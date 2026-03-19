import { NextRequest, NextResponse } from "next/server";

import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { disconnectClawCloudWhatsApp } from "@/lib/clawcloud-whatsapp";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ provider: string }>;
};

async function deactivateProviders(userId: string, providers: string[]) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("connected_accounts")
    .update({
      is_active: false,
      access_token: null,
      refresh_token: null,
      token_expiry: null,
    })
    .eq("user_id", userId)
    .in("provider", providers);

  if (error) {
    throw new Error(error.message);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const { provider } = await context.params;

    if (provider === "google") {
      await deactivateProviders(auth.user.id, ["gmail", "google_calendar", "google_drive"]);
      return NextResponse.json({ success: true });
    }

    if (provider === "whatsapp") {
      await disconnectClawCloudWhatsApp(auth.user.id).catch(() => null);
      await deactivateProviders(auth.user.id, ["whatsapp"]);
      return NextResponse.json({ success: true });
    }

    if (provider === "telegram") {
      await deactivateProviders(auth.user.id, ["telegram"]);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unsupported provider." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: getClawCloudErrorMessage(error) },
      { status: 500 },
    );
  }
}
