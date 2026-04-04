import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import {
  buildGoogleNotConnectedReply,
  buildGoogleReconnectRequiredReply,
  createClawCloudGmailDraft,
  getClawCloudGmailMessages,
  isClawCloudGoogleNotConnectedError,
  isClawCloudGoogleReconnectRequiredError,
  sendClawCloudGmailReply,
} from "@/lib/clawcloud-google";
import { getUserLocale, translateMessage } from "@/lib/clawcloud-i18n";
import { parseOutboundReviewDecision } from "@/lib/clawcloud-outbound-review";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { extractJsonObject, safeJsonParse } from "@/lib/utils";
import { sendClawCloudWhatsAppMessage } from "@/lib/clawcloud-whatsapp";

export type ApprovalStatus = "pending" | "sent" | "skipped" | "edit_requested";

export type ReplyApproval = {
  id: string;
  user_id: string;
  email_id: string;
  email_from: string;
  email_subject: string;
  draft_body: string;
  status: ApprovalStatus;
  created_at: string;
  updated_at?: string | null;
};

type ReplyApprovalMode = "compose_send" | "compose_draft" | "reply_send" | "reply_draft" | "legacy_reply_send";

type ReplyApprovalEnvelope = {
  version: 1;
  action: Exclude<ReplyApprovalMode, "legacy_reply_send">;
  to: string;
  inReplyTo?: string | null;
  originalEmailId?: string | null;
  originalPrompt?: string | null;
  targetLabel?: string | null;
};

type QueueReplyApprovalInput = {
  userId: string;
  action: Exclude<ReplyApprovalMode, "legacy_reply_send">;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  originalEmailId?: string | null;
  originalPrompt?: string | null;
  targetLabel?: string | null;
};

type ReplyApprovalExecutionPlan = {
  mode: ReplyApprovalMode;
  to: string;
  subject: string;
  displayTarget: string;
  inReplyTo: string | null;
};

function encodeReplyApprovalEnvelope(payload: ReplyApprovalEnvelope) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `meta:${encoded}`;
}

function decodeReplyApprovalEnvelope(emailId: string): ReplyApprovalEnvelope | null {
  if (!emailId.startsWith("meta:")) {
    return null;
  }

  try {
    const decoded = Buffer.from(emailId.slice(5), "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<ReplyApprovalEnvelope>;
    if (
      parsed?.version !== 1
      || (parsed.action !== "compose_send"
        && parsed.action !== "compose_draft"
        && parsed.action !== "reply_send"
        && parsed.action !== "reply_draft")
      || typeof parsed.to !== "string"
    ) {
      return null;
    }

    return {
      version: 1,
      action: parsed.action,
      to: parsed.to,
      inReplyTo: typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : null,
      originalEmailId: typeof parsed.originalEmailId === "string" ? parsed.originalEmailId : null,
      originalPrompt: typeof parsed.originalPrompt === "string" ? parsed.originalPrompt : null,
      targetLabel: typeof parsed.targetLabel === "string" ? parsed.targetLabel : null,
    };
  } catch {
    return null;
  }
}

function resolveReplyApprovalExecutionPlan(approval: ReplyApproval): ReplyApprovalExecutionPlan {
  const envelope = decodeReplyApprovalEnvelope(approval.email_id);
  if (!envelope) {
    return {
      mode: "legacy_reply_send",
      to: extractEmailAddress(approval.email_from),
      subject: `Re: ${approval.email_subject}`,
      displayTarget: displayNameFromSender(approval.email_from),
      inReplyTo: null,
    };
  }

  const displayTarget = envelope.targetLabel?.trim()
    || (envelope.action === "reply_send" || envelope.action === "reply_draft"
      ? displayNameFromSender(approval.email_from)
      : envelope.to);

  return {
    mode: envelope.action,
    to: envelope.to,
    subject: approval.email_subject,
    displayTarget,
    inReplyTo: envelope.inReplyTo ?? null,
  };
}

function buildReplyApprovalHeadline(plan: ReplyApprovalExecutionPlan) {
  return plan.mode === "compose_draft" || plan.mode === "reply_draft"
    ? "Gmail draft ready for review"
    : "Gmail message ready for review";
}

function buildReplyApprovalPrompt(plan: ReplyApprovalExecutionPlan) {
  return plan.mode === "compose_draft" || plan.mode === "reply_draft"
    ? "Should I save this to Gmail drafts?"
    : "Should I send this now?";
}

export function buildReplyApprovalReviewReply(approval: ReplyApproval) {
  const plan = resolveReplyApprovalExecutionPlan(approval);
  const preview = approval.draft_body.length > 320
    ? `${approval.draft_body.slice(0, 320)}...`
    : approval.draft_body;

  return [
    `📧 *${buildReplyApprovalHeadline(plan)}*`,
    `*To:* ${plan.displayTarget}`,
    `*Subject:* ${plan.subject}`,
    "",
    "*Draft:*",
    preview,
    "",
    buildReplyApprovalPrompt(plan),
    "Use `SEND`, `EDIT`, or `SKIP` if you still want to process this older queued draft manually.",
    `Power option: \`SEND ${approval.id.slice(0, 8)}\`, \`EDIT ${approval.id.slice(0, 8)} <text>\`, \`SKIP ${approval.id.slice(0, 8)}\``,
  ].join("\n");
}

export function buildReplyApprovalContextReply(
  approval: ReplyApproval,
  kind: "review" | "explain" | "target",
) {
  const plan = resolveReplyApprovalExecutionPlan(approval);

  if (kind === "review") {
    return buildReplyApprovalReviewReply(approval);
  }

  if (kind === "target") {
    return [
      `This pending Gmail ${plan.mode === "compose_draft" || plan.mode === "reply_draft" ? "draft" : "message"} is for *${plan.displayTarget}*.`,
      `*Subject:* ${plan.subject}`,
      "Use `SEND`, `EDIT`, or `SKIP` if you still want to process this older queued item manually.",
    ].join("\n\n");
  }

  return [
    `This Gmail ${plan.mode === "compose_draft" || plan.mode === "reply_draft" ? "draft" : "message"} is an older queued review item from before direct-send mode was enabled.`,
    `*Target:* ${plan.displayTarget}`,
    `*Subject:* ${plan.subject}`,
    "Use `SEND`, `EDIT`, or `SKIP` if you still want to process it manually.",
  ].join("\n\n");
}

type ReplyApprovalRewriteDraft = {
  subject: string;
  body: string;
};

function normalizeReplyApprovalRewriteDraft(
  raw: string,
  approval: Pick<ReplyApproval, "email_subject" | "draft_body">,
): ReplyApprovalRewriteDraft {
  const cleaned = raw.replace(/```json|```/gi, "").trim();
  const jsonCandidate = extractJsonObject(cleaned) ?? cleaned;
  const parsed = safeJsonParse<{ subject?: unknown; body?: unknown }>(jsonCandidate);
  if (parsed) {
    const subject = typeof parsed.subject === "string" && parsed.subject.trim()
      ? parsed.subject.trim()
      : approval.email_subject;
    const body = typeof parsed.body === "string" && parsed.body.trim()
      ? parsed.body.trim()
      : approval.draft_body;
    return { subject, body };
  }

  return {
    subject: approval.email_subject,
    body: cleaned || approval.draft_body,
  };
}

export function normalizeReplyApprovalRewriteDraftForTest(
  raw: string,
  approval: Pick<ReplyApproval, "email_subject" | "draft_body">,
) {
  return normalizeReplyApprovalRewriteDraft(raw, approval);
}

async function rewriteReplyApprovalDraft(
  approval: ReplyApproval,
  guidance: string | null,
) {
  const plan = resolveReplyApprovalExecutionPlan(approval);
  const rewritten = await completeClawCloudPrompt({
    system: [
      "You rewrite professional email drafts.",
      "Return strict JSON only with keys `subject` and `body`.",
      "`subject` must be a clean single-line email subject with no quotes or markdown.",
      "`body` must be the full updated email body with no markdown fences.",
      "Preserve the original intent, facts, commitments, and requested outcome.",
      "Improve tone, clarity, and professionalism.",
      "Only change the subject if the revision request asks for it or the current subject should be clarified for the same message.",
      "If feedback is provided, follow it carefully.",
      "Keep the draft concise and ready to send.",
    ].join("\n"),
    user: [
      `Mode: ${plan.mode}`,
      `Recipient: ${plan.displayTarget}`,
      `Current subject: ${approval.email_subject}`,
      `Current draft:\n${approval.draft_body}`,
      guidance
        ? `Revision request: ${guidance}`
        : "Revision request: Rewrite this to sound more polished, professional, and accurate.",
    ].join("\n\n"),
    intent: "email",
    maxTokens: 420,
    fallback: JSON.stringify({
      subject: approval.email_subject,
      body: approval.draft_body,
    }),
  });

  return normalizeReplyApprovalRewriteDraft(rewritten, approval);
}

async function updateReplyApprovalDraftOnly(
  approvalId: string,
  subject: string,
  draftBody: string,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("reply_approvals")
    .update({
      email_subject: subject,
      draft_body: draftBody,
      updated_at: new Date().toISOString(),
    })
    .eq("id", approvalId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ReplyApproval;
}

function extractEmailAddress(value: string) {
  const bracketMatch = value.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }

  const directMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return directMatch?.[0]?.trim() ?? value.trim();
}

function displayNameFromSender(value: string) {
  const display = value.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim();
  return display || extractEmailAddress(value);
}

function firstNameFromSender(value: string) {
  const display = displayNameFromSender(value);
  if (!display || display.includes("@")) {
    return "there";
  }

  return display.split(/\s+/)[0] ?? "there";
}

export function shouldSkipEmailForReply(from: string, subject: string) {
  const email = extractEmailAddress(from).toLowerCase();
  const displayName = displayNameFromSender(from).toLowerCase();
  const subjectLower = subject.toLowerCase();

  const senderPatterns = [
    /no[-_.]?reply/,
    /do[-_.]?not[-_.]?reply/,
    /donotreply/,
    /mailer[-_.]?daemon/,
    /postmaster/,
    /bounce/,
    /unsubscribe/,
    /notifications?/,
    /newsletters?/,
    /alerts?/,
    /digest/,
    /updates?/,
    /security/,
    /verify/,
    /otp/,
    /billing/,
    /invoice/,
    /receipts?/,
    /payments?/,
    /jobs?/,
    /support/,
    /info@/,
    /team@/,
  ];

  if (senderPatterns.some((pattern) => pattern.test(email))) {
    return true;
  }

  const automatedDomains = [
    "amazon.",
    "facebook.",
    "glassdoor.",
    "googlemail.",
    "indeed.",
    "instagram.",
    "linkedin.",
    "mailchimp.",
    "marketo.",
    "medium.",
    "monster.",
    "naukri.",
    "paypal.",
    "quora.",
    "reddit.",
    "sendgrid.",
    "shopify.",
    "slack.",
    "spotify.",
    "stripe.",
    "tiktok.",
    "twitter.",
    "youtube.",
    "zomato.",
  ];

  if (automatedDomains.some((domain) => email.includes(domain))) {
    return true;
  }

  const subjectPatterns = [
    /\b(newsletter|digest|unsubscribe|top stories|trending|roundup)\b/,
    /\b(otp|verification code|security code|login code|auth code)\b/,
    /\b(order|invoice|receipt|payment|refund|shipment|delivered|tracking)\b/,
    /\b(job alert|job opening|apply now|new jobs?|recruitment|hiring)\b/,
    /\b(% off|sale|discount|promo|coupon|limited time|offer)\b/,
    /\b(password reset|account alert|sign.?in alert|subscription|billing notice)\b/,
    /\b(appointment confirmation|booking confirmation|reservation confirmation)\b/,
  ];

  if (subjectPatterns.some((pattern) => pattern.test(subjectLower))) {
    return true;
  }

  const brandPatterns = [
    /\bteam\b/,
    /\bsupport\b/,
    /\bnewsletter\b/,
    /\bnotifications?\b/,
    /\b(alerts?|updates?)\b/,
    /\b(inc|llc|ltd|corp|company)\b/,
  ];

  return brandPatterns.some((pattern) => pattern.test(displayName));
}

function buildReplySearchQuery() {
  return [
    "is:unread",
    "is:inbox",
    "-from:noreply",
    "-from:no-reply",
    "-from:donotreply",
    "-from:notifications",
    "-from:newsletter",
    "-from:alerts",
    "-from:mailer",
    "-from:updates",
    "-from:billing",
    "-subject:unsubscribe",
    "-subject:newsletter",
    "-subject:otp",
    "-subject:(job alert)",
    "-subject:(transaction alert)",
    "-subject:(order confirmed)",
    "-category:promotions",
    "-category:social",
    "-category:updates",
    "-category:forums",
  ].join(" ");
}

async function generateReplyDraft(from: string, subject: string, body: string) {
  const senderName = firstNameFromSender(from);

  return completeClawCloudPrompt({
    system: [
      "You write concise, professional email replies for busy professionals.",
      "Rules:",
      "- Address the sender by first name only when natural.",
      "- Match the tone of the incoming email.",
      "- Reference the actual topic from the subject or body.",
      "- Answer the question directly or promise a concrete follow-up.",
      "- Keep it under 90 words.",
      "- Return only the reply body with a short sign-off.",
    ].join("\n"),
    user: `Write a reply to this email.\n\nFrom: ${from}\nSubject: ${subject}\nBody:\n${body}`,
    intent: "email",
    maxTokens: 250,
    fallback: `Hi ${senderName},\n\nThank you for your email. I will review this and get back to you shortly.\n\nBest regards,`,
  });
}

export async function queueReplyApproval(input: QueueReplyApprovalInput) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const emailId = encodeReplyApprovalEnvelope({
    version: 1,
    action: input.action,
    to: input.to,
    inReplyTo: input.inReplyTo ?? null,
    originalEmailId: input.originalEmailId ?? null,
    originalPrompt: input.originalPrompt ?? null,
    targetLabel: input.targetLabel ?? null,
  });

  const { data, error } = await supabaseAdmin
    .from("reply_approvals")
    .insert({
      user_id: input.userId,
      email_id: emailId,
      email_from: input.targetLabel || input.to,
      email_subject: input.subject,
      draft_body: input.body,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as ReplyApproval;
}

export async function listReplyApprovals(userId: string, limit = 50) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("reply_approvals")
    .select(
      "id, user_id, email_id, email_from, email_subject, draft_body, status, created_at, updated_at",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ReplyApproval[];
}

export async function getLatestPendingReplyApproval(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("reply_approvals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as ReplyApproval | null) ?? null;
}

export async function updateReplyApproval(
  userId: string,
  approvalId: string,
  input: {
    action: "send" | "skip";
    draftBody?: string;
  },
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("reply_approvals")
    .select("*")
    .eq("id", approvalId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const approval = data as ReplyApproval | null;
  if (!approval) {
    throw new Error("Approval not found.");
  }

  if (approval.status !== "pending") {
    throw new Error(`Already ${approval.status}.`);
  }

  if (input.action === "skip") {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("reply_approvals")
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

    return updated as ReplyApproval;
  }

  const finalBody = input.draftBody?.trim() || approval.draft_body;
  const plan = resolveReplyApprovalExecutionPlan(approval);

  if (plan.mode === "compose_draft" || plan.mode === "reply_draft") {
    await createClawCloudGmailDraft(userId, {
      to: plan.to,
      subject: plan.subject,
      body: finalBody,
      inReplyTo: plan.inReplyTo || null,
    });
  } else {
    await sendClawCloudGmailReply(userId, {
      to: plan.to,
      subject: plan.subject,
      body: finalBody,
      inReplyTo: plan.inReplyTo || null,
    });
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("reply_approvals")
    .update({
      status: "sent",
      draft_body: finalBody,
      updated_at: new Date().toISOString(),
    })
    .eq("id", approval.id)
    .select("*")
    .single();

  if (updateError) {
    throw new Error(updateError.message);
  }

  return updated as ReplyApproval;
}

export async function handleLatestReplyApprovalReview(userId: string, message: string) {
  const decision = parseOutboundReviewDecision(message);
  if (decision.kind === "none") {
    return { handled: false, response: "", createdAt: null as string | null };
  }

  const locale = await getUserLocale(userId);

  const approval = await getLatestPendingReplyApproval(userId);
  if (!approval) {
    return { handled: false, response: "", createdAt: null as string | null };
  }

  const plan = resolveReplyApprovalExecutionPlan(approval);

  if (decision.kind === "cancel") {
    await updateReplyApproval(userId, approval.id, { action: "skip" });
    return {
      handled: true,
      response: await translateMessage(
        `Okay, I won't ${plan.mode === "compose_draft" || plan.mode === "reply_draft" ? "save" : "send"} the Gmail ${plan.mode === "compose_draft" || plan.mode === "reply_draft" ? "draft" : "message"} for ${plan.displayTarget}.`,
        locale,
      ),
      createdAt: approval.created_at,
    };
  }

  if (decision.kind === "rewrite") {
    const updatedDraft = await rewriteReplyApprovalDraft(approval, decision.feedback);
    const updatedApproval = await updateReplyApprovalDraftOnly(
      approval.id,
      updatedDraft.subject,
      updatedDraft.body,
    );

    return {
      handled: true,
      response: await translateMessage(buildReplyApprovalReviewReply(updatedApproval), locale),
      createdAt: approval.created_at,
    };
  }

  try {
    await updateReplyApproval(userId, approval.id, {
      action: "send",
    });

    await upsertAnalyticsDaily(userId, {
      tasks_run: 1,
      wa_messages_sent: 1,
      drafts_created: plan.mode === "compose_draft" || plan.mode === "reply_draft" ? 1 : 0,
    });

    const completedLabel = plan.mode === "compose_draft" || plan.mode === "reply_draft"
      ? `Saved the Gmail draft for ${plan.displayTarget}.`
      : `Sent the Gmail message to ${plan.displayTarget}.`;

    return {
      handled: true,
      response: await translateMessage(
        `${completedLabel}\n\nSubject: ${plan.subject}`,
        locale,
      ),
      createdAt: approval.created_at,
    };
  } catch (error) {
    const messageText = isClawCloudGoogleReconnectRequiredError(error)
      ? buildGoogleReconnectRequiredReply("Gmail")
      : isClawCloudGoogleNotConnectedError(error, "gmail")
        ? buildGoogleNotConnectedReply("Gmail")
        : error instanceof Error
          ? error.message
          : "Unknown error while sending the reply.";

    return {
      handled: true,
      response: await translateMessage(
        `I couldn't complete that Gmail action yet.\n\n${messageText}\n\nReconnect Gmail at swift-deploy.in and try again.`,
        locale,
      ),
      createdAt: approval.created_at,
    };
  }
}

export async function sendReplyApprovalRequests(userId: string, maxEmails = 3) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const locale = await getUserLocale(userId);
  const requestedCount = Math.min(Math.max(maxEmails, 1), 10);
  let emails;
  try {
    emails = await getClawCloudGmailMessages(userId, {
      query: buildReplySearchQuery(),
      maxResults: Math.max(requestedCount * 4, requestedCount),
    });
  } catch (error) {
    if (isClawCloudGoogleReconnectRequiredError(error)) {
      await sendClawCloudWhatsAppMessage(
        userId,
        await translateMessage(buildGoogleReconnectRequiredReply("Gmail"), locale),
      );
      return { queued: 0 };
    }
    if (isClawCloudGoogleNotConnectedError(error, "gmail")) {
      await sendClawCloudWhatsAppMessage(
        userId,
        await translateMessage(buildGoogleNotConnectedReply("Gmail"), locale),
      );
      return { queued: 0 };
    }
    throw error;
  }

  if (emails.length === 0) {
    const message = await translateMessage(
      "📭 *No emails need replies right now.*\n\nYour inbox looks clear of actionable messages. I will keep checking.",
      locale,
    );
    await sendClawCloudWhatsAppMessage(userId, message);
    return { queued: 0 };
  }

  const actionableEmails = emails.filter(
    (email) => !shouldSkipEmailForReply(email.from ?? "", email.subject ?? ""),
  );

  if (actionableEmails.length === 0) {
    const message = await translateMessage(
      "📭 *No human emails need replies right now.*\n\nI found messages, but they were automated notifications or newsletters.",
      locale,
    );
    await sendClawCloudWhatsAppMessage(userId, message);
    return { queued: 0 };
  }

  let queued = 0;

  for (const email of actionableEmails.slice(0, requestedCount)) {
    const { data: existingApproval } = await supabaseAdmin
      .from("reply_approvals")
      .select("id")
      .eq("user_id", userId)
      .eq("email_id", email.id)
      .maybeSingle();

    if (existingApproval?.id) {
      continue;
    }

    const draftBody = await generateReplyDraft(
      email.from ?? "",
      email.subject ?? "",
      email.body ?? email.snippet ?? "",
    );

    const { data: approval } = await supabaseAdmin
      .from("reply_approvals")
      .insert({
        user_id: userId,
        email_id: email.id,
        email_from: email.from,
        email_subject: email.subject,
        draft_body: draftBody,
        status: "pending",
      })
      .select("*")
      .single();

    if (!(approval as ReplyApproval | null)?.id) {
      continue;
    }

    const senderDisplay = displayNameFromSender(email.from ?? "");
    const preview =
      draftBody.length > 180 ? `${draftBody.slice(0, 180)}...` : draftBody;
    const shortId = approval.id.slice(0, 8);
    const message = [
      `📧 *New email from ${senderDisplay}*`,
      `_${email.subject}_`,
      "",
      "*Draft reply:*",
      preview,
      "",
      "Reply with one of:",
      `• \`SEND ${shortId}\` - send this reply`,
      `• \`EDIT ${shortId} <your text>\` - change it first`,
      `• \`SKIP ${shortId}\` - ignore this email`,
    ].join("\n");

    await sendClawCloudWhatsAppMessage(userId, await translateMessage(message, locale));
    queued += 1;
  }

  if (queued === 0) {
    const message = await translateMessage(
      "📭 *All matching drafts are already pending or sent.*\n\nNo new reply approvals need your review right now.",
      locale,
    );
    await sendClawCloudWhatsAppMessage(userId, message);
    return { queued: 0 };
  }

  await upsertAnalyticsDaily(userId, {
    drafts_created: queued,
    wa_messages_sent: queued,
  });

  return { queued };
}

export async function handleReplyApprovalCommand(userId: string, message: string) {
  const sendMatch = message.match(/^SEND\s+([a-f0-9-]{8,})/i);
  const editMatch = message.match(/^EDIT\s+([a-f0-9-]{8,})\s+([\s\S]+)/i);
  const skipMatch = message.match(/^SKIP\s+([a-f0-9-]{8,})/i);

  if (!sendMatch && !editMatch && !skipMatch) {
    return { handled: false, response: "" };
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const locale = await getUserLocale(userId);
  const shortId = (sendMatch?.[1] ?? editMatch?.[1] ?? skipMatch?.[1] ?? "").toLowerCase();
  const { data } = await supabaseAdmin
    .from("reply_approvals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(50);

  const approval = (data as ReplyApproval[] | null)?.find((item) =>
    item.id.toLowerCase().startsWith(shortId),
  )!;

  if (!approval) {
    return {
      handled: true,
      response: await translateMessage(
        "❌ *Draft not found.*\n\nIt may already be sent or skipped. Use SEND, EDIT, or SKIP followed by the draft ID.",
        locale,
      ),
    };
  }

  if (skipMatch) {
    await updateReplyApproval(userId, approval.id, { action: "skip" });
    const plan = resolveReplyApprovalExecutionPlan(approval);

    return {
      handled: true,
      response: await translateMessage(
        `Skipped the pending Gmail ${plan.mode === "compose_draft" || plan.mode === "reply_draft" ? "draft" : "message"} for ${plan.displayTarget}.`,
        locale,
      ),
    };

    return {
      handled: true,
      response: await translateMessage(
        `✅ *Skipped.*\n\nDraft for _${displayNameFromSender(approval.email_from)}_ has been ignored.`,
        locale,
      ),
    };
  }

  const finalBody = editMatch?.[2]?.trim() || approval.draft_body;
  const plan = resolveReplyApprovalExecutionPlan(approval);

  try {
    await updateReplyApproval(userId, approval.id, {
      action: "send",
      draftBody: finalBody,
    });

    await upsertAnalyticsDaily(userId, {
      tasks_run: 1,
      wa_messages_sent: 1,
    });

    return {
      handled: true,
      response: await translateMessage(
        `${
          plan.mode === "compose_draft" || plan.mode === "reply_draft"
            ? `Saved the Gmail draft for ${plan.displayTarget}.`
            : `Sent the Gmail message to ${plan.displayTarget}.`
        }\n\nSubject: ${plan.subject}`,
        locale,
      ),
    };

    return {
      handled: true,
      response: await translateMessage(
        `✅ *Reply sent to ${displayNameFromSender(approval.email_from)}.*\n\n_Subject: Re: ${approval.email_subject}_`,
        locale,
      ),
    };
  } catch (error) {
    const messageText = isClawCloudGoogleReconnectRequiredError(error)
      ? buildGoogleReconnectRequiredReply("Gmail")
      : isClawCloudGoogleNotConnectedError(error, "gmail")
        ? buildGoogleNotConnectedReply("Gmail")
        : error instanceof Error
          ? error.message
          : "Unknown error while sending the reply.";

    return {
      handled: true,
      response: await translateMessage(
        `❌ *Failed to send reply.*\n\n${messageText}\n\nPlease try again or reconnect Gmail at swift-deploy.in.`,
        locale,
      ),
    };
  }
}
