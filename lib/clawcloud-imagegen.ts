const TOGETHER_API_URL = "https://api.together.xyz/v1/images/generations";
const STABILITY_API_URL = "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image";
const IMAGEGEN_TIMEOUT_MS = 45_000;

export type ImageGenResult = {
  imageBuffer: Buffer;
  mimeType: "image/jpeg" | "image/png";
  revisedPrompt?: string;
};

const IMAGE_GEN_PATTERNS = [
  /\b(generate|create|make|draw|design|produce|render)\s+(a|an|me|my|the|some)?\s*(image|photo|picture|poster|logo|banner|thumbnail|illustration|artwork|painting|drawing|wallpaper|avatar|icon|meme|flyer|graphic)\b/i,
  /\b(image|photo|picture|logo|poster|banner)\s+(of|for|showing|depicting|with)\b/i,
  /\btext[- ]to[- ]image\b/i,
  /\bgenerate image\b/i,
  /\bdraw (me|a|an|the)\b/i,
  /\bcreate (me|a|an|the).*(image|photo|picture|logo|poster)\b/i,
  /\bai (art|image|photo|picture)\b/i,
];

export function detectImageGenIntent(message: string): boolean {
  return IMAGE_GEN_PATTERNS.some((pattern) => pattern.test(message));
}

export function extractImagePrompt(message: string): string {
  return message
    .replace(/^(please\s+)?(can you|could you|will you)\s+/i, "")
    .replace(/^(generate|create|make|draw|design|produce|render)\s+(a|an|me|my|the|some)?\s*/i, "")
    .replace(/^(image|photo|picture)\s+(of|for|showing|depicting|with)\s*/i, "")
    .replace(/\b(please)\b/gi, "")
    .trim()
    || message.trim();
}

function enhancePrompt(rawPrompt: string): string {
  const lower = rawPrompt.toLowerCase();
  const hasStyleHint = /\b(realistic|cartoon|anime|watercolor|oil painting|3d|sketch|minimalist|vintage|modern|professional|photorealistic)\b/i.test(rawPrompt);

  if (/\b(logo|brand|business card|icon)\b/i.test(lower)) {
    return `${rawPrompt}, professional logo design, clean vector style, white background, high quality`;
  }

  if (/\b(poster|flyer|banner|advertisement)\b/i.test(lower)) {
    return `${rawPrompt}, professional graphic design, vibrant colors, high resolution`;
  }

  if (/\b(person|man|woman|portrait|face|character)\b/i.test(lower)) {
    return `${rawPrompt}, high quality portrait, detailed, professional photography style`;
  }

  if (!hasStyleHint) {
    return `${rawPrompt}, high quality, detailed, professional`;
  }

  return rawPrompt;
}

async function generateWithTogether(prompt: string): Promise<ImageGenResult | null> {
  const apiKey = process.env.TOGETHER_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGEGEN_TIMEOUT_MS);

  try {
    const response = await fetch(TOGETHER_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "black-forest-labs/FLUX.1-schnell-Free",
        prompt: enhancePrompt(prompt),
        width: 1024,
        height: 1024,
        steps: 4,
        n: 1,
        response_format: "b64_json",
      }),
    });

    if (!response.ok) {
      console.error(`[imagegen] Together AI ${response.status}`);
      return null;
    }

    const data = await response.json() as { data?: Array<{ b64_json?: string }> };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) {
      return null;
    }

    return {
      imageBuffer: Buffer.from(b64, "base64"),
      mimeType: "image/jpeg",
    };
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      console.error("[imagegen] Together AI error:", error instanceof Error ? error.message : error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function generateWithStability(prompt: string): Promise<ImageGenResult | null> {
  const apiKey = process.env.STABILITY_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGEGEN_TIMEOUT_MS);

  try {
    const response = await fetch(STABILITY_API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        text_prompts: [{ text: enhancePrompt(prompt), weight: 1 }],
        cfg_scale: 7,
        height: 1024,
        width: 1024,
        samples: 1,
        steps: 30,
      }),
    });

    if (!response.ok) {
      console.error(`[imagegen] Stability AI ${response.status}`);
      return null;
    }

    const data = await response.json() as { artifacts?: Array<{ base64?: string }> };
    const b64 = data.artifacts?.[0]?.base64;
    if (!b64) {
      return null;
    }

    return {
      imageBuffer: Buffer.from(b64, "base64"),
      mimeType: "image/png",
    };
  } catch (error) {
    if ((error as Error)?.name !== "AbortError") {
      console.error("[imagegen] Stability AI error:", error instanceof Error ? error.message : error);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function generateImage(prompt: string): Promise<ImageGenResult | null> {
  console.log(`[imagegen] Generating: "${prompt.slice(0, 80)}"`);

  const together = await generateWithTogether(prompt);
  if (together) {
    console.log(`[imagegen] Together AI success: ${together.imageBuffer.length} bytes`);
    return together;
  }

  const stability = await generateWithStability(prompt);
  if (stability) {
    console.log(`[imagegen] Stability AI success: ${stability.imageBuffer.length} bytes`);
    return stability;
  }

  console.warn("[imagegen] All providers failed");
  return null;
}

export function isImageGenAvailable(): boolean {
  return Boolean(
    process.env.TOGETHER_API_KEY?.trim()
    || process.env.STABILITY_API_KEY?.trim(),
  );
}
