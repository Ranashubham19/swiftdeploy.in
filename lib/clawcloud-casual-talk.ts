import type { IntentType } from "@/lib/clawcloud-ai";

export type CasualConversationTurn = {
  role: "user" | "assistant" | string;
  content: string;
};

export type ClawCloudCasualTalkProfile = {
  primaryTone: "casual" | "professional" | "direct" | "warm" | "playful" | "balanced";
  formality: "casual" | "neutral" | "formal";
  preferredReplyLength: "short" | "balanced" | "detailed";
  emojiStyle: "none" | "light";
  summary: string;
  continuityHint: string | null;
};

export type ClawCloudEmotionalContext = {
  currentEmotion:
    | "neutral"
    | "happy"
    | "excited"
    | "grateful"
    | "sad"
    | "stressed"
    | "frustrated"
    | "angry"
    | "anxious";
  intensity: "low" | "medium" | "high";
  supportStyle: "steady" | "celebratory" | "encouraging" | "calming";
  summary: string;
  responseGuidance: string;
};

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}]/u;
const SLANG_RE =
  /\b(bro|sis|ya|nah|yup|nope|gonna|wanna|kinda|sorta|lol|lmao|haha|hehe|btw|pls|plz|thx|tho|coz|cuz|okie)\b/i;
const PROFESSIONAL_RE =
  /\b(please|kindly|would you|could you|can you please|thank you|appreciate|regards|assist|clarify)\b/i;
const WARM_RE = /\b(thanks|thank you|appreciate|please|glad|love|nice|great|awesome)\b/i;
const PLAYFUL_RE = /\b(lol|lmao|haha|hehe|funny|roast|joke|banter)\b/i;
const DIRECT_RE =
  /^(tell|show|give|send|write|make|do|fix|help|explain|answer|solve|compare|summarize|check)\b/i;
const FOLLOW_UP_RE =
  /^(and|also|what about|how about|same for|again|that one|this one|the other one|not that|which one|what is this|what is that)\b/i;
const DEICTIC_RE = /\b(it|this|that|those|these|they|he|she|him|her|there|here|one)\b/i;
const HARD_TASK_RE =
  /\b(remind|schedule|send|message|whatsapp|gmail|calendar|email|draft|drive|stock|price|weather|train|tax|calculate|code|program|translate|write|article|news|research|compare|analysis)\b/i;
const HAPPY_RE = /\b(happy|glad|great|awesome|amazing|nice|good news|finally worked|finally done|so good)\b/i;
const EXCITED_RE = /\b(excited|let'?s go|lets go|can'?t wait|super excited|so ready|woohoo|yay|omg)\b/i;
const GRATEFUL_RE = /\b(thanks|thank you|appreciate|grateful|means a lot)\b/i;
const SAD_RE = /\b(sad|down|hurt|cry|crying|heartbroken|lonely|miss them|bad day|feeling low|miserable)\b/i;
const STRESSED_RE = /\b(stressed|overwhelmed|burned out|burnt out|too much|under pressure|exhausted|drained|tired of this)\b/i;
const FRUSTRATED_RE = /\b(frustrated|annoyed|irritated|fed up|stuck|not working|failed again|this sucks|so annoying)\b/i;
const ANGRY_RE = /\b(angry|mad|furious|pissed|hate this|hate it|outraged)\b/i;
const ANXIOUS_RE = /\b(anxious|anxiety|nervous|worried|scared|afraid|panic|panicking|uneasy)\b/i;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, limit = 140) {
  const clean = normalizeWhitespace(value);
  if (clean.length <= limit) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function collectRecentUserMessages(
  currentMessage: string,
  recentTurns: CasualConversationTurn[],
) {
  return [
    ...recentTurns
      .filter((turn) => turn.role === "user")
      .map((turn) => normalizeWhitespace(turn.content))
      .filter(Boolean)
      .slice(-6),
    normalizeWhitespace(currentMessage),
  ].filter(Boolean);
}

function averageWordCount(messages: string[]) {
  if (!messages.length) {
    return 0;
  }

  const total = messages.reduce((sum, message) => sum + message.split(/\s+/).filter(Boolean).length, 0);
  return total / messages.length;
}

function scoreMessages(messages: string[], re: RegExp) {
  return messages.reduce((score, message) => score + (re.test(message) ? 1 : 0), 0);
}

function inferPrimaryTone(messages: string[]) {
  const casualScore =
    scoreMessages(messages, SLANG_RE)
    + messages.reduce((score, message) => score + (message === message.toLowerCase() ? 1 : 0), 0);
  const professionalScore = scoreMessages(messages, PROFESSIONAL_RE);
  const warmScore = scoreMessages(messages, WARM_RE);
  const playfulScore =
    scoreMessages(messages, PLAYFUL_RE)
    + messages.reduce((score, message) => score + (EMOJI_RE.test(message) ? 1 : 0), 0);
  const directScore =
    scoreMessages(messages, DIRECT_RE)
    + messages.reduce((score, message) => score + (message.split(/\s+/).filter(Boolean).length <= 5 ? 1 : 0), 0);

  const ranked = [
    { tone: "professional" as const, score: professionalScore },
    { tone: "playful" as const, score: playfulScore },
    { tone: "warm" as const, score: warmScore },
    { tone: "direct" as const, score: directScore },
    { tone: "casual" as const, score: casualScore },
  ].sort((left, right) => right.score - left.score);

  if ((ranked[0]?.score ?? 0) <= 0) {
    return "balanced" as const;
  }

  if ((ranked[0]?.score ?? 0) === (ranked[1]?.score ?? -1) && ranked[0]?.score <= 1) {
    return "balanced" as const;
  }

  return ranked[0]?.tone ?? "balanced";
}

function inferEmotionIntensity(score: number) {
  if (score >= 4) {
    return "high" as const;
  }
  if (score >= 2) {
    return "medium" as const;
  }
  return "low" as const;
}

function buildEmotionSummary(
  emotion: ClawCloudEmotionalContext["currentEmotion"],
  intensity: ClawCloudEmotionalContext["intensity"],
  supportStyle: ClawCloudEmotionalContext["supportStyle"],
) {
  const emotionLabel =
    emotion === "neutral"
      ? "steady or neutral"
      : emotion === "happy"
        ? "positive and happy"
        : emotion === "excited"
          ? "energized and excited"
          : emotion === "grateful"
            ? "warm and appreciative"
            : emotion === "sad"
              ? "sad or emotionally low"
              : emotion === "stressed"
                ? "stressed or overloaded"
                : emotion === "frustrated"
                  ? "frustrated"
                  : emotion === "angry"
                    ? "angry"
                    : "anxious or worried";

  const intensityLabel =
    intensity === "high" ? "strongly" : intensity === "medium" ? "noticeably" : "lightly";

  const supportLabel =
    supportStyle === "celebratory"
      ? "respond with warm energy"
      : supportStyle === "encouraging"
        ? "respond with calm encouragement"
        : supportStyle === "calming"
          ? "respond with a steady calming tone"
          : "respond with a grounded human tone";

  return `${intensityLabel} ${emotionLabel}; ${supportLabel}`;
}

export function inferClawCloudEmotionalContext(
  currentMessage: string,
  recentTurns: CasualConversationTurn[] = [],
): ClawCloudEmotionalContext {
  const messages = collectRecentUserMessages(currentMessage, recentTurns);
  const current = normalizeWhitespace(currentMessage);
  const scoreWithCurrentWeight = (re: RegExp) =>
    scoreMessages(messages, re) + (re.test(current) ? 2 : 0);

  const positiveScores = [
    { emotion: "excited" as const, score: scoreWithCurrentWeight(EXCITED_RE) + (/!{2,}/.test(current) ? 1 : 0) },
    { emotion: "happy" as const, score: scoreWithCurrentWeight(HAPPY_RE) },
    { emotion: "grateful" as const, score: scoreWithCurrentWeight(GRATEFUL_RE) },
  ];
  const negativeScores = [
    { emotion: "sad" as const, score: scoreWithCurrentWeight(SAD_RE) },
    { emotion: "stressed" as const, score: scoreWithCurrentWeight(STRESSED_RE) },
    { emotion: "frustrated" as const, score: scoreWithCurrentWeight(FRUSTRATED_RE) },
    { emotion: "angry" as const, score: scoreWithCurrentWeight(ANGRY_RE) },
    { emotion: "anxious" as const, score: scoreWithCurrentWeight(ANXIOUS_RE) },
  ];

  const strongestNegative = [...negativeScores].sort((left, right) => right.score - left.score)[0];
  const strongestPositive = [...positiveScores].sort((left, right) => right.score - left.score)[0];

  if ((strongestNegative?.score ?? 0) > 0 && (strongestNegative?.score ?? 0) >= (strongestPositive?.score ?? 0)) {
    const emotion = strongestNegative?.emotion ?? "neutral";
    const intensity = inferEmotionIntensity(strongestNegative?.score ?? 0);
    const supportStyle =
      emotion === "angry" || emotion === "anxious"
        ? "calming"
        : "encouraging";
    const responseGuidance =
      "Acknowledge the user's emotional state briefly, then respond in a calmer, steadier, more encouraging tone. Do not amplify sadness, panic, anger, or hopelessness.";

    return {
      currentEmotion: emotion,
      intensity,
      supportStyle,
      summary: buildEmotionSummary(emotion, intensity, supportStyle),
      responseGuidance,
    };
  }

  if ((strongestPositive?.score ?? 0) > 0) {
    const emotion = strongestPositive?.emotion ?? "neutral";
    const intensity = inferEmotionIntensity(strongestPositive?.score ?? 0);
    const supportStyle = "celebratory";
    const responseGuidance =
      "Match the positive energy naturally while staying clear and helpful. Sound warm, lively, and human without becoming childish or overhyped.";

    return {
      currentEmotion: emotion,
      intensity,
      supportStyle,
      summary: buildEmotionSummary(emotion, intensity, supportStyle),
      responseGuidance,
    };
  }

  return {
    currentEmotion: "neutral",
    intensity: "low",
    supportStyle: "steady",
    summary: buildEmotionSummary("neutral", "low", "steady"),
    responseGuidance:
      "Stay natural, grounded, and human. Be emotionally aware, but do not inject artificial drama or forced cheerfulness.",
  };
}

function buildContinuityHint(recentTurns: CasualConversationTurn[]) {
  const recentUserTurns = recentTurns
    .filter((turn) => turn.role === "user")
    .map((turn) => clip(turn.content, 120))
    .filter(Boolean);

  if (!recentUserTurns.length) {
    return null;
  }

  const latest = recentUserTurns[recentUserTurns.length - 1] ?? "";
  if (!latest) {
    return null;
  }

  if (recentUserTurns.length === 1) {
    return latest;
  }

  const previous = recentUserTurns[recentUserTurns.length - 2] ?? "";
  if (!previous) {
    return latest;
  }

  return `${previous} -> ${latest}`;
}

export function inferClawCloudCasualTalkProfile(
  currentMessage: string,
  recentTurns: CasualConversationTurn[] = [],
): ClawCloudCasualTalkProfile {
  const messages = collectRecentUserMessages(currentMessage, recentTurns);
  const averageWords = averageWordCount(messages);
  const primaryTone = inferPrimaryTone(messages);
  const formality =
    primaryTone === "professional" ? "formal" : primaryTone === "casual" || primaryTone === "playful" ? "casual" : "neutral";
  const preferredReplyLength =
    averageWords <= 7 ? "short" : averageWords >= 18 ? "detailed" : "balanced";
  const emojiStyle = messages.some((message) => EMOJI_RE.test(message) || /!{2,}/.test(message)) ? "light" : "none";
  const continuityHint = buildContinuityHint(recentTurns);

  const summaryParts = [
    primaryTone === "balanced" ? "balanced, human" : `${primaryTone}, human`,
    formality === "formal" ? "more formal" : formality === "casual" ? "more casual" : "neutral formality",
    preferredReplyLength === "short" ? "prefers concise replies" : preferredReplyLength === "detailed" ? "comfortable with fuller replies" : "prefers medium-length replies",
    emojiStyle === "light" ? "lightly expressive" : "plain punctuation",
  ];

  return {
    primaryTone,
    formality,
    preferredReplyLength,
    emojiStyle,
    summary: summaryParts.join(", "),
    continuityHint,
  };
}

export function buildClawCloudCasualTalkInstruction(input: {
  message: string;
  intent: IntentType;
  recentTurns?: CasualConversationTurn[];
  resolvedQuestion?: string | null;
  activeTopics?: string[];
  topicSummary?: string | null;
}) {
  const profile = inferClawCloudCasualTalkProfile(input.message, input.recentTurns ?? []);
  const emotion = inferClawCloudEmotionalContext(input.message, input.recentTurns ?? []);
  const lines = [
    "CASUAL CONVERSATION ADAPTATION:",
    "Classify the user's message as a NEW question, a FOLLOW-UP, or a CLARIFICATION before answering.",
    "Match the user's writing rhythm, formality, and energy naturally without sounding scripted.",
    "Continue the thread like a thoughtful human teammate, not a feature list or an AI brochure.",
    "Read the user's emotional state from the current and recent messages before answering.",
    "Use recent conversation context before assuming the user started a brand-new topic.",
    "Resolve words like it, this, that, why, when, and how against the latest logical subject from recent turns.",
    "Stay on the same topic unless the user clearly changes it.",
    "If the user's wording is vague, infer from recent context first. Only ask one brief clarification question if the context is still genuinely unclear.",
    "If more than one earlier topic still fits, ask that one brief clarification instead of guessing.",
    "When you ask for clarification, sound natural and professional, not robotic or legalistic.",
    "Do not mention being an AI assistant unless the user asks about it directly.",
    `Observed user style: ${profile.summary}.`,
    `Observed emotional context: ${emotion.summary}.`,
    emotion.responseGuidance,
  ];

  if (profile.continuityHint) {
    lines.push(`Recent conversation anchor: ${profile.continuityHint}.`);
  }

  if (input.activeTopics?.length) {
    lines.push(`Recent active topics: ${input.activeTopics.slice(0, 4).join(", ")}.`);
  }

  const resolvedQuestion = normalizeWhitespace(input.resolvedQuestion ?? "");
  const currentMessage = normalizeWhitespace(input.message);
  if (resolvedQuestion && resolvedQuestion.toLowerCase() !== currentMessage.toLowerCase()) {
    lines.push(`Resolved follow-up context: ${clip(resolvedQuestion, 180)}.`);
  }

  if (input.topicSummary) {
    lines.push(`Earlier context summary: ${clip(input.topicSummary, 180)}.`);
  }

  if (input.intent === "greeting" || input.intent === "general" || input.intent === "help" || input.intent === "explain") {
    lines.push("For low-stakes chat, prefer natural prose over rigid sections unless structure clearly helps.");
  }

  return lines.join("\n");
}

export function shouldAskClawCloudCasualClarification(input: {
  message: string;
  intent: IntentType;
  recentTurns?: CasualConversationTurn[];
  resolvedQuestion?: string | null;
}) {
  const message = normalizeWhitespace(input.message);
  if (!message) {
    return false;
  }

  if (input.intent === "greeting" && message.split(/\s+/).filter(Boolean).length <= 5) {
    return false;
  }

  if (/^(thanks|thank you|ok|okay|cool|nice|great|got it|done)\b/i.test(message)) {
    return false;
  }

  if (HARD_TASK_RE.test(message)) {
    return false;
  }

  const resolvedQuestion = normalizeWhitespace(input.resolvedQuestion ?? "");
  if (resolvedQuestion && resolvedQuestion.toLowerCase() !== message.toLowerCase() && resolvedQuestion.length > message.length + 12) {
    return false;
  }

  const wordCount = message.split(/\s+/).filter(Boolean).length;
  const hasHistory = Boolean(input.recentTurns?.some((turn) => normalizeWhitespace(turn.content)));
  const deictic = DEICTIC_RE.test(message);
  const followUpOnly = FOLLOW_UP_RE.test(message);

  if (!hasHistory) {
    return wordCount <= 3 || (deictic && wordCount <= 8);
  }

  return followUpOnly || (deictic && wordCount <= 6);
}

export function buildClawCloudCasualClarificationReply(input: {
  message: string;
  recentTurns?: CasualConversationTurn[];
  activeTopics?: string[];
}) {
  const profile = inferClawCloudCasualTalkProfile(input.message, input.recentTurns ?? []);
  const emotion = inferClawCloudEmotionalContext(input.message, input.recentTurns ?? []);
  const opener =
    emotion.currentEmotion === "sad" || emotion.currentEmotion === "stressed" || emotion.currentEmotion === "frustrated" || emotion.currentEmotion === "anxious"
      ? "I want to help properly, so I want to make sure I'm following you correctly."
      : profile.primaryTone === "professional"
        ? "I want to make sure I answer the right thing."
        : "I want to make sure I'm following you correctly.";

  const activeTopics = input.activeTopics?.filter(Boolean) ?? [];
  if (activeTopics.length >= 2) {
    return [
      opener,
      "",
      `Are you referring to *${activeTopics[0]}* or *${activeTopics[1]}*?`,
      "If it's something else, tell me the topic once more in one line and I'll continue properly.",
    ].join("\n");
  }

  if (activeTopics.length === 1) {
    return [
      opener,
      "",
      `Are you talking about *${activeTopics[0]}*, or do you want to switch to something new?`,
      "Tell me once in one line and I'll continue from the right context.",
    ].join("\n");
  }

  return [
    opener,
    "",
    "Tell me what *this/that* refers to in one clear line, and I'll continue from there.",
  ].join("\n");
}
