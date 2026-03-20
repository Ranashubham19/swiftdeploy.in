import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function normalizeOrigin(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function getExpectedLoginRedirectUri(origin: string) {
  return `${normalizeOrigin(origin)}/api/auth/google/callback`;
}

export async function GET(request: NextRequest) {
  const workspaceOauthConfigured = Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.NEXT_PUBLIC_APP_URL,
  );
  const workspacePublicEnabled = Boolean(
    env.GOOGLE_WORKSPACE_PUBLIC_ENABLED && !env.GOOGLE_WORKSPACE_TEMPORARY_HOLD,
  );
  const workspaceExtendedPublicEnabled = Boolean(
    env.GOOGLE_WORKSPACE_PUBLIC_ENABLED
    && env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED
    && !env.GOOGLE_WORKSPACE_TEMPORARY_HOLD,
  );
  const workspaceReason = !workspaceOauthConfigured
    ? "missing_google_workspace_env"
    : env.GOOGLE_WORKSPACE_TEMPORARY_HOLD
      ? "google_workspace_rollout_hold"
      : !env.GOOGLE_WORKSPACE_PUBLIC_ENABLED
        ? "google_workspace_public_disabled"
        : "ok";
  const workspaceExtendedReason = !workspaceOauthConfigured
    ? "missing_google_workspace_env"
    : env.GOOGLE_WORKSPACE_TEMPORARY_HOLD
      ? "google_workspace_rollout_hold"
      : !env.GOOGLE_WORKSPACE_PUBLIC_ENABLED
        ? "google_workspace_public_disabled"
        : !env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED
          ? "google_workspace_extended_public_disabled"
          : "ok";

  if (!env.GOOGLE_SIGNIN_PUBLIC_ENABLED) {
    return withNoStoreHeaders(
      NextResponse.json({
        ok: false,
        reason: "public_google_signin_disabled",
        loginFlow: "custom_google_login",
        workspace: {
          ok: workspacePublicEnabled,
          reason: workspaceReason,
          expectedRedirectUri: getExpectedLoginRedirectUri(request.nextUrl.origin),
          extended: {
            ok: workspaceExtendedPublicEnabled,
            reason: workspaceExtendedReason,
          },
        },
      }),
    );
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return withNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          reason: "missing_google_login_env",
          loginFlow: "custom_google_login",
          expectedClientId: env.GOOGLE_CLIENT_ID,
          workspace: {
            ok: workspacePublicEnabled,
            reason: workspaceReason,
            expectedRedirectUri: getExpectedLoginRedirectUri(request.nextUrl.origin),
            extended: {
              ok: workspaceExtendedPublicEnabled,
              reason: workspaceExtendedReason,
            },
          },
        },
        { status: 500 },
      ),
    );
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return withNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          reason: "missing_supabase_env",
          loginFlow: "custom_google_login",
          workspace: {
            ok: workspacePublicEnabled,
            reason: workspaceReason,
            expectedRedirectUri: getExpectedLoginRedirectUri(request.nextUrl.origin),
            extended: {
              ok: workspaceExtendedPublicEnabled,
              reason: workspaceExtendedReason,
            },
          },
        },
        { status: 500 },
      ),
    );
  }

  const settingsUrl = `${env.SUPABASE_URL}/auth/v1/settings`;

  try {
    const response = await fetch(settingsUrl, {
      method: "GET",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      cache: "no-store",
    });
    return withNoStoreHeaders(
      NextResponse.json({
        ok: response.ok,
        reason: response.ok ? "ok" : "supabase_settings_unavailable",
        loginFlow: "custom_google_login",
        origin: normalizeOrigin(request.nextUrl.origin),
        expectedClientId: env.GOOGLE_CLIENT_ID,
        expectedRedirectUri: getExpectedLoginRedirectUri(request.nextUrl.origin),
        supabaseGoogleEnabled: null,
        workspace: {
          ok: workspacePublicEnabled,
          reason: workspaceReason,
          expectedRedirectUri: getExpectedLoginRedirectUri(request.nextUrl.origin),
          extended: {
            ok: workspaceExtendedPublicEnabled,
            reason: workspaceExtendedReason,
          },
        },
      }),
    );
  } catch (error) {
    return withNoStoreHeaders(
      NextResponse.json(
        {
          ok: false,
          reason: "provider_check_failed",
          loginFlow: "custom_google_login",
          error: error instanceof Error ? error.message : "Unable to inspect provider health.",
          workspace: {
            ok: workspacePublicEnabled,
            reason: workspaceReason,
            expectedRedirectUri: getExpectedLoginRedirectUri(request.nextUrl.origin),
            extended: {
              ok: workspaceExtendedPublicEnabled,
              reason: workspaceExtendedReason,
            },
          },
        },
        { status: 500 },
      ),
    );
  }
}
