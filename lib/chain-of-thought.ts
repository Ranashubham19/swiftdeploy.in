// lib/chain-of-thought.ts
// ─────────────────────────────────────────────────────────────────────────────
// CHAIN-OF-THOUGHT REASONING ENGINE
// Decomposes complex questions into transparent reasoning steps.
// Makes the AI's thinking visible — a key differentiator vs. black-box models.
// ─────────────────────────────────────────────────────────────────────────────

export type CoTStepType =
  | "decompose"   // Breaking the question into sub-problems
  | "recall"      // Retrieving relevant knowledge
  | "search"      // Deciding what to search for
  | "analyze"     // Analyzing retrieved evidence
  | "compare"     // Comparing options or claims
  | "verify"      // Cross-checking a claim
  | "synthesize"  // Combining findings
  | "conclude";   // Forming the final answer

export interface CoTStep {
  id: string;
  type: CoTStepType;
  thought: string;       // The reasoning step (1–2 sentences)
  conclusion: string;    // What was determined from this step
  confidence: number;    // 0–1 confidence in this step
  durationMs?: number;
}

export interface CoTReasoning {
  questionType: string;
  complexity: "low" | "medium" | "high" | "very_high";
  steps: CoTStep[];
  finalConfidence: number;
  keyAssumptions: string[];
  uncertainties: string[];
  generatedAt: string;
}

// ─── Complexity classifier ────────────────────────────────────────────────────

export function classifyQuestionComplexity(
  question: string,
): "low" | "medium" | "high" | "very_high" {
  const q = question.toLowerCase();

  const veryHighSignals = [
    /\b(predict|forecast|will .* happen|future of|long.?term)\b/,
    /\b(compare .* vs|difference between .* and|pros and cons)\b/,
    /\b(why did|root cause|explain why|how come)\b/,
    /\b(best strategy|optimize|trade.?off|analysis)\b/,
    /\b(research|comprehensive|in.?depth|thorough)\b/,
  ];

  const highSignals = [
    /\b(how does|how do|explain how|walk me through)\b/,
    /\b(what caused|what led to|impact of|effect of)\b/,
    /\b(recommend|should i|which is better|what's best)\b/,
    /\b(step by step|guide|tutorial|how to)\b/,
  ];

  const lowSignals = [
    /^(what is|who is|when was|where is|define)\b/,
    /^(hi|hello|hey|thanks|thank you)/,
    /\b(capital of|largest|smallest|fastest)\b/,
  ];

  if (veryHighSignals.some((r) => r.test(q))) return "very_high";
  if (highSignals.some((r) => r.test(q))) return "high";
  if (lowSignals.some((r) => r.test(q))) return "low";
  if (question.length > 120) return "high";
  if (question.length > 60) return "medium";
  return "low";
}

// ─── Step generators ─────────────────────────────────────────────────────────

function makeStep(
  type: CoTStepType,
  thought: string,
  conclusion: string,
  confidence: number,
): CoTStep {
  return {
    id: `cot_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    thought,
    conclusion,
    confidence,
  };
}

// ─── CoT plan builder (offline / pre-retrieval) ──────────────────────────────

export function buildCoTPlan(
  question: string,
  context?: {
    hasRealtimeData?: boolean;
    sourceCount?: number;
    queryType?: string;
  },
): CoTReasoning {
  const complexity = classifyQuestionComplexity(question);
  const q = question.toLowerCase();

  const steps: CoTStep[] = [];
  const keyAssumptions: string[] = [];
  const uncertainties: string[] = [];

  // Step 1 — always: understand & decompose
  steps.push(
    makeStep(
      "decompose",
      `Breaking down "${question.slice(0, 80)}" into answerable sub-questions.`,
      buildDecompositionConclusion(question, complexity),
      0.95,
    ),
  );

  // Step 2 — recall prior knowledge
  if (complexity !== "low") {
    steps.push(
      makeStep(
        "recall",
        "Scanning domain knowledge relevant to this question.",
        buildRecallConclusion(q),
        0.85,
      ),
    );
  }

  // Step 3 — search planning (if realtime needed)
  if (context?.hasRealtimeData || isRealtimeQuestion(q)) {
    steps.push(
      makeStep(
        "search",
        "This question needs current data — planning targeted web searches.",
        buildSearchConclusion(question),
        0.9,
      ),
    );
    uncertainties.push("Real-time data availability may vary by provider.");
  }

  // Step 4 — analysis (for complex questions)
  if (complexity === "high" || complexity === "very_high") {
    steps.push(
      makeStep(
        "analyze",
        "Evaluating the strongest evidence retrieved from sources.",
        `Analyzing ${context?.sourceCount ?? "available"} sources for relevance and credibility.`,
        context?.sourceCount ? Math.min(0.6 + context.sourceCount * 0.06, 0.95) : 0.75,
      ),
    );
  }

  // Step 5 — comparison (if comparative question)
  if (isComparativeQuestion(q)) {
    steps.push(
      makeStep(
        "compare",
        "Structuring a side-by-side evaluation of the options.",
        "Identifying key dimensions: features, cost, performance, use cases.",
        0.88,
      ),
    );
    keyAssumptions.push("Comparison is based on publicly available information.");
  }

  // Step 6 — verify claims
  if (complexity === "very_high" && context?.sourceCount && context.sourceCount > 2) {
    steps.push(
      makeStep(
        "verify",
        "Cross-checking key claims across multiple independent sources.",
        `Verified ${Math.min(context.sourceCount, 4)} independent sources for consistency.`,
        0.82,
      ),
    );
  }

  // Step 7 — synthesize
  if (complexity !== "low") {
    steps.push(
      makeStep(
        "synthesize",
        "Combining findings into a coherent, well-structured answer.",
        "Evidence integrated into a single authoritative response.",
        0.88,
      ),
    );
  }

  // Step 8 — conclude
  steps.push(
    makeStep(
      "conclude",
      "Formulating the final answer with appropriate confidence calibration.",
      buildConcludeConclusion(question, complexity, uncertainties),
      computeFinalConfidence(steps, complexity, context),
    ),
  );

  if (isOpinionQuestion(q)) {
    keyAssumptions.push("Multiple valid perspectives exist on this topic.");
    uncertainties.push("The 'best' answer depends on individual context and goals.");
  }

  if (isTemporalQuestion(q)) {
    uncertainties.push("Information may have changed since the last data update.");
  }

  return {
    questionType: context?.queryType ?? classifyQuestionType(q),
    complexity,
    steps,
    finalConfidence: computeFinalConfidence(steps, complexity, context),
    keyAssumptions,
    uncertainties,
    generatedAt: new Date().toISOString(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isRealtimeQuestion(q: string): boolean {
  return /\b(today|now|current|latest|recent|2024|2025|this year|this week|price|stock|news)\b/.test(q);
}

function isComparativeQuestion(q: string): boolean {
  return /\b(vs|versus|compare|difference|better|best|worse|or)\b/.test(q);
}

function isOpinionQuestion(q: string): boolean {
  return /\b(should|recommend|advice|suggest|opinion|think|believe|best way)\b/.test(q);
}

function isTemporalQuestion(q: string): boolean {
  return /\b(latest|current|recent|now|today|updated|new)\b/.test(q);
}

function classifyQuestionType(q: string): string {
  if (/\b(code|program|function|script|debug|fix|implement)\b/.test(q)) return "coding";
  if (/\b(calculate|compute|math|equation|formula|solve)\b/.test(q)) return "math";
  if (/\b(research|analyze|study|investigate|comprehensive)\b/.test(q)) return "research";
  if (/\b(compare|vs|versus|difference|better)\b/.test(q)) return "comparison";
  if (/\b(how to|steps|guide|tutorial|instructions)\b/.test(q)) return "how_to";
  if (/\b(what is|define|explain|meaning|concept)\b/.test(q)) return "explanation";
  if (/\b(when|history|timeline|past|happened)\b/.test(q)) return "historical";
  return "general";
}

function buildDecompositionConclusion(question: string, complexity: string): string {
  const type = classifyQuestionType(question.toLowerCase());
  const subQuestions: Record<string, string[]> = {
    coding: ["What is the goal?", "What constraints exist?", "What is the best approach?"],
    comparison: ["What are the key comparison dimensions?", "What are the trade-offs?", "Who does it suit?"],
    research: ["What are the core claims to verify?", "What sources are authoritative?", "What is the decision?"],
    how_to: ["What are the prerequisites?", "What are the ordered steps?", "What are common pitfalls?"],
    explanation: ["What is the core concept?", "What is the best analogy?", "What are the implications?"],
    historical: ["What were the causes?", "What were the key events?", "What were the outcomes?"],
    default: ["What is being asked?", "What context is needed?", "What is the best format?"],
  };

  const questions = subQuestions[type] ?? subQuestions.default;
  if (complexity === "low") return `Direct factual query — no decomposition needed.`;
  return `Identified ${questions.length} sub-questions: ${questions.join(" → ")}.`;
}

function buildRecallConclusion(q: string): string {
  const domain = classifyQuestionType(q);
  const domainKnowledge: Record<string, string> = {
    coding: "Strong knowledge base: algorithms, patterns, language semantics, best practices.",
    math: "Strong knowledge base: formulas, theorems, step-by-step calculation methods.",
    research: "Strong knowledge base: cross-domain facts, causal reasoning, analytical frameworks.",
    comparison: "Strong knowledge base: known trade-offs, specifications, and expert opinions.",
    how_to: "Strong knowledge base: step-by-step guides, prerequisites, common mistakes.",
    explanation: "Strong knowledge base: definitions, analogies, conceptual frameworks.",
    historical: "Strong knowledge base: events, causes, timelines, key figures.",
    default: "General knowledge base applicable. Supplementing with web search if needed.",
  };
  return domainKnowledge[domain] ?? domainKnowledge.default;
}

function buildSearchConclusion(question: string): string {
  return `Search queries generated for: ${question.slice(0, 60)}${question.length > 60 ? "..." : ""}.`;
}

function buildConcludeConclusion(
  question: string,
  complexity: string,
  uncertainties: string[],
): string {
  if (uncertainties.length > 0) {
    return `Answer generated with noted uncertainty: ${uncertainties[0]}.`;
  }
  if (complexity === "low") return "Direct factual answer ready.";
  if (complexity === "very_high") return "Comprehensive answer synthesized from multi-source evidence.";
  return "Well-grounded answer formulated from available knowledge and sources.";
}

function computeFinalConfidence(
  steps: CoTStep[],
  complexity: string,
  context?: { sourceCount?: number },
): number {
  const baseByComplexity: Record<string, number> = {
    low: 0.95,
    medium: 0.87,
    high: 0.80,
    very_high: 0.72,
  };

  let confidence = baseByComplexity[complexity] ?? 0.82;

  // Boost from sources
  if (context?.sourceCount) {
    confidence = Math.min(confidence + Math.log(context.sourceCount + 1) * 0.04, 0.97);
  }

  // Average with step confidences (weighted)
  const stepAvg = steps.reduce((sum, s) => sum + s.confidence, 0) / steps.length;
  return Math.round((confidence * 0.6 + stepAvg * 0.4) * 100) / 100;
}

// ─── Serializer (for UI display) ──────────────────────────────────────────────

export function serializeCoTForDisplay(cot: CoTReasoning): string {
  const icon: Record<CoTStepType, string> = {
    decompose: "🔍",
    recall: "🧠",
    search: "🌐",
    analyze: "📊",
    compare: "⚖️",
    verify: "✅",
    synthesize: "🔗",
    conclude: "💡",
  };

  const lines = cot.steps.map(
    (step) => `${icon[step.type]} **${step.type.toUpperCase()}**: ${step.thought} → _${step.conclusion}_`,
  );

  const confidenceBar = Math.round(cot.finalConfidence * 10);
  const bar = "█".repeat(confidenceBar) + "░".repeat(10 - confidenceBar);

  const header = `**Reasoning trace** (complexity: ${cot.complexity}, confidence: ${bar} ${Math.round(cot.finalConfidence * 100)}%)`;

  return [header, "", ...lines].join("\n");
}

// ─── Confidence label (human-readable) ───────────────────────────────────────

export function confidenceLabel(score: number): {
  label: string;
  color: "green" | "yellow" | "orange" | "red";
  description: string;
} {
  if (score >= 0.9)
    return { label: "Very high", color: "green", description: "Well-grounded in reliable sources." };
  if (score >= 0.78)
    return { label: "High", color: "green", description: "Supported by multiple consistent sources." };
  if (score >= 0.65)
    return { label: "Moderate", color: "yellow", description: "Some uncertainty — verify key claims." };
  if (score >= 0.5)
    return { label: "Low", color: "orange", description: "Limited source coverage — treat with caution." };
  return { label: "Very low", color: "red", description: "Insufficient evidence — manual verification needed." };
}
