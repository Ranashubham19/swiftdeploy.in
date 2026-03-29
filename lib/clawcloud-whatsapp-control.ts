import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  defaultWhatsAppSettings,
  type WhatsAppApprovalState,
  type WhatsAppAutomationMode,
  type WhatsAppContactPriority,
  type WhatsAppGroupReplyMode,
  type WhatsAppReplyMode,
  type WhatsAppSensitivity,
  type WhatsAppSettings,
} from "@/lib/clawcloud-whatsapp-workspace-types";

const automationModes = new Set<WhatsAppAutomationMode>([
  "read_only",
  "suggest_only",
  "approve_before_send",
]);

const replyModes = new Set<WhatsAppReplyMode>([
  "balanced",
  "professional",
  "friendly",
  "brief",
]);

const groupReplyModes = new Set<WhatsAppGroupReplyMode>([
  "mention_only",
  "allow",
  "never",
]);

const priorities = new Set<WhatsAppContactPriority>(["low", "normal", "high", "vip"]);

function normalizeOptionalTime(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return /^\d{2}:\d{2}$/.test(trimmed) ? trimmed : null;
}

function normalizeRetentionDays(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return defaultWhatsAppSettings.retentionDays;
  }

  const rounded = Math.round(value);
  return Math.min(3650, Math.max(7, rounded));
}

function normalizeSettings(value: unknown): WhatsAppSettings {
  const raw = value && typeof value === "object"
    ? (value as Partial<Record<keyof WhatsAppSettings, unknown>>)
    : {};

  const automationMode = typeof raw.automationMode === "string" && automationModes.has(raw.automationMode as WhatsAppAutomationMode)
    ? (raw.automationMode as WhatsAppAutomationMode)
    : defaultWhatsAppSettings.automationMode;
  const replyMode = typeof raw.replyMode === "string" && replyModes.has(raw.replyMode as WhatsAppReplyMode)
    ? (raw.replyMode as WhatsAppReplyMode)
    : defaultWhatsAppSettings.replyMode;
  const groupReplyMode = typeof raw.groupReplyMode === "string" && groupReplyModes.has(raw.groupReplyMode as WhatsAppGroupReplyMode)
    ? (raw.groupReplyMode as WhatsAppGroupReplyMode)
    : defaultWhatsAppSettings.groupReplyMode;

  return {
    automationMode,
    replyMode,
    groupReplyMode,
    requireApprovalForSensitive:
      typeof raw.requireApprovalForSensitive === "boolean"
        ? raw.requireApprovalForSensitive
        : defaultWhatsAppSettings.requireApprovalForSensitive,
    allowGroupReplies:
      typeof raw.allowGroupReplies === "boolean"
        ? raw.allowGroupReplies
        : defaultWhatsAppSettings.allowGroupReplies,
    allowDirectSendCommands:
      typeof raw.allowDirectSendCommands === "boolean"
        ? raw.allowDirectSendCommands
        : defaultWhatsAppSettings.allowDirectSendCommands,
    requireApprovalForNewContacts:
      typeof raw.requireApprovalForNewContacts === "boolean"
        ? raw.requireApprovalForNewContacts
        : defaultWhatsAppSettings.requireApprovalForNewContacts,
    requireApprovalForFirstOutreach:
      typeof raw.requireApprovalForFirstOutreach === "boolean"
        ? raw.requireApprovalForFirstOutreach
        : defaultWhatsAppSettings.requireApprovalForFirstOutreach,
    allowWorkflowAutoSend:
      typeof raw.allowWorkflowAutoSend === "boolean"
        ? raw.allowWorkflowAutoSend
        : defaultWhatsAppSettings.allowWorkflowAutoSend,
    maskSensitivePreviews:
      typeof raw.maskSensitivePreviews === "boolean"
        ? raw.maskSensitivePreviews
        : defaultWhatsAppSettings.maskSensitivePreviews,
    retentionDays: normalizeRetentionDays(raw.retentionDays),
    quietHoursStart: normalizeOptionalTime(raw.quietHoursStart),
    quietHoursEnd: normalizeOptionalTime(raw.quietHoursEnd),
  };
}

export function sanitizeWhatsAppSettingsPatch(
  patch: Partial<Record<keyof WhatsAppSettings, unknown>>,
) {
  return normalizeSettings({ ...defaultWhatsAppSettings, ...patch });
}

export async function getWhatsAppSettings(userId: string): Promise<WhatsAppSettings> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("user_preferences")
    .select("whatsapp_settings")
    .eq("user_id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  return normalizeSettings(data?.whatsapp_settings);
}

export async function upsertWhatsAppSettings(
  userId: string,
  patch: Partial<Record<keyof WhatsAppSettings, unknown>>,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const current = await getWhatsAppSettings(userId);
  const next = sanitizeWhatsAppSettingsPatch({ ...current, ...patch });

  const { error } = await supabaseAdmin
    .from("user_preferences")
    .upsert(
      {
        user_id: userId,
        whatsapp_settings: next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (error) {
    throw new Error(error.message);
  }

  await writeWhatsAppAuditLog(userId, {
    eventType: "settings_updated",
    actor: "user",
    summary: "Updated WhatsApp assistant controls.",
    metadata: next,
  }).catch(() => null);

  return next;
}

export async function writeWhatsAppAuditLog(
  userId: string,
  input: {
    eventType: string;
    actor: string;
    summary: string;
    targetType?: string;
    targetValue?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("whatsapp_audit_log")
    .insert({
      user_id: userId,
      event_type: input.eventType,
      actor: input.actor,
      target_type: input.targetType ?? "chat",
      target_value: input.targetValue ?? null,
      summary: input.summary,
      metadata: input.metadata ?? {},
    });

  if (error) {
    throw new Error(error.message);
  }
}

export function detectWhatsAppSensitivity(text: string): WhatsAppSensitivity {
  const normalized = text.toLowerCase();

  if (
    /\b(otp|one.time password|verification code|bank account|cvv|upi pin|password|passcode|aadhaar|passport|confidential|salary slip|medical report|prescription|legal notice)\b/.test(normalized)
  ) {
    return "critical";
  }

  if (
    /\b(payment|invoice|money|pricing|quote|contract|agreement|offer letter|diagnosis|treatment|court|lawyer|tax|refund|bank|urgent approval)\b/.test(normalized)
  ) {
    return "sensitive";
  }

  return "normal";
}

export function scoreWhatsAppReplyConfidence(input: {
  sourceMessage: string;
  draftReply: string;
  sensitivity: WhatsAppSensitivity;
  isGroupMessage: boolean;
}) {
  let score = 0.82;

  if (input.sensitivity === "sensitive") {
    score -= 0.18;
  }
  if (input.sensitivity === "critical") {
    score -= 0.32;
  }
  if (input.isGroupMessage) {
    score -= 0.08;
  }
  if (input.sourceMessage.length < 12) {
    score -= 0.08;
  }
  if (input.sourceMessage.length > 420) {
    score -= 0.05;
  }
  if (input.draftReply.length < 8) {
    score -= 0.1;
  }

  return Math.max(0.35, Math.min(0.96, Math.round(score * 100) / 100));
}

export function getWhatsAppPriorityForMessage(
  text: string,
  contactPriority: WhatsAppContactPriority = "normal",
): WhatsAppContactPriority {
  const normalized = text.toLowerCase();
  if (contactPriority === "vip") {
    return "vip";
  }

  if (/\b(urgent|asap|immediately|today|right now|important|critical)\b/.test(normalized)) {
    return contactPriority === "high" ? "vip" : "high";
  }

  if (contactPriority === "high") {
    return "high";
  }

  if (/\b(when free|whenever|later|no rush)\b/.test(normalized)) {
    return "low";
  }

  return "normal";
}

function compareClockTimes(left: string, right: string) {
  return left.localeCompare(right);
}

function currentClock(timeZone = "Asia/Kolkata") {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date());

    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
    return `${hour === "24" ? "00" : hour}:${minute}`;
  } catch {
    return "00:00";
  }
}

export function isWithinWhatsAppQuietHours(
  settings: WhatsAppSettings,
  timeZone = "Asia/Kolkata",
) {
  if (!settings.quietHoursStart || !settings.quietHoursEnd) {
    return false;
  }

  const now = currentClock(timeZone);

  if (settings.quietHoursStart === settings.quietHoursEnd) {
    return true;
  }

  if (compareClockTimes(settings.quietHoursStart, settings.quietHoursEnd) < 0) {
    return (
      compareClockTimes(now, settings.quietHoursStart) >= 0
      && compareClockTimes(now, settings.quietHoursEnd) < 0
    );
  }

  return (
    compareClockTimes(now, settings.quietHoursStart) >= 0
    || compareClockTimes(now, settings.quietHoursEnd) < 0
  );
}

export function decideWhatsAppReplyAction(input: {
  settings: WhatsAppSettings;
  sensitivity: WhatsAppSensitivity;
  isGroupMessage: boolean;
  isKnownContact?: boolean;
  timeZone?: string | null;
}) {
  if (input.isGroupMessage) {
    if (!input.settings.allowGroupReplies || input.settings.groupReplyMode === "never") {
      return { action: "block" as const, reason: "Group replies are disabled." };
    }
  }

  if (
    isWithinWhatsAppQuietHours(
      input.settings,
      input.timeZone && input.timeZone.trim() ? input.timeZone : "Asia/Kolkata",
    )
  ) {
    return { action: "queue" as const, reason: "Message arrived during quiet hours." };
  }

  if (input.settings.automationMode === "read_only") {
    return { action: "block" as const, reason: "Automation mode is read-only." };
  }

  if (input.settings.automationMode === "suggest_only") {
    return { action: "queue" as const, reason: "Automation mode is suggest-only." };
  }

  if (input.settings.automationMode === "approve_before_send") {
    return { action: "queue" as const, reason: "Replies require approval before sending." };
  }

  if (!input.isGroupMessage && input.settings.requireApprovalForNewContacts && input.isKnownContact === false) {
    return { action: "queue" as const, reason: "New contacts require approval before ClawCloud replies." };
  }

  if (input.settings.requireApprovalForSensitive && input.sensitivity !== "normal") {
    return { action: "queue" as const, reason: "Sensitive content requires approval." };
  }

  return { action: "send" as const, reason: "Reply can be sent automatically." };
}

export function shouldRequireExplicitUserCommandForWhatsAppChat(
  chatType: "direct" | "group" | "self" | "broadcast" | "unknown",
) {
  return chatType !== "self";
}

export function applyWhatsAppReplyMode(reply: string, mode: WhatsAppReplyMode) {
  const cleaned = reply.replace(/\n{3,}/g, "\n\n").trim();

  if (mode === "brief") {
    const sentences = cleaned
      .split(/(?<=[.!?])\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .slice(0, 2);
    return sentences.join(" ").slice(0, 240).trim();
  }

  if (mode === "professional") {
    return cleaned
      .replace(/\s{2,}/g, " ")
      .replace(/!{2,}/g, "!")
      .trim();
  }

  if (mode === "friendly" && cleaned.length > 0 && !/^(hi|hello|hey)\b/i.test(cleaned)) {
    return `Hi! ${cleaned}`;
  }

  return cleaned;
}

export async function markLatestWhatsAppThreadState(input: {
  userId: string;
  remoteJid?: string | null;
  remotePhone?: string | null;
  needsReply: boolean;
  approvalState: WhatsAppApprovalState;
  priority?: WhatsAppContactPriority;
  sensitivity?: WhatsAppSensitivity;
  replyConfidence?: number | null;
  auditPayload?: Record<string, unknown>;
}) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  let query = supabaseAdmin
    .from("whatsapp_messages")
    .select("id")
    .eq("user_id", input.userId)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1);

  if (input.remoteJid) {
    query = query.eq("remote_jid", input.remoteJid);
  } else if (input.remotePhone) {
    query = query.eq("remote_phone", input.remotePhone);
  }

  const { data } = await query.maybeSingle().catch(() => ({ data: null }));
  if (!data?.id) {
    return;
  }

  await supabaseAdmin
    .from("whatsapp_messages")
    .update({
      needs_reply: input.needsReply,
      approval_state: input.approvalState,
      priority: input.priority,
      sensitivity: input.sensitivity,
      reply_confidence: input.replyConfidence ?? null,
      audit_payload: input.auditPayload ?? {},
    })
    .eq("id", data.id)
    .catch(() => null);
}

export function normalizeWhatsAppPriority(value: unknown): WhatsAppContactPriority {
  return typeof value === "string" && priorities.has(value as WhatsAppContactPriority)
    ? (value as WhatsAppContactPriority)
    : "normal";
}

export function maskWhatsAppContentPreview(
  content: string | null | undefined,
  maskSensitive: boolean,
  sensitivity: WhatsAppSensitivity = "normal",
) {
  const text = String(content ?? "").trim();
  if (!text) {
    return "";
  }

  if (!maskSensitive || sensitivity === "normal") {
    return text;
  }

  const visible = text.slice(0, 24);
  return `${visible}${text.length > 24 ? "..." : ""} [masked]`;
}
