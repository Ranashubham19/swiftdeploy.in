import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

type Criterion = {
  label: string;
  patterns: RegExp[];
};

type BenchCase = {
  key: string;
  domain: string;
  question: string;
  criteria: Criterion[];
};

type BenchResult = {
  key: string;
  domain: string;
  question: string;
  elapsedMs: number;
  elapsedSeconds: number;
  score: number;
  maxScore: number;
  hits: string[];
  misses: string[];
  answer: string;
};

const benchUserId = "00000000-0000-0000-0000-000000000702";
const reportPath = "tmp-clawcloud-hard-benchmark.json";

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

const cases: BenchCase[] = [
  {
    key: "stripe_billing_migration",
    domain: "coding",
    question:
      "deep: Design a zero-downtime Stripe billing migration from mutable balances to an immutable ledger. I need shadow mode, dual-write, idempotent webhook handling, rollback, and exact guidance on inbox/event dedupe keys.",
    criteria: [
      { label: "Clear migration phases", patterns: [/\bshadow\b/i, /\bdual-?write\b/i, /\bcutover|primary\b/i] },
      { label: "Webhook idempotency", patterns: [/\bidempot/i, /\bevent_id|stripe event/i] },
      { label: "Rollback path", patterns: [/\brollback\b/i] },
      { label: "Immutable ledger framing", patterns: [/\bledger\b/i, /\bimmutab/i] },
      { label: "Schema or concrete implementation detail", patterns: [/```(?:sql|ts|typescript)/i, /\bcreate table\b/i] },
    ],
  },
  {
    key: "did_policy_eval",
    domain: "math",
    question:
      "deep: In a difference-in-differences policy evaluation, the treatment coefficient beta is -0.18 and the standard error is 0.05. Explain the estimator, compute the t-statistic, 95% confidence interval, significance, and list the parallel-trends checks and robustness tests.",
    criteria: [
      { label: "DiD estimator or regression form", patterns: [/\bdifference-?in-?differences|did\b/i, /\btreated.*post|beta3|att\b/i] },
      { label: "Numerical significance calculation", patterns: [/\bt-?stat/i, /\b95%\s*ci|confidence interval\b/i] },
      { label: "Parallel trends", patterns: [/\bparallel trends?\b/i] },
      { label: "Event-study or placebo robustness", patterns: [/\bevent-?study\b/i, /\bplacebo\b/i] },
      { label: "Interpretation of treatment effect", patterns: [/\beffect\b/i, /\bsignificant|not statistically significant\b/i] },
    ],
  },
  {
    key: "energy_var",
    domain: "quant_finance",
    question:
      "deep: A European power retailer needs weekly 95% VaR and stress loss estimation under spot price spikes and heat waves while hedging with forwards. Give the correct loss definition, estimation structure, stress testing approach, and explain why naive Gaussian normality fails.",
    criteria: [
      { label: "Loss definition", patterns: [/\bloss definition\b/i, /\bL_week|sum_h|q_actual|q_hedged\b/i] },
      { label: "VaR estimation method", patterns: [/\bvar\b/i, /\bhistorical simulation|scenario simulation|bootstrap\b/i] },
      { label: "Stress testing", patterns: [/\bstress\b/i, /\bheat-?wave\b/i] },
      { label: "Heavy-tail or non-Gaussian warning", patterns: [/\bheavy-?tailed|fat tails?|non-gaussian|naive normal/i] },
      { label: "Practical recommendation", patterns: [/\bfinal answer|bottom line\b/i] },
    ],
  },
  {
    key: "satellite_collision_copilot",
    domain: "aerospace",
    question:
      "deep: Design a satellite collision-avoidance copilot. I need conjunction data ingestion, probability-of-collision scoring, maneuver recommendation drafting, human override, approval controls, and a rollout plan.",
    criteria: [
      { label: "Conjunction or CDM ingestion", patterns: [/\bconjunction\b/i, /\bcdm\b/i] },
      { label: "Collision probability or risk scoring", patterns: [/\bprobability of collision|\bpc\b/i, /\brisk scoring|miss distance\b/i] },
      { label: "Human-gated control model", patterns: [/\bhuman-gated|human override|approval\b/i] },
      { label: "Maneuver recommendation details", patterns: [/\bmaneuver\b/i, /\bdelta-v|burn\b/i] },
      { label: "Rollout or phased deployment", patterns: [/\bphase 1|rollout\b/i] },
    ],
  },
  {
    key: "carbon_registry_architecture",
    domain: "advanced_systems",
    question:
      "deep: Design a production-safe architecture for a cross-border carbon credit registry SaaS. Requirements: multi-tenant ledger, issuance and retirement tracking, GDPR deletion handling, zk-friendly audit proofs, idempotent settlement webhooks, rollback-safe migrations, and operator approvals for high-impact actions.",
    criteria: [
      { label: "Core invariants or design rules", patterns: [/\binvariant|design rules?|single source of truth|append-only\b/i] },
      { label: "Schema or data model", patterns: [/```(?:sql|ts|typescript)/i, /\bschema|create table|data model\b/i] },
      { label: "Flow plus idempotency", patterns: [/\bflow\b/i, /\bidempot/i, /\bwebhook\b/i] },
      { label: "Privacy and auditability", patterns: [/\bgdpr\b/i, /\baudit|proof\b/i] },
      { label: "Failure modes, rollback, or approvals", patterns: [/\bfailure modes?|rollback|operator approval|human approval\b/i] },
    ],
  },
];

function scoreAnswer(answer: string, criteria: Criterion[]) {
  const hits: string[] = [];
  const misses: string[] = [];

  for (const criterion of criteria) {
    const matched = criterion.patterns.some((pattern) => pattern.test(answer));
    if (matched) {
      hits.push(criterion.label);
    } else {
      misses.push(criterion.label);
    }
  }

  return {
    score: hits.length * 2,
    maxScore: criteria.length * 2,
    hits,
    misses,
  };
}

async function runCase(
  test: BenchCase,
  routeInboundAgentMessage: (userId: string, message: string) => Promise<string | null>,
): Promise<BenchResult> {
  const started = performance.now();
  const answer = (await routeInboundAgentMessage(benchUserId, test.question)) ?? "";
  const elapsedMs = performance.now() - started;
  const scoring = scoreAnswer(answer, test.criteria);

  return {
    key: test.key,
    domain: test.domain,
    question: test.question,
    elapsedMs: Number(elapsedMs.toFixed(1)),
    elapsedSeconds: Number((elapsedMs / 1000).toFixed(2)),
    score: scoring.score,
    maxScore: scoring.maxScore,
    hits: scoring.hits,
    misses: scoring.misses,
    answer,
  };
}

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const [{ getProviderSnapshot }, { routeInboundAgentMessage }] = await Promise.all([
    import("@/lib/env"),
    import("@/lib/clawcloud-agent"),
  ]);

  const providerSnapshot = getProviderSnapshot();
  const results: BenchResult[] = [];

  for (const test of cases) {
    results.push(await runCase(test, routeInboundAgentMessage));
  }

  const totals = results.reduce(
    (acc, item) => {
      acc.score += item.score;
      acc.maxScore += item.maxScore;
      acc.elapsedMs += item.elapsedMs;
      return acc;
    },
    { score: 0, maxScore: 0, elapsedMs: 0 },
  );

  const report = {
    generatedAt: new Date().toISOString(),
    benchUserId,
    providerSnapshot,
    overall: {
      totalScore: totals.score,
      totalMaxScore: totals.maxScore,
      percentage: Number(((totals.score / totals.maxScore) * 100).toFixed(1)),
      totalElapsedSeconds: Number((totals.elapsedMs / 1000).toFixed(2)),
      averageElapsedSeconds: Number((totals.elapsedMs / results.length / 1000).toFixed(2)),
    },
    results,
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const summary = {
    generatedAt: report.generatedAt,
    reportPath,
    providerSnapshot,
    overall: report.overall,
    results: results.map((item) => ({
      key: item.key,
      domain: item.domain,
      elapsedSeconds: item.elapsedSeconds,
      score: item.score,
      maxScore: item.maxScore,
      hits: item.hits,
      misses: item.misses,
      answerPreview: item.answer.slice(0, 280),
    })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
