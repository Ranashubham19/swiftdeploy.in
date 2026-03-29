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

export function isWhatsAppSelfChatJid(
  jid: string | null | undefined,
  sessionPhone: string | null | undefined,
) {
  const remotePhone = phoneFromWhatsAppJid(jid);
  const linkedPhone = normalizeWhatsAppPhone(sessionPhone);
  return Boolean(remotePhone && linkedPhone && remotePhone === linkedPhone);
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
