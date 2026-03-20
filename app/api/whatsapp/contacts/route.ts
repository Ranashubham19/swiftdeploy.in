import { NextRequest, NextResponse } from "next/server";

import {
  listWhatsAppContacts,
  updateWhatsAppContactWorkspace,
} from "@/lib/clawcloud-whatsapp-inbox";
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
    const contacts = await listWhatsAppContacts(auth.user.id);
    return NextResponse.json({ contacts });
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
    const body = (await request.json()) as {
      jid?: string | null;
      phoneNumber?: string | null;
      priority?: string | null;
      tags?: string[] | null;
    };

    await updateWhatsAppContactWorkspace(auth.user.id, body);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
