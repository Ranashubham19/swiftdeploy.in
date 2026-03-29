import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { matchesWholeAlias } from "@/lib/clawcloud-intent-match";
import { loadSyncedWhatsAppContactAliases } from "@/lib/clawcloud-whatsapp-contacts";

type ContactMap = Record<string, string>;

const CONTACTS_TASK_TYPE = "user_contacts";

const CONTACT_HONORIFICS = [
  "ji",
  "sir",
  "madam",
  "mam",
  "bhai",
  "bhaiya",
  "didi",
  "saab",
  "sahab",
  "uncle",
  "aunty",
  "auntie",
] as const;

const CANONICAL_CONTACT_ALIASES: Record<string, string> = {
  mom: "maa",
  mother: "maa",
  mummy: "maa",
  mum: "maa",
  mommy: "maa",
  mamma: "maa",
  mama: "maa",
  ma: "maa",
  dad: "papa",
  father: "papa",
  daddy: "papa",
  pappa: "papa",
  baba: "papa",
  pitaji: "papa",
};

const AMBIGUOUS_DIRECT_RECIPIENTS = new Set([
  "me",
  "myself",
  "us",
  "ourselves",
  "you",
  "yourself",
]);

export type ParsedSendMessageCommand =
  {
    kind: "contacts" | "phone" | "broadcast_all";
    message: string;
    contactName: string;
    contactNames: string[];
    phone: string | null;
  };

export type SendMessageCommandSafetyIssue =
  | "ambiguous_recipient"
  | "scheduled_send"
  | "conditional_send";

export type SendMessageCommandSafetyDecision =
  | {
    allowed: true;
    parsed: ParsedSendMessageCommand;
  }
  | {
    allowed: false;
    parsed: ParsedSendMessageCommand;
    issue: SendMessageCommandSafetyIssue;
    ambiguousRecipients?: string[];
  };

export type ParsedSendMessageAction =
  | {
    scope: "single_contact";
    requestedRecipientLabels: string[];
    requestedRecipientCount: 1;
    message: string;
    reviewLabel: string;
    requiresHeightenedConfirmation: false;
    confirmationMode: "always";
    riskSummary: "single_contact";
  }
  | {
    scope: "multi_contact";
    requestedRecipientLabels: string[];
    requestedRecipientCount: number;
    message: string;
    reviewLabel: string;
    requiresHeightenedConfirmation: true;
    confirmationMode: "always";
    riskSummary: "multi_recipient";
  }
  | {
    scope: "broadcast_all";
    requestedRecipientLabels: [];
    requestedRecipientCount: 0;
    message: string;
    reviewLabel: "all contacts";
    requiresHeightenedConfirmation: true;
    confirmationMode: "broadcast_explicit";
    riskSummary: "broadcast_all";
  }
  | {
    scope: "direct_phone";
    requestedRecipientLabels: string[];
    requestedRecipientCount: 1;
    message: string;
    reviewLabel: string;
    requiresHeightenedConfirmation: true;
    confirmationMode: "always";
    riskSummary: "direct_phone";
  };

const AMBIGUOUS_RECIPIENT_PLACEHOLDERS = new Set([
  ...AMBIGUOUS_DIRECT_RECIPIENTS,
  "him",
  "her",
  "them",
  "someone",
  "somebody",
  "anyone",
  "anybody",
]);

const CONDITIONAL_SEND_CUE_PATTERN =
  /\b(?:if|unless|when|once|whenever|as soon as|until|after\s+(?:he|she|they|you|someone|somebody|anyone|anybody|the client|the team|it)|before\s+(?:he|she|they|you|someone|somebody|anyone|anybody|the client|the team|it))\b/i;

const SCHEDULED_SEND_CUE_PATTERN =
  /\b(?:tomorrow|tonight|later|today|this\s+(?:morning|afternoon|evening|night)|next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:at|around|by)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|in\s+\d+\s+(?:minutes?|hours?|days?|weeks?)|after\s+\d+\s+(?:minutes?|hours?|days?|weeks?))\b/i;

function cleanupNamePunctuation(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200d\uFE0F]/g, "")
    .replace(/[_]+/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/[^\p{L}\p{N}\s.&+\-/\u0900-\u097F]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripFirstMessageOccurrence(text: string, message: string) {
  const candidates = [`"${message}"`, `'${message}'`, message];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const pattern = new RegExp(escapeRegex(candidate), "i");
    if (pattern.test(text)) {
      return text.replace(pattern, " ");
    }
  }

  return text;
}

function buildSendCommandEnvelope(text: string, message: string) {
  return stripFirstMessageOccurrence(text, message)
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeContactName(name: string) {
  let normalized = cleanupNamePunctuation(name).toLowerCase();
  if (!normalized) return "";

  normalized = normalized.replace(/'s$/, "").trim();
  normalized = normalized.replace(/\b(?:contact|phone|number)\b/gi, "").replace(/\s+/g, " ").trim();

  const words = normalized
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => CANONICAL_CONTACT_ALIASES[word] ?? word);

  while (words.length > 1) {
    const lastWord = words[words.length - 1];
    if (lastWord && CONTACT_HONORIFICS.includes(lastWord as (typeof CONTACT_HONORIFICS)[number])) {
      words.pop();
      continue;
    }
    break;
  }

  return words.join(" ").trim();
}

export function formatContactDisplayName(name: string) {
  return normalizeContactName(name)
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("91")) return digits;
  return `91${digits.replace(/^0+/, "")}`;
}

function isBroadcastTarget(value: string) {
  const normalized = normalizeContactName(value);
  return [
    "all",
    "everyone",
    "everybody",
    "all contacts",
    "every contact",
    "every saved contact",
    "everyone at once",
    "all at once",
  ].includes(normalized);
}

function extractDirectPhone(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return null;

  const nonPhone = cleaned.replace(/[\d\s+()\-]/g, "");
  if (nonPhone.length > 0) {
    return null;
  }

  const normalized = normalizePhone(cleaned);
  return normalized || null;
}

function splitContactNames(rawRecipients: string) {
  const cleaned = rawRecipients
    .replace(/\b(?:contacts?|people|person)\b/gi, " ")
    .replace(/\b(?:at once|all together|together)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const parts = cleaned
    .split(/\s*(?:,|\/|&|\+|\band\b|\balong with\b|\bplus\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const deduped = new Map<string, string>();
  for (const part of parts) {
    const normalized = normalizeContactName(part);
    if (!normalized || isBroadcastTarget(normalized)) continue;
    deduped.set(normalized, cleanupNamePunctuation(part));
  }

  return [...deduped.values()];
}

function buildParsedSendCommand(
  rawRecipients: string,
  message: string,
): ParsedSendMessageCommand | null {
  const cleanedRecipients = rawRecipients.trim().replace(/^[,:-]+|[,:-]+$/g, "").trim();
  const cleanedMessage = message.trim().replace(/^["']|["']$/g, "").trim();
  if (!cleanedRecipients || !cleanedMessage) {
    return null;
  }

  if (isBroadcastTarget(cleanedRecipients)) {
    return {
      kind: "broadcast_all",
      message: cleanedMessage,
      contactName: "everyone",
      contactNames: [],
      phone: null,
    };
  }

  const directPhone = extractDirectPhone(cleanedRecipients);
  if (directPhone) {
    return {
      kind: "phone",
      message: cleanedMessage,
      contactName: cleanedRecipients,
      contactNames: [],
      phone: directPhone,
    };
  }

  const contactNames = splitContactNames(cleanedRecipients);
  if (!contactNames.length) {
    return null;
  }

  if (contactNames.every((name) => AMBIGUOUS_DIRECT_RECIPIENTS.has(normalizeContactName(name)))) {
    return null;
  }

  return {
    kind: "contacts",
    contactNames,
    message: cleanedMessage,
    contactName: contactNames[0] ?? cleanedRecipients,
    phone: null,
  };
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
    const syncedOnly: ContactMap = {};
    const syncedAliases = await loadSyncedWhatsAppContactAliases(userId).catch(() => []);
    for (const entry of syncedAliases) {
      const normalizedName = normalizeContactName(entry.alias);
      const normalizedPhone = normalizePhone(entry.phone);
      if (!normalizedName || !normalizedPhone || syncedOnly[normalizedName]) continue;
      syncedOnly[normalizedName] = normalizedPhone;
    }
    return syncedOnly;
  }

  const normalized: ContactMap = {};
  const syncedAliases = await loadSyncedWhatsAppContactAliases(userId).catch(() => []);
  for (const entry of syncedAliases) {
    const normalizedName = normalizeContactName(entry.alias);
    const normalizedPhone = normalizePhone(entry.phone);
    if (!normalizedName || !normalizedPhone || normalized[normalizedName]) continue;
    normalized[normalizedName] = normalizedPhone;
  }

  for (const [name, phone] of Object.entries(contacts as Record<string, unknown>)) {
    if (typeof name !== "string" || typeof phone !== "string") continue;
    const normalizedName = normalizeContactName(name);
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedName || !normalizedPhone) continue;
    normalized[normalizedName] = normalizedPhone;
  }

  return normalized;
}

export async function saveContact(userId: string, name: string, phone: string): Promise<void> {
  const db = getClawCloudSupabaseAdmin();
  const current = await loadContacts(userId);
  const normalizedName = normalizeContactName(name);
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
  const key = normalizeContactName(name);
  if (!key) return null;

  if (contacts[key]) return contacts[key];

  for (const [savedName, phone] of Object.entries(contacts)) {
    if (matchesWholeAlias(savedName, key) || matchesWholeAlias(key, savedName)) {
      return phone;
    }

    const savedWords = savedName.split(/\s+/).filter((word) => word.length >= 3);
    const queryWords = key.split(/\s+/).filter((word) => word.length >= 3);

    if (queryWords.some((queryWord) =>
      savedWords.some((savedWord) =>
        savedWord === queryWord || savedWord.startsWith(queryWord) || queryWord.startsWith(savedWord)
      ))) {
      return phone;
    }
  }

  return null;
}

export function parseSaveContactCommand(text: string): { name: string; phone: string } | null {
  const t = text.trim().replace(/[.]+$/, "");
  const namePattern = "(.{1,50}?)";
  const phonePattern = "([\\d\\s+\\-()]{7,20})";

  const p1 = t.match(
    new RegExp(`^(?:save|add)\\s+contact[:\\s]+${namePattern}\\s*[=:]\\s*${phonePattern}$`, "i"),
  );
  if (p1) return { name: cleanupNamePunctuation(p1[1] ?? ""), phone: p1[2]?.trim() ?? "" };

  const p2 = t.match(
    new RegExp(`^(?:save|add)\\s+${namePattern}\\s+(?:as|=|:)\\s*${phonePattern}$`, "i"),
  );
  if (p2) return { name: cleanupNamePunctuation(p2[1] ?? ""), phone: p2[2]?.trim() ?? "" };

  const p3 = t.match(
    new RegExp(`^${namePattern}(?:'s)?\\s+(?:number|phone|contact)\\s+(?:is|=|:)\\s*${phonePattern}$`, "i"),
  );
  if (p3) return { name: cleanupNamePunctuation(p3[1] ?? ""), phone: p3[2]?.trim() ?? "" };

  const p4 = t.match(
    new RegExp(`^(?:save|add)\\s+contact[:\\s]+(?:name\\s+)?${namePattern}\\s*,\\s*(?:phone|number)\\s*[:=]?\\s*${phonePattern}$`, "i"),
  );
  if (p4) return { name: cleanupNamePunctuation(p4[1] ?? ""), phone: p4[2]?.trim() ?? "" };

  const p5 = t.match(
    new RegExp(`^(?:save|add)\\s+${namePattern}\\s*,\\s*(?:phone|number)\\s*[:=]?\\s*${phonePattern}$`, "i"),
  );
  if (p5) return { name: cleanupNamePunctuation(p5[1] ?? ""), phone: p5[2]?.trim() ?? "" };

  const p6 = t.match(
    new RegExp(`^(?:save|add)\\s+contact[:\\s]+(?:name\\s+)?${namePattern}\\s+(?:phone|number)\\s*[:=]?\\s*${phonePattern}$`, "i"),
  );
  if (p6) return { name: cleanupNamePunctuation(p6[1] ?? ""), phone: p6[2]?.trim() ?? "" };

  return null;
}

export function parseSendMessageCommand(text: string): ParsedSendMessageCommand | null {
  const t = text.trim().replace(/^ok\s+/i, "").trim();

  const quotedMessageFirst = t.match(
    /^(?:please\s+)?(?:send|message|msg|whatsapp|wa)\s+(?:"([^"]+)"|'([^']+)')\s+to\s+(.+)$/i,
  );
  if (quotedMessageFirst) {
    return buildParsedSendCommand(
      quotedMessageFirst[3] ?? "",
      quotedMessageFirst[1] ?? quotedMessageFirst[2] ?? "",
    );
  }

  const sendToColon = t.match(
    /^(?:please\s+)?(?:send|message|msg|whatsapp|wa)\s+to\s+(.+?)\s*:\s*(.+)$/i,
  );
  if (sendToColon) {
    return buildParsedSendCommand(sendToColon[1] ?? "", sendToColon[2] ?? "");
  }

  const sendToQuoted = t.match(
    /^(?:please\s+)?(?:send|message|msg|whatsapp|wa)\s+to\s+(.+?)\s+(?:"([^"]+)"|'([^']+)')$/i,
  );
  if (sendToQuoted) {
    return buildParsedSendCommand(
      sendToQuoted[1] ?? "",
      sendToQuoted[2] ?? sendToQuoted[3] ?? "",
    );
  }

  const recipientFirst = t.match(
    /^(?:send\s+(?:a\s+)?(?:message|msg|whatsapp|wa)\s+to|message|msg|whatsapp|wa)\s+(.+?)\s*:\s*(.+)$/i,
  );
  if (recipientFirst) {
    return buildParsedSendCommand(recipientFirst[1] ?? "", recipientFirst[2] ?? "");
  }

  const tellPattern = t.match(/^tell\s+(.+?)\s+that\s+(.+)$/i);
  if (tellPattern) {
    return buildParsedSendCommand(tellPattern[1] ?? "", tellPattern[2] ?? "");
  }

  const tellColonPattern = t.match(/^tell\s+(.+?)\s*:\s*(.+)$/i);
  if (tellColonPattern) {
    return buildParsedSendCommand(tellColonPattern[1] ?? "", tellColonPattern[2] ?? "");
  }

  const messageFirst = t.match(/^(?:please\s+)?send\s+(.{2,160}?)\s+to\s+(.+)$/i);
  if (messageFirst) {
    return buildParsedSendCommand(messageFirst[2] ?? "", messageFirst[1] ?? "");
  }

  const shortGreeting = t.match(
    /^send\s+(good\s+(?:morning|night|evening|afternoon)|hello|hi|bye|take care|good day)\s+(?:to\s+)?(.+)$/i,
  );
  if (shortGreeting) {
    return buildParsedSendCommand(shortGreeting[2] ?? "", shortGreeting[1] ?? "");
  }

  const directToPattern = t.match(/^send\s+to\s+(.+?)\s+(.+)$/i);
  if (directToPattern) {
    return buildParsedSendCommand(directToPattern[1] ?? "", directToPattern[2] ?? "");
  }

  return null;
}

export function analyzeSendMessageCommandSafety(text: string): SendMessageCommandSafetyDecision | null {
  const parsed = parseSendMessageCommand(text);
  if (!parsed) {
    return null;
  }

  const recipientNames = parsed.kind === "contacts"
    ? parsed.contactNames
    : parsed.kind === "broadcast_all"
      ? []
      : [parsed.contactName];

  const ambiguousRecipients = recipientNames
    .map((name) => cleanupNamePunctuation(name))
    .filter((name) => AMBIGUOUS_RECIPIENT_PLACEHOLDERS.has(normalizeContactName(name)));

  if (ambiguousRecipients.length) {
    return {
      allowed: false,
      parsed,
      issue: "ambiguous_recipient",
      ambiguousRecipients,
    };
  }

  const commandEnvelope = buildSendCommandEnvelope(text, parsed.message);
  if (CONDITIONAL_SEND_CUE_PATTERN.test(commandEnvelope)) {
    return {
      allowed: false,
      parsed,
      issue: "conditional_send",
    };
  }

  if (SCHEDULED_SEND_CUE_PATTERN.test(commandEnvelope)) {
    return {
      allowed: false,
      parsed,
      issue: "scheduled_send",
    };
  }

  return {
    allowed: true,
    parsed,
  };
}

export function buildParsedSendMessageAction(parsed: ParsedSendMessageCommand): ParsedSendMessageAction {
  if (parsed.kind === "broadcast_all") {
    return {
      scope: "broadcast_all",
      requestedRecipientLabels: [],
      requestedRecipientCount: 0,
      message: parsed.message,
      reviewLabel: "all contacts",
      requiresHeightenedConfirmation: true,
      confirmationMode: "broadcast_explicit",
      riskSummary: "broadcast_all",
    };
  }

  if (parsed.kind === "phone") {
    return {
      scope: "direct_phone",
      requestedRecipientLabels: [parsed.contactName],
      requestedRecipientCount: 1,
      message: parsed.message,
      reviewLabel: parsed.contactName,
      requiresHeightenedConfirmation: true,
      confirmationMode: "always",
      riskSummary: "direct_phone",
    };
  }

  if (parsed.contactNames.length > 1) {
    return {
      scope: "multi_contact",
      requestedRecipientLabels: [...parsed.contactNames],
      requestedRecipientCount: parsed.contactNames.length,
      message: parsed.message,
      reviewLabel: `${parsed.contactNames.length} contacts`,
      requiresHeightenedConfirmation: true,
      confirmationMode: "always",
      riskSummary: "multi_recipient",
    };
  }

  return {
    scope: "single_contact",
    requestedRecipientLabels: [parsed.contactName],
    requestedRecipientCount: 1,
    message: parsed.message,
    reviewLabel: parsed.contactName,
    requiresHeightenedConfirmation: false,
    confirmationMode: "always",
    riskSummary: "single_contact",
  };
}

export async function listContactsFormatted(userId: string): Promise<string> {
  const contacts = await loadContacts(userId);
  const rows = Object.entries(contacts);

  if (!rows.length) {
    return [
      "No contacts saved yet.",
      "",
      "Save a contact like this:",
      "_Save contact: Maa = +919876543210_",
      "",
      "Then say: _Send message to Maa: Good morning!_",
    ].join("\n");
  }

  const lines = rows.map(([name, phone]) => {
    const prettyName = formatContactDisplayName(name);
    return `- *${prettyName}* - +${phone}`;
  });

  return [
    `Your available contacts (${rows.length}):`,
    "",
    ...lines,
    "",
    "_This list includes saved ClawCloud contacts and synced WhatsApp contacts when available._",
    "",
    "To message: _Send message to [name]: [text]_",
    "To add: _Save contact: [name] = [phone]_",
  ].join("\n");
}
