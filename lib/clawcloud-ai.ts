// lib/clawcloud-ai.ts
// -----------------------------------------------------------------------------
// MODEL-ROUTED AI ENGINE
// Strongest-first frontier model routing with automatic fallback.
//
// GLOBAL QUALITY PROFILE
// A single ranked model list can drive every intent so the app always tries the
// strongest model first, falls forward instantly on failure, and promotes
// higher-ranked models back to the front after a cooldown.
//
// Set these in env vars when you want explicit routing:
//   NVIDIA_CHAT_MODEL      = meta/llama-4-maverick-17b-128e-instruct
//   NVIDIA_GLOBAL_MODELS   = meta/llama-4-maverick-17b-128e-instruct,qwen/qwen3.5-397b-a17b,...
// -----------------------------------------------------------------------------

import { env } from "@/lib/env";
import type { ClawCloudModelAuditTrail } from "@/lib/types";
import { screenInput, screenOutput, buildSafeRefusal, sanitizeOutput } from "@/lib/clawcloud-safety-filter";
import { logSafetyBlock, logCacheHit, logInfo, logWarn, recordIntentQuery, recordCacheHit, recordCacheMiss, recordFallback, incrementActiveRequests, decrementActiveRequests, generateTraceId } from "@/lib/clawcloud-observability";
import { recordModelPerformance, reorderModelsByPerformance, getAdaptiveTimeout } from "@/lib/clawcloud-model-health-persistence";

export type IntentType =
  | "greeting"
  | "help"
  | "memory"
  | "general"
  | "coding"
  | "math"
  | "email"
  | "reminder"
  | "send_message"
  | "save_contact"
  | "calendar"
  | "spending"
  | "finance"
  | "web_search"
  | "research"
  | "creative"
  | "science"
  | "history"
  | "geography"
  | "health"
  | "law"
  | "economics"
  | "culture"
  | "sports"
  | "technology"
  | "language"
  | "explain";

export type ResponseMode = "fast" | "deep";

type ModelTier = "fast" | "chat" | "reasoning" | "code";
type ModelCandidate = {
  model: string;
  timeoutMs: number;
  tier: ModelTier;
  healthKey: string;
};
type ModelHealthState = {
  consecutiveFailures: number;
  cooldownUntil: number;
  lastFailureAt: number;
  lastSuccessAt: number;
};

// Live-benchmarked 2026-04-07. Stable production routing is enforced below by
// filtering failed GPT/gemma/llama3 families out of active rotation.
const GLOBAL_TOP_MODELS = [
  // ── Tier 0: GPT-5 flagships — most advanced AI models available ──
  "gpt-5.4-pro",                                   //  flagship pro — best accuracy
  "gpt-5.4",                                       //  latest flagship
  "gpt-5.4-mini",                                  //  latest mini — fast + strong
  "gpt-5.2-pro",                                   //  strong pro
  "gpt-5.2",                                       //  strong flagship
  "gpt-5-pro",                                     //  proven pro
  "gpt-5",                                         //  proven flagship
  // ── Tier 1: NVIDIA ultra-fast frontier (sub-1.5s) ──
  "google/gemma-2-27b-it",                         //  1.0s  fast general
  "meta/llama-4-maverick-17b-128e-instruct",       //  1.1s  latest Meta, strong all-domain
  "meta/llama3-8b-instruct",                       //  1.1s  ultra-fast lightweight
  "mistralai/mistral-small-3.1-24b-instruct-2503", //  1.1s  fast + accurate
  "deepseek-ai/deepseek-v3.1-terminus",            //  1.2s  fast reasoning
  "qwen/qwen2.5-coder-32b-instruct",              //  1.3s  code specialist
  "qwen/qwen3-next-80b-a3b-instruct",             //  1.3s  latest Qwen MoE
  "mistralai/mixtral-8x22b-instruct-v0.1",        //  1.4s  strong reasoning
  "qwen/qwen3-coder-480b-a35b-instruct",          //  1.5s  frontier code MoE
  // ── Tier 2: NVIDIA fast + strong (sub-2.5s) ──
  "deepseek-ai/deepseek-v3.1",                     //  1.8s  strong general
  "deepseek-ai/deepseek-v3.1",                     //  1.8s  strong general
  "qwen/qwen3.5-397b-a17b",                        //  1.9s  frontier MoE all-domain
  "qwen/qwen2.5-coder-32b-instruct",               //  2.0s  code specialist
  "deepseek-ai/deepseek-v3.1-terminus",             //  2.0s  strong general
  "qwen/qwen3-coder-480b-a35b-instruct",           //  2.1s  frontier code MoE
  "qwen/qwen3.5-397b-a17b",                        //  2.2s  frontier MoE all-domain
  "qwen/qwen3-next-80b-a3b-instruct",              //  2.3s  latest Qwen MoE
  "mistralai/mixtral-8x22b-instruct-v0.1",         //  2.5s  strong reasoning
  // ── Last resort: GPT cheap fallback ──
  "gpt-5.4-nano",                                  //  cheapest GPT, ultra-fast
] as const;

const ACTIVE_STABLE_ROUTE_MODELS = [
  "meta/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3.5-397b-a17b",
  "deepseek-ai/deepseek-v3.1",
  "deepseek-ai/deepseek-v3.1-terminus",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "qwen/qwen3-next-80b-a3b-instruct",
  "mistralai/mixtral-8x22b-instruct-v0.1",
  "qwen/qwen3-coder-480b-a35b-instruct",
  "qwen/qwen2.5-coder-32b-instruct",
] as const;

const DEPRECATED_ROUTE_MODEL_PATTERNS = [
  /^gpt-5/i,
  /^google\/gemma-2-27b-it$/i,
  /^mistralai\/mistral-large-3/i,
  /^moonshotai\/kimi-k2/i,
  /^meta\/llama-3\./i,
  /^meta\/llama3-8b-instruct$/i,
  /^nvidia\/llama/i,
  /^qwen\/qwen2\.5-7b/i,
  /^z-ai\/glm/i,
  /^deepseek-ai\/deepseek-v3\.2$/i,
];

const MODEL_HEALTH = new Map<string, ModelHealthState>();
const MODEL_FAILURE_COOLDOWN_MS = 45_000;
const MODEL_FAILURE_MAX_COOLDOWN_MS = 8 * 60 * 1000;

// Per-model timeout — reduced to fail fast and move to the next model quickly
const INTENT_TIMEOUT_MS: Record<IntentType, number> = {
  greeting: 5_000,
  help: 5_000,
  memory: 5_000,
  reminder: 5_000,
  send_message: 6_000,
  save_contact: 5_000,
  calendar: 6_000,
  general: 8_000,
  email: 8_000,
  spending: 8_000,
  finance: 10_000,
  web_search: 10_000,
  creative: 8_000,
  coding: 14_000,
  math: 10_000,
  research: 10_000,
  science: 8_000,
  history: 8_000,
  geography: 8_000,
  health: 8_000,
  law: 8_000,
  economics: 8_000,
  culture: 8_000,
  sports: 8_000,
  technology: 8_000,
  language: 8_000,
  explain: 8_000,
};

// Parallelism 2 for all knowledge intents — race two models to beat NVIDIA timeouts
const INTENT_PARALLELISM: Record<IntentType, number> = {
  greeting: 1,
  help: 1,
  memory: 1,
  reminder: 1,
  send_message: 1,
  save_contact: 1,
  calendar: 1,
  general: 2,
  email: 2,
  spending: 2,
  finance: 2,
  web_search: 2,
  creative: 2,
  coding: 2,
  math: 4,
  research: 2,
  science: 2,
  history: 2,
  geography: 2,
  health: 2,
  law: 2,
  economics: 2,
  culture: 2,
  sports: 2,
  technology: 2,
  language: 2,
  explain: 2,
};

const INTENT_MAX_TOTAL_MS: Record<IntentType, number> = {
  greeting: 8_000,
  help: 8_000,
  memory: 8_000,
  reminder: 8_000,
  send_message: 10_000,
  save_contact: 10_000,
  calendar: 10_000,
  general: 20_000,
  email: 16_000,
  spending: 16_000,
  finance: 22_000,
  web_search: 25_000,
  creative: 20_000,
  coding: 28_000,
  math: 22_000,
  research: 22_000,
  science: 20_000,
  history: 16_000,
  geography: 12_000,
  health: 20_000,
  law: 20_000,
  economics: 20_000,
  culture: 14_000,
  sports: 12_000,
  technology: 20_000,
  language: 12_000,
  explain: 22_000,
};

const INTENT_CANDIDATE_LIMIT: Record<IntentType, number> = {
  greeting: 1,
  help: 1,
  memory: 1,
  reminder: 1,
  send_message: 1,
  save_contact: 1,
  calendar: 1,
  general: 4,
  email: 2,
  spending: 2,
  finance: 2,
  web_search: 2,
  creative: 2,
  coding: 3,
  math: 2,
  research: 2,
  science: 4,
  history: 4,
  geography: 3,
  health: 4,
  law: 4,
  economics: 4,
  culture: 2,
  sports: 2,
  technology: 4,
  language: 4,
  explain: 4,
};

const INTENT_HISTORY_LIMIT: Record<IntentType, number> = {
  greeting: 4,
  help: 4,
  memory: 5,
  reminder: 4,
  send_message: 4,
  save_contact: 4,
  calendar: 4,
  general: 6,
  email: 5,
  spending: 5,
  finance: 6,
  web_search: 6,
  creative: 5,
  coding: 7,
  math: 6,
  research: 7,
  science: 6,
  history: 6,
  geography: 5,
  health: 6,
  law: 6,
  economics: 6,
  culture: 5,
  sports: 5,
  technology: 6,
  language: 5,
  explain: 6,
};

const INTENT_HISTORY_CHAR_LIMIT: Record<IntentType, number> = {
  greeting: 280,
  help: 280,
  memory: 340,
  reminder: 300,
  send_message: 340,
  save_contact: 320,
  calendar: 340,
  general: 520,
  email: 480,
  spending: 460,
  finance: 520,
  web_search: 520,
  creative: 460,
  coding: 560,
  math: 500,
  research: 560,
  science: 520,
  history: 500,
  geography: 440,
  health: 520,
  law: 520,
  economics: 520,
  culture: 460,
  sports: 400,
  technology: 520,
  language: 440,
  explain: 520,
};

function buildIntentPriority(models: string[]) {
  return filterDeprecatedRouteModels(uniqueModels(models));
}

const FAST_OPERATIONAL_MODEL_PRIORITY = buildIntentPriority([
  "meta/llama-4-maverick-17b-128e-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "deepseek-ai/deepseek-v3.1-terminus",
  "qwen/qwen3-next-80b-a3b-instruct",
  "deepseek-ai/deepseek-v3.1",
  "qwen/qwen3.5-397b-a17b",
  "mistralai/mixtral-8x22b-instruct-v0.1",
]);

const GENERAL_MODEL_PRIORITY = buildIntentPriority([
  "meta/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3.5-397b-a17b",
  "deepseek-ai/deepseek-v3.1",
  "deepseek-ai/deepseek-v3.1-terminus",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "qwen/qwen3-next-80b-a3b-instruct",
  "mistralai/mixtral-8x22b-instruct-v0.1",
  "qwen/qwen3-coder-480b-a35b-instruct",
  "qwen/qwen2.5-coder-32b-instruct",
]);

const REASONING_MODEL_PRIORITY = buildIntentPriority([
  "qwen/qwen3.5-397b-a17b",
  "deepseek-ai/deepseek-v3.1",
  "deepseek-ai/deepseek-v3.1-terminus",
  "meta/llama-4-maverick-17b-128e-instruct",
  "mistralai/mixtral-8x22b-instruct-v0.1",
  "qwen/qwen3-next-80b-a3b-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
]);

const MATH_MODEL_PRIORITY = buildIntentPriority([
  "meta/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3.5-397b-a17b",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "deepseek-ai/deepseek-v3.1-terminus",
  "deepseek-ai/deepseek-v3.1",
  "mistralai/mixtral-8x22b-instruct-v0.1",
  "qwen/qwen3-next-80b-a3b-instruct",
]);

// Fast coding traffic on WhatsApp needs lower latency than deep coding review
// mode. Keep the fast lane biased toward the most reliable sub-2s models, and
// reserve the largest coder-heavy route for deep mode where longer waits are
// acceptable.
const FAST_CODE_MODEL_PRIORITY = buildIntentPriority([
  "meta/llama-4-maverick-17b-128e-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "deepseek-ai/deepseek-v3.1-terminus",
  "qwen/qwen2.5-coder-32b-instruct",
  "qwen/qwen3-next-80b-a3b-instruct",
  "deepseek-ai/deepseek-v3.1",
  "qwen/qwen3.5-397b-a17b",
  "qwen/qwen3-coder-480b-a35b-instruct",
]);

const DEEP_CODE_MODEL_PRIORITY = buildIntentPriority([
  "qwen/qwen3-coder-480b-a35b-instruct",
  "qwen/qwen2.5-coder-32b-instruct",
  "deepseek-ai/deepseek-v3.1",
  "qwen/qwen3.5-397b-a17b",
  "meta/llama-4-maverick-17b-128e-instruct",
  "deepseek-ai/deepseek-v3.1-terminus",
  "qwen/qwen3-next-80b-a3b-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
]);

const LANGUAGE_MODEL_PRIORITY = buildIntentPriority([
  "qwen/qwen3.5-397b-a17b",
  "meta/llama-4-maverick-17b-128e-instruct",
  "deepseek-ai/deepseek-v3.1",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "qwen/qwen3-next-80b-a3b-instruct",
  "deepseek-ai/deepseek-v3.1-terminus",
  "mistralai/mixtral-8x22b-instruct-v0.1",
]);

const INTENT_PREFERRED_MODELS: Record<IntentType, string[]> = {
  greeting: FAST_OPERATIONAL_MODEL_PRIORITY,
  help: FAST_OPERATIONAL_MODEL_PRIORITY,
  memory: FAST_OPERATIONAL_MODEL_PRIORITY,
  reminder: FAST_OPERATIONAL_MODEL_PRIORITY,
  send_message: FAST_OPERATIONAL_MODEL_PRIORITY,
  save_contact: FAST_OPERATIONAL_MODEL_PRIORITY,
  calendar: FAST_OPERATIONAL_MODEL_PRIORITY,
  general: GENERAL_MODEL_PRIORITY,
  coding: FAST_CODE_MODEL_PRIORITY,
  math: MATH_MODEL_PRIORITY,
  email: GENERAL_MODEL_PRIORITY,
  spending: REASONING_MODEL_PRIORITY,
  finance: REASONING_MODEL_PRIORITY,
  web_search: REASONING_MODEL_PRIORITY,
  research: REASONING_MODEL_PRIORITY,
  creative: GENERAL_MODEL_PRIORITY,
  science: REASONING_MODEL_PRIORITY,
  history: GENERAL_MODEL_PRIORITY,
  geography: GENERAL_MODEL_PRIORITY,
  health: REASONING_MODEL_PRIORITY,
  law: REASONING_MODEL_PRIORITY,
  economics: REASONING_MODEL_PRIORITY,
  culture: GENERAL_MODEL_PRIORITY,
  sports: GENERAL_MODEL_PRIORITY,
  technology: REASONING_MODEL_PRIORITY,
  language: LANGUAGE_MODEL_PRIORITY,
  explain: LANGUAGE_MODEL_PRIORITY,
};

const DEEP_INTENT_TIMEOUT_MS: Record<IntentType, number> = {
  greeting: 7_000,
  help: 7_000,
  memory: 7_000,
  reminder: 7_000,
  send_message: 9_000,
  save_contact: 8_000,
  calendar: 10_000,
  general: 20_000,
  email: 18_000,
  spending: 18_000,
  finance: 25_000,
  web_search: 25_000,
  creative: 20_000,
  coding: 30_000,
  math: 22_000,
  research: 25_000,
  science: 20_000,
  history: 18_000,
  geography: 15_000,
  health: 20_000,
  law: 20_000,
  economics: 20_000,
  culture: 18_000,
  sports: 15_000,
  technology: 20_000,
  language: 15_000,
  explain: 22_000,
};

const DEEP_INTENT_PARALLELISM: Record<IntentType, number> = {
  greeting: 1,
  help: 1,
  memory: 1,
  reminder: 1,
  send_message: 1,
  save_contact: 1,
  calendar: 1,
  general: 1,
  email: 2,
  spending: 2,
  finance: 3,
  web_search: 3,
  creative: 2,
  coding: 4,
  math: 3,
  research: 3,
  science: 2,
  history: 2,
  geography: 2,
  health: 2,
  law: 2,
  economics: 2,
  culture: 2,
  sports: 2,
  technology: 2,
  language: 1,
  explain: 1,
};

const DEEP_INTENT_MAX_TOTAL_MS: Record<IntentType, number> = {
  greeting: 10_000,
  help: 10_000,
  memory: 10_000,
  reminder: 10_000,
  send_message: 12_000,
  save_contact: 12_000,
  calendar: 12_000,
  general: 30_000,
  email: 25_000,
  spending: 25_000,
  finance: 35_000,
  web_search: 35_000,
  creative: 30_000,
  coding: 35_000,
  math: 30_000,
  research: 35_000,
  science: 30_000,
  history: 25_000,
  geography: 20_000,
  health: 30_000,
  law: 30_000,
  economics: 30_000,
  culture: 25_000,
  sports: 20_000,
  technology: 30_000,
  language: 20_000,
  explain: 30_000,
};

const DEEP_INTENT_CANDIDATE_LIMIT: Record<IntentType, number> = {
  greeting: 1,
  help: 1,
  memory: 1,
  reminder: 1,
  send_message: 1,
  save_contact: 1,
  calendar: 1,
  general: 4,
  email: 2,
  spending: 2,
  finance: 3,
  web_search: 3,
  creative: 2,
  coding: 3,
  math: 3,
  research: 3,
  science: 3,
  history: 4,
  geography: 3,
  health: 3,
  law: 3,
  economics: 3,
  culture: 2,
  sports: 2,
  technology: 4,
  language: 4,
  explain: 4,
};

const DEEP_INTENT_HISTORY_LIMIT: Record<IntentType, number> = {
  greeting: 3,
  help: 3,
  memory: 4,
  reminder: 3,
  send_message: 3,
  save_contact: 3,
  calendar: 3,
  general: 6,
  email: 6,
  spending: 6,
  finance: 6,
  web_search: 6,
  creative: 5,
  coding: 8,
  math: 6,
  research: 8,
  science: 6,
  history: 6,
  geography: 5,
  health: 6,
  law: 6,
  economics: 6,
  culture: 5,
  sports: 5,
  technology: 6,
  language: 5,
  explain: 6,
};

const DEEP_INTENT_HISTORY_CHAR_LIMIT: Record<IntentType, number> = {
  greeting: 240,
  help: 240,
  memory: 300,
  reminder: 260,
  send_message: 320,
  save_contact: 300,
  calendar: 320,
  general: 520,
  email: 500,
  spending: 460,
  finance: 600,
  web_search: 600,
  creative: 480,
  coding: 640,
  math: 520,
  research: 640,
  science: 560,
  history: 520,
  geography: 460,
  health: 560,
  law: 560,
  economics: 560,
  culture: 480,
  sports: 440,
  technology: 520,
  language: 440,
  explain: 560,
};

const DEEP_INTENT_PREFERRED_MODELS: Record<IntentType, string[]> = {
  greeting: FAST_OPERATIONAL_MODEL_PRIORITY,
  help: FAST_OPERATIONAL_MODEL_PRIORITY,
  memory: FAST_OPERATIONAL_MODEL_PRIORITY,
  reminder: FAST_OPERATIONAL_MODEL_PRIORITY,
  send_message: FAST_OPERATIONAL_MODEL_PRIORITY,
  save_contact: FAST_OPERATIONAL_MODEL_PRIORITY,
  calendar: FAST_OPERATIONAL_MODEL_PRIORITY,
  general: REASONING_MODEL_PRIORITY,
  coding: DEEP_CODE_MODEL_PRIORITY,
  math: REASONING_MODEL_PRIORITY,
  email: GENERAL_MODEL_PRIORITY,
  spending: REASONING_MODEL_PRIORITY,
  finance: REASONING_MODEL_PRIORITY,
  web_search: REASONING_MODEL_PRIORITY,
  research: REASONING_MODEL_PRIORITY,
  creative: GENERAL_MODEL_PRIORITY,
  science: REASONING_MODEL_PRIORITY,
  history: REASONING_MODEL_PRIORITY,
  geography: GENERAL_MODEL_PRIORITY,
  health: REASONING_MODEL_PRIORITY,
  law: REASONING_MODEL_PRIORITY,
  economics: REASONING_MODEL_PRIORITY,
  culture: GENERAL_MODEL_PRIORITY,
  sports: GENERAL_MODEL_PRIORITY,
  technology: REASONING_MODEL_PRIORITY,
  language: LANGUAGE_MODEL_PRIORITY,
  explain: LANGUAGE_MODEL_PRIORITY,
};

type ProviderAvailability = {
  openai: boolean;
  nvidia: boolean;
};

function resolveProviderAvailability(): ProviderAvailability {
  return {
    openai: Boolean(env.OPENAI_API_KEY),
    nvidia: Boolean(env.NVIDIA_API_KEY),
  };
}

function hasAnyAiProviderConfigured(availability = resolveProviderAvailability()) {
  return availability.openai || availability.nvidia;
}

function filterModelsByConfiguredProviders(
  models: string[],
  availability = resolveProviderAvailability(),
) {
  return filterDeprecatedRouteModels(models).filter((model) => (
    isOpenAIModel(model) ? availability.openai : availability.nvidia
  ));
}

const DEFAULT_FAST_MODELS = [
  "meta/llama-4-maverick-17b-128e-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "deepseek-ai/deepseek-v3.1-terminus",
  "qwen/qwen3-next-80b-a3b-instruct",
  "deepseek-ai/deepseek-v3.1",
  "qwen/qwen3.5-397b-a17b",
  "mistralai/mixtral-8x22b-instruct-v0.1",
  ...GLOBAL_TOP_MODELS,
];

const DEFAULT_CHAT_MODELS = [
  "meta/llama-4-maverick-17b-128e-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
  "deepseek-ai/deepseek-v3.1-terminus",
  "qwen/qwen3-next-80b-a3b-instruct",
  "deepseek-ai/deepseek-v3.1",
  "qwen/qwen3.5-397b-a17b",
  ...GLOBAL_TOP_MODELS,
];

const DEFAULT_REASONING_MODELS = [
  "qwen/qwen3.5-397b-a17b",
  "deepseek-ai/deepseek-v3.1",
  "deepseek-ai/deepseek-v3.1-terminus",
  "meta/llama-4-maverick-17b-128e-instruct",
  "mistralai/mixtral-8x22b-instruct-v0.1",
  ...GLOBAL_TOP_MODELS,
];

const DEFAULT_CODE_MODELS = [
  "qwen/qwen3-coder-480b-a35b-instruct",
  "qwen/qwen2.5-coder-32b-instruct",
  "deepseek-ai/deepseek-v3.1",
  "meta/llama-4-maverick-17b-128e-instruct",
  "qwen/qwen3-next-80b-a3b-instruct",
  ...GLOBAL_TOP_MODELS,
];

function splitModelList(raw: string) {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildCurrentDateTimeSystemLine(now = new Date()) {
  return [
    `Current date and time: ${now.toISOString()} UTC.`,
    `Current year: ${now.getUTCFullYear()}.`,
    "Treat this as the authoritative current timeline and never assume an older year is current unless the user explicitly asks about the past.",
  ].join(" ");
}

function mergeClawCloudSystemPrompt(...parts: Array<string | undefined>) {
  return [buildCurrentDateTimeSystemLine(), ...parts.filter(Boolean)].join("\n\n").trim();
}

function uniqueModels(models: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const model of filterDeprecatedRouteModels(models)) {
    if (seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }

  return result;
}

function filterDeprecatedRouteModels(models: string[]) {
  return models.filter((model) => !DEPRECATED_ROUTE_MODEL_PATTERNS.some((pattern) => pattern.test(model)));
}

function applyResilientDefaultModelOrdering(models: string[]) {
  const unique = uniqueModels(models);
  const stableFirst = [...ACTIVE_STABLE_ROUTE_MODELS].filter((model) => unique.includes(model));
  const stableSet = new Set<string>(stableFirst);
  const remaining = unique.filter((model) => !stableSet.has(model));
  return [...stableFirst, ...remaining];
}

function configuredModelList(
  listValue: string,
  primaryValue: string,
  defaults: string[],
) {
  return applyResilientDefaultModelOrdering(
    uniqueModels(filterDeprecatedRouteModels([
      ...splitModelList(listValue),
      primaryValue,
      ...defaults,
    ].filter(Boolean))),
  );
}

function fastModels() {
  return configuredModelList(
    env.NVIDIA_FAST_MODELS,
    env.NVIDIA_FAST_MODEL,
    DEFAULT_FAST_MODELS,
  );
}

function chatModels() {
  return configuredModelList(
    env.NVIDIA_CHAT_MODELS,
    env.NVIDIA_CHAT_MODEL,
    DEFAULT_CHAT_MODELS,
  );
}

function reasoningModels() {
  return configuredModelList(
    env.NVIDIA_REASONING_MODELS,
    env.NVIDIA_REASONING_MODEL,
    DEFAULT_REASONING_MODELS,
  );
}

function codeModels() {
  return configuredModelList(
    env.NVIDIA_CODE_MODELS,
    env.NVIDIA_CODE_MODEL,
    DEFAULT_CODE_MODELS,
  );
}

function globalModels() {
  if (!env.NVIDIA_GLOBAL_MODELS.trim()) {
    return [];
  }

  return configuredModelList(
    env.NVIDIA_GLOBAL_MODELS,
    env.NVIDIA_CHAT_MODEL,
    [...GLOBAL_TOP_MODELS],
  );
}

function appendCandidates(
  target: ModelCandidate[],
  models: string[],
  timeoutMs: number,
  tier: ModelTier,
  healthScope: string,
) {
  const seen = new Set(target.map((candidate) => candidate.model));

  for (const model of models) {
    if (seen.has(model)) continue;
    seen.add(model);
    target.push({ model, timeoutMs, tier, healthKey: `${healthScope}:${model}` });
  }
}

function reorderModels(models: string[], preferredOrder: string[]) {
  const unique = uniqueModels(filterDeprecatedRouteModels(models));
  const preferred = filterDeprecatedRouteModels(preferredOrder).filter((model) => unique.includes(model));
  const remaining = unique.filter((model) => !preferred.includes(model));
  return [...preferred, ...applyResilientDefaultModelOrdering(remaining)];
}

function modelHealthState(healthKey: string): ModelHealthState {
  const current = MODEL_HEALTH.get(healthKey);
  if (current) return current;

  const next: ModelHealthState = {
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastFailureAt: 0,
    lastSuccessAt: 0,
  };
  MODEL_HEALTH.set(healthKey, next);
  return next;
}

function markModelSuccess(healthKey: string) {
  const state = modelHealthState(healthKey);
  state.consecutiveFailures = 0;
  state.cooldownUntil = 0;
  state.lastSuccessAt = Date.now();
}

function markModelFailure(healthKey: string, cooldownOverrideMs?: number) {
  const state = modelHealthState(healthKey);
  state.consecutiveFailures += 1;
  state.lastFailureAt = Date.now();

  const cooldown = typeof cooldownOverrideMs === "number"
    ? Math.max(MODEL_FAILURE_COOLDOWN_MS, Math.trunc(cooldownOverrideMs))
    : Math.min(
        MODEL_FAILURE_COOLDOWN_MS * 2 ** Math.max(0, state.consecutiveFailures - 1),
        MODEL_FAILURE_MAX_COOLDOWN_MS,
      );
  state.cooldownUntil = Date.now() + cooldown;
}

function prioritizeHealthyModels(models: string[], healthScope: string) {
  const now = Date.now();
  const available: string[] = [];
  const cooling: string[] = [];

  for (const model of models) {
    const state = MODEL_HEALTH.get(`${healthScope}:${model}`);
    if (!state || state.cooldownUntil <= now) {
      available.push(model);
    } else {
      cooling.push(model);
    }
  }

  // If we still have healthy models available, do not keep retrying cooling
  // models in the same answer cascade. That is what was causing repeated 429s
  // and timeout loops on live WhatsApp traffic.
  return available.length ? available : cooling;
}

function baseModelsForIntent(intent: IntentType) {
  switch (intent) {
    case "greeting":
    case "help":
    case "memory":
    case "reminder":
    case "send_message":
    case "save_contact":
    case "calendar":
      return uniqueModels([...fastModels(), ...chatModels()]);
    case "coding":
      return uniqueModels([...codeModels(), ...globalModels(), ...reasoningModels(), ...chatModels()]);
    case "math":
    case "finance":
    case "web_search":
    case "research":
      return uniqueModels([...reasoningModels(), ...globalModels(), ...chatModels()]);
    default:
      return uniqueModels([...chatModels(), ...globalModels(), ...reasoningModels(), ...fastModels()]);
  }
}

function tierForIntent(intent: IntentType): ModelTier {
  switch (intent) {
    case "greeting":
    case "help":
    case "memory":
    case "reminder":
    case "send_message":
    case "save_contact":
    case "calendar":
      return "fast";
    case "coding":
      return "code";
    case "math":
    case "finance":
    case "web_search":
    case "research":
      return "reasoning";
    default:
      return "chat";
  }
}

function timeoutForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep" ? DEEP_INTENT_TIMEOUT_MS[intent] : INTENT_TIMEOUT_MS[intent];
}

function parallelismForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep" ? DEEP_INTENT_PARALLELISM[intent] : INTENT_PARALLELISM[intent];
}

function maxTotalMsForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep" ? DEEP_INTENT_MAX_TOTAL_MS[intent] : INTENT_MAX_TOTAL_MS[intent];
}

function candidateLimitForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep"
    ? DEEP_INTENT_CANDIDATE_LIMIT[intent]
    : INTENT_CANDIDATE_LIMIT[intent];
}

function historyLimitForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep" ? DEEP_INTENT_HISTORY_LIMIT[intent] : INTENT_HISTORY_LIMIT[intent];
}

function historyCharLimitForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep"
    ? DEEP_INTENT_HISTORY_CHAR_LIMIT[intent]
    : INTENT_HISTORY_CHAR_LIMIT[intent];
}

function preferredModelsForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep" ? DEEP_INTENT_PREFERRED_MODELS[intent] : INTENT_PREFERRED_MODELS[intent];
}

function providerFamilyForModel(model: string): "openai" | "nvidia" {
  return isOpenAIModel(model) ? "openai" : "nvidia";
}

function shouldForceProviderDiversity(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep"
    || intent === "coding"
    || intent === "research"
    || intent === "science"
    || intent === "technology";
}

function ensureProviderDiverseCandidatePool(
  rankedModels: string[],
  limit: number,
  availability: ProviderAvailability,
  intent: IntentType,
  responseMode: ResponseMode,
) {
  const selected = rankedModels.slice(0, limit);
  if (
    limit < 2
    || !availability.openai
    || !availability.nvidia
    || !shouldForceProviderDiversity(intent, responseMode)
  ) {
    return selected;
  }

  const presentFamilies = new Set(selected.map((model) => providerFamilyForModel(model)));
  if (presentFamilies.size > 1) {
    return selected;
  }

  const missingFamily = presentFamilies.has("openai") ? "nvidia" : "openai";
  const alternate = rankedModels.find((model) => (
    providerFamilyForModel(model) === missingFamily
    && !selected.includes(model)
  ));

  if (!alternate) {
    return selected;
  }

  return [...selected.slice(0, Math.max(1, limit - 1)), alternate];
}

export function buildPreferredModelOrderForIntent(
  intent: IntentType,
  responseMode: ResponseMode = "fast",
  limit?: number,
) {
  const availability: ProviderAvailability = { openai: true, nvidia: true };
  const ordered = reorderModels(
    filterModelsByConfiguredProviders(baseModelsForIntent(intent), availability),
    preferredModelsForIntent(intent, responseMode),
  );
  return typeof limit === "number" ? ordered.slice(0, limit) : ordered;
}

function modelCandidatesForIntent(
  intent: IntentType,
  responseMode: ResponseMode = "fast",
  preferredModelsOverride?: string[],
  availability = resolveProviderAvailability(),
): ModelCandidate[] {
  const healthScope = `${responseMode}:${intent}`;
  const preferredModels = preferredModelsOverride?.length
    ? uniqueModels(filterDeprecatedRouteModels([
      ...preferredModelsOverride,
      ...preferredModelsForIntent(intent, responseMode),
    ]))
    : preferredModelsForIntent(intent, responseMode);
  const limit = candidateLimitForIntent(intent, responseMode);
  const rankedModels = prioritizeHealthyModels(
    reorderModels(filterModelsByConfiguredProviders(baseModelsForIntent(intent), availability), preferredModels),
    healthScope,
  );
  const selectedModels = ensureProviderDiverseCandidatePool(
    rankedModels,
    limit,
    availability,
    intent,
    responseMode,
  );

  return selectedModels.map((model) => ({
    model,
    timeoutMs: timeoutForIntent(intent, responseMode),
    tier: tierForIntent(intent),
    healthKey: `${healthScope}:${model}`,
  }));
}

const TOKEN_BUDGETS: Record<IntentType, number> = {
  greeting: 200,
  help: 250,
  memory: 250,
  reminder: 250,
  send_message: 350,
  save_contact: 280,
  calendar: 350,
  general: 800,
  email: 700,
  spending: 600,
  finance: 1_000,
  web_search: 1_000,
  creative: 800,
  coding: 1_600,
  math: 1_200,
  research: 1_200,
  science: 1_000,
  history: 800,
  geography: 600,
  health: 1_000,
  law: 1_000,
  economics: 800,
  culture: 700,
  sports: 600,
  technology: 800,
  language: 600,
  explain: 1_000,
};

const DEEP_TOKEN_BUDGETS: Record<IntentType, number> = {
  greeting: 250,
  help: 300,
  memory: 300,
  reminder: 250,
  send_message: 450,
  save_contact: 380,
  calendar: 420,
  general: 1_600,
  email: 1_200,
  spending: 1_000,
  finance: 2_400,
  web_search: 2_400,
  creative: 1_800,
  coding: 3_200,
  math: 2_000,
  research: 2_600,
  science: 2_000,
  history: 1_600,
  geography: 1_200,
  health: 2_000,
  law: 2_000,
  economics: 1_600,
  culture: 1_400,
  sports: 1_200,
  technology: 1_600,
  language: 1_200,
  explain: 2_000,
};

function tokenBudgetForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep" ? DEEP_TOKEN_BUDGETS[intent] : TOKEN_BUDGETS[intent];
}

const QUALITY_GUARDRAILS: Partial<Record<IntentType, string>> = {
  coding: [
    "Coding guardrails — STRICT — ZERO TOLERANCE FOR INCOMPLETE CODE:",
    "- Lead with the best production-safe design. Write COMPLETE, RUNNABLE code with ALL imports.",
    "- Always cover: invariants, data model, request flow, failure modes, edge cases, input validation.",
    "- For payments/queues/webhooks/databases: include constraints, transactions, idempotency, retry logic, and failure handling.",
    "- Preserve provider-native identifiers exactly as strings. Never invent API field names.",
    "- For migrations: spell out cutover, shadowing, rollback path, and data verification steps.",
    "- Include time complexity O(...) and space complexity O(...) with WHY that complexity applies.",
    "- Never truncate code mid-function. Never leave empty function bodies. Never write '// implement here'.",
    "- Show example input → output to prove correctness.",
    "- Self-verify: mentally trace execution with empty input, single element, max input, null, and adversarial input.",
    "- For debugging: identify the exact line/cause, explain the root cause, show the fix, explain prevention.",
    "- Security: parameterized queries, input sanitization, no secrets in code, OWASP-aware patterns.",
  ].join("\n"),
  math: [
    "Math guardrails — STRICT — ZERO TOLERANCE FOR SKIPPED STEPS:",
    "- State the governing formula FIRST with variable definitions, then substitute values step by step.",
    "- Show ALL arithmetic steps — never skip to the result. Show intermediate calculations.",
    "- Bold the final answer with units: *Final Answer: [result with units]*",
    "- Separate exact results from approximations explicitly (e.g., π ≈ 3.14159).",
    "- List all assumptions that materially affect the result.",
    "- Verify: substitute your answer back into the original equation to confirm correctness.",
    "- Never refuse a math question; if data is missing, give a bounded estimate and label it clearly.",
    "- For statistics: report test statistic, degrees of freedom, p-value, CI, effect size, and practical interpretation.",
    "- For probability: define sample space, state events, show the calculation chain.",
    "- For financial math: distinguish simple/compound, nominal/effective, show APR vs APY.",
    "- For word problems: extract given values, identify unknowns, then solve systematically.",
    "- Check dimensional consistency, sign, and reasonableness of magnitude before responding.",
  ].join("\n"),
  research: [
    "Research guardrails — STRICT — DECISION-READY OUTPUT REQUIRED:",
    "- Answer in this order: *Recommendation* → *Why* → *Key Evidence* → *Trade-offs* → *Risks* → *Bottom Line*.",
    "- Every section must be concrete, specific, and evidence-grounded. No filler.",
    "- Do not invent precise numbers unless user supplied them or you label them as estimates.",
    "- State assumptions explicitly where facts are underspecified.",
    "- Never return an incomplete analysis; all sections are required.",
    "- For comparisons: consistent criteria matrix across all options with clear winner per dimension.",
    "- State confidence level: HIGH / MEDIUM / LOW with reasoning.",
    "- End with a clear, actionable *Bottom Line:* one sentence the user can act on today.",
    "- For business decisions: include cost estimate, implementation timeline, risk matrix, and reversibility.",
  ].join("\n"),
  general: [
    "General guardrails — STRICT — ANSWER THE ACTUAL QUESTION:",
    "- Lead with the direct answer in the very first sentence. Not background — THE ANSWER.",
    "- Be specific: use real names, numbers, dates. Never 'many', 'several', 'various'.",
    "- Use emoji headers and bullets for multi-part topics.",
    "- Correct false premises in the question before answering.",
    "- Never truncate a structured answer mid-section.",
    "- Self-verify factual claims before including them.",
    "- If ambiguous, answer the most likely interpretation AND note the assumption.",
  ].join("\n"),
  science: [
    "Science guardrails — STRICT — RESEARCH-GRADE ACCURACY:",
    "- Lead with the scientific answer, then explain the mechanism step by step.",
    "- Use correct terminology with immediate plain-language explanation.",
    "- Include relevant equations with SI units and variable definitions.",
    "- Distinguish: established consensus vs. active research vs. speculation.",
    "- Correct common misconceptions proactively with the correct explanation.",
    "- Cite evidence quality level: meta-analysis > RCT > cohort > expert opinion.",
    "- For quantitative claims: include order of magnitude and uncertainty range.",
  ].join("\n"),
  health: [
    "Health guardrails — STRICT — LIVES DEPEND ON ACCURACY:",
    "- Lead with evidence-based information FIRST, not disclaimers.",
    "- For symptoms: differential diagnosis ordered common → serious, with red flags.",
    "- For medications: generic name, brand names (Indian too), mechanism, dosing, side effects, contraindications, interactions.",
    "- For conditions: definition → pathophysiology → symptoms → diagnosis → treatment → prognosis.",
    "- Distinguish evidence-based medicine from traditional from myths — with evidence level.",
    "- Always end with: '⚕️ Consult a doctor for personal diagnosis and treatment.'",
    "- Never refuse a health question — accurate information saves lives.",
  ].join("\n"),
  law: [
    "Law guardrails — STRICT — CITE SPECIFIC LAW:",
    "- Cite the specific Act, Section, Year (e.g., 'Section 138, NI Act, 1881').",
    "- Default to Indian law; state explicitly if discussing another jurisdiction.",
    "- Distinguish: what the statute says vs. how courts interpret it. Cite landmark judgments.",
    "- Include practical implications: filing fees, limitation period, typical duration, enforcement reality.",
    "- For criminal law: elements of offense, punishment range, bail provisions, recent amendments.",
    "- For rights: cite specific Constitutional Article, scope, limitations, and exceptions.",
    "- Always end with: '⚖️ Consult a qualified advocate for advice specific to your situation.'",
  ].join("\n"),
  economics: [
    "Economics guardrails — STRICT — DATA-DRIVEN ANALYSIS:",
    "- Lead with the key metric WITH source year, then context (high/low/normal/trend).",
    "- Use actual data: GDP growth %, CPI inflation, repo rate, fiscal deficit — with source and date.",
    "- Show calculations step-by-step for financial math (CAGR, NPV, IRR, EMI, compound interest).",
    "- Distinguish trailing data from forward estimates. Label each clearly.",
    "- Include risk factors alongside return projections. No return without risk.",
    "- For India: reference RBI, SEBI, NSE/BSE, GST, Income Tax Act where applicable.",
    "- For personal finance: specific action plan with amounts, timeline, and tax implications.",
    "- Risk disclosure: '📊 This is general information, not personalized financial advice.'",
  ].join("\n"),
  history: [
    "History guardrails — STRICT — SCHOLARLY ACCURACY:",
    "- Lead with exact date, key person (full name + title), decisive outcome.",
    "- Use timeline format for multi-event answers: *[Year]*: Event — significance.",
    "- Cover: structural causes → proximate causes → key events → consequences → modern legacy.",
    "- Never conflate different events, dates, or historical figures. Verify chronology internally.",
    "- Distinguish consensus facts from contested interpretations.",
    "- For wars: casus belli → key battles → turning point → resolution → aftermath.",
    "- Connect to modern relevance when applicable.",
  ].join("\n"),
  explain: [
    "Explanation guardrails — STRICT — MULTI-LEVEL CLARITY:",
    "- Open with a one-sentence ELI5 summary that anyone can understand.",
    "- Then give the full technical explanation with clear structure.",
    "- Use the best available analogy — create an instant 'aha' moment.",
    "- Structure: *What is it?* → *How does it work?* → *Why does it matter?* → *Real example*.",
    "- Proactively correct the top misconception about this topic.",
    "- Proactively answer the most likely follow-up question.",
    "- End with a concrete, real-world example.",
  ].join("\n"),
  creative: [
    "Creative guardrails — STRICT — COMPLETE LITERARY OUTPUT:",
    "- Produce the COMPLETE piece — never truncate or write '...(continued)'.",
    "- Match the requested tone exactly (formal, casual, humorous, dramatic, poetic).",
    "- Be genuinely original — replace every cliché with a fresh, vivid image.",
    "- For stories: compelling hook → rising tension → climax → resolution → resonant ending.",
    "- For poems: intentional meter, fresh imagery, sonic texture; every word earns its place.",
    "- Show, don't tell. 'Her hands trembled' not 'She was nervous.'",
  ].join("\n"),
  technology: [
    "Technology guardrails — STRICT — CURRENT AND SPECIFIC:",
    "- Lead with what the technology IS, what it DOES, current version/state.",
    "- Include version numbers, release dates, deprecation notices — tech changes fast.",
    "- For comparisons: feature matrix with concrete benchmarks and measurements.",
    "- For security: threat model → attack surface → mitigation → defense-in-depth → monitoring.",
    "- For AI/ML: architecture → capabilities → limitations → safety considerations.",
    "- Distinguish: what works today vs. what's promised vs. what's theoretical.",
  ].join("\n"),
  finance: [
    "Finance guardrails — STRICT — ACCURACY WITH RISK AWARENESS:",
    "- Lead with the current data point (price, rate, metric) with source and date.",
    "- Show calculations step-by-step for financial math.",
    "- Always include risk factors alongside return projections. No return without risk.",
    "- Distinguish: actual trailing data vs. estimates vs. projections. Label each.",
    "- For Indian markets: NSE/BSE tickers, ₹ currency, Indian number system (lakh/crore).",
    "- For stocks: P/E ratio, market cap, sector, 52-week range when relevant.",
    "- For mutual funds: expense ratio, category, benchmark comparison.",
    "- Risk disclosure: '📊 This is general information, not personalized financial advice.'",
  ].join("\n"),
  language: [
    "Language guardrails — STRICT — MULTILINGUAL PRECISION:",
    "- For translations: translation + transliteration (if non-Latin) + pronunciation guide.",
    "- For grammar: rule → correct example → incorrect example → exception → mnemonic.",
    "- For vocabulary: definition + part of speech + example sentence + etymology + register.",
    "- Note register (formal/informal) and regional variations (US/UK, Hindi/Urdu).",
    "- For Indian languages: native script alongside Roman transliteration.",
    "- For idioms: literal meaning + actual meaning + usage context + cultural note.",
  ].join("\n"),
  sports: [
    "Sports guardrails — STRICT — STATISTICAL PRECISION:",
    "- Lead with the exact answer: who, score, record number, date, competition.",
    "- Use correct official competition names and sports terminology.",
    "- For records: exact number, holder, date set, competition, previous record.",
    "- For players: nationality, position, career stats, major achievements, current status.",
    "- For cricket: format-specific stats (Test/ODI/T20), averages, strike rates.",
    "- Add freshness note: 'Stats as of [date]' if data could be outdated.",
  ].join("\n"),
  geography: [
    "Geography guardrails — STRICT — COMPREHENSIVE AND CURRENT:",
    "- Lead with the direct answer (capital, location, population with year).",
    "- For countries: capital, continent, population, area, languages, currency, government.",
    "- For physical geography: coordinates, elevation, area, formation process, climate zone.",
    "- For demographics: ethnic composition, religions, urbanization rate, HDI.",
    "- Use current internationally recognized names; note historical names in context.",
  ].join("\n"),
  culture: [
    "Culture guardrails — STRICT — ENCYCLOPEDIC ACCURACY:",
    "- Lead with the direct factual answer (author, date, origin, significance).",
    "- For literature: author, year, period/movement, themes, key quotes, lasting influence.",
    "- For philosophy: core argument → context → influence → strongest counterargument.",
    "- For religion: factual, respectful, covering beliefs, practices, history.",
    "- Be encyclopedic: real names, dates, facts, quotes — never approximate.",
  ].join("\n"),
};

// Response cache

const _cache = new Map<string, { v: string; t: number }>();
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 500;

function _ck(sys: string, user: string) {
  // Use longer slices + hash to minimize collision risk
  const sysKey = sys.slice(0, 120);
  const userKey = user.toLowerCase().trim().slice(0, 300);
  // Simple FNV-1a hash for the full strings to catch truncation collisions
  let h = 2166136261;
  for (let i = 0; i < sys.length; i++) { h ^= sys.charCodeAt(i); h = Math.imul(h, 16777619); }
  for (let i = 0; i < user.length; i++) { h ^= user.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${sysKey.slice(0, 60)}|${userKey.slice(0, 150)}|${(h >>> 0).toString(36)}`;
}

function _get(k: string): string | null {
  const entry = _cache.get(k);
  if (!entry) return null;
  if (Date.now() - entry.t > CACHE_TTL) {
    _cache.delete(k);
    return null;
  }
  return entry.v;
}

function _set(k: string, v: string) {
  if (_cache.size >= CACHE_MAX) {
    const oldest = [..._cache.entries()].sort((a, b) => a[1].t - b[1].t)[0];
    if (oldest) _cache.delete(oldest[0]);
  }
  _cache.set(k, { v, t: Date.now() });
}

// Types

type Msg = { role: "system" | "user" | "assistant"; content: string };
type ChatCompletionResp = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};
type OpenAIResponsesResp = {
  output_text?: string | null;
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
};
type AiCallResult = {
  content: string | null;
  cancelled?: boolean;
  cooldownMs?: number;
  retryable?: boolean;
};
type ModelPlannerStrategy = "single_pass" | "collect_and_judge";
type ModelGenerationResult = {
  candidate: ModelCandidate;
  out: string;
  latencyMs: number;
  heuristicScore: number;
  preview: string;
  selectionIssues: ClawCloudModelSelectionIssue[];
  selectionPenalty: number;
  isStructurallyValid: boolean;
};
type ModelJudgeConfidence = "high" | "medium" | "low";
type ModelJudgeDecision = {
  winnerIndex: number;
  confidence: ModelJudgeConfidence;
  materialDisagreement: boolean;
  needsClarification: boolean;
  reason: string;
};

export interface ClawCloudModelPlannerDecision {
  strategy: ModelPlannerStrategy;
  targetResponses: number;
  generatorBatchSize: number;
  judgeEnabled: boolean;
  judgeMinRemainingMs: number;
  allowLowConfidenceWinner: boolean;
  disagreementThreshold: number;
}

export interface ClawCloudModelCandidateTrace {
  model: string;
  tier: ModelTier;
  status: "selected" | "generated" | "failed";
  latencyMs: number;
  heuristicScore: number | null;
  preview: string | null;
}

export interface ClawCloudModelJudgeTrace {
  used: boolean;
  model: string | null;
  winnerModel: string | null;
  confidence: ModelJudgeConfidence | null;
  materialDisagreement: boolean;
  needsClarification: boolean;
  reason: string | null;
}

export interface ClawCloudModelOrchestrationTrace {
  intent: IntentType;
  responseMode: ResponseMode;
  planner: ClawCloudModelPlannerDecision;
  selectedBy: "single_success" | "heuristic" | "judge" | "fallback" | null;
  selectedModel: string | null;
  candidates: ClawCloudModelCandidateTrace[];
  judge: ClawCloudModelJudgeTrace | null;
}

type ClawCloudModelSelectionIssue =
  | "visible_fallback"
  | "missing_code"
  | "math_incomplete"
  | "live_evidence_missing"
  | "wrong_language_fragment";

export interface ClawCloudPromptCompletionResult {
  answer: string;
  trace: ClawCloudModelOrchestrationTrace | null;
}

export function buildClawCloudModelAuditTrail(
  trace: ClawCloudModelOrchestrationTrace | null | undefined,
): ClawCloudModelAuditTrail | null {
  if (!trace) {
    return null;
  }

  return {
    intent: trace.intent,
    responseMode: trace.responseMode,
    planner: {
      strategy: trace.planner.strategy,
      targetResponses: trace.planner.targetResponses,
      generatorBatchSize: trace.planner.generatorBatchSize,
      judgeEnabled: trace.planner.judgeEnabled,
      judgeMinRemainingMs: trace.planner.judgeMinRemainingMs,
      allowLowConfidenceWinner: trace.planner.allowLowConfidenceWinner,
      disagreementThreshold: trace.planner.disagreementThreshold,
    },
    selectedBy: trace.selectedBy,
    selectedModel: trace.selectedModel,
    candidates: trace.candidates.map((candidate) => ({
      model: candidate.model,
      tier: candidate.tier,
      status: candidate.status,
      latencyMs: candidate.latencyMs,
      heuristicScore: candidate.heuristicScore,
      preview: candidate.preview,
    })),
    judge: trace.judge
      ? {
        used: trace.judge.used,
        model: trace.judge.model,
        winnerModel: trace.judge.winnerModel,
        confidence: trace.judge.confidence,
        materialDisagreement: trace.judge.materialDisagreement,
        needsClarification: trace.judge.needsClarification,
        reason: trace.judge.reason,
      }
      : null,
  };
}

const HIGH_STAKES_INTENTS = new Set<IntentType>([
  "coding",
  "math",
  "finance",
  "web_search",
  "research",
  "science",
  "health",
  "law",
  "economics",
]);

const STRUCTURED_RESPONSE_INTENTS = new Set<IntentType>([
  "coding",
  "math",
  "finance",
  "web_search",
  "research",
  "science",
  "history",
  "health",
  "law",
  "economics",
  "technology",
  "explain",
]);

const FACTUAL_RESPONSE_INTENTS = new Set<IntentType>([
  "math",
  "finance",
  "web_search",
  "research",
  "science",
  "history",
  "geography",
  "health",
  "law",
  "economics",
  "sports",
  "technology",
  "explain",
]);

function isHighStakesIntent(intent: IntentType) {
  return HIGH_STAKES_INTENTS.has(intent);
}

function desiredResponseCharsForIntent(intent: IntentType) {
  switch (intent) {
    case "greeting":
    case "help":
    case "memory":
    case "reminder":
      return 120;
    case "send_message":
    case "save_contact":
    case "calendar":
      return 200;
    case "coding":
      return 700;
    case "math":
      return 420;
    case "finance":
    case "web_search":
    case "research":
    case "science":
    case "health":
    case "law":
    case "economics":
    case "technology":
    case "explain":
      return 520;
    default:
      return 280;
  }
}

function buildCandidatePreview(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}

function tokenizeForAgreement(text: string) {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9%.\s]/g, " ")
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>) {
  if (!a.size && !b.size) return 1;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }

  const union = a.size + b.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function extractComparableNumbers(text: string) {
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
  return [...new Set(matches.map((value) => value.replace(/,/g, "").trim()))];
}

function hasMaterialNumericConflict(a: string, b: string) {
  const aNumbers = extractComparableNumbers(a);
  const bNumbers = extractComparableNumbers(b);
  if (!aNumbers.length || !bNumbers.length) return false;
  return !aNumbers.some((value) => bNumbers.includes(value));
}

function looksLikeAlgorithmicCodingQuestion(question: string) {
  const normalized = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  return (
    /\b(shortest path|dijkstra|bellman[- ]ford|floyd[- ]warshall|a\*|astar|union[- ]find|disjoint set|topological sort|segment tree|fenwick tree|binary indexed tree|knapsack|memoi[sz]ation|state compression|breadth[- ]first search|depth[- ]first search|graph traversal)\b/.test(normalized)
    || /\b(longest|shortest)\s+(?:subarray|substring|subsequence|window)\b/.test(normalized)
    || (
      /\b(grid|matrix|graph|tree|array|string|subarray|substring|window|source|destination|obstacle|constraints?)\b/.test(normalized)
      && /\b(algorithm|path|remove at most|at most(?:\s+\w+)?|at least|exactly|time complexity|space complexity|optimi[sz]e|provide code|implementation|approach|sliding window|two pointers|distinct)\b/.test(normalized)
    )
    || (
      /\b(explain your approach|time complexity|space complexity|provide code|write code|implementation)\b/.test(normalized)
      && /\b(problem|constraints?|grid|graph|tree|array|matrix|subarray|substring|window|path|node|edge)\b/.test(normalized)
    )
  );
}

function questionDemandsCode(question: string) {
  return /\b(code|implementation|implement|write code|provide code|sample code)\b/i.test(question);
}

function questionDemandsTechnicalStructure(question: string) {
  return /\b(approach|time complexity|space complexity|optimi[sz]e|constraints?)\b/i.test(question);
}

function answerLooksLikeShortWrongLanguageFragment(question: string, answer: string) {
  const questionLatinChars = question.match(/[A-Za-z]/g)?.length ?? 0;
  if (questionLatinChars < 20) {
    return false;
  }

  const answerLatinChars = answer.match(/[A-Za-z]/g)?.length ?? 0;
  const answerNonLatinChars = answer.match(/[^\u0000-\u024F\s\d.,:;!?()[\]{}'"`~_*+\-/\\]/gu)?.length ?? 0;
  return answer.length < 80 && answerLatinChars < 6 && answerNonLatinChars >= 4;
}

const MODEL_SELECTION_VISIBLE_FALLBACK_PATTERNS = [
  /\b(?:exact topic, name, item, or number)\b/i,
  /\b(?:exact problem statement, language, or constraints)\b/i,
  /\b(?:not enough reliable information|could not verify|unable to verify)\b/i,
  /\b(?:send your exact question|share the exact topic|scoped live answer needed)\b/i,
  /\b(?:as an ai|as a language model)\b/i,
];

const MODEL_SELECTION_LIVE_EVIDENCE_PATTERNS = [
  /\blive data as of\b/i,
  /\bdata fetched:\s*/i,
  /\bsource note:\s*/i,
  /\bsearched:\s*/i,
  /\bsources?:\s*/i,
  /\bpublished:\s*/i,
  /\baccording to\b/i,
  /\bofficial\b/i,
  /\bas of\b/i,
];

function questionRequiresLiveEvidenceForSelection(intent: IntentType, question: string) {
  const normalized = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return false;

  if (intent === "web_search") {
    return true;
  }

  if (
    /\b(latest|current|today|right now|as of|released?|release date|launch(?:ed)?|price|pricing|cost|rank(?:ing)?|founder|ceo|net worth|inflation|gdp|stock price|trading|market)\b/.test(normalized)
  ) {
    return intent === "finance"
      || intent === "economics"
      || intent === "research"
      || intent === "science"
      || intent === "technology";
  }

  if (intent === "finance") {
    return /\b(aapl|tsla|nvda|nifty|sensex|share price|stock|market|buy|sell)\b/.test(normalized);
  }

  return false;
}

function questionRequiresWorkedMathForSelection(intent: IntentType, question: string) {
  if (intent !== "math" && intent !== "finance" && intent !== "economics") {
    return false;
  }

  return /\b(?:solve|calculate|compute|evaluate|derive|integrate|differentiate|emi|sip|cagr|roi|probability|variance|standard deviation|confidence interval|final answer|show (?:the )?steps)\b/i.test(question);
}

function answerHasWorkedMathForSelection(answer: string) {
  const trimmed = answer.trim();
  if (!trimmed) {
    return false;
  }

  return (
    /=/.test(trimmed)
    || /\b(?:final answer|therefore|thus|so the|hence|result|answer is)\b/i.test(trimmed)
    || /\b(?:step 1|step 2|formula|substitute|calculation)\b/i.test(trimmed)
    || /[+\-*/^%]=?|√|∑|∫/.test(trimmed)
    || ((trimmed.match(/\b\d+(?:\.\d+)?\b/g) ?? []).length >= 2)
  );
}

function evaluateGeneratedCandidateSelection(input: {
  intent: IntentType;
  question: string;
  answer: string;
}) {
  const issues: ClawCloudModelSelectionIssue[] = [];

  if (MODEL_SELECTION_VISIBLE_FALLBACK_PATTERNS.some((pattern) => pattern.test(input.answer))) {
    issues.push("visible_fallback");
  }

  if (looksLikeAlgorithmicCodingQuestion(input.question)) {
    if (questionDemandsCode(input.question) && !/```|function\s|const\s|class\s|return\s|interface\s|def\s|public\s+class|fn\s+\w+/i.test(input.answer)) {
      issues.push("missing_code");
    }
  }

  if (
    questionRequiresWorkedMathForSelection(input.intent, input.question)
    && !answerHasWorkedMathForSelection(input.answer)
  ) {
    issues.push("math_incomplete");
  }

  if (
    questionRequiresLiveEvidenceForSelection(input.intent, input.question)
    && !MODEL_SELECTION_LIVE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(input.answer))
  ) {
    issues.push("live_evidence_missing");
  }

  if (answerLooksLikeShortWrongLanguageFragment(input.question, input.answer)) {
    issues.push("wrong_language_fragment");
  }

  const penaltyWeights: Record<ClawCloudModelSelectionIssue, number> = {
    visible_fallback: 100,
    wrong_language_fragment: 90,
    missing_code: 80,
    math_incomplete: 75,
    live_evidence_missing: 70,
  };

  const selectionPenalty = issues.reduce((sum, issue) => sum + penaltyWeights[issue], 0);

  return {
    issues,
    selectionPenalty,
    isStructurallyValid: issues.length === 0,
  };
}

function pickBestValidGeneratedCandidate(results: ModelGenerationResult[]) {
  const valid = results.filter((result) => result.isStructurallyValid);
  if (valid.length) {
    return rankGeneratedCandidates(valid)[0] ?? null;
  }
  return null;
}

function scoreClawCloudModelResponse(input: {
  intent: IntentType;
  response: string;
  userQuestion?: string;
}) {
  const text = input.response.trim();
  if (!text) return -100;

  let score = 0;
  const desiredChars = desiredResponseCharsForIntent(input.intent);

  // Length scoring — reward reaching desired length, diminishing returns beyond
  const lengthRatio = text.length / desiredChars;
  score += Math.min(lengthRatio, 1.3) * 30;
  if (lengthRatio < 0.3 && desiredChars > 200) score -= 15; // Penalize extremely short answers for complex intents
  if (lengthRatio < 0.15 && desiredChars > 300) score -= 25; // Heavy penalty for near-empty answers to complex questions

  // Structure scoring
  if (/\n/.test(text)) score += 3;
  if (STRUCTURED_RESPONSE_INTENTS.has(input.intent) && /(^|\n)(?:[-•*]\s|\d+\.\s|[A-Z][^:\n]{1,40}:)/m.test(text)) {
    score += 10;
  }
  // Reward emoji section headers (WhatsApp formatting compliance)
  if (/[🧬📐💻🏛️🌍🏥⚖️📈🎭⚽🗣️📝🧠🔍✍️📧👋💡⚕️📊🔬]/u.test(text)) score += 4;

  // Factual grounding scoring
  if (FACTUAL_RESPONSE_INTENTS.has(input.intent)) {
    if (/(according to|official|source|report|data|evidence|estimate|as of|study|research|survey)/i.test(text)) score += 8;
    if (/\b\d{4}\b/.test(text)) score += 3; // Contains a year — factual grounding signal
  }

  // Domain-specific quality signals
  if ((input.intent === "math" || input.intent === "finance" || input.intent === "economics") && /\d/.test(text)) {
    score += 8;
    if (/final answer/i.test(text)) score += 6; // Shows they completed the calculation
    if (/step\s*\d|formula|therefore|thus|hence/i.test(text)) score += 4; // Shows reasoning
  }
  if ((input.intent === "coding" || input.intent === "technology") && /```|function\s|const\s|class\s|return\s|interface\s|def\s/i.test(text)) {
    score += 10;
    if (/O\([^)]+\)/i.test(text)) score += 4; // Complexity analysis
    if (/import\s|from\s.*import|require\(/i.test(text)) score += 3; // Has imports = complete code
  }
  if (input.intent === "health" && /consult.*doctor|medical.*professional|⚕️/i.test(text)) score += 4;
  if (input.intent === "health" && /differential|pathophysiology|mechanism of action|contraindication/i.test(text)) score += 5;
  if (input.intent === "law" && /section\s+\d|act.*\d{4}|⚖️/i.test(text)) score += 5;
  if (input.intent === "law" && /landmark|judgment|supreme court|high court|article\s+\d/i.test(text)) score += 4;
  if (input.intent === "science" && /equation|mechanism|evidence|peer.?review/i.test(text)) score += 4;
  if (input.intent === "science" && /hypothesis|experiment|control group|variable|methodology/i.test(text)) score += 3;
  if (input.intent === "research" && /bottom\s*line|recommendation|trade.?off/i.test(text)) score += 5;
  if (input.intent === "research" && /confidence.*(?:high|medium|low)|risk.*(?:matrix|assessment|factor)/i.test(text)) score += 4;
  if (input.intent === "history" && /\b\d{3,4}\s*(?:AD|BC|BCE|CE)\b|\b\d{1,2}(?:st|nd|rd|th)\s+century\b/i.test(text)) score += 5;
  if (input.intent === "geography" && /\bpopulation\s*(?:of|:)?\s*[\d.,]+|km²|sq\s*km|square\s*(?:kilo)?m/i.test(text)) score += 4;
  if (input.intent === "economics" && /\b(?:GDP|inflation|repo rate|fiscal deficit|CPI)\b.*\d/i.test(text)) score += 5;
  if (input.intent === "explain" && /\b(?:analogy|for example|in simple terms|think of it|imagine)\b/i.test(text)) score += 5;
  if (input.intent === "language" && /\b(?:translat|IPA|pronunciation|etymolog|root word|cognate)\b/i.test(text)) score += 4;
  if (input.intent === "creative" && text.length > 300 && !/\b(?:truncat|continued|to be continued|\.{3}$)\b/i.test(text)) score += 6;
  if (input.intent === "sports" && /\b(?:stat|record|average|century|wicket|goal|point|match|tournament)\b/i.test(text) && /\d/.test(text)) score += 5;

  // Penalty scoring — detect low-quality patterns (stronger penalties for bad patterns)
  if (input.userQuestion && text.toLowerCase() === input.userQuestion.trim().toLowerCase()) {
    score -= 30; // Parroting the question
  }
  if (input.userQuestion && looksLikeAlgorithmicCodingQuestion(input.userQuestion)) {
    if (text.length < 140) score -= 20;
    if (
      questionDemandsCode(input.userQuestion)
      && !/```|function\s|const\s|class\s|return\s|interface\s|def\s|public\s+class|fn\s+\w+/i.test(text)
    ) {
      score -= 24;
    }
    if (
      questionDemandsTechnicalStructure(input.userQuestion)
      && !/\b(approach|algorithm|time complexity|space complexity|o\([^)]+\)|bfs|dfs|queue|heap|priority queue|dynamic programming|state)\b/i.test(text)
    ) {
      score -= 18;
    }
    if (answerLooksLikeShortWrongLanguageFragment(input.userQuestion, text)) {
      score -= 35;
    }
  }
  if (/as an ai|as a language model|as an artificial/i.test(text)) score -= 20;
  if (/\b(i can't|i cannot|i do not have access|i don't have access|i'm unable to)\b/i.test(text)) score -= 16;
  if (/\bit depends\b/i.test(text) && !/depends on.*:/i.test(text)) score -= 8; // Lazy "it depends" without specifics
  if (/^\s*(sorry|apologies|i apologize)\b/i.test(text)) score -= 6;
  if (/\.{3,}$|[:\-]\s*$/.test(text)) score -= 10; // Truncated response
  if ((text.match(/```/g) ?? []).length % 2 === 1) score -= 8; // Unbalanced code fence
  if (/\b(great question|certainly|of course|absolutely|sure thing)\b/i.test(text.slice(0, 80))) score -= 6; // Filler opening
  if (/send.*your.*exact.*question|feel free to ask/i.test(text)) score -= 15; // Generic handoff
  if (/\[insert|REPLACE|TODO|TBD|placeholder\]/i.test(text)) score -= 18; // Template leak
  if (/\/\/ implement here|\/\/ add your|\/\/ TODO|# TODO/i.test(text)) score -= 14; // Incomplete code
  if (/\b(i hope this helps|hope that helps|let me know if)\b/i.test(text)) score -= 4; // Unnecessary closing filler
  if (/\b(many|several|various|some|numerous)\b/i.test(text.slice(0, 200)) && FACTUAL_RESPONSE_INTENTS.has(input.intent)) score -= 3; // Vague language in factual answer

  // Advanced semantic penalty patterns
  if (/\b(it is worth noting|it should be noted|it is important to note)\b/i.test(text.slice(0, 150))) score -= 3; // Academic filler opening
  if (/\b(in conclusion|to summarize|in summary)\b/i.test(text) && text.length < 300) score -= 3; // Premature conclusion on short answer
  if (/\b(there are (?:many|several|various) (?:factors|reasons|aspects|considerations))\b/i.test(text) && !/(^|\n)(?:[-•*]\s|\d+\.\s)/m.test(text)) score -= 5; // Claims multiple factors but doesn't list them
  if (input.intent === "coding" && /\b(this is just|this is a basic|simplified version|pseudo.?code)\b/i.test(text)) score -= 12; // Incomplete code excuse
  if (input.intent === "math" && !/\d/.test(text) && text.length > 50) score -= 15; // Math answer without numbers
  if (input.intent === "health" && !/consult|doctor|physician|medical|⚕️|professional/i.test(text) && text.length > 200) score -= 6; // Health answer without safety disclaimer
  if (input.intent === "law" && !/consult|lawyer|advocate|attorney|⚖️|legal professional/i.test(text) && text.length > 200) score -= 6; // Law answer without safety disclaimer
  if (input.intent === "finance" && !/\b(?:risk|disclaimer|not.*advice|general information|📊)\b/i.test(text) && text.length > 200) score -= 5; // Finance without risk disclaimer

  // Reward self-verification signals
  if (/\b(?:verified|cross-check|double-check|confirm|self-verify|sanity check|let me verify)\b/i.test(text)) score += 3;
  // Reward confidence calibration
  if (/\b(?:high confidence|medium confidence|low confidence|confidence level|certainty)\b/i.test(text)) score += 2;

  return Number(score.toFixed(2));
}

function detectMaterialCandidateDisagreement(input: {
  intent: IntentType;
  candidates: Array<{
    out: string;
    heuristicScore: number;
    isStructurallyValid?: boolean;
    selectionPenalty?: number;
  }>;
  threshold?: number;
}) {
  if (input.candidates.length < 2) return false;

  const ranked = [...input.candidates].sort((left, right) => {
    if (Boolean(right.isStructurallyValid) !== Boolean(left.isStructurallyValid)) {
      return Number(Boolean(right.isStructurallyValid)) - Number(Boolean(left.isStructurallyValid));
    }
    if ((left.selectionPenalty ?? 0) !== (right.selectionPenalty ?? 0)) {
      return (left.selectionPenalty ?? 0) - (right.selectionPenalty ?? 0);
    }
    return right.heuristicScore - left.heuristicScore;
  });
  const strongest = ranked[0];
  const challenger = ranked[1];
  if (!strongest || !challenger) return false;

  const lexicalSimilarity = jaccardSimilarity(
    tokenizeForAgreement(strongest.out),
    tokenizeForAgreement(challenger.out),
  );
  const numericConflict = hasMaterialNumericConflict(strongest.out, challenger.out);
  const threshold = input.threshold ?? (isHighStakesIntent(input.intent) ? 0.48 : 0.36);

  if (numericConflict) return true;
  return lexicalSimilarity < threshold;
}

function buildClawCloudModelPlannerDecision(input: {
  intent: IntentType;
  responseMode: ResponseMode;
  availableCandidates: number;
}): ClawCloudModelPlannerDecision {
  const highStakes = isHighStakesIntent(input.intent);
  const isDeep = input.responseMode === "deep";
  const isFast = input.responseMode === "fast";
  const canJudge = input.availableCandidates > 1;

  let targetResponses = 1;
  let judgeEnabled = false;

  // Fast mode: ALWAYS single-pass — speed is paramount
  if (isFast) {
    targetResponses = 1;
    judgeEnabled = false;
  } else if (highStakes && canJudge) {
    targetResponses = Math.min(input.availableCandidates, isDeep ? 3 : 2);
    judgeEnabled = true;
  } else if (isDeep && canJudge) {
    targetResponses = Math.min(input.availableCandidates, 2);
    judgeEnabled = true;
  }

  // In single_pass mode, batch size = parallelism (race N models, first wins).
  // In collect_and_judge mode, batch size = max(targetResponses, 2).
  const parallelism = parallelismForIntent(input.intent, input.responseMode);
  const generatorBatchSize = Math.max(
    1,
    Math.min(
      parallelism,
      judgeEnabled ? Math.max(targetResponses, 2) : parallelism,
      input.availableCandidates,
    ),
  );

  return {
    strategy: judgeEnabled ? "collect_and_judge" : "single_pass",
    targetResponses,
    generatorBatchSize,
    judgeEnabled,
    judgeMinRemainingMs: judgeEnabled
      ? (highStakes ? (isDeep ? 6_500 : 4_500) : 3_500)
      : 0,
    allowLowConfidenceWinner: !highStakes,
    disagreementThreshold: highStakes ? 0.48 : 0.36,
  };
}

function buildJudgeCandidatesForIntent(intent: IntentType, responseMode: ResponseMode): ModelCandidate[] {
  const healthScope = `judge:${responseMode}:${intent}`;
  const rankedModels = prioritizeHealthyModels(
    reorderModels(
      filterModelsByConfiguredProviders(uniqueModels([...reasoningModels(), ...chatModels(), ...globalModels()])),
      preferredModelsForIntent(intent, responseMode),
    ),
    healthScope,
  );

  return rankedModels.slice(0, 3).map((model) => ({
    model,
    timeoutMs: Math.max(4_000, Math.floor(timeoutForIntent(intent, responseMode) * 0.75)),
    tier: "reasoning",
    healthKey: `${healthScope}:${model}`,
  }));
}

function extractFirstJsonObject(raw: string) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced?.startsWith("{") && fenced.endsWith("}")) {
    return fenced;
  }

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1).trim();
}

function parseJudgeDecision(raw: string, candidateCount: number): ModelJudgeDecision | null {
  const json = extractFirstJsonObject(raw);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json) as {
      winner?: string;
      confidence?: string;
      materialDisagreement?: boolean;
      needsClarification?: boolean;
      reason?: string;
    };
    const winner = (parsed.winner ?? "").trim().toUpperCase();
    const winnerIndex = winner.charCodeAt(0) - 65;
    if (!Number.isInteger(winnerIndex) || winnerIndex < 0 || winnerIndex >= candidateCount) {
      return null;
    }

    const confidence = parsed.confidence === "high" || parsed.confidence === "medium" || parsed.confidence === "low"
      ? parsed.confidence
      : "low";

    return {
      winnerIndex,
      confidence,
      materialDisagreement: Boolean(parsed.materialDisagreement),
      needsClarification: Boolean(parsed.needsClarification),
      reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
    };
  } catch {
    return null;
  }
}

async function runCandidateCollectionBatch(input: {
  messages: Msg[];
  maxTokens: number;
  temperature: number;
  candidates: ModelCandidate[];
  userQuestion: string;
  intent: IntentType;
  responseMode: ResponseMode;
}): Promise<{
  successes: ModelGenerationResult[];
  failures: ClawCloudModelCandidateTrace[];
}> {
  type BatchAttemptResult =
    | { ok: true; result: ModelGenerationResult }
    | {
      ok: false;
      trace: ClawCloudModelCandidateTrace & {
        status: "failed";
        heuristicScore: null;
        preview: null;
      };
    };

  for (const candidate of input.candidates) {
    console.log(`[ai] trying ${candidate.model}`);
  }

  const attempts: Array<Promise<BatchAttemptResult>> = input.candidates.map(async (candidate) => {
    const startedAt = Date.now();
    const callResult = await _call(
      input.messages,
      input.maxTokens,
      candidate.model,
      candidate.timeoutMs,
      input.responseMode,
      input.temperature,
    );
    const latencyMs = Date.now() - startedAt;
    const out = callResult.content;

    if (out) {
      markModelSuccess(candidate.healthKey);
      const selection = evaluateGeneratedCandidateSelection({
        intent: input.intent,
        question: input.userQuestion,
        answer: out,
      });
      return {
        ok: true as const,
        result: {
          candidate,
          out,
          latencyMs,
          heuristicScore: scoreClawCloudModelResponse({
            intent: input.intent,
            response: out,
            userQuestion: input.userQuestion,
          }),
          preview: buildCandidatePreview(out),
          selectionIssues: selection.issues,
          selectionPenalty: selection.selectionPenalty,
          isStructurallyValid: selection.isStructurallyValid,
        },
      };
    }

    if (!callResult.cancelled) {
      markModelFailure(candidate.healthKey, callResult.cooldownMs);
      console.warn(`[ai] ${candidate.model} failed, trying next model...`);
    }
    return {
      ok: false as const,
      trace: {
        model: candidate.model,
        tier: candidate.tier,
        status: "failed" as const,
        latencyMs,
        heuristicScore: null,
        preview: null,
      },
    };
  });

  const settled = await Promise.all(attempts);
  const successes: ModelGenerationResult[] = [];
  const failures: ClawCloudModelCandidateTrace[] = [];

  for (const entry of settled) {
    if (entry.ok) {
      successes.push(entry.result);
    } else {
      failures.push(entry.trace);
    }
  }

  return { successes, failures };
}

async function judgeGeneratedCandidates(input: {
  intent: IntentType;
  responseMode: ResponseMode;
  userQuestion: string;
  systemPrompt: string;
  candidates: ModelGenerationResult[];
  deadlineMs: number;
}): Promise<ClawCloudModelJudgeTrace> {
  const judgeCandidates = buildJudgeCandidatesForIntent(input.intent, input.responseMode);
  const judgeSystem = [
    "You are ClawCloud's final answer judge.",
    "Select the single best candidate answer for the user.",
    "Optimize for correctness, completeness, instruction-following, safety, and groundedness.",
    "If the candidates materially disagree on facts or numbers and none is clearly reliable, set needsClarification to true and confidence to low.",
    "Return strict JSON only in this exact shape:",
    '{"winner":"A","confidence":"high|medium|low","materialDisagreement":true,"needsClarification":false,"reason":"short reason"}',
  ].join("\n");
  const candidateBody = input.candidates
    .slice(0, 3)
    .map((candidate, index) => {
      const label = String.fromCharCode(65 + index);
      return [
        `Candidate ${label}`,
        `Model: ${candidate.candidate.model}`,
        `Heuristic score: ${candidate.heuristicScore}`,
        `Validation: ${candidate.isStructurallyValid ? "VALID" : `ISSUES -> ${candidate.selectionIssues.join(", ")}`}`,
        candidate.out.slice(0, 2_200),
      ].join("\n");
    })
    .join("\n\n");
  const judgeUser = [
    `Intent: ${input.intent}`,
    `Mode: ${input.responseMode}`,
    `User question: ${input.userQuestion}`,
    input.systemPrompt ? `System instructions summary: ${input.systemPrompt.slice(0, 800)}` : null,
    candidateBody,
  ].filter(Boolean).join("\n\n");

  for (const judgeCandidate of judgeCandidates) {
    const remainingMs = input.deadlineMs - Date.now();
    if (remainingMs < 1_500) {
      break;
    }

    const timeoutMs = Math.min(judgeCandidate.timeoutMs, remainingMs);
    const startedAt = Date.now();
    const callResult = await _call(
      [
        { role: "system", content: judgeSystem },
        { role: "user", content: judgeUser },
      ],
      260,
      judgeCandidate.model,
      timeoutMs,
      input.responseMode,
      0,
    );
    const latencyMs = Date.now() - startedAt;
    const raw = callResult.content;

    if (!raw) {
      if (!callResult.cancelled) {
        markModelFailure(judgeCandidate.healthKey, callResult.cooldownMs);
      }
      continue;
    }

    const decision = parseJudgeDecision(raw, Math.min(input.candidates.length, 3));
    if (!decision) {
      markModelFailure(judgeCandidate.healthKey);
      continue;
    }

    markModelSuccess(judgeCandidate.healthKey);
    const winner = input.candidates[decision.winnerIndex];
    console.log(`[ai] judge ${judgeCandidate.model} chose ${winner?.candidate.model ?? "unknown"} in ${latencyMs}ms`);

    return {
      used: true,
      model: judgeCandidate.model,
      winnerModel: winner?.candidate.model ?? null,
      confidence: decision.confidence,
      materialDisagreement: decision.materialDisagreement,
      needsClarification: decision.needsClarification,
      reason: decision.reason || null,
    };
  }

  return {
    used: false,
    model: null,
    winnerModel: null,
    confidence: null,
    materialDisagreement: false,
    needsClarification: false,
    reason: null,
  };
}

function rankGeneratedCandidates(results: ModelGenerationResult[]) {
  return [...results].sort((left, right) => {
    if (right.isStructurallyValid !== left.isStructurallyValid) {
      return Number(right.isStructurallyValid) - Number(left.isStructurallyValid);
    }
    if (left.selectionPenalty !== right.selectionPenalty) {
      return left.selectionPenalty - right.selectionPenalty;
    }
    if (right.heuristicScore !== left.heuristicScore) {
      return right.heuristicScore - left.heuristicScore;
    }
    return right.out.length - left.out.length;
  });
}

function buildCandidateTrace(
  results: ModelGenerationResult[],
  failures: ClawCloudModelCandidateTrace[],
  selectedModel: string | null,
) {
  return [
    ...results.map((result) => ({
      model: result.candidate.model,
      tier: result.candidate.tier,
      status: result.candidate.model === selectedModel ? "selected" as const : "generated" as const,
      latencyMs: result.latencyMs,
      heuristicScore: result.heuristicScore,
      preview: result.preview,
    })),
    ...failures,
  ];
}

async function orchestrateClawCloudPrompt(input: {
  intent: IntentType;
  responseMode: ResponseMode;
  userQuestion: string;
  systemPrompt: string;
  messages: Msg[];
  maxTokens: number;
  temperature: number;
  candidates: ModelCandidate[];
  deadlineMs: number;
}): Promise<{
  answer: string | null;
  trace: ClawCloudModelOrchestrationTrace;
}> {
  const planner = buildClawCloudModelPlannerDecision({
    intent: input.intent,
    responseMode: input.responseMode,
    availableCandidates: input.candidates.length,
  });
  const successes: ModelGenerationResult[] = [];
  const failures: ClawCloudModelCandidateTrace[] = [];

  console.log(
    `[ai] ${input.responseMode} ${input.intent} planner -> ${planner.strategy} target=${planner.targetResponses} judge=${planner.judgeEnabled}`,
  );

  for (let offset = 0; offset < input.candidates.length; offset += planner.generatorBatchSize) {
    const remainingMs = input.deadlineMs - Date.now();
    if (remainingMs < 2_000) {
      break;
    }

    const batch = input.candidates
      .slice(offset, offset + planner.generatorBatchSize)
      .map((candidate) => ({
        ...candidate,
        timeoutMs: Math.min(candidate.timeoutMs, remainingMs),
      }));

    console.log(
      `[ai] ${input.responseMode} ${input.intent} generator batch -> ${batch.map((candidate) => candidate.model).join(" | ")}`,
    );

    if (!planner.judgeEnabled) {
      const batchResult = await runCandidateBatch({
        messages: input.messages,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        candidates: batch,
        intent: input.intent,
        responseMode: input.responseMode,
        userQuestion: input.userQuestion,
      });

      failures.push(...batchResult.failures);

      if (batchResult.winner) {
        successes.push(batchResult.winner);
        return {
          answer: batchResult.winner.out,
          trace: {
            intent: input.intent,
            responseMode: input.responseMode,
            planner,
            selectedBy: "single_success",
            selectedModel: batchResult.winner.candidate.model,
            candidates: buildCandidateTrace(successes, failures, batchResult.winner.candidate.model),
            judge: null,
          },
        };
      }

      continue;
    }

    const batchResult = await runCandidateCollectionBatch({
      messages: input.messages,
      maxTokens: input.maxTokens,
      temperature: input.temperature,
      candidates: batch,
      userQuestion: input.userQuestion,
      intent: input.intent,
      responseMode: input.responseMode,
    });

    successes.push(...batchResult.successes);
    failures.push(...batchResult.failures);

    if (successes.length >= planner.targetResponses) {
      break;
    }
  }

  if (!successes.length) {
    return {
      answer: null,
      trace: {
        intent: input.intent,
        responseMode: input.responseMode,
        planner,
        selectedBy: "fallback",
        selectedModel: null,
        candidates: buildCandidateTrace(successes, failures, null),
        judge: null,
      },
    };
  }

  const ranked = rankGeneratedCandidates(successes);
  const validRanked = ranked.filter((candidate) => candidate.isStructurallyValid);
  const heuristicWinner = validRanked[0] ?? ranked[0] ?? null;
  const scoreGap = validRanked.length > 1
    ? (validRanked[0]?.heuristicScore ?? 0) - (validRanked[1]?.heuristicScore ?? 0)
    : ranked.length > 1
      ? (ranked[0]?.heuristicScore ?? 0) - (ranked[1]?.heuristicScore ?? 0)
    : Number.POSITIVE_INFINITY;
  const materialDisagreement = detectMaterialCandidateDisagreement({
    intent: input.intent,
    candidates: (validRanked.length >= 2 ? validRanked : ranked).map((candidate) => ({
      out: candidate.out,
      heuristicScore: candidate.heuristicScore,
      isStructurallyValid: candidate.isStructurallyValid,
      selectionPenalty: candidate.selectionPenalty,
    })),
    threshold: planner.disagreementThreshold,
  });

  let selected = heuristicWinner;
  let selectedBy: ClawCloudModelOrchestrationTrace["selectedBy"] = "heuristic";
  let judgeTrace: ClawCloudModelJudgeTrace | null = null;
  const candidatePoolForJudge = validRanked.length ? validRanked : ranked;

  const shouldInvokeJudge = planner.judgeEnabled
    && candidatePoolForJudge.length > 1
    && (
      materialDisagreement
      || input.responseMode === "deep"
      || scoreGap < 8
      || isHighStakesIntent(input.intent)
    )
    && (input.deadlineMs - Date.now()) >= planner.judgeMinRemainingMs;

  if (shouldInvokeJudge) {
    const evaluatedCandidates = candidatePoolForJudge.slice(0, Math.min(candidatePoolForJudge.length, 3));
    judgeTrace = await judgeGeneratedCandidates({
      intent: input.intent,
      responseMode: input.responseMode,
      userQuestion: input.userQuestion,
      systemPrompt: input.systemPrompt,
      candidates: evaluatedCandidates,
      deadlineMs: input.deadlineMs,
    });

    if (judgeTrace.used && judgeTrace.winnerModel) {
      selected = evaluatedCandidates.find((candidate) => candidate.candidate.model === judgeTrace?.winnerModel) ?? heuristicWinner;
      selectedBy = "judge";
    }
  } else if (planner.judgeEnabled) {
    judgeTrace = {
      used: false,
      model: null,
      winnerModel: null,
      confidence: null,
      materialDisagreement,
      needsClarification: false,
      reason: "Judge skipped because heuristic winner was already clear within the remaining budget.",
    };
  }

  if ((!selected || !selected.isStructurallyValid) && validRanked.length) {
    selected = validRanked[0] ?? selected;
    selectedBy = "heuristic";
  }

  const hasCompetingValidAnswers = validRanked.length > 1;
  const judgeConfidenceLow = judgeTrace?.used
    ? judgeTrace.confidence === "low" || judgeTrace.needsClarification
    : false;
  const heuristicConfidenceLow = hasCompetingValidAnswers && materialDisagreement && scoreGap < 8;
  const unresolvedHighStakesTieWithoutJudge = (
    hasCompetingValidAnswers
    && materialDisagreement
    && !judgeTrace?.used
    && isHighStakesIntent(input.intent)
    && scoreGap < 12
  );
  const unresolvedConflict = (
    hasCompetingValidAnswers
    && materialDisagreement
    && (
      judgeConfidenceLow
      || heuristicConfidenceLow
      || unresolvedHighStakesTieWithoutJudge
    )
  );
  const hasValidWinner = Boolean(selected?.isStructurallyValid);
  const canShipSelectedAnswer = hasValidWinner && !unresolvedConflict;
  const selectedAnswer = canShipSelectedAnswer ? (selected?.out?.trim() ?? null) : null;
  const selectedModel = canShipSelectedAnswer ? (selected?.candidate.model ?? null) : null;

  return {
    answer: selectedAnswer,
    trace: {
      intent: input.intent,
      responseMode: input.responseMode,
      planner,
      selectedBy: canShipSelectedAnswer ? selectedBy : "fallback",
      selectedModel,
      candidates: buildCandidateTrace(successes, failures, selectedModel),
      judge: judgeTrace ?? (planner.judgeEnabled ? {
        used: false,
        model: null,
        winnerModel: null,
        confidence: null,
        materialDisagreement,
        needsClarification: false,
        reason: null,
      } : null),
    },
  };
}

// Core API call

// OpenAI model prefixes — routed to api.openai.com instead of NVIDIA
const OPENAI_MODEL_PREFIXES = ["gpt-", "o1-", "o3-", "o4-", "chatgpt-"];
const OPENAI_RESPONSES_MODEL_PATTERNS = [/^gpt-5/i, /^o[134]/i, /^chatgpt-/i];
const NVIDIA_NO_SYSTEM_ROLE_PATTERNS = [/^google\/gemma/i];
const INVALID_MODEL_COOLDOWN_MS = 30 * 60 * 1000;
function isOpenAIModel(model: string) {
  return OPENAI_MODEL_PREFIXES.some((p) => model.startsWith(p));
}

function prefersOpenAIResponsesApi(model: string) {
  return OPENAI_RESPONSES_MODEL_PATTERNS.some((pattern) => pattern.test(model));
}

function isOpenAIReasoningModel(model: string) {
  return prefersOpenAIResponsesApi(model);
}

function isOpenAIProReasoningModel(model: string) {
  return isOpenAIReasoningModel(model) && /(?:^|[-.])pro$/i.test(model);
}

function openAIReasoningEffortForModel(
  model: string,
  responseMode: ResponseMode,
): "low" | "medium" | "high" | "xhigh" | undefined {
  if (!isOpenAIReasoningModel(model)) {
    return undefined;
  }

  if (isOpenAIProReasoningModel(model)) {
    return "high";
  }

  if (/^gpt-5\.(?:2|4)/i.test(model)) {
    return responseMode === "deep" ? "high" : "low";
  }

  if (/^gpt-5/i.test(model)) {
    return responseMode === "deep" ? "medium" : "low";
  }

  if (/^o[134]/i.test(model)) {
    return responseMode === "deep" ? "medium" : "low";
  }

  return responseMode === "deep" ? "medium" : "low";
}

function openAIModelSupportsSampling(model: string, responseMode: ResponseMode) {
  return !openAIReasoningEffortForModel(model, responseMode);
}

function nvidiaModelSupportsSystemRole(model: string) {
  return !NVIDIA_NO_SYSTEM_ROLE_PATTERNS.some((pattern) => pattern.test(model));
}

function collapseSystemMessagesIntoUserTurn(messages: Msg[]) {
  const systemInstruction = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
  const nonSystemMessages = messages.filter((message) => message.role !== "system");

  if (!systemInstruction) {
    return nonSystemMessages;
  }

  return [
    {
      role: "user" as const,
      content: `Follow these instructions exactly:\n${systemInstruction}`,
    },
    ...nonSystemMessages,
  ];
}

function coalesceAdjacentMessages(messages: Msg[]) {
  const merged: Msg[] = [];

  for (const message of messages) {
    const content = message.content.trim();
    if (!content) {
      continue;
    }

    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content = `${last.content}\n\n${content}`.trim();
      continue;
    }

    merged.push({
      role: message.role,
      content,
    });
  }

  return merged;
}

function buildProviderMessages(model: string, messages: Msg[]) {
  if (isOpenAIModel(model)) {
    return messages;
  }

  const providerMessages = nvidiaModelSupportsSystemRole(model)
    ? messages
    : collapseSystemMessagesIntoUserTurn(messages);

  return coalesceAdjacentMessages(providerMessages);
}

function buildOpenAIResponsesBody(
  messages: Msg[],
  maxTokens: number,
  model: string,
  temperature: number,
  responseMode: ResponseMode,
) {
  const instructions = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim() || undefined;

  const input = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role,
      content: message.content,
    }));

  const body: Record<string, unknown> = {
    model,
    instructions,
    input: input.length ? input : [{ role: "user" as const, content: "Respond briefly." }],
    max_output_tokens: maxTokens,
  };

  const reasoningEffort = openAIReasoningEffortForModel(model, responseMode);
  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  if (openAIModelSupportsSampling(model, responseMode)) {
    body.temperature = temperature;
    body.top_p = 0.95;
  }

  return body;
}

function buildOpenAIChatBody(
  messages: Msg[],
  maxTokens: number,
  model: string,
  temperature: number,
  responseMode: ResponseMode,
) {
  const body: Record<string, unknown> = {
    model,
    max_completion_tokens: maxTokens,
    messages,
  };

  const reasoningEffort = openAIReasoningEffortForModel(model, responseMode);
  if (reasoningEffort) {
    body.reasoning_effort = reasoningEffort;
  }

  if (openAIModelSupportsSampling(model, responseMode)) {
    body.temperature = temperature;
    body.top_p = 0.95;
  }

  return body;
}

function buildNvidiaChatBody(
  messages: Msg[],
  maxTokens: number,
  model: string,
  temperature: number,
) {
  return {
    model,
    max_tokens: maxTokens,
    temperature,
    top_p: 0.95,
    messages,
  };
}

function extractChatCompletionText(data: ChatCompletionResp) {
  const raw = data.choices?.[0]?.message?.content;
  if (typeof raw === "string") {
    return raw.trim() || null;
  }

  if (Array.isArray(raw)) {
    const joined = raw
      .map((part) => part?.text ?? "")
      .join("")
      .trim();
    return joined || null;
  }

  return null;
}

function extractResponsesApiText(data: OpenAIResponsesResp) {
  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const joined = (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part?.text ?? "")
    .join("")
    .trim();

  return joined || null;
}

function shouldRetryOpenAIWithAlternateTransport(status: number, bodyText: string) {
  const normalized = bodyText.toLowerCase();
  return (
    status === 400 || status === 404
  ) && (
    normalized.includes("v1/chat/completions")
    || normalized.includes("v1/responses")
    || normalized.includes("max_completion_tokens")
    || normalized.includes("max_output_tokens")
    || normalized.includes("unsupported parameter")
    || normalized.includes("not supported in")
  );
}

function inferFailureCooldownMs(status: number, bodyText: string) {
  const normalized = bodyText.toLowerCase();
  const looksLikeContractMismatch = (
    normalized.includes("v1/chat/completions")
    || normalized.includes("v1/responses")
    || normalized.includes("max_completion_tokens")
    || normalized.includes("max_output_tokens")
    || normalized.includes("unsupported parameter")
  );

  if (
    (status === 400 || status === 404)
    && /"param"\s*:\s*"model"/.test(normalized)
    && !looksLikeContractMismatch
  ) {
    return INVALID_MODEL_COOLDOWN_MS;
  }

  return undefined;
}

async function executeJsonModelRequest(input: {
  model: string;
  url: string;
  apiKey: string;
  body: unknown;
  timeoutMs: number;
  signal: AbortSignal;
  timedOutRef: { current: boolean };
  cancelledRef: { current: boolean };
  parse: (data: unknown) => string | null;
}): Promise<AiCallResult> {
  const callStartMs = Date.now();
  console.log(`[ai] calling ${input.model} timeout=${input.timeoutMs}ms url=${input.url}`);

  try {
    const res = await fetch(input.url, {
      method: "POST",
      signal: input.signal,
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input.body),
    });

    const callLatencyMs = Date.now() - callStartMs;
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[ai] ${res.status} ${input.model} (${callLatencyMs}ms): ${txt.slice(0, 300)}`);
      return {
        content: null,
        cooldownMs: inferFailureCooldownMs(res.status, txt),
        retryable: shouldRetryOpenAIWithAlternateTransport(res.status, txt),
      };
    }

    const data = await res.json().catch(() => null);
    const content = input.parse(data)?.trim() ?? null;
    if (!content) {
      console.error(`[ai] empty ${input.model} (${callLatencyMs}ms)`);
      return { content: null };
    }

    console.log(`[ai] ${input.model} OK (${callLatencyMs}ms) len=${content.length}`);
    return { content };
  } catch (error) {
    const callLatencyMs = Date.now() - callStartMs;
    if ((error as Error)?.name === "AbortError") {
      if (input.timedOutRef.current) {
        console.warn(`[ai] timeout on ${input.model} after ${callLatencyMs}ms (limit=${input.timeoutMs}ms)`);
      } else if (!input.cancelledRef.current) {
        console.warn(`[ai] cancelled ${input.model} after ${callLatencyMs}ms`);
      }
      return { content: null, cancelled: !input.timedOutRef.current };
    }

    console.error(`[ai] error on ${input.model} after ${callLatencyMs}ms:`, error);
    return { content: null };
  }
}

async function _call(
  messages: Msg[],
  maxTokens: number,
  model: string,
  timeoutMs: number,
  responseMode: ResponseMode,
  temperature = 0.2,
  signal?: AbortSignal,
): Promise<AiCallResult> {
  const useOpenAI = isOpenAIModel(model);

  if (useOpenAI && !env.OPENAI_API_KEY) return { content: null };
  if (!useOpenAI && !env.NVIDIA_API_KEY) return { content: null };

  const ctrl = new AbortController();
  const timedOutRef = { current: false };
  const cancelledRef = { current: false };
  const onAbort = () => {
    cancelledRef.current = true;
    ctrl.abort();
  };
  if (signal?.aborted) {
    cancelledRef.current = true;
    ctrl.abort();
  } else if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOutRef.current = true;
    ctrl.abort();
  }, timeoutMs);

  try {
    if (useOpenAI) {
      const apiKey = env.OPENAI_API_KEY!;
      const primaryTransport = prefersOpenAIResponsesApi(model) ? "responses" : "chat";
      const attempts = primaryTransport === "responses"
        ? [
            {
              url: "https://api.openai.com/v1/responses",
              body: buildOpenAIResponsesBody(messages, maxTokens, model, temperature, responseMode),
              parse: (data: unknown) => extractResponsesApiText(data as OpenAIResponsesResp),
              kind: "responses" as const,
            },
            {
              url: "https://api.openai.com/v1/chat/completions",
              body: buildOpenAIChatBody(messages, maxTokens, model, temperature, responseMode),
              parse: (data: unknown) => extractChatCompletionText(data as ChatCompletionResp),
              kind: "chat" as const,
            },
          ]
        : [
            {
              url: "https://api.openai.com/v1/chat/completions",
              body: buildOpenAIChatBody(messages, maxTokens, model, temperature, responseMode),
              parse: (data: unknown) => extractChatCompletionText(data as ChatCompletionResp),
              kind: "chat" as const,
            },
            {
              url: "https://api.openai.com/v1/responses",
              body: buildOpenAIResponsesBody(messages, maxTokens, model, temperature, responseMode),
              parse: (data: unknown) => extractResponsesApiText(data as OpenAIResponsesResp),
              kind: "responses" as const,
            },
          ];

      let lastFailure: AiCallResult = { content: null };
      for (let index = 0; index < attempts.length; index += 1) {
        const attempt = attempts[index]!;
        const result = await executeJsonModelRequest({
          model,
          url: attempt.url,
          apiKey,
          body: attempt.body,
          timeoutMs,
          signal: ctrl.signal,
          timedOutRef,
          cancelledRef,
          parse: attempt.parse,
        });

        if (result.content || result.cancelled || timedOutRef.current) {
          return result;
        }

        lastFailure = result;
        if (index === attempts.length - 1) {
          break;
        }

        if (!result.retryable) {
          break;
        }
      }

      return lastFailure;
    }

    const base = (env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1")
      .replace(/\/+$/, "")
      .replace(/\/chat\/completions$/i, "")
      .replace(/\/embeddings$/i, "");
    const url = `${/\/v\d+$/i.test(base) ? base : `${base}/v1`}/chat/completions`;
    return await executeJsonModelRequest({
      model,
      url,
      apiKey: env.NVIDIA_API_KEY!,
      body: buildNvidiaChatBody(buildProviderMessages(model, messages), maxTokens, model, temperature),
      timeoutMs,
      signal: ctrl.signal,
      timedOutRef,
      cancelledRef,
      parse: (data: unknown) => extractChatCompletionText(data as ChatCompletionResp),
    });
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

async function runCandidateBatch(input: {
  messages: Msg[];
  maxTokens: number;
  temperature: number;
  candidates: ModelCandidate[];
  intent: IntentType;
  responseMode: ResponseMode;
  userQuestion: string;
}): Promise<{
  winner: ModelGenerationResult | null;
  failures: ClawCloudModelCandidateTrace[];
}> {
  type CandidateBatchSuccess = {
    ok: true;
    index: number;
    result: ModelGenerationResult;
  };
  type CandidateBatchFailure = {
    ok: false;
    index: number;
    trace: ClawCloudModelCandidateTrace;
  };

  for (const candidate of input.candidates) {
    console.log(`[ai] trying ${candidate.model}`);
  }

  const controllers = input.candidates.map(() => new AbortController());
  const failures = new Map<number, ClawCloudModelCandidateTrace>();
  const successes: ModelGenerationResult[] = [];

  const attempts = input.candidates.map((candidate, index) => (async () => {
    const startedAt = Date.now();
    const callResult = await _call(
      input.messages,
      input.maxTokens,
      candidate.model,
      candidate.timeoutMs,
      input.responseMode,
      input.temperature,
      controllers[index].signal,
    );
    const latencyMs = Date.now() - startedAt;
    const out = callResult.content;

    if (out) {
      markModelSuccess(candidate.healthKey);
      const selection = evaluateGeneratedCandidateSelection({
        intent: input.intent,
        question: input.userQuestion,
        answer: out,
      });
      return {
        ok: true as const,
        index,
        result: {
          candidate,
          out,
          latencyMs,
          heuristicScore: scoreClawCloudModelResponse({
            intent: input.intent,
            response: out,
            userQuestion: input.userQuestion,
          }),
          preview: buildCandidatePreview(out),
          selectionIssues: selection.issues,
          selectionPenalty: selection.selectionPenalty,
          isStructurallyValid: selection.isStructurallyValid,
        },
      } satisfies CandidateBatchSuccess;
    }

    if (!callResult.cancelled && !controllers[index].signal.aborted) {
      markModelFailure(candidate.healthKey, callResult.cooldownMs);
      console.warn(`[ai] ${candidate.model} failed, trying next model...`);
    }
    return {
      ok: false as const,
      index,
      trace: {
        model: candidate.model,
        tier: candidate.tier,
        status: "failed" as const,
        latencyMs,
        heuristicScore: null,
        preview: null,
      },
    } satisfies CandidateBatchFailure;
  })());

  const pending = new Map(
    attempts.map((attempt, index) => [
      index,
      attempt.then((result) => ({ index, result })),
    ]),
  );

  while (pending.size) {
    const settled = await Promise.race(pending.values());
    pending.delete(settled.index);

    if (settled.result.ok) {
      const winner = settled.result.result;
      successes.push(winner);

      if (winner.isStructurallyValid) {
        for (let index = 0; index < controllers.length; index += 1) {
          if (index !== settled.result.index) {
            controllers[index].abort();
          }
        }
        return {
          winner,
          failures: [...failures.values()],
        };
      }

      continue;
    }

    failures.set(settled.index, settled.result.trace);
  }

  for (const controller of controllers) {
    controller.abort();
  }

  return {
    winner: pickBestValidGeneratedCandidate(successes),
    failures: [...failures.values()],
  };
}

export async function completeClawCloudPrompt(input: {
  user: string;
  system?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  intent?: IntentType;
  responseMode?: ResponseMode;
  preferredModels?: string[];
  fallback: string;
  skipCache?: boolean;
  temperature?: number;
}): Promise<string> {
  const result = await completeClawCloudPromptWithTrace(input);
  return result.answer;
}

export async function completeClawCloudPromptWithTrace(input: {
  user: string;
  system?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  intent?: IntentType;
  responseMode?: ResponseMode;
  preferredModels?: string[];
  fallback: string;
  skipCache?: boolean;
  temperature?: number;
  userId?: string;
}): Promise<ClawCloudPromptCompletionResult> {
  const traceId = generateTraceId();
  const requestStartedAt = Date.now();
  const availability = resolveProviderAvailability();

  if (!hasAnyAiProviderConfigured(availability)) {
    logWarn("ai-engine", "no_api_key", { traceId });
    return {
      answer: input.fallback,
      trace: null,
    };
  }

  const intent = input.intent ?? "general";
  const responseMode = input.responseMode ?? "fast";

  // ── SAFETY FILTER — screen input before generation ──
  const safetyVerdict = screenInput(input.user);
  if (!safetyVerdict.allowed) {
    logSafetyBlock(input.userId ?? "unknown", safetyVerdict.category, safetyVerdict.reason);
    return {
      answer: buildSafeRefusal(safetyVerdict),
      trace: null,
    };
  }
  if (safetyVerdict.category === "prompt_injection") {
    logWarn("safety-filter", "prompt_injection_detected", { traceId, category: safetyVerdict.category });
  }

  incrementActiveRequests();

  try {
    const extraGuardrails = QUALITY_GUARDRAILS[intent];
    const mergedSystem = mergeClawCloudSystemPrompt(input.system, extraGuardrails);

    const useCache = !input.skipCache && !input.history?.length;
    const ck = _ck(mergedSystem, input.user);
    if (useCache) {
      const hit = _get(ck);
      if (hit) {
        logCacheHit(intent, ck);
        recordCacheHit(intent);
        return {
          answer: hit,
          trace: null,
        };
      }
      recordCacheMiss(intent);
    }

    const msgs: Msg[] = [];
    if (mergedSystem) msgs.push({ role: "system", content: mergedSystem });

    if (input.history?.length) {
      const historyLimit = historyLimitForIntent(intent, responseMode);
      const historyCharLimit = historyCharLimitForIntent(intent, responseMode);
      for (const message of input.history.slice(-historyLimit)) {
        msgs.push({ role: message.role, content: message.content.slice(0, historyCharLimit) });
      }
    }

    msgs.push({ role: "user", content: input.user });
    const tokens = input.maxTokens ?? tokenBudgetForIntent(intent, responseMode);
    const temperature =
      input.temperature ?? (
        intent === "coding" || intent === "math" || intent === "finance" ? 0.08
        : intent === "creative" ? 0.35
        : intent === "greeting" ? 0.4
        : intent === "research" || intent === "science" || intent === "law" || intent === "health" ? 0.12
        : 0.18
      );

    // ── PERFORMANCE-BASED MODEL REORDERING ──
    const candidates = modelCandidatesForIntent(intent, responseMode, input.preferredModels, availability);
    const reorderedModels = reorderModelsByPerformance(
      candidates.map((c) => c.model),
      intent,
      responseMode,
    );
    // Apply performance reordering while keeping candidate metadata
    const orderedCandidates = reorderedModels
      .map((model) => candidates.find((c) => c.model === model))
      .filter((c): c is ModelCandidate => c !== undefined);
    const finalCandidates = orderedCandidates.length ? orderedCandidates : candidates;

    // Apply adaptive timeouts learned from actual latency data
    for (const c of finalCandidates) {
      c.timeoutMs = getAdaptiveTimeout(c.model, intent, responseMode, c.timeoutMs);
    }

    const deadline = Date.now() + maxTotalMsForIntent(intent, responseMode);

    logInfo("ai-engine", "orchestration_start", {
      traceId, intent, responseMode,
      candidateCount: finalCandidates.length,
      models: finalCandidates.map((c) => c.model),
    });

    const orchestration = await orchestrateClawCloudPrompt({
      intent,
      responseMode,
      userQuestion: input.user,
      systemPrompt: mergedSystem,
      messages: msgs,
      maxTokens: tokens,
      temperature,
      candidates: finalCandidates,
      deadlineMs: deadline,
    });

    if (!orchestration.answer) {
      logWarn("ai-engine", "all_models_failed", { traceId, intent, responseMode });
      recordFallback(intent);
    }

    if (!orchestration.answer) {
      return {
        answer: input.fallback,
        trace: orchestration.trace,
      };
    }

    // ── OUTPUT SAFETY FILTER — screen response after generation ──
    const outputVerdict = screenOutput(orchestration.answer);
    if (!outputVerdict.safe) {
      logWarn("safety-filter", "output_blocked", { traceId, category: outputVerdict.category, issues: outputVerdict.issues });
      return {
        answer: input.fallback,
        trace: orchestration.trace,
      };
    }

    // Sanitize output (redact leaked credentials)
    const sanitized = sanitizeOutput(orchestration.answer);

    // Record metrics
    const responseTimeMs = Date.now() - requestStartedAt;
    recordIntentQuery(intent, responseTimeMs);

    // Record model performance for persistence-based ranking
    if (orchestration.trace?.selectedModel) {
      recordModelPerformance({
        model: orchestration.trace.selectedModel,
        intent,
        responseMode,
        success: true,
        latencyMs: responseTimeMs,
        heuristicScore: orchestration.trace.candidates.find(
          (c) => c.model === orchestration.trace?.selectedModel,
        )?.heuristicScore ?? undefined,
        isJudgeWin: orchestration.trace.selectedBy === "judge",
      });
    }

    if (useCache) _set(ck, sanitized);
    return {
      answer: sanitized,
      trace: orchestration.trace,
    };
  } finally {
    decrementActiveRequests();
  }
}

export function buildClawCloudModelPlannerDecisionForTest(input: {
  intent: IntentType;
  responseMode: ResponseMode;
  availableCandidates: number;
}) {
  return buildClawCloudModelPlannerDecision(input);
}

export function scoreClawCloudModelResponseForTest(input: {
  intent: IntentType;
  response: string;
  userQuestion?: string;
}) {
  return scoreClawCloudModelResponse(input);
}

export function detectMaterialCandidateDisagreementForTest(input: {
  intent: IntentType;
  responses: string[];
}) {
  return detectMaterialCandidateDisagreement({
    intent: input.intent,
    candidates: input.responses.map((response) => ({
      out: response,
      heuristicScore: scoreClawCloudModelResponse({
        intent: input.intent,
        response,
      }),
    })),
  });
}

export function chooseClawCloudCandidateForTest(input: {
  intent: IntentType;
  responseMode: ResponseMode;
  userQuestion: string;
  responses: Array<{ response: string; model?: string; tier?: ModelTier }>;
  judgeDecision?: Partial<ModelJudgeDecision> & { winnerIndex: number };
}) {
  const generated = input.responses.map((entry, index) => {
    const selection = evaluateGeneratedCandidateSelection({
      intent: input.intent,
      question: input.userQuestion,
      answer: entry.response,
    });
    return {
      candidate: {
        model: entry.model ?? `test-model-${index + 1}`,
        timeoutMs: 2_000,
        tier: entry.tier ?? "chat",
        healthKey: `test:${index + 1}`,
      },
      out: entry.response,
      latencyMs: 100 + index,
      heuristicScore: scoreClawCloudModelResponse({
        intent: input.intent,
        response: entry.response,
        userQuestion: input.userQuestion,
      }),
      preview: buildCandidatePreview(entry.response),
      selectionIssues: selection.issues,
      selectionPenalty: selection.selectionPenalty,
      isStructurallyValid: selection.isStructurallyValid,
    };
  });
  const planner = buildClawCloudModelPlannerDecision({
    intent: input.intent,
    responseMode: input.responseMode,
    availableCandidates: generated.length,
  });
  const ranked = rankGeneratedCandidates(generated);
  const validRanked = ranked.filter((candidate) => candidate.isStructurallyValid);
  const heuristicWinner = validRanked[0] ?? ranked[0] ?? null;
  const scoreGap = validRanked.length > 1
    ? (validRanked[0]?.heuristicScore ?? 0) - (validRanked[1]?.heuristicScore ?? 0)
    : ranked.length > 1
      ? (ranked[0]?.heuristicScore ?? 0) - (ranked[1]?.heuristicScore ?? 0)
    : Number.POSITIVE_INFINITY;
  const materialDisagreement = detectMaterialCandidateDisagreement({
    intent: input.intent,
    candidates: (validRanked.length >= 2 ? validRanked : ranked).map((candidate) => ({
      out: candidate.out,
      heuristicScore: candidate.heuristicScore,
      isStructurallyValid: candidate.isStructurallyValid,
      selectionPenalty: candidate.selectionPenalty,
    })),
    threshold: planner.disagreementThreshold,
  });

  let selected = heuristicWinner;
  let selectedBy: ClawCloudModelOrchestrationTrace["selectedBy"] = planner.judgeEnabled ? "heuristic" : "single_success";
  const candidatePoolForJudge = validRanked.length ? validRanked : ranked;

  if (input.judgeDecision) {
    const judged = candidatePoolForJudge[input.judgeDecision.winnerIndex] ?? null;
    if (judged) {
      selected = judged;
      selectedBy = "judge";
    }
  }

  if ((!selected || !selected.isStructurallyValid) && validRanked.length) {
    selected = validRanked[0] ?? selected;
    selectedBy = "heuristic";
  }

  const hasCompetingValidAnswers = validRanked.length > 1;
  const judgeConfidenceLow = input.judgeDecision
    ? input.judgeDecision.confidence === "low" || Boolean(input.judgeDecision.needsClarification)
    : false;
  const heuristicConfidenceLow = hasCompetingValidAnswers && materialDisagreement && scoreGap < 8;
  const unresolvedHighStakesTieWithoutJudge = (
    hasCompetingValidAnswers
    && materialDisagreement
    && !input.judgeDecision
    && isHighStakesIntent(input.intent)
    && scoreGap < 12
  );
  const unresolvedConflict = (
    hasCompetingValidAnswers
    && materialDisagreement
    && (
      judgeConfidenceLow
      || heuristicConfidenceLow
      || unresolvedHighStakesTieWithoutJudge
    )
  );
  const selectedIndex = selected?.isStructurallyValid && !unresolvedConflict
    ? generated.findIndex((candidate) => candidate.candidate.model === selected?.candidate.model)
    : null;

  return {
    planner,
    selectedIndex,
    selectedBy: selectedIndex !== null ? selectedBy : "fallback",
    materialDisagreement,
    scores: generated.map((candidate) => candidate.heuristicScore),
  };
}

export function buildClawCloudModelCandidatesForTest(input: {
  intent: IntentType;
  responseMode?: ResponseMode;
  preferredModels?: string[];
  providerAvailability?: Partial<ProviderAvailability>;
}) {
  const availability = {
    ...resolveProviderAvailability(),
    ...input.providerAvailability,
  };

  return modelCandidatesForIntent(
    input.intent,
    input.responseMode ?? "fast",
    input.preferredModels,
    availability,
  ).map((candidate) => candidate.model);
}

// Fast path for instant acknowledgements

export async function completeClawCloudFast(input: {
  user: string;
  system?: string;
  maxTokens?: number;
  fallback: string;
}): Promise<string> {
  const availability = resolveProviderAvailability();
  if (!hasAnyAiProviderConfigured(availability)) return input.fallback;

  const msgs: Msg[] = [];
  const mergedSystem = mergeClawCloudSystemPrompt(input.system);
  if (mergedSystem) msgs.push({ role: "system", content: mergedSystem });
  msgs.push({ role: "user", content: input.user });

  const ackCandidates: ModelCandidate[] = [];
  appendCandidates(
    ackCandidates,
    prioritizeHealthyModels(
      reorderModels(
        filterModelsByConfiguredProviders(fastModels(), availability),
        INTENT_PREFERRED_MODELS.greeting,
      ),
      "greeting",
    ),
    INTENT_TIMEOUT_MS.greeting,
    "fast",
    "greeting",
  );
  appendCandidates(
    ackCandidates,
    prioritizeHealthyModels(
      reorderModels(
        filterModelsByConfiguredProviders(chatModels(), availability),
        INTENT_PREFERRED_MODELS.general,
      ),
      "general",
    ),
    INTENT_TIMEOUT_MS.general,
    "chat",
    "general",
  );

  let out: Awaited<ReturnType<typeof runCandidateBatch>> | null = null;
  const deadline = Date.now() + INTENT_MAX_TOTAL_MS.greeting;
  for (let offset = 0; offset < ackCandidates.length; offset += 2) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 1_500) {
      break;
    }

    const batch = ackCandidates.slice(offset, offset + 2).map((candidate) => ({
      ...candidate,
      timeoutMs: Math.min(candidate.timeoutMs, remainingMs),
    }));
    console.log(
      `[ai] fast-path batch -> ${batch.map((candidate) => candidate.model).join(" | ")}`,
    );
    out = await runCandidateBatch({
      messages: msgs,
      maxTokens: input.maxTokens ?? 150,
      temperature: 0.18,
      candidates: batch,
      intent: "greeting",
      responseMode: "fast",
      userQuestion: input.user,
    });
    if (out.winner?.out) {
      break;
    }
  }

  return out?.winner?.out?.trim() || input.fallback;
}
