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
  | "general"
  | "coding"
  | "math"
  | "email"
  | "reminder"
  | "calendar"
  | "spending"
  | "research"
  | "creative";

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
  greeting: 2_500,
  reminder: 2_500,
  calendar: 2_800,
  general: 4_200,
  email: 4_200,
  spending: 4_200,
  creative: 4_500,
  coding: 4_800,
  math: 4_800,
  research: 4_800,
};

const INTENT_PARALLELISM: Record<IntentType, number> = {
  greeting: 1,
  reminder: 1,
  calendar: 1,
  general: 2,
  email: 2,
  spending: 2,
  creative: 2,
  coding: 3,
  math: 3,
  research: 3,
};

const INTENT_MAX_TOTAL_MS: Record<IntentType, number> = {
  greeting: 3_500,
  reminder: 3_500,
  calendar: 4_000,
  general: 4_800,
  email: 4_800,
  spending: 4_800,
  creative: 5_000,
  coding: 5_000,
  math: 5_000,
  research: 5_000,
};

const INTENT_CANDIDATE_LIMIT: Record<IntentType, number> = {
  greeting: 2,
  reminder: 2,
  calendar: 2,
  general: 3,
  email: 3,
  spending: 3,
  creative: 3,
  coding: 4,
  math: 4,
  research: 4,
};

const INTENT_HISTORY_LIMIT: Record<IntentType, number> = {
  greeting: 2,
  reminder: 2,
  calendar: 2,
  general: 3,
  email: 3,
  spending: 3,
  creative: 3,
  coding: 2,
  math: 2,
  research: 2,
};

const INTENT_HISTORY_CHAR_LIMIT: Record<IntentType, number> = {
  greeting: 180,
  reminder: 180,
  calendar: 220,
  general: 260,
  email: 260,
  spending: 260,
  creative: 260,
  coding: 240,
  math: 220,
  research: 240,
};

const INTENT_PREFERRED_MODELS: Record<IntentType, string[]> = {
  greeting: [
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
};

const DEEP_INTENT_TIMEOUT_MS: Record<IntentType, number> = {
  greeting: 2_800,
  reminder: 2_800,
  calendar: 3_200,
  general: 5_500,
  email: 5_500,
  spending: 5_500,
  creative: 6_500,
  coding: 7_500,
  math: 7_000,
  research: 7_500,
};

const DEEP_INTENT_PARALLELISM: Record<IntentType, number> = {
  greeting: 1,
  reminder: 1,
  calendar: 1,
  general: 2,
  email: 2,
  spending: 2,
  creative: 2,
  coding: 2,
  math: 2,
  research: 2,
};

const DEEP_INTENT_MAX_TOTAL_MS: Record<IntentType, number> = {
  greeting: 4_000,
  reminder: 4_000,
  calendar: 4_500,
  general: 7_000,
  email: 7_000,
  spending: 7_000,
  creative: 8_000,
  coding: 9_000,
  math: 8_500,
  research: 9_000,
};

const DEEP_INTENT_CANDIDATE_LIMIT: Record<IntentType, number> = {
  greeting: 2,
  reminder: 2,
  calendar: 2,
  general: 2,
  email: 2,
  spending: 2,
  creative: 2,
  coding: 2,
  math: 2,
  research: 2,
};

const DEEP_INTENT_HISTORY_LIMIT: Record<IntentType, number> = {
  greeting: 2,
  reminder: 2,
  calendar: 2,
  general: 4,
  email: 4,
  spending: 4,
  creative: 4,
  coding: 4,
  math: 4,
  research: 4,
};

const DEEP_INTENT_HISTORY_CHAR_LIMIT: Record<IntentType, number> = {
  greeting: 180,
  reminder: 180,
  calendar: 240,
  general: 360,
  email: 360,
  spending: 320,
  creative: 360,
  coding: 420,
  math: 340,
  research: 420,
};

const DEEP_INTENT_PREFERRED_MODELS: Record<IntentType, string[]> = {
  greeting: [
    "meta/llama-3.3-70b-instruct",
    "moonshotai/kimi-k2-instruct-0905",
  ],
  reminder: [
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
  research: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
  ],
  creative: [
    "mistralai/mistral-large-3-675b-instruct-2512",
    "meta/llama-3.3-70b-instruct",
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
    case "reminder":
    case "calendar":
      return uniqueModels([...fastModels(), ...chatModels()]);
    case "coding":
      return uniqueModels([...codeModels(), ...globalModels(), ...reasoningModels(), ...chatModels()]);
    case "math":
    case "research":
      return uniqueModels([...reasoningModels(), ...globalModels(), ...chatModels()]);
    default:
      return uniqueModels([...chatModels(), ...globalModels(), ...reasoningModels(), ...fastModels()]);
  }
}

function tierForIntent(intent: IntentType): ModelTier {
  switch (intent) {
    case "greeting":
    case "reminder":
    case "calendar":
      return "fast";
    case "coding":
      return "code";
    case "math":
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
  reminder: 150,
  calendar: 250,
  general: 320,
  email: 320,
  spending: 380,
  creative: 380,
  coding: 420,
  math: 300,
  research: 420,
};

const DEEP_TOKEN_BUDGETS: Record<IntentType, number> = {
  greeting: 220,
  reminder: 180,
  calendar: 280,
  general: 420,
  email: 440,
  spending: 420,
  creative: 520,
  coding: 700,
  math: 420,
  research: 700,
};

function tokenBudgetForIntent(intent: IntentType, responseMode: ResponseMode) {
  return responseMode === "deep" ? DEEP_TOKEN_BUDGETS[intent] : TOKEN_BUDGETS[intent];
}

const QUALITY_GUARDRAILS: Partial<Record<IntentType, string>> = {
  coding: [
    "Coding guardrails:",
    "- Lead with the best production-safe design, not generic advice.",
    "- Start with 3-5 invariants or design rules.",
    "- Then give schema, request flow, and minimal pseudocode only if useful.",
    "- Keep the answer compact unless the user explicitly asks for full code.",
    "- Preserve provider-native IDs exactly as strings when a vendor uses string identifiers.",
    "- Distinguish webhook deduplication keys from business idempotency keys.",
    "- Prefer compact, high-signal answers over long boilerplate.",
    "- If exact details are uncertain, label them as assumptions instead of inventing them.",
  ].join("\n"),
  math: [
    "Math guardrails:",
    "- Use this order: formula, compute, interpretation, final answer.",
    "- Keep the answer compact and calculation-focused.",
    "- Separate exact calculations from approximations.",
    "- Distinguish arithmetic expectancy from geometric growth and compounding drag.",
    "- If drawdown or path risk has no clean closed form, say so clearly and label the approximation.",
    "- Do not present heuristic shortcuts as exact drawdown probabilities.",
    "- Give a bounded range instead of fake precision when assumptions are strong.",
  ].join("\n"),
  research: [
    "Research guardrails:",
    "- Use this order: decision, why, tradeoffs, bottom line.",
    "- Lead with the decision and why.",
    "- Keep the memo concise and decision-ready.",
    "- Do not invent precise latency, cost, benchmark, or compliance numbers unless the user gave them or you clearly label them as illustrative estimates.",
    "- Separate privacy risk, auditability, hallucination risk, and operational risk.",
    "- Prefer concise decision memos over long generic overviews.",
  ].join("\n"),
  general: [
    "General guardrails:",
    "- Answer directly and avoid filler.",
    "- If an important assumption is required, say it explicitly.",
    "- Do not make up precise facts you are unsure about.",
    "- Prefer a concise professional answer over a broad generic one.",
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

  const useCache = !input.skipCache && !input.history?.length;
  const ck = _ck(input.system ?? "", input.user);
  if (useCache) {
    const hit = _get(ck);
    if (hit) {
      console.log("[ai] cache hit");
      return hit;
    }
  }

  const intent = input.intent ?? "general";
  const responseMode = input.responseMode ?? "fast";
  const msgs: Msg[] = [];
  if (input.system) msgs.push({ role: "system", content: input.system });

  if (input.history?.length) {
    const historyLimit = historyLimitForIntent(intent, responseMode);
    const historyCharLimit = historyCharLimitForIntent(intent, responseMode);
    for (const message of input.history.slice(-historyLimit)) {
      msgs.push({ role: message.role, content: message.content.slice(0, historyCharLimit) });
    }
  }

  msgs.push({ role: "user", content: input.user });

  const extraGuardrails = QUALITY_GUARDRAILS[intent];
  if (extraGuardrails) {
    msgs.splice(input.system ? 1 : 0, 0, { role: "system", content: extraGuardrails });
  }
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
