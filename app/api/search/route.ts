import { NextRequest, NextResponse } from "next/server";

import {
  buildRateLimitErrorResponse,
  takeClawCloudRateLimit,
  withRateLimitHeaders,
} from "@/lib/clawcloud-api-guards";
import { searchInternet } from "@/lib/search";
import { requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await takeClawCloudRateLimit("search", auth.user.id, {
    limit: env.API_RATE_LIMIT_SEARCH,
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.ok) {
    return buildRateLimitErrorResponse(
      rateLimit,
      "Too many search requests. Please wait a moment and try again.",
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { query?: string; queries?: string[] }
    | null;
  const queries = [
    body?.query?.trim() ?? "",
    ...(body?.queries ?? []).map((query) => query.trim()),
  ].filter(Boolean);

  if (!queries.length) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "query is required" }, { status: 400 }),
      rateLimit,
    );
  }

  if (queries.length > env.RESEARCH_MAX_SEARCH_QUERIES) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "too many queries requested" }, { status: 400 }),
      rateLimit,
    );
  }

  if (queries.some((query) => query.length > 300)) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "query is too long" }, { status: 400 }),
      rateLimit,
    );
  }

  const results = await searchInternet(queries);

  return withRateLimitHeaders(
    NextResponse.json({
      queries,
      count: results.length,
      results,
    }),
    rateLimit,
  );
}
