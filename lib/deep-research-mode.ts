// lib/deep-research-mode.ts
// ─────────────────────────────────────────────────────────────────────────────
// DEEP RESEARCH MODE
// Like Perplexity Pro Search — but better. Goes 5x deeper:
//   - 10+ search queries (vs standard 3–5)
//   - 15+ sources (vs standard 8)
//   - Multi-angle query strategies
//   - Fact cross-verification
//   - Structured research report with executive summary
//   - Confidence scoring per section
//   - Source diversity enforcement
// ─────────────────────────────────────────────────────────────────────────────

import { expandQuery } from "./smart-query-engine";
import { buildCoTPlan } from "./chain-of-thought";
import { scoreAnswerConfidence } from "./confidence-scorer";
import type { ResearchSource } from "./types";

export interface DeepResearchConfig {
  maxSources: number;
  maxQueries: number;
  requireDiverseDomains: boolean;
  enableFactCrossCheck: boolean;
  enableExpertAnalysis: boolean;
  depthLevel: "standard" | "deep" | "ultra";
}

export const DEEP_RESEARCH_CONFIGS: Record<DeepResearchConfig["depthLevel"], DeepResearchConfig> = {
  standard: {
    maxSources: 8,
    maxQueries: 4,
    requireDiverseDomains: false,
    enableFactCrossCheck: false,
    enableExpertAnalysis: false,
    depthLevel: "standard",
  },
  deep: {
    maxSources: 15,
    maxQueries: 8,
    requireDiverseDomains: true,
    enableFactCrossCheck: true,
    enableExpertAnalysis: true,
    depthLevel: "deep",
  },
  ultra: {
    maxSources: 25,
    maxQueries: 15,
    requireDiverseDomains: true,
    enableFactCrossCheck: true,
    enableExpertAnalysis: true,
    depthLevel: "ultra",
  },
};

// ─── Multi-angle query builder ────────────────────────────────────────────────

export function buildDeepResearchQueries(
  question: string,
  config: DeepResearchConfig,
): string[] {
  const expansion = expandQuery(question);
  const queries: string[] = expansion.queries.map((q) => q.query);
  const year = new Date().getFullYear();

  // Add angle-specific variants
  const angles = [
    // Academic/research angle
    `${question} research academic ${year}`,
    `${question} study findings evidence`,

    // Expert opinion angle
    `${question} expert analysis opinion`,
    `${question} what experts say`,

    // Data/statistics angle
    `${question} statistics data ${year}`,
    `${question} numbers metrics report`,

    // Counterpoint angle (for balanced analysis)
    `${question} criticism concerns drawbacks`,
    `against ${question} problems issues`,

    // Primary sources
    `${question} official report government`,
    `${question} white paper industry report`,

    // Recent developments
    `${question} latest news ${year}`,
    `${question} recent update development`,

    // India-specific (if relevant)
    `${question} India context`,
    `${question} Indian perspective`,
  ];

  const allQueries = [...queries, ...angles];

  // Deduplicate and return up to maxQueries
  const seen = new Set<string>();
  return allQueries
    .filter((q) => {
      const key = q.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return q.length > 5;
    })
    .slice(0, config.maxQueries);
}

// ─── Source diversity enforcer ────────────────────────────────────────────────

export function enforceSourceDiversity(
  sources: ResearchSource[],
  maxSources: number,
): ResearchSource[] {
  if (!sources.length) return [];

  // Group by domain
  const byDomain = new Map<string, ResearchSource[]>();
  for (const source of sources) {
    const domain = source.domain ?? "unknown";
    const group = byDomain.get(domain) ?? [];
    group.push(source);
    byDomain.set(domain, group);
  }

  // Take max 2 per domain, prioritizing by score
  const diversified: ResearchSource[] = [];
  const domains = [...byDomain.keys()].sort(() => Math.random() - 0.5); // Shuffle for variety

  // First pass: take the best source from each domain
  for (const domain of domains) {
    const domainSources = (byDomain.get(domain) ?? []).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    if (domainSources[0]) diversified.push(domainSources[0]);
    if (diversified.length >= maxSources) break;
  }

  // Second pass: fill remaining slots with second-best from each domain
  if (diversified.length < maxSources) {
    for (const domain of domains) {
      const domainSources = (byDomain.get(domain) ?? []).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      if (domainSources[1] && !diversified.includes(domainSources[1])) {
        diversified.push(domainSources[1]);
      }
      if (diversified.length >= maxSources) break;
    }
  }

  return diversified.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// ─── Fact cross-checker ───────────────────────────────────────────────────────

export interface CrossCheckResult {
  claim: string;
  agreementCount: number;
  disagreementCount: number;
  confidence: number;
  status: "confirmed" | "contested" | "unverified";
}

export function crossCheckClaims(
  claims: string[],
  sources: ResearchSource[],
): CrossCheckResult[] {
  return claims.map((claim) => {
    const claimWords = claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4);

    const supporting = sources.filter((source) => {
      const snippetWords = (source.snippet ?? "").toLowerCase().split(/\s+/);
      const overlap = claimWords.filter((w) => snippetWords.some((sw) => sw.includes(w)));
      return overlap.length >= Math.ceil(claimWords.length * 0.3);
    });

    const agreementCount = supporting.length;
    const confidence = Math.min(agreementCount / 3, 1.0);
    const status =
      agreementCount >= 2 ? "confirmed" : agreementCount >= 1 ? "unverified" : "unverified";

    return {
      claim,
      agreementCount,
      disagreementCount: 0, // Would require NLP contradiction detection in production
      confidence,
      status,
    };
  });
}

// ─── Deep research system prompt ──────────────────────────────────────────────

export function buildDeepResearchSystemPrompt(
  question: string,
  config: DeepResearchConfig,
): string {
  const depthLabel = {
    standard: "Standard Research",
    deep: "Deep Research",
    ultra: "Ultra-Deep Research",
  }[config.depthLevel];

  return `You are operating in *${depthLabel} Mode* — the most thorough analysis mode available.

━━━ DEEP RESEARCH MANDATE ━━━

Your task is to produce a comprehensive research report that:
1. Answers the question with expert authority
2. Backs every major claim with specific source evidence
3. Presents multiple perspectives (not just the consensus view)
4. Notes contradictions and uncertainties explicitly
5. Ends with a decision-ready recommendation

━━━ REPORT STRUCTURE ━━━

## Executive Summary
2–3 sentences. The main finding and its implication.

## Key Findings (${config.depthLevel === "ultra" ? "6–8" : "4–6"} bullets)
Most important discoveries from the research.

## Detailed Analysis
${config.depthLevel === "standard" ? "2–3 sections" : config.depthLevel === "deep" ? "4–5 sections" : "6–8 sections"}, each with:
- Clear section heading
- Evidence-grounded analysis
- Inline source references

## ${config.enableFactCrossCheck ? "Fact Verification\nKey claims checked against multiple sources.\n\n## " : ""}Limitations & Caveats
What we don't know. What might have changed. What additional research would reveal.

## Recommendation
Direct, specific, actionable. "Do X if Y. Avoid X if Z."

━━━ QUALITY STANDARDS ━━━
- Every major claim must be evidence-backed
- Distinguish "confirmed by multiple sources" from "single-source claim"
- Quantify where possible: %, ₹, times, years — not vague "many" or "most"
- Note when evidence quality is weak
- Write for a decision-maker, not an academic`;
}

// ─── Progress labels for deep research ───────────────────────────────────────

export function getDeepResearchProgressLabels(config: DeepResearchConfig): string[] {
  const labels: string[] = [
    "Memory & context preparation",
    "Query classification & expansion",
  ];

  if (config.maxQueries > 5) {
    labels.push(`Launching ${config.maxQueries}-query parallel search`);
  } else {
    labels.push(`Searching ${config.maxQueries} query variants`);
  }

  labels.push(`Crawling up to ${config.maxSources} sources`);

  if (config.requireDiverseDomains) {
    labels.push("Enforcing source diversity across domains");
  }

  labels.push("Chunking & embedding evidence");
  labels.push("Retrieving & reranking top evidence");

  if (config.enableFactCrossCheck) {
    labels.push("Cross-checking key claims across sources");
  }

  if (config.enableExpertAnalysis) {
    labels.push("Expert synthesis & report generation");
  }

  labels.push("Finalizing structured report with citations");

  return labels;
}

// ─── Deep research detector ───────────────────────────────────────────────────

export function shouldUseDeepResearch(question: string): DeepResearchConfig["depthLevel"] {
  const q = question.toLowerCase();

  const ultraSignals = [
    /\b(comprehensive report|full analysis|deep dive|complete guide|everything about|in-depth study)\b/,
    /\b(market research|competitive analysis|investment thesis|due diligence)\b/,
  ];

  const deepSignals = [
    /\b(research|analyze|analysis|compare|comparison|evaluate|assessment|review|overview)\b/,
    /\b(pros and cons|advantages disadvantages|should i|best way to|how to choose)\b/,
    /\b(why|explain|how does|what causes|impact of|effect of)\b/,
    question.length > 100, // Long questions usually need deeper research
  ];

  if (ultraSignals.some((r) => r.test(q))) return "ultra";
  if (deepSignals.some((r) => (typeof r === "boolean" ? r : r.test(q)))) return "deep";
  return "standard";
}
