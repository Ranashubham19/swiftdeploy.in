import {
  env,
  isGoogleWorkspaceExtendedConnectEnabled,
  isGoogleWorkspaceOauthConfigured,
  isGoogleWorkspacePublicConnectEnabled,
} from "@/lib/env";

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isWorkspaceOauthConfigured() {
  return isGoogleWorkspaceOauthConfigured();
}

export function isGoogleWorkspaceTestUser(email: string | null | undefined) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return false;
  }

  return env.GOOGLE_WORKSPACE_TEST_USER_EMAILS.some(
    (candidate) => normalizeEmail(candidate) === normalized,
  );
}

export function getGoogleWorkspaceCoreAccess(email: string | null | undefined) {
  const configured = isWorkspaceOauthConfigured();
  const allowlisted = isGoogleWorkspaceTestUser(email);

  if (!configured) {
    return {
      available: false,
      allowlisted,
      reason: "Google OAuth client or public app URL is incomplete.",
    };
  }

  return {
    available: true,
    allowlisted,
    reason: "Google Workspace connect is available.",
  };
}

export function getGoogleWorkspaceExtendedAccess(email: string | null | undefined) {
  const configured = isWorkspaceOauthConfigured();
  const allowlisted = isGoogleWorkspaceTestUser(email);

  if (!configured) {
    return {
      available: false,
      allowlisted,
      reason: "Google OAuth client or public app URL is incomplete.",
    };
  }

  return {
    available: true,
    allowlisted,
    reason: "Drive and Sheets connect is available.",
  };
}
