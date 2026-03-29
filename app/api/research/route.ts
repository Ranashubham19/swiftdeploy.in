import { NextRequest } from "next/server";

import {
  buildRateLimitErrorResponse,
  takeClawCloudRateLimit,
  withRateLimitHeaders,
} from "@/lib/clawcloud-api-guards";
import { runResearchAgent } from "@/lib/research-agent";
import { getUserDisplayName, requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";
import type { ResearchRequestBody } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function writeSseChunk(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  payload: unknown,
) {
  controller.enqueue(
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
  );
}

function splitForStreaming(markdown: string, chunkSize = 42) {
  const normalized = markdown.replace(/\r/g, "");
  if (!normalized.trim()) {
    return [] as string[];
  }

  const words = normalized.split(/(\s+)/).filter(Boolean);
  const chunks: string[] = [];
  let active = "";

  for (const token of words) {
    if ((active + token).length > chunkSize && active) {
      chunks.push(active);
      active = token;
      continue;
    }

    active += token;
  }

  if (active) {
    chunks.push(active);
  }

  return chunks;
}

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const rateLimit = await takeClawCloudRateLimit("research", auth.user.id, {
    limit: env.API_RATE_LIMIT_RESEARCH,
    windowMs: env.API_RATE_LIMIT_WINDOW_MS,
  });
  if (!rateLimit.ok) {
    return buildRateLimitErrorResponse(
      rateLimit,
      "Too many research requests. Please wait a minute and try again.",
    );
  }

  const body = (await request.json().catch(() => null)) as
    | Partial<ResearchRequestBody>
    | null;
  const question = body?.question?.trim();

  if (!question) {
    return withRateLimitHeaders(
      Response.json({ error: "question is required" }, { status: 400 }),
      rateLimit,
    );
  }

  if (question.length > 4_000) {
    return withRateLimitHeaders(
      Response.json({ error: "question is too long" }, { status: 400 }),
      rateLimit,
    );
  }

  if ((body?.history?.length ?? 0) > 12) {
    return withRateLimitHeaders(
      Response.json({ error: "history is too large" }, { status: 400 }),
      rateLimit,
    );
  }

  if ((body?.threadId?.trim().length ?? 0) > 128) {
    return withRateLimitHeaders(
      Response.json({ error: "thread id is invalid" }, { status: 400 }),
      rateLimit,
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      writeSseChunk(controller, encoder, "status", {
        message: "Research run started",
        at: new Date().toISOString(),
      });

      try {
        const result = await runResearchAgent(
          {
            question,
            threadId: body?.threadId,
            history: body?.history ?? [],
            memory: body?.memory ?? null,
            user: {
              uid: auth.user.id,
              email: auth.user.email ?? null,
              displayName: getUserDisplayName(auth.user) || null,
            },
          },
          {
            onProgress: (step) =>
              writeSseChunk(controller, encoder, "progress", step),
            onSources: (sources) =>
              writeSseChunk(controller, encoder, "sources", { sources }),
          },
        );

        for (const delta of splitForStreaming(result.answer.markdown)) {
          writeSseChunk(controller, encoder, "token", { delta });
        }

        writeSseChunk(controller, encoder, "complete", result);
      } catch (error) {
        writeSseChunk(controller, encoder, "error", {
          message:
            error instanceof Error ? error.message : "Research execution failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return withRateLimitHeaders(
    new Response(stream, {
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    }),
    rateLimit,
  );
}
