import { NextRequest } from "next/server";

import { runResearchAgent } from "@/lib/research-agent";
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
  const body = (await request.json().catch(() => null)) as
    | Partial<ResearchRequestBody>
    | null;
  const question = body?.question?.trim();

  if (!question) {
    return Response.json({ error: "question is required" }, { status: 400 });
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
            user: body?.user ?? null,
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

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
