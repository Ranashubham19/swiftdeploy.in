export type OutboundReviewDecision =
  | { kind: "none" }
  | { kind: "approve" }
  | { kind: "cancel" }
  | { kind: "rewrite"; feedback: string | null };

function normalizeReviewText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function looksLikeFreshActionCommand(text: string) {
  const normalized = normalizeReviewText(text).toLowerCase();
  if (!normalized) {
    return false;
  }

  // Treat concrete "send ... to <person>" style instructions as new actions,
  // not as approval confirmations for previously queued drafts.
  if (
    /^(?:send|message|tell)\b/.test(normalized)
    && (
      /\bto\b/.test(normalized)
      || /[:'"]/u.test(text)
      || /\+\d{6,}/.test(normalized)
    )
  ) {
    return true;
  }

  if (
    /^(?:create|save)\b/.test(normalized)
    && /\b(?:reminder|task|contact|draft|message|email)\b/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function looksLikeApprove(text: string) {
  return [
    /^(?:yes|yep|yeah|haan|han|ok|okay|sure|fine|alright)(?:\s*,)?\s+(?:send|create|save|approve|confirm|go ahead|proceed)(?:\s+(?:it|this|that|them|now|please))*\s*[.!?]*$/i,
    /^(?:send|send it|send this|send now)(?:\s+please)?\s*[.!?]*$/i,
    /^(?:please\s+)?send(?:\s+(?:it|this|that|them|now))?(?:\s+please)?\s*[.!?]*$/i,
    /^(?:create|create it|save|save it)(?:\s+(?:this|that))?(?:\s+draft)?(?:\s+please)?\s*[.!?]*$/i,
    /^(?:approve|approved|confirm|confirmed|go ahead|proceed|ship it)(?:\s+please)?\s*[.!?]*$/i,
    /^(?:go ahead|proceed)(?:,?\s+and)?\s+(?:send|create|save|approve|confirm)(?:\s+(?:it|this|that|them|now|please))*\s*[.!?]*$/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeCancel(text: string) {
  return [
    /^(?:no|nah)\b/i,
    /^(?:cancel|skip|stop|abort)\b/i,
    /^(?:don't|do not)\s+(?:send|create|save|do)\b/i,
    /^(?:not now|leave it|drop it)\b/i,
  ].some((pattern) => pattern.test(text));
}

function stripRewritePoliteness(text: string) {
  return text
    .replace(/^(?:please|kindly)\s+/i, "")
    .replace(/^(?:can|could|would)\s+you\s+/i, "")
    .trim();
}

function extractRewriteFeedback(text: string) {
  const normalized = stripRewritePoliteness(text);
  const rewritePatterns: RegExp[] = [
    /^(?:rewrite|redraft|rephrase|revise)(?:\s+it|\s+this|\s+that)?(?:\s+(?:to|as|with))?[\s:,-]*(.*)$/i,
    /^(?:draft another|make another version)(?:\s+of\s+it)?[\s:,-]*(.*)$/i,
    /^(?:improve|polish|refine)(?:\s+it|\s+this|\s+that)?[\s:,-]*(.*)$/i,
    /^(?:make|turn)\s+(?:it|this|that)\s+(.+)$/i,
    /^((?:more|less)\s+.+)$/i,
    /^((?:shorter|longer|clearer|friendlier|warmer|stronger|softer|simpler|formal|more formal|professional|more professional|polite|more polite|concise|more concise|detailed|more detailed).*)$/i,
  ];

  for (const pattern of rewritePatterns) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    const feedback = match[1]?.trim() || null;
    return feedback;
  }

  if (
    /^(?:change|update|fix|edit|make)\s+(?:the\s+)?subject(?:\s+line)?\b/i.test(normalized)
    || /^(?:add|include|mention)\s+that\b/i.test(normalized)
    || /^(?:remove|delete|drop|cut|trim)\s+(?:it|this|that|the\s+(?:apology|closing|opening|greeting|sign-?off|first line|last line|intro|subject|subject line))\b/i.test(normalized)
    || /^(?:shorten|lengthen|expand|clarify|simplify|tighten|soften|tone down|polish|refine|improve)\s+(?:it|this|that|the\s+(?:draft|reply|message|email|body|subject|subject line))\b/i.test(normalized)
    || /^keep\s+.+\b(?:and|but)\b.+\b(?:add|include|mention|remove|delete|drop|cut|trim|shorten|lengthen|expand|clarify|simplify|tighten|soften|tone down|polish|refine|improve|change|update|fix|edit|make|shorter|longer|clearer|friendlier|warmer|stronger|softer|simpler|formal|more formal|professional|more professional|polite|more polite|concise|more concise|detailed|more detailed)\b/i.test(normalized)
  ) {
    return normalized;
  }

  return null;
}

export function parseOutboundReviewDecision(text: string): OutboundReviewDecision {
  const normalized = normalizeReviewText(text);
  if (!normalized) {
    return { kind: "none" };
  }

  if (looksLikeFreshActionCommand(normalized)) {
    return { kind: "none" };
  }

  const rewriteFeedback = extractRewriteFeedback(normalized);
  if (
    rewriteFeedback !== null
    || /\b(?:rewrite|redraft|rephrase|revise|improve|polish|refine|draft another)\b/i.test(normalized)
  ) {
    return {
      kind: "rewrite",
      feedback: rewriteFeedback,
    };
  }

  if (looksLikeApprove(normalized)) {
    return { kind: "approve" };
  }

  if (looksLikeCancel(normalized)) {
    return { kind: "cancel" };
  }

  return { kind: "none" };
}

export function parseOutboundReviewDecisionForTest(text: string) {
  return parseOutboundReviewDecision(text);
}
