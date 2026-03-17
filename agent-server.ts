import express from "express";
import * as cron from "node-cron";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient } from "@supabase/supabase-js";

loadEnvConfig(process.cwd());

const STALE_MS = 60_000;
const DIRECT_REPLY_TIMEOUT_MS = 50_000;
const HTTP_REPLY_TIMEOUT_MS = 55_000;
const STREAM_REPLY_MIN_LENGTH = 900;
const SESSION_WATCHDOG_STALE_MS = 3 * 60_000;
const SESSION_WATCHDOG_INTERVAL_MS = 5 * 60_000;

type SessionRecord = {
  sock: WASocket;
  status: "connecting" | "waiting" | "connected";
  qr: string | null;
  qrIssuedAt: number | null;
  phone: string | null;
  lastChatJid: string | null;
  startedAt: number;
};

type RouteInboundAgentMessageFn = (userId: string, message: string) => Promise<string | null>;

const sessions = new Map<string, SessionRecord>();
const outboundIds = new Set<string>();
const inboundIds = new Map<string, number>();
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
  const chunks: string[] = [];
  const sections = text.split(/\n\n+/);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.length <= 120) {
      chunks.push(trimmed);
      continue;
    }

    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    let current = "";

    for (const sentence of sentences) {
      if ((current + " " + sentence).length > 160 && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }
  }

  return chunks.filter(Boolean);
}

function chunkDelay(chunk: string) {
  const words = chunk.split(/\s+/).length;
  return Math.min(400 + words * 60, 1_200);
}

async function sendStreamingMessage(sock: WASocket, jid: string, fullText: string) {
  const chunks = splitIntoStreamChunks(fullText);

  if (chunks.length <= 1) {
    const sent = await sock.sendMessage(jid, { text: fullText.trim() });
    if (sent?.key?.id) {
      outboundIds.add(sent.key.id);
    }
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

    const sent = await sock.sendMessage(jid, { text: index === 0 ? chunk : chunk });
    if (sent?.key?.id) {
      outboundIds.add(sent.key.id);
    }

    if (!isLast) {
      await sock.sendPresenceUpdate("composing", jid).catch(() => null);
    }
  }

  await sock.sendPresenceUpdate("paused", jid).catch(() => null);
}

async function logOutbound(userId: string, content: string) {
  await db()
    .from("whatsapp_messages")
    .insert({
      user_id: userId,
      direction: "outbound",
      content,
      message_type: "text",
      sent_at: new Date().toISOString(),
    })
    .catch(() => null);
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

async function loadPreferredChatJid(userId: string) {
  const { data } = await db()
    .from("connected_accounts")
    .select("account_email")
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .maybeSingle()
    .catch(() => ({ data: null }));

  return jidFromPhone(data?.account_email);
}

async function persistPreferredChatTarget(
  userId: string,
  sessionPhone: string | null,
  remoteJid: string | null,
) {
  const remotePhone = phoneFromJid(remoteJid);
  const linkedPhone = normalizePhone(sessionPhone);

  if (!remotePhone || !linkedPhone || remotePhone === linkedPhone) {
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

async function sendWelcome(sock: WASocket, phone: string) {
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

  const jid = targetJid || session.lastChatJid || `${session.phone}@s.whatsapp.net`;
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
) {
  void db()
    .from("whatsapp_messages")
    .insert({
      user_id: userId,
      direction: "inbound",
      content: text,
      message_type: "text",
      wa_message_id: waId,
      sent_at: new Date().toISOString(),
    })
    .catch(() => null);

  const session = sessions.get(userId);
  if (session && remoteJid) {
    session.lastChatJid = remoteJid;
    sessions.set(userId, session);
    void persistPreferredChatTarget(userId, session.phone, remoteJid);
  }

  const jid =
    remoteJid ||
    session?.lastChatJid ||
    (session?.phone ? `${session.phone}@s.whatsapp.net` : null);

  if (jid && session) {
    void session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
  }

  let finalReply: string | null = null;

  console.log(`[agent] PATH A direct reply for ${userId}`);
  const directReply = await runDirectAgentReply(userId, text);
  if (directReply?.trim() && !isEmptyOrFallback(directReply)) {
    finalReply = directReply.trim();
    console.log(`[agent] PATH A success for ${userId} (${finalReply.length} chars)`);
  } else {
    console.warn(`[agent] PATH A empty or fallback for ${userId} - trying PATH B`);

    if (appUrl()) {
      console.log(`[agent] PATH B HTTP call to ${appUrl()}/api/agent/message`);
      const response = await callNext("/api/agent/message", {
        userId,
        message: text,
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
  });

  const record: SessionRecord = {
    sock,
    status: "connecting",
    qr: null,
    qrIssuedAt: null,
    phone: null,
    lastChatJid: preferredChatJid,
    startedAt: Date.now(),
  };

  sessions.set(userId, record);
  sock.ev.on("creds.update", saveCreds);

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
            display_name: sock.user?.name || phone,
            is_active: true,
            connected_at: new Date().toISOString(),
          },
          { onConflict: "user_id,provider" },
        )
        .catch(() => null);

      if (phone && sendWelcomeNow) {
        await sendWelcome(sock, phone);
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

      const messageId = message.key.id ?? "";
      if (messageId && outboundIds.has(messageId)) {
        outboundIds.delete(messageId);
        continue;
      }

      if (message.key.fromMe && !isSelfChat(message, current)) {
        continue;
      }

      const text =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        message.message?.imageMessage?.caption ||
        "";

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

      console.log(`[agent] Inbound from ${userId}: "${text.slice(0, 80)}"`);
      await handleInbound(userId, text, message.key.id ?? null, message.key.remoteJid ?? null);
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

function findByPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  for (const session of sessions.values()) {
    if (session.phone?.replace(/\D/g, "") === digits) {
      return session;
    }
  }
  return null;
}

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
  const message = String(req.body.message ?? "").trim();

  if (!phone || !message) {
    res.status(400).json({ error: "phone and message required" });
    return;
  }

  const session = findByPhone(phone) ?? [...sessions.values()][0] ?? null;
  if (!session) {
    res.status(503).json({ error: "No active session" });
    return;
  }

  const jid = `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
  await sendStreamingMessage(session.sock, jid, message);
  res.json({ success: true });
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

  res.json({
    success: true,
    target: sessions.get(userId)?.lastChatJid || sessions.get(userId)?.phone || null,
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
