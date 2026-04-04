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
// Set these in Vercel env vars:
//   NVIDIA_CHAT_MODEL      = moonshotai/kimi-k2.5
//   NVIDIA_GLOBAL_MODELS   = moonshotai/kimi-k2.5,z-ai/glm5,...
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

const GLOBAL_TOP_MODELS = [
  "moonshotai/kimi-k2.5",
  "z-ai/glm5",
  "mistralai/mistral-large-3-675b-instruct-2512",
  "qwen/qwen3.5-397b-a17b",
  "moonshotai/kimi-k2-instruct-0905",
  "meta/llama-3.1-405b-instruct",
  "deepseek-ai/deepseek-v3.1-terminus",
  "moonshotai/kimi-k2-instruct",
  "qwen/qwen3-coder-480b-a35b-instruct",
  "moonshotai/kimi-k2-thinking",
  "deepseek-ai/deepseek-v3.1",
  "deepseek-ai/deepseek-v3.2",
] as const;

const MODEL_HEALTH = new Map<string, ModelHealthState>();
const MODEL_FAILURE_COOLDOWN_MS = 45_000;
const MODEL_FAILURE_MAX_COOLDOWN_MS = 8 * 60 * 1000;

const INTENT_TIMEOUT_MS: Record<IntentType, number> = {
  greeting: 3_000,
  help: 3_000,
  memory: 3_000,
  reminder: 3_000,
  send_message: 4_000,
  save_contact: 3_500,
  calendar: 4_000,
  general: 8_000,
  email: 7_000,
  spending: 7_000,
  finance: 10_000,
  web_search: 12_000,
  creative: 8_000,
  coding: 10_000,
  math: 10_000,
  research: 10_000,
  science: 8_000,
  history: 8_000,
  geography: 6_000,
  health: 8_000,
  law: 8_000,
  economics: 8_000,
  culture: 6_000,
  sports: 6_000,
  technology: 8_000,
  language: 6_000,
  explain: 8_000,
};

const INTENT_PARALLELISM: Record<IntentType, number> = {
  greeting: 1,
  help: 1,
  memory: 1,
  reminder: 1,
  send_message: 1,
  save_contact: 1,
  calendar: 1,
  general: 2,
  email: 1,
  spending: 1,
  finance: 2,
  web_search: 2,
  creative: 1,
  coding: 2,
  math: 2,
  research: 2,
  science: 2,
  history: 2,
  geography: 1,
  health: 2,
  law: 2,
  economics: 2,
  culture: 1,
  sports: 1,
  technology: 2,
  language: 1,
  explain: 2,
};

const INTENT_MAX_TOTAL_MS: Record<IntentType, number> = {
  greeting: 4_000,
  help: 4_000,
  memory: 4_000,
  reminder: 4_000,
  send_message: 5_000,
  save_contact: 5_000,
  calendar: 6_000,
  general: 12_000,
  email: 10_000,
  spending: 10_000,
  finance: 15_000,
  web_search: 18_000,
  creative: 12_000,
  coding: 15_000,
  math: 14_000,
  research: 16_000,
  science: 12_000,
  history: 10_000,
  geography: 8_000,
  health: 12_000,
  law: 12_000,
  economics: 12_000,
  culture: 10_000,
  sports: 8_000,
  technology: 12_000,
  language: 8_000,
  explain: 14_000,
};

const INTENT_CANDIDATE_LIMIT: Record<IntentType, number> = {
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
  math: 2,
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

const INTENT_PREFERRED_MODELS: Record<IntentType, string[]> = {
  greeting: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.1-8b-instruct",
    "moonshotai/kimi-k2-instruct",
  ],
  help: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.1-8b-instruct",
    "moonshotai/kimi-k2-instruct",
  ],
  memory: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.1-8b-instruct",
    "moonshotai/kimi-k2-instruct",
  ],
  reminder: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.1-8b-instruct",
    "moonshotai/kimi-k2-instruct",
  ],
  send_message: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.1-8b-instruct",
    "moonshotai/kimi-k2-instruct",
  ],
  save_contact: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.1-8b-instruct",
    "moonshotai/kimi-k2-instruct",
  ],
  calendar: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.1-8b-instruct",
    "moonshotai/kimi-k2-instruct",
  ],
  general: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
    "z-ai/glm5",
    "qwen/qwen3.5-397b-a17b",
  ],
  coding: [
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "qwen/qwen3-coder-480b-a35b-instruct",
    "meta/llama-3.1-405b-instruct",
  ],
  math: [
    "z-ai/glm5",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.1-405b-instruct",
    "moonshotai/kimi-k2-thinking",
  ],
  email: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
    "qwen/qwen3.5-397b-a17b",
  ],
  spending: [
    "z-ai/glm5",
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  finance: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "z-ai/glm5",
    "meta/llama-3.1-405b-instruct",
  ],
  web_search: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "z-ai/glm5",
    "meta/llama-3.1-405b-instruct",
  ],
  research: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "z-ai/glm5",
    "meta/llama-3.1-405b-instruct",
  ],
  creative: [
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "qwen/qwen3.5-397b-a17b",
  ],
  science: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  history: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  geography: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  health: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  law: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  economics: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  culture: [
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  sports: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  technology: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  language: [
    "moonshotai/kimi-k2-instruct-0905",
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  explain: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "z-ai/glm5",
  ],
};

const DEEP_INTENT_TIMEOUT_MS: Record<IntentType, number> = {
  greeting: 3_500,
  help: 3_500,
  memory: 3_500,
  reminder: 3_500,
  send_message: 4_500,
  save_contact: 4_000,
  calendar: 5_000,
  general: 12_000,
  email: 10_000,
  spending: 10_000,
  finance: 15_000,
  web_search: 15_000,
  creative: 12_000,
  coding: 15_000,
  math: 14_000,
  research: 15_000,
  science: 12_000,
  history: 10_000,
  geography: 8_000,
  health: 12_000,
  law: 12_000,
  economics: 12_000,
  culture: 10_000,
  sports: 8_000,
  technology: 12_000,
  language: 8_000,
  explain: 14_000,
};

const DEEP_INTENT_PARALLELISM: Record<IntentType, number> = {
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
  finance: 3,
  web_search: 3,
  creative: 2,
  coding: 3,
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
  language: 2,
  explain: 2,
};

const DEEP_INTENT_MAX_TOTAL_MS: Record<IntentType, number> = {
  greeting: 5_000,
  help: 5_000,
  memory: 5_000,
  reminder: 5_000,
  send_message: 6_000,
  save_contact: 6_000,
  calendar: 6_000,
  general: 18_000,
  email: 16_000,
  spending: 16_000,
  finance: 25_000,
  web_search: 25_000,
  creative: 18_000,
  coding: 25_000,
  math: 22_000,
  research: 25_000,
  science: 18_000,
  history: 16_000,
  geography: 12_000,
  health: 18_000,
  law: 18_000,
  economics: 18_000,
  culture: 16_000,
  sports: 12_000,
  technology: 18_000,
  language: 12_000,
  explain: 22_000,
};

const DEEP_INTENT_CANDIDATE_LIMIT: Record<IntentType, number> = {
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
  finance: 3,
  web_search: 3,
  creative: 2,
  coding: 3,
  math: 3,
  research: 3,
  science: 3,
  history: 2,
  geography: 2,
  health: 3,
  law: 3,
  economics: 3,
  culture: 2,
  sports: 2,
  technology: 2,
  language: 2,
  explain: 3,
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
  greeting: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  help: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  memory: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  reminder: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  send_message: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  save_contact: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  calendar: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  general: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
  ],
  coding: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
  ],
  math: [
    "z-ai/glm5",
    "meta/llama-3.3-70b-instruct",
  ],
  email: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
  ],
  spending: [
    "z-ai/glm5",
    "meta/llama-3.3-70b-instruct",
  ],
  finance: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
  ],
  web_search: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
  ],
  research: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
  ],
  creative: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
  ],
  science: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  history: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct",
  ],
  geography: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  health: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  law: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  economics: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct",
  ],
  culture: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  sports: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  technology: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  language: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ],
  explain: [
    "meta/llama-3.3-70b-instruct",
    "mistralai/mistral-large-3-675b-instruct-2512",
    "z-ai/glm5",
  ],
};

const DEFAULT_FAST_MODELS = [
  ...GLOBAL_TOP_MODELS,
  "meta/llama-3.3-70b-instruct",
  "meta/llama-3.1-8b-instruct",
  "meta/llama3-8b-instruct",
  "nvidia/llama3-chatqa-1.5-8b",
];

const DEFAULT_CHAT_MODELS = [
  ...GLOBAL_TOP_MODELS,
  "meta/llama-3.3-70b-instruct",
];

const DEFAULT_REASONING_MODELS = [
  ...GLOBAL_TOP_MODELS,
  "nvidia/nemotron-4-340b-instruct",
];

const DEFAULT_CODE_MODELS = [
  ...GLOBAL_TOP_MODELS,
  "mistralai/devstral-2-123b-instruct-2512",
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

  for (const model of models) {
    if (seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }

  return result;
}

function configuredModelList(
  listValue: string,
  primaryValue: string,
  defaults: string[],
) {
  return uniqueModels([...splitModelList(listValue), primaryValue, ...defaults].filter(Boolean));
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
  const unique = uniqueModels(models);
  const preferred = preferredOrder.filter((model) => unique.includes(model));
  const remaining = unique.filter((model) => !preferred.includes(model));
  return [...preferred, ...remaining];
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

function markModelFailure(healthKey: string) {
  const state = modelHealthState(healthKey);
  state.consecutiveFailures += 1;
  state.lastFailureAt = Date.now();

  const cooldown = Math.min(
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

  return [...available, ...cooling];
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

function modelCandidatesForIntent(
  intent: IntentType,
  responseMode: ResponseMode = "fast",
  preferredModelsOverride?: string[],
): ModelCandidate[] {
  const healthScope = `${responseMode}:${intent}`;
  const preferredModels = preferredModelsOverride?.length
    ? uniqueModels([...preferredModelsOverride, ...preferredModelsForIntent(intent, responseMode)])
    : preferredModelsForIntent(intent, responseMode);
  const rankedModels = prioritizeHealthyModels(
    reorderModels(baseModelsForIntent(intent), preferredModels),
    healthScope,
  );

  return rankedModels.slice(0, candidateLimitForIntent(intent, responseMode)).map((model) => ({
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
type NvResp = { choices?: Array<{ message?: { content?: string } }> };
type ModelPlannerStrategy = "single_pass" | "collect_and_judge";
type ModelGenerationResult = {
  candidate: ModelCandidate;
  out: string;
  latencyMs: number;
  heuristicScore: number;
  preview: string;
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
  "technology",
  "explain",
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
  candidates: Array<{ out: string; heuristicScore: number }>;
  threshold?: number;
}) {
  if (input.candidates.length < 2) return false;

  const ranked = [...input.candidates].sort((left, right) => right.heuristicScore - left.heuristicScore);
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
  const canJudge = input.availableCandidates > 1;

  let targetResponses = 1;
  let judgeEnabled = false;

  if (highStakes && canJudge) {
    targetResponses = Math.min(input.availableCandidates, isDeep ? 3 : 2);
    judgeEnabled = true;
  } else if (isDeep && canJudge) {
    targetResponses = Math.min(input.availableCandidates, 2);
    judgeEnabled = true;
  }

  const generatorBatchSize = Math.max(
    1,
    Math.min(
      parallelismForIntent(input.intent, input.responseMode),
      Math.max(targetResponses, judgeEnabled ? 2 : 1),
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
      uniqueModels([...reasoningModels(), ...chatModels(), ...globalModels()]),
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
    const out = await _call(
      input.messages,
      input.maxTokens,
      candidate.model,
      candidate.timeoutMs,
      input.temperature,
    );
    const latencyMs = Date.now() - startedAt;

    if (out) {
      markModelSuccess(candidate.healthKey);
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
        },
      };
    }

    markModelFailure(candidate.healthKey);
    console.warn(`[ai] ${candidate.model} failed, trying next model...`);
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
    const raw = await _call(
      [
        { role: "system", content: judgeSystem },
        { role: "user", content: judgeUser },
      ],
      260,
      judgeCandidate.model,
      timeoutMs,
      0,
    );
    const latencyMs = Date.now() - startedAt;

    if (!raw) {
      markModelFailure(judgeCandidate.healthKey);
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
  const heuristicWinner = ranked[0] ?? null;
  const scoreGap = ranked.length > 1
    ? (ranked[0]?.heuristicScore ?? 0) - (ranked[1]?.heuristicScore ?? 0)
    : Number.POSITIVE_INFINITY;
  const materialDisagreement = detectMaterialCandidateDisagreement({
    intent: input.intent,
    candidates: ranked.map((candidate) => ({
      out: candidate.out,
      heuristicScore: candidate.heuristicScore,
    })),
    threshold: planner.disagreementThreshold,
  });

  let selected = heuristicWinner;
  let selectedBy: ClawCloudModelOrchestrationTrace["selectedBy"] = "heuristic";
  let judgeTrace: ClawCloudModelJudgeTrace | null = null;

  const shouldInvokeJudge = planner.judgeEnabled
    && ranked.length > 1
    && (
      materialDisagreement
      || input.responseMode === "deep"
      || scoreGap < 8
      || isHighStakesIntent(input.intent)
    )
    && (input.deadlineMs - Date.now()) >= planner.judgeMinRemainingMs;

  if (shouldInvokeJudge) {
    const evaluatedCandidates = ranked.slice(0, Math.min(ranked.length, 3));
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

  const judgeConfidenceLow = judgeTrace?.used
    ? judgeTrace.confidence === "low" || judgeTrace.needsClarification
    : false;
  const heuristicConfidenceLow = materialDisagreement && scoreGap < 8;
  const confidentWinner = selected
    && !(judgeConfidenceLow || heuristicConfidenceLow)
    ? true
    : Boolean(selected && planner.allowLowConfidenceWinner);

  return {
    answer: confidentWinner ? selected?.out ?? null : null,
    trace: {
      intent: input.intent,
      responseMode: input.responseMode,
      planner,
      selectedBy: confidentWinner ? selectedBy : "fallback",
      selectedModel: confidentWinner ? (selected?.candidate.model ?? null) : null,
      candidates: buildCandidateTrace(successes, failures, confidentWinner ? (selected?.candidate.model ?? null) : null),
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

async function _call(
  messages: Msg[],
  maxTokens: number,
  model: string,
  timeoutMs: number,
  temperature = 0.2,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!env.NVIDIA_API_KEY) return null;

  const base = (env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1")
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/embeddings$/i, "");
  const url = `${/\/v\d+$/i.test(base) ? base : `${base}/v1`}/chat/completions`;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) {
    ctrl.abort();
  } else if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        top_p: 0.95,
        messages,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[ai] ${res.status} ${model}: ${txt.slice(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as NvResp;
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      console.warn(`[ai] timeout on ${model}`);
    } else {
      console.error(`[ai] error on ${model}:`, error);
    }
    return null;
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
  userQuestion: string;
}): Promise<{
  winner: ModelGenerationResult | null;
  failures: ClawCloudModelCandidateTrace[];
}> {
  for (const candidate of input.candidates) {
    console.log(`[ai] trying ${candidate.model}`);
  }

  const controllers = input.candidates.map(() => new AbortController());
  const failures = new Map<number, ClawCloudModelCandidateTrace>();

  const attempts = input.candidates.map((candidate, index) => (async () => {
    const startedAt = Date.now();
    const out = await _call(
      input.messages,
      input.maxTokens,
      candidate.model,
      candidate.timeoutMs,
      input.temperature,
      controllers[index].signal,
    );
    const latencyMs = Date.now() - startedAt;

    if (out) {
      markModelSuccess(candidate.healthKey);
      return {
        candidate,
        out,
        index,
        latencyMs,
        heuristicScore: scoreClawCloudModelResponse({
          intent: input.intent,
          response: out,
          userQuestion: input.userQuestion,
        }),
        preview: buildCandidatePreview(out),
      };
    }

    if (!controllers[index].signal.aborted) {
      markModelFailure(candidate.healthKey);
      failures.set(index, {
        model: candidate.model,
        tier: candidate.tier,
        status: "failed",
        latencyMs,
        heuristicScore: null,
        preview: null,
      });
      console.warn(`[ai] ${candidate.model} failed, trying next model...`);
    }

    throw new Error(`No usable response from ${candidate.model}`);
  })());

  try {
    const winner = await Promise.any(attempts);
    for (let index = 0; index < controllers.length; index += 1) {
      if (index !== winner.index) {
        controllers[index].abort();
      }
    }
    return {
      winner: {
        candidate: winner.candidate,
        out: winner.out,
        latencyMs: winner.latencyMs,
        heuristicScore: winner.heuristicScore,
        preview: winner.preview,
      },
      failures: [...failures.values()],
    };
  } catch {
    for (const controller of controllers) {
      controller.abort();
    }
    return {
      winner: null,
      failures: [...failures.values()],
    };
  }
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

  if (!env.NVIDIA_API_KEY) {
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
    const candidates = modelCandidatesForIntent(intent, responseMode, input.preferredModels);
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
  const generated = input.responses.map((entry, index) => ({
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
  }));
  const planner = buildClawCloudModelPlannerDecision({
    intent: input.intent,
    responseMode: input.responseMode,
    availableCandidates: generated.length,
  });
  const ranked = rankGeneratedCandidates(generated);
  const heuristicWinner = ranked[0] ?? null;
  const scoreGap = ranked.length > 1
    ? (ranked[0]?.heuristicScore ?? 0) - (ranked[1]?.heuristicScore ?? 0)
    : Number.POSITIVE_INFINITY;
  const materialDisagreement = detectMaterialCandidateDisagreement({
    intent: input.intent,
    candidates: ranked.map((candidate) => ({
      out: candidate.out,
      heuristicScore: candidate.heuristicScore,
    })),
    threshold: planner.disagreementThreshold,
  });

  let selected = heuristicWinner;
  let selectedBy: ClawCloudModelOrchestrationTrace["selectedBy"] = planner.judgeEnabled ? "heuristic" : "single_success";

  if (input.judgeDecision) {
    const judged = ranked[input.judgeDecision.winnerIndex] ?? null;
    if (judged) {
      selected = judged;
      selectedBy = "judge";
    }
  }

  const judgeConfidenceLow = input.judgeDecision
    ? input.judgeDecision.confidence === "low" || Boolean(input.judgeDecision.needsClarification)
    : false;
  const heuristicConfidenceLow = materialDisagreement && scoreGap < 8;
  const confidentWinner = selected
    && !(judgeConfidenceLow || heuristicConfidenceLow)
    ? true
    : Boolean(selected && planner.allowLowConfidenceWinner);

  return {
    planner,
    selectedIndex: confidentWinner && selected
      ? generated.findIndex((candidate) => candidate.candidate.model === selected?.candidate.model)
      : null,
    selectedBy: confidentWinner ? selectedBy : "fallback",
    materialDisagreement,
    scores: generated.map((candidate) => candidate.heuristicScore),
  };
}

// Fast path for instant acknowledgements

export async function completeClawCloudFast(input: {
  user: string;
  system?: string;
  maxTokens?: number;
  fallback: string;
}): Promise<string> {
  if (!env.NVIDIA_API_KEY) return input.fallback;

  const msgs: Msg[] = [];
  const mergedSystem = mergeClawCloudSystemPrompt(input.system);
  if (mergedSystem) msgs.push({ role: "system", content: mergedSystem });
  msgs.push({ role: "user", content: input.user });

  const ackCandidates: ModelCandidate[] = [];
  appendCandidates(
    ackCandidates,
    prioritizeHealthyModels(reorderModels(fastModels(), INTENT_PREFERRED_MODELS.greeting), "greeting"),
    INTENT_TIMEOUT_MS.greeting,
    "fast",
    "greeting",
  );
  appendCandidates(
    ackCandidates,
    prioritizeHealthyModels(reorderModels(chatModels(), INTENT_PREFERRED_MODELS.general), "general"),
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
      userQuestion: input.user,
    });
    if (out.winner?.out) {
      break;
    }
  }

  return out?.winner?.out?.trim() || input.fallback;
}
