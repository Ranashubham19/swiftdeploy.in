import { logClawCloudProviderEvent } from "@/lib/clawcloud-provider-telemetry";

// lib/clawcloud-vision.ts
// ─────────────────────────────────────────────────────────────────────────────
// Image understanding for WhatsApp image messages.
//
// Uses NVIDIA vision models (primary) with an OpenAI vision fallback.
// Called from agent-server.ts when Baileys delivers an imageMessage WITHOUT
// a caption (captioned images are already handled as text by the existing
// imageMessage.caption branch).
//
// Returns a natural-language description + answer to any user question.
// ─────────────────────────────────────────────────────────────────────────────

const NVIDIA_VISION_MODEL = "microsoft/phi-3.5-vision-instruct";
const OPENAI_VISION_MODEL = "gpt-4o-mini";
const NVIDIA_REASONING_MODEL = "meta/llama-3.3-70b-instruct";
const OPENAI_REASONING_MODEL = "gpt-4o-mini";
const VISION_TIMEOUT_MS = 25_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Types ────────────────────────────────────────────────────────────────────

type VisionMessage = {
  role: "user" | "assistant" | "system";
  content:
    | string
    | Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
      >;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
};

type TextMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

// ─── Core API call ────────────────────────────────────────────────────────────

async function callVisionModel(
  messages: VisionMessage[],
  apiUrl: string,
  apiKey: string,
  model: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        temperature: 0.2,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      logClawCloudProviderEvent("warn", "vision", "provider_failed", {
        provider: model,
        status: response.status,
        reason: "non_ok_response",
        error: errorText.slice(0, 200),
      });
      return null;
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      logClawCloudProviderEvent("warn", "vision", "provider_failed", {
        provider: model,
        reason: "timeout",
      });
    } else {
      logClawCloudProviderEvent("error", "vision", "provider_failed", {
        provider: model,
        reason: "exception",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callTextModel(
  messages: TextMessage[],
  apiUrl: string,
  apiKey: string,
  model: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        temperature: 0.1,
        messages,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      logClawCloudProviderEvent("warn", "vision_reasoning", "provider_failed", {
        provider: model,
        status: response.status,
        reason: "non_ok_response",
        error: errorText.slice(0, 200),
      });
      return null;
    }

    const data = (await response.json()) as ChatCompletionResponse;
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      logClawCloudProviderEvent("warn", "vision_reasoning", "provider_failed", {
        provider: model,
        reason: "timeout",
      });
    } else {
      logClawCloudProviderEvent("error", "vision_reasoning", "provider_failed", {
        provider: model,
        reason: "exception",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildImageDescriptionPrompt() {
  return [
    "Describe this image clearly and accurately.",
    "If there is visible text, quote the important text exactly.",
    "If the image is a screenshot, table, dashboard, or document, list the key rows or fields as bullets.",
    "Do not invent details that are not visible.",
  ].join(" ");
}

function buildImageExtractionPrompt() {
  return [
    "Read this image carefully.",
    "Transcribe the visible text exactly, including names, labels, row values, codes, dates, and numbers.",
    "If the image contains a table, grid, or dashboard, rewrite each important row or field as a separate bullet.",
    "Do not answer any question yet and do not guess missing values.",
    "Reply exactly in this format:",
    "VISIBLE_TEXT:",
    "<exact text>",
    "",
    "STRUCTURED_FACTS:",
    "- <fact 1>",
    "- <fact 2>",
  ].join("\n");
}

function buildGroundedReasoningPrompt(
  extractedEvidence: string,
  userQuestion: string,
) {
  return [
    "You are answering a question about an image using extracted visual evidence only.",
    "Use only the evidence below.",
    "Follow every rule in the user's question in the exact order given.",
    "If the winning answer has an owner, engineer, assignee, or named person attached to it, include that name in the final answer.",
    "If a row is excluded by a rule, say so briefly.",
    "If there is a tie-break, apply it explicitly.",
    "If the evidence is insufficient, say what is missing instead of guessing.",
    "",
    "User question:",
    userQuestion.trim(),
    "",
    "Extracted image evidence:",
    extractedEvidence.trim().slice(0, 6_000),
    "",
    "Reply in this format:",
    "Final answer: <one sentence>",
    "Why:",
    "- <short bullet citing the exact row/value used>",
    "- <short bullet showing the rule or tie-break>",
  ].join("\n");
}

async function runVisionPrompt(
  dataUrl: string,
  prompt: string,
  nvidiaUrl: string,
  nvidiaKey?: string,
  openaiKey?: string,
): Promise<string | null> {
  const messages: VisionMessage[] = [
    {
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: dataUrl },
        },
        {
          type: "text",
          text: prompt,
        },
      ],
    },
  ];

  if (nvidiaKey) {
    logClawCloudProviderEvent("info", "vision", "provider_attempt", {
      provider: "nvidia",
      model: NVIDIA_VISION_MODEL,
      prompt_chars: prompt.length,
    });
    const result = await callVisionModel(
      messages,
      nvidiaUrl,
      nvidiaKey,
      NVIDIA_VISION_MODEL,
    );
    if (result) {
      logClawCloudProviderEvent("info", "vision", "provider_succeeded", {
        provider: "nvidia",
        model: NVIDIA_VISION_MODEL,
        chars: result.length,
      });
      return result;
    }
    logClawCloudProviderEvent("warn", "vision", "fallback_triggered", {
      from: "nvidia",
      to: "openai",
      reason: "primary_failed",
    });
  }

  if (openaiKey) {
    logClawCloudProviderEvent("info", "vision", "provider_attempt", {
      provider: "openai",
      model: OPENAI_VISION_MODEL,
      prompt_chars: prompt.length,
    });
    const result = await callVisionModel(
      messages,
      "https://api.openai.com/v1/chat/completions",
      openaiKey,
      OPENAI_VISION_MODEL,
    );
    if (result) {
      logClawCloudProviderEvent("info", "vision", "provider_succeeded", {
        provider: "openai",
        model: OPENAI_VISION_MODEL,
        chars: result.length,
      });
      return result;
    }
    logClawCloudProviderEvent("warn", "vision", "provider_failed", {
      provider: "openai",
      model: OPENAI_VISION_MODEL,
      reason: "fallback_failed",
    });
  }

  return null;
}

async function runGroundedReasoning(
  extractedEvidence: string,
  userQuestion: string,
  nvidiaUrl: string,
  nvidiaKey?: string,
  openaiKey?: string,
): Promise<string | null> {
  const messages: TextMessage[] = [
    {
      role: "user",
      content: buildGroundedReasoningPrompt(extractedEvidence, userQuestion),
    },
  ];

  if (nvidiaKey) {
    const result = await callTextModel(
      messages,
      nvidiaUrl,
      nvidiaKey,
      NVIDIA_REASONING_MODEL,
    );
    if (result) {
      return result;
    }
  }

  if (openaiKey) {
    const result = await callTextModel(
      messages,
      "https://api.openai.com/v1/chat/completions",
      openaiKey,
      OPENAI_REASONING_MODEL,
    );
    if (result) {
      return result;
    }
  }

  return null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Analyse an image and answer the user's question about it.
 *
 * @param imageBuffer   Raw image bytes (JPEG, PNG, WebP accepted)
 * @param mimeType      MIME type (e.g. "image/jpeg")
 * @param userQuestion  What the user typed alongside the image (may be empty)
 * @returns             AI description / answer, or null on failure
 */
export async function analyseImage(
  imageBuffer: Buffer,
  mimeType: string = "image/jpeg",
  userQuestion: string = "",
): Promise<string | null> {
  if (!imageBuffer || imageBuffer.length === 0) {
    logClawCloudProviderEvent("warn", "vision", "provider_failed", {
      reason: "empty_image_buffer",
    });
    return null;
  }

  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    logClawCloudProviderEvent("warn", "vision", "provider_failed", {
      reason: "image_too_large",
      size_mb: Number((imageBuffer.length / 1024 / 1024).toFixed(1)),
    });
    return null;
  }

  // Convert to base64 data URL
  const base64 = imageBuffer.toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const hasUserQuestion = Boolean(userQuestion.trim());

  const nvidiaKey = process.env.NVIDIA_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const nvidiaBase = (
    process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1"
  )
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "");
  const nvidiaUrl = `${/\/v\d+$/i.test(nvidiaBase) ? nvidiaBase : `${nvidiaBase}/v1`}/chat/completions`;

  logClawCloudProviderEvent("info", "vision", "analysis_started", {
    bytes: imageBuffer.length,
    had_question: hasUserQuestion,
  });

  if (hasUserQuestion) {
    const extractedEvidence = await runVisionPrompt(
      dataUrl,
      buildImageExtractionPrompt(),
      nvidiaUrl,
      nvidiaKey,
      openaiKey,
    );

    if (extractedEvidence) {
      const groundedAnswer = await runGroundedReasoning(
        extractedEvidence,
        userQuestion,
        nvidiaUrl,
        nvidiaKey,
        openaiKey,
      );
      if (groundedAnswer) {
        return groundedAnswer;
      }
    }
  }

  const fallbackPrompt = hasUserQuestion
    ? [
        "Study this image carefully and read the visible text exactly before answering.",
        "Use only the contents of the image.",
        "Question:",
        userQuestion.trim(),
        "",
        "Give a direct answer and then 1-2 short bullets explaining which exact values or rows support it.",
      ].join("\n")
    : buildImageDescriptionPrompt();

  const result = await runVisionPrompt(
    dataUrl,
    fallbackPrompt,
    nvidiaUrl,
    nvidiaKey,
    openaiKey,
  );
  if (result) {
    return result;
  }

  if (!nvidiaKey && !openaiKey) {
    logClawCloudProviderEvent("warn", "vision", "provider_unavailable", {
      reason: "missing_api_keys",
    });
  }

  return null;
}

/**
 * Returns true if at least one vision provider is available.
 */
export function isVisionAvailable(): boolean {
  return Boolean(
    process.env.NVIDIA_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
  );
}

/**
 * Wraps the raw vision answer in WhatsApp-friendly formatting.
 */
export function formatVisionReply(
  rawAnswer: string,
  hadCaption: boolean,
): string {
  const prefix = hadCaption ? "🖼️ *Image analysis:*\n\n" : "🖼️ *Here's what I see:*\n\n";
  return prefix + rawAnswer;
}
