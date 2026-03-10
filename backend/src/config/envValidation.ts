type EnvDict = NodeJS.ProcessEnv | Record<string, string | undefined>;

export type EnvValidationIssue = {
  code: string;
  message: string;
};

export type EnvValidationResult = {
  errors: EnvValidationIssue[];
  warnings: EnvValidationIssue[];
};

const isTrue = (value: string | undefined, defaultValue = false): boolean => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return defaultValue;
  return ["1", "true", "yes", "on"].includes(normalized);
};

const hasStrongSecret = (value: string | undefined, min = 32): boolean =>
  String(value || "").trim().length >= min;

export const validateRuntimeEnv = (
  env: EnvDict,
  runtime: "legacy" | "standalone",
): EnvValidationResult => {
  const errors: EnvValidationIssue[] = [];
  const warnings: EnvValidationIssue[] = [];
  const isProduction = String(env.NODE_ENV || "").trim() === "production";
  const sessionSecret = String(env.SESSION_SECRET || "").trim();

  if (isProduction && !hasStrongSecret(sessionSecret)) {
    errors.push({
      code: "SESSION_SECRET_WEAK",
      message: "SESSION_SECRET must be set to a strong value (>=32 chars) in production",
    });
  } else if (!hasStrongSecret(sessionSecret)) {
    warnings.push({
      code: "SESSION_SECRET_DEV_FALLBACK",
      message: "SESSION_SECRET is missing or weak; development fallback may be used",
    });
  }

  if (runtime === "legacy") {
    const encryptionKey = String(env.BOT_STATE_ENCRYPTION_KEY || "").trim();
    if (isProduction && !encryptionKey) {
      errors.push({
        code: "BOT_STATE_ENCRYPTION_KEY_MISSING",
        message: "BOT_STATE_ENCRYPTION_KEY is required in production to encrypt persisted Telegram bot tokens",
      });
    } else if (!encryptionKey) {
      warnings.push({
        code: "BOT_STATE_ENCRYPTION_KEY_MISSING_DEV",
        message: "BOT_STATE_ENCRYPTION_KEY is not set; persisted Telegram bot tokens will remain plaintext in local/dev",
      });
    }
  }

  if (runtime === "standalone") {
    const useWebhook = isTrue(env.TELEGRAM_USE_WEBHOOK, false);
    const runtimeSource = String(env.TELEGRAM_RUNTIME_SOURCE || "legacy").trim().toLowerCase();
    if (isProduction && runtimeSource === "standalone" && useWebhook) {
      const secret = String(env.TELEGRAM_WEBHOOK_SECRET || "").trim();
      if (!secret) {
        errors.push({
          code: "TELEGRAM_WEBHOOK_SECRET_MISSING",
          message: "TELEGRAM_WEBHOOK_SECRET is required in production when standalone runtime uses webhooks",
        });
      }
    }
  }

  return { errors, warnings };
};
