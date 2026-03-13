import OpenAI from "openai";

import { env } from "@/lib/env";

let cachedOpenAIClient: OpenAI | null = null;

function getOpenAIClient() {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  if (!cachedOpenAIClient) {
    cachedOpenAIClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  return cachedOpenAIClient;
}

export async function completeClawCloudPrompt(input: {
  user: string;
  system?: string;
  maxTokens?: number;
  fallback: string;
}) {
  const client = getOpenAIClient();
  if (!client) {
    return input.fallback;
  }

  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL || "gpt-4o-mini",
    max_tokens: input.maxTokens ?? 300,
    messages: [
      ...(input.system ? [{ role: "system" as const, content: input.system }] : []),
      { role: "user" as const, content: input.user },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || input.fallback;
}
