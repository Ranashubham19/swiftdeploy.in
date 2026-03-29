import { NextRequest, NextResponse } from "next/server";

import {
  buildClawCloudGoogleLoginAuthUrl,
  buildClawCloudGoogleLoginState,
} from "@/lib/clawcloud-google";
import { isGooglePublicSignInEnabled } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GOOGLE_LOGIN_STATE_COOKIE = "clawcloud-google-login-state";

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function GET(request: NextRequest) {
  const redirectBase = new URL("/auth", request.nextUrl.origin);
  const intent = request.nextUrl.searchParams.get("intent")?.trim().toLowerCase() === "signup"
    ? "signup"
    : "login";

  if (!isGooglePublicSignInEnabled()) {
    redirectBase.searchParams.set(
      "error",
      "Google sign-in is unavailable on this deployment right now.",
    );
    return withNoStoreHeaders(NextResponse.redirect(redirectBase));
  }

  try {
    const state = buildClawCloudGoogleLoginState(request.nextUrl.origin, intent);
    const url = buildClawCloudGoogleLoginAuthUrl(state, request.nextUrl.origin);
    const response = withNoStoreHeaders(NextResponse.redirect(url));

    response.cookies.set(GOOGLE_LOGIN_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 10 * 60,
    });

    return response;
  } catch (error) {
    redirectBase.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Unable to start Google sign-in.",
    );
    return withNoStoreHeaders(NextResponse.redirect(redirectBase));
  }
}
