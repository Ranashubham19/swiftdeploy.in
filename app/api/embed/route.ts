import { NextRequest, NextResponse } from "next/server";

import { embedTexts } from "@/lib/embeddings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { texts?: string[]; inputType?: "query" | "passage" }
    | null;
  const texts = (body?.texts ?? []).map((text) => text.trim()).filter(Boolean);

  if (!texts.length) {
    return NextResponse.json({ error: "texts are required" }, { status: 400 });
  }

  const embeddings = await embedTexts(texts, body?.inputType ?? "passage");

  return NextResponse.json({
    count: embeddings.length,
    dimensions: embeddings[0]?.length ?? 0,
    embeddings,
  });
}
