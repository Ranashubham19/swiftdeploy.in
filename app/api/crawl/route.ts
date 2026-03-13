import { NextRequest, NextResponse } from "next/server";

import { extractWebsiteContent } from "@/lib/crawl";
import { stableId } from "@/lib/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { url?: string; title?: string; snippet?: string }
    | null;
  const url = body?.url?.trim();

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const document = await extractWebsiteContent({
    id: stableId("ad-hoc-crawl", url),
    title: body?.title?.trim() || "Untitled source",
    url,
    snippet: body?.snippet?.trim() || "",
    provider: "firecrawl",
    domain: new URL(url).hostname.replace(/^www\./, ""),
    score: 0,
  });

  return NextResponse.json({
    ok: Boolean(document),
    document,
  });
}
