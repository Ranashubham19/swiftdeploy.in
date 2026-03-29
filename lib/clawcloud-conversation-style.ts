import crypto from "node:crypto";

import { env } from "@/lib/env";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type ClawCloudConversationStyle = "professional" | "casual";

type ConversationStylePayload = {
  v: 1;
  userId: string;
  originalMessage: string;
  issuedAt: string;
  expiresAt: string;
};

export type ClawCloudConversationStyleRequest = {
  token: string;
  prompt: string;
  issuedAt: string;
  expiresAt: string;
  professionalLabel: string;
  casualLabel: string;
};

type StoredConversationStyleRequest = {
  request: ClawCloudConversationStyleRequest;
  originalMessage: string;
  expiresAtMs: number;
};

const CONVERSATION_STYLE_TTL_MS = 10 * 60 * 1000;
const LEGACY_CONVERSATION_STYLE_PREFIX = "conversation-style-request";
const CONVERSATION_STYLE_MARKER_RE = /^\[\[clawcloud-style:(professional|casual)\]\]\s*/i;
const latestConversationStyleRequests = new Map<string, StoredConversationStyleRequest>();

function encodeBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getConversationStyleSecret() {
  const secret = (
    env.AGENT_SECRET
    || env.CRON_SECRET
    || env.SUPABASE_SERVICE_ROLE_KEY
  )?.trim();

  if (!secret) {
    throw new Error("Conversation style secret is not configured.");
  }

  return secret;
}

function signPayload(encodedPayload: string) {
  return crypto
    .createHmac("sha256", getConversationStyleSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function buildLegacyConversationStyleRowId(userId: string) {
  return `${LEGACY_CONVERSATION_STYLE_PREFIX}:${userId}`;
}

function buildConversationStylePrompt() {
  return [
    "Choose how I should talk for this request",
    "",
    "Same ClawCloud functionality. Two different conversation styles.",
    "",
    "Professional",
    "Polished, composed, structured, and more formal.",
    "",
    "Casual",
    "Natural, human, adaptive, and more relaxed.",
    "",
    'Reply "Professional" or "Casual" to continue.',
  ].join("\n");
}

export function buildConversationStyleInstruction(style: ClawCloudConversationStyle) {
  if (style === "casual") {
    return [
      "Conversation style selected: Casual.",
      "Keep the same accuracy, capability, and safety standards, but sound more natural, human, adaptive, and relaxed.",
      "Use clean conversational prose instead of stiff formal phrasing. Do not become sloppy, vague, or unserious.",
    ].join("\n");
  }

  return [
    "Conversation style selected: Professional.",
    "Keep the same accuracy, capability, and safety standards, but answer in a polished, composed, structured, more formal style.",
    "Sound like a calm senior expert: direct, precise, warm, and composed.",
    "Answer first, then add context. Do not sound slangy, overly chatty, loose, or hedge before the main answer.",
  ].join("\n");
}

export function embedConversationStyleInMessage(
  style: ClawCloudConversationStyle,
  message: string,
) {
  return `[[clawcloud-style:${style}]] ${message.trim()}`;
}

export function extractEmbeddedConversationStyle(message: string): {
  style: ClawCloudConversationStyle | null;
  cleaned: string;
} {
  const trimmed = message.trim();
  const match = trimmed.match(CONVERSATION_STYLE_MARKER_RE);
  if (!match) {
    return {
      style: null,
      cleaned: trimmed,
    };
  }

  return {
    style: match[1]?.toLowerCase() === "casual" ? "casual" : "professional",
    cleaned: trimmed.replace(CONVERSATION_STYLE_MARKER_RE, "").trim(),
  };
}

export function createConversationStyleRequest(input: {
  userId: string;
  originalMessage: string;
}) {
  const issuedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CONVERSATION_STYLE_TTL_MS).toISOString();
  const payload: ConversationStylePayload = {
    v: 1,
    userId: input.userId,
    originalMessage: input.originalMessage,
    issuedAt,
    expiresAt,
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const token = `${encodedPayload}.${signPayload(encodedPayload)}`;

  return {
    token,
    prompt: buildConversationStylePrompt(),
    issuedAt,
    expiresAt,
    professionalLabel: "Professional",
    casualLabel: "Casual",
  } satisfies ClawCloudConversationStyleRequest;
}

export function verifyConversationStyleToken(
  token: string,
  userId: string,
): ConversationStylePayload | null {
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
    const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as Partial<ConversationStylePayload>;
    if (
      parsed.v !== 1
      || parsed.userId !== userId
      || typeof parsed.originalMessage !== "string"
      || typeof parsed.issuedAt !== "string"
      || typeof parsed.expiresAt !== "string"
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
      originalMessage: parsed.originalMessage,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function parseConversationStyleChoice(
  message: string,
): ClawCloudConversationStyle | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/^(professional|pro|formal|professional one|professional mode)$/.test(normalized)) {
    return "professional";
  }

  if (/^(casual|casual one|casual mode|human|human tone|normal)$/.test(normalized)) {
    return "casual";
  }

  return null;
}

export function detectExplicitConversationStyleOverride(
  message: string,
): ClawCloudConversationStyle | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (
    /^(professional|casual)\s*:/i.test(message)
    || /\b(?:talk|reply|respond|answer|write|speak)\s+(?:(?:to|with)\s+me\s+)?(?:in|with|using)\s+(?:a\s+)?professional(?:\s+(?:tone|style|way|mode))?\b/i.test(message)
  ) {
    return "professional";
  }

  if (/\b(?:talk|reply|respond|answer|write|speak)\s+(?:(?:to|with)\s+me\s+)?(?:in|with|using)\s+(?:a\s+)?casual(?:\s+(?:tone|style|way|mode))?\b/i.test(message)) {
    return "casual";
  }

  return null;
}

function shouldPersistConversationStyleRequest() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

async function loadPersistedConversationStyleRequest(userId: string) {
  if (!shouldPersistConversationStyleRequest()) {
    return null;
  }

  const { data } = await getClawCloudSupabaseAdmin()
    .from("chat_threads")
    .select("active_result")
    .eq("id", buildLegacyConversationStyleRowId(userId))
    .eq("user_id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  const raw = data?.active_result as Record<string, unknown> | null | undefined;
  if (!raw || raw.kind !== "conversation_style_request") {
    return null;
  }

  const request = raw.request as Record<string, unknown> | undefined;
  const originalMessage = typeof raw.originalMessage === "string" ? raw.originalMessage : "";
  if (!request || !originalMessage) {
    return null;
  }

  const token = typeof request.token === "string" ? request.token : "";
  const prompt = typeof request.prompt === "string" ? request.prompt : "";
  const issuedAt = typeof request.issuedAt === "string" ? request.issuedAt : "";
  const expiresAt = typeof request.expiresAt === "string" ? request.expiresAt : "";
  const professionalLabel =
    typeof request.professionalLabel === "string" && request.professionalLabel.trim()
      ? request.professionalLabel
      : "Professional";
  const casualLabel =
    typeof request.casualLabel === "string" && request.casualLabel.trim()
      ? request.casualLabel
      : "Casual";

  if (!token || !prompt || !issuedAt || !expiresAt) {
    return null;
  }

  const verified = verifyConversationStyleToken(token, userId);
  if (!verified) {
    return null;
  }

  return {
    request: {
      token,
      prompt,
      issuedAt,
      expiresAt,
      professionalLabel,
      casualLabel,
    },
    originalMessage,
    expiresAtMs: new Date(expiresAt).getTime(),
  } satisfies StoredConversationStyleRequest;
}

async function persistConversationStyleRequest(
  userId: string,
  stored: StoredConversationStyleRequest,
) {
  if (!shouldPersistConversationStyleRequest()) {
    return;
  }

  await getClawCloudSupabaseAdmin()
    .from("chat_threads")
    .upsert({
      id: buildLegacyConversationStyleRowId(userId),
      user_id: userId,
      title: "Conversation style request",
      updated_at: stored.request.issuedAt,
      messages: [],
      progress: [],
      sources: [],
      active_result: {
        kind: "conversation_style_request",
        request: stored.request,
        originalMessage: stored.originalMessage,
      },
    })
    .catch(() => undefined);
}

async function clearPersistedConversationStyleRequest(userId: string, token?: string | null) {
  if (!shouldPersistConversationStyleRequest()) {
    return;
  }

  if (token) {
    const current = await loadPersistedConversationStyleRequest(userId).catch(() => null);
    if (current?.request.token !== token) {
      return;
    }
  }

  await getClawCloudSupabaseAdmin()
    .from("chat_threads")
    .delete()
    .eq("id", buildLegacyConversationStyleRowId(userId))
    .eq("user_id", userId)
    .catch(() => undefined);
}

export async function rememberLatestConversationStyleRequest(
  userId: string,
  request: ClawCloudConversationStyleRequest,
  originalMessage: string,
) {
  const stored = {
    request,
    originalMessage,
    expiresAtMs: new Date(request.expiresAt).getTime(),
  } satisfies StoredConversationStyleRequest;

  latestConversationStyleRequests.set(userId, stored);
  await persistConversationStyleRequest(userId, stored).catch(() => undefined);
}

export async function clearLatestConversationStyleRequest(
  userId: string,
  token?: string | null,
) {
  const current = latestConversationStyleRequests.get(userId);
  if (!token || current?.request.token === token) {
    latestConversationStyleRequests.delete(userId);
  }

  await clearPersistedConversationStyleRequest(userId, token).catch(() => undefined);
}

export async function resolveLatestConversationStyleDecision(
  userId: string,
  message: string,
) {
  const selection = parseConversationStyleChoice(message);
  let pending = latestConversationStyleRequests.get(userId) ?? null;

  if (!selection) {
    if (pending && pending.expiresAtMs <= Date.now()) {
      latestConversationStyleRequests.delete(userId);
    }
    return null;
  }

  if ((!pending || pending.expiresAtMs <= Date.now()) && shouldPersistConversationStyleRequest()) {
    pending = await loadPersistedConversationStyleRequest(userId).catch(() => null);
    if (pending) {
      latestConversationStyleRequests.set(userId, pending);
    }
  }

  if (!pending || pending.expiresAtMs <= Date.now()) {
    if (pending) {
      latestConversationStyleRequests.delete(userId);
      await clearPersistedConversationStyleRequest(userId, pending.request.token).catch(() => undefined);
    }
    return null;
  }

  latestConversationStyleRequests.delete(userId);
  await clearPersistedConversationStyleRequest(userId, pending.request.token).catch(() => undefined);

  return {
    style: selection,
    token: pending.request.token,
    originalMessage: pending.originalMessage,
  };
}
