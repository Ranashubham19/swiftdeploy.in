import type { ResearchDocument, ResearchSource } from "@/lib/types";

import { env } from "@/lib/env";
import { clipText, markdownToPlainText, stableId, stripHtml } from "@/lib/utils";

type FirecrawlResponse = {
  success?: boolean;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      url?: string;
      sourceURL?: string;
    };
  };
};

type ApifyItem = {
  url?: string;
  metadata?: {
    title?: string;
    description?: string;
  };
  title?: string;
  text?: string;
  markdown?: string;
  html?: string;
  description?: string;
};

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

async function firecrawlSource(source: ResearchSource): Promise<ResearchDocument | null> {
  if (!env.FIRECRAWL_API_KEY) {
    return null;
  }

  const response = await fetchWithTimeout("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: source.url,
      formats: ["markdown"],
      onlyMainContent: true,
    }),
  }, 4200);

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as FirecrawlResponse;
  const markdown = payload.data?.markdown ?? "";
  const content = markdownToPlainText(markdown);

  if (content.length < 160) {
    return null;
  }

  return {
    id: stableId("firecrawl", source.url),
    title: payload.data?.metadata?.title || source.title,
    url: payload.data?.metadata?.sourceURL || payload.data?.metadata?.url || source.url,
    content,
    provider: "firecrawl",
    excerpt: clipText(content, 280),
  };
}

async function jinaReaderSource(source: ResearchSource): Promise<ResearchDocument | null> {
  if (!env.JINA_API_KEY) {
    return null;
  }

  const endpoint = `https://r.jina.ai/${source.url}`;
  const response = await fetchWithTimeout(
    endpoint,
    {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        "x-no-cache": "true",
      },
    },
    3600,
  );

  if (!response.ok) {
    return null;
  }

  const markdown = await response.text();
  const content = markdownToPlainText(markdown);

  if (content.length < 160) {
    return null;
  }

  return {
    id: stableId("jina", source.url),
    title: source.title,
    url: source.url,
    content,
    provider: "jina",
    excerpt: clipText(content, 280),
  };
}

async function scraperApiSource(source: ResearchSource): Promise<ResearchDocument | null> {
  if (!env.SCRAPERAPI_KEY) {
    return null;
  }

  const endpoint = new URL("https://api.scraperapi.com/");
  endpoint.searchParams.set("api_key", env.SCRAPERAPI_KEY);
  endpoint.searchParams.set("url", source.url);

  const response = await fetchWithTimeout(endpoint.toString(), {
    cache: "no-store",
  }, 3200);

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const content = stripHtml(html);

  if (content.length < 160) {
    return null;
  }

  return {
    id: stableId("scraperapi", source.url),
    title: source.title,
    url: source.url,
    content,
    provider: "scraperapi",
    excerpt: clipText(content, 280),
  };
}

async function apifySource(source: ResearchSource): Promise<ResearchDocument | null> {
  if (!env.APIFY_API_TOKEN) {
    return null;
  }

  const endpoint = new URL(
    "https://api.apify.com/v2/acts/apify~website-content-crawler/run-sync-get-dataset-items",
  );
  endpoint.searchParams.set("token", env.APIFY_API_TOKEN);
  endpoint.searchParams.set("memory", "4096");
  endpoint.searchParams.set("timeout", "180");

  const response = await fetchWithTimeout(endpoint.toString(), {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      startUrls: [{ url: source.url }],
      maxCrawlDepth: 0,
      maxCrawlPages: 1,
      saveMarkdown: true,
      saveHtml: false,
      removeCookieWarnings: true,
      crawlerType: "playwright:chrome",
    }),
  }, 5200);

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as ApifyItem[];
  const first = payload[0];
  if (!first) {
    return null;
  }

  const rawContent = [
    first.markdown,
    first.text,
    first.metadata?.description,
    first.description,
  ]
    .filter(Boolean)
    .join("\n\n");
  const content = first.html
    ? stripHtml([first.html, rawContent].filter(Boolean).join("\n\n"))
    : markdownToPlainText(rawContent);
  if (content.length < 160) {
    return null;
  }

  return {
    id: stableId("apify", source.url),
    title: first.metadata?.title || first.title || source.title,
    url: first.url || source.url,
    content,
    provider: "apify",
    excerpt: clipText(content, 280),
  };
}

async function brightDataSource(source: ResearchSource): Promise<ResearchDocument | null> {
  if (!env.BRIGHTDATA_API_KEY || !env.BRIGHTDATA_ZONE) {
    return null;
  }

  const response = await fetchWithTimeout("https://api.brightdata.com/request", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${env.BRIGHTDATA_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      zone: env.BRIGHTDATA_ZONE,
      url: source.url,
      format: "raw",
      method: "GET",
    }),
  }, 5200);

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const content = stripHtml(html);

  if (content.length < 160) {
    return null;
  }

  return {
    id: stableId("brightdata", source.url),
    title: source.title,
    url: source.url,
    content,
    provider: "brightdata",
    excerpt: clipText(content, 280),
  };
}

export async function extractWebsiteContent(source: ResearchSource) {
  for (const attempt of [
    firecrawlSource,
    jinaReaderSource,
    apifySource,
    brightDataSource,
    scraperApiSource,
  ]) {
    try {
      const result = await attempt(source);
      if (result) {
        return result;
      }
    } catch {
      // Try the next provider.
    }
  }

  return null;
}
