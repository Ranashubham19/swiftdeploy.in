import { NextRequest, NextResponse } from "next/server";

import {
  env,
  isGoogleWorkspaceOauthConfigured,
  isGooglePublicSignInEnabled,
  isGoogleWorkspaceSetupLiteMode,
} from "@/lib/env";
import {
  getGoogleWorkspaceCoreAccess,
  getGoogleWorkspaceExtendedAccess,
} from "@/lib/google-workspace-rollout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
const SUPABASE_SETTINGS_TIMEOUT_MS = 6_000;

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

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: NextRequest) {
  const workspaceOauthConfigured = isGoogleWorkspaceOauthConfigured();
  const workspaceAccess = getGoogleWorkspaceCoreAccess(null);
  const workspaceExtendedAccess = getGoogleWorkspaceExtendedAccess(null);
  const workspacePublicEnabled = workspaceAccess.available;
  const workspaceExtendedPublicEnabled = workspaceExtendedAccess.available;
  const workspaceReason = !workspaceOauthConfigured
    ? "missing_google_workspace_env"
    : workspaceAccess.reason ?? "ok";
  const workspaceExtendedReason = !workspaceOauthConfigured
    ? "missing_google_workspace_env"
    : workspaceExtendedAccess.reason ?? "ok";

  if (!isGooglePublicSignInEnabled()) {
    return withNoStoreHeaders(
      NextResponse.json({
        ok: false,
        reason: "public_google_signin_unavailable",
        loginFlow: "custom_google_login",
        workspace: {
          ok: workspacePublicEnabled,
          setupLiteMode: isGoogleWorkspaceSetupLiteMode(),
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
            setupLiteMode: isGoogleWorkspaceSetupLiteMode(),
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
            setupLiteMode: isGoogleWorkspaceSetupLiteMode(),
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
    const response = await fetchWithTimeout(settingsUrl, {
      method: "GET",
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      },
      cache: "no-store",
    }, SUPABASE_SETTINGS_TIMEOUT_MS);
    return withNoStoreHeaders(
      NextResponse.json({
        ok: true,
        reason: response.ok ? "ok" : "custom_google_login_ready",
        loginFlow: "custom_google_login",
        origin: normalizeOrigin(request.nextUrl.origin),
        expectedClientId: env.GOOGLE_CLIENT_ID,
        expectedRedirectUri: getExpectedLoginRedirectUri(request.nextUrl.origin),
        supabaseGoogleEnabled: null,
        supabaseSettingsProbeOk: response.ok,
        ...(response.ok
          ? {}
          : {
            warning:
              "Supabase settings probe was unavailable, but the custom Google sign-in flow is still configured.",
          }),
        workspace: {
          ok: workspacePublicEnabled,
          setupLiteMode: isGoogleWorkspaceSetupLiteMode(),
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
      NextResponse.json({
        ok: true,
        reason: "custom_google_login_ready",
        loginFlow: "custom_google_login",
        error: error instanceof Error ? error.message : "Unable to inspect provider health.",
        warning:
          "Supabase settings probe failed, but the custom Google sign-in flow is still configured.",
        supabaseSettingsProbeOk: false,
        workspace: {
          ok: workspacePublicEnabled,
          setupLiteMode: isGoogleWorkspaceSetupLiteMode(),
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
}
