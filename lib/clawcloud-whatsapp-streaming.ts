function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function splitWhatsAppStreamChunks(text: string): string[] {
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) {
    return [];
  }

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

    if (/^___CODE_BLOCK_\d+___$/.test(trimmed)) {
      const idx = Number.parseInt(trimmed.match(/\d+/)?.[0] ?? "-1", 10);
      if (idx >= 0 && codeBlocks[idx]) {
        chunks.push(codeBlocks[idx]);
      }
      continue;
    }

    if (trimmed.length <= 180) {
      chunks.push(trimmed);
      continue;
    }

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

  return chunks.filter(Boolean);
}

export function whatsAppChunkDelayMs(chunk: string) {
  if (chunk.startsWith("```")) {
    return clampNumber(700 + chunk.length * 2, 900, 3_200);
  }

  const words = chunk.split(/\s+/).filter(Boolean).length;
  return clampNumber(450 + words * 50, 650, 1_900);
}

export function whatsAppInitialTypingDelayMs(text: string) {
  const len = text.trim().length;
  if (len < 80) return 700;
  if (len < 220) return 1_000;
  if (len < 600) return 1_400;
  return 1_900;
}

export function shouldStageWhatsAppReply(text: string, minLength = 140) {
  return text.replace(/\s+/g, " ").trim().length >= minLength;
}
