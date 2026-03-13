import type {
  ConversationMemory,
  ConversationRole,
  ResearchRequestBody,
} from "@/lib/types";

type MessageLike = {
  role: ConversationRole | string;
  content: string;
};

export type QueryRewriteResult = {
  resolvedQuestion: string;
  rewrittenQueries: string[];
  usedConversationContext: boolean;
  memory: ConversationMemory;
};

const STOP_WORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "best",
  "by",
  "can",
  "current",
  "did",
  "do",
  "does",
  "for",
  "from",
  "get",
  "give",
  "going",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "latest",
  "me",
  "more",
  "news",
  "now",
  "of",
  "on",
  "or",
  "right",
  "show",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "today",
  "up",
  "update",
  "updates",
  "was",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, limit = 180) {
  const clean = normalizeWhitespace(value);
  if (clean.length <= limit) {
    return clean;
  }

  return `${clean.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function sentenceCase(value: string) {
  const clean = normalizeWhitespace(value).replace(/[.?!]+$/, "");
  if (!clean) {
    return "";
  }

  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function looksLikeGreeting(question: string) {
  return /^(hi|hello|hey|yo|good (morning|afternoon|evening)|thanks|thank you)\b[!.? ]*$/i.test(
    normalizeWhitespace(question),
  );
}

function toSearchTokens(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_WORDS.has(token));
}

function extractEntities(value: string) {
  const matches =
    value.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z0-9.&-]+){0,3})\b/g) ?? [];

  return [...new Set(matches.map((match) => normalizeWhitespace(match)))].slice(0, 6);
}

function extractLocations(value: string) {
  const matches =
    value.match(
      /\b(?:in|at|for|from|about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g,
    ) ?? [];

  return [
    ...new Set(
      matches
        .map((match) =>
          normalizeWhitespace(match.replace(/^(in|at|for|from|about)\s+/i, "")),
        )
        .filter(Boolean),
    ),
  ].slice(0, 5);
}

function keywordSummary(messages: MessageLike[]) {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content);
  const counts = new Map<string, number>();

  for (const message of userMessages) {
    for (const token of toSearchTokens(message)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6)
    .map(([token]) => token);
}

function inferActiveTopic(
  currentQuestion: string,
  history: MessageLike[],
  fallbackResolvedQuestion = "",
) {
  const latestUserQuestion =
    [...history]
      .reverse()
      .find((message) => message.role === "user" && normalizeWhitespace(message.content))?.content ??
    "";
  const standaloneTopicPivot =
    !looksLikeGreeting(currentQuestion) && !isFollowUpQuestion(currentQuestion);
  const base = standaloneTopicPivot
    ? currentQuestion
    : latestUserQuestion || fallbackResolvedQuestion || currentQuestion;
  const keywords = keywordSummary(history);
  const anchor = sentenceCase(base);

  if (standaloneTopicPivot || !keywords.length) {
    return anchor;
  }

  const keywordTail = keywords.slice(0, 4).join(", ");
  if (!anchor) {
    return sentenceCase(keywordTail);
  }

  return clip(`${anchor}. Focus areas: ${keywordTail}.`, 180);
}

function isFollowUpQuestion(question: string) {
  const trimmed = normalizeWhitespace(question);
  if (!trimmed) {
    return false;
  }

  const lower = trimmed.toLowerCase();
  const words = trimmed.split(/\s+/);
  const wordCount = words.length;
  const explicitFollowUpCue =
    /^(and|also|what about|how about|what else|what then|same for|compare that|compare them|what changed)\b/i.test(
      trimmed,
    );
  const deicticPronoun =
    /\b(this|that|those|them|it|there|here|these)\b/i.test(trimmed);
  const standaloneIntent =
    /^(top \d+|latest|current|best|what is|who is|which|how much|how many|compare|difference|ranking|rank|list|price|prices|gdp|population|weather|stock|news|update)\b/i.test(
      lower,
    ) ||
    /\b(richest|wealthiest|largest|smallest|cheapest|most expensive|countries|cities)\b/i.test(
      lower,
    );

  if (explicitFollowUpCue || deicticPronoun) {
    return true;
  }

  if (wordCount <= 2) {
    return true;
  }

  if (wordCount <= 5) {
    return !standaloneIntent;
  }

  return false;
}

function cleanupAnchorQuestion(value: string) {
  return normalizeWhitespace(value)
    .replace(/\b(can you|could you|please|tell me|show me|give me)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveFollowUpQuestion(
  question: string,
  memory: ConversationMemory,
) {
  const trimmed = normalizeWhitespace(question);
  if (!trimmed) {
    return trimmed;
  }

  if (looksLikeGreeting(trimmed)) {
    return trimmed;
  }

  if (!isFollowUpQuestion(trimmed)) {
    return trimmed;
  }

  const anchor =
    cleanupAnchorQuestion(memory.lastResolvedQuestion) ||
    cleanupAnchorQuestion(memory.lastUserQuestion) ||
    cleanupAnchorQuestion(memory.activeTopic);

  if (!anchor) {
    return trimmed;
  }

  const normalizedAnchor = anchor.replace(/[.?!]+$/g, "");
  const directSubject = trimmed
    .replace(/^(and|also)\s+/i, "")
    .replace(/^(what about|how about|same for)\s+/i, "")
    .replace(/[?!.]+$/g, "")
    .trim();

  if (/^(what about|how about|same for)\b/i.test(trimmed) && directSubject) {
    return normalizeWhitespace(`${normalizedAnchor} ${directSubject}`);
  }

  if (/^(why|when|where|who|how much|how many|which one)\b/i.test(trimmed)) {
    return normalizeWhitespace(`${trimmed} regarding ${normalizedAnchor}`);
  }

  if (/^(and|also)\b/i.test(trimmed)) {
    return normalizeWhitespace(`${normalizedAnchor} ${trimmed.replace(/^(and|also)\s+/i, "")}`);
  }

  if (
    /\b(this|that|those|them|it|there|here|these)\b/i.test(trimmed) &&
    !trimmed.toLowerCase().includes(normalizedAnchor.toLowerCase())
  ) {
    return normalizeWhitespace(`${trimmed} about ${normalizedAnchor}`);
  }

  return normalizeWhitespace(`${normalizedAnchor} ${trimmed}`);
}

function currentMonthYear() {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date());
}

function shouldAppendDate(question: string) {
  return /\b(latest|today|current|recent|price|prices|news|update|updates|this week|this month|202[5-9]|202\d)\b/i.test(
    question,
  );
}

function buildQueries(resolvedQuestion: string, memory: ConversationMemory) {
  const queries = new Set<string>();
  const question = normalizeWhitespace(resolvedQuestion);
  const activeTopic = normalizeWhitespace(memory.activeTopic);

  queries.add(question);

  if (shouldAppendDate(question)) {
    queries.add(`${question} ${currentMonthYear()}`);
  }

  const questionTokens = new Set(toSearchTokens(question));
  const activeTopicTokens = new Set(toSearchTokens(activeTopic));
  const overlapCount = [...questionTokens].filter((token) =>
    activeTopicTokens.has(token),
  ).length;
  const overlapRatio =
    questionTokens.size > 0 ? overlapCount / questionTokens.size : 0;

  if (
    activeTopic &&
    !question.toLowerCase().includes(activeTopic.toLowerCase()) &&
    overlapRatio >= 0.25
  ) {
    queries.add(`${question} ${activeTopic}`);
  }

  if (/\b(price|prices|cost|tariff|rate|fare|fee)\b/i.test(question)) {
    queries.add(`${question} official source`);
    queries.add(`${question} government update`);
  } else if (/\b(compare|comparison|vs|versus|difference|differences)\b/i.test(question)) {
    queries.add(`${question} comparison`);
    queries.add(`${question} official documentation`);
  } else if (/\b(report|research|market|industry|analysis|brief|trend)\b/i.test(question)) {
    queries.add(`${question} analysis`);
    queries.add(`${question} report`);
  } else {
    queries.add(`${question} official source`);
    queries.add(`${question} latest`);
  }

  const fallbackQueries = [
    `${question} ${currentMonthYear()}`,
    `${question} latest update`,
    `${question} facts`,
    `${question} official announcement`,
    activeTopic && overlapRatio >= 0.25 ? `${question} ${activeTopic}` : "",
  ].filter(Boolean);

  for (const fallbackQuery of fallbackQueries) {
    if (queries.size >= 3) {
      break;
    }
    queries.add(normalizeWhitespace(fallbackQuery));
  }

  return [...queries]
    .map((query) => normalizeWhitespace(query))
    .filter(Boolean)
    .slice(0, 5);
}

export function buildConversationMemory(
  currentQuestion: string,
  history: ResearchRequestBody["history"] = [],
  previousMemory?: Partial<ConversationMemory> | null,
): ConversationMemory {
  const messages = (history ?? [])
    .map((message) => ({
      role: message.role,
      content: normalizeWhitespace(message.content),
    }))
    .filter((message) => message.content);

  const lastUserQuestion =
    [...messages].reverse().find((message) => message.role === "user")?.content ??
    previousMemory?.lastUserQuestion ??
    "";
  const lastAssistantAnswer =
    [...messages].reverse().find((message) => message.role === "assistant")?.content ??
    previousMemory?.lastAssistantAnswer ??
    "";
  const lastResolvedQuestion =
    previousMemory?.lastResolvedQuestion ||
    lastUserQuestion ||
    normalizeWhitespace(currentQuestion);
  const activeTopic = inferActiveTopic(
    currentQuestion,
    messages,
    lastResolvedQuestion,
  );
  const openQuestions = messages
    .filter((message) => message.role === "user" && /\?$/.test(message.content))
    .slice(-3)
    .map((message) => sentenceCase(message.content));
  const summaryParts = [
    activeTopic ? `Conversation focus: ${clip(activeTopic, 90)}` : "",
    lastUserQuestion ? `Last user ask: ${clip(lastUserQuestion, 90)}` : "",
    lastAssistantAnswer ? `Last answer: ${clip(lastAssistantAnswer, 90)}` : "",
  ].filter(Boolean);

  const entities = [
    ...new Set(
      [
        ...extractEntities(currentQuestion),
        ...messages.flatMap((message) => extractEntities(message.content)),
        ...(previousMemory?.entities ?? []),
      ].filter(Boolean),
    ),
  ].slice(0, 8);

  const locations = [
    ...new Set(
      [
        ...extractLocations(currentQuestion),
        ...messages.flatMap((message) => extractLocations(message.content)),
        ...(previousMemory?.locations ?? []),
      ].filter(Boolean),
    ),
  ].slice(0, 6);

  return {
    summary:
      summaryParts.join(". ") ||
      "New conversation with no prior thread context.",
    activeTopic: clip(activeTopic || sentenceCase(currentQuestion), 120),
    lastUserQuestion,
    lastAssistantAnswer: clip(lastAssistantAnswer, 160),
    lastResolvedQuestion: clip(lastResolvedQuestion, 180),
    openQuestions,
    entities,
    locations,
  };
}

export function rewriteQuestionWithMemory(
  question: string,
  history: ResearchRequestBody["history"] = [],
  previousMemory?: Partial<ConversationMemory> | null,
): QueryRewriteResult {
  const memory = buildConversationMemory(question, history, previousMemory);
  const hasPriorThreadContext = Boolean(
    (history?.length ?? 0) > 0 ||
      previousMemory?.lastUserQuestion ||
      previousMemory?.lastResolvedQuestion,
  );
  const resolvedQuestion = normalizeWhitespace(
    hasPriorThreadContext ? resolveFollowUpQuestion(question, memory) || question : question,
  );
  const usedConversationContext =
    normalizeWhitespace(question).toLowerCase() !== resolvedQuestion.toLowerCase();

  return {
    resolvedQuestion,
    rewrittenQueries: buildQueries(resolvedQuestion, {
      ...memory,
      lastResolvedQuestion: resolvedQuestion,
    }),
    usedConversationContext,
    memory: {
      ...memory,
      lastResolvedQuestion: resolvedQuestion,
    },
  };
}
