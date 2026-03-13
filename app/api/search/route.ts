import { NextRequest, NextResponse } from "next/server";

import { searchInternet } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | { query?: string; queries?: string[] }
    | null;
  const queries = [
    body?.query?.trim() ?? "",
    ...(body?.queries ?? []).map((query) => query.trim()),
  ].filter(Boolean);

  if (!queries.length) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const results = await searchInternet(queries);

  return NextResponse.json({
    queries,
    count: results.length,
    results,
  });
}
