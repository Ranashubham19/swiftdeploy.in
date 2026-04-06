export type WhatsAppReceiptAliasMessage = {
  content?: string | null;
  direction?: string | null;
  chatType?: string | null;
  remotePhone?: string | null;
  remoteJid?: string | null;
};

const RECEIPT_ALIAS_BLOCKLIST = new Set([
  "that contact",
  "that recipient",
  "the recipient",
  "recipient",
  "contact",
  "all contacts",
  "everyone",
  "everybody",
  "whatsapp",
  "message",
  "reply",
]);

const RECEIPT_TARGET_PREFIX_PATTERNS = [
  /^(?:✅\s*)?message delivered to\s+/i,
  /^(?:✅\s*)?reply delivered to\s+/i,
  /^(?:✅\s*)?message submitted to whatsapp for\s+/i,
  /^(?:✅\s*)?reply submitted to whatsapp for\s+/i,
  /^(?:✅\s*)?message re-?sent to(?:\s+whatsapp)?\s+/i,
  /^(?:✅\s*)?reply re-?sent to(?:\s+whatsapp)?\s+/i,
  /^an identical message was already delivered to\s+/i,
  /^an identical reply was already delivered to\s+/i,
  /^an identical message for\s+/i,
  /^an identical reply for\s+/i,
  /^(?:✅\s*)?message sent to\s+/i,
  /^(?:✅\s*)?reply sent to\s+/i,
] as const;

const RECEIPT_BULLET_TARGET_RE =
  /^(?:[-*]\s*|(?:\d+\.\s*))(.+?)\s+\(\+?([\d\s().-]{7,})\)\s*:/i;
const RECEIPT_PHONE_RE = /\(\+?([\d\s().-]{7,})\)/;

function normalizePhoneDigits(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

function cleanAliasLabel(value: string | null | undefined) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/[*_`~]/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+on whatsapp$/i, "")
    .replace(/[:\-–,.;!?]+$/g, "")
    .trim();

  if (!cleaned || cleaned.length > 80) {
    return "";
  }

  return cleaned;
}

function extractReceiptAliasFromLine(line: string) {
  const bulletMatch = line.match(RECEIPT_BULLET_TARGET_RE);
  if (bulletMatch?.[1] && bulletMatch[2]) {
    const alias = cleanAliasLabel(bulletMatch[1]);
    const phone = normalizePhoneDigits(bulletMatch[2]);
    if (!alias || !phone) {
      return null;
    }
    return { alias, phone };
  }

  const phoneMatch = line.match(RECEIPT_PHONE_RE);
  if (!phoneMatch?.[1] || typeof phoneMatch.index !== "number") {
    return null;
  }

  const phone = normalizePhoneDigits(phoneMatch[1]);
  if (!phone) {
    return null;
  }

  let label = line.slice(0, phoneMatch.index).trim();
  let matchedPrefix = false;
  for (const pattern of RECEIPT_TARGET_PREFIX_PATTERNS) {
    if (!pattern.test(label)) {
      continue;
    }
    label = label.replace(pattern, "").trim();
    matchedPrefix = true;
    break;
  }

  if (!matchedPrefix) {
    return null;
  }

  const alias = cleanAliasLabel(label);
  if (!alias) {
    return null;
  }

  return { alias, phone };
}

export function buildWhatsAppReceiptDerivedAliasMap(
  messages: WhatsAppReceiptAliasMessage[],
) {
  const aliasesByPhone = new Map<string, Set<string>>();

  for (const message of messages) {
    const direction = String(message.direction ?? "").trim().toLowerCase();
    if (direction !== "outbound") {
      continue;
    }

    const chatType = String(message.chatType ?? "").trim().toLowerCase();
    if (chatType && chatType !== "direct" && chatType !== "self") {
      continue;
    }

    const content = String(message.content ?? "").trim();
    if (!content) {
      continue;
    }

    const remotePhone = normalizePhoneDigits(message.remotePhone)
      ?? normalizePhoneDigits(message.remoteJid);
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      const extracted = extractReceiptAliasFromLine(line);
      if (!extracted) {
        continue;
      }

      const aliasKey = extracted.alias.toLowerCase();
      if (RECEIPT_ALIAS_BLOCKLIST.has(aliasKey)) {
        continue;
      }

      if (remotePhone && remotePhone === extracted.phone) {
        continue;
      }

      const bucket = aliasesByPhone.get(extracted.phone) ?? new Set<string>();
      bucket.add(extracted.alias);
      aliasesByPhone.set(extracted.phone, bucket);
    }
  }

  return new Map(
    [...aliasesByPhone.entries()].map(([phone, aliases]) => [phone, [...aliases]]),
  );
}

export function buildWhatsAppReceiptDerivedAliasMapForTest(
  messages: WhatsAppReceiptAliasMessage[],
) {
  return Object.fromEntries(
    [...buildWhatsAppReceiptDerivedAliasMap(messages).entries()].map(([phone, aliases]) => [
      phone,
      [...aliases],
    ]),
  ) as Record<string, string[]>;
}
