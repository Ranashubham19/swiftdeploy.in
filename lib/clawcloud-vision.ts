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
const NVIDIA_REASONING_MODEL = "meta/llama-4-maverick-17b-128e-instruct";
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
    "You are a WhatsApp AI assistant. A user just sent you this image on WhatsApp.",
    "RESPOND to the image like a smart friend would — understand WHAT the image means and reply accordingly.",
    "Return one compact WhatsApp reply only. Do not split the answer into titled sections or multiple separate blocks.",
    "",
    "CRITICAL RULES:",
    "1. GREETING IMAGES (Good Morning/सुप्रभात/Good Night/शुभ रात्रि/Happy Birthday/festival wishes/motivational quotes):",
    "   → Reply with a warm greeting in the SAME LANGUAGE as the text in the image.",
    "   → Example: Image says 'सुप्रभात' with Hindi poetry → Reply: 'सुप्रभात! 🌅 आपका दिन मंगलमय हो। बहुत सुंदर संदेश!'",
    "   → Example: Image says 'Good Morning' → Reply: 'Good morning! Wishing you a beautiful day ahead! 🌞'",
    "   → Do NOT translate the text. Do NOT describe flowers, birds, or backgrounds. Just greet back warmly.",
    "",
    "2. MEMES/JOKES → React to the humor. Laugh, comment on the joke.",
    "3. PHOTOS of people/places/events → Comment on what's happening, not visual details.",
    "4. SCREENSHOTS of apps/chats/UI → Respond to the CONTENT shown, ignore UI elements.",
    "5. DOCUMENTS/TABLES/DATA → Extract KEY information with bullet points.",
    "6. QUESTIONS/PROBLEMS (math, quiz, homework) → Solve directly.",
    "7. MOTIVATIONAL/INSPIRATIONAL quotes → Acknowledge the message positively in the same language.",
    "",
    "STRICTLY FORBIDDEN:",
    "- NEVER say 'The image contains...', 'The image displays...', 'I can see...', 'It is accompanied by...'",
    "- NEVER describe visual elements: colors, backgrounds, birds, flowers, fonts, layout, watermarks, website URLs",
    "- NEVER mention 'status bar', 'dark theme', 'notification icon', 'blurred background'",
    "- NEVER say you need extracted text, that you are assuming extracted text exists, or that the user should provide OCR text first",
    "- NEVER translate or transcribe the text unless asked — just RESPOND to its meaning",
    "- NEVER give a second paragraph about what the image 'suggests' or 'indicates'",
    "",
    "Your response must be SHORT (2-4 sentences max), warm, and natural — like replying to a friend on WhatsApp.",
  ].join("\n");
}

function buildImageExtractionPrompt() {
  return [
    "Read this image carefully.",
    "Transcribe the visible text exactly, including names, labels, row values, codes, dates, and numbers.",
    "If this is a screenshot, QR payment page, invoice, booking page, or dashboard, capture the app names, payment rails, amounts, timers, statuses, warnings, and identifiers that are visibly shown.",
    "If the image contains a table, grid, or dashboard, rewrite each important row or field as a separate bullet.",
    "If anything is unreadable or cut off, say that it is unreadable instead of guessing.",
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
    "Reply in the same language as the user's question unless the user explicitly asked for another language.",
    "Return one compact WhatsApp reply only. Do not add decorative headers or split the answer into multiple titled sections.",
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

function buildImageEvidenceSummaryPrompt(
  extractedEvidence: string,
  userQuestion: string,
) {
  const trimmedQuestion = userQuestion.trim();

  return [
    "You are preparing a final reply from extracted image evidence only.",
    "Use only the evidence below.",
    "Reply in the same language as the user's question when a question is provided. Otherwise match the dominant language visible in the image.",
    "Return one compact WhatsApp reply only. Do not use multiple titled sections or separated answer blocks.",
    "If the image is a screenshot, payment page, QR code, table, or dashboard, focus on the exact visible content such as app names, amounts, timers, statuses, warnings, codes, and identifiers.",
    "If any detail is partial or unreadable, say that briefly instead of guessing.",
    "",
    trimmedQuestion ? "User question:" : "Task:",
    trimmedQuestion || "Summarize what this image shows in a concise, professional way.",
    "",
    "Extracted image evidence:",
    extractedEvidence.trim().slice(0, 6_000),
    "",
    trimmedQuestion
      ? "Reply with a direct answer followed by 1-2 short bullets citing the exact visible evidence."
      : "Reply with 2-4 sentences that explain the most important visible details and the key action or conclusion the user should notice.",
  ].join("\n");
}

function hasMeaningfulImageEvidence(extractedEvidence: string) {
  const normalized = extractedEvidence
    .replace(/visible_text:/gi, "")
    .replace(/structured_facts:/gi, "")
    .replace(/[-:\s]/g, "")
    .trim();

  return normalized.length >= 24;
}

function looksLikeVisionPlaceholderReply(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return true;
  }

  return [
    /\bextract(?:ed)? text from image\b/i,
    /\bassume the extracted text is available\b/i,
    /\bdon'?t have the actual extracted text\b/i,
    /\bprovide the extracted text\b/i,
    /\bshare the extracted text\b/i,
    /\bwait for more information about the image\b/i,
    /\boriginal message was an image\b/i,
    /\bi (?:cannot|can't|do not|don't) have the (?:actual )?extracted text\b/i,
    /\bi (?:cannot|can't|do not|don't) (?:see|view|access) the image\b/i,
    /^\s*(?:visible_text|structured_facts):/i,
  ].some((pattern) => pattern.test(trimmed));
}

async function runEvidenceSummary(
  extractedEvidence: string,
  userQuestion: string,
  nvidiaUrl: string,
  nvidiaKey?: string,
  openaiKey?: string,
): Promise<string | null> {
  const messages: TextMessage[] = [
    {
      role: "user",
      content: buildImageEvidenceSummaryPrompt(extractedEvidence, userQuestion),
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

function logRejectedVisionReply(stage: string, raw: string) {
  logClawCloudProviderEvent("warn", "vision", "analysis_rejected", {
    stage,
    preview: raw.trim().slice(0, 180),
  });
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

  const extractedEvidence = await runVisionPrompt(
    dataUrl,
    buildImageExtractionPrompt(),
    nvidiaUrl,
    nvidiaKey,
    openaiKey,
  );

  if (extractedEvidence && hasMeaningfulImageEvidence(extractedEvidence)) {
    if (hasUserQuestion) {
      const groundedAnswer = await runGroundedReasoning(
        extractedEvidence,
        userQuestion,
        nvidiaUrl,
        nvidiaKey,
        openaiKey,
      );
      if (groundedAnswer && !looksLikeVisionPlaceholderReply(groundedAnswer)) {
        return groundedAnswer;
      }
      if (groundedAnswer) {
        logRejectedVisionReply("grounded_reasoning", groundedAnswer);
      }
    }

    const evidenceSummary = await runEvidenceSummary(
      extractedEvidence,
      userQuestion,
      nvidiaUrl,
      nvidiaKey,
      openaiKey,
    );
    if (evidenceSummary && !looksLikeVisionPlaceholderReply(evidenceSummary)) {
      return evidenceSummary;
    }
    if (evidenceSummary) {
      logRejectedVisionReply("evidence_summary", evidenceSummary);
    }
  }

  const fallbackPrompt = hasUserQuestion
    ? [
        "Study this image carefully and read the visible text exactly before answering.",
        "Use only the contents of the image.",
        "Reply in the same language as the user's question unless the user asked for another language.",
        "Do not say that extracted text is missing, that OCR is unavailable, or that the user should provide the extracted text first.",
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
  if (result && !looksLikeVisionPlaceholderReply(result)) {
    return result;
  }
  if (result) {
    logRejectedVisionReply("fallback_prompt", result);
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
 * Clean up vision model output — strip description-style phrasing that leaked
 * through despite prompt instructions.
 */
function cleanVisionResponse(raw: string): string {
  let cleaned = raw.trim();

  cleaned = cleaned.replace(/^final answer:\s*/i, "");
  cleaned = cleaned.replace(/\nwhy:\s*/i, "\n\nWhy:\n");

  // Strip description-style opening phrases
  const descriptionPrefixes = [
    /^the image (?:contains|displays|shows|depicts|features|is)\b[^.]*\.\s*/i,
    /^this image (?:contains|displays|shows|depicts|features|is)\b[^.]*\.\s*/i,
    /^i (?:can see|see|notice)\b[^.]*\.\s*/i,
    /^it is accompanied by\b[^.]*\.\s*/i,
    /^the (?:overall )?(?:image|picture|photo) (?:appears to be|seems to be|looks like)\b[^.]*\.\s*/i,
  ];

  for (const prefix of descriptionPrefixes) {
    cleaned = cleaned.replace(prefix, "");
  }

  // Strip trailing sentences that describe visual elements
  const trailingDescriptions = [
    /\.\s*(?:The website|The watermark|The URL|A website)\s+"?[^"]*"?\s+is (?:also )?visible\.?\s*$/i,
    /\.\s*It is accompanied by[^.]*\.?\s*$/i,
    /\.\s*The (?:background|image|photo) (?:shows|features|has|contains)[^.]*\.?\s*$/i,
  ];

  for (const trailing of trailingDescriptions) {
    cleaned = cleaned.replace(trailing, ".");
  }

  return cleaned.trim();
}

function compactVisionReplyForWhatsApp(raw: string): string {
  const normalized = cleanVisionResponse(raw)
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!normalized) {
    return "";
  }

  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const compactLines: string[] = [];

  for (const line of lines) {
    if (/^(?:🖼️\s*)?\*?image analysis:?\*?$/i.test(line)) {
      continue;
    }
    if (/^\*?why:?\*?$/i.test(line)) {
      continue;
    }

    const bulletNormalized = line
      .replace(/^[•*]\s+/, "- ")
      .replace(/^\d+\)\s+/, (match) => match.replace(")", "."));

    compactLines.push(bulletNormalized);
  }

  return compactLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function looksLikeVisionPlaceholderReplyForTest(raw: string) {
  return looksLikeVisionPlaceholderReply(raw);
}

/**
 * Wraps the raw vision answer in WhatsApp-friendly formatting.
 * For captioned images (user asked a question), prefix with analysis header.
 * For uncaptioned images, return the natural response directly — no "Here's what I see" header.
 */
export function formatVisionReply(
  rawAnswer: string,
  hadCaption: boolean,
): string {
  const cleaned = compactVisionReplyForWhatsApp(rawAnswer);

  if (hadCaption) {
    return cleaned;
  }
  // No prefix for uncaptioned images — the AI response is already natural and conversational
  return cleaned;
}
