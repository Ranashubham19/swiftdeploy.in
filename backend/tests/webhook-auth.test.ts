import test from "node:test";
import assert from "node:assert/strict";
import { verifyTelegramWebhookSecretHeader } from "../src/telegramWebhookSecurity.js";

test("webhook auth accepts matching secret header", () => {
  assert.equal(
    verifyTelegramWebhookSecretHeader("secret-123", "secret-123", {
      isProduction: true,
      webhookEnabled: true,
    }),
    true,
  );
});

test("webhook auth rejects missing header in production when secret is configured", () => {
  assert.equal(
    verifyTelegramWebhookSecretHeader("", "secret-123", {
      isProduction: true,
      webhookEnabled: true,
    }),
    false,
  );
});

test("webhook auth allows local dev without secret", () => {
  assert.equal(
    verifyTelegramWebhookSecretHeader("", "", {
      isProduction: false,
      webhookEnabled: true,
    }),
    true,
  );
});
