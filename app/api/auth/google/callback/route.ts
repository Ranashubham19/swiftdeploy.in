import { NextRequest, NextResponse } from "next/server";

import {
  exchangeClawCloudGoogleCode,
  fetchClawCloudGoogleProfile,
} from "@/lib/clawcloud-google";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim();
  const userId = request.nextUrl.searchParams.get("state")?.trim();
  const providerError = request.nextUrl.searchParams.get("error");

  const redirectBase = new URL("/setup", request.nextUrl.origin);

  if (providerError) {
    redirectBase.searchParams.set("error", "google_denied");
    return NextResponse.redirect(redirectBase);
  }

  if (!code || !userId) {
    return NextResponse.json(
      { error: "Missing Google OAuth code or user id." },
      { status: 400 },
    );
  }

  try {
    const exchanged = await exchangeClawCloudGoogleCode(code);
    const profile = await fetchClawCloudGoogleProfile(exchanged.accessToken);
    const tokenExpiry = new Date(Date.now() + exchanged.expiresIn * 1000).toISOString();

    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const sharedRow = {
      user_id: userId,
      access_token: exchanged.accessToken,
      refresh_token: exchanged.refreshToken,
      token_expiry: tokenExpiry,
      account_email: profile.email,
      display_name: profile.name,
      is_active: true,
      connected_at: new Date().toISOString(),
    };

    const { error: gmailError } = await supabaseAdmin
      .from("connected_accounts")
      .upsert(
        {
          ...sharedRow,
          provider: "gmail",
        },
        { onConflict: "user_id,provider" },
      );

    if (gmailError) {
      throw new Error(gmailError.message);
    }

    const { error: calendarError } = await supabaseAdmin
      .from("connected_accounts")
      .upsert(
        {
          ...sharedRow,
          provider: "google_calendar",
        },
        { onConflict: "user_id,provider" },
      );

    if (calendarError) {
      throw new Error(calendarError.message);
    }

    redirectBase.searchParams.set("step", "2");
    redirectBase.searchParams.set("gmail", "connected");
    return NextResponse.redirect(redirectBase);
  } catch (error) {
    redirectBase.searchParams.set("error", getClawCloudErrorMessage(error));
    return NextResponse.redirect(redirectBase);
  }
}
