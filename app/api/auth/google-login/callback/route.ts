import { NextRequest, NextResponse } from "next/server";

import { exchangeClawCloudGoogleLoginCode } from "@/lib/clawcloud-google";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GOOGLE_LOGIN_STATE_COOKIE = "clawcloud-google-login-state";
const GOOGLE_LOGIN_SESSION_COOKIE = "clawcloud-google-login-session";

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim();
  const state = request.nextUrl.searchParams.get("state")?.trim();
  const providerError = request.nextUrl.searchParams.get("error");
  const redirectBase = new URL("/auth", request.nextUrl.origin);

  const expectedState = request.cookies.get(GOOGLE_LOGIN_STATE_COOKIE)?.value?.trim() ?? "";

  if (providerError) {
    redirectBase.searchParams.set("error", providerError);
    const response = withNoStoreHeaders(NextResponse.redirect(redirectBase));
    response.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
    return response;
  }

  if (!code || !state || !expectedState || state !== expectedState) {
    redirectBase.searchParams.set("error", "invalid_google_login_state");
    const response = withNoStoreHeaders(NextResponse.redirect(redirectBase));
    response.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
    return response;
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    redirectBase.searchParams.set("error", "missing_supabase_env");
    const response = withNoStoreHeaders(NextResponse.redirect(redirectBase));
    response.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
    return response;
  }

  try {
    const exchanged = await exchangeClawCloudGoogleLoginCode(code, request.nextUrl.origin);
    const response = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=id_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        provider: "google",
        id_token: exchanged.idToken,
        access_token: exchanged.accessToken,
      }),
    });

    const json = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
      error_description?: string;
      msg?: string;
    };

    if (!response.ok || !json.access_token || !json.refresh_token) {
      throw new Error(json.error_description || json.error || json.msg || "Supabase Google sign-in failed.");
    }

    const bridgePayload = Buffer.from(
      JSON.stringify({
        access_token: json.access_token,
        refresh_token: json.refresh_token,
      }),
      "utf-8",
    ).toString("base64url");

    redirectBase.searchParams.set("google_bridge", "1");

    const redirectResponse = withNoStoreHeaders(NextResponse.redirect(redirectBase));
    redirectResponse.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
    redirectResponse.cookies.set(GOOGLE_LOGIN_SESSION_COOKIE, bridgePayload, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: 60,
    });
    return redirectResponse;
  } catch (error) {
    redirectBase.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Unable to finish Google sign-in.",
    );
    const response = withNoStoreHeaders(NextResponse.redirect(redirectBase));
    response.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
    response.cookies.delete(GOOGLE_LOGIN_SESSION_COOKIE);
    return response;
  }
}
