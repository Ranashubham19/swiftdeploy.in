import { NextRequest, NextResponse } from "next/server";

import { getClawCloudErrorMessage, requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { exportWhatsAppWorkspaceData } from "@/lib/clawcloud-whatsapp-governance";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const bundle = await exportWhatsAppWorkspaceData(auth.user.id);
    return NextResponse.json(bundle);
  } catch (error) {
    return NextResponse.json({ error: getClawCloudErrorMessage(error) }, { status: 500 });
  }
}
