import { NextRequest, NextResponse } from "next/server";

import { buildClawCloudGoogleAuthUrl } from "@/lib/clawcloud-google";
import { env } from "@/lib/env";
import { getClawCloudErrorMessage } from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function GET(request: NextRequest) {
  const userId = request.nextUrl.searchParams.get("userId")?.trim();
  const redirectBase = new URL("/setup", request.nextUrl.origin);

  if (!env.GOOGLE_WORKSPACE_PUBLIC_ENABLED || env.GOOGLE_WORKSPACE_TEMPORARY_HOLD) {
    redirectBase.searchParams.set(
      "error",
      "Google Workspace is temporarily paused while ClawCloud finishes verification. Continue setup now and connect Google later from the dashboard.",
    );
    return withNoStoreHeaders(NextResponse.redirect(redirectBase));
  }

  if (!userId) {
    return withNoStoreHeaders(
      NextResponse.json({ error: "userId is required" }, { status: 400 }),
    );
  }

  try {
    const url = buildClawCloudGoogleAuthUrl(userId, request.nextUrl.origin);
    return withNoStoreHeaders(NextResponse.redirect(url));
  } catch (error) {
    redirectBase.searchParams.set("error", getClawCloudErrorMessage(error));
    return withNoStoreHeaders(NextResponse.redirect(redirectBase));
  }
}
