import test from "node:test";
import assert from "node:assert/strict";
import { normalizeIsolatedRunnerResponse } from "../src/tools/isolatedRunnerClient.js";

test("normalizes isolated runner response payload", () => {
  const result = normalizeIsolatedRunnerResponse(
    {
      ok: true,
      language: "python",
      command: "python3",
      args: ["file.py"],
      exitCode: 0,
      timedOut: false,
      stdout: "42\n",
      stderr: "",
    },
    "python",
  );
  assert.equal(result.ok, true);
  assert.equal(result.language, "python");
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "42");
});

test("normalizes missing fields safely", () => {
  const result = normalizeIsolatedRunnerResponse({}, "javascript");
  assert.equal(result.ok, false);
  assert.equal(result.language, "javascript");
  assert.equal(result.exitCode, null);
  assert.deepEqual(result.args, []);
});
