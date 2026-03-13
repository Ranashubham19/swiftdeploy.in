import { NextRequest, NextResponse } from "next/server";

import { embedTexts } from "@/lib/embeddings";
import { env } from "@/lib/env";
import { retrieveResearchContext } from "@/lib/vector-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { question?: string; limit?: number }
    | null;
  const question = body?.question?.trim();

  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const [queryVector] = await embedTexts([question], "query");
  const context = await retrieveResearchContext(
    queryVector,
    Math.min(Math.max(body?.limit ?? env.RESEARCH_RETRIEVE_LIMIT, 1), 12),
  );

  return NextResponse.json({
    question,
    count: context.length,
    context,
  });
}
