import { NextRequest, NextResponse } from "next/server";

import {
  buildClawCloudGoogleAuthUrl,
  buildClawCloudGoogleWorkspaceState,
  normalizeGoogleWorkspaceScopeSet,
  type GoogleWorkspaceScopeSet,
} from "@/lib/clawcloud-google";
import { upsertGlobalLiteConnection } from "@/lib/clawcloud-global-lite";
import {
  getGoogleWorkspaceCoreAccess,
  getGoogleWorkspaceExtendedAccess,
} from "@/lib/google-workspace-rollout";
import {
  getClawCloudErrorMessage,
  requireClawCloudAuth,
} from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GOOGLE_WORKSPACE_SESSION_COOKIE = "clawcloud-google-workspace-session";

type GoogleWorkspaceSessionCookie = {
  nonce: string;
  userId: string;
  scopeSet: GoogleWorkspaceScopeSet;
  flow: "default" | "setup_step1" | "setup_unified";
  expectedEmail: string | null;
  sourceProvider: "gmail" | "google_calendar" | "google_drive" | null;
  issuedAt: string;
};

function encodeWorkspaceSessionCookie(payload: GoogleWorkspaceSessionCookie) {
  return Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
}

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

async function buildSetupLiteRedirectUrl(
  request: NextRequest,
  userId: string,
  userEmail: string | null | undefined,
  flow: "default" | "setup_step1" | "setup_unified",
  sourceProvider: "gmail" | "google_calendar" | "google_drive" | null,
) {
  const redirectUrl = new URL("/setup", request.nextUrl.origin);
  redirectUrl.searchParams.set("global_connect", "bootstrap");

  const normalizedEmail = String(userEmail ?? "").trim().toLowerCase();
  if (normalizedEmail) {
    try {
      await upsertGlobalLiteConnection(userId, {
        provider: "gmail",
        email: normalizedEmail,
      });
      redirectUrl.searchParams.set("gmail_lite", "connected");
    } catch {
      // Keep setup usable even if Gmail Lite cannot be pre-created yet.
    }
  }

  try {
    await upsertGlobalLiteConnection(userId, {
      provider: "google_drive",
      label: "My ClawCloud document vault",
    });
    redirectUrl.searchParams.set("drive_lite", "connected");
  } catch {
    // Keep setup usable even if Drive Lite cannot be pre-created yet.
  }

  if (flow === "setup_unified") {
    redirectUrl.searchParams.set("step", "2");
  }

  if (sourceProvider === "google_calendar") {
    redirectUrl.searchParams.set(
      "error",
      "Calendar Lite uses a private ICS link during setup. Add it on the setup page instead of Google OAuth.",
    );
  }

  return redirectUrl.toString();
}

async function buildSafeWorkspaceFallbackUrl(
  request: NextRequest,
  userId: string,
  userEmail: string | null | undefined,
  flow: "default" | "setup_step1" | "setup_unified",
  sourceProvider: "gmail" | "google_calendar" | "google_drive" | null,
) {
  return buildSetupLiteRedirectUrl(
    request,
    userId,
    userEmail,
    flow === "default" ? "setup_step1" : flow,
    sourceProvider,
  );
}

export async function GET(request: NextRequest) {
  const auth = await requireClawCloudAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const requestedScopeSet = request.nextUrl.searchParams.get("scopeSet")?.trim().toLowerCase();
  const scopeSet = normalizeGoogleWorkspaceScopeSet(requestedScopeSet);
  const requestedFlow = request.nextUrl.searchParams.get("flow")?.trim().toLowerCase();
  const requestedSourceProvider = request.nextUrl.searchParams.get("sourceProvider")?.trim().toLowerCase();
  const flow = requestedFlow === "setup_unified"
    ? "setup_unified"
    : requestedFlow === "setup_step1"
      ? "setup_step1"
      : "default";
  const sourceProvider = requestedSourceProvider === "google_calendar"
    ? "google_calendar"
    : requestedSourceProvider === "google_drive"
      ? "google_drive"
      : requestedSourceProvider === "gmail"
        ? "gmail"
        : null;
  try {
    const coreAccess = getGoogleWorkspaceCoreAccess(auth.user.email ?? null);
    const extendedAccess = getGoogleWorkspaceExtendedAccess(auth.user.email ?? null);
    const requiresExtendedAccess = scopeSet === "extended" || scopeSet === "google_drive";
    const requestedAccess = requiresExtendedAccess ? extendedAccess : coreAccess;
    const shouldForceSafeFallback =
      (env.GOOGLE_WORKSPACE_SETUP_LITE_ONLY || env.GOOGLE_WORKSPACE_TEMPORARY_HOLD)
      && !requestedAccess.available;

    if (shouldForceSafeFallback) {
      const url = await buildSafeWorkspaceFallbackUrl(
        request,
        auth.user.id,
        auth.user.email ?? null,
        flow,
        sourceProvider,
      );

      return withNoStoreHeaders(NextResponse.json({ url }));
    }

    if (!requiresExtendedAccess && !coreAccess.available) {
      return withNoStoreHeaders(
        NextResponse.json({ error: coreAccess.reason }, { status: 403 }),
      );
    }

    if (requiresExtendedAccess && !extendedAccess.available) {
      return withNoStoreHeaders(
        NextResponse.json({ error: extendedAccess.reason }, { status: 403 }),
      );
    }

    const nonce = crypto.randomUUID();
    const url = buildClawCloudGoogleAuthUrl(
      buildClawCloudGoogleWorkspaceState(nonce, scopeSet),
      request.nextUrl.origin,
      scopeSet,
      { loginHint: auth.user.email ?? null },
    );
    const response = withNoStoreHeaders(NextResponse.json({ url }));
    response.cookies.set(
      GOOGLE_WORKSPACE_SESSION_COOKIE,
      encodeWorkspaceSessionCookie({
        nonce,
        userId: auth.user.id,
        scopeSet,
        flow,
        expectedEmail: auth.user.email ?? null,
        sourceProvider,
        issuedAt: new Date().toISOString(),
      }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 10,
      },
    );
    return response;
  } catch (error) {
    return withNoStoreHeaders(
      NextResponse.json({ error: getClawCloudErrorMessage(error) }, { status: 500 }),
    );
  }
}
