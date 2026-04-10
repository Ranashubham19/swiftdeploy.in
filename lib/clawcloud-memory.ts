import {
  extractDocumentContextSnippet,
  looksLikeDocumentPrompt,
} from "@/lib/clawcloud-docs";
import {
  inferClawCloudCasualTalkProfile,
  inferClawCloudEmotionalContext,
} from "@/lib/clawcloud-casual-talk";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type MemoryTurn = {
  role: "user" | "assistant";
  content: string;
};

export type ConversationMemory = {
  recentTurns: MemoryTurn[];
  topicSummary: string;
  activeTopics: string[];
  isFollowUp: boolean;
  resolvedQuestion: string;
  recentDocumentContext: string | null;
  userToneProfile: string;
  userEmotionalContext: string;
  continuityHint: string | null;
};

type ConversationContinuityAnalysis = {
  isFollowUp: boolean;
  resolvedQuestion: string;
  anchorUserTurn: MemoryTurn | null;
  anchorAssistantTurn: MemoryTurn | null;
  score: number;
};

type ContinuityAnchorCandidate = {
  userTurn: MemoryTurn;
  assistantTurn: MemoryTurn | null;
  turnIndex: number;
  overlap: number;
  topicOverlap: number;
  score: number;
};

const RAW_RECENT_TURNS = 48;
const SUMMARY_LOOK_BACK = 120;
const MAX_CONTENT_CHARS = 1_200;
const MAX_DOCUMENT_CONTENT_CHARS = 4_800;
const CONTINUITY_TOKEN_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "get",
  "give",
  "hai",
  "ho",
  "i",
  "in",
  "is",
  "it",
  "ki",
  "ko",
  "me",
  "mein",
  "my",
  "of",
  "on",
  "or",
  "please",
  "se",
  "tell",
  "the",
  "to",
  "tum",
  "what",
  "with",
]);

const FOLLOW_UP_SIGNALS = [
  /\b(it|this|that|those|these|they|he|she|him|her|its|their|unka|unki|unke|uska|uski|uske|inko|inki|inke|isko|iske|iss|ye|yeh|woh|voh)\b/i,
  /\b(above|previous|last|earlier|before|prior|mentioned|said|told)\b/i,
  /\b(more|again|also|another|next|then|after|and|so|but|still|aur|phir|ab|ab se|same)\b/i,
  /^(yes|no|ok|okay|sure|right|correct|wrong|really|why|how|when|what|who|where)\b/i,
  /\?$/,
];

const PRONOUN_START = /^(it|this|that|those|they|he|she|unka|unki|unke|uska|uski|uske|inko|inki|inke|ye|yeh|woh|voh)\s/i;
const CONTEXTUAL_REFERENCE = /\b(it|this|that|those|these|they|he|she|him|her|its|their|unka|unki|unke|uska|uski|uske|inko|inki|inke|isko|iske|iss|ye|yeh|woh|voh)\b/i;
const DIRECT_STANDALONE_QUESTION_START =
  /^(?:what(?:'s| is| are| was| were)|who(?:'s| is| are| was| were)|when(?:'s| is| are| was| were| did)|where(?:'s| is| are| was| were)|why(?:'s| is| are| does| do| did)|how(?:'s| is| are| does| do| did)|explain|describe|define|summari[sz]e|story of|plot of|summary of|tell me about|compare|difference between)\b/i;
const FRESH_ACTION_REQUEST_START =
  /^(?:send|reply|read|show|draft|write|translate|open|search|find|check|from now(?: on(?:ward)?)?|start|stop)\b/i;
const CONTINUATION_OPENER =
  /^(?:and|also|so|then|but|or|aur|ab|ab se|phir|same|continue|go on|tell me more|what about|how about|which one|that one|this one|those|them|it)\b/i;
const SELECTION_FOLLOW_UP_START =
  /^(?:(?:go\s+(?:with|for)|choose|pick|take)\s+.+|use\s+(?:it|that|this|same|the\s+(?:first|second|third|fourth|1st|2nd|3rd|4th)\s+one)\b.*|reply\s+with\s+.+|option\s*\d+\b.*|(?:the\s+)?(?:first|second|third|fourth|1st|2nd|3rd|4th)\s+one(?:\s+.+)?|(?:this|that|same)\s+one(?:\s+.+)?|confirm(?:ed)?|yes\s+(?:this|that|same|it|one)|correct|right)$/i;
const LANGUAGE_OR_STYLE_ONLY_FOLLOW_UP =
  /^(?:(?:in|into)\s+(?:english|hindi|hinglish|urdu|punjabi|thai|chinese|japanese|korean|tamil|telugu|bengali|marathi|french|spanish|arabic|german|italian|russian)|(?:make|keep|write|say|reply|send|translate|explain)\s+(?:it\s+)?(?:in|into)\s+(?:english|hindi|hinglish|urdu|punjabi|thai|chinese|japanese|korean|tamil|telugu|bengali|marathi|french|spanish|arabic|german|italian|russian)|(?:short(?:er)?|brief(?:ly)?|simple(?:r)?|professional(?:ly)?|formal(?:ly)?|polite(?:ly)?|more detailed|detailed))\b/i;
const VOLATILE_FRESH_QUERY_START =
  /^(?:latest|current|today|right now|currently|weather|temperature|forecast|price|pricing|stock|news|headline|score|schedule|who is the current|what is the current|what is the latest|show whatsapp history|read and tell me the message of|tell me the message of)\b/i;
const HARD_TECHNICAL_FRESH_QUERY_SIGNAL =
  /\b(?:algorithm|approach|time complexity|space complexity|provide code|write code|constraints?|distributed system|system design|fault tolerance|federated learning|causal inference|queueing|black-?scholes|kaplan[- ]meier|o\([^)]+\)|10\^?\d+)\b/i;
const DOCUMENT_FOLLOW_UP_SIGNAL =
  /\b(document|file|pdf|sheet|page|row|table|section|clause|invoice|statement|receipt|contract|resume|cv)\b/i;
const DOCUMENT_DECISION_SIGNAL =
  /\b(which|compare|better|best|cheapest|lowest|highest|difference|summary|summarize|explain|mention|show)\b/i;
const LOW_SIGNAL_ACK_RE =
  /^(?:ok(?:ay)?|kk|k|hmm+|hm+|yes|no|sure|fine|thanks?|thank you|thx|done|haan|han|hmm|ji|acha|achha|theek(?: hai)?|thik(?: hai)?|right|correct|got it|understood)\b[!.? ]*$/i;
const LOW_SIGNAL_ASSISTANT_OPERATION_RE =
  /\b(?:message (?:delivered|submitted|sent|re-?sent) to|reply (?:delivered|submitted|sent|re-?sent) to|delivery confirmation|active contact mode|reply with the exact contact name|whatsapp conversation summary|messages reviewed for this summary|latest visible message|couldn't find synced whatsapp messages|train status update|official fallbacks)\b/i;

const TOPIC_EXTRACTORS: Array<{ re: RegExp; topic: string }> = [
  { re: /\b(bitcoin|btc|ethereum|eth|crypto|blockchain|nft|defi|web3)\b/i, topic: "cryptocurrency" },
  { re: /\b(stock|market|nifty|sensex|nasdaq|dow|sp500|share|invest|portfolio)\b/i, topic: "finance/stocks" },
  { re: /\b(ai|artificial intelligence|machine learning|llm|gpt|chatgpt|claude|gemini)\b/i, topic: "ai" },
  { re: /\b(code|coding|programming|python|javascript|react|node|typescript|bug|error|api)\b/i, topic: "coding" },
  { re: /\b(richest|billionaire|elon|bezos|zuckerberg|wealth|net worth|forbes)\b/i, topic: "billionaires/wealth" },
  { re: /\b(ipl|cricket|football|sports|match|score|team|player)\b/i, topic: "sports" },
  { re: /\b(health|medicine|doctor|diet|fitness|gym|workout|disease|symptom)\b/i, topic: "health" },
  { re: /\b(recipe|food|cook|ingredient|dish|restaurant|cuisine)\b/i, topic: "food" },
  { re: /\b(travel|trip|tour|hotel|flight|visa|country|city|destination)\b/i, topic: "travel" },
  { re: /\b(exam|study|university|college|school|degree|education|course)\b/i, topic: "education" },
  { re: /\b(job|career|resume|cv|interview|salary|work|company|startup)\b/i, topic: "career" },
  { re: /\b(news|politics|government|minister|election|policy|law|court)\b/i, topic: "news/politics" },
  { re: /\b(phone|mobile|iphone|android|gadget|laptop|computer|device|app)\b/i, topic: "technology/gadgets" },
];

function extractTopics(text: string): string[] {
  return TOPIC_EXTRACTORS
    .filter(({ re }) => re.test(text))
    .map(({ topic }) => topic)
    .slice(0, 5);
}

function computeTopicOverlap(left: string[], right: string[]) {
  if (!left.length || !right.length) {
    return 0;
  }

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;

  for (const topic of leftSet) {
    if (rightSet.has(topic)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(1, Math.min(leftSet.size, rightSet.size));
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function looksLikeStandaloneQuestion(msg: string, wordCount: number) {
  if (!msg) {
    return false;
  }

  if (VOLATILE_FRESH_QUERY_START.test(msg)) {
    return true;
  }

  if (HARD_TECHNICAL_FRESH_QUERY_SIGNAL.test(msg) && wordCount >= 6 && !PRONOUN_START.test(msg)) {
    return true;
  }

  if (DIRECT_STANDALONE_QUESTION_START.test(msg)) {
    return true;
  }

  return /[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/u.test(msg) && wordCount >= 4 && !PRONOUN_START.test(msg);
}

function looksLikeFreshActionRequest(msg: string) {
  if (!msg) {
    return false;
  }

  if (!FRESH_ACTION_REQUEST_START.test(msg)) {
    return false;
  }

  if (CONTEXTUAL_REFERENCE.test(msg) || LANGUAGE_OR_STYLE_ONLY_FOLLOW_UP.test(msg)) {
    return false;
  }

  return true;
}

function toContinuityTokens(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !CONTINUITY_TOKEN_STOP_WORDS.has(token));
}

function tokenOverlapScore(left: string, right: string) {
  const leftTokens = new Set(toContinuityTokens(left));
  const rightTokens = new Set(toContinuityTokens(right));
  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
}

function isLowSignalTurn(turn: MemoryTurn) {
  const trimmed = normalizeWhitespace(turn.content);
  if (!trimmed) {
    return true;
  }

  if (LOW_SIGNAL_ACK_RE.test(trimmed) && trimmed.split(/\s+/).filter(Boolean).length <= 4) {
    return true;
  }

  return turn.role === "assistant" && LOW_SIGNAL_ASSISTANT_OPERATION_RE.test(trimmed);
}

function findLatestSubstantiveTurn(
  recentTurns: MemoryTurn[],
  role: MemoryTurn["role"],
) {
  for (let index = recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = recentTurns[index];
    if (!turn || turn.role !== role || isLowSignalTurn(turn)) {
      continue;
    }
    return turn;
  }

  return null;
}

function findNearestSubstantiveAssistantAfter(
  recentTurns: MemoryTurn[],
  userTurnIndex: number,
) {
  for (let index = userTurnIndex + 1; index < recentTurns.length; index += 1) {
    const turn = recentTurns[index];
    if (!turn || turn.role === "user") {
      break;
    }
    if (!isLowSignalTurn(turn)) {
      return turn;
    }
  }

  return null;
}

function buildContinuityAnchorCandidates(
  currentMessage: string,
  recentTurns: MemoryTurn[],
  activeTopics: string[],
) {
  const currentTopics = extractTopics(currentMessage);
  const hasContextCue = PRONOUN_START.test(currentMessage) || CONTEXTUAL_REFERENCE.test(currentMessage);
  const hasContinuationCue = CONTINUATION_OPENER.test(currentMessage);
  const hasSelectionCue = SELECTION_FOLLOW_UP_START.test(currentMessage);
  const styleOnly = LANGUAGE_OR_STYLE_ONLY_FOLLOW_UP.test(currentMessage);
  const documentFollowUp = looksLikeDocumentFollowUp(currentMessage);
  const standaloneQuestion = looksLikeStandaloneQuestion(
    currentMessage,
    currentMessage.split(/\s+/).filter(Boolean).length,
  );
  const freshAction = looksLikeFreshActionRequest(currentMessage);

  const candidates: ContinuityAnchorCandidate[] = [];

  for (let index = recentTurns.length - 1; index >= 0; index -= 1) {
    const userTurn = recentTurns[index];
    if (!userTurn || userTurn.role !== "user" || isLowSignalTurn(userTurn)) {
      continue;
    }

    const assistantTurn = findNearestSubstantiveAssistantAfter(recentTurns, index);
    const combinedContext = `${userTurn.content} ${assistantTurn?.content ?? ""}`.trim();
    const overlap = Math.max(
      tokenOverlapScore(currentMessage, userTurn.content),
      assistantTurn ? tokenOverlapScore(currentMessage, assistantTurn.content) : 0,
      tokenOverlapScore(currentMessage, combinedContext),
    );
    const candidateTopics = extractTopics(combinedContext);
    const topicOverlap = Math.max(
      computeTopicOverlap(currentTopics, candidateTopics),
      !currentTopics.length && (hasContextCue || hasContinuationCue || hasSelectionCue || styleOnly)
        ? computeTopicOverlap(activeTopics, candidateTopics)
        : 0,
    );
    const distanceFromEnd = Math.max(0, recentTurns.length - index - 1);

    let score = 0;
    if (index === recentTurns.length - 1) score += 2;
    else if (distanceFromEnd <= 2) score += 1.5;
    else if (distanceFromEnd <= 5) score += 1;

    if (overlap >= 0.45) score += 4;
    else if (overlap >= 0.25) score += 2;
    else if (overlap > 0) score += 1;

    if (topicOverlap >= 0.6) score += 3;
    else if (topicOverlap > 0) score += 1.5;

    if (hasContextCue) score += index === recentTurns.length - 1 ? 2 : 1;
    if (hasContinuationCue) score += index === recentTurns.length - 1 ? 1.5 : 0.75;
    if (hasSelectionCue) score += index === recentTurns.length - 1 ? 3 : 1.5;
    if (styleOnly) score += index === recentTurns.length - 1 ? 3 : 1;
    if (documentFollowUp && looksLikeDocumentPrompt(combinedContext)) score += 3;
    if (assistantTurn && !isLowSignalTurn(assistantTurn)) score += 0.25;

    if (freshAction && overlap === 0 && topicOverlap === 0 && !hasContextCue && !hasContinuationCue && !hasSelectionCue) {
      score -= 3;
    }

    if (standaloneQuestion && overlap === 0 && topicOverlap === 0 && !hasContextCue && !hasSelectionCue && !styleOnly) {
      score -= 4;
    }

    candidates.push({
      userTurn,
      assistantTurn,
      turnIndex: index,
      overlap,
      topicOverlap,
      score,
    });
  }

  return candidates.sort((left, right) => right.score - left.score || right.turnIndex - left.turnIndex);
}

function looksLikeStandaloneTopicShift(
  currentMessage: string,
  anchorUserTurn: MemoryTurn | null,
  anchorAssistantTurn: MemoryTurn | null,
) {
  const msg = currentMessage.trim();
  if (!msg) {
    return false;
  }

  if (PRONOUN_START.test(msg) || CONTEXTUAL_REFERENCE.test(msg) || CONTINUATION_OPENER.test(msg) || SELECTION_FOLLOW_UP_START.test(msg)) {
    return false;
  }

  if (VOLATILE_FRESH_QUERY_START.test(msg) || HARD_TECHNICAL_FRESH_QUERY_SIGNAL.test(msg)) {
    return true;
  }

  const wordCount = msg.split(/\s+/).filter(Boolean).length;
  const standaloneQuestion = looksLikeStandaloneQuestion(msg, wordCount);
  const freshAction = looksLikeFreshActionRequest(msg);
  if (!standaloneQuestion && !freshAction && wordCount < 7) {
    return false;
  }

  const currentTopics = extractTopics(msg);
  const anchorTopics = extractTopics(
    `${anchorUserTurn?.content ?? ""} ${anchorAssistantTurn?.content ?? ""}`.trim(),
  );
  if (!currentTopics.length || !anchorTopics.length) {
    return false;
  }

  return computeTopicOverlap(currentTopics, anchorTopics) === 0;
}

function isFollowUpQuestion(currentMessage: string, recentTurns: MemoryTurn[]): boolean {
  if (!recentTurns.length) return false;

  const msg = currentMessage.trim();
  const words = msg.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const anchorUserTurn = findLatestSubstantiveTurn(recentTurns, "user");
  const anchorAssistantTurn = findLatestSubstantiveTurn(recentTurns, "assistant");

  if (!msg) return false;
  if (PRONOUN_START.test(msg)) return true;
  if (LANGUAGE_OR_STYLE_ONLY_FOLLOW_UP.test(msg)) return Boolean(anchorUserTurn || anchorAssistantTurn);
  if (SELECTION_FOLLOW_UP_START.test(msg)) return Boolean(anchorUserTurn || anchorAssistantTurn);
  if (CONTINUATION_OPENER.test(msg) && !looksLikeStandaloneQuestion(msg, wordCount)) return true;
  if (looksLikeFreshActionRequest(msg) && !CONTEXTUAL_REFERENCE.test(msg)) return false;
  if (looksLikeStandaloneQuestion(msg, wordCount)) return false;
  if (wordCount <= 3) return true;

  const anchorText = `${anchorUserTurn?.content ?? ""} ${anchorAssistantTurn?.content ?? ""}`.trim();
  const overlap = anchorText ? tokenOverlapScore(msg, anchorText) : 0;
  if (overlap >= 0.34) {
    return true;
  }

  const hits = FOLLOW_UP_SIGNALS.reduce((count, re) => count + (re.test(msg) ? 1 : 0), 0);
  return hits >= 2;
}

function analyzeConversationContinuity(
  currentMessage: string,
  recentTurns: MemoryTurn[],
  activeTopics: string[],
): ConversationContinuityAnalysis {
  const msg = currentMessage.trim();
  const anchorCandidates = buildContinuityAnchorCandidates(msg, recentTurns, activeTopics);
  const bestAnchor = anchorCandidates[0] ?? null;
  const latestUserTurn = findLatestSubstantiveTurn(recentTurns, "user");
  const latestAssistantTurn = findLatestSubstantiveTurn(recentTurns, "assistant");
  const anchorUserTurn = bestAnchor?.userTurn ?? latestUserTurn;
  const anchorAssistantTurn = bestAnchor?.assistantTurn ?? latestAssistantTurn;

  if (!recentTurns.length || !msg) {
    return {
      isFollowUp: false,
      resolvedQuestion: msg,
      anchorUserTurn,
      anchorAssistantTurn,
      score: 0,
    };
  }

  const words = msg.split(/\s+/).filter(Boolean).length;
  const lastUserContext = anchorUserTurn?.content?.slice(0, 300) ?? "";
  const lastAssistantContext = anchorAssistantTurn?.content?.slice(0, 300) ?? "";
  const overlap = Math.max(
    tokenOverlapScore(msg, lastUserContext),
    tokenOverlapScore(msg, lastAssistantContext),
  );
  const topicOverlap = computeTopicOverlap(
    extractTopics(msg),
    extractTopics(`${lastUserContext} ${lastAssistantContext}`.trim()),
  );
  const hasContextCue = PRONOUN_START.test(msg) || CONTEXTUAL_REFERENCE.test(msg);
  const hasContinuationCue = CONTINUATION_OPENER.test(msg);
  const hasSelectionCue = SELECTION_FOLLOW_UP_START.test(msg);
  const styleOnly = LANGUAGE_OR_STYLE_ONLY_FOLLOW_UP.test(msg);
  const standaloneQuestion = looksLikeStandaloneQuestion(msg, words);
  const freshAction = looksLikeFreshActionRequest(msg);
  const standaloneTopicShift = looksLikeStandaloneTopicShift(
    msg,
    anchorUserTurn,
    anchorAssistantTurn,
  );

  let score = bestAnchor?.score ?? 0;
  if (PRONOUN_START.test(msg)) score += 4;
  if (hasContextCue) score += 2;
  if (hasContinuationCue) score += 2;
  if (hasSelectionCue) score += 3;
  if (styleOnly) score += 3;
  if (looksLikeDocumentFollowUp(msg)) score += 2;
  if (words <= 3) {
    if (hasContextCue || hasContinuationCue || styleOnly || overlap > 0 || topicOverlap > 0) {
      score += 1;
    } else {
      score -= 2;
    }
  } else if (words <= 6 && !standaloneQuestion && !freshAction) score += 1;
  if (overlap >= 0.45) score += 2;
  else if (overlap >= 0.25) score += 1;
  if (topicOverlap >= 0.6) score += 2;
  else if (topicOverlap > 0) score += 1;
  if (standaloneQuestion) score -= 4;
  if (freshAction && !hasContextCue && !hasContinuationCue && !hasSelectionCue) score -= 3;
  if (standaloneTopicShift) score -= 5;
  if (words >= 8 && overlap === 0 && topicOverlap === 0 && !hasContextCue && !styleOnly) score -= 1;

  const isFollowUp =
    score >= 2
    && Boolean(anchorUserTurn || anchorAssistantTurn)
    && !(standaloneQuestion && !hasContextCue && !styleOnly)
    && !standaloneTopicShift;

  return {
    isFollowUp,
    resolvedQuestion: isFollowUp
      ? resolveFollowUp(currentMessage, recentTurns, activeTopics, anchorUserTurn, anchorAssistantTurn)
      : msg,
    anchorUserTurn,
    anchorAssistantTurn,
    score,
  };
}

function resolveFollowUp(
  currentMessage: string,
  recentTurns: MemoryTurn[],
  activeTopics: string[],
  anchorUserTurn?: MemoryTurn | null,
  anchorAssistantTurn?: MemoryTurn | null,
): string {
  const msg = currentMessage.trim();
  if (!recentTurns.length || !msg) return msg;

  const lastUserContext = anchorUserTurn?.content?.slice(0, 300)
    ?? findLatestSubstantiveTurn(recentTurns, "user")?.content?.slice(0, 300)
    ?? "";
  const lastAssistantContext = anchorAssistantTurn?.content?.slice(0, 300)
    ?? findLatestSubstantiveTurn(recentTurns, "assistant")?.content?.slice(0, 300)
    ?? "";

  if (LANGUAGE_OR_STYLE_ONLY_FOLLOW_UP.test(msg) && lastUserContext) {
    return normalizeWhitespace(`${lastUserContext} ${msg}`);
  }

  if (SELECTION_FOLLOW_UP_START.test(msg) && lastUserContext) {
    return normalizeWhitespace(`${lastUserContext}. Follow-up: ${msg}`);
  }

  if (/^(?:what about|how about|same for)\b/i.test(msg) && lastUserContext) {
    const directSubject = msg
      .replace(/^(?:what about|how about|same for)\s+/i, "")
      .replace(/[?!.]+$/g, "")
      .trim();
    if (directSubject) {
      return normalizeWhitespace(`${lastUserContext} ${directSubject}`);
    }
  }

  if (/^(?:and|also|or|aur|so|then|but|ab|ab se|phir)\b/i.test(msg) && lastUserContext) {
    const suffix = msg.replace(/^(?:and|also|or|aur|so|then|but|ab|ab se|phir)\s+/i, "").trim();
    if (suffix) {
      return normalizeWhitespace(`${lastUserContext} ${suffix}`);
    }
  }

  if (/^(?:why|when|where|who|how much|how many|which one)\b/i.test(msg) && lastUserContext) {
    return normalizeWhitespace(`${msg} regarding ${lastUserContext}`);
  }

  // For pronoun references, inject both user and assistant context
  if (PRONOUN_START.test(msg)) {
    const contextParts: string[] = [];
    if (lastUserContext) contextParts.push(`user asked: ${lastUserContext}`);
    if (lastAssistantContext) contextParts.push(`you answered: ${lastAssistantContext}`);
    const context = contextParts.join("; ");
    return context ? `${msg} (context: ${context})` : msg;
  }

  const words = msg.split(/\s+/).filter(Boolean).length;

  if (CONTEXTUAL_REFERENCE.test(msg)) {
    const contextParts: string[] = [];
    if (lastUserContext) contextParts.push(`user asked: ${lastUserContext}`);
    if (lastAssistantContext) contextParts.push(`you answered: ${lastAssistantContext}`);
    const context = contextParts.join("; ");
    return context ? `${msg} (context: ${context})` : msg;
  }

  // For short messages, inject topic and recent context
  if (words <= 8 && lastUserContext) {
    return normalizeWhitespace(`${lastUserContext}. Follow-up: ${msg}`);
  }

  if (words <= 8 && activeTopics.length > 0) {
    const topicHint = `topic: ${activeTopics.join(", ")}`;
    const contextHint = lastAssistantContext ? `; recent answer: ${lastAssistantContext.slice(0, 160)}` : "";
    return `${msg} (${topicHint}${contextHint})`;
  }

  // For medium messages that look like follow-ups, add topic hint
  if (words <= 15 && activeTopics.length > 0) {
    return `${msg} (ongoing topic: ${activeTopics.join(", ")})`;
  }

  return msg;
}

function looksLikeDocumentFollowUp(currentMessage: string): boolean {
  const trimmed = currentMessage.trim();
  if (!trimmed) {
    return false;
  }

  if (DOCUMENT_FOLLOW_UP_SIGNAL.test(trimmed) || PRONOUN_START.test(trimmed)) {
    return true;
  }

  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return trimmed.endsWith("?") && wordCount <= 16 && DOCUMENT_DECISION_SIGNAL.test(trimmed);
}

function truncateHistoryContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) {
    return "";
  }

  if (looksLikeDocumentPrompt(trimmed)) {
    return extractDocumentContextSnippet(trimmed, MAX_DOCUMENT_CONTENT_CHARS) ?? trimmed.slice(0, MAX_DOCUMENT_CONTENT_CHARS);
  }

  return trimmed.slice(0, MAX_CONTENT_CHARS);
}

function findRecentDocumentContext(recentTurns: MemoryTurn[]): string | null {
  for (let index = recentTurns.length - 1; index >= 0; index -= 1) {
    const turn = recentTurns[index];
    if (turn.role !== "user") {
      continue;
    }

    const snippet = extractDocumentContextSnippet(turn.content, MAX_DOCUMENT_CONTENT_CHARS);
    if (snippet) {
      return snippet;
    }
  }

  return null;
}

async function loadRawHistory(userId: string, limit: number): Promise<MemoryTurn[]> {
  try {
    const { data } = await getClawCloudSupabaseAdmin()
      .from("whatsapp_messages")
      .select("direction,content,sent_at")
      .eq("user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (!data?.length) return [];

    return data
      .reverse()
      .map((row) => ({
        role: (row.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
        content: truncateHistoryContent(String(row.content ?? "")),
      }))
      .filter((turn) => turn.content.length > 0);
  } catch {
    return [];
  }
}

function buildOlderSummary(olderTurns: MemoryTurn[]): string {
  if (!olderTurns.length) return "";

  const userMessages = olderTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content.slice(0, 180))
    .slice(-10);

  if (!userMessages.length) return "";

  const topicList = extractTopics(userMessages.join(" "));
  const recentPreview = userMessages.slice(-3).join("; ").slice(0, 360);
  const topicLine = topicList.length ? `Topics discussed: ${topicList.join(", ")}.` : "";

  // Also capture assistant context for better continuity
  const assistantMessages = olderTurns
    .filter((turn) => turn.role === "assistant")
    .map((turn) => turn.content.slice(0, 100))
    .slice(-3);
  const assistantPreview = assistantMessages.length
    ? `You previously answered about: ${assistantMessages.join("; ").slice(0, 240)}.`
    : "";

  return [
    `Earlier conversation: ${recentPreview}.`,
    topicLine,
    assistantPreview,
  ].filter(Boolean).join(" ");
}

export async function buildConversationMemory(
  userId: string,
  currentMessage: string,
): Promise<ConversationMemory> {
  const allTurns = await loadRawHistory(userId, SUMMARY_LOOK_BACK);
  const recentTurns = allTurns.slice(-RAW_RECENT_TURNS);
  const olderTurns = allTurns.slice(0, Math.max(0, allTurns.length - RAW_RECENT_TURNS));
  const activeTopics = extractTopics(`${recentTurns.map((turn) => turn.content).join(" ")} ${currentMessage}`);
  const topicSummary = buildOlderSummary(olderTurns);
  const continuity = analyzeConversationContinuity(currentMessage, recentTurns, activeTopics);
  const isFollowUp = continuity.isFollowUp;
  const recentDocumentContext = findRecentDocumentContext(recentTurns);
  const casualTalkProfile = inferClawCloudCasualTalkProfile(currentMessage, recentTurns);
  const emotionalContext = inferClawCloudEmotionalContext(currentMessage, recentTurns);
  const resolvedQuestionBase = continuity.resolvedQuestion || currentMessage.trim();
  const resolvedQuestion = recentDocumentContext
    && !looksLikeDocumentPrompt(currentMessage)
    && looksLikeDocumentFollowUp(currentMessage)
    ? `${recentDocumentContext}\n\nFollow-up question about this document: ${resolvedQuestionBase || currentMessage.trim()}`
    : resolvedQuestionBase;

  return {
    recentTurns,
    topicSummary,
    activeTopics,
    isFollowUp,
    recentDocumentContext,
    resolvedQuestion: resolvedQuestion || currentMessage.trim(),
    userToneProfile: casualTalkProfile.summary,
    userEmotionalContext: emotionalContext.summary,
    continuityHint: casualTalkProfile.continuityHint,
  };
}

export function buildMemorySystemSnippet(
  memory: ConversationMemory,
  userProfileSnippet?: string,
): string {
  const lines: string[] = [];

  if (memory.topicSummary) {
    lines.push(`Conversation history: ${memory.topicSummary}`);
  }
  if (memory.activeTopics.length) {
    lines.push(`Active topics: ${memory.activeTopics.join(", ")}`);
  }
  if (memory.userToneProfile) {
    lines.push(`User tone profile: ${memory.userToneProfile}`);
  }
  if (memory.userEmotionalContext) {
    lines.push(`User emotional context: ${memory.userEmotionalContext}`);
  }
  if (memory.continuityHint) {
    lines.push(`Recent conversation anchor: ${memory.continuityHint}`);
  }
  if (memory.isFollowUp) {
    lines.push("⚡ Current message is a follow-up to the prior conversation. Use full context for continuity.");
    if (looksLikeDocumentPrompt(memory.resolvedQuestion)) {
      lines.push("Resolved question includes the recent uploaded document context.");
    } else {
      lines.push(`Resolved question: ${memory.resolvedQuestion}`);
    }
    lines.push("IMPORTANT: Answer in the context of the ongoing conversation. Do not treat this as a standalone question.");
  } else if (memory.recentTurns.length) {
    lines.push("Current message appears standalone. Do not merge unrelated old context unless the user clearly refers back to prior chat.");
  }
  if (memory.recentDocumentContext && !looksLikeDocumentPrompt(memory.resolvedQuestion)) {
    lines.push("Recent document context is available from the previous uploaded file. Use it when the user refers back to the document.");
  }

  if (userProfileSnippet) {
    lines.push("");
    lines.push(userProfileSnippet);
  }

  return lines.join("\n");
}

export async function getSmartHistory(
  userId: string,
  mode: "fast" | "deep" = "fast",
): Promise<MemoryTurn[]> {
  const limit = mode === "deep" ? 50 : 30;
  return loadRawHistory(userId, limit);
}

export function analyzeConversationContinuityForTest(input: {
  currentMessage: string;
  recentTurns: MemoryTurn[];
  activeTopics?: string[];
}) {
  const analysis = analyzeConversationContinuity(
    input.currentMessage,
    input.recentTurns,
    input.activeTopics ?? extractTopics(
      `${input.recentTurns.map((turn) => turn.content).join(" ")} ${input.currentMessage}`,
    ),
  );

  return {
    isFollowUp: analysis.isFollowUp,
    resolvedQuestion: analysis.resolvedQuestion,
    anchorUserTurn: analysis.anchorUserTurn?.content ?? null,
    anchorAssistantTurn: analysis.anchorAssistantTurn?.content ?? null,
    score: analysis.score,
  };
}
