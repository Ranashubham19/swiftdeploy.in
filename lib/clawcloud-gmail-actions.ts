import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import {
  buildGoogleNotConnectedReply,
  buildGoogleReconnectRequiredReply,
  getClawCloudGmailMessages,
  isClawCloudGoogleNotConnectedError,
  isClawCloudGoogleReconnectRequiredError,
  modifyClawCloudGmailMessage,
} from "@/lib/clawcloud-google";
import {
  buildReplyApprovalReviewReply,
  queueReplyApproval,
} from "@/lib/clawcloud-reply-approval";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  looksLikeEmailWritingKnowledgeQuestion,
  looksLikeGmailKnowledgeQuestion,
} from "@/lib/clawcloud-workspace-knowledge";

export type GmailActionIntent =
  | "gmail_reply_queue"
  | "gmail_draft"
  | "gmail_send"
  | "gmail_reply_draft"
  | "gmail_reply_send"
  | "gmail_mark_read"
  | "gmail_mark_unread"
  | "gmail_archive"
  | "gmail_trash"
  | "gmail_restore"
  | "gmail_mark_spam"
  | "gmail_mark_not_spam"
  | "gmail_star"
  | "gmail_unstar";

type ParsedGmailAction =
  | {
      kind: "reply_queue";
      count: number;
    }
  | {
      kind: "draft" | "send";
      recipientHint: string | null;
      subjectHint: string | null;
      contentInstruction: string | null;
      explicitSelfTarget: boolean;
    }
  | {
      kind: "reply_draft" | "reply_send";
      senderHint: string | null;
      subjectHint: string | null;
      contentInstruction: string | null;
    }
  | {
      kind:
        | "mark_read"
        | "mark_unread"
        | "archive"
        | "trash"
        | "restore"
        | "mark_spam"
        | "mark_not_spam"
        | "star"
        | "unstar";
      senderHint: string | null;
    };

type GmailReplyTarget = {
  id: string;
  from: string;
  subject: string;
  body: string;
  snippet: string;
  replyTo: string;
  messageId: string;
  date: string;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function extractRequestedCount(text: string) {
  const lower = text.toLowerCase();
  if (/\ball|every|each\b/.test(lower)) {
    return 3;
  }

  const match = text.match(/\b(\d{1,2})\b/);
  const count = Number(match?.[1] ?? "");
  if (Number.isFinite(count) && count > 0) {
    return Math.max(1, Math.min(10, count));
  }

  return 1;
}

function extractEmailAddress(value: string) {
  const bracketMatch = value.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) {
    return bracketMatch[1].trim();
  }

  const directMatch = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return directMatch?.[0]?.trim() ?? null;
}

function normalizeSenderValue(value: string) {
  return value.toLowerCase().replace(/<[^>]+>/g, " ").replace(/["']/g, " ").replace(/\s+/g, " ").trim();
}

function cleanReplySubject(subject: string) {
  const trimmed = subject.trim() || "Quick follow-up";
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

function extractSubjectHint(raw: string) {
  const match = raw.match(/\bsubject\s*[:\-]?\s*(.+?)(?=\s+\b(?:saying|that says|with message|body|about|regarding)\b|$)/i);
  return match?.[1]?.trim() ?? null;
}

function extractContentInstruction(raw: string) {
  const patterns = [
    /\b(?:saying that|saying|that says|with message|body\s*:|message\s*:)\s+([\s\S]+)$/i,
    /\b(?:about|regarding)\s+([\s\S]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

function extractComposeRecipientHint(raw: string) {
  const implicitSelfMatch = raw.match(/\b(?:email|mail|message)\s+(my gmail|my email|me|myself)\b/i);
  if (implicitSelfMatch?.[1]) {
    return {
      recipientHint: implicitSelfMatch[1].trim(),
      explicitSelfTarget: true,
    };
  }

  const selfMatch = raw.match(/\bto\s+(my gmail|my email|me|myself)\b/i);
  if (selfMatch?.[1]) {
    return {
      recipientHint: selfMatch[1].trim(),
      explicitSelfTarget: true,
    };
  }

  const emailMatch = raw.match(/\bto\s+([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i);
  if (emailMatch?.[1]) {
    return {
      recipientHint: emailMatch[1].trim(),
      explicitSelfTarget: false,
    };
  }

  const quotedMatch = raw.match(/\bto\s+["']([^"']+)["']/i);
  if (quotedMatch?.[1]) {
    return {
      recipientHint: quotedMatch[1].trim(),
      explicitSelfTarget: false,
    };
  }

  const genericMatch = raw.match(/\bto\s+(.+?)(?=\s+\b(?:subject|saying|that says|with message|body|about|regarding)\b|$)/i);
  return {
    recipientHint: genericMatch?.[1]?.trim() ?? null,
    explicitSelfTarget: false,
  };
}

function extractReplySenderHint(raw: string) {
  const patterns = [
    /\b(?:reply|respond|mark|archive|delete|trash|restore|recover|move|report|star|unstar)\s+(?:in gmail\s+)?to\s+(?:my\s+)?(?:latest|last)\s+email\s+from\s+(.+?)(?=\s+\b(?:subject|saying|that says|with message|body|about|regarding|as|to)\b|$)/i,
    /\b(?:reply|respond|mark|archive|delete|trash|restore|recover|move|report|star|unstar)\s+(?:in gmail\s+)?to\s+the\s+email\s+from\s+(.+?)(?=\s+\b(?:subject|saying|that says|with message|body|about|regarding|as|to)\b|$)/i,
    /\b(?:reply|respond)\s+(?:in gmail\s+)?to\s+(.+?)'s\s+email(?=\s+\b(?:subject|saying|that says|with message|body|about|regarding)\b|$)/i,
    /\b(?:mark|archive|delete|trash|restore|recover|move|report|star|unstar)\s+(?:my\s+)?(?:latest|last)\s+email\s+from\s+(.+?)(?=\s+\b(?:as|subject|today|yesterday|this week|last week|to)\b|$)/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = match?.[1]?.trim();
    if (value) {
      return value;
    }
  }

  return null;
}

export function detectGmailActionIntent(text: string): GmailActionIntent | null {
  if (looksLikeGmailKnowledgeQuestion(text) || looksLikeEmailWritingKnowledgeQuestion(text)) {
    return null;
  }

  const parsed = parseGmailActionRequest(text);
  return parsed?.kind === "reply_queue"
    ? "gmail_reply_queue"
    : parsed?.kind === "draft"
      ? "gmail_draft"
      : parsed?.kind === "send"
        ? "gmail_send"
        : parsed?.kind === "reply_draft"
          ? "gmail_reply_draft"
          : parsed?.kind === "reply_send"
            ? "gmail_reply_send"
            : parsed?.kind === "mark_read"
              ? "gmail_mark_read"
              : parsed?.kind === "mark_unread"
                ? "gmail_mark_unread"
                : parsed?.kind === "archive"
                  ? "gmail_archive"
                  : parsed?.kind === "trash"
                    ? "gmail_trash"
                    : parsed?.kind === "restore"
                      ? "gmail_restore"
                      : parsed?.kind === "mark_spam"
                        ? "gmail_mark_spam"
                        : parsed?.kind === "mark_not_spam"
                          ? "gmail_mark_not_spam"
                          : parsed?.kind === "star"
                            ? "gmail_star"
                            : parsed?.kind === "unstar"
                              ? "gmail_unstar"
                              : null;
}

export function parseGmailActionRequest(text: string): ParsedGmailAction | null {
  const raw = text.trim();
  const lower = raw.toLowerCase();

  if (looksLikeGmailKnowledgeQuestion(raw) || looksLikeEmailWritingKnowledgeQuestion(raw)) {
    return null;
  }

  if (
    /\b(draft|prepare|queue|create)\s+repl(?:y|ies)\b.*\b(?:emails?|inbox|gmail)\b/.test(lower)
    || /\b(?:check|scan|review|look through|go through)\b.*\b(?:emails?|inbox|gmail)\b.*\b(draft|prepare)\b.*\brepl(?:y|ies)\b/.test(lower)
  ) {
    return { kind: "reply_queue", count: extractRequestedCount(raw) };
  }

  if (
    /\b(?:reply|respond)\b.*\b(?:my\s+)?(?:latest|last)\s+email\b/.test(lower)
    || /\b(?:reply|respond)\b.*\bemail\s+from\b/.test(lower)
  ) {
    return {
      kind: /\bsend\b/.test(lower) ? "reply_send" : "reply_draft",
      senderHint: extractReplySenderHint(raw),
      subjectHint: extractSubjectHint(raw),
      contentInstruction: extractContentInstruction(raw),
    };
  }

  if (
    /\bmark\b.*\b(?:latest|last)?\s*email\b.*\bunread\b/.test(lower)
    || /\bmark\b.*\bemail\b.*\bunread\b/.test(lower)
  ) {
    return { kind: "mark_unread", senderHint: extractReplySenderHint(raw) };
  }

  if (
    /\bmark\b.*\b(?:latest|last)?\s*email\b.*\bread\b/.test(lower)
    || /\bmark\b.*\bemail\b.*\bread\b/.test(lower)
  ) {
    return { kind: "mark_read", senderHint: extractReplySenderHint(raw) };
  }

  if (/\barchive\b.*\bemail\b/.test(lower) || /\barchive\b.*\b(?:latest|last)\s+email\b/.test(lower)) {
    return { kind: "archive", senderHint: extractReplySenderHint(raw) };
  }

  if (
    /\b(?:delete|trash|bin)\b.*\bemail\b/.test(lower)
    || /\b(?:delete|trash|bin)\b.*\b(?:latest|last)\s+email\b/.test(lower)
  ) {
    return { kind: "trash", senderHint: extractReplySenderHint(raw) };
  }

  if (
    /\b(?:restore|recover|untrash)\b.*\bemail\b/.test(lower)
    || /\bmove\b.*\bemail\b.*\bback\b/.test(lower)
  ) {
    return { kind: "restore", senderHint: extractReplySenderHint(raw) };
  }

  if (
    /\b(?:move|mark|report)\b.*\bemail\b.*\bnot spam\b/.test(lower)
    || /\bunspam\b.*\bemail\b/.test(lower)
  ) {
    return { kind: "mark_not_spam", senderHint: extractReplySenderHint(raw) };
  }

  if (
    /\b(?:move|mark|report)\b.*\bemail\b.*\b(?:spam|junk)\b/.test(lower)
    || /\b(?:spam|junk)\b.*\b(?:latest|last)\s+email\b/.test(lower)
  ) {
    return { kind: "mark_spam", senderHint: extractReplySenderHint(raw) };
  }

  if (/\bunstar\b.*\bemail\b/.test(lower) || /\bunstar\b.*\b(?:latest|last)\s+email\b/.test(lower)) {
    return { kind: "unstar", senderHint: extractReplySenderHint(raw) };
  }

  if (/\bstar\b.*\bemail\b/.test(lower) || /\bstar\b.*\b(?:latest|last)\s+email\b/.test(lower)) {
    return { kind: "star", senderHint: extractReplySenderHint(raw) };
  }

  const composeRecipient = extractComposeRecipientHint(raw);
  const hasExplicitComposeTarget = Boolean(composeRecipient.recipientHint);
  const mentionsExplicitGmailSurface =
    /\bgmail\b/.test(lower)
    || /\bdrafts?\b/.test(lower)
    || /\binbox\b/.test(lower);
  if (
    (
      /\bsend\s+(?:an?\s+)?(?:gmail\s+)?(?:email|mail|message)\b/.test(lower)
      && (hasExplicitComposeTarget || mentionsExplicitGmailSurface)
    )
    || /\bemail\s+me\b/.test(lower)
    || /\bmessage\s+my\s+gmail\b/.test(lower)
  ) {
    return {
      kind: "send",
      recipientHint: composeRecipient.recipientHint,
      subjectHint: extractSubjectHint(raw),
      contentInstruction: extractContentInstruction(raw),
      explicitSelfTarget: composeRecipient.explicitSelfTarget,
    };
  }

  if (
    (
      /\b(?:draft|compose|create|save)\s+(?:an?\s+)?(?:gmail\s+)?(?:email|mail|draft|message)\b/.test(lower)
      && (hasExplicitComposeTarget || mentionsExplicitGmailSurface)
    )
    || /\bsave\b.*\bto\s+(?:gmail\s+)?drafts?\b/.test(lower)
    || /\bgmail\s+draft\b/.test(lower)
  ) {
    return {
      kind: "draft",
      recipientHint: composeRecipient.recipientHint,
      subjectHint: extractSubjectHint(raw),
      contentInstruction: extractContentInstruction(raw),
      explicitSelfTarget: composeRecipient.explicitSelfTarget,
    };
  }

  return null;
}

async function getPrimaryGmailAddress(userId: string) {
  const { data, error } = await getClawCloudSupabaseAdmin()
    .from("connected_accounts")
    .select("account_email")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data?.account_email as string | null | undefined)?.trim() || null;
}

async function resolveComposeRecipient(
  userId: string,
  action: Extract<ParsedGmailAction, { kind: "draft" | "send" }>,
) {
  if (action.explicitSelfTarget) {
    return await getPrimaryGmailAddress(userId);
  }

  return extractEmailAddress(action.recipientHint ?? "");
}

async function resolveReplyTarget(userId: string, senderHint: string | null): Promise<GmailReplyTarget | null> {
  const emails = await getClawCloudGmailMessages(userId, {
    query: "in:anywhere newer_than:90d",
    maxResults: 25,
  });

  const ranked = [...emails].sort((left, right) => Date.parse(right.date || "") - Date.parse(left.date || ""));
  if (!senderHint) {
    const latest = ranked[0];
    return latest
      ? {
          id: latest.id,
          from: latest.from,
          subject: latest.subject,
          body: latest.body,
          snippet: latest.snippet,
          replyTo: latest.replyTo,
          messageId: latest.messageId,
          date: latest.date,
        }
      : null;
  }

  const normalizedHint = normalizeSenderValue(senderHint);
  const matched = ranked.find((email) => {
    const haystack = [
      email.from,
      email.replyTo,
      email.subject,
      email.snippet,
    ].filter(Boolean).map(normalizeSenderValue).join(" ");
    return haystack.includes(normalizedHint);
  });

  return matched
    ? {
        id: matched.id,
        from: matched.from,
        subject: matched.subject,
        body: matched.body,
        snippet: matched.snippet,
        replyTo: matched.replyTo,
        messageId: matched.messageId,
        date: matched.date,
      }
    : null;
}

function parseStructuredEmailDraft(value: string, fallbackSubject: string) {
  const subjectMatch = value.match(/subject\s*:\s*(.+)/i);
  const bodyMatch = value.match(/body\s*:\s*([\s\S]+)/i);
  const subject = normalizeText(subjectMatch?.[1] ?? fallbackSubject) || fallbackSubject;
  const body = normalizeText(bodyMatch?.[1] ?? value.replace(/subject\s*:.+/i, "").trim());
  return {
    subject,
    body: body || "Thank you for your message.",
  };
}

async function generateComposedEmail(input: {
  prompt: string;
  toLabel: string;
  instruction: string;
  subjectHint: string | null;
}) {
  const fallbackSubject = input.subjectHint || "Quick follow-up";
  const fallbackBody = normalizeText(input.instruction);
  const draft = await completeClawCloudPrompt({
    system: [
      "You write polished, professional emails.",
      "Return exactly this format:",
      "Subject: <short subject>",
      "Body: <full email body>",
      "Do not sign as the recipient, vendor, or company mentioned in the request.",
      "If no sender identity is provided, end with a neutral sign-off like `Best regards,` and no sender name.",
      "Keep the body concise, practical, and ready to send.",
    ].join("\n"),
    user: [
      `Recipient: ${input.toLabel}`,
      `User request: ${input.prompt}`,
      `Instruction to convey: ${input.instruction}`,
      input.subjectHint ? `Preferred subject: ${input.subjectHint}` : "",
    ].filter(Boolean).join("\n"),
    intent: "email",
    maxTokens: 320,
    fallback: `Subject: ${fallbackSubject}\nBody: ${fallbackBody}`,
  });

  return parseStructuredEmailDraft(draft, fallbackSubject);
}

async function generateReplyEmail(input: {
  prompt: string;
  original: GmailReplyTarget;
  instruction: string | null;
}) {
  const fallbackBody = input.instruction
    ? normalizeText(input.instruction)
    : "Thank you for your email. I understand your message and will move forward accordingly.";
  const draft = await completeClawCloudPrompt({
    system: [
      "You write concise, professional email replies.",
      "Return only the reply body, no subject line and no markdown.",
      "Reference the original email naturally when useful.",
      "Do not sign as the recipient, vendor, or company from the email you are replying to.",
      "If the user does not specify the sender identity, end with a neutral sign-off like `Best regards,` and no sender name.",
      "Keep it under 120 words unless the user explicitly asks for more detail.",
    ].join("\n"),
    user: [
      `User request: ${input.prompt}`,
      `From: ${input.original.from}`,
      `Original subject: ${input.original.subject}`,
      `Original email body: ${input.original.body || input.original.snippet || "(No body available)"}`,
      input.instruction ? `Reply should convey: ${input.instruction}` : "Write an appropriate professional reply.",
    ].join("\n\n"),
    intent: "email",
    maxTokens: 280,
    fallback: fallbackBody,
  });

  return normalizeText(draft) || fallbackBody;
}

function buildDraftCreatedReply(to: string, subject: string, body: string, replyMode = false) {
  const preview = body.length > 240 ? `${body.slice(0, 240)}...` : body;
  return [
    replyMode ? "📧 *Gmail reply draft created*" : "📧 *Gmail draft created*",
    `*To:* ${to}`,
    `*Subject:* ${subject}`,
    "",
    "*Preview:*",
    preview,
    "",
    "_Saved in your Gmail drafts._",
  ].join("\n");
}

function buildSentReply(to: string, subject: string, body: string, replyMode = false) {
  const preview = body.length > 240 ? `${body.slice(0, 240)}...` : body;
  return [
    replyMode ? "📨 *Gmail reply sent*" : "📨 *Email sent via Gmail*",
    `*To:* ${to}`,
    `*Subject:* ${subject}`,
    "",
    "*Sent message:*",
    preview,
  ].join("\n");
}

function buildModifiedReply(actionLabel: string, target: GmailReplyTarget) {
  return [
    `📧 *${actionLabel}*`,
    `*From:* ${target.from || "Unknown sender"}`,
    `*Subject:* ${target.subject || "(No subject)"}`,
  ].join("\n");
}

export async function handleGmailActionRequest(userId: string, text: string) {
  const action = parseGmailActionRequest(text);
  if (!action || action.kind === "reply_queue") {
    return null;
  }

  try {
    if (action.kind === "draft" || action.kind === "send") {
      const recipient = await resolveComposeRecipient(userId, action);
      if (!recipient) {
        return [
          "📧 *I can do that in Gmail, but I need the recipient email address.*",
          "",
          "Try one of these:",
          "• _Create a Gmail draft to name@example.com saying ..._",
          "• _Send an email to my Gmail saying ..._",
        ].join("\n");
      }

      const instruction = action.contentInstruction;
      if (!instruction) {
        return [
          "📧 *Tell me what the email should say.*",
          "",
          "Examples:",
          "• _Create a Gmail draft to name@example.com saying I understand your message and will follow up tomorrow._",
          "• _Send an email to my Gmail saying I reached home safely._",
        ].join("\n");
      }

      const composed = await generateComposedEmail({
        prompt: text,
        toLabel: recipient,
        instruction,
        subjectHint: action.subjectHint,
      });

      const approval = await queueReplyApproval({
        userId,
        action: action.kind === "draft" ? "compose_draft" : "compose_send",
        to: recipient,
        subject: composed.subject,
        body: composed.body,
        originalPrompt: text,
        targetLabel: recipient,
      });

      return buildReplyApprovalReviewReply(approval);
    }

    if (action.kind === "reply_draft" || action.kind === "reply_send") {
      const target = await resolveReplyTarget(userId, action.senderHint);
      if (!target) {
        return action.senderHint
          ? `📭 *I couldn't find a recent email from ${action.senderHint}.*\n\nTry a more specific sender name or email address.`
          : "📭 *I couldn't find a recent email to reply to right now.*";
      }

      const to = extractEmailAddress(target.replyTo || target.from);
      if (!to) {
        return "📭 *I found the email, but I couldn't resolve a reply address from it.*";
      }

      const subject = cleanReplySubject(action.subjectHint || target.subject || "Quick follow-up");
      const body = await generateReplyEmail({
        prompt: text,
        original: target,
        instruction: action.contentInstruction,
      });

      const approval = await queueReplyApproval({
        userId,
        action: action.kind === "reply_draft" ? "reply_draft" : "reply_send",
        to,
        subject,
        body,
        inReplyTo: target.messageId || null,
        originalEmailId: target.id,
        originalPrompt: text,
        targetLabel: target.from,
      });

      return buildReplyApprovalReviewReply(approval);
    }

    const modifyAction = action as Extract<
      ParsedGmailAction,
      { kind: "mark_read" | "mark_unread" | "archive" | "trash" | "restore" | "mark_spam" | "mark_not_spam" | "star" | "unstar" }
    >;
    const target = await resolveReplyTarget(userId, modifyAction.senderHint);
    if (!target) {
      return modifyAction.senderHint
        ? `📭 *I couldn't find a recent email from ${modifyAction.senderHint}.*\n\nTry a more specific sender name or email address.`
        : "📭 *I couldn't find a recent email to update right now.*";
    }

    if (modifyAction.kind === "mark_read") {
      await modifyClawCloudGmailMessage(userId, {
        messageId: target.id,
        removeLabelIds: ["UNREAD"],
      });
      return buildModifiedReply("Marked email as read", target);
    }

    if (modifyAction.kind === "mark_unread") {
      await modifyClawCloudGmailMessage(userId, {
        messageId: target.id,
        addLabelIds: ["UNREAD"],
      });
      return buildModifiedReply("Marked email as unread", target);
    }

    if (modifyAction.kind === "archive") {
      await modifyClawCloudGmailMessage(userId, {
        messageId: target.id,
        removeLabelIds: ["INBOX"],
      });
      return buildModifiedReply("Archived email", target);
    }

    if (modifyAction.kind === "trash") {
      await modifyClawCloudGmailMessage(userId, {
        messageId: target.id,
        addLabelIds: ["TRASH"],
        removeLabelIds: ["INBOX", "SPAM"],
      });
      return buildModifiedReply("Moved email to trash", target);
    }

    if (modifyAction.kind === "restore") {
      await modifyClawCloudGmailMessage(userId, {
        messageId: target.id,
        addLabelIds: ["INBOX"],
        removeLabelIds: ["TRASH", "SPAM"],
      });
      return buildModifiedReply("Restored email to inbox", target);
    }

    if (modifyAction.kind === "mark_spam") {
      await modifyClawCloudGmailMessage(userId, {
        messageId: target.id,
        addLabelIds: ["SPAM"],
        removeLabelIds: ["INBOX", "TRASH"],
      });
      return buildModifiedReply("Marked email as spam", target);
    }

    if (modifyAction.kind === "mark_not_spam") {
      await modifyClawCloudGmailMessage(userId, {
        messageId: target.id,
        addLabelIds: ["INBOX"],
        removeLabelIds: ["SPAM", "TRASH"],
      });
      return buildModifiedReply("Removed email from spam", target);
    }

    if (modifyAction.kind === "star") {
      await modifyClawCloudGmailMessage(userId, {
        messageId: target.id,
        addLabelIds: ["STARRED"],
      });
      return buildModifiedReply("Starred email", target);
    }

    await modifyClawCloudGmailMessage(userId, {
      messageId: target.id,
      removeLabelIds: ["STARRED"],
    });
    return buildModifiedReply("Removed star from email", target);
  } catch (error) {
    if (isClawCloudGoogleReconnectRequiredError(error)) {
      return buildGoogleReconnectRequiredReply("Gmail");
    }
    if (isClawCloudGoogleNotConnectedError(error, "gmail")) {
      return buildGoogleNotConnectedReply("Gmail");
    }
    throw error;
  }
}
