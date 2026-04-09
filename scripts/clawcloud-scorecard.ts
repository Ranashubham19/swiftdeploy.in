import { existsSync, readFileSync } from "node:fs";

import {
  loadClawCloudEnv,
  parseFlag,
  runTsxJsonScriptAsync,
  writeJsonReport,
} from "./clawcloud-script-helpers";

type WeightedSection = {
  key: string;
  label: string;
  weight: number;
  score: number | null;
  details: Record<string, unknown>;
};

type JsonScriptRun = Awaited<ReturnType<typeof runTsxJsonScriptAsync>>;

type ScorecardComponent<T> = {
  key: string;
  scriptPath: string;
  reportPath: string;
  args?: string[];
  timeoutMs?: number;
  parse: (value: T | null, run: JsonScriptRun | null, reused: boolean) => WeightedSection;
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
  runResult: JsonScriptRun | null,
  filePath: string,
) {
  if (!runResult) {
    return readJsonFile<T>(filePath);
  }

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

function isFreshEnough(checkedAt: unknown, maxAgeHours = 6) {
  if (typeof checkedAt !== "string" || !checkedAt) {
    return false;
  }

  const checkedTime = new Date(checkedAt).getTime();
  if (Number.isNaN(checkedTime)) {
    return false;
  }

  return (Date.now() - checkedTime) <= (maxAgeHours * 60 * 60 * 1000);
}

async function loadOrRunComponent<T>(
  component: ScorecardComponent<T>,
  reuseFreshReports: boolean,
) {
  const cachedReport = readJsonFile<T & { checkedAt?: string; generatedAt?: string }>(component.reportPath);
  const cachedTimestamp = cachedReport?.checkedAt ?? cachedReport?.generatedAt ?? null;
  const canReuse = reuseFreshReports && isFreshEnough(cachedTimestamp);

  if (canReuse) {
    return {
      reused: true,
      run: null,
      json: cachedReport as T,
    };
  }

  const run = await runTsxJsonScriptAsync(component.scriptPath, component.args ?? [], {
    timeoutMs: component.timeoutMs,
  });
  const json = chooseJsonReport<T>(run, component.reportPath);

  return {
    reused: false,
    run,
    json,
  };
}

async function main() {
  loadClawCloudEnv();
  const { getProviderSnapshot } = await import("@/lib/env");

  const withLive = parseFlag("--with-live");
  const reuseFreshReports = !parseFlag("--no-reuse-fresh");
  const reportPath = "tmp-clawcloud-scorecard.json";
  const providerSnapshot = getProviderSnapshot();
  const components: Array<ScorecardComponent<any>> = [
    {
      key: "replay",
      scriptPath: "scripts/clawcloud-replay-eval.ts",
      reportPath: "tmp-clawcloud-replay-report.json",
      timeoutMs: 10 * 60 * 1000,
      parse: (replayJson, run, reused) => ({
        key: "replay",
        label: "WhatsApp replay",
        weight: 35,
        score: replayJson ? extractNumber(replayJson.passRate, 0) : null,
        details: {
          passed: replayJson?.passed ?? 0,
          failed: replayJson?.failed ?? 0,
          averageLatencyMs: replayJson?.averageLatencyMs ?? null,
          failedCases: (replayJson?.results ?? []).filter((item: { ok: boolean }) => !item.ok).map((item: { id: string }) => item.id),
          commandOk: reused ? Boolean(replayJson) : run?.ok ?? false,
          reusedFreshReport: reused,
          timedOut: run?.timedOut ?? false,
        },
      }),
    },
    {
      key: "regression",
      scriptPath: "scripts/clawcloud-whatsapp-regression.ts",
      reportPath: "tmp-clawcloud-whatsapp-regression.scorecard.json",
      args: ["--profile", "scorecard", "--concurrency", "4"],
      timeoutMs: 8 * 60 * 1000,
      parse: (regressionJson, run, reused) => ({
        key: "regression",
        label: "Regression suite",
        weight: 20,
        score: regressionJson
          ? Number(
            ((extractNumber(regressionJson.passed, 0) / Math.max(extractNumber(regressionJson.total, 0), 1)) * 100).toFixed(1),
          )
          : null,
        details: {
          passed: regressionJson?.passed ?? 0,
          failed: regressionJson?.failed ?? 0,
          failedCases: (regressionJson?.results ?? []).filter((item: { ok: boolean }) => !item.ok).map((item: { prompt: string }) => item.prompt),
          commandOk: reused ? Boolean(regressionJson) : run?.ok ?? false,
          reusedFreshReport: reused,
          timedOut: run?.timedOut ?? false,
        },
      }),
    },
    {
      key: "benchmark",
      scriptPath: "scripts/clawcloud-hard-benchmark.ts",
      reportPath: "tmp-clawcloud-hard-benchmark.json",
      timeoutMs: 10 * 60 * 1000,
      parse: (benchmarkJson, run, reused) => ({
        key: "benchmark",
        label: "Hard benchmark",
        weight: 30,
        score: benchmarkJson ? extractNumber(benchmarkJson.overall?.percentage, 0) : null,
        details: {
          weakCases: (benchmarkJson?.results ?? [])
            .filter((item: { misses?: string[] }) => (item.misses?.length ?? 0) > 0)
            .map((item: { key: string; misses?: string[] }) => ({
              key: item.key,
              misses: item.misses ?? [],
            })),
          commandOk: reused ? Boolean(benchmarkJson) : run?.ok ?? false,
          reusedFreshReport: reused,
          timedOut: run?.timedOut ?? false,
        },
      }),
    },
  ];

  if (withLive) {
    components.push({
      key: "live_api",
      scriptPath: "scripts/clawcloud-daily-canary.ts",
      reportPath: "tmp-clawcloud-daily-canary.json",
      timeoutMs: 4 * 60 * 1000,
      parse: (liveJson, run, reused) => ({
        key: "live_api",
        label: "Live production canary",
        weight: 15,
        score: liveJson
          ? Number(
            ((extractNumber(liveJson.passed, 0) / Math.max(extractNumber(liveJson.total, 0), 1)) * 100).toFixed(1),
          )
          : null,
        details: {
          passed: liveJson?.passed ?? 0,
          failed: liveJson?.failed ?? 0,
          failedCases: (liveJson?.results ?? []).filter((item: { ok: boolean }) => !item.ok).map((item: { id: string }) => item.id),
          commandOk: reused ? Boolean(liveJson) : run?.ok ?? false,
          reusedFreshReport: reused,
          timedOut: run?.timedOut ?? false,
        },
      }),
    });
  }

  const componentResults = await Promise.all(
    components.map(async (component) => {
      const resolved = await loadOrRunComponent(component, reuseFreshReports);
      return {
        key: component.key,
        run: resolved.run,
        section: component.parse(resolved.json, resolved.run, resolved.reused),
      };
    }),
  );

  const sections = componentResults.map((item) => item.section);

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
    commandStatus: Object.fromEntries(
      componentResults.map((item) => {
        const details = item.section.details as {
          commandOk?: boolean;
          reusedFreshReport?: boolean;
        };

        return [item.key === "live_api" ? "live" : item.key, {
          ok: details.commandOk ?? false,
          exitCode: item.run?.exitCode ?? 0,
          reusedFreshReport: details.reusedFreshReport ?? false,
        }];
      }),
    ),
  };

  writeJsonReport(reportPath, report);
  console.log(JSON.stringify(report, null, 2));

  const componentFailed = componentResults.some((item) => {
    const details = item.section.details as { commandOk?: boolean };
    return details.commandOk !== true;
  });

  if (componentFailed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
