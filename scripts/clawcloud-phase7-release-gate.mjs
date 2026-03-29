import { existsSync, readFileSync, writeFileSync } from "node:fs";

const REPORT_PATH = "tmp-clawcloud-phase7-release-gate.json";
const MIN_SCORECARD_OVERALL = 95;
const MIN_REPLAY_SCORE = 100;
const MIN_BENCHMARK_SCORE = 90;
const MIN_LIVE_API_SCORE = 90;

function stripOuterQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function loadEnvFile(filename) {
  if (!existsSync(filename)) {
    return;
  }

  const raw = readFileSync(filename, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) {
      continue;
    }

    const key = trimmed.slice(0, splitAt).trim();
    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = stripOuterQuotes(trimmed.slice(splitAt + 1).trim());
  }
}

function loadClawCloudEnv() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
}

function writeJsonReport(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readTextFile(filePath) {
  if (!existsSync(filePath)) {
    return "";
  }

  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function readJsonFile(filePath) {
  const raw = readTextFile(filePath);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hasLiveApiQaConfig() {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTJS_URL || "").trim();
  const bearer = (process.env.CRON_SECRET || process.env.AGENT_SECRET || "").trim();
  return Boolean(baseUrl && bearer);
}

function isFreshEnough(checkedAt, maxAgeHours = 24) {
  if (typeof checkedAt !== "string" || !checkedAt) {
    return false;
  }

  const checkedTime = new Date(checkedAt).getTime();
  if (Number.isNaN(checkedTime)) {
    return false;
  }

  return (Date.now() - checkedTime) <= (maxAgeHours * 60 * 60 * 1000);
}

async function main() {
  loadClawCloudEnv();

  const scorecardJson = readJsonFile("tmp-clawcloud-scorecard.json");
  const overallScore = readNumber(scorecardJson?.overall?.score, 0);
  const replayScore = readNumber(scorecardJson?.sections?.replay?.score, 0);
  const benchmarkScore = readNumber(scorecardJson?.sections?.benchmark?.score, 0);
  const liveApiScore = readNumber(scorecardJson?.sections?.live_api?.score, 0);
  const requireLiveApiScorecard = Boolean(scorecardJson?.withLive || hasLiveApiQaConfig());

  const canaryJson = readJsonFile("tmp-clawcloud-daily-canary.json");

  const qualityGateWorkflow = readTextFile(".github/workflows/quality-gate.yml");
  const canaryWorkflow = readTextFile(".github/workflows/phase7-canary.yml");

  const checks = [
    {
      key: "scorecard_report",
      ok: Boolean(scorecardJson),
      detail: scorecardJson ? "Scorecard report found." : "Scorecard report missing.",
    },
    {
      key: "scorecard_threshold",
      ok: overallScore >= MIN_SCORECARD_OVERALL,
      detail: `Overall score ${overallScore} / ${MIN_SCORECARD_OVERALL}.`,
    },
    {
      key: "replay_threshold",
      ok: replayScore >= MIN_REPLAY_SCORE,
      detail: `Replay score ${replayScore} / ${MIN_REPLAY_SCORE}.`,
    },
    {
      key: "benchmark_threshold",
      ok: benchmarkScore >= MIN_BENCHMARK_SCORE,
      detail: `Benchmark score ${benchmarkScore} / ${MIN_BENCHMARK_SCORE}.`,
    },
    {
      key: "scorecard_components",
      ok:
        scorecardJson?.commandStatus?.replay?.ok === true
        && scorecardJson?.commandStatus?.benchmark?.ok === true
        && (!requireLiveApiScorecard || scorecardJson?.commandStatus?.live?.ok === true),
      detail: requireLiveApiScorecard
        ? "Replay, benchmark, and live API sections must all pass."
        : "Replay and benchmark sections must both pass.",
    },
    {
      key: "scorecard_freshness",
      ok: isFreshEnough(scorecardJson?.checkedAt),
      detail: "Scorecard report must be fresh.",
    },
    {
      key: "live_scorecard_mode",
      ok: !requireLiveApiScorecard || scorecardJson?.withLive === true,
      detail: requireLiveApiScorecard
        ? "Live QA is configured, so the scorecard must be generated with --with-live."
        : "Live QA is optional for this environment.",
    },
    {
      key: "live_api_threshold",
      ok: !requireLiveApiScorecard || liveApiScore >= MIN_LIVE_API_SCORE,
      detail: requireLiveApiScorecard
        ? `Live API score ${liveApiScore} / ${MIN_LIVE_API_SCORE}.`
        : "Live API threshold skipped because live QA is not configured.",
    },
    {
      key: "canary_report",
      ok: Boolean(canaryJson),
      detail: canaryJson ? "Canary report found." : "Canary report missing.",
    },
    {
      key: "canary_gate",
      ok: Boolean(canaryJson?.dryRun || canaryJson?.healthy),
      detail: canaryJson?.dryRun
        ? "Canary dry-run validated workflow wiring."
        : "Canary run passed.",
    },
    {
      key: "canary_freshness",
      ok: isFreshEnough(canaryJson?.checkedAt),
      detail: "Canary report must be fresh.",
    },
    {
      key: "quality_workflow",
      ok:
        qualityGateWorkflow.includes("name: Quality Gate")
        && qualityGateWorkflow.includes("phase0-quality")
        && qualityGateWorkflow.includes("npm run build")
        && qualityGateWorkflow.includes("npm run qa:phase7"),
      detail: "Quality Gate workflow must run build and Phase 7 release checks.",
    },
    {
      key: "scheduled_canary_workflow",
      ok:
        canaryWorkflow.includes("schedule:")
        && canaryWorkflow.includes("workflow_dispatch:")
        && canaryWorkflow.includes("npm run qa:canary"),
      detail: "Scheduled canary workflow must exist and invoke qa:canary.",
    },
  ];

  const healthy = checks.every((check) => check.ok);
  const report = {
    checkedAt: new Date().toISOString(),
    healthy,
    thresholds: {
      minScorecardOverall: MIN_SCORECARD_OVERALL,
      minReplayScore: MIN_REPLAY_SCORE,
      minBenchmarkScore: MIN_BENCHMARK_SCORE,
      minLiveApiScore: MIN_LIVE_API_SCORE,
    },
    scorecard: {
      ok: Boolean(scorecardJson),
      overallScore,
      replayScore,
      benchmarkScore,
      liveApiScore: scorecardJson?.withLive ? liveApiScore : null,
      label: scorecardJson?.overall?.label ?? null,
      withLive: Boolean(scorecardJson?.withLive),
    },
    canary: {
      ok: Boolean(canaryJson),
      dryRun: Boolean(canaryJson?.dryRun),
      healthy: Boolean(canaryJson?.healthy),
      notes: canaryJson?.notes ?? [],
    },
    checks,
  };

  writeJsonReport(REPORT_PATH, report);
  console.log(JSON.stringify(report, null, 2));

  if (!healthy) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
