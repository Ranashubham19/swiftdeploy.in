import { NextRequest, NextResponse } from "next/server";

import { getClawCloudErrorMessage, requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { listWhatsAppAuditLog } from "@/lib/clawcloud-whatsapp-governance";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "120");

  try {
    const audit = await listWhatsAppAuditLog(auth.user.id, limit);
    return NextResponse.json({ audit });
  } catch (error) {
    return NextResponse.json({ error: getClawCloudErrorMessage(error) }, { status: 500 });
  }
}
