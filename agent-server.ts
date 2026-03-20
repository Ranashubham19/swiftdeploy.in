import express from "express";
import * as cron from "node-cron";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  Browsers,
  DisconnectReason,
  downloadContentFromMessage,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type Contact as WAContact,
  type MediaType,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient } from "@supabase/supabase-js";
import { transcribeAudioBuffer, isWhisperAvailable } from "./lib/clawcloud-whisper";
import { analyseImage, isVisionAvailable, formatVisionReply } from "./lib/clawcloud-vision";
import {
  detectImageGenIntent,
  extractImagePrompt,
  generateImage,
  isImageGenAvailable,
} from "./lib/clawcloud-imagegen";
import {
  buildDocumentQuestionPrompt,
  extractDocumentText,
  isSupportedDocument,
} from "./lib/clawcloud-docs";
import {
  buildVideoPromptFromMedia,
  isVideoProcessingAvailable,
} from "./lib/clawcloud-video";
import { handleUrlMessage, hasUrlIntent } from "./lib/clawcloud-url-reader";
import { detectCodeRunIntent, runUserCode } from "./lib/clawcloud-code-runner";
import {
  getActiveOnboardingState,
  handleOnboardingReply,
  isNewUserNeedingOnboarding,
  startOnboarding,
} from "./lib/clawcloud-onboarding-flow";
import {
  detectUpiSms,
  formatUpiSaveReply,
  parseUpiSms,
  saveUpiTransaction,
} from "./lib/clawcloud-upi";
import {
  upsertWhatsAppContacts,
  type WhatsAppContactSyncInput,
} from "./lib/clawcloud-whatsapp-contacts";
import { registerClawCloudWhatsAppRuntime } from "./lib/clawcloud-whatsapp";

loadEnvConfig(process.cwd());

const STALE_MS = 60_000;
const DIRECT_REPLY_TIMEOUT_MS = 50_000;
const HTTP_REPLY_TIMEOUT_MS = 55_000;
const STREAM_REPLY_MIN_LENGTH = 900;
const SESSION_WATCHDOG_STALE_MS = 3 * 60_000;
const SESSION_WATCHDOG_INTERVAL_MS = 5 * 60_000;
const MAX_SEND_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const;
const GROUP_RATE_LIMIT_MS = 8_000;

type SessionRecord = {
  sock: WASocket;
  status: "connecting" | "waiting" | "connected";
  qr: string | null;
  qrIssuedAt: number | null;
  phone: string | null;
  lastChatJid: string | null;
  startedAt: number;
  contacts: Map<string, SessionContactEntry>;
};

type SessionContactEntry = {
  jid: string;
  phone: string | null;
  displayName: string;
  aliases: string[];
  updatedAt: number;
};

type RouteInboundAgentMessageFn = (userId: string, message: string) => Promise<string | null>;

const sessions = new Map<string, SessionRecord>();
const outboundIds = new Set<string>();
const inboundIds = new Map<string, number>();
const groupLastReplyAt = new Map<string, number>();
let cachedRouteInboundAgentMessage: RouteInboundAgentMessageFn | null = null;

const INBOUND_ID_TTL_MS = 10 * 60_000;
const INBOUND_ID_MAX = 5_000;

function pruneInboundIdCache(now = Date.now()) {
  if (inboundIds.size <= INBOUND_ID_MAX) {
    for (const [id, seenAt] of inboundIds) {
      if (now - seenAt > INBOUND_ID_TTL_MS) {
        inboundIds.delete(id);
      }
    }
    return;
  }

  const entries = [...inboundIds.entries()].sort((a, b) => a[1] - b[1]);
  const keepFrom = Math.max(0, entries.length - INBOUND_ID_MAX);
  inboundIds.clear();
  for (let i = keepFrom; i < entries.length; i += 1) {
    const [id, ts] = entries[i];
    inboundIds.set(id, ts);
  }
}

function isGroupRateLimited(groupJid: string): boolean {
  const lastAt = groupLastReplyAt.get(groupJid);
  if (!lastAt) {
    return false;
  }

  return Date.now() - lastAt < GROUP_RATE_LIMIT_MS;
}

function markGroupReplied(groupJid: string): void {
  groupLastReplyAt.set(groupJid, Date.now());
}

function db() {
  return createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );
}

function appUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXTJS_URL?.trim();
  if (configured) return configured;

  const railwayDomain = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  if (railwayDomain) {
    return `https://${railwayDomain}`;
  }

  return "";
}

function isRailwayRuntime() {
  return Boolean(
    process.env.RAILWAY_PROJECT_ID
    || process.env.RAILWAY_ENVIRONMENT_ID
    || process.env.RAILWAY_SERVICE_ID,
  );
}

function sessionBaseDir() {
  const configured = process.env.WA_SESSION_DIR?.trim();
  if (configured) {
    if (path.isAbsolute(configured) || !isRailwayRuntime()) {
      return configured;
    }

    // Railway sessions need a mounted volume path; relative paths are ephemeral there.
    return "/data/wa-sessions";
  }

  return isRailwayRuntime() ? "/data/wa-sessions" : "./wa-sessions";
}

function looksLikeUserId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function savedSessionUserIds() {
  const base = sessionBaseDir();
  if (!fs.existsSync(base)) {
    return [];
  }

  try {
    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name.trim())
      .filter((entry) => looksLikeUserId(entry))
      .filter(Boolean);
  } catch (error) {
    console.error(
      "[agent] Could not inspect saved session dir:",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

const NVIDIA_ENV_KEYS = [
  "NVIDIA_API_KEY",
  "NVDIA_API_KEY",
  "NVDA_API_KEY",
  "NVIDIA_APIKEY",
  "NVIDIA_KEY",
  "NVIDIA_TOKEN",
] as const;

function normalizeSecretCandidate(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function looksLikeNvidiaApiKey(value: string) {
  const normalized = normalizeSecretCandidate(value).toLowerCase();
  return normalized.includes("nvapi-") && normalized.length >= 16;
}

function resolveNvidiaApiKey() {
  for (const key of NVIDIA_ENV_KEYS) {
    const value = normalizeSecretCandidate(process.env[key] ?? "");
    if (value && looksLikeNvidiaApiKey(value)) {
      return { key, value };
    }
  }

  for (const [key, raw] of Object.entries(process.env)) {
    const value = normalizeSecretCandidate(String(raw ?? ""));
    if (!value) continue;
    if (!/nvidia|nvda|nvdia|nvapi/i.test(key)) continue;
    if (looksLikeNvidiaApiKey(value)) {
      return { key, value };
    }
  }

  for (const [key, raw] of Object.entries(process.env)) {
    const value = normalizeSecretCandidate(String(raw ?? ""));
    if (looksLikeNvidiaApiKey(value)) {
      return { key: `(value_scan:${key})`, value };
    }
  }

  return { key: null as string | null, value: "" };
}

function ensureCanonicalNvidiaEnv() {
  const resolved = resolveNvidiaApiKey();
  if (!process.env.NVIDIA_API_KEY?.trim() && resolved.value) {
    process.env.NVIDIA_API_KEY = resolved.value;
  }
  return resolveNvidiaApiKey();
}

function getNvidiaEnvHints() {
  const hints: Array<{ key: string; hasValue: boolean; looksNvapi: boolean }> = [];
  const seen = new Set<string>();

  for (const key of Object.keys(process.env)) {
    if (!/nvidia|nvda|nvdia|nvapi/i.test(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    const value = normalizeSecretCandidate(String(process.env[key] ?? ""));
    hints.push({
      key,
      hasValue: Boolean(value),
      looksNvapi: looksLikeNvidiaApiKey(value),
    });
  }

  return hints.sort((a, b) => a.key.localeCompare(b.key));
}

function missingEnv() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AGENT_SECRET"].filter(
    (key) => !process.env[key]?.trim(),
  );
}

function configError() {
  const missing = missingEnv();
  return missing.length ? `Missing env vars: ${missing.join(", ")}` : null;
}

function assertConfigured() {
  const error = configError();
  if (error) {
    throw new Error(error);
  }
}

function logStartupDiagnostics() {
  console.log("[agent] ======= STARTUP DIAGNOSTICS =======");
  const nvidia = ensureCanonicalNvidiaEnv();

  const checks = [
    { key: "SUPABASE_URL", value: process.env.SUPABASE_URL ?? "MISSING" },
    {
      key: "SUPABASE_SERVICE_ROLE_KEY",
      value: process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING",
    },
    { key: "AGENT_SECRET", value: process.env.AGENT_SECRET ? "SET" : "MISSING" },
    { key: "CRON_SECRET", value: process.env.CRON_SECRET ? "SET" : "MISSING" },
    {
      key: "NVIDIA_KEY_SOURCE",
      value: nvidia.key ?? "none",
    },
    {
      key: "NVIDIA_API_KEY",
      value: nvidia.value
        ? `SET (${nvidia.value.slice(0, 8)}...)`
        : "MISSING - AI answers may fall back",
    },
    {
      key: "NEXT_PUBLIC_APP_URL",
      value: process.env.NEXT_PUBLIC_APP_URL || "MISSING - HTTP fallback will fail",
    },
    { key: "NEXTJS_URL", value: process.env.NEXTJS_URL || "not set" },
    { key: "WA_SESSION_DIR", value: process.env.WA_SESSION_DIR || "not set" },
    { key: "SESSION_BASE_DIR", value: sessionBaseDir() },
    {
      key: "SAVED_SESSION_DIRS",
      value: String(savedSessionUserIds().length),
    },
  ];

  for (const check of checks) {
    console.log(`[agent] ${check.key}: ${check.value}`);
  }

  const url = appUrl();
  if (!url) {
    console.error("[agent] CRITICAL: NEXT_PUBLIC_APP_URL is not set.");
    console.error("[agent] Set NEXT_PUBLIC_APP_URL=https://swift-deploy.in on Railway.");
  } else if (url.includes("localhost") || url.includes("127.0.0.1")) {
    console.error("[agent] CRITICAL: NEXT_PUBLIC_APP_URL points to localhost.");
    console.error(`[agent] Current value: ${url}`);
    console.error("[agent] Fix it to https://swift-deploy.in on Railway.");
  } else {
    console.log(`[agent] App URL: ${url}`);
  }

  console.log("[agent] =================================");
}

async function getWAVersion(): Promise<[number, number, number]> {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[agent] WA v${version.join(".")} (latest=${isLatest})`);
  return version;
}

function sessionDir(userId: string) {
  const base = sessionBaseDir();
  return path.join(base, userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

async function discardSession(
  userId: string,
  record: SessionRecord | undefined,
  options: { deleteAuth?: boolean } = {},
) {
  if (record) {
    try {
      await record.sock.logout();
    } catch {
      // Ignore logout failures during cleanup.
    }

    try {
      record.sock.end(new Error("discarded"));
    } catch {
      // Ignore socket close failures during cleanup.
    }
  }

  sessions.delete(userId);

  if (options.deleteAuth) {
    const dir = sessionDir(userId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

function splitIntoStreamChunks(text: string): string[] {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return [];
  }

  const codeBlocks: string[] = [];
  const withPlaceholders = normalized.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match.trim());
    return `___CODE_BLOCK_${codeBlocks.length - 1}___`;
  });

  const chunks: string[] = [];
  const sections = withPlaceholders.split(/\n\n+/);
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    if (/^___CODE_BLOCK_\d+___$/.test(trimmed)) {
      const idx = Number.parseInt(trimmed.match(/\d+/)?.[0] ?? "-1", 10);
      if (idx >= 0 && codeBlocks[idx]) {
        chunks.push(codeBlocks[idx]);
      }
      continue;
    }

    if (trimmed.length <= 220) {
      chunks.push(trimmed);
      continue;
    }

    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > 260 && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = candidate;
      }
    }
    if (current.trim()) {
      chunks.push(current.trim());
    }
  }

  return chunks.filter(Boolean);
}

function chunkDelay(chunk: string) {
  if (chunk.startsWith("```")) {
    return Math.min(600 + chunk.length * 2, 3_000);
  }
  const words = chunk.split(/\s+/).length;
  return Math.min(500 + words * 55, 1_800);
}

function initialTypingDelay(text: string) {
  const len = text.length;
  if (len < 80) return 700;
  if (len < 300) return 1_100;
  if (len < 800) return 1_600;
  return 2_000;
}

async function sendStreamingMessage(sock: WASocket, jid: string, fullText: string) {
  const trimmed = fullText.replace(/\n{3,}/g, "\n\n").trim();
  const chunks = splitIntoStreamChunks(trimmed);

  await sock.sendPresenceUpdate("composing", jid).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, initialTypingDelay(trimmed)));

  if (chunks.length <= 1) {
    const sent = await sock.sendMessage(jid, { text: trimmed });
    if (sent?.key?.id) {
      outboundIds.add(sent.key.id);
    }
    await sock.sendPresenceUpdate("paused", jid).catch(() => null);
    return;
  }

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index] ?? "";
    const isLast = index === chunks.length - 1;

    if (index > 0) {
      await sock.sendPresenceUpdate("composing", jid).catch(() => null);
      await new Promise((resolve) => setTimeout(resolve, chunkDelay(chunk)));
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    const sent = await sock.sendMessage(jid, { text: chunk });
    if (sent?.key?.id) {
      outboundIds.add(sent.key.id);
    }

    if (!isLast) {
      await sock.sendPresenceUpdate("composing", jid).catch(() => null);
    }
  }

  await sock.sendPresenceUpdate("paused", jid).catch(() => null);
}

async function logOutbound(
  userId: string,
  content: string,
  targetJid?: string | null,
  contactName?: string | null,
) {
  const session = sessions.get(userId);
  const sentAt = new Date().toISOString();
  const fullRow = {
    user_id: userId,
    direction: "outbound",
    content,
    message_type: "text",
    remote_jid: targetJid ?? null,
    remote_phone: phoneFromJid(targetJid),
    contact_name: sanitizeContactName(contactName),
    chat_type: getChatType(targetJid, session),
    sent_at: sentAt,
  };

  const inserted = await db()
    .from("whatsapp_messages")
    .insert(fullRow)
    .then(() => true)
    .catch(() => false);

  if (!inserted) {
    await db()
      .from("whatsapp_messages")
      .insert({
        user_id: userId,
        direction: "outbound",
        content,
        message_type: "text",
        sent_at: sentAt,
      })
      .catch(() => null);
  }
}

async function shouldSendWelcome(userId: string, phone: string | null) {
  const { data } = await db()
    .from("connected_accounts")
    .select("phone_number, is_active")
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (!data) {
    return true;
  }

  const existingPhone = String(data.phone_number ?? "").replace(/\D/g, "");
  const nextPhone = String(phone ?? "").replace(/\D/g, "");

  if (!existingPhone || !nextPhone || existingPhone !== nextPhone) {
    return true;
  }

  return !Boolean(data.is_active);
}

function normalizePhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function phoneFromJid(jid: string | null | undefined) {
  const digits = String(jid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits || null;
}

function jidFromPhone(phone: string | null | undefined) {
  const digits = normalizePhone(phone);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

function isDirectChatJid(jid: string) {
  return /@s\.whatsapp\.net$/i.test(jid);
}

function isLidChatJid(jid: string) {
  return /@lid$/i.test(jid);
}

function isGroupChatJid(jid: string) {
  return /@g\.us$/i.test(jid);
}

function isIgnoredChatJid(jid: string) {
  const value = jid.toLowerCase();
  return (
    value === "status@broadcast"
    || value.endsWith("@broadcast")
    || value.endsWith("@newsletter")
  );
}

function toReplyableJid(jid: string | null | undefined) {
  const value = String(jid ?? "").trim();
  if (!value) return null;
  if (isIgnoredChatJid(value)) return null;
  if (!isDirectChatJid(value) && !isLidChatJid(value)) return null;
  return value;
}

function sanitizeContactName(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

const LIVE_CONTACT_HONORIFICS = [
  "ji",
  "sir",
  "madam",
  "mam",
  "bhai",
  "bhaiya",
  "didi",
  "saab",
  "sahab",
  "uncle",
  "aunty",
  "auntie",
] as const;

const LIVE_CONTACT_CANONICAL_ALIASES: Record<string, string> = {
  mom: "maa",
  mother: "maa",
  mummy: "maa",
  mum: "maa",
  mommy: "maa",
  mamma: "maa",
  mama: "maa",
  ma: "maa",
  dad: "papa",
  father: "papa",
  daddy: "papa",
  pappa: "papa",
  baba: "papa",
  pitaji: "papa",
};

function normalizeLiveContactName(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, "")
    .replace(/[_]+/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/[^\p{L}\p{N}\s.&+\-/\u0900-\u097F]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!cleaned) {
    return "";
  }

  const words = cleaned
    .replace(/\b(?:contact|phone|number)\b/gi, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => LIVE_CONTACT_CANONICAL_ALIASES[word] ?? word);

  while (words.length > 1) {
    const lastWord = words[words.length - 1];
    if (lastWord && LIVE_CONTACT_HONORIFICS.includes(lastWord as (typeof LIVE_CONTACT_HONORIFICS)[number])) {
      words.pop();
      continue;
    }
    break;
  }

  return words.join(" ").trim();
}

function collectLiveContactAliases(seed: WhatsAppContactSyncInput) {
  const rawAliases = [
    seed.contactName,
    seed.notifyName,
    seed.verifiedName,
  ]
    .map((value) => sanitizeContactName(value))
    .filter((value): value is string => Boolean(value));

  const normalizedAliases = rawAliases
    .map((value) => normalizeLiveContactName(value))
    .filter(Boolean);

  return [...new Set(normalizedAliases)];
}

function rememberSessionContacts(record: SessionRecord, contacts: WhatsAppContactSyncInput[]) {
  for (const seed of contacts) {
    const jid = toReplyableJid(seed.jid ?? null);
    const phone = (
      (isDirectChatJid(jid ?? "") ? phoneFromJid(jid) : null)
      ?? String(seed.phoneNumber ?? "").replace(/\D/g, "")
      || null
    );
    const aliases = collectLiveContactAliases(seed);
    const displayName =
      sanitizeContactName(seed.contactName)
      ?? sanitizeContactName(seed.notifyName)
      ?? sanitizeContactName(seed.verifiedName)
      ?? aliases[0]
      ?? null;

    if (!jid || !aliases.length || !displayName) {
      continue;
    }

    const contactKey = phone || jid;
    const existing = record.contacts.get(contactKey);
    const mergedAliases = new Set<string>(existing?.aliases ?? []);
    for (const alias of aliases) {
      mergedAliases.add(alias);
    }

    record.contacts.set(contactKey, {
      jid,
      phone,
      displayName,
      aliases: [...mergedAliases],
      updatedAt: Date.now(),
    });
  }
}

function resolveSessionContact(record: SessionRecord, rawName: string) {
  const normalizedQuery = normalizeLiveContactName(rawName);
  if (!normalizedQuery) {
    return null;
  }

  let best: SessionContactEntry | null = null;
  let bestScore = -1;

  for (const entry of record.contacts.values()) {
    let score = 0;
    for (const alias of entry.aliases) {
      if (alias === normalizedQuery) {
        score = Math.max(score, 100);
      } else if (alias.startsWith(normalizedQuery) || normalizedQuery.startsWith(alias)) {
        score = Math.max(score, 90);
      } else if (alias.includes(normalizedQuery) || normalizedQuery.includes(alias)) {
        score = Math.max(score, 80);
      }
    }

    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }

  if (!best || bestScore < 80) {
    return null;
  }

  return {
    name: best.displayName,
    phone: best.phone,
    jid: best.jid,
  };
}

function buildSyncSeedFromBaileysContact(contact: Partial<WAContact>): WhatsAppContactSyncInput | null {
  const jid = toReplyableJid(contact.jid ?? contact.id ?? null);
  const phoneNumber = phoneFromJid(contact.jid ?? contact.id ?? null);
  const contactName = sanitizeContactName(contact.name);
  const notifyName = sanitizeContactName(contact.notify);
  const verifiedName = sanitizeContactName(contact.verifiedName);

  if (!jid || (!phoneNumber && !isLidChatJid(jid)) || (!contactName && !notifyName && !verifiedName)) {
    return null;
  }

  return {
    jid,
    phoneNumber,
    contactName,
    notifyName,
    verifiedName,
  };
}

function buildSyncSeedFromMessage(message: WAMessage): WhatsAppContactSyncInput | null {
  const jid = toReplyableJid(message.key.remoteJid ?? null);
  const phoneNumber = phoneFromJid(jid);
  const notifyName = sanitizeContactName(message.pushName);

  if (!jid || (!phoneNumber && !isLidChatJid(jid)) || !notifyName) {
    return null;
  }

  return {
    jid,
    phoneNumber,
    notifyName,
    source: "message",
  };
}

function buildSyncSeedFromChat(chat: Record<string, unknown>): WhatsAppContactSyncInput | null {
  const jid = toReplyableJid(chat.id);
  const phoneNumber = isDirectChatJid(jid ?? "") ? phoneFromJid(jid) : null;
  const contactName = sanitizeContactName(
    typeof chat.name === "string"
      ? chat.name
      : typeof chat.formattedTitle === "string"
        ? chat.formattedTitle
        : typeof chat.contactName === "string"
          ? chat.contactName
          : null,
  );
  const notifyName = sanitizeContactName(
    typeof chat.notifyName === "string"
      ? chat.notifyName
      : typeof chat.pushName === "string"
        ? chat.pushName
        : null,
  );

  if (!jid || (!contactName && !notifyName)) {
    return null;
  }

  return {
    jid,
    phoneNumber,
    contactName,
    notifyName,
    source: "history",
  };
}

function getChatType(
  jid: string | null | undefined,
  session: SessionRecord | null | undefined,
): "direct" | "group" | "self" | "broadcast" | "unknown" {
  const value = String(jid ?? "").trim().toLowerCase();
  if (!value) return "unknown";
  if (value === "status@broadcast" || value.endsWith("@broadcast")) return "broadcast";
  if (value.endsWith("@g.us")) return "group";
  if (value.endsWith("@lid")) return "direct";

  const remotePhone = phoneFromJid(value);
  const selfPhone = normalizePhone(session?.phone);
  if (remotePhone && selfPhone && remotePhone === selfPhone) {
    return "self";
  }

  if (value.endsWith("@s.whatsapp.net")) {
    return "direct";
  }

  return "unknown";
}

function buildMessageLogFields(
  message: WAMessage | null,
  remoteJid: string | null | undefined,
  session: SessionRecord | null | undefined,
) {
  const safeRemoteJid = String(remoteJid ?? "").trim() || null;
  const chatType = getChatType(safeRemoteJid, session);
  return {
    remote_jid: safeRemoteJid,
    remote_phone:
      (chatType === "direct" || chatType === "self") && isDirectChatJid(safeRemoteJid ?? "")
        ? phoneFromJid(safeRemoteJid)
        : null,
    contact_name: sanitizeContactName(message?.pushName),
    chat_type: chatType,
  };
}

function resolveReplyJid(
  session: SessionRecord,
  targetJid?: string | null,
) {
  const rawTarget = String(targetJid ?? "").trim();
  if (rawTarget && isGroupChatJid(rawTarget)) {
    return rawTarget;
  }

  const candidate = toReplyableJid(targetJid);
  if (candidate) {
    return candidate;
  }

  const remembered = toReplyableJid(session.lastChatJid);
  if (remembered) {
    return remembered;
  }

  return jidFromPhone(session.phone);
}

async function loadPreferredChatJid(userId: string) {
  const { data } = await db()
    .from("connected_accounts")
    .select("phone_number,account_email")
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .maybeSingle()
    .catch(() => ({ data: null }));

  const linkedPhoneJid = jidFromPhone(data?.phone_number);
  if (linkedPhoneJid) {
    return linkedPhoneJid;
  }

  return jidFromPhone(data?.account_email);
}

async function persistPreferredChatTarget(
  userId: string,
  sessionPhone: string | null,
  remoteJid: string | null,
) {
  const remotePhone = phoneFromJid(toReplyableJid(remoteJid));
  const linkedPhone = normalizePhone(sessionPhone);

  if (!linkedPhone) {
    return;
  }

  // Keep WhatsApp assistant replies anchored to the owner's own chat.
  if (!remotePhone || remotePhone !== linkedPhone) {
    return;
  }

  await db()
    .from("connected_accounts")
    .update({
      account_email: remotePhone,
      last_used_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .catch(() => null);
}

const STATIC_WELCOME_TEXT = [
  "🦞 *ClawCloud AI reconnected!*",
  "",
  "Your AI assistant is back online.",
  "",
  "💻 Code  •  📧 Email  •  📅 Calendar  •  ⏰ Reminders",
  "📊 Math  •  🗞️ News  •  💰 Finance  •  🌤️ Weather",
  "🖼️ Images  •  🎤 Voice notes  •  📄 Documents",
  "",
  "Type *help* for the full feature list.",
  "Finish setup at swift-deploy.in to unlock all features.",
].join("\n");

async function sendWelcome(sock: WASocket, phone: string, userId?: string) {
  const jid = `${phone}@s.whatsapp.net`;
  let text = STATIC_WELCOME_TEXT;

  if (userId) {
    const needsOnboarding = await isNewUserNeedingOnboarding(userId).catch(() => false);
    if (needsOnboarding) {
      text = await startOnboarding(userId).catch(() => STATIC_WELCOME_TEXT);
    }
  }

  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) {
    outboundIds.add(sent.key.id);
  }
}

function getMentionedJids(message: WAMessage): string[] {
  const candidates = [
    message.message?.extendedTextMessage?.contextInfo?.mentionedJid,
    message.message?.imageMessage?.contextInfo?.mentionedJid,
    message.message?.videoMessage?.contextInfo?.mentionedJid,
    message.message?.documentMessage?.contextInfo?.mentionedJid,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) {
      return candidate;
    }
  }

  return [];
}

function isBotMentioned(message: WAMessage, session: SessionRecord): boolean {
  const mentionedJids = getMentionedJids(message);
  if (!mentionedJids.length) {
    return false;
  }

  const botCandidates = [
    phoneFromJid(session.sock.user?.id),
    normalizePhone(session.phone),
  ].filter((value): value is string => Boolean(value));

  return mentionedJids.some((jid) => {
    const mentionedPhone = phoneFromJid(jid);
    return Boolean(mentionedPhone && botCandidates.includes(mentionedPhone));
  });
}

function stripMentionTokens(text: string, mentionedJids: string[]): string {
  let cleaned = text;

  for (const jid of mentionedJids) {
    const digits = phoneFromJid(jid);
    if (!digits) continue;

    cleaned = cleaned.replace(new RegExp(`@${digits}\\b`, "g"), "");
    if (digits.length > 10) {
      cleaned = cleaned.replace(new RegExp(`@${digits.slice(-10)}\\b`, "g"), "");
    }
  }

  return cleaned.replace(/\s{2,}/g, " ").trim();
}

function stripQuotedReplyPrefix(text: string): string {
  return text.replace(/^\[Replying to:[^\]]+\]\s*/i, "").trim();
}

async function sendWelcomeLegacy(sock: WASocket, phone: string) {
  const jid = `${phone}@s.whatsapp.net`;
  const text = [
    "🦞 *ClawCloud AI is connected!*",
    "",
    "I'm your personal AI assistant right here on WhatsApp.",
    "",
    "Here's what I can do for you:",
    "💻 *Code* - write, debug, explain in any language",
    "📧 *Email* - search, draft, and reply from your inbox",
    "📅 *Calendar* - check meetings and reminders",
    "⏰ *Reminders* - set smart alerts",
    "🧠 *Knowledge* - answer questions on any topic",
    "📊 *Math* - solve problems step by step",
    "✍️ *Writing* - essays, reports, and content",
    "🗞️ *News* - latest news from anywhere",
    "",
    "Just type naturally. I understand what you need.",
    "",
    "Finish setup at swift-deploy.in to unlock all features.",
  ].join("\n");

  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) {
    outboundIds.add(sent.key.id);
  }
}

async function downloadMediaBuffer(
  message: WAMessage,
  mediaType: MediaType,
): Promise<Buffer | null> {
  const contentNode =
    mediaType === "image"
      ? message.message?.imageMessage
      : mediaType === "audio"
        ? message.message?.audioMessage
        : mediaType === "video"
          ? message.message?.videoMessage
        : mediaType === "document"
          ? message.message?.documentMessage
          : null;

  if (!contentNode) {
    return null;
  }

  try {
    const stream = await downloadContentFromMessage(contentNode, mediaType);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    console.error(
      `[agent] downloadMediaBuffer(${mediaType}) failed:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function extractQuotedReplyText(message: WAMessage): string {
  const quotedMessage = message.message?.extendedTextMessage?.contextInfo?.quotedMessage as
    | {
        conversation?: string | null;
        extendedTextMessage?: { text?: string | null } | null;
        imageMessage?: { caption?: string | null } | null;
        videoMessage?: { caption?: string | null } | null;
        documentMessage?: { caption?: string | null; fileName?: string | null } | null;
      }
    | undefined;

  if (!quotedMessage) {
    return "";
  }

  return (
    quotedMessage.conversation?.trim()
    || quotedMessage.extendedTextMessage?.text?.trim()
    || quotedMessage.imageMessage?.caption?.trim()
    || quotedMessage.videoMessage?.caption?.trim()
    || quotedMessage.documentMessage?.caption?.trim()
    || quotedMessage.documentMessage?.fileName?.trim()
    || ""
  );
}

function getBuiltinFallbackResponse(message: string) {
  const text = message.toLowerCase().trim();

  if (
    /^(hi|hello|hey|hii|helo|namaste|good\s*(morning|evening|afternoon|night))\b/.test(text) &&
    text.length < 30
  ) {
    return "👋 *Hey! ClawCloud AI here.*\n\nAsk me anything - coding, math, email, news, reminders, or any question at all.";
  }

  if (/what can you do|what do you do|your capabilities|help me with|features/.test(text)) {
    return [
      "🦞 *I can help you with:*",
      "",
      "💻 *Code* - write, debug, explain any language",
      "📧 *Email* - search and draft replies from your inbox",
      "📅 *Calendar* - check meetings and briefings",
      "⏰ *Reminders* - set smart alerts",
      "🧠 *Knowledge* - answer any question",
      "📊 *Math* - step-by-step solutions",
      "✍️ *Writing* - essays, reports, and content",
      "🗞️ *News* - latest news anywhere",
      "",
      "Just ask naturally and I will figure out what you need.",
    ].join("\n");
  }

  if (/test|working|alive|are you there|respond/.test(text)) {
    return "✅ *Yes, I'm here and working!*\n\nAsk me anything and I'll help.";
  }

  return [
    "Direct answer mode is active.",
    "",
    `Topic: _${message.slice(0, 100)}${message.length > 100 ? "..." : ""}_`,
    "",
    "The request could not be completed in this attempt.",
    "Resend the same question with one extra detail and I will return a complete answer.",
  ].join("\n");
}

function isEmptyOrFallback(reply: string | null | undefined) {
  if (!reply?.trim()) {
    return true;
  }

  const lower = reply.trim().toLowerCase();
  return (
    lower.includes("__fast_fallback") ||
    lower.includes("__deep_fallback") ||
    lower.includes("could not produce a reliable answer") ||
    lower.includes("send the question again and i will retry") ||
    lower.includes("let me try that again") ||
    lower.includes("reliable information for this detail is not available in the retrieved sources") ||
    lower.includes("i can answer any history question with dates, causes, key figures, and impact") ||
    lower.includes("ask specifically: 'when did x happen?'") ||
    lower.includes("rephrase your question and i'll answer it immediately and accurately") ||
    lower.includes("i received your question") ||
    lower.includes("coding reply") ||
    lower.includes("coding answer") ||
    lower.includes("i received: _") ||
    lower.includes("clean starter template") ||
    lower.includes("you asked about") ||
    lower.includes("send your exact goal in one line") ||
    lower.includes("preferred output format") ||
    lower.includes("direct answer mode is active") ||
    lower.includes("reminder set for [task] at [time]") ||
    (lower.includes("[task]") && lower.includes("[time]")) ||
    lower.includes("message understood: _") ||
    lower.includes("ask your exact question in one line") ||
    lower.includes("i can continue with either a concise answer or a deeper explanation") ||
    lower.includes("send one topic + location so i can return a precise update") ||
    lower.includes("latest update request") ||
    lower.includes("is a concept that should be understood in three parts") ||
    lower.includes("can be understood in three parts: what it is, how it works, and why it matters") ||
    lower.includes("if you want a deep version, i can expand this with examples and practical applications") ||
    (lower.startsWith("*i could not") && lower.length < 200)
  );
}

function buildEmergencyProfessionalFallback(message: string) {
  const text = message.toLowerCase().trim();

  if (/\bn[-\s]?queen\b/.test(text)) {
    return [
      "Coding answer:",
      "",
      "```python",
      "def solve_n_queens(n: int):",
      "    cols, d1, d2 = set(), set(), set()",
      "    board = [['.' for _ in range(n)] for _ in range(n)]",
      "    out = []",
      "",
      "    def dfs(r: int):",
      "        if r == n:",
      "            out.append([''.join(row) for row in board])",
      "            return",
      "        for c in range(n):",
      "            if c in cols or (r - c) in d1 or (r + c) in d2:",
      "                continue",
      "            cols.add(c); d1.add(r - c); d2.add(r + c)",
      "            board[r][c] = 'Q'",
      "            dfs(r + 1)",
      "            board[r][c] = '.'",
      "            cols.remove(c); d1.remove(r - c); d2.remove(r + c)",
      "",
      "    dfs(0)",
      "    return out",
      "```",
    ].join("\n");
  }

  if (/\brat\b/.test(text) && /\bmaze\b/.test(text)) {
    return [
      "Coding answer:",
      "",
      "```python",
      "def find_paths(maze):",
      "    n = len(maze)",
      "    if n == 0 or maze[0][0] == 0 or maze[n-1][n-1] == 0:",
      "        return []",
      "    moves = [(1,0,'D'), (0,-1,'L'), (0,1,'R'), (-1,0,'U')]",
      "    vis = [[False]*n for _ in range(n)]",
      "    out = []",
      "",
      "    def dfs(r, c, path):",
      "        if r == n-1 and c == n-1:",
      "            out.append(path)",
      "            return",
      "        for dr, dc, ch in moves:",
      "            nr, nc = r + dr, c + dc",
      "            if 0 <= nr < n and 0 <= nc < n and maze[nr][nc] == 1 and not vis[nr][nc]:",
      "                vis[nr][nc] = True",
      "                dfs(nr, nc, path + ch)",
      "                vis[nr][nc] = False",
      "",
      "    vis[0][0] = True",
      "    dfs(0, 0, '')",
      "    return sorted(out)",
      "```",
    ].join("\n");
  }

  if (/\b(code|program|algorithm|n[-\s]?queen|debug|python|javascript|java|c\+\+)\b/.test(text)) {
    return [
      "💻 *Coding Mode Active*",
      "",
      "I can write a full working solution.",
      "Send the exact problem statement, and I will return complete runnable code in one response.",
    ].join("\n");
  }

  if (/\b(weather|whether|temperature|forecast|rain|humidity|wind|aqi)\b/.test(text)) {
    return [
      "🌦️ *Weather Update*",
      "",
      "Please send your city name for an accurate forecast.",
      "Example: _Weather today in Delhi_.",
    ].join("\n");
  }

  if (/\b(news|latest|today|headline)\b/.test(text)) {
    return [
      "📰 *News Update*",
      "",
      "Send topic + location for accurate latest headlines.",
      "Example: _India business news today_.",
    ].join("\n");
  }

  const diffMatch = text.match(/\b(?:difference between|compare)\s+(.+?)\s+(?:and|vs\.?|versus)\s+(.+?)(?:\?|$)/);
  if (diffMatch) {
    const left = diffMatch[1].trim();
    const right = diffMatch[2].trim();
    if (
      (left === "ai" && right === "ml")
      || (left === "ml" && right === "ai")
      || (left.includes("artificial intelligence") && right.includes("machine learning"))
      || (left.includes("machine learning") && right.includes("artificial intelligence"))
    ) {
      return [
        "*AI vs ML*",
        "",
        "*AI* is the broader field of building systems that perform tasks requiring human-like intelligence.",
        "*ML* is a subset of AI where models learn patterns from data to make predictions or decisions.",
        "",
        "In short: *all ML is AI, but not all AI is ML.*",
      ].join("\n");
    }
  }

  if (/\bwhat is moist\b|\bdefine moist\b|\bmeaning of moist\b/.test(text)) {
    return [
      "*Moist means slightly wet.*",
      "",
      "It describes something that has a small amount of liquid but is not fully soaked.",
      "Example: moist soil is damp enough for plants to grow well.",
    ].join("\n");
  }

  if (/\bmariana trench\b/.test(text)) {
    return [
      "Mariana Trench:",
      "",
      "The Mariana Trench is the deepest known part of Earth's oceans in the western Pacific Ocean.",
      "Its deepest point is Challenger Deep at about 10,935 meters (35,876 feet).",
    ].join("\n");
  }

  return [
    "I can help with this.",
    "",
    "Send your exact question in one line and include key detail (topic or location).",
    "Example: *What is the Mariana Trench?* or *Weather in Mumbai today*.",
  ].join("\n");
}

async function sendReply(
  userId: string,
  message: string,
  targetJid?: string | null,
): Promise<boolean> {
  const session = sessions.get(userId);
  if (!session?.phone) {
    return false;
  }

  const jid = resolveReplyJid(session, targetJid);
  if (!jid) {
    return false;
  }

  const cleaned = message.replace(/\n{3,}/g, "\n\n").trim();
  const messageExcerpt = cleaned.slice(0, 200);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_SEND_RETRIES; attempt += 1) {
    try {
      if (cleaned.length >= STREAM_REPLY_MIN_LENGTH) {
        await sendStreamingMessage(session.sock, jid, cleaned);
      } else {
        const sent = await session.sock.sendMessage(jid, { text: cleaned });
        if (sent?.key?.id) {
          outboundIds.add(sent.key.id);
        }
      }

      if (attempt > 0) {
        await db()
          .from("delivery_failures")
          .update({
            final_status: "delivered",
            resolved_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("jid", jid)
          .eq("message_excerpt", messageExcerpt)
          .eq("final_status", "retrying")
          .is("resolved_at", null)
          .catch(() => null);
      }

      void logOutbound(userId, message, jid);
      if (isGroupChatJid(jid)) {
        markGroupReplied(jid);
      }
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const finalStatus = attempt === MAX_SEND_RETRIES - 1 ? "failed" : "retrying";

      await db()
        .from("delivery_failures")
        .insert({
          user_id: userId,
          jid,
          message_excerpt: messageExcerpt,
          error_message: lastError.message,
          retry_count: attempt + 1,
          final_status: finalStatus,
        })
        .catch(() => null);

      if (attempt < MAX_SEND_RETRIES - 1) {
        const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        console.warn(
          `[agent] sendReply attempt ${attempt + 1} failed for ${userId}; retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(
    `[agent] sendReply failed after ${MAX_SEND_RETRIES} attempts for ${userId}:`,
    lastError?.message ?? "Unknown error",
  );
  return false;
}

async function sendReplyLegacy(
  userId: string,
  message: string,
  targetJid?: string | null,
): Promise<boolean> {
  const session = sessions.get(userId);
  if (!session?.phone) {
    return false;
  }

  const jid = resolveReplyJid(session, targetJid);
  if (!jid) {
    return false;
  }

  const cleaned = message.replace(/\n{3,}/g, "\n\n").trim();

  if (cleaned.length >= STREAM_REPLY_MIN_LENGTH) {
    await sendStreamingMessage(session.sock, jid, cleaned);
  } else {
    const sent = await session.sock.sendMessage(jid, { text: cleaned });
    if (sent?.key?.id) {
      outboundIds.add(sent.key.id);
    }
  }

  void logOutbound(userId, message);
  if (isGroupChatJid(jid)) {
    markGroupReplied(jid);
  }
  return true;
}

async function callNext(pathname: string, body: Record<string, unknown>): Promise<Response | null> {
  if (!appUrl()) {
    console.error("[agent] callNext skipped: app URL is missing");
    return null;
  }

  const sharedSecrets = [
    process.env.AGENT_SECRET?.trim(),
    process.env.CRON_SECRET?.trim(),
  ].filter((value): value is string => Boolean(value));

  if (!sharedSecrets.length) {
    console.error("[agent] callNext skipped: AGENT_SECRET/CRON_SECRET not configured");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_REPLY_TIMEOUT_MS);

  try {
    for (const secret of sharedSecrets) {
      const response = await fetch(`${appUrl()}${pathname}`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        return response;
      }

      if (response.status !== 401 && response.status !== 403) {
        return response;
      }
    }

    return null;
  } catch (error) {
    console.error(
      "[agent] callNext failed:",
      error instanceof Error ? error.message : error,
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getDirectRouteInboundAgentMessage() {
  if (cachedRouteInboundAgentMessage) {
    return cachedRouteInboundAgentMessage;
  }

  ensureCanonicalNvidiaEnv();
  const module = await import("./lib/clawcloud-agent");
  cachedRouteInboundAgentMessage = module.routeInboundAgentMessage;
  return cachedRouteInboundAgentMessage;
}

async function runDirectAgentReply(userId: string, message: string): Promise<string | null> {
  // If local NVIDIA key is missing, PATH A often degrades to generic templates.
  // Prefer PATH B (/api/agent/message on app_url) for stronger answers.
  const nvidia = ensureCanonicalNvidiaEnv();
  if (!nvidia.value && appUrl()) {
    return null;
  }

  try {
    const routeInboundAgentMessage = await getDirectRouteInboundAgentMessage();
    const timeout = new Promise<string | null>((resolve) => {
      setTimeout(() => resolve(null), DIRECT_REPLY_TIMEOUT_MS);
    });

    return await Promise.race([routeInboundAgentMessage(userId, message), timeout]);
  } catch (error) {
    console.error(
      `[agent] Direct reply failed for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

async function handleInbound(
  userId: string,
  text: string,
  waId: string | null,
  remoteJid: string | null,
  originalMessage?: WAMessage | null,
  routedTextOverride?: string,
) {
  const session = sessions.get(userId);
  const logFields = buildMessageLogFields(originalMessage ?? null, remoteJid, session);
  const sentAt = new Date().toISOString();

  void db()
    .from("whatsapp_messages")
    .insert({
      user_id: userId,
      direction: "inbound",
      content: text,
      message_type: "text",
      wa_message_id: waId,
      ...logFields,
      sent_at: sentAt,
    })
    .catch(() =>
      db()
        .from("whatsapp_messages")
        .insert({
          user_id: userId,
          direction: "inbound",
          content: text,
          message_type: "text",
          wa_message_id: waId,
          sent_at: sentAt,
        })
        .catch(() => null),
    );

  const safeRemoteJid = toReplyableJid(remoteJid);

  if (session && safeRemoteJid) {
    session.lastChatJid = safeRemoteJid;
    sessions.set(userId, session);
    void persistPreferredChatTarget(userId, session.phone, safeRemoteJid);
  }

  const jid =
    (session ? resolveReplyJid(session, remoteJid) : null) ||
    safeRemoteJid ||
    (session ? resolveReplyJid(session) : null);

  if (jid && session) {
    void session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
  }

  let finalReply: string | null = null;
  const routedText = routedTextOverride?.trim() || text;

  console.log(`[agent] PATH A direct reply for ${userId}`);
  const directReply = await runDirectAgentReply(userId, routedText);
  if (directReply?.trim() && !isEmptyOrFallback(directReply)) {
    finalReply = directReply.trim();
    console.log(`[agent] PATH A success for ${userId} (${finalReply.length} chars)`);
  } else {
    console.warn(`[agent] PATH A empty or fallback for ${userId} - trying PATH B`);

    if (appUrl()) {
      console.log(`[agent] PATH B HTTP call to ${appUrl()}/api/agent/message`);
      const response = await callNext("/api/agent/message", {
        userId,
        message: routedText,
        _internal: true,
      });

      if (response?.ok) {
        const json = (await response.json().catch(() => ({}))) as { response?: string | null };
        if (json.response?.trim() && !isEmptyOrFallback(json.response)) {
          finalReply = json.response.trim();
          console.log(`[agent] PATH B success for ${userId} (${finalReply.length} chars)`);
        } else {
          console.warn(`[agent] PATH B returned empty or fallback for ${userId}`);
        }
      } else if (response) {
        const body = await response.text().catch(() => "");
        console.error(
          `[agent] PATH B failed for ${userId}: HTTP ${response.status}${body ? ` - ${body.slice(0, 200)}` : ""}`,
        );
      } else {
        console.error(`[agent] PATH B failed for ${userId}: no response`);
      }
    } else {
      console.error("[agent] PATH B skipped: NEXT_PUBLIC_APP_URL is not set");
    }
  }

  if (!finalReply || isEmptyOrFallback(finalReply)) {
    console.warn(`[agent] Using builtin fallback for ${userId}`);
    finalReply = buildEmergencyProfessionalFallback(text);
  }

  if (jid && session) {
    void session.sock.sendPresenceUpdate("paused", jid).catch(() => null);
  }

  if (jid && session && finalReply) {
    await sendReply(userId, finalReply, jid).catch((error) =>
      console.error(
        `[agent] Reply send failed for ${userId}:`,
        error instanceof Error ? error.message : error,
      ),
    );
    return;
  }

  console.error(`[agent] Could not send reply for ${userId}: jid=${jid}, session=${Boolean(session)}`);
}

async function markDisconnected(userId: string) {
  await db()
    .from("connected_accounts")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .catch(() => null);
}

async function getActiveUserIds(): Promise<string[]> {
  const { data } = await db()
    .from("connected_accounts")
    .select("user_id")
    .eq("provider", "whatsapp")
    .eq("is_active", true);

  return (data ?? []).map((row) => String(row.user_id ?? "").trim()).filter(Boolean);
}

async function connectSession(userId: string): Promise<SessionRecord> {
  assertConfigured();
  const preferredChatJid = await loadPreferredChatJid(userId);

  const existing = sessions.get(userId);
  if (existing && (existing.status === "waiting" || existing.status === "connected")) {
    return existing;
  }

  if (existing && existing.status === "connecting") {
    if (Date.now() - existing.startedAt < STALE_MS) {
      return existing;
    }

    console.warn(`[agent] Resetting stale session for ${userId}`);
    await discardSession(userId, existing, { deleteAuth: true });
  }

  const dir = sessionDir(userId);
  fs.mkdirSync(dir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  const version = await getWAVersion();
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    version,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: true,
  });

  const record: SessionRecord = {
    sock,
    status: "connecting",
    qr: null,
    qrIssuedAt: null,
    phone: null,
    lastChatJid: preferredChatJid,
    startedAt: Date.now(),
    contacts: new Map<string, SessionContactEntry>(),
  };

  sessions.set(userId, record);
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messaging-history.set", ({ contacts, chats }) => {
    const seeds = [
      ...((contacts ?? [])
      .map((contact) => buildSyncSeedFromBaileysContact(contact))
      .filter(Boolean) as WhatsAppContactSyncInput[]),
      ...((chats ?? [])
      .map((chat) => buildSyncSeedFromChat(chat as Record<string, unknown>))
      .filter(Boolean) as WhatsAppContactSyncInput[]),
    ];

    if (seeds.length) {
      rememberSessionContacts(record, seeds);
      void upsertWhatsAppContacts(userId, seeds).catch((error) =>
        console.error(
          `[agent] WhatsApp history contact sync failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        ),
      );
    }
  });

  sock.ev.on("contacts.upsert", (contacts) => {
    const seeds = contacts
      .map((contact) => buildSyncSeedFromBaileysContact(contact))
      .filter(Boolean) as WhatsAppContactSyncInput[];

    if (seeds.length) {
      rememberSessionContacts(record, seeds);
      void upsertWhatsAppContacts(userId, seeds).catch((error) =>
        console.error(
          `[agent] WhatsApp contacts.upsert sync failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        ),
      );
    }
  });

  sock.ev.on("contacts.update", (contacts) => {
    const seeds = contacts
      .map((contact) => buildSyncSeedFromBaileysContact(contact))
      .filter(Boolean) as WhatsAppContactSyncInput[];

    if (seeds.length) {
      rememberSessionContacts(record, seeds);
      void upsertWhatsAppContacts(userId, seeds).catch((error) =>
        console.error(
          `[agent] WhatsApp contacts.update sync failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        ),
      );
    }
  });

  sock.ev.on("chats.upsert", (chats) => {
    const seeds = chats
      .map((chat) => buildSyncSeedFromChat(chat as Record<string, unknown>))
      .filter(Boolean) as WhatsAppContactSyncInput[];

    if (seeds.length) {
      rememberSessionContacts(record, seeds);
    }
  });

  sock.ev.on("chats.update", (chats) => {
    const seeds = chats
      .map((chat) => buildSyncSeedFromChat(chat as Record<string, unknown>))
      .filter(Boolean) as WhatsAppContactSyncInput[];

    if (seeds.length) {
      rememberSessionContacts(record, seeds);
    }
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    const current = sessions.get(userId);
    if (current !== record) {
      return;
    }

    if (qr) {
      console.log(`[agent] QR generated for ${userId}`);
      current.qr = await QRCode.toDataURL(qr, { width: 360, margin: 2 });
      current.qrIssuedAt = Date.now();
      current.status = "waiting";
      sessions.set(userId, current);
    }

    if (connection === "open") {
      const phone = sock.user?.id?.split(":")[0] ?? null;
      console.log(`[agent] WhatsApp connected for ${userId}${phone ? ` (${phone})` : ""}`);
      current.status = "connected";
      current.phone = phone;
      current.qr = null;
      current.qrIssuedAt = null;
      sessions.set(userId, current);

      const sendWelcomeNow = await shouldSendWelcome(userId, phone);
      await db()
        .from("connected_accounts")
        .upsert(
          {
            user_id: userId,
            provider: "whatsapp",
            phone_number: phone,
            account_email: phone,
            display_name: sock.user?.name || phone,
            is_active: true,
            connected_at: new Date().toISOString(),
          },
          { onConflict: "user_id,provider" },
        )
        .catch(() => null);

      current.lastChatJid = jidFromPhone(phone);
      sessions.set(userId, current);

      if (phone && sendWelcomeNow) {
        await sendWelcome(sock, phone, userId);
      }
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      sessions.delete(userId);

      if (!reconnect) {
        await markDisconnected(userId);
      }

      console.warn(`[agent] Closed for ${userId} (code: ${code ?? "?"}) reconnect=${reconnect}`);
      if (reconnect) {
        setTimeout(() => {
          void connectSession(userId);
        }, 3_000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") {
      return;
    }

    for (const message of messages) {
      const current = sessions.get(userId);
      if (current !== record) {
        return;
      }

      const remoteJid = message.key.remoteJid ?? null;
      const safeRemoteJid = toReplyableJid(remoteJid);
      const isGroupMessage = Boolean(remoteJid && isGroupChatJid(remoteJid));
      const mentionedJids = isGroupMessage ? getMentionedJids(message) : [];
      let replyTargetJid = safeRemoteJid;

      if (isGroupMessage) {
        const isMentioned = isBotMentioned(message, current);

        if (!isMentioned) {
          continue;
        }

        if (remoteJid && isGroupRateLimited(remoteJid)) {
          console.log(`[agent] Group rate limited: ${remoteJid}`);
          continue;
        }

        replyTargetJid = remoteJid ?? safeRemoteJid;
      }

      const messageId = message.key.id ?? "";
      if (messageId && outboundIds.has(messageId)) {
        outboundIds.delete(messageId);
        continue;
      }

      const syncSeed = buildSyncSeedFromMessage(message);
      if (syncSeed) {
        rememberSessionContacts(record, [syncSeed]);
        void upsertWhatsAppContacts(userId, [syncSeed]).catch((error) =>
          console.error(
            `[agent] WhatsApp message contact sync failed for ${userId}:`,
            error instanceof Error ? error.message : error,
          ),
        );
      }

      if (message.key.fromMe && !isSelfChat(message, current)) {
        continue;
      }

      if (!message.key.fromMe && !replyTargetJid) {
        continue;
      }

      let text =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        "";
      let mediaHandled = false;

      if (isGroupMessage && text) {
        text = stripMentionTokens(text, mentionedJids);
      }

      const quotedReplyText = extractQuotedReplyText(message);
      if (text && quotedReplyText) {
        const quotedSnippet = quotedReplyText.slice(0, 300);
        const needsEllipsis = quotedReplyText.length > 300;

        if (quotedSnippet !== text.trim()) {
          text = [
            `[Replying to: "${quotedSnippet}${needsEllipsis ? "..." : ""}"]`,
            text,
          ].join("\n");
          console.log(`[agent] Quoted reply detected for ${userId}; context prepended`);
        }
      }

      if (!text && message.message?.imageMessage) {
        const caption = message.message.imageMessage.caption?.trim() ?? "";
        const mimeType = message.message.imageMessage.mimetype ?? "image/jpeg";

        if (isVisionAvailable()) {
          const session = sessions.get(userId);
          const jid = session ? resolveReplyJid(session, replyTargetJid) : null;
          if (jid && session) {
            await session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
          }

          console.log(`[agent] Image received for ${userId}; downloading for vision`);
          const imageBuffer = await downloadMediaBuffer(message, "image");

          if (imageBuffer) {
            const visionAnswer = await analyseImage(imageBuffer, mimeType, caption);
            if (visionAnswer) {
              const reply = formatVisionReply(visionAnswer, Boolean(caption));
              await sendReply(userId, reply, replyTargetJid);
              mediaHandled = true;
            } else {
              text = caption || "Can you describe what you see?";
            }
          } else {
            text = caption || "I received your image but couldn't download it. Please try again.";
          }
        } else if (caption) {
          text = caption;
        } else {
          await sendReply(
            userId,
            [
              "🖼️ *Image received!*",
              "",
              "Image analysis isn't configured on this deployment yet.",
              "Add `NVIDIA_API_KEY` or `OPENAI_API_KEY` to enable vision support.",
              "",
              "_Tip: You can also describe the image in text and I'll help you from there._",
            ].join("\n"),
            replyTargetJid,
          );
          mediaHandled = true;
        }
      }

      if (!text && !mediaHandled && message.message?.audioMessage) {
        const mimeType = message.message.audioMessage.mimetype ?? "audio/ogg; codecs=opus";

        if (isWhisperAvailable()) {
          const session = sessions.get(userId);
          const jid = session ? resolveReplyJid(session, replyTargetJid) : null;
          if (jid && session) {
            await session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
          }

          console.log(`[agent] Voice note received for ${userId}; transcribing`);
          const audioBuffer = await downloadMediaBuffer(message, "audio");

          if (audioBuffer) {
            const transcript = await transcribeAudioBuffer(audioBuffer, mimeType);
            if (transcript) {
              console.log(
                `[agent] Transcript: "${transcript.slice(0, 80)}${transcript.length > 80 ? "..." : ""}"`,
              );
              text = `[Voice note transcribed]: ${transcript}`;
            } else {
              await sendReply(
                userId,
                "I received your voice note but couldn't transcribe it. Please try again or type your message.",
                replyTargetJid,
              );
              mediaHandled = true;
            }
          } else {
            await sendReply(
              userId,
              "I received your voice note but couldn't download it. Please try again.",
              replyTargetJid,
            );
            mediaHandled = true;
          }
        } else {
          await sendReply(
            userId,
            "I received your voice note, but voice transcription is not configured yet. Add `GROQ_API_KEY` to enable voice notes.",
            replyTargetJid,
          );
          mediaHandled = true;
        }
      }

      if (!text && !mediaHandled && message.message?.documentMessage) {
        const mimeType =
          message.message.documentMessage.mimetype ?? "application/octet-stream";
        const fileName =
          message.message.documentMessage.fileName ??
          `document.${mimeType.split("/")[1] ?? "bin"}`;
        const caption = message.message.documentMessage.caption?.trim() ?? "";

        if (isSupportedDocument(mimeType, fileName)) {
          const session = sessions.get(userId);
          const jid = session ? resolveReplyJid(session, replyTargetJid) : null;
          if (jid && session) {
            await session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
          }

          console.log(
            `[agent] Document received for ${userId}: "${fileName}" (${mimeType})`,
          );
          const documentBuffer = await downloadMediaBuffer(message, "document");

          if (documentBuffer) {
            const extracted = await extractDocumentText(documentBuffer, mimeType, fileName);
            if (extracted) {
              text = buildDocumentQuestionPrompt(extracted, caption);
            } else {
              await sendReply(
                userId,
                `I received *${fileName}* but couldn't extract text from it. Supported formats are PDF, DOCX, XLSX, TXT, CSV, Markdown, and JSON.`,
                replyTargetJid,
              );
              mediaHandled = true;
            }
          } else {
            await sendReply(
              userId,
              `I received *${fileName}* but couldn't download it. Please try again.`,
              replyTargetJid,
            );
            mediaHandled = true;
          }
        } else {
          await sendReply(
            userId,
            `I received *${fileName}* but that file type is not supported yet.\n\nSupported formats: *PDF, DOCX, XLSX, TXT, CSV, Markdown, and JSON.*`,
            replyTargetJid,
          );
          mediaHandled = true;
        }
      }

      if (!text && !mediaHandled && message.message?.videoMessage) {
        const caption = message.message.videoMessage.caption?.trim() ?? "";
        const mimeType = message.message.videoMessage.mimetype ?? "video/mp4";
        if (isVideoProcessingAvailable()) {
          const session = sessions.get(userId);
          const jid = session ? resolveReplyJid(session, replyTargetJid) : null;
          if (jid && session) {
            await session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
          }

          console.log(`[agent] Video received for ${userId}; extracting transcript and frame`);
          const videoBuffer = await downloadMediaBuffer(message, "video");

          if (videoBuffer) {
            const videoPrompt = await buildVideoPromptFromMedia({
              videoBuffer,
              mimeType,
              caption,
            });

            if (videoPrompt) {
              text = videoPrompt;
            } else if (caption) {
              text = caption;
            } else {
              await sendReply(
                userId,
                [
                  "I received your video but could not extract enough audio or visual detail to answer confidently.",
                  "",
                  "Try one of these:",
                  "- add a caption with your question",
                  "- send the key frame as an image",
                  "- send the audio as a voice note",
                ].join("\n"),
                replyTargetJid,
              );
              mediaHandled = true;
            }
          } else {
            await sendReply(
              userId,
              "I received your video but couldn't download it. Please try again.",
              replyTargetJid,
            );
            mediaHandled = true;
          }
        } else if (caption) {
          text = caption;
        } else {
          await sendReply(
            userId,
            [
              "🎥 *Video received!*",
              "",
              "Video analysis is not configured on this deployment yet.",
              "",
              "To enable it, add an ffmpeg binary plus voice or vision support.",
              "• Send me the *audio only* as a voice note - I'll transcribe it",
              "• *Type your question* and I'll answer immediately",
              "• Share a *YouTube link* and I'll summarise the video for you",
            ].join("\n"),
            replyTargetJid,
          );
          mediaHandled = true;
        }
      }

      if (!text && !mediaHandled && message.message?.locationMessage) {
        const loc = message.message.locationMessage;
        const lat = loc.degreesLatitude ?? 0;
        const lng = loc.degreesLongitude ?? 0;
        const name = loc.name?.trim() ?? "";
        const address = loc.address?.trim() ?? "";
        const locationLabel = name || address || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

        text = `Tell me about this location and what's nearby: ${locationLabel}. Coordinates: ${lat}, ${lng}. Give me the weather, nearby landmarks, and any useful local information.`;
      }

      if (!text && !mediaHandled && message.message?.stickerMessage) {
        await sendReply(
          userId,
          [
            "😄 *Sticker received!*",
            "",
            "I can't view stickers, but I love the energy.",
            "What can I help you with today?",
          ].join("\n"),
          replyTargetJid,
        );
        mediaHandled = true;
      }

      if (!text && !mediaHandled && message.message?.contactMessage) {
        const contact = message.message.contactMessage;
        const displayName = contact.displayName?.trim() || "Unknown";
        const vcard = contact.vcard ?? "";
        const phoneMatch = vcard.match(/TEL[^:]*:([+\d\s\-().]+)/);
        const phone = phoneMatch?.[1]?.replace(/[^\d+]/g, "").trim() ?? "";

        if (phone) {
          text = `Save contact: ${displayName} = ${phone}`;
        } else {
          await sendReply(
            userId,
            [
              `👤 *Contact received: ${displayName}*`,
              "",
              "I couldn't extract a phone number from this contact card.",
              "You can save contacts manually by typing:",
              `_Save ${displayName} as +91XXXXXXXXXX_`,
            ].join("\n"),
            replyTargetJid,
          );
          mediaHandled = true;
        }
      }

      if (!text && !mediaHandled && message.message?.reactionMessage) {
        const emoji = message.message.reactionMessage.text ?? "";
        const positiveReactions = ["👍", "❤️", "🔥", "😍", "👏", "🙏", "💯", "✅", "😊", "🤩"];

        if (positiveReactions.includes(emoji)) {
          await sendReply(
            userId,
            "Glad that was helpful! 😊 What else can I help you with?",
            replyTargetJid,
          );
        }

        mediaHandled = true;
      }

      if (mediaHandled) {
        continue;
      }

      if (isGroupMessage && text) {
        text = stripMentionTokens(text, mentionedJids);
      }

      if (!text) {
        continue;
      }

      if (messageId) {
        const now = Date.now();
        pruneInboundIdCache(now);
        const seenAt = inboundIds.get(messageId);
        if (seenAt && now - seenAt <= INBOUND_ID_TTL_MS) {
          continue;
        }
        inboundIds.set(messageId, now);
      }

      if (!isGroupMessage) {
        const onboardingState = await getActiveOnboardingState(userId).catch(() => null);
        if (onboardingState) {
          const onboardingReply = await handleOnboardingReply(
            userId,
            stripQuotedReplyPrefix(text),
          ).catch(() => null);
          if (onboardingReply) {
            await sendReply(userId, onboardingReply, replyTargetJid);
            continue;
          }
        } else {
          const shouldStartOnboarding = await isNewUserNeedingOnboarding(userId).catch(() => false);
          if (shouldStartOnboarding) {
            const onboardingReply = await startOnboarding(userId).catch(() => null);
            if (onboardingReply) {
              await sendReply(userId, onboardingReply, replyTargetJid);
              continue;
            }
          }
        }
      }

      if (text && detectImageGenIntent(text)) {
        if (!isImageGenAvailable()) {
          await sendReply(
            userId,
            [
              "🎨 *Image generation isn't set up yet.*",
              "",
              "This deployment needs at least one working image provider.",
              "Supported options: *Pollinations*, `HF_TOKEN`, or `GOOGLE_GEMINI_API_KEY`.",
            ].join("\n"),
            replyTargetJid,
          );
          continue;
        }

        const session = sessions.get(userId);
        const jid = session ? resolveReplyJid(session, replyTargetJid) : null;
        if (jid && session) {
          await session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
        }

        await sendReply(
          userId,
          "🎨 _Generating your image... this takes about 10 seconds_",
          replyTargetJid,
        );

        const prompt = extractImagePrompt(text);
        const result = await generateImage(prompt).catch(() => null);

        if (result && jid && session) {
          const sent = await session.sock.sendMessage(jid, {
            image: result.imageBuffer,
            mimetype: result.mimeType,
            caption: `🎨 *Generated:* ${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}`,
          }).catch(() => null);

          if (sent?.key?.id) {
            outboundIds.add(sent.key.id);
          }
          if (isGroupChatJid(jid)) {
            markGroupReplied(jid);
          }
        } else {
          await sendReply(
            userId,
            [
              "❌ *Image generation failed.*",
              "",
              "The image provider returned an error. Please try:",
              "• A simpler or more specific prompt",
              "• Trying again in a moment",
            ].join("\n"),
            replyTargetJid,
          );
        }
        continue;
      }

      if (text && hasUrlIntent(text)) {
        const session = sessions.get(userId);
        const jid = session ? resolveReplyJid(session, replyTargetJid) : null;
        if (jid && session) {
          await session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
        }

        const urlReply = await handleUrlMessage(text).catch(() => null);
        if (urlReply) {
          await sendReply(userId, urlReply, replyTargetJid);
          continue;
        }
      }

      if (text && detectCodeRunIntent(text)) {
        const session = sessions.get(userId);
        const jid = session ? resolveReplyJid(session, replyTargetJid) : null;
        if (jid && session) {
          await session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
        }

        const codeReply = await runUserCode(text).catch(() => null);
        if (codeReply) {
          await sendReply(userId, codeReply, replyTargetJid);
          continue;
        }
      }

      if (text && detectUpiSms(text)) {
        const transaction = parseUpiSms(text, userId);
        if (transaction) {
          const saved = await saveUpiTransaction(transaction).catch(() => false);
          if (saved) {
            await sendReply(userId, formatUpiSaveReply(transaction), replyTargetJid);
            continue;
          }
        }
      }

      console.log(`[agent] Inbound from ${userId}: "${text.slice(0, 80)}"`);
      const agentText = isGroupMessage
        ? `[Group message — respond concisely for a group audience]\n${text}`
        : text;
      await handleInbound(userId, text, message.key.id ?? null, replyTargetJid, message, agentText);
    }
  });

  return record;
}

function shouldRegenerateQr(session: SessionRecord, forceRefresh: boolean) {
  if (session.status !== "waiting") {
    return false;
  }

  if (forceRefresh) {
    return true;
  }

  if (!session.qr || !session.qrIssuedAt) {
    return true;
  }

  // WhatsApp pairing QR turns stale quickly; rotate before users hit hard-expiry.
  return Date.now() - session.qrIssuedAt > 75_000;
}

function isSelfChat(message: { key?: { remoteJid?: string | null } }, session: SessionRecord) {
  const jid = String(message.key?.remoteJid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
  const phone = session.phone?.replace(/\D/g, "") ?? "";
  return Boolean(phone && jid && phone === jid);
}

function findSessionByPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  for (const [userId, session] of sessions.entries()) {
    if (session.phone?.replace(/\D/g, "") === digits) {
      return { userId, session };
    }
  }
  return null;
}

registerClawCloudWhatsAppRuntime({
  async send({ userId, phone, jid, message, contactName }) {
    const resolvedSession = userId
      ? { userId, session: sessions.get(userId) ?? null }
      : (phone ? findSessionByPhone(phone) : null);
    const session = resolvedSession?.session ?? [...sessions.values()][0] ?? null;
    if (!session) {
      return false;
    }

    const normalizedPhone = phone ? phone.replace(/\D/g, "") : "";
    const targetJid = jid || (normalizedPhone ? `${normalizedPhone}@s.whatsapp.net` : "");
    if (!targetJid) {
      return false;
    }

    await sendStreamingMessage(session.sock, targetJid, message);
    if (resolvedSession?.userId) {
      void logOutbound(resolvedSession.userId, message, targetJid, sanitizeContactName(contactName));
    }
    return true;
  },
  async resolveContact({ userId, contactName }) {
    const session = sessions.get(userId) ?? null;
    if (!session) {
      return null;
    }

    const resolved = resolveSessionContact(session, contactName);
    if (!resolved) {
      return null;
    }

    return {
      name: resolved.name,
      phone: resolved.phone,
      jid: resolved.jid,
    };
  },
});

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : "";
}

async function restoreSessions() {
  if (configError()) {
    return;
  }

  try {
    const ids = Array.from(new Set([
      ...(await getActiveUserIds()),
      ...savedSessionUserIds(),
    ]));

    if (!ids.length) {
      console.log(
        `[agent] No active sessions to restore (saved auth dirs: ${savedSessionUserIds().length})`,
      );
      return;
    }

    console.log(`[agent] Restoring ${ids.length} session(s)...`);
    for (const id of ids) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      void connectSession(id).catch((error) =>
        console.error(
          `[agent] Restore failed for ${id}:`,
          error instanceof Error ? error.message : error,
        ),
      );
    }
  } catch (error) {
    console.error("[agent] Restore error:", error);
  }
}

async function sessionWatchdog() {
  const now = Date.now();

  for (const [userId, session] of sessions.entries()) {
    if (session.status === "connected") {
      continue;
    }

    if (now - session.startedAt < SESSION_WATCHDOG_STALE_MS) {
      continue;
    }

    console.warn(`[agent] Watchdog restarting stuck session for ${userId} (${session.status})`);
    const hasSavedAuth = fs.existsSync(sessionDir(userId));
    await discardSession(userId, session, { deleteAuth: false });

    if (!hasSavedAuth) {
      await markDisconnected(userId);
      continue;
    }

    void connectSession(userId).catch((error) =>
      console.error(
        `[agent] Watchdog reconnect failed for ${userId}:`,
        error instanceof Error ? error.message : error,
      ),
    );
  }
}

const app = express();
app.use(express.json());

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const error = configError();
  if (error) {
    res.status(503).json({ error, missingRequiredEnv: missingEnv() });
    return;
  }

  if (req.headers.authorization?.trim() !== `Bearer ${process.env.AGENT_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

app.get("/wa/qr/:userId", auth, async (req, res) => {
  try {
    const userId = readParam(req.params.userId);
    const forceRefresh = String(req.query.refresh ?? "").trim() === "1";

    let session = await connectSession(userId);
    if (shouldRegenerateQr(session, forceRefresh)) {
      console.log(
        `[agent] Refreshing QR for ${userId} (forced=${forceRefresh}, ageMs=${
          session.qrIssuedAt ? Date.now() - session.qrIssuedAt : -1
        })`,
      );
      await discardSession(userId, sessions.get(userId), { deleteAuth: true });
      session = await connectSession(userId);
    }

    res.json({
      status: session.status,
      qr: session.qr,
      phone: session.phone,
      qr_age_seconds: session.qrIssuedAt ? Math.floor((Date.now() - session.qrIssuedAt) / 1000) : null,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

app.delete("/wa/session/:userId", auth, async (req, res) => {
  const userId = readParam(req.params.userId);
  await discardSession(userId, sessions.get(userId), { deleteAuth: true });
  await markDisconnected(userId);
  res.json({ success: true });
});

app.post("/wa/send", auth, async (req, res) => {
  const phone = String(req.body.phone ?? "").trim();
  const jid = toReplyableJid(req.body.jid);
  const message = String(req.body.message ?? "").trim();
  const userId = String(req.body.userId ?? "").trim() || null;
  const contactName = sanitizeContactName(req.body.contactName);

  if ((!phone && !jid) || !message) {
    res.status(400).json({ error: "phone or jid, plus message, required" });
    return;
  }

  const resolvedSession = userId
    ? { userId, session: sessions.get(userId) ?? null }
    : (phone ? findSessionByPhone(phone) : null);
  const session = resolvedSession?.session ?? [...sessions.values()][0] ?? null;
  if (!session) {
    res.status(503).json({ error: "No active session" });
    return;
  }

  const targetJid = jid || `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
  await sendStreamingMessage(session.sock, targetJid, message);
  if (resolvedSession?.userId) {
    void logOutbound(resolvedSession.userId, message, targetJid, contactName);
  }
  res.json({ success: true });
});

app.post("/wa/resolve-contact", auth, async (req, res) => {
  const userId = String(req.body.userId ?? "").trim();
  const contactName = sanitizeContactName(req.body.contactName);

  if (!userId || !contactName) {
    res.status(400).json({ error: "userId and contactName required" });
    return;
  }

  const session = sessions.get(userId) ?? null;
  if (!session) {
    res.status(503).json({ error: "No active session for this user" });
    return;
  }

  const resolved = resolveSessionContact(session, contactName);
  if (!resolved) {
    res.status(404).json({ error: "No matching contact in active WhatsApp session" });
    return;
  }

  res.json({
    success: true,
    name: resolved.name,
    phone: resolved.phone,
    jid: resolved.jid,
  });
});

app.post("/wa/send-user/:userId", auth, async (req, res) => {
  const userId = readParam(req.params.userId);
  const message = String(req.body.message ?? "").trim();

  if (!userId || !message) {
    res.status(400).json({ error: "userId and message required" });
    return;
  }

  const ok = await sendReply(userId, message);
  if (!ok) {
    res.status(503).json({ error: "No active session for this user" });
    return;
  }

  const session = sessions.get(userId) ?? null;
  res.json({
    success: true,
    target: session ? resolveReplyJid(session) : null,
  });
});

app.get("/health", (_req, res) => {
  const error = configError();
  const connected = [...sessions.values()].filter((session) => session.status === "connected");
  const nvidia = ensureCanonicalNvidiaEnv();
  const nvidiaHints = getNvidiaEnvHints();
  const buildSha =
    process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || null;

  res.json({
    status: error ? "degraded" : "ok",
    configured: !error,
    build_sha: buildSha,
    railway_service: process.env.RAILWAY_SERVICE_NAME || null,
    connections: connected.length,
    total_sessions: sessions.size,
    nvidia_configured: Boolean(nvidia.value),
    nvidia_env_source: nvidia.key,
    nvidia_env_hints: nvidiaHints,
    app_url: appUrl() || "NOT SET",
    session_states: Object.fromEntries(
      [...sessions.entries()].map(([userId, session]) => [
        userId.slice(0, 8),
        {
          status: session.status,
          phone: session.phone ? "set" : "none",
        },
      ]),
    ),
    missingRequiredEnv: error ? missingEnv() : [],
    session_base_dir: sessionBaseDir(),
    saved_auth_dirs: savedSessionUserIds().length,
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

if (appUrl() && process.env.CRON_SECRET) {
  cron.schedule("* * * * *", async () => {
    try {
      const response = await fetch(`${appUrl()}/api/agent/cron`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(
          `[agent] Cron HTTP ${response.status}${body ? ` - ${body.slice(0, 100)}` : ""}`,
        );
      }
    } catch (error) {
      console.error("[agent] Cron failed:", error);
    }
  });
}

const port = Number(process.env.PORT || process.env.AGENT_PORT || 3001);
app.listen(Number.isFinite(port) && port > 0 ? port : 3001, "0.0.0.0", () => {
  const error = configError();
  if (error) {
    console.warn(error);
  }

  console.log(`[agent] Server listening on port ${port}`);
  logStartupDiagnostics();
  void restoreSessions();
  setInterval(() => {
    void sessionWatchdog();
  }, SESSION_WATCHDOG_INTERVAL_MS);
});
