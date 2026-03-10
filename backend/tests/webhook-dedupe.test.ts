import test from "node:test";
import assert from "node:assert/strict";
import { createTelegramUpdateDeduper } from "../legacy/webhookDedupe.js";

test("dedupe does not mark when only checking duplicate status", () => {
  const deduper = createTelegramUpdateDeduper();
  assert.equal(deduper.hasDuplicate("primary", 123), false);
  assert.equal(deduper.hasDuplicate("primary", 123), false);
});

test("dedupe marks seen after explicit mark and then blocks duplicates", () => {
  const deduper = createTelegramUpdateDeduper();
  assert.equal(deduper.hasDuplicate("bot:1", 555), false);
  deduper.markSeen("bot:1", 555);
  assert.equal(deduper.hasDuplicate("bot:1", 555), true);
});

test("legacy isDuplicate remains backward compatible", () => {
  const deduper = createTelegramUpdateDeduper();
  assert.equal(deduper.isDuplicate("primary", 77), false);
  assert.equal(deduper.isDuplicate("primary", 77), true);
});
