// lib/clawcloud-observability.ts
// -----------------------------------------------------------------------------
// STRUCTURED OBSERVABILITY — Metrics, structured logging, and performance
// tracking for the ClawCloud AI engine. Replaces console.log with production-
// grade structured logging and real-time metrics collection.
// -----------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export type MetricType = "counter" | "gauge" | "histogram";

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  component: string;
  event: string;
  data: Record<string, unknown>;
  traceId?: string;
  userId?: string;
  intent?: string;
  model?: string;
  latencyMs?: number;
}

export interface ModelMetrics {
  model: string;
  intent: string;
  responseMode: string;
  totalCalls: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  avgHeuristicScore: number;
  judgeWinCount: number;
  lastCalledAt: number;
  lastSuccessAt: number;
  lastFailureAt: number;
}

export interface IntentMetrics {
  intent: string;
  totalQueries: number;
  avgResponseTimeMs: number;
  judgeInvokedCount: number;
  fallbackCount: number;
  cacheHitCount: number;
  safetyBlockedCount: number;
  avgConfidence: number;
  lastQueryAt: number;
}

export interface SystemHealthSnapshot {
  uptime: number;
  totalRequests: number;
  activeRequests: number;
  cacheSize: number;
  cacheHitRate: number;
  avgResponseTimeMs: number;
  modelHealthSummary: Array<{ model: string; healthy: boolean; consecutiveFailures: number }>;
  intentDistribution: Record<string, number>;
  errorRate: number;
  lastResetAt: number;
}

export type AnswerQualityMetricKey =
  | "visible_fallback"
  | "blocked_good_answer"
  | "wrong_language"
  | "stale_live_answer"
  | "media_grounding_failure"
  | "ambiguous_contact";

export interface AnswerQualityMetricsSnapshot {
  totalSignals: number;
  counts: Record<AnswerQualityMetricKey, number>;
}

// ---------------------------------------------------------------------------
// STRUCTURED LOGGER
// ---------------------------------------------------------------------------

const LOG_BUFFER: StructuredLogEntry[] = [];
const LOG_BUFFER_MAX = 1_000;
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

let MIN_LOG_LEVEL: LogLevel = "info";

export function setLogLevel(level: LogLevel) {
  MIN_LOG_LEVEL = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[MIN_LOG_LEVEL];
}

function createLogEntry(
  level: LogLevel,
  component: string,
  event: string,
  data: Record<string, unknown> = {},
  extras?: Partial<Pick<StructuredLogEntry, "traceId" | "userId" | "intent" | "model" | "latencyMs">>,
): StructuredLogEntry {
  return {
    timestamp: new Date().toISOString(),
    level,
    component,
    event,
    data,
    ...extras,
  };
}

function emitLog(entry: StructuredLogEntry) {
  // Buffer for retrieval
  if (LOG_BUFFER.length >= LOG_BUFFER_MAX) {
    LOG_BUFFER.shift();
  }
  LOG_BUFFER.push(entry);

  // Structured console output
  const prefix = `[${entry.timestamp}] [${entry.level.toUpperCase()}] [${entry.component}]`;
  const suffix = entry.latencyMs ? ` (${entry.latencyMs}ms)` : "";
  const msg = `${prefix} ${entry.event}${suffix}`;

  switch (entry.level) {
    case "debug":
      console.debug(msg, entry.data);
      break;
    case "info":
      console.log(msg, Object.keys(entry.data).length ? entry.data : "");
      break;
    case "warn":
      console.warn(msg, entry.data);
      break;
    case "error":
    case "fatal":
      console.error(msg, entry.data);
      break;
  }
}

export function log(
  level: LogLevel,
  component: string,
  event: string,
  data: Record<string, unknown> = {},
  extras?: Partial<Pick<StructuredLogEntry, "traceId" | "userId" | "intent" | "model" | "latencyMs">>,
) {
  if (!shouldLog(level)) return;
  emitLog(createLogEntry(level, component, event, data, extras));
}

export function logInfo(component: string, event: string, data?: Record<string, unknown>) {
  log("info", component, event, data);
}

export function logWarn(component: string, event: string, data?: Record<string, unknown>) {
  log("warn", component, event, data);
}

export function logError(component: string, event: string, data?: Record<string, unknown>) {
  log("error", component, event, data);
}

export function logModelCall(
  model: string,
  intent: string,
  success: boolean,
  latencyMs: number,
  data?: Record<string, unknown>,
) {
  log(
    success ? "info" : "warn",
    "ai-engine",
    success ? "model_call_success" : "model_call_failure",
    { model, intent, success, ...data },
    { model, intent, latencyMs },
  );
  recordModelCall(model, intent, "fast", success, latencyMs, data?.heuristicScore as number | undefined);
}

export function logJudgeDecision(
  intent: string,
  winnerModel: string,
  confidence: string,
  reason: string,
  latencyMs: number,
) {
  log("info", "ai-engine", "judge_decision", { intent, winnerModel, confidence, reason }, { intent, latencyMs });
}

export function logSafetyBlock(userId: string, category: string, reason: string) {
  log("warn", "safety-filter", "input_blocked", { userId, category, reason }, { userId });
  incrementIntentMetric("_safety_blocked", "safetyBlockedCount");
}

export function logCacheHit(intent: string, cacheKey: string) {
  log("debug", "ai-engine", "cache_hit", { intent, keyPrefix: cacheKey.slice(0, 30) }, { intent });
}

export function logIntentDetection(
  intent: string,
  confidence: number,
  alternates: Array<{ intent: string; confidence: number }>,
) {
  log("info", "intent-detector", "intent_classified", { intent, confidence, alternates: alternates.slice(0, 3) }, { intent });
}

export function getRecentLogs(count = 100, level?: LogLevel): StructuredLogEntry[] {
  const filtered = level ? LOG_BUFFER.filter((e) => e.level === level) : LOG_BUFFER;
  return filtered.slice(-count);
}

// ---------------------------------------------------------------------------
// METRICS COLLECTION
// ---------------------------------------------------------------------------

const MODEL_METRICS = new Map<string, ModelMetrics>();
const INTENT_METRICS = new Map<string, IntentMetrics>();
const LATENCY_SAMPLES = new Map<string, number[]>();
const LATENCY_SAMPLE_MAX = 200;

const SYSTEM_COUNTERS = {
  totalRequests: 0,
  activeRequests: 0,
  cacheHits: 0,
  cacheMisses: 0,
  safetyBlocks: 0,
  judgeInvocations: 0,
  fallbacks: 0,
  startedAt: Date.now(),
};

const ANSWER_QUALITY_COUNTS: Record<AnswerQualityMetricKey, number> = {
  visible_fallback: 0,
  blocked_good_answer: 0,
  wrong_language: 0,
  stale_live_answer: 0,
  media_grounding_failure: 0,
  ambiguous_contact: 0,
};

function getOrCreateModelMetrics(model: string, intent: string, responseMode: string): ModelMetrics {
  const key = `${model}:${intent}:${responseMode}`;
  let metrics = MODEL_METRICS.get(key);
  if (!metrics) {
    metrics = {
      model,
      intent,
      responseMode,
      totalCalls: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      avgHeuristicScore: 0,
      judgeWinCount: 0,
      lastCalledAt: 0,
      lastSuccessAt: 0,
      lastFailureAt: 0,
    };
    MODEL_METRICS.set(key, metrics);
  }
  return metrics;
}

function getOrCreateIntentMetrics(intent: string): IntentMetrics {
  let metrics = INTENT_METRICS.get(intent);
  if (!metrics) {
    metrics = {
      intent,
      totalQueries: 0,
      avgResponseTimeMs: 0,
      judgeInvokedCount: 0,
      fallbackCount: 0,
      cacheHitCount: 0,
      safetyBlockedCount: 0,
      avgConfidence: 0,
      lastQueryAt: 0,
    };
    INTENT_METRICS.set(intent, metrics);
  }
  return metrics;
}

function addLatencySample(key: string, latencyMs: number) {
  let samples = LATENCY_SAMPLES.get(key);
  if (!samples) {
    samples = [];
    LATENCY_SAMPLES.set(key, samples);
  }
  if (samples.length >= LATENCY_SAMPLE_MAX) {
    samples.shift();
  }
  samples.push(latencyMs);
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function recordModelCall(
  model: string,
  intent: string,
  responseMode: string,
  success: boolean,
  latencyMs: number,
  heuristicScore?: number,
) {
  const metrics = getOrCreateModelMetrics(model, intent, responseMode);
  metrics.totalCalls += 1;
  metrics.lastCalledAt = Date.now();

  if (success) {
    metrics.successCount += 1;
    metrics.lastSuccessAt = Date.now();
  } else {
    metrics.failureCount += 1;
    metrics.lastFailureAt = Date.now();
  }

  // Rolling average latency
  metrics.avgLatencyMs = metrics.avgLatencyMs + (latencyMs - metrics.avgLatencyMs) / metrics.totalCalls;

  // Latency percentiles
  const sampleKey = `${model}:${intent}:${responseMode}`;
  addLatencySample(sampleKey, latencyMs);
  const samples = [...(LATENCY_SAMPLES.get(sampleKey) ?? [])].sort((a, b) => a - b);
  metrics.p50LatencyMs = percentile(samples, 50);
  metrics.p95LatencyMs = percentile(samples, 95);
  metrics.p99LatencyMs = percentile(samples, 99);

  // Heuristic score average
  if (heuristicScore !== undefined) {
    const prevTotal = metrics.avgHeuristicScore * (metrics.totalCalls - 1);
    metrics.avgHeuristicScore = (prevTotal + heuristicScore) / metrics.totalCalls;
  }
}

export function recordJudgeWin(model: string, intent: string, responseMode: string) {
  const metrics = getOrCreateModelMetrics(model, intent, responseMode);
  metrics.judgeWinCount += 1;
}

export function recordIntentQuery(intent: string, responseTimeMs: number) {
  const metrics = getOrCreateIntentMetrics(intent);
  metrics.totalQueries += 1;
  metrics.lastQueryAt = Date.now();
  metrics.avgResponseTimeMs = metrics.avgResponseTimeMs + (responseTimeMs - metrics.avgResponseTimeMs) / metrics.totalQueries;
  SYSTEM_COUNTERS.totalRequests += 1;
}

function incrementIntentMetric(intent: string, field: keyof IntentMetrics) {
  const metrics = getOrCreateIntentMetrics(intent);
  (metrics as unknown as Record<string, number>)[field] = ((metrics as unknown as Record<string, number>)[field] ?? 0) + 1;
}

export function recordCacheHit(intent: string) {
  incrementIntentMetric(intent, "cacheHitCount");
  SYSTEM_COUNTERS.cacheHits += 1;
}

export function recordCacheMiss(intent: string) {
  SYSTEM_COUNTERS.cacheMisses += 1;
}

export function recordFallback(intent: string) {
  incrementIntentMetric(intent, "fallbackCount");
  SYSTEM_COUNTERS.fallbacks += 1;
}

export function recordJudgeInvocation(intent: string) {
  incrementIntentMetric(intent, "judgeInvokedCount");
  SYSTEM_COUNTERS.judgeInvocations += 1;
}

export function incrementActiveRequests() {
  SYSTEM_COUNTERS.activeRequests += 1;
}

export function decrementActiveRequests() {
  SYSTEM_COUNTERS.activeRequests = Math.max(0, SYSTEM_COUNTERS.activeRequests - 1);
}

export function recordAnswerQualitySignals(flags: string[]) {
  for (const flag of flags) {
    if (flag in ANSWER_QUALITY_COUNTS) {
      ANSWER_QUALITY_COUNTS[flag as AnswerQualityMetricKey] += 1;
    }
  }
}

export function getAnswerQualityMetricsSnapshot(): AnswerQualityMetricsSnapshot {
  const counts = { ...ANSWER_QUALITY_COUNTS };
  const totalSignals = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return {
    totalSignals,
    counts,
  };
}

export function resetAnswerQualityMetricsForTest() {
  for (const key of Object.keys(ANSWER_QUALITY_COUNTS) as AnswerQualityMetricKey[]) {
    ANSWER_QUALITY_COUNTS[key] = 0;
  }
}

// ---------------------------------------------------------------------------
// HEALTH SNAPSHOT — full system status
// ---------------------------------------------------------------------------

export function getSystemHealthSnapshot(
  cacheSize: number,
  modelHealthMap: Map<string, { consecutiveFailures: number; cooldownUntil: number }>,
): SystemHealthSnapshot {
  const now = Date.now();
  const totalCache = SYSTEM_COUNTERS.cacheHits + SYSTEM_COUNTERS.cacheMisses;

  const intentDist: Record<string, number> = {};
  for (const [intent, metrics] of INTENT_METRICS) {
    intentDist[intent] = metrics.totalQueries;
  }

  const modelHealth: SystemHealthSnapshot["modelHealthSummary"] = [];
  const seen = new Set<string>();
  for (const [key, state] of modelHealthMap) {
    const model = key.split(":").pop() ?? key;
    if (seen.has(model)) continue;
    seen.add(model);
    modelHealth.push({
      model,
      healthy: state.cooldownUntil <= now,
      consecutiveFailures: state.consecutiveFailures,
    });
  }

  let totalSuccess = 0;
  let totalFail = 0;
  for (const metrics of MODEL_METRICS.values()) {
    totalSuccess += metrics.successCount;
    totalFail += metrics.failureCount;
  }
  const totalCalls = totalSuccess + totalFail;

  return {
    uptime: now - SYSTEM_COUNTERS.startedAt,
    totalRequests: SYSTEM_COUNTERS.totalRequests,
    activeRequests: SYSTEM_COUNTERS.activeRequests,
    cacheSize,
    cacheHitRate: totalCache > 0 ? SYSTEM_COUNTERS.cacheHits / totalCache : 0,
    avgResponseTimeMs: computeGlobalAvgResponseTime(),
    modelHealthSummary: modelHealth,
    intentDistribution: intentDist,
    errorRate: totalCalls > 0 ? totalFail / totalCalls : 0,
    lastResetAt: SYSTEM_COUNTERS.startedAt,
  };
}

function computeGlobalAvgResponseTime(): number {
  let total = 0;
  let count = 0;
  for (const metrics of INTENT_METRICS.values()) {
    total += metrics.avgResponseTimeMs * metrics.totalQueries;
    count += metrics.totalQueries;
  }
  return count > 0 ? total / count : 0;
}

// ---------------------------------------------------------------------------
// MODEL PERFORMANCE LEADERBOARD — which models win per intent
// ---------------------------------------------------------------------------

export function getModelLeaderboard(intent?: string): Array<{
  model: string;
  intent: string;
  successRate: number;
  avgLatencyMs: number;
  avgScore: number;
  judgeWinRate: number;
  totalCalls: number;
}> {
  const entries: ReturnType<typeof getModelLeaderboard> = [];

  for (const metrics of MODEL_METRICS.values()) {
    if (intent && metrics.intent !== intent) continue;
    if (metrics.totalCalls < 1) continue;

    entries.push({
      model: metrics.model,
      intent: metrics.intent,
      successRate: metrics.totalCalls > 0 ? metrics.successCount / metrics.totalCalls : 0,
      avgLatencyMs: Math.round(metrics.avgLatencyMs),
      avgScore: Math.round(metrics.avgHeuristicScore * 100) / 100,
      judgeWinRate: metrics.successCount > 0 ? metrics.judgeWinCount / metrics.successCount : 0,
      totalCalls: metrics.totalCalls,
    });
  }

  return entries.sort((a, b) => {
    // Sort by success rate, then judge win rate, then score
    const successDiff = b.successRate - a.successRate;
    if (Math.abs(successDiff) > 0.05) return successDiff;
    const winDiff = b.judgeWinRate - a.judgeWinRate;
    if (Math.abs(winDiff) > 0.05) return winDiff;
    return b.avgScore - a.avgScore;
  });
}

// ---------------------------------------------------------------------------
// TRACE ID GENERATION
// ---------------------------------------------------------------------------

let traceCounter = 0;
export function generateTraceId(): string {
  traceCounter += 1;
  return `cc-${Date.now().toString(36)}-${traceCounter.toString(36)}`;
}
