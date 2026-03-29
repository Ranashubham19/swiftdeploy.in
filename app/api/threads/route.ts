import { NextRequest, NextResponse } from "next/server";

import {
  buildRateLimitErrorResponse,
  takeClawCloudRateLimit,
  withRateLimitHeaders,
} from "@/lib/clawcloud-api-guards";
import { listConversationThreads, persistConversationThread } from "@/lib/conversations";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";
import type { ConversationThread } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function validateThreadPayload(thread: ConversationThread) {
  if (thread.title.trim().length > 160) {
    return "thread title is too long";
  }

  if (thread.messages.length > 100) {
    return "thread has too many messages";
  }

  if (thread.progress.length > 100) {
    return "thread has too many progress items";
  }

  if (thread.sources.length > 24) {
    return "thread has too many sources";
  }

  const oversizedMessage = thread.messages.find(
    (message) => String(message.content ?? "").length > 12_000,
  );
  if (oversizedMessage) {
    return "thread contains an oversized message";
  }

  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await takeClawCloudRateLimit("threads:read", auth.user.id, {
    limit: env.API_RATE_LIMIT_THREADS_READ,
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.ok) {
    return buildRateLimitErrorResponse(
      rateLimit,
      "Too many thread sync requests. Please wait a moment and try again.",
    );
  }

  try {
    const result = await listConversationThreads(auth.user.id);

    return withRateLimitHeaders(
      NextResponse.json(result, {
        status: result.persistence.synced ? 200 : 503,
      }),
      rateLimit,
    );
  } catch (error) {
    return withRateLimitHeaders(
      NextResponse.json(
        { error: getClawCloudErrorMessage(error) },
        { status: 500 },
      ),
      rateLimit,
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await takeClawCloudRateLimit("threads:write", auth.user.id, {
    limit: env.API_RATE_LIMIT_THREADS_WRITE,
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.ok) {
    return buildRateLimitErrorResponse(
      rateLimit,
      "Too many thread save requests. Please wait a moment and try again.",
    );
  }

  const body = (await request.json().catch(() => null)) as ConversationThread | null;
  if (!body?.id || !body?.title) {
    return withRateLimitHeaders(
      NextResponse.json({ error: "thread payload is required" }, { status: 400 }),
      rateLimit,
    );
  }

  const payloadError = validateThreadPayload(body);
  if (payloadError) {
    return withRateLimitHeaders(
      NextResponse.json({ error: payloadError }, { status: 400 }),
      rateLimit,
    );
  }

  try {
    const persistence = await persistConversationThread(auth.user.id, body);
    return withRateLimitHeaders(
      NextResponse.json(
        {
          persistence,
        },
        {
          status: persistence.synced ? 200 : 503,
        },
      ),
      rateLimit,
    );
  } catch (error) {
    return withRateLimitHeaders(
      NextResponse.json(
        { error: getClawCloudErrorMessage(error) },
        { status: 500 },
      ),
      rateLimit,
    );
  }
}
