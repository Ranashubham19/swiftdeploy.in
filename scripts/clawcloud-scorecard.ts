import { existsSync, readFileSync } from "node:fs";

import {
  loadClawCloudEnv,
  parseFlag,
  runTsxJsonScript,
  writeJsonReport,
} from "./clawcloud-script-helpers";

type WeightedSection = {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  details: Record<string, unknown>;
};

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function extractNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function chooseJsonReport<T>(
  runResult: ReturnType<typeof runTsxJsonScript>,
  filePath: string,
) {
  if (runResult.ok && runResult.json) {
    return runResult.json as T;
  }

  const fileJson = readJsonFile<T>(filePath);
  if (fileJson) {
    return fileJson;
  }

  return (runResult.json as T | null) ?? null;
}

function scoreLabel(score: number) {
  if (score >= 90) return "elite";
  if (score >= 80) return "strong";
  if (score >= 70) return "watch";
  return "needs_work";
}

function summarizeSection(section: WeightedSection) {
  return {
    score: section.score,
    weight: section.weight,
    label: section.label,
    details: section.details,
  };
}

async function main() {
  loadClawCloudEnv();
  const { getProviderSnapshot } = await import("@/lib/env");

  const withLive = parseFlag("--with-live");
  const reportPath = "tmp-clawcloud-scorecard.json";
  const providerSnapshot = getProviderSnapshot();

  const replayRun = runTsxJsonScript("scripts/clawcloud-replay-eval.ts");
  const replayJson = chooseJsonReport<{
    passRate?: number;
    passed?: number;
    failed?: number;
    averageLatencyMs?: number;
    results?: Array<{ id: string; ok: boolean }>;
  }>(replayRun, "tmp-clawcloud-replay-report.json") as
    | {
      passRate?: number;
      passed?: number;
      failed?: number;
      averageLatencyMs?: number;
      results?: Array<{ id: string; ok: boolean }>;
    }
    | null;

  const benchmarkRun = runTsxJsonScript("scripts/clawcloud-hard-benchmark.ts");
  const benchmarkJson = chooseJsonReport<{
    overall?: { percentage?: number };
    results?: Array<{ key: string; misses?: string[] }>;
  }>(benchmarkRun, "tmp-clawcloud-hard-benchmark.json") as
    | {
      overall?: { percentage?: number };
      results?: Array<{ key: string; misses?: string[] }>;
    }
    | null;

  let liveRun:
    | {
      ok: boolean;
      exitCode: number;
      stdout: string;
      stderr: string;
      json: unknown;
    }
    | null = null;
  let liveJson:
    | {
      passed?: number;
      failed?: number;
      total?: number;
      results?: Array<{ id: string; ok: boolean }>;
    }
    | null = null;

  if (withLive) {
    liveRun = runTsxJsonScript("scripts/clawcloud-live-api-qa.ts");
    liveJson = chooseJsonReport<{
      passed?: number;
      failed?: number;
      total?: number;
      results?: Array<{ id: string; ok: boolean }>;
    }>(liveRun, "tmp-clawcloud-live-api-qa.json") as
      | {
        passed?: number;
        failed?: number;
        total?: number;
        results?: Array<{ id: string; ok: boolean }>;
      }
      | null;
  }

  const sections: WeightedSection[] = [
    {
      key: "replay",
      label: "WhatsApp replay",
      weight: 45,
      score: replayJson ? extractNumber(replayJson.passRate, 0) : null,
      details: {
        passed: replayJson?.passed ?? 0,
        failed: replayJson?.failed ?? 0,
        averageLatencyMs: replayJson?.averageLatencyMs ?? null,
        failedCases: (replayJson?.results ?? []).filter((item) => !item.ok).map((item) => item.id),
        commandOk: replayRun.ok,
      },
    },
    {
      key: "benchmark",
      label: "Hard benchmark",
      weight: 35,
      score: benchmarkJson ? extractNumber(benchmarkJson.overall?.percentage, 0) : null,
      details: {
        weakCases: (benchmarkJson?.results ?? [])
          .filter((item) => (item.misses?.length ?? 0) > 0)
          .map((item) => ({
            key: item.key,
            misses: item.misses ?? [],
          })),
        commandOk: benchmarkRun.ok,
      },
    },
  ];

  if (withLive) {
    sections.push({
      key: "live_api",
      label: "Live API QA",
      weight: 20,
      score: liveJson
        ? Number(
          ((extractNumber(liveJson.passed, 0) / Math.max(extractNumber(liveJson.total, 0), 1)) * 100).toFixed(1),
        )
        : null,
      details: {
        passed: liveJson?.passed ?? 0,
        failed: liveJson?.failed ?? 0,
        failedCases: (liveJson?.results ?? []).filter((item) => !item.ok).map((item) => item.id),
        commandOk: liveRun?.ok ?? false,
      },
    });
  }

  const scoredSections = sections.filter((section) => section.score !== null) as Array<WeightedSection & { score: number }>;
  const totalWeight = scoredSections.reduce((sum, section) => sum + section.weight, 0);
  const overallScore = totalWeight > 0
    ? Number(
      (
        scoredSections.reduce((sum, section) => sum + (section.score * section.weight), 0)
        / totalWeight
      ).toFixed(1),
    )
    : 0;

  const report = {
    checkedAt: new Date().toISOString(),
    providerSnapshot,
    withLive,
    overall: {
      score: overallScore,
      label: scoreLabel(overallScore),
      totalWeight,
    },
    sections: Object.fromEntries(sections.map((section) => [section.key, summarizeSection(section)])),
    commandStatus: {
      replay: { ok: replayRun.ok, exitCode: replayRun.exitCode },
      benchmark: { ok: benchmarkRun.ok, exitCode: benchmarkRun.exitCode },
      live: withLive
        ? { ok: liveRun?.ok ?? false, exitCode: liveRun?.exitCode ?? 1 }
        : { ok: null, exitCode: null },
    },
  };

  writeJsonReport(reportPath, report);
  console.log(JSON.stringify(report, null, 2));

  if (!replayRun.ok || !benchmarkRun.ok || (withLive && !liveRun?.ok)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
