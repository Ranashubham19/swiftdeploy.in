import { NextRequest, NextResponse } from "next/server";

import {
  exchangeClawCloudGoogleCode,
  exchangeClawCloudGoogleLoginCode,
  fetchClawCloudGoogleProfile,
  parseClawCloudGoogleWorkspaceState,
} from "@/lib/clawcloud-google";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
} from "@/lib/clawcloud-supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GOOGLE_LOGIN_STATE_COOKIE = "clawcloud-google-login-state";
const GOOGLE_LOGIN_SESSION_COOKIE = "clawcloud-google-login-session";

function isExistingUserError(message: string) {
  return /already (exists|been registered|registered)|duplicate|unique/i.test(message);
}

function buildWorkspaceRedirectBase(origin: string, scopeSet: "core" | "extended") {
  const redirectBase = new URL(scopeSet === "extended" ? "/settings" : "/setup", origin);
  if (scopeSet === "extended") {
    redirectBase.searchParams.set("tab", "integrations");
  }
  return redirectBase;
}

function describeGoogleWorkspaceSaveError(error: { message?: string | null; code?: string | null }) {
  const message = String(error.message ?? "").trim();
  const code = String(error.code ?? "").trim();
  if (
    code === "23514"
    || /connected_accounts_provider_check/i.test(message)
    || /violates check constraint/i.test(message)
  ) {
    return "Google Drive permission was granted, but the production database schema still rejects google_drive connections. Apply the latest connected_accounts provider migration and retry.";
  }

  return message || "Unable to save the Google Workspace connection.";
}

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

  const fallbackScopeSet = state?.startsWith("workspace:extended:") ? "extended" : "core";
  const redirectBase = buildWorkspaceRedirectBase(request.nextUrl.origin, fallbackScopeSet);
  const loginRedirectBase = new URL("/auth", request.nextUrl.origin);
  const expectedLoginState = request.cookies.get(GOOGLE_LOGIN_STATE_COOKIE)?.value?.trim() ?? "";

  if (state?.startsWith("login:")) {
    if (providerError) {
      loginRedirectBase.searchParams.set("error", providerError);
      const response = withNoStoreHeaders(NextResponse.redirect(loginRedirectBase));
      response.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
      return response;
    }

    if (!code || !state || !expectedLoginState || state !== expectedLoginState) {
      loginRedirectBase.searchParams.set("error", "invalid_google_login_state");
      const response = withNoStoreHeaders(NextResponse.redirect(loginRedirectBase));
      response.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
      return response;
    }

    try {
      const exchanged = await exchangeClawCloudGoogleLoginCode(code, request.nextUrl.origin);
      const profile = await fetchClawCloudGoogleProfile(exchanged.accessToken);
      const supabaseAdmin = getClawCloudSupabaseAdmin();
      const normalizedEmail = profile.email.trim().toLowerCase();

      const created = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: {
          name: profile.name,
          full_name: profile.name,
          auth_provider: "google",
        },
        app_metadata: {
          provider: "google",
          providers: ["google"],
        },
      });

      if (created.error && !isExistingUserError(created.error.message)) {
        throw new Error(created.error.message);
      }

      const linkResponse = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: normalizedEmail,
      });

      if (linkResponse.error || !linkResponse.data.properties?.hashed_token) {
        throw new Error(linkResponse.error?.message || "Unable to generate the Google sign-in session.");
      }

      const bridgePayload = Buffer.from(
        JSON.stringify({
          token_hash: linkResponse.data.properties.hashed_token,
          type: "magiclink",
        }),
        "utf-8",
      ).toString("base64url");

      loginRedirectBase.searchParams.set("google_bridge", "1");

      const redirectResponse = withNoStoreHeaders(NextResponse.redirect(loginRedirectBase));
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
      loginRedirectBase.searchParams.set(
        "error",
        error instanceof Error ? error.message : "Unable to finish Google sign-in.",
      );
      const response = withNoStoreHeaders(NextResponse.redirect(loginRedirectBase));
      response.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
      response.cookies.delete(GOOGLE_LOGIN_SESSION_COOKIE);
      return response;
    }
  }

  if (providerError) {
    redirectBase.searchParams.set("error", "google_denied");
    return withNoStoreHeaders(NextResponse.redirect(redirectBase));
  }

  if (!code || !state) {
    return withNoStoreHeaders(
      NextResponse.json(
        { error: "Missing Google OAuth code or user id." },
        { status: 400 },
      ),
    );
  }

  try {
    const workspaceState = parseClawCloudGoogleWorkspaceState(state);
    const workspaceRedirectBase = buildWorkspaceRedirectBase(request.nextUrl.origin, workspaceState.scopeSet);
    const userId = workspaceState.userId;
    const exchanged = await exchangeClawCloudGoogleCode(code, request.nextUrl.origin);
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

    if (workspaceState.scopeSet === "extended") {
      const { error } = await supabaseAdmin
        .from("connected_accounts")
        .upsert(
          {
            ...sharedRow,
            provider: "google_drive",
          },
          { onConflict: "user_id,provider" },
        );

      if (error) {
        throw new Error(describeGoogleWorkspaceSaveError(error));
      }
    }

    if (workspaceState.scopeSet === "extended") {
      workspaceRedirectBase.searchParams.set("drive", "connected");
      return withNoStoreHeaders(NextResponse.redirect(workspaceRedirectBase));
    }

    workspaceRedirectBase.searchParams.set("step", "2");
    workspaceRedirectBase.searchParams.set("gmail", "connected");
    return withNoStoreHeaders(NextResponse.redirect(workspaceRedirectBase));
  } catch (error) {
    redirectBase.searchParams.set("error", getClawCloudErrorMessage(error));
    return withNoStoreHeaders(NextResponse.redirect(redirectBase));
  }
}
