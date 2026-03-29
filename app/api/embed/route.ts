import { NextRequest, NextResponse } from "next/server";

import {
  buildRateLimitErrorResponse,
  takeClawCloudRateLimit,
  withRateLimitHeaders,
} from "@/lib/clawcloud-api-guards";
import { requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { embedTexts } from "@/lib/embeddings";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await takeClawCloudRateLimit("embed", auth.user.id, {
    limit: env.API_RATE_LIMIT_EMBED,
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.ok) {
    return buildRateLimitErrorResponse(
      rateLimit,
      "Too many embedding requests. Please wait a moment and try again.",
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { texts?: string[]; inputType?: "query" | "passage" }
    | null;
  const texts = (body?.texts ?? []).map((text) => text.trim()).filter(Boolean);

  if (!texts.length) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "texts are required" }, { status: 400 }),
      rateLimit,
    );
  }

  if (texts.length > 10) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "too many texts requested" }, { status: 400 }),
      rateLimit,
    );
  }

  if (texts.some((text) => text.length > 4_000)) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "text input is too long" }, { status: 400 }),
      rateLimit,
    );
  }

  const totalCharacters = texts.reduce((sum, text) => sum + text.length, 0);
  if (totalCharacters > 20_000) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "embedding payload is too large" }, { status: 400 }),
      rateLimit,
    );
  }

  const embeddings = await embedTexts(texts, body?.inputType ?? "passage");

  return withRateLimitHeaders(
    NextResponse.json({
      count: embeddings.length,
      dimensions: embeddings[0]?.length ?? 0,
      embeddings,
    }),
    rateLimit,
  );
}
