import { NextRequest, NextResponse } from "next/server";

import { listConversationThreads, persistConversationThread } from "@/lib/conversations";
import type { ConversationThread } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId");
  const result = await listConversationThreads(userId);

  return NextResponse.json(result, {
    status: result.persistence.synced ? 200 : 503,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as ConversationThread | null;
  if (!body?.id || !body?.title) {
    return NextResponse.json({ error: "thread payload is required" }, { status: 400 });
  }

  const persistence = await persistConversationThread(body);
  return NextResponse.json(
    {
      persistence,
    },
    {
      status: persistence.synced ? 200 : 503,
    },
  );
}
