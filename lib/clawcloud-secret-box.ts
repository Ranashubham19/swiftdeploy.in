import crypto from "node:crypto";

import { env } from "@/lib/env";

const SECRET_BOX_PREFIX = "enc:v1:";
const SECRET_BOX_IV_BYTES = 12;

type SecretBoxOptions = {
  secret?: string | null;
};

function getSecretBoxKeyMaterial(options: SecretBoxOptions = {}) {
  const secret = (
    options.secret
    || (
    env.AGENT_SECRET
    || env.CRON_SECRET
    || env.SUPABASE_SERVICE_ROLE_KEY
    || env.GOOGLE_CLIENT_SECRET
    )
  )?.trim();

  if (!secret) {
    throw new Error("Secret box key material is not configured.");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

export function looksEncryptedSecretValue(value: string | null | undefined) {
  return String(value ?? "").startsWith(SECRET_BOX_PREFIX);
}

export function encryptSecretValue(value: string | null | undefined, options: SecretBoxOptions = {}) {
  const plaintext = String(value ?? "").trim();
  if (!plaintext) {
    return null;
  }

  if (looksEncryptedSecretValue(plaintext)) {
    return plaintext;
  }

  const iv = crypto.randomBytes(SECRET_BOX_IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", getSecretBoxKeyMaterial(options), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${SECRET_BOX_PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptSecretValue(value: string | null | undefined, options: SecretBoxOptions = {}) {
  const encoded = String(value ?? "").trim();
  if (!encoded) {
    return null;
  }

  if (!looksEncryptedSecretValue(encoded)) {
    return encoded;
  }

  const payload = encoded.slice(SECRET_BOX_PREFIX.length);
  const [ivPart, tagPart, cipherPart] = payload.split(".", 3);
  if (!ivPart || !tagPart || !cipherPart) {
    throw new Error("Encrypted secret payload is malformed.");
  }

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getSecretBoxKeyMaterial(options),
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(cipherPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");

  return plaintext || null;
}

export function maskSecretValue(value: string | null | undefined, options: SecretBoxOptions = {}) {
  const plaintext = decryptSecretValue(value, options);
  if (!plaintext) {
    return null;
  }

  if (plaintext.length <= 8) {
    return `${plaintext.slice(0, 2)}***`;
  }

  return `${plaintext.slice(0, 4)}***${plaintext.slice(-4)}`;
}
