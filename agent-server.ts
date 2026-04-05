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
  WAMessageStatus,
  type Contact as WAContact,
  type MediaType,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient } from "@supabase/supabase-js";
import {
  buildClawCloudAnswerQualityProfile,
  buildClawCloudLowConfidenceReply,
} from "./lib/clawcloud-answer-quality";
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
  backfillWhatsAppContactsFromHistory,
  upsertWhatsAppContacts,
  type WhatsAppContactSyncInput,
} from "./lib/clawcloud-whatsapp-contacts";
import {
  applyWhatsAppReplyMode,
  decideWhatsAppReplyAction,
  detectWhatsAppSensitivity,
  getWhatsAppPriorityForMessage,
  getWhatsAppSettings,
  markLatestWhatsAppThreadState,
  normalizeWhatsAppPriority,
  scoreWhatsAppReplyConfidence,
  writeWhatsAppAuditLog,
} from "./lib/clawcloud-whatsapp-control";
import {
  processDueWhatsAppWorkflowRuns,
  scheduleWhatsAppWorkflowRunsFromInbound,
} from "./lib/clawcloud-whatsapp-workflows";
import {
  ensureWhatsAppOutboundMessage,
  getWhatsAppOutboundMessage,
  markWhatsAppOutboundAckByWaMessageId,
  shouldRetryUndeliveredWhatsAppOutbound,
  transitionWhatsAppOutboundMessage,
  type WhatsAppMessageAckStatus,
} from "./lib/clawcloud-whatsapp-outbound";
import { registerClawCloudWhatsAppRuntime } from "./lib/clawcloud-whatsapp";
import {
  buildClawCloudWhatsAppSyncPolicy,
  shouldRequestMoreClawCloudWhatsAppHistory,
} from "./lib/clawcloud-whatsapp-sync-policy";
import {
  buildClawCloudWhatsAppHistoryBackfillPlan,
  summarizeClawCloudWhatsAppHistoryCoverage,
} from "./lib/clawcloud-whatsapp-history-plan";
import { buildClawCloudWhatsAppContactIdentityGraph } from "./lib/clawcloud-whatsapp-contact-identity";
import { buildWhatsAppReceiptDerivedAliasMap } from "./lib/clawcloud-whatsapp-contact-alias-receipts";
import {
  computeClawCloudWhatsAppSyncProgress,
  deriveClawCloudWhatsAppRuntimeHealth,
  type ClawCloudWhatsAppRuntimeConnectionStatus,
  type ClawCloudWhatsAppRuntimeStatus,
  type ClawCloudWhatsAppRuntimeSyncState,
} from "./lib/clawcloud-whatsapp-runtime";
import {
  computeClawCloudWhatsAppReconnectDelayMs,
  getClawCloudWhatsAppReconnectWaitMs,
  normalizeClawCloudWhatsAppRecoveryCheckpoint,
  type ClawCloudWhatsAppRecoveryCheckpoint,
} from "./lib/clawcloud-whatsapp-recovery";
import {
  buildClawCloudWhatsAppSyncCheckpointResumeRecommended,
  normalizeClawCloudWhatsAppSyncCheckpoint,
  type ClawCloudWhatsAppSyncCheckpoint,
} from "./lib/clawcloud-whatsapp-sync-checkpoint";
import {
  buildClawCloudWhatsAppSessionStorageHealth,
  resolveClawCloudWhatsAppSessionBaseDir,
  type ClawCloudWhatsAppSessionStorageHealth,
} from "./lib/clawcloud-whatsapp-storage";
import {
  shouldStageWhatsAppReply,
  splitWhatsAppStreamChunks,
  whatsAppChunkDelayMs,
  whatsAppInitialTypingDelayMs,
} from "./lib/clawcloud-whatsapp-streaming";
import { deleteWhatsAppWorkspaceData } from "./lib/clawcloud-whatsapp-governance";
import { listRetiredWhatsAppOwnerUserIds } from "./lib/clawcloud-whatsapp-owner-handoff";
import {
  extractWhatsAppPhoneShareFromChat,
  extractWhatsAppPhoneShareFromMessage,
  isWhatsAppResolvedSelfChat,
  resolveDefaultAssistantChatJid,
  shouldRememberAssistantSelfChat,
} from "./lib/clawcloud-whatsapp-routing";
import {
  defaultWhatsAppSettings,
  type WhatsAppContactPriority,
  type WhatsAppOutboundStatus,
  type WhatsAppOutboundSource,
  type WhatsAppSettings,
} from "./lib/clawcloud-whatsapp-workspace-types";

loadEnvConfig(process.cwd());

const STALE_MS = 60_000;
const QR_WAIT_TIMEOUT_MS = 1_500;
const QR_WAIT_POLL_MS = 120;
const QR_CONNECTING_RESET_MS = 2_000;
const WHATSAPP_QR_STALE_AFTER_MS = 75_000;
const WHATSAPP_QR_RENDER_WIDTH = 640;
const WHATSAPP_QR_RENDER_MARGIN = 4;
const WA_VERSION_CACHE_MS = 30 * 60_000;
const DIRECT_REPLY_TIMEOUT_MS = 18_000;
const HTTP_REPLY_TIMEOUT_MS = 22_000;
const STREAM_REPLY_MIN_LENGTH = Math.max(
  20,
  Number.parseInt(process.env.WA_STREAM_REPLY_MIN_LENGTH ?? "24", 10) || 24,
);
const SESSION_WATCHDOG_STALE_MS = 3 * 60_000;
const SESSION_WATCHDOG_INTERVAL_MS = 5 * 60_000;
const MAX_SEND_RETRIES = 3;
const RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const;
const GROUP_RATE_LIMIT_MS = 8_000;
const CONTACT_REFRESH_WAIT_MS = 1_000;
const CONTACT_REFRESH_COLLECTIONS = [
  "regular",
  "regular_high",
  "regular_low",
  "critical_block",
  "critical_unblock_low",
] as const;
const CONTACT_REFRESH_FOLLOWUP_DELAY_MS = 4_000;
const CONTACT_REFRESH_FOLLOWUP_DELAYS_MS = [
  CONTACT_REFRESH_FOLLOWUP_DELAY_MS,
  15_000,
  45_000,
] as const;
const SESSION_WORKSPACE_RESYNC_INITIAL_DELAY_MS = 20_000;
const SESSION_WORKSPACE_RESYNC_INTERVAL_MS = 10 * 60_000;
const SESSION_HISTORY_PERSIST_DEBOUNCE_MS = 1_500;
const SESSION_HISTORY_CONTACT_BACKFILL_DEBOUNCE_MS = 2_000;
const SESSION_RECOVERY_CHECKPOINT_FILE = ".clawcloud-runtime.json";
const SESSION_SYNC_CHECKPOINT_FILE = ".clawcloud-sync-runtime.json";

async function renderWhatsAppQrDataUrl(value: string) {
  return QRCode.toDataURL(value, {
    width: WHATSAPP_QR_RENDER_WIDTH,
    margin: WHATSAPP_QR_RENDER_MARGIN,
    color: {
      dark: "#000000",
      light: "#FFFFFFFF",
    },
    rendererOpts: {
      quality: 1,
    },
  });
}
const SESSION_SYNC_CHECKPOINT_PERSIST_DEBOUNCE_MS = 900;
const SESSION_HISTORY_EXPANSION_FOLLOWUP_DELAY_MS = 3_000;
const SESSION_RECONNECT_BASE_DELAY_MS = 3_000;
const SESSION_RECONNECT_MAX_DELAY_MS = 60_000;
const SESSION_STORAGE_HEALTH_CACHE_MS = 15_000;
const PASSIVE_EXTERNAL_WHATSAPP_REASON =
  "Explicit user command is required before ClawCloud can read, reply, or act in other WhatsApp chats.";

function readPositiveIntEnv(name: string) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

const WHATSAPP_SYNC_POLICY = buildClawCloudWhatsAppSyncPolicy({
  contactRefreshTarget: readPositiveIntEnv("WA_CONTACT_REFRESH_TARGET"),
  contactRefreshMaxPasses: readPositiveIntEnv("WA_CONTACT_REFRESH_MAX_PASSES"),
  historyTarget: readPositiveIntEnv("WA_HISTORY_SYNC_TARGET"),
  historyBufferLimit: readPositiveIntEnv("WA_HISTORY_BUFFER_LIMIT"),
  historyKnownLookupLimit: readPositiveIntEnv("WA_HISTORY_KNOWN_LOOKUP_LIMIT"),
  historyPersistBatchLimit: readPositiveIntEnv("WA_HISTORY_PERSIST_BATCH_LIMIT"),
  historyExpansionChatLimit: readPositiveIntEnv("WA_HISTORY_EXPANSION_CHAT_LIMIT"),
  historyExpansionBatchSize: readPositiveIntEnv("WA_HISTORY_EXPANSION_BATCH_SIZE"),
  historyExpansionMaxAttemptsPerCursor: readPositiveIntEnv("WA_HISTORY_EXPANSION_MAX_ATTEMPTS"),
  historyContactBackfillScanLimit: readPositiveIntEnv("WA_HISTORY_CONTACT_BACKFILL_SCAN_LIMIT"),
});

const CONTACT_REFRESH_MAX_PASSES = WHATSAPP_SYNC_POLICY.contactRefreshMaxPasses;
const CONTACT_REFRESH_TARGET_COUNT = WHATSAPP_SYNC_POLICY.contactRefreshTarget;
const SESSION_HISTORY_SYNC_TARGET = WHATSAPP_SYNC_POLICY.historyTarget;
const SESSION_HISTORY_BUFFER_LIMIT = WHATSAPP_SYNC_POLICY.historyBufferLimit;
const SESSION_HISTORY_KNOWN_LOOKUP_LIMIT = WHATSAPP_SYNC_POLICY.historyKnownLookupLimit;
const SESSION_HISTORY_PERSIST_BATCH_LIMIT = WHATSAPP_SYNC_POLICY.historyPersistBatchLimit;
const SESSION_HISTORY_EXPANSION_CHAT_LIMIT = WHATSAPP_SYNC_POLICY.historyExpansionChatLimit;
const SESSION_HISTORY_EXPANSION_BATCH_SIZE = WHATSAPP_SYNC_POLICY.historyExpansionBatchSize;
const SESSION_HISTORY_EXPANSION_MAX_ATTEMPTS_PER_CURSOR =
  WHATSAPP_SYNC_POLICY.historyExpansionMaxAttemptsPerCursor;
const SESSION_HISTORY_DEEP_CHAT_TARGET = Math.max(
  24,
  Math.min(SESSION_HISTORY_SYNC_TARGET, SESSION_HISTORY_EXPANSION_BATCH_SIZE * 2),
);

type SessionRecord = {
  sock: WASocket;
  status: "connecting" | "waiting" | "connected";
  qr: string | null;
  qrIssuedAt: number | null;
  phone: string | null;
  lastChatJid: string | null;
  ownerIdentityKeys: Set<string>;
  startedAt: number;
  connectedAt: number | null;
  lastActivityAt: number;
  activeSyncFrames: SessionSyncFrame[];
  syncState: ClawCloudWhatsAppRuntimeSyncState;
  lastSyncStartedAt: number | null;
  lastSyncFinishedAt: number | null;
  lastSuccessfulSyncAt: number | null;
  lastSyncReason: string | null;
  lastSyncError: string | null;
  lastSyncDurationMs: number | null;
  lastContactPersistedCount: number;
  lastHistoryPersistedCount: number;
  lastHistoryBackfillCount: number;
  lastHistoryExpansionRequestedCount: number;
  checkpointContactCount: number;
  checkpointHistoryMessageCount: number;
  checkpointHistoryCursors: SessionHistoryResumeCursor[];
  reconnectAttempts: number;
  lastDisconnectCode: number | null;
  lastDisconnectAt: number | null;
  nextReconnectAt: number | null;
  sharedPhoneJids: Map<string, string>;
  contacts: Map<string, SessionContactEntry>;
  historyRows: Map<string, SessionHistoryEntry>;
};

type SessionContactEntry = {
  jid: string;
  phone: string | null;
  displayName: string;
  aliases: string[];
  sourceKinds: string[];
  messageCount: number;
  lastMessageAt: number | null;
  updatedAt: number;
};

type SessionContactMatch = {
  name: string;
  phone: string | null;
  jid: string | null;
  score: number;
};

type SessionContactResolveResult =
  | { type: "found"; contact: SessionContactMatch }
  | { type: "ambiguous"; matches: SessionContactMatch[] };

type SessionHistoryEntry = {
  wa_message_id: string;
  user_id: string;
  direction: "inbound" | "outbound";
  content: string;
  message_type: string;
  remote_jid: string | null;
  remote_phone: string | null;
  contact_name: string | null;
  chat_type: "direct" | "group" | "self" | "broadcast" | "unknown";
  sent_at: string;
};

type DurableWhatsAppContactRow = {
  jid?: string | null;
  phone_number?: string | null;
  contact_name?: string | null;
  notify_name?: string | null;
  verified_name?: string | null;
};

type SessionHistoryCursor = {
  remoteJid: string;
  oldestMessageId: string;
  oldestTimestampMs: number;
  fromMe: boolean;
  messageCount: number;
};

type SessionHistoryResumeCursor = SessionHistoryCursor & {
  attempts: number;
};

type SessionSyncFrame = {
  id: string;
  kind: ClawCloudWhatsAppRuntimeSyncState;
  reason: string;
  startedAt: number;
};

type RouteInboundAgentMessageFn = (userId: string, message: string) => Promise<string | null>;
type SessionScopedTask = {
  record: SessionRecord;
  promise: Promise<void>;
};

const sessions = new Map<string, SessionRecord>();
const outboundIds = new Set<string>();
const inboundIds = new Map<string, number>();
const groupLastReplyAt = new Map<string, number>();
const contactRefreshTasks = new Map<string, SessionScopedTask>();
const workspaceBootstrapTasks = new Map<string, SessionScopedTask>();
const sessionContactPersistTimers = new Map<string, NodeJS.Timeout>();
const sessionHistoryPersistTimers = new Map<string, NodeJS.Timeout>();
const sessionHistoryContactBackfillTimers = new Map<string, NodeJS.Timeout>();
const sessionSyncCheckpointTimers = new Map<string, NodeJS.Timeout>();
const sessionWorkspaceResyncTimers = new Map<string, NodeJS.Timeout>();
const sessionHistoryExpansionFollowupTimers = new Map<string, NodeJS.Timeout>();
const sessionHistoryExpansionTasks = new Map<string, SessionScopedTask>();
const sessionHistoryExpansionState = new Map<string, Map<string, {
  oldestMessageId: string;
  attempts: number;
}>>();
const sessionReconnectTimers = new Map<string, NodeJS.Timeout>();
let cachedRouteInboundAgentMessage: RouteInboundAgentMessageFn | null = null;
let cachedWAVersion:
  | {
    version: [number, number, number];
    fetchedAt: number;
    isLatest: boolean;
  }
  | null = null;
let cachedSessionStorageHealth:
  | {
    value: ClawCloudWhatsAppSessionStorageHealth;
    checkedAtMs: number;
  }
  | null = null;

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

function isActiveSessionRecord(userId: string, record: SessionRecord) {
  return sessions.get(userId) === record;
}

function touchSessionActivity(record: SessionRecord, at = Date.now()) {
  record.lastActivityAt = at;
}

function getSessionRuntimeContactCount(record: SessionRecord) {
  return Math.max(record.contacts.size, record.checkpointContactCount);
}

function getSessionRuntimeHistoryMessageCount(record: SessionRecord) {
  return Math.max(record.historyRows.size, record.checkpointHistoryMessageCount);
}

function beginSessionSync(
  userId: string,
  record: SessionRecord,
  kind: ClawCloudWhatsAppRuntimeSyncState,
  reason: string,
): SessionSyncFrame {
  const frame: SessionSyncFrame = {
    id: `${kind}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    kind,
    reason,
    startedAt: Date.now(),
  };

  record.activeSyncFrames.push(frame);
  record.syncState = frame.kind;
  record.lastSyncStartedAt = frame.startedAt;
  record.lastSyncReason = reason;
  touchSessionActivity(record, frame.startedAt);
  scheduleSessionSyncCheckpointPersist(userId, record, `${reason}.start`, 0);
  return frame;
}

function completeSessionSync(
  userId: string,
  record: SessionRecord,
  frame: SessionSyncFrame,
  details?: {
    error?: unknown;
    contactPersistedCount?: number;
    historyPersistedCount?: number;
    historyBackfillCount?: number;
    historyExpansionRequestedCount?: number;
  },
) {
  const finishedAt = Date.now();
  record.activeSyncFrames = record.activeSyncFrames.filter((item) => item.id !== frame.id);
  record.syncState = record.activeSyncFrames[record.activeSyncFrames.length - 1]?.kind ?? "idle";
  record.lastSyncFinishedAt = finishedAt;
  record.lastSyncDurationMs = Math.max(0, finishedAt - frame.startedAt);
  record.lastSyncReason = frame.reason;
  touchSessionActivity(record, finishedAt);

  if (typeof details?.contactPersistedCount === "number") {
    record.lastContactPersistedCount = Math.max(0, Math.trunc(details.contactPersistedCount));
    record.checkpointContactCount = Math.max(record.checkpointContactCount, record.lastContactPersistedCount);
  }
  if (typeof details?.historyPersistedCount === "number") {
    record.lastHistoryPersistedCount = Math.max(0, Math.trunc(details.historyPersistedCount));
    record.checkpointHistoryMessageCount = Math.max(
      record.checkpointHistoryMessageCount,
      record.lastHistoryPersistedCount,
      record.historyRows.size,
    );
  }
  if (typeof details?.historyBackfillCount === "number") {
    record.lastHistoryBackfillCount = Math.max(0, Math.trunc(details.historyBackfillCount));
  }
  if (typeof details?.historyExpansionRequestedCount === "number") {
    record.lastHistoryExpansionRequestedCount = Math.max(0, Math.trunc(details.historyExpansionRequestedCount));
  }

  if (details?.error) {
    record.lastSyncError = details.error instanceof Error
      ? details.error.message
      : String(details.error);
    persistSessionRecoveryCheckpoint(userId, { record });
    persistSessionSyncCheckpoint(userId, record);
    return;
  }

  record.lastSuccessfulSyncAt = finishedAt;
  record.lastSyncError = null;
  persistSessionRecoveryCheckpoint(userId, { record });
  persistSessionSyncCheckpoint(userId, record);
}

function connectionStatusForRuntime(record: SessionRecord | null): ClawCloudWhatsAppRuntimeConnectionStatus {
  if (!record) {
    return "disconnected";
  }

  return record.status;
}

function toIsoOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

function buildSessionRuntimeStatus(userId: string, record: SessionRecord): ClawCloudWhatsAppRuntimeStatus {
  const contactCount = getSessionRuntimeContactCount(record);
  const historyMessageCount = getSessionRuntimeHistoryMessageCount(record);
  const historyCoverage = summarizeClawCloudWhatsAppHistoryCoverage(
    buildSessionHistoryBackfillPlan(userId, record),
  );
  const progress = computeClawCloudWhatsAppSyncProgress({
    contactCount,
    historyMessageCount,
    contactTarget: CONTACT_REFRESH_TARGET_COUNT,
    historyTarget: SESSION_HISTORY_SYNC_TARGET,
  });

  return {
    connectionStatus: connectionStatusForRuntime(record),
    health: deriveClawCloudWhatsAppRuntimeHealth({
      connectionStatus: connectionStatusForRuntime(record),
      syncState: record.syncState,
      activeSyncJobs: record.activeSyncFrames.length,
      lastSyncError: record.lastSyncError,
      lastActivityAtMs: record.lastActivityAt,
      staleAfterMs: SESSION_WATCHDOG_STALE_MS,
      nowMs: Date.now(),
    }),
    syncState: record.syncState,
    activeSyncJobs: record.activeSyncFrames.length,
    connected: record.status === "connected",
    requiresReauth: false,
    phone: record.phone,
    qrReady: Boolean(record.qr),
    qrAgeSeconds: record.qrIssuedAt ? Math.floor((Date.now() - record.qrIssuedAt) / 1000) : null,
    contactCount,
    historyMessageCount,
    progress,
    historyCoverage,
    startedAt: toIsoOrNull(record.startedAt),
    connectedAt: toIsoOrNull(record.connectedAt),
    lastActivityAt: toIsoOrNull(record.lastActivityAt),
    lastSyncStartedAt: toIsoOrNull(record.lastSyncStartedAt),
    lastSyncFinishedAt: toIsoOrNull(record.lastSyncFinishedAt),
    lastSuccessfulSyncAt: toIsoOrNull(record.lastSuccessfulSyncAt),
    lastSyncReason: record.lastSyncReason,
    lastSyncError: record.lastSyncError,
    lastSyncDurationMs: record.lastSyncDurationMs,
    lastContactPersistedCount: record.lastContactPersistedCount,
    lastHistoryPersistedCount: record.lastHistoryPersistedCount,
    lastHistoryBackfillCount: record.lastHistoryBackfillCount,
    lastHistoryExpansionRequestedCount: record.lastHistoryExpansionRequestedCount,
    maintenanceResyncIntervalMs: SESSION_WORKSPACE_RESYNC_INTERVAL_MS,
    staleAfterMs: SESSION_WATCHDOG_STALE_MS,
  };
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
  return resolveClawCloudWhatsAppSessionBaseDir({
    configuredBaseDir: process.env.WA_SESSION_DIR?.trim() ?? null,
    isRailwayRuntime: isRailwayRuntime(),
  });
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

function savedSessionCheckpointCount() {
  return savedSessionUserIds().reduce((total, userId) => (
    fs.existsSync(sessionRecoveryCheckpointPath(userId))
      ? total + 1
      : total
  ), 0);
}

function savedSessionSyncCheckpointCount() {
  return savedSessionUserIds().reduce((total, userId) => (
    fs.existsSync(sessionSyncCheckpointPath(userId))
      ? total + 1
      : total
  ), 0);
}

function readSessionStorageHealth(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (
    !options.force
    && cachedSessionStorageHealth
    && now - cachedSessionStorageHealth.checkedAtMs < SESSION_STORAGE_HEALTH_CACHE_MS
  ) {
    return cachedSessionStorageHealth.value;
  }

  const resolvedBaseDir = sessionBaseDir();
  let writable = false;
  let probeError: string | null = null;

  try {
    fs.mkdirSync(resolvedBaseDir, { recursive: true });
    const probeFile = path.join(
      resolvedBaseDir,
      `.clawcloud-volume-probe-${process.pid}-${now.toString(36)}.tmp`,
    );
    const probePayload = `probe:${now}`;
    fs.writeFileSync(probeFile, probePayload, "utf8");
    const confirmed = fs.readFileSync(probeFile, "utf8");
    writable = confirmed === probePayload;
    fs.rmSync(probeFile, { force: true });
    if (!writable) {
      probeError = "Session storage probe did not round-trip correctly.";
    }
  } catch (error) {
    writable = false;
    probeError = error instanceof Error ? error.message : String(error);
  }

  const value = buildClawCloudWhatsAppSessionStorageHealth({
    configuredBaseDir: process.env.WA_SESSION_DIR?.trim() ?? null,
    resolvedBaseDir,
    isRailwayRuntime: isRailwayRuntime(),
    writable,
    probeError,
    authDirCount: savedSessionUserIds().length,
    checkpointCount: savedSessionCheckpointCount(),
    syncCheckpointCount: savedSessionSyncCheckpointCount(),
    checkedAt: new Date(now).toISOString(),
  });

  cachedSessionStorageHealth = {
    value,
    checkedAtMs: now,
  };

  return value;
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
  const storageHealth = readSessionStorageHealth({ force: true });

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
    {
      key: "SESSION_STORAGE_STATUS",
      value: storageHealth.status,
    },
    {
      key: "SESSION_STORAGE_WRITABLE",
      value: String(storageHealth.writable),
    },
    {
      key: "SESSION_CHECKPOINT_DIRS",
      value: String(storageHealth.checkpointCount),
    },
    {
      key: "SESSION_SYNC_CHECKPOINT_DIRS",
      value: String(storageHealth.syncCheckpointCount),
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

  if (storageHealth.warnings.length > 0) {
    for (const warning of storageHealth.warnings) {
      console.warn(`[agent] SESSION STORAGE WARNING: ${warning}`);
    }
  }
  if (storageHealth.probeError) {
    console.warn(`[agent] SESSION STORAGE PROBE ERROR: ${storageHealth.probeError}`);
  }

  console.log("[agent] =================================");
}

async function getWAVersion(): Promise<[number, number, number]> {
  const now = Date.now();
  if (cachedWAVersion && now - cachedWAVersion.fetchedAt < WA_VERSION_CACHE_MS) {
    return cachedWAVersion.version;
  }

  try {
    const { version, isLatest } = await fetchLatestBaileysVersion();
    cachedWAVersion = {
      version,
      fetchedAt: now,
      isLatest,
    };
    console.log(`[agent] WA v${version.join(".")} (latest=${isLatest})`);
    return version;
  } catch (error) {
    if (cachedWAVersion) {
      console.warn(
        `[agent] Using cached WA version ${cachedWAVersion.version.join(".")} after refresh failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return cachedWAVersion.version;
    }

    throw error;
  }
}

function sessionDir(userId: string) {
  const base = sessionBaseDir();
  return path.join(base, userId.replace(/[^a-zA-Z0-9_-]/g, "_"));
}

function sessionRecoveryCheckpointPath(userId: string) {
  return path.join(sessionDir(userId), SESSION_RECOVERY_CHECKPOINT_FILE);
}

function sessionSyncCheckpointPath(userId: string) {
  return path.join(sessionDir(userId), SESSION_SYNC_CHECKPOINT_FILE);
}

function readSessionRecoveryCheckpoint(userId: string) {
  const file = sessionRecoveryCheckpointPath(userId);
  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return normalizeClawCloudWhatsAppRecoveryCheckpoint(raw);
  } catch (error) {
    console.warn(
      `[agent] Could not read WhatsApp recovery checkpoint for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function writeSessionRecoveryCheckpoint(
  userId: string,
  checkpoint: ClawCloudWhatsAppRecoveryCheckpoint,
) {
  try {
    fs.mkdirSync(sessionDir(userId), { recursive: true });
    fs.writeFileSync(
      sessionRecoveryCheckpointPath(userId),
      JSON.stringify(checkpoint, null, 2),
      "utf8",
    );
  } catch (error) {
    console.warn(
      `[agent] Could not persist WhatsApp recovery checkpoint for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

function readSessionSyncCheckpoint(userId: string) {
  const file = sessionSyncCheckpointPath(userId);
  if (!fs.existsSync(file)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    return normalizeClawCloudWhatsAppSyncCheckpoint(raw);
  } catch (error) {
    console.warn(
      `[agent] Could not read WhatsApp sync checkpoint for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function writeSessionSyncCheckpoint(
  userId: string,
  checkpoint: ClawCloudWhatsAppSyncCheckpoint,
) {
  try {
    fs.mkdirSync(sessionDir(userId), { recursive: true });
    fs.writeFileSync(
      sessionSyncCheckpointPath(userId),
      JSON.stringify(checkpoint, null, 2),
      "utf8",
    );
  } catch (error) {
    console.warn(
      `[agent] Could not persist WhatsApp sync checkpoint for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

function clearSessionReconnectTimer(userId: string) {
  const timer = sessionReconnectTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    sessionReconnectTimers.delete(userId);
  }
}

function buildSessionRecoveryCheckpoint(
  userId: string,
  input: {
    record?: SessionRecord | null;
    connectionStatus?: ClawCloudWhatsAppRuntimeConnectionStatus;
    connected?: boolean;
    requiresReauth?: boolean;
    lastSyncError?: string | null;
    reconnectAttempts?: number;
    lastDisconnectCode?: number | null;
    lastDisconnectAt?: number | null;
    nextReconnectAt?: number | null;
    updatedAt?: number;
  } = {},
): ClawCloudWhatsAppRecoveryCheckpoint {
  const record = input.record ?? null;
  const updatedAt = input.updatedAt ?? Date.now();

  return {
    version: 1,
    connectionStatus: input.connectionStatus ?? connectionStatusForRuntime(record),
    phone: record?.phone ?? null,
    connected: input.connected ?? record?.status === "connected",
    requiresReauth: Boolean(input.requiresReauth),
    reconnectAttempts: Math.max(
      0,
      Math.trunc(input.reconnectAttempts ?? record?.reconnectAttempts ?? 0),
    ),
    lastDisconnectCode:
      typeof input.lastDisconnectCode === "number"
        ? Math.trunc(input.lastDisconnectCode)
        : record?.lastDisconnectCode ?? null,
    lastDisconnectAt: toIsoOrNull(input.lastDisconnectAt ?? record?.lastDisconnectAt),
    nextReconnectAt: toIsoOrNull(input.nextReconnectAt ?? record?.nextReconnectAt),
    connectedAt: toIsoOrNull(record?.connectedAt),
    lastActivityAt: toIsoOrNull(record?.lastActivityAt),
    lastSuccessfulSyncAt: toIsoOrNull(record?.lastSuccessfulSyncAt),
    lastSyncFinishedAt: toIsoOrNull(record?.lastSyncFinishedAt),
    lastSyncReason: record?.lastSyncReason ?? null,
    lastSyncError: input.lastSyncError ?? record?.lastSyncError ?? null,
    lastSyncDurationMs: record?.lastSyncDurationMs ?? null,
    lastContactPersistedCount: Math.max(0, Math.trunc(record?.lastContactPersistedCount ?? 0)),
    lastHistoryPersistedCount: Math.max(0, Math.trunc(record?.lastHistoryPersistedCount ?? 0)),
    lastHistoryBackfillCount: Math.max(0, Math.trunc(record?.lastHistoryBackfillCount ?? 0)),
    lastHistoryExpansionRequestedCount: Math.max(
      0,
      Math.trunc(record?.lastHistoryExpansionRequestedCount ?? 0),
    ),
    updatedAt: toIsoOrNull(updatedAt),
  };
}

function persistSessionRecoveryCheckpoint(
  userId: string,
  input: Parameters<typeof buildSessionRecoveryCheckpoint>[1] = {},
) {
  writeSessionRecoveryCheckpoint(userId, buildSessionRecoveryCheckpoint(userId, input));
}

function restoreSessionHistoryResumeCursors(
  checkpoint: ClawCloudWhatsAppSyncCheckpoint | null | undefined,
) {
  const source = checkpoint?.historyCursors?.length
    ? checkpoint.historyCursors.map((cursor) => ({
      remoteJid: cursor.remoteJid,
      oldestMessageId: cursor.oldestMessageId,
      oldestTimestampAt: cursor.oldestTimestampAt,
      fromMe: cursor.fromMe,
      messageCount: cursor.messageCount,
      attempts: cursor.attempts,
    }))
    : (checkpoint?.chatStates ?? [])
      .filter((chat) =>
        typeof chat.remoteJid === "string"
        && Boolean(chat.oldestTimestampAt)
        && typeof chat.oldestMessageId === "string"
        && chat.oldestMessageId.trim().length > 0
      )
      .map((chat) => ({
        remoteJid: chat.remoteJid,
        oldestMessageId: chat.oldestMessageId,
        oldestTimestampAt: chat.oldestTimestampAt,
        fromMe: chat.fromMe,
        messageCount: chat.messageCount,
        attempts: chat.attempts,
      }));

  return source
    .map((cursor): SessionHistoryResumeCursor | null => {
      const oldestTimestampMs = cursor.oldestTimestampAt ? Date.parse(cursor.oldestTimestampAt) : NaN;
      if (!Number.isFinite(oldestTimestampMs)) {
        return null;
      }

      return {
        remoteJid: cursor.remoteJid,
        oldestMessageId: cursor.oldestMessageId,
        oldestTimestampMs,
        fromMe: cursor.fromMe,
        messageCount: Math.max(1, Math.trunc(cursor.messageCount || 1)),
        attempts: Math.max(0, Math.trunc(cursor.attempts || 0)),
      };
    })
    .filter(Boolean) as SessionHistoryResumeCursor[];
}

function buildSessionHistoryResumeCursors(userId: string, record: SessionRecord) {
  const requestState = sessionHistoryExpansionState.get(userId) ?? new Map();
  const merged = new Map<string, SessionHistoryResumeCursor>();

  for (const cursor of record.checkpointHistoryCursors) {
    merged.set(cursor.remoteJid, { ...cursor });
  }

  for (const cursor of buildSessionHistoryCursors(record)) {
    const attemptsState = requestState.get(cursor.remoteJid);
    const next: SessionHistoryResumeCursor = {
      ...cursor,
      attempts:
        attemptsState?.oldestMessageId === cursor.oldestMessageId
          ? attemptsState.attempts
          : 0,
    };
    const existing = merged.get(cursor.remoteJid);

    if (!existing) {
      merged.set(cursor.remoteJid, next);
      continue;
    }

    const nextIsOlder = next.oldestTimestampMs < existing.oldestTimestampMs;
    const sameCursor = next.oldestMessageId === existing.oldestMessageId;
    if (nextIsOlder) {
      merged.set(cursor.remoteJid, next);
      continue;
    }

    if (sameCursor) {
      merged.set(cursor.remoteJid, {
        ...existing,
        fromMe: next.fromMe,
        messageCount: Math.max(existing.messageCount, next.messageCount),
        attempts: Math.max(existing.attempts, next.attempts),
      });
      continue;
    }

    merged.set(cursor.remoteJid, {
      ...existing,
      messageCount: Math.max(existing.messageCount, next.messageCount),
    });
  }

  return [...merged.values()].sort((left, right) => {
    if (left.messageCount !== right.messageCount) {
      return left.messageCount - right.messageCount;
    }
    return right.oldestTimestampMs - left.oldestTimestampMs;
  });
}

function buildSessionHistoryBackfillPlan(userId: string, record: SessionRecord) {
  const latestByRemoteJid = new Map<string, SessionHistoryEntry>();

  for (const row of record.historyRows.values()) {
    const remoteJid = toReplyableJid(row.remote_jid ?? null);
    if (!remoteJid) {
      continue;
    }

    const existing = latestByRemoteJid.get(remoteJid);
    if (!existing || existing.sent_at.localeCompare(row.sent_at) < 0) {
      latestByRemoteJid.set(remoteJid, row);
    }
  }

  const chats = buildSessionHistoryResumeCursors(userId, record).map((cursor) => {
    const latest = latestByRemoteJid.get(cursor.remoteJid);
    const resolvedPhone = resolveSessionContactPhone(record, cursor.remoteJid, latest?.remote_phone ?? null);
    const contactEntry =
      (resolvedPhone ? record.contacts.get(resolvedPhone) : null)
      ?? record.contacts.get(cursor.remoteJid)
      ?? null;
    return {
      remoteJid: cursor.remoteJid,
      oldestMessageId: cursor.oldestMessageId,
      chatType: latest?.chat_type === "self"
        ? "self"
        : latest?.chat_type === "group"
          ? "group"
          : latest?.chat_type === "direct"
            ? "direct"
            : getChatType(cursor.remoteJid, record) === "self"
              ? "self"
              : getChatType(cursor.remoteJid, record) === "group"
                ? "group"
                : getChatType(cursor.remoteJid, record) === "direct"
                  ? "direct"
                  : "unknown",
      messageCount: cursor.messageCount,
      oldestTimestampMs: cursor.oldestTimestampMs,
      latestTimestampMs: latest ? Date.parse(latest.sent_at) : null,
      fromMe: cursor.fromMe,
      attempts: cursor.attempts,
      hasDisplayName: Boolean(contactEntry?.displayName || latest?.contact_name),
    };
  });

  return buildClawCloudWhatsAppHistoryBackfillPlan(chats, {
    deepMessageTarget: SESSION_HISTORY_DEEP_CHAT_TARGET,
    completionAttemptThreshold: SESSION_HISTORY_EXPANSION_MAX_ATTEMPTS_PER_CURSOR,
  });
}

function buildEligibleSessionHistoryExpansionCandidates(userId: string, record: SessionRecord) {
  const requestState = sessionHistoryExpansionState.get(userId) ?? new Map();
  const cursorsByRemoteJid = new Map(
    buildSessionHistoryResumeCursors(userId, record).map((cursor) => [cursor.remoteJid, cursor] as const),
  );

  return buildSessionHistoryBackfillPlan(userId, record)
    .map((chat) => cursorsByRemoteJid.get(chat.remoteJid) ?? null)
    .filter(Boolean)
    .filter((cursor) => {
      const previous = requestState.get(cursor.remoteJid);
      if (!previous) {
        return true;
      }
      if (previous.oldestMessageId !== cursor.oldestMessageId) {
        return true;
      }
      return previous.attempts < SESSION_HISTORY_EXPANSION_MAX_ATTEMPTS_PER_CURSOR;
    }) as SessionHistoryResumeCursor[];
}

function buildSessionSyncCheckpoint(
  userId: string,
  record: SessionRecord,
  updatedAt = Date.now(),
): ClawCloudWhatsAppSyncCheckpoint {
  const contactCount = getSessionRuntimeContactCount(record);
  const historyMessageCount = getSessionRuntimeHistoryMessageCount(record);
  const chatStates = buildSessionHistoryBackfillPlan(userId, record)
    .slice(0, Math.max(SESSION_HISTORY_EXPANSION_CHAT_LIMIT * 2, 24));
  const historyCursors = buildSessionHistoryResumeCursors(userId, record)
    .slice(0, Math.max(SESSION_HISTORY_EXPANSION_CHAT_LIMIT * 2, 24))
    .map((cursor) => ({
      remoteJid: cursor.remoteJid,
      oldestMessageId: cursor.oldestMessageId,
      oldestTimestampAt: toIsoOrNull(cursor.oldestTimestampMs),
      fromMe: cursor.fromMe,
      messageCount: Math.max(1, Math.trunc(cursor.messageCount)),
      attempts: Math.max(0, Math.trunc(cursor.attempts)),
    }));

  return {
    version: 1,
    syncState: record.syncState,
    contactCount,
    historyMessageCount,
    contactTarget: CONTACT_REFRESH_TARGET_COUNT,
    historyTarget: SESSION_HISTORY_SYNC_TARGET,
    lastContactPersistedCount: Math.max(0, Math.trunc(record.lastContactPersistedCount)),
    lastHistoryPersistedCount: Math.max(0, Math.trunc(record.lastHistoryPersistedCount)),
    lastHistoryBackfillCount: Math.max(0, Math.trunc(record.lastHistoryBackfillCount)),
    lastHistoryExpansionRequestedCount: Math.max(0, Math.trunc(record.lastHistoryExpansionRequestedCount)),
    lastSyncReason: record.lastSyncReason,
    lastSyncStartedAt: toIsoOrNull(record.lastSyncStartedAt),
    lastSyncFinishedAt: toIsoOrNull(record.lastSyncFinishedAt),
    lastSuccessfulSyncAt: toIsoOrNull(record.lastSuccessfulSyncAt),
    resumeRecommended: buildClawCloudWhatsAppSyncCheckpointResumeRecommended({
      syncState: record.syncState,
      contactCount,
      historyMessageCount,
      contactTarget: CONTACT_REFRESH_TARGET_COUNT,
      historyTarget: SESSION_HISTORY_SYNC_TARGET,
    }),
    historyCursors,
    historyCoverage: summarizeClawCloudWhatsAppHistoryCoverage(chatStates),
    chatStates,
    updatedAt: toIsoOrNull(updatedAt),
  };
}

function persistSessionSyncCheckpoint(userId: string, record: SessionRecord) {
  record.checkpointContactCount = Math.max(record.checkpointContactCount, record.contacts.size);
  record.checkpointHistoryMessageCount = Math.max(
    record.checkpointHistoryMessageCount,
    record.historyRows.size,
    record.lastHistoryPersistedCount,
  );
  record.checkpointHistoryCursors = buildSessionHistoryResumeCursors(userId, record);
  writeSessionSyncCheckpoint(userId, buildSessionSyncCheckpoint(userId, record));
}

function scheduleSessionSyncCheckpointPersist(
  userId: string,
  record: SessionRecord,
  _reason: string,
  delayMs = SESSION_SYNC_CHECKPOINT_PERSIST_DEBOUNCE_MS,
) {
  if (!isActiveSessionRecord(userId, record)) {
    return;
  }

  const existing = sessionSyncCheckpointTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    sessionSyncCheckpointTimers.delete(userId);
    if (!isActiveSessionRecord(userId, record)) {
      return;
    }
    persistSessionSyncCheckpoint(userId, record);
  }, Math.max(0, Math.trunc(delayMs)));

  sessionSyncCheckpointTimers.set(userId, timer);
}

function clearSessionHistoryExpansionFollowupTimer(userId: string) {
  const timer = sessionHistoryExpansionFollowupTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    sessionHistoryExpansionFollowupTimers.delete(userId);
  }
}

function scheduleSessionHistoryExpansionFollowup(
  userId: string,
  record: SessionRecord,
  reason: string,
  delayMs = SESSION_HISTORY_EXPANSION_FOLLOWUP_DELAY_MS,
) {
  if (!isActiveSessionRecord(userId, record) || record.status !== "connected") {
    return;
  }

  clearSessionHistoryExpansionFollowupTimer(userId);
  const timer = setTimeout(() => {
    sessionHistoryExpansionFollowupTimers.delete(userId);
    const latest = sessions.get(userId);
    if (latest !== record || latest?.status !== "connected") {
      return;
    }

    void requestSessionHistoryExpansion(userId, latest, reason).catch((error) =>
      console.error(
        `[agent] Scheduled WhatsApp history follow-up failed for ${userId}:`,
        error instanceof Error ? error.message : error,
      ),
    );
  }, Math.max(0, Math.trunc(delayMs)));

  sessionHistoryExpansionFollowupTimers.set(userId, timer);
}

function clearSessionRuntimeResources(
  userId: string,
  record: SessionRecord | undefined,
) {
  clearSessionReconnectTimer(userId);

  const contactTask = contactRefreshTasks.get(userId);
  if (!record || contactTask?.record === record) {
    contactRefreshTasks.delete(userId);
  }

  const workspaceTask = workspaceBootstrapTasks.get(userId);
  if (!record || workspaceTask?.record === record) {
    workspaceBootstrapTasks.delete(userId);
  }

  const persistTimer = sessionContactPersistTimers.get(userId);
  if (persistTimer) {
    clearTimeout(persistTimer);
    sessionContactPersistTimers.delete(userId);
  }

  const historyPersistTimer = sessionHistoryPersistTimers.get(userId);
  if (historyPersistTimer) {
    clearTimeout(historyPersistTimer);
    sessionHistoryPersistTimers.delete(userId);
  }

  const historyBackfillTimer = sessionHistoryContactBackfillTimers.get(userId);
  if (historyBackfillTimer) {
    clearTimeout(historyBackfillTimer);
    sessionHistoryContactBackfillTimers.delete(userId);
  }
  clearSessionHistoryExpansionFollowupTimer(userId);

  const syncCheckpointTimer = sessionSyncCheckpointTimers.get(userId);
  if (syncCheckpointTimer) {
    clearTimeout(syncCheckpointTimer);
    sessionSyncCheckpointTimers.delete(userId);
  }

  const resyncTimer = sessionWorkspaceResyncTimers.get(userId);
  if (resyncTimer) {
    clearTimeout(resyncTimer);
    sessionWorkspaceResyncTimers.delete(userId);
  }

  const historyExpansionTask = sessionHistoryExpansionTasks.get(userId);
  if (!record || historyExpansionTask?.record === record) {
    sessionHistoryExpansionTasks.delete(userId);
  }
  sessionHistoryExpansionState.delete(userId);
}

function scheduleSessionReconnect(
  userId: string,
  record: SessionRecord,
  reason: string,
) {
  const reconnectAttempts = Math.max(1, record.reconnectAttempts + 1);
  const delayMs = computeClawCloudWhatsAppReconnectDelayMs(reconnectAttempts, {
    baseMs: SESSION_RECONNECT_BASE_DELAY_MS,
    maxMs: SESSION_RECONNECT_MAX_DELAY_MS,
  });
  const now = Date.now();

  record.reconnectAttempts = reconnectAttempts;
  record.lastDisconnectAt = now;
  record.nextReconnectAt = now + delayMs;

  persistSessionRecoveryCheckpoint(userId, {
    record,
    connectionStatus: "disconnected",
    connected: false,
    reconnectAttempts,
    lastDisconnectAt: record.lastDisconnectAt,
    nextReconnectAt: record.nextReconnectAt,
    lastSyncError: record.lastSyncError ?? `WhatsApp connection closed. Retrying via ${reason}.`,
    updatedAt: now,
  });
  persistSessionSyncCheckpoint(userId, record);

  clearSessionReconnectTimer(userId);
  const timer = setTimeout(() => {
    sessionReconnectTimers.delete(userId);
    void connectSession(userId).catch((error) =>
      console.error(
        `[agent] Scheduled reconnect failed for ${userId}:`,
        error instanceof Error ? error.message : error,
      ),
    );
  }, delayMs);
  sessionReconnectTimers.set(userId, timer);

  console.warn(
    `[agent] Scheduling WhatsApp reconnect for ${userId} in ${delayMs}ms after ${reason} (attempt ${reconnectAttempts})`,
  );
}

async function discardSession(
  userId: string,
  record: SessionRecord | undefined,
  options: { deleteAuth?: boolean; logout?: boolean } = {},
) {
  if (record) {
    persistSessionSyncCheckpoint(userId, record);
  }
  clearSessionRuntimeResources(userId, record);

  if (record) {
    const shouldLogout = options.logout ?? Boolean(options.deleteAuth);
    if (shouldLogout) {
      try {
        await record.sock.logout();
      } catch {
        // Ignore logout failures during cleanup.
      }
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

/**
 * GLOBAL SAFETY GUARD — strip internal routing metadata that must NEVER appear
 * in a WhatsApp message sent to any contact.  Applied at the last mile before
 * every `sock.sendMessage` call so that even if upstream code fails to strip
 * the prefix it can never leak to a real conversation.
 */
function sanitizeOutboundWhatsAppMessage(raw: string): string {
  let text = raw;

  // Strip [WhatsApp workspace context] block
  if (text.startsWith("[WhatsApp workspace context]")) {
    const sep = text.indexOf("\n\n");
    text = sep === -1 ? "" : text.slice(sep + 2);
  }

  // Also catch mangled single-line variants (e.g. collapsed newlines)
  text = text.replace(
    /^\[WhatsApp workspace context\][^\n]*(?:\n- [^\n]*)*\n{0,2}/i,
    "",
  );

  // Strip [Group message …] wrappers
  text = text.replace(/^\[Group message[^\]]*\]\s*/i, "");

  // ABSOLUTE SAFETY: internal signals must NEVER reach a WhatsApp chat
  const cleaned = text.replace(/\n{3,}/g, "\n\n").trim();
  if (/^__[A-Z_]+__$/.test(cleaned) || cleaned.includes("__LOW_CONFIDENCE_RECOVERY_SIGNAL__")) {
    return "";
  }

  return cleaned;
}

async function sendStreamingMessage(sock: WASocket, jid: string, fullText: string) {
  const trimmed = sanitizeOutboundWhatsAppMessage(fullText);
  const messageIds: string[] = [];

  // Show "typing..." indicator before sending — natural thinking pause
  await sock.sendPresenceUpdate("composing", jid).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, whatsAppInitialTypingDelayMs(trimmed)));

  // Always send as a SINGLE message box — no splitting into multiple bubbles
  const sent = await sock.sendMessage(jid, { text: trimmed });
  if (sent?.key?.id) {
    outboundIds.add(sent.key.id);
    messageIds.push(sent.key.id);
  }

  await sock.sendPresenceUpdate("paused", jid).catch(() => null);
  return messageIds;
}

type TrackedWhatsAppSendInput = {
  userId: string | null;
  source?: WhatsAppOutboundSource | null;
  approvalId?: string | null;
  workflowRunId?: string | null;
  idempotencyKey?: string | null;
  jid: string;
  phone?: string | null;
  contactName?: string | null;
  message: string;
  metadata?: Record<string, unknown> | null;
};

function normalizeTrackedWhatsAppMetadata(value: unknown) {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function buildAssistantReplyIdempotencyKey(userId: string, jid: string) {
  return [
    "assistant-reply",
    userId,
    jid,
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join("-");
}

function buildTrackedWhatsAppMessageExcerpt(message: string) {
  return message.replace(/\n{3,}/g, "\n\n").trim().slice(0, 200);
}

function mapBaileysStatusToAckStatus(status: number | null | undefined): WhatsAppMessageAckStatus | null {
  if (status === WAMessageStatus.READ) {
    return "read";
  }
  if (status === WAMessageStatus.DELIVERY_ACK) {
    return "delivery_ack";
  }
  if (status === WAMessageStatus.SERVER_ACK) {
    return "server_ack";
  }
  if (status === WAMessageStatus.PENDING) {
    return "pending";
  }
  if (status === WAMessageStatus.ERROR) {
    return "error";
  }

  return null;
}

function mapReceiptUpdateToAckStatus(receipt: {
  readTimestamp?: number | string | null;
  receiptTimestamp?: number | string | null;
  deliveredDeviceJid?: string[] | null;
  pendingDeviceJid?: string[] | null;
} | null | undefined): WhatsAppMessageAckStatus | null {
  if (!receipt) {
    return null;
  }

  if (receipt.readTimestamp != null) {
    return "read";
  }
  if (receipt.receiptTimestamp != null || (receipt.deliveredDeviceJid?.length ?? 0) > 0) {
    return "delivery_ack";
  }
  if ((receipt.pendingDeviceJid?.length ?? 0) > 0) {
    return "pending";
  }

  return null;
}

function mapOutboundStatusToAckStatus(status: WhatsAppOutboundStatus | null | undefined): WhatsAppMessageAckStatus | null {
  if (status === "read") return "read";
  if (status === "delivered") return "delivery_ack";
  if (status === "sent") return "server_ack";
  if (status === "failed") return "error";
  if (
    status === "queued"
    || status === "approved"
    || status === "retrying"
    || status === "approval_required"
    || status === "drafted"
  ) {
    return "pending";
  }
  return null;
}

const WHATSAPP_UNCONFIRMED_RESEND_AFTER_MS = (() => {
  const configured = Number.parseInt(process.env.WA_OUTBOUND_PENDING_RETRY_MS ?? "", 10);
  return Number.isFinite(configured) ? Math.max(10_000, configured) : 30_000;
})();

function buildOutboundAckSummary(status: WhatsAppOutboundStatus | null | undefined) {
  const ackStatus = mapOutboundStatusToAckStatus(status);
  return {
    ackStatus,
    sentAccepted: ackStatus === "server_ack" || ackStatus === "delivery_ack" || ackStatus === "read",
    deliveryConfirmed: ackStatus === "delivery_ack" || ackStatus === "read",
    failed: ackStatus === "error",
  };
}

async function waitForTrackedOutboundStatus(input: {
  userId: string;
  idempotencyKey: string | null;
  timeoutMs: number;
}) {
  const timeoutMs = Math.max(0, Math.min(15_000, Math.trunc(input.timeoutMs)));
  if (!input.idempotencyKey || timeoutMs <= 0) {
    return null;
  }

  const deadline = Date.now() + timeoutMs;
  let lastStatus: WhatsAppOutboundStatus | null = null;

  while (Date.now() <= deadline) {
    const outbound = await getWhatsAppOutboundMessage({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
    }).catch(() => null);

    if (outbound?.status) {
      lastStatus = outbound.status;
      const summary = buildOutboundAckSummary(outbound.status);
      if (summary.deliveryConfirmed || summary.failed) {
        return summary;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return lastStatus ? buildOutboundAckSummary(lastStatus) : null;
}

async function reconcileTrackedOutboundBeforeSend(input: {
  tracking: TrackedWhatsAppSendInput | null;
  trackedOutbound: Awaited<ReturnType<typeof prepareTrackedWhatsAppOutbound>>;
  waitForAckMs: number;
  retryRequestedVia: string;
}) {
  const trackedOutbound = input.trackedOutbound;
  if (!trackedOutbound) {
    return {
      trackedOutbound: null,
      summary: null,
      retriedUndelivered: false,
    };
  }

  if (trackedOutbound.status === "sent") {
    if (shouldRetryUndeliveredWhatsAppOutbound(trackedOutbound, {
      minPendingMs: WHATSAPP_UNCONFIRMED_RESEND_AFTER_MS,
    })) {
      const retried = input.tracking?.userId
        ? await transitionWhatsAppOutboundMessage({
          userId: input.tracking.userId,
          outboundMessageId: trackedOutbound.id,
          nextStatus: "retrying",
          metadata: {
            retry_reason: "delivery_unconfirmed",
            retry_requested_at: new Date().toISOString(),
            retry_requested_via: input.retryRequestedVia,
          },
        }).catch(() => trackedOutbound)
        : trackedOutbound;

      return {
        trackedOutbound: retried ?? trackedOutbound,
        summary: null,
        retriedUndelivered: true,
      };
    }

    const summary = buildOutboundAckSummary(trackedOutbound.status);
    const waited = (input.waitForAckMs > 0 && input.tracking?.userId)
      ? await waitForTrackedOutboundStatus({
        userId: input.tracking.userId,
        idempotencyKey: trackedOutbound.idempotency_key,
        timeoutMs: input.waitForAckMs,
      })
      : null;

    return {
      trackedOutbound,
      summary: waited ?? summary,
      retriedUndelivered: false,
    };
  }

  if (trackedOutbound.status === "delivered" || trackedOutbound.status === "read") {
    const summary = buildOutboundAckSummary(trackedOutbound.status);
    return {
      trackedOutbound,
      summary,
      retriedUndelivered: false,
    };
  }

  return {
    trackedOutbound,
    summary: null,
    retriedUndelivered: false,
  };
}

async function resolveRegisteredWhatsAppTargetJid(sock: WASocket, targetJid: string) {
  if (!isDirectChatJid(targetJid)) {
    return {
      exists: true as const,
      jid: targetJid,
      warning: null as string | null,
      reason: null as "not_registered" | "verification_unavailable" | null,
    };
  }

  try {
    const result = await (sock as unknown as { onWhatsApp?: (...jids: string[]) => Promise<Array<{ jid?: string; exists?: boolean }>> }).onWhatsApp?.(targetJid);
    const first = Array.isArray(result) ? result[0] : null;
    if (!first) {
      return {
        exists: false as const,
        jid: targetJid,
        warning: null as string | null,
        reason: "verification_unavailable" as const,
      };
    }

    if (first.exists === false) {
      return {
        exists: false as const,
        jid: targetJid,
        warning: null as string | null,
        reason: "not_registered" as const,
      };
    }

    return {
      exists: true as const,
      jid: toReplyableJid(first.jid ?? targetJid) ?? targetJid,
      warning: null as string | null,
      reason: null as "not_registered" | "verification_unavailable" | null,
    };
  } catch {
    return {
      exists: false as const,
      jid: targetJid,
      warning: null as string | null,
      reason: "verification_unavailable" as const,
    };
  }
}

async function prepareTrackedWhatsAppOutbound(input: TrackedWhatsAppSendInput) {
  if (!input.userId) {
    return null;
  }

  let outbound = await ensureWhatsAppOutboundMessage({
    userId: input.userId,
    source: input.source ?? "api_send",
    approvalId: input.approvalId,
    workflowRunId: input.workflowRunId,
    remoteJid: input.jid,
    remotePhone: input.phone ?? phoneFromJid(input.jid),
    contactName: sanitizeContactName(input.contactName),
    messageText: input.message,
    status: input.approvalId ? "approved" : "queued",
    idempotencyKey: input.idempotencyKey,
    metadata: normalizeTrackedWhatsAppMetadata(input.metadata),
  }).catch(() => null);

  if (!outbound) {
    return null;
  }

  if (outbound.status === "approval_required") {
    outbound = await transitionWhatsAppOutboundMessage({
      userId: input.userId,
      outboundMessageId: outbound.id,
      nextStatus: "approved",
      metadata: normalizeTrackedWhatsAppMetadata(input.metadata),
    }).catch(() => outbound);
  } else if (outbound.status === "failed") {
    outbound = await transitionWhatsAppOutboundMessage({
      userId: input.userId,
      outboundMessageId: outbound.id,
      nextStatus: "retrying",
      metadata: normalizeTrackedWhatsAppMetadata(input.metadata),
    }).catch(() => outbound);
  }

  return outbound;
}

async function recordTrackedWhatsAppSendSuccess(
  tracking: TrackedWhatsAppSendInput,
  waMessageIds: string[],
  attemptCount: number,
) {
  if (!tracking.userId) {
    return;
  }

  await transitionWhatsAppOutboundMessage({
    userId: tracking.userId,
    idempotencyKey: tracking.idempotencyKey ?? null,
    nextStatus: "sent",
    attemptCount,
    waMessageIds,
    metadata: normalizeTrackedWhatsAppMetadata(tracking.metadata),
  }).catch(() => null);
}

async function recordTrackedWhatsAppSendFailure(
  tracking: TrackedWhatsAppSendInput,
  attemptCount: number,
  errorMessage: string,
  finalFailure: boolean,
) {
  if (!tracking.userId) {
    return;
  }

  await transitionWhatsAppOutboundMessage({
    userId: tracking.userId,
    idempotencyKey: tracking.idempotencyKey ?? null,
    nextStatus: finalFailure ? "failed" : "retrying",
    attemptCount,
    errorMessage,
    metadata: normalizeTrackedWhatsAppMetadata(tracking.metadata),
  }).catch(() => null);
}

async function logOutbound(
  userId: string,
  content: string,
  targetJid?: string | null,
  contactName?: string | null,
  waMessageIds?: string[] | null,
) {
  const session = sessions.get(userId);
  const sentAt = new Date().toISOString();
  const primaryWaMessageId = waMessageIds?.find((value) => value.trim()) ?? null;
  const fullRow = {
    user_id: userId,
    direction: "outbound",
    content,
    message_type: "text",
    wa_message_id: primaryWaMessageId,
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
        wa_message_id: primaryWaMessageId,
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

function deriveSessionCountryCode(record: SessionRecord | null | undefined) {
  const selfDigits = normalizePhone(record?.phone);
  if (!selfDigits || selfDigits.length <= 10) {
    return null;
  }

  const countryCode = selfDigits.slice(0, selfDigits.length - 10);
  return countryCode || null;
}

function resolvePhoneFromSessionContacts(
  record: SessionRecord | null | undefined,
  rawPhone: string | null | undefined,
) {
  const digits = normalizePhone(rawPhone);
  if (!record || !digits) {
    return null;
  }

  let suffixMatch: string | null = null;
  for (const contact of record.contacts.values()) {
    const contactPhone = normalizePhone(contact.phone);
    if (!contactPhone) {
      continue;
    }

    if (contactPhone === digits) {
      return contactPhone;
    }

    if (digits.length >= 7 && contactPhone.endsWith(digits)) {
      if (suffixMatch && suffixMatch !== contactPhone) {
        return null;
      }
      suffixMatch = contactPhone;
    }
  }

  return suffixMatch;
}

function normalizeOutboundPhoneForSession(
  record: SessionRecord | null | undefined,
  rawPhone: string | null | undefined,
) {
  const digits = normalizePhone(rawPhone);
  if (!digits) {
    return null;
  }

  const resolvedFromContacts = resolvePhoneFromSessionContacts(record, digits);
  if (resolvedFromContacts) {
    return resolvedFromContacts;
  }

  const countryCode = deriveSessionCountryCode(record);

  if (digits.length === 11 && digits.startsWith("0") && countryCode) {
    return `${countryCode}${digits.slice(1)}`;
  }

  if (digits.length === 10 && countryCode) {
    return `${countryCode}${digits}`;
  }

  return digits;
}

function phoneFromJid(jid: string | null | undefined) {
  const value = String(jid ?? "").trim().toLowerCase();
  if (!/@s\.whatsapp\.net$/i.test(value)) {
    return null;
  }

  const digits = value.split("@")[0]?.replace(/\D/g, "") ?? "";
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

function buildOutboundDirectTarget(input: {
  record: SessionRecord | null | undefined;
  phone?: string | null;
  jid?: string | null;
}) {
  const normalizedInputJid = toReplyableJid(input.jid ?? null);
  const normalizedPhone = normalizeOutboundPhoneForSession(
    input.record,
    input.phone ?? phoneFromJid(normalizedInputJid),
  );

  if (normalizedInputJid && isLidChatJid(normalizedInputJid)) {
    const lidTarget = resolveSessionReplyableJid(input.record ?? null, normalizedInputJid) ?? normalizedInputJid;
    return {
      jid: lidTarget,
      phone: normalizedPhone ?? phoneFromJid(lidTarget),
    };
  }

  if (normalizedPhone) {
    return {
      jid: `${normalizedPhone}@s.whatsapp.net`,
      phone: normalizedPhone,
    };
  }

  return {
    jid: normalizedInputJid,
    phone: phoneFromJid(normalizedInputJid),
  };
}

async function resolveWhatsAppDialCodeForUser(
  userId: string | null | undefined,
  record: SessionRecord | null | undefined,
) {
  const sessionCountryCode = deriveSessionCountryCode(record);
  if (sessionCountryCode) {
    return sessionCountryCode;
  }

  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    return null;
  }

  const { data } = await db()
    .from("connected_accounts")
    .select("phone_number, account_email")
    .eq("user_id", normalizedUserId)
    .eq("provider", "whatsapp")
    .maybeSingle()
    .catch(() => ({ data: null }));

  const linkedDigits = normalizePhone(data?.phone_number) ?? normalizePhone(data?.account_email);
  if (!linkedDigits || linkedDigits.length <= 10) {
    return null;
  }

  const countryCode = linkedDigits.slice(0, linkedDigits.length - 10);
  return countryCode || null;
}

function resolveSessionReplyableJid(
  record: SessionRecord | null | undefined,
  jid: string | null | undefined,
) {
  const value = toReplyableJid(jid);
  if (!value) {
    return null;
  }

  if (record && isLidChatJid(value)) {
    return record.sharedPhoneJids.get(value) ?? value;
  }

  return value;
}

function resolveSessionContactPhone(
  record: SessionRecord | null | undefined,
  jid: string | null | undefined,
  fallbackPhone?: string | null | undefined,
) {
  return phoneFromJid(resolveSessionReplyableJid(record, jid)) ?? normalizePhone(fallbackPhone);
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
  di: "didi",
  dii: "didi",
  sister: "didi",
  sis: "didi",
  bro: "bhai",
  brother: "bhai",
  bhaiya: "bhai",
};

const LIVE_CONTACT_VARIANT_EXPANSIONS: Record<string, string[]> = {
  maa: ["mom", "mother", "mummy", "mum", "mommy", "mamma", "mama", "ma"],
  papa: ["dad", "father", "daddy", "pappa", "baba", "pitaji", "papaji", "papa ji"],
  didi: ["dii", "di", "sister", "sis"],
  bhai: ["bhaiya", "bro", "brother"],
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

function normalizeLiveIdentityKey(value: string | null | undefined) {
  const normalized = normalizeLiveContactName(value);
  if (!normalized) {
    return "";
  }

  return normalized.replace(/\s+/g, "");
}

function collectLiveIdentityKeys(values: Array<string | null | undefined>) {
  const keys = new Set<string>();
  for (const value of values) {
    const normalized = normalizeLiveContactName(value);
    if (normalized) {
      keys.add(normalized);
    }

    const compact = normalizeLiveIdentityKey(value);
    if (compact) {
      keys.add(compact);
    }
  }

  return keys;
}

function uniqueSanitizedStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => sanitizeContactName(value)).filter(Boolean))] as string[];
}

function expandLiveAliasVariants(value: string | null | undefined) {
  const base = normalizeLiveContactName(value);
  if (!base) {
    return [];
  }

  const variants = new Set<string>([base, base.replace(/\s+/g, "")]);
  const words = base.split(/\s+/).filter(Boolean);

  for (const word of words) {
    variants.add(word);
    for (const expansion of LIVE_CONTACT_VARIANT_EXPANSIONS[word] ?? []) {
      variants.add(normalizeLiveContactName(expansion));
    }
  }

  for (const expansion of LIVE_CONTACT_VARIANT_EXPANSIONS[base] ?? []) {
    variants.add(normalizeLiveContactName(expansion));
  }

  return [...variants].filter(Boolean);
}

function getLiveContactQueryVariants(value: string) {
  const base = normalizeLiveContactName(value);
  if (!base) {
    return [];
  }

  const variants = new Set<string>(expandLiveAliasVariants(base));
  for (const word of base.split(/\s+/).filter(Boolean)) {
    variants.add(word);
  }
  return [...variants].filter(Boolean);
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const matrix: number[][] = [];
  for (let row = 0; row <= right.length; row += 1) {
    matrix[row] = [row];
  }
  for (let column = 0; column <= left.length; column += 1) {
    matrix[0]![column] = column;
  }

  for (let row = 1; row <= right.length; row += 1) {
    for (let column = 1; column <= left.length; column += 1) {
      const cost = left[column - 1] === right[row - 1] ? 0 : 1;
      matrix[row]![column] = Math.min(
        matrix[row - 1]![column]! + 1,
        matrix[row]![column - 1]! + 1,
        matrix[row - 1]![column - 1]! + cost,
      );
    }
  }

  return matrix[right.length]![left.length]!;
}

function liveContactSimilarity(left: string, right: string) {
  const maxLen = Math.max(left.length, right.length);
  if (!maxLen) {
    return 1;
  }
  return 1 - levenshteinDistance(left, right) / maxLen;
}

function normalizeSessionSourceKinds(values: Array<string | null | undefined>) {
  return [...new Set(
    values
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean),
  )];
}

function normalizeTimestampToMs(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function pickBetterDisplayName(current: string | null | undefined, candidate: string | null | undefined) {
  const currentValue = sanitizeContactName(current);
  const candidateValue = sanitizeContactName(candidate);
  if (!candidateValue) {
    return currentValue ?? null;
  }
  if (!currentValue) {
    return candidateValue;
  }

  const currentWords = currentValue.split(/\s+/).length;
  const candidateWords = candidateValue.split(/\s+/).length;
  if (candidateWords > currentWords) {
    return candidateValue;
  }
  if (candidateValue.length > currentValue.length + 2) {
    return candidateValue;
  }
  return currentValue;
}

function collectLiveContactAliases(seed: WhatsAppContactSyncInput) {
  const rawAliases = [
    seed.contactName,
    seed.notifyName,
    seed.verifiedName,
    ...(Array.isArray(seed.aliases) ? seed.aliases : []),
  ];

  return [...new Set(rawAliases.flatMap((value) => expandLiveAliasVariants(value)))];
}

function rememberSessionContacts(record: SessionRecord, contacts: WhatsAppContactSyncInput[]) {
  for (const seed of contacts) {
    const jid = resolveSessionReplyableJid(record, seed.jid ?? null);
    const phone = resolveSessionContactPhone(record, jid, seed.phoneNumber);
    const aliases = collectLiveContactAliases(seed);
    const preferredNames = uniqueSanitizedStrings([
      seed.contactName,
      seed.notifyName,
      seed.verifiedName,
      ...(Array.isArray(seed.aliases) ? seed.aliases : []),
    ]);
    const displayName = pickBetterDisplayName(
      null,
      sanitizeContactName(seed.contactName)
      ?? sanitizeContactName(seed.notifyName)
      ?? sanitizeContactName(seed.verifiedName)
      ?? preferredNames[0]
      ?? aliases[0]
      ?? null,
    );

    if (!jid || !aliases.length || !displayName) {
      continue;
    }

    const contactKey = phone || jid;
    const existing = record.contacts.get(contactKey);
    const mergedAliases = new Set<string>(existing?.aliases ?? []);
    for (const alias of aliases) {
      mergedAliases.add(alias);
    }
    const sourceKinds = normalizeSessionSourceKinds([
      ...(existing?.sourceKinds ?? []),
      ...(Array.isArray(seed.sourceKinds) ? seed.sourceKinds : []),
      seed.source ?? "session",
    ]);
    const messageCount = Math.max(
      existing?.messageCount ?? 0,
      typeof seed.messageCount === "number" && Number.isFinite(seed.messageCount) ? Math.max(0, Math.trunc(seed.messageCount)) : 0,
    );
    const lastMessageAt = Math.max(
      existing?.lastMessageAt ?? 0,
      normalizeTimestampToMs(seed.lastMessageAt) ?? 0,
    ) || null;

    record.contacts.set(contactKey, {
      jid,
      phone,
      displayName: pickBetterDisplayName(existing?.displayName, displayName) ?? displayName,
      aliases: [...mergedAliases],
      sourceKinds,
      messageCount,
      lastMessageAt,
      updatedAt: Date.now(),
    });
  }

  record.checkpointContactCount = Math.max(record.checkpointContactCount, record.contacts.size);
}

function applySessionPhoneShare(
  record: SessionRecord,
  lidJid: string | null | undefined,
  directJid: string | null | undefined,
) {
  const normalizedLid = toReplyableJid(lidJid);
  const normalizedDirect = toReplyableJid(directJid);
  if (!normalizedLid || !isLidChatJid(normalizedLid) || !normalizedDirect || !isDirectChatJid(normalizedDirect)) {
    return false;
  }

  const directPhone = phoneFromJid(normalizedDirect);
  if (!directPhone) {
    return false;
  }

  record.sharedPhoneJids.set(normalizedLid, normalizedDirect);

  const existingLid = record.contacts.get(normalizedLid);
  const existingDirect = record.contacts.get(directPhone) ?? record.contacts.get(normalizedDirect);
  const mergedAliases = new Set<string>([
    ...(existingLid?.aliases ?? []),
    ...(existingDirect?.aliases ?? []),
  ]);
  mergedAliases.add(directPhone);

  const mergedEntry: SessionContactEntry | null =
    existingLid || existingDirect
      ? {
        jid: normalizedDirect,
        phone: directPhone,
        displayName:
          pickBetterDisplayName(existingDirect?.displayName, existingLid?.displayName)
          ?? existingDirect?.displayName
          ?? existingLid?.displayName
          ?? directPhone,
        aliases: [...mergedAliases],
        sourceKinds: normalizeSessionSourceKinds([
          ...(existingDirect?.sourceKinds ?? []),
          ...(existingLid?.sourceKinds ?? []),
          "phone_number_share",
        ]),
        messageCount: Math.max(existingDirect?.messageCount ?? 0, existingLid?.messageCount ?? 0),
        lastMessageAt: Math.max(existingDirect?.lastMessageAt ?? 0, existingLid?.lastMessageAt ?? 0) || null,
        updatedAt: Date.now(),
      }
      : null;

  if (existingLid) {
    record.contacts.delete(normalizedLid);
  }
  if (existingDirect) {
    const existingDirectKey = existingDirect.phone ?? existingDirect.jid;
    record.contacts.delete(existingDirectKey);
  }
  if (mergedEntry) {
    record.contacts.set(directPhone, mergedEntry);
  }
  if (record.lastChatJid === normalizedLid) {
    record.lastChatJid = normalizedDirect;
  }

  for (const row of record.historyRows.values()) {
    if (row.remote_jid !== normalizedLid) {
      continue;
    }

    row.remote_jid = normalizedDirect;
    row.remote_phone = directPhone;
    if (!row.contact_name && mergedEntry?.displayName && mergedEntry.displayName !== directPhone) {
      row.contact_name = mergedEntry.displayName;
    }
  }

  return true;
}

function maybeApplySelfLidIdentityBridge(
  record: SessionRecord,
  message: WAMessage,
  historyEntry: SessionHistoryEntry | null,
) {
  if (!record.phone || record.ownerIdentityKeys.size === 0) {
    return false;
  }

  const remoteLid = toReplyableJid(message.key.remoteJid ?? null);
  if (!remoteLid || !isLidChatJid(remoteLid)) {
    return false;
  }

  const alreadyResolved = resolveSessionReplyableJid(record, remoteLid);
  if (alreadyResolved && isDirectChatJid(alreadyResolved)) {
    return false;
  }

  const selfDirectJid = jidFromPhone(record.phone);
  if (!selfDirectJid) {
    return false;
  }

  const remoteContact = record.contacts.get(remoteLid);
  const candidateKeys = collectLiveIdentityKeys([
    historyEntry?.contact_name ?? null,
    message.pushName ?? null,
    remoteContact?.displayName ?? null,
    ...(remoteContact?.aliases ?? []),
  ]);
  const matchedIdentity = [...candidateKeys].some((key) => record.ownerIdentityKeys.has(key));
  if (!matchedIdentity) {
    return false;
  }

  return applySessionPhoneShare(record, remoteLid, selfDirectJid);
}

async function hydrateSessionSelfLidMappingsFromStore(
  userId: string,
  record: SessionRecord,
  reason: string,
  options: {
    specificLid?: string | null | undefined;
    limit?: number;
  } = {},
) {
  if (!isActiveSessionRecord(userId, record) || !record.phone || record.ownerIdentityKeys.size === 0) {
    return false;
  }

  const selfDirectJid = jidFromPhone(record.phone);
  if (!selfDirectJid) {
    return false;
  }

  const normalizedSpecificLid = toReplyableJid(options.specificLid ?? null);
  const specificLid =
    normalizedSpecificLid && isLidChatJid(normalizedSpecificLid)
      ? normalizedSpecificLid
      : null;
  const rawLimit = typeof options.limit === "number" && Number.isFinite(options.limit)
    ? Math.trunc(options.limit)
    : 120;
  const limit = Math.max(1, Math.min(500, rawLimit));

  const directPromise = db()
    .from("whatsapp_contacts")
    .select("jid,phone_number,contact_name,notify_name,verified_name")
    .eq("user_id", userId)
    .eq("jid", selfDirectJid)
    .limit(1)
    .catch(() => ({ data: [] as DurableWhatsAppContactRow[] }));

  const lidPromise = (() => {
    let query = db()
      .from("whatsapp_contacts")
      .select("jid,phone_number,contact_name,notify_name,verified_name")
      .eq("user_id", userId);

    if (specificLid) {
      query = query.eq("jid", specificLid);
    } else {
      query = query
        .like("jid", "%@lid")
        .limit(limit);
    }

    return query.catch(() => ({ data: [] as DurableWhatsAppContactRow[] }));
  })();

  const [directResult, lidResult] = await Promise.all([directPromise, lidPromise]);
  const directRows = Array.isArray(directResult.data) ? directResult.data : [];
  const lidRows = Array.isArray(lidResult.data) ? lidResult.data : [];
  if (!lidRows.length) {
    return false;
  }

  const ownerIdentityKeys = new Set<string>(record.ownerIdentityKeys);
  const directIdentityKeys = collectLiveIdentityKeys([
    record.phone,
    selfDirectJid,
    ...directRows.flatMap((row) => [
      row.phone_number ?? null,
      row.contact_name ?? null,
      row.notify_name ?? null,
      row.verified_name ?? null,
    ]),
  ]);
  for (const key of directIdentityKeys) {
    ownerIdentityKeys.add(key);
  }

  if (ownerIdentityKeys.size === 0) {
    return false;
  }

  let changed = false;
  let bridgedCount = 0;

  for (const row of lidRows) {
    const lidJid = toReplyableJid(row.jid ?? null);
    if (!lidJid || !isLidChatJid(lidJid)) {
      continue;
    }

    const identityKeys = collectLiveIdentityKeys([
      row.phone_number ?? null,
      row.contact_name ?? null,
      row.notify_name ?? null,
      row.verified_name ?? null,
    ]);
    const isOwnerLid = [...identityKeys].some((key) => ownerIdentityKeys.has(key));
    if (!isOwnerLid) {
      continue;
    }

    if (applySessionPhoneShare(record, lidJid, selfDirectJid)) {
      changed = true;
      bridgedCount += 1;
    }
  }

  if (changed) {
    touchSessionActivity(record);
    persistSessionSyncCheckpoint(userId, record);
    scheduleSessionContactSnapshotPersist(userId, record, `${reason}.durable-self-lid`);
    scheduleSessionHistorySnapshotPersist(userId, record, `${reason}.durable-self-lid`, 200);
    console.log(
      `[agent] Hydrated ${bridgedCount} durable self-chat LID mapping(s) for ${userId} after ${reason}`,
    );
  }

  return changed;
}

function syncSessionContactSeeds(
  userId: string,
  record: SessionRecord,
  seeds: WhatsAppContactSyncInput[],
  sourceLabel: string,
  options: { persist?: boolean } = {},
) {
  if (!seeds.length || !isActiveSessionRecord(userId, record)) {
    return;
  }

  rememberSessionContacts(record, seeds);
  scheduleSessionSyncCheckpointPersist(userId, record, `${sourceLabel}.contact-seeds`);

  if (options.persist === false) {
    return;
  }

  void upsertWhatsAppContacts(userId, seeds).catch((error) =>
    console.error(
      `[agent] WhatsApp ${sourceLabel} contact sync failed for ${userId}:`,
      error instanceof Error ? error.message : error,
    ),
  );
}

function buildSessionContactSeeds(record: SessionRecord): WhatsAppContactSyncInput[] {
  const timestamp = new Date().toISOString();
  return [...record.contacts.values()]
    .map((contact) => {
      const aliases = contact.aliases.filter(Boolean);
      const [contactName, notifyName, verifiedName] = aliases;
      return {
        jid: contact.jid,
        phoneNumber: contact.phone,
        contactName: contactName ?? contact.displayName,
        notifyName: notifyName ?? null,
        verifiedName: verifiedName ?? null,
        aliases,
        source: "session" as const,
        sourceKinds: contact.sourceKinds,
        messageCount: contact.messageCount || null,
        lastMessageAt: contact.lastMessageAt ? new Date(contact.lastMessageAt).toISOString() : null,
        lastSeenAt: timestamp,
      };
    })
    .filter((seed) => Boolean(seed.jid));
}

async function persistSessionContactSnapshot(
  userId: string,
  record: SessionRecord,
  sourceLabel: string,
) {
  if (!isActiveSessionRecord(userId, record)) {
    return 0;
  }

  const seeds = buildSessionContactSeeds(record);
  if (!seeds.length) {
    return 0;
  }

  return await upsertWhatsAppContacts(userId, seeds).then((persisted) => {
    record.lastContactPersistedCount = Math.max(0, Math.trunc(persisted));
    record.checkpointContactCount = Math.max(record.checkpointContactCount, record.contacts.size, persisted);
    touchSessionActivity(record);
    persistSessionSyncCheckpoint(userId, record);
    return persisted;
  }).catch((error) => {
    console.error(
      `[agent] WhatsApp ${sourceLabel} contact snapshot persistence failed for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
    return 0;
  });
}

function scheduleSessionContactSnapshotPersist(
  userId: string,
  record: SessionRecord,
  sourceLabel: string,
) {
  if (!isActiveSessionRecord(userId, record)) {
    return;
  }

  const existing = sessionContactPersistTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    sessionContactPersistTimers.delete(userId);
    if (!isActiveSessionRecord(userId, record)) {
      return;
    }
    void persistSessionContactSnapshot(userId, record, sourceLabel).catch((error) =>
      console.error(
        `[agent] Scheduled WhatsApp contact persistence failed for ${userId}:`,
        error instanceof Error ? error.message : error,
      ),
    );
  }, 1_200);

  sessionContactPersistTimers.set(userId, timer);
}

function scheduleSessionHistorySnapshotPersist(
  userId: string,
  record: SessionRecord,
  sourceLabel: string,
  delayMs = SESSION_HISTORY_PERSIST_DEBOUNCE_MS,
) {
  if (!isActiveSessionRecord(userId, record)) {
    return;
  }

  const existing = sessionHistoryPersistTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    sessionHistoryPersistTimers.delete(userId);
    if (sessions.get(userId) !== record) {
      return;
    }

    void persistSessionHistorySnapshot(userId, record, sourceLabel).catch((error) =>
      console.error(
        `[agent] Scheduled WhatsApp history persistence failed for ${userId}:`,
        error instanceof Error ? error.message : error,
      ),
    );
  }, delayMs);

  sessionHistoryPersistTimers.set(userId, timer);
}

function extractHistoryMessageContent(message: WAMessage) {
  const payload = message.message;
  if (!payload) {
    return null;
  }

  const contactCardNames = Array.isArray(payload.contactsArrayMessage?.contacts)
    ? payload.contactsArrayMessage.contacts
      .map((contact) => contact.displayName?.trim())
      .filter((value): value is string => Boolean(value))
    : [];

  const text =
    payload.conversation?.trim()
    || payload.extendedTextMessage?.text?.trim()
    || payload.imageMessage?.caption?.trim()
    || payload.videoMessage?.caption?.trim()
    || payload.documentMessage?.caption?.trim()
    || payload.contactMessage?.displayName?.trim()
    || contactCardNames.join(", ")
    || "";

  if (text) {
    return text;
  }

  if (payload.audioMessage) return "[Audio message]";
  if (payload.imageMessage) return "[Image]";
  if (payload.videoMessage) return "[Video]";
  if (payload.documentMessage?.fileName) return `[Document: ${payload.documentMessage.fileName}]`;
  if (payload.documentMessage) return "[Document]";
  if (payload.locationMessage) return "[Location]";
  if (payload.reactionMessage?.text) return `[Reaction: ${payload.reactionMessage.text}]`;
  if (payload.contactMessage || payload.contactsArrayMessage) return "[Contact card]";

  return null;
}

function buildSessionHistoryEntry(
  userId: string,
  record: SessionRecord,
  message: WAMessage,
): SessionHistoryEntry | null {
  const waMessageId = String(message.key.id ?? "").trim();
  if (!waMessageId) {
    return null;
  }

  const content = extractHistoryMessageContent(message);
  if (!content) {
    return null;
  }

  const replyableRemoteJid = toReplyableJid(message.key.remoteJid ?? null);
  const replyableParticipantJid = toReplyableJid(message.key.participant ?? null);
  const remoteJid = resolveSessionReplyableJid(
    record,
    replyableRemoteJid ?? replyableParticipantJid,
  );
  const syncSeed = buildSyncSeedFromMessage(message);
  const resolvedSeedJid = resolveSessionReplyableJid(record, syncSeed?.jid ?? null);
  const resolvedSeedPhone = resolveSessionContactPhone(record, resolvedSeedJid, syncSeed?.phoneNumber);
  const knownSessionContact =
    (resolvedSeedPhone ? record.contacts.get(resolvedSeedPhone) : null)
    ?? (resolvedSeedJid ? record.contacts.get(resolvedSeedJid) : null)
    ?? null;
  const contactName =
    sanitizeContactName(syncSeed?.contactName)
    || sanitizeContactName(syncSeed?.notifyName)
    || sanitizeContactName(syncSeed?.verifiedName)
    || sanitizeContactName(message.pushName)
    || knownSessionContact?.displayName
    || null;
  const timestampMs = normalizeTimestampToMs(
    typeof message.messageTimestamp === "object" && message.messageTimestamp && "toNumber" in message.messageTimestamp
      ? (message.messageTimestamp as { toNumber: () => number }).toNumber()
      : (message.messageTimestamp as number | undefined),
  );

  return {
    wa_message_id: waMessageId,
    user_id: userId,
    direction: message.key.fromMe ? "outbound" : "inbound",
    content,
    message_type: getInboundMessageType(message),
    remote_jid: remoteJid,
    remote_phone: resolveSessionContactPhone(record, remoteJid, syncSeed?.phoneNumber),
    contact_name: contactName,
    chat_type: getChatType(remoteJid, record),
    sent_at: timestampMs ? new Date(timestampMs).toISOString() : new Date().toISOString(),
  };
}

function buildSyncSeedFromHistoryRow(row: SessionHistoryEntry): WhatsAppContactSyncInput | null {
  const jid = toReplyableJid(row.remote_jid ?? null);
  const phoneNumber =
    phoneFromJid(jid)
    ?? normalizePhone(row.remote_phone ?? null);
  if (!jid) {
    return null;
  }

  const aliases = uniqueSanitizedStrings([
    sanitizeContactName(row.contact_name),
    phoneNumber,
  ]);

  return {
    jid,
    phoneNumber,
    contactName: sanitizeContactName(row.contact_name),
    aliases,
    source: "history",
    sourceKinds: ["history_message_snapshot"],
    messageCount: 1,
    lastMessageAt: row.sent_at,
  };
}

async function persistSessionHistorySnapshot(
  userId: string,
  record: SessionRecord,
  sourceLabel: string,
) {
  const rows = [...record.historyRows.values()];
  if (!rows.length) {
    return 0;
  }

  const knownIds = rows
    .map((row) => row.wa_message_id)
    .filter(Boolean)
    .slice(0, SESSION_HISTORY_KNOWN_LOOKUP_LIMIT);
  const { data: existing } = await db()
    .from("whatsapp_messages")
    .select("wa_message_id")
    .eq("user_id", userId)
    .in("wa_message_id", knownIds)
    .catch(() => ({ data: [] as Array<{ wa_message_id: string | null }> }));

  const existingIds = new Set((existing ?? []).map((row) => String(row.wa_message_id ?? "").trim()).filter(Boolean));
  const pending = rows
    .filter((row) => row.wa_message_id && !existingIds.has(row.wa_message_id))
    .sort((left, right) => left.sent_at.localeCompare(right.sent_at))
    .slice(-SESSION_HISTORY_PERSIST_BATCH_LIMIT);

  if (!pending.length) {
    return 0;
  }

  const { error } = await db()
    .from("whatsapp_messages")
    .insert(pending);

  if (error) {
    console.error(
      `[agent] WhatsApp ${sourceLabel} history snapshot persistence failed for ${userId}:`,
      error.message,
    );
    return 0;
  }

  record.lastHistoryPersistedCount = pending.length;
  record.checkpointHistoryMessageCount = Math.max(
    record.checkpointHistoryMessageCount,
    record.historyRows.size,
    pending.length,
  );
  touchSessionActivity(record);
  persistSessionSyncCheckpoint(userId, record);
  console.log(`[agent] Persisted ${pending.length} WhatsApp history messages for ${userId} after ${sourceLabel}`);
  return pending.length;
}

function rememberSessionHistoryRows(record: SessionRecord, rows: SessionHistoryEntry[]) {
  for (const row of rows) {
    record.historyRows.set(row.wa_message_id, row);
  }

  const ordered = [...record.historyRows.values()].sort((left, right) => right.sent_at.localeCompare(left.sent_at));
  record.checkpointHistoryMessageCount = Math.max(record.checkpointHistoryMessageCount, ordered.length);
  if (ordered.length <= SESSION_HISTORY_BUFFER_LIMIT) {
    return;
  }

  const trimmed = ordered.slice(0, SESSION_HISTORY_BUFFER_LIMIT);
  record.historyRows = new Map(trimmed.map((row) => [row.wa_message_id, row]));
}

function scheduleSessionHistoryContactBackfill(userId: string, reason: string) {
  const existing = sessionHistoryContactBackfillTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    sessionHistoryContactBackfillTimers.delete(userId);
    void backfillWhatsAppContactsFromHistory(userId)
      .then((result) => {
        const activeRecord = sessions.get(userId);
        if (activeRecord) {
          activeRecord.lastHistoryBackfillCount = Math.max(0, Math.trunc(result.createdCount));
          touchSessionActivity(activeRecord);
          persistSessionSyncCheckpoint(userId, activeRecord);
        }
        if (result.createdCount > 0) {
          console.log(
            `[agent] Backfilled ${result.createdCount} durable WhatsApp contacts from history for ${userId} after ${reason}`,
          );
        }
      })
      .catch((error) =>
        console.error(
          `[agent] WhatsApp history contact backfill failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        ),
      );
  }, SESSION_HISTORY_CONTACT_BACKFILL_DEBOUNCE_MS);

  sessionHistoryContactBackfillTimers.set(userId, timer);
}

function safeBuildHistoryContactSeed(
  contact: Partial<WAContact>,
  sourceLabel: string,
) {
  try {
    return buildSyncSeedFromBaileysContact(contact);
  } catch (error) {
    console.error(
      `[agent] Skipping malformed WhatsApp contact during ${sourceLabel}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function safeBuildHistoryChatSeed(
  chat: Record<string, unknown>,
  sourceLabel: string,
) {
  try {
    return buildSyncSeedFromChat(chat);
  } catch (error) {
    console.error(
      `[agent] Skipping malformed WhatsApp chat during ${sourceLabel}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function safeBuildHistoryMessageSeed(
  message: WAMessage,
  sourceLabel: string,
) {
  try {
    return buildSyncSeedFromMessage(message);
  } catch (error) {
    console.error(
      `[agent] Skipping malformed WhatsApp message contact seed during ${sourceLabel}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function safeBuildSessionHistoryEntry(
  userId: string,
  record: SessionRecord,
  message: WAMessage,
  sourceLabel: string,
) {
  try {
    return buildSessionHistoryEntry(userId, record, message);
  } catch (error) {
    console.error(
      `[agent] Skipping malformed WhatsApp history message during ${sourceLabel}:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

function buildSessionHistoryCursors(record: SessionRecord) {
  const cursors = new Map<string, SessionHistoryCursor>();

  for (const row of record.historyRows.values()) {
    if (row.chat_type !== "direct" && row.chat_type !== "self") {
      continue;
    }

    const remoteJid = toReplyableJid(row.remote_jid ?? null);
    if (!remoteJid || !row.wa_message_id) {
      continue;
    }

    const timestampMs = Date.parse(row.sent_at);
    if (!Number.isFinite(timestampMs)) {
      continue;
    }

    const existing = cursors.get(remoteJid);
    if (!existing) {
      cursors.set(remoteJid, {
        remoteJid,
        oldestMessageId: row.wa_message_id,
        oldestTimestampMs: timestampMs,
        fromMe: row.direction === "outbound",
        messageCount: 1,
      });
      continue;
    }

    existing.messageCount += 1;
    if (timestampMs < existing.oldestTimestampMs) {
      existing.oldestMessageId = row.wa_message_id;
      existing.oldestTimestampMs = timestampMs;
      existing.fromMe = row.direction === "outbound";
    }
  }

  return [...cursors.values()].sort((left, right) => {
    if (left.messageCount !== right.messageCount) {
      return left.messageCount - right.messageCount;
    }
    return right.oldestTimestampMs - left.oldestTimestampMs;
  });
}

async function requestSessionHistoryExpansion(
  userId: string,
  record: SessionRecord,
  reason: string,
) {
  if (record.status !== "connected" || !isActiveSessionRecord(userId, record)) {
    return;
  }

  if (!shouldRequestMoreClawCloudWhatsAppHistory(
    getSessionRuntimeHistoryMessageCount(record),
    SESSION_HISTORY_SYNC_TARGET,
  )) {
    return;
  }

  const existing = sessionHistoryExpansionTasks.get(userId);
  if (existing) {
    if (existing.record === record) {
      return existing.promise;
    }

    sessionHistoryExpansionTasks.delete(userId);
  }

  const task = (async () => {
    const syncFrame = beginSessionSync(userId, record, "history_expansion", reason);
    let requestedCount = 0;
    const requestState = sessionHistoryExpansionState.get(userId) ?? new Map();
    sessionHistoryExpansionState.set(userId, requestState);

    try {
      if (!isActiveSessionRecord(userId, record)) {
        return;
      }

      const prioritizedCandidates = buildEligibleSessionHistoryExpansionCandidates(userId, record)
        .slice(0, SESSION_HISTORY_EXPANSION_CHAT_LIMIT);

      if (!prioritizedCandidates.length) {
        return;
      }

      for (const cursor of prioritizedCandidates) {
        if (!isActiveSessionRecord(userId, record) || record.status !== "connected") {
          break;
        }

        try {
          await record.sock.fetchMessageHistory(
            SESSION_HISTORY_EXPANSION_BATCH_SIZE,
            {
              remoteJid: cursor.remoteJid,
              id: cursor.oldestMessageId,
              fromMe: cursor.fromMe,
            },
            cursor.oldestTimestampMs,
          );
          requestedCount += 1;
          const previous = requestState.get(cursor.remoteJid);
          requestState.set(cursor.remoteJid, {
            oldestMessageId: cursor.oldestMessageId,
            attempts:
              previous?.oldestMessageId === cursor.oldestMessageId
                ? previous.attempts + 1
                : 1,
          });
        } catch (error) {
          const previous = requestState.get(cursor.remoteJid);
          requestState.set(cursor.remoteJid, {
            oldestMessageId: cursor.oldestMessageId,
            attempts:
              previous?.oldestMessageId === cursor.oldestMessageId
                ? previous.attempts + 1
                : 1,
          });
          console.error(
            `[agent] WhatsApp history expansion request failed for ${userId} via ${reason}:`,
            error instanceof Error ? error.message : error,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, 220));
      }

      if (requestedCount > 0) {
        console.log(
          `[agent] Requested older WhatsApp history for ${requestedCount} chats for ${userId} via ${reason}`,
        );
        if (buildEligibleSessionHistoryExpansionCandidates(userId, record).length > 0) {
          scheduleSessionHistoryExpansionFollowup(
            userId,
            record,
            `${reason}.followup`,
          );
        }
      }
      completeSessionSync(userId, record, syncFrame, {
        historyExpansionRequestedCount: requestedCount,
      });
    } catch (error) {
      completeSessionSync(userId, record, syncFrame, {
        historyExpansionRequestedCount: requestedCount,
        error,
      });
      throw error;
    } finally {
      if (record.activeSyncFrames.some((item) => item.id === syncFrame.id)) {
        completeSessionSync(userId, record, syncFrame, {
          historyExpansionRequestedCount: requestedCount,
        });
      }
      const activeTask = sessionHistoryExpansionTasks.get(userId);
      if (activeTask?.record === record) {
        sessionHistoryExpansionTasks.delete(userId);
      }
    }
  })();

  sessionHistoryExpansionTasks.set(userId, { record, promise: task });
  return task;
}

function processSessionHistorySync(
  userId: string,
  record: SessionRecord,
  payload: {
    contacts?: Partial<WAContact>[] | null;
    chats?: Record<string, unknown>[] | null;
    messages?: WAMessage[] | null;
    syncType?: unknown;
    progress?: number | null;
  },
) {
  if (!isActiveSessionRecord(userId, record)) {
    return;
  }

  touchSessionActivity(record);

  const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  const chats = Array.isArray(payload.chats) ? payload.chats : [];
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const sourceLabel = `history.sync.${String(payload.syncType ?? "unknown")}`;

  try {
    for (const chat of chats) {
      const phoneShare = extractWhatsAppPhoneShareFromChat(chat);
      if (phoneShare) {
        applySessionPhoneShare(record, phoneShare.lidJid, phoneShare.directJid);
      }
    }

    for (const message of messages) {
      const phoneShare = extractWhatsAppPhoneShareFromMessage(message);
      if (phoneShare) {
        applySessionPhoneShare(record, phoneShare.lidJid, phoneShare.directJid);
      }
    }

    const seeds = [
      ...(contacts
        .map((contact) => safeBuildHistoryContactSeed(contact, sourceLabel))
        .filter(Boolean) as WhatsAppContactSyncInput[]),
      ...(chats
        .map((chat) => safeBuildHistoryChatSeed(chat, sourceLabel))
        .filter(Boolean) as WhatsAppContactSyncInput[]),
      ...(messages
        .map((message) => safeBuildHistoryMessageSeed(message, sourceLabel))
        .filter(Boolean) as WhatsAppContactSyncInput[]),
    ];

    if (contacts.length || chats.length || messages.length) {
      console.log(
        `[agent] WhatsApp history sync for ${userId}: contacts=${contacts.length} chats=${chats.length} messages=${messages.length} syncType=${String(payload.syncType ?? "unknown")} progress=${payload.progress ?? "?"}`,
      );
    }

    syncSessionContactSeeds(userId, record, seeds, sourceLabel);
    scheduleSessionContactSnapshotPersist(userId, record, sourceLabel);

    const historyRows = messages
      .map((message) => safeBuildSessionHistoryEntry(userId, record, message, sourceLabel))
      .filter(Boolean) as SessionHistoryEntry[];

    rememberSessionHistoryRows(record, historyRows);
    scheduleSessionSyncCheckpointPersist(userId, record, `${sourceLabel}.history-rows`);
    const historyContactSeeds = historyRows
      .map((row) => buildSyncSeedFromHistoryRow(row))
      .filter(Boolean) as WhatsAppContactSyncInput[];
    syncSessionContactSeeds(userId, record, historyContactSeeds, `${sourceLabel}.rows`);

    if (historyRows.length) {
      scheduleSessionHistorySnapshotPersist(userId, record, sourceLabel);
      scheduleSessionHistoryContactBackfill(userId, sourceLabel);
      void persistSessionHistorySnapshot(userId, record, sourceLabel).catch((error) =>
        console.error(
          `[agent] WhatsApp history event persistence failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        ),
      );
    }

    if (record.status === "connected" && (messages.length || chats.length || contacts.length)) {
      void requestSessionHistoryExpansion(userId, record, `${sourceLabel}.continue`).catch((error) =>
        console.error(
          `[agent] WhatsApp history continuation failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        ),
      );
    }
  } catch (error) {
    console.error(
      `[agent] WhatsApp history sync processing failed for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

async function requestSessionContactRefresh(
  userId: string,
  record: SessionRecord,
  reason: string,
) {
  if (record.status !== "connected" || !isActiveSessionRecord(userId, record)) {
    console.log(
      `[agent] Skipping WhatsApp contact refresh for ${userId} via ${reason}: session status is ${record.status}`,
    );
    return;
  }

  const existing = contactRefreshTasks.get(userId);
  if (existing) {
    if (existing.record === record) {
      return existing.promise;
    }

    contactRefreshTasks.delete(userId);
  }

  const task = (async () => {
    const syncFrame = beginSessionSync(userId, record, "contact_refresh", reason);
    let bestPersisted = 0;
    let bestHistoryPersisted = 0;
    try {
      if (!isActiveSessionRecord(userId, record)) {
        return;
      }

      console.log(`[agent] Refreshing WhatsApp contacts for ${userId} via ${reason}`);
      let previousPassCount = record.contacts.size;

      for (let pass = 0; pass < CONTACT_REFRESH_MAX_PASSES; pass += 1) {
        if (!isActiveSessionRecord(userId, record) || record.status !== "connected") {
          break;
        }

        await record.sock.resyncAppState(CONTACT_REFRESH_COLLECTIONS, false);
        await new Promise((resolve) => setTimeout(resolve, CONTACT_REFRESH_WAIT_MS));
        if (!isActiveSessionRecord(userId, record) || record.status !== "connected") {
          break;
        }
        const persisted = await persistSessionContactSnapshot(userId, record, `${reason}.pass${pass + 1}`);
        bestPersisted = Math.max(bestPersisted, persisted);
        const historyPersisted = await persistSessionHistorySnapshot(
          userId,
          record,
          `${reason}.pass${pass + 1}`,
        ).catch((error) => {
          console.error(
            `[agent] WhatsApp history refresh persistence failed for ${userId}:`,
            error instanceof Error ? error.message : error,
          );
          return 0;
        });
        bestHistoryPersisted = Math.max(bestHistoryPersisted, historyPersisted);

        const currentCount = record.contacts.size;
        const reachedTarget = currentCount >= CONTACT_REFRESH_TARGET_COUNT;
        const stalled = pass > 0 && currentCount <= previousPassCount;
        previousPassCount = Math.max(previousPassCount, currentCount);
        if (reachedTarget || stalled) {
          break;
        }
      }

      if (bestPersisted > 0) {
        console.log(`[agent] Persisted ${bestPersisted} WhatsApp contacts for ${userId} after ${reason}`);
      }
      completeSessionSync(userId, record, syncFrame, {
        contactPersistedCount: bestPersisted,
        historyPersistedCount: bestHistoryPersisted,
      });
    } catch (error) {
      console.error(
        `[agent] WhatsApp contact refresh failed for ${userId}:`,
        error instanceof Error ? error.message : error,
      );
      completeSessionSync(userId, record, syncFrame, {
        contactPersistedCount: bestPersisted,
        historyPersistedCount: bestHistoryPersisted,
        error,
      });
    } finally {
      if (record.activeSyncFrames.some((item) => item.id === syncFrame.id)) {
        completeSessionSync(userId, record, syncFrame, {
          contactPersistedCount: bestPersisted,
          historyPersistedCount: bestHistoryPersisted,
        });
      }
      const activeTask = contactRefreshTasks.get(userId);
      if (activeTask?.record === record) {
        contactRefreshTasks.delete(userId);
      }
    }
  })();

  contactRefreshTasks.set(userId, { record, promise: task });
  return task;
}

async function bootstrapSessionWorkspace(
  userId: string,
  record: SessionRecord,
  reason: string,
) {
  if (record.status !== "connected" || !isActiveSessionRecord(userId, record)) {
    return;
  }

  const existing = workspaceBootstrapTasks.get(userId);
  if (existing) {
    if (existing.record === record) {
      return existing.promise;
    }

    workspaceBootstrapTasks.delete(userId);
  }

  const task = (async () => {
    const syncFrame = beginSessionSync(userId, record, "workspace_bootstrap", reason);
    let backfillCount = 0;
    try {
      if (!isActiveSessionRecord(userId, record)) {
        return;
      }

      await requestSessionContactRefresh(userId, record, reason);
      if (!isActiveSessionRecord(userId, record)) {
        return;
      }

      const backfill = await backfillWhatsAppContactsFromHistory(userId).catch((error) => {
        console.error(
          `[agent] WhatsApp history contact backfill failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        );
        return { createdCount: 0 };
      });
      backfillCount = Math.max(0, Math.trunc(backfill.createdCount));

      if (isActiveSessionRecord(userId, record) && backfillCount > 0) {
        console.log(
          `[agent] Backfilled ${backfillCount} durable WhatsApp contacts from history for ${userId} after ${reason}`,
        );
      }

      if (!isActiveSessionRecord(userId, record)) {
        return;
      }

      await requestSessionHistoryExpansion(userId, record, reason).catch((error) => {
        console.error(
          `[agent] WhatsApp history expansion failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        );
      });
      completeSessionSync(userId, record, syncFrame, {
        historyBackfillCount: backfillCount,
      });
    } catch (error) {
      completeSessionSync(userId, record, syncFrame, {
        historyBackfillCount: backfillCount,
        error,
      });
      throw error;
    } finally {
      if (record.activeSyncFrames.some((item) => item.id === syncFrame.id)) {
        completeSessionSync(userId, record, syncFrame, {
          historyBackfillCount: backfillCount,
        });
      }
      const activeTask = workspaceBootstrapTasks.get(userId);
      if (activeTask?.record === record) {
        workspaceBootstrapTasks.delete(userId);
      }
    }
  })();

  workspaceBootstrapTasks.set(userId, { record, promise: task });
  return task;
}

function scheduleSessionWorkspaceResync(
  userId: string,
  record: SessionRecord,
  reason: string,
  delayMs = SESSION_WORKSPACE_RESYNC_INTERVAL_MS,
) {
  const existing = sessionWorkspaceResyncTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }

  const timer = setTimeout(() => {
    sessionWorkspaceResyncTimers.delete(userId);
    const latest = sessions.get(userId);
    if (latest !== record || latest?.status !== "connected") {
      return;
    }

    void bootstrapSessionWorkspace(userId, latest, reason)
      .catch((error) =>
        console.error(
          `[agent] Scheduled WhatsApp workspace resync failed for ${userId}:`,
          error instanceof Error ? error.message : error,
        ),
      )
      .finally(() => {
        const current = sessions.get(userId);
        if (current === latest && current?.status === "connected") {
          scheduleSessionWorkspaceResync(
            userId,
            current,
            `${reason}.repeat`,
            SESSION_WORKSPACE_RESYNC_INTERVAL_MS,
          );
        }
      });
  }, delayMs);

  sessionWorkspaceResyncTimers.set(userId, timer);
}

function scoreSessionContactAlias(alias: string, normalizedQuery: string) {
  if (alias === normalizedQuery) {
    return 100;
  }

  if (alias.startsWith(normalizedQuery) || normalizedQuery.startsWith(alias)) {
    return 92;
  }

  const aliasWords = alias.split(/\s+/).filter(Boolean);
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  if (
    aliasWords.some((word) => queryWords.includes(word))
    || queryWords.some((word) => aliasWords.includes(word))
  ) {
    return 88;
  }

  if (alias.includes(normalizedQuery) || normalizedQuery.includes(alias)) {
    return 84;
  }

  return Math.round(liveContactSimilarity(alias, normalizedQuery) * 100);
}

const SELF_CONTACT_QUERY_PATTERN = /\b(me|myself|self|my chat|my own|my number|my whatsapp|to me|to myself)\b/i;

function isExplicitSelfContactQuery(rawName: string) {
  const normalized = sanitizeContactName(rawName);
  if (!normalized) {
    return false;
  }

  return SELF_CONTACT_QUERY_PATTERN.test(normalized);
}

function isSessionSelfRecipient(
  record: SessionRecord,
  input: { phone: string | null; jid: string | null; name?: string | null },
) {
  const selfPhone = normalizePhone(record.phone);
  const recipientPhone = normalizePhone(input.phone);
  if (selfPhone && recipientPhone && selfPhone === recipientPhone) {
    return true;
  }

  const rawName = String(input.name ?? "").trim();
  if (
    rawName
    && (
      /\(\s*you\s*\)$/i.test(rawName)
      || /^you$/i.test(rawName)
      || /^me$/i.test(rawName)
      || /\bmessage yourself\b/i.test(rawName)
    )
  ) {
    return true;
  }

  return getChatType(input.jid, record) === "self";
}

function resolveSessionContact(record: SessionRecord, rawName: string): SessionContactResolveResult | null {
  const queryVariants = getLiveContactQueryVariants(rawName);
  if (!queryVariants.length) {
    return null;
  }
  const allowSelfMatch = isExplicitSelfContactQuery(rawName);
  const receiptDerivedAliases = buildWhatsAppReceiptDerivedAliasMap(
    [...record.historyRows.values()].map((row) => ({
      content: row.content,
      direction: row.direction,
      chatType: row.chat_type,
      remotePhone: row.remote_phone,
      remoteJid: row.remote_jid,
    })),
  );

  const matches: Array<SessionContactMatch & { qualityRank: number; memberCount: number }> = [];
  const identities = buildClawCloudWhatsAppContactIdentityGraph(
    [
      ...[...record.contacts.values()].map((entry) => ({
        jid: entry.jid,
        phone: entry.phone,
        displayName: entry.displayName,
        aliases: entry.aliases,
        messageCount: entry.messageCount,
        lastMessageAt: entry.lastMessageAt ? new Date(entry.lastMessageAt).toISOString() : null,
        lastSeenAt: entry.updatedAt ? new Date(entry.updatedAt).toISOString() : null,
      })),
      ...[...receiptDerivedAliases.entries()].map(([phone, aliases]) => ({
        jid: `${phone}@s.whatsapp.net`,
        phone,
        displayName: aliases[0] ?? phone,
        aliases,
        identityKey: `phone:${phone}`,
      })),
    ],
  );

  for (const identity of identities) {
    let score = 0;
    for (const alias of identity.normalizedAliases) {
      for (const queryVariant of queryVariants) {
        score = Math.max(score, scoreSessionContactAlias(alias, queryVariant));
      }
    }

    if (score < 72) {
      continue;
    }

    matches.push({
      name: identity.displayName,
      phone: identity.phone,
      jid: identity.primaryJid,
      score,
      qualityRank:
        identity.phone
          ? 3
          : (identity.quality === "alias_bridge" ? 2 : 1),
      memberCount: identity.memberCount,
    });
  }

  const filteredMatches = allowSelfMatch
    ? matches
    : matches.filter((candidate) =>
      !isSessionSelfRecipient(record, {
        phone: candidate.phone,
        jid: candidate.jid ?? null,
        name: candidate.name,
      })
    );

  filteredMatches.sort((left, right) =>
    right.score - left.score
    || right.qualityRank - left.qualityRank
    || right.memberCount - left.memberCount
    || right.name.length - left.name.length,
  );

  if (!filteredMatches.length) {
    return null;
  }

  if (filteredMatches.length === 1) {
    return { type: "found", contact: filteredMatches[0]! };
  }

  const top = filteredMatches[0]!;
  const runnerUp = filteredMatches[1]!;
  if (
    top.score >= 100
    || top.score - runnerUp.score > 8
    || (top.score === runnerUp.score && top.qualityRank > runnerUp.qualityRank)
  ) {
    return { type: "found", contact: top };
  }

  return {
    type: "ambiguous",
    matches: filteredMatches.slice(0, 4),
  };
}

function buildSyncSeedFromBaileysContact(contact: Partial<WAContact>): WhatsAppContactSyncInput | null {
  const jid = toReplyableJid(contact.jid ?? contact.id ?? null);
  const phoneNumber = phoneFromJid(contact.jid ?? contact.id ?? null);
  const raw = contact as Partial<WAContact> & Record<string, unknown>;
  const nameAliases = uniqueSanitizedStrings([
    sanitizeContactName(contact.name),
    sanitizeContactName(contact.notify),
    sanitizeContactName(contact.verifiedName),
    sanitizeContactName(typeof raw.short === "string" ? raw.short : null),
    sanitizeContactName(typeof raw.shortName === "string" ? raw.shortName : null),
    sanitizeContactName(typeof raw.pushname === "string" ? raw.pushname : null),
    sanitizeContactName(typeof raw.vname === "string" ? raw.vname : null),
  ]);
  const aliases = uniqueSanitizedStrings([
    ...nameAliases,
    phoneNumber,
  ]);
  const [contactName, notifyName, verifiedName] = nameAliases;

  if (!jid || (!phoneNumber && !isLidChatJid(jid)) || !aliases.length) {
    return null;
  }

  return {
    jid,
    phoneNumber,
    contactName,
    notifyName,
    verifiedName,
    aliases,
    sourceKinds: ["baileys_contact"],
  };
}

function buildSyncSeedFromMessage(message: WAMessage): WhatsAppContactSyncInput | null {
  const phoneShare = extractWhatsAppPhoneShareFromMessage(message);
  const replyableJid = toReplyableJid(message.key.remoteJid ?? null);
  const participantJid = toReplyableJid(message.key.participant ?? null);
  const jid = phoneShare?.directJid ?? participantJid ?? replyableJid;
  const phoneNumber = phoneFromJid(phoneShare?.directJid ?? jid);
  const nameAliases = uniqueSanitizedStrings([
    sanitizeContactName(message.pushName),
    sanitizeContactName(message.message?.contactMessage?.displayName),
    sanitizeContactName(message.message?.contactsArrayMessage?.contacts?.[0]?.displayName),
  ]);
  const aliases = uniqueSanitizedStrings([
    ...nameAliases,
    phoneNumber,
  ]);
  const notifyName = nameAliases[0] ?? null;

  if (!jid || (!phoneNumber && !isLidChatJid(jid)) || !aliases.length) {
    return null;
  }

  const messageTimestamp = normalizeTimestampToMs(
    typeof message.messageTimestamp === "object" && message.messageTimestamp && "toNumber" in message.messageTimestamp
      ? (message.messageTimestamp as { toNumber: () => number }).toNumber()
      : (message.messageTimestamp as number | undefined),
  );

  return {
    jid,
    phoneNumber,
    notifyName,
    aliases,
    source: "message",
    sourceKinds: [participantJid ? "group_participant_message" : "message"],
    messageCount: 1,
    lastMessageAt: messageTimestamp ? new Date(messageTimestamp).toISOString() : null,
  };
}

function buildSyncSeedFromChat(chat: Record<string, unknown>): WhatsAppContactSyncInput | null {
  const phoneShare = extractWhatsAppPhoneShareFromChat(chat);
  const jid =
    phoneShare?.directJid
    ?? toReplyableJid(chat.id)
    ?? toReplyableJid(typeof chat.pnJid === "string" ? chat.pnJid : null)
    ?? toReplyableJid(typeof chat.lidJid === "string" ? chat.lidJid : null);
  const phoneNumber = jid ? phoneFromJid(jid) : null;
  const nameAliases = uniqueSanitizedStrings([
    typeof chat.name === "string" ? chat.name : null,
    typeof chat.formattedTitle === "string" ? chat.formattedTitle : null,
    typeof chat.contactName === "string" ? chat.contactName : null,
    typeof chat.notifyName === "string" ? chat.notifyName : null,
    typeof chat.pushName === "string" ? chat.pushName : null,
    typeof chat.shortName === "string" ? chat.shortName : null,
  ]);
  const aliases = uniqueSanitizedStrings([
    ...nameAliases,
    phoneNumber,
  ]);
  const [contactName, notifyName] = nameAliases;

  if (!jid || !aliases.length) {
    return null;
  }

  return {
    jid,
    phoneNumber,
    contactName,
    notifyName,
    aliases,
    source: "history",
    sourceKinds: ["chat_history"],
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

function getInboundMessageType(message: WAMessage | null | undefined) {
  const payload = message?.message;
  if (!payload) return "text";
  if (payload.imageMessage) return "image";
  if (payload.audioMessage) return "audio";
  if (payload.documentMessage) return "document";
  if (payload.videoMessage) return "video";
  if (payload.locationMessage) return "location";
  if (payload.contactMessage || payload.contactsArrayMessage) return "contact";
  if (payload.reactionMessage) return "reaction";
  return "text";
}

function buildWhatsAppRoutingContext(input: {
  baseText: string;
  chatType: "direct" | "group" | "self" | "broadcast" | "unknown";
  messageType: string;
  contactName: string | null;
  priority: WhatsAppContactPriority;
  tags: string[];
}) {
  const notes: string[] = [];

  if (input.contactName) {
    notes.push(`Contact: ${input.contactName}.`);
  }

  if (input.priority === "vip" || input.priority === "high") {
    notes.push(`This is a ${input.priority.toUpperCase()} priority conversation.`);
  }

  if (input.tags.length) {
    notes.push(`Known contact tags: ${input.tags.slice(0, 4).join(", ")}.`);
  }

  if (input.tags.some((tag) => /client|work|business|lead|finance/i.test(tag))) {
    notes.push("Default to a concise professional tone unless the user asks for something else.");
  }

  if (input.tags.some((tag) => /family|friend|personal/i.test(tag))) {
    notes.push("A warmer and more familiar tone is acceptable when it fits the message.");
  }

  if (input.chatType === "group") {
    notes.push("This reply is for a WhatsApp group audience. Keep it concise and avoid sounding overly personal.");
  }

  if (input.messageType !== "text") {
    notes.push(`The original WhatsApp message arrived as ${input.messageType}. Use the extracted text as the source content.`);
  }

  if (!notes.length) {
    return input.baseText;
  }

  return `[WhatsApp workspace context]\n${notes.map((note) => `- ${note}`).join("\n")}\n\n${input.baseText}`;
}

function resolveReplyJid(
  session: SessionRecord,
  targetJid?: string | null,
) {
  const rawTarget = String(targetJid ?? "").trim();
  if (rawTarget && isGroupChatJid(rawTarget)) {
    return rawTarget;
  }

  const candidate = resolveSessionReplyableJid(session, targetJid);
  if (candidate) {
    return candidate;
  }

  const assistantDefault = resolveDefaultAssistantChatJid(session.phone, session.lastChatJid);
  if (assistantDefault) {
    return assistantDefault;
  }

  return null;
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

async function loadSessionOwnerIdentityKeys(userId: string) {
  const [userResult, accountResult] = await Promise.all([
    db()
      .from("users")
      .select("full_name,email")
      .eq("id", userId)
      .maybeSingle()
      .catch(() => ({ data: null as { full_name?: string | null; email?: string | null } | null })),
    db()
      .from("connected_accounts")
      .select("display_name,account_email")
      .eq("user_id", userId)
      .eq("provider", "whatsapp")
      .maybeSingle()
      .catch(() => ({ data: null as { display_name?: string | null; account_email?: string | null } | null })),
  ]);

  const emailLocalPart = String(userResult.data?.email ?? "").split("@")[0] ?? "";
  const accountLocalPart = String(accountResult.data?.account_email ?? "").split("@")[0] ?? "";

  return collectLiveIdentityKeys([
    userResult.data?.full_name ?? null,
    accountResult.data?.display_name ?? null,
    emailLocalPart || null,
    accountLocalPart || null,
  ]);
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

async function getUserWhatsAppTimeZone(userId: string) {
  const { data } = await db()
    .from("users")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  return (data?.timezone as string | undefined) ?? "Asia/Kolkata";
}

async function loadWhatsAppWorkspaceContact(
  userId: string,
  remoteJid: string | null,
  remotePhone: string | null,
) {
  const byJid = remoteJid
    ? await db()
      .from("whatsapp_contacts")
      .select("contact_name, notify_name, verified_name, priority, tags")
      .eq("user_id", userId)
      .eq("jid", remoteJid)
      .maybeSingle()
      .catch(() => ({ data: null }))
    : { data: null };

  if (byJid.data) {
    return {
      displayName:
        sanitizeContactName(byJid.data.contact_name)
        || sanitizeContactName(byJid.data.notify_name)
        || sanitizeContactName(byJid.data.verified_name),
      isKnown: true,
      priority: normalizeWhatsAppPriority(byJid.data.priority),
      tags: Array.isArray(byJid.data.tags)
        ? byJid.data.tags.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [],
    };
  }

  const byPhone = remotePhone
    ? await db()
      .from("whatsapp_contacts")
      .select("contact_name, notify_name, verified_name, priority, tags")
      .eq("user_id", userId)
      .eq("phone_number", remotePhone)
      .maybeSingle()
      .catch(() => ({ data: null }))
    : { data: null };

  if (!byPhone.data) {
    return {
      displayName: null,
      isKnown: false,
      priority: "normal" as WhatsAppContactPriority,
      tags: [] as string[],
    };
  }

  return {
    displayName:
      sanitizeContactName(byPhone.data.contact_name)
      || sanitizeContactName(byPhone.data.notify_name)
      || sanitizeContactName(byPhone.data.verified_name),
    isKnown: true,
    priority: normalizeWhatsAppPriority(byPhone.data.priority),
    tags: Array.isArray(byPhone.data.tags)
      ? byPhone.data.tags.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      : [],
  };
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

function resolveAssistantSelfReplyTarget(
  session: SessionRecord | null | undefined,
  targetJid?: string | null,
) {
  if (!session?.phone) {
    return null;
  }

  const jid = resolveReplyJid(session, targetJid);
  if (!jid) {
    return null;
  }

  if (targetJid) {
    return jid;
  }

  return isWhatsAppResolvedSelfChat(session.phone, targetJid ?? null, jid)
    ? jid
    : null;
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

function looksLikeAssistantPreferenceRequest(message: string) {
  const normalized = String(message ?? "").toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  const hasPreferenceKeyword =
    /\b(?:fast|faster|slow|detailed|detail|brief|short|concise|accurate|accuracy|professional|formal|direct|hallucinat(?:e|ing)|perfect)\b/.test(normalized);
  const hasReplyKeyword =
    /\b(?:reply|respond|response|answer|answers|be|keep|make|write|talk)\b/.test(normalized);

  return hasPreferenceKeyword && hasReplyKeyword;
}

function looksLikeAssistantParametersQuestion(message: string) {
  const normalized = String(message ?? "").toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  return (
    /\b(?:what|which|tell me|show me|explain)\b.{0,18}\byour\b.{0,18}\b(?:parameter|parameters|setting|settings|configuration|config|limits)\b/.test(normalized)
    || /\bhow\s+are\s+you\s+(?:configured|set\s*up)\b/.test(normalized)
  );
}

function looksLikeWeatherQuestionWithoutLocation(message: string) {
  const normalized = String(message ?? "").toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  return /\b(?:weather|whether|temperature|forecast|rain|humidity|wind|aqi)\b/.test(normalized);
}

function looksLikePromptLeakReply(reply: string | null | undefined) {
  const normalized = String(reply ?? "").toLowerCase().trim();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("you are being asked to")
    || normalized.includes("original user prompt")
    || normalized.includes("romanized reading")
    || normalized.includes("english meaning")
    || normalized.includes("answer the question described by the english meaning")
    || normalized.includes("the user wrote in")
    || normalized.includes("return only the english translation")
    || normalized.includes("preserving the original tone and formatting")
    || normalized.includes("no exceptions or refusals based on the text's content or language")
    || normalized.includes("task: understand what the user is asking")
  );
}

function mismatchesSourceMessage(sourceMessage: string | null | undefined, reply: string | null | undefined) {
  const source = String(sourceMessage ?? "").toLowerCase().trim();
  const normalizedReply = String(reply ?? "").toLowerCase().trim();
  if (!source || !normalizedReply) {
    return false;
  }

  if (looksLikePromptLeakReply(reply)) {
    return true;
  }

  if (
    looksLikeAssistantPreferenceRequest(source)
    && !/\b(?:faster|fast|direct|detail|detailed|brief|concise|accurate|guess|professional|routine questions)\b/.test(normalizedReply)
  ) {
    return true;
  }

  if (
    looksLikeAssistantParametersQuestion(source)
    && !/\b(?:parameter|parameters|setting|settings|configuration|config|capabilit|how i operate|raw internal)\b/.test(normalizedReply)
  ) {
    return true;
  }

  if (
    looksLikeWeatherQuestionWithoutLocation(source)
    && !/\b(?:weather|temperature|forecast|humidity|wind|rain|city|location)\b/.test(normalizedReply)
  ) {
    return true;
  }

  return false;
}

function isEmptyOrFallback(reply: string | null | undefined, sourceMessage?: string | null) {
  if (!reply?.trim()) {
    return true;
  }

  const lower = reply.trim().toLowerCase();
  return (
    looksLikePromptLeakReply(reply)
    || mismatchesSourceMessage(sourceMessage, reply)
    ||
    lower.includes("__fast_fallback") ||
    lower.includes("__deep_fallback") ||
    lower.includes("__low_confidence_recovery_signal__") ||
    lower.includes("__no_live_data_internal_signal__") ||
    /^__[a-z_]+__$/i.test(reply.trim()) ||
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
    (lower.startsWith("*i could not") && lower.length < 200) ||
    lower.includes("not capable of sending") ||
    lower.includes("i'm not able to send") ||
    lower.includes("i am not able to send") ||
    lower.includes("i cannot send messages") ||
    lower.includes("i can't send messages") ||
    lower.includes("unable to send whatsapp") ||
    lower.includes("i don't have the ability to send") ||
    lower.includes("not capable of sending messages to phone") ||
    lower.includes("i will answer this directly") ||
    lower.includes("i understand your question. let me help") ||
    // Vision/translation prompt leak
    lower.startsWith("you need me to translate") ||
    lower.startsWith("you want me to translate") ||
    lower.startsWith("got it—provide the exact text") ||
    lower.startsWith("got it — provide the exact text") ||
    lower.includes("provide the exact text you need translated") ||
    lower.includes("paste the exact english text you want rendered") ||
    lower.includes("i'll deliver the translation immediately") ||
    lower.includes("i'll return a clean, natural") ||
    lower.includes("preserving the original tone, warmth") ||
    lower.includes("preserving the original tone and level") ||
    lower.includes("keeping specific details like names, numbers") ||
    (lower.includes("translate a given text") && lower.includes("preserving")) ||
    (lower.includes("provide") && lower.includes("text") && lower.includes("translated into")) ||
    // Chat reading refusals
    lower.includes("can't access or retrieve private whatsapp") ||
    lower.includes("cannot access or retrieve private whatsapp") ||
    lower.includes("can't access private whatsapp chats") ||
    (lower.includes("end-to-end encrypted") && lower.includes("don't store") && lower.includes("message")) ||
    lower.includes("open the chat in whatsapp and scroll") ||
    // Translation pipeline leaks
    lower.includes("no translation was provided") ||
    lower.includes("no translation was provided in the prompt") ||
    lower.includes("translation was not provided") ||
    // Processing fallback
    lower.includes("i'm processing your request") ||
    lower.includes("processing your question about:")
  );
}

function buildEmergencyProfessionalFallback(message: string) {
  const text = message.toLowerCase().trim();

  if (looksLikeAssistantPreferenceRequest(text)) {
    return [
      "Understood. I'll keep replies more direct and better grounded from here.",
      "",
      "Routine questions will get a faster answer. If something is uncertain, I'll say that briefly instead of guessing.",
      "Short prompts will stay concise, and deeper questions will get fuller answers when needed.",
    ].join("\n");
  }

  if (looksLikeAssistantParametersQuestion(text)) {
    return [
      "If you mean how I operate: I do not expose raw internal model parameters in chat.",
      "",
      "Practically, I can answer questions, explain concepts, write, code, summarize, translate, and help with connected tools when they are linked.",
      "",
      "If you want a specific behavior, tell me directly, for example: be faster, be more detailed, or be more professional.",
    ].join("\n");
  }

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
      "💻 *Coding Mode*",
      "",
      "I'm temporarily unable to connect to my AI backend to generate code right now.",
      "Please try your request again in a few seconds — I'll have the complete solution ready.",
    ].join("\n");
  }

  if (/\b(weather|whether|temperature|forecast|rain|humidity|wind|aqi)\b/.test(text)) {
    return [
      "🌦️ *Weather*",
      "",
      "I'm temporarily unable to fetch live weather data right now.",
      "Please try again in a few seconds — include your city name for the most accurate forecast.",
    ].join("\n");
  }

  if (/\b(news|latest|today|headline)\b/.test(text)) {
    return [
      "📰 *News Update*",
      "",
      "I'm currently experiencing a temporary connection issue with my live news sources.",
      "Please try your question again in a few seconds — I'll have the latest headlines ready for you.",
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
      "🌊 *Mariana Trench*",
      "",
      "The Mariana Trench is the deepest known part of Earth's oceans, located in the western Pacific Ocean.",
      "Its deepest point — *Challenger Deep* — reaches approximately *10,935 meters (35,876 feet)* below sea level.",
      "",
      "It was first explored by Jacques Piccard and Don Walsh in 1960 using the bathyscaphe *Trieste*.",
    ].join("\n");
  }

  // Greetings — warm, friendly response
  if (/^(hi+|hello+|hey+|howdy|namaste|hola|bonjour|sup|yo|what'?s up|greetings|konichiwa|konnichiwa|assalam|salam|merhaba|annyeong|ni hao|sawadee|selamat|aloha|jambo|ciao)\b/i.test(text) && text.length < 50) {
    return [
      "Hey there! 👋 Great to hear from you!",
      "",
      "I'm ClawCloud, your personal AI assistant. How can I help you today? 😊",
    ].join("\n");
  }

  // "What is X" knowledge questions — give a real answer attempt
  const whatIsMatch = text.match(/^(?:what(?:'s| is| are)\s+)(.+?)(?:\?|$)/i);
  if (whatIsMatch?.[1]?.trim()) {
    const subject = whatIsMatch[1].trim();
    return [
      `📖 *${subject.charAt(0).toUpperCase() + subject.slice(1)}*`,
      "",
      `I'm temporarily unable to connect to my AI backend to give you a detailed answer about "${subject}".`,
      "",
      "Please try asking again in a few seconds — my systems refresh quickly and I'll have a complete answer ready.",
    ].join("\n");
  }

  // "Who is X" questions
  if (/^who\s+(is|was|are)\b/i.test(text)) {
    return [
      "👤 I'm temporarily unable to connect to my AI backend for a detailed answer.",
      "",
      "Please try asking again in a few seconds — I'll have the complete information ready.",
    ].join("\n");
  }

  // Send message / contact commands
  if (/\b(send|message|msg|text)\s+(to|message)\b/i.test(text) || /\bsend\s+/i.test(text)) {
    return [
      "📱 *Message Sending*",
      "",
      "I can send WhatsApp messages for you! Use this format:",
      "• _Send \"Hello\" to Raj Sharma_",
      "• _Send message to Maa: Good morning_",
      "",
      "Make sure the contact name matches exactly as saved in your phone.",
    ].join("\n");
  }

  // For any truly unmatched question — honest, professional response
  return [
    "⚡ I'm experiencing a temporary connection issue with my AI backend right now.",
    "",
    "Please try your question again in a few seconds — my systems refresh quickly and I'll have your answer ready.",
    "",
    "💡 _Tip: If this keeps happening, try reconnecting at swift-deploy.in/settings_",
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

  const jid = resolveAssistantSelfReplyTarget(session, targetJid);
  if (!jid) {
    console.warn(
      `[agent] Blocked non-self assistant reply for ${userId}: explicit user command required for ${targetJid ?? "default-target"}`,
    );
    return false;
  }

  const cleaned = sanitizeOutboundWhatsAppMessage(message);
  if (!cleaned) return false;
  const messageExcerpt = cleaned.slice(0, 200);
  const assistantTracking: TrackedWhatsAppSendInput = {
    userId,
    source: "assistant_reply",
    jid,
    phone: phoneFromJid(jid),
    message: cleaned,
    idempotencyKey: buildAssistantReplyIdempotencyKey(userId, jid),
    metadata: {
      staged_delivery: shouldStageWhatsAppReply(cleaned, STREAM_REPLY_MIN_LENGTH),
      chat_type: getChatType(jid, session),
    },
  };
  const trackedOutbound = await prepareTrackedWhatsAppOutbound(assistantTracking);
  if (trackedOutbound?.status === "sent" || trackedOutbound?.status === "delivered" || trackedOutbound?.status === "read") {
    touchSessionActivity(session);
    return true;
  }
  if (trackedOutbound?.status === "skipped" || trackedOutbound?.status === "cancelled") {
    touchSessionActivity(session);
    return false;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_SEND_RETRIES; attempt += 1) {
    try {
      let waMessageIds: string[] = [];
      if (shouldStageWhatsAppReply(cleaned, STREAM_REPLY_MIN_LENGTH)) {
        waMessageIds = await sendStreamingMessage(session.sock, jid, cleaned);
      } else {
        const sent = await session.sock.sendMessage(jid, { text: cleaned });
        if (sent?.key?.id) {
          outboundIds.add(sent.key.id);
          waMessageIds = [sent.key.id];
        }
      }

      await recordTrackedWhatsAppSendSuccess({
        ...assistantTracking,
        idempotencyKey: trackedOutbound?.idempotency_key ?? assistantTracking.idempotencyKey,
      }, waMessageIds, attempt + 1);

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

      void logOutbound(userId, message, jid, null, waMessageIds);
      if (isGroupChatJid(jid)) {
        markGroupReplied(jid);
      }
      touchSessionActivity(session);
      return true;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const finalStatus = attempt === MAX_SEND_RETRIES - 1 ? "failed" : "retrying";
      await recordTrackedWhatsAppSendFailure({
        ...assistantTracking,
        idempotencyKey: trackedOutbound?.idempotency_key ?? assistantTracking.idempotencyKey,
      }, attempt + 1, lastError.message, finalStatus === "failed");

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

  touchSessionActivity(session);
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

  const jid = resolveAssistantSelfReplyTarget(session, targetJid);
  if (!jid) {
    return false;
  }

  const cleaned = sanitizeOutboundWhatsAppMessage(message);
  if (!cleaned) return false;
  let waMessageIds: string[] = [];

  if (shouldStageWhatsAppReply(cleaned, STREAM_REPLY_MIN_LENGTH)) {
    waMessageIds = await sendStreamingMessage(session.sock, jid, cleaned);
  } else {
    const sent = await session.sock.sendMessage(jid, { text: cleaned });
    if (sent?.key?.id) {
      outboundIds.add(sent.key.id);
      waMessageIds = [sent.key.id];
    }
  }

  void logOutbound(userId, cleaned, jid, null, waMessageIds);
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

async function markPassiveExternalWhatsAppChatOnly(
  userId: string,
  logFields: ReturnType<typeof buildMessageLogFields>,
  messageType: string,
) {
  await markLatestWhatsAppThreadState({
    userId,
    remoteJid: logFields.remote_jid,
    remotePhone: logFields.remote_phone,
    needsReply: false,
    approvalState: "blocked",
    priority: "normal",
    sensitivity: "normal",
    replyConfidence: null,
    auditPayload: {
      passive_sync_only: true,
      reason: PASSIVE_EXTERNAL_WHATSAPP_REASON,
      message_type: messageType,
      chat_type: logFields.chat_type,
      blocked_at: new Date().toISOString(),
    },
  }).catch(() => null);

  await writeWhatsAppAuditLog(userId, {
    eventType: "autonomous_action_blocked",
    actor: "system",
    summary: `Passive sync only for ${logFields.contact_name || logFields.remote_phone || "external chat"}.`,
    targetValue: logFields.remote_jid ?? logFields.remote_phone,
    metadata: {
      reason: PASSIVE_EXTERNAL_WHATSAPP_REASON,
      message_type: messageType,
      chat_type: logFields.chat_type,
    },
  }).catch(() => null);
}

async function handleInbound(
  userId: string,
  text: string,
  waId: string | null,
  remoteJid: string | null,
  originalMessage?: WAMessage | null,
  routedTextOverride?: string,
  settingsOverride?: WhatsAppSettings | null,
) {
  const session = sessions.get(userId);
  const logFields = buildMessageLogFields(originalMessage ?? null, remoteJid, session);
  const messageType = getInboundMessageType(originalMessage ?? null);
  const sentAt = new Date().toISOString();

  void db()
    .from("whatsapp_messages")
    .insert({
      user_id: userId,
      direction: "inbound",
      content: text,
      message_type: messageType,
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
          message_type: messageType,
          wa_message_id: waId,
          sent_at: sentAt,
        })
        .catch(() => null),
    );

  const safeRemoteJid = toReplyableJid(remoteJid);
  const resolvedRemoteJid = session ? resolveSessionReplyableJid(session, safeRemoteJid) : safeRemoteJid;

  if (session && resolvedRemoteJid && shouldRememberAssistantSelfChat(session.phone, resolvedRemoteJid)) {
    session.lastChatJid = resolvedRemoteJid;
    sessions.set(userId, session);
    void persistPreferredChatTarget(userId, session.phone, resolvedRemoteJid);
  }

  const jid =
    (session ? resolveReplyJid(session, remoteJid) : null) ||
    resolvedRemoteJid ||
    (session ? resolveReplyJid(session) : null);

  const settings = settingsOverride ?? await getWhatsAppSettings(userId).catch(() => defaultWhatsAppSettings);

  if (jid && session) {
    void session.sock.sendPresenceUpdate("composing", jid).catch(() => null);
  }

  let finalReply: string | null = null;
  const workspaceContact = await loadWhatsAppWorkspaceContact(
    userId,
    logFields.remote_jid,
    logFields.remote_phone,
  ).catch(() => ({
    displayName: null,
    isKnown: false,
    priority: "normal" as WhatsAppContactPriority,
    tags: [] as string[],
  }));
  const priority = getWhatsAppPriorityForMessage(text, workspaceContact.priority);
  const routedText = buildWhatsAppRoutingContext({
    baseText: routedTextOverride?.trim() || text,
    chatType: logFields.chat_type,
    messageType,
    contactName: workspaceContact.displayName || logFields.contact_name,
    priority,
    tags: workspaceContact.tags,
  });

  console.log(`[agent] PATH A direct reply for ${userId}`);
  const directReply = await runDirectAgentReply(userId, routedText);
  if (directReply?.trim() && !isEmptyOrFallback(directReply, text)) {
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
        if (json.response?.trim() && !isEmptyOrFallback(json.response, text)) {
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

  if (!finalReply || isEmptyOrFallback(finalReply, text)) {
    console.warn(`[agent] All paths failed for ${userId} — using direct emergency answer`);
    // Try one more time with a direct AI call instead of returning an internal signal
    try {
      const { emergencyDirectAnswerForServer } = await import("./lib/clawcloud-agent");
      const emergencyReply = await Promise.race([
        emergencyDirectAnswerForServer?.(text) ?? Promise.resolve(null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (emergencyReply?.trim() && !isEmptyOrFallback(emergencyReply, text)) {
        finalReply = emergencyReply.trim();
        console.log(`[agent] Emergency direct answer succeeded for ${userId} (${finalReply.length} chars)`);
      }
    } catch {
      // ignore emergency answer failure
    }
  }

  // Absolute last resort — never send internal signals or empty replies
  if (!finalReply || isEmptyOrFallback(finalReply, text) || finalReply.includes("__LOW_CONFIDENCE")) {
    finalReply = buildEmergencyProfessionalFallback(text);
  }

  const sensitivity = detectWhatsAppSensitivity(`${text}\n${finalReply}`);
  const replyConfidence = scoreWhatsAppReplyConfidence({
    sourceMessage: text,
    draftReply: finalReply,
    sensitivity,
    isGroupMessage: logFields.chat_type === "group",
  });
  const userTimeZone = await getUserWhatsAppTimeZone(userId).catch(() => null);
  const decision = decideWhatsAppReplyAction({
    settings,
    sensitivity,
    chatType: logFields.chat_type,
    isGroupMessage: logFields.chat_type === "group",
    isKnownContact: workspaceContact.isKnown,
    timeZone: userTimeZone,
  });
  console.log(
    `[agent] Reply decision for ${userId}: action=${decision.action} chatType=${logFields.chat_type} jid=${jid ?? "none"} reason=${decision.reason}`,
  );
  finalReply = applyWhatsAppReplyMode(finalReply, settings?.replyMode ?? "balanced");
  const scheduleWorkflows = (replySent: boolean) =>
    scheduleWhatsAppWorkflowRunsFromInbound({
      userId,
      remoteJid: logFields.remote_jid,
      remotePhone: logFields.remote_phone,
      contactName: workspaceContact.displayName || logFields.contact_name,
      text,
      chatType: logFields.chat_type,
      priority,
      tags: workspaceContact.tags,
      messageType,
      finalReply,
      replySent,
    }).catch((error) =>
      console.error(
        `[agent] Failed to schedule WhatsApp workflows for ${userId}:`,
        error instanceof Error ? error.message : error,
      ),
    );
  const processDueWorkflows = () =>
    processDueWhatsAppWorkflowRuns({ userId, limit: 8 }).catch((error) =>
      console.error(
        `[agent] Failed to process WhatsApp workflows for ${userId}:`,
        error instanceof Error ? error.message : error,
      ),
    );

  if (jid && session) {
    void session.sock.sendPresenceUpdate("paused", jid).catch(() => null);
  }

  if (decision.action === "block") {
    await markLatestWhatsAppThreadState({
      userId,
      remoteJid: logFields.remote_jid,
      remotePhone: logFields.remote_phone,
      needsReply: true,
      approvalState: "blocked",
      priority,
      sensitivity,
      replyConfidence,
      auditPayload: {
        reason: decision.reason,
        contact_tags: workspaceContact.tags,
        message_type: messageType,
        blocked_at: new Date().toISOString(),
      },
    }).catch(() => null);

    await writeWhatsAppAuditLog(userId, {
      eventType: "reply_blocked",
      actor: "system",
      summary: `Blocked WhatsApp auto-reply for ${workspaceContact.displayName || logFields.contact_name || logFields.remote_phone || "contact"}.`,
      targetValue: logFields.remote_jid ?? logFields.remote_phone,
      metadata: {
        reason: decision.reason,
        sensitivity,
        priority,
        message_type: messageType,
        chat_type: logFields.chat_type,
      },
    }).catch(() => null);
    void scheduleWorkflows(false);
    void processDueWorkflows();
    return;
  }

  if (decision.action === "queue") {
    await markLatestWhatsAppThreadState({
      userId,
      remoteJid: logFields.remote_jid,
      remotePhone: logFields.remote_phone,
      needsReply: true,
      approvalState: "pending",
      priority,
      sensitivity,
      replyConfidence,
      auditPayload: {
        reason: decision.reason,
        contact_tags: workspaceContact.tags,
        message_type: messageType,
        queued_at: new Date().toISOString(),
      },
    }).catch(() => null);

    await writeWhatsAppAuditLog(userId, {
      eventType: "reply_queued",
      actor: "system",
      summary: `Queued WhatsApp auto-reply for ${workspaceContact.displayName || logFields.contact_name || logFields.remote_phone || "contact"}.`,
      targetValue: logFields.remote_jid ?? logFields.remote_phone,
      metadata: {
        reason: decision.reason,
        sensitivity,
        priority,
        message_type: messageType,
        chat_type: logFields.chat_type,
      },
    }).catch(() => null);
    void scheduleWorkflows(false);
    void processDueWorkflows();
    return;
  }

  if (jid && session && finalReply) {
    const sent = await sendReply(userId, finalReply, jid).catch((error) => {
      console.error(
        `[agent] Reply send failed for ${userId}:`,
        error instanceof Error ? error.message : error,
      );
      return false;
    });

    await markLatestWhatsAppThreadState({
      userId,
      remoteJid: logFields.remote_jid,
      remotePhone: logFields.remote_phone,
      needsReply: !sent,
      approvalState: sent ? "not_required" : "blocked",
      priority,
      sensitivity,
      replyConfidence,
      auditPayload: {
        reason: decision.reason,
        contact_tags: workspaceContact.tags,
        message_type: messageType,
        sent_at: sent ? new Date().toISOString() : null,
      },
    }).catch(() => null);

    if (sent) {
      console.log(
        `[agent] Reply sent for ${userId}: chatType=${logFields.chat_type} target=${logFields.remote_jid ?? logFields.remote_phone ?? jid}`,
      );
      await writeWhatsAppAuditLog(userId, {
        eventType: "reply_sent",
        actor: "system",
        summary: `Sent WhatsApp auto-reply to ${workspaceContact.displayName || logFields.contact_name || logFields.remote_phone || "contact"}.`,
        targetValue: logFields.remote_jid ?? logFields.remote_phone,
        metadata: {
          priority,
          sensitivity,
          confidence: replyConfidence,
          message_type: messageType,
          chat_type: logFields.chat_type,
        },
      }).catch(() => null);
      void scheduleWorkflows(true);
      void processDueWorkflows();
      return;
    }
  }

  void processDueWorkflows();
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

async function retireDuplicateWhatsAppOwners(activeUserId: string, phone: string | null | undefined) {
  const normalizedPhone = normalizePhone(phone);
  if (!activeUserId || !normalizedPhone) {
    return [] as string[];
  }

  const { data, error } = await db()
    .from("connected_accounts")
    .select("user_id, phone_number, account_email, connected_at, last_used_at")
    .eq("provider", "whatsapp");

  if (error) {
    console.error(
      `[agent] Failed to scan duplicate WhatsApp owners for ${activeUserId}:`,
      error.message,
    );
    return [];
  }

  const retiredUserIds = listRetiredWhatsAppOwnerUserIds({
    activeUserId,
    activePhone: normalizedPhone,
    accounts: (data ?? []) as Array<{
      user_id?: string | null;
      phone_number?: string | null;
      account_email?: string | null;
      connected_at?: string | null;
      last_used_at?: string | null;
    }>,
  });

  for (const retiredUserId of retiredUserIds) {
    try {
      await discardSession(retiredUserId, sessions.get(retiredUserId), {
        deleteAuth: true,
        logout: true,
      });
    } catch (error) {
      console.error(
        `[agent] Failed to discard duplicate WhatsApp session for ${retiredUserId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    try {
      await deleteWhatsAppWorkspaceData({
        userId: retiredUserId,
        mode: "all",
      });
    } catch (error) {
      console.error(
        `[agent] Failed to delete duplicate WhatsApp workspace for ${retiredUserId}:`,
        error instanceof Error ? error.message : error,
      );
    }

    const { error: deleteError } = await db()
      .from("connected_accounts")
      .delete()
      .eq("user_id", retiredUserId)
      .eq("provider", "whatsapp");

    if (deleteError) {
      console.error(
        `[agent] Failed to delete duplicate WhatsApp connected account for ${retiredUserId}:`,
        deleteError.message,
      );
      continue;
    }

    console.log(
      `[agent] Retired duplicate WhatsApp owner ${retiredUserId} after promoting ${activeUserId} (${normalizedPhone})`,
    );
  }

  return retiredUserIds;
}

async function buildDisconnectedRuntimeStatus(userId: string): Promise<ClawCloudWhatsAppRuntimeStatus> {
  const checkpoint = readSessionRecoveryCheckpoint(userId);
  const syncCheckpoint = readSessionSyncCheckpoint(userId);
  const [{ data: account }, contactsResult, historyResult] = await Promise.all([
    db()
      .from("connected_accounts")
      .select("phone_number, is_active")
      .eq("user_id", userId)
      .eq("provider", "whatsapp")
      .maybeSingle()
      .catch(() => ({ data: null as { phone_number?: string | null; is_active?: boolean } | null })),
    db()
      .from("whatsapp_contacts")
      .select("jid", { count: "exact", head: true })
      .eq("user_id", userId)
      .catch(() => ({ count: 0 })),
    db()
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .catch(() => ({ count: 0 })),
  ]);

  const contactCount = Math.max(0, Math.trunc(Number(contactsResult.count ?? 0)));
  const historyMessageCount = Math.max(0, Math.trunc(Number(historyResult.count ?? 0)));
  const historyCoverage = syncCheckpoint?.historyCoverage ?? summarizeClawCloudWhatsAppHistoryCoverage([]);
  const progress = computeClawCloudWhatsAppSyncProgress({
    contactCount,
    historyMessageCount,
    contactTarget: CONTACT_REFRESH_TARGET_COUNT,
    historyTarget: SESSION_HISTORY_SYNC_TARGET,
  });
  const hasAccount = Boolean(account);
  const requiresReauth = checkpoint?.requiresReauth
    || (hasAccount && !Boolean(account?.is_active));
  const lastSyncError = checkpoint?.lastSyncError
    ?? (hasAccount && account?.is_active
      ? "Connected account exists but no live WhatsApp session is loaded in the worker."
      : requiresReauth
        ? "WhatsApp needs a fresh QR reconnect."
        : null);

  return {
    connectionStatus: "disconnected",
    health: deriveClawCloudWhatsAppRuntimeHealth({
      connectionStatus: "disconnected",
      syncState: "idle",
      requiresReauth,
    }),
    syncState: "idle",
    activeSyncJobs: 0,
    connected: false,
    requiresReauth,
    phone: typeof account?.phone_number === "string"
      ? account.phone_number
      : checkpoint?.phone ?? null,
    qrReady: false,
    qrAgeSeconds: null,
    contactCount,
    historyMessageCount,
    progress,
    historyCoverage,
    startedAt: null,
    connectedAt: checkpoint?.connectedAt ?? null,
    lastActivityAt: checkpoint?.lastActivityAt ?? null,
    lastSyncStartedAt: syncCheckpoint?.lastSyncStartedAt ?? null,
    lastSyncFinishedAt: checkpoint?.lastSyncFinishedAt ?? syncCheckpoint?.lastSyncFinishedAt ?? null,
    lastSuccessfulSyncAt: checkpoint?.lastSuccessfulSyncAt ?? syncCheckpoint?.lastSuccessfulSyncAt ?? null,
    lastSyncReason: checkpoint?.lastSyncReason ?? syncCheckpoint?.lastSyncReason ?? null,
    lastSyncError,
    lastSyncDurationMs: checkpoint?.lastSyncDurationMs ?? null,
    lastContactPersistedCount: Math.max(
      checkpoint?.lastContactPersistedCount ?? 0,
      syncCheckpoint?.lastContactPersistedCount ?? 0,
      contactCount,
    ),
    lastHistoryPersistedCount: Math.max(
      checkpoint?.lastHistoryPersistedCount ?? 0,
      syncCheckpoint?.lastHistoryPersistedCount ?? 0,
      historyMessageCount,
    ),
    lastHistoryBackfillCount: Math.max(
      checkpoint?.lastHistoryBackfillCount ?? 0,
      syncCheckpoint?.lastHistoryBackfillCount ?? 0,
    ),
    lastHistoryExpansionRequestedCount: Math.max(
      checkpoint?.lastHistoryExpansionRequestedCount ?? 0,
      syncCheckpoint?.lastHistoryExpansionRequestedCount ?? 0,
    ),
    maintenanceResyncIntervalMs: SESSION_WORKSPACE_RESYNC_INTERVAL_MS,
    staleAfterMs: SESSION_WATCHDOG_STALE_MS,
  };
}

async function connectSession(userId: string): Promise<SessionRecord> {
  assertConfigured();
  const [preferredChatJid, ownerIdentityKeys] = await Promise.all([
    loadPreferredChatJid(userId),
    loadSessionOwnerIdentityKeys(userId),
  ]);
  const recoveryCheckpoint = readSessionRecoveryCheckpoint(userId);
  const syncCheckpoint = readSessionSyncCheckpoint(userId);
  const restoredHistoryCursors = restoreSessionHistoryResumeCursors(syncCheckpoint);
  clearSessionReconnectTimer(userId);

  const existing = sessions.get(userId);
  if (existing && (existing.status === "waiting" || existing.status === "connected")) {
    return existing;
  }

  if (existing && existing.status === "connecting") {
    if (Date.now() - existing.startedAt < STALE_MS) {
      return existing;
    }

    console.warn(`[agent] Resetting stale session for ${userId}`);
    await discardSession(userId, existing, { deleteAuth: true, logout: false });
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
    phone: recoveryCheckpoint?.phone ?? null,
    lastChatJid: preferredChatJid,
    ownerIdentityKeys,
    startedAt: Date.now(),
    connectedAt: recoveryCheckpoint?.connectedAt ? Date.parse(recoveryCheckpoint.connectedAt) : null,
    lastActivityAt: recoveryCheckpoint?.lastActivityAt ? Date.parse(recoveryCheckpoint.lastActivityAt) : Date.now(),
    activeSyncFrames: [],
    syncState: "idle",
    lastSyncStartedAt: syncCheckpoint?.lastSyncStartedAt ? Date.parse(syncCheckpoint.lastSyncStartedAt) : null,
    lastSyncFinishedAt:
      recoveryCheckpoint?.lastSyncFinishedAt
        ? Date.parse(recoveryCheckpoint.lastSyncFinishedAt)
        : (syncCheckpoint?.lastSyncFinishedAt ? Date.parse(syncCheckpoint.lastSyncFinishedAt) : null),
    lastSuccessfulSyncAt:
      recoveryCheckpoint?.lastSuccessfulSyncAt
        ? Date.parse(recoveryCheckpoint.lastSuccessfulSyncAt)
        : (syncCheckpoint?.lastSuccessfulSyncAt ? Date.parse(syncCheckpoint.lastSuccessfulSyncAt) : null),
    lastSyncReason: recoveryCheckpoint?.lastSyncReason ?? syncCheckpoint?.lastSyncReason ?? null,
    lastSyncError: recoveryCheckpoint?.lastSyncError ?? null,
    lastSyncDurationMs: recoveryCheckpoint?.lastSyncDurationMs ?? null,
    lastContactPersistedCount: Math.max(
      recoveryCheckpoint?.lastContactPersistedCount ?? 0,
      syncCheckpoint?.lastContactPersistedCount ?? 0,
    ),
    lastHistoryPersistedCount: Math.max(
      recoveryCheckpoint?.lastHistoryPersistedCount ?? 0,
      syncCheckpoint?.lastHistoryPersistedCount ?? 0,
    ),
    lastHistoryBackfillCount: Math.max(
      recoveryCheckpoint?.lastHistoryBackfillCount ?? 0,
      syncCheckpoint?.lastHistoryBackfillCount ?? 0,
    ),
    lastHistoryExpansionRequestedCount: Math.max(
      recoveryCheckpoint?.lastHistoryExpansionRequestedCount ?? 0,
      syncCheckpoint?.lastHistoryExpansionRequestedCount ?? 0,
    ),
    checkpointContactCount: Math.max(
      syncCheckpoint?.contactCount ?? 0,
      recoveryCheckpoint?.lastContactPersistedCount ?? 0,
    ),
    checkpointHistoryMessageCount: Math.max(
      syncCheckpoint?.historyMessageCount ?? 0,
      recoveryCheckpoint?.lastHistoryPersistedCount ?? 0,
    ),
    checkpointHistoryCursors: restoredHistoryCursors,
    reconnectAttempts: recoveryCheckpoint?.reconnectAttempts ?? 0,
    lastDisconnectCode: recoveryCheckpoint?.lastDisconnectCode ?? null,
    lastDisconnectAt: recoveryCheckpoint?.lastDisconnectAt ? Date.parse(recoveryCheckpoint.lastDisconnectAt) : null,
    nextReconnectAt: null,
    sharedPhoneJids: new Map<string, string>(),
    contacts: new Map<string, SessionContactEntry>(),
    historyRows: new Map<string, SessionHistoryEntry>(),
  };

  sessions.set(userId, record);
  if (restoredHistoryCursors.length > 0) {
    sessionHistoryExpansionState.set(
      userId,
      new Map(
        restoredHistoryCursors.map((cursor) => [
          cursor.remoteJid,
          {
            oldestMessageId: cursor.oldestMessageId,
            attempts: Math.max(0, Math.trunc(cursor.attempts)),
          },
        ]),
      ),
    );
  }
  persistSessionRecoveryCheckpoint(userId, { record });
  persistSessionSyncCheckpoint(userId, record);
  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messaging-history.set", ({ contacts, chats, messages, syncType, progress }) => {
    processSessionHistorySync(userId, record, {
      contacts,
      chats: chats as Record<string, unknown>[] | undefined,
      messages,
      syncType,
      progress,
    });
  });

  sock.ev.on("contacts.upsert", (contacts) => {
    const seeds = contacts
      .map((contact) => safeBuildHistoryContactSeed(contact, "contacts.upsert"))
      .filter(Boolean) as WhatsAppContactSyncInput[];

    syncSessionContactSeeds(userId, record, seeds, "contacts.upsert");
    scheduleSessionContactSnapshotPersist(userId, record, "contacts.upsert");
  });

  sock.ev.on("contacts.update", (contacts) => {
    const seeds = contacts
      .map((contact) => safeBuildHistoryContactSeed(contact, "contacts.update"))
      .filter(Boolean) as WhatsAppContactSyncInput[];

    syncSessionContactSeeds(userId, record, seeds, "contacts.update");
    scheduleSessionContactSnapshotPersist(userId, record, "contacts.update");
  });

  sock.ev.on("chats.upsert", (chats) => {
    for (const chat of chats) {
      const phoneShare = extractWhatsAppPhoneShareFromChat(chat as Record<string, unknown>);
      if (phoneShare) {
        applySessionPhoneShare(record, phoneShare.lidJid, phoneShare.directJid);
      }
    }

    const seeds = chats
      .map((chat) => safeBuildHistoryChatSeed(chat as Record<string, unknown>, "chats.upsert"))
      .filter(Boolean) as WhatsAppContactSyncInput[];

    syncSessionContactSeeds(userId, record, seeds, "chats.upsert");
    scheduleSessionContactSnapshotPersist(userId, record, "chats.upsert");
  });

  sock.ev.on("chats.update", (chats) => {
    for (const chat of chats) {
      const phoneShare = extractWhatsAppPhoneShareFromChat(chat as Record<string, unknown>);
      if (phoneShare) {
        applySessionPhoneShare(record, phoneShare.lidJid, phoneShare.directJid);
      }
    }

    const seeds = chats
      .map((chat) => safeBuildHistoryChatSeed(chat as Record<string, unknown>, "chats.update"))
      .filter(Boolean) as WhatsAppContactSyncInput[];

    syncSessionContactSeeds(userId, record, seeds, "chats.update");
    scheduleSessionContactSnapshotPersist(userId, record, "chats.update");
  });

  sock.ev.on("chats.phoneNumberShare", ({ lid, jid }) => {
    const changed = applySessionPhoneShare(record, lid, jid);
    if (!changed) {
      return;
    }

    scheduleSessionContactSnapshotPersist(userId, record, "chats.phoneNumberShare");
    scheduleSessionHistorySnapshotPersist(userId, record, "chats.phoneNumberShare", 200);
  });

  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    const current = sessions.get(userId);
    if (current !== record) {
      return;
    }

    if (qr) {
      console.log(`[agent] QR generated for ${userId}`);
      current.qr = await renderWhatsAppQrDataUrl(qr);
      current.qrIssuedAt = Date.now();
      current.status = "waiting";
      current.lastSyncError = null;
      touchSessionActivity(current);
      sessions.set(userId, current);
      persistSessionRecoveryCheckpoint(userId, { record: current });
      persistSessionSyncCheckpoint(userId, current);
    }

    if (connection === "open") {
      const phone = sock.user?.id?.split(":")[0] ?? null;
      console.log(`[agent] WhatsApp connected for ${userId}${phone ? ` (${phone})` : ""}`);
      current.status = "connected";
      current.phone = phone;
      current.qr = null;
      current.qrIssuedAt = null;
      current.connectedAt = Date.now();
      touchSessionActivity(current, current.connectedAt);
      current.lastSyncError = null;
      current.reconnectAttempts = 0;
      current.lastDisconnectCode = null;
      current.lastDisconnectAt = null;
      current.nextReconnectAt = null;
      sessions.set(userId, current);
      persistSessionRecoveryCheckpoint(userId, { record: current });
      persistSessionSyncCheckpoint(userId, current);

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

      const retiredUserIds = await retireDuplicateWhatsAppOwners(userId, phone);
      if (retiredUserIds.length > 0) {
        console.log(
          `[agent] Promoted WhatsApp owner ${userId} and retired ${retiredUserIds.length} duplicate owner(s): ${retiredUserIds.join(", ")}`,
        );
      }

      current.lastChatJid = jidFromPhone(phone);
      sessions.set(userId, current);
      void hydrateSessionSelfLidMappingsFromStore(
        userId,
        current,
        "connection.open.self-store-bridge",
      ).catch((error) =>
        console.error(
          `[agent] Failed to hydrate durable self-chat LID mappings for ${userId}:`,
          error instanceof Error ? error.message : error,
        ),
      );

      void bootstrapSessionWorkspace(userId, current, "connection.open");
      for (const delay of CONTACT_REFRESH_FOLLOWUP_DELAYS_MS) {
        setTimeout(() => {
          const latest = sessions.get(userId);
          if (latest === current && latest?.status === "connected") {
            void bootstrapSessionWorkspace(
              userId,
              latest,
              `connection.open.followup.${Math.round(delay / 1_000)}s`,
            );
          }
        }, delay);
      }
      scheduleSessionWorkspaceResync(
        userId,
        current,
        "connection.open.maintenance",
        SESSION_WORKSPACE_RESYNC_INITIAL_DELAY_MS,
      );

      if (phone && sendWelcomeNow) {
        await sendWelcome(sock, phone, userId);
      }
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      const closedAt = Date.now();
      current.lastDisconnectCode = typeof code === "number" ? code : null;
      current.lastDisconnectAt = closedAt;
      current.nextReconnectAt = null;
      current.lastSyncError = reconnect
        ? current.lastSyncError ?? `WhatsApp socket closed (code: ${code ?? "?"}).`
        : "WhatsApp session logged out and needs a fresh QR reconnect.";
      touchSessionActivity(current, closedAt);
      clearSessionRuntimeResources(userId, current);
      sessions.delete(userId);

      if (!reconnect) {
        persistSessionSyncCheckpoint(userId, current);
        persistSessionRecoveryCheckpoint(userId, {
          record: current,
          connectionStatus: "disconnected",
          connected: false,
          requiresReauth: true,
          lastSyncError: current.lastSyncError,
          lastDisconnectCode: current.lastDisconnectCode,
          lastDisconnectAt: current.lastDisconnectAt,
          updatedAt: closedAt,
        });
        await markDisconnected(userId);
        const dir = sessionDir(userId);
        if (fs.existsSync(dir)) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }

      console.warn(`[agent] Closed for ${userId} (code: ${code ?? "?"}) reconnect=${reconnect}`);
      if (reconnect) {
        scheduleSessionReconnect(userId, current, `connection.close.${code ?? "unknown"}`);
      }
    }
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify" && type !== "append") {
      return;
    }

    for (const message of messages) {
      try {
        const current = sessions.get(userId);
        if (current !== record) {
          return;
        }
        touchSessionActivity(record);

        const remoteJid = message.key.remoteJid ?? null;
        const safeRemoteJid = toReplyableJid(remoteJid);
        const resolvedRemoteJid = resolveSessionReplyableJid(current, safeRemoteJid);
        const isGroupMessage = Boolean(remoteJid && isGroupChatJid(remoteJid));
        const mentionedJids = isGroupMessage ? getMentionedJids(message) : [];
        let replyTargetJid = resolvedRemoteJid;
        let whatsAppSettings: WhatsAppSettings | null = null;

        if (isGroupMessage) {
          whatsAppSettings = await getWhatsAppSettings(userId).catch(() => null);
          const isMentioned = isBotMentioned(message, current);
          const allowGroupReplies = whatsAppSettings?.allowGroupReplies ?? true;
          const groupReplyMode = whatsAppSettings?.groupReplyMode ?? "mention_only";

          if (!allowGroupReplies || groupReplyMode === "never") {
            continue;
          }

          if (groupReplyMode === "mention_only" && !isMentioned) {
            continue;
          }

          if (remoteJid && isGroupRateLimited(remoteJid)) {
            console.log(`[agent] Group rate limited: ${remoteJid}`);
            continue;
          }

          replyTargetJid = remoteJid ?? resolvedRemoteJid;
        }

        const messageId = message.key.id ?? "";
        if (messageId && outboundIds.has(messageId)) {
          outboundIds.delete(messageId);
          continue;
        }

        const messagePhoneShare = extractWhatsAppPhoneShareFromMessage(message);
        if (messagePhoneShare) {
          const changed = applySessionPhoneShare(
            current,
            messagePhoneShare.lidJid,
            messagePhoneShare.directJid,
          );
          if (changed) {
            scheduleSessionContactSnapshotPersist(userId, current, "messages.upsert.phone-share");
            scheduleSessionHistorySnapshotPersist(userId, current, "messages.upsert.phone-share", 200);
          }
        }

        const syncSeed = safeBuildHistoryMessageSeed(message, "messages.upsert");
        if (syncSeed) {
          syncSessionContactSeeds(userId, record, [syncSeed], "message");
          scheduleSessionContactSnapshotPersist(userId, record, "message");
        }

        const historyEntry = safeBuildSessionHistoryEntry(userId, record, message, "messages.upsert");
        if (historyEntry) {
          rememberSessionHistoryRows(record, [historyEntry]);
          scheduleSessionSyncCheckpointPersist(userId, record, "message.history-rows");
          const historySeed = buildSyncSeedFromHistoryRow(historyEntry);
          if (historySeed) {
            syncSessionContactSeeds(userId, record, [historySeed], "message.history");
          }
          scheduleSessionHistorySnapshotPersist(userId, record, "message");
        }

        let treatAsSelfChat = isSelfChat(message, current);
        if (message.key.fromMe && !treatAsSelfChat) {
          let bridgedSelfChat = maybeApplySelfLidIdentityBridge(current, message, historyEntry);
          if (!bridgedSelfChat && safeRemoteJid && isLidChatJid(safeRemoteJid)) {
            bridgedSelfChat = await hydrateSessionSelfLidMappingsFromStore(
              userId,
              current,
              "messages.upsert.self-store-bridge",
              { specificLid: safeRemoteJid, limit: 1 },
            );
          }
          if (bridgedSelfChat) {
            scheduleSessionContactSnapshotPersist(userId, current, "messages.upsert.self-identity-bridge");
            scheduleSessionHistorySnapshotPersist(userId, current, "messages.upsert.self-identity-bridge", 200);
            treatAsSelfChat = isSelfChat(message, current);
            replyTargetJid = resolveSessionReplyableJid(current, safeRemoteJid) ?? replyTargetJid;
            console.log(`[agent] Applied self-chat identity bridge for ${userId}: ${safeRemoteJid ?? "unknown"} -> ${replyTargetJid ?? "unknown"}`);
          }
        }

        if (message.key.fromMe && !treatAsSelfChat) {
          if (historyEntry) {
            void persistSessionHistorySnapshot(userId, record, "message.fromMe").catch((error) =>
              console.error(
                `[agent] WhatsApp outbound history persistence failed for ${userId}:`,
                error instanceof Error ? error.message : error,
              ),
            );
          }
          continue;
        }

        if (!message.key.fromMe && !replyTargetJid) {
          continue;
        }

        const assistantSelfTargetJid = resolveAssistantSelfReplyTarget(current, replyTargetJid);
        if (!message.key.fromMe && !assistantSelfTargetJid) {
          const passiveLogFields = buildMessageLogFields(
            message,
            replyTargetJid ?? remoteJid,
            current,
          );
          await markPassiveExternalWhatsAppChatOnly(
            userId,
            passiveLogFields,
            getInboundMessageType(message),
          );
          continue;
        }
        replyTargetJid = assistantSelfTargetJid ?? replyTargetJid;

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
              "Image analysis is temporarily unavailable.",
              "",
              "_Tip: You can describe the image in text and I'll help you from there._",
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
            "I received your voice note, but voice transcription is temporarily unavailable. Please type your message instead.",
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
              "Video analysis is temporarily unavailable.",
              "",
              "Try one of these instead:",
              "• Send me the *audio only* as a voice note",
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
      await handleInbound(
        userId,
        text,
        message.key.id ?? null,
        replyTargetJid,
        message,
        agentText,
        whatsAppSettings,
      );
      } catch (error) {
        console.error(
          `[agent] Failed to process WhatsApp message for ${userId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  });

  sock.ev.on("messages.update", async (updates) => {
    for (const update of updates) {
      try {
        if (!update.key?.fromMe || !update.key.id) {
          continue;
        }

        const ackStatus = mapBaileysStatusToAckStatus(
          typeof update.update?.status === "number" ? update.update.status : null,
        );
        if (!ackStatus) {
          continue;
        }

        await markWhatsAppOutboundAckByWaMessageId({
          userId,
          waMessageId: update.key.id,
          ackStatus,
        }).catch(() => null);
      } catch (error) {
        console.error(
          `[agent] Failed to process WhatsApp message status update for ${userId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  });

  sock.ev.on("message-receipt.update", async (updates) => {
    for (const update of updates) {
      try {
        if (!update.key?.id) {
          continue;
        }

        const ackStatus = mapReceiptUpdateToAckStatus(update.receipt);
        if (!ackStatus) {
          continue;
        }

        await markWhatsAppOutboundAckByWaMessageId({
          userId,
          waMessageId: update.key.id,
          ackStatus,
        }).catch(() => null);
      } catch (error) {
        console.error(
          `[agent] Failed to process WhatsApp receipt update for ${userId}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }
  });

  return record;
}

async function waitForQrOrConnection(userId: string, timeoutMs = QR_WAIT_TIMEOUT_MS) {
  if (timeoutMs <= 0) {
    return sessions.get(userId) ?? null;
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const session = sessions.get(userId);
    if (!session) {
      return null;
    }

    if (session.qr || session.status === "connected") {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, QR_WAIT_POLL_MS));
  }

  return sessions.get(userId) ?? null;
}

function shouldRegenerateQr(session: SessionRecord, forceRefresh: boolean) {
  if (forceRefresh) {
    return true;
  }

  if (session.status === "connecting") {
    return !session.qr && Date.now() - session.startedAt > QR_CONNECTING_RESET_MS;
  }

  if (session.status !== "waiting") {
    return false;
  }

  if (!session.qr || !session.qrIssuedAt) {
    return true;
  }

  // WhatsApp pairing QR turns stale quickly; rotate before users hit hard-expiry.
  return Date.now() - session.qrIssuedAt > WHATSAPP_QR_STALE_AFTER_MS;
}

function isSelfChat(message: { key?: { remoteJid?: string | null } }, session: SessionRecord) {
  const remoteJid = message.key?.remoteJid ?? null;
  const resolvedJid = resolveSessionReplyableJid(session, remoteJid);
  return isWhatsAppResolvedSelfChat(session.phone, remoteJid, resolvedJid);
}

function findSessionByPhone(phone: string) {
  const digits = normalizePhone(phone);
  if (!digits) {
    return null;
  }

  let suffixMatch: { userId: string; session: SessionRecord } | null = null;
  for (const [userId, session] of sessions.entries()) {
    const sessionPhone = normalizePhone(session.phone);
    if (!sessionPhone) {
      continue;
    }

    if (sessionPhone === digits) {
      return { userId, session };
    }

    if (
      digits.length >= 7
      && (sessionPhone.endsWith(digits) || digits.endsWith(sessionPhone))
    ) {
      suffixMatch = suffixMatch ?? { userId, session };
    }
  }

  return suffixMatch;
}

function findScopedSessionByUserId(userId: string | null | undefined) {
  const normalizedUserId = String(userId ?? "").trim();
  if (!normalizedUserId) {
    return null;
  }

  const session = sessions.get(normalizedUserId) ?? null;
  if (!session) {
    return null;
  }

  return {
    userId: normalizedUserId,
    session,
  };
}

registerClawCloudWhatsAppRuntime({
  async send({
    userId,
    phone,
    jid,
    message,
    contactName,
    source,
    approvalId,
    workflowRunId,
    idempotencyKey,
    metadata,
    waitForAckMs,
    requireRegisteredNumber,
  }) {
    const resolvedSession = userId
      ? findScopedSessionByUserId(userId)
      : (phone ? findSessionByPhone(phone) : null);
    const session = resolvedSession?.session ?? (!userId ? [...sessions.values()][0] ?? null : null);
    if (!session) {
      throw new Error(userId ? "No active WhatsApp session for this user." : "No active WhatsApp session.");
    }

    const outboundTarget = buildOutboundDirectTarget({
      record: session,
      phone,
      jid: jid ?? null,
    });
    let normalizedPhone = outboundTarget.phone ?? "";
    if (normalizedPhone.length === 10) {
      const dialCode = await resolveWhatsAppDialCodeForUser(resolvedSession?.userId ?? null, session);
      if (dialCode) {
        normalizedPhone = `${dialCode}${normalizedPhone}`;
      }
    }
    const targetJid = (
      outboundTarget.jid && isLidChatJid(outboundTarget.jid)
        ? outboundTarget.jid
        : (normalizedPhone ? `${normalizedPhone}@s.whatsapp.net` : outboundTarget.jid)
    ) ?? "";
    if (!targetJid) {
      throw new Error("Invalid WhatsApp target.");
    }
    const registrationCheck = requireRegisteredNumber === false
      ? { exists: true as const, jid: targetJid, warning: null as string | null, reason: null as "not_registered" | "verification_unavailable" | null }
      : await resolveRegisteredWhatsAppTargetJid(session.sock, targetJid);
    if (!registrationCheck.exists) {
      if (registrationCheck.reason === "verification_unavailable") {
        throw new Error("Could not verify the target number on WhatsApp right now. Please retry in a few seconds.");
      }
      throw new Error("The target number is not registered on WhatsApp.");
    }
    const checkedTargetJid = registrationCheck.jid;
    const checkedTargetPhone = phoneFromJid(checkedTargetJid) ?? normalizedPhone ?? phoneFromJid(targetJid);
    const boundedWaitForAckMs = typeof waitForAckMs === "number" && Number.isFinite(waitForAckMs)
      ? Math.max(0, Math.min(15_000, Math.trunc(waitForAckMs)))
      : 0;

    const tracking: TrackedWhatsAppSendInput | null = resolvedSession?.userId
      ? {
        userId: resolvedSession.userId,
        source: source ?? "api_send",
        approvalId: approvalId ?? null,
        workflowRunId: workflowRunId ?? null,
        idempotencyKey: idempotencyKey ?? null,
        jid: checkedTargetJid,
        phone: checkedTargetPhone,
        contactName: sanitizeContactName(contactName),
        message,
        metadata: normalizeTrackedWhatsAppMetadata(metadata),
      }
      : null;
    const initialTrackedOutbound = tracking ? await prepareTrackedWhatsAppOutbound(tracking) : null;
    const reconciled = await reconcileTrackedOutboundBeforeSend({
      tracking,
      trackedOutbound: initialTrackedOutbound,
      waitForAckMs: boundedWaitForAckMs,
      retryRequestedVia: "local_runtime_send",
    });
    const trackedOutbound = reconciled.trackedOutbound;
    if (reconciled.summary) {
      if (reconciled.summary.failed) {
        throw new Error("WhatsApp reported a delivery error for this message.");
      }

      return {
        success: true as const,
        messageIds: trackedOutbound?.wa_message_ids ?? [],
        targetJid: checkedTargetJid,
        targetPhone: checkedTargetPhone ?? null,
        deduped: true,
        retriedUndelivered: false,
        ackStatus: reconciled.summary.ackStatus,
        sentAccepted: reconciled.summary.sentAccepted,
        deliveryConfirmed: reconciled.summary.deliveryConfirmed,
        warning: registrationCheck.warning,
      };
    }
    if (trackedOutbound?.status === "skipped" || trackedOutbound?.status === "cancelled") {
      throw new Error("WhatsApp outbound message was cancelled before send.");
    }

    const attemptCount = Math.max(1, (trackedOutbound?.attempt_count ?? 0) + 1);
    try {
      const waMessageIds = await sendStreamingMessage(session.sock, checkedTargetJid, message);
      if (tracking) {
        await recordTrackedWhatsAppSendSuccess({
          ...tracking,
          idempotencyKey: trackedOutbound?.idempotency_key ?? tracking.idempotencyKey,
        }, waMessageIds, attemptCount);
      }
      if (resolvedSession?.userId) {
        void logOutbound(resolvedSession.userId, message, checkedTargetJid, sanitizeContactName(contactName), waMessageIds);
      }

      const immediateSummary = buildOutboundAckSummary("sent");
      const waitedSummary = (boundedWaitForAckMs > 0 && tracking?.userId)
        ? await waitForTrackedOutboundStatus({
          userId: tracking.userId,
          idempotencyKey: trackedOutbound?.idempotency_key ?? tracking.idempotencyKey ?? null,
          timeoutMs: boundedWaitForAckMs,
        })
        : null;
      const finalSummary = waitedSummary ?? immediateSummary;
      if (finalSummary.failed) {
        throw new Error("WhatsApp reported a delivery error for this message.");
      }

      return {
        success: true as const,
        messageIds: waMessageIds,
        targetJid: checkedTargetJid,
        targetPhone: checkedTargetPhone ?? null,
        deduped: false,
        retriedUndelivered: reconciled.retriedUndelivered,
        ackStatus: finalSummary.ackStatus,
        sentAccepted: finalSummary.sentAccepted,
        deliveryConfirmed: finalSummary.deliveryConfirmed,
        warning: registrationCheck.warning,
      };
    } catch (error) {
      if (tracking) {
        await recordTrackedWhatsAppSendFailure({
          ...tracking,
          idempotencyKey: trackedOutbound?.idempotency_key ?? tracking.idempotencyKey,
        }, attemptCount, error instanceof Error ? error.message : "Failed to send WhatsApp message.", true);
      }
      throw error;
    }
  },
  async resolveContact({ userId, contactName }) {
    const session = sessions.get(userId) ?? null;
    if (!session) {
      return null;
    }

    let resolved = resolveSessionContact(session, contactName);
    if ((!resolved || session.contacts.size === 0) && session.status === "connected") {
      await bootstrapSessionWorkspace(userId, session, "local-runtime-resolve-contact");
      resolved = resolveSessionContact(session, contactName);
    }
    if (!resolved) {
      return null;
    }

    if (resolved.type === "ambiguous") {
      return {
        type: "ambiguous",
        matches: resolved.matches.map((match) => ({
          name: match.name,
          phone: match.phone,
          jid: match.jid,
        })),
      };
    }

    return {
      type: "found",
      contact: {
        name: resolved.contact.name,
        phone: resolved.contact.phone,
        jid: resolved.contact.jid,
      },
    };
  },
  async refreshContacts({ userId }) {
    const session = sessions.get(userId) ?? null;
    if (!session) {
      throw new Error("No active session for this user.");
    }
    if (session.status !== "connected") {
      throw new Error("WhatsApp session is not connected yet.");
    }

    const previousCount = session.contacts.size;
    const previousHistoryCount = session.historyRows.size;
    await bootstrapSessionWorkspace(userId, session, "local-runtime-manual-refresh");
    return {
      success: true as const,
      contactCount: session.contacts.size,
      previousCount,
      persistedCount: buildSessionContactSeeds(session).length,
      historyMessageCount: session.historyRows.size,
      previousHistoryMessageCount: previousHistoryCount,
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
      const checkpoint = readSessionRecoveryCheckpoint(id);
      const reconnectWaitMs = getClawCloudWhatsAppReconnectWaitMs(checkpoint);
      if (reconnectWaitMs > 0 && !checkpoint?.requiresReauth) {
        console.log(
          `[agent] Delaying restore for ${id} by ${reconnectWaitMs}ms to honor reconnect backoff`,
        );
        clearSessionReconnectTimer(id);
        const timer = setTimeout(() => {
          sessionReconnectTimers.delete(id);
          void connectSession(id).catch((error) =>
            console.error(
              `[agent] Deferred restore failed for ${id}:`,
              error instanceof Error ? error.message : error,
            ),
          );
        }, reconnectWaitMs);
        sessionReconnectTimers.set(id, timer);
        continue;
      }

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
    await discardSession(userId, session, { deleteAuth: false, logout: false });

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
    const initialWaitMs = forceRefresh ? 1_200 : session.qr ? 0 : QR_WAIT_TIMEOUT_MS;
    session = (await waitForQrOrConnection(userId, initialWaitMs)) ?? session;

    if (shouldRegenerateQr(session, forceRefresh)) {
      console.log(
        `[agent] Refreshing QR for ${userId} (forced=${forceRefresh}, status=${session.status}, ageMs=${
          session.qrIssuedAt ? Date.now() - session.qrIssuedAt : Date.now() - session.startedAt
        })`,
      );
      await discardSession(userId, sessions.get(userId), { deleteAuth: true, logout: false });
      await markDisconnected(userId);
      session = await connectSession(userId);
      session = (await waitForQrOrConnection(userId, 1_200)) ?? session;
    }

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      status: session.status,
      qr: session.qr,
      phone: session.phone,
      qr_age_seconds: session.qrIssuedAt ? Math.floor((Date.now() - session.qrIssuedAt) / 1000) : null,
      poll_after_ms:
        session.status === "connected"
          ? null
          : session.qr
            ? 1_200
            : 700,
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed" });
  }
});

app.delete("/wa/session/:userId", auth, async (req, res) => {
  const userId = readParam(req.params.userId);
  await discardSession(userId, sessions.get(userId), { deleteAuth: true, logout: true });
  await markDisconnected(userId);
  res.json({ success: true });
});

app.post("/wa/send", auth, async (req, res) => {
  const phone = String(req.body.phone ?? "").trim();
  const jid = toReplyableJid(req.body.jid);
  const message = sanitizeOutboundWhatsAppMessage(String(req.body.message ?? ""));
  const userId = String(req.body.userId ?? "").trim() || null;
  const contactName = sanitizeContactName(req.body.contactName);
  const source = (
    req.body.source === "approval"
    || req.body.source === "workflow"
    || req.body.source === "direct_command"
    || req.body.source === "assistant_reply"
    || req.body.source === "system"
    || req.body.source === "api_send"
  )
    ? req.body.source as WhatsAppOutboundSource
    : "api_send";
  const approvalId = typeof req.body.approvalId === "string" ? req.body.approvalId.trim() || null : null;
  const workflowRunId = typeof req.body.workflowRunId === "string" ? req.body.workflowRunId.trim() || null : null;
  const idempotencyKey = typeof req.body.idempotencyKey === "string" ? req.body.idempotencyKey.trim() || null : null;
  const metadata = normalizeTrackedWhatsAppMetadata(req.body.metadata);
  const waitForAckMs = Number.isFinite(Number(req.body.waitForAckMs))
    ? Math.max(0, Math.min(15_000, Math.trunc(Number(req.body.waitForAckMs))))
    : 0;
  const requireRegisteredNumber = req.body.requireRegisteredNumber !== false;

  if ((!phone && !jid) || !message) {
    res.status(400).json({ error: "phone or jid, plus message, required" });
    return;
  }

  const resolvedSession = userId
    ? findScopedSessionByUserId(userId)
    : (phone ? findSessionByPhone(phone) : null);
  const session = resolvedSession?.session ?? (!userId ? [...sessions.values()][0] ?? null : null);
  if (!session) {
    res.status(503).json({ error: userId ? "No active session for this user" : "No active session" });
    return;
  }

  const outboundTarget = buildOutboundDirectTarget({
    record: session,
    phone,
    jid,
  });
  let targetPhone = outboundTarget.phone ?? phoneFromJid(outboundTarget.jid);
  if (targetPhone && targetPhone.length === 10) {
    const dialCode = await resolveWhatsAppDialCodeForUser(resolvedSession?.userId ?? null, session);
    if (dialCode) {
      targetPhone = `${dialCode}${targetPhone}`;
    }
  }

  const targetJid = outboundTarget.jid && isLidChatJid(outboundTarget.jid)
    ? outboundTarget.jid
    : (targetPhone ? `${targetPhone}@s.whatsapp.net` : outboundTarget.jid);
  if (!targetJid) {
    res.status(400).json({ error: "Invalid WhatsApp target. Provide a valid phone or jid." });
    return;
  }
  const registrationCheck = requireRegisteredNumber
    ? await resolveRegisteredWhatsAppTargetJid(session.sock, targetJid)
    : { exists: true as const, jid: targetJid, warning: null as string | null, reason: null as "not_registered" | "verification_unavailable" | null };

  if (!registrationCheck.exists) {
    if (registrationCheck.reason === "verification_unavailable") {
      res.status(503).json({ error: "Could not verify the target number on WhatsApp right now. Please retry in a few seconds." });
      return;
    }
    res.status(404).json({ error: "The target number is not registered on WhatsApp." });
    return;
  }

  const checkedTargetJid = registrationCheck.jid;
  const checkedTargetPhone = phoneFromJid(checkedTargetJid) ?? targetPhone ?? null;
  const tracking: TrackedWhatsAppSendInput | null = resolvedSession?.userId
    ? {
      userId: resolvedSession.userId,
      source,
      approvalId,
      workflowRunId,
      idempotencyKey,
      jid: checkedTargetJid,
      phone: checkedTargetPhone,
      contactName,
      message,
      metadata,
    }
    : null;
  const initialTrackedOutbound = tracking ? await prepareTrackedWhatsAppOutbound(tracking) : null;
  const reconciled = await reconcileTrackedOutboundBeforeSend({
    tracking,
    trackedOutbound: initialTrackedOutbound,
    waitForAckMs,
    retryRequestedVia: "api_send",
  });
  const trackedOutbound = reconciled.trackedOutbound;
  if (reconciled.summary) {
    const finalSummary = reconciled.summary;
    if (finalSummary.failed) {
      res.status(502).json({ error: "WhatsApp reported a delivery error for this message." });
      return;
    }

    res.json({
      success: true,
      deduped: true,
      messageIds: trackedOutbound.wa_message_ids,
      targetJid: checkedTargetJid,
      targetPhone: checkedTargetPhone,
      retriedUndelivered: false,
      ackStatus: finalSummary.ackStatus,
      sentAccepted: finalSummary.sentAccepted,
      deliveryConfirmed: finalSummary.deliveryConfirmed,
      warning: registrationCheck.warning,
    });
    return;
  }
  if (trackedOutbound?.status === "skipped" || trackedOutbound?.status === "cancelled") {
    res.status(409).json({ error: "WhatsApp outbound message was cancelled before send." });
    return;
  }

  try {
    const attemptCount = Math.max(1, (trackedOutbound?.attempt_count ?? 0) + 1);
    const waMessageIds = await sendStreamingMessage(session.sock, checkedTargetJid, message);
    if (tracking) {
      await recordTrackedWhatsAppSendSuccess({
        ...tracking,
        idempotencyKey: trackedOutbound?.idempotency_key ?? tracking.idempotencyKey,
      }, waMessageIds, attemptCount);
    }
    if (resolvedSession?.userId) {
      void logOutbound(resolvedSession.userId, message, checkedTargetJid, contactName, waMessageIds);
    }

    const immediateSummary = buildOutboundAckSummary("sent");
    const waitedSummary = (waitForAckMs > 0 && tracking?.userId)
      ? await waitForTrackedOutboundStatus({
        userId: tracking.userId,
        idempotencyKey: trackedOutbound?.idempotency_key ?? tracking.idempotencyKey ?? null,
        timeoutMs: waitForAckMs,
      })
      : null;
    const finalSummary = waitedSummary ?? immediateSummary;
    if (finalSummary.failed) {
      res.status(502).json({ error: "WhatsApp reported a delivery error for this message." });
      return;
    }

    res.json({
      success: true,
      messageIds: waMessageIds,
      targetJid: checkedTargetJid,
      targetPhone: checkedTargetPhone,
      retriedUndelivered: reconciled.retriedUndelivered,
      ackStatus: finalSummary.ackStatus,
      sentAccepted: finalSummary.sentAccepted,
      deliveryConfirmed: finalSummary.deliveryConfirmed,
      warning: registrationCheck.warning,
    });
  } catch (error) {
    const attemptCount = Math.max(1, (trackedOutbound?.attempt_count ?? 0) + 1);
    if (tracking) {
      await recordTrackedWhatsAppSendFailure({
        ...tracking,
        idempotencyKey: trackedOutbound?.idempotency_key ?? tracking.idempotencyKey,
      }, attemptCount, error instanceof Error ? error.message : "Failed to send WhatsApp message.", true);
    }
    throw error;
  }
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

  let resolved = resolveSessionContact(session, contactName);
  if ((!resolved || session.contacts.size === 0) && session.status === "connected") {
    await bootstrapSessionWorkspace(userId, session, "resolve-contact");
    resolved = resolveSessionContact(session, contactName);
  }

  if (!resolved) {
    res.status(404).json({ error: "No matching contact in active WhatsApp session" });
    return;
  }

  if (resolved.type === "ambiguous") {
    res.json({
      success: true,
      type: "ambiguous",
      matches: resolved.matches.map((match) => ({
        name: match.name,
        phone: match.phone,
        jid: match.jid,
      })),
    });
    return;
  }

  res.json({
    success: true,
    type: "found",
    name: resolved.contact.name,
    phone: resolved.contact.phone,
    jid: resolved.contact.jid,
  });
});

app.get("/wa/runtime/:userId", auth, async (req, res) => {
  const userId = readParam(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }

  const session = sessions.get(userId) ?? null;
  if (!session) {
    res.json(await buildDisconnectedRuntimeStatus(userId));
    return;
  }

  res.json(buildSessionRuntimeStatus(userId, session));
});

app.post("/wa/refresh-contacts", auth, async (req, res) => {
  const userId = String(req.body.userId ?? "").trim();

  if (!userId) {
    res.status(400).json({ error: "userId required" });
    return;
  }

  const session = sessions.get(userId) ?? null;
  if (!session) {
    res.status(503).json({ error: "No active session for this user" });
    return;
  }
  if (session.status !== "connected") {
    res.status(409).json({
      error: "WhatsApp session is not connected yet.",
      sessionStatus: session.status,
    });
    return;
  }

  const beforeCount = session.contacts.size;
  const beforeHistoryCount = session.historyRows.size;
  await bootstrapSessionWorkspace(userId, session, "manual-refresh");
  const persistedCount = buildSessionContactSeeds(session).length;

  res.json({
    success: true,
    contactCount: session.contacts.size,
    previousCount: beforeCount,
    persistedCount,
    historyMessageCount: session.historyRows.size,
    previousHistoryMessageCount: beforeHistoryCount,
    runtime: buildSessionRuntimeStatus(userId, session),
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
  const sessionStorage = readSessionStorageHealth();
  const connected = [...sessions.values()].filter((session) => session.status === "connected");
  const nvidia = ensureCanonicalNvidiaEnv();
  const nvidiaHints = getNvidiaEnvHints();
  const buildSha =
    process.env.RAILWAY_GIT_COMMIT_SHA
    || process.env.VERCEL_GIT_COMMIT_SHA
    || process.env.GIT_COMMIT_SHA
    || null;

  res.json({
    status: error || sessionStorage.status !== "healthy" ? "degraded" : "ok",
    configured: !error,
    build_sha: buildSha,
    railway_service: process.env.RAILWAY_SERVICE_NAME || null,
    connections: connected.length,
    total_sessions: sessions.size,
    nvidia_configured: Boolean(nvidia.value),
    nvidia_env_source: nvidia.key,
    nvidia_env_hints: nvidiaHints,
    app_url: appUrl() || "NOT SET",
    active_sync_jobs: [...sessions.values()].reduce((total, session) => total + session.activeSyncFrames.length, 0),
    session_states: Object.fromEntries(
      [...sessions.entries()].map(([userId, session]) => [
        userId.slice(0, 8),
        {
          ...buildSessionRuntimeStatus(userId, session),
          phone_loaded: session.phone ? "set" : "none",
        },
      ]),
    ),
    missingRequiredEnv: error ? missingEnv() : [],
    session_base_dir: sessionBaseDir(),
    saved_auth_dirs: savedSessionUserIds().length,
    session_storage: sessionStorage,
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
