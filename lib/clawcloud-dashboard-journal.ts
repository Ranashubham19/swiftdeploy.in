import type {
  AppAccessConsentRequest,
  AppAccessConsentStatus,
} from "@/lib/clawcloud-app-access-consent";
import type { ClawCloudConversationStyleRequest } from "@/lib/clawcloud-conversation-style";
import type {
  ClawCloudAnswerBundle,
  ClawCloudEvidenceItem,
  ClawCloudModelAuditCandidate,
  ClawCloudModelAuditJudge,
  ClawCloudModelAuditTrail,
} from "@/lib/types";

const dashboardJournalTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const dashboardJournalDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

export type DashboardJournalAppAccessConsent = AppAccessConsentRequest & {
  status: AppAccessConsentStatus;
};

export type DashboardJournalConversationStyleRequest = ClawCloudConversationStyleRequest & {
  status: "pending" | "professional" | "casual";
};

export type DashboardJournalMessage = {
  id: string;
  role: "bot" | "user";
  text: string;
  time: string;
  createdAt: string;
  appAccessConsent?: DashboardJournalAppAccessConsent | null;
  conversationStyleRequest?: DashboardJournalConversationStyleRequest | null;
  liveAnswerBundle?: ClawCloudAnswerBundle | null;
  modelAuditTrail?: ClawCloudModelAuditTrail | null;
};

export type DashboardJournalThread = {
  id: string;
  dateKey: string;
  title: string;
  updatedAt: string;
  messages: DashboardJournalMessage[];
};

export type DashboardJournalThreadRecord = {
  thread_key: string;
  date_key: string;
  title: string;
  updated_at: string;
  created_at?: string | null;
  messages: unknown;
};

export const DASHBOARD_JOURNAL_STORAGE_PREFIX = "clawcloud-dashboard-journal-v1";
export const DASHBOARD_JOURNAL_THREAD_PREFIX = "dashboard-day-";

const DASHBOARD_JOURNAL_LIVE_EVIDENCE_KINDS = new Set<ClawCloudEvidenceItem["kind"]>([
  "search_result",
  "official_api",
  "official_page",
  "weather_provider",
  "market_data",
  "report",
  "inferred",
]);

const DASHBOARD_JOURNAL_MODEL_AUDIT_TIERS = new Set<ClawCloudModelAuditCandidate["tier"]>([
  "fast",
  "chat",
  "reasoning",
  "code",
]);

const DASHBOARD_JOURNAL_MODEL_AUDIT_STATUSES = new Set<ClawCloudModelAuditCandidate["status"]>([
  "selected",
  "generated",
  "failed",
]);

function clampDashboardJournalText(value: string, limit: number) {
  return value.trim().slice(0, limit);
}

function normalizeDashboardJournalEvidenceItem(
  raw: Partial<ClawCloudEvidenceItem>,
): ClawCloudEvidenceItem | null {
  const title = typeof raw.title === "string" ? clampDashboardJournalText(raw.title, 180) : "";
  const domain = typeof raw.domain === "string" ? clampDashboardJournalText(raw.domain, 120) : "";
  const kind = raw.kind;

  if (!title || !domain || !kind || !DASHBOARD_JOURNAL_LIVE_EVIDENCE_KINDS.has(kind)) {
    return null;
  }

  return {
    title,
    domain,
    kind,
    url:
      typeof raw.url === "string" && raw.url.trim()
        ? clampDashboardJournalText(raw.url, 400)
        : null,
    snippet:
      typeof raw.snippet === "string" && raw.snippet.trim()
        ? clampDashboardJournalText(raw.snippet, 320)
        : null,
    publishedAt:
      typeof raw.publishedAt === "string" && raw.publishedAt.trim()
        ? raw.publishedAt
        : null,
    observedAt:
      typeof raw.observedAt === "string" && raw.observedAt.trim()
        ? raw.observedAt
        : null,
  };
}

function normalizeDashboardJournalLiveAnswerBundle(
  raw: unknown,
  fallbackAnswer: string,
): ClawCloudAnswerBundle | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const bundle = raw as Partial<ClawCloudAnswerBundle>;
  if (bundle.channel !== "live" || typeof bundle.generatedAt !== "string" || !bundle.generatedAt.trim()) {
    return null;
  }

  const evidence = Array.isArray(bundle.evidence)
    ? bundle.evidence
      .map((item) => normalizeDashboardJournalEvidenceItem(item))
      .filter((item): item is ClawCloudEvidenceItem => Boolean(item))
      .slice(0, 6)
    : [];

  const sourceSummary = Array.isArray(bundle.sourceSummary)
    ? bundle.sourceSummary
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => clampDashboardJournalText(item, 120))
      .slice(0, 6)
    : [];

  const metadataEntries = bundle.metadata && typeof bundle.metadata === "object" && !Array.isArray(bundle.metadata)
    ? Object.entries(bundle.metadata)
      .filter((entry) =>
        typeof entry[0] === "string"
        && entry[0].trim().length > 0
        && (
          typeof entry[1] === "string"
          || typeof entry[1] === "number"
          || typeof entry[1] === "boolean"
          || entry[1] === null
        ))
      .slice(0, 16)
    : [];

  return {
    question:
      typeof bundle.question === "string" && bundle.question.trim()
        ? clampDashboardJournalText(bundle.question, 500)
        : "",
    answer:
      typeof bundle.answer === "string" && bundle.answer.trim()
        ? clampDashboardJournalText(bundle.answer, 12_000)
        : clampDashboardJournalText(fallbackAnswer, 12_000),
    channel: "live",
    generatedAt: bundle.generatedAt,
    badge:
      typeof bundle.badge === "string" && bundle.badge.trim()
        ? clampDashboardJournalText(bundle.badge, 120)
        : null,
    sourceNote:
      typeof bundle.sourceNote === "string" && bundle.sourceNote.trim()
        ? clampDashboardJournalText(bundle.sourceNote, 240)
        : null,
    evidence,
    sourceSummary,
    metadata: Object.fromEntries(
      metadataEntries.map(([key, value]) => [
        clampDashboardJournalText(key, 80),
        typeof value === "string" ? clampDashboardJournalText(value, 160) : value,
      ]),
    ),
  };
}

function normalizeDashboardJournalModelAuditCandidate(
  raw: Partial<ClawCloudModelAuditCandidate>,
): ClawCloudModelAuditCandidate | null {
  const model = typeof raw.model === "string" ? clampDashboardJournalText(raw.model, 160) : "";
  const tier = raw.tier;
  const status = raw.status;
  const latencyMs = typeof raw.latencyMs === "number" && Number.isFinite(raw.latencyMs)
    ? Math.max(0, Math.round(raw.latencyMs))
    : 0;
  const heuristicScore = typeof raw.heuristicScore === "number" && Number.isFinite(raw.heuristicScore)
    ? Number(raw.heuristicScore.toFixed(2))
    : null;

  if (!model || !tier || !status || !DASHBOARD_JOURNAL_MODEL_AUDIT_TIERS.has(tier) || !DASHBOARD_JOURNAL_MODEL_AUDIT_STATUSES.has(status)) {
    return null;
  }

  return {
    model,
    tier,
    status,
    latencyMs,
    heuristicScore,
    preview:
      typeof raw.preview === "string" && raw.preview.trim()
        ? clampDashboardJournalText(raw.preview, 220)
        : null,
  };
}

function normalizeDashboardJournalModelAuditJudge(
  raw: Partial<ClawCloudModelAuditJudge> | null | undefined,
): ClawCloudModelAuditJudge | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const confidence = raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
    ? raw.confidence
    : null;

  return {
    used: Boolean(raw.used),
    model:
      typeof raw.model === "string" && raw.model.trim()
        ? clampDashboardJournalText(raw.model, 160)
        : null,
    winnerModel:
      typeof raw.winnerModel === "string" && raw.winnerModel.trim()
        ? clampDashboardJournalText(raw.winnerModel, 160)
        : null,
    confidence,
    materialDisagreement: Boolean(raw.materialDisagreement),
    needsClarification: Boolean(raw.needsClarification),
    reason:
      typeof raw.reason === "string" && raw.reason.trim()
        ? clampDashboardJournalText(raw.reason, 220)
        : null,
  };
}

function normalizeDashboardJournalModelAuditTrail(raw: unknown): ClawCloudModelAuditTrail | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const trail = raw as Partial<ClawCloudModelAuditTrail>;
  if (trail.responseMode !== "fast" && trail.responseMode !== "deep") {
    return null;
  }

  const planner = trail.planner;
  if (!planner || typeof planner !== "object" || Array.isArray(planner)) {
    return null;
  }

  const candidates = Array.isArray(trail.candidates)
    ? trail.candidates
      .map((candidate) => normalizeDashboardJournalModelAuditCandidate(candidate))
      .filter((candidate): candidate is ClawCloudModelAuditCandidate => Boolean(candidate))
      .slice(0, 8)
    : [];

  const selectedBy =
    trail.selectedBy === "single_success"
    || trail.selectedBy === "heuristic"
    || trail.selectedBy === "judge"
    || trail.selectedBy === "fallback"
      ? trail.selectedBy
      : null;

  return {
    intent:
      typeof trail.intent === "string" && trail.intent.trim()
        ? clampDashboardJournalText(trail.intent, 60)
        : "general",
    responseMode: trail.responseMode,
    planner: {
      strategy: planner.strategy === "collect_and_judge" ? "collect_and_judge" : "single_pass",
      targetResponses:
        typeof planner.targetResponses === "number" && Number.isFinite(planner.targetResponses)
          ? Math.max(1, Math.round(planner.targetResponses))
          : 1,
      generatorBatchSize:
        typeof planner.generatorBatchSize === "number" && Number.isFinite(planner.generatorBatchSize)
          ? Math.max(1, Math.round(planner.generatorBatchSize))
          : 1,
      judgeEnabled: Boolean(planner.judgeEnabled),
      judgeMinRemainingMs:
        typeof planner.judgeMinRemainingMs === "number" && Number.isFinite(planner.judgeMinRemainingMs)
          ? Math.max(0, Math.round(planner.judgeMinRemainingMs))
          : 0,
      allowLowConfidenceWinner: Boolean(planner.allowLowConfidenceWinner),
      disagreementThreshold:
        typeof planner.disagreementThreshold === "number" && Number.isFinite(planner.disagreementThreshold)
          ? Number(planner.disagreementThreshold.toFixed(2))
          : 0,
    },
    selectedBy,
    selectedModel:
      typeof trail.selectedModel === "string" && trail.selectedModel.trim()
        ? clampDashboardJournalText(trail.selectedModel, 160)
        : null,
    candidates,
    judge: normalizeDashboardJournalModelAuditJudge(trail.judge),
  };
}

function scoreDashboardJournalLiveAnswerBundle(bundle: ClawCloudAnswerBundle | null | undefined) {
  if (!bundle) {
    return -1;
  }

  return (
    bundle.evidence.length * 10
    + bundle.sourceSummary.length * 4
    + (bundle.badge ? 2 : 0)
    + (bundle.sourceNote ? 2 : 0)
    + Object.keys(bundle.metadata ?? {}).length
  );
}

function scoreDashboardJournalModelAuditTrail(trail: ClawCloudModelAuditTrail | null | undefined) {
  if (!trail) {
    return -1;
  }

  return (
    trail.candidates.length * 4
    + (trail.selectedModel ? 4 : 0)
    + (trail.planner.judgeEnabled ? 4 : 0)
    + (trail.judge?.used ? 8 : 0)
    + (trail.judge?.materialDisagreement ? 6 : 0)
  );
}

function generateDashboardJournalId() {
  const nextRandomUuid = globalThis.crypto?.randomUUID?.();
  if (nextRandomUuid) {
    return nextRandomUuid;
  }

  return `journal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatDashboardJournalMessageTime(date = new Date()) {
  return `${dashboardJournalTimeFormatter.format(date)} \u2713\u2713`;
}

export function getDashboardJournalDateKey(date = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return date.toISOString().split("T")[0] ?? "";
  }
}

export function buildDashboardJournalThreadId(dateKey: string) {
  return `${DASHBOARD_JOURNAL_THREAD_PREFIX}${dateKey}`;
}

export function buildDashboardJournalStorageKey(ownerKey: string) {
  return `${DASHBOARD_JOURNAL_STORAGE_PREFIX}:${ownerKey}`;
}

export function formatDashboardJournalLabel(
  dateKey: string,
  todayKey = getDashboardJournalDateKey(),
) {
  if (dateKey === todayKey) {
    return "Today";
  }

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === getDashboardJournalDateKey(yesterday)) {
    return "Yesterday";
  }

  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return dateKey;
  }

  return dashboardJournalDateFormatter.format(parsed);
}

export function createDashboardJournalThread(dateKey = getDashboardJournalDateKey()): DashboardJournalThread {
  const parsed = new Date(`${dateKey}T00:00:00`);
  const title = Number.isNaN(parsed.getTime())
    ? `Dashboard journal ${dateKey}`
    : `Dashboard journal ${dashboardJournalDateFormatter.format(parsed)}`;

  return {
    id: buildDashboardJournalThreadId(dateKey),
    dateKey,
    title,
    updatedAt: new Date().toISOString(),
    messages: [],
  };
}

export function normalizeDashboardJournalMessage(
  raw: Partial<DashboardJournalMessage>,
): DashboardJournalMessage {
  const createdAt = raw.createdAt || new Date().toISOString();
  const rawConsent = raw.appAccessConsent;
  const rawStyleRequest = raw.conversationStyleRequest;
  const normalizedStatus: AppAccessConsentStatus =
    rawConsent?.status === "approved" || rawConsent?.status === "denied"
      ? rawConsent.status
      : "pending";
  const normalizedConsent =
    rawConsent
      && typeof rawConsent.token === "string"
      && typeof rawConsent.prompt === "string"
      && typeof rawConsent.surface === "string"
      && typeof rawConsent.operation === "string"
      && typeof rawConsent.summary === "string"
      && typeof rawConsent.expiresAt === "string"
      && typeof rawConsent.issuedAt === "string"
      ? {
          token: rawConsent.token,
          prompt: rawConsent.prompt,
          surface: rawConsent.surface,
          operation: rawConsent.operation,
          summary: rawConsent.summary,
          expiresAt: rawConsent.expiresAt,
          issuedAt: rawConsent.issuedAt,
          yesLabel:
            typeof rawConsent.yesLabel === "string" && rawConsent.yesLabel.trim()
              ? rawConsent.yesLabel
              : "Yes",
          noLabel:
            typeof rawConsent.noLabel === "string" && rawConsent.noLabel.trim()
              ? rawConsent.noLabel
              : "No",
          status: normalizedStatus,
        }
      : null;
  const normalizedStyleStatus: DashboardJournalConversationStyleRequest["status"] =
    rawStyleRequest?.status === "professional" || rawStyleRequest?.status === "casual"
      ? rawStyleRequest.status
      : "pending";
  const normalizedStyleRequest =
    rawStyleRequest
      && typeof rawStyleRequest.token === "string"
      && typeof rawStyleRequest.prompt === "string"
      && typeof rawStyleRequest.issuedAt === "string"
      && typeof rawStyleRequest.expiresAt === "string"
      ? {
          token: rawStyleRequest.token,
          prompt: rawStyleRequest.prompt,
          issuedAt: rawStyleRequest.issuedAt,
          expiresAt: rawStyleRequest.expiresAt,
          professionalLabel:
            typeof rawStyleRequest.professionalLabel === "string" && rawStyleRequest.professionalLabel.trim()
              ? rawStyleRequest.professionalLabel
              : "Professional",
          casualLabel:
            typeof rawStyleRequest.casualLabel === "string" && rawStyleRequest.casualLabel.trim()
              ? rawStyleRequest.casualLabel
              : "Casual",
          status: normalizedStyleStatus,
        }
      : null;
  const normalizedLiveAnswerBundle = normalizeDashboardJournalLiveAnswerBundle(raw.liveAnswerBundle, raw.text ?? "");
  const normalizedModelAuditTrail = normalizeDashboardJournalModelAuditTrail(raw.modelAuditTrail);

  return {
    id: raw.id || generateDashboardJournalId(),
    role: raw.role === "user" ? "user" : "bot",
    text: typeof raw.text === "string" ? raw.text : "",
    createdAt,
    time: raw.time || formatDashboardJournalMessageTime(new Date(createdAt)),
    appAccessConsent: normalizedConsent,
    conversationStyleRequest: normalizedStyleRequest,
    liveAnswerBundle: normalizedLiveAnswerBundle,
    modelAuditTrail: normalizedModelAuditTrail,
  };
}

export function normalizeDashboardJournalThread(
  raw: Partial<DashboardJournalThread>,
): DashboardJournalThread {
  const dateKey = raw.dateKey || getDashboardJournalDateKey();
  return {
    id: raw.id || buildDashboardJournalThreadId(dateKey),
    dateKey,
    title: raw.title || createDashboardJournalThread(dateKey).title,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    messages: normalizeDashboardJournalMessages(
      Array.isArray(raw.messages) ? raw.messages : [],
    ),
  };
}

export function normalizeDashboardJournalMessages(
  messages: Array<Partial<DashboardJournalMessage>>,
) {
  return [...messages]
    .map((message) => normalizeDashboardJournalMessage(message))
    .sort((left, right) => {
      if (left.createdAt !== right.createdAt) {
        return left.createdAt.localeCompare(right.createdAt);
      }

      return left.id.localeCompare(right.id);
    });
}

export function sortDashboardJournalThreads(threads: DashboardJournalThread[]) {
  return [...threads].sort((left, right) => {
    if (left.dateKey !== right.dateKey) {
      return right.dateKey.localeCompare(left.dateKey);
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
}

export function mergeDashboardJournalMessages(
  left: DashboardJournalMessage[],
  right: DashboardJournalMessage[],
) {
  const merged = new Map<string, DashboardJournalMessage>();

  for (const message of [...left, ...right]) {
    const normalized = normalizeDashboardJournalMessage(message);
    const existing = merged.get(normalized.id);

    if (!existing) {
      merged.set(normalized.id, normalized);
      continue;
    }

    merged.set(normalized.id, {
      ...existing,
      ...normalized,
      text:
        normalized.text.length >= existing.text.length ? normalized.text : existing.text,
      time: normalized.time || existing.time,
      createdAt:
        normalized.createdAt && normalized.createdAt <= existing.createdAt
          ? normalized.createdAt
          : existing.createdAt,
      appAccessConsent: normalized.appAccessConsent ?? existing.appAccessConsent ?? null,
      conversationStyleRequest: normalized.conversationStyleRequest ?? existing.conversationStyleRequest ?? null,
      liveAnswerBundle:
        scoreDashboardJournalLiveAnswerBundle(normalized.liveAnswerBundle)
        >= scoreDashboardJournalLiveAnswerBundle(existing.liveAnswerBundle)
          ? normalized.liveAnswerBundle ?? null
          : existing.liveAnswerBundle ?? null,
      modelAuditTrail:
        scoreDashboardJournalModelAuditTrail(normalized.modelAuditTrail)
        >= scoreDashboardJournalModelAuditTrail(existing.modelAuditTrail)
          ? normalized.modelAuditTrail ?? null
          : existing.modelAuditTrail ?? null,
    });
  }

  return normalizeDashboardJournalMessages([...merged.values()]);
}

export function mergeDashboardJournalThread(
  left: DashboardJournalThread,
  right: DashboardJournalThread,
): DashboardJournalThread {
  const normalizedLeft = normalizeDashboardJournalThread(left);
  const normalizedRight = normalizeDashboardJournalThread(right);
  const newestUpdatedAt =
    new Date(normalizedLeft.updatedAt).getTime() >= new Date(normalizedRight.updatedAt).getTime()
      ? normalizedLeft.updatedAt
      : normalizedRight.updatedAt;
  const title =
    new Date(normalizedRight.updatedAt).getTime() >= new Date(normalizedLeft.updatedAt).getTime()
      ? normalizedRight.title
      : normalizedLeft.title;

  return normalizeDashboardJournalThread({
    id: normalizedLeft.id || normalizedRight.id,
    dateKey: normalizedLeft.dateKey || normalizedRight.dateKey,
    title,
    updatedAt: newestUpdatedAt,
    messages: mergeDashboardJournalMessages(normalizedLeft.messages, normalizedRight.messages),
  });
}

export function mergeDashboardJournalCollections(
  left: DashboardJournalThread[],
  right: DashboardJournalThread[],
) {
  const merged = new Map<string, DashboardJournalThread>();

  for (const thread of left) {
    const normalized = normalizeDashboardJournalThread(thread);
    merged.set(normalized.id, normalized);
  }

  for (const thread of right) {
    const normalized = normalizeDashboardJournalThread(thread);
    const existing = merged.get(normalized.id);
    merged.set(
      normalized.id,
      existing ? mergeDashboardJournalThread(existing, normalized) : normalized,
    );
  }

  return sortDashboardJournalThreads([...merged.values()]);
}

export function ensureDashboardJournalDay(
  threads: DashboardJournalThread[],
  dateKey = getDashboardJournalDateKey(),
) {
  const existing = threads.find((thread) => thread.dateKey === dateKey);
  if (existing) {
    return {
      threads: sortDashboardJournalThreads(threads),
      thread: existing,
    };
  }

  const nextThread = createDashboardJournalThread(dateKey);
  return {
    threads: sortDashboardJournalThreads([...threads, nextThread]),
    thread: nextThread,
  };
}

export function readLocalDashboardJournal(storageKey: string) {
  if (typeof window === "undefined") {
    return [] as DashboardJournalThread[];
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return [] as DashboardJournalThread[];
    }

    const parsed = JSON.parse(raw) as Partial<DashboardJournalThread>[];
    if (!Array.isArray(parsed)) {
      return [] as DashboardJournalThread[];
    }

    return sortDashboardJournalThreads(parsed.map((thread) => normalizeDashboardJournalThread(thread)));
  } catch {
    return [] as DashboardJournalThread[];
  }
}

export function buildDashboardJournalSyncSignature(threads: DashboardJournalThread[]) {
  return JSON.stringify(
    sortDashboardJournalThreads(threads).map((thread) => ({
      id: thread.id,
      dateKey: thread.dateKey,
      title: thread.title,
      updatedAt: thread.updatedAt,
      messages: thread.messages.map((message) => ({
        id: message.id,
        role: message.role,
        text: message.text,
        createdAt: message.createdAt,
        appAccessConsent: message.appAccessConsent
          ? {
              token: message.appAccessConsent.token,
              prompt: message.appAccessConsent.prompt,
              surface: message.appAccessConsent.surface,
              operation: message.appAccessConsent.operation,
              summary: message.appAccessConsent.summary,
              issuedAt: message.appAccessConsent.issuedAt,
              expiresAt: message.appAccessConsent.expiresAt,
              yesLabel: message.appAccessConsent.yesLabel,
              noLabel: message.appAccessConsent.noLabel,
              status: message.appAccessConsent.status,
            }
          : null,
        conversationStyleRequest: message.conversationStyleRequest
          ? {
              token: message.conversationStyleRequest.token,
              prompt: message.conversationStyleRequest.prompt,
              issuedAt: message.conversationStyleRequest.issuedAt,
              expiresAt: message.conversationStyleRequest.expiresAt,
              professionalLabel: message.conversationStyleRequest.professionalLabel,
              casualLabel: message.conversationStyleRequest.casualLabel,
              status: message.conversationStyleRequest.status,
            }
          : null,
        liveAnswerBundle: message.liveAnswerBundle
          ? {
              question: message.liveAnswerBundle.question,
              answer: message.liveAnswerBundle.answer,
              channel: message.liveAnswerBundle.channel,
              generatedAt: message.liveAnswerBundle.generatedAt,
              badge: message.liveAnswerBundle.badge,
              sourceNote: message.liveAnswerBundle.sourceNote,
              sourceSummary: message.liveAnswerBundle.sourceSummary,
              evidence: message.liveAnswerBundle.evidence,
              metadata: message.liveAnswerBundle.metadata,
            }
          : null,
        modelAuditTrail: message.modelAuditTrail
          ? {
              intent: message.modelAuditTrail.intent,
              responseMode: message.modelAuditTrail.responseMode,
              planner: message.modelAuditTrail.planner,
              selectedBy: message.modelAuditTrail.selectedBy,
              selectedModel: message.modelAuditTrail.selectedModel,
              candidates: message.modelAuditTrail.candidates,
              judge: message.modelAuditTrail.judge,
            }
          : null,
      })),
    })),
  );
}

export function dashboardJournalThreadToRecord(thread: DashboardJournalThread) {
  return {
    thread_key: thread.id,
    date_key: thread.dateKey,
    title: thread.title,
    messages: thread.messages,
    updated_at: thread.updatedAt,
  };
}

export function dashboardJournalRecordToThread(
  record: Partial<DashboardJournalThreadRecord>,
): DashboardJournalThread {
  const dateKey =
    typeof record.date_key === "string" && record.date_key
      ? record.date_key
      : getDashboardJournalDateKey();

  return normalizeDashboardJournalThread({
    id:
      typeof record.thread_key === "string" && record.thread_key
        ? record.thread_key
        : buildDashboardJournalThreadId(dateKey),
    dateKey,
    title: typeof record.title === "string" ? record.title : undefined,
    updatedAt: typeof record.updated_at === "string" ? record.updated_at : undefined,
    messages: Array.isArray(record.messages)
      ? normalizeDashboardJournalMessages(
          record.messages as Array<Partial<DashboardJournalMessage>>,
        )
      : [],
  });
}
