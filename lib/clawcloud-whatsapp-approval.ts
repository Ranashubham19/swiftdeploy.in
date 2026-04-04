import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { getUserLocale, translateMessage } from "@/lib/clawcloud-i18n";
import { parseOutboundReviewDecision } from "@/lib/clawcloud-outbound-review";
import { sendClawCloudWhatsAppToPhone } from "@/lib/clawcloud-whatsapp";
import {
  ensureWhatsAppOutboundMessage,
  transitionWhatsAppOutboundMessage,
} from "@/lib/clawcloud-whatsapp-outbound";
import {
  markLatestWhatsAppThreadState,
  writeWhatsAppAuditLog,
} from "@/lib/clawcloud-whatsapp-control";
import type {
  WhatsAppContactPriority,
  WhatsAppOutboundSource,
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

function getApprovalGroupId(approval: WhatsAppReplyApproval) {
  const candidate = approval.metadata?.approval_group_id;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : approval.id;
}

function getApprovalConfirmationMode(approval: WhatsAppReplyApproval) {
  const candidate = approval.metadata?.confirmation_mode;
  return candidate === "broadcast_explicit" ? "broadcast_explicit" : "always";
}

function requiresExplicitBroadcastConfirmation(approval: WhatsAppReplyApproval) {
  return getApprovalConfirmationMode(approval) === "broadcast_explicit";
}

function getApprovalOutboundSource(metadata: Record<string, unknown> | null | undefined): WhatsAppOutboundSource {
  const workflowRunId = typeof metadata?.workflow_run_id === "string" ? metadata.workflow_run_id.trim() : "";
  if (workflowRunId) {
    return "workflow";
  }

  return metadata?.approval_origin === "send_command"
    ? "direct_command"
    : "approval";
}

function looksLikeExplicitBroadcastApproval(message: string) {
  const normalized = message.trim().replace(/\s+/g, " ").toLowerCase();
  return /^(?:yes|okay|ok|confirm|approve|send)\b/.test(normalized)
    && /\b(?:all|everyone|broadcast)\b/.test(normalized);
}

function buildWhatsAppDraftRewritePrompt(
  draftReply: string,
  who: string,
  feedback: string | null,
) {
  return completeClawCloudPrompt({
    system: [
      "You rewrite WhatsApp messages so they sound polished, natural, and professional.",
      "Return only the updated WhatsApp message text.",
      "Preserve the original intent, facts, names, and promised actions.",
      "Keep the language choice and relationship cues from the current draft.",
      "If the user gives revision feedback, follow it closely.",
      "Do not add placeholders or explanations.",
    ].join("\n"),
    user: [
      `Recipient: ${who}`,
      `Current draft:\n${draftReply}`,
      feedback
        ? `Revision request: ${feedback}`
        : "Revision request: Rewrite this to sound more polished, accurate, and professional while keeping the same meaning.",
    ].join("\n\n"),
    intent: "send_message",
    maxTokens: 220,
    fallback: draftReply,
  });
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

export async function getLatestPendingWhatsAppApprovalGroup(userId: string) {
  const approvals = (await listWhatsAppReplyApprovals(userId, 100))
    .filter((approval) => approval.status === "pending");
  const latest = approvals[0] ?? null;
  if (!latest) {
    return null;
  }

  const groupId = getApprovalGroupId(latest);
  const grouped = approvals
    .filter((approval) => getApprovalGroupId(approval) === groupId)
    .sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));

  return {
    groupId,
    approvals: grouped,
    latestCreatedAt: latest.created_at,
  };
}

async function updateWhatsAppApprovalDrafts(
  approvalIds: string[],
  draftReply: string,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_reply_approvals")
    .update({
      draft_reply: draftReply,
      updated_at: new Date().toISOString(),
    })
    .in("id", approvalIds)
    .select("*");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as WhatsAppReplyApproval[];
}

export async function queueWhatsAppReplyApproval(input: QueueWhatsAppReplyApprovalInput) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const metadata = {
    ...(input.metadata ?? {}),
    sensitivity: input.sensitivity,
  };
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
      metadata,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const approval = data as WhatsAppReplyApproval;

  await ensureWhatsAppOutboundMessage({
    userId: input.userId,
    source: getApprovalOutboundSource(approval.metadata),
    approvalId: approval.id,
    workflowRunId:
      typeof approval.metadata?.workflow_run_id === "string"
        ? approval.metadata.workflow_run_id
        : null,
    remoteJid: input.remoteJid,
    remotePhone: input.remotePhone,
    contactName: input.contactName,
    messageText: input.draftReply,
    status: "approval_required",
    metadata,
  }).catch(() => null);

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

  return approval;
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
    const outbound = await ensureWhatsAppOutboundMessage({
      userId,
      source: getApprovalOutboundSource(approval.metadata),
      approvalId: approval.id,
      workflowRunId:
        typeof approval.metadata?.workflow_run_id === "string"
          ? approval.metadata.workflow_run_id
          : null,
      remoteJid: approval.remote_jid,
      remotePhone: approval.remote_phone,
      contactName: approval.contact_name,
      messageText: approval.draft_reply,
      status: "approval_required",
      metadata: approval.metadata ?? {},
    }).catch(() => null);

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
    if (outbound) {
      await transitionWhatsAppOutboundMessage({
        userId,
        outboundMessageId: outbound.id,
        nextStatus: "skipped",
        metadata: {
          approval_id: approval.id,
          skipped_via: "approval_review",
        },
      }).catch(() => null);
    }

    return updated as WhatsAppReplyApproval;
  }

  const draftReply = input.draftReply?.trim() || approval.draft_reply;
  const outbound = await ensureWhatsAppOutboundMessage({
    userId,
    source: getApprovalOutboundSource(approval.metadata),
    approvalId: approval.id,
    workflowRunId:
      typeof approval.metadata?.workflow_run_id === "string"
        ? approval.metadata.workflow_run_id
        : null,
    remoteJid: approval.remote_jid,
    remotePhone: approval.remote_phone,
    contactName: approval.contact_name,
    messageText: draftReply,
    status: "approval_required",
    metadata: {
      ...(approval.metadata ?? {}),
      sensitivity: approval.sensitivity,
    },
  }).catch(() => null);

  if (outbound) {
    await transitionWhatsAppOutboundMessage({
      userId,
      outboundMessageId: outbound.id,
      nextStatus: "approved",
      metadata: {
        approval_id: approval.id,
        edited_before_send: draftReply !== approval.draft_reply,
      },
    }).catch(() => null);
  }

  await sendClawCloudWhatsAppToPhone(approval.remote_phone, draftReply, {
    userId,
    contactName: approval.contact_name,
    jid: approval.remote_jid,
    source: outbound?.source ?? getApprovalOutboundSource(approval.metadata),
    approvalId: approval.id,
    workflowRunId:
      typeof approval.metadata?.workflow_run_id === "string"
        ? approval.metadata.workflow_run_id
        : null,
    idempotencyKey: outbound?.idempotency_key ?? null,
    metadata: {
      ...(approval.metadata ?? {}),
      sensitivity: approval.sensitivity,
      edited_before_send: draftReply !== approval.draft_reply,
    },
  }).catch(async (error) => {
    if (outbound) {
      await transitionWhatsAppOutboundMessage({
        userId,
        outboundMessageId: outbound.id,
        nextStatus: "failed",
        errorMessage: error instanceof Error ? error.message : "Failed to send approved WhatsApp reply.",
        metadata: {
          approval_id: approval.id,
        },
      }).catch(() => null);
    }
    throw error;
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

export async function handleLatestWhatsAppApprovalReview(userId: string, message: string) {
  const decision = parseOutboundReviewDecision(message);
  if (decision.kind === "none") {
    return { handled: false, response: "", createdAt: null as string | null };
  }

  const locale = await getUserLocale(userId);

  const group = await getLatestPendingWhatsAppApprovalGroup(userId);
  if (!group || !group.approvals.length) {
    return { handled: false, response: "", createdAt: null as string | null };
  }

  const primary = group.approvals[0]!;
  const label = group.approvals.length === 1
    ? primary.contact_name || primary.remote_phone || "that contact"
    : `${group.approvals.length} contacts`;
  const requiresBroadcastPhrase = group.approvals.some(requiresExplicitBroadcastConfirmation);

  if (decision.kind === "cancel") {
    for (const approval of group.approvals) {
      await updateWhatsAppReplyApproval(userId, approval.id, { action: "skip" });
    }

    return {
      handled: true,
      response: await translateMessage(
        `Okay, I won't send that WhatsApp draft to ${label}.`,
        locale,
      ),
      createdAt: group.latestCreatedAt,
    };
  }

  if (decision.kind === "rewrite") {
    const rewritten = await buildWhatsAppDraftRewritePrompt(
      primary.draft_reply,
      label,
      decision.feedback,
    );
    const updatedApprovals = await updateWhatsAppApprovalDrafts(
      group.approvals.map((approval) => approval.id),
      rewritten.trim() || primary.draft_reply,
    );
    const previewApproval = updatedApprovals[0] ?? primary;
    return {
      handled: true,
      response: await translateMessage(buildWhatsAppApprovalReviewReply(previewApproval, updatedApprovals.length || group.approvals.length), locale),
      createdAt: group.latestCreatedAt,
    };
  }

  if (decision.kind === "approve" && requiresBroadcastPhrase && !looksLikeExplicitBroadcastApproval(message)) {
    return {
      handled: true,
      response: await translateMessage(
        [
          `For safety, this WhatsApp draft targets ${group.approvals.length} contacts.`,
          "",
          "Use `WSEND`, `WEDIT`, or `WSKIP` to handle this older broadcast draft manually.",
        ].join("\n"),
        locale,
      ),
      createdAt: group.latestCreatedAt,
    };
  }

  for (const approval of group.approvals) {
    await updateWhatsAppReplyApproval(userId, approval.id, { action: "send" });
  }
  await upsertAnalyticsDaily(userId, {
    tasks_run: 1,
    wa_messages_sent: group.approvals.length,
  }).catch(() => null);

  return {
    handled: true,
    response: await translateMessage(
      `Sent the approved WhatsApp ${group.approvals.length === 1 ? "message" : "messages"} to ${label}.`,
      locale,
    ),
    createdAt: group.latestCreatedAt,
  };
}

export async function handleWhatsAppApprovalCommand(userId: string, message: string) {
  const sendMatch = message.match(/^WSEND\s+([a-f0-9-]{6,})/i);
  const editMatch = message.match(/^WEDIT\s+([a-f0-9-]{6,})\s+([\s\S]+)/i);
  const skipMatch = message.match(/^WSKIP\s+([a-f0-9-]{6,})/i);

  if (!sendMatch && !editMatch && !skipMatch) {
    return { handled: false, response: "" };
  }

  const locale = await getUserLocale(userId);

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

export function buildWhatsAppApprovalReviewReply(approval: WhatsAppReplyApproval, recipientCount = 1) {
  const who = recipientCount === 1
    ? approval.contact_name || approval.remote_phone || "contact"
    : `${recipientCount} contacts`;
  const explicitBroadcast = requiresExplicitBroadcastConfirmation(approval);
  return [
    `📲 *WhatsApp draft ready for review: ${who}*`,
    "",
    `*Context:* ${approval.source_message.slice(0, 180)}`,
    "",
    "*Draft:*",
    approval.draft_reply.slice(0, 260),
    "",
    explicitBroadcast ? "Should I send this to all now?" : "Should I send this now?",
    ...(explicitBroadcast
      ? [
        `*Safety:* This is a broadcast-style draft for ${recipientCount} contacts.`,
        "Use `WSEND`, `WEDIT`, or `WSKIP` to handle this older broadcast draft manually.",
      ]
      : [
        "Use `WSEND`, `WEDIT`, or `WSKIP` to handle this older draft manually.",
      ]),
    `Power option: \`WSEND ${shortId(approval.id)}\`, \`WEDIT ${shortId(approval.id)} your new reply\`, \`WSKIP ${shortId(approval.id)}\``,
  ].join("\n");
}

export function buildWhatsAppApprovalContextReply(
  approval: WhatsAppReplyApproval,
  kind: "review" | "explain" | "target",
  recipientCount = 1,
) {
  const who = recipientCount === 1
    ? approval.contact_name || approval.remote_phone || "that contact"
    : `${recipientCount} contacts`;
  const explicitBroadcast = requiresExplicitBroadcastConfirmation(approval);
  const confirmLine = explicitBroadcast
    ? "Use `WSEND`, `WEDIT`, or `WSKIP` to handle this older broadcast draft manually."
    : "Use `WSEND`, `WEDIT`, or `WSKIP` to handle this older draft manually.";

  if (kind === "review") {
    return buildWhatsAppApprovalReviewReply(approval, recipientCount);
  }

  if (kind === "target") {
    return [
      `This pending WhatsApp draft is for *${who}*.`,
      `*Context:* ${approval.source_message.slice(0, 180)}`,
      explicitBroadcast
        ? `*Safety:* This is a broadcast-style draft for ${recipientCount} contacts.`
        : null,
      confirmLine,
    ].filter(Boolean).join("\n\n");
  }

  return [
    `This WhatsApp draft is an older queued review item from before direct-send mode was enabled${explicitBroadcast ? " for multiple recipients" : ""}.`,
    approval.reason ? `*Reason:* ${approval.reason}` : null,
    `*Target:* ${who}`,
    confirmLine,
  ].filter(Boolean).join("\n\n");
}

export function buildWhatsAppApprovalNotice(approval: WhatsAppReplyApproval) {
  const who = approval.contact_name || approval.remote_phone || "contact";
  const explicitBroadcast = requiresExplicitBroadcastConfirmation(approval);
  return [
    `📲 *Reply waiting for approval: ${who}*`,
    "",
    `*Incoming:* ${approval.source_message.slice(0, 180)}`,
    "",
    "*Suggested reply:*",
    approval.draft_reply.slice(0, 260),
    "",
    ...(explicitBroadcast
      ? [
        `*Safety:* This broadcast draft needs explicit confirmation.`,
        "Use `WSEND`, `WEDIT`, or `WSKIP` after checking the recipient list.",
      ]
      : []),
    `Use \`WSEND ${shortId(approval.id)}\` to send`,
    `Use \`WEDIT ${shortId(approval.id)} your new reply\` to edit and send`,
    `Use \`WSKIP ${shortId(approval.id)}\` to ignore`,
  ].join("\n");
}
