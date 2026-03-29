import { load as loadHtml } from "cheerio";

import { inferClawCloudRegionContext, normalizeRegionalQuestion } from "@/lib/clawcloud-region-context";
import { searchInternetWithDiagnostics } from "@/lib/search";

type RetailFuelKind = "gasoline" | "diesel" | "lpg";

type RetailFuelIntent = {
  kind: RetailFuelKind;
  displayLabel: string;
  countryCandidate: string | null;
  missingCountry: boolean;
};

type FuelCountryEntry = {
  slug: string;
  label: string;
  normalizedLabel: string;
};

type FuelPriceSnapshot = {
  country: string;
  displayLabel: string;
  localCurrency: string;
  localPrice: string;
  usdPrice: string;
  updatedAt: string;
  timingLabel?: string | null;
  worldAverageUsd?: string | null;
  sourceLabel?: string | null;
};

const GLOBAL_PETROL_BASE_URL = "https://www.globalpetrolprices.com";
const GLOBAL_PETROL_COUNTRIES_URL = `${GLOBAL_PETROL_BASE_URL}/countries/`;

const FUEL_KIND_ALIASES: Array<{
  kind: RetailFuelKind;
  displayLabel: string;
  aliases: string[];
}> = [
  {
    kind: "gasoline",
    displayLabel: "petrol",
    aliases: ["petrol", "gasoline", "gas price", "gas prices", "gasoline price", "petrol price", "gasolina"],
  },
  {
    kind: "diesel",
    displayLabel: "diesel",
    aliases: ["diesel", "diesel price", "diesel fuel", "diesel fuel price", "gasoil"],
  },
  {
    kind: "lpg",
    displayLabel: "lpg",
    aliases: ["lpg", "lpg price", "autogas", "autogas price", "cooking gas", "cylinder gas"],
  },
];

const FUEL_KIND_TO_PATH: Record<RetailFuelKind, string> = {
  gasoline: "gasoline_prices",
  diesel: "diesel_prices",
  lpg: "lpg_prices",
};

const COUNTRY_ALIAS_TO_SLUG = new Map<string, string>([
  ["usa", "USA"],
  ["united states", "USA"],
  ["united states of america", "USA"],
  ["uk", "United-Kingdom"],
  ["united kingdom", "United-Kingdom"],
  ["britain", "United-Kingdom"],
  ["great britain", "United-Kingdom"],
  ["uae", "United-Arab-Emirates"],
  ["united arab emirates", "United-Arab-Emirates"],
  ["south korea", "South-Korea"],
  ["republic of korea", "South-Korea"],
  ["north korea", "North-Korea"],
  ["democratic peoples republic of korea", "North-Korea"],
  ["czechia", "Czech-Republic"],
  ["czech republic", "Czech-Republic"],
  ["turkiye", "Turkey"],
  ["russian federation", "Russia"],
  ["myanmar", "Burma-Myanmar"],
  ["burma", "Burma-Myanmar"],
  ["hong kong", "Hong-Kong"],
  ["new zealand", "New-Zealand"],
  ["saudi arabia", "Saudi-Arabia"],
  ["south africa", "South-Africa"],
  ["ivory coast", "Ivory-Coast"],
  ["cote divoire", "Ivory-Coast"],
  ["cote d ivoire", "Ivory-Coast"],
  ["dr congo", "Democratic-Republic-of-the-Congo"],
  ["democratic republic of the congo", "Democratic-Republic-of-the-Congo"],
  ["dominican republic", "Dominican-Republic"],
  ["trinidad and tobago", "Trinidad-and-Tobago"],
  ["bosnia and herzegovina", "Bosnia-and-Herzegovina"],
  ["north macedonia", "Macedonia"],
]);

let fuelCountryCache: { expiresAt: number; entries: FuelCountryEntry[] } | null = null;

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsWholeNormalizedTerm(haystack: string, needle: string) {
  if (!haystack || !needle) return false;
  const paddedHaystack = ` ${haystack} `;
  return paddedHaystack.includes(` ${needle} `);
}

function fetchTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

function formatFuelDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).replace(/ /g, "-");
}

function normalizeFuelDateLabel(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  const explicit = raw.match(/\b(\d{2}-[A-Za-z]{3}-\d{4})\b/);
  if (explicit?.[1]) {
    return explicit[1];
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return formatFuelDate(parsed);
  }

  const iso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const [_, year, month, day] = iso;
    const parsedIso = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isNaN(parsedIso.getTime())) {
      return formatFuelDate(parsedIso);
    }
  }

  return null;
}

async function fetchTextWithTimeout(url: string, timeoutMs = 8_000) {
  const timeout = fetchTimeoutSignal(timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 ClawCloud/1.0" },
      signal: timeout.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  } finally {
    timeout.clear();
  }
}

function detectRetailFuelKind(question: string) {
  const normalized = normalizeRegionalQuestion(question).toLowerCase();
  if (/\bnatural gas\b/i.test(normalized)) {
    return null;
  }

  for (const candidate of FUEL_KIND_ALIASES) {
    if (candidate.aliases.some((alias) => containsWholeNormalizedTerm(normalized, normalizeLookupKey(alias)))) {
      return candidate;
    }
  }

  return null;
}

function extractCountryCandidate(question: string) {
  const normalized = normalizeRegionalQuestion(question);
  const patterns = [
    /\b(?:in|for|of|at)\s+(.+?)(?:\b(?:right now|today|now|currently|current|latest|per liter|per litre)\b|$)/i,
    /^(.+?)\s+\b(?:petrol|gasoline|diesel|lpg|gasolina|gasoil|autogas)\b/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(normalized);
    const candidate = match?.[1]
      ?.replace(/\b(price|cost|rate|value|worth|fuel|petrol|gasoline|diesel|lpg|gasolina|gasoil|autogas)\b/gi, " ")
      ?.replace(/\b(in|for|of|at)\b/gi, " ")
      ?.replace(/[?.,;:()]/g, " ")
      ?.replace(/\s+/g, " ")
      ?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return null;
}

export function detectRetailFuelPriceQuestion(question: string): RetailFuelIntent | null {
  const kind = detectRetailFuelKind(question);
  if (!kind) {
    return null;
  }

  const normalized = normalizeRegionalQuestion(question).toLowerCase();
  const hasPriceSignal = /\b(price|cost|rate|how much|what is|current|today|right now|now|currently|per liter|per litre)\b/i.test(normalized);
  if (!hasPriceSignal) {
    return null;
  }

  const countryCandidate = extractCountryCandidate(question);
  return {
    kind: kind.kind,
    displayLabel: kind.displayLabel,
    countryCandidate,
    missingCountry: !countryCandidate,
  };
}

async function fetchFuelCountryEntries() {
  if (fuelCountryCache && fuelCountryCache.expiresAt > Date.now()) {
    return fuelCountryCache.entries;
  }

  const html = await fetchTextWithTimeout(GLOBAL_PETROL_COUNTRIES_URL, 9_000);
  if (!html) {
    return [];
  }

  const $ = loadHtml(html);
  const entries = $("a.unitElement")
    .toArray()
    .map((element) => {
      const href = $(element).attr("href") ?? "";
      const label = $(element).text().replace(/\s+/g, " ").trim();
      const slug = href.match(/globalpetrolprices\.com\/([^/?#]+)\//i)?.[1]?.trim() ?? "";
      if (!slug || !label) {
        return null;
      }
      return {
        slug,
        label,
        normalizedLabel: normalizeLookupKey(label),
      };
    })
    .filter((entry): entry is FuelCountryEntry => Boolean(entry));

  if (entries.length) {
    fuelCountryCache = {
      expiresAt: Date.now() + 12 * 60 * 60 * 1_000,
      entries,
    };
  }

  return entries;
}

function resolveFuelCountryBySlug(slug: string, entries: FuelCountryEntry[]) {
  return entries.find((entry) => entry.slug === slug) ?? null;
}

function resolveFuelCountryCandidate(candidate: string, entries: FuelCountryEntry[]) {
  const normalizedCandidate = normalizeLookupKey(candidate);
  if (!normalizedCandidate) {
    return null;
  }

  const aliasedSlug = COUNTRY_ALIAS_TO_SLUG.get(normalizedCandidate);
  if (aliasedSlug) {
    const aliased = resolveFuelCountryBySlug(aliasedSlug, entries);
    if (aliased) {
      return aliased;
    }
  }

  const exact = entries.find((entry) =>
    entry.normalizedLabel === normalizedCandidate || normalizeLookupKey(entry.slug) === normalizedCandidate,
  );
  if (exact) {
    return exact;
  }

  const containing = entries.filter((entry) =>
    entry.normalizedLabel.includes(normalizedCandidate)
    || normalizedCandidate.includes(entry.normalizedLabel),
  );
  if (containing.length === 1) {
    return containing[0];
  }

  return null;
}

function resolveFuelCountryFromQuestion(question: string, entries: FuelCountryEntry[]) {
  const intent = detectRetailFuelPriceQuestion(question);
  const context = inferClawCloudRegionContext(question);
  const preferredCountryCandidate = context.requestedRegionMatchType === "locality"
    ? context.requestedRegion?.countryName ?? intent?.countryCandidate ?? null
    : intent?.countryCandidate ?? null;
  const candidates = [
    preferredCountryCandidate,
    intent?.countryCandidate ?? null,
    context.requestedRegion?.countryName ?? null,
    question,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const resolved = resolveFuelCountryCandidate(candidate, entries);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function titleCaseFuelCountryLabel(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => {
      if (part.length <= 3 && /^[A-Z]+$/.test(part)) {
        return part;
      }
      return `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`;
    })
    .join(" ");
}

function buildFallbackFuelCountryEntry(question: string) {
  const intent = detectRetailFuelPriceQuestion(question);
  const context = inferClawCloudRegionContext(question);
  const rawCountry = context.requestedRegionMatchType === "locality"
    ? context.requestedRegion?.countryName ?? intent?.countryCandidate ?? null
    : intent?.countryCandidate ?? context.requestedRegion?.countryName ?? null;
  if (!rawCountry) {
    return null;
  }

  const normalizedCountry = normalizeLookupKey(rawCountry);
  const slug = COUNTRY_ALIAS_TO_SLUG.get(normalizedCountry)
    ?? titleCaseFuelCountryLabel(rawCountry).replace(/\s+/g, "-");
  const label = context.requestedRegion?.countryName ?? titleCaseFuelCountryLabel(rawCountry);

  if (!slug || !label) {
    return null;
  }

  return {
    slug,
    label,
    normalizedLabel: normalizeLookupKey(label),
  } satisfies FuelCountryEntry;
}

function parseFuelPricePage(html: string, kind: RetailFuelKind): FuelPriceSnapshot | null {
  const $ = loadHtml(html);
  const root = $("#graphPageLeft");
  const intro = root.find("div[style*='text-align: justify']").first().text().replace(/\s+/g, " ").trim();
  const heading = root.find("h1").first().text().replace(/\s+/g, " ").trim();
  const sourceLabel = root
    .find("a")
    .toArray()
    .map((element) => $(element).text().replace(/\s+/g, " ").trim())
    .find((text) => Boolean(text) && !/download|forecast|data|home|countries/i.test(text)) ?? null;

  const country = heading.replace(/\s+(Gasoline|Diesel|LPG)\s+prices.*$/i, "").trim();
  const displayLabel = kind === "gasoline" ? "petrol" : kind.toUpperCase();
  const introMatch = intro.match(
    /is\s+([A-Z]{3})\s+([\d.]+)\s+per liter\s+or\s+USD\s+([\d.]+)\s+per liter[\s\S]*?(?:updated on|update from)\s+([0-9]{2}-[A-Za-z]{3}-[0-9]{4})/i,
  );
  const worldAverageUsd = intro.match(/world average [^.]*?USD\s+([\d.]+)\s+per liter/i)?.[1] ?? null;

  if (introMatch?.[1] && introMatch[2] && introMatch[3] && introMatch[4] && country) {
    return {
      country,
      displayLabel,
      localCurrency: introMatch[1],
      localPrice: introMatch[2],
      usdPrice: introMatch[3],
      updatedAt: introMatch[4],
      worldAverageUsd,
      sourceLabel,
    };
  }

  return null;
}

function parseFuelSearchSnippet(
  text: string,
  kind: RetailFuelKind,
  countryLabel: string,
  publishedDate?: string | null,
) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (!normalizedText) {
    return null;
  }

  const displayLabel = kind === "gasoline" ? "petrol" : kind.toUpperCase();
  const localMatch = normalizedText.match(/([A-Z]{3})\s+([\d.]+)\s+per liter\s+or\s+USD\s+([\d.]+)\s+per liter/i);
  const updatedAt = normalizeFuelDateLabel(normalizedText) ?? normalizeFuelDateLabel(publishedDate) ?? formatFuelDate(new Date());
  const worldAverageUsd = normalizedText.match(/world average [^.]*?USD\s+([\d.]+)\s+per liter/i)?.[1] ?? null;

  if (!localMatch?.[1] || !localMatch[2] || !localMatch[3]) {
    return null;
  }

  return {
    country: countryLabel,
    displayLabel,
    localCurrency: localMatch[1],
    localPrice: localMatch[2],
    usdPrice: localMatch[3],
    updatedAt,
    timingLabel: /updated on|update from/i.test(normalizedText) ? "Last update" : "Live data as of",
    worldAverageUsd,
    sourceLabel: "globalpetrolprices.com",
  } satisfies FuelPriceSnapshot;
}

function formatFuelAnswer(snapshot: FuelPriceSnapshot) {
  const lines = [
    `⛽ *${snapshot.country} ${snapshot.displayLabel} price*`,
    `*Latest national average retail price:* *${snapshot.localCurrency} ${snapshot.localPrice} per liter*`,
    `• USD equivalent: *$${snapshot.usdPrice} per liter*`,
    `• ${snapshot.timingLabel ?? "Last update"}: *${snapshot.updatedAt}*`,
    snapshot.worldAverageUsd ? `• World average: *$${snapshot.worldAverageUsd} per liter*` : "",
    "• Note: city and station prices can vary from the national average.",
    `Sources: globalpetrolprices.com${snapshot.sourceLabel ? `, ${snapshot.sourceLabel}` : ""}`,
  ];

  return lines.filter(Boolean).join("\n");
}

export function isCompleteRetailFuelAnswer(question: string, answer: string) {
  const intent = detectRetailFuelPriceQuestion(question);
  if (!intent) {
    return true;
  }

  const normalizedAnswer = answer.trim().toLowerCase();
  if (!normalizedAnswer) {
    return false;
  }

  if (
    /tell me the country|share the country|which country|could not match the country|couldn't match the country|could not confirm a reliable national retail price|couldn't confirm a reliable national retail price/.test(normalizedAnswer)
  ) {
    return true;
  }

  const hasFuelSignal = new RegExp(`\\b(${intent.displayLabel}|gasoline|diesel|lpg)\\b`, "i").test(answer);
  const hasPrice =
    /\b[A-Z]{3}\s+\d+(?:\.\d+)?\s+per lit(?:er|re)\b/.test(answer)
    || /\$\d+(?:\.\d+)?\s+per lit(?:er|re)/i.test(answer);
  const hasDate = /\b\d{2}-[A-Za-z]{3}-\d{4}\b/.test(answer);
  const hasSource = /\bsources?:/i.test(answer);

  return hasFuelSignal && hasPrice && hasDate && hasSource;
}

async function fetchFuelPriceFromSearch(
  country: FuelCountryEntry,
  intent: RetailFuelIntent,
) {
  const search = await searchInternetWithDiagnostics(
    [
      `site:globalpetrolprices.com ${country.label} ${intent.kind} prices`,
      `${country.label} ${intent.displayLabel} price per liter globalpetrolprices`,
    ],
    {
      maxQueries: 2,
      maxResults: 8,
    },
  ).catch(() => null);

  const candidates = search?.sources?.filter((source) => source.domain.includes("globalpetrolprices.com")) ?? [];
  for (const source of candidates) {
    const snapshot = parseFuelSearchSnippet(
      `${source.title} ${source.snippet}`.trim(),
      intent.kind,
      country.label,
      source.publishedDate ?? null,
    );
    if (snapshot) {
      return snapshot;
    }
  }

  return null;
}

export async function fetchRetailFuelPriceAnswer(question: string) {
  const intent = detectRetailFuelPriceQuestion(question);
  if (!intent) {
    return "";
  }

  if (intent.missingCountry) {
    return [
      "⛽ *Retail fuel price check*",
      "",
      `Tell me the *country* for the current ${intent.displayLabel} price.`,
      `Example: _${intent.displayLabel} price in China right now_`,
      "Sources: globalpetrolprices.com",
    ].join("\n");
  }

  const entries = await fetchFuelCountryEntries();
  const country = entries.length
    ? resolveFuelCountryFromQuestion(question, entries)
    : buildFallbackFuelCountryEntry(question);
  if (!country) {
    return [
      "⛽ *Retail fuel price check*",
      "",
      "I couldn't match that country to a supported retail fuel source.",
      "Try the full country name, for example: _petrol price in China right now_.",
      "Sources: globalpetrolprices.com",
    ].join("\n");
  }

  const html = await fetchTextWithTimeout(
    `${GLOBAL_PETROL_BASE_URL}/${country.slug}/${FUEL_KIND_TO_PATH[intent.kind]}/`,
    10_000,
  );
  if (!html) {
    const searchFallback = await fetchFuelPriceFromSearch(country, intent);
    if (searchFallback) {
      return formatFuelAnswer(searchFallback);
    }
    return [
      `⛽ *${country.label} ${intent.displayLabel} price*`,
      "",
      "I couldn't confirm a reliable national retail price right now. Please try again shortly.",
      "Sources: globalpetrolprices.com",
    ].join("\n");
  }

  const snapshot = parseFuelPricePage(html, intent.kind);
  if (!snapshot) {
    const searchFallback = await fetchFuelPriceFromSearch(country, intent);
    if (searchFallback) {
      return formatFuelAnswer(searchFallback);
    }
    return [
      `⛽ *${country.label} ${intent.displayLabel} price*`,
      "",
      "I found the country page, but I couldn't parse a reliable current national retail price from it.",
      "Sources: globalpetrolprices.com",
    ].join("\n");
  }

  return formatFuelAnswer(snapshot);
}
