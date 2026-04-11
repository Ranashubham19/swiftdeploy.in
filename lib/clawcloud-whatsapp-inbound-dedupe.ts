export type InboundMessageDedupOptions = {
  now?: number;
  ttlMs?: number;
  maxEntries?: number;
};

const INBOUND_FALLBACK_DEDUPE_BUCKET_MS = 15_000;

function cleanInboundDedupText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

export function rememberRecentMessageDedupKey(
  cache: Map<string, number>,
  messageKey: string | null | undefined,
  options: InboundMessageDedupOptions = {},
) {
  const normalizedKey = String(messageKey ?? "").trim();
  if (!normalizedKey) {
    return;
  }

  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  pruneInboundMessageDedupCache(cache, {
    ...options,
    now,
    ttlMs,
  });
  cache.set(normalizedKey, now);
}

export function hasRecentMessageDedupKey(
  cache: Map<string, number>,
  messageKey: string | null | undefined,
  options: InboundMessageDedupOptions = {},
) {
  const normalizedKey = String(messageKey ?? "").trim();
  if (!normalizedKey) {
    return false;
  }

  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  pruneInboundMessageDedupCache(cache, {
    ...options,
    now,
    ttlMs,
  });

  const seenAt = cache.get(normalizedKey);
  return typeof seenAt === "number" && now - seenAt <= ttlMs;
}

export function buildInboundMessageDedupKey(input: {
  messageId?: string | null;
  remoteJid?: string | null;
  fromMe?: boolean | null;
  messageType?: string | null;
  contentPreview?: string | null;
  timestampMs?: number | null;
}) {
  const normalizedId = cleanInboundDedupText(input.messageId);
  if (normalizedId) {
    return normalizedId;
  }

  const remoteJid = cleanInboundDedupText(input.remoteJid);
  const messageType = cleanInboundDedupText(input.messageType);
  const contentPreview = cleanInboundDedupText(input.contentPreview) || "empty";
  const timestampMs = typeof input.timestampMs === "number" && Number.isFinite(input.timestampMs)
    ? Math.max(0, Math.trunc(input.timestampMs))
    : 0;
  const bucket = timestampMs > 0
    ? Math.floor(timestampMs / INBOUND_FALLBACK_DEDUPE_BUCKET_MS).toString(36)
    : "no-ts";

  return [
    "fallback",
    input.fromMe ? "from_me" : "from_remote",
    remoteJid || "unknown-jid",
    messageType || "unknown-type",
    bucket,
    contentPreview,
  ].join("|");
}

export function hasReplyEligibleInboundPayload(input: {
  message?: {
    conversation?: string | null;
    extendedTextMessage?: { text?: string | null } | null;
    imageMessage?: unknown;
    audioMessage?: unknown;
    documentMessage?: unknown;
    videoMessage?: unknown;
    locationMessage?: unknown;
    contactMessage?: unknown;
    reactionMessage?: unknown;
    stickerMessage?: unknown;
  } | null;
}) {
  const payload = input.message;
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const textCandidates = [
    payload.conversation,
    payload.extendedTextMessage?.text,
  ];
  if (textCandidates.some((value) => String(value ?? "").trim().length > 0)) {
    return true;
  }

  return Boolean(
    payload.imageMessage
    || payload.audioMessage
    || payload.documentMessage
    || payload.videoMessage
    || payload.locationMessage
    || payload.contactMessage
    || payload.reactionMessage
    || payload.stickerMessage
  );
}

export function buildAssistantSelfReplyEchoKey(input: {
  targetJid?: string | null;
  messageText?: string | null;
}) {
  const targetJid = cleanInboundDedupText(input.targetJid);
  const messageText = cleanInboundDedupText(input.messageText).toLowerCase();
  if (!messageText) {
    return "";
  }

  return [
    "assistant-self-reply",
    targetJid || "unknown-jid",
    messageText,
  ].join("|");
}

export function pruneInboundMessageDedupCache(
  cache: Map<string, number>,
  options: InboundMessageDedupOptions = {},
) {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? 10 * 60_000;
  const maxEntries = options.maxEntries ?? 10_000;

  if (cache.size <= maxEntries) {
    for (const [id, seenAt] of cache) {
      if (now - seenAt > ttlMs) {
        cache.delete(id);
      }
    }
    return;
  }

  const entries = [...cache.entries()].sort((a, b) => a[1] - b[1]);
  const trimmed = entries.slice(-Math.floor(maxEntries * 0.75));
  cache.clear();
  for (const [id, ts] of trimmed) {
    cache.set(id, ts);
  }
}

export function registerInboundMessageId(
  cache: Map<string, number>,
  messageId: string | null | undefined,
  options: InboundMessageDedupOptions = {},
) {
  const normalizedId = String(messageId ?? "").trim();
  if (!normalizedId) {
    return true;
  }

  if (hasRecentMessageDedupKey(cache, normalizedId, options)) {
    return false;
  }

  rememberRecentMessageDedupKey(cache, normalizedId, options);
  return true;
}
