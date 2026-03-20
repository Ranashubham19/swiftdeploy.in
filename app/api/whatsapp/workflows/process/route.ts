import { NextRequest, NextResponse } from "next/server";

import { getClawCloudErrorMessage, requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { processDueWhatsAppWorkflowRuns } from "@/lib/clawcloud-whatsapp-workflows";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const processed = await processDueWhatsAppWorkflowRuns({ userId: auth.user.id, limit: 40 });
    return NextResponse.json({ processed });
  } catch (error) {
    return NextResponse.json({ error: getClawCloudErrorMessage(error) }, { status: 500 });
  }
}
