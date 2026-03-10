import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStructuredOutputInstructions,
  detectStructuredOutputMode,
  normalizeStructuredOutput,
} from "../legacy/advanced/structuredOutput.js";

test("detects JSON structured output request", () => {
  const mode = detectStructuredOutputMode("Return the answer as JSON only");
  assert.equal(mode.kind, "json");
  const rules = buildStructuredOutputInstructions(mode);
  assert.match(rules, /valid JSON only/i);
});

test("normalizes fenced json to raw valid json", () => {
  const mode = { kind: "json" } as const;
  const out = normalizeStructuredOutput("```json\n{\"a\":1,\"b\":\"x\"}\n```", mode);
  assert.equal(out, "{\"a\":1,\"b\":\"x\"}");
});
