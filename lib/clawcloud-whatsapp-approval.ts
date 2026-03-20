import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { getUserLocale, translateMessage } from "@/lib/clawcloud-i18n";
import { sendClawCloudWhatsAppToPhone } from "@/lib/clawcloud-whatsapp";
import {
  markLatestWhatsAppThreadState,
  writeWhatsAppAuditLog,
} from "@/lib/clawcloud-whatsapp-control";
import type {
  WhatsAppContactPriority,
  WhatsAppReplyApproval,
  WhatsAppSensitivity,
} from "@/lib/clawcloud-whatsapp-workspace-types";

type QueueWhatsAppReplyApprovalInput = {
  userId: string;
  remoteJid: string | null;
  remotePhone: string | null;
  contactName: string | null;
  sourceMessage: string;
  draftReply: string;
  sensitivity: WhatsAppSensitivity;
  confidence: number;
  reason: string;
  priority: WhatsAppContactPriority;
  auditPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

function shortId(id: string) {
  return id.slice(0, 8);
}

async function findApprovalByShortId(userId: string, candidateId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_reply_approvals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(100);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as WhatsAppReplyApproval[]).find((item) =>
    item.id.toLowerCase().startsWith(candidateId.toLowerCase()),
  ) ?? null;
}

async function syncWorkflowRunFromApproval(
  userId: string,
  approval: WhatsAppReplyApproval,
  action: "send" | "skip",
) {
  const workflowRunId = String(approval.metadata?.workflow_run_id ?? "").trim();
  if (!workflowRunId) {
    return;
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  await supabaseAdmin
    .from("whatsapp_workflow_runs")
    .update({
      status: action === "send" ? "sent" : "skipped",
      approval_state: action === "send" ? "approved" : "skipped",
      sent_at: action === "send" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", workflowRunId)
    .eq("user_id", userId)
    .catch(() => null);
}

export async function listWhatsAppReplyApprovals(userId: string, limit = 50) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_reply_approvals")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as WhatsAppReplyApproval[];
}

export async function queueWhatsAppReplyApproval(input: QueueWhatsAppReplyApprovalInput) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_reply_approvals")
    .insert({
      user_id: input.userId,
      remote_jid: input.remoteJid,
      remote_phone: input.remotePhone,
      contact_name: input.contactName,
      source_message: input.sourceMessage,
      draft_reply: input.draftReply,
      status: "pending",
      sensitivity: input.sensitivity,
      confidence: input.confidence,
      reason: input.reason,
      metadata: input.metadata ?? {},
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await markLatestWhatsAppThreadState({
    userId: input.userId,
    remoteJid: input.remoteJid,
    remotePhone: input.remotePhone,
    needsReply: true,
    approvalState: "pending",
    priority: input.priority,
    sensitivity: input.sensitivity,
    replyConfidence: input.confidence,
    auditPayload: {
      reason: input.reason,
      queued_at: new Date().toISOString(),
      ...(input.auditPayload ?? {}),
    },
  }).catch(() => null);

  await writeWhatsAppAuditLog(input.userId, {
    eventType: "reply_queued",
    actor: "system",
    summary: `Queued WhatsApp reply approval for ${input.contactName || input.remotePhone || "contact"}.`,
    targetValue: input.remoteJid ?? input.remotePhone,
    metadata: {
      reason: input.reason,
      confidence: input.confidence,
      sensitivity: input.sensitivity,
      ...(input.auditPayload ?? {}),
    },
  }).catch(() => null);

  return data as WhatsAppReplyApproval;
}

export async function updateWhatsAppReplyApproval(
  userId: string,
  approvalId: string,
  input: {
    action: "send" | "skip";
    draftReply?: string;
  },
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_reply_approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const approval = data as WhatsAppReplyApproval | null;
  if (!approval) {
    throw new Error("WhatsApp approval not found.");
  }

  if (approval.status !== "pending") {
    throw new Error(`Approval is already ${approval.status}.`);
  }

  if (input.action === "skip") {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("whatsapp_reply_approvals")
      .update({
        status: "skipped",
        updated_at: new Date().toISOString(),
      })
      .eq("id", approval.id)
      .select("*")
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    await markLatestWhatsAppThreadState({
      userId,
      remoteJid: approval.remote_jid,
      remotePhone: approval.remote_phone,
      needsReply: false,
      approvalState: "skipped",
      replyConfidence: approval.confidence,
      sensitivity: approval.sensitivity,
      auditPayload: {
        skipped_at: new Date().toISOString(),
      },
    }).catch(() => null);

    await writeWhatsAppAuditLog(userId, {
      eventType: "reply_skipped",
      actor: "user",
      summary: `Skipped WhatsApp reply for ${approval.contact_name || approval.remote_phone || "contact"}.`,
      targetValue: approval.remote_jid ?? approval.remote_phone,
      metadata: {
        approval_id: approval.id,
      },
    }).catch(() => null);

    await syncWorkflowRunFromApproval(userId, approval, "skip").catch(() => null);

    return updated as WhatsAppReplyApproval;
  }

  const draftReply = input.draftReply?.trim() || approval.draft_reply;
  await sendClawCloudWhatsAppToPhone(approval.remote_phone, draftReply, {
    userId,
    contactName: approval.contact_name,
    jid: approval.remote_jid,
  });

  const nextStatus = draftReply === approval.draft_reply ? "sent" : "edited";
  const { data: updated, error: updateError } = await supabaseAdmin
    .from("whatsapp_reply_approvals")
    .update({
      status: nextStatus,
      draft_reply: draftReply,
      updated_at: new Date().toISOString(),
    })
    .eq("id", approval.id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(updateError.message);
  }

  await markLatestWhatsAppThreadState({
    userId,
    remoteJid: approval.remote_jid,
    remotePhone: approval.remote_phone,
    needsReply: false,
    approvalState: "approved",
    replyConfidence: approval.confidence,
    sensitivity: approval.sensitivity,
    auditPayload: {
      sent_at: new Date().toISOString(),
      approval_id: approval.id,
    },
  }).catch(() => null);

  await writeWhatsAppAuditLog(userId, {
    eventType: "reply_sent",
    actor: "user",
    summary: `Sent approved WhatsApp reply to ${approval.contact_name || approval.remote_phone || "contact"}.`,
    targetValue: approval.remote_jid ?? approval.remote_phone,
    metadata: {
      approval_id: approval.id,
      edited: nextStatus === "edited",
      },
    }).catch(() => null);

  await syncWorkflowRunFromApproval(userId, approval, "send").catch(() => null);

  return updated as WhatsAppReplyApproval;
}

export async function handleWhatsAppApprovalCommand(userId: string, message: string) {
  const locale = await getUserLocale(userId);
  const sendMatch = message.match(/^WSEND\s+([a-f0-9-]{6,})/i);
  const editMatch = message.match(/^WEDIT\s+([a-f0-9-]{6,})\s+([\s\S]+)/i);
  const skipMatch = message.match(/^WSKIP\s+([a-f0-9-]{6,})/i);

  if (!sendMatch && !editMatch && !skipMatch) {
    return { handled: false, response: "" };
  }

  const approval = await findApprovalByShortId(
    userId,
    sendMatch?.[1] ?? editMatch?.[1] ?? skipMatch?.[1] ?? "",
  );

  if (!approval) {
    return {
      handled: true,
      response: await translateMessage(
        "I could not find that WhatsApp approval. It may already be handled.",
        locale,
      ),
    };
  }

  if (skipMatch) {
    await updateWhatsAppReplyApproval(userId, approval.id, { action: "skip" });
    return {
      handled: true,
      response: await translateMessage(
        `Skipped the pending WhatsApp reply for ${approval.contact_name || approval.remote_phone || "that contact"}.`,
        locale,
      ),
    };
  }

  const finalDraft = editMatch?.[2]?.trim() || approval.draft_reply;
  await updateWhatsAppReplyApproval(userId, approval.id, {
    action: "send",
    draftReply: finalDraft,
  });

  return {
    handled: true,
    response: await translateMessage(
      `Sent the WhatsApp reply to ${approval.contact_name || approval.remote_phone || "that contact"}.`,
      locale,
    ),
  };
}

export function buildWhatsAppApprovalNotice(approval: WhatsAppReplyApproval) {
  const who = approval.contact_name || approval.remote_phone || "contact";
  return [
    `📲 *Reply waiting for approval: ${who}*`,
    "",
    `*Incoming:* ${approval.source_message.slice(0, 180)}`,
    "",
    "*Suggested reply:*",
    approval.draft_reply.slice(0, 260),
    "",
    `Use \`WSEND ${shortId(approval.id)}\` to send`,
    `Use \`WEDIT ${shortId(approval.id)} your new reply\` to edit and send`,
    `Use \`WSKIP ${shortId(approval.id)}\` to ignore`,
  ].join("\n");
}
