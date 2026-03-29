import type { ClawCloudWhatsAppRuntimeSyncState } from "@/lib/clawcloud-whatsapp-runtime";
import {
  summarizeClawCloudWhatsAppHistoryCoverage,
  type ClawCloudWhatsAppHistoryBackfillChatState,
  type ClawCloudWhatsAppHistoryCoverageSummary,
} from "@/lib/clawcloud-whatsapp-history-plan";

export type ClawCloudWhatsAppSyncCheckpointCursor = {
  remoteJid: string;
  oldestMessageId: string;
  oldestTimestampAt: string | null;
  fromMe: boolean;
  messageCount: number;
  attempts: number;
};

export type ClawCloudWhatsAppSyncCheckpoint = {
  version: 1;
  syncState: ClawCloudWhatsAppRuntimeSyncState;
  contactCount: number;
  historyMessageCount: number;
  contactTarget: number;
  historyTarget: number;
  lastContactPersistedCount: number;
  lastHistoryPersistedCount: number;
  lastHistoryBackfillCount: number;
  lastHistoryExpansionRequestedCount: number;
  lastSyncReason: string | null;
  lastSyncStartedAt: string | null;
  lastSyncFinishedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  resumeRecommended: boolean;
  historyCursors: ClawCloudWhatsAppSyncCheckpointCursor[];
  historyCoverage: ClawCloudWhatsAppHistoryCoverageSummary;
  chatStates: ClawCloudWhatsAppHistoryBackfillChatState[];
  updatedAt: string | null;
};

function normalizeIso(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeCount(value: unknown, fallback = 0) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(value));
}

function normalizeSyncState(value: unknown): ClawCloudWhatsAppRuntimeSyncState {
  return value === "workspace_bootstrap"
    || value === "contact_refresh"
    || value === "history_expansion"
    || value === "idle"
    ? value
    : "idle";
}

function normalizeCursor(
  value: unknown,
): ClawCloudWhatsAppSyncCheckpointCursor | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<ClawCloudWhatsAppSyncCheckpointCursor>;
  const remoteJid = normalizeOptionalString(raw.remoteJid);
  const oldestMessageId = normalizeOptionalString(raw.oldestMessageId);
  if (!remoteJid || !oldestMessageId) {
    return null;
  }

  return {
    remoteJid,
    oldestMessageId,
    oldestTimestampAt: normalizeIso(raw.oldestTimestampAt),
    fromMe: Boolean(raw.fromMe),
    messageCount: Math.max(1, normalizeCount(raw.messageCount, 1)),
    attempts: normalizeCount(raw.attempts),
  };
}

function normalizeHistoryCoverageSummary(value: unknown): ClawCloudWhatsAppHistoryCoverageSummary {
  if (!value || typeof value !== "object") {
    return {
      notStartedChats: 0,
      partialChats: 0,
      deepChats: 0,
      completeChats: 0,
      prioritizedChats: 0,
    };
  }

  const raw = value as Partial<ClawCloudWhatsAppHistoryCoverageSummary>;
  return {
    notStartedChats: normalizeCount(raw.notStartedChats),
    partialChats: normalizeCount(raw.partialChats),
    deepChats: normalizeCount(raw.deepChats),
    completeChats: normalizeCount(raw.completeChats),
    prioritizedChats: normalizeCount(raw.prioritizedChats),
  };
}

function normalizeChatSyncCompleteness(value: unknown) {
  return value === "not_started"
    || value === "partial"
    || value === "deep"
    || value === "complete_as_available"
    ? value
    : "partial";
}

function normalizeChatState(value: unknown): ClawCloudWhatsAppHistoryBackfillChatState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<ClawCloudWhatsAppHistoryBackfillChatState>;
  const remoteJid = normalizeOptionalString(raw.remoteJid);
  if (!remoteJid) {
    return null;
  }

  return {
    remoteJid,
    oldestMessageId: normalizeOptionalString(raw.oldestMessageId),
    chatType:
      raw.chatType === "direct"
      || raw.chatType === "group"
      || raw.chatType === "self"
      || raw.chatType === "unknown"
        ? raw.chatType
        : "unknown",
    messageCount: normalizeCount(raw.messageCount),
    oldestTimestampAt: normalizeIso(raw.oldestTimestampAt),
    latestTimestampAt: normalizeIso(raw.latestTimestampAt),
    fromMe: Boolean(raw.fromMe),
    attempts: normalizeCount(raw.attempts),
    hasDisplayName: Boolean(raw.hasDisplayName),
    completeness: normalizeChatSyncCompleteness(raw.completeness),
    priorityScore: normalizeCount(raw.priorityScore),
  };
}

export function buildClawCloudWhatsAppSyncCheckpointResumeRecommended(input: {
  syncState?: ClawCloudWhatsAppRuntimeSyncState | null;
  contactCount?: number | null;
  historyMessageCount?: number | null;
  contactTarget?: number | null;
  historyTarget?: number | null;
}) {
  const syncState = normalizeSyncState(input.syncState);
  const contactTarget = Math.max(1, normalizeCount(input.contactTarget, 1));
  const historyTarget = Math.max(1, normalizeCount(input.historyTarget, 1));
  const contactCount = normalizeCount(input.contactCount);
  const historyMessageCount = normalizeCount(input.historyMessageCount);

  return (
    syncState !== "idle"
    || contactCount < contactTarget
    || historyMessageCount < historyTarget
  );
}

export function normalizeClawCloudWhatsAppSyncCheckpoint(
  value: unknown,
): ClawCloudWhatsAppSyncCheckpoint | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<ClawCloudWhatsAppSyncCheckpoint>;
  const syncState = normalizeSyncState(raw.syncState);
  const contactCount = normalizeCount(raw.contactCount);
  const historyMessageCount = normalizeCount(raw.historyMessageCount);
  const contactTarget = Math.max(1, normalizeCount(raw.contactTarget, 1));
  const historyTarget = Math.max(1, normalizeCount(raw.historyTarget, 1));
  const chatStates = Array.isArray(raw.chatStates)
    ? raw.chatStates
      .map((chat) => normalizeChatState(chat))
      .filter(Boolean) as ClawCloudWhatsAppHistoryBackfillChatState[]
    : [];

  return {
    version: 1,
    syncState,
    contactCount,
    historyMessageCount,
    contactTarget,
    historyTarget,
    lastContactPersistedCount: normalizeCount(raw.lastContactPersistedCount),
    lastHistoryPersistedCount: normalizeCount(raw.lastHistoryPersistedCount),
    lastHistoryBackfillCount: normalizeCount(raw.lastHistoryBackfillCount),
    lastHistoryExpansionRequestedCount: normalizeCount(raw.lastHistoryExpansionRequestedCount),
    lastSyncReason: normalizeOptionalString(raw.lastSyncReason),
    lastSyncStartedAt: normalizeIso(raw.lastSyncStartedAt),
    lastSyncFinishedAt: normalizeIso(raw.lastSyncFinishedAt),
    lastSuccessfulSyncAt: normalizeIso(raw.lastSuccessfulSyncAt),
    resumeRecommended: buildClawCloudWhatsAppSyncCheckpointResumeRecommended({
      syncState,
      contactCount,
      historyMessageCount,
      contactTarget,
      historyTarget,
    }),
    historyCursors: Array.isArray(raw.historyCursors)
      ? raw.historyCursors
        .map((cursor) => normalizeCursor(cursor))
        .filter(Boolean) as ClawCloudWhatsAppSyncCheckpointCursor[]
      : [],
    historyCoverage: chatStates.length
      ? summarizeClawCloudWhatsAppHistoryCoverage(chatStates)
      : normalizeHistoryCoverageSummary(raw.historyCoverage),
    chatStates,
    updatedAt: normalizeIso(raw.updatedAt),
  };
}
