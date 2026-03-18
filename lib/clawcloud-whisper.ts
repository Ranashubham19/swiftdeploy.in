// lib/clawcloud-whisper.ts
// ─────────────────────────────────────────────────────────────────────────────
// Voice note transcription using Groq Whisper (primary) or OpenAI Whisper
// (fallback). Both use the same request shape — only the base URL differs.
//
// Called from agent-server.ts when Baileys delivers an audioMessage.
// Returns the transcribed text string, or null on failure.
// ─────────────────────────────────────────────────────────────────────────────

const GROQ_WHISPER_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const OPENAI_WHISPER_URL =
  "https://api.openai.com/v1/audio/transcriptions";

const WHISPER_MODEL_GROQ = "whisper-large-v3-turbo";
const WHISPER_MODEL_OPENAI = "whisper-1";

const WHISPER_TIMEOUT_MS = 20_000;

// ─── Types ────────────────────────────────────────────────────────────────────

type WhisperResponse = {
  text?: string;
  error?: { message?: string };
};

// ─── Core call ────────────────────────────────────────────────────────────────

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
      console.error(
        `[whisper] ${response.status} from ${apiUrl}: ${errorText.slice(0, 200)}`,
      );
      return null;
    }

    // response_format=text returns plain text, not JSON
    const result = await response.text();
    const trimmed = result.trim();
    return trimmed || null;
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      console.warn("[whisper] Transcription timed out");
    } else {
      console.error(
        "[whisper] Error:",
        error instanceof Error ? error.message : error,
      );
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Transcribe a WhatsApp audio/voice note to text.
 *
 * Tries Groq first (faster, free tier), falls back to OpenAI if Groq fails
 * or is not configured.
 *
 * @param audioBuffer  Raw audio bytes (opus, mp4, ogg, webm accepted)
 * @param mimeType     MIME type reported by WhatsApp (e.g. "audio/ogg; codecs=opus")
 * @returns            Transcribed text, or null on failure
 */
export async function transcribeAudioBuffer(
  audioBuffer: Buffer,
  mimeType: string = "audio/ogg",
): Promise<string | null> {
  if (!audioBuffer || audioBuffer.length === 0) {
    console.warn("[whisper] Empty audio buffer, skipping transcription");
    return null;
  }

  // Determine a suitable filename extension from MIME type
  const ext = mimeTypeToExtension(mimeType);
  const fileName = `voice_note.${ext}`;

  const groqKey = process.env.GROQ_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  // Try Groq (primary — faster and free tier available)
  if (groqKey) {
    console.log(
      `[whisper] Trying Groq Whisper for ${audioBuffer.length} byte audio`,
    );
    const result = await callWhisper(
      audioBuffer,
      mimeType,
      fileName,
      GROQ_WHISPER_URL,
      groqKey,
      WHISPER_MODEL_GROQ,
    );
    if (result) {
      console.log(
        `[whisper] Groq success: "${result.slice(0, 80)}${result.length > 80 ? "..." : ""}"`,
      );
      return result;
    }
    console.warn("[whisper] Groq failed, trying OpenAI fallback");
  }

  // Try OpenAI (fallback)
  if (openaiKey) {
    console.log("[whisper] Trying OpenAI Whisper fallback");
    const result = await callWhisper(
      audioBuffer,
      mimeType,
      fileName,
      OPENAI_WHISPER_URL,
      openaiKey,
      WHISPER_MODEL_OPENAI,
    );
    if (result) {
      console.log(
        `[whisper] OpenAI success: "${result.slice(0, 80)}${result.length > 80 ? "..." : ""}"`,
      );
      return result;
    }
    console.warn("[whisper] OpenAI also failed");
  }

  if (!groqKey && !openaiKey) {
    console.warn(
      "[whisper] No GROQ_API_KEY or OPENAI_API_KEY set — voice transcription unavailable",
    );
  }

  return null;
}

/**
 * Returns true if the environment has at least one Whisper provider configured.
 * Use this to decide whether to attempt audio download at all.
 */
export function isWhisperAvailable(): boolean {
  return Boolean(
    process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mimeTypeToExtension(mimeType: string): string {
  const lower = mimeType.toLowerCase();

  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("opus")) return "ogg"; // WhatsApp voice notes
  if (lower.includes("mp4") || lower.includes("m4a")) return "m4a";
  if (lower.includes("webm")) return "webm";
  if (lower.includes("mp3") || lower.includes("mpeg")) return "mp3";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("flac")) return "flac";

  return "ogg"; // WhatsApp default
}
