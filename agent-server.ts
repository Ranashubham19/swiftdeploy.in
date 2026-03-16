import express from "express";
import * as cron from "node-cron";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
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
  phone: string | null;
  lastChatJid: string | null;
  startedAt: number;
};

type RouteInboundAgentMessageFn = (userId: string, message: string) => Promise<string | null>;

const sessions = new Map<string, SessionRecord>();
const outboundIds = new Set<string>();
let cachedRouteInboundAgentMessage: RouteInboundAgentMessageFn | null = null;

function db() {
  return createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );
}

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXTJS_URL?.trim() || "";
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

  const checks = [
    { key: "SUPABASE_URL", value: process.env.SUPABASE_URL ?? "MISSING" },
    {
      key: "SUPABASE_SERVICE_ROLE_KEY",
      value: process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING",
    },
    { key: "AGENT_SECRET", value: process.env.AGENT_SECRET ? "SET" : "MISSING" },
    { key: "CRON_SECRET", value: process.env.CRON_SECRET ? "SET" : "MISSING" },
    {
      key: "NVIDIA_API_KEY",
      value: process.env.NVIDIA_API_KEY
        ? `SET (${process.env.NVIDIA_API_KEY.slice(0, 8)}...)`
        : "MISSING - AI answers may fall back",
    },
    {
      key: "NEXT_PUBLIC_APP_URL",
      value: process.env.NEXT_PUBLIC_APP_URL || "MISSING - HTTP fallback will fail",
    },
    { key: "NEXTJS_URL", value: process.env.NEXTJS_URL || "not set" },
    { key: "WA_SESSION_DIR", value: process.env.WA_SESSION_DIR || "./wa-sessions" },
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
  const base = process.env.WA_SESSION_DIR || "./wa-sessions";
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
    "⚡ *ClawCloud AI*",
    "",
    `I received your message: _"${message.slice(0, 100)}${message.length > 100 ? "..." : ""}"_`,
    "",
    "I'm currently having trouble completing that request.",
    "Please send it again in a moment. If it keeps happening, check swift-deploy.in.",
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
    (lower.startsWith("*i could not") && lower.length < 200)
  );
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
  if (!appUrl() || !process.env.AGENT_SECRET?.trim()) {
    console.error("[agent] callNext skipped: app URL or AGENT_SECRET is missing");
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_REPLY_TIMEOUT_MS);

  try {
    return await fetch(`${appUrl()}${pathname}`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.AGENT_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
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

  const module = await import("./lib/clawcloud-agent");
  cachedRouteInboundAgentMessage = module.routeInboundAgentMessage;
  return cachedRouteInboundAgentMessage;
}

async function runDirectAgentReply(userId: string, message: string): Promise<string | null> {
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
    finalReply = getBuiltinFallbackResponse(text);
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
      current.qr = await QRCode.toDataURL(qr, { width: 220, margin: 1 });
      current.status = "waiting";
      sessions.set(userId, current);
    }

    if (connection === "open") {
      const phone = sock.user?.id?.split(":")[0] ?? null;
      console.log(`[agent] WhatsApp connected for ${userId}${phone ? ` (${phone})` : ""}`);
      current.status = "connected";
      current.phone = phone;
      current.qr = null;
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

      console.log(`[agent] Inbound from ${userId}: "${text.slice(0, 80)}"`);
      await handleInbound(userId, text, message.key.id ?? null, message.key.remoteJid ?? null);
    }
  });

  return record;
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
    const ids = await getActiveUserIds();
    if (!ids.length) {
      console.log("[agent] No active sessions to restore");
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
    const session = await connectSession(readParam(req.params.userId));
    res.json({ status: session.status, qr: session.qr, phone: session.phone });
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

  res.json({
    status: error ? "degraded" : "ok",
    configured: !error,
    connections: connected.length,
    total_sessions: sessions.size,
    nvidia_configured: Boolean(process.env.NVIDIA_API_KEY),
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
