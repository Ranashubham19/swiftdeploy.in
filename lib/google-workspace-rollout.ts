import {
  env,
  isGoogleWorkspaceOauthConfigured,
  isGoogleWorkspaceExtendedConnectEnabled,
  isGoogleWorkspacePublicConnectEnabled,
  isGoogleWorkspaceSetupLiteMode,
} from "@/lib/env";

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isWorkspaceOauthConfigured() {
  return isGoogleWorkspaceOauthConfigured();
}

function isWorkspaceConnectForcedToLiteOnly() {
  return isGoogleWorkspaceSetupLiteMode();
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
  const publicEnabled = isGoogleWorkspacePublicConnectEnabled();
  const liteOnly = isWorkspaceConnectForcedToLiteOnly();

  if (!configured) {
    return {
      available: false,
      allowlisted,
      reason: "Google OAuth client or public app URL is incomplete.",
    };
  }

  if (allowlisted) {
    return {
      available: true,
      allowlisted,
      reason: liteOnly
        ? "Google Workspace connect is available for this trusted tester while public users stay on Lite mode."
        : "Google Workspace connect is available for this trusted tester.",
    };
  }

  if (liteOnly) {
    return {
      available: false,
      allowlisted,
      reason: "Google Workspace connect is hidden right now while ClawCloud uses Lite mode to avoid the Google verification screen.",
    };
  }

  if (env.GOOGLE_WORKSPACE_TEMPORARY_HOLD) {
    return {
      available: false,
      allowlisted,
      reason: "Google Workspace public connect is temporarily paused while Google review is pending. Use Lite mode for public users or connect with an allowlisted tester account.",
    };
  }

  if (!publicEnabled) {
    return {
      available: false,
      allowlisted,
      reason: "Google Workspace public connect is disabled for this deployment.",
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
  const publicEnabled = isGoogleWorkspaceExtendedConnectEnabled();
  const liteOnly = isWorkspaceConnectForcedToLiteOnly();

  if (!configured) {
    return {
      available: false,
      allowlisted,
      reason: "Google OAuth client or public app URL is incomplete.",
    };
  }

  if (allowlisted) {
    return {
      available: true,
      allowlisted,
      reason: liteOnly
        ? "Drive and Sheets connect is available for this trusted tester while public users stay on Lite mode."
        : "Drive and Sheets connect is available for this trusted tester.",
    };
  }

  if (liteOnly) {
    return {
      available: false,
      allowlisted,
      reason: "Google Drive and Sheets connect is hidden right now while ClawCloud uses Lite mode to avoid the Google verification screen.",
    };
  }

  if (env.GOOGLE_WORKSPACE_TEMPORARY_HOLD) {
    return {
      available: false,
      allowlisted,
      reason: "Google Drive and Sheets public connect is temporarily paused while Google review is pending. Use Lite mode for public users or connect with an allowlisted tester account.",
    };
  }

  if (!publicEnabled) {
    return {
      available: false,
      allowlisted,
      reason: "Drive and Sheets public connect is disabled for this deployment.",
    };
  }

  return {
    available: true,
    allowlisted,
    reason: "Drive and Sheets connect is available.",
  };
}
