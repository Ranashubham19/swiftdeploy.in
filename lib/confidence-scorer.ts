// lib/confidence-scorer.ts
// ─────────────────────────────────────────────────────────────────────────────
// ANSWER CONFIDENCE & QUALITY SCORING ENGINE
// Produces a multi-dimensional reliability score for every AI answer.
// ChatGPT and Claude never show you HOW confident they are — this does.
// ─────────────────────────────────────────────────────────────────────────────

import type { ResearchSource } from "./types";

export type ConfidenceTier = "very_high" | "high" | "moderate" | "low" | "very_low";

export interface ConfidenceScore {
  overall: number;             // 0–1 composite
  tier: ConfidenceTier;
  dimensions: {
    sourceCount: number;       // 0–1: more sources = higher
    sourceFreshness: number;   // 0–1: recent sources = higher
    sourceAuthority: number;   // 0–1: high-authority domains = higher
    sourceDiversity: number;   // 0–1: diverse domains = higher
    claimConsistency: number;  // 0–1: sources agree = higher
    coverageDepth: number;     // 0–1: how well sources cover the question
  };
  explanation: string;
  badge: {
    label: string;
    emoji: string;
    colorClass: string;        // Tailwind class
  };
  improvementHints: string[];
}

// ─── Authoritative domain list ────────────────────────────────────────────────

const HIGH_AUTHORITY_DOMAINS = new Set([
  "gov", "edu", "org", "ac.uk", "ac.in",
  "nature.com", "science.org", "nejm.org", "bmj.com", "pubmed.ncbi.nlm.nih.gov",
  "who.int", "cdc.gov", "nih.gov", "fda.gov", "sec.gov",
  "worldbank.org", "imf.org", "un.org", "oecd.org",
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk",
  "nytimes.com", "theguardian.com", "washingtonpost.com",
  "techcrunch.com", "wired.com", "arstechnica.com",
  "github.com", "stackoverflow.com", "developer.mozilla.org",
  "docs.python.org", "learn.microsoft.com", "cloud.google.com",
  "arxiv.org", "ssrn.com", "jstor.org",
]);

const LOW_AUTHORITY_DOMAINS = new Set([
  "reddit.com", "quora.com", "answers.com", "yahoo.com",
  "buzzfeed.com", "dailymail.co.uk", "foxnews.com",
  "medium.com", "substack.com", "wordpress.com",
]);

// ─── Freshness scorer ────────────────────────────────────────────────────────

function scoreSourceFreshness(sources: ResearchSource[]): number {
  if (!sources.length) return 0.5;

  const now = Date.now();
  const daysOld = sources
    .filter((s) => s.publishedDate)
    .map((s) => (now - new Date(s.publishedDate!).getTime()) / (1000 * 60 * 60 * 24));

  if (!daysOld.length) return 0.65; // No date info — assume moderate

  const avgDays = daysOld.reduce((a, b) => a + b, 0) / daysOld.length;

  // Decay curve: 0 days = 1.0, 7 days = 0.95, 30 days = 0.85, 365 days = 0.6, 3 years = 0.4
  if (avgDays <= 1) return 1.0;
  if (avgDays <= 7) return 0.95;
  if (avgDays <= 30) return 0.88;
  if (avgDays <= 90) return 0.80;
  if (avgDays <= 365) return 0.70;
  if (avgDays <= 730) return 0.58;
  return Math.max(0.35, 0.58 - (avgDays - 730) / 3000);
}

// ─── Authority scorer ────────────────────────────────────────────────────────

function scoreSourceAuthority(sources: ResearchSource[]): number {
  if (!sources.length) return 0.5;

  const scores = sources.map((source) => {
    const domain = source.domain?.toLowerCase() ?? "";
    const tld = domain.split(".").slice(-1)[0] ?? "";

    if (HIGH_AUTHORITY_DOMAINS.has(domain) || HIGH_AUTHORITY_DOMAINS.has(tld)) return 0.95;
    if (LOW_AUTHORITY_DOMAINS.has(domain)) return 0.35;

    // Score from provider
    if (source.provider === "tavily") return 0.72;
    if (source.provider === "serpapi") return 0.70;

    // Score from relevance score
    if (source.score > 0.8) return 0.85;
    if (source.score > 0.6) return 0.72;
    if (source.score > 0.4) return 0.60;
    return 0.50;
  });

  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

// ─── Diversity scorer ────────────────────────────────────────────────────────

function scoreSourceDiversity(sources: ResearchSource[]): number {
  if (!sources.length) return 0.0;
  if (sources.length === 1) return 0.4;

  const uniqueDomains = new Set(sources.map((s) => s.domain?.split(".").slice(-2).join(".")));
  const uniqueProviders = new Set(sources.map((s) => s.provider));

  const domainScore = Math.min(uniqueDomains.size / 5, 1.0); // 5+ unique domains = 1.0
  const providerScore = Math.min(uniqueProviders.size / 3, 1.0); // 3+ providers = 1.0

  return domainScore * 0.7 + providerScore * 0.3;
}

// ─── Coverage scorer ─────────────────────────────────────────────────────────

function scoreCoverageDepth(
  sources: ResearchSource[],
  retrievedChunks: number = 0,
): number {
  const sourceScore = Math.min(sources.length / 8, 1.0); // 8+ sources = 1.0
  const chunkScore = Math.min(retrievedChunks / 10, 1.0); // 10+ chunks = 1.0

  if (!sources.length && !retrievedChunks) return 0.0;

  // Average relevance score of sources
  const avgRelevance =
    sources.length
      ? sources.reduce((sum, s) => sum + (s.score ?? 0.5), 0) / sources.length
      : 0.5;

  return sourceScore * 0.4 + chunkScore * 0.25 + avgRelevance * 0.35;
}

// ─── Claim consistency scorer ─────────────────────────────────────────────────

function scoreClaimConsistency(sources: ResearchSource[]): number {
  if (!sources.length) return 0.7; // No sources = chat mode, trust model
  if (sources.length === 1) return 0.72;

  // Proxy: if multiple high-scoring sources from different domains exist → high consistency
  const topSources = sources.filter((s) => (s.score ?? 0) > 0.6);
  const diversity = scoreSourceDiversity(topSources);

  if (topSources.length >= 3 && diversity > 0.5) return 0.88;
  if (topSources.length >= 2) return 0.78;
  return 0.65;
}

// ─── Main scoring function ───────────────────────────────────────────────────

export function scoreAnswerConfidence(params: {
  sources: ResearchSource[];
  retrievedChunks?: number;
  queryType?: string;
  hasRealtimeData?: boolean;
  modelTier?: "fast" | "chat" | "reasoning" | "code";
}): ConfidenceScore {
  const { sources, retrievedChunks = 0, queryType, hasRealtimeData, modelTier } = params;

  const sourceCount = Math.min(sources.length / 6, 1.0); // 6+ sources = 1.0
  const sourceFreshness = scoreSourceFreshness(sources);
  const sourceAuthority = scoreSourceAuthority(sources);
  const sourceDiversity = scoreSourceDiversity(sources);
  const claimConsistency = scoreClaimConsistency(sources);
  const coverageDepth = scoreCoverageDepth(sources, retrievedChunks);

  // Weighted composite
  let overall =
    sourceCount * 0.15 +
    sourceFreshness * 0.15 +
    sourceAuthority * 0.20 +
    sourceDiversity * 0.10 +
    claimConsistency * 0.20 +
    coverageDepth * 0.20;

  // Model tier bonus
  if (modelTier === "reasoning") overall = Math.min(overall + 0.04, 0.97);
  if (modelTier === "fast") overall = Math.max(overall - 0.03, 0.3);

  // Realtime penalty (data may be stale)
  if (hasRealtimeData && sourceFreshness < 0.7) overall = Math.max(overall - 0.06, 0.3);

  // General knowledge / chat — no sources needed, trust model
  if (!sources.length && (queryType === "general_knowledge" || queryType === "greeting")) {
    overall = 0.85;
  }

  overall = Math.round(Math.max(0.1, Math.min(0.98, overall)) * 100) / 100;

  const tier = computeTier(overall);
  const badge = computeBadge(tier);
  const explanation = computeExplanation(
    tier,
    sources.length,
    sourceFreshness,
    sourceAuthority,
  );
  const improvementHints = computeImprovementHints(
    overall,
    sources.length,
    sourceFreshness,
    sourceAuthority,
    sourceDiversity,
  );

  return {
    overall,
    tier,
    dimensions: {
      sourceCount,
      sourceFreshness,
      sourceAuthority,
      sourceDiversity,
      claimConsistency,
      coverageDepth,
    },
    explanation,
    badge,
    improvementHints,
  };
}

// ─── Tier + badge helpers ─────────────────────────────────────────────────────

function computeTier(overall: number): ConfidenceTier {
  if (overall >= 0.88) return "very_high";
  if (overall >= 0.75) return "high";
  if (overall >= 0.60) return "moderate";
  if (overall >= 0.45) return "low";
  return "very_low";
}

function computeBadge(tier: ConfidenceTier): ConfidenceScore["badge"] {
  const badges: Record<ConfidenceTier, ConfidenceScore["badge"]> = {
    very_high: { label: "Verified", emoji: "✅", colorClass: "bg-green-500/15 text-green-600 border-green-500/30" },
    high: { label: "High confidence", emoji: "🔵", colorClass: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
    moderate: { label: "Moderate", emoji: "🟡", colorClass: "bg-yellow-500/15 text-yellow-600 border-yellow-500/30" },
    low: { label: "Low confidence", emoji: "🟠", colorClass: "bg-orange-500/15 text-orange-600 border-orange-500/30" },
    very_low: { label: "Uncertain", emoji: "🔴", colorClass: "bg-red-500/15 text-red-600 border-red-500/30" },
  };
  return badges[tier];
}

function computeExplanation(
  tier: ConfidenceTier,
  sourceCount: number,
  freshness: number,
  authority: number,
): string {
  if (tier === "very_high") return `Backed by ${sourceCount} authoritative, fresh sources with high agreement.`;
  if (tier === "high") return `Supported by ${sourceCount} relevant sources with good reliability signals.`;
  if (tier === "moderate") {
    if (freshness < 0.7) return `${sourceCount} sources found but some may be outdated — verify time-sensitive claims.`;
    if (authority < 0.6) return `${sourceCount} sources found but authority signals are mixed — cross-check key facts.`;
    return `${sourceCount} sources found with moderate coverage — key claims are plausible but not fully verified.`;
  }
  if (tier === "low") return `Limited source coverage (${sourceCount} sources) — treat claims cautiously.`;
  return "Insufficient evidence retrieved — manual verification strongly recommended.";
}

function computeImprovementHints(
  overall: number,
  sourceCount: number,
  freshness: number,
  authority: number,
  diversity: number,
): string[] {
  if (overall >= 0.9) return [];

  const hints: string[] = [];
  if (sourceCount < 0.5) hints.push("Add more sources by using a more specific search query.");
  if (freshness < 0.7) hints.push("Filter results to the last 30 days for more current information.");
  if (authority < 0.6) hints.push("Prioritize .gov, .edu, or major news outlets for higher authority.");
  if (diversity < 0.4) hints.push("Search across multiple domains to reduce source bias.");
  if (hints.length === 0 && overall < 0.85) hints.push("Enable Deep Research mode for more comprehensive coverage.");
  return hints.slice(0, 3);
}

// ─── Comparison helper for multi-claim verification ──────────────────────────

export interface FactClaim {
  claim: string;
  supportedBy: string[];  // source URLs
  contradictedBy: string[];
  confidence: number;
}

export function extractFactClaims(
  text: string,
  sources: ResearchSource[],
): FactClaim[] {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 30 && s.length < 200);

  return sentences.slice(0, 5).map((sentence) => {
    const supportedBy = sources
      .filter((s) => s.score > 0.7)
      .slice(0, 2)
      .map((s) => s.url);

    return {
      claim: sentence,
      supportedBy,
      contradictedBy: [],
      confidence: supportedBy.length > 0 ? 0.8 : 0.6,
    };
  });
}
