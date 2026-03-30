import { load as loadHtml } from "cheerio";
import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { looksLikeHistoricalWealthQuestion } from "@/lib/clawcloud-historical-wealth";
import { fetchIndiaConsumerPriceAnswer } from "@/lib/clawcloud-india-consumer-prices";
import { looksLikeCurrentAffairsQuestion } from "@/lib/clawcloud-current-affairs";
import { env } from "@/lib/env";
import { fetchOfficialPricingAnswer } from "@/lib/clawcloud-official-pricing";
import { detectRetailFuelPriceQuestion, fetchRetailFuelPriceAnswer } from "@/lib/clawcloud-retail-prices";
import {
  detectClawCloudRegionMention,
  inferClawCloudRegionContext,
  normalizeRegionalQuestion,
} from "@/lib/clawcloud-region-context";
import { extractExplicitQuestionYear, hasPastYearScope } from "@/lib/clawcloud-time-scope";
import { getWeather, looksLikeDirectWeatherQuestion, parseWeatherCity } from "@/lib/clawcloud-weather";
import { searchInternetWithDiagnostics } from "@/lib/search";
import type { ClawCloudAnswerBundle, ClawCloudEvidenceItem, ResearchSource } from "@/lib/types";

export type ClawCloudLiveSearchTier = "realtime" | "volatile" | "knowledge";

export type ClawCloudLiveSearchRoute = {
  tier: ClawCloudLiveSearchTier;
  requiresWebSearch: boolean;
  badge: string | null;
  sourceNote: string | null;
};

export type ClawCloudLiveBundleStrategy = "deterministic" | "search_synthesis";

export type ClawCloudCountryMetricKind =
  | "gdp_nominal"
  | "gdp_growth"
  | "population"
  | "inflation"
  | "unemployment";

export type ClawCloudCountryMetricQuery = {
  kind: ClawCloudCountryMetricKind;
  countryCandidate: string;
};

export type ClawCloudShortDefinitionLookup = {
  term: string;
};

export type ClawCloudRichestRankingScope = "people" | "cities" | "mixed" | null;

const REALTIME_PATTERNS: RegExp[] = [
  /\b(stock price|share price|bitcoin price|btc price|eth price|crypto price)\b/i,
  /\b(today'?s?\s+price|current price|price right now|price today)\b/i,
  /\b(nifty|sensex|nasdaq|dow jones|s&p 500)\s+(today|now|live|current)\b/i,
  /\b(forex|exchange rate|usd to inr|inr to usd)\s*(today|now|live|current)?\b/i,
  /\b(lpg price|petrol price|diesel price)\s*(today|this month)?\b/i,
  /\b(price of .{1,30} (share|stock)|what is .{1,30} (price|rate|value|worth) (today|now|right now|currently))\b/i,
  /\b(how much is .{1,30} (trading|worth|valued) (at|today|now|right now))\b/i,
  /\b(gold price|silver price|crude oil price|oil price|gold etf|mutual fund nav|nav of)\b/i,
  /\b(bank nifty|midcap|mid cap)\b/i,
  /\b(live score|match score|today'?s?\s+score|cricket score|ipl score|football score|nba score|nfl score)\b/i,
  /\b(breaking news|news of today|news today|today news|today'?s?\s+news|latest news today|news right now)\b/i,
  /\b(what (is|happened|are) (happening|going on) (right now|today|currently))\b/i,
  /\b(weather today|weather right now|temperature today|rain today|forecast today)\b/i,
  /\b(aqi|air quality)\s*(today|right now|now)\b/i,
  /\b(election result|vote count|exit poll|who won the election)\b/i,
  /\b(just happened|just announced|just released|just launched)\b/i,
  /\b(died today|passed away today|arrested today|fired today|resigned today)\b/i,
  /\b(iran|israel|usa?|united states|russia|ukraine|china|taiwan|india|pakistan|hamas|hezbollah|houthi|houthis)\b.*\b(war|conflict|ceasefire|truce|peace(?:\s+deal|\s+talks?)?|negotiat(?:e|ion|ions|ing)|sanction(?:s|ed|ing)?|attack|strike|missile|demand(?:s)?|condition(?:s)?|terms? to stop|stop the war|end the war)\b/i,
  /\b(war|conflict|ceasefire|truce|peace(?:\s+deal|\s+talks?)?|negotiat(?:e|ion|ions|ing)|sanction(?:s|ed|ing)?|attack|strike|missile|demand(?:s)?|condition(?:s)?|terms? to stop|stop the war|end the war)\b.*\b(iran|israel|usa?|united states|russia|ukraine|china|taiwan|india|pakistan|hamas|hezbollah|houthi|houthis)\b/i,
];

const VOLATILE_PATTERNS: RegExp[] = [
  /\b(top\s*\d+\s*(richest|wealthiest|billionaires?|companies|brands|ai models?|smartphones?|economies|countries|cities))\b/i,
  /\b((richest|wealthiest)\s+(people|person|man|woman|individual|billionaires?|countries?|economies?|companies?|cities?|families?)|billionaire|millionaire|net worth|forbes billionaire)\b/i,
  /\b(who\s+is\s+(the\s+)?(richest|wealthiest)\b)/i,
  /\b(who\s+is\s+(the\s+)?(current\s+)?(ceo|cto|cfo|founder|president|prime minister|governor|chair(man|person|woman)|director)\b)/i,
  /\b(ceo|president|prime minister|governor|chair(man|person|woman)|director)\s+of\s+[a-z0-9]/i,
  /\b(most valuable company|largest company by market cap|highest market cap)\b/i,
  /\b(top\s*\d+\s*companies\s+by\s+market\s+cap)\b/i,
  /\b(latest\s+(iphone|android|samsung|pixel|oneplus)\s+model|newest\s+(iphone|android|samsung|pixel|oneplus)\s+model)\b/i,
  /\b(top\s*\d+\s*(ai|llm|model)\s*(of|in)\s*(20\d\d|today|now)?)\b/i,
  /\b(current population of|population of .* (20\d\d|today|current))\b/i,
  /\b(gdp|inflation|unemployment)\s+(of|in|rate)\b/i,
  /\b(who won the (oscar|grammy|nobel|bafta|golden globe)|(oscar|grammy|nobel|pulitzer)\s+(winner|winners))\b/i,
  /\b(icc ranking|fifa ranking|atp ranking|wta ranking)\b/i,
];

const KNOWLEDGE_PATTERNS: RegExp[] = [
  /^(what is|what are|what does|what was|what were|define|explain|describe|tell me about|meaning of|definition of)\b/i,
  /^(how does|how do|how is|how are|how did|how was)\b/i,
  /^(why does|why do|why is|why are|why did|why was)\b/i,
  /^(who (invented|discovered|created|founded|made|built|designed|wrote|composed))\b/i,
  /\b(chemical formula|molecular formula|element|compound|atom|molecule|reaction|enzyme|protein|dna|rna)\b/i,
  /\b(periodic table|boiling point|melting point|density of|speed of light)\b/i,
  /\b(history of|historical|ancient|medieval|world war|revolution|empire|dynasty|civilization)\b/i,
  /\b(capital of|located in|continent|geography)\b/i,
  /\b(calculate|compute|solve|prove|derive|algorithm|code|program|debug|function|syntax|sql|api)\b/i,
  /\b(factorial|fibonacci|prime number|sort|recursion|loop|array|string|integer)\b/i,
  /\b(difference between|formula for|how many (bones|planets|countries|continents|elements))\b/i,
  /\b(largest|smallest|tallest|deepest)\s+(country|city|ocean|mountain|river|desert|building)\b/i,
  // Entertainment / fiction — story requests about movies, shows, books, games
  /\b(story|plot|storyline|synopsis)\b.*\b(avenger|marvel|dc|star\s*wars?|harry\s*potter|naruto|one\s*piece|game\s*of\s*thrones|lord\s*of\s*the\s*rings|infinity\s*war|end\s*game|endgame|civil\s*war|anime|movie|film|series|drama|kdrama)\b/i,
  /\b(avenger|marvel|dc|star\s*wars?|harry\s*potter|naruto|one\s*piece|game\s*of\s*thrones|lord\s*of\s*the\s*rings|infinity\s*war|end\s*game|endgame|civil\s*war)\b.*\b(story|plot|storyline|synopsis)\b/i,
];

const REALTIME_CONTEXT_CUE = /\b(right now|today|live|currently|as of now|just now|breaking|latest|recent)\b/i;
const REALTIME_ENTITY_CUE = /\b(price|rate|value|worth|nav|stock|share|score|weather|forecast|temperature|aqi|news|updates?|announcement|traffic|exchange rate|result|war|conflict|ceasefire|truce|peace|negotiation|negotiations|sanctions?|strike|attack|missile|terms?|conditions?|demands?)\b/i;
const VOLATILE_RANKING_CUE = /\b(top\s*\d+|ranking|rank|list|current|latest|as of|updated)\b/i;
const VOLATILE_ENTITY_CUE = /\b(net worth|billionaire|forbes|ceo|president|prime minister|market cap|most valuable|population|gdp|inflation|unemployment|award|winner|richest people|richest person|wealthiest people|wealthiest person|richest country|largest economy)\b/i;
const COMMON_STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "latest",
  "list",
  "of",
  "on",
  "or",
  "right",
  "the",
  "to",
  "today",
  "top",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "world",
]);
const TRUSTED_LIVE_DOMAINS = [
  "forbes.com",
  "bloomberg.com",
  "reuters.com",
  "cnbc.com",
  "ft.com",
  "wsj.com",
  "yahoo.com",
  "intel.com",
  "apple.com",
  "openai.com",
  "coinmarketcap.com",
  "coindesk.com",
  "binance.com",
];
const DEFINITION_REFERENCE_DOMAINS = [
  "wikipedia.org",
  "wiktionary.org",
  "britannica.com",
  "merriam-webster.com",
  "dictionary.cambridge.org",
  "collinsdictionary.com",
  "dictionary.com",
  "vocabulary.com",
  "etymonline.com",
  "oxfordlearnersdictionaries.com",
  "glosbe.com",
  "wordnik.com",
  "encyclopedia.com",
  "fandom.com",
];
const SHORT_DEFINITION_LOOKUP_PATTERNS = [
  /^(?:what is|what are|define|meaning of|definition of|tell me about)\s+(.+?)(?:\?|$)/i,
  /^(?:what does)\s+(.+?)\s+(?:mean)(?:\?|$)/i,
];
const SHORT_DEFINITION_REJECTION_PATTERNS = [
  /\b(price|cost|gdp|population|inflation|weather|temperature|news|latest|today|current|right now|stock|ceo|war|conflict|score|capital of|where is|when did|who is)\b/i,
  /\b(difference between|compare|history of|how to|how does|why does|why is)\b/i,
  /\b(company|brand|manufacturer|organization|organisation|platform|software|service|app|website|device|product|startup|tool|university|college|school)\b/i,
];
const ENTITY_IDENTITY_CUE =
  /\b(company|brand|manufacturer|electronics?|peripherals?|gaming|accessories|startup|business|corporation|corp\.?|inc\.?|ltd\.?|limited|platform|software|service|app(?:lication)?|tool|product|device|headphones?|speaker|consumer electronics|organization|organisation|association|agency|foundation|institution|university|college|school|board|federation|governing body|bank|airline|automaker|retailer|marketplace|search engine|chatbot|assistant|ai model|language model|llm|website|media company|newspaper|telecom|e-?commerce)\b/i;
const ENTITY_DESCRIPTOR_VERB_CUE =
  /\b(headquartered|based in|founded|known for|makes|manufactures|develops|builds|sells|operates|offers|provides|owned by|subsidiary|provider)\b/i;
const LEXICAL_LOOKUP_CUE =
  /\b(meaning|definition|means|refers to|noun|verb|adjective|adverb|etymology|pronunciation|translation|dictionary|term|word)\b/i;
const LOOKUP_DISAMBIGUATION_CUE = /\b(may refer to|disambiguation|surname|given name)\b/i;
const LOW_QUALITY_PUBLIC_LOOKUP_CUE =
  /\b(character|profile|account|linkedin|instagram|facebook|song|lyrics|reels|deviantart|scribd|pinterest|youtube)\b/i;
const HENLEY_WEALTHIEST_CITIES_REPORT_URL = "https://www.henleyglobal.com/newsroom/press-releases/wealthiest-cities-report-2025";
const WORLD_BANK_COUNTRIES_URL = "https://api.worldbank.org/v2/country?format=json&per_page=400";
const COUNTRY_METRIC_EXTRACTION_PATTERNS = [
  /\b(?:what(?:'s| is)|tell me|show me|give me|share|find)?\s*(?:the\s+)?(?:latest\s+|current\s+|official\s+|nominal\s+|real\s+|annual\s+)?(?:gdp|gross domestic product|population|inflation|unemployment(?: rate)?|jobless rate|gdp growth|economic growth(?: rate)?)\s+(?:of|in|for)\s+(.+?)(?:\?|$)/i,
  /\b(?:what(?:'s| is)|tell me|show me|give me|share|find)?\s*(.+?)'?s\s+(?:latest\s+|current\s+|official\s+|nominal\s+|real\s+|annual\s+)?(?:gdp|gross domestic product|population|inflation|unemployment(?: rate)?|jobless rate|gdp growth|economic growth(?: rate)?)(?:\b|$)/i,
  /^(.+?)\s+(?:latest\s+|current\s+|official\s+|nominal\s+|real\s+|annual\s+)?(?:gdp|gross domestic product|population|inflation|unemployment(?: rate)?|jobless rate|gdp growth|economic growth(?: rate)?)(?:\b|$)/i,
];
const COUNTRY_METRIC_NOISE = /\b(?:the|latest|current|official|nominal|real|annual|yearly|estimated|estimate|reliable|world bank|imf|wb|today|right now|currently|as of today|as of now|in usd|usd|us dollars?|dollars?|percent|percentage|rate)\b/gi;
const COUNTRY_METRIC_ALIAS_TO_CODE = new Map<string, string>([
  ["america", "USA"],
  ["u s", "USA"],
  ["u s a", "USA"],
  ["us", "USA"],
  ["usa", "USA"],
  ["united states", "USA"],
  ["united states of america", "USA"],
  ["uk", "GBR"],
  ["u k", "GBR"],
  ["britain", "GBR"],
  ["great britain", "GBR"],
  ["united kingdom", "GBR"],
  ["uae", "ARE"],
  ["u a e", "ARE"],
  ["united arab emirates", "ARE"],
  ["south korea", "KOR"],
  ["korea south", "KOR"],
  ["republic of korea", "KOR"],
  ["north korea", "PRK"],
  ["korea north", "PRK"],
  ["dem peoples rep of korea", "PRK"],
  ["russia", "RUS"],
  ["russian federation", "RUS"],
  ["iran", "IRN"],
  ["iran islamic republic of", "IRN"],
  ["turkey", "TUR"],
  ["turkiye", "TUR"],
  ["viet nam", "VNM"],
  ["vietnam", "VNM"],
  ["egypt", "EGY"],
  ["egypt arab rep", "EGY"],
  ["venezuela", "VEN"],
  ["venezuela rb", "VEN"],
  ["slovakia", "SVK"],
  ["slovak republic", "SVK"],
  ["czechia", "CZE"],
  ["czech republic", "CZE"],
  ["syria", "SYR"],
  ["syrian arab republic", "SYR"],
  ["yemen", "YEM"],
  ["yemen rep", "YEM"],
  ["laos", "LAO"],
  ["lao pdr", "LAO"],
  ["brunei", "BRN"],
  ["brunei darussalam", "BRN"],
  ["bolivia", "BOL"],
  ["bolivia plurinational state of", "BOL"],
  ["tanzania", "TZA"],
  ["tanzania united republic of", "TZA"],
  ["moldova", "MDA"],
  ["moldova republic of", "MDA"],
  ["world", "WLD"],
]);
const COUNTRY_METRIC_CODE_TO_ALIASES = new Map<string, string[]>();

for (const [alias, code] of COUNTRY_METRIC_ALIAS_TO_CODE.entries()) {
  const existing = COUNTRY_METRIC_CODE_TO_ALIASES.get(code) ?? [];
  existing.push(alias);
  COUNTRY_METRIC_CODE_TO_ALIASES.set(code, existing);
}

type WorldBankCountryRecord = {
  id?: string;
  iso2Code?: string;
  name?: string;
};

type WorldBankIndicatorEntry = {
  value?: number | null;
  date?: string;
  country?: { value?: string };
};

type WorldBankMetricConfig = {
  indicator: string;
  label: string;
  sourceLabel: string;
  formatValue: (value: number) => string;
  answerPatterns: RegExp[];
};

type WorldBankMetricSnapshot = {
  kind: ClawCloudCountryMetricKind;
  countryName: string;
  value: number;
  year: string;
};

const WORLD_BANK_METRIC_CONFIG: Record<ClawCloudCountryMetricKind, WorldBankMetricConfig> = {
  gdp_nominal: {
    indicator: "NY.GDP.MKTP.CD",
    label: "GDP",
    sourceLabel: "GDP, current US$",
    formatValue: (value) => formatUsdValue(value),
    answerPatterns: [/\bgdp\b/i, /\bgross domestic product\b/i, /(\$|usd|trillion|billion)/i],
  },
  gdp_growth: {
    indicator: "NY.GDP.MKTP.KD.ZG",
    label: "GDP growth",
    sourceLabel: "GDP growth (annual %)",
    formatValue: (value) => `${value.toFixed(2)}%`,
    answerPatterns: [/\bgdp growth\b/i, /\beconomic growth\b/i, /\bannual %\b/i, /\b%\b/],
  },
  population: {
    indicator: "SP.POP.TOTL",
    label: "Population",
    sourceLabel: "Population, total",
    formatValue: (value) => Math.round(value).toLocaleString("en-US"),
    answerPatterns: [/\bpopulation\b/i, /\bpeople\b/i],
  },
  inflation: {
    indicator: "FP.CPI.TOTL.ZG",
    label: "Inflation",
    sourceLabel: "Inflation, consumer prices (annual %)",
    formatValue: (value) => `${value.toFixed(2)}%`,
    answerPatterns: [/\binflation\b/i, /\bcpi\b/i, /\b%\b/],
  },
  unemployment: {
    indicator: "SL.UEM.TOTL.ZS",
    label: "Unemployment",
    sourceLabel: "Unemployment, total (% of total labor force)",
    formatValue: (value) => `${value.toFixed(2)}%`,
    answerPatterns: [/\bunemployment\b/i, /\bjobless\b/i, /\b%\b/],
  },
};

let worldBankCountryCache: { expiresAt: number; records: WorldBankCountryRecord[] } | null = null;

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeQuestion(question: string) {
  return normalizeRegionalQuestion(question).toLowerCase().replace(/\s+/g, " ").trim();
}

function cleanShortDefinitionTerm(raw: string) {
  return raw
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/^(?:the|a|an)\s+/i, "")
    .replace(/\s+(?:in|into|for)\s+(?:english|hindi|korean|spanish|french|arabic|japanese|chinese)\b.*$/i, "")
    .replace(/[?!.,;:]+$/g, "")
    .trim();
}

export function detectShortDefinitionLookup(question: string): ClawCloudShortDefinitionLookup | null {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return null;
  }

  if (SHORT_DEFINITION_REJECTION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return null;
  }

  for (const pattern of SHORT_DEFINITION_LOOKUP_PATTERNS) {
    const match = normalized.match(pattern);
    const rawTerm = match?.[1];
    if (!rawTerm) {
      continue;
    }

    const term = cleanShortDefinitionTerm(rawTerm);
    if (!term) {
      continue;
    }

    const tokenCount = term.split(/\s+/).filter(Boolean).length;
    if (tokenCount > 3 || term.length > 48) {
      return null;
    }

    return { term };
  }

  return null;
}

function normalizeLookupKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[â€™']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatUsdValue(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `$${(value / 1_000_000_000_000).toFixed(2)} trillion`;
  }
  if (abs >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)} billion`;
  }
  if (abs >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)} million`;
  }
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPopulationValue(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)} billion`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)} million`;
  }
  return Math.round(value).toLocaleString("en-US");
}

function formatUsdPerCapita(value: number) {
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

function metricEmoji(kind: ClawCloudCountryMetricKind) {
  switch (kind) {
    case "gdp_nominal":
    case "gdp_growth":
      return "ðŸ“Š";
    case "population":
      return "ðŸ‘¥";
    case "inflation":
      return "ðŸ’¹";
    case "unemployment":
      return "ðŸ’¼";
    default:
      return "ðŸ“Œ";
  }
}

async function fetchWorldBankMetricSnapshot(
  countryId: string,
  countryName: string,
  kind: ClawCloudCountryMetricKind,
) {
  const metricConfig = WORLD_BANK_METRIC_CONFIG[kind];
  const indicatorUrl = `https://api.worldbank.org/v2/country/${encodeURIComponent(countryId)}/indicator/${encodeURIComponent(metricConfig.indicator)}?format=json&per_page=10`;
  const data = await fetchJsonWithTimeout<[unknown, WorldBankIndicatorEntry[]?]>(indicatorUrl, 8000);
  const latest = (data?.[1] ?? []).find((entry) => typeof entry?.value === "number");
  if (typeof latest?.value !== "number" || !latest?.date) {
    return null;
  }

  return {
    kind,
    countryName,
    value: latest.value,
    year: latest.date,
  } satisfies WorldBankMetricSnapshot;
}

async function buildWorldBankMetricQuickContext(
  countryId: string,
  countryName: string,
  primary: WorldBankMetricSnapshot,
) {
  const lines: string[] = [];

  if (primary.kind === "gdp_nominal" || primary.kind === "population") {
    const [gdpResult, populationResult] = await Promise.allSettled([
      primary.kind === "gdp_nominal"
        ? Promise.resolve(primary)
        : fetchWorldBankMetricSnapshot(countryId, countryName, "gdp_nominal"),
      primary.kind === "population"
        ? Promise.resolve(primary)
        : fetchWorldBankMetricSnapshot(countryId, countryName, "population"),
    ]);

    const gdp =
      gdpResult.status === "fulfilled" && gdpResult.value?.kind === "gdp_nominal"
        ? gdpResult.value
        : null;
    const population =
      populationResult.status === "fulfilled" && populationResult.value?.kind === "population"
        ? populationResult.value
        : null;

    if (population && primary.kind !== "population") {
      lines.push(`â€¢ Population: *${formatPopulationValue(population.value)}*`);
    }

    if (gdp && population && population.value > 0) {
      lines.push(`â€¢ GDP per capita: *${formatUsdPerCapita(gdp.value / population.value)}*`);
    }
  }

  return lines;
}

function buildWorldBankMetricAnswer(options: {
  countryName: string;
  primary: WorldBankMetricSnapshot;
  quickContext: string[];
}) {
  const metricConfig = WORLD_BANK_METRIC_CONFIG[options.primary.kind];
  const currentYear = new Date().getFullYear();
  const metricYear = Number.parseInt(options.primary.year, 10);
  const isLaggingAnnualActual = Number.isFinite(metricYear) && metricYear < currentYear;

  const lines = [
    `${metricEmoji(options.primary.kind)} *${options.countryName} ${metricConfig.label}*`,
    `*Latest official annual estimate:* *${metricConfig.formatValue(options.primary.value)}* (*${options.primary.year}*)`,
  ];

  if (options.quickContext.length) {
    lines.push("");
    lines.push("*Quick context*");
    lines.push(...options.quickContext);
  }

  lines.push("");
  lines.push("*What to know*");
  lines.push("â€¢ This is the latest finalized annual figure available from the World Bank.");
  if (isLaggingAnnualActual) {
    lines.push("â€¢ Newer calendar-year figures are usually forecasts or provisional estimates, not finalized annual actuals yet.");
  }

  lines.push("");
  lines.push("*Source*");
  lines.push("â€¢ World Bank");
  lines.push(`â€¢ Metric: *${metricConfig.sourceLabel}*`);
  lines.push(`â€¢ Indicator: *${metricConfig.indicator}*`);
  lines.push(`â€¢ Searched: *${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}*`);

  return lines.join("\n");
}

function detectCountryMetricKind(question: string): ClawCloudCountryMetricKind | null {
  const normalizedQuestion = normalizeQuestion(question);
  if (
    /\b(gdp growth|economic growth(?: rate)?)\b/i.test(normalizedQuestion)
    || (/\bgrowth rate\b/i.test(normalizedQuestion) && /\b(gdp|economy|economic)\b/i.test(normalizedQuestion))
  ) {
    return "gdp_growth";
  }
  if (/\b(gdp|gross domestic product)\b/i.test(normalizedQuestion)) {
    return "gdp_nominal";
  }
  if (/\bpopulation\b/i.test(normalizedQuestion)) {
    return "population";
  }
  if (/\b(inflation|consumer prices|cpi)\b/i.test(normalizedQuestion)) {
    return "inflation";
  }
  if (/\b(unemployment|jobless)\b/i.test(normalizedQuestion)) {
    return "unemployment";
  }
  return null;
}

function cleanCountryMetricCandidate(value: string) {
  const cleaned = value
    .replace(/^(?:please\s+)?search(?:\s+the)?\s+web(?:\s+(?:and|for))?\s+/i, "")
    .replace(/^(?:tell me|show me|give me|share|find)\s+/i, "")
    .replace(/^(?:according to|using)\s+/i, "")
    .replace(/^(?:the|for|in|of)\s+/i, "")
    .replace(COUNTRY_METRIC_NOISE, " ")
    .replace(/[?.,;:()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.replace(/^the\s+/i, "").trim();
}

export function detectWorldBankCountryMetricQuestion(question: string): ClawCloudCountryMetricQuery | null {
  const normalizedQuestion = normalizeRegionalQuestion(question);
  const kind = detectCountryMetricKind(normalizedQuestion);
  if (!kind) {
    return null;
  }

  for (const pattern of COUNTRY_METRIC_EXTRACTION_PATTERNS) {
    const match = pattern.exec(normalizedQuestion);
    const rawCandidate = match?.[1]?.trim();
    const countryCandidate = rawCandidate ? cleanCountryMetricCandidate(rawCandidate) : "";
    if (!countryCandidate) {
      continue;
    }
    if (/^(?:what(?:s| is)?|tell me|show me|give me|share|find|explain|define)\b/i.test(countryCandidate)) {
      continue;
    }
    if (/^(what|whats|is|are|gdp|gross domestic product|population|inflation|unemployment|jobless|rate|current|latest)$/i.test(countryCandidate)) {
      continue;
    }

    const regionMention = detectClawCloudRegionMention(countryCandidate);
    if (regionMention?.kind === "locality") {
      return null;
    }

    return {
      kind,
      countryCandidate,
    };
  }

  return null;
}

function isAggregateWorldBankRecord(record: WorldBankCountryRecord) {
  const name = normalizeLookupKey(record.name || "");
  if (!name) return true;
  if (record.id === "WLD" || name === "world") return false;
  return (
    /\b(aggregate|income|euro area|european union|oecd|ida|ibrd|arab world|south asia|north america|latin america|caribbean|sub saharan|east asia|pacific|middle east|fragile|small states|high income|low income|middle income|least developed|heavily indebted|demographic|dividend|developing|excluding|only|members)\b/i.test(name)
    || /\bregion\b/i.test(name)
  );
}

async function fetchWorldBankCountryRecords() {
  if (worldBankCountryCache && worldBankCountryCache.expiresAt > Date.now()) {
    return worldBankCountryCache.records;
  }

  const response = await fetchJsonWithTimeout<[unknown, WorldBankCountryRecord[]?]>(WORLD_BANK_COUNTRIES_URL, 8000);
  const records = Array.isArray(response?.[1])
    ? response[1]
      .filter((record) => record?.id && record?.name)
      .filter((record) => !isAggregateWorldBankRecord(record))
    : [];

  if (records.length) {
    worldBankCountryCache = {
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      records,
    };
  }

  return records;
}

function resolveCountryAliasCode(candidate: string) {
  return COUNTRY_METRIC_ALIAS_TO_CODE.get(normalizeLookupKey(candidate)) || null;
}

async function resolveWorldBankCountry(candidate: string) {
  const records = await fetchWorldBankCountryRecords();
  if (!records.length) {
    return null;
  }

  const normalizedCandidate = normalizeLookupKey(candidate);
  if (!normalizedCandidate) {
    return null;
  }

  const aliasCode = resolveCountryAliasCode(candidate);
  if (aliasCode) {
    const aliasMatch = records.find((record) => record.id === aliasCode);
    if (aliasMatch) {
      return aliasMatch;
    }
  }

  const exactMatch = records.find((record) => normalizeLookupKey(record.name || "") === normalizedCandidate);
  if (exactMatch) {
    return exactMatch;
  }

  const containsMatches = records.filter((record) => {
    const normalizedName = normalizeLookupKey(record.name || "");
    return normalizedName.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedName);
  });

  if (containsMatches.length === 1) {
    return containsMatches[0];
  }

  return null;
}

function looksCompleteCountryMetricAnswer(
  answer: string,
  metricQuery: ClawCloudCountryMetricQuery,
) {
  const normalized = answer.trim();
  if (!normalized) {
    return false;
  }

  const hasYear = /\b20\d{2}\b/.test(normalized);
  const hasNumber = /\d[\d,]*(?:\.\d+)?(?:\s*(?:%|percent|million|billion|trillion|usd|people))?/i.test(normalized);
  const patterns = WORLD_BANK_METRIC_CONFIG[metricQuery.kind].answerPatterns;
  const hasMetricSignal = patterns.some((pattern) => pattern.test(normalized));
  const normalizedAnswer = normalizeLookupKey(normalized);
  const normalizedCandidate = normalizeLookupKey(metricQuery.countryCandidate);
  const aliasLabels = COUNTRY_METRIC_CODE_TO_ALIASES.get(resolveCountryAliasCode(metricQuery.countryCandidate) || "") ?? [];
  const countryLabels = [normalizedCandidate, ...aliasLabels].filter(Boolean);
  const hasCountrySignal = countryLabels.some((label) => normalizedAnswer.includes(label));

  return hasYear && hasNumber && hasMetricSignal && hasCountrySignal;
}

export function isCompleteCountryMetricAnswer(
  question: string,
  answer: string,
) {
  const metricQuery = detectWorldBankCountryMetricQuestion(question);
  if (!metricQuery) {
    return true;
  }
  return looksCompleteCountryMetricAnswer(answer, metricQuery);
}

export async function fetchWorldBankCountryMetricAnswer(question: string) {
  const metricQuery = detectWorldBankCountryMetricQuestion(question);
  if (!metricQuery) {
    return "";
  }

  const country = await resolveWorldBankCountry(metricQuery.countryCandidate);
  if (!country?.id || !country.name) {
    return "";
  }

  const primary = await fetchWorldBankMetricSnapshot(country.id, country.name, metricQuery.kind);
  if (!primary) {
    return "";
  }

  const quickContext = await buildWorldBankMetricQuickContext(country.id, country.name, primary)
    .catch(() => []);

  return buildWorldBankMetricAnswer({
    countryName: country.name,
    primary,
    quickContext,
  });
}

function isRealtimeQuestion(normalizedQuestion: string) {
  return (
    matchesAny(normalizedQuestion, REALTIME_PATTERNS)
    || looksLikeCurrentAffairsQuestion(normalizedQuestion)
    || (REALTIME_CONTEXT_CUE.test(normalizedQuestion) && REALTIME_ENTITY_CUE.test(normalizedQuestion))
  );
}

function isVolatileQuestion(normalizedQuestion: string) {
  if (looksLikeHistoricalWealthQuestion(normalizedQuestion)) {
    return false;
  }

  return (
    matchesAny(normalizedQuestion, VOLATILE_PATTERNS)
    || detectWorldBankCountryMetricQuestion(normalizedQuestion) !== null
    || (VOLATILE_RANKING_CUE.test(normalizedQuestion) && VOLATILE_ENTITY_CUE.test(normalizedQuestion))
  );
}

function isStableKnowledgeQuestion(normalizedQuestion: string) {
  return matchesAny(normalizedQuestion, KNOWLEDGE_PATTERNS);
}

export function classifyClawCloudLiveSearchTier(question: string): ClawCloudLiveSearchTier {
  const normalizedQuestion = normalizeQuestion(question);
  if (!normalizedQuestion) return "knowledge";

  // CRITICAL: Check stable knowledge FIRST — science, math, coding, history
  // questions must never be routed to live search even if they mention
  // company names (e.g. "Pfizer") or entity cues (e.g. "reaction", "protein").
  if (isStableKnowledgeQuestion(normalizedQuestion)) return "knowledge";

  if (isRealtimeQuestion(normalizedQuestion)) return "realtime";
  if (isVolatileQuestion(normalizedQuestion)) return "volatile";

  return "knowledge";
}

export function classifyClawCloudLiveSearchRoute(question: string): ClawCloudLiveSearchRoute {
  const tier = classifyClawCloudLiveSearchTier(question);

  if (tier === "realtime") {
    return {
      tier,
      requiresWebSearch: true,
      badge: "\u26a1 *Live answer*",
      sourceNote: "_Source note: checked against live web signals; figures can shift quickly._",
    };
  }

  if (tier === "volatile") {
    return {
      tier,
      requiresWebSearch: true,
      badge: "\ud83d\udcc5 *Fresh answer*",
      sourceNote: "_Source note: based on recently retrieved web sources (Tavily/SerpAPI where available)._",
    };
  }

  return {
    tier,
    requiresWebSearch: false,
    badge: null,
    sourceNote: null,
  };
}

export function shouldUseLiveSearch(question: string): boolean {
  return classifyClawCloudLiveSearchRoute(question).requiresWebSearch;
}

export function isVolatileLiveSearchQuestion(question: string): boolean {
  return classifyClawCloudLiveSearchTier(question) === "volatile";
}

async function fetchJsonWithTimeout<T>(url: string, timeoutMs = 7000): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 ClawCloud/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextWithTimeout(url: string, timeoutMs = 7000): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 ClawCloud/1.0" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function clipText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}â€¦`;
}

function formatUsdBillionsFromForbes(finalWorth: number) {
  const billions = finalWorth > 1_000 ? finalWorth / 1_000 : finalWorth;
  return `${billions.toFixed(1)}B`;
}

export function extractRichestRankingScope(question: string): ClawCloudRichestRankingScope {
  const normalized = normalizeQuestion(question);
  if (!/\b(richest|wealthiest|billionaire|net worth|forbes)\b/i.test(normalized)) {
    return null;
  }

  const asksCities =
    /\b(richest cities|wealthiest cities|richest city|wealthiest city|cities report|wealthiest cities report)\b/i.test(normalized)
    || (/\btop\s*\d+\s*(richest|wealthiest)\b/i.test(normalized) && /\bcities?\b/i.test(normalized));
  const asksPeopleExplicitly =
    /\b(richest people|wealthiest people|richest person|wealthiest person|richest persons|wealthiest persons|richest individual|wealthiest individual|richest man|wealthiest man|richest woman|wealthiest woman|billionaires?|net worth ranking|forbes.*billionaire)\b/i.test(normalized)
    || (/\btop\s*\d+\s*(richest|wealthiest)\b/i.test(normalized) && /\b(people|persons?|individuals?|men|women|billionaires?|famil(?:y|ies))\b/i.test(normalized));
  const asksOtherRankedEntity =
    /\b(countries?|economies?|companies?|brands?|ai models?|smartphones?|phones?|universities?|colleges?|states?)\b/i.test(normalized);

  if (asksCities && asksPeopleExplicitly) {
    return "mixed";
  }
  if (asksCities) {
    return "cities";
  }
  if (asksPeopleExplicitly) {
    return "people";
  }
  if (/\btop\s*\d+\s*(richest|wealthiest)\b/i.test(normalized) && !asksOtherRankedEntity) {
    return "people";
  }

  return null;
}

function mentionsRichestPeopleQuestion(question: string) {
  const scope = extractRichestRankingScope(question);
  return scope === "people" || scope === "mixed";
}

function mentionsRichestCitiesQuestion(question: string) {
  const scope = extractRichestRankingScope(question);
  return scope === "cities" || scope === "mixed";
}

function looksLikeRichestRankingQuestion(question: string) {
  return extractRichestRankingScope(question) !== null;
}

type RichestCityRow = {
  city: string;
  millionaires: string;
};

const HENLEY_WEALTHIEST_CITIES_FALLBACK: RichestCityRow[] = [
  { city: "New York", millionaires: "384,500" },
  { city: "Bay Area", millionaires: "342,400" },
  { city: "Tokyo", millionaires: "292,300" },
  { city: "Singapore", millionaires: "242,400" },
  { city: "Los Angeles", millionaires: "220,600" },
  { city: "London", millionaires: "215,700" },
  { city: "Paris", millionaires: "160,100" },
  { city: "Hong Kong", millionaires: "154,900" },
  { city: "Sydney", millionaires: "152,900" },
  { city: "Chicago", millionaires: "127,100" },
];

function parseHenleyRichestCitiesReport(text: string): RichestCityRow[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  const patterns: Array<{ city: string; re: RegExp }> = [
    { city: "New York", re: /new york[^.]{0,220}?with\s+([\d,]+)\s+(?:high-net-worth individuals|resident millionaires|millionaires)/i },
    { city: "Bay Area", re: /bay area[^.]{0,220}?2\s*nd place[^.]{0,140}?with\s+([\d,]+)\s+(?:resident )?millionaires/i },
    { city: "Tokyo", re: /tokyo[^.]{0,180}?3\s*rd place[^.]{0,120}?with\s+([\d,]+)\s+millionaires/i },
    { city: "Singapore", re: /singapore[^.]{0,180}?4\s*th place[^.]{0,120}?with\s+([\d,]+)\s+millionaires/i },
    { city: "Los Angeles", re: /los angeles\s*\(([\d,]+)\s+millionaires/i },
    { city: "London", re: /london[^.]{0,220}?6\s*th place[^.]{0,140}?with(?: just)?\s+([\d,]+)\s+millionaires/i },
    { city: "Paris", re: /paris\s*\(([\d,]+)\s+millionaires\)[^.]{0,120}?7\s*th place/i },
    { city: "Hong Kong", re: /hong kong\s*\(([\d,]+)\s+millionaires\)[^.]{0,120}?8\s*th position/i },
    { city: "Sydney", re: /sydney\s*\(([\d,]+)\s+millionaires\)[^.]{0,120}?9\s*th place/i },
    { city: "Chicago", re: /chicago\s*\(([\d,]+)(?:\s+millionaires)?\)/i },
  ];

  const rows = patterns
    .map((pattern) => {
      const match = normalized.match(pattern.re);
      const millionaires = match?.[1]?.trim();
      if (!millionaires) {
        return null;
      }
      return {
        city: pattern.city,
        millionaires,
      };
    })
    .filter(Boolean) as RichestCityRow[];

  return rows.length >= 8 ? rows : [];
}

function looksLikeBitcoinPriceQuestion(question: string) {
  const normalizedQuestion = normalizeQuestion(question);
  return /\b(bitcoin|btc)\b/i.test(normalizedQuestion)
    && /\b(price|usd|inr|aed|eur|gbp|current|today|right now|live)\b/i.test(normalizedQuestion);
}

function looksLikeCurrentCeoQuestion(question: string) {
  return /\b(current\s+ceo\s+of|who\s+is\s+the\s+ceo\s+of|who\s+is\s+ceo\s+of)\b/i.test(question);
}

function looksLikeLatestIphoneQuestion(question: string) {
  return /\b(latest|newest|current)\b/i.test(question) && /\biphone\b/i.test(question);
}

async function buildRichestPeopleAnswerFromForbes(
  question: string,
  options?: { allowMixed?: boolean },
) {
  if (
    looksLikeHistoricalWealthQuestion(question)
    || !looksLikeRichestRankingQuestion(question)
    || (!options?.allowMixed && mentionsRichestCitiesQuestion(question))
  ) {
    return "";
  }

  type ForbesPerson = {
    name?: string;
    personName?: string;
    person?: { name?: string };
    finalWorth?: number;
  };
  type ForbesResponse = {
    personList?: {
      personsLists?: ForbesPerson[];
    };
  };

  const data = await fetchJsonWithTimeout<ForbesResponse>(
    "https://www.forbes.com/forbesapi/person/rtb/0/position/true.json?limit=10",
    8000,
  );
  const people = data?.personList?.personsLists?.filter(
    (person) => (person.personName || person.person?.name || person.name) && Number.isFinite(person.finalWorth),
  ) ?? [];
  if (people.length < 5) {
    return "";
  }

  const top = people.slice(0, 10);
  const lines = top.map((person, index) => {
    const worth = formatUsdBillionsFromForbes(Number(person.finalWorth ?? 0));
    const personName = person.personName || person.person?.name || person.name || "Unknown";
    return `${index + 1}. *${personName}* â€” *$${worth}*`;
  });

  return [
    "Top richest people by live net worth:",
    ...lines,
    "",
    `As of ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "Sources: forbes.com (Real-Time Billionaires API)",
  ].join("\n");
}

async function buildRichestCitiesAnswerFromHenley(question: string) {
  if (!mentionsRichestCitiesQuestion(question)) {
    return "";
  }

  const html = await fetchTextWithTimeout(HENLEY_WEALTHIEST_CITIES_REPORT_URL, 9000);
  const text = html ? loadHtml(html).root().text() : "";
  const topCities = parseHenleyRichestCitiesReport(text);
  const resolvedCities = topCities.length >= 8 ? topCities : HENLEY_WEALTHIEST_CITIES_FALLBACK;

  const lines = resolvedCities.map((row, index) =>
    `${index + 1}. *${row.city}* â€” *${row.millionaires}* resident millionaires`,
  );

  return [
    "Top wealthiest cities by resident millionaires (latest available Henley report):",
    ...lines,
    "",
    "Source: henleyglobal.com / New World Wealth (World's Wealthiest Cities Report 2025)",
  ].join("\n");
}

async function buildRichestPeopleAndCitiesAnswer(question: string) {
  if (!mentionsRichestPeopleQuestion(question) || !mentionsRichestCitiesQuestion(question)) {
    return "";
  }

  const [people, cities] = await Promise.all([
    buildRichestPeopleAnswerFromForbes(question, { allowMixed: true }),
    buildRichestCitiesAnswerFromHenley(question),
  ]);

  if (!people.trim() || !cities.trim()) {
    return "";
  }

  return [
    people,
    "",
    cities,
  ].join("\n");
}

async function buildBitcoinPriceAnswer(question: string) {
  if (!looksLikeBitcoinPriceQuestion(question)) {
    return "";
  }

  const context = inferClawCloudRegionContext(question);
  const preferredCurrency = context.requestedCurrency?.toLowerCase() ?? "usd";
  const requestedCountryName = context.requestedRegion?.countryName ?? "";
  const supportedCurrencies = ["usd", "inr", "aed", "eur", "gbp", "jpy", "cny", "sar", "ils", "cad", "aud", "sgd"];
  const vsCurrencies = [...new Set([
    preferredCurrency,
    "usd",
    "inr",
  ].filter((currency) => supportedCurrencies.includes(currency)))];

  type CoinGeckoResponse = {
    bitcoin?: Record<string, number | undefined>;
  };

  const data = await fetchJsonWithTimeout<CoinGeckoResponse>(
    `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${vsCurrencies.join(",")}&include_24hr_change=true`,
    7000,
  );
  const btc = data?.bitcoin;
  const preferredValue = btc?.[preferredCurrency];
  const usdValue = btc?.usd;
  const inrValue = btc?.inr;
  if (!btc || !Number.isFinite(Number(preferredValue ?? Number.NaN)) || !Number.isFinite(Number(usdValue ?? Number.NaN))) {
    if (!env.SERPAPI_API_KEY) {
      return "";
    }

    type SerpApiOrganic = { snippet?: string; source?: string; link?: string };
    type SerpApiResponse = { organic_results?: SerpApiOrganic[] };
    const endpoint = new URL("https://serpapi.com/search.json");
    endpoint.searchParams.set("engine", "google");
    endpoint.searchParams.set("q", `bitcoin price ${preferredCurrency} usd live ${requestedCountryName}`.trim());
    endpoint.searchParams.set("api_key", env.SERPAPI_API_KEY);
    endpoint.searchParams.set("num", "3");
    const fallback = await fetchJsonWithTimeout<SerpApiResponse>(endpoint.toString(), 7000);
    const top = fallback?.organic_results?.[0];
    if (!top?.snippet) {
      return "";
    }

    return [
      "*Bitcoin (BTC) current price context:*",
      `â€¢ ${clipText(top.snippet, 200)}`,
      "",
      `As of ${new Date().toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}`,
      `Source: ${top.source || top.link || "serpapi organic result"}`,
    ].join("\n");
  }

  const changeRaw = btc.usd_24h_change;
  const change = Number.isFinite(changeRaw)
    ? `${changeRaw! >= 0 ? "+" : ""}${changeRaw!.toFixed(2)}% (24h)`
    : "24h change unavailable";
  const preferredCode = preferredCurrency.toUpperCase();
  const preferredPrice = Number(preferredValue);
  const usd = Number(usdValue).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const preferredFormatted = Number.isFinite(preferredPrice)
    ? preferredPrice.toLocaleString(preferredCurrency === "inr" ? "en-IN" : "en-US", {
        maximumFractionDigits: preferredCurrency === "jpy" ? 0 : 2,
      })
    : null;
  const preferredSymbol = ({
    usd: "$",
    inr: "â‚¹",
    aed: "AED ",
    eur: "â‚¬",
    gbp: "Â£",
    jpy: "Â¥",
    cny: "Â¥",
    sar: "SAR ",
    ils: "â‚ª",
    cad: "C$",
    aud: "A$",
    sgd: "S$",
  } as const)[preferredCurrency] ?? `${preferredCode} `;

  return [
    `*Bitcoin (BTC) live price:*`,
    preferredFormatted ? `â€¢ ${preferredCode}: *${preferredSymbol}${preferredFormatted}*${requestedCountryName ? ` in ${requestedCountryName}` : ""}` : "",
    `â€¢ USD: *$${usd}*`,
    Number.isFinite(Number(inrValue ?? Number.NaN))
      ? `â€¢ INR: *â‚¹${Number(inrValue).toLocaleString("en-IN", { maximumFractionDigits: 2 })}*`
      : "",
    `â€¢ 24h: *${change}*`,
    "",
    `As of ${new Date().toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}`,
    "Sources: api.coingecko.com",
  ].filter(Boolean).join("\n");
}

function extractCompanyFromCeoQuestion(question: string) {
  const match = /\bceo\s+of\s+([a-z0-9 .&-]+)/i.exec(question);
  if (!match?.[1]) {
    return "";
  }
  return match[1]
    .replace(/\b(in|during)\s+(19|20)\d{2}\b.*$/i, "")
    .replace(/\b(as of|today|right now|currently)\b.*$/i, "")
    .trim()
    .replace(/[?.,;:]+$/, "");
}

function extractLikelyPersonNameFromCeoText(text: string) {
  const patterns = [
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,2})\s+(?:is|was)\s+the\s+(?:current\s+)?CEO\b/,
    /\bCEO(?:\s+of\s+[A-Za-z0-9.& -]+)?(?:\s+is|\s+was)?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,2})\b/,
    /\b([A-Z][a-z]+(?:\s+[A-Z][a-z.'-]+){1,2}),?\s+(?:the\s+)?(?:current\s+)?CEO\b/,
  ];

  for (const pattern of patterns) {
    const candidate = text.match(pattern)?.[1]?.trim();
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

async function buildCurrentCeoAnswerFromSerp(question: string) {
  if (!looksLikeCurrentCeoQuestion(question) || !env.SERPAPI_API_KEY) {
    return "";
  }

  const company = extractCompanyFromCeoQuestion(question);
  if (!company) {
    return "";
  }
  const currentYear = new Date().getFullYear();
  const explicitYear = extractExplicitQuestionYear(question);
  const historicalYear = explicitYear !== null && explicitYear < currentYear ? explicitYear : null;

  type SerpApiAnswerBox = {
    answer?: string;
    title?: string;
    link?: string;
  };
  type SerpApiOrganic = {
    title?: string;
    link?: string;
    snippet?: string;
    source?: string;
  };
  type SerpApiResponse = {
    answer_box?: SerpApiAnswerBox;
    organic_results?: SerpApiOrganic[];
  };

  const endpoint = new URL("https://serpapi.com/search.json");
  endpoint.searchParams.set("engine", "google");
  endpoint.searchParams.set("q", historicalYear ? `CEO of ${company} in ${historicalYear}` : `current CEO of ${company}`);
  endpoint.searchParams.set("api_key", env.SERPAPI_API_KEY);
  endpoint.searchParams.set("num", "5");

  const data = await fetchJsonWithTimeout<SerpApiResponse>(endpoint.toString(), 7000);
  const answerBoxValue = data?.answer_box?.answer?.trim();
  if (answerBoxValue) {
    return [
      historicalYear
        ? `CEO of *${company}* in *${historicalYear}* was *${answerBoxValue}*.`
        : `Current CEO of *${company}* is *${answerBoxValue}*.`,
      "",
      historicalYear
        ? `Reference year: ${historicalYear}`
        : `As of ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      "Sources: google/serpapi answer box",
    ].join("\n");
  }

  const answerBoxCandidate = extractLikelyPersonNameFromCeoText(
    `${data?.answer_box?.title ?? ""} ${data?.answer_box?.answer ?? ""}`.trim(),
  );
  if (answerBoxCandidate) {
    return [
      historicalYear
        ? `CEO of *${company}* in *${historicalYear}* was *${answerBoxCandidate}*.`
        : `Current CEO of *${company}* is *${answerBoxCandidate}*.`,
      "",
      historicalYear
        ? `Reference year: ${historicalYear}`
        : `As of ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      "Sources: google/serpapi answer box",
    ].join("\n");
  }

  const topOrganic = data?.organic_results?.[0];
  const organicCandidate = data?.organic_results
    ?.flatMap((item) => [item.title ?? "", item.snippet ?? ""])
    .map((text) => extractLikelyPersonNameFromCeoText(text))
    .find(Boolean);
  if (organicCandidate) {
    return [
      historicalYear
        ? `CEO of *${company}* in *${historicalYear}* was *${organicCandidate}*.`
        : `Current CEO of *${company}* is *${organicCandidate}*.`,
      topOrganic?.snippet ? `â€¢ ${clipText(topOrganic.snippet, 180)}` : "",
      "",
      historicalYear
        ? `Reference year: ${historicalYear}`
        : `As of ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      `Source: ${topOrganic?.source || topOrganic?.link || "serpapi organic result"}`,
    ].filter(Boolean).join("\n");
  }

  if (topOrganic?.snippet && topOrganic?.title) {
    return [
      "I could not extract a definitive CEO name from the answer box, but the top source says:",
      `â€¢ *${topOrganic.title}*`,
      `â€¢ ${clipText(topOrganic.snippet, 180)}`,
      "",
      `Source: ${topOrganic.source || topOrganic.link || "serpapi organic result"}`,
    ].join("\n");
  }

  return "";
}

async function buildLatestIphoneAnswerFromSerp(question: string) {
  if (!looksLikeLatestIphoneQuestion(question) || hasPastYearScope(question) || !env.SERPAPI_API_KEY) {
    return "";
  }

  type SerpApiOrganic = {
    title?: string;
    link?: string;
    snippet?: string;
    source?: string;
  };
  type SerpApiResponse = {
    organic_results?: SerpApiOrganic[];
  };

  const endpoint = new URL("https://serpapi.com/search.json");
  endpoint.searchParams.set("engine", "google");
  endpoint.searchParams.set("q", "latest iPhone model Apple official");
  endpoint.searchParams.set("api_key", env.SERPAPI_API_KEY);
  endpoint.searchParams.set("num", "6");

  const data = await fetchJsonWithTimeout<SerpApiResponse>(endpoint.toString(), 7000);
  const top = data?.organic_results?.find((item) => /apple/i.test(item.link || item.title || ""));
  const snippet = top?.snippet ?? data?.organic_results?.[0]?.snippet ?? "";
  if (!snippet) {
    return "";
  }

  const models = [...snippet.matchAll(/\biPhone\s+\d{1,2}(?:\s*(?:Pro Max|Pro|Plus|Air|e))?\b/gi)]
    .map((match) => match[0])
    .filter((value, index, arr) => arr.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .slice(0, 4);

  if (!models.length) {
    return "";
  }

  return [
    `Latest iPhone lineup from current Apple-linked results: *${models.join(", ")}*`,
    top?.snippet ? `â€¢ ${clipText(top.snippet, 220)}` : "",
    "",
    `As of ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    `Source: ${top?.source || top?.link || "google/serpapi organic result"}`,
  ].filter(Boolean).join("\n");
}

function buildLiveSearchQueries(question: string, route: ClawCloudLiveSearchRoute) {
  const context = inferClawCloudRegionContext(question);
  const q = normalizeRegionalQuestion(question).trim() || question.trim();
  const lower = q.toLowerCase();
  const year = new Date().getFullYear();
  const explicitYear = extractExplicitQuestionYear(q);
  const historicalYear = explicitYear !== null && explicitYear < year ? explicitYear : null;
  const queries = new Set<string>([q]);
  const countryMetric = detectWorldBankCountryMetricQuestion(q);
  const retailFuel = detectRetailFuelPriceQuestion(q);
  const localityScopedMetric =
    !countryMetric
    && context.requestedRegionMatchType === "locality"
    && /\b(gdp|gross domestic product|population|inflation|unemployment|economy|economic output)\b/i.test(lower);
  const preferredCurrency = context.requestedCurrency?.toLowerCase() ?? "usd";

  if (route.tier === "realtime") {
    if (retailFuel) {
      const country = context.requestedRegionMatchType === "locality"
        ? context.requestedRegion?.countryName || retailFuel.countryCandidate || ""
        : retailFuel.countryCandidate || context.requestedRegion?.countryName || "";
      if (country) {
        queries.add(`site:globalpetrolprices.com ${country} ${retailFuel.displayLabel} price`);
        queries.add(`${country} ${retailFuel.displayLabel} price per liter`);
        queries.add(`${country} ${retailFuel.displayLabel} national average retail price`);
      } else {
        queries.add(`${retailFuel.displayLabel} price by country`);
      }
    } else if (/\b(bitcoin|btc)\b/.test(lower)) {
      queries.add(`bitcoin price live ${preferredCurrency} usd ${year}`);
      queries.add("btc usd live price");
      queries.add(`bitcoin ${preferredCurrency} live price`);
    } else {
      queries.add(`${q} live update`);
      queries.add(`${q} official current`);
    }
  }

  if (route.tier === "volatile") {
    if (countryMetric) {
      const metricLabel = WORLD_BANK_METRIC_CONFIG[countryMetric.kind].label;
      queries.add(`${countryMetric.countryCandidate} ${metricLabel} world bank`);
      queries.add(`site:worldbank.org ${countryMetric.countryCandidate} ${metricLabel}`);
      queries.add(`${countryMetric.countryCandidate} ${metricLabel} latest annual estimate`);
    } else if (localityScopedMetric) {
      queries.add(`${q} latest estimate`);
      queries.add(`${q} metropolitan area latest estimate`);
      queries.add(`${q} official statistics`);
    } else if (/\b(richest|wealthiest|billionaire|net worth|forbes)\b/.test(lower)) {
      const rankingScope = extractRichestRankingScope(q);
      if (looksLikeHistoricalWealthQuestion(q)) {
        queries.add("richest person in history");
        queries.add("wealthiest people in history");
        queries.add("Mansa Musa Rockefeller richest in history");
      } else if (rankingScope === "people" || rankingScope === "mixed" || rankingScope === null) {
        queries.add(`top 10 richest people in the world ${year} net worth`);
        queries.add(`forbes real-time billionaires list ${year}`);
        queries.add(`bloomberg billionaires index ${year}`);
      }
      if (rankingScope === "cities" || rankingScope === "mixed") {
        queries.add(`top richest cities in the world ${year}`);
        queries.add(`wealthiest cities report ${year}`);
      }
    } else if (/\bceo\b/.test(lower)) {
      const ofMatch = /ceo\s+of\s+([a-z0-9 .&-]+)/i.exec(q);
      const company = ofMatch?.[1]?.trim();
      if (company) {
        queries.add(historicalYear ? `${company} ceo ${historicalYear}` : `${company} ceo ${year}`);
        queries.add(historicalYear ? `${company} leadership team ${historicalYear}` : `${company} leadership team official`);
      }
      queries.add(historicalYear ? `${q} ${historicalYear}` : `${q} official announcement`);
    } else if (/\biphone|apple\b/.test(lower)) {
      if (historicalYear) {
        queries.add(`Apple iPhone lineup ${historicalYear} official`);
        queries.add(`latest iPhone in ${historicalYear} Apple official`);
      } else {
        queries.add(`Apple latest iPhone model ${year}`);
        queries.add(`Apple newsroom iPhone ${year}`);
      }
    } else if (/\bopenai|gpt|chatgpt\b/.test(lower)) {
      queries.add(`OpenAI latest updates ${year}`);
      queries.add(`OpenAI announcements ${year}`);
      queries.add("OpenAI newsroom");
    } else {
      if (historicalYear) {
        queries.add(`${q} ${historicalYear}`);
      } else {
        queries.add(`${q} latest ${year}`);
        queries.add(`${q} official source`);
      }
    }
  }

  if (!historicalYear && !looksLikeHistoricalWealthQuestion(q)) {
    queries.add(`${q} latest`);
  }
  return [...queries].slice(0, 5);
}

function tokenizeQuestion(question: string) {
  return [...new Set(
    question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3 && !COMMON_STOP_WORDS.has(token)),
  )];
}

function focusTokensForQuestion(question: string) {
  const lower = question.toLowerCase();
  const retailFuel = detectRetailFuelPriceQuestion(question);
  if (retailFuel) {
    return [retailFuel.displayLabel, retailFuel.kind, "fuel", "retail", "price", "per liter"];
  }
  if (/\b(richest|wealthiest|billionaire|net worth|forbes)\b/.test(lower)) {
    const rankingScope = extractRichestRankingScope(question);
    if (rankingScope === "cities") {
      return ["richest", "cities", "wealthiest", "millionaires", "henley"];
    }
    if (rankingScope === "mixed") {
      return ["richest", "cities", "people", "wealthiest", "net worth", "forbes", "henley"];
    }
    return ["richest", "billionaire", "net worth", "forbes"];
  }
  if (/\bceo\b/.test(lower)) {
    return ["ceo"];
  }
  if (/\b(bitcoin|btc)\b/.test(lower)) {
    return ["bitcoin", "btc", "price", "usd", "inr"];
  }
  if (/\bopenai|gpt|chatgpt\b/.test(lower)) {
    return ["openai", "gpt", "chatgpt", "announcement"];
  }
  if (/\biphone|apple\b/.test(lower)) {
    return ["iphone", "apple", "model", "launch"];
  }
  return [];
}

function scoreDefinitionSource(term: string, source: ResearchSource) {
  const normalizedTerm = term.toLowerCase();
  const haystack = `${source.title} ${source.snippet} ${source.domain}`.toLowerCase();
  let score = Number(source.score || 0);

  if (haystack.includes(normalizedTerm)) {
    score += 1.0;
  }

  if (DEFINITION_REFERENCE_DOMAINS.some((domain) => source.domain.includes(domain))) {
    score += 1.2;
  }

  if (/\b(meaning|definition|means|refers to|noun|verb|adjective|etymology|pronunciation|translation)\b/i.test(haystack)) {
    score += 0.7;
  }

  if (/\b(quenya|sindarin|elvish|dictionary|etymology|translation)\b/i.test(haystack)) {
    score += 0.9;
  }

  if (/\b(character|profile|account|linkedin|instagram|facebook|song|lyrics|reels|streamlabs|deviantart|scribd)\b/i.test(haystack)) {
    score -= 0.8;
  }

  return score;
}

function selectDefinitionSources(term: string, sources: ResearchSource[]) {
  return [...sources]
    .map((source) => ({
      source,
      score: scoreDefinitionSource(term, source),
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.source)
    .slice(0, 5);
}

function buildDefinitionLookupQueries(term: string) {
  return [
    `"${term}"`,
    `"${term}" meaning`,
    `"${term}" definition`,
  ];
}

function extractSourceTitleLead(title: string) {
  return title.split(/\s+(?:[-|–—])\s+|\s*:\s*/)[0]?.trim() ?? title.trim();
}

function sourceLooksOfficialForTerm(term: string, source: ResearchSource) {
  const normalizedTerm = normalizeLookupKey(term).replace(/\s+/g, "");
  if (!normalizedTerm) {
    return false;
  }

  const domainKey = source.domain
    .replace(/^www\./i, "")
    .split(".")[0]
    ?.replace(/[^a-z0-9]+/gi, "")
    .toLowerCase() ?? "";

  if (domainKey && (domainKey === normalizedTerm || domainKey.includes(normalizedTerm) || normalizedTerm.includes(domainKey))) {
    return true;
  }

  return source.url.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(normalizedTerm);
}

function scoreEntityIdentitySource(term: string, source: ResearchSource) {
  const normalizedTerm = term.toLowerCase();
  const escapedTerm = escapeRegex(term);
  const haystack = `${source.title} ${source.snippet} ${source.domain}`.toLowerCase();
  let score = Number(source.score || 0);

  if (haystack.includes(normalizedTerm)) {
    score += 1.0;
  }

  if (sourceLooksOfficialForTerm(term, source)) {
    score += 1.2;
  }

  if (ENTITY_IDENTITY_CUE.test(haystack)) {
    score += 1.1;
  }

  if (ENTITY_DESCRIPTOR_VERB_CUE.test(haystack)) {
    score += 0.7;
  }

  if (new RegExp(`\\b${escapedTerm}\\b\\s+(?:is|are|was|were)\\b`, "i").test(`${source.title}. ${source.snippet}`)) {
    score += 1.1;
  }

  if (DEFINITION_REFERENCE_DOMAINS.some((domain) => source.domain.includes(domain))) {
    score += 0.25;
  }

  if (LEXICAL_LOOKUP_CUE.test(haystack)) {
    score -= 0.8;
  }

  if (LOOKUP_DISAMBIGUATION_CUE.test(haystack)) {
    score -= 0.8;
  }

  if (LOW_QUALITY_PUBLIC_LOOKUP_CUE.test(haystack)) {
    score -= 1.0;
  }

  return score;
}

function selectEntityIdentitySources(term: string, sources: ResearchSource[]) {
  return [...sources]
    .map((source) => ({
      source,
      score: scoreEntityIdentitySource(term, source),
    }))
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.source)
    .slice(0, 5);
}

function normalizeEntityDescriptor(value: string) {
  return clipText(
    value
      .replace(/\s+/g, " ")
      .replace(/^["'`([{-]+\s*/, "")
      .replace(/\s*[)\]}]+$/, "")
      .replace(/[;,:-]\s*$/g, "")
      .trim(),
    180,
  );
}

function looksLikeEntityDescriptor(value: string) {
  const normalized = normalizeEntityDescriptor(value);
  if (!normalized || normalized.length < 10) {
    return false;
  }

  if (LEXICAL_LOOKUP_CUE.test(normalized) || LOOKUP_DISAMBIGUATION_CUE.test(normalized)) {
    return false;
  }

  return ENTITY_IDENTITY_CUE.test(normalized) || ENTITY_DESCRIPTOR_VERB_CUE.test(normalized);
}

function extractEntityDescriptorFromSource(term: string, source: ResearchSource) {
  const escapedTerm = escapeRegex(term);
  const title = source.title.replace(/\s+/g, " ").trim();
  const snippet = cleanDefinitionSnippet(source.snippet);
  const combined = cleanDefinitionSnippet(`${title}. ${source.snippet}`);

  const directDescriptor =
    combined.match(new RegExp(`\\b${escapedTerm}\\b\\s+(?:is|are|was|were)\\s+([^.!?]{10,180})`, "i"))?.[1]
    ?? combined.match(new RegExp(`\\b${escapedTerm}\\b\\s*(?:-|–|—|:)\\s*([^.!?]{10,180})`, "i"))?.[1];

  if (directDescriptor && looksLikeEntityDescriptor(directDescriptor)) {
    return normalizeEntityDescriptor(directDescriptor);
  }

  const titleLead = extractSourceTitleLead(title);
  if (normalizeLookupKey(titleLead) === normalizeLookupKey(term) && looksLikeEntityDescriptor(snippet)) {
    return normalizeEntityDescriptor(
      snippet.replace(new RegExp(`^${escapedTerm}\\s+(?:is|are|was|were)\\s+`, "i"), ""),
    );
  }

  return "";
}

function inferEntityDisplayLabel(term: string, sources: ResearchSource[]) {
  const normalizedTerm = normalizeLookupKey(term);

  for (const source of sources) {
    const titleLead = extractSourceTitleLead(source.title);
    if (normalizeLookupKey(titleLead) === normalizedTerm) {
      return titleLead;
    }
  }

  const trimmed = term.trim();
  return trimmed ? `${trimmed[0]?.toUpperCase() ?? ""}${trimmed.slice(1)}` : term;
}

function looksLikeEntityIdentitySourceSet(term: string, sources: ResearchSource[]) {
  return sources.some((source) => scoreEntityIdentitySource(term, source) >= 2.2);
}

function buildNamedEntityIdentityAnswer(term: string, sources: ResearchSource[]) {
  const rankedSources = selectEntityIdentitySources(term, sources);
  if (!rankedSources.length) {
    return "";
  }

  const displayLabel = inferEntityDisplayLabel(term, rankedSources);
  const escapedDisplayLabel = escapeRegex(displayLabel);

  for (const source of rankedSources) {
    const descriptor = extractEntityDescriptorFromSource(displayLabel, source) || extractEntityDescriptorFromSource(term, source);
    if (!descriptor) {
      continue;
    }

    const cleanedDescriptor = normalizeEntityDescriptor(
      descriptor.replace(new RegExp(`^${escapedDisplayLabel}\\s+(?:is|are|was|were)\\s+`, "i"), ""),
    );
    if (!cleanedDescriptor) {
      continue;
    }

    return `${displayLabel} is ${cleanedDescriptor.replace(/[.]+$/g, "")}.`;
  }

  return "";
}

export function buildDefinitionLookupQueriesForTest(term: string) {
  return buildDefinitionLookupQueries(term);
}

export function buildNamedEntityIdentityAnswerForTest(term: string, sources: ResearchSource[]) {
  return buildNamedEntityIdentityAnswer(term, sources);
}

const CURATED_SHORT_DEFINITION_FALLBACKS: Record<string, string> = {
  semparo: 'Semparo appears to be a Quenya term that means "for a few reasons."',
  narasimha: "Narasimha is the half-man, half-lion avatar of Vishnu in Hindu tradition. He is known for protecting Prahlada and defeating Hiranyakashipu, symbolizing the victory of dharma over tyranny.",
  narsimha: "Narsimha, more commonly spelled Narasimha, is the half-man, half-lion avatar of Vishnu in Hindu tradition. He is known for protecting Prahlada and defeating Hiranyakashipu, symbolizing the victory of dharma over tyranny.",
};

function buildShortDefinitionFallback(term: string, sources: ResearchSource[]) {
  const topSources = selectDefinitionSources(term, sources);
  const domains = [...new Set(topSources.map((source) => source.domain).filter(Boolean))].slice(0, 3);
  const snippets = topSources
    .map((source) => `${source.title} ${source.snippet}`.toLowerCase())
    .join(" ");
  const clues: string[] = [];

  if (/\bquenya\b/.test(snippets)) {
    clues.push("a Quenya-language term");
  }
  if (/\bfinal fantasy\b|\bfandom\b|\bcharacter\b/.test(snippets)) {
    clues.push("a character or proper name");
  }

  const clueText = clues.length
    ? ` The public results mainly point to ${clues.join(" and ")}.`
    : "";
  const sourceText = domains.length ? ` Sources checked: ${domains.join(", ")}.` : "";

  return `I can't pin down one reliable meaning for "${term}" from public definition sources alone.${clueText}${sourceText} If you mean a specific language, title, app, or subject area, tell me that context and I'll define the exact one.`;
}

function buildPublicLookupSource(input: {
  title: string;
  url: string;
  snippet: string;
  score: number;
}): ResearchSource {
  const domain = (() => {
    try {
      return new URL(input.url).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  })();

  return {
    id: `public:${input.url}`,
    title: input.title,
    url: input.url,
    snippet: clipText(input.snippet.trim(), 260),
    provider: "jina",
    domain,
    score: input.score,
  };
}

function dedupeDefinitionSources(sources: ResearchSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url.toLowerCase().replace(/\?.*$/, "");
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

async function duckDuckGoDefinitionSearch(term: string): Promise<ResearchSource[]> {
  const endpoint = new URL("https://api.duckduckgo.com/");
  endpoint.searchParams.set("q", term);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("no_html", "1");
  endpoint.searchParams.set("skip_disambig", "0");
  endpoint.searchParams.set("no_redirect", "1");

  const payload = await fetchJsonWithTimeout<{
    AbstractText?: string;
    AbstractURL?: string;
    AbstractSource?: string;
    RelatedTopics?: Array<{
      Text?: string;
      FirstURL?: string;
      Topics?: Array<{
        Text?: string;
        FirstURL?: string;
      }>;
    }>;
  }>(endpoint.toString(), 4_000);

  if (!payload) {
    return [];
  }

  const sources: ResearchSource[] = [];
  if (payload.AbstractText && payload.AbstractURL) {
    sources.push(buildPublicLookupSource({
      title: `${term} - ${payload.AbstractSource ?? "DuckDuckGo"}`,
      url: payload.AbstractURL,
      snippet: payload.AbstractText,
      score: 0.72,
    }));
  }

  for (const topic of (payload.RelatedTopics ?? []).slice(0, 5)) {
    if (topic.Text && topic.FirstURL) {
      sources.push(buildPublicLookupSource({
        title: topic.Text.split(" - ")[0] ?? topic.Text.slice(0, 80),
        url: topic.FirstURL,
        snippet: topic.Text,
        score: 0.48,
      }));
    }

    for (const nested of (topic.Topics ?? []).slice(0, 2)) {
      if (nested.Text && nested.FirstURL) {
        sources.push(buildPublicLookupSource({
          title: nested.Text.split(" - ")[0] ?? nested.Text.slice(0, 80),
          url: nested.FirstURL,
          snippet: nested.Text,
          score: 0.38,
        }));
      }
    }
  }

  return sources;
}

function resolveDuckDuckGoHtmlHref(href: string) {
  try {
    const url = new URL(href, "https://html.duckduckgo.com");
    return url.searchParams.get("uddg") || url.toString();
  } catch {
    return href;
  }
}

async function duckDuckGoHtmlDefinitionSearch(term: string): Promise<ResearchSource[]> {
  const endpoint = new URL("https://html.duckduckgo.com/html/");
  endpoint.searchParams.set("q", `"${term}" meaning`);

  const html = await fetchTextWithTimeout(endpoint.toString(), 5_000);
  if (!html) {
    return [];
  }

  const $ = loadHtml(html);
  const sources: ResearchSource[] = [];

  $(".result").slice(0, 6).each((index, element) => {
    const rawHref = $(element).find("a.result__a").attr("href")?.trim() ?? "";
    const href = resolveDuckDuckGoHtmlHref(rawHref);
    if (!href) {
      return;
    }

    const title = $(element).find("a.result__a").text().replace(/\s+/g, " ").trim();
    const snippet = $(element).find(".result__snippet").text().replace(/\s+/g, " ").trim();
    if (!title && !snippet) {
      return;
    }

    sources.push(buildPublicLookupSource({
      title: title || term,
      url: href,
      snippet,
      score: 0.58 - index * 0.05,
    }));
  });

  return sources;
}

async function wikipediaDefinitionSearch(term: string): Promise<ResearchSource[]> {
  const endpoint = new URL("https://en.wikipedia.org/w/api.php");
  endpoint.searchParams.set("action", "opensearch");
  endpoint.searchParams.set("search", term);
  endpoint.searchParams.set("limit", "3");
  endpoint.searchParams.set("namespace", "0");
  endpoint.searchParams.set("format", "json");

  const payload = await fetchJsonWithTimeout<[string, string[], string[], string[]]>(endpoint.toString(), 4_000);
  const titles = payload?.[1] ?? [];
  const descriptions = payload?.[2] ?? [];
  const urls = payload?.[3] ?? [];

  return titles.map((title, index) =>
    buildPublicLookupSource({
      title,
      url: urls[index] ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
      snippet: descriptions[index] ?? "",
      score: 0.62 - index * 0.06,
    }),
  );
}

async function wiktionaryDefinitionSearch(term: string): Promise<ResearchSource[]> {
  const endpoint = new URL("https://en.wiktionary.org/w/api.php");
  endpoint.searchParams.set("action", "opensearch");
  endpoint.searchParams.set("search", term);
  endpoint.searchParams.set("limit", "3");
  endpoint.searchParams.set("namespace", "0");
  endpoint.searchParams.set("format", "json");

  const payload = await fetchJsonWithTimeout<[string, string[], string[], string[]]>(endpoint.toString(), 4_000);
  const titles = payload?.[1] ?? [];
  const descriptions = payload?.[2] ?? [];
  const urls = payload?.[3] ?? [];

  return titles.map((title, index) =>
    buildPublicLookupSource({
      title,
      url: urls[index] ?? `https://en.wiktionary.org/wiki/${encodeURIComponent(title)}`,
      snippet: descriptions[index] ?? "",
      score: 0.7 - index * 0.06,
    }),
  );
}

async function fetchPublicDefinitionSources(term: string) {
  const settled = await Promise.allSettled([
    duckDuckGoDefinitionSearch(term),
    duckDuckGoHtmlDefinitionSearch(term),
    wikipediaDefinitionSearch(term),
    wiktionaryDefinitionSearch(term),
  ]);

  return dedupeDefinitionSources(
    settled
      .filter((result): result is PromiseFulfilledResult<ResearchSource[]> => result.status === "fulfilled")
      .flatMap((result) => result.value),
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanDefinitionSnippet(value: string) {
  return clipText(
    value
      .replace(/\s+/g, " ")
      .replace(/^[^A-Za-z0-9"'(]+/, "")
      .trim(),
    220,
  );
}

function extractDeterministicDefinition(term: string, sources: ResearchSource[]) {
  const escapedTerm = escapeRegex(term);
  const termPattern = new RegExp(`\\b${escapedTerm}\\b`, "i");

  const rankedSources = selectDefinitionSources(term, sources).slice(0, 5);

  for (const source of rankedSources) {
    const text = cleanDefinitionSnippet(`${source.title}. ${source.snippet}`);
    if (!text || !termPattern.test(text)) {
      continue;
    }

    const lexicalMeaning =
      text.match(/(?:^|[.!?]\s+)[*"â€œ]?([^*"â€-]{3,90})\s+-\s+Dictionary\b/i)?.[1]
      ?? text.match(/(?:^|[.!?]\s+)[*"â€œ]?([^*"â€-]{3,90})\s+-\s+Middle Quenya\b/i)?.[1]
      ?? text.match(/\bmeaning\s*[:\-]?\s*["â€œ]?([^."â€]{4,120})["â€]?/i)?.[1]
      ?? text.match(/\bmeans?\s+["â€œ]?([^."â€]{4,120})["â€]?/i)?.[1]
      ?? text.match(/\brefers to\s+["â€œ]?([^."â€]{4,120})["â€]?/i)?.[1];

    if (lexicalMeaning?.trim()) {
      const cleanedMeaning = lexicalMeaning.trim();
      if (cleanedMeaning.toLowerCase().includes(term.toLowerCase())) {
        continue;
      }
      const sourceClue = /\bquenya\b/i.test(text)
        ? `${term} appears to be a Quenya term meaning "${cleanedMeaning}."`
        : `${term} appears to mean "${cleanedMeaning}."`;
      return sourceClue;
    }
  }

  for (const source of rankedSources) {
    const text = cleanDefinitionSnippet(`${source.title}. ${source.snippet}`);
    if (!text || !termPattern.test(text)) {
      continue;
    }

    const quenyaMeaning = text.match(/\bMiddle Quenya\b.*?\b(adverb|noun|verb|adjective)\b.*?\bMeaning\b[:\-]?\s*["â€œ]?([^."â€]{4,120})["â€]?/i);
    if (quenyaMeaning?.[2]) {
      return `${term} appears to be a Middle Quenya ${quenyaMeaning[1].toLowerCase()} meaning "${quenyaMeaning[2].trim()}."`;
    }

  }

  return "";
}

function extractDefinitionSnippetFromHtml(term: string, html: string) {
  const $ = loadHtml(html);
  const metaDescription =
    $('meta[name="description"]').attr("content")
    || $('meta[property="og:description"]').attr("content")
    || "";

  const mainText = $("main").text() || $("article").text() || $("body").text();
  const normalizedText = mainText.replace(/\s+/g, " ").trim();
  const escapedTerm = escapeRegex(term);

  const meaning =
    normalizedText.match(new RegExp(`\\b${escapedTerm}\\b.{0,140}?\\bMeaning\\b\\s*[:\\-]?\\s*["â€œ]?([^."â€]{4,140})["â€]?`, "i"))?.[1]
    ?? normalizedText.match(/\bMeaning\b\s*[:\-]?\s*["â€œ]?([^."â€]{4,140})["â€]?/i)?.[1]
    ?? normalizedText.match(new RegExp(`\\b${escapedTerm}\\b\\s+(?:is|means|refers to)\\s+["â€œ]?([^."â€]{4,140})["â€]?`, "i"))?.[1];

  if (meaning?.trim()) {
    return `Meaning: ${meaning.trim()}`;
  }

  if (metaDescription.trim()) {
    return metaDescription.trim();
  }

  return clipText(normalizedText, 260);
}

async function hydrateDefinitionSources(term: string, sources: ResearchSource[]) {
  const hydrated = await Promise.all(
    sources.slice(0, 2).map(async (source) => {
      if (source.snippet.trim().length >= 60 && /\b(meaning|means|refers to|noun|verb|adverb|adjective)\b/i.test(source.snippet)) {
        return source;
      }

      const html = await fetchTextWithTimeout(source.url, 4_500);
      if (!html) {
        return source;
      }

      const extractedSnippet = extractDefinitionSnippetFromHtml(term, html);
      if (!extractedSnippet.trim()) {
        return source;
      }

      return {
        ...source,
        snippet: extractedSnippet,
        score: source.score + 0.2,
      } satisfies ResearchSource;
    }),
  );

  return dedupeDefinitionSources([
    ...hydrated,
    ...sources.slice(2),
  ]);
}

export async function answerShortDefinitionLookup(question: string): Promise<string | null> {
  const lookup = detectShortDefinitionLookup(question);
  if (!lookup) {
    return null;
  }

  const curated = CURATED_SHORT_DEFINITION_FALLBACKS[lookup.term.toLowerCase()];
  if (curated) {
    return curated;
  }

  const keyedSearch = await searchInternetWithDiagnostics(buildDefinitionLookupQueries(lookup.term), {
    maxQueries: 3,
    maxResults: 12,
  });
  const publicSources = keyedSearch.sources.length >= 2
    ? []
    : await fetchPublicDefinitionSources(lookup.term).catch(() => []);
  const combinedSources = dedupeDefinitionSources([
    ...keyedSearch.sources,
    ...publicSources,
  ]);

  if (!combinedSources.length) {
    return null;
  }

  const directEntityAnswer = buildNamedEntityIdentityAnswer(lookup.term, combinedSources);
  if (directEntityAnswer.trim()) {
    return directEntityAnswer.trim();
  }

  const entityIdentityLikely = looksLikeEntityIdentitySourceSet(lookup.term, combinedSources);

  let sources = selectDefinitionSources(lookup.term, combinedSources);
  if (!sources.length) {
    return null;
  }

  let deterministic = extractDeterministicDefinition(lookup.term, sources);
  if (deterministic.trim()) {
    return deterministic.trim();
  }

  sources = selectDefinitionSources(lookup.term, await hydrateDefinitionSources(lookup.term, sources).catch(() => sources));
  const hydratedEntityAnswer = buildNamedEntityIdentityAnswer(lookup.term, sources);
  if (hydratedEntityAnswer.trim()) {
    return hydratedEntityAnswer.trim();
  }

  deterministic = extractDeterministicDefinition(lookup.term, sources);
  if (deterministic.trim()) {
    return deterministic.trim();
  }

  if (entityIdentityLikely) {
    return null;
  }

  return buildShortDefinitionFallback(lookup.term, sources);
}

function scoreLiveSource(
  source: ResearchSource,
  questionTokens: string[],
  focusTokens: string[],
) {
  const haystack = `${source.title} ${source.snippet} ${source.domain}`.toLowerCase();
  const overlap = questionTokens.filter((token) => haystack.includes(token)).length;
  const focusOverlap = focusTokens.filter((token) => haystack.includes(token)).length;
  const trustedBoost = TRUSTED_LIVE_DOMAINS.some((domain) => source.domain.includes(domain)) ? 0.65 : 0;
  return Number(source.score || 0) + overlap * 0.25 + focusOverlap * 0.5 + trustedBoost;
}

function selectRelevantLiveSources(question: string, sources: ResearchSource[]) {
  const questionTokens = tokenizeQuestion(question);
  const focusTokens = focusTokensForQuestion(question);
  const scored = sources
    .map((source) => ({
      source,
      score: scoreLiveSource(source, questionTokens, focusTokens),
    }))
    .sort((left, right) => right.score - left.score);

  const focused = scored
    .filter((entry) => entry.score >= 1.0)
    .map((entry) => entry.source);

  if (focused.length >= 3) {
    return focused.slice(0, 8);
  }

  return scored.map((entry) => entry.source).slice(0, 8);
}

function buildSynthesisSourceBlock(sources: ResearchSource[]) {
  return sources
    .slice(0, 8)
    .map((source, index) => [
      `[${index + 1}] ${clipText(source.title, 180)}`,
      `URL: ${source.url}`,
      `Domain: ${source.domain}`,
      `Snippet: ${clipText(source.snippet || "", 500)}`,
      source.publishedDate ? `Published: ${source.publishedDate}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n\n");
}

async function synthesizeLiveAnswerFromSources(
  question: string,
  route: ClawCloudLiveSearchRoute,
  sources: ResearchSource[],
) {
  const asOfDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const sourceBlock = buildSynthesisSourceBlock(sources);
  const instruction =
    route.tier === "realtime"
      ? "The user asked for real-time data. Prefer the newest source snippets and include concise market/current context."
      : "The user asked for a volatile fact (rankings/roles/latest releases). Use authoritative sources and resolve conflicts by preferring newer/trusted sources.";

  const answer = await completeClawCloudPrompt({
    system: [
      "You are ClawCloud AI. Produce a professional WhatsApp-style answer grounded strictly in the provided sources.",
      "Never use training-cutoff language, and never invent values missing from sources.",
      "If data is unavailable in the sources, say exactly what is missing and still provide the best verified facts.",
      "For ranking questions, use a numbered list.",
      "At the end include one line: Sources: domain1, domain2, ...",
      instruction,
    ].join("\n"),
    user: [
      `Question: ${question}`,
      `As-of date: ${asOfDate}`,
      "",
      "Verified source snippets:",
      sourceBlock,
    ].join("\n"),
    intent: "research",
    responseMode: "deep",
    maxTokens: 1_200,
    fallback: "",
    skipCache: true,
    temperature: 0.22,
  });

  return answer.trim();
}

async function buildCurrentWeatherAnswer(question: string) {
  if (!looksLikeDirectWeatherQuestion(question)) {
    return "";
  }

  const city = parseWeatherCity(question);
  if (!city) {
    return "";
  }

  const weather = await getWeather(city).catch(() => null);
  return weather?.trim() ?? "";
}

const KNOWN_DETERMINISTIC_EVIDENCE_PATTERNS: Array<{
  pattern: RegExp;
  title: string;
  domain: string;
  kind: ClawCloudEvidenceItem["kind"];
}> = [
  { pattern: /\bworld bank|worldbank\.org\b/i, title: "World Bank", domain: "worldbank.org", kind: "official_api" },
  { pattern: /\bopen-meteo\.com\b/i, title: "Open-Meteo", domain: "open-meteo.com", kind: "weather_provider" },
  { pattern: /\bwttr\.in\b/i, title: "wttr.in", domain: "wttr.in", kind: "weather_provider" },
  { pattern: /\bglobalpetrolprices\.com\b/i, title: "GlobalPetrolPrices", domain: "globalpetrolprices.com", kind: "report" },
  { pattern: /\bconsumer affairs|fcainfoweb\.nic\.in\b/i, title: "Department of Consumer Affairs", domain: "fcainfoweb.nic.in", kind: "official_page" },
  { pattern: /\bndrc|national development and reform commission\b/i, title: "National Development and Reform Commission", domain: "ndrc.gov.cn", kind: "official_page" },
  { pattern: /\bopenai\.com\b/i, title: "OpenAI", domain: "openai.com", kind: "official_page" },
  { pattern: /\bplatform\.openai\.com\b/i, title: "OpenAI Platform Docs", domain: "platform.openai.com", kind: "official_page" },
  { pattern: /\bforbes\b/i, title: "Forbes", domain: "forbes.com", kind: "report" },
  { pattern: /\bhenleyglobal\.com|henley report\b/i, title: "Henley & Partners", domain: "henleyglobal.com", kind: "report" },
  { pattern: /\bapple\b/i, title: "Apple", domain: "apple.com", kind: "official_page" },
  { pattern: /\bserpapi\b/i, title: "SerpAPI", domain: "serpapi.com", kind: "search_result" },
];

function buildLiveEvidenceSummary(evidence: ClawCloudEvidenceItem[]) {
  return [...new Set(evidence.map((item) => item.domain).filter(Boolean))].slice(0, 5);
}

function mapResearchSourceToEvidence(source: ResearchSource): ClawCloudEvidenceItem {
  const normalizedDomain = String(source.domain || "").trim() || new URL(source.url).hostname;
  const inferredKind: ClawCloudEvidenceItem["kind"] = TRUSTED_LIVE_DOMAINS.some((domain) => normalizedDomain.includes(domain))
    ? "official_page"
    : "search_result";

  return {
    title: source.title,
    domain: normalizedDomain,
    kind: inferredKind,
    url: source.url,
    snippet: source.snippet || null,
    publishedAt: source.publishedDate ?? null,
    observedAt: new Date().toISOString(),
  };
}

function inferEvidenceFromRenderedAnswer(answer: string): ClawCloudEvidenceItem[] {
  const evidence: ClawCloudEvidenceItem[] = [];
  const seen = new Set<string>();

  for (const known of KNOWN_DETERMINISTIC_EVIDENCE_PATTERNS) {
    if (!known.pattern.test(answer)) {
      continue;
    }

    const key = `${known.domain}:${known.kind}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    evidence.push({
      title: known.title,
      domain: known.domain,
      kind: known.kind,
      observedAt: new Date().toISOString(),
    });
  }

  const sourceLineMatches = [...answer.matchAll(/^sources?:\s*(.+)$/gim)];
  for (const match of sourceLineMatches) {
    const rawSources = String(match[1] ?? "")
      .split(/,|\band\b/gi)
      .map((part) => part.replace(/[*_`]/g, "").trim())
      .filter(Boolean);

    for (const rawSource of rawSources) {
      const normalizedSource = rawSource
        .replace(/^https?:\/\//i, "")
        .replace(/^www\./i, "")
        .replace(/\/.*$/, "")
        .trim()
        .toLowerCase();
      const domain = normalizedSource || rawSource.toLowerCase();
      const key = `${domain}:inferred`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      evidence.push({
        title: rawSource,
        domain,
        kind: "inferred",
        observedAt: new Date().toISOString(),
      });
    }
  }

  return evidence.slice(0, 6);
}

export function buildClawCloudLiveAnswerBundle(input: {
  question: string;
  answer: string;
  route: ClawCloudLiveSearchRoute;
  evidence?: ClawCloudEvidenceItem[];
  strategy: ClawCloudLiveBundleStrategy;
}): ClawCloudAnswerBundle {
  const answer = input.answer.trim();
  const evidence = (input.evidence?.length ? input.evidence : inferEvidenceFromRenderedAnswer(answer)).slice(0, 6);

  return {
    question: input.question,
    answer,
    channel: "live",
    generatedAt: new Date().toISOString(),
    badge: input.route.badge,
    sourceNote: input.route.sourceNote,
    evidence,
    sourceSummary: buildLiveEvidenceSummary(evidence),
    metadata: {
      route_tier: input.route.tier,
      requires_web_search: input.route.requiresWebSearch,
      evidence_count: evidence.length,
      strategy: input.strategy,
    },
  };
}

export function maybeBuildClawCloudLiveAnswerBundle(input: {
  question: string;
  answer: string;
  strategy?: ClawCloudLiveBundleStrategy;
  evidence?: ClawCloudEvidenceItem[];
  route?: ClawCloudLiveSearchRoute;
}): ClawCloudAnswerBundle | null {
  const answer = input.answer.trim();
  if (!answer) {
    return null;
  }

  const route = input.route ?? classifyClawCloudLiveSearchRoute(input.question);
  if (!route.requiresWebSearch) {
    return null;
  }

  return buildClawCloudLiveAnswerBundle({
    question: input.question,
    answer,
    route,
    evidence: input.evidence,
    strategy: input.strategy ?? "deterministic",
  });
}

export function renderClawCloudAnswerBundle(bundle: ClawCloudAnswerBundle): string {
  const cleaned = bundle.answer.trim();
  if (!cleaned) {
    return "";
  }

  if (
    cleaned.toLowerCase().includes("*live answer*")
    || cleaned.toLowerCase().includes("*fresh answer*")
    || cleaned.toLowerCase().includes("source note:")
  ) {
    return cleaned;
  }

  return [bundle.badge, bundle.sourceNote, "", cleaned]
    .filter((part) => part && part.trim().length > 0)
    .join("\n");
}

export async function fetchLiveAnswerBundle(question: string): Promise<ClawCloudAnswerBundle | null> {
  const route = classifyClawCloudLiveSearchRoute(question);
  if (!route.requiresWebSearch) {
    return null;
  }

  const deterministicAnswers = [
    await buildCurrentWeatherAnswer(question),
    await fetchIndiaConsumerPriceAnswer(question),
    await fetchRetailFuelPriceAnswer(question),
    await fetchWorldBankCountryMetricAnswer(question),
    await fetchOfficialPricingAnswer(question),
    await buildRichestPeopleAndCitiesAnswer(question),
    await buildRichestPeopleAnswerFromForbes(question),
    await buildRichestCitiesAnswerFromHenley(question),
    await buildBitcoinPriceAnswer(question),
    await buildCurrentCeoAnswerFromSerp(question),
    await buildLatestIphoneAnswerFromSerp(question),
  ];
  const deterministic = deterministicAnswers.find((answer) => answer.trim().length > 0);
  if (deterministic) {
    return buildClawCloudLiveAnswerBundle({
      question,
      answer: deterministic,
      route,
      strategy: "deterministic",
    });
  }

  const queries = buildLiveSearchQueries(question, route);
  const search = await searchInternetWithDiagnostics(queries, {
    maxQueries: Math.min(queries.length, 5),
    maxResults: 24,
  });

  if (!search.sources.length) {
    return null;
  }

  const sources = selectRelevantLiveSources(question, search.sources);
  if (sources.length < 2) {
    return null;
  }

  const synthesized = await synthesizeLiveAnswerFromSources(question, route, sources);
  if (!synthesized) {
    return null;
  }

  return buildClawCloudLiveAnswerBundle({
    question,
    answer: synthesized,
    route,
    evidence: sources.map((source) => mapResearchSourceToEvidence(source)),
    strategy: "search_synthesis",
  });
}

export async function fetchLiveDataAndSynthesize(question: string): Promise<string> {
  const bundle = await fetchLiveAnswerBundle(question);
  return bundle ? renderClawCloudAnswerBundle(bundle) : "";
}

function alreadyTaggedAsFresh(answer: string) {
  const t = answer.toLowerCase();
  return (
    t.includes("*live answer*")
    || t.includes("*fresh answer*")
    || t.includes("source note: checked against live web signals")
    || t.includes("source note: based on recently retrieved web sources")
  );
}

export function decorateLiveSearchAnswer(
  answer: string,
  routeOrQuestion: ClawCloudLiveSearchRoute | string,
): string {
  const cleaned = (answer ?? "").trim();
  if (!cleaned) return "";

  const route =
    typeof routeOrQuestion === "string"
      ? classifyClawCloudLiveSearchRoute(routeOrQuestion)
      : routeOrQuestion;

  if (!route.requiresWebSearch || alreadyTaggedAsFresh(cleaned)) {
    return cleaned;
  }

  return [route.badge, route.sourceNote, "", cleaned]
    .filter((part) => part && part.trim().length > 0)
    .join("\n");
}

