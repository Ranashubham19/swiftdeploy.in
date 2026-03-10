import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENC_PREFIX = "enc:v1:";

const deriveKey = (secret: string): Buffer => {
  const trimmed = String(secret || "").trim();
  if (!trimmed) return Buffer.alloc(0);

  // Accept raw hex/base64 keys, otherwise derive from passphrase.
  const tryHex = /^[a-f0-9]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : null;
  if (tryHex && tryHex.length === 32) return tryHex;
  try {
    const base64 = Buffer.from(trimmed, "base64");
    if (base64.length === 32) return base64;
  } catch {}

  return createHash("sha256").update(trimmed).digest();
};

const toBase64Url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const fromBase64Url = (value: string): Buffer => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(padded, "base64");
};

export const isEncryptedSecret = (value: string): boolean =>
  String(value || "").startsWith(ENC_PREFIX);

export const encryptSecretForStorage = (
  plaintext: string,
  masterSecret: string,
): string => {
  const text = String(plaintext || "");
  const key = deriveKey(masterSecret);
  if (!text || key.length !== 32) return text;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${toBase64Url(Buffer.concat([iv, tag, encrypted]))}`;
};

export const decryptSecretFromStorage = (
  storedValue: string,
  masterSecret: string,
): string | null => {
  const raw = String(storedValue || "");
  if (!raw) return "";
  if (!isEncryptedSecret(raw)) return raw;

  const key = deriveKey(masterSecret);
  if (key.length !== 32) return null;

  try {
    const payload = fromBase64Url(raw.slice(ENC_PREFIX.length));
    if (payload.length < 12 + 16) return null;
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const encrypted = payload.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return plain.toString("utf8");
  } catch {
    return null;
  }
};
