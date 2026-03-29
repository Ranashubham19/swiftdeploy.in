import { isClawCloudMissingSchemaMessage } from "@/lib/clawcloud-schema-compat";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  decorateClawCloudWhatsAppContactIdentitySeeds,
  type ClawCloudWhatsAppContactIdentityQuality,
} from "@/lib/clawcloud-whatsapp-contact-identity";
import { buildClawCloudWhatsAppSyncPolicy } from "@/lib/clawcloud-whatsapp-sync-policy";

const CONTACTS_TASK_TYPE = "user_contacts";
const WHATSAPP_SYNC_POLICY = buildClawCloudWhatsAppSyncPolicy({
  historyContactBackfillScanLimit: Number.parseInt(
    process.env.WA_HISTORY_CONTACT_BACKFILL_SCAN_LIMIT ?? "",
    10,
  ),
});
const whatsappContactWriteQueues = new Map<string, Promise<void>>();

export type WhatsAppContactSyncInput = {
  jid?: string | null;
  phoneNumber?: string | null;
  contactName?: string | null;
  notifyName?: string | null;
  verifiedName?: string | null;
  aliases?: string[] | null;
  source?: "session" | "history" | "message";
  sourceKinds?: string[] | null;
  messageCount?: number | null;
  lastMessageAt?: string | null;
  lastSeenAt?: string | null;
};

type SyncedAliasRow = {
  jid?: string | null;
  phone_number: string | null;
  contact_name: string | null;
  notify_name: string | null;
  verified_name: string | null;
  aliases?: string[] | null;
  last_seen_at?: string | null;
};

type FallbackSyncedContactRow = {
  jid?: string | null;
  phone_number?: string | null;
  contact_name?: string | null;
  notify_name?: string | null;
  verified_name?: string | null;
  aliases?: string[] | null;
  identity_key?: string | null;
  identity_aliases?: string[] | null;
  identity_jids?: string[] | null;
  identity_quality?: ClawCloudWhatsAppContactIdentityQuality | null;
  source_kinds?: string[] | null;
  message_count?: number | null;
  last_message_at?: string | null;
  last_seen_at?: string | null;
};

type WhatsAppHistoryBackfillRow = {
  remote_jid?: string | null;
  remote_phone?: string | null;
  contact_name?: string | null;
  sent_at?: string | null;
};

export type RichWhatsAppContactUpsertRow = {
  user_id: string;
  jid: string;
  phone_number: string | null;
  contact_name: string | null;
  notify_name: string | null;
  verified_name: string | null;
  aliases: string[];
  identity_key: string;
  identity_aliases: string[];
  identity_jids: string[];
  identity_quality: ClawCloudWhatsAppContactIdentityQuality;
  source: "session" | "history" | "message";
  source_kinds: string[];
  message_count: number | null;
  last_message_at: string | null;
  last_seen_at: string;
};

const WHATSAPP_CONTACT_SOURCE_PRIORITY: Record<RichWhatsAppContactUpsertRow["source"], number> = {
  message: 1,
  history: 2,
  session: 3,
};

export type SyncedWhatsAppContactRow = {
  jid: string | null;
  phone_number: string | null;
  contact_name: string | null;
  notify_name: string | null;
  verified_name: string | null;
  aliases: string[];
  identity_key: string | null;
  identity_aliases: string[];
  identity_jids: string[];
  identity_quality: ClawCloudWhatsAppContactIdentityQuality | null;
  source_kinds: string[];
  message_count: number | null;
  last_message_at: string | null;
  last_seen_at: string | null;
};

function normalizePhoneDigits(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeJid(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase() || null;
}

function isDirectPersonJid(jid: string) {
  return /@(s\.whatsapp\.net|lid)$/i.test(jid);
}

function phoneFromJid(jid: string | null | undefined) {
  const value = String(jid ?? "").trim().toLowerCase();
  if (!/@s\.whatsapp\.net$/i.test(value)) {
    return null;
  }

  const digits = value.split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits || null;
}

function normalizePhoneForJid(jid: string | null | undefined, phone: string | null | undefined) {
  const normalizedJid = normalizeJid(jid);
  if (!normalizedJid) {
    return normalizePhoneDigits(phone);
  }

  if (/@lid$/i.test(normalizedJid)) {
    return null;
  }

  return normalizePhoneDigits(phone) ?? phoneFromJid(normalizedJid);
}

function cleanName(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => cleanName(value)).filter(Boolean))] as string[];
}

function cleanAliasList(values: Array<string | null | undefined>) {
  return uniqueStrings(values);
}

function pickPreferredName(current: string | null | undefined, candidate: string | null | undefined) {
  const currentValue = cleanName(current);
  const candidateValue = cleanName(candidate);

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

  const currentWords = currentValue.split(/\s+/).length;
  const candidateWords = candidateValue.split(/\s+/).length;
  if (candidateWords > currentWords) {
    return candidateValue;
  }
  if (candidateValue.length > currentValue.length + 2) {
    return candidateValue;
  }

  return currentValue;
}

function pickPreferredSource(
  current: RichWhatsAppContactUpsertRow["source"] | null | undefined,
  candidate: RichWhatsAppContactUpsertRow["source"] | null | undefined,
) {
  const currentValue = current ?? "message";
  const candidateValue = candidate ?? "message";
  return WHATSAPP_CONTACT_SOURCE_PRIORITY[candidateValue] >= WHATSAPP_CONTACT_SOURCE_PRIORITY[currentValue]
    ? candidateValue
    : currentValue;
}

function normalizeSourceKinds(values: Array<string | null | undefined>) {
  return [...new Set(
    values
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean),
  )];
}

function latestIsoTimestamp(values: Array<string | null | undefined>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .sort()
    .slice(-1)[0] ?? null;
}

function attachIdentityMetadataToWhatsAppContactRows<
  T extends {
    jid: string | null;
    phone_number: string | null;
    contact_name: string | null;
    notify_name: string | null;
    verified_name: string | null;
    aliases: string[];
    message_count?: number | null;
    last_message_at?: string | null;
    last_seen_at?: string | null;
    identity_key?: string | null;
    identity_aliases?: string[] | null;
    identity_jids?: string[] | null;
    identity_quality?: ClawCloudWhatsAppContactIdentityQuality | null;
  },
>(rows: T[]) {
  const decorated = decorateClawCloudWhatsAppContactIdentitySeeds(
    rows.map((row) => ({
      jid: row.jid,
      phone: row.phone_number,
      displayName:
        row.contact_name
        ?? row.notify_name
        ?? row.verified_name
        ?? row.aliases[0]
        ?? row.phone_number
        ?? row.jid,
      aliases: cleanAliasList([
        row.contact_name,
        row.notify_name,
        row.verified_name,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        ...(Array.isArray(row.identity_aliases) ? row.identity_aliases : []),
      ]),
      identityKey: row.identity_key ?? null,
      identityJids: row.identity_jids ?? null,
      messageCount:
        typeof row.message_count === "number" && Number.isFinite(row.message_count)
          ? Math.max(0, Math.trunc(row.message_count))
          : null,
      lastMessageAt: row.last_message_at ?? null,
      lastSeenAt: row.last_seen_at ?? null,
    })),
  );

  return rows.map((row, index) => {
    const identity = decorated[index];
    return {
      ...row,
      identity_key: identity?.identityKey ?? row.identity_key ?? `jid:${row.jid ?? "unknown"}`,
      identity_aliases: cleanAliasList([
        ...(Array.isArray(row.identity_aliases) ? row.identity_aliases : []),
        ...(Array.isArray(identity?.identityAliases) ? identity.identityAliases : []),
      ]),
      identity_jids: cleanAliasList([
        ...(Array.isArray(row.identity_jids) ? row.identity_jids : []),
        ...(Array.isArray(identity?.identityJids) ? identity.identityJids : []),
        row.jid ?? null,
      ]).sort(),
      identity_quality: identity?.identityQuality ?? row.identity_quality ?? "jid_only",
    };
  });
}

export function mergeWhatsAppContactUpsertRows(rows: RichWhatsAppContactUpsertRow[]) {
  const merged = new Map<string, RichWhatsAppContactUpsertRow>();

  for (const row of rows) {
    const key = `${row.user_id}::${row.jid}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {
        ...row,
        aliases: cleanAliasList([
          ...(Array.isArray(row.aliases) ? row.aliases : []),
          row.contact_name,
          row.notify_name,
          row.verified_name,
          row.phone_number,
        ]),
        identity_key: cleanName(row.identity_key) ?? `jid:${row.jid}`,
        identity_aliases: cleanAliasList([
          ...(Array.isArray(row.identity_aliases) ? row.identity_aliases : []),
          ...(Array.isArray(row.aliases) ? row.aliases : []),
          row.contact_name,
          row.notify_name,
          row.verified_name,
          row.phone_number,
        ]),
        identity_jids: cleanAliasList([
          ...(Array.isArray(row.identity_jids) ? row.identity_jids : []),
          row.jid,
        ]),
        identity_quality: row.identity_quality ?? "jid_only",
        source_kinds: normalizeSourceKinds([
          ...(Array.isArray(row.source_kinds) ? row.source_kinds : []),
          row.source,
        ]),
      });
      continue;
    }

    merged.set(key, {
      ...existing,
      phone_number: existing.phone_number || row.phone_number,
      contact_name: pickPreferredName(existing.contact_name, row.contact_name),
      notify_name: pickPreferredName(existing.notify_name, row.notify_name),
      verified_name: pickPreferredName(existing.verified_name, row.verified_name),
      aliases: cleanAliasList([
        ...(Array.isArray(existing.aliases) ? existing.aliases : []),
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        existing.contact_name,
        existing.notify_name,
        existing.verified_name,
        row.contact_name,
        row.notify_name,
        row.verified_name,
        existing.phone_number,
        row.phone_number,
      ]),
      identity_key: cleanName(existing.identity_key) ?? cleanName(row.identity_key) ?? `jid:${row.jid}`,
      identity_aliases: cleanAliasList([
        ...(Array.isArray(existing.identity_aliases) ? existing.identity_aliases : []),
        ...(Array.isArray(row.identity_aliases) ? row.identity_aliases : []),
        ...(Array.isArray(existing.aliases) ? existing.aliases : []),
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        existing.contact_name,
        existing.notify_name,
        existing.verified_name,
        row.contact_name,
        row.notify_name,
        row.verified_name,
        existing.phone_number,
        row.phone_number,
      ]),
      identity_jids: cleanAliasList([
        ...(Array.isArray(existing.identity_jids) ? existing.identity_jids : []),
        ...(Array.isArray(row.identity_jids) ? row.identity_jids : []),
        existing.jid,
        row.jid,
      ]),
      identity_quality: row.identity_quality ?? existing.identity_quality ?? "jid_only",
      source: pickPreferredSource(existing.source, row.source),
      source_kinds: normalizeSourceKinds([
        ...(Array.isArray(existing.source_kinds) ? existing.source_kinds : []),
        ...(Array.isArray(row.source_kinds) ? row.source_kinds : []),
        existing.source,
        row.source,
      ]),
      message_count: Math.max(
        typeof existing.message_count === "number" ? existing.message_count : 0,
        typeof row.message_count === "number" ? row.message_count : 0,
      ) || null,
      last_message_at: latestIsoTimestamp([existing.last_message_at, row.last_message_at]),
      last_seen_at: latestIsoTimestamp([existing.last_seen_at, row.last_seen_at]) ?? row.last_seen_at,
    });
  }

  return [...merged.values()];
}

function collectAliases(row: SyncedAliasRow) {
  return cleanAliasList([
    row.contact_name,
    row.notify_name,
    row.verified_name,
    ...(Array.isArray(row.aliases) ? row.aliases : []),
  ]);
}

async function loadFallbackSyncedContacts(userId: string): Promise<SyncedAliasRow[]> {
  const rows = await loadFallbackSyncedWhatsAppContacts(userId);
  return rows.map((row) => ({
    phone_number: row.phone_number,
    contact_name: row.contact_name,
    notify_name: row.notify_name,
    verified_name: row.verified_name,
    aliases: row.aliases,
    last_seen_at: row.last_seen_at,
  }));
}

export async function loadFallbackSyncedWhatsAppContacts(
  userId: string,
): Promise<SyncedWhatsAppContactRow[]> {
  const supabase = getClawCloudSupabaseAdmin();
  const { data } = await supabase
    .from("agent_tasks")
    .select("config")
    .eq("user_id", userId)
    .eq("task_type", CONTACTS_TASK_TYPE)
    .maybeSingle()
    .catch(() => ({ data: null }));

  const config = data?.config;
  if (!config || typeof config !== "object") {
    return [];
  }

  const synced = (config as { synced_whatsapp_contacts?: unknown }).synced_whatsapp_contacts;
  if (!Array.isArray(synced)) {
    return [];
  }

  const normalizedRows: SyncedWhatsAppContactRow[] = synced
    .map((row) => row as FallbackSyncedContactRow)
    .map((row) => ({
      jid: normalizeJid(row.jid),
      phone_number: normalizePhoneForJid(row.jid, row.phone_number),
      contact_name: cleanName(row.contact_name),
      notify_name: cleanName(row.notify_name),
      verified_name: cleanName(row.verified_name),
      aliases: cleanAliasList([
        row.contact_name,
        row.notify_name,
        row.verified_name,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
      ]),
      identity_key: cleanName(row.identity_key),
      identity_aliases: cleanAliasList([
        ...(Array.isArray(row.identity_aliases) ? row.identity_aliases : []),
      ]),
      identity_jids: cleanAliasList([
        ...(Array.isArray(row.identity_jids) ? row.identity_jids : []),
        row.jid,
      ]),
      identity_quality: row.identity_quality ?? null,
      source_kinds: normalizeSourceKinds(Array.isArray(row.source_kinds) ? row.source_kinds : []),
      message_count:
        typeof row.message_count === "number" && Number.isFinite(row.message_count)
          ? Math.max(0, Math.trunc(row.message_count))
          : null,
      last_message_at: row.last_message_at ?? null,
      last_seen_at: row.last_seen_at ?? null,
    }))
    .filter((row) => Boolean(row.jid));

  return attachIdentityMetadataToWhatsAppContactRows(normalizedRows) as SyncedWhatsAppContactRow[];
}

async function saveFallbackSyncedContacts(
  userId: string,
  rows: Array<{
    jid: string;
    phone_number: string | null;
    contact_name: string | null;
    notify_name: string | null;
    verified_name: string | null;
    aliases: string[];
    identity_key: string;
    identity_aliases: string[];
    identity_jids: string[];
    identity_quality: ClawCloudWhatsAppContactIdentityQuality;
    source: string;
    source_kinds: string[];
    message_count: number | null;
    last_message_at: string | null;
    last_seen_at: string;
  }>,
) {
  const supabase = getClawCloudSupabaseAdmin();
  const { data } = await supabase
    .from("agent_tasks")
    .select("config")
    .eq("user_id", userId)
    .eq("task_type", CONTACTS_TASK_TYPE)
    .maybeSingle()
    .catch(() => ({ data: null }));

  const existingConfig =
    data?.config && typeof data.config === "object"
      ? (data.config as Record<string, unknown>)
      : {};
  const existingSynced = Array.isArray(existingConfig.synced_whatsapp_contacts)
    ? (existingConfig.synced_whatsapp_contacts as FallbackSyncedContactRow[])
    : [];

  const merged = new Map<string, Record<string, unknown>>();
  for (const row of existingSynced) {
    const jid = normalizeJid(row.jid);
    const phone = normalizePhoneForJid(row.jid, row.phone_number);
    if (!jid) continue;
    merged.set(jid, {
      jid,
      phone_number: phone,
      contact_name: cleanName(row.contact_name),
      notify_name: cleanName(row.notify_name),
      verified_name: cleanName(row.verified_name),
      aliases: cleanAliasList([
        row.contact_name,
        row.notify_name,
        row.verified_name,
        ...(Array.isArray(row.aliases) ? row.aliases : []),
      ]),
      identity_key: cleanName(row.identity_key) ?? `jid:${jid}`,
      identity_aliases: cleanAliasList([
        ...(Array.isArray(row.identity_aliases) ? row.identity_aliases : []),
        row.contact_name,
        row.notify_name,
        row.verified_name,
      ]),
      identity_jids: cleanAliasList([
        ...(Array.isArray(row.identity_jids) ? row.identity_jids : []),
        jid,
      ]),
      identity_quality: row.identity_quality ?? "jid_only",
      source: "session",
      source_kinds: normalizeSourceKinds(Array.isArray(row.source_kinds) ? row.source_kinds : ["session"]),
      message_count:
        typeof row.message_count === "number" && Number.isFinite(row.message_count)
          ? Math.max(0, Math.trunc(row.message_count))
          : null,
      last_message_at: row.last_message_at ?? null,
      last_seen_at: row.last_seen_at ?? new Date().toISOString(),
    });
  }

  for (const row of rows) {
    const existing = merged.get(row.jid);
    merged.set(row.jid, {
      ...(existing ?? {}),
      ...row,
      phone_number:
        normalizePhoneForJid(
          row.jid,
          (existing?.phone_number as string | null | undefined) ?? null,
        )
        || row.phone_number
        || null,
      aliases: cleanAliasList([
        ...(Array.isArray(existing?.aliases) ? (existing.aliases as string[]) : []),
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        existing?.contact_name as string | null | undefined,
        existing?.notify_name as string | null | undefined,
        existing?.verified_name as string | null | undefined,
        row.contact_name,
        row.notify_name,
        row.verified_name,
      ]),
      identity_key: cleanName(row.identity_key) ?? cleanName(existing?.identity_key as string | null | undefined) ?? `jid:${row.jid}`,
      identity_aliases: cleanAliasList([
        ...(Array.isArray(existing?.identity_aliases) ? (existing.identity_aliases as string[]) : []),
        ...(Array.isArray(row.identity_aliases) ? row.identity_aliases : []),
        ...(Array.isArray(existing?.aliases) ? (existing.aliases as string[]) : []),
        ...(Array.isArray(row.aliases) ? row.aliases : []),
        existing?.contact_name as string | null | undefined,
        existing?.notify_name as string | null | undefined,
        existing?.verified_name as string | null | undefined,
        row.contact_name,
        row.notify_name,
        row.verified_name,
      ]),
      identity_jids: cleanAliasList([
        ...(Array.isArray(existing?.identity_jids) ? (existing.identity_jids as string[]) : []),
        ...(Array.isArray(row.identity_jids) ? row.identity_jids : []),
        existing?.jid as string | null | undefined,
        row.jid,
      ]),
      identity_quality: row.identity_quality ?? (existing?.identity_quality as ClawCloudWhatsAppContactIdentityQuality | null | undefined) ?? "jid_only",
      source_kinds: normalizeSourceKinds([
        ...(Array.isArray(existing?.source_kinds) ? (existing.source_kinds as string[]) : []),
        ...(Array.isArray(row.source_kinds) ? row.source_kinds : []),
        row.source,
      ]),
      message_count: Math.max(
        typeof existing?.message_count === "number" ? Number(existing.message_count) : 0,
        typeof row.message_count === "number" ? row.message_count : 0,
      ) || null,
      last_message_at:
        [existing?.last_message_at, row.last_message_at]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .sort()
          .slice(-1)[0] ?? null,
      last_seen_at:
        [existing?.last_seen_at, row.last_seen_at]
          .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          .sort()
          .slice(-1)[0] ?? row.last_seen_at,
    });
  }

  const persistedRows = attachIdentityMetadataToWhatsAppContactRows(
    [...merged.values()] as Array<{
      jid: string;
      phone_number: string | null;
      contact_name: string | null;
      notify_name: string | null;
      verified_name: string | null;
      aliases: string[];
      identity_key: string | null;
      identity_aliases: string[];
      identity_jids: string[];
      identity_quality: ClawCloudWhatsAppContactIdentityQuality | null;
      source: string;
      source_kinds: string[];
      message_count: number | null;
      last_message_at: string | null;
      last_seen_at: string;
    }>,
  );

  await supabase.from("agent_tasks").upsert(
    {
      user_id: userId,
      task_type: CONTACTS_TASK_TYPE,
      is_enabled: true,
      config: {
        ...existingConfig,
        synced_whatsapp_contacts: persistedRows,
      },
    },
    { onConflict: "user_id,task_type" },
  );
}

function toLegacyWhatsAppContactRow(row: RichWhatsAppContactUpsertRow) {
  return {
    user_id: row.user_id,
    jid: row.jid,
    phone_number: row.phone_number,
    contact_name: row.contact_name ?? row.aliases[0] ?? row.phone_number ?? null,
    notify_name: row.notify_name ?? null,
    verified_name: row.verified_name ?? null,
    source: row.source,
    last_seen_at: row.last_seen_at,
  };
}

async function upsertWhatsAppContactRows(
  userId: string,
  rows: RichWhatsAppContactUpsertRow[],
) {
  const dedupedRows = attachIdentityMetadataToWhatsAppContactRows(
    mergeWhatsAppContactUpsertRows(rows),
  );
  if (!dedupedRows.length) {
    return 0;
  }

  let fallbackSaved = false;
  try {
    await saveFallbackSyncedContacts(userId, dedupedRows);
    fallbackSaved = true;
  } catch (error) {
    console.error(
      `[whatsapp-contacts] fallback save failed for ${userId}:`,
      error instanceof Error ? error.message : error,
    );
  }

  const supabase = getClawCloudSupabaseAdmin();
  const richUpsert = await supabase
    .from("whatsapp_contacts")
    .upsert(dedupedRows, { onConflict: "user_id,jid" });

  if (!richUpsert.error) {
    return dedupedRows.length;
  }

  if (!isClawCloudMissingSchemaMessage(richUpsert.error.message)) {
    console.error(
      `[whatsapp-contacts] table upsert failed for ${userId}:`,
      richUpsert.error.message,
    );
    return fallbackSaved ? dedupedRows.length : 0;
  }

  const legacyUpsert = await supabase
    .from("whatsapp_contacts")
    .upsert(dedupedRows.map(toLegacyWhatsAppContactRow), { onConflict: "user_id,jid" });

  if (legacyUpsert.error) {
    console.error(
      `[whatsapp-contacts] legacy table upsert failed for ${userId}:`,
      legacyUpsert.error.message,
    );
    return fallbackSaved ? dedupedRows.length : 0;
  }

  return dedupedRows.length;
}

async function runSerializedWhatsAppContactWrite<T>(
  userId: string,
  task: () => Promise<T>,
) {
  const previous = whatsappContactWriteQueues.get(userId) ?? Promise.resolve();
  let unlock: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  whatsappContactWriteQueues.set(userId, queued);

  try {
    await previous.catch(() => undefined);
    return await task();
  } finally {
    unlock();
    if (whatsappContactWriteQueues.get(userId) === queued) {
      whatsappContactWriteQueues.delete(userId);
    }
  }
}

export function buildWhatsAppHistoryBackfillContacts(
  rows: WhatsAppHistoryBackfillRow[],
): Array<{
  jid: string;
  phone_number: string | null;
  contact_name: string | null;
  notify_name: string | null;
  verified_name: string | null;
  aliases: string[];
  source: "history";
  source_kinds: string[];
  message_count: number | null;
  last_message_at: string | null;
  last_seen_at: string;
}> {
  const grouped = new Map<string, {
    jid: string;
    phone_number: string | null;
    contactNames: string[];
    messageCount: number;
    timestamps: string[];
  }>();

  for (const row of rows) {
    const jid = normalizeJid(row.remote_jid);
    const phone = normalizePhoneDigits(row.remote_phone) ?? phoneFromJid(jid);
    if (!jid || !isDirectPersonJid(jid)) {
      continue;
    }

    const key = jid;
    const existing = grouped.get(key) ?? {
      jid,
      phone_number: phone,
      contactNames: [],
      messageCount: 0,
      timestamps: [],
    };

    const contactName = cleanName(row.contact_name);
    if (contactName) {
      existing.contactNames.push(contactName);
    }

    if (typeof row.sent_at === "string" && row.sent_at.trim().length > 0) {
      existing.timestamps.push(row.sent_at);
    }

    existing.messageCount += 1;
    grouped.set(key, existing);
  }

  return [...grouped.values()].map((group) => {
    const aliases = cleanAliasList([
      ...group.contactNames,
      group.phone_number,
    ]);
    const bestName = group.contactNames.sort((left, right) => right.length - left.length)[0] ?? null;
    const lastSeen = latestIsoTimestamp(group.timestamps) ?? new Date().toISOString();

    return {
      jid: group.jid,
      phone_number: group.phone_number,
      contact_name: bestName,
      notify_name: null,
      verified_name: null,
      aliases,
      source: "history" as const,
      source_kinds: ["history_backfill"],
      message_count: group.messageCount,
      last_message_at: latestIsoTimestamp(group.timestamps),
      last_seen_at: lastSeen,
    };
  });
}

export async function backfillWhatsAppContactsFromHistory(userId: string) {
  const supabase = getClawCloudSupabaseAdmin();
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("remote_jid, remote_phone, contact_name, sent_at")
    .eq("user_id", userId)
    .not("remote_jid", "is", null)
    .order("sent_at", { ascending: false })
    .limit(WHATSAPP_SYNC_POLICY.historyContactBackfillScanLimit);

  if (error) {
    throw new Error(error.message);
  }

  const rows = buildWhatsAppHistoryBackfillContacts((data ?? []) as WhatsAppHistoryBackfillRow[]);
  if (!rows.length) {
    return {
      createdCount: 0,
    };
  }

  const upsertRows: RichWhatsAppContactUpsertRow[] = rows.map((row) => ({
    user_id: userId,
    jid: row.jid,
    phone_number: row.phone_number,
    contact_name: row.contact_name,
    notify_name: row.notify_name,
    verified_name: row.verified_name,
    aliases: row.aliases,
    identity_key: row.phone_number ? `phone:${row.phone_number}` : `jid:${row.jid}`,
    identity_aliases: row.aliases,
    identity_jids: [row.jid],
    identity_quality: row.phone_number ? "phone" : "jid_only",
    source: row.source,
    source_kinds: row.source_kinds,
    message_count: row.message_count,
    last_message_at: row.last_message_at,
    last_seen_at: row.last_seen_at,
  }));

  let persistedCount = 0;
  await runSerializedWhatsAppContactWrite(userId, async () => {
    persistedCount = await upsertWhatsAppContactRows(userId, upsertRows);
  });

  return {
    createdCount: persistedCount,
  };
}

export async function loadSyncedWhatsAppContactAliases(userId: string) {
  const supabase = getClawCloudSupabaseAdmin();
  const query = await supabase
    .from("whatsapp_contacts")
    .select("jid, phone_number, contact_name, notify_name, verified_name")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .catch(() => ({ data: null }));

  const tableRows = ((query.data ?? []) as SyncedAliasRow[]).filter((row) => Boolean(row.phone_number));
  const fallbackRows = await loadFallbackSyncedContacts(userId).catch(() => []);

  const identityRows = attachIdentityMetadataToWhatsAppContactRows(
    [...tableRows, ...fallbackRows].map((row) => ({
      jid: normalizeJid((row as { jid?: string | null }).jid ?? row.phone_number),
      phone_number: normalizePhoneDigits(row.phone_number),
      contact_name: row.contact_name,
      notify_name: row.notify_name,
      verified_name: row.verified_name,
      aliases: collectAliases(row),
      identity_key: cleanName((row as { identity_key?: string | null }).identity_key),
      identity_aliases: cleanAliasList([
        ...((row as { identity_aliases?: string[] | null }).identity_aliases ?? []),
      ]),
      identity_jids: cleanAliasList([
        ...((row as { identity_jids?: string[] | null }).identity_jids ?? []),
        (row as { jid?: string | null }).jid ?? null,
      ]),
      identity_quality: ((row as { identity_quality?: ClawCloudWhatsAppContactIdentityQuality | null }).identity_quality) ?? null,
      message_count: null,
      last_message_at: null,
      last_seen_at: row.last_seen_at ?? null,
    })),
  );

  const aliases: Array<{ alias: string; phone: string }> = [];
  for (const row of identityRows) {
    const phone = normalizePhoneDigits(row.phone_number);
    if (!phone) {
      continue;
    }

    for (const alias of cleanAliasList([
      ...collectAliases(row),
      ...(Array.isArray(row.identity_aliases) ? row.identity_aliases : []),
    ])) {
      aliases.push({ alias, phone });
    }
  }

  return aliases;
}

export function prepareWhatsAppContactUpsertRows(
  userId: string,
  contacts: WhatsAppContactSyncInput[],
) {
  return attachIdentityMetadataToWhatsAppContactRows(
    mergeWhatsAppContactUpsertRows(
      contacts
        .map((contact): RichWhatsAppContactUpsertRow | null => {
          const jid = normalizeJid(contact.jid);
          const phone = normalizePhoneDigits(contact.phoneNumber) ?? phoneFromJid(jid);
          const contactName = cleanName(contact.contactName);
          const notifyName = cleanName(contact.notifyName);
          const verifiedName = cleanName(contact.verifiedName);
          const aliases = cleanAliasList([
            contact.contactName,
            contact.notifyName,
            contact.verifiedName,
            ...(Array.isArray(contact.aliases) ? contact.aliases : []),
          ]);

          if (!jid || !isDirectPersonJid(jid)) {
            return null;
          }

          const normalizedAliases = aliases.length ? aliases : [phone ?? jid];

          return {
            user_id: userId,
            jid,
            phone_number: phone ?? null,
            contact_name: contactName ?? aliases[0] ?? phone ?? jid,
            notify_name: notifyName ?? aliases[1] ?? null,
            verified_name: verifiedName ?? aliases[2] ?? null,
            aliases: normalizedAliases,
            identity_key: phone ? `phone:${phone}` : `jid:${jid}`,
            identity_aliases: normalizedAliases,
            identity_jids: [jid],
            identity_quality: phone ? "phone" : "jid_only",
            source: contact.source ?? "session",
            source_kinds: normalizeSourceKinds([
              ...(Array.isArray(contact.sourceKinds) ? contact.sourceKinds : []),
              contact.source ?? "session",
            ]),
            message_count:
              typeof contact.messageCount === "number" && Number.isFinite(contact.messageCount)
                ? Math.max(0, Math.trunc(contact.messageCount))
                : null,
            last_message_at: contact.lastMessageAt ?? null,
            last_seen_at: contact.lastSeenAt ?? new Date().toISOString(),
          };
        })
        .filter((row): row is RichWhatsAppContactUpsertRow => row !== null),
    ),
  );
}

export async function upsertWhatsAppContacts(
  userId: string,
  contacts: WhatsAppContactSyncInput[],
) {
  if (!contacts.length) {
    return 0;
  }

  const rows = prepareWhatsAppContactUpsertRows(userId, contacts);

  if (!rows.length) {
    return 0;
  }

  let persistedCount = 0;
  await runSerializedWhatsAppContactWrite(userId, async () => {
    persistedCount = await upsertWhatsAppContactRows(userId, rows);
  });

  return persistedCount;
}
