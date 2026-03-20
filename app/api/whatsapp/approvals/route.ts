import { NextRequest, NextResponse } from "next/server";

import { listWhatsAppReplyApprovals } from "@/lib/clawcloud-whatsapp-approval";
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

  try {
    const approvals = await listWhatsAppReplyApprovals(auth.user.id);
    return NextResponse.json({ approvals });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
