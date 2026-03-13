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
};

export async function listReplyApprovals(userId: string, limit = 50) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("reply_approvals")
    .select("id, user_id, email_id, email_from, email_subject, draft_body, status, created_at")
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
    to: approval.email_from,
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
  const emails = await getClawCloudGmailMessages(userId, {
    query: "is:unread -from:noreply -from:no-reply -from:mailer",
    maxResults: maxEmails,
  });

  if (emails.length === 0) {
    const message = await translateMessage(
      "No emails need replies right now. I will check again later.",
      locale,
    );
    await sendClawCloudWhatsAppMessage(userId, message);
    return { queued: 0 };
  }

  let queued = 0;

  for (const email of emails.slice(0, maxEmails)) {
    const { data: existingApproval } = await supabaseAdmin
      .from("reply_approvals")
      .select("id")
      .eq("user_id", userId)
      .eq("email_id", email.id)
      .maybeSingle();

    if (existingApproval?.id) {
      continue;
    }

    const draftBody = await completeClawCloudPrompt({
      system:
        "You write concise, professional email replies. Return only the reply body.",
      user: `Write a reply to this email.\n\nFrom: ${email.from}\nSubject: ${email.subject}\nBody:\n${email.body || email.snippet}`,
      maxTokens: 300,
      fallback:
        "Hi,\n\nThank you for your email. I will get back to you shortly.\n\nBest regards,",
    });

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

    const preview =
      draftBody.length > 200 ? `${draftBody.slice(0, 200)}...` : draftBody;
    const message = [
      `New email from ${email.from}`,
      `Subject: ${email.subject}`,
      "",
      "Draft reply:",
      preview,
      "",
      "Reply with:",
      `SEND ${approval.id.slice(0, 8)} to send it`,
      `EDIT ${approval.id.slice(0, 8)} <your text> to change it`,
      `SKIP ${approval.id.slice(0, 8)} to ignore it`,
    ].join("\n");

    await sendClawCloudWhatsAppMessage(userId, await translateMessage(message, locale));
    queued += 1;
  }

  if (queued === 0) {
    const message = await translateMessage(
      "No new reply approvals need your review right now.",
      locale,
    );
    await sendClawCloudWhatsAppMessage(userId, message);
  }

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
        "I could not find that draft. It may already be sent or skipped.",
        locale,
      ),
    };
  }

  if (skipMatch) {
    await updateReplyApproval(userId, approval.id, { action: "skip" });

    return {
      handled: true,
      response: await translateMessage(`Skipped the reply to ${approval.email_from}.`, locale),
    };
  }

  const finalBody = editMatch?.[2]?.trim() || approval.draft_body;

  try {
    await updateReplyApproval(userId, approval.id, {
      action: "send",
      draftBody: finalBody,
    });

    if (editMatch) {
      await supabaseAdmin
        .from("reply_approvals")
        .update({
          status: "edit_requested",
          updated_at: new Date().toISOString(),
        })
        .eq("id", approval.id);
    }

    await upsertAnalyticsDaily(userId, {
      drafts_created: 1,
      tasks_run: 1,
      wa_messages_sent: 1,
    });

    return {
      handled: true,
      response: await translateMessage(
        `Reply sent to ${approval.email_from}.\n\nSubject: Re: ${approval.email_subject}`,
        locale,
      ),
    };
  } catch (error) {
    const messageText =
      error instanceof Error ? error.message : "Unknown error while sending the reply.";

    return {
      handled: true,
      response: await translateMessage(
        `Failed to send the reply: ${messageText}. Please try again.`,
        locale,
      ),
    };
  }
}
