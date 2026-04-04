export function normalizeWhatsAppPhone(value: string | null | undefined) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits || null;
}

export function phoneFromWhatsAppJid(jid: string | null | undefined) {
  const digits = String(jid ?? "").split("@")[0]?.replace(/\D/g, "") ?? "";
  return digits || null;
}

export function jidFromWhatsAppPhone(phone: string | null | undefined) {
  const digits = normalizeWhatsAppPhone(phone);
  return digits ? `${digits}@s.whatsapp.net` : null;
}

export function isWhatsAppDirectChatJid(jid: string) {
  return /@s\.whatsapp\.net$/i.test(jid);
}

export function isWhatsAppLidChatJid(jid: string) {
  return /@lid$/i.test(jid);
}

export function isWhatsAppIgnoredChatJid(jid: string) {
  const value = jid.toLowerCase();
  return (
    value === "status@broadcast"
    || value.endsWith("@broadcast")
    || value.endsWith("@newsletter")
  );
}

export function toReplyableWhatsAppJid(jid: string | null | undefined) {
  const value = String(jid ?? "").trim();
  if (!value) return null;
  if (isWhatsAppIgnoredChatJid(value)) return null;
  if (!isWhatsAppDirectChatJid(value) && !isWhatsAppLidChatJid(value)) return null;
  return value;
}

export type WhatsAppPhoneSharePair = {
  lidJid: string;
  directJid: string;
};

function pickWhatsAppPhoneSharePair(input: {
  lidCandidates: Array<string | null | undefined>;
  directCandidates: Array<string | null | undefined>;
}) {
  const lidJid =
    input.lidCandidates
      .map((value) => toReplyableWhatsAppJid(value))
      .find((value): value is string => Boolean(value && isWhatsAppLidChatJid(value)))
    ?? null;
  const directJid =
    input.directCandidates
      .map((value) => toReplyableWhatsAppJid(value))
      .find((value): value is string => Boolean(value && isWhatsAppDirectChatJid(value)))
    ?? null;

  if (!lidJid || !directJid) {
    return null;
  }

  return {
    lidJid,
    directJid,
  };
}

function findNestedWhatsAppJidByKey(
  value: unknown,
  targetKey: "pnJid" | "lidJid",
  maxDepth = 6,
) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<unknown>();

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const { value: node, depth } = current;
    if (!node || typeof node !== "object") {
      continue;
    }
    if (seen.has(node)) {
      continue;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      if (depth >= maxDepth) {
        continue;
      }
      for (const item of node) {
        queue.push({ value: item, depth: depth + 1 });
      }
      continue;
    }

    for (const [key, nested] of Object.entries(node as Record<string, unknown>)) {
      if (key === targetKey && typeof nested === "string") {
        const jid = toReplyableWhatsAppJid(nested);
        if (jid) {
          return jid;
        }
      }

      if (depth < maxDepth && nested && typeof nested === "object") {
        queue.push({ value: nested, depth: depth + 1 });
      }
    }
  }

  return null;
}

export function extractWhatsAppPhoneShareFromChat(
  chat: Record<string, unknown> | null | undefined,
) {
  if (!chat) {
    return null;
  }

  return pickWhatsAppPhoneSharePair({
    lidCandidates: [
      typeof chat.lidJid === "string" ? chat.lidJid : null,
      typeof chat.id === "string" ? chat.id : null,
      typeof chat.pnJid === "string" ? chat.pnJid : null,
    ],
    directCandidates: [
      typeof chat.pnJid === "string" ? chat.pnJid : null,
      typeof chat.id === "string" ? chat.id : null,
      typeof chat.lidJid === "string" ? chat.lidJid : null,
    ],
  });
}

export function extractWhatsAppPhoneShareFromMessage(
  message:
    | {
      key?: {
        remoteJid?: string | null;
        participant?: string | null;
      };
      message?: unknown;
    }
    | null
    | undefined,
) {
  if (!message) {
    return null;
  }

  const nestedPayload = message.message ?? null;
  return pickWhatsAppPhoneSharePair({
    lidCandidates: [
      findNestedWhatsAppJidByKey(nestedPayload, "lidJid"),
      message.key?.remoteJid ?? null,
      message.key?.participant ?? null,
      findNestedWhatsAppJidByKey(nestedPayload, "pnJid"),
    ],
    directCandidates: [
      findNestedWhatsAppJidByKey(nestedPayload, "pnJid"),
      message.key?.remoteJid ?? null,
      message.key?.participant ?? null,
      findNestedWhatsAppJidByKey(nestedPayload, "lidJid"),
    ],
  });
}

export function isWhatsAppSelfChatJid(
  jid: string | null | undefined,
  sessionPhone: string | null | undefined,
) {
  const remotePhone = phoneFromWhatsAppJid(jid);
  const linkedPhone = normalizeWhatsAppPhone(sessionPhone);
  return Boolean(remotePhone && linkedPhone && remotePhone === linkedPhone);
}

export function isWhatsAppResolvedSelfChat(
  sessionPhone: string | null | undefined,
  remoteJid: string | null | undefined,
  resolvedJid?: string | null | undefined,
) {
  const candidate = toReplyableWhatsAppJid(resolvedJid ?? remoteJid);
  if (!candidate) {
    return false;
  }

  return isWhatsAppSelfChatJid(candidate, sessionPhone);
}

export function shouldRememberAssistantSelfChat(
  sessionPhone: string | null | undefined,
  remoteJid: string | null | undefined,
) {
  const replyableJid = toReplyableWhatsAppJid(remoteJid);
  if (!replyableJid) {
    return false;
  }

  return isWhatsAppSelfChatJid(replyableJid, sessionPhone);
}

export function resolveDefaultAssistantChatJid(
  sessionPhone: string | null | undefined,
  lastChatJid: string | null | undefined,
) {
  return jidFromWhatsAppPhone(sessionPhone) ?? toReplyableWhatsAppJid(lastChatJid);
}
