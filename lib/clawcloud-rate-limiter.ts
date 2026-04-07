// lib/clawcloud-rate-limiter.ts
// -----------------------------------------------------------------------------
// RATE LIMITER — Per-user, per-intent rate limiting with sliding window
// and cost tracking. Prevents abuse, controls API costs, and ensures fair
// usage across all users.
// -----------------------------------------------------------------------------

export type RateLimitTier = "free" | "starter" | "pro" | "unlimited";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterMs: number;
  tier: RateLimitTier;
  costEstimate: number;
};

export type UserQuota = {
  tier: RateLimitTier;
  requestsPerMinute: number;
  requestsPerHour: number;
  requestsPerDay: number;
  deepModePerDay: number;
  maxConcurrent: number;
  maxTokensPerRequest: number;
};

// ---------------------------------------------------------------------------
// TIER QUOTAS
// ---------------------------------------------------------------------------

const TIER_QUOTAS: Record<RateLimitTier, UserQuota> = {
  free: {
    tier: "free",
    requestsPerMinute: 8,
    requestsPerHour: 60,
    requestsPerDay: 200,
    deepModePerDay: 20,
    maxConcurrent: 2,
    maxTokensPerRequest: 2_000,
  },
  starter: {
    tier: "starter",
    requestsPerMinute: 15,
    requestsPerHour: 200,
    requestsPerDay: 1_000,
    deepModePerDay: 100,
    maxConcurrent: 4,
    maxTokensPerRequest: 4_000,
  },
  pro: {
    tier: "pro",
    requestsPerMinute: 30,
    requestsPerHour: 500,
    requestsPerDay: 5_000,
    deepModePerDay: 500,
    maxConcurrent: 8,
    maxTokensPerRequest: 6_000,
  },
  unlimited: {
    tier: "unlimited",
    requestsPerMinute: 100,
    requestsPerHour: 2_000,
    requestsPerDay: 50_000,
    deepModePerDay: 10_000,
    maxConcurrent: 20,
    maxTokensPerRequest: 8_000,
  },
};

// ---------------------------------------------------------------------------
// SLIDING WINDOW TRACKER
// ---------------------------------------------------------------------------

type WindowEntry = {
  timestamps: number[];
  concurrent: number;
  deepCount: number;
  deepResetAt: number;
  costAccumulator: number;
};

const USER_WINDOWS = new Map<string, WindowEntry>();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 min
let lastCleanup = Date.now();

function getUserWindow(userId: string): WindowEntry {
  let entry = USER_WINDOWS.get(userId);
  if (!entry) {
    entry = {
      timestamps: [],
      concurrent: 0,
      deepCount: 0,
      deepResetAt: getNextDayReset(),
      costAccumulator: 0,
    };
    USER_WINDOWS.set(userId, entry);
  }
  return entry;
}

function getNextDayReset(): number {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return tomorrow.getTime();
}

function pruneOldTimestamps(entry: WindowEntry) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000; // Keep 24h
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
}

function cleanupStaleEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const staleThreshold = 30 * 60 * 1000; // 30 min inactive
  for (const [userId, entry] of USER_WINDOWS) {
    const lastActivity = entry.timestamps.length ? entry.timestamps[entry.timestamps.length - 1] : 0;
    if (now - lastActivity > staleThreshold && entry.concurrent === 0) {
      USER_WINDOWS.delete(userId);
    }
  }
}

// ---------------------------------------------------------------------------
// COST ESTIMATION — approximate API cost per request
// ---------------------------------------------------------------------------

const MODEL_COST_PER_1K_TOKENS: Record<string, number> = {
  // OpenAI GPT-5 models
  "gpt-5.4-nano": 0.0001,
  "gpt-5.4-mini": 0.0004,
  "gpt-5.4": 0.0030,
  "gpt-5.4-pro": 0.0060,
  "gpt-5.2-pro": 0.0050,
  "gpt-5.2": 0.0025,
  "gpt-5-pro": 0.0040,
  "gpt-5": 0.0020,
  // NVIDIA models
  "google/gemma-2-27b-it": 0.0004,
  "meta/llama-4-maverick-17b-128e-instruct": 0.0008,
  "meta/llama3-8b-instruct": 0.0001,
  "mistralai/mistral-small-3.1-24b-instruct-2503": 0.0007,
  "qwen/qwen3-next-80b-a3b-instruct": 0.0012,
  "qwen/qwen3.5-397b-a17b": 0.0015,
  "deepseek-ai/deepseek-v3.1": 0.0013,
  "deepseek-ai/deepseek-v3.1-terminus": 0.0014,
  "qwen/qwen2.5-coder-32b-instruct": 0.0008,
  "qwen/qwen3-coder-480b-a35b-instruct": 0.0016,
  default: 0.0010,
};

export function estimateRequestCost(
  models: string[],
  estimatedTokens: number,
  parallelism: number,
): number {
  let totalCost = 0;
  const modelsUsed = Math.min(models.length, parallelism);

  for (let i = 0; i < modelsUsed; i++) {
    const model = models[i];
    const costPer1k = MODEL_COST_PER_1K_TOKENS[model] ?? MODEL_COST_PER_1K_TOKENS["default"];
    totalCost += costPer1k * (estimatedTokens / 1_000);
  }

  return Math.round(totalCost * 10_000) / 10_000; // 4 decimal places
}

// ---------------------------------------------------------------------------
// MAIN RATE LIMIT CHECK
// ---------------------------------------------------------------------------

export function checkRateLimit(
  userId: string,
  tier: RateLimitTier,
  isDeepMode: boolean = false,
): RateLimitResult {
  cleanupStaleEntries();

  const quota = TIER_QUOTAS[tier] ?? TIER_QUOTAS.free;
  const entry = getUserWindow(userId);
  pruneOldTimestamps(entry);

  const now = Date.now();

  // Reset daily deep count if new day
  if (now >= entry.deepResetAt) {
    entry.deepCount = 0;
    entry.deepResetAt = getNextDayReset();
  }

  // Check concurrent limit
  if (entry.concurrent >= quota.maxConcurrent) {
    return {
      allowed: false,
      remaining: 0,
      limit: quota.maxConcurrent,
      resetAt: now + 5_000,
      retryAfterMs: 5_000,
      tier,
      costEstimate: 0,
    };
  }

  // Check per-minute limit
  const oneMinuteAgo = now - 60_000;
  const recentMinute = entry.timestamps.filter((t) => t > oneMinuteAgo).length;
  if (recentMinute >= quota.requestsPerMinute) {
    const oldestInWindow = entry.timestamps.find((t) => t > oneMinuteAgo) ?? now;
    const retryAfter = oldestInWindow + 60_000 - now;
    return {
      allowed: false,
      remaining: 0,
      limit: quota.requestsPerMinute,
      resetAt: oldestInWindow + 60_000,
      retryAfterMs: Math.max(retryAfter, 1_000),
      tier,
      costEstimate: 0,
    };
  }

  // Check per-hour limit
  const oneHourAgo = now - 3_600_000;
  const recentHour = entry.timestamps.filter((t) => t > oneHourAgo).length;
  if (recentHour >= quota.requestsPerHour) {
    const oldestInWindow = entry.timestamps.find((t) => t > oneHourAgo) ?? now;
    const retryAfter = oldestInWindow + 3_600_000 - now;
    return {
      allowed: false,
      remaining: 0,
      limit: quota.requestsPerHour,
      resetAt: oldestInWindow + 3_600_000,
      retryAfterMs: Math.max(retryAfter, 1_000),
      tier,
      costEstimate: 0,
    };
  }

  // Check per-day limit
  const oneDayAgo = now - 86_400_000;
  const recentDay = entry.timestamps.filter((t) => t > oneDayAgo).length;
  if (recentDay >= quota.requestsPerDay) {
    return {
      allowed: false,
      remaining: 0,
      limit: quota.requestsPerDay,
      resetAt: entry.deepResetAt,
      retryAfterMs: entry.deepResetAt - now,
      tier,
      costEstimate: 0,
    };
  }

  // Check deep mode daily limit
  if (isDeepMode && entry.deepCount >= quota.deepModePerDay) {
    return {
      allowed: false,
      remaining: 0,
      limit: quota.deepModePerDay,
      resetAt: entry.deepResetAt,
      retryAfterMs: entry.deepResetAt - now,
      tier,
      costEstimate: 0,
    };
  }

  // Allowed — record the request
  entry.timestamps.push(now);
  if (isDeepMode) {
    entry.deepCount += 1;
  }

  const remainingMinute = quota.requestsPerMinute - recentMinute - 1;
  const remainingHour = quota.requestsPerHour - recentHour - 1;
  const remainingDay = quota.requestsPerDay - recentDay - 1;

  return {
    allowed: true,
    remaining: Math.min(remainingMinute, remainingHour, remainingDay),
    limit: quota.requestsPerDay,
    resetAt: entry.deepResetAt,
    retryAfterMs: 0,
    tier,
    costEstimate: 0,
  };
}

// ---------------------------------------------------------------------------
// CONCURRENT REQUEST TRACKING
// ---------------------------------------------------------------------------

export function acquireConcurrencySlot(userId: string): boolean {
  const entry = getUserWindow(userId);
  // No hard block — just track
  entry.concurrent += 1;
  return true;
}

export function releaseConcurrencySlot(userId: string) {
  const entry = USER_WINDOWS.get(userId);
  if (entry) {
    entry.concurrent = Math.max(0, entry.concurrent - 1);
  }
}

// ---------------------------------------------------------------------------
// COST TRACKING
// ---------------------------------------------------------------------------

export function recordRequestCost(userId: string, cost: number) {
  const entry = getUserWindow(userId);
  entry.costAccumulator += cost;
}

export function getUserCostToday(userId: string): number {
  const entry = USER_WINDOWS.get(userId);
  if (!entry) return 0;
  return Math.round(entry.costAccumulator * 10_000) / 10_000;
}

// ---------------------------------------------------------------------------
// ADMIN — get rate limit status for a user
// ---------------------------------------------------------------------------

export function getUserRateLimitStatus(userId: string, tier: RateLimitTier): {
  tier: RateLimitTier;
  quota: UserQuota;
  currentMinute: number;
  currentHour: number;
  currentDay: number;
  deepModeUsed: number;
  concurrent: number;
  costToday: number;
} {
  const quota = TIER_QUOTAS[tier] ?? TIER_QUOTAS.free;
  const entry = getUserWindow(userId);
  pruneOldTimestamps(entry);

  const now = Date.now();
  return {
    tier,
    quota,
    currentMinute: entry.timestamps.filter((t) => t > now - 60_000).length,
    currentHour: entry.timestamps.filter((t) => t > now - 3_600_000).length,
    currentDay: entry.timestamps.filter((t) => t > now - 86_400_000).length,
    deepModeUsed: entry.deepCount,
    concurrent: entry.concurrent,
    costToday: Math.round(entry.costAccumulator * 10_000) / 10_000,
  };
}
