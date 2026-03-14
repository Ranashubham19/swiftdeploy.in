import { env } from "@/lib/env";

// NVIDIA's API is fully OpenAI-compatible.
// We call it directly via fetch so there is no OpenAI SDK dependency.
const NVIDIA_API_URL = `${
  env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"
}/chat/completions`;

// Use the fast chat model for agent tasks (briefings, drafts, search).
// Falls back to the base chat model if no fast model is configured.
function getAgentModel(): string {
  return (
    env.NVIDIA_FAST_MODEL ||
    env.NVIDIA_CHAT_MODEL ||
    "meta/llama-3.1-8b-instruct"
  );
}

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

async function callNvidiaChat(
  messages: NvidiaMessage[],
  maxTokens: number,
  timeoutMs = 12000,
): Promise<string | null> {
  if (!env.NVIDIA_API_KEY) {
    return null;
  }

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(NVIDIA_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getAgentModel(),
        max_tokens: maxTokens,
        temperature: 0.2,
        messages,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(`[clawcloud-ai] NVIDIA API error ${response.status}: ${text}`);
      return null;
    }

    const payload = (await response.json()) as NvidiaCompletionResponse;
    return payload.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      console.error("[clawcloud-ai] NVIDIA request timed out");
    } else {
      console.error("[clawcloud-ai] NVIDIA request failed:", error);
    }
    return null;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * The single AI call used by all ClawCloud agent tasks:
 * morning briefings, draft replies, email search, meeting reminders,
 * evening summaries, spending analysis, and general chat.
 *
 * Returns the fallback string if NVIDIA_API_KEY is not set or
 * if the API call fails, so callers never crash.
 */
export async function completeClawCloudPrompt(input: {
  user: string;
  system?: string;
  maxTokens?: number;
  fallback: string;
}): Promise<string> {
  const messages: NvidiaMessage[] = [];

  if (input.system) {
    messages.push({ role: "system", content: input.system });
  }

  messages.push({ role: "user", content: input.user });

  const result = await callNvidiaChat(messages, input.maxTokens ?? 300);

  if (!result) {
    return input.fallback;
  }

  return result;
}
