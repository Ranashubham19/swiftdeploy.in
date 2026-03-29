import crypto from "node:crypto";

import { env } from "@/lib/env";
import { decryptSecretValue, encryptSecretValue } from "@/lib/clawcloud-secret-box";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import type { ClawCloudProvider } from "@/lib/clawcloud-types";

export type GoogleWorkspaceScopeSet =
  | "core"
  | "extended"
  | "gmail"
  | "google_calendar"
  | "google_drive";
type GoogleConnectedProvider = Extract<ClawCloudProvider, "gmail" | "google_calendar" | "google_drive">;

function uniqueGoogleScopes(...groups: ReadonlyArray<readonly string[]>) {
  return [...new Set(groups.flat())];
}

const googleWorkspaceGmailScopes = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "email",
  "profile",
] as const;

const googleWorkspaceCalendarScopes = [
  "https://www.googleapis.com/auth/calendar.events",
  "email",
  "profile",
] as const;

const googleWorkspaceDriveScopes = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
  "email",
  "profile",
] as const;

const googleWorkspaceCoreScopes = uniqueGoogleScopes(
  googleWorkspaceGmailScopes,
  googleWorkspaceCalendarScopes,
);

const googleWorkspaceExtendedScopes = uniqueGoogleScopes(googleWorkspaceDriveScopes);

const googleLoginScopes = [
  "openid",
  "email",
  "profile",
] as const;

const googleConnectedProviders: GoogleConnectedProvider[] = [
  "gmail",
  "google_calendar",
  "google_drive",
];

function getGoogleWorkspaceScopeSetProviders(scopeSet: GoogleWorkspaceScopeSet) {
  switch (scopeSet) {
    case "gmail":
      return ["gmail"] as const;
    case "google_calendar":
      return ["google_calendar"] as const;
    case "google_drive":
      return ["google_drive"] as const;
    case "extended":
      return [...googleConnectedProviders] as const;
    case "core":
    default:
      return ["gmail", "google_calendar"] as const;
  }
}

function getRequiredGoogleWorkspaceScopesForProviders(
  providers: Iterable<GoogleConnectedProvider>,
) {
  const requiredScopes = new Set<string>();

  for (const provider of providers) {
    const providerScopes = provider === "gmail"
      ? googleWorkspaceGmailScopes
      : provider === "google_calendar"
        ? googleWorkspaceCalendarScopes
        : googleWorkspaceDriveScopes;

    for (const scope of providerScopes) {
      requiredScopes.add(scope);
    }
  }

  return [...requiredScopes];
}

function formatGoogleWorkspaceAccessList(providers: readonly GoogleConnectedProvider[]) {
  const labels = providers.map((provider) => {
    if (provider === "gmail") {
      return "Gmail";
    }

    if (provider === "google_calendar") {
      return "Google Calendar";
    }

    return "Google Drive / Sheets";
  });

  if (labels.length <= 1) {
    return labels[0] ?? "Google Workspace";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function isGoogleWorkspaceScopeSet(value: string | null | undefined): value is GoogleWorkspaceScopeSet {
  return (
    value === "core"
    || value === "extended"
    || value === "gmail"
    || value === "google_calendar"
    || value === "google_drive"
  );
}

export function normalizeGoogleWorkspaceScopeSet(
  value: string | null | undefined,
  fallback: GoogleWorkspaceScopeSet = "core",
) {
  return isGoogleWorkspaceScopeSet(value) ? value : fallback;
}

type ConnectedGoogleAccount = {
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
};

function decryptConnectedGoogleAccount(account: ConnectedGoogleAccount): ConnectedGoogleAccount {
  return {
    access_token: decryptSecretValue(account.access_token),
    refresh_token: decryptSecretValue(account.refresh_token),
    token_expiry: account.token_expiry,
  };
}

export type ClawCloudGoogleCapabilityStatus = {
  checked: boolean;
  connected: boolean;
  reconnectRequired: boolean;
  reconnectReason: string | null;
  gmailModify: boolean;
  gmailCompose: boolean;
  gmailSend: boolean;
  calendarWrite: boolean;
  driveRead: boolean;
  sheetsWrite: boolean;
};

export type GmailMessage = {
  id: string;
  threadId: string;
  messageId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  replyTo: string;
  snippet: string;
  isRead: boolean;
  labels: string[];
  body: string;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string | null;
  hangoutLink: string | null;
  attendees: Array<{ email?: string | null; displayName?: string | null }>;
  description: string | null;
};

type CalendarEventPayload = {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
  hangoutLink?: string;
  attendees?: Array<{ email?: string | null; displayName?: string | null }>;
  description?: string;
};

export class ClawCloudGoogleReconnectRequiredError extends Error {
  readonly providers: GoogleConnectedProvider[];

  constructor(message = "Google Workspace needs to be reconnected.", providers = googleConnectedProviders) {
    super(message);
    this.name = "ClawCloudGoogleReconnectRequiredError";
    this.providers = [...providers];
  }
}

export function isClawCloudGoogleReconnectRequiredError(
  error: unknown,
): error is ClawCloudGoogleReconnectRequiredError {
  return error instanceof ClawCloudGoogleReconnectRequiredError;
}

export function isClawCloudGoogleNotConnectedError(
  error: unknown,
  provider?: GoogleConnectedProvider,
) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message) {
    return false;
  }

  const normalized = message.trim().toLowerCase();
  if (provider) {
    return normalized.includes(`${provider} is not connected for this user.`);
  }

  return /\b(?:gmail|google_calendar|google_drive)\s+is not connected for this user\.\b/i.test(normalized);
}

export function buildGoogleReconnectRequiredReply(serviceLabel = "Google Workspace") {
  return [
    `*${serviceLabel} needs to be reconnected.*`,
    "",
    "The saved Google connection is no longer valid for this account.",
    "Reconnect Google at *swift-deploy.in/settings* and try again.",
  ].join("\n");
}

export function buildGoogleNotConnectedReply(serviceLabel = "Google Workspace") {
  return [
    `*${serviceLabel} is not connected.*`,
    "",
    "Reconnect Google at *swift-deploy.in/settings* and try again.",
  ].join("\n");
}

function normalizeOrigin(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function isLocalOrigin(origin: string) {
  if (!origin) {
    return false;
  }

  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
  } catch {
    return false;
  }
}

type GoogleLoginIntent = "login" | "signup";

type GoogleLoginStatePayload = {
  nonce: string;
  origin: string;
  issuedAt: string;
  intent: GoogleLoginIntent;
};

const GOOGLE_LOGIN_STATE_PREFIX = "login:v2:";
const GOOGLE_LOGIN_STATE_MAX_AGE_MS = 15 * 60 * 1000;

function getClawCloudGoogleLoginStateSecret() {
  const secret = (
    env.AGENT_SECRET
    || env.CRON_SECRET
    || env.SUPABASE_SERVICE_ROLE_KEY
    || env.GOOGLE_CLIENT_SECRET
  )?.trim();

  if (!secret) {
    throw new Error("Google login state secret is not configured.");
  }

  return secret;
}

function getPreferredGoogleAuthOrigin(requestOrigin?: string) {
  const liveOrigin = normalizeOrigin(requestOrigin);
  if (liveOrigin && !isLocalOrigin(liveOrigin)) {
    return liveOrigin;
  }

  const configuredRedirectUri = normalizeOrigin(env.GOOGLE_REDIRECT_URI);
  if (configuredRedirectUri && !isLocalOrigin(configuredRedirectUri)) {
    try {
      return new URL(configuredRedirectUri).origin;
    } catch {
      // Fall through to the app URL.
    }
  }

  const configuredAppUrl = normalizeOrigin(env.NEXT_PUBLIC_APP_URL);
  if (configuredAppUrl) {
    return configuredAppUrl;
  }

  return liveOrigin;
}

function signClawCloudGoogleLoginStatePayload(encodedPayload: string) {
  return crypto
    .createHmac("sha256", getClawCloudGoogleLoginStateSecret())
    .update(encodedPayload)
    .digest("base64url");
}

export function buildClawCloudGoogleLoginState(
  requestOrigin?: string,
  intent: GoogleLoginIntent = "login",
) {
  const origin = getPreferredGoogleAuthOrigin(requestOrigin);
  if (!origin) {
    throw new Error("Google login origin is not configured.");
  }

  const payload: GoogleLoginStatePayload = {
    nonce: crypto.randomUUID(),
    origin,
    issuedAt: new Date().toISOString(),
    intent,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = signClawCloudGoogleLoginStatePayload(encodedPayload);
  return `${GOOGLE_LOGIN_STATE_PREFIX}${encodedPayload}.${signature}`;
}

export function parseClawCloudGoogleLoginState(state: string) {
  const trimmed = state.trim();
  if (!trimmed.startsWith(GOOGLE_LOGIN_STATE_PREFIX)) {
    return null;
  }

  const raw = trimmed.slice(GOOGLE_LOGIN_STATE_PREFIX.length);
  const [encodedPayload, providedSignature] = raw.split(".", 2);
  if (!encodedPayload || !providedSignature) {
    throw new Error("Invalid Google login state.");
  }

  const expectedSignature = signClawCloudGoogleLoginStatePayload(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    providedBuffer.length !== expectedBuffer.length
    || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid Google login state.");
  }

  const parsed = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf-8"),
  ) as Partial<GoogleLoginStatePayload>;

  const origin = normalizeOrigin(parsed.origin);
  const nonce = String(parsed.nonce ?? "").trim();
  const issuedAt = String(parsed.issuedAt ?? "").trim();
  const intent = parsed.intent === "signup" ? "signup" : "login";
  const issuedAtMs = Date.parse(issuedAt);

  if (!origin || !nonce || !issuedAt || Number.isNaN(issuedAtMs)) {
    throw new Error("Invalid Google login state.");
  }

  if (Date.now() - issuedAtMs > GOOGLE_LOGIN_STATE_MAX_AGE_MS) {
    throw new Error("Expired Google login state.");
  }

  return {
    nonce,
    origin,
    issuedAt,
    intent,
  };
}

export function verifyClawCloudGoogleLoginCallbackState(
  state: string | null | undefined,
  expectedState: string | null | undefined,
) {
  const returnedState = String(state ?? "").trim();
  const cookieState = String(expectedState ?? "").trim();

  if (!returnedState || !cookieState || returnedState !== cookieState) {
    return null;
  }

  try {
    return parseClawCloudGoogleLoginState(returnedState);
  } catch {
    return null;
  }
}

function hasGooglePermissionScopeError(message: string) {
  const normalized = String(message ?? "").trim().toLowerCase();
  return (
    /\binsufficient\b.*\bscope\b/.test(normalized)
    || /\binsufficient authentication scopes\b/.test(normalized)
    || /\binsufficient\b.*\bpermission\b/.test(normalized)
    || /\bpermission denied\b/.test(normalized)
    || /\bdoes not have any of the acceptable scopes\b/.test(normalized)
  );
}

async function readGoogleApiErrorMessage(response: Response, fallback: string) {
  const raw = await response.text().catch(() => "");
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    const message = parsed.error?.message?.trim();
    if (message) {
      return message;
    }
  } catch {
    // Fall through to raw text handling.
  }

  return raw.trim().slice(0, 300) || fallback;
}

function describeGoogleReconnectProviders(providers: GoogleConnectedProvider[]) {
  const unique = Array.from(new Set(providers));
  if (unique.length !== 1) {
    return "Google Workspace";
  }

  switch (unique[0]) {
    case "gmail":
      return "Gmail";
    case "google_calendar":
      return "Google Calendar";
    case "google_drive":
      return "Google Drive";
    default:
      return "Google Workspace";
  }
}

export function createClawCloudGoogleApiError(
  message: string,
  fallback: string,
  providers: GoogleConnectedProvider[],
): Error {
  const normalizedMessage = String(message ?? "").trim() || fallback;
  if (hasGooglePermissionScopeError(message)) {
    return new ClawCloudGoogleReconnectRequiredError(
      `Reconnect ${describeGoogleReconnectProviders(providers)} in settings to grant the latest permissions.`,
      providers,
    );
  }

  return new Error(normalizedMessage);
}

function throwGoogleApiPermissionAwareError(
  message: string,
  fallback: string,
  providers: GoogleConnectedProvider[],
): never {
  throw createClawCloudGoogleApiError(message, fallback, providers);
}

function normalizeCalendarEvent(event: CalendarEventPayload): CalendarEvent {
  return {
    id: event.id ?? "",
    summary: event.summary ?? "Untitled event",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    location: event.location ?? null,
    hangoutLink: event.hangoutLink ?? null,
    attendees: event.attendees ?? [],
    description: event.description ?? null,
  };
}

function hasGrantedScope(grantedScopes: Set<string>, requiredScopes: readonly string[]) {
  return requiredScopes.every((scope) => grantedScopes.has(scope));
}

function getRequiredGoogleWorkspaceScopes(scopeSet: GoogleWorkspaceScopeSet) {
  switch (scopeSet) {
    case "gmail":
      return [...googleWorkspaceGmailScopes];
    case "google_calendar":
      return [...googleWorkspaceCalendarScopes];
    case "google_drive":
      return [...googleWorkspaceDriveScopes];
    case "extended":
      return [...googleWorkspaceCoreScopes, ...googleWorkspaceExtendedScopes];
    case "core":
    default:
      return [...googleWorkspaceCoreScopes];
  }
}

export function hasRequiredGoogleWorkspaceScopes(
  grantedScopes: Set<string> | null,
  scopeSet: GoogleWorkspaceScopeSet,
) {
  if (!grantedScopes) {
    return false;
  }

  return hasGrantedScope(grantedScopes, getRequiredGoogleWorkspaceScopes(scopeSet));
}

export function buildGoogleWorkspaceScopeMismatchMessage(
  scopeSet: GoogleWorkspaceScopeSet,
  grantedScopes: Set<string> | null,
) {
  const expectedProviders = getGoogleWorkspaceScopeSetProviders(scopeSet);
  const grantedScopeList = grantedScopes ? [...grantedScopes] : [];
  const missingScopes = getRequiredGoogleWorkspaceScopes(scopeSet).filter(
    (scope) => !grantedScopes?.has(scope),
  );

  const grantedBasicOnly = grantedScopeList.length > 0
    && !grantedScopeList.some((scope) => scope.startsWith("https://www.googleapis.com/auth/"));
  const expectedAccessLabel = formatGoogleWorkspaceAccessList(expectedProviders);

  if (grantedBasicOnly || missingScopes.length > 0) {
    return `Google only granted basic sign-in permissions for this account. Reconnect Google and approve access for ${expectedAccessLabel}.`;
  }

  return `Google did not confirm the required Workspace permissions for ${expectedAccessLabel}. Reconnect Google and try again.`;
}

function getGoogleRedirectUri(requestOrigin?: string) {
  const origin = getPreferredGoogleAuthOrigin(requestOrigin);
  if (origin) {
    return `${origin}/api/auth/google/callback`;
  }

  return "";
}

function getGoogleLoginRedirectUri(requestOrigin?: string) {
  return getGoogleRedirectUri(requestOrigin);
}

function assertGoogleOAuthConfigured(requestOrigin?: string) {
  const missing: string[] = [];

  if (!env.GOOGLE_CLIENT_ID) {
    missing.push("GOOGLE_CLIENT_ID or GOOGLE_OAUTH_CLIENT_ID");
  }

  if (!env.GOOGLE_CLIENT_SECRET) {
    missing.push("GOOGLE_CLIENT_SECRET or GOOGLE_OAUTH_CLIENT_SECRET");
  }

  if (!getGoogleRedirectUri(requestOrigin)) {
    missing.push("GOOGLE_REDIRECT_URI, NEXT_PUBLIC_APP_URL, or request origin");
  }

  if (missing.length > 0) {
    throw new Error(`Google OAuth is not fully configured. Missing: ${missing.join(", ")}.`);
  }
}

function assertGoogleLoginOAuthConfigured(requestOrigin?: string) {
  const missing: string[] = [];

  if (!env.GOOGLE_CLIENT_ID) {
    missing.push("GOOGLE_CLIENT_ID or GOOGLE_OAUTH_CLIENT_ID");
  }

  if (!env.GOOGLE_CLIENT_SECRET) {
    missing.push("GOOGLE_CLIENT_SECRET or GOOGLE_OAUTH_CLIENT_SECRET");
  }

  if (!getGoogleLoginRedirectUri(requestOrigin)) {
    missing.push("NEXT_PUBLIC_APP_URL or request origin");
  }

  if (missing.length > 0) {
    throw new Error(`Google login OAuth is not fully configured. Missing: ${missing.join(", ")}.`);
  }
}

export function buildClawCloudGoogleWorkspaceState(
  nonce: string,
  scopeSet: GoogleWorkspaceScopeSet,
) {
  return `workspace:${scopeSet}:${nonce}`;
}

function normalizeClawCloudGoogleWorkspaceEmail(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.includes("@") ? normalized : "";
}

export function matchesExpectedClawCloudGoogleWorkspaceEmail(
  expectedEmail: string | null | undefined,
  actualEmail: string | null | undefined,
) {
  const normalizedExpected = normalizeClawCloudGoogleWorkspaceEmail(expectedEmail);
  if (!normalizedExpected) {
    return true;
  }

  return normalizeClawCloudGoogleWorkspaceEmail(actualEmail) === normalizedExpected;
}

export function buildGoogleWorkspaceWrongAccountMessage(expectedEmail: string | null | undefined) {
  const normalizedExpected = normalizeClawCloudGoogleWorkspaceEmail(expectedEmail);
  if (!normalizedExpected) {
    return "Reconnect Google using the same account you signed in with.";
  }

  return `Continue with the signed-in Google account ${normalizedExpected} and try again.`;
}

export function parseClawCloudGoogleWorkspaceState(state: string) {
  const trimmed = state.trim();
  const match = trimmed.match(/^workspace:([a-z_]+):(.+)$/i);
  if (match && isGoogleWorkspaceScopeSet(match[1].toLowerCase())) {
    return {
      nonce: match[2].trim(),
      scopeSet: match[1].toLowerCase() as GoogleWorkspaceScopeSet,
    };
  }

  throw new Error("Invalid Google Workspace state.");
}

function getGoogleWorkspaceScopes(scopeSet: GoogleWorkspaceScopeSet) {
  return getRequiredGoogleWorkspaceScopes(scopeSet);
}

export function buildClawCloudGoogleAuthUrl(
  state: string,
  requestOrigin?: string,
  scopeSet: GoogleWorkspaceScopeSet = "core",
  options?: {
    loginHint?: string | null;
  },
) {
  assertGoogleOAuthConfigured(requestOrigin);
  const redirectUri = getGoogleRedirectUri(requestOrigin);
  const normalizedLoginHint = normalizeClawCloudGoogleWorkspaceEmail(options?.loginHint);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    scope: getGoogleWorkspaceScopes(scopeSet).join(" "),
    state,
  });

  if (normalizedLoginHint) {
    params.set("login_hint", normalizedLoginHint);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildClawCloudGoogleLoginAuthUrl(state: string, requestOrigin?: string) {
  assertGoogleLoginOAuthConfigured(requestOrigin);
  const redirectUri = getGoogleLoginRedirectUri(requestOrigin);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "online",
    include_granted_scopes: "true",
    prompt: "select_account",
    scope: googleLoginScopes.join(" "),
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeClawCloudGoogleCode(code: string, requestOrigin?: string) {
  assertGoogleOAuthConfigured(requestOrigin);
  const redirectUri = getGoogleRedirectUri(requestOrigin);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || json.error || !json.access_token) {
    throw new Error(json.error_description || json.error || "Google token exchange failed.");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresIn: json.expires_in ?? 3600,
  };
}

export async function exchangeClawCloudGoogleLoginCode(code: string, requestOrigin?: string) {
  assertGoogleLoginOAuthConfigured(requestOrigin);
  const redirectUri = getGoogleLoginRedirectUri(requestOrigin);

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const json = (await response.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    id_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || json.error || !json.access_token || !json.id_token) {
    throw new Error(json.error_description || json.error || "Google login token exchange failed.");
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    idToken: json.id_token,
    expiresIn: json.expires_in ?? 3600,
  };
}

export async function fetchClawCloudGoogleProfile(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const json = (await response.json()) as {
    email?: string;
    name?: string;
    error?: string;
  };

  if (!response.ok || json.error || !json.email) {
    throw new Error("Unable to read Google profile.");
  }

  return {
    email: json.email,
    name: json.name ?? json.email,
  };
}

async function getConnectedGoogleAccount(
  userId: string,
  provider: GoogleConnectedProvider,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("connected_accounts")
    .select("access_token, refresh_token, token_expiry")
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("is_active", true)
    .single();

  if (error || !data) {
    throw new Error(`${provider} is not connected for this user.`);
  }

  return decryptConnectedGoogleAccount(data as ConnectedGoogleAccount);
}

function buildGoogleOauthErrorMessage(errorCode?: string, errorDescription?: string) {
  return [errorDescription, errorCode]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ")
    || "Google token refresh failed.";
}

function shouldRequireGoogleReconnect(errorCode?: string, errorDescription?: string) {
  const normalizedCode = String(errorCode ?? "").trim().toLowerCase();
  const normalizedDescription = String(errorDescription ?? "").trim().toLowerCase();
  const normalizedCombined = `${normalizedCode} ${normalizedDescription}`.trim();

  return [
    /\binvalid_client\b/,
    /\bunauthorized_client\b/,
    /\binvalid_grant\b/,
    /\boauth client was deleted\b/,
    /\bdeleted\b.*\bclient\b/,
    /\bexpired or revoked\b/,
    /\btoken has been expired or revoked\b/,
    /\brevoked\b/,
    /\bmalformed auth code\b/,
  ].some((pattern) => pattern.test(normalizedCombined));
}

async function deactivateConnectedGoogleAccounts(
  userId: string,
  providers: GoogleConnectedProvider[] = googleConnectedProviders,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("connected_accounts")
    .update({
      is_active: false,
      access_token: null,
      refresh_token: null,
      token_expiry: null,
    })
    .eq("user_id", userId)
    .in("provider", providers);

  if (error) {
    throw new Error(error.message);
  }
}

async function refreshGoogleAccessToken(refreshToken: string) {
  assertGoogleOAuthConfigured();

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
    }),
  });

  const json = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!response.ok || json.error || !json.access_token) {
    const googleErrorMessage = buildGoogleOauthErrorMessage(json.error, json.error_description);
    if (shouldRequireGoogleReconnect(json.error, json.error_description)) {
      throw new ClawCloudGoogleReconnectRequiredError(googleErrorMessage);
    }
    throw new Error(googleErrorMessage);
  }

  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? 3600,
  };
}

export async function getValidGoogleAccessToken(
  userId: string,
  provider: GoogleConnectedProvider,
) {
  const account = await getConnectedGoogleAccount(userId, provider);

  const tokenExpiry = account.token_expiry ? new Date(account.token_expiry).getTime() : 0;
  const isExpired = !tokenExpiry || tokenExpiry <= Date.now() + 5 * 60 * 1000;

  if (!isExpired && account.access_token) {
    return account.access_token;
  }

  if (!account.refresh_token) {
    await deactivateConnectedGoogleAccounts(userId).catch(() => null);
    throw new ClawCloudGoogleReconnectRequiredError(`Missing refresh token for ${provider}.`);
  }

  let refreshed;
  try {
    refreshed = await refreshGoogleAccessToken(account.refresh_token);
  } catch (error) {
    if (isClawCloudGoogleReconnectRequiredError(error)) {
      await deactivateConnectedGoogleAccounts(userId, error.providers).catch(() => null);
    }
    throw error;
  }
  const nextExpiry = new Date(Date.now() + refreshed.expiresIn * 1000).toISOString();

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  await supabaseAdmin
    .from("connected_accounts")
    .update({
      access_token: encryptSecretValue(refreshed.accessToken),
      token_expiry: nextExpiry,
    })
    .eq("user_id", userId)
    .eq("provider", provider);

  return refreshed.accessToken;
}

export async function fetchGoogleGrantedScopes(accessToken: string) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(accessToken)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json().catch(() => ({}))) as { scope?: string };
  const scopes = String(payload.scope ?? "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return new Set(scopes);
}

async function probeGoogleWorkspaceProviderAccess(
  accessToken: string,
  provider: GoogleConnectedProvider,
) {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const probeUrl = provider === "gmail"
    ? "https://gmail.googleapis.com/gmail/v1/users/me/profile"
    : provider === "google_calendar"
      ? `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=1&singleEvents=true&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(tomorrow.toISOString())}`
      : "https://www.googleapis.com/drive/v3/files?pageSize=1&fields=files(id,name)";

  try {
    const response = await fetch(probeUrl, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function confirmGoogleWorkspaceScopeAccess(
  accessToken: string,
  scopeSet: GoogleWorkspaceScopeSet,
) {
  const providers = getGoogleWorkspaceScopeSetProviders(scopeSet);

  for (const provider of providers) {
    const verified = await probeGoogleWorkspaceProviderAccess(accessToken, provider);
    if (!verified) {
      return false;
    }
  }

  return true;
}

export async function getClawCloudGoogleCapabilityStatus(
  userId: string,
): Promise<ClawCloudGoogleCapabilityStatus> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("connected_accounts")
    .select("provider")
    .eq("user_id", userId)
    .in("provider", googleConnectedProviders)
    .eq("is_active", true);

  const connectedProviders = new Set(
    ((data ?? []) as Array<{ provider?: string | null }>)
      .map((row) => String(row.provider ?? "").trim())
      .filter(Boolean),
  );

  if (connectedProviders.size === 0) {
    return {
      checked: false,
      connected: false,
      reconnectRequired: false,
      reconnectReason: null,
      gmailModify: false,
      gmailCompose: false,
      gmailSend: false,
      calendarWrite: false,
      driveRead: false,
      sheetsWrite: false,
    };
  }

  const activeProviders = googleConnectedProviders.filter((provider) => connectedProviders.has(provider));

  try {
    let checked = false;
    let reconnectReason: string | null = null;
    let gmailModify = false;
    let gmailCompose = false;
    let gmailSend = false;
    let calendarWrite = false;
    let driveRead = false;
    let sheetsWrite = false;

    for (const provider of activeProviders) {
      try {
        const accessToken = await getValidGoogleAccessToken(userId, provider);
        const grantedScopes = await fetchGoogleGrantedScopes(accessToken);
        checked = checked || Boolean(grantedScopes);
        const requiredScopes = getRequiredGoogleWorkspaceScopesForProviders([provider]);
        const hasRequiredScopes = Boolean(grantedScopes && hasGrantedScope(grantedScopes, requiredScopes));

        if (!hasRequiredScopes && !reconnectReason) {
          reconnectReason = buildGoogleWorkspaceScopeMismatchMessage(provider, grantedScopes);
        }

        if (provider === "gmail") {
          gmailModify = Boolean(grantedScopes && hasGrantedScope(grantedScopes, ["https://www.googleapis.com/auth/gmail.modify"]));
          gmailCompose = Boolean(grantedScopes && hasGrantedScope(grantedScopes, ["https://www.googleapis.com/auth/gmail.compose"]));
          gmailSend = Boolean(grantedScopes && hasGrantedScope(grantedScopes, ["https://www.googleapis.com/auth/gmail.send"]));
        }

        if (provider === "google_calendar") {
          calendarWrite = Boolean(grantedScopes && hasGrantedScope(grantedScopes, ["https://www.googleapis.com/auth/calendar.events"]));
        }

        if (provider === "google_drive") {
          driveRead = Boolean(grantedScopes && hasGrantedScope(grantedScopes, ["https://www.googleapis.com/auth/drive.readonly"]));
          sheetsWrite = Boolean(grantedScopes && hasGrantedScope(grantedScopes, ["https://www.googleapis.com/auth/spreadsheets"]));
        }
      } catch (error) {
        if (!reconnectReason) {
          reconnectReason = error instanceof Error
            ? error.message
            : "Reconnect Google to refresh the latest permissions.";
        }
      }
    }

    return {
      checked,
      connected: true,
      reconnectRequired: Boolean(reconnectReason),
      reconnectReason,
      gmailModify,
      gmailCompose,
      gmailSend,
      calendarWrite,
      driveRead,
      sheetsWrite,
    };
  } catch (error) {
    return {
      checked: false,
      connected: true,
      reconnectRequired: true,
      reconnectReason: error instanceof Error ? error.message : "Reconnect Google to refresh the latest permissions.",
      gmailModify: false,
      gmailCompose: false,
      gmailSend: false,
      calendarWrite: false,
      driveRead: false,
      sheetsWrite: false,
    };
  }
}

function decodeGoogleBody(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function decodeBasicHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, digits) => {
      const codePoint = Number(digits);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
    });
}

function normalizeGoogleText(value: string) {
  return decodeBasicHtmlEntities(value)
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtmlToText(html: string) {
  return normalizeGoogleText(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );
}

function decodeGoogleBodyByMimeType(value: string, mimeType: string | undefined) {
  const decoded = decodeGoogleBody(value);
  if (/text\/html/i.test(mimeType ?? "")) {
    return stripHtmlToText(decoded);
  }
  return decoded;
}

export function extractGoogleMessageBody(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const payloadRecord = payload as {
    body?: { data?: string | null };
    parts?: unknown[];
    mimeType?: string;
  };

  if (payloadRecord.body?.data) {
    return decodeGoogleBodyByMimeType(payloadRecord.body.data, payloadRecord.mimeType);
  }

  if (!Array.isArray(payloadRecord.parts)) {
    return "";
  }

  for (const part of payloadRecord.parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { mimeType?: string }).mimeType === "text/plain" &&
      (part as { body?: { data?: string | null } }).body?.data
    ) {
      return decodeGoogleBodyByMimeType(
        (part as { body: { data: string } }).body.data,
        (part as { mimeType?: string }).mimeType,
      );
    }
  }

  for (const part of payloadRecord.parts) {
    if (
      part &&
      typeof part === "object" &&
      (part as { mimeType?: string }).mimeType === "text/html" &&
      (part as { body?: { data?: string | null } }).body?.data
    ) {
      return decodeGoogleBodyByMimeType(
        (part as { body: { data: string } }).body.data,
        (part as { mimeType?: string }).mimeType,
      );
    }
  }

  for (const part of payloadRecord.parts) {
    const nested = extractGoogleMessageBody(part);
    if (nested) {
      return nested;
    }
  }

  return "";
}

async function getFullGmailBody(accessToken: string, messageId: string) {
  try {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const json = (await response.json()) as { payload?: unknown };
    return extractGoogleMessageBody(json.payload).slice(0, 4000);
  } catch {
    return "";
  }
}

export async function getClawCloudGmailMessages(
  userId: string,
  options: { query?: string; maxResults?: number } = {},
): Promise<GmailMessage[]> {
  const accessToken = await getValidGoogleAccessToken(userId, "gmail");
  const query = options.query ?? "is:unread";
  const maxResults = options.maxResults ?? 20;

  const listResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const listJson = (await listResponse.json()) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };

  if (!listResponse.ok) {
    throwGoogleApiPermissionAwareError(
      listJson.error?.message || "Failed to read Gmail messages.",
      "Failed to read Gmail messages.",
      ["gmail"],
    );
  }

  if (!Array.isArray(listJson.messages) || listJson.messages.length === 0) {
    return [];
  }

  const messages = await Promise.all(
    listJson.messages.slice(0, maxResults).map(async ({ id }) => {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=Reply-To`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const json = (await response.json().catch(() => ({}))) as {
        id: string;
        threadId: string;
        snippet?: string;
        labelIds?: string[];
        error?: { message?: string };
        payload?: {
          headers?: Array<{ name?: string; value?: string }>;
        };
      };

      if (!response.ok) {
        const errorMessage = json.error?.message || "Failed to read Gmail message details.";
        if (hasGooglePermissionScopeError(errorMessage)) {
          throw createClawCloudGoogleApiError(
            errorMessage,
            "Failed to read Gmail message details.",
            ["gmail"],
          );
        }
        return {
          id,
          threadId: "",
          messageId: "",
          from: "",
          to: "",
          subject: "",
          date: "",
          replyTo: "",
          snippet: "",
          isRead: true,
          labels: [],
          body: "",
        };
      }

      const headers = json.payload?.headers ?? [];
      const readHeader = (name: string) =>
        headers.find((header) => header.name === name)?.value ?? "";

      return {
        id: json.id,
        threadId: json.threadId,
        messageId: readHeader("Message-ID"),
        from: readHeader("From"),
        to: readHeader("To"),
        subject: readHeader("Subject"),
        date: readHeader("Date"),
        replyTo: readHeader("Reply-To") || readHeader("From"),
        snippet: normalizeGoogleText(json.snippet ?? ""),
        isRead: !json.labelIds?.includes("UNREAD"),
        labels: json.labelIds ?? [],
        body: await getFullGmailBody(accessToken, json.id),
      };
    }),
  );

  return messages;
}

export async function createClawCloudGmailDraft(
  userId: string,
  input: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string | null;
  },
) {
  const accessToken = await getValidGoogleAccessToken(userId, "gmail");

  const rawLines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : "",
    input.inReplyTo ? `References: ${input.inReplyTo}` : "",
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ].filter(Boolean);

  const raw = Buffer.from(rawLines.join("\r\n")).toString("base64url");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: { raw },
    }),
  });

  const json = (await response.json()) as {
    id?: string;
    error?: { message?: string };
  };

  if (!response.ok || !json.id) {
    throwGoogleApiPermissionAwareError(
      json.error?.message || "Failed to create Gmail draft.",
      "Failed to create Gmail draft.",
      ["gmail"],
    );
  }

  return json.id;
}

export async function sendClawCloudGmailReply(
  userId: string,
  input: {
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string | null;
  },
) {
  const accessToken = await getValidGoogleAccessToken(userId, "gmail");

  const rawLines = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : "",
    input.inReplyTo ? `References: ${input.inReplyTo}` : "",
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
  ].filter(Boolean);

  const raw = Buffer.from(rawLines.join("\r\n")).toString("base64url");
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    id?: string;
    error?: { message?: string };
  };

  if (!response.ok || !json.id) {
    throwGoogleApiPermissionAwareError(
      json.error?.message || "Failed to send Gmail reply.",
      "Failed to send Gmail reply.",
      ["gmail"],
    );
  }

  return json.id;
}

export async function getClawCloudCalendarEvents(
  userId: string,
  options: {
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  } = {},
): Promise<CalendarEvent[]> {
  const accessToken = await getValidGoogleAccessToken(userId, "google_calendar");

  const params = new URLSearchParams({
    timeMin: options.timeMin ?? new Date().toISOString(),
    timeMax:
      options.timeMax ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    maxResults: String(options.maxResults ?? 10),
    singleEvents: "true",
    orderBy: "startTime",
  });
  params.set(
    "fields",
    "items(id,summary,start,end,location,hangoutLink,attendees,description)",
  );

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const message = await readGoogleApiErrorMessage(response, "Failed to read Calendar events.");
    throwGoogleApiPermissionAwareError(message, "Failed to read Calendar events.", ["google_calendar"]);
  }

  const json = (await response.json()) as { items?: CalendarEventPayload[] };
  return (json.items ?? []).map(normalizeCalendarEvent);
}

export async function createClawCloudCalendarEvent(
  userId: string,
  input: {
    summary: string;
    start: string;
    end: string;
    description?: string | null;
    location?: string | null;
    attendeeEmails?: string[];
    timeZone?: string | null;
  },
): Promise<CalendarEvent> {
  const accessToken = await getValidGoogleAccessToken(userId, "google_calendar");
  const payload = {
    summary: input.summary.trim() || "Untitled event",
    start: {
      dateTime: input.start,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    },
    end: {
      dateTime: input.end,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    },
    location: input.location?.trim() || undefined,
    description: input.description?.trim() || undefined,
    attendees: (input.attendeeEmails ?? [])
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({ email })),
  };

  const response = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const message = await readGoogleApiErrorMessage(response, "Failed to create Calendar event.");
    throwGoogleApiPermissionAwareError(message, "Failed to create Calendar event.", ["google_calendar"]);
  }

  const json = (await response.json()) as CalendarEventPayload;
  return normalizeCalendarEvent(json);
}

export async function updateClawCloudCalendarEvent(
  userId: string,
  input: {
    eventId: string;
    summary?: string | null;
    start?: string | null;
    end?: string | null;
    description?: string | null;
    location?: string | null;
    attendeeEmails?: string[] | null;
    timeZone?: string | null;
  },
): Promise<CalendarEvent> {
  const accessToken = await getValidGoogleAccessToken(userId, "google_calendar");
  const payload: Record<string, unknown> = {};

  if (typeof input.summary === "string" && input.summary.trim()) {
    payload.summary = input.summary.trim();
  }
  if (typeof input.start === "string" && input.start.trim()) {
    payload.start = {
      dateTime: input.start,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    };
  }
  if (typeof input.end === "string" && input.end.trim()) {
    payload.end = {
      dateTime: input.end,
      ...(input.timeZone ? { timeZone: input.timeZone } : {}),
    };
  }
  if (input.description !== undefined) {
    payload.description = input.description?.trim() || null;
  }
  if (input.location !== undefined) {
    payload.location = input.location?.trim() || null;
  }
  if (input.attendeeEmails !== undefined) {
    payload.attendees = (input.attendeeEmails ?? [])
      .map((email) => email.trim())
      .filter(Boolean)
      .map((email) => ({ email }));
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const message = await readGoogleApiErrorMessage(response, "Failed to update Calendar event.");
    throwGoogleApiPermissionAwareError(message, "Failed to update Calendar event.", ["google_calendar"]);
  }

  const json = (await response.json()) as CalendarEventPayload;
  return normalizeCalendarEvent(json);
}

export async function deleteClawCloudCalendarEvent(userId: string, eventId: string) {
  const accessToken = await getValidGoogleAccessToken(userId, "google_calendar");
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    const message = await readGoogleApiErrorMessage(response, "Failed to delete Calendar event.");
    throwGoogleApiPermissionAwareError(message, "Failed to delete Calendar event.", ["google_calendar"]);
  }

  return true;
}

export async function modifyClawCloudGmailMessage(
  userId: string,
  input: {
    messageId: string;
    addLabelIds?: string[];
    removeLabelIds?: string[];
  },
) {
  const accessToken = await getValidGoogleAccessToken(userId, "gmail");
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(input.messageId)}/modify`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        addLabelIds: input.addLabelIds ?? [],
        removeLabelIds: input.removeLabelIds ?? [],
      }),
    },
  );

  if (!response.ok) {
    const message = await readGoogleApiErrorMessage(response, "Failed to update Gmail message.");
    throwGoogleApiPermissionAwareError(message, "Failed to update Gmail message.", ["gmail"]);
  }

  return true;
}
