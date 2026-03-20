import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

const CONTACTS_TASK_TYPE = "user_contacts";

export type WhatsAppContactSyncInput = {
  jid?: string | null;
  phoneNumber?: string | null;
  contactName?: string | null;
  notifyName?: string | null;
  verifiedName?: string | null;
  source?: "session" | "history" | "message";
  lastSeenAt?: string | null;
};

type SyncedAliasRow = {
  phone_number: string | null;
  contact_name: string | null;
  notify_name: string | null;
  verified_name: string | null;
  last_seen_at?: string | null;
};

type FallbackSyncedContactRow = {
  jid?: string | null;
  phone_number?: string | null;
  contact_name?: string | null;
  notify_name?: string | null;
  verified_name?: string | null;
  last_seen_at?: string | null;
};

function normalizePhoneDigits(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function normalizeJid(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase() || null;
}

function isDirectPersonJid(jid: string) {
  return /@s\.whatsapp\.net$/i.test(jid);
}

function phoneFromJid(jid: string | null | undefined) {
  const digits = String(jid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits || null;
}

function cleanName(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || null;
}

function collectAliases(row: SyncedAliasRow) {
  return [
    cleanName(row.contact_name),
    cleanName(row.notify_name),
    cleanName(row.verified_name),
  ].filter((value, index, all): value is string => Boolean(value) && all.indexOf(value) === index);
}

async function loadFallbackSyncedContacts(userId: string): Promise<SyncedAliasRow[]> {
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

  return synced
    .map((row) => row as FallbackSyncedContactRow)
    .map((row) => ({
      phone_number: normalizePhoneDigits(row.phone_number),
      contact_name: cleanName(row.contact_name),
      notify_name: cleanName(row.notify_name),
      verified_name: cleanName(row.verified_name),
      last_seen_at: row.last_seen_at ?? null,
    }))
    .filter((row) => Boolean(row.phone_number));
}

async function saveFallbackSyncedContacts(
  userId: string,
  rows: Array<{
    jid: string;
    phone_number: string;
    contact_name: string | null;
    notify_name: string | null;
    verified_name: string | null;
    source: string;
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
    const phone = normalizePhoneDigits(row.phone_number);
    if (!jid || !phone) continue;
    merged.set(jid, {
      jid,
      phone_number: phone,
      contact_name: cleanName(row.contact_name),
      notify_name: cleanName(row.notify_name),
      verified_name: cleanName(row.verified_name),
      source: "session",
      last_seen_at: row.last_seen_at ?? new Date().toISOString(),
    });
  }

  for (const row of rows) {
    merged.set(row.jid, row);
  }

  await supabase.from("agent_tasks").upsert(
    {
      user_id: userId,
      task_type: CONTACTS_TASK_TYPE,
      is_enabled: true,
      config: {
        ...existingConfig,
        synced_whatsapp_contacts: [...merged.values()],
      },
    },
    { onConflict: "user_id,task_type" },
  );
}

export async function loadSyncedWhatsAppContactAliases(userId: string) {
  const supabase = getClawCloudSupabaseAdmin();
  const query = await supabase
    .from("whatsapp_contacts")
    .select("phone_number, contact_name, notify_name, verified_name")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false })
    .catch(() => ({ data: null }));

  const tableRows = ((query.data ?? []) as SyncedAliasRow[]).filter((row) => Boolean(row.phone_number));
  const fallbackRows = await loadFallbackSyncedContacts(userId).catch(() => []);

  const aliases: Array<{ alias: string; phone: string }> = [];
  for (const row of [...tableRows, ...fallbackRows]) {
    const phone = normalizePhoneDigits(row.phone_number);
    if (!phone) {
      continue;
    }

    for (const alias of collectAliases(row)) {
      aliases.push({ alias, phone });
    }
  }

  return aliases;
}

export async function upsertWhatsAppContacts(
  userId: string,
  contacts: WhatsAppContactSyncInput[],
) {
  if (!contacts.length) {
    return;
  }

  const rows = contacts
    .map((contact) => {
      const jid = normalizeJid(contact.jid);
      const phone = normalizePhoneDigits(contact.phoneNumber) ?? phoneFromJid(jid);
      const contactName = cleanName(contact.contactName);
      const notifyName = cleanName(contact.notifyName);
      const verifiedName = cleanName(contact.verifiedName);

      if (!jid || !isDirectPersonJid(jid)) {
        return null;
      }

      if (!phone) {
        return null;
      }

      if (!contactName && !notifyName && !verifiedName) {
        return null;
      }

      return {
        user_id: userId,
        jid,
        phone_number: phone,
        contact_name: contactName,
        notify_name: notifyName,
        verified_name: verifiedName,
        source: contact.source ?? "session",
        last_seen_at: contact.lastSeenAt ?? new Date().toISOString(),
      };
    })
    .filter(
      (
        row,
      ): row is {
        user_id: string;
        jid: string;
        phone_number: string;
        contact_name: string | null;
        notify_name: string | null;
        verified_name: string | null;
        source: "session" | "history" | "message";
        last_seen_at: string;
      } => Boolean(row),
    );

  if (!rows.length) {
    return;
  }

  await saveFallbackSyncedContacts(userId, rows).catch(() => null);

  await getClawCloudSupabaseAdmin()
    .from("whatsapp_contacts")
    .upsert(rows, { onConflict: "user_id,jid" })
    .catch(() => null);
}
