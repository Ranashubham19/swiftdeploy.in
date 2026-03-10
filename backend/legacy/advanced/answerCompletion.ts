const trailingConnectorPattern =
  /\b(and|or|with|to|for|in|on|at|by|from|during|through|about|because|that|which)\s*$/i;

export const isLikelyIncompleteNaturalAnswer = (text: string): boolean => {
  const normalized = String(text || "").trim();
  if (!normalized) return true;

  const fenceCount = (normalized.match(/```/g) || []).length;
  if (fenceCount % 2 !== 0) return true;

  const lastChar = normalized.slice(-1);
  const hasTerminalPunctuation = /[.!?:)\]"'`]/u.test(lastChar);
  const trailingConnector = trailingConnectorPattern.test(normalized);
  const lastWord = normalized.split(/\s+/).pop() || "";
  const trailingCutWord = normalized.length >= 40 && /^[a-z]{1,3}$/i.test(lastWord);
  const endsWithColonListStarter = /:\s*$/.test(normalized) && normalized.split(/\n/).length <= 4;

  if (trailingConnector || endsWithColonListStarter) return true;
  if (normalized.length < 120) return false;

  return !hasTerminalPunctuation || trailingCutWord;
};

export const mergeContinuationText = (base: string, continuation: string): string => {
  const a = String(base || "").trim();
  const b = String(continuation || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (a.includes(b)) return a;

  const trimmed = b.replace(/^(continue(?:ing)?(?: from where [^.]+?)?[:\-]?\s*)/i, "").trim();
  if (!trimmed) return a;

  const lastLine = a.split(/\r?\n/).pop()?.trim() || "";
  if (lastLine && trimmed.toLowerCase().startsWith(lastLine.toLowerCase())) {
    const remainder = trimmed.slice(lastLine.length).trimStart();
    return remainder ? `${a}${a.endsWith("\n") ? "" : "\n"}${remainder}`.trim() : a;
  }

  const overlapMax = Math.min(240, Math.min(a.length, trimmed.length));
  let overlap = 0;
  for (let i = overlapMax; i >= 6; i -= 1) {
    if (a.slice(-i).toLowerCase() === trimmed.slice(0, i).toLowerCase()) {
      overlap = i;
      break;
    }
  }
  const mergedTail = overlap ? trimmed.slice(overlap).trimStart() : trimmed;
  return `${a}${a.endsWith("\n") ? "" : "\n"}${mergedTail}`.trim();
};
