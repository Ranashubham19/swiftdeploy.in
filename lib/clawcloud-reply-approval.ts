import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import {
  getClawCloudGmailMessages,
  sendClawCloudGmailReply,
} from "@/lib/clawcloud-google";
import { getUserLocale, translateMessage } from "@/lib/clawcloud-i18n";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
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
  await sendClawCloudGmailReply(userId, {
    to: extractEmailAddress(approval.email_from),
    subject: `Re: ${approval.email_subject}`,
    body: finalBody,
  });

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

export async function sendReplyApprovalRequests(userId: string, maxEmails = 3) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const locale = await getUserLocale(userId);
  const requestedCount = Math.min(Math.max(maxEmails, 1), 10);
  const emails = await getClawCloudGmailMessages(userId, {
    query: buildReplySearchQuery(),
    maxResults: Math.max(requestedCount * 4, requestedCount),
  });

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
      .select("id")
      .single();

    if (!approval?.id) {
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
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const locale = await getUserLocale(userId);
  const sendMatch = message.match(/^SEND\s+([a-f0-9-]{8,})/i);
  const editMatch = message.match(/^EDIT\s+([a-f0-9-]{8,})\s+([\s\S]+)/i);
  const skipMatch = message.match(/^SKIP\s+([a-f0-9-]{8,})/i);

  if (!sendMatch && !editMatch && !skipMatch) {
    return { handled: false, response: "" };
  }

  const shortId = (sendMatch?.[1] ?? editMatch?.[1] ?? skipMatch?.[1] ?? "").toLowerCase();
  const { data } = await supabaseAdmin
    .from("reply_approvals")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .limit(50);

  const approval = (data as ReplyApproval[] | null)?.find((item) =>
    item.id.toLowerCase().startsWith(shortId),
  );

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

    return {
      handled: true,
      response: await translateMessage(
        `✅ *Skipped.*\n\nDraft for _${displayNameFromSender(approval.email_from)}_ has been ignored.`,
        locale,
      ),
    };
  }

  const finalBody = editMatch?.[2]?.trim() || approval.draft_body;

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
        `✅ *Reply sent to ${displayNameFromSender(approval.email_from)}.*\n\n_Subject: Re: ${approval.email_subject}_`,
        locale,
      ),
    };
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown error while sending the reply.";

    return {
      handled: true,
      response: await translateMessage(
        `❌ *Failed to send reply.*\n\n${messageText}\n\nPlease try again or reconnect Gmail at swift-deploy.in.`,
        locale,
      ),
    };
  }
}
