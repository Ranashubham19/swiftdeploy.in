import { NextRequest, NextResponse } from "next/server";

import { listWhatsAppHistory } from "@/lib/clawcloud-whatsapp-inbox";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const params = request.nextUrl.searchParams;
  const query = params.get("q");
  const contact = params.get("contact");
  const limit = Number(params.get("limit") ?? "120");
  const chatType = params.get("chatType");
  const approvalState = params.get("approvalState");
  const sensitivity = params.get("sensitivity");
  const direction = params.get("direction");
  const mediaOnly = params.get("mediaOnly") === "true";
  const awaitingOnly = params.get("awaitingOnly") === "true";

  try {
    const snapshot = await listWhatsAppHistory({
      userId: auth.user.id,
      query,
      contact,
      limit,
      chatType,
      approvalState,
      sensitivity,
      direction,
      mediaOnly,
      awaitingOnly,
    });
    return NextResponse.json({
      history: snapshot.rows,
      insights: snapshot.insights,
      groupThreads: snapshot.groupThreads,
      mediaSummary: snapshot.mediaSummary,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
