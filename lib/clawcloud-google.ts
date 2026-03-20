import { env } from "@/lib/env";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import type { ClawCloudProvider } from "@/lib/clawcloud-types";

export type GoogleWorkspaceScopeSet = "core" | "extended";
type GoogleConnectedProvider = Extract<ClawCloudProvider, "gmail" | "google_calendar" | "google_drive">;

const googleWorkspaceCoreScopes = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "email",
  "profile",
] as const;

const googleWorkspaceExtendedScopes = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

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

type ConnectedGoogleAccount = {
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
};

type GmailMessage = {
  id: string;
  threadId: string;
  messageId: string;
  from: string;
  subject: string;
  date: string;
  replyTo: string;
  snippet: string;
  isRead: boolean;
  labels: string[];
  body: string;
};

type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
  location: string | null;
  hangoutLink: string | null;
  attendees: Array<{ email?: string | null; displayName?: string | null }>;
  description: string | null;
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

export function buildGoogleReconnectRequiredReply(serviceLabel = "Google Workspace") {
  return [
    `*${serviceLabel} needs to be reconnected.*`,
    "",
    "The saved Google connection is no longer valid for this account.",
    "Reconnect Google at *swift-deploy.in/settings* and try again.",
  ].join("\n");
}

function normalizeOrigin(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function getGoogleRedirectUri(requestOrigin?: string) {
  const configuredRedirectUri = normalizeOrigin(env.GOOGLE_REDIRECT_URI);
  if (configuredRedirectUri) {
    return configuredRedirectUri;
  }

  const configuredAppUrl = normalizeOrigin(env.NEXT_PUBLIC_APP_URL);
  if (configuredAppUrl) {
    return `${configuredAppUrl}/api/auth/google/callback`;
  }

  const liveOrigin = normalizeOrigin(requestOrigin);
  if (liveOrigin) {
    return `${liveOrigin}/api/auth/google/callback`;
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

function buildGoogleWorkspaceState(userId: string, scopeSet: GoogleWorkspaceScopeSet) {
  return `workspace:${scopeSet}:${userId}`;
}

export function parseClawCloudGoogleWorkspaceState(state: string) {
  const trimmed = state.trim();
  const match = trimmed.match(/^workspace:(core|extended):(.+)$/i);
  if (match) {
    return {
      userId: match[2].trim(),
      scopeSet: match[1].toLowerCase() as GoogleWorkspaceScopeSet,
    };
  }

  // Backward compatibility for previously-issued auth URLs that stored only the user id.
  return {
    userId: trimmed,
    scopeSet: "extended" as GoogleWorkspaceScopeSet,
  };
}

function getGoogleWorkspaceScopes(scopeSet: GoogleWorkspaceScopeSet) {
  return scopeSet === "extended"
    ? [...googleWorkspaceCoreScopes, ...googleWorkspaceExtendedScopes]
    : [...googleWorkspaceCoreScopes];
}

export function buildClawCloudGoogleAuthUrl(
  userId: string,
  requestOrigin?: string,
  scopeSet: GoogleWorkspaceScopeSet = "core",
) {
  assertGoogleOAuthConfigured(requestOrigin);
  const redirectUri = getGoogleRedirectUri(requestOrigin);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: getGoogleWorkspaceScopes(scopeSet).join(" "),
    state: buildGoogleWorkspaceState(userId, scopeSet),
  });

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

  return data as ConnectedGoogleAccount;
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
      access_token: refreshed.accessToken,
      token_expiry: nextExpiry,
    })
    .eq("user_id", userId)
    .eq("provider", provider);

  return refreshed.accessToken;
}

function decodeGoogleBody(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function extractGoogleMessageBody(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const payloadRecord = payload as {
    body?: { data?: string | null };
    parts?: unknown[];
    mimeType?: string;
  };

  if (payloadRecord.body?.data) {
    return decodeGoogleBody(payloadRecord.body.data);
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
      return decodeGoogleBody((part as { body: { data: string } }).body.data);
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
  };

  if (!Array.isArray(listJson.messages) || listJson.messages.length === 0) {
    return [];
  }

  const messages = await Promise.all(
    listJson.messages.slice(0, maxResults).map(async ({ id }) => {
      const response = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID&metadataHeaders=Reply-To`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      const json = (await response.json()) as {
        id: string;
        threadId: string;
        snippet?: string;
        labelIds?: string[];
        payload?: {
          headers?: Array<{ name?: string; value?: string }>;
        };
      };

      const headers = json.payload?.headers ?? [];
      const readHeader = (name: string) =>
        headers.find((header) => header.name === name)?.value ?? "";

      return {
        id: json.id,
        threadId: json.threadId,
        messageId: readHeader("Message-ID"),
        from: readHeader("From"),
        subject: readHeader("Subject"),
        date: readHeader("Date"),
        replyTo: readHeader("Reply-To") || readHeader("From"),
        snippet: json.snippet ?? "",
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
    throw new Error(json.error?.message || "Failed to create Gmail draft.");
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
    throw new Error(json.error?.message || "Failed to send Gmail reply.");
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
  let accessToken = "";

  try {
    accessToken = await getValidGoogleAccessToken(userId, "google_calendar");
  } catch {
    return [];
  }

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

  const json = (await response.json()) as {
    items?: Array<{
      id?: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      location?: string;
      hangoutLink?: string;
      attendees?: Array<{ email?: string | null; displayName?: string | null }>;
      description?: string;
    }>;
  };

  return (json.items ?? []).map((event) => ({
    id: event.id ?? "",
    summary: event.summary ?? "Untitled event",
    start: event.start?.dateTime || event.start?.date || "",
    end: event.end?.dateTime || event.end?.date || "",
    location: event.location ?? null,
    hangoutLink: event.hangoutLink ?? null,
    attendees: event.attendees ?? [],
    description: event.description ?? null,
  }));
}
