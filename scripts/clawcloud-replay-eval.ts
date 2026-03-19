import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  loadClawCloudEnv,
  parseOption,
  writeJsonReport,
} from "./clawcloud-script-helpers";

type ReplayCase = {
  id: string;
  prompt: string;
  tags?: string[];
  minimumLength?: number;
  maxLatencyMs?: number;
  mustMatchAll?: string[];
  mustMatchAny?: string[];
  mustNotMatch?: string[];
};

type ReplayFixture = {
  suite?: string;
  cases: ReplayCase[];
};

type ReplayResult = {
  id: string;
  prompt: string;
  tags: string[];
  ok: boolean;
  elapsedMs: number;
  violations: string[];
  preview: string;
};

const DEFAULT_FIXTURE_PATH = "qa/fixtures/whatsapp-replay.json";
const DEFAULT_REPORT_PATH = "tmp-clawcloud-replay-report.json";
const DEFAULT_USER_ID = "00000000-0000-0000-0000-000000000701";

const GLOBAL_BANNED_PATTERNS = [
  /__fast_fallback_internal__/i,
  /__deep_fallback_internal__/i,
  /i got your message/i,
  /you asked about/i,
  /ready to answer\./i,
  /ask your question and i'll answer it completely/i,
];

function compilePatterns(patterns: string[] | undefined) {
  return (patterns ?? []).map((pattern) => new RegExp(pattern, "i"));
}

function loadFixture(filePath: string): ReplayFixture {
  const raw = readFileSync(resolve(process.cwd(), filePath), "utf8");
  return JSON.parse(raw) as ReplayFixture;
}

async function main() {
  loadClawCloudEnv();

  const fixturePath = parseOption("--fixture") ?? DEFAULT_FIXTURE_PATH;
  const reportPath = parseOption("--report") ?? DEFAULT_REPORT_PATH;
  const userId = parseOption("--user") ?? DEFAULT_USER_ID;
  const fixture = loadFixture(fixturePath);
  const { routeInboundAgentMessage } = await import("@/lib/clawcloud-agent");

  const results: ReplayResult[] = [];

  for (const testCase of fixture.cases) {
    const started = performance.now();
    const answer = (await routeInboundAgentMessage(userId, testCase.prompt)) ?? "";
    const elapsedMs = Number((performance.now() - started).toFixed(1));
    const violations: string[] = [];

    if (!answer.trim()) {
      violations.push("Empty answer");
    }

    const minimumLength = testCase.minimumLength ?? 1;
    if (answer.trim().length < minimumLength) {
      violations.push(`Answer shorter than expected minimum length ${minimumLength}`);
    }

    if (testCase.maxLatencyMs && elapsedMs > testCase.maxLatencyMs) {
      violations.push(`Exceeded latency budget ${testCase.maxLatencyMs}ms`);
    }

    for (const pattern of GLOBAL_BANNED_PATTERNS) {
      if (pattern.test(answer)) {
        violations.push(`Contains banned fallback phrase: ${pattern}`);
      }
    }

    for (const pattern of compilePatterns(testCase.mustNotMatch)) {
      if (pattern.test(answer)) {
        violations.push(`Matched forbidden pattern: ${pattern}`);
      }
    }

    for (const pattern of compilePatterns(testCase.mustMatchAll)) {
      if (!pattern.test(answer)) {
        violations.push(`Missing required pattern: ${pattern}`);
      }
    }

    const matchAny = compilePatterns(testCase.mustMatchAny);
    if (matchAny.length > 0 && !matchAny.some((pattern) => pattern.test(answer))) {
      violations.push(`Missing any-of patterns: ${matchAny.map(String).join(", ")}`);
    }

    results.push({
      id: testCase.id,
      prompt: testCase.prompt,
      tags: testCase.tags ?? [],
      ok: violations.length === 0,
      elapsedMs,
      violations,
      preview: answer.replace(/\s+/g, " ").slice(0, 260),
    });
  }

  const passed = results.filter((row) => row.ok).length;
  const failed = results.length - passed;
  const averageLatencyMs = Number(
    (results.reduce((sum, row) => sum + row.elapsedMs, 0) / Math.max(results.length, 1)).toFixed(1),
  );

  const report = {
    checkedAt: new Date().toISOString(),
    suite: fixture.suite ?? "whatsapp_replay",
    fixturePath,
    reportPath,
    userId,
    total: results.length,
    passed,
    failed,
    passRate: Number(((passed / Math.max(results.length, 1)) * 100).toFixed(1)),
    averageLatencyMs,
    results,
  };

  writeJsonReport(reportPath, report);
  console.log(JSON.stringify(report, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
