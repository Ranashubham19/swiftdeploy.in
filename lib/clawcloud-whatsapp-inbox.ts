import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { normalizeContactName, normalizePhone } from "@/lib/clawcloud-contacts";
import { listWhatsAppReplyApprovals } from "@/lib/clawcloud-whatsapp-approval";
import { decorateClawCloudWhatsAppContactIdentitySeeds } from "@/lib/clawcloud-whatsapp-contact-identity";
import { loadFallbackSyncedWhatsAppContacts } from "@/lib/clawcloud-whatsapp-contacts";
import { normalizeWhatsAppPriority } from "@/lib/clawcloud-whatsapp-control";
import type {
  WhatsAppHistoryEntry,
  WhatsAppHistoryInsights,
  WhatsAppInboxContact,
  WhatsAppInboxSummary,
  WhatsAppGroupThreadInsight,
  WhatsAppMediaSummary,
  WhatsAppReplyApproval,
} from "@/lib/clawcloud-whatsapp-workspace-types";

type ContactRow = {
  jid: string;
  phone_number: string | null;
  contact_name: string | null;
  notify_name: string | null;
  verified_name: string | null;
  aliases?: string[] | null;
  tags?: string[] | null;
  priority?: string | null;
  last_seen_at?: string | null;
};

type MessageRow = WhatsAppHistoryEntry;
type ResolvedHistoryContact = {
  phone?: string | null;
  jid?: string | null;
  aliases?: string[] | null;
};
const WHATSAPP_HISTORY_READ_LIMIT_MAX = 1_000;
const WHATSAPP_CONTACT_LIST_LIMIT = 1_000;
const WHATSAPP_CONTACT_MESSAGE_SCAN_LIMIT = 1_500;
const WHATSAPP_MEDIA_MESSAGE_TYPES = ["image", "audio", "document", "video"] as const;

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function normalizeHistoryContactName(value: string | null | undefined) {
  return normalizeContactName(String(value ?? "").trim());
}

function normalizeHistoryPhone(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }

  const normalized = normalizePhone(raw);
  return normalized || raw.replace(/\D/g, "");
}

function buildSafeIlikePattern(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim().replace(/[%_]/g, "");
  return trimmed ? `%${trimmed}%` : "";
}

function hasResolvedHistoryExactIdentity(
  resolvedContact: ResolvedHistoryContact | null | undefined,
) {
  return Boolean(
    normalizeHistoryPhone(resolvedContact?.phone)
    || String(resolvedContact?.jid ?? "").trim(),
  );
}

function pickPreferredContactLabel(current: string | null | undefined, candidate: string | null | undefined) {
  const currentValue = String(current ?? "").trim() || null;
  const candidateValue = String(candidate ?? "").trim() || null;
  if (!candidateValue) {
    return currentValue ?? null;
  }
  if (!currentValue) {
    return candidateValue;
  }

  const currentIsDigits = /^\d+$/.test(currentValue);
  const candidateIsDigits = /^\d+$/.test(candidateValue);
  if (currentIsDigits && !candidateIsDigits) {
    return candidateValue;
  }
  if (!currentIsDigits && candidateIsDigits) {
    return currentValue;
  }

  const currentWords = currentValue.split(/\s+/).filter(Boolean).length;
  const candidateWords = candidateValue.split(/\s+/).filter(Boolean).length;
  if (candidateWords > currentWords) {
    return candidateValue;
  }
  if (candidateValue.length > currentValue.length + 2) {
    return candidateValue;
  }

  return currentValue;
}

function pickHigherPriority(current: string | null | undefined, candidate: string | null | undefined) {
  const priorityWeight: Record<string, number> = {
    low: 1,
    normal: 2,
    high: 3,
    vip: 4,
  };

  const currentValue = normalizeWhatsAppPriority(current);
  const candidateValue = normalizeWhatsAppPriority(candidate);
  return priorityWeight[candidateValue] >= priorityWeight[currentValue]
    ? candidateValue
    : currentValue;
}

function filterWhatsAppHistoryRowsForResolvedContact(
  rows: MessageRow[],
  resolvedContact: ResolvedHistoryContact | null | undefined,
) {
  if (!resolvedContact) {
    return rows;
  }

  const resolvedPhone = normalizeHistoryPhone(resolvedContact.phone);
  const resolvedJid = String(resolvedContact.jid ?? "").trim().toLowerCase();
  const aliases = new Set(
    uniqueStrings(resolvedContact.aliases ?? []).map((value) => normalizeHistoryContactName(value)).filter(Boolean),
  );
  const hasExactIdentity = Boolean(resolvedPhone || resolvedJid);

  return rows.filter((row) => {
    const rowPhone = normalizeHistoryPhone(row.remote_phone);
    const rowJid = String(row.remote_jid ?? "").trim().toLowerCase();
    const rowName = normalizeHistoryContactName(row.contact_name);
    const phoneMatches = Boolean(resolvedPhone && rowPhone && rowPhone === resolvedPhone);
    const jidMatches = Boolean(resolvedJid && rowJid && rowJid === resolvedJid);

    if (hasExactIdentity) {
      return phoneMatches || jidMatches;
    }

    return Boolean(rowName && aliases.has(rowName));
  });
}

export function filterWhatsAppHistoryRowsForResolvedContactForTest(
  rows: MessageRow[],
  resolvedContact: ResolvedHistoryContact | null | undefined,
) {
  return filterWhatsAppHistoryRowsForResolvedContact(rows, resolvedContact);
}

function buildWhatsAppHistoryDedupKey(row: MessageRow) {
  return [
    String(row.remote_jid ?? "").trim().toLowerCase(),
    normalizeHistoryPhone(row.remote_phone),
    String(row.sent_at ?? "").trim(),
    String(row.direction ?? "").trim().toLowerCase(),
    String(row.message_type ?? "").trim().toLowerCase(),
    String(row.chat_type ?? "").trim().toLowerCase(),
    String(row.content ?? "").replace(/\s+/g, " ").trim(),
  ].join("|");
}

function dedupeWhatsAppHistoryRows(rows: MessageRow[]) {
  const seen = new Set<string>();
  const deduped: MessageRow[] = [];

  for (const row of rows) {
    const key = buildWhatsAppHistoryDedupKey(row);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(row);
  }

  return deduped;
}

export function dedupeWhatsAppHistoryRowsForTest(rows: MessageRow[]) {
  return dedupeWhatsAppHistoryRows(rows);
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

type WhatsAppInboxSummarySnapshotInput = {
  contacts: WhatsAppInboxContact[];
  approvals: WhatsAppReplyApproval[];
  recentMessages: Array<Pick<MessageRow, "sent_at" | "chat_type" | "message_type" | "sensitivity" | "remote_jid">>;
  connected: boolean;
  contactCountOverride?: number | null;
};

export function buildWhatsAppInboxSummarySnapshot(
  input: WhatsAppInboxSummarySnapshotInput,
): WhatsAppInboxSummary {
  const contactCountOverride = typeof input.contactCountOverride === "number" && Number.isFinite(input.contactCountOverride)
    ? Math.max(0, Math.trunc(input.contactCountOverride))
    : null;

  return {
    connected: input.connected,
    contactCount: contactCountOverride ?? input.contacts.length,
    pendingApprovalCount: input.approvals.filter((item) => item.status === "pending").length,
    awaitingReplyCount: input.contacts.filter((item) => item.awaiting_reply).length,
    highPriorityCount: input.contacts.filter((item) => item.priority === "high" || item.priority === "vip").length,
    recentMessageCount: input.recentMessages.length,
    groupThreadCount: new Set(
      input.recentMessages
        .filter((item) => item.chat_type === "group" && String(item.remote_jid ?? "").trim())
        .map((item) => String(item.remote_jid)),
    ).size,
    mediaMessageCount: input.recentMessages.filter((item) => isMediaMessageType(item.message_type)).length,
    sensitiveMessageCount: input.recentMessages.filter((item) => item.sensitivity && item.sensitivity !== "normal").length,
  };
}

export async function listWhatsAppHistory(input: {
  userId: string;
  query?: string | null;
  contact?: string | null;
  resolvedContact?: ResolvedHistoryContact | null;
  contactExactOnly?: boolean;
  limit?: number;
  chatType?: string | null;
  approvalState?: string | null;
  sensitivity?: string | null;
  direction?: string | null;
  mediaOnly?: boolean;
  awaitingOnly?: boolean;
}) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), WHATSAPP_HISTORY_READ_LIMIT_MAX);
  const query = input.query?.trim().toLowerCase() ?? "";
  const contact = input.contact?.trim().toLowerCase() ?? "";
  const chatType = input.chatType?.trim().toLowerCase() ?? "";
  const approvalState = input.approvalState?.trim().toLowerCase() ?? "";
  const sensitivity = input.sensitivity?.trim().toLowerCase() ?? "";
  const direction = input.direction?.trim().toLowerCase() ?? "";
  const exactResolvedIdentity = hasResolvedHistoryExactIdentity(input.resolvedContact);
  const fetchLimit = exactResolvedIdentity
    ? Math.min(
      WHATSAPP_HISTORY_READ_LIMIT_MAX,
      Math.max(limit * 40, 200),
    )
    : Math.min(
      WHATSAPP_HISTORY_READ_LIMIT_MAX,
      Math.max(limit, limit * ((contact || query) ? 4 : 1)),
    );

  let historyQuery = supabaseAdmin
    .from("whatsapp_messages")
    .select(
      "id, direction, content, message_type, remote_jid, remote_phone, contact_name, chat_type, sent_at, priority, needs_reply, reply_confidence, sensitivity, approval_state, audit_payload",
    )
    .eq("user_id", input.userId)
    .order("sent_at", { ascending: false });

  if (exactResolvedIdentity) {
    const resolvedPhone = normalizeHistoryPhone(input.resolvedContact?.phone);
    const resolvedJid = String(input.resolvedContact?.jid ?? "").trim().toLowerCase();

    if (resolvedPhone) {
      historyQuery = historyQuery.eq("remote_phone", resolvedPhone);
    } else if (resolvedJid) {
      historyQuery = historyQuery.eq("remote_jid", resolvedJid);
    }

    const queryPattern = buildSafeIlikePattern(query);
    if (queryPattern) {
      historyQuery = historyQuery.ilike("content", queryPattern);
    }
  } else if (contact) {
    const normalizedContactPhone = normalizeHistoryPhone(contact);
    const contactPattern = buildSafeIlikePattern(contact);
    if (normalizedContactPhone && normalizedContactPhone === contact.replace(/\D/g, "")) {
      historyQuery = historyQuery.eq("remote_phone", normalizedContactPhone);
    } else if (contactPattern) {
      historyQuery = historyQuery.or([
        `contact_name.ilike.${contactPattern}`,
        `remote_phone.ilike.${contactPattern}`,
        `remote_jid.ilike.${contactPattern}`,
      ].join(","));
    }
  }

  if (chatType && chatType !== "all") {
    historyQuery = historyQuery.eq("chat_type", chatType);
  }

  if (approvalState && approvalState !== "all") {
    historyQuery = historyQuery.eq("approval_state", approvalState);
  }

  if (sensitivity && sensitivity !== "all") {
    historyQuery = historyQuery.eq("sensitivity", sensitivity);
  }

  if (direction && direction !== "all") {
    historyQuery = historyQuery.eq("direction", direction);
  }

  if (input.mediaOnly) {
    historyQuery = historyQuery.in("message_type", [...WHATSAPP_MEDIA_MESSAGE_TYPES]);
  }

  if (input.awaitingOnly) {
    historyQuery = historyQuery.eq("needs_reply", true);
  }

  const { data, error } = await historyQuery.limit(fetchLimit);

  if (error) {
    throw new Error(error.message);
  }

  let rows = dedupeWhatsAppHistoryRows((data ?? []) as MessageRow[]);

  if (query && !exactResolvedIdentity) {
    rows = rows.filter((row) =>
      row.content.toLowerCase().includes(query)
      || String(row.contact_name ?? "").toLowerCase().includes(query)
      || String(row.remote_phone ?? "").toLowerCase().includes(query),
    );
  }

  if (input.resolvedContact) {
    rows = filterWhatsAppHistoryRowsForResolvedContact(rows, input.resolvedContact);
  } else if (contact) {
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
    rows = rows.filter((row) => WHATSAPP_MEDIA_MESSAGE_TYPES.includes(String(row.message_type ?? "").trim().toLowerCase() as typeof WHATSAPP_MEDIA_MESSAGE_TYPES[number]));
  }

  if (input.awaitingOnly) {
    rows = rows.filter((row) => row.needs_reply);
  }

  rows = rows.slice(0, limit);

  return {
    rows,
    insights: buildHistoryInsights(rows),
    groupThreads: buildGroupThreads(rows),
    mediaSummary: buildMediaSummary(rows),
  };
}

export async function listWhatsAppContacts(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const [contactsResult, messagesResult, fallbackContacts] = await Promise.all([
    supabaseAdmin
      .from("whatsapp_contacts")
      .select("jid, phone_number, contact_name, notify_name, verified_name, tags, priority, last_seen_at")
      .eq("user_id", userId)
      .order("last_seen_at", { ascending: false })
      .limit(WHATSAPP_CONTACT_LIST_LIMIT),
    supabaseAdmin
      .from("whatsapp_messages")
      .select("direction, content, remote_jid, remote_phone, sent_at, needs_reply, contact_name")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(WHATSAPP_CONTACT_MESSAGE_SCAN_LIMIT),
    loadFallbackSyncedWhatsAppContacts(userId).catch(() => []),
  ]);

  if (messagesResult.error) {
    throw new Error(messagesResult.error.message);
  }

  if (contactsResult.error) {
    console.error("[whatsapp-inbox] whatsapp_contacts query failed:", contactsResult.error.message);
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

  const identitySeeds = [
    ...(((contactsResult.data ?? []) as ContactRow[]).filter(Boolean).map((contact) => ({
      jid: String(contact.jid ?? "").trim() || null,
      phone: String(contact.phone_number ?? "").trim() || null,
      displayName: contact.contact_name ?? contact.notify_name ?? contact.verified_name ?? contact.phone_number ?? contact.jid,
      aliases: uniqueStrings([
        contact.contact_name,
        contact.notify_name,
        contact.verified_name,
        ...(Array.isArray(contact.aliases) ? contact.aliases : []),
      ]),
      tags: Array.isArray(contact.tags) ? contact.tags : [],
      priority: contact.priority ?? "normal",
      lastSeenAt: contact.last_seen_at ?? null,
    }))),
    ...fallbackContacts.map((contact) => ({
      jid: String(contact.jid ?? "").trim() || null,
      phone: String(contact.phone_number ?? "").trim() || null,
      displayName: contact.contact_name ?? contact.notify_name ?? contact.verified_name ?? contact.phone_number ?? contact.jid,
      aliases: uniqueStrings([
        contact.contact_name,
        contact.notify_name,
        contact.verified_name,
        ...(Array.isArray(contact.aliases) ? contact.aliases : []),
        ...(Array.isArray(contact.identity_aliases) ? contact.identity_aliases : []),
      ]),
      identityKey: contact.identity_key,
      identityJids: contact.identity_jids,
      tags: [],
      priority: "normal",
      lastSeenAt: contact.last_seen_at ?? null,
    })),
    ...([...byChatKey.values()].map((message) => ({
      jid: String(message.remote_jid ?? "").trim() || null,
      phone: String(message.remote_phone ?? "").trim() || null,
      displayName: String(message.contact_name ?? "").trim() || String(message.remote_phone ?? "").trim() || String(message.remote_jid ?? "").trim(),
      aliases: uniqueStrings([
        String(message.contact_name ?? "").trim() || null,
        String(message.remote_phone ?? "").trim() || null,
      ]),
      tags: [],
      priority: "normal",
      lastSeenAt: message.sent_at ?? null,
    }))),
  ];

  const decoratedContacts = decorateClawCloudWhatsAppContactIdentitySeeds(identitySeeds);
  const mergedContacts = new Map<string, {
    jid: string;
    phone_number: string | null;
    display_name: string;
    aliases: Set<string>;
    tags: Set<string>;
    priority: string;
    last_seen_at: string | null;
    identity_jids: Set<string>;
  }>();

  for (const contact of decoratedContacts) {
    const identityKey = contact.identityKey;
    const existing = mergedContacts.get(identityKey) ?? {
      jid: String(contact.identityJids?.[0] ?? contact.jid ?? contact.phone ?? identityKey).trim(),
      phone_number: String(contact.phone ?? "").trim() || null,
      display_name:
        String(contact.displayName ?? "").trim()
        || String(contact.aliases?.[0] ?? "").trim()
        || String(contact.phone ?? contact.jid ?? identityKey).trim(),
      aliases: new Set<string>(),
      tags: new Set<string>(),
      priority: "normal",
      last_seen_at: null,
      identity_jids: new Set<string>(),
    };

    existing.jid = String(existing.jid || contact.identityJids?.[0] || contact.jid || contact.phone || identityKey).trim();
    existing.phone_number = existing.phone_number ?? (String(contact.phone ?? "").trim() || null);
    existing.display_name =
      pickPreferredContactLabel(
        existing.display_name,
        String(contact.displayName ?? "").trim()
        || String(contact.aliases?.[0] ?? "").trim()
        || null,
      )
      ?? existing.display_name;
    existing.priority = pickHigherPriority(existing.priority, contact.priority);
    existing.last_seen_at =
      [existing.last_seen_at, contact.lastSeenAt]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .sort()
        .slice(-1)[0] ?? existing.last_seen_at;

    for (const alias of uniqueStrings([
      ...(Array.isArray(contact.aliases) ? contact.aliases : []),
      ...(Array.isArray(contact.identityAliases) ? contact.identityAliases : []),
      contact.displayName,
      contact.phone,
    ])) {
      existing.aliases.add(alias);
    }
    for (const tag of Array.isArray(contact.tags) ? contact.tags : []) {
      existing.tags.add(tag);
    }
    for (const jid of Array.isArray(contact.identityJids) ? contact.identityJids : []) {
      if (jid) {
        existing.identity_jids.add(jid);
      }
    }
    if (contact.jid) {
      existing.identity_jids.add(contact.jid);
    }

    mergedContacts.set(identityKey, existing);
  }

  const messageIdentityLookup = new Map<string, string>();
  for (const [identityKey, contact] of mergedContacts) {
    if (contact.phone_number) {
      messageIdentityLookup.set(contact.phone_number, identityKey);
    }
    for (const jid of contact.identity_jids) {
      messageIdentityLookup.set(jid, identityKey);
    }
  }

  const lastMessageByIdentity = new Map<string, (typeof messages)[number]>();
  for (const message of messages) {
    const identityKey =
      messageIdentityLookup.get(String(message.remote_jid ?? "").trim())
      ?? messageIdentityLookup.get(String(message.remote_phone ?? "").trim());
    if (!identityKey || lastMessageByIdentity.has(identityKey)) {
      continue;
    }
    lastMessageByIdentity.set(identityKey, message);
  }

  return [...mergedContacts.entries()]
    .map(([identityKey, contact]): WhatsAppInboxContact & { sort_key: string } => {
      const lastMessage = lastMessageByIdentity.get(identityKey) ?? null;

      return {
        jid: contact.jid,
        phone_number: contact.phone_number ?? null,
        display_name: contact.display_name,
        aliases: [...contact.aliases],
        tags: [...contact.tags],
        priority: normalizeWhatsAppPriority(contact.priority),
        last_seen_at: contact.last_seen_at ?? null,
        last_message_at: lastMessage?.sent_at ?? null,
        last_message_direction: lastMessage?.direction ?? null,
        last_message_preview: lastMessage?.content?.slice(0, 140) ?? null,
        awaiting_reply: Boolean(lastMessage?.needs_reply),
        sort_key: String(lastMessage?.sent_at ?? contact.last_seen_at ?? ""),
      };
    })
    .sort((left, right) => right.sort_key.localeCompare(left.sort_key))
    .map(({ sort_key: _sortKey, ...contact }) => contact);
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
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("provider", "whatsapp")
      .eq("is_active", true)
      .then(({ count }) => (count ?? 0) > 0)
      .catch(() => false),
  ]);

  return buildWhatsAppInboxSummarySnapshot({
    contacts,
    approvals,
    recentMessages,
    connected,
  });
}
