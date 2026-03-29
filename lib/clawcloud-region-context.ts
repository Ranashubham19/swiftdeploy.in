import { matchesWholeAlias } from "@/lib/clawcloud-intent-match";

type RegionDefinition = {
  code: string;
  canonical: string;
  countryName: string;
  currency: string;
  gl: string;
  hl: string;
  timeZone: string;
  goldDisplayUnit?: "gram" | "10g";
  aliases: string[];
  localityAliases?: string[];
};

type CurrencyAliasDefinition = {
  currency: string;
  aliases: string[];
};

type CanonicalTermDefinition = {
  replacement: string;
  aliases: string[];
};

export type ClawCloudRegionContext = {
  normalizedQuestion: string;
  requestedCurrency: string | null;
  requestedRegion: RegionDefinition | null;
  mentionedRegions: RegionDefinition[];
  requestedRegionMatchType: "country" | "locality" | null;
  languageHint: string | null;
};

const REGION_DEFINITIONS: RegionDefinition[] = [
  {
    code: "IN",
    canonical: "india",
    countryName: "India",
    currency: "INR",
    gl: "in",
    hl: "en",
    timeZone: "Asia/Kolkata",
    goldDisplayUnit: "10g",
    aliases: ["india", "indian", "bharat", "भारत", "hindustan", "हिंदुस्तान"],
  },
  {
    code: "US",
    canonical: "usa",
    countryName: "United States",
    currency: "USD",
    gl: "us",
    hl: "en",
    timeZone: "America/New_York",
    aliases: [
      "usa",
      "u.s.a.",
      "u.s.",
      "united states",
      "united states of america",
      "america",
      "american",
      "अमेरिका",
    ],
  },
  {
    code: "GB",
    canonical: "uk",
    countryName: "United Kingdom",
    currency: "GBP",
    gl: "uk",
    hl: "en",
    timeZone: "Europe/London",
    aliases: ["uk", "u.k.", "britain", "british", "united kingdom"],
    localityAliases: ["england", "london"],
  },
  {
    code: "AE",
    canonical: "uae",
    countryName: "United Arab Emirates",
    currency: "AED",
    gl: "ae",
    hl: "en",
    timeZone: "Asia/Dubai",
    goldDisplayUnit: "gram",
    aliases: ["uae", "u.a.e.", "united arab emirates", "emirates", "dubai", "abu dhabi", "दुबई"],
  },
  {
    code: "JP",
    canonical: "japan",
    countryName: "Japan",
    currency: "JPY",
    gl: "jp",
    hl: "en",
    timeZone: "Asia/Tokyo",
    goldDisplayUnit: "gram",
    aliases: ["japan", "japanese", "tokyo", "जापान"],
  },
  {
    code: "SG",
    canonical: "singapore",
    countryName: "Singapore",
    currency: "SGD",
    gl: "sg",
    hl: "en",
    timeZone: "Asia/Singapore",
    goldDisplayUnit: "gram",
    aliases: ["singapore", "singaporean"],
  },
  {
    code: "AU",
    canonical: "australia",
    countryName: "Australia",
    currency: "AUD",
    gl: "au",
    hl: "en",
    timeZone: "Australia/Sydney",
    aliases: ["australia", "australian", "sydney", "melbourne"],
  },
  {
    code: "CA",
    canonical: "canada",
    countryName: "Canada",
    currency: "CAD",
    gl: "ca",
    hl: "en",
    timeZone: "America/Toronto",
    aliases: ["canada", "canadian", "toronto", "vancouver"],
  },
  {
    code: "CN",
    canonical: "china",
    countryName: "China",
    currency: "CNY",
    gl: "cn",
    hl: "en",
    timeZone: "Asia/Shanghai",
    aliases: ["china", "chinese", "beijing", "shanghai", "चीन"],
  },
  {
    code: "DE",
    canonical: "germany",
    countryName: "Germany",
    currency: "EUR",
    gl: "de",
    hl: "en",
    timeZone: "Europe/Berlin",
    aliases: ["germany", "german", "berlin", "deutschland"],
  },
  {
    code: "FR",
    canonical: "france",
    countryName: "France",
    currency: "EUR",
    gl: "fr",
    hl: "en",
    timeZone: "Europe/Paris",
    aliases: ["france", "french", "paris"],
  },
  {
    code: "IT",
    canonical: "italy",
    countryName: "Italy",
    currency: "EUR",
    gl: "it",
    hl: "en",
    timeZone: "Europe/Rome",
    aliases: ["italy", "italian", "rome", "milan"],
  },
  {
    code: "ES",
    canonical: "spain",
    countryName: "Spain",
    currency: "EUR",
    gl: "es",
    hl: "en",
    timeZone: "Europe/Madrid",
    aliases: ["spain", "spanish", "madrid", "barcelona", "españa"],
  },
  {
    code: "SA",
    canonical: "saudi arabia",
    countryName: "Saudi Arabia",
    currency: "SAR",
    gl: "sa",
    hl: "en",
    timeZone: "Asia/Riyadh",
    goldDisplayUnit: "gram",
    aliases: ["saudi", "saudi arabia", "riyadh", "jeddah"],
  },
  {
    code: "IL",
    canonical: "israel",
    countryName: "Israel",
    currency: "ILS",
    gl: "il",
    hl: "en",
    timeZone: "Asia/Jerusalem",
    aliases: ["israel", "israeli", "iseral", "isreal", "tel aviv", "jerusalem"],
  },
];

const REGION_LOCALITY_ALIAS_MAP: Record<string, string[]> = {
  uk: ["england", "london"],
  uae: ["dubai", "abu dhabi", "à¤¦à¥à¤¬à¤ˆ"],
  japan: ["tokyo"],
  australia: ["sydney", "melbourne"],
  canada: ["toronto", "vancouver"],
  china: ["beijing", "shanghai"],
  germany: ["berlin"],
  france: ["paris"],
  italy: ["rome", "milan"],
  spain: ["madrid", "barcelona"],
  "saudi arabia": ["riyadh", "jeddah"],
  israel: ["tel aviv", "jerusalem"],
};

type RegionAliasMatch = {
  region: RegionDefinition;
  index: number;
  kind: "country" | "locality";
};

const CURRENCY_ALIASES: CurrencyAliasDefinition[] = [
  {
    currency: "INR",
    aliases: ["inr", "indian rupee", "rupee", "rupees", "rs", "rs.", "₹", "रुपया", "रुपये", "रुपयों"],
  },
  {
    currency: "USD",
    aliases: ["usd", "us dollar", "us dollars", "dollar", "dollars", "$", "डॉलर"],
  },
  {
    currency: "EUR",
    aliases: ["eur", "euro", "euros", "€"],
  },
  {
    currency: "GBP",
    aliases: ["gbp", "pound", "pounds", "sterling", "£"],
  },
  {
    currency: "AED",
    aliases: ["aed", "dirham", "dirhams", "dhs", "dh", "د.إ"],
  },
  {
    currency: "JPY",
    aliases: ["jpy", "yen", "¥"],
  },
  {
    currency: "SGD",
    aliases: ["sgd", "singapore dollar"],
  },
  {
    currency: "AUD",
    aliases: ["aud", "australian dollar"],
  },
  {
    currency: "CAD",
    aliases: ["cad", "canadian dollar"],
  },
  {
    currency: "CNY",
    aliases: ["cny", "yuan", "renminbi"],
  },
  {
    currency: "SAR",
    aliases: ["sar", "riyal", "riyal"],
  },
  {
    currency: "ILS",
    aliases: ["ils", "shekel", "shekels"],
  },
];

const CANONICAL_TERM_DEFINITIONS: CanonicalTermDefinition[] = [
  {
    replacement: "price",
    aliases: ["keemat", "kimat", "daam", "dam", "bhaav", "bhav", "कीमत", "भाव", "precio", "prix"],
  },
  {
    replacement: "gold",
    aliases: ["gold", "sona", "sone", "सोना", "सोने", "oro"],
  },
  {
    replacement: "silver",
    aliases: ["silver", "chandi", "चांदी", "plata"],
  },
  {
    replacement: "weather",
    aliases: [
      "weather",
      "mausam",
      "\u092e\u094c\u0938\u092e",
      "clima",
      "tiempo",
      "meteo",
      "m\u00e9t\u00e9o",
      "wetter",
    ],
  },
  {
    replacement: "temperature",
    aliases: [
      "temperature",
      "temperatura",
      "temp\u00e9rature",
      "\u0924\u093e\u092a\u092e\u093e\u0928",
    ],
  },
  {
    replacement: "forecast",
    aliases: [
      "forecast",
      "pronostico",
      "pron\u00f3stico",
      "prevision",
      "pr\u00e9vision",
      "\u092a\u0942\u0930\u094d\u0935\u093e\u0928\u0941\u092e\u093e\u0928",
    ],
  },
  {
    replacement: "news",
    aliases: [
      "news",
      "noticias",
      "actualites",
      "actualit\u00e9s",
      "\u0938\u092e\u093e\u091a\u093e\u0930",
      "\u0916\u092c\u0930",
      "khabar",
    ],
  },
  {
    replacement: "update",
    aliases: [
      "update",
      "updates",
      "actualizacion",
      "actualizaci\u00f3n",
      "mise a jour",
      "mise \u00e0 jour",
      "\u0905\u092a\u0921\u0947\u091f",
    ],
  },
  {
    replacement: "latest",
    aliases: [
      "latest",
      "recent",
      "nuevo",
      "nueva",
      "ultimas",
      "\u00faltimas",
      "dernieres",
      "derni\u00e8res",
      "\u0928\u0935\u0940\u0928\u0924\u092e",
    ],
  },
  {
    replacement: "today",
    aliases: [
      "today",
      "todays",
      "today's",
      "hoy",
      "aujourd'hui",
      "\u0906\u091c",
    ],
  },
  {
    replacement: "current",
    aliases: [
      "current",
      "currently",
      "actual",
      "actualmente",
      "present",
      "\u0905\u092d\u0940",
    ],
  },
  {
    replacement: "bitcoin",
    aliases: ["bitcoin", "btc", "बिटकॉइन"],
  },
  {
    replacement: "ethereum",
    aliases: ["ethereum", "eth", "इथेरियम"],
  },
];

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasNeedsWordBoundaries(alias: string) {
  return /^[\p{L}\p{N}\s.-]+$/u.test(alias);
}

function replaceAlias(text: string, alias: string, replacement: string) {
  const escaped = escapeRegex(alias);
  if (!escaped) {
    return text;
  }

  if (aliasNeedsWordBoundaries(alias)) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, "giu");
    return text.replace(pattern, (_match, prefix: string) => `${prefix}${replacement}`);
  }

  return text.replace(new RegExp(escaped, "giu"), ` ${replacement} `);
}

function normalizeWhitespace(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getRegionLocalityAliases(region: RegionDefinition) {
  return region.localityAliases?.length
    ? region.localityAliases
    : (REGION_LOCALITY_ALIAS_MAP[region.canonical] ?? []);
}

function getRegionCountryAliases(region: RegionDefinition) {
  const localityAliases = new Set(
    getRegionLocalityAliases(region).map((alias) => normalizeWhitespace(alias)),
  );
  return region.aliases.filter((alias) => !localityAliases.has(normalizeWhitespace(alias)));
}

function applyCanonicalTermReplacements(text: string) {
  let next = normalizeWhitespace(text);

  for (const region of REGION_DEFINITIONS) {
    for (const alias of getRegionCountryAliases(region)) {
      next = replaceAlias(next, normalizeWhitespace(alias), region.canonical);
    }
  }

  for (const currency of CURRENCY_ALIASES) {
    for (const alias of currency.aliases) {
      next = replaceAlias(next, normalizeWhitespace(alias), currency.currency.toLowerCase());
    }
  }

  for (const term of CANONICAL_TERM_DEFINITIONS) {
    for (const alias of term.aliases) {
      next = replaceAlias(next, normalizeWhitespace(alias), term.replacement);
    }
  }

  return next.replace(/\s+/g, " ").trim();
}

function findCurrencyInQuestion(normalizedQuestion: string) {
  for (const currency of CURRENCY_ALIASES) {
    if (matchesWholeAlias(normalizedQuestion, currency.currency.toLowerCase())) {
      return currency.currency;
    }
  }

  return null;
}

function findRegionAliasMatchIndex(text: string, alias: string) {
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(alias)}(?=$|[^\\p{L}\\p{N}])`, "iu");
  const match = pattern.exec(text);
  return match?.index ?? -1;
}

function buildRegionAliasMatches(normalizedQuestion: string) {
  return REGION_DEFINITIONS
    .map((region) => {
      const aliasCandidates = [
        { alias: region.canonical, kind: "country" as const },
        ...getRegionCountryAliases(region).map((alias) => ({
          alias: normalizeWhitespace(alias),
          kind: "country" as const,
        })),
        ...getRegionLocalityAliases(region).map((alias) => ({
          alias: normalizeWhitespace(alias),
          kind: "locality" as const,
        })),
      ];

      const bestMatch = aliasCandidates
        .map((entry) => ({
          ...entry,
          index: findRegionAliasMatchIndex(normalizedQuestion, entry.alias),
        }))
        .filter((entry) => entry.index >= 0)
        .sort((left, right) => left.index - right.index)[0];

      if (!bestMatch) {
        return null;
      }

      return {
        region,
        index: bestMatch.index,
        kind: bestMatch.kind,
      } satisfies RegionAliasMatch;
    })
    .filter((entry): entry is RegionAliasMatch => Boolean(entry))
    .sort((left, right) => left.index - right.index);
}

function findMentionedRegions(normalizedQuestion: string) {
  return buildRegionAliasMatches(normalizedQuestion).map((entry) => entry.region);
}

export function detectClawCloudRegionMention(question: string) {
  const normalizedQuestion = normalizeWhitespace(question);
  const match = buildRegionAliasMatches(normalizedQuestion)[0] ?? null;
  if (!match) {
    return null;
  }

  return {
    region: match.region,
    kind: match.kind,
  } as const;
}

const QUESTION_LANGUAGE_PATTERNS: Array<{ locale: string; pattern: RegExp }> = [
  { locale: "hi", pattern: /[\u0900-\u097f]/u },
  { locale: "ar", pattern: /[\u0600-\u06ff]/u },
  { locale: "ja", pattern: /[\u3040-\u30ff]/u },
  { locale: "ko", pattern: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u },
  { locale: "ru", pattern: /[\u0400-\u04ff]/u },
  { locale: "es", pattern: /\b(?:precio|oro|plata|noticias|hoy|actualizaci(?:o|ó)n|clima|temperatura|cu[aá]l|que)\b/i },
  { locale: "fr", pattern: /\b(?:prix|actualit(?:e|é)s|aujourd'hui|m[eé]t[eé]o|temp[eé]rature|mise \u00e0 jour|quelle?)\b/i },
  { locale: "de", pattern: /\b(?:nachrichten|wetter|temperatur|preis|aktuell|heute)\b/i },
];

export function inferQuestionLanguageHint(question: string) {
  const normalizedQuestion = normalizeWhitespace(question);
  for (const candidate of QUESTION_LANGUAGE_PATTERNS) {
    if (candidate.pattern.test(question) || candidate.pattern.test(normalizedQuestion)) {
      return candidate.locale;
    }
  }

  return null;
}

export function normalizeRegionalQuestion(question: string) {
  return applyCanonicalTermReplacements(question);
}

export function inferClawCloudRegionContext(question: string): ClawCloudRegionContext {
  const normalizedQuestion = normalizeRegionalQuestion(question);
  const regionAliasMatches = buildRegionAliasMatches(normalizeWhitespace(question));
  const mentionedRegions = regionAliasMatches.map((entry) => entry.region);
  const requestedRegion = regionAliasMatches[0]?.region ?? null;
  const explicitCurrency = findCurrencyInQuestion(normalizedQuestion);
  const languageHint = inferQuestionLanguageHint(question);

  return {
    normalizedQuestion,
    requestedCurrency: explicitCurrency ?? requestedRegion?.currency ?? null,
    requestedRegion,
    mentionedRegions,
    requestedRegionMatchType: regionAliasMatches[0]?.kind ?? null,
    languageHint,
  };
}

export function inferRegionalSearchLocale(question: string) {
  const context = inferClawCloudRegionContext(question);
  const languageHint = context.languageHint || context.requestedRegion?.hl || "en";
  if (!context.mentionedRegions.length) {
    return { hl: languageHint };
  }

  if (context.mentionedRegions.length > 1) {
    return { hl: languageHint };
  }

  return {
    gl: context.requestedRegion?.gl,
    hl: languageHint,
  };
}
