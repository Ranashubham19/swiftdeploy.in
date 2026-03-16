// lib/answer-enricher.ts
// ─────────────────────────────────────────────────────────────────────────────
// ANSWER ENRICHMENT ENGINE
// Adds intelligence layers that ChatGPT/Claude/Gemini don't show:
//  - Confidence scoring with dimensional breakdown
//  - Source quality metrics
//  - Smart follow-up generation
//  - Answer freshness indicators
//  - Reasoning trace (chain-of-thought summary)
//  - Format detection and optimization
// ─────────────────────────────────────────────────────────────────────────────

import { scoreAnswerConfidence, type ConfidenceScore } from "./confidence-scorer";
import { buildCoTPlan, type CoTReasoning } from "./chain-of-thought";
import {
  detectAdvancedFormat,
  type AdvancedAnswerFormat,
  buildComparisonFormat,
  buildProsConsFormat,
  buildHowToFormat,
  buildTimelineMetadata,
  buildFactCheckFormat,
} from "./advanced-formats";
import { expandQuery, generateSmartFollowUps, detectDomain, type QueryDomain } from "./smart-query-engine";
import type { ResearchSource } from "./types";

// ─── Enriched answer metadata ─────────────────────────────────────────────────

export interface AnswerMetadata {
  confidence: ConfidenceScore;
  cot?: CoTReasoning;             // Chain-of-thought (for complex questions)
  advancedFormat?: AdvancedAnswerFormat;
  formatMetadata?: Record<string, unknown>;
  smartFollowUps: string[];
  sourceQuality: SourceQualitySummary;
  processingStats: ProcessingStats;
  freshness: FreshnessIndicator;
}

export interface SourceQualitySummary {
  totalSources: number;
  highAuthoritySources: number;
  averageRelevanceScore: number;
  providersUsed: string[];
  newestSourceDate?: string;
  oldestSourceDate?: string;
  coverageRating: "excellent" | "good" | "moderate" | "limited" | "none";
}

export interface ProcessingStats {
  searchQueriesRun: number;
  documentsAnalyzed: number;
  chunksIndexed: number;
  modelsUsed: string[];
  totalMs?: number;
  pipeline: string; // e.g. "search → crawl → embed → rerank → reason"
}

export interface FreshnessIndicator {
  status: "live" | "recent" | "current" | "dated" | "historical" | "timeless";
  label: string;
  explanation: string;
}

// ─── Source quality analyzer ─────────────────────────────────────────────────

const HIGH_AUTHORITY_PATTERNS = [
  /\.(gov|edu|ac\.\w+)\//,
  /\b(nature\.com|science\.org|nejm\.org|pubmed|who\.int|cdc\.gov|nih\.gov)\b/,
  /\b(reuters\.com|apnews\.com|bbc\.(com|co\.uk)|nytimes\.com)\b/,
  /\b(techcrunch\.com|wired\.com|arstechnica\.com)\b/,
  /\b(investopedia\.com|bloomberg\.com|ft\.com)\b/,
];

function analyzeSourceQuality(sources: ResearchSource[]): SourceQualitySummary {
  if (!sources.length) {
    return {
      totalSources: 0,
      highAuthoritySources: 0,
      averageRelevanceScore: 0,
      providersUsed: [],
      coverageRating: "none",
    };
  }

  const highAuthority = sources.filter((s) =>
    HIGH_AUTHORITY_PATTERNS.some((p) => p.test(s.url ?? "") || p.test(s.domain ?? "")),
  );

  const avgScore =
    sources.reduce((sum, s) => sum + (s.score ?? 0.5), 0) / sources.length;

  const providers = [...new Set(sources.map((s) => s.provider))];

  const dates = sources
    .filter((s) => s.publishedDate)
    .map((s) => new Date(s.publishedDate!).getTime())
    .sort((a, b) => b - a);

  const coverage =
    sources.length >= 8 && avgScore > 0.7
      ? "excellent"
      : sources.length >= 5 && avgScore > 0.6
        ? "good"
        : sources.length >= 3
          ? "moderate"
          : sources.length >= 1
            ? "limited"
            : "none";

  return {
    totalSources: sources.length,
    highAuthoritySources: highAuthority.length,
    averageRelevanceScore: Math.round(avgScore * 100) / 100,
    providersUsed: providers,
    newestSourceDate: dates.length ? new Date(dates[0]).toLocaleDateString() : undefined,
    oldestSourceDate: dates.length ? new Date(dates[dates.length - 1]).toLocaleDateString() : undefined,
    coverageRating: coverage,
  };
}

// ─── Freshness indicator ──────────────────────────────────────────────────────

function computeFreshness(
  question: string,
  sources: ResearchSource[],
): FreshnessIndicator {
  const q = question.toLowerCase();

  // Timeless topics
  if (/\b(math|formula|theorem|definition|how to code|history of|ancient|what is|who was)\b/.test(q)) {
    return {
      status: "timeless",
      label: "Timeless",
      explanation: "This topic doesn't change — knowledge is stable.",
    };
  }

  const datedSources = sources.filter((s) => s.publishedDate);
  if (!datedSources.length) {
    return {
      status: "current",
      label: "Current",
      explanation: "Answer based on model knowledge — verify time-sensitive claims.",
    };
  }

  const newest = Math.max(...datedSources.map((s) => new Date(s.publishedDate!).getTime()));
  const daysOld = (Date.now() - newest) / (1000 * 60 * 60 * 24);

  if (daysOld <= 1) return { status: "live", label: "Live", explanation: "Sources published within the last 24 hours." };
  if (daysOld <= 7) return { status: "recent", label: "Recent", explanation: "Sources from the last 7 days." };
  if (daysOld <= 30) return { status: "current", label: "Current", explanation: "Sources from the last 30 days." };
  if (daysOld <= 180) return { status: "dated", label: "May be dated", explanation: "Newest source is over a month old — verify freshness." };
  return { status: "historical", label: "Historical", explanation: "Sources are over 6 months old — check for updates." };
}

// ─── Smart follow-up generator ────────────────────────────────────────────────

function generateFollowUps(
  question: string,
  format: AdvancedAnswerFormat | null,
  domain: QueryDomain,
  entities: string[],
  existingFollowUps: string[] = [],
): string[] {
  // Start with smart domain-based follow-ups
  const smartFollowUps = generateSmartFollowUps(question, domain, entities);

  // Format-specific follow-ups
  const formatFollowUps: Partial<Record<AdvancedAnswerFormat, string[]>> = {
    comparison: [
      "Can you make a side-by-side comparison table?",
      "Which option is better for long-term use?",
      "What do users say about each?",
    ],
    timeline: [
      "What were the key turning points?",
      "Who drove these changes?",
      "What comes next?",
    ],
    pros_cons: [
      "What do critics say about this?",
      "Are there any hidden downsides?",
      "What's the expert consensus?",
    ],
    how_to: [
      "What are the most common mistakes?",
      "Can you show a real-world example?",
      "How do I automate this?",
    ],
    fact_check: [
      "What's the original source of this claim?",
      "Are there related myths to debunk?",
      "What do scientific experts say?",
    ],
  };

  const allFollowUps = [
    ...smartFollowUps,
    ...(format && formatFollowUps[format] ? formatFollowUps[format]! : []),
    ...existingFollowUps,
  ];

  // Deduplicate and return top 4
  const seen = new Set<string>();
  return allFollowUps
    .filter((f) => {
      const key = f.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return f.length > 10;
    })
    .slice(0, 4);
}

// ─── Main enrichment function ─────────────────────────────────────────────────

export interface EnrichmentInput {
  question: string;
  sources: ResearchSource[];
  retrievedChunks?: number;
  queryType?: string;
  modelsUsed?: string[];
  searchQueriesRun?: number;
  documentsAnalyzed?: number;
  chunksIndexed?: number;
  totalMs?: number;
  pipeline?: string;
  existingFollowUps?: string[];
  modelTier?: "fast" | "chat" | "reasoning" | "code";
  includeCoT?: boolean;
}

export function enrichAnswer(input: EnrichmentInput): AnswerMetadata {
  const {
    question,
    sources,
    retrievedChunks = 0,
    queryType,
    modelsUsed = [],
    searchQueriesRun = 0,
    documentsAnalyzed = 0,
    chunksIndexed = 0,
    totalMs,
    pipeline = "chat",
    existingFollowUps = [],
    modelTier,
    includeCoT = false,
  } = input;

  // Detect domain and entities
  const expanded = expandQuery(question);
  const domain = detectDomain(question) as QueryDomain;

  // Score confidence
  const confidence = scoreAnswerConfidence({
    sources,
    retrievedChunks,
    queryType,
    hasRealtimeData: sources.some((s) => s.publishedDate && Date.now() - new Date(s.publishedDate).getTime() < 86400000),
    modelTier,
  });

  // Detect advanced format
  const advancedFormat = detectAdvancedFormat(question);

  // Build format metadata
  let formatMetadata: Record<string, unknown> | undefined;
  if (advancedFormat) {
    const entities = expanded.entityHints;
    switch (advancedFormat) {
      case "comparison":
        formatMetadata = buildComparisonFormat(question, entities.length >= 2 ? entities.slice(0, 2) : [question, "alternatives"]);
        break;
      case "pros_cons":
        formatMetadata = buildProsConsFormat(entities[0] ?? question.replace(/^pros and cons of /i, ""));
        break;
      case "how_to":
        formatMetadata = buildHowToFormat(question);
        break;
      case "timeline":
        formatMetadata = buildTimelineMetadata(question);
        break;
      case "fact_check":
        formatMetadata = buildFactCheckFormat(question);
        break;
    }
  }

  // Build chain-of-thought (for complex questions)
  const cot: CoTReasoning | undefined =
    includeCoT
      ? buildCoTPlan(question, {
          hasRealtimeData: sources.length > 0 && sources.some((s) => s.publishedDate),
          sourceCount: sources.length,
          queryType,
        })
      : undefined;

  // Source quality
  const sourceQuality = analyzeSourceQuality(sources);

  // Freshness
  const freshness = computeFreshness(question, sources);

  // Smart follow-ups
  const smartFollowUps = generateFollowUps(
    question,
    advancedFormat,
    domain,
    expanded.entityHints,
    existingFollowUps,
  );

  // Processing stats
  const processingStats: ProcessingStats = {
    searchQueriesRun,
    documentsAnalyzed,
    chunksIndexed,
    modelsUsed,
    totalMs,
    pipeline,
  };

  return {
    confidence,
    cot,
    advancedFormat: advancedFormat ?? undefined,
    formatMetadata,
    smartFollowUps,
    sourceQuality,
    processingStats,
    freshness,
  };
}

// ─── Metadata → progress step ────────────────────────────────────────────────

export function metadataToProgressLabel(metadata: AnswerMetadata): string {
  const { confidence, sourceQuality, freshness, advancedFormat } = metadata;

  const parts: string[] = [
    `${confidence.badge.emoji} ${confidence.badge.label}`,
    `${sourceQuality.totalSources} sources`,
    freshness.label,
  ];

  if (advancedFormat) {
    parts.push(`${advancedFormat.replace("_", " ")} format`);
  }

  return parts.join(" · ");
}

// ─── Confidence pill HTML (for UI injection) ──────────────────────────────────

export function renderConfidencePill(confidence: ConfidenceScore): string {
  const { badge, overall } = confidence;
  const pct = Math.round(overall * 100);
  return `<span class="${badge.colorClass} inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border">${badge.emoji} ${badge.label} ${pct}%</span>`;
}
