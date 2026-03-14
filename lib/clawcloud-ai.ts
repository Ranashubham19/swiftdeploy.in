import { env } from "@/lib/env";

type NvidiaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type NvidiaCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

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

const TOKEN_BUDGETS: Record<IntentType, number> = {
  greeting: 180,
  general: 420,
  coding: 1100,
  math: 500,
  email: 650,
  reminder: 180,
  calendar: 260,
  spending: 420,
  research: 900,
  creative: 750,
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;
const responseCache = new Map<string, { value: string; createdAt: number }>();

export function getConfiguredClawCloudChatProvider() {
  if (env.NVIDIA_API_KEY) {
    return "nvidia" as const;
  }

  if (env.OPENAI_API_KEY) {
    return "openai" as const;
  }

  return null;
}

export function hasClawCloudChatProvider() {
  return getConfiguredClawCloudChatProvider() !== null;
}

function getNvidiaApiUrl() {
  const rawBaseUrl = (env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").trim();
  const normalizedBaseUrl = rawBaseUrl.replace(/\/+$/, "");

  if (/\/chat\/completions$/i.test(normalizedBaseUrl)) {
    return normalizedBaseUrl;
  }

  return `${normalizedBaseUrl}/chat/completions`;
}

function getFastModel() {
  return (
    env.NVIDIA_FAST_MODEL ||
    env.NVIDIA_CHAT_MODEL ||
    "meta/llama-3.1-8b-instruct"
  );
}

function getSmartModel() {
  return (
    env.NVIDIA_REASONING_MODEL ||
    env.NVIDIA_FAST_MODEL ||
    env.NVIDIA_CHAT_MODEL ||
    "meta/llama-3.1-8b-instruct"
  );
}

function createCacheKey(system: string | undefined, user: string, intent?: IntentType) {
  return [
    intent ?? "general",
    (system ?? "").trim().slice(0, 200),
    user.trim().toLowerCase().slice(0, 300),
  ].join("|||");
}

function readCache(key: string) {
  const cached = responseCache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }

  return cached.value;
}

function writeCache(key: string, value: string) {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldestEntry = [...responseCache.entries()].sort(
      (left, right) => left[1].createdAt - right[1].createdAt,
    )[0];

    if (oldestEntry) {
      responseCache.delete(oldestEntry[0]);
    }
  }

  responseCache.set(key, { value, createdAt: Date.now() });
}

function clipMessageContent(content: string, maxLength = 700) {
  const trimmed = content.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
}

async function callNvidiaChat(input: {
  messages: NvidiaMessage[];
  maxTokens: number;
  model: string;
  timeoutMs: number;
}) {
  if (!env.NVIDIA_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(getNvidiaApiUrl(), {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens,
        temperature: 0.25,
        top_p: 0.9,
        messages: input.messages,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `[clawcloud-ai] NVIDIA API error ${response.status}: ${text.slice(0, 300)}`,
      );
      return null;
    }

    const payload = (await response.json()) as NvidiaCompletionResponse;
    return payload.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      console.warn(`[clawcloud-ai] ${input.model} request timed out after ${input.timeoutMs}ms`);
    } else {
      console.error(`[clawcloud-ai] ${input.model} request failed:`, error);
    }

    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

async function callOpenAiChat(input: {
  messages: NvidiaMessage[];
  maxTokens: number;
  timeoutMs: number;
}) {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || "gpt-4o-mini",
        max_tokens: input.maxTokens,
        temperature: 0.25,
        messages: input.messages,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `[clawcloud-ai] OpenAI API error ${response.status}: ${text.slice(0, 300)}`,
      );
      return null;
    }

    const payload = (await response.json()) as NvidiaCompletionResponse;
    return payload.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      console.warn(`[clawcloud-ai] OpenAI request timed out after ${input.timeoutMs}ms`);
    } else {
      console.error("[clawcloud-ai] OpenAI request failed:", error);
    }

    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function buildMessages(input: {
  user: string;
  system?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}) {
  const messages: NvidiaMessage[] = [];

  if (input.system?.trim()) {
    messages.push({ role: "system", content: input.system.trim() });
  }

  for (const message of (input.history ?? []).slice(-8)) {
    const content = clipMessageContent(message.content);
    if (!content) {
      continue;
    }

    messages.push({ role: message.role, content });
  }

  messages.push({ role: "user", content: clipMessageContent(input.user, 1200) });
  return messages;
}

async function firstSuccessfulText(tasks: Array<Promise<string | null>>) {
  try {
    return await Promise.any(
      tasks.map(async (task) => {
        const result = await task;
        if (!result?.trim()) {
          throw new Error("empty");
        }

        return result.trim();
      }),
    );
  } catch {
    return null;
  }
}

export async function completeClawCloudPrompt(input: {
  user: string;
  system?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  intent?: IntentType;
  fallback: string;
  skipCache?: boolean;
}): Promise<string> {
  const provider = getConfiguredClawCloudChatProvider();
  if (!provider) {
    return input.fallback;
  }

  const useCache = !input.skipCache && !input.history?.length;
  const cacheKey = createCacheKey(input.system, input.user, input.intent);
  if (useCache) {
    const cached = readCache(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const messages = buildMessages(input);
  const maxTokens = input.maxTokens ?? TOKEN_BUDGETS[input.intent ?? "general"];
  let result: string | null = null;

  if (provider === "nvidia") {
    const primaryModel = getFastModel();
    const secondaryModel = getSmartModel();

    result = await callNvidiaChat({
      messages,
      maxTokens,
      model: primaryModel,
      timeoutMs: 8000,
    });

    if (!result) {
      result = await callNvidiaChat({
        messages,
        maxTokens,
        model: secondaryModel,
        timeoutMs: secondaryModel === primaryModel ? 16000 : 12000,
      });
    }
  } else {
    result = await callOpenAiChat({
      messages,
      maxTokens,
      timeoutMs: 10000,
    });

    if (!result) {
      result = await callOpenAiChat({
        messages,
        maxTokens,
        timeoutMs: 18000,
      });
    }
  }

  if (!result) {
    return input.fallback;
  }

  if (useCache) {
    writeCache(cacheKey, result);
  }

  return result;
}

export async function completeClawCloudFast(input: {
  user: string;
  system?: string;
  maxTokens?: number;
  fallback: string;
}): Promise<string> {
  const provider = getConfiguredClawCloudChatProvider();
  if (!provider) {
    return input.fallback;
  }

  const messages = buildMessages({
    system: input.system,
    user: input.user,
  });
  const maxTokens = input.maxTokens ?? 160;
  let result: string | null = null;

  if (provider === "nvidia") {
    const primaryModel = getFastModel();
    const secondaryModel = getSmartModel();

    result = await firstSuccessfulText([
      callNvidiaChat({
        messages,
        maxTokens,
        model: primaryModel,
        timeoutMs: 5000,
      }),
      callNvidiaChat({
        messages,
        maxTokens,
        model: secondaryModel,
        timeoutMs: secondaryModel === primaryModel ? 9000 : 7500,
      }),
    ]);
  } else {
    result = await callOpenAiChat({
      messages,
      maxTokens,
      timeoutMs: 6500,
    });
  }

  return result ?? input.fallback;
}
