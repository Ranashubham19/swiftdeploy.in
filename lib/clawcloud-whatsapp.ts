import { env } from "@/lib/env";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { backfillWhatsAppContactsFromHistory } from "@/lib/clawcloud-whatsapp-contacts";
import { pickAuthoritativeClawCloudWhatsAppAccount } from "@/lib/clawcloud-whatsapp-account-selection";
import type { ClawCloudWhatsAppHistoryCoverageSummary } from "@/lib/clawcloud-whatsapp-history-plan";
import {
  computeClawCloudWhatsAppSyncProgress,
  type ClawCloudWhatsAppRuntimeStatus,
} from "@/lib/clawcloud-whatsapp-runtime";
import { buildClawCloudWhatsAppSyncPolicy } from "@/lib/clawcloud-whatsapp-sync-policy";
import type { WhatsAppOutboundSource } from "@/lib/clawcloud-whatsapp-workspace-types";

type LocalWhatsAppResolveResult = {
  name: string;
  phone: string | null;
  jid: string | null;
};

type LocalWhatsAppAmbiguousMatch = {
  name: string;
  phone: string | null;
  jid: string | null;
};

export type ClawCloudWhatsAppResolveResult =
  | { type: "found"; contact: LocalWhatsAppResolveResult }
  | { type: "ambiguous"; matches: LocalWhatsAppAmbiguousMatch[] };

export type ClawCloudWhatsAppRefreshResult = {
  success: true;
  contactCount: number;
  previousCount?: number;
  persistedCount?: number;
  historyMessageCount?: number;
  previousHistoryMessageCount?: number;
};

export type ClawCloudWhatsAppAckStatus = "pending" | "server_ack" | "delivery_ack" | "read" | "error";

export type ClawCloudWhatsAppSendResult = {
  success: true;
  messageIds: string[];
  targetJid: string | null;
  targetPhone: string | null;
  deduped: boolean;
  ackStatus: ClawCloudWhatsAppAckStatus | null;
  sentAccepted: boolean;
  deliveryConfirmed: boolean;
  warning: string | null;
};

export type ClawCloudWhatsAppWorkspaceState = {
  connected: boolean;
  contactCount: number;
  historyMessageCount: number;
};

export type ClawCloudWhatsAppWorkspaceBootstrapResult = ClawCloudWhatsAppWorkspaceState & {
  refreshed: boolean;
  previousCount: number;
  persistedCount: number;
};

function toStringOrNull(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function buildFallbackWhatsAppRuntimeStatus(input: {
  accountActive: boolean;
  hasAccount: boolean;
  phone: string | null;
  contactCount: number;
  historyMessageCount: number;
}): ClawCloudWhatsAppRuntimeStatus {
  return {
    connectionStatus: "disconnected",
    health: input.hasAccount
      ? (input.accountActive ? "degraded" : "reauth_required")
      : "healthy",
    syncState: "idle",
    activeSyncJobs: 0,
    connected: false,
    requiresReauth: input.hasAccount && !input.accountActive,
    phone: input.phone,
    qrReady: false,
    qrAgeSeconds: null,
    contactCount: input.contactCount,
    historyMessageCount: input.historyMessageCount,
    progress: computeClawCloudWhatsAppSyncProgress({
      contactCount: input.contactCount,
      historyMessageCount: input.historyMessageCount,
      contactTarget: WHATSAPP_WORKSPACE_READY_CONTACT_COUNT,
      historyTarget: WHATSAPP_WORKSPACE_READY_HISTORY_COUNT,
    }),
    historyCoverage: normalizeHistoryCoverageSummary(null),
    startedAt: null,
    connectedAt: null,
    lastActivityAt: null,
    lastSyncStartedAt: null,
    lastSyncFinishedAt: null,
    lastSuccessfulSyncAt: null,
    lastSyncReason: null,
    lastSyncError: null,
    lastSyncDurationMs: null,
    lastContactPersistedCount: input.contactCount,
    lastHistoryPersistedCount: input.historyMessageCount,
    lastHistoryBackfillCount: 0,
    lastHistoryExpansionRequestedCount: 0,
    maintenanceResyncIntervalMs: 10 * 60_000,
    staleAfterMs: 3 * 60_000,
  };
}

type LocalWhatsAppRuntime = {
  send?: (input: {
    userId?: string | null;
    phone?: string | null;
    jid?: string | null;
    message: string;
    contactName?: string | null;
    source?: WhatsAppOutboundSource | null;
    approvalId?: string | null;
    workflowRunId?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown> | null;
  }) => Promise<boolean>;
  resolveContact?: (input: {
    userId: string;
    contactName: string;
  }) => Promise<ClawCloudWhatsAppResolveResult | null>;
  refreshContacts?: (input: { userId: string }) => Promise<ClawCloudWhatsAppRefreshResult>;
};

const WHATSAPP_SYNC_POLICY = buildClawCloudWhatsAppSyncPolicy({
  contactRefreshTarget: Number.parseInt(process.env.WA_CONTACT_REFRESH_TARGET ?? "", 10),
  historyTarget: Number.parseInt(process.env.WA_HISTORY_SYNC_TARGET ?? "", 10),
});
const WHATSAPP_WORKSPACE_READY_CONTACT_COUNT = Math.max(
  1,
  Math.min(180, WHATSAPP_SYNC_POLICY.contactRefreshTarget),
);
const WHATSAPP_WORKSPACE_READY_HISTORY_COUNT = Math.max(
  1,
  Math.min(1_500, WHATSAPP_SYNC_POLICY.historyTarget),
);
const WHATSAPP_RUNTIME_FETCH_TIMEOUT_MS = 1_200;

let localWhatsAppRuntime: LocalWhatsAppRuntime | null = null;

export function registerClawCloudWhatsAppRuntime(runtime: LocalWhatsAppRuntime) {
  localWhatsAppRuntime = runtime;
}

function normalizeAgentServerUrl(url: string) {
  return url.trim().replace(/\/+$/, "");
}

function normalizeCount(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function normalizeHistoryCoverageSummary(value: unknown): ClawCloudWhatsAppHistoryCoverageSummary {
  const raw = value && typeof value === "object"
    ? value as Partial<ClawCloudWhatsAppHistoryCoverageSummary>
    : {};
  return {
    notStartedChats: normalizeCount(raw.notStartedChats),
    partialChats: normalizeCount(raw.partialChats),
    deepChats: normalizeCount(raw.deepChats),
    completeChats: normalizeCount(raw.completeChats),
    prioritizedChats: normalizeCount(raw.prioritizedChats),
  };
}

function getAgentServerBaseUrl() {
  const explicit = normalizeAgentServerUrl(env.AGENT_SERVER_URL);
  if (explicit) {
    return explicit;
  }

  const backendApi = normalizeAgentServerUrl(env.BACKEND_API_URL);
  if (backendApi) {
    return backendApi;
  }

  return "";
}

function assertAgentServerConfigured() {
  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    throw new Error(
      "WhatsApp agent server requires AGENT_SERVER_URL (or BACKEND_API_URL) and AGENT_SECRET.",
    );
  }
}

async function agentServerFetch(
  path: string,
  init: RequestInit = {},
  options?: { timeoutMs?: number },
) {
  assertAgentServerConfigured();

  const timeoutMs = options?.timeoutMs;
  const controller = timeoutMs && !init.signal
    ? new AbortController()
    : null;
  const timeoutHandle = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(`${getAgentServerBaseUrl()}${path}`, {
      ...init,
      signal: init.signal ?? controller?.signal,
      headers: {
        Authorization: `Bearer ${env.AGENT_SECRET}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    return response;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

export async function getClawCloudWhatsAppAccount(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("connected_accounts")
    .select("phone_number, display_name, is_active, connected_at, last_used_at")
    .eq("user_id", userId)
    .eq("provider", "whatsapp")
    .limit(12);

  if (error || !Array.isArray(data)) {
    return null;
  }

  return pickAuthoritativeClawCloudWhatsAppAccount(data as Array<{
    phone_number: string | null;
    display_name: string | null;
    is_active: boolean;
    connected_at?: string | null;
    last_used_at?: string | null;
  }>);
}

export function shouldBootstrapClawCloudWhatsAppWorkspace(input: {
  connected: boolean;
  contactCount: number;
  historyMessageCount: number;
  force?: boolean;
}) {
  if (input.force) {
    return input.connected;
  }

  return input.connected && (
    input.contactCount < WHATSAPP_WORKSPACE_READY_CONTACT_COUNT
    || input.historyMessageCount < WHATSAPP_WORKSPACE_READY_HISTORY_COUNT
  );
}

export async function getClawCloudWhatsAppWorkspaceState(
  userId: string,
): Promise<ClawCloudWhatsAppWorkspaceState> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const [account, contactsResult, historyResult] = await Promise.all([
    getClawCloudWhatsAppAccount(userId),
    supabaseAdmin
      .from("whatsapp_contacts")
      .select("jid", { count: "exact", head: true })
      .eq("user_id", userId)
      .catch(() => ({ count: 0 })),
    supabaseAdmin
      .from("whatsapp_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .catch(() => ({ count: 0 })),
  ]);

  return {
    connected: Boolean(account?.is_active),
    contactCount: normalizeCount(contactsResult.count),
    historyMessageCount: normalizeCount(historyResult.count),
  };
}

export async function ensureClawCloudWhatsAppWorkspaceReady(
  userId: string,
  options?: { force?: boolean },
): Promise<ClawCloudWhatsAppWorkspaceBootstrapResult> {
  const before = await getClawCloudWhatsAppWorkspaceState(userId);

  if (!shouldBootstrapClawCloudWhatsAppWorkspace({
    ...before,
    force: options?.force,
  })) {
    return {
      ...before,
      refreshed: false,
      previousCount: before.contactCount,
      persistedCount: before.contactCount,
    };
  }

  const refreshed = await refreshClawCloudWhatsAppContacts(userId);
  const after = await getClawCloudWhatsAppWorkspaceState(userId);

  return {
    ...after,
    refreshed: true,
    previousCount: refreshed.previousCount ?? before.contactCount,
    persistedCount: refreshed.persistedCount ?? after.contactCount,
  };
}

export async function getClawCloudWhatsAppRuntimeStatus(
  userId: string,
): Promise<ClawCloudWhatsAppRuntimeStatus> {
  const fallbackWorkspaceStatePromise = getClawCloudWhatsAppWorkspaceState(userId).catch(() => ({
    connected: false,
    contactCount: 0,
    historyMessageCount: 0,
  }));
  const fallbackAccountPromise = getClawCloudWhatsAppAccount(userId).catch(() => null);

  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    const [workspaceState, account] = await Promise.all([
      fallbackWorkspaceStatePromise,
      fallbackAccountPromise,
    ]);
    return buildFallbackWhatsAppRuntimeStatus({
      accountActive: Boolean(account?.is_active),
      hasAccount: Boolean(account),
      phone: account?.phone_number ?? null,
      contactCount: workspaceState.contactCount,
      historyMessageCount: workspaceState.historyMessageCount,
    });
  }

  const response = await agentServerFetch(`/wa/runtime/${encodeURIComponent(userId)}`, {
    method: "GET",
  }, {
    timeoutMs: WHATSAPP_RUNTIME_FETCH_TIMEOUT_MS,
  }).catch(() => null);

  if (!response || !response.ok) {
    const [workspaceState, account] = await Promise.all([
      fallbackWorkspaceStatePromise,
      fallbackAccountPromise,
    ]);
    return buildFallbackWhatsAppRuntimeStatus({
      accountActive: Boolean(account?.is_active),
      hasAccount: Boolean(account),
      phone: account?.phone_number ?? null,
      contactCount: workspaceState.contactCount,
      historyMessageCount: workspaceState.historyMessageCount,
    });
  }

  const json = (await response.json().catch(() => ({}))) as Partial<ClawCloudWhatsAppRuntimeStatus> & {
    progress?: Partial<ClawCloudWhatsAppRuntimeStatus["progress"]> | null;
  };

  const contactCount = normalizeCount(json.contactCount);
  const historyMessageCount = normalizeCount(json.historyMessageCount);

  return {
    connectionStatus:
      json.connectionStatus === "connecting"
      || json.connectionStatus === "waiting"
      || json.connectionStatus === "connected"
      || json.connectionStatus === "disconnected"
        ? json.connectionStatus
        : "disconnected",
    health:
      json.health === "healthy"
      || json.health === "syncing"
      || json.health === "degraded"
      || json.health === "reauth_required"
        ? json.health
        : "healthy",
    syncState:
      json.syncState === "workspace_bootstrap"
      || json.syncState === "contact_refresh"
      || json.syncState === "history_expansion"
      || json.syncState === "idle"
        ? json.syncState
        : "idle",
    activeSyncJobs: normalizeCount(json.activeSyncJobs),
    connected: Boolean(json.connected),
    requiresReauth: Boolean(json.requiresReauth),
    phone: toStringOrNull(json.phone ?? null),
    qrReady: Boolean(json.qrReady),
    qrAgeSeconds:
      typeof json.qrAgeSeconds === "number" && Number.isFinite(json.qrAgeSeconds)
        ? Math.max(0, Math.trunc(json.qrAgeSeconds))
        : null,
    contactCount,
    historyMessageCount,
    progress: computeClawCloudWhatsAppSyncProgress({
      contactCount,
      historyMessageCount,
      contactTarget: Number(json.progress?.contactTarget ?? WHATSAPP_WORKSPACE_READY_CONTACT_COUNT),
      historyTarget: Number(json.progress?.historyTarget ?? WHATSAPP_WORKSPACE_READY_HISTORY_COUNT),
    }),
    historyCoverage: normalizeHistoryCoverageSummary((json as { historyCoverage?: unknown }).historyCoverage),
    startedAt: toStringOrNull(json.startedAt),
    connectedAt: toStringOrNull(json.connectedAt),
    lastActivityAt: toStringOrNull(json.lastActivityAt),
    lastSyncStartedAt: toStringOrNull(json.lastSyncStartedAt),
    lastSyncFinishedAt: toStringOrNull(json.lastSyncFinishedAt),
    lastSuccessfulSyncAt: toStringOrNull(json.lastSuccessfulSyncAt),
    lastSyncReason: toStringOrNull(json.lastSyncReason),
    lastSyncError: toStringOrNull(json.lastSyncError),
    lastSyncDurationMs:
      typeof json.lastSyncDurationMs === "number" && Number.isFinite(json.lastSyncDurationMs)
        ? Math.max(0, Math.trunc(json.lastSyncDurationMs))
        : null,
    lastContactPersistedCount: normalizeCount(json.lastContactPersistedCount),
    lastHistoryPersistedCount: normalizeCount(json.lastHistoryPersistedCount),
    lastHistoryBackfillCount: normalizeCount(json.lastHistoryBackfillCount),
    lastHistoryExpansionRequestedCount: normalizeCount(json.lastHistoryExpansionRequestedCount),
    maintenanceResyncIntervalMs:
      typeof json.maintenanceResyncIntervalMs === "number" && Number.isFinite(json.maintenanceResyncIntervalMs)
        ? Math.max(0, Math.trunc(json.maintenanceResyncIntervalMs))
        : 10 * 60_000,
    staleAfterMs:
      typeof json.staleAfterMs === "number" && Number.isFinite(json.staleAfterMs)
        ? Math.max(0, Math.trunc(json.staleAfterMs))
        : 3 * 60_000,
  };
}

export async function requestClawCloudWhatsAppQr(
  userId: string,
  options?: { forceRefresh?: boolean },
) {
  const refreshQuery = options?.forceRefresh ? "?refresh=1" : "";
  const response = await agentServerFetch(`/wa/qr/${userId}${refreshQuery}`, {
    method: "GET",
  }, {
    timeoutMs: 2_500,
  });

  const json = (await response.json()) as {
    qr?: string;
    status?: string;
    phone?: string | null;
    qr_age_seconds?: number | null;
    poll_after_ms?: number | null;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(json.error || "Unable to start WhatsApp connection.");
  }

  return json;
}

export async function disconnectClawCloudWhatsApp(userId: string) {
  const response = await agentServerFetch(`/wa/session/${userId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error || "Unable to disconnect WhatsApp.");
  }

  return true;
}

/**
 * Strip internal routing metadata that must never reach a real WhatsApp contact.
 */
function sanitizeWhatsAppOutbound(raw: string): string {
  let text = raw;
  if (text.startsWith("[WhatsApp workspace context]")) {
    const sep = text.indexOf("\n\n");
    text = sep === -1 ? "" : text.slice(sep + 2);
  }
  text = text.replace(/^\[WhatsApp workspace context\][^\n]*(?:\n- [^\n]*)*\n{0,2}/i, "");
  text = text.replace(/^\[Group message[^\]]*\]\s*/i, "");
  return text.trim();
}

export async function sendClawCloudWhatsAppToPhone(
  phone: string | null,
  rawMessage: string,
  options?: {
    userId?: string;
    contactName?: string | null;
    jid?: string | null;
    source?: WhatsAppOutboundSource | null;
    approvalId?: string | null;
    workflowRunId?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown> | null;
    waitForAckMs?: number | null;
    requireRegisteredNumber?: boolean | null;
  },
) {
  const message = sanitizeWhatsAppOutbound(rawMessage);
  if (!message) {
    throw new Error("Outbound message was empty after sanitization.");
  }

  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    if (localWhatsAppRuntime?.send) {
      const ok = await localWhatsAppRuntime.send({
        userId: options?.userId ?? null,
        phone,
        jid: options?.jid ?? null,
        message,
        contactName: options?.contactName ?? null,
        source: options?.source ?? null,
        approvalId: options?.approvalId ?? null,
        workflowRunId: options?.workflowRunId ?? null,
        idempotencyKey: options?.idempotencyKey ?? null,
        metadata: options?.metadata ?? null,
      });
      if (!ok) {
        throw new Error("Failed to send WhatsApp message.");
      }
      return {
        success: true as const,
        messageIds: [],
        targetJid: options?.jid ?? null,
        targetPhone: phone ?? null,
        deduped: false,
        ackStatus: null,
        sentAccepted: true,
        deliveryConfirmed: false,
        warning: null,
      };
    }
  }

  const response = await agentServerFetch("/wa/send", {
    method: "POST",
    body: JSON.stringify({
      phone: phone ?? null,
      jid: options?.jid ?? null,
      message,
      userId: options?.userId ?? null,
      contactName: options?.contactName ?? null,
      source: options?.source ?? null,
      approvalId: options?.approvalId ?? null,
      workflowRunId: options?.workflowRunId ?? null,
      idempotencyKey: options?.idempotencyKey ?? null,
      metadata: options?.metadata ?? null,
      waitForAckMs: options?.waitForAckMs ?? null,
      requireRegisteredNumber: options?.requireRegisteredNumber ?? true,
    }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    error?: string;
    success?: boolean;
    deduped?: boolean;
    messageIds?: string[];
    targetJid?: string | null;
    targetPhone?: string | null;
    ackStatus?: ClawCloudWhatsAppAckStatus | null;
    sentAccepted?: boolean;
    deliveryConfirmed?: boolean;
    warning?: string | null;
  };
  if (!response.ok) {
    throw new Error(json.error || "Failed to send WhatsApp message.");
  }

  if (!json.success) {
    throw new Error("WhatsApp send failed without explicit error.");
  }

  const ackStatus = (
    json.ackStatus === "pending"
    || json.ackStatus === "server_ack"
    || json.ackStatus === "delivery_ack"
    || json.ackStatus === "read"
    || json.ackStatus === "error"
  )
    ? json.ackStatus
    : null;

  return {
    success: true as const,
    messageIds: Array.isArray(json.messageIds) ? json.messageIds : [],
    targetJid: json.targetJid ?? options?.jid ?? null,
    targetPhone: json.targetPhone ?? phone ?? null,
    deduped: Boolean(json.deduped),
    ackStatus,
    sentAccepted: Boolean(json.sentAccepted ?? (ackStatus === "server_ack" || ackStatus === "delivery_ack" || ackStatus === "read")),
    deliveryConfirmed: Boolean(json.deliveryConfirmed ?? (ackStatus === "delivery_ack" || ackStatus === "read")),
    warning: typeof json.warning === "string" ? json.warning : null,
  };
}

export async function resolveClawCloudWhatsAppContact(userId: string, contactName: string) {
  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    if (localWhatsAppRuntime?.resolveContact) {
      return localWhatsAppRuntime.resolveContact({ userId, contactName });
    }
  }

  const response = await agentServerFetch("/wa/resolve-contact", {
    method: "POST",
    body: JSON.stringify({
      userId,
      contactName,
    }),
  });

  if (response.status === 404) {
    return null;
  }

  const json = (await response.json().catch(() => ({}))) as {
    error?: string;
    type?: "found" | "ambiguous";
    name?: string;
    phone?: string | null;
    jid?: string | null;
    matches?: Array<{
      name?: string;
      phone?: string | null;
      jid?: string | null;
    }>;
  };

  if (!response.ok) {
    throw new Error(json.error || "Failed to resolve WhatsApp contact.");
  }

  if (json.type === "ambiguous" && Array.isArray(json.matches) && json.matches.length) {
    return {
      type: "ambiguous",
      matches: json.matches
        .filter((match): match is { name: string; phone: string | null; jid: string | null } =>
          typeof match?.name === "string" && match.name.trim().length > 0,
        )
        .map((match) => ({
          name: match.name,
          phone: match.phone ?? null,
          jid: match.jid ?? null,
        })),
    };
  }

  if (!json.name) {
    return null;
  }

  return {
    type: "found",
    contact: {
      name: json.name,
      phone: json.phone ?? null,
      jid: json.jid ?? null,
    },
  };
}

export async function refreshClawCloudWhatsAppContacts(userId: string) {
  let historyBackfillCount = 0;

  if (!getAgentServerBaseUrl() || !env.AGENT_SECRET) {
    if (localWhatsAppRuntime?.refreshContacts) {
      const refreshed = await localWhatsAppRuntime.refreshContacts({ userId });
      historyBackfillCount = (
        await backfillWhatsAppContactsFromHistory(userId).catch(() => ({ createdCount: 0 }))
      ).createdCount;
      return {
        ...refreshed,
        contactCount: Math.max(refreshed.contactCount, historyBackfillCount),
        persistedCount: Math.max(refreshed.persistedCount ?? 0, historyBackfillCount),
      };
    }
  }

  const response = await agentServerFetch("/wa/refresh-contacts", {
    method: "POST",
    body: JSON.stringify({ userId }),
  });

  const json = (await response.json().catch(() => ({}))) as {
    error?: string;
    success?: boolean;
    contactCount?: number;
    previousCount?: number;
    persistedCount?: number;
    historyMessageCount?: number;
    previousHistoryMessageCount?: number;
  };

  if (!response.ok) {
    throw new Error(json.error || "Failed to refresh WhatsApp contacts.");
  }

  historyBackfillCount = (
    await backfillWhatsAppContactsFromHistory(userId).catch(() => ({ createdCount: 0 }))
  ).createdCount;

  return {
    success: true as const,
    contactCount: Math.max(Number(json.contactCount ?? 0), historyBackfillCount),
    previousCount: Number(json.previousCount ?? 0),
    persistedCount: Math.max(Number(json.persistedCount ?? 0), historyBackfillCount),
    historyMessageCount: Number(json.historyMessageCount ?? 0),
    previousHistoryMessageCount: Number(json.previousHistoryMessageCount ?? 0),
  };
}

export async function sendClawCloudWhatsAppMessage(userId: string, message: string) {
  const primaryResponse = await agentServerFetch(`/wa/send-user/${encodeURIComponent(userId)}`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  let shouldLogLocally = false;

  if (!primaryResponse.ok) {
    const account = await getClawCloudWhatsAppAccount(userId);
    if (!account?.phone_number) {
      return false;
    }

    await sendClawCloudWhatsAppToPhone(account.phone_number, message, {
      userId,
      source: "system",
      metadata: {
        send_path: "send_user_fallback",
      },
    });
    shouldLogLocally = true;
  }

  if (shouldLogLocally) {
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    await supabaseAdmin.from("whatsapp_messages").insert({
      user_id: userId,
      direction: "outbound",
      content: message,
      message_type: "text",
      sent_at: new Date().toISOString(),
    });
  }

  return true;
}
