export type ClawCloudWhatsAppChatSyncCompleteness =
  | "not_started"
  | "partial"
  | "deep"
  | "complete_as_available";

export type ClawCloudWhatsAppHistoryBackfillChatInput = {
  remoteJid: string;
  oldestMessageId: string | null;
  chatType: "direct" | "group" | "self" | "unknown";
  messageCount: number;
  oldestTimestampMs: number | null;
  latestTimestampMs: number | null;
  fromMe: boolean;
  attempts: number;
  hasDisplayName: boolean;
};

export type ClawCloudWhatsAppHistoryBackfillChatState = {
  remoteJid: string;
  oldestMessageId: string | null;
  chatType: "direct" | "group" | "self" | "unknown";
  messageCount: number;
  oldestTimestampAt: string | null;
  latestTimestampAt: string | null;
  fromMe: boolean;
  attempts: number;
  hasDisplayName: boolean;
  completeness: ClawCloudWhatsAppChatSyncCompleteness;
  priorityScore: number;
};

export type ClawCloudWhatsAppHistoryCoverageSummary = {
  notStartedChats: number;
  partialChats: number;
  deepChats: number;
  completeChats: number;
  prioritizedChats: number;
};

function clampPositiveInt(value: number | null | undefined, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function toIsoOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : null;
}

export function deriveClawCloudWhatsAppChatSyncCompleteness(input: {
  messageCount: number;
  attempts?: number | null;
  deepMessageTarget?: number | null;
  completionAttemptThreshold?: number | null;
  completionMinMessageCount?: number | null;
}): ClawCloudWhatsAppChatSyncCompleteness {
  const messageCount = Math.max(0, Math.trunc(input.messageCount || 0));
  const attempts = Math.max(0, Math.trunc(input.attempts || 0));
  const deepMessageTarget = clampPositiveInt(input.deepMessageTarget, 48, 12, 500);
  const completionAttemptThreshold = clampPositiveInt(input.completionAttemptThreshold, 6, 1, 20);
  const completionMinMessageCount = clampPositiveInt(
    input.completionMinMessageCount,
    Math.max(12, Math.round(deepMessageTarget / 2)),
    1,
    deepMessageTarget,
  );

  if (messageCount <= 0) {
    return "not_started";
  }

  if (attempts >= completionAttemptThreshold && messageCount >= completionMinMessageCount) {
    return "complete_as_available";
  }

  if (messageCount >= deepMessageTarget) {
    return "deep";
  }

  return "partial";
}

function scoreClawCloudWhatsAppHistoryBackfillChat(
  chat: ClawCloudWhatsAppHistoryBackfillChatInput,
  completeness: ClawCloudWhatsAppChatSyncCompleteness,
  options: {
    deepMessageTarget: number;
    nowMs: number;
  },
) {
  let score = 0;

  switch (completeness) {
    case "not_started":
      score += 180;
      break;
    case "partial":
      score += 135;
      break;
    case "deep":
      score += 45;
      break;
    case "complete_as_available":
      score -= 90;
      break;
    default:
      break;
  }

  if (chat.chatType === "self") {
    score += 125;
  } else if (chat.chatType === "direct") {
    score += 95;
  } else if (chat.chatType === "group") {
    score += 28;
  }

  const recencyAgeDays =
    typeof chat.latestTimestampMs === "number" && Number.isFinite(chat.latestTimestampMs)
      ? Math.max(0, (options.nowMs - chat.latestTimestampMs) / 86_400_000)
      : 365;
  score += Math.max(0, Math.round(60 - Math.min(60, recencyAgeDays * 3)));
  score += Math.max(0, options.deepMessageTarget - Math.max(0, Math.trunc(chat.messageCount || 0)));
  score -= Math.max(0, Math.trunc(chat.attempts || 0)) * 32;

  if (chat.hasDisplayName) {
    score += 12;
  }

  return score;
}

export function buildClawCloudWhatsAppHistoryBackfillPlan(
  chats: ClawCloudWhatsAppHistoryBackfillChatInput[],
  options: {
    deepMessageTarget?: number | null;
    completionAttemptThreshold?: number | null;
    completionMinMessageCount?: number | null;
    nowMs?: number | null;
  } = {},
): ClawCloudWhatsAppHistoryBackfillChatState[] {
  const deepMessageTarget = clampPositiveInt(options.deepMessageTarget, 48, 12, 500);
  const completionAttemptThreshold = clampPositiveInt(options.completionAttemptThreshold, 6, 1, 20);
  const completionMinMessageCount = clampPositiveInt(
    options.completionMinMessageCount,
    Math.max(12, Math.round(deepMessageTarget / 2)),
    1,
    deepMessageTarget,
  );
  const nowMs =
    typeof options.nowMs === "number" && Number.isFinite(options.nowMs)
      ? options.nowMs
      : Date.now();

  return chats
    .filter((chat) => typeof chat.remoteJid === "string" && chat.remoteJid.trim().length > 0)
    .map((chat) => {
      const completeness = deriveClawCloudWhatsAppChatSyncCompleteness({
        messageCount: chat.messageCount,
        attempts: chat.attempts,
        deepMessageTarget,
        completionAttemptThreshold,
        completionMinMessageCount,
      });

      return {
        remoteJid: chat.remoteJid.trim(),
        oldestMessageId: typeof chat.oldestMessageId === "string" && chat.oldestMessageId.trim()
          ? chat.oldestMessageId.trim()
          : null,
        chatType: chat.chatType,
        messageCount: Math.max(0, Math.trunc(chat.messageCount || 0)),
        oldestTimestampAt: toIsoOrNull(chat.oldestTimestampMs),
        latestTimestampAt: toIsoOrNull(chat.latestTimestampMs),
        fromMe: Boolean(chat.fromMe),
        attempts: Math.max(0, Math.trunc(chat.attempts || 0)),
        hasDisplayName: Boolean(chat.hasDisplayName),
        completeness,
        priorityScore: scoreClawCloudWhatsAppHistoryBackfillChat(chat, completeness, {
          deepMessageTarget,
          nowMs,
        }),
      };
    })
    .sort((left, right) => {
      if (left.priorityScore !== right.priorityScore) {
        return right.priorityScore - left.priorityScore;
      }
      if (left.latestTimestampAt !== right.latestTimestampAt) {
        return String(right.latestTimestampAt ?? "").localeCompare(String(left.latestTimestampAt ?? ""));
      }
      return left.remoteJid.localeCompare(right.remoteJid);
    });
}

export function summarizeClawCloudWhatsAppHistoryCoverage(
  chats: ClawCloudWhatsAppHistoryBackfillChatState[],
): ClawCloudWhatsAppHistoryCoverageSummary {
  const summary: ClawCloudWhatsAppHistoryCoverageSummary = {
    notStartedChats: 0,
    partialChats: 0,
    deepChats: 0,
    completeChats: 0,
    prioritizedChats: chats.length,
  };

  for (const chat of chats) {
    switch (chat.completeness) {
      case "not_started":
        summary.notStartedChats += 1;
        break;
      case "partial":
        summary.partialChats += 1;
        break;
      case "deep":
        summary.deepChats += 1;
        break;
      case "complete_as_available":
        summary.completeChats += 1;
        break;
      default:
        break;
    }
  }

  return summary;
}
