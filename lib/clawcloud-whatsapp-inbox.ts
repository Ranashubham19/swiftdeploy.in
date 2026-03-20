import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { listWhatsAppReplyApprovals } from "@/lib/clawcloud-whatsapp-approval";
import { normalizeWhatsAppPriority } from "@/lib/clawcloud-whatsapp-control";
import type {
  WhatsAppHistoryEntry,
  WhatsAppHistoryInsights,
  WhatsAppInboxContact,
  WhatsAppInboxSummary,
  WhatsAppGroupThreadInsight,
  WhatsAppMediaSummary,
} from "@/lib/clawcloud-whatsapp-workspace-types";

type ContactRow = {
  jid: string;
  phone_number: string | null;
  contact_name: string | null;
  notify_name: string | null;
  verified_name: string | null;
  tags?: string[] | null;
  priority?: string | null;
  last_seen_at?: string | null;
};

type MessageRow = WhatsAppHistoryEntry;

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function isMediaMessageType(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "image"
    || normalized === "audio"
    || normalized === "document"
    || normalized === "video";
}

function buildHistoryInsights(rows: MessageRow[]): WhatsAppHistoryInsights {
  return {
    resultCount: rows.length,
    awaitingReplyCount: rows.filter((row) => row.needs_reply).length,
    sensitiveCount: rows.filter((row) => row.sensitivity !== "normal").length,
    blockedCount: rows.filter((row) => row.approval_state === "blocked").length,
    groupCount: rows.filter((row) => row.chat_type === "group").length,
    mediaCount: rows.filter((row) => isMediaMessageType(row.message_type)).length,
  };
}

function buildGroupThreads(rows: MessageRow[]): WhatsAppGroupThreadInsight[] {
  const groups = new Map<string, WhatsAppGroupThreadInsight>();

  for (const row of rows) {
    if (row.chat_type !== "group") {
      continue;
    }

    const key = String(row.remote_jid ?? "").trim();
    if (!key) {
      continue;
    }

    const current = groups.get(key) ?? {
      jid: key,
      display_name: row.contact_name || key,
      message_count: 0,
      pending_approval_count: 0,
      sensitive_count: 0,
      last_message_at: row.sent_at,
      last_message_preview: row.content.slice(0, 140),
    };

    current.message_count += 1;
    if (row.approval_state === "pending") {
      current.pending_approval_count += 1;
    }
    if (row.sensitivity !== "normal") {
      current.sensitive_count += 1;
    }
    if (!current.last_message_at || row.sent_at > current.last_message_at) {
      current.last_message_at = row.sent_at;
      current.last_message_preview = row.content.slice(0, 140);
      current.display_name = row.contact_name || current.display_name;
    }

    groups.set(key, current);
  }

  return [...groups.values()]
    .sort((left, right) => String(right.last_message_at ?? "").localeCompare(String(left.last_message_at ?? "")))
    .slice(0, 12);
}

function buildMediaSummary(rows: MessageRow[]): WhatsAppMediaSummary {
  const summary: WhatsAppMediaSummary = {
    image: 0,
    audio: 0,
    document: 0,
    video: 0,
    other: 0,
  };

  for (const row of rows) {
    switch (String(row.message_type ?? "").trim().toLowerCase()) {
      case "image":
        summary.image += 1;
        break;
      case "audio":
        summary.audio += 1;
        break;
      case "document":
        summary.document += 1;
        break;
      case "video":
        summary.video += 1;
        break;
      default:
        if (isMediaMessageType(row.message_type)) {
          summary.other += 1;
        }
        break;
    }
  }

  return summary;
}

export async function listWhatsAppHistory(input: {
  userId: string;
  query?: string | null;
  contact?: string | null;
  limit?: number;
  chatType?: string | null;
  approvalState?: string | null;
  sensitivity?: string | null;
  direction?: string | null;
  mediaOnly?: boolean;
  awaitingOnly?: boolean;
}) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 300);
  const { data, error } = await supabaseAdmin
    .from("whatsapp_messages")
    .select(
      "id, direction, content, message_type, remote_jid, remote_phone, contact_name, chat_type, sent_at, priority, needs_reply, reply_confidence, sensitivity, approval_state, audit_payload",
    )
    .eq("user_id", input.userId)
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  let rows = (data ?? []) as MessageRow[];
  const query = input.query?.trim().toLowerCase() ?? "";
  const contact = input.contact?.trim().toLowerCase() ?? "";
  const chatType = input.chatType?.trim().toLowerCase() ?? "";
  const approvalState = input.approvalState?.trim().toLowerCase() ?? "";
  const sensitivity = input.sensitivity?.trim().toLowerCase() ?? "";
  const direction = input.direction?.trim().toLowerCase() ?? "";

  if (query) {
    rows = rows.filter((row) =>
      row.content.toLowerCase().includes(query)
      || String(row.contact_name ?? "").toLowerCase().includes(query)
      || String(row.remote_phone ?? "").toLowerCase().includes(query),
    );
  }

  if (contact) {
    rows = rows.filter((row) =>
      String(row.contact_name ?? "").toLowerCase().includes(contact)
      || String(row.remote_phone ?? "").toLowerCase().includes(contact)
      || String(row.remote_jid ?? "").toLowerCase().includes(contact),
    );
  }

  if (chatType && chatType !== "all") {
    rows = rows.filter((row) => String(row.chat_type ?? "").toLowerCase() === chatType);
  }

  if (approvalState && approvalState !== "all") {
    rows = rows.filter((row) => String(row.approval_state ?? "").toLowerCase() === approvalState);
  }

  if (sensitivity && sensitivity !== "all") {
    rows = rows.filter((row) => String(row.sensitivity ?? "").toLowerCase() === sensitivity);
  }

  if (direction && direction !== "all") {
    rows = rows.filter((row) => String(row.direction ?? "").toLowerCase() === direction);
  }

  if (input.mediaOnly) {
    rows = rows.filter((row) => isMediaMessageType(row.message_type));
  }

  if (input.awaitingOnly) {
    rows = rows.filter((row) => row.needs_reply);
  }

  return {
    rows,
    insights: buildHistoryInsights(rows),
    groupThreads: buildGroupThreads(rows),
    mediaSummary: buildMediaSummary(rows),
  };
}

export async function listWhatsAppContacts(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const [contactsResult, messagesResult] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_contacts")
      .select("jid, phone_number, contact_name, notify_name, verified_name, tags, priority, last_seen_at")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(300),
    supabaseAdmin
      .from("whatsapp_messages")
      .select("direction, content, remote_jid, remote_phone, sent_at, needs_reply, contact_name")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(500),
  ]);

  if (contactsResult.error) {
    throw new Error(contactsResult.error.message);
  }
  if (messagesResult.error) {
    throw new Error(messagesResult.error.message);
  }

  const messages = messagesResult.data ?? [];
  const byChatKey = new Map<string, (typeof messages)[number]>();

  for (const message of messages) {
    const key = String(message.remote_jid ?? message.remote_phone ?? "").trim();
    if (!key || byChatKey.has(key)) {
      continue;
    }
    byChatKey.set(key, message);
  }

  return ((contactsResult.data ?? []) as ContactRow[]).map((contact): WhatsAppInboxContact => {
    const lastMessage =
      byChatKey.get(contact.jid)
      ?? byChatKey.get(String(contact.phone_number ?? "").trim())
      ?? null;

    const displayName =
      contact.contact_name?.trim()
      || contact.notify_name?.trim()
      || contact.verified_name?.trim()
      || contact.phone_number
      || contact.jid;

    return {
      jid: contact.jid,
      phone_number: contact.phone_number ?? null,
      display_name: displayName,
      aliases: uniqueStrings([
        contact.contact_name,
        contact.notify_name,
        contact.verified_name,
      ]),
      tags: Array.isArray(contact.tags)
        ? contact.tags.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        : [],
      priority: normalizeWhatsAppPriority(contact.priority),
      last_seen_at: contact.last_seen_at ?? null,
      last_message_at: lastMessage?.sent_at ?? null,
      last_message_direction: lastMessage?.direction ?? null,
      last_message_preview: lastMessage?.content?.slice(0, 140) ?? null,
      awaiting_reply: Boolean(lastMessage?.needs_reply),
    };
  });
}

export async function updateWhatsAppContactWorkspace(
  userId: string,
  input: {
    jid?: string | null;
    phoneNumber?: string | null;
    priority?: string | null;
    tags?: string[] | null;
  },
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const normalizedTags = (input.tags ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);

  let query = supabaseAdmin
    .from("whatsapp_contacts")
    .update({
      priority: normalizeWhatsAppPriority(input.priority),
      tags: normalizedTags,
    })
    .eq("user_id", userId);

  if (input.jid) {
    query = query.eq("jid", input.jid);
  } else if (input.phoneNumber) {
    query = query.eq("phone_number", input.phoneNumber);
  } else {
    throw new Error("jid or phoneNumber is required.");
  }

  const { error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return true;
}

export async function getWhatsAppInboxSummary(userId: string): Promise<WhatsAppInboxSummary> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const [contacts, approvals, recentMessages, connected] = await Promise.all([
    listWhatsAppContacts(userId).catch(() => []),
    listWhatsAppReplyApprovals(userId, 200).catch(() => []),
    supabaseAdmin
      .from("whatsapp_messages")
      .select("id, sent_at, chat_type, message_type, sensitivity, remote_jid")
      .eq("user_id", userId)
      .gte("sent_at", new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(500)
      .then(({ data }) => data ?? [])
      .catch(() => []),
    supabaseAdmin
      .from("connected_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", "whatsapp")
      .eq("is_active", true)
      .maybeSingle()
      .then(({ data }) => Boolean(data))
      .catch(() => false),
  ]);

  return {
    connected,
    contactCount: contacts.length,
    pendingApprovalCount: approvals.filter((item) => item.status === "pending").length,
    awaitingReplyCount: contacts.filter((item) => item.awaiting_reply).length,
    highPriorityCount: contacts.filter((item) => item.priority === "high" || item.priority === "vip").length,
    recentMessageCount: recentMessages.length,
    groupThreadCount: new Set(
      recentMessages
        .filter((item) => item.chat_type === "group" && String(item.remote_jid ?? "").trim())
        .map((item) => String(item.remote_jid)),
    ).size,
    mediaMessageCount: recentMessages.filter((item) => isMediaMessageType(item.message_type)).length,
    sensitiveMessageCount: recentMessages.filter((item) => item.sensitivity && item.sensitivity !== "normal").length,
  };
}
