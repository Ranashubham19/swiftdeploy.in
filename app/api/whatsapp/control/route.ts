import { NextRequest, NextResponse } from "next/server";

import {
  getWhatsAppSettings,
  upsertWhatsAppSettings,
} from "@/lib/clawcloud-whatsapp-control";
import { getWhatsAppInboxSummary } from "@/lib/clawcloud-whatsapp-inbox";
import { getClawCloudWhatsAppRuntimeStatus } from "@/lib/clawcloud-whatsapp";
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
    const [settings, summary, runtime] = await Promise.all([
      getWhatsAppSettings(auth.user.id),
      getWhatsAppInboxSummary(auth.user.id),
      getClawCloudWhatsAppRuntimeStatus(auth.user.id).catch(() => null),
    ]);

    return NextResponse.json({ settings, summary, runtime });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const settings = await upsertWhatsAppSettings(auth.user.id, body);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
