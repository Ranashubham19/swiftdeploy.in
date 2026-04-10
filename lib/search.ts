import type {
  ResearchSource,
  SearchDiagnostics,
  SearchProvider,
  SearchProviderQueryDiagnostic,
  SearchProviderSummaryDiagnostic,
} from "@/lib/types";

import { env } from "@/lib/env";
import {
  clipText,
  domainFromUrl,
  extractUrls,
  stableId,
  uniqueBy,
} from "@/lib/utils";

type TavilyResponse = {
  results?: Array<{
    url?: string;
    title?: string;
    content?: string;
    score?: number;
  }>;
};

type SerpApiResponse = {
  organic_results?: Array<{
    title?: string;
    link?: string;
    snippet?: string;
    position?: number;
    date?: string;
  }>;
};

const WRAPPED_NEWS_PUBLISHER_DOMAIN_MAP: Record<string, string> = {
  "abc news": "abcnews.go.com",
  "ap": "apnews.com",
  "ap news": "apnews.com",
  "bbc": "bbc.com",
  "bbc news": "bbc.com",
  "bloomberg": "bloomberg.com",
  "cnbc": "cnbc.com",
  "cnn": "cnn.com",
  "economic times": "economictimes.indiatimes.com",
  "financial times": "ft.com",
  "forbes": "forbes.com",
  "hindustan times": "hindustantimes.com",
  "indian express": "indianexpress.com",
  "mint": "livemint.com",
  "ndtv": "ndtv.com",
  "news18": "news18.com",
  "npr": "npr.org",
  "reuters": "reuters.com",
  "the guardian": "theguardian.com",
  "the hindu": "thehindu.com",
  "times of india": "timesofindia.indiatimes.com",
  "wall street journal": "wsj.com",
};

function normalizePublisherLabel(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/[|–—:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inferWrappedNewsPublisherDomain(title: string, snippet: string) {
  const candidates = new Set<string>();
  const normalizedTitle = title.replace(/&nbsp;/gi, " ").trim();
  const normalizedSnippet = snippet.replace(/&nbsp;/gi, " ").trim();

  const titleTail = normalizedTitle.split(/\s+-\s+|\s+\|\s+/).at(-1)?.trim();
  const snippetTail = normalizedSnippet.split(/\s{2,}|\u00a0{2,}/).at(-1)?.trim();
  if (titleTail) {
    candidates.add(titleTail);
  }
  if (snippetTail) {
    candidates.add(snippetTail);
  }

  for (const candidate of candidates) {
    const normalized = normalizePublisherLabel(candidate);
    if (!normalized) {
      continue;
    }

    if (WRAPPED_NEWS_PUBLISHER_DOMAIN_MAP[normalized]) {
      return WRAPPED_NEWS_PUBLISHER_DOMAIN_MAP[normalized];
    }

    const fuzzy = Object.entries(WRAPPED_NEWS_PUBLISHER_DOMAIN_MAP).find(([label]) => normalized.includes(label));
    if (fuzzy) {
      return fuzzy[1];
    }
  }

  return "";
}

function resolveSearchResultDomain(url: string, title: string, snippet: string) {
  const baseDomain = domainFromUrl(url);
  if (baseDomain !== "news.google.com") {
    return baseDomain;
  }

  return inferWrappedNewsPublisherDomain(title, snippet) || baseDomain;
}

export function resolveSearchResultDomainForTest(url: string, title: string, snippet: string) {
  return resolveSearchResultDomain(url, title, snippet);
}

function dedupeSources(sources: ResearchSource[]) {
  const unique = uniqueBy(sources, (result) => result.url);
  const strong = unique.filter((source) => !isLowSignalSearchResult(source));

  return (strong.length >= 3 ? strong : unique)
    .sort((left, right) => right.score - left.score);
}

function isLowSignalSearchResult(source: ResearchSource) {
  const title = source.title.trim().toLowerCase();
  const snippet = source.snippet.trim().toLowerCase();

  return (
    !title ||
    title === "skip to content" ||
    title === "home" ||
    title === "untitled source" ||
    title === source.domain.toLowerCase() ||
    /^search$/.test(title) ||
    /^results$/.test(title) ||
    (title.length < 5 && !/\d/.test(title)) ||
    (/cookie|privacy|javascript|enable browser/i.test(title) &&
      !/price|news|report|analysis|official|documentation/i.test(snippet))
  );
}

function parseJinaSearchText(query: string, payload: string) {
  const lines = payload.replace(/\r/g, "").split("\n");
  const sources: ResearchSource[] = [];
  let pendingTitle = "";
  let pendingSnippet: string[] = [];

  function flushSource(url: string) {
    const snippet = clipText(pendingSnippet.join(" ").trim(), 240);
    sources.push({
      id: stableId("jina", url),
      title: pendingTitle || domainFromUrl(url),
      url,
      snippet,
      provider: "jina",
      domain: resolveSearchResultDomain(url, pendingTitle || domainFromUrl(url), snippet),
      score: Math.max(0.2, 1 - sources.length * 0.08),
    });
    pendingTitle = "";
    pendingSnippet = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    const urlMatch = /^(?:URL(?: Source)?:)\s*(https?:\/\/\S+)$/i.exec(line);
    if (urlMatch?.[1]) {
      flushSource(urlMatch[1]);
      continue;
    }

    const markdownMatch = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/.exec(line);
    if (markdownMatch?.[2]) {
      pendingTitle = markdownMatch[1].trim();
      flushSource(markdownMatch[2].trim());
      continue;
    }

    if (/^title:\s+/i.test(line)) {
      pendingTitle = line.replace(/^title:\s+/i, "").trim();
      continue;
    }

    if (/^description:\s+/i.test(line) || /^content:\s+/i.test(line)) {
      pendingSnippet.push(line.replace(/^(description|content):\s+/i, "").trim());
      continue;
    }

    if (!pendingTitle && /^#{1,3}\s+/.test(line)) {
      pendingTitle = line.replace(/^#{1,3}\s+/, "").trim();
      continue;
    }

    if (!/^(search query|markdown content|links|results)$/i.test(line)) {
      pendingSnippet.push(line);
    }
  }

  const urlOnlySources = extractUrls(payload)
    .filter((url) => !sources.some((source) => source.url === url))
    .slice(0, 8)
    .map((url, index) => ({
      id: stableId("jina-url", url),
      title: query,
      url,
      snippet: clipText(payload, 220),
      provider: "jina" as const,
      domain: resolveSearchResultDomain(url, query, payload),
      score: Math.max(0.15, 0.7 - index * 0.05),
    }));

  return dedupeSources([...sources, ...urlOnlySources]).slice(0, 8);
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  return fetch(input, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutHandle));
}

async function tavilySearch(query: string): Promise<ResearchSource[]> {
  if (!env.TAVILY_API_KEY) {
    return [];
  }

  const response = await fetchWithTimeout("https://api.tavily.com/search", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.TAVILY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: 10,
      search_depth: "advanced",
      include_answer: false,
      include_raw_content: false,
    }),
  }, 3200);

  if (!response.ok) {
    throw new Error(`Tavily search failed with ${response.status}`);
  }

  const payload = (await response.json()) as TavilyResponse;
  return (payload.results ?? [])
    .filter((result) => result.url && result.title)
    .map((result) => ({
      id: stableId("tavily", result.url ?? ""),
      title: result.title ?? "Untitled source",
      url: result.url ?? "",
      snippet: clipText(result.content ?? "", 250),
      provider: "tavily" as const,
      domain: resolveSearchResultDomain(
        result.url ?? "",
        result.title ?? "Untitled source",
        clipText(result.content ?? "", 250),
      ),
      score: Number(result.score ?? 0),
    }));
}

async function serpApiSearch(query: string): Promise<ResearchSource[]> {
  if (!env.SERPAPI_API_KEY) {
    return [];
  }

  const endpoint = new URL("https://serpapi.com/search.json");
  endpoint.searchParams.set("engine", "google");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("api_key", env.SERPAPI_API_KEY);
  endpoint.searchParams.set("num", "10");
  endpoint.searchParams.set("google_domain", "google.com");

  const response = await fetchWithTimeout(endpoint.toString(), {
    cache: "no-store",
  }, 3200);

  if (!response.ok) {
    throw new Error(`SerpAPI search failed with ${response.status}`);
  }

  const payload = (await response.json()) as SerpApiResponse;
  return (payload.organic_results ?? [])
    .filter((result) => result.link && result.title)
    .map((result) => ({
      id: stableId("serpapi", result.link ?? ""),
      title: result.title ?? "Untitled source",
      url: result.link ?? "",
      snippet: clipText(result.snippet ?? "", 250),
      provider: "serpapi" as const,
      domain: resolveSearchResultDomain(
        result.link ?? "",
        result.title ?? "Untitled source",
        clipText(result.snippet ?? "", 250),
      ),
      score: 1 / Math.max(result.position ?? 1, 1),
      publishedDate: result.date,
    }));
}

async function jinaSearch(query: string): Promise<ResearchSource[]> {
  if (!env.JINA_API_KEY) {
    return [];
  }

  const endpoint = new URL("https://s.jina.ai/");
  endpoint.searchParams.set("q", query);

  const response = await fetchWithTimeout(
    endpoint.toString(),
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        "x-no-cache": "true",
      },
    },
    3200,
  );

  if (!response.ok) {
    throw new Error(`Jina search failed with ${response.status}`);
  }

  const payload = await response.text();
  return parseJinaSearchText(query, payload);
}

type SearchInternetOptions = {
  maxQueries?: number;
  maxResults?: number;
};

type ProviderExecutor = {
  name: SearchProvider;
  enabled: boolean;
  run: (query: string) => Promise<ResearchSource[]>;
};

type ProviderExecutionResult = {
  sources: ResearchSource[];
  diagnostic: SearchProviderQueryDiagnostic;
};

function summarizeProviderDiagnostics(
  diagnostics: SearchProviderQueryDiagnostic[],
): SearchProviderSummaryDiagnostic[] {
  const providers: SearchProvider[] = ["tavily", "serpapi", "jina"];

  return providers.map((provider) => {
    const providerDiagnostics = diagnostics.filter(
      (diagnostic) => diagnostic.provider === provider,
    );
    const attempted = providerDiagnostics.filter(
      (diagnostic) => diagnostic.attempted,
    );
    const successful = attempted.filter((diagnostic) => diagnostic.ok);
    const failed = attempted.filter((diagnostic) => !diagnostic.ok);
    const durationSamples = attempted.map((diagnostic) => diagnostic.durationMs);
    const totalDuration = durationSamples.reduce(
      (sum, duration) => sum + duration,
      0,
    );

    return {
      provider,
      attemptedQueries: attempted.length,
      successfulQueries: successful.length,
      failedQueries: failed.length,
      totalResults: providerDiagnostics.reduce(
        (sum, diagnostic) => sum + diagnostic.resultCount,
        0,
      ),
      averageDurationMs: attempted.length
        ? Math.round(totalDuration / attempted.length)
        : 0,
      maxDurationMs: durationSamples.length ? Math.max(...durationSamples) : 0,
      lastError: failed.at(-1)?.error,
    } satisfies SearchProviderSummaryDiagnostic;
  });
}

function disabledProviderDiagnostic(
  provider: SearchProvider,
  query: string,
): SearchProviderQueryDiagnostic {
  return {
    provider,
    query,
    attempted: false,
    ok: false,
    durationMs: 0,
    resultCount: 0,
    error: "provider_not_configured",
  };
}

async function executeProviderQuery(
  provider: ProviderExecutor,
  query: string,
): Promise<ProviderExecutionResult> {
  if (!provider.enabled) {
    return {
      sources: [],
      diagnostic: disabledProviderDiagnostic(provider.name, query),
    };
  }

  const startedAt = Date.now();
  try {
    const sources = await provider.run(query);
    return {
      sources,
      diagnostic: {
        provider: provider.name,
        query,
        attempted: true,
        ok: true,
        durationMs: Date.now() - startedAt,
        resultCount: sources.length,
      },
    };
  } catch (error) {
    return {
      sources: [],
      diagnostic: {
        provider: provider.name,
        query,
        attempted: true,
        ok: false,
        durationMs: Date.now() - startedAt,
        resultCount: 0,
        error: error instanceof Error ? error.message : "provider query failed",
      },
    };
  }
}

export async function searchInternetWithDiagnostics(
  queries: string[],
  options: SearchInternetOptions = {},
): Promise<{ sources: ResearchSource[]; diagnostics: SearchDiagnostics }> {
  const uniqueQueries = [...new Set(queries.map((query) => query.trim()).filter(Boolean))]
    .slice(0, options.maxQueries ?? env.RESEARCH_MAX_SEARCH_QUERIES);

  if (!uniqueQueries.length) {
    return {
      sources: [],
      diagnostics: {
        queries: [],
        rawResultCount: 0,
        dedupedResultCount: 0,
        providerQueries: [],
        providerSummary: summarizeProviderDiagnostics([]),
        retryCount: 0,
      },
    };
  }

  const providers: ProviderExecutor[] = [
    {
      name: "tavily",
      enabled: Boolean(env.TAVILY_API_KEY),
      run: tavilySearch,
    },
    {
      name: "serpapi",
      enabled: Boolean(env.SERPAPI_API_KEY),
      run: serpApiSearch,
    },
    {
      name: "jina",
      enabled: Boolean(env.JINA_API_KEY),
      run: jinaSearch,
    },
  ];

  const queryResults = await Promise.all(
    uniqueQueries.map(async (query) => {
      const providerRuns = await Promise.all(
        providers.map((provider) => executeProviderQuery(provider, query)),
      );
      const perQuerySources = dedupeSources(providerRuns.flatMap((run) => run.sources));
      const providerDiagnostics = providerRuns.map((run) => run.diagnostic);
      return { perQuerySources, providerDiagnostics };
    }),
  );

  const providerQueries = queryResults.flatMap((entry) => entry.providerDiagnostics);
  const rawResultCount = providerQueries.reduce(
    (sum, diagnostic) => sum + diagnostic.resultCount,
    0,
  );
  const deduped = dedupeSources(queryResults.flatMap((entry) => entry.perQuerySources));
  const limited = deduped.slice(0, options.maxResults ?? env.RESEARCH_MAX_SEARCH_RESULTS);

  return {
    sources: limited,
    diagnostics: {
      queries: uniqueQueries,
      rawResultCount,
      dedupedResultCount: deduped.length,
      providerQueries,
      providerSummary: summarizeProviderDiagnostics(providerQueries),
      retryCount: 0,
    },
  };
}

export async function searchInternet(
  queries: string[],
  options: SearchInternetOptions = {},
) {
  const result = await searchInternetWithDiagnostics(queries, options);
  return result.sources;
}
