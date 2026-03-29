import type { ClawCloudWhatsAppHistoryCoverageSummary } from "@/lib/clawcloud-whatsapp-history-plan";

export type ClawCloudWhatsAppRuntimeConnectionStatus =
  | "disconnected"
  | "connecting"
  | "waiting"
  | "connected";

export type ClawCloudWhatsAppRuntimeHealth =
  | "healthy"
  | "syncing"
  | "degraded"
  | "reauth_required";

export type ClawCloudWhatsAppRuntimeSyncState =
  | "idle"
  | "workspace_bootstrap"
  | "contact_refresh"
  | "history_expansion";

export type ClawCloudWhatsAppSyncProgress = {
  overallPercent: number;
  contactPercent: number;
  historyPercent: number;
  contactTarget: number;
  historyTarget: number;
};

export type ClawCloudWhatsAppRuntimeStatus = {
  connectionStatus: ClawCloudWhatsAppRuntimeConnectionStatus;
  health: ClawCloudWhatsAppRuntimeHealth;
  syncState: ClawCloudWhatsAppRuntimeSyncState;
  activeSyncJobs: number;
  connected: boolean;
  requiresReauth: boolean;
  phone: string | null;
  qrReady: boolean;
  qrAgeSeconds: number | null;
  contactCount: number;
  historyMessageCount: number;
  progress: ClawCloudWhatsAppSyncProgress;
  historyCoverage: ClawCloudWhatsAppHistoryCoverageSummary;
  startedAt: string | null;
  connectedAt: string | null;
  lastActivityAt: string | null;
  lastSyncStartedAt: string | null;
  lastSyncFinishedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastSyncReason: string | null;
  lastSyncError: string | null;
  lastSyncDurationMs: number | null;
  lastContactPersistedCount: number;
  lastHistoryPersistedCount: number;
  lastHistoryBackfillCount: number;
  lastHistoryExpansionRequestedCount: number;
  maintenanceResyncIntervalMs: number;
  staleAfterMs: number;
};

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function safePositiveInt(value: number | null | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.trunc(value);
}

export function computeClawCloudWhatsAppSyncProgress(input: {
  contactCount: number;
  historyMessageCount: number;
  contactTarget: number;
  historyTarget: number;
}): ClawCloudWhatsAppSyncProgress {
  const contactTarget = safePositiveInt(input.contactTarget, 1);
  const historyTarget = safePositiveInt(input.historyTarget, 1);
  const contactCount = Math.max(0, Math.trunc(input.contactCount || 0));
  const historyMessageCount = Math.max(0, Math.trunc(input.historyMessageCount || 0));
  const contactPercent = clampPercent((contactCount / contactTarget) * 100);
  const historyPercent = clampPercent((historyMessageCount / historyTarget) * 100);

  return {
    overallPercent: clampPercent((contactPercent + historyPercent) / 2),
    contactPercent,
    historyPercent,
    contactTarget,
    historyTarget,
  };
}

export function deriveClawCloudWhatsAppRuntimeHealth(input: {
  connectionStatus: ClawCloudWhatsAppRuntimeConnectionStatus;
  syncState: ClawCloudWhatsAppRuntimeSyncState;
  activeSyncJobs?: number;
  requiresReauth?: boolean;
  lastSyncError?: string | null;
  lastActivityAtMs?: number | null;
  staleAfterMs?: number;
  nowMs?: number;
}): ClawCloudWhatsAppRuntimeHealth {
  if (input.requiresReauth) {
    return "reauth_required";
  }

  if (
    input.connectionStatus === "connecting"
    || input.connectionStatus === "waiting"
    || input.syncState !== "idle"
    || (input.activeSyncJobs ?? 0) > 0
  ) {
    return "syncing";
  }

  if (
    input.connectionStatus === "connected"
    && typeof input.lastActivityAtMs === "number"
    && Number.isFinite(input.lastActivityAtMs)
    && typeof input.staleAfterMs === "number"
    && input.staleAfterMs > 0
    && (input.nowMs ?? Date.now()) - input.lastActivityAtMs > input.staleAfterMs
  ) {
    return "degraded";
  }

  if (input.lastSyncError) {
    return "degraded";
  }

  return "healthy";
}
