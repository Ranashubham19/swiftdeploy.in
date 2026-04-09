import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { isClawCloudMissingSchemaMessage } from "@/lib/clawcloud-schema-compat";
import type {
  ClawCloudAnswerBundle,
  ClawCloudModelAuditSelectedBy,
  ClawCloudModelAuditTrail,
} from "@/lib/types";

export type ClawCloudAnswerResponseState =
  | "answered"
  | "refused"
  | "consent_prompt"
  | "failed";

export type ClawCloudAnswerObservabilitySnapshot = {
  intent: string;
  category: string;
  latencyMs: number;
  charCount: number;
  hadVisibleFallback: boolean;
  liveAnswer: boolean;
  liveEvidenceCount: number;
  liveSourceCount: number;
  liveStrategy: string | null;
  modelAudited: boolean;
  selectedBy: ClawCloudModelAuditSelectedBy | null;
  selectedModel: string | null;
  judgeUsed: boolean;
  materialDisagreement: boolean;
  needsClarification: boolean;
  qualityFlags: string[];
};

export type ClawCloudAnswerObservabilitySummary = {
  windowDays: number;
  totalResponses: number;
  answeredCount: number;
  refusalCount: number;
  consentPromptCount: number;
  failedCount: number;
  fallbackCount: number;
  fallbackRate: number;
  liveAnswerCount: number;
  liveGroundedCount: number;
  liveGroundedRate: number;
  modelAuditedCount: number;
  modelAuditedRate: number;
  disagreementCount: number;
  disagreementRate: number;
  blockedGoodAnswerCount: number;
  blockedGoodAnswerRate: number;
  wrongLanguageCount: number;
  wrongLanguageRate: number;
  staleLiveAnswerCount: number;
  staleLiveAnswerRate: number;
  mediaGroundingFailureCount: number;
  mediaGroundingFailureRate: number;
  ambiguousContactCount: number;
  ambiguousContactRate: number;
  avgLatencyMs: number;
  topIntents: Array<{
    intent: string;
    count: number;
    fallbackRate: number;
    avgLatencyMs: number;
  }>;
};

type ClawCloudAnswerObservabilityRecord = {
  intent: string;
  response_state: ClawCloudAnswerResponseState;
  latency_ms: number | null;
  had_visible_fallback: boolean;
  live_answer?: boolean | null;
  live_evidence_count?: number | null;
  model_audited?: boolean | null;
  material_disagreement?: boolean | null;
  metadata?: {
    quality_flags?: unknown;
  } | null;
};

function trimPreview(value: string | null | undefined, limit = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeBoolean(value: unknown) {
  return value === true;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : 0;
}

function roundPercent(value: number) {
  return Number(value.toFixed(1));
}

function normalizeQualityFlags(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return [...new Set(
    value
      .map((item) => typeof item === "string" ? item.trim() : "")
      .filter(Boolean),
  )];
}

function deriveObservabilityQualityFlags(input: {
  category: string;
  hadVisibleFallback: boolean;
  responseText?: string | null;
  liveAnswerBundle?: ClawCloudAnswerBundle | null;
  modelAuditTrail?: ClawCloudModelAuditTrail | null;
}) {
  const flags = new Set<string>();
  const responseText = trimPreview(input.responseText, 4000).toLowerCase();

  if (input.hadVisibleFallback) {
    flags.add("visible_fallback");
  }

  if (
    input.modelAuditTrail
    && input.modelAuditTrail.selectedBy === "fallback"
    && input.modelAuditTrail.candidates.some((candidate) => candidate.status !== "failed")
  ) {
    flags.add("blocked_good_answer");
  }

  if (
    /\b(reply with the exact contact name|full number|option number|exact whatsapp contact|right chat)\b/i.test(responseText)
  ) {
    flags.add("ambiguous_contact");
  }

  if (
    /\b(image|video|voice note|audio|recording|document|pdf)\b/i.test(responseText)
    && /\b(?:couldn't|could not|can't|cannot|not enough|share a clearer|grounded|transcript)\b/i.test(responseText)
  ) {
    flags.add("media_grounding_failure");
  }

  if (
    !input.liveAnswerBundle
    && (
      /\b(?:couldn't verify|could not verify|not enough reliable information|latest reliable|current data|fresh sources)\b/i.test(responseText)
      || (
        /\b(?:latest|current|today|right now)\b/i.test(responseText)
        && /\b(?:cannot|couldn't|could not|unable)\b/i.test(responseText)
      )
    )
  ) {
    flags.add("stale_live_answer");
  }

  if (/\b(?:reply only in|wrong language|rewrite your entire reply)\b/i.test(responseText)) {
    flags.add("wrong_language");
  }

  return [...flags];
}

export function looksLikeClawCloudRefusal(response: string | null | undefined) {
  const normalized = trimPreview(response, 400).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.includes("could not complete a reliable direct answer on that attempt")) {
    return false;
  }

  return (
    normalized.startsWith("i couldn't")
    || normalized.startsWith("i could not")
    || normalized.startsWith("i can't")
    || normalized.startsWith("i cannot")
    || normalized.includes("i can't safely")
    || normalized.includes("i do not auto-send")
    || normalized.includes("i don't auto-send")
    || normalized.includes("not enough reliable information")
    || normalized.includes("couldn't verify")
    || normalized.includes("unable to verify")
    || normalized.includes("tell me the exact")
    || normalized.includes("please clarify")
  );
}

export function buildClawCloudAnswerObservabilitySnapshot(input: {
  intent: string;
  category: string;
  latencyMs: number;
  charCount: number;
  hadVisibleFallback: boolean;
  responseText?: string | null;
  liveAnswerBundle?: ClawCloudAnswerBundle | null;
  modelAuditTrail?: ClawCloudModelAuditTrail | null;
  qualityFlags?: string[];
}): ClawCloudAnswerObservabilitySnapshot {
  const liveAnswerBundle = input.liveAnswerBundle ?? null;
  const modelAuditTrail = input.modelAuditTrail ?? null;
  const liveEvidenceCount = liveAnswerBundle?.evidence.length ?? 0;
  const derivedQualityFlags = deriveObservabilityQualityFlags({
    category: input.category,
    hadVisibleFallback: input.hadVisibleFallback,
    responseText: input.responseText,
    liveAnswerBundle,
    modelAuditTrail,
  });

  return {
    intent: input.intent.trim() || "general",
    category: input.category.trim() || "general",
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    charCount: Math.max(0, Math.round(input.charCount)),
    hadVisibleFallback: input.hadVisibleFallback,
    liveAnswer: Boolean(liveAnswerBundle),
    liveEvidenceCount,
    liveSourceCount: liveAnswerBundle?.sourceSummary.length ?? 0,
    liveStrategy:
      typeof liveAnswerBundle?.metadata?.strategy === "string"
        ? liveAnswerBundle.metadata.strategy
        : null,
    modelAudited: Boolean(modelAuditTrail),
    selectedBy: modelAuditTrail?.selectedBy ?? null,
    selectedModel: modelAuditTrail?.selectedModel ?? null,
    judgeUsed: Boolean(modelAuditTrail?.judge?.used),
    materialDisagreement: Boolean(modelAuditTrail?.judge?.materialDisagreement),
    needsClarification: Boolean(modelAuditTrail?.judge?.needsClarification),
    qualityFlags: [...new Set([...(input.qualityFlags ?? []), ...derivedQualityFlags])],
  };
}

export function summarizeClawCloudAnswerObservabilityRecords(
  records: ClawCloudAnswerObservabilityRecord[],
  windowDays = 7,
): ClawCloudAnswerObservabilitySummary {
  const totalResponses = records.length;
  const answeredCount = records.filter((record) => record.response_state === "answered").length;
  const refusalCount = records.filter((record) => record.response_state === "refused").length;
  const consentPromptCount = records.filter((record) => record.response_state === "consent_prompt").length;
  const failedCount = records.filter((record) => record.response_state === "failed").length;
  const fallbackCount = records.filter((record) => record.had_visible_fallback).length;

  const liveAnswerCount = records.filter((record) => normalizeBoolean(record.live_answer)).length;
  const liveGroundedCount = records.filter((record) =>
    normalizeBoolean(record.live_answer)
    && normalizeNumber(record.live_evidence_count) > 0,
  ).length;
  const modelAuditedCount = records.filter((record) => normalizeBoolean(record.model_audited)).length;
  const disagreementCount = records.filter((record) => normalizeBoolean(record.material_disagreement)).length;
  const blockedGoodAnswerCount = records.filter((record) =>
    normalizeQualityFlags(record.metadata?.quality_flags).includes("blocked_good_answer"),
  ).length;
  const wrongLanguageCount = records.filter((record) =>
    normalizeQualityFlags(record.metadata?.quality_flags).includes("wrong_language"),
  ).length;
  const staleLiveAnswerCount = records.filter((record) =>
    normalizeQualityFlags(record.metadata?.quality_flags).includes("stale_live_answer"),
  ).length;
  const mediaGroundingFailureCount = records.filter((record) =>
    normalizeQualityFlags(record.metadata?.quality_flags).includes("media_grounding_failure"),
  ).length;
  const ambiguousContactCount = records.filter((record) =>
    normalizeQualityFlags(record.metadata?.quality_flags).includes("ambiguous_contact"),
  ).length;
  const avgLatencyMs = totalResponses
    ? Math.round(
      records.reduce((sum, record) => sum + normalizeNumber(record.latency_ms), 0)
      / totalResponses,
    )
    : 0;

  const intentMap = new Map<string, {
    count: number;
    fallbackCount: number;
    latencyTotal: number;
  }>();
  for (const record of records) {
    const intent = record.intent?.trim() || "general";
    const current = intentMap.get(intent) ?? { count: 0, fallbackCount: 0, latencyTotal: 0 };
    current.count += 1;
    current.fallbackCount += record.had_visible_fallback ? 1 : 0;
    current.latencyTotal += normalizeNumber(record.latency_ms);
    intentMap.set(intent, current);
  }

  const topIntents = [...intentMap.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([intent, stats]) => ({
      intent,
      count: stats.count,
      fallbackRate: stats.count ? roundPercent((stats.fallbackCount / stats.count) * 100) : 0,
      avgLatencyMs: stats.count ? Math.round(stats.latencyTotal / stats.count) : 0,
    }));

  return {
    windowDays,
    totalResponses,
    answeredCount,
    refusalCount,
    consentPromptCount,
    failedCount,
    fallbackCount,
    fallbackRate: totalResponses ? roundPercent((fallbackCount / totalResponses) * 100) : 0,
    liveAnswerCount,
    liveGroundedCount,
    liveGroundedRate: liveAnswerCount ? roundPercent((liveGroundedCount / liveAnswerCount) * 100) : 0,
    modelAuditedCount,
    modelAuditedRate: totalResponses ? roundPercent((modelAuditedCount / totalResponses) * 100) : 0,
    disagreementCount,
    disagreementRate: modelAuditedCount ? roundPercent((disagreementCount / modelAuditedCount) * 100) : 0,
    blockedGoodAnswerCount,
    blockedGoodAnswerRate: totalResponses ? roundPercent((blockedGoodAnswerCount / totalResponses) * 100) : 0,
    wrongLanguageCount,
    wrongLanguageRate: totalResponses ? roundPercent((wrongLanguageCount / totalResponses) * 100) : 0,
    staleLiveAnswerCount,
    staleLiveAnswerRate: totalResponses ? roundPercent((staleLiveAnswerCount / totalResponses) * 100) : 0,
    mediaGroundingFailureCount,
    mediaGroundingFailureRate: totalResponses ? roundPercent((mediaGroundingFailureCount / totalResponses) * 100) : 0,
    ambiguousContactCount,
    ambiguousContactRate: totalResponses ? roundPercent((ambiguousContactCount / totalResponses) * 100) : 0,
    avgLatencyMs,
    topIntents,
  };
}

export async function recordClawCloudAnswerObservability(input: {
  userId: string;
  question: string;
  response: string | null;
  inputKind: string;
  consentPrompt?: boolean;
  metadata?: Record<string, unknown> | null;
  snapshot?: ClawCloudAnswerObservabilitySnapshot | null;
}) {
  const response = trimPreview(input.response, 4000);
  const snapshot = input.snapshot ?? null;
  const responseState: ClawCloudAnswerResponseState = input.consentPrompt
    ? "consent_prompt"
    : !response
      ? "failed"
      : looksLikeClawCloudRefusal(response)
        ? "refused"
        : "answered";

  const payload = {
    user_id: input.userId,
    input_kind: input.inputKind.trim() || "api_inbound_message",
    question_preview: trimPreview(input.question, 240),
    response_preview: response,
    intent: snapshot?.intent ?? "general",
    category: snapshot?.category ?? "general",
    response_state: responseState,
    latency_ms: snapshot?.latencyMs ?? null,
    char_count: snapshot?.charCount ?? response.length,
    had_visible_fallback: snapshot?.hadVisibleFallback ?? false,
    live_answer: snapshot?.liveAnswer ?? false,
    live_evidence_count: snapshot?.liveEvidenceCount ?? 0,
    live_source_count: snapshot?.liveSourceCount ?? 0,
    live_strategy: snapshot?.liveStrategy ?? null,
    model_audited: snapshot?.modelAudited ?? false,
    selected_by: snapshot?.selectedBy ?? null,
    selected_model: snapshot?.selectedModel ?? null,
    judge_used: snapshot?.judgeUsed ?? false,
    material_disagreement: snapshot?.materialDisagreement ?? false,
    needs_clarification: snapshot?.needsClarification ?? false,
    metadata: {
      ...(input.metadata ?? {}),
      quality_flags: snapshot?.qualityFlags ?? [],
    },
  };

  try {
    await getClawCloudSupabaseAdmin()
      .from("answer_observability_events")
      .insert(payload);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (isClawCloudMissingSchemaMessage(message)) {
      return false;
    }
    throw error;
  }
}

export async function getClawCloudAnswerObservabilitySummary(userId: string, windowDays = 7) {
  const days = Math.min(Math.max(windowDays, 1), 30);
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const { data, error } = await getClawCloudSupabaseAdmin()
      .from("answer_observability_events")
      .select([
        "intent",
        "response_state",
        "latency_ms",
        "had_visible_fallback",
        "live_answer",
        "live_evidence_count",
        "model_audited",
        "material_disagreement",
        "metadata",
      ].join(","))
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      throw new Error(error.message);
    }

    return summarizeClawCloudAnswerObservabilityRecords(
      ((data ?? []) as ClawCloudAnswerObservabilityRecord[]),
      days,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (isClawCloudMissingSchemaMessage(message)) {
      return summarizeClawCloudAnswerObservabilityRecords([], days);
    }
    throw error;
  }
}
