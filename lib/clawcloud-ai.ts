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
  greeting: 4_000,
  help: 4_000,
  memory: 4_000,
  reminder: 4_000,
  send_message: 4_000,
  save_contact: 4_000,
  calendar: 5_000,
  general: 8_000,
  email: 8_000,
  spending: 8_000,
  finance: 15_000,
  web_search: 18_000,
  creative: 9_000,
  coding: 14_000,
  math: 12_000,
  research: 12_000,
  science: 10_000,
  history: 8_000,
  geography: 6_000,
  health: 9_000,
  law: 9_000,
  economics: 9_000,
  culture: 8_000,
  sports: 7_000,
  technology: 8_000,
  language: 7_000,
  explain: 10_000,
};

const INTENT_PARALLELISM: Record<IntentType, number> = {
  greeting: 1,
  help: 1,
  memory: 1,
  reminder: 1,
  send_message: 1,
  save_contact: 1,
  calendar: 1,
  general: 3,
  email: 2,
  spending: 2,
  finance: 4,
  web_search: 4,
  creative: 2,
  coding: 4,
  math: 4,
  research: 4,
  science: 3,
  history: 3,
  geography: 2,
  health: 3,
  law: 3,
  economics: 3,
  culture: 2,
  sports: 2,
  technology: 3,
  language: 2,
  explain: 3,
};

const INTENT_MAX_TOTAL_MS: Record<IntentType, number> = {
  greeting: 5_000,
  help: 5_000,
  memory: 5_000,
  reminder: 5_000,
  send_message: 6_000,
  save_contact: 6_000,
  calendar: 7_000,
  general: 12_000,
  email: 12_000,
  spending: 12_000,
  finance: 20_000,
  web_search: 22_000,
  creative: 14_000,
  coding: 22_000,
  math: 18_000,
  research: 18_000,
  science: 14_000,
  history: 12_000,
  geography: 9_000,
  health: 14_000,
  law: 14_000,
  economics: 14_000,
  culture: 12_000,
  sports: 10_000,
  technology: 12_000,
  language: 10_000,
  explain: 16_000,
};

const INTENT_CANDIDATE_LIMIT: Record<IntentType, number> = {
  greeting: 2,
  help: 2,
  memory: 2,
  reminder: 2,
  send_message: 2,
  save_contact: 2,
  calendar: 2,
  general: 4,
  email: 4,
  spending: 4,
  finance: 4,
  web_search: 4,
  creative: 4,
  coding: 5,
  math: 5,
  research: 5,
  science: 5,
  history: 4,
  geography: 4,
  health: 5,
  law: 5,
  economics: 5,
  culture: 4,
  sports: 4,
  technology: 4,
  language: 4,
  explain: 5,
};

const INTENT_HISTORY_LIMIT: Record<IntentType, number> = {
  greeting: 2,
  help: 2,
  memory: 2,
  reminder: 2,
  send_message: 2,
  save_contact: 2,
  calendar: 2,
  general: 3,
  email: 3,
  spending: 3,
  finance: 2,
  web_search: 2,
  creative: 3,
  coding: 2,
  math: 2,
  research: 2,
  science: 3,
  history: 3,
  geography: 3,
  health: 3,
  law: 3,
  economics: 3,
  culture: 3,
  sports: 3,
  technology: 3,
  language: 3,
  explain: 3,
};

const INTENT_HISTORY_CHAR_LIMIT: Record<IntentType, number> = {
  greeting: 180,
  help: 180,
  memory: 180,
  reminder: 180,
  send_message: 220,
  save_contact: 220,
  calendar: 220,
  general: 260,
  email: 260,
  spending: 260,
  finance: 240,
  web_search: 240,
  creative: 260,
  coding: 240,
  math: 220,
  research: 240,
  science: 240,
  history: 240,
  geography: 240,
  health: 260,
  law: 260,
  economics: 260,
  culture: 240,
  sports: 220,
  technology: 240,
  language: 220,
  explain: 260,
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
  greeting: 5_000,
  help: 5_000,
  memory: 5_000,
  reminder: 5_000,
  send_message: 6_000,
  save_contact: 6_000,
  calendar: 7_000,
  general: 20_000,
  email: 18_000,
  spending: 18_000,
  finance: 35_000,
  web_search: 35_000,
  creative: 20_000,
  coding: 35_000,
  math: 30_000,
  research: 35_000,
  science: 22_000,
  history: 18_000,
  geography: 14_000,
  health: 22_000,
  law: 22_000,
  economics: 22_000,
  culture: 18_000,
  sports: 16_000,
  technology: 20_000,
  language: 16_000,
  explain: 24_000,
};

const DEEP_INTENT_PARALLELISM: Record<IntentType, number> = {
  greeting: 1,
  help: 1,
  memory: 1,
  reminder: 1,
  send_message: 1,
  save_contact: 1,
  calendar: 1,
  general: 4,
  email: 4,
  spending: 4,
  finance: 5,
  web_search: 5,
  creative: 4,
  coding: 5,
  math: 5,
  research: 5,
  science: 4,
  history: 4,
  geography: 3,
  health: 4,
  law: 4,
  economics: 4,
  culture: 3,
  sports: 3,
  technology: 4,
  language: 3,
  explain: 4,
};

const DEEP_INTENT_MAX_TOTAL_MS: Record<IntentType, number> = {
  greeting: 6_000,
  help: 6_000,
  memory: 6_000,
  reminder: 6_000,
  send_message: 8_000,
  save_contact: 8_000,
  calendar: 8_000,
  general: 30_000,
  email: 26_000,
  spending: 26_000,
  finance: 60_000,
  web_search: 60_000,
  creative: 30_000,
  coding: 60_000,
  math: 55_000,
  research: 60_000,
  science: 34_000,
  history: 28_000,
  geography: 22_000,
  health: 34_000,
  law: 34_000,
  economics: 34_000,
  culture: 28_000,
  sports: 24_000,
  technology: 30_000,
  language: 24_000,
  explain: 36_000,
};

const DEEP_INTENT_CANDIDATE_LIMIT: Record<IntentType, number> = {
  greeting: 2,
  help: 2,
  memory: 2,
  reminder: 2,
  send_message: 2,
  save_contact: 2,
  calendar: 2,
  general: 4,
  email: 4,
  spending: 4,
  finance: 8,
  web_search: 8,
  creative: 4,
  coding: 8,
  math: 8,
  research: 8,
  science: 6,
  history: 4,
  geography: 4,
  health: 6,
  law: 6,
  economics: 6,
  culture: 4,
  sports: 4,
  technology: 4,
  language: 4,
  explain: 6,
};

const DEEP_INTENT_HISTORY_LIMIT: Record<IntentType, number> = {
  greeting: 2,
  help: 2,
  memory: 2,
  reminder: 2,
  send_message: 2,
  save_contact: 2,
  calendar: 2,
  general: 4,
  email: 4,
  spending: 4,
  finance: 4,
  web_search: 4,
  creative: 4,
  coding: 4,
  math: 4,
  research: 4,
  science: 4,
  history: 4,
  geography: 4,
  health: 4,
  law: 4,
  economics: 4,
  culture: 4,
  sports: 4,
  technology: 4,
  language: 4,
  explain: 4,
};

const DEEP_INTENT_HISTORY_CHAR_LIMIT: Record<IntentType, number> = {
  greeting: 180,
  help: 180,
  memory: 180,
  reminder: 180,
  send_message: 240,
  save_contact: 240,
  calendar: 240,
  general: 360,
  email: 360,
  spending: 320,
  finance: 420,
  web_search: 420,
  creative: 360,
  coding: 420,
  math: 340,
  research: 420,
  science: 380,
  history: 360,
  geography: 340,
  health: 380,
  law: 380,
  economics: 380,
  culture: 360,
  sports: 340,
  technology: 360,
  language: 340,
  explain: 380,
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
  help: 200,
  memory: 200,
  reminder: 180,
  send_message: 260,
  save_contact: 260,
  calendar: 280,
  general: 400,
  email: 400,
  spending: 420,
  finance: 520,
  web_search: 520,
  creative: 450,
  coding: 560,
  math: 420,
  research: 520,
  science: 460,
  history: 420,
  geography: 380,
  health: 460,
  law: 440,
  economics: 460,
  culture: 420,
  sports: 380,
  technology: 430,
  language: 380,
  explain: 460,
};

const DEEP_TOKEN_BUDGETS: Record<IntentType, number> = {
  greeting: 220,
  help: 220,
  memory: 220,
  reminder: 180,
  send_message: 320,
  save_contact: 320,
  calendar: 280,
  general: 700,
  email: 700,
  spending: 600,
  finance: 1_300,
  web_search: 1_300,
  creative: 800,
  coding: 1_600,
  math: 900,
  research: 1_300,
  science: 1_000,
  history: 850,
  geography: 760,
  health: 1_000,
  law: 1_000,
  economics: 1_000,
  culture: 850,
  sports: 760,
  technology: 900,
  language: 760,
  explain: 1_000,
};

function tokenBudgetForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep" ? DEEP_TOKEN_BUDGETS[intent] : TOKEN_BUDGETS[intent];
}

const QUALITY_GUARDRAILS: Partial<Record<IntentType, string>> = {
  coding: [
    "Coding guardrails:",
    "- Lead with the best production-safe design.",
    "- Always cover invariants, schema, request flow, failure modes, and pseudocode.",
    "- For payments, queues, webhooks, and databases: include constraints, transactions, idempotency keys, and failure handling.",
    "- Preserve provider-native identifiers exactly.",
    "- For migrations and production rollouts: spell out the cutover, shadowing, and rollback path.",
    "- Never truncate a coding answer mid-design.",
    "- Never say 'it depends' without giving the specific answer for each relevant case.",
  ].join("\n"),
  math: [
    "Math guardrails:",
    "- Always state the governing formula first, then substitute values step by step.",
    "- Show all arithmetic steps and do not skip to the result.",
    "- Separate exact results from approximations explicitly.",
    "- List all assumptions that materially affect the result.",
    "- Never refuse a math question; if exact solution needs missing data, give a bounded estimate and label it clearly.",
    "- For causal inference, state the identifying assumption, the estimator formula, and compute the result when inputs are present.",
    "- For statistics and econometrics, report the test statistic, p-value, and confidence interval together when inputs allow.",
  ].join("\n"),
  research: [
    "Research guardrails:",
    "- Answer in this exact order: recommendation, why, trade-offs, rollout, bottom line.",
    "- Every section must be concrete and specific.",
    "- Do not invent precise numbers unless the user supplied them.",
    "- State assumptions where facts are underspecified.",
    "- Never return an incomplete memo; all sections are required.",
    "- For policy or regulatory questions, name the relevant rule, regulation, or standard when known.",
  ].join("\n"),
  general: [
    "General guardrails:",
    "- Lead with the direct answer, not a caveat.",
    "- Use headers and bullets for multi-part topics.",
    "- Be specific and prefer concrete examples over abstractions.",
    "- Never truncate a structured answer mid-section.",
  ].join("\n"),
};

// Response cache

const _cache = new Map<string, { v: string; t: number }>();
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 300;

function _ck(sys: string, user: string) {
  return `${sys.slice(0, 60)}|${user.toLowerCase().trim().slice(0, 150)}`;
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
}): Promise<string | null> {
  for (const candidate of input.candidates) {
    console.log(`[ai] trying ${candidate.model}`);
  }

  const controllers = input.candidates.map(() => new AbortController());

  const attempts = input.candidates.map((candidate, index) => (async () => {
    const out = await _call(
      input.messages,
      input.maxTokens,
      candidate.model,
      candidate.timeoutMs,
      input.temperature,
      controllers[index].signal,
    );

    if (out) {
      markModelSuccess(candidate.healthKey);
      return { candidate, out, index };
    }

    if (!controllers[index].signal.aborted) {
      markModelFailure(candidate.healthKey);
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
    return winner.out;
  } catch {
    for (const controller of controllers) {
      controller.abort();
    }
    return null;
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
  if (!env.NVIDIA_API_KEY) return input.fallback;

  const intent = input.intent ?? "general";
  const responseMode = input.responseMode ?? "fast";
  const extraGuardrails = QUALITY_GUARDRAILS[intent];
  const mergedSystem = [input.system, extraGuardrails].filter(Boolean).join("\n\n").trim();

  const useCache = !input.skipCache && !input.history?.length;
  const ck = _ck(mergedSystem, input.user);
  if (useCache) {
    const hit = _get(ck);
    if (hit) {
      console.log("[ai] cache hit");
      return hit;
    }
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
    input.temperature ?? (intent === "coding" || intent === "math" ? 0.1 : 0.2);
  const candidates = modelCandidatesForIntent(intent, responseMode, input.preferredModels);
  const deadline = Date.now() + maxTotalMsForIntent(intent, responseMode);

  console.log(
    `[ai] ${responseMode} ${intent} candidates -> ${candidates.map((candidate) => candidate.model).join(" | ")}`,
  );

  let out: string | null = null;
  const batchSize = parallelismForIntent(intent, responseMode);

  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const remainingMs = deadline - Date.now();
    if (remainingMs < 2_000) {
      break;
    }

    const batch = candidates
      .slice(offset, offset + batchSize)
      .map((candidate) => ({
        ...candidate,
        timeoutMs: Math.min(candidate.timeoutMs, remainingMs),
      }));
    console.log(
      `[ai] ${responseMode} ${intent} batch -> ${batch.map((candidate) => candidate.model).join(" | ")}`,
    );
    out = await runCandidateBatch({
      messages: msgs,
      maxTokens: tokens,
      temperature,
      candidates: batch,
    });
    if (out) {
      break;
    }
  }

  if (!out) {
    console.warn("[ai] all models failed, using fallback response");
  }

  if (!out) return input.fallback;
  if (useCache) _set(ck, out);
  return out;
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
  if (input.system) msgs.push({ role: "system", content: input.system });
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

  let out: string | null = null;
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
      temperature: 0.3,
      candidates: batch,
    });
    if (out) {
      break;
    }
  }

  return out?.trim() || input.fallback;
}
