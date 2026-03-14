// agent-server.ts — ClawCloud WhatsApp Agent Server
// ─────────────────────────────────────────────────────────────────────────────
// KEY FEATURES:
//  1. Typing indicator fires IMMEDIATELY when message arrives
//  2. Streaming "typewriter" effect — sends text sentence-by-sentence
//     so it appears to TYPE in WhatsApp like ChatGPT streams
//  3. Professional message formatting preserved end-to-end
//  4. Auto-reconnect on session drop
//  5. Chunked delivery for long messages
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import * as cron from "node-cron";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient } from "@supabase/supabase-js";

// ─── Config ───────────────────────────────────────────────────────────────────

const STALE_MS = 60_000;

type SessionRecord = {
  sock: WASocket;
  status: "connecting" | "waiting" | "connected";
  qr: string | null;
  phone: string | null;
  lastChatJid: string | null;
  startedAt: number;
};

const sessions = new Map<string, SessionRecord>();
const outboundIds = new Set<string>();
const DIRECT_REPLY_TIMEOUT_MS = 15_000;
const HTTP_REPLY_TIMEOUT_MS = 10_000;

type RouteInboundAgentMessageFn = (userId: string, message: string) => Promise<string | null>;
let cachedRouteInboundAgentMessage: RouteInboundAgentMessageFn | null = null;

// ─── Supabase ─────────────────────────────────────────────────────────────────

function db() {
  return createClient(
    process.env.SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  );
}

// ─── Env ──────────────────────────────────────────────────────────────────────

function appUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.NEXTJS_URL?.trim() || "";
}

function missingEnv() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "AGENT_SECRET"].filter(
    (k) => !process.env[k]?.trim(),
  );
}

function configError() {
  const m = missingEnv();
  return m.length ? `Missing env vars: ${m.join(", ")}` : null;
}

function assertConfigured() {
  const e = configError();
  if (e) throw new Error(e);
}

// ─── WhatsApp version ─────────────────────────────────────────────────────────

async function getWAVersion(): Promise<[number, number, number]> {
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(`[agent] WA v${version.join(".")} (latest=${isLatest})`);
  return version;
}

// ─── Session dir ──────────────────────────────────────────────────────────────

function sessionDir(userId: string) {
  const base = process.env.WA_SESSION_DIR || "./wa-sessions";
  return path.join(base, userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

// ─── Discard session ──────────────────────────────────────────────────────────

async function discardSession(
  userId: string,
  rec: SessionRecord | undefined,
  opts: { deleteAuth?: boolean } = {},
) {
  if (rec) {
    try { await rec.sock.logout(); } catch { /* ignore */ }
    try { rec.sock.end(new Error("discarded")); } catch { /* ignore */ }
  }
  sessions.delete(userId);
  if (opts.deleteAuth) {
    const d = sessionDir(userId);
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
}

// ─── STREAMING TYPEWRITER EFFECT ─────────────────────────────────────────────
// This is the magic that makes replies feel like ChatGPT typing.
// Strategy: split the full reply into natural "chunks" (sentences / sections),
// then send each chunk with a short delay, keeping "composing" indicator on
// between chunks. The user sees text appearing progressively.

function splitIntoStreamChunks(text: string): string[] {
  // Split at sentence boundaries and section breaks for natural flow
  const chunks: string[] = [];
  
  // First split by double newlines (sections)
  const sections = text.split(/\n\n+/);
  
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    
    // For short sections (under 120 chars) — send as one chunk
    if (trimmed.length <= 120) {
      chunks.push(trimmed);
      continue;
    }
    
    // For longer sections — split by sentences
    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      if ((current + " " + sentence).length > 160 && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? current + " " + sentence : sentence;
      }
    }
    if (current.trim()) chunks.push(current.trim());
  }
  
  return chunks.filter(Boolean);
}

// Delay between chunks in ms — simulates typing speed
// Longer chunks get more time (realistic typing feel)
function chunkDelay(chunk: string): number {
  const words = chunk.split(/\s+/).length;
  // ~200 words/min typing = ~300ms per word, but we go faster for UX
  // Short chunk: 400-600ms, long chunk: 800-1200ms
  return Math.min(400 + words * 60, 1200);
}

// ─── Send with streaming typewriter effect ────────────────────────────────────

async function sendStreamingMessage(
  sock: WASocket,
  jid: string,
  fullText: string,
): Promise<void> {
  const chunks = splitIntoStreamChunks(fullText);
  
  if (chunks.length <= 1) {
    // Short reply — just send it directly, no need to split
    const sent = await sock.sendMessage(jid, { text: fullText.trim() });
    if (sent?.key?.id) outboundIds.add(sent.key.id);
    return;
  }

  // Multi-chunk: stream sentence by sentence with typing indicator between each
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    
    // Show typing indicator before each chunk (except before the very first
    // since we already started composing in handleInboundMessage)
    if (i > 0) {
      await sock.sendPresenceUpdate("composing", jid).catch(() => null);
      await new Promise((r) => setTimeout(r, chunkDelay(chunk)));
    }
    
    // Build the cumulative message (all chunks so far)
    // This makes it look like text is being appended progressively
    const textSoFar = chunks.slice(0, i + 1).join("\n\n");
    
    if (i === 0) {
      // First chunk — send as new message
      const sent = await sock.sendMessage(jid, { text: textSoFar });
      if (sent?.key?.id) outboundIds.add(sent.key.id);
    } else {
      // Subsequent chunks — send as new message (WhatsApp doesn't support
      // editing sent messages, so we send the full accumulated text each time
      // but delete previous non-final chunks... Actually simpler: just send
      // each section as its own message with small delay)
      await sock.sendPresenceUpdate("paused", jid).catch(() => null);
      await new Promise((r) => setTimeout(r, 300));
      
      // Send ONLY the new chunk as a continuation
      const sent = await sock.sendMessage(jid, { text: chunk });
      if (sent?.key?.id) outboundIds.add(sent.key.id);
    }
    
    if (!isLast) {
      await sock.sendPresenceUpdate("composing", jid).catch(() => null);
    }
  }
  
  // Final: stop composing
  await sock.sendPresenceUpdate("paused", jid).catch(() => null);
}

// ─── Save to DB ───────────────────────────────────────────────────────────────

async function logOutbound(userId: string, content: string) {
  await db().from("whatsapp_messages").insert({
    user_id: userId,
    direction: "outbound",
    content,
    message_type: "text",
    sent_at: new Date().toISOString(),
  }).catch(() => null);
}

// ─── Welcome message ──────────────────────────────────────────────────────────

async function sendWelcome(sock: WASocket, phone: string) {
  const jid = `${phone}@s.whatsapp.net`;
  const text = [
    "🦞 *ClawCloud AI is connected!*",
    "",
    "I'm your personal AI assistant — more capable than ChatGPT, right here on WhatsApp.",
    "",
    "Here's what I can do for you:",
    "💻 *Code* — write, debug, explain in any language",
    "📧 *Email* — search, draft, reply to your inbox",
    "📅 *Calendar* — check meetings & get briefings",
    "⏰ *Reminders* — set smart alerts",
    "🧠 *Knowledge* — answer any question on any topic",
    "📊 *Math* — solve problems step by step",
    "✍️ *Writing* — essays, reports, creative content",
    "💡 *Ideas* — brainstorm, analyze, strategize",
    "",
    "Just type naturally. I understand everything.",
    "",
    "Finish setup at swift-deploy.in to unlock all features 🚀",
  ].join("\n");

  const sent = await sock.sendMessage(jid, { text });
  if (sent?.key?.id) outboundIds.add(sent.key.id);
}

// ─── Send reply to user ───────────────────────────────────────────────────────

async function sendReply(userId: string, message: string, targetJid?: string | null): Promise<boolean> {
  const session = sessions.get(userId);
  if (!session?.phone) return false;

  const jid = targetJid || session.lastChatJid || `${session.phone}@s.whatsapp.net`;
  const cleaned = message.replace(/\n{3,}/g, "\n\n").trim();

  // Use streaming for messages over 100 chars
  if (cleaned.length > 100) {
    await sendStreamingMessage(session.sock, jid, cleaned);
  } else {
    const sent = await session.sock.sendMessage(jid, { text: cleaned });
    if (sent?.key?.id) outboundIds.add(sent.key.id);
  }

  await logOutbound(userId, message);
  return true;
}

// ─── Internal Next.js call ────────────────────────────────────────────────────

async function callNext(pathname: string, body: Record<string, unknown>) {
  if (!appUrl() || !process.env.AGENT_SECRET?.trim()) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_REPLY_TIMEOUT_MS);
  try {
    return await fetch(`${appUrl()}${pathname}`, {
    method: "POST",
    signal: ctrl.signal,
    headers: {
      Authorization: `Bearer ${process.env.AGENT_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  } finally {
    clearTimeout(timer);
  }
}

async function getDirectRouteInboundAgentMessage() {
  if (cachedRouteInboundAgentMessage) {
    return cachedRouteInboundAgentMessage;
  }

  const mod = await import("./lib/clawcloud-agent");
  cachedRouteInboundAgentMessage = mod.routeInboundAgentMessage;
  return cachedRouteInboundAgentMessage;
}

async function runDirectAgentReply(userId: string, message: string) {
  const routeInboundAgentMessage = await getDirectRouteInboundAgentMessage();
  const timeout = new Promise<string | null>((resolve) => {
    setTimeout(() => resolve(null), DIRECT_REPLY_TIMEOUT_MS);
  });

  try {
    return await Promise.race([routeInboundAgentMessage(userId, message), timeout]);
  } catch (error) {
    console.error(
      `[agent] Direct reply failed for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

// ─── Handle inbound message ───────────────────────────────────────────────────
// FLOW: message arrives → typing starts INSTANTLY → AI call → stream reply

async function handleInbound(
  userId: string,
  text: string,
  waId: string | null,
  remoteJid: string | null,
) {
  // 1. Log inbound
  await db().from("whatsapp_messages").insert({
    user_id: userId,
    direction: "inbound",
    content: text,
    message_type: "text",
    wa_message_id: waId,
    sent_at: new Date().toISOString(),
  }).catch(() => null);

  const session = sessions.get(userId);
  if (session && remoteJid) {
    session.lastChatJid = remoteJid;
    sessions.set(userId, session);
  }
  const jid = remoteJid || session?.lastChatJid || (session?.phone ? `${session.phone}@s.whatsapp.net` : null);

  // 2. Start typing indicator IMMEDIATELY — user sees this within milliseconds
  if (jid && session) {
    void session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
  }

  // 3. Try direct in-process reply first for the fastest, most reliable path.
  const directReply = await runDirectAgentReply(userId, text);
  if (jid && session) {
    void session.sock.sendPresenceUpdate("paused", jid).catch(() => null);
  }
  if (directReply?.trim()) {
    await sendReply(userId, directReply, jid);
    return;
  }

  // 4. Fall back to the Next.js internal API if needed.
  let response: Response | null = null;
  try {
    response = await callNext("/api/agent/message", {
      userId,
      message: text,
      _internal: true,
    });
  } catch (err) {
    console.error(`[agent] Backend call failed for ${userId}:`, err instanceof Error ? err.message : err);
    if (jid && session) void session.sock.sendPresenceUpdate("paused", jid).catch(() => null);
    return;
  }

  if (!response) {
    console.error(`[agent] No response for ${userId}: app URL or secret not configured`);
    if (jid && session) {
      void session.sock.sendPresenceUpdate("paused", jid).catch(() => null);
      await sendReply(
        userId,
        "*ClawCloud is connected, but the reply service is temporarily unavailable.*\n\nPlease try again in a few seconds.",
        jid,
      ).catch(() => null);
    }
    return;
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[agent] Backend error for ${userId}: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    if (jid && session) {
      void session.sock.sendPresenceUpdate("paused", jid).catch(() => null);
      await sendReply(
        userId,
        "*ClawCloud hit a temporary error while generating the reply.*\n\nPlease send the message once more.",
        jid,
      ).catch(() => null);
    }
    return;
  }

  const json = (await response.json().catch(() => ({}))) as { response?: string | null };

  // 4. Stop typing, stream the reply
  if (jid && session) void session.sock.sendPresenceUpdate("paused", jid).catch(() => null);

  if (json.response?.trim()) {
    await sendReply(userId, json.response, jid);
    return;
  }

  console.log(`[agent] No direct reply for ${userId} — task running async`);
  if (jid && session) {
    await sendReply(
      userId,
      "*Working on it.* I started the task and I’ll send the result here as soon as it’s ready.",
      jid,
    ).catch(() => null);
  }
}

// ─── WhatsApp session ─────────────────────────────────────────────────────────

async function markDisconnected(userId: string) {
  await db().from("connected_accounts").update({ is_active: false })
    .eq("user_id", userId).eq("provider", "whatsapp").catch(() => null);
}

async function getActiveUserIds(): Promise<string[]> {
  const { data } = await db().from("connected_accounts").select("user_id")
    .eq("provider", "whatsapp").eq("is_active", true);
  return (data ?? []).map((r) => String(r.user_id ?? "").trim()).filter(Boolean);
}

async function connectSession(userId: string): Promise<SessionRecord> {
  assertConfigured();

  const existing = sessions.get(userId);
  if (existing && (existing.status === "waiting" || existing.status === "connected")) return existing;
  if (existing && existing.status === "connecting") {
    if (Date.now() - existing.startedAt < STALE_MS) return existing;
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
    lastChatJid: null,
    startedAt: Date.now(),
  };
  sessions.set(userId, record);
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    const cur = sessions.get(userId);
    if (cur !== record) return;

    if (qr) {
      console.log(`[agent] QR for ${userId}`);
      cur.qr = await QRCode.toDataURL(qr, { width: 220, margin: 1 });
      cur.status = "waiting";
      sessions.set(userId, cur);
    }

    if (connection === "open") {
      const phone = sock.user?.id?.split(":")[0] ?? null;
      console.log(`[agent] Connected for ${userId}${phone ? ` (${phone})` : ""}`);
      cur.status = "connected";
      cur.phone = phone;
      cur.qr = null;
      sessions.set(userId, cur);

      await db().from("connected_accounts").upsert({
        user_id: userId, provider: "whatsapp", phone_number: phone,
        display_name: sock.user?.name || phone, is_active: true,
        connected_at: new Date().toISOString(),
      }, { onConflict: "user_id,provider" }).catch(() => null);

      if (phone) await sendWelcome(sock, phone);
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      sessions.delete(userId);
      if (!reconnect) await markDisconnected(userId);
      console.warn(`[agent] Closed for ${userId} (code: ${code ?? "?"})`);
      if (reconnect) setTimeout(() => void connectSession(userId), 3000);
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") return;
    for (const msg of messages) {
      const cur = sessions.get(userId);
      if (cur !== record) return;

      const msgId = msg.key.id ?? "";
      if (msgId && outboundIds.has(msgId)) { outboundIds.delete(msgId); continue; }
      if (msg.key.fromMe && !isSelfChat(msg, cur)) continue;

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
      if (!text) continue;

      console.log(`[agent] Msg from ${userId} (type=${type})`);
      await handleInbound(
        userId,
        text,
        msg.key.id ?? null,
        msg.key.remoteJid ?? null,
      );
    }
  });

  return record;
}

function isSelfChat(msg: { key?: { remoteJid?: string | null } }, s: SessionRecord) {
  const jid = String(msg.key?.remoteJid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
  const ph = s.phone?.replace(/\D/g, "") ?? "";
  return Boolean(ph && jid && ph === jid);
}

function findByPhone(phone: string) {
  const d = phone.replace(/\D/g, "");
  for (const s of sessions.values()) {
    if (s.phone?.replace(/\D/g, "") === d) return s;
  }
  return null;
}

function readParam(v: string | string[] | undefined) {
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
}

async function restoreSessions() {
  if (configError()) return;
  try {
    const ids = await getActiveUserIds();
    if (!ids.length) { console.log("[agent] No sessions to restore"); return; }
    console.log(`[agent] Restoring ${ids.length} session(s)`);
    for (const id of ids) {
      void connectSession(id).catch((e) =>
        console.error(`[agent] Restore failed for ${id}:`, e instanceof Error ? e.message : e),
      );
    }
  } catch (e) {
    console.error("[agent] Restore error:", e);
  }
}

// ─── Express ──────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const err = configError();
  if (err) { res.status(503).json({ error: err, missingRequiredEnv: missingEnv() }); return; }
  if (req.headers.authorization?.trim() !== `Bearer ${process.env.AGENT_SECRET}`) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  next();
}

app.get("/wa/qr/:userId", auth, async (req, res) => {
  try {
    const s = await connectSession(readParam(req.params.userId));
    res.json({ status: s.status, qr: s.qr, phone: s.phone });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed" });
  }
});

app.delete("/wa/session/:userId", auth, async (req, res) => {
  const id = readParam(req.params.userId);
  await discardSession(id, sessions.get(id), { deleteAuth: true });
  await markDisconnected(id);
  res.json({ success: true });
});

app.post("/wa/send", auth, async (req, res) => {
  const phone = String(req.body.phone ?? "").trim();
  const message = String(req.body.message ?? "").trim();
  if (!phone || !message) { res.status(400).json({ error: "phone and message required" }); return; }

  const session = findByPhone(phone) ?? [...sessions.values()][0] ?? null;
  if (!session) { res.status(503).json({ error: "No active session" }); return; }

  const jid = `${phone.replace(/\D/g, "")}@s.whatsapp.net`;
  await sendStreamingMessage(session.sock, jid, message);
  res.json({ success: true });
});

app.get("/health", (_req, res) => {
  const m = missingEnv();
  res.json({ status: m.length ? "degraded" : "ok", configured: m.length === 0, missingRequiredEnv: m, connections: sessions.size });
});

// ─── Cron ─────────────────────────────────────────────────────────────────────

if (appUrl() && process.env.CRON_SECRET) {
  cron.schedule("* * * * *", async () => {
    try {
      await fetch(`${appUrl()}/api/agent/cron`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
    } catch (e) { console.error("[agent] Cron failed:", e); }
  });
}

// ─── Start ────────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT || process.env.AGENT_PORT || 3001);
app.listen(Number.isFinite(port) && port > 0 ? port : 3001, "0.0.0.0", () => {
  const e = configError();
  if (e) console.warn(e);
  console.log(`ClawCloud agent running on port ${port}`);
  void restoreSessions();
});
