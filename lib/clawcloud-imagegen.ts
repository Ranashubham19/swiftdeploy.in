import { logClawCloudProviderEvent } from "@/lib/clawcloud-provider-telemetry";

const IMAGEGEN_TIMEOUT_MS = 40_000;

const IMAGE_GEN_PATTERNS = [
  /\b(generate|create|make|draw|design|produce|render)\s+(a|an|me|my|the|some)?\s*(image|photo|picture|poster|logo|banner|thumbnail|illustration|artwork|painting|drawing|wallpaper|avatar|icon|meme|flyer|graphic)\b/i,
  /\b(image|photo|picture|logo|poster|banner)\s+(of|for|showing|depicting|with)\b/i,
  /\btext[- ]to[- ]image\b/i,
  /\bgenerate image\b/i,
  /\bdraw (me|a|an|the)\b/i,
  /\bcreate (me|a|an|the).*(image|photo|picture|logo|poster)\b/i,
  /\bai (art|image|photo|picture)\b/i,
  /\b(bana|banao|design kar|photo bana)\b/i,
];

export function detectImageGenIntent(message: string): boolean {
  return IMAGE_GEN_PATTERNS.some((pattern) => pattern.test(message));
}

export function extractImagePrompt(message: string): string {
  return message
    .replace(/^(generate|create|make|draw|design|produce|render)\s+(a|an|me|my|the|some)?\s*/i, "")
    .replace(/^(image|photo|picture)\s+(of|for|showing|depicting|with)?\s*/i, "")
    .replace(/\b(please|can you|could you|will you|mujhe|mere liye)\b/gi, "")
    .trim()
    || message.trim();
}

function enhancePrompt(rawPrompt: string): string {
  const lower = rawPrompt.toLowerCase();
  const hasStyleHint = /\b(realistic|cartoon|anime|watercolor|oil painting|3d|sketch|minimalist|vintage|modern|professional|photorealistic)\b/i.test(rawPrompt);

  if (/\b(logo|brand|icon)\b/i.test(lower)) {
    return `${rawPrompt}, professional logo design, clean vector style, white background, high quality`;
  }

  if (/\b(poster|flyer|banner)\b/i.test(lower)) {
    return `${rawPrompt}, professional graphic design, vibrant colors, high resolution`;
  }

  if (!hasStyleHint) {
    return `${rawPrompt}, high quality, detailed`;
  }

  return rawPrompt;
}

async function generateWithPollinations(prompt: string): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGEGEN_TIMEOUT_MS);

  try {
    const encodedPrompt = encodeURIComponent(enhancePrompt(prompt));
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&model=flux&nologo=true&enhance=true`;

    logClawCloudProviderEvent("info", "imagegen", "provider_attempt", {
      provider: "pollinations",
      prompt_preview: prompt.slice(0, 60),
    });

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "ClawCloud-WhatsApp-Bot/1.0",
      },
    });

    if (!response.ok) {
      logClawCloudProviderEvent("warn", "imagegen", "provider_failed", {
        provider: "pollinations",
        status: response.status,
        reason: "non_ok_response",
      });
      return null;
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("image")) {
      logClawCloudProviderEvent("warn", "imagegen", "provider_failed", {
        provider: "pollinations",
        reason: "non_image_response",
        content_type: contentType,
      });
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 5_000) {
      logClawCloudProviderEvent("warn", "imagegen", "provider_failed", {
        provider: "pollinations",
        reason: "small_buffer",
        bytes: buffer.length,
      });
      return null;
    }

    logClawCloudProviderEvent("info", "imagegen", "provider_succeeded", {
      provider: "pollinations",
      bytes: buffer.length,
    });
    return buffer;
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      logClawCloudProviderEvent("error", "imagegen", "provider_failed", {
        provider: "pollinations",
        reason: "exception",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function generateWithHuggingFace(prompt: string): Promise<Buffer | null> {
  const token = process.env.HF_TOKEN?.trim();
  if (!token) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGEGEN_TIMEOUT_MS);

  try {
    logClawCloudProviderEvent("info", "imagegen", "provider_attempt", {
      provider: "huggingface",
      prompt_preview: prompt.slice(0, 60),
    });

    const response = await fetch(
      "https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell",
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: enhancePrompt(prompt),
          parameters: {
            num_inference_steps: 4,
            width: 1024,
            height: 1024,
          },
        }),
      },
    );

    if (response.status === 503) {
      logClawCloudProviderEvent("warn", "imagegen", "provider_failed", {
        provider: "huggingface",
        status: 503,
        reason: "model_loading",
      });
      return null;
    }

    if (!response.ok) {
      logClawCloudProviderEvent("warn", "imagegen", "provider_failed", {
        provider: "huggingface",
        status: response.status,
        reason: "non_ok_response",
      });
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length < 5_000) {
      return null;
    }

    logClawCloudProviderEvent("info", "imagegen", "provider_succeeded", {
      provider: "huggingface",
      bytes: buffer.length,
    });
    return buffer;
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      logClawCloudProviderEvent("error", "imagegen", "provider_failed", {
        provider: "huggingface",
        reason: "exception",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function generateWithGemini(prompt: string): Promise<Buffer | null> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGEGEN_TIMEOUT_MS);

  try {
    logClawCloudProviderEvent("info", "imagegen", "provider_attempt", {
      provider: "gemini",
      prompt_preview: prompt.slice(0, 60),
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-preview-image-generation:generateContent?key=${apiKey}`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: `Generate an image: ${enhancePrompt(prompt)}` }],
          }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
        }),
      },
    );

    if (!response.ok) {
      logClawCloudProviderEvent("warn", "imagegen", "provider_failed", {
        provider: "gemini",
        status: response.status,
        reason: "non_ok_response",
      });
      return null;
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    const imagePart = data.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.mimeType?.startsWith("image/"),
    );

    if (!imagePart?.inlineData?.data) {
      return null;
    }

    const buffer = Buffer.from(imagePart.inlineData.data, "base64");
    logClawCloudProviderEvent("info", "imagegen", "provider_succeeded", {
      provider: "gemini",
      bytes: buffer.length,
    });
    return buffer;
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      logClawCloudProviderEvent("error", "imagegen", "provider_failed", {
        provider: "gemini",
        reason: "exception",
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type ImageGenResult = {
  imageBuffer: Buffer;
  mimeType: "image/jpeg" | "image/png";
};

export function getImageGenerationStatus() {
  const providers = ["pollinations"];

  if (process.env.HF_TOKEN?.trim()) {
    providers.push("huggingface");
  }

  if (process.env.GOOGLE_GEMINI_API_KEY?.trim()) {
    providers.push("gemini");
  }

  return {
    available: providers.length > 0,
    providers,
  };
}

export async function generateImage(prompt: string): Promise<ImageGenResult | null> {
  logClawCloudProviderEvent("info", "imagegen", "generation_started", {
    prompt_preview: prompt.slice(0, 80),
  });

  const pollinations = await generateWithPollinations(prompt);
  if (pollinations) {
    return { imageBuffer: pollinations, mimeType: "image/jpeg" };
  }

  const hf = await generateWithHuggingFace(prompt);
  if (hf) {
    return { imageBuffer: hf, mimeType: "image/jpeg" };
  }

  const gemini = await generateWithGemini(prompt);
  if (gemini) {
    return { imageBuffer: gemini, mimeType: "image/png" };
  }

  logClawCloudProviderEvent("warn", "imagegen", "generation_failed", {
    reason: "all_providers_failed",
    providers: getImageGenerationStatus().providers,
  });
  return null;
}

export function isImageGenAvailable(): boolean {
  return getImageGenerationStatus().available;
}
