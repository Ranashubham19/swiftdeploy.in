import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

type ContactMap = Record<string, string>;

const CONTACTS_TASK_TYPE = "user_contacts";

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("91")) return digits;
  return `91${digits.replace(/^0+/, "")}`;
}

export async function loadContacts(userId: string): Promise<ContactMap> {
  const db = getClawCloudSupabaseAdmin();
  const { data } = await db
    .from("agent_tasks")
    .select("config")
    .eq("user_id", userId)
    .eq("task_type", CONTACTS_TASK_TYPE)
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (!data?.config || typeof data.config !== "object") {
    return {};
  }

  const contacts = (data.config as { contacts?: unknown }).contacts;
  if (!contacts || typeof contacts !== "object") {
    return {};
  }

  const normalized: ContactMap = {};
  for (const [name, phone] of Object.entries(contacts as Record<string, unknown>)) {
    if (typeof name !== "string" || typeof phone !== "string") continue;
    const normalizedName = normalizeName(name);
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedName || !normalizedPhone) continue;
    normalized[normalizedName] = normalizedPhone;
  }
  return normalized;
}

export async function saveContact(userId: string, name: string, phone: string): Promise<void> {
  const db = getClawCloudSupabaseAdmin();
  const current = await loadContacts(userId);
  const normalizedName = normalizeName(name);
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedName || !normalizedPhone) {
    return;
  }

  const updated: ContactMap = { ...current, [normalizedName]: normalizedPhone };

  await db.from("agent_tasks").upsert(
    {
      user_id: userId,
      task_type: CONTACTS_TASK_TYPE,
      is_enabled: true,
      config: { contacts: updated },
    },
    { onConflict: "user_id,task_type" },
  );
}

export async function lookupContact(userId: string, name: string): Promise<string | null> {
  const contacts = await loadContacts(userId);
  const key = normalizeName(name);
  if (!key) return null;

  if (contacts[key]) return contacts[key];

  for (const [savedName, phone] of Object.entries(contacts)) {
    if (savedName.includes(key) || key.includes(savedName)) {
      return phone;
    }
  }

  return null;
}

export function parseSaveContactCommand(text: string): { name: string; phone: string } | null {
  const t = text.trim();

  const p1 = t.match(
    /^(?:save|add)\s+contact[:\s]+([a-zA-Z\u0900-\u097F\s]{1,30}?)\s*[=:]\s*([\d\s+\-()]{7,20})$/i,
  );
  if (p1) return { name: p1[1].trim(), phone: p1[2].trim() };

  const p2 = t.match(
    /^(?:save|add)\s+([a-zA-Z\u0900-\u097F\s]{1,30}?)\s+(?:as|=|:)\s*([\d\s+\-()]{7,20})$/i,
  );
  if (p2) return { name: p2[1].trim(), phone: p2[2].trim() };

  const p3 = t.match(
    /^([a-zA-Z\u0900-\u097F\s]{1,30}?)(?:'s)?\s+(?:number|phone|contact)\s+(?:is|=|:)\s*([\d\s+\-()]{7,20})$/i,
  );
  if (p3) return { name: p3[1].trim(), phone: p3[2].trim() };

  return null;
}

export function parseSendMessageCommand(
  text: string,
): { contactName: string; message: string } | null {
  const t = text.trim().replace(/^ok\s+/i, "").trim();

  const p1 = t.match(
    /^(?:send\s+(?:a\s+)?(?:message|msg|whatsapp|wa)\s+to|message|whatsapp|wa)\s+([a-zA-Z\u0900-\u097F\s]{1,30}?)[\s:,]+(.+)$/i,
  );
  if (p1) return { contactName: p1[1].trim(), message: p1[2].trim() };

  const p2 = t.match(
    /^(?:write|send)\s+(?:a\s+)?(?:message|msg)\s+to\s+([a-zA-Z\u0900-\u097F][a-zA-Z\u0900-\u097F\s]{0,30}?)\s+(?:say(?:ing)?|that)\s+(.{2,})$/i,
  );
  if (p2) return { contactName: p2[1].trim(), message: p2[2].trim() };

  const p3 = t.match(
    /^(?:message|msg|whatsapp|wa)\s+([a-zA-Z\u0900-\u097F][a-zA-Z\u0900-\u097F\s]{0,30}?)[\s:,]+(.{2,})$/i,
  );
  if (p3) return { contactName: p3[1].trim(), message: p3[2].trim() };

  const p4 = t.match(
    /^tell\s+([a-zA-Z\u0900-\u097F\s]{1,25}?)\s+(?:that\s+)?(.+)$/i,
  );
  if (p4) return { contactName: p4[1].trim(), message: p4[2].trim() };

  const p5 = t.match(
    /^send\s+(good\s+(?:morning|night|evening|afternoon)|hello|hi|bye|take care)\s+(?:to\s+)?([a-zA-Z\u0900-\u097F][a-zA-Z\u0900-\u097F\s]{1,25})$/i,
  );
  if (p5) return { contactName: p5[2].trim(), message: p5[1].trim() };

  const p6 = t.match(
    /^send\s+(.{2,60}?)\s+to\s+([a-zA-Z\u0900-\u097F\s]{1,25})$/i,
  );
  if (p6) return { contactName: p6[2].trim(), message: p6[1].trim() };

  return null;
}

export async function listContactsFormatted(userId: string): Promise<string> {
  const contacts = await loadContacts(userId);
  const rows = Object.entries(contacts);

  if (!rows.length) {
    return [
      "📋 *No contacts saved yet.*",
      "",
      "Save a contact like this:",
      "_Save contact: Maa = +919876543210_",
      "",
      "Then say: _Send message to Maa: Good morning!_",
    ].join("\n");
  }

  const lines = rows.map(([name, phone]) => {
    const prettyName = name.charAt(0).toUpperCase() + name.slice(1);
    return `• *${prettyName}* — +${phone}`;
  });

  return [
    `📋 *Your saved contacts (${rows.length}):*`,
    "",
    ...lines,
    "",
    "To message: _Send message to [name]: [text]_",
    "To add: _Save contact: [name] = [phone]_",
  ].join("\n");
}
