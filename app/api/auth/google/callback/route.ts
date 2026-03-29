import { NextRequest, NextResponse } from "next/server";

import {
  confirmGoogleWorkspaceScopeAccess,
  buildGoogleWorkspaceWrongAccountMessage,
  buildGoogleWorkspaceScopeMismatchMessage,
  exchangeClawCloudGoogleCode,
  exchangeClawCloudGoogleLoginCode,
  fetchGoogleGrantedScopes,
  fetchClawCloudGoogleProfile,
  hasRequiredGoogleWorkspaceScopes,
  matchesExpectedClawCloudGoogleWorkspaceEmail,
  normalizeGoogleWorkspaceScopeSet,
  parseClawCloudGoogleWorkspaceState,
  verifyClawCloudGoogleLoginCallbackState,
} from "@/lib/clawcloud-google";
import {
  getClawCloudErrorMessage,
  getClawCloudSupabaseAdmin,
} from "@/lib/clawcloud-supabase";
import { decryptSecretValue, encryptSecretValue } from "@/lib/clawcloud-secret-box";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const GOOGLE_LOGIN_STATE_COOKIE = "clawcloud-google-login-state";
const GOOGLE_LOGIN_SESSION_COOKIE = "clawcloud-google-login-session";
const GOOGLE_WORKSPACE_SESSION_COOKIE = "clawcloud-google-workspace-session";

type GoogleWorkspaceSessionCookie = {
  nonce: string;
  userId: string;
  scopeSet: "core" | "extended" | "gmail" | "google_calendar" | "google_drive";
  flow: "default" | "setup_step1" | "setup_unified";
  expectedEmail: string | null;
  sourceProvider: "gmail" | "google_calendar" | "google_drive" | null;
  issuedAt: string;
};

function isExistingUserError(message: string) {
  return /already (exists|been registered|registered)|duplicate|unique/i.test(message);
}

function buildWorkspaceRedirectBase(
  origin: string,
  scopeSet: GoogleWorkspaceSessionCookie["scopeSet"],
  flow: "default" | "setup_step1" | "setup_unified",
) {
  const redirectBase = new URL(
    flow === "setup_unified" || flow === "setup_step1" ? "/setup" : "/settings",
    origin,
  );
  if (flow === "default" && (scopeSet === "extended" || scopeSet === "google_drive")) {
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

function decodeWorkspaceSessionCookie(value: string | null | undefined): GoogleWorkspaceSessionCookie | null {
  const encoded = value?.trim() ?? "";
  if (!encoded) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as Partial<GoogleWorkspaceSessionCookie>;
    const scopeSet = normalizeGoogleWorkspaceScopeSet(parsed.scopeSet, "core");
    const nonce = String(parsed.nonce ?? "").trim();
    const userId = String(parsed.userId ?? "").trim();

    if (!nonce || !userId) {
      return null;
    }

    return {
      nonce,
      userId,
      scopeSet,
      flow: parsed.flow === "setup_unified"
        ? "setup_unified"
        : parsed.flow === "setup_step1"
          ? "setup_step1"
          : "default",
      expectedEmail: typeof parsed.expectedEmail === "string" ? parsed.expectedEmail : null,
      sourceProvider: parsed.sourceProvider === "google_calendar"
        ? "google_calendar"
        : parsed.sourceProvider === "google_drive"
          ? "google_drive"
          : parsed.sourceProvider === "gmail"
            ? "gmail"
            : null,
      issuedAt: String(parsed.issuedAt ?? ""),
    };
  } catch {
    return null;
  }
}

function clearWorkspaceSessionCookie(response: NextResponse) {
  response.cookies.delete(GOOGLE_WORKSPACE_SESSION_COOKIE);
  return response;
}

function safeParseWorkspaceState(state: string | null | undefined) {
  if (!state) {
    return null;
  }

  try {
    return parseClawCloudGoogleWorkspaceState(state);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code")?.trim();
  const state = request.nextUrl.searchParams.get("state")?.trim();
  const providerError = request.nextUrl.searchParams.get("error");
  const workspaceSession = decodeWorkspaceSessionCookie(
    request.cookies.get(GOOGLE_WORKSPACE_SESSION_COOKIE)?.value,
  );
  const parsedWorkspaceState = safeParseWorkspaceState(state);

  const fallbackScopeSet = workspaceSession?.scopeSet
    ?? parsedWorkspaceState?.scopeSet
    ?? normalizeGoogleWorkspaceScopeSet(
      state?.startsWith("workspace:")
        ? state.split(":")[1]?.trim().toLowerCase()
        : null,
      "core",
    );
  const redirectBase = buildWorkspaceRedirectBase(
    request.nextUrl.origin,
    fallbackScopeSet,
    workspaceSession?.flow ?? "default",
  );
  const expectedLoginState = request.cookies.get(GOOGLE_LOGIN_STATE_COOKIE)?.value?.trim() ?? "";
  const verifiedLoginState = verifyClawCloudGoogleLoginCallbackState(state, expectedLoginState);
  const loginRedirectBase = new URL("/auth", verifiedLoginState?.origin ?? request.nextUrl.origin);

  if (state?.startsWith("login:")) {
    if (providerError) {
      loginRedirectBase.searchParams.set("error", providerError);
      const response = withNoStoreHeaders(NextResponse.redirect(loginRedirectBase));
      response.cookies.delete(GOOGLE_LOGIN_STATE_COOKIE);
      return response;
    }

    if (!code || !verifiedLoginState) {
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
    return clearWorkspaceSessionCookie(
      withNoStoreHeaders(NextResponse.redirect(redirectBase)),
    );
  }

  if (!code || !state) {
    redirectBase.searchParams.set("error", "missing_google_oauth_code");
    return clearWorkspaceSessionCookie(
      withNoStoreHeaders(NextResponse.redirect(redirectBase)),
    );
  }

  try {
    const workspaceState = parseClawCloudGoogleWorkspaceState(state);
    if (
      !workspaceSession
      || workspaceSession.nonce !== workspaceState.nonce
      || workspaceSession.scopeSet !== workspaceState.scopeSet
    ) {
      throw new Error("Google connection session expired. Please retry.");
    }

    const workspaceRedirectBase = buildWorkspaceRedirectBase(
      request.nextUrl.origin,
      workspaceState.scopeSet,
      workspaceSession.flow,
    );
    const userId = workspaceSession.userId;
    const exchanged = await exchangeClawCloudGoogleCode(code, request.nextUrl.origin);
    const grantedScopes = await fetchGoogleGrantedScopes(exchanged.accessToken);
    let confirmedWorkspaceScopes = hasRequiredGoogleWorkspaceScopes(grantedScopes, workspaceState.scopeSet);
    if (!confirmedWorkspaceScopes) {
      confirmedWorkspaceScopes = await confirmGoogleWorkspaceScopeAccess(
        exchanged.accessToken,
        workspaceState.scopeSet,
      );
    }
    if (!confirmedWorkspaceScopes) {
      throw new Error(
        buildGoogleWorkspaceScopeMismatchMessage(workspaceState.scopeSet, grantedScopes),
      );
    }
    const profile = await fetchClawCloudGoogleProfile(exchanged.accessToken);
    if (!matchesExpectedClawCloudGoogleWorkspaceEmail(workspaceSession.expectedEmail, profile.email)) {
      throw new Error(buildGoogleWorkspaceWrongAccountMessage(workspaceSession.expectedEmail));
    }
    const tokenExpiry = new Date(Date.now() + exchanged.expiresIn * 1000).toISOString();

    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const { data: existingGoogleRows } = await supabaseAdmin
      .from("connected_accounts")
      .select("refresh_token")
      .eq("user_id", userId)
      .in("provider", ["gmail", "google_calendar", "google_drive"]);
    const existingRefreshToken = ((existingGoogleRows ?? []) as Array<{ refresh_token?: string | null }>)
      .map((row) => decryptSecretValue(row.refresh_token))
      .map((value) => String(value ?? "").trim())
      .find(Boolean)
      || null;
    const sharedRow = {
      user_id: userId,
      access_token: encryptSecretValue(exchanged.accessToken),
      refresh_token: encryptSecretValue(exchanged.refreshToken ?? existingRefreshToken),
      token_expiry: tokenExpiry,
      account_email: profile.email,
      display_name: profile.name,
      is_active: true,
      connected_at: new Date().toISOString(),
    };

    const providersToSave = workspaceState.scopeSet === "extended"
      ? ["gmail", "google_calendar", "google_drive"]
      : workspaceState.scopeSet === "core"
        ? ["gmail", "google_calendar"]
        : [workspaceState.scopeSet];

    for (const provider of providersToSave) {
      const { error } = await supabaseAdmin
        .from("connected_accounts")
        .upsert(
          {
            ...sharedRow,
            provider,
          },
          { onConflict: "user_id,provider" },
        );

      if (error) {
        throw new Error(
          provider === "google_drive"
            ? describeGoogleWorkspaceSaveError(error)
            : error.message,
        );
      }
    }

    if (providersToSave.includes("gmail")) {
      workspaceRedirectBase.searchParams.set("gmail", "connected");
    }
    if (providersToSave.includes("google_calendar")) {
      workspaceRedirectBase.searchParams.set("calendar", "connected");
    }
    if (providersToSave.includes("google_drive")) {
      workspaceRedirectBase.searchParams.set("drive", "connected");
    }
    if (workspaceSession.sourceProvider) {
      workspaceRedirectBase.searchParams.set("source", workspaceSession.sourceProvider);
    }

    if (workspaceSession.flow === "setup_unified") {
      workspaceRedirectBase.searchParams.set("step", "2");
      workspaceRedirectBase.searchParams.set("activation", "all");
      return clearWorkspaceSessionCookie(
        withNoStoreHeaders(NextResponse.redirect(workspaceRedirectBase)),
      );
    }

    if (workspaceSession.flow === "setup_step1") {
      return clearWorkspaceSessionCookie(
        withNoStoreHeaders(NextResponse.redirect(workspaceRedirectBase)),
      );
    }

    if (workspaceState.scopeSet === "extended" || workspaceState.scopeSet === "google_drive") {
      return clearWorkspaceSessionCookie(
        withNoStoreHeaders(NextResponse.redirect(workspaceRedirectBase)),
      );
    }

    workspaceRedirectBase.searchParams.set("step", "2");
    return clearWorkspaceSessionCookie(
      withNoStoreHeaders(NextResponse.redirect(workspaceRedirectBase)),
    );
  } catch (error) {
    redirectBase.searchParams.set("error", getClawCloudErrorMessage(error));
    return clearWorkspaceSessionCookie(
      withNoStoreHeaders(NextResponse.redirect(redirectBase)),
    );
  }
}
