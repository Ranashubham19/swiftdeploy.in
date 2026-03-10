import test from "node:test";
import assert from "node:assert/strict";
import { validateGeneratedCode } from "../legacy/advanced/codeValidation.js";

test("validates javascript syntax success", () => {
  const result = validateGeneratedCode("function x(){ return 1; }\nconsole.log(x());", "javascript");
  assert.equal(result.ok, true);
});

test("validates javascript syntax failure", () => {
  const result = validateGeneratedCode("function x( {", "javascript");
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test("validates json syntax failure", () => {
  const result = validateGeneratedCode("{ bad json }", "json");
  assert.equal(result.ok, false);
});
