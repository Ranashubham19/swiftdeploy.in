import { NextRequest, NextResponse } from "next/server";

import {
  getClawCloudErrorMessage,
  isValidSharedSecret,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";
import { sendClawCloudWhatsAppToPhone } from "@/lib/clawcloud-whatsapp";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      phone?: string;
      message?: string;
      _internal?: boolean;
    };

    if (!body.phone || !body.message) {
      return NextResponse.json(
        { error: "phone and message are required" },
        { status: 400 },
      );
    }

    if (body._internal) {
      if (!isValidSharedSecret(request, env.AGENT_SECRET, env.CRON_SECRET)) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      const auth = await requireClawCloudAuth(request);
      if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
      }
    }

    await sendClawCloudWhatsAppToPhone(body.phone, body.message);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
