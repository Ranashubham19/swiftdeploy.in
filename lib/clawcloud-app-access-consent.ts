import crypto from "node:crypto";

import { env } from "@/lib/env";
import { isClawCloudMissingSchemaMessage } from "@/lib/clawcloud-schema-compat";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type AppAccessSurface = "gmail" | "google_calendar" | "google_drive" | "whatsapp";
export type AppAccessOperation = "read" | "write";
export type AppAccessConsentStatus = "pending" | "approved" | "denied";

type AppAccessConsentPayload = {
  v: 1;
  userId: string;
  surface: AppAccessSurface;
  operation: AppAccessOperation;
  summary: string;
  originalMessage: string;
  issuedAt: string;
  expiresAt: string;
};

export type AppAccessConsentRequest = {
  token: string;
  surface: AppAccessSurface;
  operation: AppAccessOperation;
  summary: string;
  prompt: string;
  issuedAt: string;
  expiresAt: string;
  yesLabel: string;
  noLabel: string;
};

const APP_ACCESS_CONSENT_TTL_MS = 10 * 60 * 1000;
const APP_ACCESS_CONSENT_TABLE = "app_access_consents";
const LEGACY_APP_ACCESS_CONSENT_PREFIX = "app-access-consent";
const recentConsentRequests = new Map<
  string,
  {
    request: AppAccessConsentRequest;
    originalMessage: string;
    expiresAtMs: number;
  }
>();

type StoredAppAccessConsent = {
  request: AppAccessConsentRequest;
  originalMessage: string;
  expiresAtMs: number;
};

type AppAccessConsentStoreOptions = {
  persist?: boolean;
};

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getAppAccessConsentSecret() {
  const secret = (
    env.AGENT_SECRET
    || env.CRON_SECRET
    || env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!secret) {
    throw new Error("App access consent secret is not configured.");
  }

  return secret;
}

function signPayload(encodedPayload: string) {
  return crypto
    .createHmac("sha256", getAppAccessConsentSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function getSurfaceLabel(surface: AppAccessSurface) {
  switch (surface) {
    case "gmail":
      return "Gmail";
    case "google_calendar":
      return "Google Calendar";
    case "google_drive":
      return "Google Drive";
    case "whatsapp":
      return "WhatsApp";
  }
}

function getOperationLabel(operation: AppAccessOperation) {
  return operation === "write" ? "make changes in" : "read from";
}

export function buildAppAccessConsentSummary(
  surface: AppAccessSurface,
  operation: AppAccessOperation,
) {
  switch (surface) {
    case "gmail":
      return operation === "write"
        ? "make changes in your Gmail"
        : "read from your Gmail";
    case "google_calendar":
      return operation === "write"
        ? "make changes in your Google Calendar"
        : "read from your Google Calendar";
    case "google_drive":
      return operation === "write"
        ? "make changes in your Google Drive files"
        : "read from your Google Drive files";
    case "whatsapp":
      return operation === "write"
        ? "use your WhatsApp to send or reply"
        : "read from your WhatsApp";
  }
}

export function buildAppAccessConsentPrompt(
  surface: AppAccessSurface,
  operation: AppAccessOperation,
) {
  const summary = buildAppAccessConsentSummary(surface, operation);
  return [
    "Security check",
    "",
    `You asked me to ${summary} for this request.`,
    "",
    "Grant one-time access?",
    'Reply "Yes" to continue or "No" to cancel.',
    "In the dashboard, you can also approve it with one tap.",
  ].join("\n");
}

export function buildAppAccessDeniedReply(
  surface: AppAccessSurface,
  operation: AppAccessOperation = "read",
) {
  return [
    "Access not granted",
    "",
    `I did not ${operation === "write" ? "use" : "open"} ${getSurfaceLabel(surface)} for that request.`,
    "Ask again any time when you want to continue.",
  ].join("\n");
}

export function buildAppAccessExpiredReply() {
  return [
    "This security approval expired.",
    "",
    "Please ask the original request again so I can create a fresh approval prompt.",
  ].join("\n");
}

export function createAppAccessConsentRequest(input: {
  userId: string;
  surface: AppAccessSurface;
  operation: AppAccessOperation;
  summary?: string;
  originalMessage: string;
}) {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + APP_ACCESS_CONSENT_TTL_MS).toISOString();
  const summary =
    input.summary?.trim() || buildAppAccessConsentSummary(input.surface, input.operation);
  const payload: AppAccessConsentPayload = {
    v: 1,
    userId: input.userId,
    surface: input.surface,
    operation: input.operation,
    summary,
    originalMessage: input.originalMessage,
    issuedAt,
    expiresAt,
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const token = `${encodedPayload}.${signPayload(encodedPayload)}`;

  return {
    token,
    surface: input.surface,
    operation: input.operation,
    summary,
    prompt: buildAppAccessConsentPrompt(input.surface, input.operation),
    issuedAt,
    expiresAt,
    yesLabel: "Yes",
    noLabel: "No",
  } satisfies AppAccessConsentRequest;
}

export function verifyAppAccessConsentToken(
  token: string,
  userId: string,
): AppAccessConsentPayload | null {
  const [encodedPayload, signature] = token.trim().split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);
  const provided = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (
    provided.length !== expected.length
    || !crypto.timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<AppAccessConsentPayload>;
    if (
      parsed.v !== 1
      || parsed.userId !== userId
      || typeof parsed.originalMessage !== "string"
      || typeof parsed.summary !== "string"
      || !parsed.surface
      || !parsed.operation
      || !parsed.expiresAt
      || !parsed.issuedAt
    ) {
      return null;
    }

    const expiresAt = new Date(parsed.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      return null;
    }

    return {
      v: 1,
      userId,
      surface: parsed.surface,
      operation: parsed.operation,
      summary: parsed.summary,
      originalMessage: parsed.originalMessage,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

function isApprovalMessage(message: string) {
  return /^(yes|y|allow|approve)$/i.test(message.trim());
}

function isDenialMessage(message: string) {
  return /^(no|n|deny|cancel)$/i.test(message.trim());
}

function shouldPersistLatestAppAccessConsent(options?: AppAccessConsentStoreOptions) {
  return options?.persist !== false && Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function buildLegacyAppAccessConsentRowId(userId: string) {
  return `${LEGACY_APP_ACCESS_CONSENT_PREFIX}:${userId}`;
}

function isPendingStoredConsent(consent: StoredAppAccessConsent | null | undefined) {
  return Boolean(
    consent
    && Number.isFinite(consent.expiresAtMs)
    && consent.expiresAtMs > Date.now(),
  );
}

function normalizeStoredAppAccessConsent(
  userId: string,
  value: unknown,
  fallbackOriginalMessage?: unknown,
): StoredAppAccessConsent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt : "";
  const surface = raw.surface;
  const operation = raw.operation;
  const summary = typeof raw.summary === "string" ? raw.summary : "";
  const issuedAt = typeof raw.issuedAt === "string" ? raw.issuedAt : "";
  const expiresAt = typeof raw.expiresAt === "string" ? raw.expiresAt : "";
  const yesLabel =
    typeof raw.yesLabel === "string" && raw.yesLabel.trim() ? raw.yesLabel.trim() : "Yes";
  const noLabel =
    typeof raw.noLabel === "string" && raw.noLabel.trim() ? raw.noLabel.trim() : "No";

  if (
    !token
    || !prompt
    || !summary
    || !issuedAt
    || !expiresAt
    || (surface !== "gmail" && surface !== "google_calendar" && surface !== "google_drive" && surface !== "whatsapp")
    || (operation !== "read" && operation !== "write")
  ) {
    return null;
  }

  const verified = verifyAppAccessConsentToken(token, userId);
  if (!verified) {
    return null;
  }

  const originalMessage = typeof fallbackOriginalMessage === "string" && fallbackOriginalMessage.trim()
    ? fallbackOriginalMessage.trim()
    : verified.originalMessage;
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!originalMessage || !Number.isFinite(expiresAtMs)) {
    return null;
  }

  return {
    request: {
      token,
      prompt,
      surface,
      operation,
      summary,
      issuedAt,
      expiresAt,
      yesLabel,
      noLabel,
    },
    originalMessage,
    expiresAtMs,
  };
}

function storedConsentToLegacyPayload(consent: StoredAppAccessConsent) {
  return {
    kind: "app_access_consent",
    request: consent.request,
    originalMessage: consent.originalMessage,
  };
}

function storedConsentFromLegacyPayload(userId: string, payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (record.kind !== "app_access_consent") {
    return null;
  }

  return normalizeStoredAppAccessConsent(
    userId,
    record.request,
    record.originalMessage,
  );
}

async function loadPersistedLatestAppAccessConsent(userId: string) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from(APP_ACCESS_CONSENT_TABLE)
    .select("request, original_message")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isClawCloudMissingSchemaMessage(error.message)) {
      const legacy = await supabaseAdmin
        .from("chat_threads")
        .select("active_result")
        .eq("id", buildLegacyAppAccessConsentRowId(userId))
        .eq("user_id", userId)
        .maybeSingle()
        .catch(() => ({ data: null }));

      const normalizedLegacy = storedConsentFromLegacyPayload(userId, legacy.data?.active_result);
      if (normalizedLegacy) {
        return normalizedLegacy;
      }

      if (legacy.data?.active_result) {
        await supabaseAdmin
          .from("chat_threads")
          .delete()
          .eq("id", buildLegacyAppAccessConsentRowId(userId))
          .eq("user_id", userId)
          .catch(() => undefined);
      }

      return null;
    }

    return null;
  }

  const normalized = normalizeStoredAppAccessConsent(
    userId,
    data?.request,
    data?.original_message,
  );
  if (normalized) {
    return normalized;
  }

  if (data) {
    await supabaseAdmin
      .from(APP_ACCESS_CONSENT_TABLE)
      .delete()
      .eq("user_id", userId)
      .catch(() => undefined);
  }

  return null;
}

async function persistLatestAppAccessConsent(userId: string, consent: StoredAppAccessConsent) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from(APP_ACCESS_CONSENT_TABLE)
    .upsert(
      {
        user_id: userId,
        request: consent.request,
        original_message: consent.originalMessage,
        expires_at: consent.request.expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (!error) {
    return;
  }

  if (!isClawCloudMissingSchemaMessage(error.message)) {
    return;
  }

  await supabaseAdmin
    .from("chat_threads")
    .upsert({
      id: buildLegacyAppAccessConsentRowId(userId),
      user_id: userId,
      title: "App access consent",
      updated_at: consent.request.issuedAt,
      messages: [],
      progress: [],
      sources: [],
      active_result: storedConsentToLegacyPayload(consent),
    })
    .catch(() => undefined);
}

async function clearPersistedLatestAppAccessConsent(userId: string, token?: string | null) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  const current = await loadPersistedLatestAppAccessConsent(userId).catch(() => null);
  if (!current) {
    return;
  }

  if (token && current.request.token !== token) {
    return;
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from(APP_ACCESS_CONSENT_TABLE)
    .delete()
    .eq("user_id", userId);

  if (!error) {
    return;
  }

  if (!isClawCloudMissingSchemaMessage(error.message)) {
    return;
  }

  await supabaseAdmin
    .from("chat_threads")
    .delete()
    .eq("id", buildLegacyAppAccessConsentRowId(userId))
    .eq("user_id", userId)
    .catch(() => undefined);
}

export async function rememberLatestAppAccessConsent(
  userId: string,
  request: AppAccessConsentRequest,
  originalMessage: string,
  options?: AppAccessConsentStoreOptions,
) {
  const storedConsent = {
    request,
    originalMessage,
    expiresAtMs: new Date(request.expiresAt).getTime(),
  } satisfies StoredAppAccessConsent;

  recentConsentRequests.set(userId, storedConsent);

  if (!shouldPersistLatestAppAccessConsent(options)) {
    return;
  }

  await persistLatestAppAccessConsent(userId, storedConsent).catch(() => undefined);
}

export async function clearLatestAppAccessConsent(
  userId: string,
  token?: string | null,
  options?: AppAccessConsentStoreOptions,
) {
  const pending = recentConsentRequests.get(userId);
  if (!token || pending?.request.token === token) {
    recentConsentRequests.delete(userId);
  }

  if (!shouldPersistLatestAppAccessConsent(options)) {
    return;
  }

  await clearPersistedLatestAppAccessConsent(userId, token).catch(() => undefined);
}

export async function resolveLatestAppAccessConsentDecision(
  userId: string,
  message: string,
  options?: AppAccessConsentStoreOptions,
) {
  if (!isApprovalMessage(message) && !isDenialMessage(message)) {
    return null;
  }

  let pending = recentConsentRequests.get(userId) ?? null;
  if (!isPendingStoredConsent(pending)) {
    recentConsentRequests.delete(userId);
    pending = shouldPersistLatestAppAccessConsent(options)
      ? await loadPersistedLatestAppAccessConsent(userId).catch(() => null)
      : null;
  }

  if (!pending) {
    return null;
  }

  if (!isPendingStoredConsent(pending)) {
    recentConsentRequests.delete(userId);
    if (shouldPersistLatestAppAccessConsent(options)) {
      await clearPersistedLatestAppAccessConsent(userId, pending.request.token).catch(() => undefined);
    }
    return null;
  }

  recentConsentRequests.delete(userId);
  if (shouldPersistLatestAppAccessConsent(options)) {
    await clearPersistedLatestAppAccessConsent(userId, pending.request.token).catch(() => undefined);
  }

  return {
    decision: isApprovalMessage(message) ? "approve" : "deny",
    request: pending.request,
    originalMessage: pending.originalMessage,
  } as const;
}
