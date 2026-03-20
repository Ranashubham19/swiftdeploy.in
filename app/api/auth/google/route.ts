import { NextRequest, NextResponse } from "next/server";

import { buildClawCloudGoogleAuthUrl } from "@/lib/clawcloud-google";
import {
  getGoogleWorkspaceCoreAccess,
  getGoogleWorkspaceExtendedAccess,
} from "@/lib/google-workspace-rollout";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
} from "@/lib/clawcloud-supabase";

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
  const requestedScopeSet = request.nextUrl.searchParams.get("scopeSet")?.trim().toLowerCase();
  const scopeSet = requestedScopeSet === "extended" ? "extended" : "core";
  const redirectBase = new URL(scopeSet === "extended" ? "/settings" : "/setup", request.nextUrl.origin);
  if (scopeSet === "extended") {
    redirectBase.searchParams.set("tab", "integrations");
  }

  if (!userId) {
    return withNoStoreHeaders(
      NextResponse.json({ error: "userId is required" }, { status: 400 }),
    );
  }

  try {
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const userResult = await supabaseAdmin.auth.admin.getUserById(userId);
    const userEmail = userResult?.data?.user?.email ?? null;
    const coreAccess = getGoogleWorkspaceCoreAccess(userEmail);
    const extendedAccess = getGoogleWorkspaceExtendedAccess(userEmail);

    if (scopeSet === "core" && !coreAccess.available) {
      redirectBase.searchParams.set("error", coreAccess.reason);
      return withNoStoreHeaders(NextResponse.redirect(redirectBase));
    }

    if (scopeSet === "extended" && !extendedAccess.available) {
      redirectBase.searchParams.set("error", extendedAccess.reason);
      return withNoStoreHeaders(NextResponse.redirect(redirectBase));
    }

    const url = buildClawCloudGoogleAuthUrl(userId, request.nextUrl.origin, scopeSet);
    return withNoStoreHeaders(NextResponse.redirect(url));
  } catch (error) {
    redirectBase.searchParams.set("error", getClawCloudErrorMessage(error));
    return withNoStoreHeaders(NextResponse.redirect(redirectBase));
  }
}
