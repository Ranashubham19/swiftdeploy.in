import test from "node:test";
import assert from "node:assert/strict";
import { parseContextReference } from "../legacy/advanced/contextFollowUp.js";

test("detects previous answer reference", () => {
  const parsed = parseContextReference("explain the previous answer in more detail");
  assert.equal(parsed.isReference, true);
  assert.equal(parsed.target, "answer");
  assert.equal(parsed.latest, true);
});

test("detects ordinal question reference", () => {
  const parsed = parseContextReference("in the 2nd question, explain the last step");
  assert.equal(parsed.isReference, true);
  assert.equal(parsed.target, "question");
  assert.equal(parsed.ordinal, 2);
});

test("detects same format/style preservation", () => {
  const parsed = parseContextReference("do this in same format as previous answer");
  assert.equal(parsed.isReference, true);
  assert.equal(parsed.preserveFormat, true);
});
