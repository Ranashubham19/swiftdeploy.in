function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export type WhatsAppStreamPlan = {
  chunks: string[];
  initialDelayMs: number;
  chunkDelayMs: number[];
  totalDelayMs: number;
};

const MAX_STREAM_CHUNKS = 4;
const BULLET_LINE_RE = /^(?:[\u2022*-]|\d+[.)])\s+/;

function coalesceWhatsAppStreamChunks(chunks: string[], maxChunks = MAX_STREAM_CHUNKS) {
  if (chunks.length <= maxChunks) {
    return chunks;
  }

  const groupSize = Math.ceil(chunks.length / maxChunks);
  const merged: string[] = [];

  for (let index = 0; index < chunks.length; index += groupSize) {
    merged.push(chunks.slice(index, index + groupSize).join("\n\n").trim());
  }

  return merged;
}

function targetStreamDurationMs(text: string, chunkCount: number) {
  const len = text.trim().length;
  if (chunkCount <= 1) {
    return whatsAppInitialTypingDelayMs(text);
  }
  // Longer typing gaps between chunks for a natural streaming feel
  if (len < 120) return 1_200;
  if (len < 320) return 2_000;
  if (len < 700) return 3_000;
  return 4_000;
}

/**
 * Always keep the reply as a single message bubble.
 * The "streaming" feel comes from a longer, proportional typing indicator
 * before sending — not from splitting the answer into multiple messages.
 */
export function splitWhatsAppStreamChunks(text: string): string[] {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  return normalized ? [normalized] : [];
}

export function whatsAppChunkDelayMs(chunk: string) {
  const normalized = chunk.trim();
  if (!normalized) {
    return 0;
  }
  if (normalized.startsWith("```")) {
    return 40;
  }
  if (/^\*[^*]+\*$/.test(normalized)) {
    return 15;
  }
  if (BULLET_LINE_RE.test(normalized)) {
    const bulletCount = normalized.split(/\n/).filter((line) => BULLET_LINE_RE.test(line.trim())).length;
    return clampNumber(15 + bulletCount * 6, 20, 45);
  }
  const words = normalized.split(/\s+/).filter(Boolean).length;
  return clampNumber(10 + words * 2, 15, 40);
}

export function whatsAppInitialTypingDelayMs(text: string) {
  const len = text.trim().length;
  const lineCount = text.split(/\n/).filter((line) => line.trim()).length;
  const hasCodeBlock = text.includes("```");
  const bulletCount = text
    .split(/\n/)
    .filter((line) => BULLET_LINE_RE.test(line.trim())).length;

  // Base delay scales with answer length — longer answers get a longer
  // "typing..." indicator so it feels like someone is composing the reply
  let baseDelayMs = 350;
  if (len >= 80) baseDelayMs = 600;
  if (len >= 220) baseDelayMs = 1_000;
  if (len >= 600) baseDelayMs = 1_600;
  if (len >= 1_000) baseDelayMs = 2_200;
  if (len >= 1_800) baseDelayMs = 2_800;

  baseDelayMs += Math.min(300, Math.max(0, lineCount - 3) * 40);
  baseDelayMs += Math.min(200, bulletCount * 22);
  if (hasCodeBlock) {
    baseDelayMs += 200;
  }

  return clampNumber(baseDelayMs, 350, 3_500);
}

export function buildWhatsAppStreamPlan(text: string): WhatsAppStreamPlan {
  const chunks = splitWhatsAppStreamChunks(text);
  const initialDelayMs = whatsAppInitialTypingDelayMs(text);

  if (!chunks.length) {
    return {
      chunks: [],
      initialDelayMs,
      chunkDelayMs: [],
      totalDelayMs: initialDelayMs,
    };
  }

  const baseInterChunkDelays = chunks
    .slice(0, -1)
    .map((chunk) => whatsAppChunkDelayMs(chunk));
  const targetGapBudget = Math.max(
    0,
    targetStreamDurationMs(text, chunks.length) - initialDelayMs,
  );
  const baseGapBudget = baseInterChunkDelays.reduce((sum, delay) => sum + delay, 0);
  const scale = baseGapBudget > 0
    ? Math.min(1, targetGapBudget / baseGapBudget)
    : 1;
  const chunkDelayMs = baseInterChunkDelays.map((delay) =>
    Math.max(70, Math.round(delay * scale)),
  );

  return {
    chunks,
    initialDelayMs,
    chunkDelayMs,
    totalDelayMs: initialDelayMs + chunkDelayMs.reduce((sum, delay) => sum + delay, 0),
  };
}

export function shouldStageWhatsAppReply(text: string, minLength = 24) {
  return text.replace(/\s+/g, " ").trim().length >= minLength;
}
