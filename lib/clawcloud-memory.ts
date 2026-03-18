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
};

const RAW_RECENT_TURNS = 14;
const SUMMARY_LOOK_BACK = 40;
const MAX_CONTENT_CHARS = 800;

const FOLLOW_UP_SIGNALS = [
  /\b(it|this|that|those|these|they|he|she|him|her|its|their)\b/i,
  /\b(above|previous|last|earlier|before|prior|mentioned|said|told)\b/i,
  /\b(more|again|also|another|next|then|after|and|so|but|still)\b/i,
  /^(yes|no|ok|okay|sure|right|correct|wrong|really|why|how|when|what|who|where)\b/i,
  /\?$/,
];

const PRONOUN_START = /^(it|this|that|those|they|he|she)\s/i;

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
        content: String(row.content ?? "").trim().slice(0, MAX_CONTENT_CHARS),
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
  const resolvedQuestion = isFollowUp
    ? resolveFollowUp(currentMessage, recentTurns, activeTopics)
    : currentMessage.trim();

  return {
    recentTurns,
    topicSummary,
    activeTopics,
    isFollowUp,
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
    lines.push(`Resolved question: ${memory.resolvedQuestion}`);
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
  const limit = mode === "deep" ? 20 : 12;
  return loadRawHistory(userId, limit);
}
