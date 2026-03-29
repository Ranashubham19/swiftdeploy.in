import type { ClawCloudWhatsAppRuntimeConnectionStatus } from "@/lib/clawcloud-whatsapp-runtime";

export type ClawCloudWhatsAppRecoveryCheckpoint = {
  version: 1;
  connectionStatus: ClawCloudWhatsAppRuntimeConnectionStatus;
  phone: string | null;
  connected: boolean;
  requiresReauth: boolean;
  reconnectAttempts: number;
  lastDisconnectCode: number | null;
  lastDisconnectAt: string | null;
  nextReconnectAt: string | null;
  connectedAt: string | null;
  lastActivityAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncFinishedAt: string | null;
  lastSyncReason: string | null;
  lastSyncError: string | null;
  lastSyncDurationMs: number | null;
  lastContactPersistedCount: number;
  lastHistoryPersistedCount: number;
  lastHistoryBackfillCount: number;
  lastHistoryExpansionRequestedCount: number;
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

function normalizeConnectionStatus(value: unknown): ClawCloudWhatsAppRuntimeConnectionStatus {
  return value === "connecting"
    || value === "waiting"
    || value === "connected"
    || value === "disconnected"
    ? value
    : "disconnected";
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeOptionalInt(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return Math.trunc(value);
}

function normalizeCount(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.trunc(value));
}

export function normalizeClawCloudWhatsAppRecoveryCheckpoint(
  value: unknown,
): ClawCloudWhatsAppRecoveryCheckpoint | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Partial<ClawCloudWhatsAppRecoveryCheckpoint>;

  return {
    version: 1,
    connectionStatus: normalizeConnectionStatus(raw.connectionStatus),
    phone: normalizeOptionalString(raw.phone),
    connected: Boolean(raw.connected),
    requiresReauth: Boolean(raw.requiresReauth),
    reconnectAttempts: normalizeCount(raw.reconnectAttempts),
    lastDisconnectCode: normalizeOptionalInt(raw.lastDisconnectCode),
    lastDisconnectAt: normalizeIso(raw.lastDisconnectAt),
    nextReconnectAt: normalizeIso(raw.nextReconnectAt),
    connectedAt: normalizeIso(raw.connectedAt),
    lastActivityAt: normalizeIso(raw.lastActivityAt),
    lastSuccessfulSyncAt: normalizeIso(raw.lastSuccessfulSyncAt),
    lastSyncFinishedAt: normalizeIso(raw.lastSyncFinishedAt),
    lastSyncReason: normalizeOptionalString(raw.lastSyncReason),
    lastSyncError: normalizeOptionalString(raw.lastSyncError),
    lastSyncDurationMs: normalizeOptionalInt(raw.lastSyncDurationMs),
    lastContactPersistedCount: normalizeCount(raw.lastContactPersistedCount),
    lastHistoryPersistedCount: normalizeCount(raw.lastHistoryPersistedCount),
    lastHistoryBackfillCount: normalizeCount(raw.lastHistoryBackfillCount),
    lastHistoryExpansionRequestedCount: normalizeCount(raw.lastHistoryExpansionRequestedCount),
    updatedAt: normalizeIso(raw.updatedAt),
  };
}

export function computeClawCloudWhatsAppReconnectDelayMs(
  attempt: number,
  options?: {
    baseMs?: number;
    maxMs?: number;
  },
) {
  const normalizedAttempt = Math.max(1, Math.trunc(Number.isFinite(attempt) ? attempt : 1));
  const baseMs = Math.max(250, Math.trunc(options?.baseMs ?? 3_000));
  const maxMs = Math.max(baseMs, Math.trunc(options?.maxMs ?? 60_000));
  const multiplier = Math.min(normalizedAttempt - 1, 6);
  return Math.min(maxMs, baseMs * (2 ** multiplier));
}

export function getClawCloudWhatsAppReconnectWaitMs(
  checkpoint: ClawCloudWhatsAppRecoveryCheckpoint | null | undefined,
  nowMs = Date.now(),
) {
  const nextReconnectAt = checkpoint?.nextReconnectAt ? Date.parse(checkpoint.nextReconnectAt) : NaN;
  if (!Number.isFinite(nextReconnectAt)) {
    return 0;
  }

  return Math.max(0, nextReconnectAt - nowMs);
}
