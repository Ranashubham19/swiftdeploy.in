import { env } from "@/lib/env";

function normalizeEmail(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isWorkspaceOauthConfigured() {
  return Boolean(
    env.GOOGLE_CLIENT_ID
    && env.GOOGLE_CLIENT_SECRET
    && env.NEXT_PUBLIC_APP_URL,
  );
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
  const publicEnabled = Boolean(
    env.GOOGLE_WORKSPACE_PUBLIC_ENABLED && !env.GOOGLE_WORKSPACE_TEMPORARY_HOLD,
  );

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
      allowlisted: true,
      reason: "Google Workspace connect is enabled for approved tester accounts only.",
    };
  }

  if (publicEnabled) {
    return {
      available: true,
      allowlisted: false,
      reason: "Google Workspace connect is available.",
    };
  }

  if (env.GOOGLE_WORKSPACE_TEMPORARY_HOLD) {
    return {
      available: false,
      allowlisted: false,
      reason:
        "Google Workspace connect is temporarily limited to approved tester accounts while public access is paused.",
    };
  }

  return {
    available: false,
    allowlisted: false,
    reason:
      "Google Workspace connect is currently limited to approved tester accounts while public rollout is disabled.",
  };
}

export function getGoogleWorkspaceExtendedAccess(email: string | null | undefined) {
  const configured = isWorkspaceOauthConfigured();
  const allowlisted = isGoogleWorkspaceTestUser(email);
  const publicEnabled = Boolean(
    env.GOOGLE_WORKSPACE_PUBLIC_ENABLED
    && env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED
    && !env.GOOGLE_WORKSPACE_TEMPORARY_HOLD,
  );

  if (!configured) {
    return {
      available: false,
      allowlisted,
      reason: "Google OAuth client or public app URL is incomplete.",
    };
  }

  if (allowlisted && env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED) {
    return {
      available: true,
      allowlisted: true,
      reason: "Drive and Sheets connect is enabled for approved tester accounts only.",
    };
  }

  if (publicEnabled) {
    return {
      available: true,
      allowlisted: false,
      reason: "Drive and Sheets connect is available.",
    };
  }

  if (!env.GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED) {
    return {
      available: false,
      allowlisted: false,
      reason:
        "Drive and Sheets connect stays disabled until the extended Google scope rollout is reopened.",
    };
  }

  if (env.GOOGLE_WORKSPACE_TEMPORARY_HOLD) {
    return {
      available: false,
      allowlisted: false,
      reason:
        "Drive and Sheets connect is temporarily limited to approved tester accounts while public access is paused.",
    };
  }

  return {
    available: false,
    allowlisted: false,
    reason:
      "Drive and Sheets connect is currently limited to approved tester accounts while public rollout is disabled.",
  };
}
