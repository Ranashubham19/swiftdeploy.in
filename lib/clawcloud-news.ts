import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { env } from "@/lib/env";

type NewsSource = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedDate?: string;
  score: number;
};

const NEWS_PATTERNS: RegExp[] = [
  /\b(latest news|recent news|breaking news|top stories|latest update|news update|what('?s| is) happening|what happened|news about|update on|status of)\b/i,
  /\b(latest|recent|breaking|current)\b.{0,40}\b(news|update|updates|headline|headlines)\b/i,
  /\b(what('?s| is) the latest on|latest on|give me the latest on)\b/i,
  /\b(today|right now|currently|this week|this month|as of now|live updates?)\b/i,
  /\b(who won|final score|live score|match result|tournament result|champion|knocked out|won the election|election results?|resigned|appointed|announced|launched|unveiled|released today)\b/i,
  /\b(attack|earthquake|flood|wildfire|explosion|shooting|ceasefire|protest|verdict|arrested|killed|injured|outage|strike)\b/i,
  /\b(ipl|cricket|nba|nfl|premier league|champions league|f1|formula 1|tennis|world cup|oscars?|grammys?|box office|bollywood|hollywood)\b/i,
];

const NOT_NEWS_PATTERNS: RegExp[] = [
  /\b(how (do|does|to|can|should|would)|explain|define|difference between|meaning of|history of|theory of|concept of)\b/i,
  /\b(write|create|make|generate|code|implement|design|build|calculate|compute|solve|debug|refactor)\b/i,
  /\b(api|database|schema|algorithm|function|component|sql|python|javascript|typescript)\b/i,
];

const TRUSTED_DOMAINS = [
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "nytimes.com",
  "wsj.com",
  "ft.com",
  "bloomberg.com",
  "theguardian.com",
  "aljazeera.com",
  "cnbc.com",
  "nbcnews.com",
  "abcnews.go.com",
  "cnn.com",
  "npr.org",
  "thehindu.com",
  "indianexpress.com",
  "hindustantimes.com",
  "timesofindia.com",
  "ndtv.com",
  "economictimes.com",
  "moneycontrol.com",
  "espn.com",
  "espncricinfo.com",
  "cricbuzz.com",
];

const LOW_QUALITY_DOMAINS = [
  "reddit.com",
  "quora.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "wikipedia.org",
];

export function detectNewsQuestion(question: string): boolean {
  const text = question.trim();
  if (!text) return false;
  if (NOT_NEWS_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return NEWS_PATTERNS.some((pattern) => pattern.test(text));
}

function formatCurrentDate(): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());
}

function formatPublishedDate(value?: string) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

function currentYear(): string {
  return new Date().getFullYear().toString();
}

function cleanedTopic(question: string) {
  return question
    .replace(/^(tell me about|give me (the )?(latest|news|update) on|what('?s| is) (the )?(latest|news|status) on|latest|recent|breaking)\s+/i, "")
    .replace(/\?+$/, "")
    .trim();
}

type SearchLocaleHint = {
  gl?: string;
  hl?: string;
};

function inferSearchLocale(question: string): SearchLocaleHint {
  const lower = question.toLowerCase();
  if (/\b(india|indian|ipl|bcci|loksabha|lok sabha|rajya sabha|rbi|bollywood|isro|aadhaar|upi)\b/.test(lower)) {
    return { gl: "in", hl: "en" };
  }
  if (/\b(uk|britain|british|london|premier league|bbc)\b/.test(lower)) {
    return { gl: "uk", hl: "en" };
  }
  return { hl: "en" };
}

export function buildNewsQueries(question: string): string[] {
  const topic = cleanedTopic(question) || question.trim();
  const queries = new Set<string>();

  queries.add(`${topic} latest news`);
  queries.add(`${topic} ${currentYear()} latest update`);

  if (/\b(score|match|won|winner|final|champion|ipl|cricket|nba|nfl|football|tennis|f1|formula 1)\b/i.test(question)) {
    queries.add(`${topic} result score today`);
  } else if (/\b(election|president|prime minister|pm|resigned|appointed|cabinet|government)\b/i.test(question)) {
    queries.add(`${topic} breaking announcement`);
  } else if (/\b(launch|launched|announced|unveiled|release|released)\b/i.test(question)) {
    queries.add(`${topic} announcement today`);
  } else {
    queries.add(`${topic} news today`);
  }

  return [...queries].slice(0, 3);
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function tavilyNewsSearch(query: string): Promise<NewsSource[]> {
  if (!env.TAVILY_API_KEY) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.TAVILY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        max_results: 8,
        search_depth: "advanced",
        include_answer: false,
        include_raw_content: false,
        days: 3,
      }),
    }).finally(() => clearTimeout(timer));

    if (!response.ok) return [];

    const data = await response.json() as {
      results?: Array<{
        url?: string;
        title?: string;
        content?: string;
        score?: number;
        published_date?: string;
      }>;
    };

    return (data.results ?? [])
      .filter((item) => item.url && item.title)
      .map((item) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: (item.content ?? "").slice(0, 400),
        domain: extractDomain(item.url ?? ""),
        publishedDate: item.published_date,
        score: Number(item.score ?? 0.45),
      }));
  } catch {
    return [];
  }
}

async function serpApiNewsSearch(query: string): Promise<NewsSource[]> {
  if (!env.SERPAPI_API_KEY) return [];

  try {
    const locale = inferSearchLocale(query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const url = new URL("https://serpapi.com/search.json");
    url.searchParams.set("engine", "google");
    url.searchParams.set("tbm", "nws");
    url.searchParams.set("tbs", "qdr:d3");
    url.searchParams.set("num", "8");
    url.searchParams.set("api_key", env.SERPAPI_API_KEY);
    url.searchParams.set("q", query);
    if (locale.gl) url.searchParams.set("gl", locale.gl);
    if (locale.hl) url.searchParams.set("hl", locale.hl);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(timer));

    if (!response.ok) return [];

    const data = await response.json() as {
      news_results?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        date?: string;
        source?: string;
      }>;
      organic_results?: Array<{
        title?: string;
        link?: string;
        snippet?: string;
        date?: string;
        position?: number;
      }>;
    };

    const results = data.news_results?.length ? data.news_results : (data.organic_results ?? []);
    return results
      .filter((item) => item.link && item.title)
      .map((item, index) => ({
        title: item.title ?? "",
        url: item.link ?? "",
        snippet: (item.snippet ?? "").slice(0, 400),
        domain: extractDomain(item.link ?? ""),
        publishedDate: item.date,
        score: 0.65 - index * 0.04,
      }));
  } catch {
    return [];
  }
}

async function jinaNewsSearch(query: string): Promise<NewsSource[]> {
  if (!env.JINA_API_KEY) return [];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    const url = new URL("https://s.jina.ai/");
    url.searchParams.set("q", query);

    const response = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        "x-no-cache": "true",
        Accept: "application/json",
      },
    }).finally(() => clearTimeout(timer));

    if (!response.ok) return [];

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return [];
    }

    const data = await response.json() as {
      data?: Array<{
        url?: string;
        title?: string;
        description?: string;
        content?: string;
      }>;
    };

    return (data.data ?? [])
      .filter((item) => item.url && item.title)
      .map((item, index) => ({
        title: item.title ?? "",
        url: item.url ?? "",
        snippet: (item.description ?? item.content ?? "").slice(0, 400),
        domain: extractDomain(item.url ?? ""),
        score: 0.5 - index * 0.03,
      }));
  } catch {
    return [];
  }
}

function dedupeByUrl(sources: NewsSource[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = source.url.replace(/\?.*$/, "").toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreSource(source: NewsSource) {
  let score = source.score;

  if (TRUSTED_DOMAINS.some((domain) => source.domain.includes(domain))) {
    score += 0.25;
  }

  if (LOW_QUALITY_DOMAINS.some((domain) => source.domain.includes(domain))) {
    score -= 0.3;
  }

  if (source.snippet.length > 120) {
    score += 0.05;
  }

  if (source.publishedDate) {
    const published = new Date(source.publishedDate);
    if (!Number.isNaN(published.getTime())) {
      const hoursAgo = (Date.now() - published.getTime()) / 3_600_000;
      if (hoursAgo <= 6) score += 0.35;
      else if (hoursAgo <= 24) score += 0.2;
      else if (hoursAgo <= 72) score += 0.08;
    }
  }

  return Math.max(0, Math.min(1.2, score));
}

export async function fastNewsSearch(queries: string[]): Promise<NewsSource[]> {
  const tasks: Promise<NewsSource[]>[] = [];

  for (const [index, query] of queries.slice(0, 3).entries()) {
    tasks.push(tavilyNewsSearch(query));
    tasks.push(serpApiNewsSearch(query));
    if (index === 0) {
      tasks.push(jinaNewsSearch(query));
    }
  }

  const settled = await Promise.allSettled(tasks);
  const combined = settled
    .filter((result): result is PromiseFulfilledResult<NewsSource[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);

  return dedupeByUrl(combined)
    .map((source) => ({ ...source, score: scoreSource(source) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10);
}

function buildSourceContext(sources: NewsSource[]) {
  return sources
    .slice(0, 6)
    .map((source, index) => {
      const published = formatPublishedDate(source.publishedDate);
      return [
        `[${index + 1}] ${source.title}`,
        `Source: ${source.domain}${published ? ` | Published: ${published}` : ""}`,
        source.snippet,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

const NEWS_SYSTEM_PROMPT = [
  "You are ClawCloud AI answering a live news question for a messaging user.",
  "Use only the provided search results. Do not add facts from memory.",
  "Lead with the direct answer in 2-3 sentences, then give short bullets if needed.",
  "If sources conflict or look incomplete, say so clearly.",
  "Never invent numbers, scores, names, or timelines.",
  "End with a short source line listing the source domains.",
  "Keep the answer concise and scan-friendly.",
].join("\n");

async function synthesiseNewsAnswer(question: string, sources: NewsSource[]) {
  if (!sources.length) {
    return [
      `*No reliable recent news found for:* ${question}`,
      "",
      "- I searched live news providers but did not find strong recent coverage.",
      "- Try a more specific topic, name, place, or event.",
    ].join("\n");
  }

  const answer = await completeClawCloudPrompt({
    system: NEWS_SYSTEM_PROMPT,
    user: [
      `Today: ${formatCurrentDate()}`,
      `Question: ${question}`,
      "",
      "Live search results:",
      buildSourceContext(sources),
    ].join("\n"),
    history: [],
    intent: "general",
    responseMode: "fast",
    maxTokens: 650,
    fallback: "",
    skipCache: true,
    temperature: 0.1,
  }).catch(() => "");

  if (answer.trim()) {
    return answer.trim();
  }

  const topSources = sources.slice(0, 3);
  const sourceList = [...new Set(topSources.map((source) => source.domain))].join(", ");
  const lines = [`*Latest on:* ${question}`, ""];

  for (const source of topSources) {
    const published = formatPublishedDate(source.publishedDate);
    lines.push(`- *${source.title}*`);
    if (published) {
      lines.push(`  Published: ${published}`);
    }
    if (source.snippet) {
      lines.push(`  ${source.snippet.slice(0, 180)}${source.snippet.length > 180 ? "..." : ""}`);
    }
    lines.push("");
  }

  lines.push(`*Sources:* ${sourceList}`);
  lines.push(`*As of:* ${formatCurrentDate()}`);
  return lines.join("\n");
}

export async function answerNewsQuestion(question: string): Promise<string> {
  const queries = buildNewsQueries(question);
  const sources = await fastNewsSearch(queries);
  return synthesiseNewsAnswer(question, sources);
}

export function hasNewsProviders(): boolean {
  return Boolean(env.TAVILY_API_KEY || env.SERPAPI_API_KEY || env.JINA_API_KEY);
}
