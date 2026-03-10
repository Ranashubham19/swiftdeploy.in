export type SearchCitation = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
};

const clean = (v: unknown): string => String(v || "").replace(/\s+/g, " ").trim();

export const searchWebWithCitations = async (
  query: string,
  opts?: { maxResults?: number; timeoutMs?: number },
): Promise<SearchCitation[]> => {
  const q = clean(query);
  if (!q) return [];
  const maxResults = Math.max(1, Math.min(8, opts?.maxResults ?? 4));
  const timeoutMs = Math.max(2000, opts?.timeoutMs ?? 9000);
  const tavilyKey = clean(process.env.TAVILY_API_KEY);
  const serperKey = clean(process.env.SERPER_API_KEY);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (tavilyKey) {
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: tavilyKey,
          query: q,
          max_results: maxResults,
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as any;
      const results = Array.isArray(data?.results) ? data.results : [];
      return results
        .map((item: any) => ({
          title: clean(item?.title),
          url: clean(item?.url),
          snippet: clean(item?.content),
          source: "tavily",
        }))
        .filter((x: SearchCitation) => x.title && x.url)
        .slice(0, maxResults);
    }

    if (serperKey) {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": serperKey,
        },
        body: JSON.stringify({ q, num: maxResults }),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({}))) as any;
      const items = Array.isArray(data?.organic) ? data.organic : [];
      return items
        .map((item: any) => ({
          title: clean(item?.title),
          url: clean(item?.link),
          snippet: clean(item?.snippet),
          source: "serper",
        }))
        .filter((x: SearchCitation) => x.title && x.url)
        .slice(0, maxResults);
    }
    return [];
  } finally {
    clearTimeout(timer);
  }
};

export const formatSearchCitationsBlock = (items: SearchCitation[]): string => {
  if (!items.length) return "";
  return [
    "Live web search context (cite and verify):",
    ...items.map(
      (item, idx) =>
        `[${idx + 1}] ${item.title}\nURL: ${item.url}\nSnippet: ${item.snippet || "(no snippet)"}`,
    ),
  ].join("\n\n");
};
