function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function coalesceWhatsAppStreamChunks(chunks: string[], maxChunks = 6) {
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

/**
 * Split a WhatsApp reply into small, granular chunks for Meta AI-style
 * word-by-word typing delivery. Each chunk is a logical "sentence" or
 * short paragraph that appears progressively, creating a natural typing feel.
 */
export function splitWhatsAppStreamChunks(text: string): string[] {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return [];
  }

  // Preserve code blocks as single chunks
  const codeBlocks: string[] = [];
  const withPlaceholders = normalized.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match.trim());
    return `___CODE_BLOCK_${codeBlocks.length - 1}___`;
  });

  const chunks: string[] = [];
  const sections = withPlaceholders.split(/\n\n+/);

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // Code blocks stay as one chunk
    if (/^___CODE_BLOCK_\d+___$/.test(trimmed)) {
      const idx = Number.parseInt(trimmed.match(/\d+/)?.[0] ?? "-1", 10);
      if (idx >= 0 && codeBlocks[idx]) {
        chunks.push(codeBlocks[idx]);
      }
      continue;
    }

    // Section headers (*bold header* on their own line) — keep as their own chunk
    const lines = trimmed.split("\n");
    if (lines.length === 1 && /^\*[^*]+\*$/.test(trimmed)) {
      chunks.push(trimmed);
      continue;
    }

    // Short sections (under 120 chars) — keep as single chunk for snappy delivery
    if (trimmed.length <= 160) {
      chunks.push(trimmed);
      continue;
    }

    // Bullet lists: group every 2-3 bullets as a chunk
    const isBulletList = lines.every(
      (line) => /^[•\-\d]+[.)]\s/.test(line.trim()) || /^\*[^*]+\*$/.test(line.trim()) || !line.trim(),
    );
    if (isBulletList) {
      let currentGroup: string[] = [];
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        // Headers start a new chunk
        if (/^\*[^*]+\*$/.test(t) && currentGroup.length > 0) {
          chunks.push(currentGroup.join("\n"));
          currentGroup = [t];
          continue;
        }
        currentGroup.push(t);
        if (currentGroup.length >= 4) {
          chunks.push(currentGroup.join("\n"));
          currentGroup = [];
        }
      }
      if (currentGroup.length > 0) {
        chunks.push(currentGroup.join("\n"));
      }
      continue;
    }

    // Longer prose: split by sentences, keeping chunks to ~100–150 chars
    const sentences = trimmed.split(/(?<=[.!?])\s+/);
    let current = "";
    for (const sentence of sentences) {
      const candidate = current ? `${current} ${sentence}` : sentence;
      if (candidate.length > 220 && current) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = candidate;
      }
    }

    if (current.trim()) {
      chunks.push(current.trim());
    }
  }

  return coalesceWhatsAppStreamChunks(chunks.filter(Boolean));
}

/**
 * Delay between chunks — calibrated for natural Meta AI-style typing feel.
 * Shorter chunks get faster delivery; code blocks get slightly longer.
 */
export function whatsAppChunkDelayMs(chunk: string) {
  // Code blocks: longer pause to simulate "processing"
  if (chunk.startsWith("```")) {
    return clampNumber(260 + chunk.length * 0.6, 320, 900);
  }

  // Section headers: quick flash
  if (/^\*[^*]+\*$/.test(chunk.trim())) {
    return clampNumber(140, 120, 220);
  }

  // Bullet groups: moderate pace
  if (/^[•\-]/.test(chunk.trim())) {
    const bulletCount = (chunk.match(/^[•\-]/gm) || []).length;
    return clampNumber(180 + bulletCount * 90, 220, 650);
  }

  // Regular text: word-count based for natural reading pace
  const words = chunk.split(/\s+/).filter(Boolean).length;
  return clampNumber(120 + words * 18, 180, 650);
}

/**
 * Initial "thinking" delay before first chunk — simulates AI processing.
 * Shorter for simple messages, longer for complex ones.
 */
export function whatsAppInitialTypingDelayMs(text: string) {
  const len = text.trim().length;
  if (len < 80) return 120;
  if (len < 220) return 180;
  if (len < 600) return 240;
  return 320;
}

/**
 * Whether a reply should use staged (typing-style) delivery.
 * Lower threshold = more messages get the typing effect.
 */
export function shouldStageWhatsAppReply(text: string, minLength = 24) {
  return text.replace(/\s+/g, " ").trim().length >= minLength;
}
