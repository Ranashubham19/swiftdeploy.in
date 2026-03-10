import { timingSafeEqual } from "node:crypto";

export const safeHeaderEquals = (actual: string, expected: string): boolean => {
  const actualBuf = Buffer.from(String(actual || ""));
  const expectedBuf = Buffer.from(String(expected || ""));
  if (actualBuf.length !== expectedBuf.length) return false;
  try {
    return timingSafeEqual(actualBuf, expectedBuf);
  } catch {
    return false;
  }
};

export const verifyTelegramWebhookSecretHeader = (
  headerValue: string | undefined | null,
  expectedSecret: string,
  options?: { isProduction?: boolean; webhookEnabled?: boolean },
): boolean => {
  const isProduction = Boolean(options?.isProduction);
  const webhookEnabled = options?.webhookEnabled ?? true;
  if (!webhookEnabled) return true;
  if (!expectedSecret) return !isProduction;
  const header = String(headerValue || "").trim();
  if (!header) return false;
  return safeHeaderEquals(header, expectedSecret);
};
