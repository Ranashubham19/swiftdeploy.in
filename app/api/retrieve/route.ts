import { NextRequest, NextResponse } from "next/server";

import {
  buildRateLimitErrorResponse,
  takeClawCloudRateLimit,
  withRateLimitHeaders,
} from "@/lib/clawcloud-api-guards";
import { requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { embedTexts } from "@/lib/embeddings";
import { env } from "@/lib/env";
import { retrieveResearchContext } from "@/lib/vector-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await takeClawCloudRateLimit("retrieve", auth.user.id, {
    limit: env.API_RATE_LIMIT_RETRIEVE,
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.ok) {
    return buildRateLimitErrorResponse(
      rateLimit,
      "Too many retrieval requests. Please wait a moment and try again.",
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { question?: string; limit?: number }
    | null;
  const question = body?.question?.trim();

  if (!question) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "question is required" }, { status: 400 }),
      rateLimit,
    );
  }

  if (question.length > 4_000) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "question is too long" }, { status: 400 }),
      rateLimit,
    );
  }

  const [queryVector] = await embedTexts([question], "query");
  const context = await retrieveResearchContext(
    queryVector,
    Math.min(Math.max(body?.limit ?? env.RESEARCH_RETRIEVE_LIMIT, 1), 12),
  );

  return withRateLimitHeaders(
    NextResponse.json({
      question,
      count: context.length,
      context,
    }),
    rateLimit,
  );
}
