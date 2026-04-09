import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  defaultWhatsAppSettings,
  type WhatsAppActiveContactSession,
  type WhatsAppApprovalState,
  type WhatsAppAutomationMode,
  type WhatsAppContactPriority,
  type WhatsAppGroupReplyMode,
  type WhatsAppPendingContactOption,
  type WhatsAppPendingContactResolution,
  type WhatsAppPendingContactResolutionKind,
  type WhatsAppReplyMode,
  type WhatsAppSensitivity,
  type WhatsAppSettings,
  type WhatsAppVerifiedContactSelection,
} from "@/lib/clawcloud-whatsapp-workspace-types";

const automationModes = new Set<WhatsAppAutomationMode>([
  "auto_reply",
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

function normalizeActiveContactSession(value: unknown): WhatsAppActiveContactSession | null {
  const raw = value && typeof value === "object"
    ? value as Partial<Record<keyof WhatsAppActiveContactSession, unknown>>
    : null;

  const contactName = typeof raw?.contactName === "string" && raw.contactName.trim()
    ? raw.contactName.trim()
    : null;
  if (!contactName) {
    return null;
  }

  const phone = typeof raw?.phone === "string" && raw.phone.trim()
    ? raw.phone.trim()
    : null;
  const jid = typeof raw?.jid === "string" && raw.jid.trim()
    ? raw.jid.trim()
    : null;
  const startedAt = typeof raw?.startedAt === "string" && raw.startedAt.trim()
    ? raw.startedAt.trim()
    : new Date().toISOString();
  const sourceMessage = typeof raw?.sourceMessage === "string" && raw.sourceMessage.trim()
    ? raw.sourceMessage.trim()
    : null;

  return {
    contactName,
    phone,
    jid,
    startedAt,
    sourceMessage,
  };
}

function normalizePendingContactOptions(value: unknown): WhatsAppPendingContactOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      const raw = item && typeof item === "object"
        ? item as Partial<Record<keyof WhatsAppPendingContactOption, unknown>>
        : null;
      const name = typeof raw?.name === "string" && raw.name.trim()
        ? raw.name.trim()
        : null;
      if (!name) {
        return null;
      }

      return {
        name,
        phone: typeof raw?.phone === "string" && raw.phone.trim()
          ? raw.phone.trim()
          : null,
        jid: typeof raw?.jid === "string" && raw.jid.trim()
          ? raw.jid.trim()
          : null,
      };
    })
    .filter((item): item is WhatsAppPendingContactOption => Boolean(item));
}

function normalizePendingContactResolution(value: unknown): WhatsAppPendingContactResolution | null {
  const raw = value && typeof value === "object"
    ? value as Partial<Record<keyof WhatsAppPendingContactResolution, unknown>>
    : null;
  const kind = typeof raw?.kind === "string"
    ? raw.kind.trim()
    : "";
  const allowedKinds = new Set<WhatsAppPendingContactResolutionKind>([
    "active_contact_start",
    "whatsapp_history",
    "send_message",
  ]);
  if (!allowedKinds.has(kind as WhatsAppPendingContactResolutionKind)) {
    return null;
  }

  const requestedName = typeof raw?.requestedName === "string" && raw.requestedName.trim()
    ? raw.requestedName.trim()
    : null;
  const resumePrompt = typeof raw?.resumePrompt === "string" && raw.resumePrompt.trim()
    ? raw.resumePrompt.trim()
    : null;
  const options = normalizePendingContactOptions(raw?.options);
  if (!requestedName || !resumePrompt || !options.length) {
    return null;
  }

  const draftMessage = typeof raw?.draftMessage === "string" && raw.draftMessage.trim()
    ? raw.draftMessage.trim()
    : null;

  const createdAt = typeof raw?.createdAt === "string" && raw.createdAt.trim()
    ? raw.createdAt.trim()
    : new Date().toISOString();

  return {
    kind: kind as WhatsAppPendingContactResolutionKind,
    requestedName,
    resumePrompt,
    options,
    draftMessage,
    createdAt,
  };
}

function normalizeVerifiedContactSelection(value: unknown): WhatsAppVerifiedContactSelection | null {
  const raw = value && typeof value === "object"
    ? value as Partial<Record<keyof WhatsAppVerifiedContactSelection, unknown>>
    : null;
  const kind = typeof raw?.kind === "string"
    ? raw.kind.trim()
    : "";
  const allowedKinds = new Set<WhatsAppPendingContactResolutionKind>([
    "active_contact_start",
    "whatsapp_history",
    "send_message",
  ]);
  if (!allowedKinds.has(kind as WhatsAppPendingContactResolutionKind)) {
    return null;
  }

  const requestedName = typeof raw?.requestedName === "string" && raw.requestedName.trim()
    ? raw.requestedName.trim()
    : null;
  const contactName = typeof raw?.contactName === "string" && raw.contactName.trim()
    ? raw.contactName.trim()
    : null;
  const resumePrompt = typeof raw?.resumePrompt === "string" && raw.resumePrompt.trim()
    ? raw.resumePrompt.trim()
    : null;
  if (!requestedName || !contactName || !resumePrompt) {
    return null;
  }

  const phone = typeof raw?.phone === "string" && raw.phone.trim()
    ? raw.phone.trim()
    : null;
  const jid = typeof raw?.jid === "string" && raw.jid.trim()
    ? raw.jid.trim()
    : null;
  if (!phone && !jid) {
    return null;
  }

  const verifiedAt = typeof raw?.verifiedAt === "string" && raw.verifiedAt.trim()
    ? raw.verifiedAt.trim()
    : new Date().toISOString();

  return {
    kind: kind as WhatsAppPendingContactResolutionKind,
    requestedName,
    contactName,
    phone,
    jid,
    resumePrompt,
    verifiedAt,
  };
}

function normalizeSettings(value: unknown): WhatsAppSettings {
  const raw = value && typeof value === "object"
    ? (value as Partial<Record<keyof WhatsAppSettings, unknown>>)
    : {};

  const requestedAutomationMode =
    typeof raw.automationMode === "string" && automationModes.has(raw.automationMode as WhatsAppAutomationMode)
      ? (raw.automationMode as WhatsAppAutomationMode)
      : defaultWhatsAppSettings.automationMode;
  const automationMode = (
    requestedAutomationMode === "auto_reply"
    || requestedAutomationMode === "approve_before_send"
  )
    ? "read_only"
    : requestedAutomationMode;
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
    requireApprovalForSensitive: false,
    allowGroupReplies:
      typeof raw.allowGroupReplies === "boolean"
        ? raw.allowGroupReplies
        : defaultWhatsAppSettings.allowGroupReplies,
    allowDirectSendCommands:
      typeof raw.allowDirectSendCommands === "boolean"
        ? raw.allowDirectSendCommands
        : defaultWhatsAppSettings.allowDirectSendCommands,
    requireApprovalForNewContacts: false,
    requireApprovalForFirstOutreach: false,
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
    activeContactSession: normalizeActiveContactSession(
      raw.activeContactSession
      ?? (raw as Record<string, unknown>).active_contact_session
      ?? null,
    ),
    pendingContactResolution: normalizePendingContactResolution(
      raw.pendingContactResolution
      ?? (raw as Record<string, unknown>).pending_contact_resolution
      ?? null,
    ),
    recentVerifiedContactSelection: normalizeVerifiedContactSelection(
      raw.recentVerifiedContactSelection
      ?? (raw as Record<string, unknown>).recent_verified_contact_selection
      ?? null,
    ),
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

export async function setWhatsAppActiveContactSession(
  userId: string,
  session: WhatsAppActiveContactSession | null,
) {
  const settings = await upsertWhatsAppSettings(userId, {
    activeContactSession: session,
  });
  return settings.activeContactSession;
}

export async function clearWhatsAppActiveContactSession(userId: string) {
  await setWhatsAppActiveContactSession(userId, null);
}

export async function setWhatsAppPendingContactResolution(
  userId: string,
  resolution: WhatsAppPendingContactResolution | null,
) {
  const settings = await upsertWhatsAppSettings(userId, {
    pendingContactResolution: resolution,
  });
  return settings.pendingContactResolution;
}

export async function clearWhatsAppPendingContactResolution(userId: string) {
  await setWhatsAppPendingContactResolution(userId, null);
}

export async function setWhatsAppRecentVerifiedContactSelection(
  userId: string,
  selection: WhatsAppVerifiedContactSelection | null,
) {
  const settings = await upsertWhatsAppSettings(userId, {
    recentVerifiedContactSelection: selection,
  });
  return settings.recentVerifiedContactSelection;
}

export async function clearWhatsAppRecentVerifiedContactSelection(userId: string) {
  await setWhatsAppRecentVerifiedContactSelection(userId, null);
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
  chatType?: "direct" | "group" | "self" | "broadcast" | "unknown";
  isGroupMessage: boolean;
  isKnownContact?: boolean;
  timeZone?: string | null;
}) {
  if (input.chatType === "self") {
    return { action: "send" as const, reason: "Owner self-chat should always receive direct answers." };
  }

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

  if (
    input.settings.automationMode === "auto_reply"
    || input.settings.automationMode === "approve_before_send"
  ) {
    return {
      action: "block" as const,
      reason: "Autonomous outbound mode is retired. A direct user command is required before ClawCloud sends anything.",
    };
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
