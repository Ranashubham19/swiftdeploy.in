import { NextRequest, NextResponse } from "next/server";

import {
  buildRateLimitErrorResponse,
  resolvePublicHttpUrl,
  takeClawCloudRateLimit,
  withRateLimitHeaders,
} from "@/lib/clawcloud-api-guards";
import { requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { extractWebsiteContent } from "@/lib/crawl";
import { env } from "@/lib/env";
import { stableId } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await takeClawCloudRateLimit("crawl", auth.user.id, {
    limit: env.API_RATE_LIMIT_CRAWL,
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.ok) {
    return buildRateLimitErrorResponse(
      rateLimit,
      "Too many crawl requests. Please wait a minute and try again.",
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { url?: string; title?: string; snippet?: string }
    | null;
  const url = body?.url?.trim();

  if (!url) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "url is required" }, { status: 400 }),
      rateLimit,
    );
  }

  const parsedUrl = await resolvePublicHttpUrl(url, {
    allowedHosts: env.CRAWL_ALLOWED_HOSTS,
  });
  if (!parsedUrl) {
    const policyMessage = env.CRAWL_ALLOWED_HOSTS.length
      ? "only approved public http(s) URLs are allowed by crawl policy"
      : "only public http(s) URLs are allowed";
    return withRateLimitHeaders(
      NextResponse.json({ error: policyMessage }, { status: 400 }),
      rateLimit,
    );
  }

  if ((body?.title?.trim().length ?? 0) > 200) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "title is too long" }, { status: 400 }),
      rateLimit,
    );
  }

  if ((body?.snippet?.trim().length ?? 0) > 1_000) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "snippet is too long" }, { status: 400 }),
      rateLimit,
    );
  }

  const document = await extractWebsiteContent({
    id: stableId("ad-hoc-crawl", parsedUrl.toString()),
    title: body?.title?.trim() || "Untitled source",
    url: parsedUrl.toString(),
    snippet: body?.snippet?.trim() || "",
    provider: "firecrawl",
    domain: parsedUrl.hostname.replace(/^www\./, ""),
    score: 0,
  });

  return withRateLimitHeaders(
    NextResponse.json({
      ok: Boolean(document),
      document,
    }),
    rateLimit,
  );
}
