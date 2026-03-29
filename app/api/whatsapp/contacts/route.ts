import { NextRequest, NextResponse } from "next/server";

import {
  listWhatsAppContacts,
  updateWhatsAppContactWorkspace,
} from "@/lib/clawcloud-whatsapp-inbox";
import {
  ensureClawCloudWhatsAppWorkspaceReady,
  refreshClawCloudWhatsAppContacts,
} from "@/lib/clawcloud-whatsapp";
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
    let contacts = await listWhatsAppContacts(auth.user.id);
    const bootstrap = await ensureClawCloudWhatsAppWorkspaceReady(auth.user.id).catch(() => null);
    if (bootstrap?.refreshed) {
      contacts = await listWhatsAppContacts(auth.user.id);
    }

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

export async function POST(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const refreshed = await refreshClawCloudWhatsAppContacts(auth.user.id);
    const contacts = await listWhatsAppContacts(auth.user.id);
    return NextResponse.json({
      success: true,
      refreshedCount: refreshed.contactCount,
      previousCount: refreshed.previousCount ?? 0,
      persistedCount: refreshed.persistedCount ?? 0,
      contacts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
