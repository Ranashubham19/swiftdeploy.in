import { NextRequest, NextResponse } from "next/server";

import { sendLatestGmailRepliesOnCommand } from "@/lib/clawcloud-gmail-actions";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const result = await sendLatestGmailRepliesOnCommand(auth.user.id, 5);
    return NextResponse.json({
      success: true,
      queued: result.sent,
      sent: result.sent,
      reply: result.reply,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
