import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { env } from "@/lib/env";
import { searchInternetWithDiagnostics } from "@/lib/search";
import type { ResearchSource } from "@/lib/types";

export type ClawCloudLiveSearchTier = "realtime" | "volatile" | "knowledge";

export type ClawCloudLiveSearchRoute = {
  tier: ClawCloudLiveSearchTier;
  requiresWebSearch: boolean;
  badge: string | null;
  sourceNote: string | null;
};

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
  /\b(right now|as of today|currently happening)\b/i,
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
];

const REALTIME_CONTEXT_CUE = /\b(right now|today|live|currently|as of now|just now|breaking|latest|recent)\b/i;
const REALTIME_ENTITY_CUE = /\b(price|rate|value|worth|nav|stock|share|score|weather|forecast|temperature|aqi|news|updates?|announcement|traffic|exchange rate|result)\b/i;
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

function matchesAny(text: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(text));
}

function normalizeQuestion(question: string) {
  return question.toLowerCase().replace(/\s+/g, " ").trim();
}

function isRealtimeQuestion(normalizedQuestion: string) {
  return (
    matchesAny(normalizedQuestion, REALTIME_PATTERNS)
    || (REALTIME_CONTEXT_CUE.test(normalizedQuestion) && REALTIME_ENTITY_CUE.test(normalizedQuestion))
  );
}

function isVolatileQuestion(normalizedQuestion: string) {
  return (
    matchesAny(normalizedQuestion, VOLATILE_PATTERNS)
    || (VOLATILE_RANKING_CUE.test(normalizedQuestion) && VOLATILE_ENTITY_CUE.test(normalizedQuestion))
  );
}

function isStableKnowledgeQuestion(normalizedQuestion: string) {
  return matchesAny(normalizedQuestion, KNOWLEDGE_PATTERNS);
}

export function classifyClawCloudLiveSearchTier(question: string): ClawCloudLiveSearchTier {
  const normalizedQuestion = normalizeQuestion(question);
  if (!normalizedQuestion) return "knowledge";

  if (isRealtimeQuestion(normalizedQuestion)) return "realtime";
  if (isVolatileQuestion(normalizedQuestion)) return "volatile";
  if (isStableKnowledgeQuestion(normalizedQuestion)) return "knowledge";

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

function clipText(value: string, max: number) {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}

function formatUsdBillionsFromForbes(finalWorth: number) {
  const billions = finalWorth > 1_000 ? finalWorth / 1_000 : finalWorth;
  return `${billions.toFixed(1)}B`;
}

function looksLikeRichestRankingQuestion(question: string) {
  return /\b(top\s*\d+\s*(richest|wealthiest)|richest people|wealthiest people|forbes.*billionaire|billionaire list|net worth ranking)\b/i.test(
    question,
  );
}

function looksLikeBitcoinPriceQuestion(question: string) {
  return /\b(bitcoin|btc)\b/i.test(question) && /\b(price|usd|inr|current|today|right now|live)\b/i.test(question);
}

function looksLikeCurrentCeoQuestion(question: string) {
  return /\b(current\s+ceo\s+of|who\s+is\s+the\s+ceo\s+of|who\s+is\s+ceo\s+of)\b/i.test(question);
}

function looksLikeLatestIphoneQuestion(question: string) {
  return /\b(latest|newest|current)\b/i.test(question) && /\biphone\b/i.test(question);
}

async function buildRichestPeopleAnswerFromForbes(question: string) {
  if (!looksLikeRichestRankingQuestion(question)) {
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
    return `${index + 1}. *${personName}* — *$${worth}*`;
  });

  return [
    "Top richest people by live net worth:",
    ...lines,
    "",
    `As of ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    "Sources: forbes.com (Real-Time Billionaires API)",
  ].join("\n");
}

async function buildBitcoinPriceAnswer(question: string) {
  if (!looksLikeBitcoinPriceQuestion(question)) {
    return "";
  }

  type CoinGeckoResponse = {
    bitcoin?: {
      usd?: number;
      inr?: number;
      usd_24h_change?: number;
    };
  };

  const data = await fetchJsonWithTimeout<CoinGeckoResponse>(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd,inr&include_24hr_change=true",
    7000,
  );
  const btc = data?.bitcoin;
  if (!btc || !Number.isFinite(btc.usd) || !Number.isFinite(btc.inr)) {
    if (!env.SERPAPI_API_KEY) {
      return "";
    }

    type SerpApiOrganic = { snippet?: string; source?: string; link?: string };
    type SerpApiResponse = { organic_results?: SerpApiOrganic[] };
    const endpoint = new URL("https://serpapi.com/search.json");
    endpoint.searchParams.set("engine", "google");
    endpoint.searchParams.set("q", "bitcoin price usd inr live");
    endpoint.searchParams.set("api_key", env.SERPAPI_API_KEY);
    endpoint.searchParams.set("num", "3");
    const fallback = await fetchJsonWithTimeout<SerpApiResponse>(endpoint.toString(), 7000);
    const top = fallback?.organic_results?.[0];
    if (!top?.snippet) {
      return "";
    }

    return [
      "*Bitcoin (BTC) current price context:*",
      `• ${clipText(top.snippet, 200)}`,
      "",
      `As of ${new Date().toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}`,
      `Source: ${top.source || top.link || "serpapi organic result"}`,
    ].join("\n");
  }

  const usd = Number(btc.usd).toLocaleString("en-US", { maximumFractionDigits: 2 });
  const inr = Number(btc.inr).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const change = Number.isFinite(btc.usd_24h_change)
    ? `${btc.usd_24h_change! >= 0 ? "+" : ""}${btc.usd_24h_change!.toFixed(2)}% (24h)`
    : "24h change unavailable";

  return [
    `*Bitcoin (BTC) live price:*`,
    `• USD: *$${usd}*`,
    `• INR: *₹${inr}*`,
    `• 24h: *${change}*`,
    "",
    `As of ${new Date().toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })}`,
    "Sources: api.coingecko.com",
  ].join("\n");
}

function extractCompanyFromCeoQuestion(question: string) {
  const match = /\bceo\s+of\s+([a-z0-9 .&-]+)/i.exec(question);
  if (!match?.[1]) {
    return "";
  }
  return match[1]
    .replace(/\b(as of|today|right now|currently)\b.*$/i, "")
    .trim()
    .replace(/[?.,;:]+$/, "");
}

async function buildCurrentCeoAnswerFromSerp(question: string) {
  if (!looksLikeCurrentCeoQuestion(question) || !env.SERPAPI_API_KEY) {
    return "";
  }

  const company = extractCompanyFromCeoQuestion(question);
  if (!company) {
    return "";
  }

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
  endpoint.searchParams.set("q", `current CEO of ${company}`);
  endpoint.searchParams.set("api_key", env.SERPAPI_API_KEY);
  endpoint.searchParams.set("num", "5");

  const data = await fetchJsonWithTimeout<SerpApiResponse>(endpoint.toString(), 7000);
  const answerBoxValue = data?.answer_box?.answer?.trim();
  if (answerBoxValue) {
    return [
      `Current CEO of *${company}* is *${answerBoxValue}*.`,
      "",
      `As of ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
      "Sources: google/serpapi answer box",
    ].join("\n");
  }

  const topOrganic = data?.organic_results?.[0];
  if (topOrganic?.snippet && topOrganic?.title) {
    return [
      `I could not extract a definitive CEO name from the answer box, but the top current source says:`,
      `• *${topOrganic.title}*`,
      `• ${clipText(topOrganic.snippet, 180)}`,
      "",
      `Source: ${topOrganic.source || topOrganic.link || "serpapi organic result"}`,
    ].join("\n");
  }

  return "";
}

async function buildLatestIphoneAnswerFromSerp(question: string) {
  if (!looksLikeLatestIphoneQuestion(question) || !env.SERPAPI_API_KEY) {
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
    top?.snippet ? `• ${clipText(top.snippet, 220)}` : "",
    "",
    `As of ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    `Source: ${top?.source || top?.link || "google/serpapi organic result"}`,
  ].filter(Boolean).join("\n");
}

function buildLiveSearchQueries(question: string, route: ClawCloudLiveSearchRoute) {
  const q = question.trim();
  const lower = q.toLowerCase();
  const year = new Date().getFullYear();
  const queries = new Set<string>([q]);

  if (route.tier === "realtime") {
    if (/\b(bitcoin|btc)\b/.test(lower)) {
      queries.add(`bitcoin price live usd inr ${year}`);
      queries.add("btc usd live price");
      queries.add("bitcoin inr live price");
    } else {
      queries.add(`${q} live update`);
      queries.add(`${q} official current`);
    }
  }

  if (route.tier === "volatile") {
    if (/\b(richest|wealthiest|billionaire|net worth|forbes)\b/.test(lower)) {
      queries.add(`top 10 richest people in the world ${year} net worth`);
      queries.add(`forbes real-time billionaires list ${year}`);
      queries.add(`bloomberg billionaires index ${year}`);
    } else if (/\bceo\b/.test(lower)) {
      const ofMatch = /ceo\s+of\s+([a-z0-9 .&-]+)/i.exec(q);
      const company = ofMatch?.[1]?.trim();
      if (company) {
        queries.add(`${company} ceo ${year}`);
        queries.add(`${company} leadership team official`);
      }
      queries.add(`${q} official announcement`);
    } else if (/\biphone|apple\b/.test(lower)) {
      queries.add(`Apple latest iPhone model ${year}`);
      queries.add(`Apple newsroom iPhone ${year}`);
    } else if (/\bopenai|gpt|chatgpt\b/.test(lower)) {
      queries.add(`OpenAI latest updates ${year}`);
      queries.add(`OpenAI announcements ${year}`);
      queries.add("OpenAI newsroom");
    } else {
      queries.add(`${q} latest ${year}`);
      queries.add(`${q} official source`);
    }
  }

  queries.add(`${q} latest`);
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
  if (/\b(richest|wealthiest|billionaire|net worth|forbes)\b/.test(lower)) {
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

export async function fetchLiveDataAndSynthesize(question: string): Promise<string> {
  const route = classifyClawCloudLiveSearchRoute(question);
  if (!route.requiresWebSearch) {
    return "";
  }

  const deterministicAnswers = [
    await buildRichestPeopleAnswerFromForbes(question),
    await buildBitcoinPriceAnswer(question),
    await buildCurrentCeoAnswerFromSerp(question),
    await buildLatestIphoneAnswerFromSerp(question),
  ];
  const deterministic = deterministicAnswers.find((answer) => answer.trim().length > 0);
  if (deterministic) {
    return decorateLiveSearchAnswer(deterministic, route);
  }

  const queries = buildLiveSearchQueries(question, route);
  const search = await searchInternetWithDiagnostics(queries, {
    maxQueries: Math.min(queries.length, 5),
    maxResults: 24,
  });

  if (!search.sources.length) {
    return "";
  }

  const sources = selectRelevantLiveSources(question, search.sources);
  if (sources.length < 2) {
    return "";
  }

  const synthesized = await synthesizeLiveAnswerFromSources(question, route, sources);
  if (!synthesized) {
    return "";
  }

  return decorateLiveSearchAnswer(synthesized, route);
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
