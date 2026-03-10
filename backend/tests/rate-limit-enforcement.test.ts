import test from "node:test";
import assert from "node:assert/strict";
import { decideRateLimitAction } from "../src/rateLimitPolicy.js";

test("rate limit enforcement blocks in hard mode and computes retry seconds", () => {
  const nowMs = Date.UTC(2026, 1, 26, 10, 0, 0);
  const decision = decideRateLimitAction(
    { allowed: false, resetAt: new Date(nowMs + 4500) },
    { softMode: false, nowMs },
  );
  assert.equal(decision.allowed, false);
  assert.equal(decision.softLimited, false);
  assert.equal(decision.retryAfterSeconds, 5);
});

test("rate limit enforcement allows in soft mode", () => {
  const decision = decideRateLimitAction(
    { allowed: false, resetAt: new Date(Date.now() + 10_000) },
    { softMode: true },
  );
  assert.equal(decision.allowed, true);
  assert.equal(decision.softLimited, true);
});

test("rate limit enforcement passes through allowed requests", () => {
  const decision = decideRateLimitAction(
    { allowed: true, resetAt: new Date(Date.now()) },
    { softMode: false },
  );
  assert.deepEqual(decision, {
    allowed: true,
    softLimited: false,
    retryAfterSeconds: 0,
  });
});
