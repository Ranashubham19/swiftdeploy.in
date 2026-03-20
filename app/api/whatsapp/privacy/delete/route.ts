import { NextRequest, NextResponse } from "next/server";

import { getClawCloudErrorMessage, requireClawCloudAuth } from "@/lib/clawcloud-supabase";
import { deleteWhatsAppWorkspaceData } from "@/lib/clawcloud-whatsapp-governance";
import type { WhatsAppPrivacyDeleteMode } from "@/lib/clawcloud-whatsapp-workspace-types";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as {
      mode?: WhatsAppPrivacyDeleteMode;
      contact?: string | null;
      retentionDays?: number;
      dryRun?: boolean;
    };

    if (body.mode !== "retention" && body.mode !== "contact" && body.mode !== "all") {
      return NextResponse.json({ error: "mode must be retention, contact, or all" }, { status: 400 });
    }

    const result = await deleteWhatsAppWorkspaceData({
      userId: auth.user.id,
      mode: body.mode,
      contact: body.contact,
      retentionDays: body.retentionDays,
      dryRun: body.dryRun,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: getClawCloudErrorMessage(error) }, { status: 500 });
  }
}
