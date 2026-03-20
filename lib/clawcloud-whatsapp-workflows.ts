import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { queueWhatsAppReplyApproval } from "@/lib/clawcloud-whatsapp-approval";
import { getWhatsAppSettings, writeWhatsAppAuditLog } from "@/lib/clawcloud-whatsapp-control";
import { sendClawCloudWhatsAppToPhone } from "@/lib/clawcloud-whatsapp";
import type {
  WhatsAppApprovalState,
  WhatsAppContactPriority,
  WhatsAppWorkflow,
  WhatsAppWorkflowRun,
  WhatsAppWorkflowScope,
  WhatsAppWorkflowType,
} from "@/lib/clawcloud-whatsapp-workspace-types";

type WorkflowSeed = Omit<WhatsAppWorkflow, "id" | "user_id" | "created_at" | "updated_at">;

type ScheduleWorkflowInput = {
  userId: string;
  remoteJid: string | null;
  remotePhone: string | null;
  contactName: string | null;
  text: string;
  chatType: "direct" | "group" | "self" | "broadcast" | "unknown";
  priority: WhatsAppContactPriority;
  tags: string[];
  messageType: string;
  finalReply: string | null;
  replySent: boolean;
};

const defaultWorkflowSeeds: WorkflowSeed[] = [
  {
    workflow_type: "missed_reply_follow_up",
    title: "Missed reply follow-up",
    description: "Schedule a polite follow-up after ClawCloud replies in an important direct chat.",
    is_enabled: false,
    approval_required: true,
    delay_minutes: 180,
    scope: "direct",
    trigger_keywords: [],
    template: "Hi {name}, just following up on our earlier chat. Let me know if you need anything else from me.",
    config: {},
  },
  {
    workflow_type: "payment_follow_up",
    title: "Payment follow-up",
    description: "Prepare a payment reminder when a payment or invoice thread is active.",
    is_enabled: false,
    approval_required: true,
    delay_minutes: 240,
    scope: "direct",
    trigger_keywords: ["payment", "invoice", "pricing", "refund", "upi"],
    template: "Hi {name}, following up on the payment thread. Happy to help if you need the invoice, amount, or any clarification.",
    config: {},
  },
  {
    workflow_type: "meeting_confirmation",
    title: "Meeting confirmation",
    description: "Prepare a confirmation or reminder for meeting-related chats.",
    is_enabled: false,
    approval_required: true,
    delay_minutes: 60,
    scope: "direct",
    trigger_keywords: ["meeting", "call", "demo", "interview", "schedule", "zoom", "gmeet"],
    template: "Hi {name}, confirming our meeting thread. Let me know if the timing still works or if you'd like to reschedule.",
    config: {},
  },
  {
    workflow_type: "lead_nurture",
    title: "Lead nurture",
    description: "Create a follow-up for warm lead or client conversations.",
    is_enabled: false,
    approval_required: true,
    delay_minutes: 360,
    scope: "direct",
    trigger_keywords: ["demo", "proposal", "quote", "pricing", "trial", "follow up"],
    template: "Hi {name}, checking back on our earlier conversation. If you'd like, I can share the next steps or answer any open questions.",
    config: {},
  },
  {
    workflow_type: "group_digest",
    title: "Group digest",
    description: "Prepare a concise group digest for busy WhatsApp groups.",
    is_enabled: false,
    approval_required: true,
    delay_minutes: 120,
    scope: "group",
    trigger_keywords: [],
    template: "Quick group summary: {message}",
    config: {},
  },
];

function uniqueKeywords(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function sanitizeScope(value: unknown): WhatsAppWorkflowScope {
  return value === "group" || value === "all" ? value : "direct";
}

function normalizeDelayMinutes(value: unknown, fallback = 120) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(10080, Math.max(5, Math.round(value)));
}

function normalizeWorkflowRecord(value: Partial<WhatsAppWorkflow> & Record<string, unknown>, seed: WorkflowSeed): WorkflowSeed {
  return {
    workflow_type: seed.workflow_type,
    title: typeof value.title === "string" && value.title.trim() ? value.title.trim() : seed.title,
    description: typeof value.description === "string" ? value.description.trim() || null : seed.description,
    is_enabled: typeof value.is_enabled === "boolean" ? value.is_enabled : seed.is_enabled,
    approval_required:
      typeof value.approval_required === "boolean" ? value.approval_required : seed.approval_required,
    delay_minutes: normalizeDelayMinutes(value.delay_minutes, seed.delay_minutes),
    scope: sanitizeScope(value.scope),
    trigger_keywords: Array.isArray(value.trigger_keywords)
      ? uniqueKeywords(value.trigger_keywords.filter((item): item is string => typeof item === "string"))
      : seed.trigger_keywords,
    template: typeof value.template === "string" ? value.template.trim() || null : seed.template,
    config: value.config && typeof value.config === "object"
      ? (value.config as Record<string, unknown>)
      : seed.config,
  };
}

function workflowSeedByType(type: WhatsAppWorkflowType) {
  return defaultWorkflowSeeds.find((item) => item.workflow_type === type) ?? defaultWorkflowSeeds[0];
}

function buildWorkflowReply(template: string | null, input: ScheduleWorkflowInput) {
  const messagePreview = input.text.replace(/\s+/g, " ").trim().slice(0, 180);
  const name = input.contactName || input.remotePhone || "there";
  const baseTemplate = template || workflowSeedByType("lead_nurture").template || "";
  return baseTemplate
    .replace(/\{name\}/g, name)
    .replace(/\{message\}/g, messagePreview)
    .replace(/\{priority\}/g, input.priority);
}

function workflowMatches(input: ScheduleWorkflowInput, workflow: WhatsAppWorkflow) {
  const lower = input.text.toLowerCase();
  const tagText = input.tags.join(" ").toLowerCase();
  const keywordMatch = workflow.trigger_keywords.some((keyword) => lower.includes(keyword));

  switch (workflow.workflow_type) {
    case "group_digest":
      return input.chatType === "group";
    case "payment_follow_up":
      return keywordMatch || /\b(payment|invoice|pricing|refund|upi|amount|bank)\b/.test(lower);
    case "meeting_confirmation":
      return keywordMatch || /\b(meeting|call|demo|interview|schedule|slot|zoom|gmeet)\b/.test(lower);
    case "lead_nurture":
      return /lead|client|prospect|sales/.test(tagText)
        || keywordMatch
        || /\b(demo|proposal|quote|pricing|trial|follow up)\b/.test(lower);
    case "missed_reply_follow_up":
      return input.chatType === "direct" && input.replySent;
    default:
      return false;
  }
}

async function ensureWhatsAppWorkflows(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_automation_workflows")
    .select("*")
    .eq("user_id", userId)
    .catch(() => ({ data: null, error: null }));

  if (error) {
    throw new Error(error.message);
  }

  const existing = (data ?? []) as WhatsAppWorkflow[];
  const existingTypes = new Set(existing.map((item) => item.workflow_type));
  const missing = defaultWorkflowSeeds
    .filter((seed) => !existingTypes.has(seed.workflow_type))
    .map((seed) => ({
      user_id: userId,
      ...seed,
    }));

  if (missing.length) {
    await supabaseAdmin
      .from("whatsapp_automation_workflows")
      .upsert(missing, { onConflict: "user_id,workflow_type" })
      .catch(() => null);
  }
}

export async function listWhatsAppWorkflows(userId: string) {
  await ensureWhatsAppWorkflows(userId);
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_automation_workflows")
    .select("*")
    .eq("user_id", userId)
    .order("workflow_type", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as WhatsAppWorkflow[];
}

export async function updateWhatsAppWorkflow(
  userId: string,
  workflowType: WhatsAppWorkflowType,
  patch: Partial<WhatsAppWorkflow>,
) {
  await ensureWhatsAppWorkflows(userId);
  const seed = workflowSeedByType(workflowType);
  const currentList = await listWhatsAppWorkflows(userId);
  const current = currentList.find((item) => item.workflow_type === workflowType);
  const next = normalizeWorkflowRecord({
    ...(current ?? {}),
    ...patch,
  }, seed);

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_automation_workflows")
    .upsert(
      {
        user_id: userId,
        ...next,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,workflow_type" },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await writeWhatsAppAuditLog(userId, {
    eventType: "workflow_updated",
    actor: "user",
    targetType: "workflow",
    targetValue: workflowType,
    summary: `Updated WhatsApp workflow ${next.title}.`,
    metadata: next,
  }).catch(() => null);

  return data as WhatsAppWorkflow;
}

export async function listWhatsAppWorkflowRuns(userId: string, limit = 80) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_workflow_runs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as WhatsAppWorkflowRun[];
}

async function cancelOpenRunsForThread(userId: string, remoteJid: string | null, remotePhone: string | null) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  let query = supabaseAdmin
    .from("whatsapp_workflow_runs")
    .update({
      status: "cancelled",
      approval_state: "skipped",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .in("status", ["scheduled", "pending_approval"]);

  if (remoteJid) {
    query = query.eq("remote_jid", remoteJid);
  } else if (remotePhone) {
    query = query.eq("remote_phone", remotePhone);
  } else {
    return;
  }

  await query.catch(() => null);
}

async function existingOpenRun(
  userId: string,
  workflowType: WhatsAppWorkflowType,
  remoteJid: string | null,
  remotePhone: string | null,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  let query = supabaseAdmin
    .from("whatsapp_workflow_runs")
    .select("id")
    .eq("user_id", userId)
    .eq("workflow_type", workflowType)
    .in("status", ["scheduled", "pending_approval"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (remoteJid) {
    query = query.eq("remote_jid", remoteJid);
  } else if (remotePhone) {
    query = query.eq("remote_phone", remotePhone);
  }

  const { data } = await query.maybeSingle().catch(() => ({ data: null }));
  return Boolean(data?.id);
}

export async function scheduleWhatsAppWorkflowRunsFromInbound(input: ScheduleWorkflowInput) {
  if (!input.remoteJid && !input.remotePhone) {
    return [];
  }

  await cancelOpenRunsForThread(input.userId, input.remoteJid, input.remotePhone);
  const workflows = (await listWhatsAppWorkflows(input.userId)).filter((workflow) => workflow.is_enabled);
  if (!workflows.length) {
    return [];
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const created: WhatsAppWorkflowRun[] = [];

  for (const workflow of workflows) {
    if (workflow.scope === "direct" && input.chatType !== "direct") continue;
    if (workflow.scope === "group" && input.chatType !== "group") continue;
    if (!workflowMatches(input, workflow)) continue;
    if (await existingOpenRun(input.userId, workflow.workflow_type, input.remoteJid, input.remotePhone)) continue;

    const dueAt = new Date(Date.now() + workflow.delay_minutes * 60_000).toISOString();
    const suggestedReply = buildWorkflowReply(workflow.template, input);
    const { data, error } = await supabaseAdmin
      .from("whatsapp_workflow_runs")
      .insert({
        user_id: input.userId,
        workflow_id: workflow.id,
        workflow_type: workflow.workflow_type,
        remote_jid: input.remoteJid,
        remote_phone: input.remotePhone,
        contact_name: input.contactName,
        source_message: input.text,
        suggested_reply: suggestedReply,
        status: "scheduled",
        approval_state: workflow.approval_required ? "pending" : "not_required",
        due_at: dueAt,
        metadata: {
          workflow_title: workflow.title,
          approval_required: workflow.approval_required,
          priority: input.priority,
          tags: input.tags,
          message_type: input.messageType,
          chat_type: input.chatType,
          preview_reply: input.finalReply,
        },
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    created.push(data as WhatsAppWorkflowRun);

    await writeWhatsAppAuditLog(input.userId, {
      eventType: "workflow_scheduled",
      actor: "system",
      targetType: "workflow",
      targetValue: workflow.workflow_type,
      summary: `Scheduled workflow ${workflow.title} for ${input.contactName || input.remotePhone || "contact"}.`,
      metadata: {
        due_at: dueAt,
        remote_jid: input.remoteJid,
      },
    }).catch(() => null);
  }

  return created;
}

export async function processDueWhatsAppWorkflowRuns(options?: { userId?: string | null; limit?: number }) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  let query = supabaseAdmin
    .from("whatsapp_workflow_runs")
    .select("*")
    .eq("status", "scheduled")
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(Math.min(Math.max(options?.limit ?? 25, 1), 100));

  if (options?.userId) {
    query = query.eq("user_id", options.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  const runs = (data ?? []) as WhatsAppWorkflowRun[];
  const processed: WhatsAppWorkflowRun[] = [];

  for (const run of runs) {
    const settings = await getWhatsAppSettings(run.user_id).catch(() => null);
    const approvalRequired = Boolean(run.metadata?.approval_required) || !(settings?.allowWorkflowAutoSend ?? false);

    if (approvalRequired) {
      await queueWhatsAppReplyApproval({
        userId: run.user_id,
        remoteJid: run.remote_jid,
        remotePhone: run.remote_phone,
        contactName: run.contact_name,
        sourceMessage: run.source_message || `Workflow: ${run.workflow_type}`,
        draftReply: run.suggested_reply || "",
        sensitivity: "normal",
        confidence: 0.74,
        reason: `Workflow: ${String(run.metadata?.workflow_title ?? run.workflow_type)}`,
        priority: "normal",
        auditPayload: {
          workflow_run_id: run.id,
          workflow_type: run.workflow_type,
        },
      }).catch(() => null);

      const { data: updated } = await supabaseAdmin
        .from("whatsapp_workflow_runs")
        .update({
          status: "pending_approval",
          approval_state: "pending",
          updated_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .select("*")
        .single()
        .catch(() => ({ data: run }));
      processed.push((updated ?? run) as WhatsAppWorkflowRun);
      continue;
    }

    await sendClawCloudWhatsAppToPhone(run.remote_phone, run.suggested_reply || "", {
      userId: run.user_id,
      contactName: run.contact_name,
      jid: run.remote_jid,
    });

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("whatsapp_workflow_runs")
      .update({
        status: "sent",
        approval_state: "not_required" as WhatsAppApprovalState,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    processed.push(updated as WhatsAppWorkflowRun);
    await writeWhatsAppAuditLog(run.user_id, {
      eventType: "workflow_sent",
      actor: "system",
      targetType: "workflow",
      targetValue: run.workflow_type,
      summary: `Sent workflow message for ${run.contact_name || run.remote_phone || "contact"}.`,
      metadata: {
        workflow_run_id: run.id,
        remote_jid: run.remote_jid,
      },
    }).catch(() => null);
  }

  return processed;
}
