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

const RAW_RECENT_TURNS = 30;
const SUMMARY_LOOK_BACK = 60;
const MAX_CONTENT_CHARS = 1_200;
const MAX_DOCUMENT_CONTENT_CHARS = 4_800;

const FOLLOW_UP_SIGNALS = [
  /\b(it|this|that|those|these|they|he|she|him|her|its|their)\b/i,
  /\b(above|previous|last|earlier|before|prior|mentioned|said|told)\b/i,
  /\b(more|again|also|another|next|then|after|and|so|but|still)\b/i,
  /^(yes|no|ok|okay|sure|right|correct|wrong|really|why|how|when|what|who|where)\b/i,
  /\?$/,
];

const PRONOUN_START = /^(it|this|that|those|they|he|she)\s/i;
const DIRECT_STANDALONE_QUESTION_START =
  /^(?:what(?:'s| is| are| was| were)|who(?:'s| is| are| was| were)|when(?:'s| is| are| was| were| did)|where(?:'s| is| are| was| were)|why(?:'s| is| are| does| do| did)|how(?:'s| is| are| does| do| did)|explain|describe|define|summari[sz]e|story of|plot of|summary of|tell me about|compare|difference between)\b/i;
const DOCUMENT_FOLLOW_UP_SIGNAL =
  /\b(document|file|pdf|sheet|page|row|table|section|clause|invoice|statement|receipt|contract|resume|cv)\b/i;
const DOCUMENT_DECISION_SIGNAL =
  /\b(which|compare|better|best|cheapest|lowest|highest|difference|summary|summarize|explain|mention|show)\b/i;

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

function looksLikeStandaloneQuestion(msg: string, wordCount: number) {
  if (!msg) {
    return false;
  }

  if (DIRECT_STANDALONE_QUESTION_START.test(msg)) {
    return true;
  }

  return /[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/u.test(msg) && wordCount >= 4 && !PRONOUN_START.test(msg);
}

function isFollowUpQuestion(currentMessage: string, recentTurns: MemoryTurn[]): boolean {
  if (!recentTurns.length) return false;

  const msg = currentMessage.trim();
  const words = msg.split(/\s+/).filter(Boolean);
  const wordCount = words.length;

  if (!msg) return false;
  if (PRONOUN_START.test(msg)) return true;
  if (looksLikeStandaloneQuestion(msg, wordCount)) return false;
  if (wordCount <= 3) return true;

  const hits = FOLLOW_UP_SIGNALS.reduce((count, re) => count + (re.test(msg) ? 1 : 0), 0);
  return hits >= 2;
}

function resolveFollowUp(currentMessage: string, recentTurns: MemoryTurn[], activeTopics: string[]): string {
  const msg = currentMessage.trim();
  if (!recentTurns.length || !msg) return msg;

  const lastUserTurn = [...recentTurns].reverse().find((turn) => turn.role === "user");
  const lastAssistantTurn = [...recentTurns].reverse().find((turn) => turn.role === "assistant");
  const lastUserContext = lastUserTurn?.content?.slice(0, 300) ?? "";
  const lastAssistantContext = lastAssistantTurn?.content?.slice(0, 300) ?? "";

  // For pronoun references, inject both user and assistant context
  if (PRONOUN_START.test(msg)) {
    const contextParts: string[] = [];
    if (lastUserContext) contextParts.push(`user asked: ${lastUserContext}`);
    if (lastAssistantContext) contextParts.push(`you answered: ${lastAssistantContext}`);
    const context = contextParts.join("; ");
    return context ? `${msg} (context: ${context})` : msg;
  }

  const words = msg.split(/\s+/).filter(Boolean).length;

  // For short messages, inject topic and recent context
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
  const isFollowUp = isFollowUpQuestion(currentMessage, recentTurns);
  const recentDocumentContext = findRecentDocumentContext(recentTurns);
  const casualTalkProfile = inferClawCloudCasualTalkProfile(currentMessage, recentTurns);
  const emotionalContext = inferClawCloudEmotionalContext(currentMessage, recentTurns);
  const resolvedQuestionBase = isFollowUp
    ? resolveFollowUp(currentMessage, recentTurns, activeTopics)
    : currentMessage.trim();
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
      lines.push(`Resolved question with context: ${memory.resolvedQuestion}`);
    }
    lines.push("IMPORTANT: Answer in the context of the ongoing conversation. Do not treat this as a standalone question.");
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
