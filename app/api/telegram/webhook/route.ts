import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";
import { handleTelegramUpdate } from "@/lib/clawcloud-telegram";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secretHeader = request.headers.get("x-telegram-bot-api-secret-token");
  if (env.TELEGRAM_WEBHOOK_SECRET && secretHeader !== env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    await handleTelegramUpdate(body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[telegram/webhook]", error);
    return NextResponse.json({ ok: true });
  }
}
