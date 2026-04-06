// lib/clawcloud-model-health-persistence.ts
// -----------------------------------------------------------------------------
// PERSISTENT MODEL HEALTH — Survives restarts by persisting health state to
// Supabase. Includes performance-based model ranking, adaptive timeouts,
// and independent judge model selection that avoids generator bias.
// -----------------------------------------------------------------------------

import type { IntentType, ResponseMode } from "@/lib/clawcloud-ai";

export type PersistedModelHealthRecord = {
  model: string;
  intent: string;
  responseMode: string;
  consecutiveFailures: number;
  totalCalls: number;
  totalSuccesses: number;
  totalFailures: number;
  avgLatencyMs: number;
  avgHeuristicScore: number;
  judgeWins: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  cooldownUntil: string | null;
  updatedAt: string;
};

export type ModelPerformanceRank = {
  model: string;
  intent: string;
  compositeScore: number; // 0-100
  successRate: number;
  avgLatencyMs: number;
  avgHeuristicScore: number;
  judgeWinRate: number;
  sampleSize: number;
};

// ---------------------------------------------------------------------------
// IN-MEMORY PERFORMANCE TRACKER (feeds into persistence)
// ---------------------------------------------------------------------------

type ModelPerfEntry = {
  model: string;
  intent: string;
  responseMode: string;
  calls: number;
  successes: number;
  failures: number;
  totalLatencyMs: number;
  totalScore: number;
  judgeWins: number;
  latencySamples: number[];
  consecutiveFailures: number;
  cooldownUntil: number;
  lastSuccessAt: number;
  lastFailureAt: number;
};

const PERF_TRACKER = new Map<string, ModelPerfEntry>();
const PERF_MAX_LATENCY_SAMPLES = 100;

function perfKey(model: string, intent: string, responseMode: string): string {
  return `${responseMode}:${intent}:${model}`;
}

function getOrCreatePerf(model: string, intent: string, responseMode: string): ModelPerfEntry {
  const key = perfKey(model, intent, responseMode);
  let entry = PERF_TRACKER.get(key);
  if (!entry) {
    entry = {
      model, intent, responseMode,
      calls: 0, successes: 0, failures: 0,
      totalLatencyMs: 0, totalScore: 0, judgeWins: 0,
      latencySamples: [], consecutiveFailures: 0,
      cooldownUntil: 0, lastSuccessAt: 0, lastFailureAt: 0,
    };
    PERF_TRACKER.set(key, entry);
  }
  return entry;
}

export function recordModelPerformance(input: {
  model: string;
  intent: string;
  responseMode: string;
  success: boolean;
  latencyMs: number;
  heuristicScore?: number;
  isJudgeWin?: boolean;
}) {
  const perf = getOrCreatePerf(input.model, input.intent, input.responseMode);
  perf.calls += 1;

  if (input.success) {
    perf.successes += 1;
    perf.consecutiveFailures = 0;
    perf.cooldownUntil = 0;
    perf.lastSuccessAt = Date.now();
  } else {
    perf.failures += 1;
    perf.consecutiveFailures += 1;
    perf.lastFailureAt = Date.now();
    const cooldown = Math.min(45_000 * 2 ** Math.max(0, perf.consecutiveFailures - 1), 8 * 60 * 1000);
    perf.cooldownUntil = Date.now() + cooldown;
  }

  perf.totalLatencyMs += input.latencyMs;
  if (input.heuristicScore !== undefined) {
    perf.totalScore += input.heuristicScore;
  }
  if (input.isJudgeWin) {
    perf.judgeWins += 1;
  }

  // Keep latency samples
  if (perf.latencySamples.length >= PERF_MAX_LATENCY_SAMPLES) {
    perf.latencySamples.shift();
  }
  perf.latencySamples.push(input.latencyMs);
}

export function recordModelJudgeWin(model: string, intent: string, responseMode: string) {
  const perf = getOrCreatePerf(model, intent, responseMode);
  perf.judgeWins += 1;
}

// ---------------------------------------------------------------------------
// COMPOSITE SCORE — rank models by combined quality signals
// ---------------------------------------------------------------------------

export function computeModelCompositeScore(model: string, intent: string, responseMode: string): number {
  const perf = PERF_TRACKER.get(perfKey(model, intent, responseMode));
  if (!perf || perf.calls < 2) return 50; // Unknown model gets neutral score

  const successRate = perf.successes / Math.max(perf.calls, 1);
  const avgLatency = perf.totalLatencyMs / Math.max(perf.calls, 1);
  const avgScore = perf.totalScore / Math.max(perf.successes, 1);
  const judgeWinRate = perf.judgeWins / Math.max(perf.successes, 1);

  // Composite: 40% success rate + 25% judge win rate + 20% heuristic score + 15% latency
  const latencyScore = Math.max(0, 100 - (avgLatency / 200)); // Lower latency = higher score
  const normalizedScore = Math.min(avgScore / 80, 1) * 100; // Normalize heuristic score to 0-100

  return (
    successRate * 40
    + judgeWinRate * 25
    + normalizedScore * 0.20
    + latencyScore * 0.15
  );
}

export function getModelRankingsForIntent(intent: string, responseMode: string): ModelPerformanceRank[] {
  const rankings: ModelPerformanceRank[] = [];

  for (const [, perf] of PERF_TRACKER) {
    if (perf.intent !== intent || perf.responseMode !== responseMode) continue;
    if (perf.calls < 1) continue;

    rankings.push({
      model: perf.model,
      intent: perf.intent,
      compositeScore: computeModelCompositeScore(perf.model, intent, responseMode),
      successRate: perf.successes / Math.max(perf.calls, 1),
      avgLatencyMs: Math.round(perf.totalLatencyMs / Math.max(perf.calls, 1)),
      avgHeuristicScore: Math.round((perf.totalScore / Math.max(perf.successes, 1)) * 100) / 100,
      judgeWinRate: perf.judgeWins / Math.max(perf.successes, 1),
      sampleSize: perf.calls,
    });
  }

  return rankings.sort((a, b) => b.compositeScore - a.compositeScore);
}

// ---------------------------------------------------------------------------
// ADAPTIVE TIMEOUT — learn optimal timeout per model from actual latency data
// ---------------------------------------------------------------------------

export function getAdaptiveTimeout(model: string, intent: string, responseMode: string, baseTimeout: number): number {
  const perf = PERF_TRACKER.get(perfKey(model, intent, responseMode));
  if (!perf || perf.latencySamples.length < 5) return baseTimeout;

  const sorted = [...perf.latencySamples].sort((a, b) => a - b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1] ?? baseTimeout;

  // Set timeout to p95 + 30% buffer, but NEVER go below the base timeout
  // (prevents stale failure data from shrinking timeouts too aggressively)
  const adaptive = p95 * 1.3;
  return Math.max(baseTimeout, Math.min(adaptive, baseTimeout * 1.5));
}

// ---------------------------------------------------------------------------
// PERFORMANCE-BASED MODEL REORDERING
// ---------------------------------------------------------------------------

export function reorderModelsByPerformance(
  models: string[],
  intent: string,
  responseMode: string,
): string[] {
  const scored = models.map((model) => ({
    model,
    score: computeModelCompositeScore(model, intent, responseMode),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.model);
}

// ---------------------------------------------------------------------------
// INDEPENDENT JUDGE MODEL SELECTION
// Avoids using the same model for both generating and judging to prevent bias.
// ---------------------------------------------------------------------------

const DEDICATED_JUDGE_MODELS = [
  "qwen/qwen3.5-397b-a17b",
  "moonshotai/kimi-k2.5",
  "moonshotai/kimi-k2-thinking",
  "meta/llama-3.3-70b-instruct",
  "gpt-4o",
];

export function selectIndependentJudge(
  generatorModels: string[],
  intent: string,
  responseMode: string,
): string[] {
  const generatorSet = new Set(generatorModels);

  // Prefer models that were NOT used for generation
  const independent = DEDICATED_JUDGE_MODELS.filter((m) => !generatorSet.has(m));

  // If all judge models were used as generators, fallback to best available
  if (independent.length === 0) {
    return DEDICATED_JUDGE_MODELS.slice(0, 2);
  }

  // Reorder by performance for judging
  return reorderModelsByPerformance(
    independent.slice(0, 3),
    intent,
    responseMode,
  );
}

// ---------------------------------------------------------------------------
// PERSISTENCE — serialize/deserialize for Supabase storage
// ---------------------------------------------------------------------------

export function serializeHealthState(): PersistedModelHealthRecord[] {
  const records: PersistedModelHealthRecord[] = [];

  for (const [, perf] of PERF_TRACKER) {
    records.push({
      model: perf.model,
      intent: perf.intent,
      responseMode: perf.responseMode,
      consecutiveFailures: perf.consecutiveFailures,
      totalCalls: perf.calls,
      totalSuccesses: perf.successes,
      totalFailures: perf.failures,
      avgLatencyMs: Math.round(perf.totalLatencyMs / Math.max(perf.calls, 1)),
      avgHeuristicScore: Math.round((perf.totalScore / Math.max(perf.successes, 1)) * 100) / 100,
      judgeWins: perf.judgeWins,
      lastSuccessAt: perf.lastSuccessAt ? new Date(perf.lastSuccessAt).toISOString() : null,
      lastFailureAt: perf.lastFailureAt ? new Date(perf.lastFailureAt).toISOString() : null,
      cooldownUntil: perf.cooldownUntil ? new Date(perf.cooldownUntil).toISOString() : null,
      updatedAt: new Date().toISOString(),
    });
  }

  return records;
}

export function restoreHealthState(records: PersistedModelHealthRecord[]) {
  for (const record of records) {
    const perf = getOrCreatePerf(record.model, record.intent, record.responseMode);
    perf.calls = record.totalCalls;
    perf.successes = record.totalSuccesses;
    perf.failures = record.totalFailures;
    perf.consecutiveFailures = record.consecutiveFailures;
    perf.totalLatencyMs = record.avgLatencyMs * record.totalCalls;
    perf.totalScore = record.avgHeuristicScore * record.totalSuccesses;
    perf.judgeWins = record.judgeWins;
    perf.lastSuccessAt = record.lastSuccessAt ? new Date(record.lastSuccessAt).getTime() : 0;
    perf.lastFailureAt = record.lastFailureAt ? new Date(record.lastFailureAt).getTime() : 0;
    perf.cooldownUntil = record.cooldownUntil ? new Date(record.cooldownUntil).getTime() : 0;
  }
}

// ---------------------------------------------------------------------------
// HEALTH CHECK — is a model currently healthy for a given intent?
// ---------------------------------------------------------------------------

export function isModelHealthy(model: string, intent: string, responseMode: string): boolean {
  const perf = PERF_TRACKER.get(perfKey(model, intent, responseMode));
  if (!perf) return true; // Unknown model is assumed healthy
  return perf.cooldownUntil <= Date.now();
}

export function getModelCooldownRemaining(model: string, intent: string, responseMode: string): number {
  const perf = PERF_TRACKER.get(perfKey(model, intent, responseMode));
  if (!perf) return 0;
  return Math.max(0, perf.cooldownUntil - Date.now());
}
