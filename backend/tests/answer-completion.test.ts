import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelyIncompleteNaturalAnswer,
  mergeContinuationText,
} from "../legacy/advanced/answerCompletion.js";

test("detects incomplete natural answer by trailing connector", () => {
  const text =
    "This is a detailed explanation of the system behavior and how it works in production with retries and caching and";
  assert.equal(isLikelyIncompleteNaturalAnswer(text), true);
});

test("does not flag short complete answer", () => {
  assert.equal(isLikelyIncompleteNaturalAnswer("Yes, that is correct."), false);
});

test("merges continuation without duplicating overlapping text", () => {
  const base = "Step 1: Do A.\nStep 2: Do B and";
  const continuation = "Do B and then Step 3: Do C.\nStep 4: Verify.";
  const merged = mergeContinuationText(base, continuation);
  assert.match(merged, /Step 3: Do C/);
  assert.equal((merged.match(/Do B and/g) || []).length, 1);
});
