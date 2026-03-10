import test from "node:test";
import assert from "node:assert/strict";
import {
  decomposeQuestionParts,
  buildQuestionBreakdownInstruction,
} from "../src/utils/questionDecompose.js";

test("decomposes multiple question marks into ordered parts", () => {
  const out = decomposeQuestionParts("What is Docker? How is it different from a VM? When should I use it?");
  assert.equal(out.isMultiPart, true);
  assert.equal(out.parts.length, 3);
  assert.match(out.parts[1] || "", /different from a VM/i);
});

test("decomposes numbered lines", () => {
  const out = decomposeQuestionParts("1. Explain API\n2. Give example\n3. Common errors");
  assert.equal(out.isMultiPart, true);
  assert.deepEqual(out.parts, ["Explain API", "Give example", "Common errors"]);
});

test("builds breakdown instruction only for multi-part prompts", () => {
  assert.equal(buildQuestionBreakdownInstruction("Explain recursion").trim(), "");
  const instruction = buildQuestionBreakdownInstruction("What is recursion? Give an example?");
  assert.match(instruction, /answer every part explicitly/i);
  assert.match(instruction, /1\./);
  assert.match(instruction, /2\./);
});
