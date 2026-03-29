import { load as loadHtml } from "cheerio";

import { matchesWholeAlias } from "@/lib/clawcloud-intent-match";
import { inferClawCloudRegionContext, normalizeRegionalQuestion } from "@/lib/clawcloud-region-context";

type ConsumerPriceMode = "retail" | "wholesale";

type ConsumerCommodityDefinition = {
  key: string;
  displayLabel: string;
  pageLabels: string[];
  aliases: string[];
};

type ConsumerPriceIntent = {
  commodity: ConsumerCommodityDefinition;
  mode: ConsumerPriceMode;
  hasIndiaContext: boolean;
};

type ConsumerPriceSnapshot = {
  retailDate: string | null;
  wholesaleDate: string | null;
  retailPrice: number | null;
  wholesalePrice: number | null;
};

const INDIA_CONSUMER_PRICE_URL = "https://fcainfoweb.nic.in/default.aspx";

const CONSUMER_PRICE_SIGNAL =
  /\b(price|rate|cost|how much|current|today|right now|now|currently|retail|wholesale|mandi|kg|kilo|quintal|qtl|rupee|rupees|rs|₹)\b/i;

const EXCLUDED_PRICE_TOPICS =
  /\b(gold|silver|petrol|diesel|lpg|cylinder|bitcoin|btc|ethereum|eth|stock|share|crypto|nav|mutual fund|market cap|exchange rate|gdp|inflation|unemployment|salary|rent)\b/i;

const WHOLESALE_SIGNAL = /\b(wholesale|mandi|qtl|quintal)\b/i;

const SUPPORTED_CONSUMER_COMMODITIES: ConsumerCommodityDefinition[] = [
  {
    key: "tomato",
    displayLabel: "Tomato",
    pageLabels: ["Tomato"],
    aliases: ["tomato", "tomatoes", "tamatar", "टमाटर"],
  },
  {
    key: "onion",
    displayLabel: "Onion",
    pageLabels: ["Onion"],
    aliases: ["onion", "onions", "pyaz", "pyaaz", "प्याज", "प्याज़", "onion price"],
  },
  {
    key: "potato",
    displayLabel: "Potato",
    pageLabels: ["Potato"],
    aliases: ["potato", "potatoes", "aloo", "आलू"],
  },
  {
    key: "banana",
    displayLabel: "Banana",
    pageLabels: ["Banana"],
    aliases: ["banana", "bananas", "kela", "केला"],
  },
  {
    key: "brinjal",
    displayLabel: "Brinjal",
    pageLabels: ["Brinjal"],
    aliases: ["brinjal", "eggplant", "baingan", "बैंगन"],
  },
  {
    key: "ginger",
    displayLabel: "Ginger",
    pageLabels: ["Ginger"],
    aliases: ["ginger", "adrak", "अदरक"],
  },
  {
    key: "garlic",
    displayLabel: "Garlic",
    pageLabels: ["Garlic"],
    aliases: ["garlic", "lahsun", "lehsun", "लहसुन"],
  },
  {
    key: "rice",
    displayLabel: "Rice",
    pageLabels: ["Rice"],
    aliases: ["rice", "chawal", "चावल"],
  },
  {
    key: "wheat",
    displayLabel: "Wheat",
    pageLabels: ["Wheat"],
    aliases: ["wheat", "गेहूं", "गेहूँ", "gehun", "gehu"],
  },
  {
    key: "atta",
    displayLabel: "Atta",
    pageLabels: ["Atta (Wheat)"],
    aliases: ["atta", "flour", "wheat flour", "आटा"],
  },
  {
    key: "sugar",
    displayLabel: "Sugar",
    pageLabels: ["Sugar"],
    aliases: ["sugar", "चीनी", "cheeni"],
  },
  {
    key: "salt",
    displayLabel: "Salt",
    pageLabels: ["Salt Pack (Iodised)"],
    aliases: ["salt", "namak", "नमक"],
  },
  {
    key: "gram_dal",
    displayLabel: "Gram dal",
    pageLabels: ["Gram Dal"],
    aliases: ["gram dal", "chana dal", "चना दाल", "चना dal"],
  },
  {
    key: "tur_dal",
    displayLabel: "Tur dal",
    pageLabels: ["Tur/Arhar Dal"],
    aliases: ["tur dal", "arhar dal", "toor dal", "अरहर दाल", "तूर दाल"],
  },
  {
    key: "urad_dal",
    displayLabel: "Urad dal",
    pageLabels: ["Urad Dal"],
    aliases: ["urad dal", "उड़द दाल", "उरद दाल"],
  },
  {
    key: "moong_dal",
    displayLabel: "Moong dal",
    pageLabels: ["Moong Dal"],
    aliases: ["moong dal", "mung dal", "मूंग दाल"],
  },
  {
    key: "masoor_dal",
    displayLabel: "Masoor dal",
    pageLabels: ["Masoor Dal", "Masur Dal"],
    aliases: ["masoor dal", "masur dal", "मसूर दाल"],
  },
];

function normalizeWhitespace(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatIndiaAmount(value: number) {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeDateLabel(value: string | null | undefined) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;

  const toDayMonthYear = (date: Date) => {
    const day = date.getUTCDate().toString().padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[date.getUTCMonth()] ?? "";
    const year = date.getUTCFullYear().toString();
    return `${day}-${month}-${year}`;
  };

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    const parsed = new Date(`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return toDayMonthYear(parsed);
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return toDayMonthYear(parsed);
  }

  return raw;
}

function fetchTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
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

function detectConsumerCommodity(question: string) {
  const normalized = normalizeRegionalQuestion(question).toLowerCase();
  return SUPPORTED_CONSUMER_COMMODITIES.find((commodity) =>
    commodity.aliases.some((alias) => matchesWholeAlias(normalized, alias.toLowerCase())),
  ) ?? null;
}

function detectConsumerPriceIntent(question: string): ConsumerPriceIntent | null {
  const normalized = normalizeRegionalQuestion(question).toLowerCase();
  if (!CONSUMER_PRICE_SIGNAL.test(normalized)) {
    return null;
  }
  if (EXCLUDED_PRICE_TOPICS.test(normalized)) {
    return null;
  }

  const commodity = detectConsumerCommodity(question);
  if (!commodity) {
    return null;
  }

  const region = inferClawCloudRegionContext(question);
  const hasIndiaContext = region.requestedRegion?.code === "IN" || region.mentionedRegions.some((entry) => entry.code === "IN");

  return {
    commodity,
    mode: WHOLESALE_SIGNAL.test(normalized) ? "wholesale" : "retail",
    hasIndiaContext,
  };
}

export function looksLikeConsumerStaplePriceQuestion(question: string) {
  return detectConsumerPriceIntent(question) !== null;
}

export function buildConsumerStaplePriceClarification(question: string) {
  const intent = detectConsumerPriceIntent(question);
  if (!intent) {
    return "";
  }

  if (intent.hasIndiaContext) {
    return [
      `🛒 *${intent.commodity.displayLabel} price in India*`,
      "",
      "I usually answer this from the Department of Consumer Affairs daily price monitor.",
      "That official source was not reachable just now, so please retry in a moment for the latest all-India average.",
    ].join("\n");
  }

  return [
    `🛒 *${intent.commodity.displayLabel} price lookup*`,
    "",
    "Retail grocery prices are usually city- or market-specific, so I need a tighter location for a precise current figure.",
    "Send the country + city or market, and I will narrow it down properly.",
    "",
    "Example: _tomato price in Delhi today_ or _onion price in Dubai right now_",
  ].join("\n");
}

export function detectIndiaConsumerPriceQuestion(question: string) {
  const intent = detectConsumerPriceIntent(question);
  if (!intent?.hasIndiaContext) {
    return null;
  }
  return intent;
}

function extractSection(text: string, start: RegExp, end?: RegExp) {
  const startMatch = start.exec(text);
  if (!startMatch || startMatch.index === undefined) {
    return "";
  }

  const afterStart = text.slice(startMatch.index);
  if (!end) {
    return afterStart;
  }

  const endMatch = end.exec(afterStart);
  if (!endMatch || endMatch.index === undefined) {
    return afterStart;
  }

  return afterStart.slice(0, endMatch.index);
}

function extractSectionPrice(section: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(`${escapeRegExp(label)}\\s+([0-9]+(?:\\.[0-9]+)?)`, "i");
    const match = pattern.exec(section);
    const value = match?.[1] ? Number.parseFloat(match[1]) : Number.NaN;
    if (!Number.isNaN(value)) {
      return value;
    }
  }
  return null;
}

function parseConsumerPriceSnapshot(html: string, commodity: ConsumerCommodityDefinition): ConsumerPriceSnapshot | null {
  const $ = loadHtml(html);
  const text = normalizeWhitespace($("body").text());
  if (!text) {
    return null;
  }

  const retailDate = normalizeDateLabel(
    text.match(/All India Average Retail Price\s*\([^)]+\)\s*As on\s*([0-9/.-]+)/i)?.[1] ?? null,
  );
  const wholesaleDate = normalizeDateLabel(
    text.match(/All India Average Wholesale Price\s*\([^)]+\)\s*As on\s*([0-9/.-]+)/i)?.[1] ?? null,
  );

  const retailSection = extractSection(
    text,
    /All India Average Retail Price\s*\([^)]+\)\s*As on\s*[0-9/.-]+/i,
    /All India Average Wholesale Price\s*\([^)]+\)\s*As on\s*[0-9/.-]+/i,
  );
  const wholesaleSection = extractSection(
    text,
    /All India Average Wholesale Price\s*\([^)]+\)\s*As on\s*[0-9/.-]+/i,
    /Website Content Managed by/i,
  );

  const retailPrice = extractSectionPrice(retailSection, commodity.pageLabels);
  const wholesalePrice = extractSectionPrice(wholesaleSection, commodity.pageLabels);

  if (retailPrice === null && wholesalePrice === null) {
    return null;
  }

  return {
    retailDate,
    wholesaleDate,
    retailPrice,
    wholesalePrice,
  };
}

function buildIndiaConsumerPriceReply(intent: ConsumerPriceIntent, snapshot: ConsumerPriceSnapshot) {
  const label = intent.mode === "wholesale"
    ? `🛒 *${intent.commodity.displayLabel} wholesale price in India*`
    : `🛒 *${intent.commodity.displayLabel} price in India*`;

  const lines = [label];

  if (intent.mode === "wholesale" && snapshot.wholesalePrice !== null) {
    lines.push(`*All-India average wholesale price:* *₹${formatIndiaAmount(snapshot.wholesalePrice)} per quintal*`);
    if (snapshot.retailPrice !== null) {
      lines.push(`• Retail average: *₹${formatIndiaAmount(snapshot.retailPrice)} per kg*`);
    }
    if (snapshot.wholesaleDate) {
      lines.push(`• Official date: *${snapshot.wholesaleDate}*`);
    }
  } else if (snapshot.retailPrice !== null) {
    lines.push(`*All-India average retail price:* *₹${formatIndiaAmount(snapshot.retailPrice)} per kg*`);
    if (snapshot.wholesalePrice !== null) {
      lines.push(`• Wholesale average: *₹${formatIndiaAmount(snapshot.wholesalePrice)} per quintal*`);
    }
    if (snapshot.retailDate) {
      lines.push(`• Official date: *${snapshot.retailDate}*`);
    }
  }

  lines.push("• Source: Department of Consumer Affairs, Price Monitoring System (fcainfoweb.nic.in)");
  lines.push("• Note: local city and mandi prices can vary from the national average.");

  return lines.join("\n").trim();
}

function answerHasDate(answer: string) {
  return /\b\d{2}-[A-Za-z]{3}-\d{4}\b/.test(answer) || /\b20\d{2}\b/.test(answer);
}

export function isCompleteIndiaConsumerPriceAnswer(question: string, answer: string) {
  const intent = detectIndiaConsumerPriceQuestion(question);
  if (!intent) {
    return true;
  }

  const normalized = answer.trim();
  if (!normalized) {
    return false;
  }

  const hasCommodity = intent.commodity.aliases.some((alias) => matchesWholeAlias(normalized.toLowerCase(), alias.toLowerCase()))
    || matchesWholeAlias(normalized.toLowerCase(), intent.commodity.displayLabel.toLowerCase());
  const hasIndia = /\bindia\b|भारत/i.test(normalized);
  const hasCurrency = /(₹|inr)/i.test(normalized);
  const hasUnit = intent.mode === "wholesale"
    ? /\bper quintal\b|\bper qtl\b/i.test(normalized)
    : /\bper kg\b|\bper kilo\b/i.test(normalized);
  const hasSource = /\bdepartment of consumer affairs\b|\bprice monitoring system\b|fcainfoweb\.nic\.in/i.test(normalized);

  return hasCommodity && hasIndia && hasCurrency && hasUnit && hasSource && answerHasDate(normalized);
}

export async function fetchIndiaConsumerPriceAnswer(question: string) {
  const intent = detectIndiaConsumerPriceQuestion(question);
  if (!intent) {
    return "";
  }

  const html = await fetchTextWithTimeout(INDIA_CONSUMER_PRICE_URL, 9_000);
  if (!html) {
    return "";
  }

  const snapshot = parseConsumerPriceSnapshot(html, intent.commodity);
  if (!snapshot) {
    return "";
  }

  return buildIndiaConsumerPriceReply(intent, snapshot);
}
