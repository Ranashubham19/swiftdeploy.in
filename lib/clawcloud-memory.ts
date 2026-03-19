import {
  extractDocumentContextSnippet,
  looksLikeDocumentPrompt,
} from "@/lib/clawcloud-docs";
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
};

const RAW_RECENT_TURNS = 20;
const SUMMARY_LOOK_BACK = 40;
const MAX_CONTENT_CHARS = 800;
const MAX_DOCUMENT_CONTENT_CHARS = 3_200;

const FOLLOW_UP_SIGNALS = [
  /\b(it|this|that|those|these|they|he|she|him|her|its|their)\b/i,
  /\b(above|previous|last|earlier|before|prior|mentioned|said|told)\b/i,
  /\b(more|again|also|another|next|then|after|and|so|but|still)\b/i,
  /^(yes|no|ok|okay|sure|right|correct|wrong|really|why|how|when|what|who|where)\b/i,
  /\?$/,
];

const PRONOUN_START = /^(it|this|that|those|they|he|she)\s/i;
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

function isFollowUpQuestion(currentMessage: string, recentTurns: MemoryTurn[]): boolean {
  if (!recentTurns.length) return false;

  const msg = currentMessage.trim();
  const words = msg.split(/\s+/).filter(Boolean);

  if (!msg) return false;
  if (words.length <= 4) return true;
  if (PRONOUN_START.test(msg)) return true;

  const hits = FOLLOW_UP_SIGNALS.reduce((count, re) => count + (re.test(msg) ? 1 : 0), 0);
  return hits >= 2;
}

function resolveFollowUp(currentMessage: string, recentTurns: MemoryTurn[], activeTopics: string[]): string {
  const msg = currentMessage.trim();
  if (!recentTurns.length || !msg) return msg;

  const lastUserTurn = [...recentTurns].reverse().find((turn) => turn.role === "user");
  const lastAssistantTurn = [...recentTurns].reverse().find((turn) => turn.role === "assistant");
  const lastUserContext = lastUserTurn?.content?.slice(0, 180) ?? "";
  const lastAssistantContext = lastAssistantTurn?.content?.slice(0, 180) ?? "";
  const context = lastUserContext || lastAssistantContext;

  if (PRONOUN_START.test(msg) && context) {
    return `${msg} (context: ${context})`;
  }

  const words = msg.split(/\s+/).filter(Boolean).length;
  if (words <= 6 && activeTopics.length > 0) {
    return `${msg} (topic: ${activeTopics.join(", ")})`;
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
    .map((turn) => turn.content.slice(0, 120))
    .slice(-6);

  if (!userMessages.length) return "";

  const topicList = extractTopics(userMessages.join(" "));
  const preview = userMessages.slice(-2).join("; ").slice(0, 220);
  const topicLine = topicList.length ? `Topics: ${topicList.join(", ")}.` : "";

  return [
    `Earlier, the user discussed: ${preview}.`,
    topicLine,
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
  if (memory.isFollowUp) {
    lines.push("Current message is a follow-up. Use prior context.");
    if (looksLikeDocumentPrompt(memory.resolvedQuestion)) {
      lines.push("Resolved question includes the recent uploaded document context.");
    } else {
      lines.push(`Resolved question: ${memory.resolvedQuestion}`);
    }
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
  const limit = mode === "deep" ? 30 : 20;
  return loadRawHistory(userId, limit);
}
