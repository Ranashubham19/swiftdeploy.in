import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readRepoFile(relativePath) {
  return readFileSync(path.join(rootDir, relativePath), "utf8");
}

function sliceBetween(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start >= 0 ? start : 0);
  assert.notEqual(start, -1, `Could not find start marker: ${startNeedle}`);
  assert.notEqual(end, -1, `Could not find end marker: ${endNeedle}`);
  return source.slice(start, end);
}

const results = [];

function runCheck(name, execute) {
  try {
    const details = execute();
    results.push({ name, ok: true, details: details ?? undefined });
  } catch (error) {
    results.push({
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

runCheck("timezone_detection_rules_do_not_treat_tax_terms_as_timezones", () => {
  const memorySource = readRepoFile("lib/clawcloud-user-memory.ts");
  const timezoneBlock = sliceBetween(
    memorySource,
    "const timezoneHints: Array<[RegExp, string]> = [",
    "for (const [pattern, timezone] of timezoneHints)",
  );

  assert.doesNotMatch(timezoneBlock, /\\bgst\\b/);
  assert.doesNotMatch(timezoneBlock, /\\bsgst\\b/);
  assert.match(timezoneBlock, /\\bdubai\\b\|\\babu dhabi\\b/);
  assert.match(timezoneBlock, /\\bsingapore\\b\|\\bsgt\\b/);

  return {
    containsDubaiHint: /\\bdubai\\b\|\\babu dhabi\\b/.test(timezoneBlock),
    containsSingaporeHint: /\\bsingapore\\b\|\\bsgt\\b/.test(timezoneBlock),
  };
});

runCheck("whatsapp_delete_all_plan_covers_exported_workspace_state", () => {
  const governanceSource = readRepoFile("lib/clawcloud-whatsapp-governance.ts");

  assert.match(governanceSource, /name:\s*"whatsapp_contacts"/);
  assert.match(governanceSource, /name:\s*"whatsapp_automation_workflows"/);
  assert.match(governanceSource, /resetSettings:\s*mode === "all"/);
  assert.match(governanceSource, /writeAuditLog:\s*mode !== "all"/);
  assert.match(governanceSource, /whatsapp_settings:\s*defaultWhatsAppSettings/);

  return {
    hasContactsDelete: /name:\s*"whatsapp_contacts"/.test(governanceSource),
    hasWorkflowDelete: /name:\s*"whatsapp_automation_workflows"/.test(governanceSource),
    resetsSettings: /whatsapp_settings:\s*defaultWhatsAppSettings/.test(governanceSource),
  };
});

runCheck("phase0_regression_tests_are_present", () => {
  const testSource = readRepoFile("tests/clawcloud-core.test.ts");

  assert.match(testSource, /timezone auto-detection ignores GST tax terms/i);
  assert.match(testSource, /whatsapp privacy delete plan covers exported workspace data/i);
  assert.match(testSource, /const rows: WhatsAppHistoryEntry\[] = \[/);

  return {
    timezoneRegression: /timezone auto-detection ignores GST tax terms/i.test(testSource),
    privacyRegression: /whatsapp privacy delete plan covers exported workspace data/i.test(testSource),
  };
});

const failures = results.filter((result) => !result.ok);

console.log(JSON.stringify({
  checkedAt: new Date().toISOString(),
  results,
}, null, 2));

if (failures.length > 0) {
  throw new Error(`Phase 0 smoke failed with ${failures.length} failing check(s).`);
}
