// lib/clawcloud-ai-metrics.ts
// -----------------------------------------------------------------------------
// AI MODEL HEALTH METRICS
//
// Collects per-model latency, timeout, and success/failure data to enable
// proactive optimization and alerting. Metrics are stored in-process and
// exposed via getAiModelMetricsSnapshot() for dashboards or health endpoints.
//
// Key capabilities:
//   - Track latency percentiles (p50, p95, p99) per model
//   - Log timeout patterns with model + intent context
//   - Alert when a model exceeds the latency threshold
//   - Enable future optimization by surfacing slow models early
// -----------------------------------------------------------------------------

import type { IntentType, ResponseMode } from "@/lib/clawcloud-ai";

export type AiModelMetricEvent = {
  model: string;
  intent: IntentType;
  responseMode: ResponseMode;
  latencyMs: number;
  success: boolean;
  timedOut: boolean;
};

type ModelMetricBucket = {
  model: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  totalLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  latencySamples: number[]; // Rolling window of last N samples for percentile calc
  lastUpdatedAt: number;
  lastTimeoutAt: number | null;
  consecutiveTimeouts: number;
};

// Maximum latency samples to keep per model for percentile calculations
const MAX_LATENCY_SAMPLES = 100;

// Alert threshold: log a warning when p95 latency exceeds this value (ms)
const LATENCY_ALERT_THRESHOLD_MS = 30_000;

// Alert threshold: log a warning when timeout rate exceeds this fraction
const TIMEOUT_RATE_ALERT_THRESHOLD = 0.5;

// Minimum requests before alerting on timeout rate
const MIN_REQUESTS_FOR_ALERT = 5;

const metrics = new Map<string, ModelMetricBucket>();

function getBucket(model: string): ModelMetricBucket {
  const existing = metrics.get(model);
  if (existing) return existing;

  const bucket: ModelMetricBucket = {
    model,
    totalRequests: 0,
    successCount: 0,
    failureCount: 0,
    timeoutCount: 0,
    totalLatencyMs: 0,
    minLatencyMs: Number.POSITIVE_INFINITY,
    maxLatencyMs: 0,
    latencySamples: [],
    lastUpdatedAt: Date.now(),
    lastTimeoutAt: null,
    consecutiveTimeouts: 0,
  };
  metrics.set(model, bucket);
  return bucket;
}

function computePercentile(sortedSamples: number[], percentile: number): number {
  if (!sortedSamples.length) return 0;
  const index = Math.ceil((percentile / 100) * sortedSamples.length) - 1;
  return sortedSamples[Math.max(0, Math.min(index, sortedSamples.length - 1))] ?? 0;
}

function checkAndLogAlerts(bucket: ModelMetricBucket): void {
  if (bucket.totalRequests < MIN_REQUESTS_FOR_ALERT) return;

  // Timeout rate alert
  const timeoutRate = bucket.timeoutCount / bucket.totalRequests;
  if (timeoutRate >= TIMEOUT_RATE_ALERT_THRESHOLD) {
    console.warn(
      `[ai-metrics] ALERT: ${bucket.model} timeout rate ${(timeoutRate * 100).toFixed(1)}% ` +
      `(${bucket.timeoutCount}/${bucket.totalRequests} requests) — consider circuit breaker`,
    );
  }

  // Latency alert (p95)
  if (bucket.latencySamples.length >= 10) {
    const sorted = [...bucket.latencySamples].sort((a, b) => a - b);
    const p95 = computePercentile(sorted, 95);
    if (p95 >= LATENCY_ALERT_THRESHOLD_MS) {
      console.warn(
        `[ai-metrics] ALERT: ${bucket.model} p95 latency ${p95}ms exceeds threshold ${LATENCY_ALERT_THRESHOLD_MS}ms`,
      );
    }
  }

  // Consecutive timeout alert
  if (bucket.consecutiveTimeouts >= 3) {
    console.error(
      `[ai-metrics] CRITICAL: ${bucket.model} has ${bucket.consecutiveTimeouts} consecutive timeouts — ` +
      `circuit breaker should be open`,
    );
  }
}

/**
 * Record a metric event for a model inference call.
 * Called after every model attempt (success or failure) in the AI engine.
 */
export function recordAiModelMetric(event: AiModelMetricEvent): void {
  const bucket = getBucket(event.model);

  bucket.totalRequests += 1;
  bucket.lastUpdatedAt = Date.now();

  if (event.success) {
    bucket.successCount += 1;
    bucket.consecutiveTimeouts = 0;
  } else {
    bucket.failureCount += 1;
  }

  if (event.timedOut) {
    bucket.timeoutCount += 1;
    bucket.lastTimeoutAt = Date.now();
    bucket.consecutiveTimeouts += 1;
    console.warn(
      `[ai-metrics] timeout: ${event.model} intent=${event.intent} mode=${event.responseMode} ` +
      `latency=${event.latencyMs}ms (consecutive=${bucket.consecutiveTimeouts})`,
    );
  }

  if (event.latencyMs > 0) {
    bucket.totalLatencyMs += event.latencyMs;
    bucket.minLatencyMs = Math.min(bucket.minLatencyMs, event.latencyMs);
    bucket.maxLatencyMs = Math.max(bucket.maxLatencyMs, event.latencyMs);

    // Rolling window — keep last MAX_LATENCY_SAMPLES
    bucket.latencySamples.push(event.latencyMs);
    if (bucket.latencySamples.length > MAX_LATENCY_SAMPLES) {
      bucket.latencySamples.shift();
    }
  }

  checkAndLogAlerts(bucket);
}

export type AiModelMetricSnapshot = {
  model: string;
  totalRequests: number;
  successCount: number;
  failureCount: number;
  timeoutCount: number;
  successRate: number;
  timeoutRate: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  lastUpdatedAt: number;
  lastTimeoutAt: number | null;
  consecutiveTimeouts: number;
};

/**
 * Get a snapshot of all collected metrics for observability dashboards.
 */
export function getAiModelMetricsSnapshot(): AiModelMetricSnapshot[] {
  return [...metrics.values()].map((bucket) => {
    const sorted = [...bucket.latencySamples].sort((a, b) => a - b);
    const successRate = bucket.totalRequests > 0
      ? bucket.successCount / bucket.totalRequests
      : 0;
    const timeoutRate = bucket.totalRequests > 0
      ? bucket.timeoutCount / bucket.totalRequests
      : 0;
    const avgLatencyMs = bucket.totalRequests > 0
      ? Math.round(bucket.totalLatencyMs / bucket.totalRequests)
      : 0;

    return {
      model: bucket.model,
      totalRequests: bucket.totalRequests,
      successCount: bucket.successCount,
      failureCount: bucket.failureCount,
      timeoutCount: bucket.timeoutCount,
      successRate: Number(successRate.toFixed(4)),
      timeoutRate: Number(timeoutRate.toFixed(4)),
      avgLatencyMs,
      minLatencyMs: bucket.minLatencyMs === Number.POSITIVE_INFINITY ? 0 : bucket.minLatencyMs,
      maxLatencyMs: bucket.maxLatencyMs,
      p50LatencyMs: computePercentile(sorted, 50),
      p95LatencyMs: computePercentile(sorted, 95),
      p99LatencyMs: computePercentile(sorted, 99),
      lastUpdatedAt: bucket.lastUpdatedAt,
      lastTimeoutAt: bucket.lastTimeoutAt,
      consecutiveTimeouts: bucket.consecutiveTimeouts,
    };
  }).sort((a, b) => b.totalRequests - a.totalRequests);
}

/**
 * Get metrics for a specific model.
 */
export function getAiModelMetrics(model: string): AiModelMetricSnapshot | null {
  const bucket = metrics.get(model);
  if (!bucket) return null;

  const sorted = [...bucket.latencySamples].sort((a, b) => a - b);
  const successRate = bucket.totalRequests > 0
    ? bucket.successCount / bucket.totalRequests
    : 0;
  const timeoutRate = bucket.totalRequests > 0
    ? bucket.timeoutCount / bucket.totalRequests
    : 0;
  const avgLatencyMs = bucket.totalRequests > 0
    ? Math.round(bucket.totalLatencyMs / bucket.totalRequests)
    : 0;

  return {
    model: bucket.model,
    totalRequests: bucket.totalRequests,
    successCount: bucket.successCount,
    failureCount: bucket.failureCount,
    timeoutCount: bucket.timeoutCount,
    successRate: Number(successRate.toFixed(4)),
    timeoutRate: Number(timeoutRate.toFixed(4)),
    avgLatencyMs,
    minLatencyMs: bucket.minLatencyMs === Number.POSITIVE_INFINITY ? 0 : bucket.minLatencyMs,
    maxLatencyMs: bucket.maxLatencyMs,
    p50LatencyMs: computePercentile(sorted, 50),
    p95LatencyMs: computePercentile(sorted, 95),
    p99LatencyMs: computePercentile(sorted, 99),
    lastUpdatedAt: bucket.lastUpdatedAt,
    lastTimeoutAt: bucket.lastTimeoutAt,
    consecutiveTimeouts: bucket.consecutiveTimeouts,
  };
}

/**
 * Reset all metrics (for testing).
 */
export function resetAiModelMetrics(): void {
  metrics.clear();
}

/**
 * Log a summary of all model metrics to the console.
 * Useful for periodic health reporting.
 */
export function logAiModelMetricsSummary(): void {
  const snapshot = getAiModelMetricsSnapshot();
  if (!snapshot.length) {
    console.log("[ai-metrics] No model metrics recorded yet.");
    return;
  }

  console.log("[ai-metrics] Model health summary:");
  for (const entry of snapshot) {
    const successPct = (entry.successRate * 100).toFixed(1);
    const timeoutPct = (entry.timeoutRate * 100).toFixed(1);
    console.log(
      `  ${entry.model}: ` +
      `${entry.totalRequests} reqs, ` +
      `${successPct}% success, ` +
      `${timeoutPct}% timeout, ` +
      `avg=${entry.avgLatencyMs}ms p95=${entry.p95LatencyMs}ms`,
    );
  }
}
