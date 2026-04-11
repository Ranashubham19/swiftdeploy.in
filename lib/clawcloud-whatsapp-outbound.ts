import crypto from "node:crypto";

import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import type {
  WhatsAppOutboundMessage,
  WhatsAppOutboundSource,
  WhatsAppOutboundStatus,
} from "@/lib/clawcloud-whatsapp-workspace-types";

type CreateWhatsAppOutboundMessageInput = {
  userId: string;
  source: WhatsAppOutboundSource;
  approvalId?: string | null;
  workflowRunId?: string | null;
  remoteJid?: string | null;
  remotePhone?: string | null;
  contactName?: string | null;
  messageText: string;
  status: WhatsAppOutboundStatus;
  idempotencyKey?: string | null;
  metadata?: Record<string, unknown> | null;
};

type TransitionWhatsAppOutboundMessageInput = {
  userId: string;
  outboundMessageId?: string | null;
  idempotencyKey?: string | null;
  nextStatus: WhatsAppOutboundStatus;
  attemptCount?: number | null;
  waMessageIds?: string[] | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
  force?: boolean;
};

export type WhatsAppMessageAckStatus = "pending" | "server_ack" | "delivery_ack" | "read" | "error";

const terminalOutboundStatuses = new Set<WhatsAppOutboundStatus>([
  "read",
  "failed",
  "skipped",
  "cancelled",
]);

const outboundTransitions: Record<WhatsAppOutboundStatus, Set<WhatsAppOutboundStatus>> = {
  drafted: new Set(["queued", "approval_required", "cancelled"]),
  queued: new Set(["approval_required", "approved", "retrying", "sent", "failed", "skipped", "cancelled"]),
  approval_required: new Set(["approved", "skipped", "cancelled", "failed"]),
  approved: new Set(["retrying", "sent", "failed", "cancelled"]),
  retrying: new Set(["retrying", "sent", "failed", "cancelled"]),
  sent: new Set(["delivered", "read", "failed"]),
  delivered: new Set(["read"]),
  read: new Set(),
  failed: new Set(["retrying", "sent"]),
  skipped: new Set(),
  cancelled: new Set(),
};

function cleanText(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeWaMessageIds(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return [...new Set(
    value
      .map((item) => cleanText(typeof item === "string" ? item : null))
      .filter(Boolean),
  )] as string[];
}

function normalizeOutboundRecord(value: Record<string, unknown>) {
  return {
    id: String(value.id ?? ""),
    user_id: String(value.user_id ?? ""),
    source: String(value.source ?? "system") as WhatsAppOutboundSource,
    approval_id: cleanText(typeof value.approval_id === "string" ? value.approval_id : null),
    workflow_run_id: cleanText(typeof value.workflow_run_id === "string" ? value.workflow_run_id : null),
    remote_jid: cleanText(typeof value.remote_jid === "string" ? value.remote_jid : null),
    remote_phone: cleanText(typeof value.remote_phone === "string" ? value.remote_phone : null),
    contact_name: cleanText(typeof value.contact_name === "string" ? value.contact_name : null),
    message_text: String(value.message_text ?? ""),
    idempotency_key: String(value.idempotency_key ?? ""),
    status: String(value.status ?? "drafted") as WhatsAppOutboundStatus,
    attempt_count: Number.isFinite(Number(value.attempt_count)) ? Math.max(0, Number(value.attempt_count)) : 0,
    wa_message_ids: normalizeWaMessageIds(value.wa_message_ids),
    queued_at: String(value.queued_at ?? value.created_at ?? new Date().toISOString()),
    approved_at: cleanText(typeof value.approved_at === "string" ? value.approved_at : null),
    sent_at: cleanText(typeof value.sent_at === "string" ? value.sent_at : null),
    delivered_at: cleanText(typeof value.delivered_at === "string" ? value.delivered_at : null),
    read_at: cleanText(typeof value.read_at === "string" ? value.read_at : null),
    failed_at: cleanText(typeof value.failed_at === "string" ? value.failed_at : null),
    error_message: cleanText(typeof value.error_message === "string" ? value.error_message : null),
    metadata: value.metadata && typeof value.metadata === "object"
      ? value.metadata as Record<string, unknown>
      : {},
    created_at: String(value.created_at ?? new Date().toISOString()),
    updated_at: cleanText(typeof value.updated_at === "string" ? value.updated_at : null),
  } satisfies WhatsAppOutboundMessage;
}

function normalizeMetadata(value: unknown) {
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function nextTimestampIfMissing(existing: string | null, nextStatus: WhatsAppOutboundStatus, targetStatus: WhatsAppOutboundStatus) {
  return !existing && nextStatus === targetStatus ? new Date().toISOString() : existing;
}

function shouldApplyTransition(
  currentStatus: WhatsAppOutboundStatus,
  nextStatus: WhatsAppOutboundStatus,
  force = false,
) {
  if (force || currentStatus === nextStatus) {
    return true;
  }

  if (terminalOutboundStatuses.has(currentStatus)) {
    return false;
  }

  return outboundTransitions[currentStatus]?.has(nextStatus) ?? false;
}

export function isWhatsAppOutboundFinalizedStatus(status: WhatsAppOutboundStatus | null | undefined) {
  return Boolean(status && terminalOutboundStatuses.has(status));
}

export function resolveWhatsAppOutboundStatusFromAckStatus(
  ackStatus: WhatsAppMessageAckStatus,
): WhatsAppOutboundStatus {
  return ackStatus === "read"
    ? "read"
    : ackStatus === "delivery_ack"
      ? "delivered"
      : ackStatus === "server_ack"
        ? "sent"
        : ackStatus === "error"
          ? "failed"
          : "retrying";
}

function parseTimestampMs(value: string | null | undefined) {
  if (!value) {
    return Number.NaN;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function isWhatsAppOutboundAwaitingDelivery(
  outbound: Pick<WhatsAppOutboundMessage, "status" | "delivered_at" | "read_at" | "failed_at">,
) {
  return outbound.status === "sent"
    && !outbound.delivered_at
    && !outbound.read_at
    && !outbound.failed_at;
}

export function shouldRetryUndeliveredWhatsAppOutbound(
  outbound: Pick<WhatsAppOutboundMessage, "status" | "delivered_at" | "read_at" | "failed_at" | "updated_at" | "sent_at" | "created_at">,
  options?: {
    nowMs?: number;
    minPendingMs?: number;
  },
) {
  if (!isWhatsAppOutboundAwaitingDelivery(outbound)) {
    return false;
  }

  const nowMs = typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();
  const minPendingMs = typeof options?.minPendingMs === "number" && Number.isFinite(options.minPendingMs)
    ? Math.max(5_000, Math.trunc(options.minPendingMs))
    : 30_000;
  const referenceCandidates = [
    parseTimestampMs(outbound.updated_at),
    parseTimestampMs(outbound.sent_at),
    parseTimestampMs(outbound.created_at),
  ];
  const referenceMs = referenceCandidates.find((value) => Number.isFinite(value));
  if (typeof referenceMs !== "number" || !Number.isFinite(referenceMs)) {
    return false;
  }

  return nowMs - referenceMs >= minPendingMs;
}

export function buildWhatsAppOutboundIdempotencyKey(input: {
  userId: string;
  source: WhatsAppOutboundSource;
  remoteJid?: string | null;
  remotePhone?: string | null;
  messageText: string;
  approvalId?: string | null;
  workflowRunId?: string | null;
}) {
  const payload = [
    input.userId,
    input.source,
    cleanText(input.remoteJid) ?? "",
    cleanText(input.remotePhone) ?? "",
    cleanText(input.approvalId) ?? "",
    cleanText(input.workflowRunId) ?? "",
    input.messageText.replace(/\s+/g, " ").trim(),
  ].join("|");

  return `wa-outbound-${crypto.createHash("sha256").update(payload).digest("hex").slice(0, 32)}`;
}

export function buildAssistantReplyIdempotencyKey(input: {
  userId: string;
  targetJid: string;
  inboundMessageId?: string | null;
  inboundDedupKey?: string | null;
  messageText?: string | null;
}) {
  const inboundMessageId = cleanText(input.inboundMessageId);
  const inboundDedupKey = cleanText(input.inboundDedupKey);
  const seed = inboundMessageId ?? inboundDedupKey;

  if (seed) {
    return buildWhatsAppOutboundIdempotencyKey({
      userId: input.userId,
      source: "assistant_reply",
      remoteJid: input.targetJid,
      messageText: `assistant-reply:${seed}`,
    });
  }

  return buildWhatsAppOutboundIdempotencyKey({
    userId: input.userId,
    source: "assistant_reply",
    remoteJid: input.targetJid,
    workflowRunId: crypto.randomBytes(8).toString("hex"),
    messageText: cleanText(input.messageText) ?? "assistant-reply",
  });
}

async function getWhatsAppOutboundMessageByFilter(
  userId: string,
  filter: {
    id?: string | null;
    idempotencyKey?: string | null;
    approvalId?: string | null;
    workflowRunId?: string | null;
  },
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  let query = supabaseAdmin
    .from("whatsapp_outbound_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (filter.id) {
    query = query.eq("id", filter.id);
  } else if (filter.approvalId) {
    query = query.eq("approval_id", filter.approvalId);
  } else if (filter.workflowRunId) {
    query = query.eq("workflow_run_id", filter.workflowRunId);
  } else if (filter.idempotencyKey) {
    query = query.eq("idempotency_key", filter.idempotencyKey);
  } else {
    return null;
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(error.message);
  }

  return data ? normalizeOutboundRecord(data as Record<string, unknown>) : null;
}

export async function listWhatsAppOutboundMessages(userId: string, limit = 80) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_outbound_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Record<string, unknown>[]).map(normalizeOutboundRecord);
}

export async function ensureWhatsAppOutboundMessage(input: CreateWhatsAppOutboundMessageInput) {
  const remoteJid = cleanText(input.remoteJid);
  const remotePhone = cleanText(input.remotePhone);
  const contactName = cleanText(input.contactName);
  const messageText = input.messageText.trim();
  const metadata = normalizeMetadata(input.metadata);
  const idempotencyKey = cleanText(input.idempotencyKey)
    ?? buildWhatsAppOutboundIdempotencyKey({
      userId: input.userId,
      source: input.source,
      remoteJid,
      remotePhone,
      messageText,
      approvalId: input.approvalId,
      workflowRunId: input.workflowRunId,
    });

  const existing = await getWhatsAppOutboundMessageByFilter(input.userId, {
    approvalId: input.approvalId,
    workflowRunId: input.workflowRunId,
    idempotencyKey,
  });
  if (existing) {
    const mergedMetadata = {
      ...normalizeMetadata(existing.metadata),
      ...metadata,
    };
    const shouldRefreshExisting =
      existing.source !== input.source
      || existing.workflow_run_id !== cleanText(input.workflowRunId)
      || existing.remote_jid !== remoteJid
      || existing.remote_phone !== remotePhone
      || existing.contact_name !== contactName
      || existing.message_text !== messageText
      || JSON.stringify(existing.metadata ?? {}) !== JSON.stringify(mergedMetadata);

    if (!shouldRefreshExisting) {
      return existing;
    }

    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("whatsapp_outbound_messages")
      .update({
        source: input.source,
        workflow_run_id: cleanText(input.workflowRunId),
        remote_jid: remoteJid,
        remote_phone: remotePhone,
        contact_name: contactName,
        message_text: messageText,
        metadata: mergedMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("user_id", input.userId)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return normalizeOutboundRecord(data as Record<string, unknown>);
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_outbound_messages")
    .insert({
      user_id: input.userId,
      source: input.source,
      approval_id: cleanText(input.approvalId),
      workflow_run_id: cleanText(input.workflowRunId),
      remote_jid: remoteJid,
      remote_phone: remotePhone,
      contact_name: contactName,
      message_text: messageText,
      idempotency_key: idempotencyKey,
      status: input.status,
      queued_at: now,
      approved_at: input.status === "approved" ? now : null,
      metadata,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeOutboundRecord(data as Record<string, unknown>);
}

export async function getWhatsAppOutboundMessage(input: {
  userId: string;
  outboundMessageId?: string | null;
  approvalId?: string | null;
  workflowRunId?: string | null;
  idempotencyKey?: string | null;
}) {
  return getWhatsAppOutboundMessageByFilter(input.userId, {
    id: input.outboundMessageId,
    approvalId: input.approvalId,
    workflowRunId: input.workflowRunId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function transitionWhatsAppOutboundMessage(input: TransitionWhatsAppOutboundMessageInput) {
  const existing = await getWhatsAppOutboundMessageByFilter(input.userId, {
    id: input.outboundMessageId,
    idempotencyKey: input.idempotencyKey,
  });
  if (!existing) {
    return null;
  }

  if (!shouldApplyTransition(existing.status, input.nextStatus, Boolean(input.force))) {
    return existing;
  }

  const waMessageIds = [...new Set([
    ...existing.wa_message_ids,
    ...(input.waMessageIds ?? []).map((value) => cleanText(value)).filter(Boolean) as string[],
  ])];
  const metadata = {
    ...normalizeMetadata(existing.metadata),
    ...normalizeMetadata(input.metadata),
  };

  const payload = {
    status: input.nextStatus,
    attempt_count: typeof input.attemptCount === "number" && Number.isFinite(input.attemptCount)
      ? Math.max(existing.attempt_count, Math.trunc(input.attemptCount))
      : existing.attempt_count,
    wa_message_ids: waMessageIds,
    error_message: cleanText(input.errorMessage) ?? existing.error_message,
    approved_at: nextTimestampIfMissing(existing.approved_at, input.nextStatus, "approved"),
    sent_at: nextTimestampIfMissing(existing.sent_at, input.nextStatus, "sent"),
    delivered_at: nextTimestampIfMissing(existing.delivered_at, input.nextStatus, "delivered"),
    read_at: nextTimestampIfMissing(existing.read_at, input.nextStatus, "read"),
    failed_at: nextTimestampIfMissing(existing.failed_at, input.nextStatus, "failed"),
    metadata,
    updated_at: new Date().toISOString(),
  };

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_outbound_messages")
    .update(payload)
    .eq("id", existing.id)
    .eq("user_id", input.userId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeOutboundRecord(data as Record<string, unknown>);
}

export async function markWhatsAppOutboundAckByWaMessageId(input: {
  userId: string;
  waMessageId: string;
  ackStatus: WhatsAppMessageAckStatus;
}) {
  const waMessageId = cleanText(input.waMessageId);
  if (!waMessageId) {
    return null;
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_outbound_messages")
    .select("*")
    .eq("user_id", input.userId)
    .contains("wa_message_ids", [waMessageId])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const existing = data ? normalizeOutboundRecord(data as Record<string, unknown>) : null;
  if (!existing) {
    return null;
  }

  const updated = await transitionWhatsAppOutboundMessage({
    userId: input.userId,
    outboundMessageId: existing.id,
    nextStatus: resolveWhatsAppOutboundStatusFromAckStatus(input.ackStatus),
    errorMessage: input.ackStatus === "error" ? "WhatsApp reported a delivery error." : null,
  });

  const now = new Date().toISOString();
  if (input.ackStatus === "delivery_ack" || input.ackStatus === "read") {
    await supabaseAdmin
      .from("whatsapp_messages")
      .update({
        delivered_at: now,
        ...(input.ackStatus === "read" ? { read_at: now } : {}),
      })
      .eq("user_id", input.userId)
      .eq("wa_message_id", waMessageId)
      .catch(() => null);
  }

  return updated;
}
