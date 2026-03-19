import { logClawCloudProviderEvent } from "@/lib/clawcloud-provider-telemetry";

const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

const WHISPER_MODEL_GROQ = "whisper-large-v3-turbo";
const WHISPER_MODEL_OPENAI = "whisper-1";
const WHISPER_TIMEOUT_MS = 20_000;

async function callWhisper(
  audioBuffer: Buffer,
  mimeType: string,
  fileName: string,
  apiUrl: string,
  apiKey: string,
  model: string,
): Promise<string | null> {
  const formData = new FormData();

  const blob = new Blob([Uint8Array.from(audioBuffer)], { type: mimeType });
  formData.append("file", blob, fileName);
  formData.append("model", model);
  formData.append("response_format", "text");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WHISPER_TIMEOUT_MS);
  const provider = apiUrl.includes("groq") ? "groq" : "openai";

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      logClawCloudProviderEvent("warn", "whisper", "provider_failed", {
        provider,
        status: response.status,
        reason: "non_ok_response",
        error: errorText.slice(0, 200),
      });
      return null;
    }

    const result = await response.text();
    return result.trim() || null;
  } catch (error) {
    logClawCloudProviderEvent(
      (error as Error)?.name === "AbortError" ? "warn" : "error",
      "whisper",
      "provider_failed",
      {
        provider,
        reason: (error as Error)?.name === "AbortError" ? "timeout" : "exception",
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  mimeType: string = "audio/ogg",
): Promise<string | null> {
  if (!audioBuffer || audioBuffer.length === 0) {
    logClawCloudProviderEvent("warn", "whisper", "provider_failed", {
      reason: "empty_audio_buffer",
    });
    return null;
  }

  const ext = mimeTypeToExtension(mimeType);
  const fileName = `voice_note.${ext}`;

  const groqKey = process.env.GROQ_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (groqKey) {
    logClawCloudProviderEvent("info", "whisper", "provider_attempt", {
      provider: "groq",
      bytes: audioBuffer.length,
    });
    const result = await callWhisper(
      audioBuffer,
      mimeType,
      fileName,
      GROQ_WHISPER_URL,
      groqKey,
      WHISPER_MODEL_GROQ,
    );
    if (result) {
      logClawCloudProviderEvent("info", "whisper", "provider_succeeded", {
        provider: "groq",
        chars: result.length,
      });
      return result;
    }

    logClawCloudProviderEvent("warn", "whisper", "fallback_triggered", {
      from: "groq",
      to: "openai",
      reason: "primary_failed",
    });
  }

  if (openaiKey) {
    logClawCloudProviderEvent("info", "whisper", "provider_attempt", {
      provider: "openai",
      bytes: audioBuffer.length,
    });
    const result = await callWhisper(
      audioBuffer,
      mimeType,
      fileName,
      OPENAI_WHISPER_URL,
      openaiKey,
      WHISPER_MODEL_OPENAI,
    );
    if (result) {
      logClawCloudProviderEvent("info", "whisper", "provider_succeeded", {
        provider: "openai",
        chars: result.length,
      });
      return result;
    }

    logClawCloudProviderEvent("warn", "whisper", "provider_failed", {
      provider: "openai",
      reason: "fallback_failed",
    });
  }

  if (!groqKey && !openaiKey) {
    logClawCloudProviderEvent("warn", "whisper", "provider_unavailable", {
      reason: "missing_api_keys",
    });
  }

  return null;
}

export function isWhisperAvailable(): boolean {
  return Boolean(
    process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
  );
}

function mimeTypeToExtension(mimeType: string): string {
  const lower = mimeType.toLowerCase();

  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("opus")) return "ogg";
  if (lower.includes("mp4") || lower.includes("m4a")) return "m4a";
  if (lower.includes("webm")) return "webm";
  if (lower.includes("mp3") || lower.includes("mpeg")) return "mp3";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("flac")) return "flac";

  return "ogg";
}
