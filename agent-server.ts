import { Boom } from "@hapi/boom";
import {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import express from "express";
import cron from "node-cron";
import QRCode from "qrcode";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const envFilesLoaded = new Set<string>();

function loadEnvFile(filename: string) {
  if (!fs.existsSync(filename)) {
    return;
  }

  const content = fs.readFileSync(filename, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!key) {
      continue;
    }

    if (!(key in process.env) || envFilesLoaded.has(key)) {
      process.env[key] = value;
      envFilesLoaded.add(key);
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env"));
loadEnvFile(path.join(process.cwd(), ".env.local"));

type SessionRecord = {
  sock: WASocket;
  status: "connecting" | "waiting" | "connected";
  qr: string | null;
  phone: string | null;
  startedAt: number;
};

const requiredEnv = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AGENT_SECRET",
] as const;

const app = express();
app.use(express.json());

let supabase: ReturnType<typeof createClient<any>> | null = null;

const sessions = new Map<string, SessionRecord>();
const STALE_CONNECTING_MS = 15_000;
const WA_VERSION_CACHE_MS = 6 * 60 * 60 * 1000;

let cachedWaVersion: [number, number, number] | null = null;
let cachedWaVersionAt = 0;

function getMissingRequiredEnv() {
  return requiredEnv.filter((envName) => !process.env[envName]?.trim());
}

function getConfigurationError() {
  const missing = getMissingRequiredEnv();
  return missing.length
    ? `Agent server is missing required env vars: ${missing.join(", ")}`
    : null;
}

function assertConfigured() {
  const configurationError = getConfigurationError();
  if (configurationError) {
    throw new Error(configurationError);
  }
}

function getSupabase() {
  assertConfigured();

  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    );
  }

  return supabase;
}

function getSessionsDir() {
  return process.env.WA_SESSION_DIR || path.join(process.cwd(), "wa-sessions");
}

function getSessionDirectory(userId: string) {
  return path.join(getSessionsDir(), userId);
}

function clearSessionDirectory(userId: string) {
  fs.rmSync(getSessionDirectory(userId), { recursive: true, force: true });
}

async function discardSession(
  userId: string,
  session: SessionRecord | undefined,
  options: { deleteAuth?: boolean } = {},
) {
  if (sessions.get(userId) === session) {
    sessions.delete(userId);
  }

  if (session) {
    try {
      await session.sock.logout();
    } catch {
      // Ignore logout failures during stale-session cleanup.
    }
  }

  if (options.deleteAuth) {
    clearSessionDirectory(userId);
  }
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTJS_URL || "";
}

async function getWhatsAppWebVersion() {
  const now = Date.now();
  if (cachedWaVersion && now - cachedWaVersionAt < WA_VERSION_CACHE_MS) {
    return cachedWaVersion;
  }

  const latest = await fetchLatestWaWebVersion({ timeout: 10_000 });
  cachedWaVersion = latest.version;
  cachedWaVersionAt = now;

  console.log(
    `[agent] Using WA Web version ${latest.version.join(".")} (latest=${latest.isLatest})`,
  );

  return latest.version;
}

function authMiddleware(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction,
) {
  const configurationError = getConfigurationError();
  if (configurationError) {
    response.status(503).json({
      error: configurationError,
      missingRequiredEnv: getMissingRequiredEnv(),
    });
    return;
  }

  const header = request.headers.authorization?.trim() ?? "";
  if (header !== `Bearer ${process.env.AGENT_SECRET}`) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
}

async function callNextInternal(pathname: string, body: Record<string, unknown>) {
  if (!getAppUrl() || !process.env.AGENT_SECRET?.trim()) {
    return null;
  }

  return fetch(`${getAppUrl()}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.AGENT_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function markWhatsAppDisconnected(userId: string) {
  await getSupabase()
    .from("connected_accounts")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("provider", "whatsapp");
}

async function sendWelcomeMessage(sock: WASocket, phone: string) {
  await sock.sendMessage(`${phone}@s.whatsapp.net`, {
    text: "Your ClawCloud AI agent is connected. Finish setup and I will start helping here.",
  });
}

async function sendSessionWhatsAppMessage(userId: string, message: string) {
  const session = sessions.get(userId);
  if (!session?.phone) {
    return false;
  }

  await session.sock.sendMessage(`${session.phone}@s.whatsapp.net`, { text: message });
  await getSupabase().from("whatsapp_messages").insert({
    user_id: userId,
    direction: "outbound",
    content: message,
    message_type: "text",
    sent_at: new Date().toISOString(),
  });

  return true;
}

async function handleInboundMessage(userId: string, text: string, waMessageId: string | null) {
  await getSupabase().from("whatsapp_messages").insert({
    user_id: userId,
    direction: "inbound",
    content: text,
    message_type: "text",
    wa_message_id: waMessageId,
    sent_at: new Date().toISOString(),
  });

  const response = await callNextInternal("/api/agent/message", {
    userId,
    message: text,
    _internal: true,
  });

  if (!response?.ok) {
    return;
  }

  const json = (await response.json().catch(() => ({}))) as {
    response?: string | null;
  };

  if (json.response) {
    await sendSessionWhatsAppMessage(userId, json.response);
  }
}

async function connectWhatsAppSession(userId: string) {
  assertConfigured();

  const existing = sessions.get(userId);
  if (existing && (existing.status === "waiting" || existing.status === "connected")) {
    return existing;
  }

  if (existing && existing.status === "connecting") {
    const isStale = Date.now() - existing.startedAt >= STALE_CONNECTING_MS;
    if (!isStale) {
      return existing;
    }

    console.warn(`[agent] Resetting stale WhatsApp session for ${userId}`);
    await discardSession(userId, existing, { deleteAuth: true });
  }

  const sessionDir = getSessionDirectory(userId);
  fs.mkdirSync(sessionDir, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const version = await getWhatsAppWebVersion();
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
      current.qr = await QRCode.toDataURL(qr, {
        width: 220,
        margin: 1,
      });
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

      await getSupabase().from("connected_accounts").upsert(
        {
          user_id: userId,
          provider: "whatsapp",
          phone_number: phone,
          display_name: sock.user?.name || phone,
          is_active: true,
          connected_at: new Date().toISOString(),
        },
        { onConflict: "user_id,provider" },
      );

      if (phone) {
        await sendWelcomeMessage(sock, phone);
      }
    }

    if (connection === "close") {
      const disconnectCode =
        (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const shouldReconnect = disconnectCode !== DisconnectReason.loggedOut;

      sessions.delete(userId);
      await markWhatsAppDisconnected(userId);
      console.warn(
        `[agent] WhatsApp connection closed for ${userId} (code: ${disconnectCode ?? "unknown"})`,
      );

      if (shouldReconnect) {
        setTimeout(() => {
          void connectWhatsAppSession(userId);
        }, 3000);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") {
      return;
    }

    for (const message of messages) {
      if (message.key.fromMe) {
        continue;
      }

      const text =
        message.message?.conversation ||
        message.message?.extendedTextMessage?.text ||
        "";

      if (!text) {
        continue;
      }

      await handleInboundMessage(userId, text, message.key.id ?? null);
    }
  });

  return record;
}

function findSessionByPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");

  for (const session of sessions.values()) {
    if (session.phone?.replace(/\D/g, "") === digits) {
      return session;
    }
  }

  return null;
}

function readRouteParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : "";
}

app.get("/wa/qr/:userId", authMiddleware, async (request, response) => {
  try {
    const userId = readRouteParam(request.params.userId);
    const session = await connectWhatsAppSession(userId);
    response.json({
      status: session.status,
      qr: session.qr,
      phone: session.phone,
    });
  } catch (error) {
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unable to start WhatsApp session.",
    });
  }
});

app.delete("/wa/session/:userId", authMiddleware, async (request, response) => {
  const userId = readRouteParam(request.params.userId);
  const session = sessions.get(userId);
  await discardSession(userId, session, { deleteAuth: true });

  await markWhatsAppDisconnected(userId);
  response.json({ success: true });
});

app.post("/wa/send", authMiddleware, async (request, response) => {
  const phone = String(request.body.phone ?? "").trim();
  const message = String(request.body.message ?? "").trim();

  if (!phone || !message) {
    response.status(400).json({ error: "phone and message are required" });
    return;
  }

  const session = findSessionByPhone(phone) ?? [...sessions.values()][0] ?? null;
  if (!session) {
    response.status(503).json({ error: "No active WhatsApp session" });
    return;
  }

  await session.sock.sendMessage(`${phone.replace(/\D/g, "")}@s.whatsapp.net`, {
    text: message,
  });
  response.json({ success: true });
});

app.get("/health", (_request, response) => {
  const missingRequiredEnv = getMissingRequiredEnv();

  response.json({
    status: missingRequiredEnv.length ? "degraded" : "ok",
    configured: missingRequiredEnv.length === 0,
    missingRequiredEnv,
    connections: sessions.size,
  });
});

if (getAppUrl() && process.env.CRON_SECRET) {
  cron.schedule("* * * * *", async () => {
    try {
      await fetch(`${getAppUrl()}/api/agent/cron`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.CRON_SECRET}`,
        },
      });
    } catch (error) {
      console.error("ClawCloud cron bridge failed", error);
    }
  });
}

const rawPort = Number(process.env.PORT || process.env.AGENT_PORT || 3001);
const port = Number.isFinite(rawPort) && rawPort > 0 ? rawPort : 3001;
const host = "0.0.0.0";

app.listen(port, host, () => {
  const configurationError = getConfigurationError();
  if (configurationError) {
    console.warn(configurationError);
  }

  console.log(`ClawCloud agent server running on ${host}:${port}`);
});
