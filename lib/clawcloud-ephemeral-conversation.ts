export type ClawCloudEphemeralConversationTurn = {
  role: "user" | "assistant";
  content: string;
  timestampMs: number;
  source?: string | null;
};

type ClawCloudEphemeralConversationInputTurn = {
  role: "user" | "assistant";
  content: string;
  timestampMs?: number | null;
  source?: string | null;
};

type ClawCloudConversationTurnLike = {
  role: "user" | "assistant";
  content: string;
  timestampMs: number;
};

const CLAWCLOUD_EPHEMERAL_CONVERSATION_TTL_MS = 45 * 60 * 1000;
const CLAWCLOUD_EPHEMERAL_CONVERSATION_LIMIT = 32;
const CLAWCLOUD_EPHEMERAL_CONVERSATION_MAX_CONTENT = 1_200;
const CLAWCLOUD_EPHEMERAL_CONVERSATION_DEDUPE_WINDOW_MS = 15_000;

const clawCloudEphemeralConversationStore = new Map<string, ClawCloudEphemeralConversationTurn[]>();

function normalizeConversationUserId(userId: string) {
  return String(userId ?? "").trim();
}

function normalizeConversationContent(content: string) {
  return String(content ?? "").replace(/\s+/g, " ").trim().slice(0, CLAWCLOUD_EPHEMERAL_CONVERSATION_MAX_CONTENT);
}

function pruneUserConversationTurns(userId: string) {
  const normalizedUserId = normalizeConversationUserId(userId);
  if (!normalizedUserId) {
    return [];
  }

  const existing = clawCloudEphemeralConversationStore.get(normalizedUserId) ?? [];
  const cutoff = Date.now() - CLAWCLOUD_EPHEMERAL_CONVERSATION_TTL_MS;
  const pruned = existing
    .filter((turn) => Number.isFinite(turn.timestampMs) && turn.timestampMs >= cutoff && turn.content.trim().length > 0)
    .slice(-CLAWCLOUD_EPHEMERAL_CONVERSATION_LIMIT);

  if (pruned.length) {
    clawCloudEphemeralConversationStore.set(normalizedUserId, pruned);
  } else {
    clawCloudEphemeralConversationStore.delete(normalizedUserId);
  }

  return pruned;
}

function normalizeInputTurn(
  turn: ClawCloudEphemeralConversationInputTurn,
  fallbackTimestampMs: number,
  source?: string | null,
): ClawCloudEphemeralConversationTurn | null {
  if (turn.role !== "user" && turn.role !== "assistant") {
    return null;
  }

  const content = normalizeConversationContent(turn.content);
  if (!content) {
    return null;
  }

  const timestampMs = Number.isFinite(Number(turn.timestampMs))
    ? Math.max(0, Math.trunc(Number(turn.timestampMs)))
    : fallbackTimestampMs;

  return {
    role: turn.role,
    content,
    timestampMs,
    source: turn.source ?? source ?? null,
  };
}

function appendConversationTurn(userId: string, turn: ClawCloudEphemeralConversationTurn) {
  const normalizedUserId = normalizeConversationUserId(userId);
  if (!normalizedUserId) {
    return;
  }

  const turns = pruneUserConversationTurns(normalizedUserId);
  const previous = turns[turns.length - 1] ?? null;
  if (
    previous
    && previous.role === turn.role
    && previous.content === turn.content
    && Math.abs(turn.timestampMs - previous.timestampMs) <= CLAWCLOUD_EPHEMERAL_CONVERSATION_DEDUPE_WINDOW_MS
  ) {
    if (turn.timestampMs >= previous.timestampMs) {
      turns[turns.length - 1] = turn;
    }
  } else {
    turns.push(turn);
  }

  clawCloudEphemeralConversationStore.set(
    normalizedUserId,
    turns.slice(-CLAWCLOUD_EPHEMERAL_CONVERSATION_LIMIT),
  );
}

export function rememberClawCloudEphemeralConversationTurn(
  userId: string,
  role: "user" | "assistant",
  content: string,
  source?: string | null,
  timestampMs?: number | null,
) {
  const normalizedTurn = normalizeInputTurn(
    { role, content, timestampMs, source },
    Date.now(),
    source,
  );
  if (!normalizedTurn) {
    return;
  }

  appendConversationTurn(userId, normalizedTurn);
}

export function rememberClawCloudEphemeralConversationTurns(
  userId: string,
  turns: ClawCloudEphemeralConversationInputTurn[],
  source?: string | null,
) {
  const normalizedUserId = normalizeConversationUserId(userId);
  if (!normalizedUserId || !Array.isArray(turns) || turns.length === 0) {
    return;
  }

  const baseTime = Date.now();
  turns.forEach((turn, index) => {
    const normalizedTurn = normalizeInputTurn(turn, baseTime + index, source);
    if (!normalizedTurn) {
      return;
    }

    appendConversationTurn(normalizedUserId, normalizedTurn);
  });
}

export function rememberClawCloudEphemeralConversationExchange(
  userId: string,
  userMessage: string,
  assistantReply?: string | null,
  source?: string | null,
) {
  const turns: ClawCloudEphemeralConversationInputTurn[] = [
    {
      role: "user",
      content: userMessage,
      timestampMs: Date.now(),
    },
  ];

  if (String(assistantReply ?? "").trim()) {
    turns.push({
      role: "assistant",
      content: String(assistantReply ?? ""),
      timestampMs: Date.now() + 1,
    });
  }

  rememberClawCloudEphemeralConversationTurns(userId, turns, source);
}

export function mergeClawCloudConversationTurns(
  turns: ClawCloudConversationTurnLike[],
  limit = CLAWCLOUD_EPHEMERAL_CONVERSATION_LIMIT,
) {
  const sanitized = turns
    .map((turn) => ({
      role: turn.role,
      content: normalizeConversationContent(turn.content),
      timestampMs: Number.isFinite(turn.timestampMs) ? Math.max(0, Math.trunc(turn.timestampMs)) : 0,
    }))
    .filter((turn) => turn.content.length > 0)
    .sort((left, right) => left.timestampMs - right.timestampMs);

  const deduped: ClawCloudConversationTurnLike[] = [];
  for (const turn of sanitized) {
    const previous = deduped[deduped.length - 1] ?? null;
    if (
      previous
      && previous.role === turn.role
      && previous.content === turn.content
      && Math.abs(turn.timestampMs - previous.timestampMs) <= CLAWCLOUD_EPHEMERAL_CONVERSATION_DEDUPE_WINDOW_MS
    ) {
      if (turn.timestampMs >= previous.timestampMs) {
        deduped[deduped.length - 1] = turn;
      }
      continue;
    }

    deduped.push(turn);
  }

  return deduped.slice(-Math.max(1, limit));
}

export function getClawCloudEphemeralConversationTurns(
  userId: string,
  limit = CLAWCLOUD_EPHEMERAL_CONVERSATION_LIMIT,
) {
  return pruneUserConversationTurns(userId)
    .slice(-Math.max(1, limit))
    .map((turn) => ({ ...turn }));
}

export function getClawCloudEphemeralConversationHistory(
  userId: string,
  limit = CLAWCLOUD_EPHEMERAL_CONVERSATION_LIMIT,
) {
  return getClawCloudEphemeralConversationTurns(userId, limit).map(({ role, content }) => ({
    role,
    content,
  }));
}

export function clearClawCloudEphemeralConversationHistoryForTest(userId?: string) {
  if (userId) {
    clawCloudEphemeralConversationStore.delete(normalizeConversationUserId(userId));
    return;
  }

  clawCloudEphemeralConversationStore.clear();
}
