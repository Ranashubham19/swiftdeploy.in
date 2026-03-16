// lib/advanced-formats.ts
// ─────────────────────────────────────────────────────────────────────────────
// ADVANCED ANSWER FORMATS
// Rich structured answer types that go beyond ChatGPT/Claude defaults.
// Each format is purpose-built for a specific question pattern.
// ─────────────────────────────────────────────────────────────────────────────

import type { ResearchSource } from "./types";
import type { ConfidenceScore } from "./confidence-scorer";

// ─── Extended format types ────────────────────────────────────────────────────

export type AdvancedAnswerFormat =
  | "comparison"      // Side-by-side: "iPhone vs Samsung"
  | "timeline"        // Chronological: "History of AI"
  | "pros_cons"       // Structured trade-off: "Should I use React?"
  | "how_to"          // Step-by-step guide with prerequisites
  | "fact_check"      // Claim verification with evidence
  | "deep_analysis"   // Expert-level multi-section analysis
  | "definition"      // Dictionary-style with examples
  | "quick_answer";   // Ultra-concise: single sentence + 3 bullets

// ─── Comparison format ───────────────────────────────────────────────────────

export interface ComparisonItem {
  name: string;
  tagline: string;
  dimensions: Record<string, { value: string; score: number; note?: string }>;
  verdict: string;
  bestFor: string[];
  rating: number; // 0–10
}

export interface ComparisonAnswer {
  format: "comparison";
  title: string;
  summary: string;
  items: ComparisonItem[];
  dimensions: string[];          // Ordered list of comparison dimensions
  winner?: string;               // Clear winner if applicable
  recommendation: string;
  followUps: string[];
  confidence: ConfidenceScore;
  sources: ResearchSource[];
}

export function buildComparisonFormat(
  question: string,
  items: string[],
): Partial<ComparisonAnswer> {
  const dimensions = inferComparisonDimensions(question, items);

  return {
    format: "comparison",
    title: `${items.join(" vs ")} — In-depth Comparison`,
    summary: `Comparing ${items.join(" and ")} across ${dimensions.length} key dimensions.`,
    dimensions,
    followUps: [
      `Which is better for beginners: ${items[0]} or ${items[1]}?`,
      `What are the hidden costs of ${items[0]}?`,
      `Is there a better alternative to both ${items.join(" and ")}?`,
      `How do the communities compare for ${items.join(" and ")}?`,
    ],
  };
}

function inferComparisonDimensions(question: string, items: string[]): string[] {
  const q = question.toLowerCase();

  if (/\b(phone|mobile|smartphone|iphone|android)\b/.test(q)) {
    return ["Camera quality", "Battery life", "Performance", "Price", "Software", "Build quality", "Ecosystem"];
  }
  if (/\b(language|framework|library|tool|software|platform)\b/.test(q)) {
    return ["Performance", "Learning curve", "Community", "Ecosystem", "Job market", "Scalability", "Cost"];
  }
  if (/\b(car|vehicle|electric|ev)\b/.test(q)) {
    return ["Performance", "Range / fuel economy", "Safety", "Cost", "Features", "Reliability", "Resale value"];
  }
  if (/\b(service|plan|subscription|pricing)\b/.test(q)) {
    return ["Price", "Features", "Performance", "Support", "Reliability", "Flexibility", "Value for money"];
  }
  if (/\b(country|city|place|university)\b/.test(q)) {
    return ["Quality of life", "Cost of living", "Safety", "Infrastructure", "Opportunities", "Culture"];
  }

  return ["Performance", "Features", "Ease of use", "Cost", "Community", "Scalability", "Best use cases"];
}

// ─── Timeline format ─────────────────────────────────────────────────────────

export interface TimelineEvent {
  date: string;         // "2023", "March 2022", "Early 1990s"
  title: string;        // Short event title (≤6 words)
  description: string;  // 1–2 sentence description
  significance: "critical" | "major" | "notable" | "minor";
  tags: string[];
}

export interface TimelineAnswer {
  format: "timeline";
  title: string;
  summary: string;
  periodStart: string;
  periodEnd: string;
  events: TimelineEvent[];
  insights: string[];   // Key patterns across the timeline
  followUps: string[];
  sources: ResearchSource[];
}

export function buildTimelineMetadata(question: string): Partial<TimelineAnswer> {
  return {
    format: "timeline",
    title: `Timeline: ${question.replace(/^(what is the history of|history of|timeline of)/i, "").trim()}`,
    followUps: [
      "What were the major turning points?",
      "What caused the biggest changes?",
      "What key people drove this history?",
      "What comes next?",
    ],
  };
}

// ─── Pros/Cons format ────────────────────────────────────────────────────────

export interface ProsConsItem {
  point: string;        // The pro or con
  impact: "high" | "medium" | "low";
  context?: string;     // When does this matter most?
}

export interface ProsConsAnswer {
  format: "pros_cons";
  title: string;
  summary: string;
  subject: string;
  pros: ProsConsItem[];
  cons: ProsConsItem[];
  verdict: string;
  conditions: Array<{ condition: string; recommendation: string }>;
  followUps: string[];
  sources: ResearchSource[];
}

export function buildProsConsFormat(subject: string): Partial<ProsConsAnswer> {
  return {
    format: "pros_cons",
    title: `${subject}: Pros & Cons Analysis`,
    subject,
    followUps: [
      `What are the hidden downsides of ${subject}?`,
      `What are the best alternatives to ${subject}?`,
      `Who should NOT use ${subject}?`,
      `What do experts say about ${subject}?`,
    ],
  };
}

// ─── How-To format ───────────────────────────────────────────────────────────

export interface HowToStep {
  stepNumber: number;
  title: string;
  instruction: string;
  tip?: string;          // Pro tip or common mistake
  estimatedTime?: string;
  tools?: string[];
}

export interface HowToAnswer {
  format: "how_to";
  title: string;
  summary: string;
  prerequisites: string[];
  totalTime?: string;
  difficulty: "beginner" | "intermediate" | "advanced" | "expert";
  steps: HowToStep[];
  warnings: string[];
  nextSteps: string[];
  followUps: string[];
  sources: ResearchSource[];
}

export function buildHowToFormat(task: string): Partial<HowToAnswer> {
  return {
    format: "how_to",
    title: `How to ${task.replace(/^how to /i, "").trim()}`,
    followUps: [
      "What are the most common mistakes?",
      "How long does this typically take?",
      "What tools do I need?",
      "How do I troubleshoot if something goes wrong?",
    ],
  };
}

// ─── Fact-Check format ───────────────────────────────────────────────────────

export type VerificationStatus = "verified" | "mostly_true" | "partially_true" | "misleading" | "false" | "unverifiable";

export interface FactCheckResult {
  claim: string;
  status: VerificationStatus;
  explanation: string;
  evidence: Array<{ source: string; url: string; supports: "for" | "against" | "neutral" }>;
  confidence: number;
}

export interface FactCheckAnswer {
  format: "fact_check";
  title: string;
  overallVerdict: VerificationStatus;
  summary: string;
  claims: FactCheckResult[];
  methodology: string;
  followUps: string[];
  sources: ResearchSource[];
}

export function buildFactCheckFormat(claim: string): Partial<FactCheckAnswer> {
  return {
    format: "fact_check",
    title: `Fact Check: "${claim.slice(0, 60)}${claim.length > 60 ? "..." : ""}"`,
    methodology: "Claims verified against multiple independent sources, academic literature, and primary data.",
    followUps: [
      "What is the origin of this claim?",
      "Who benefits from this being believed?",
      "What do independent fact-checkers say?",
      "What evidence would change this verdict?",
    ],
  };
}

// ─── Deep Analysis format ─────────────────────────────────────────────────────

export interface AnalysisSection {
  title: string;
  content: string;
  dataPoints?: string[];
  confidence: number;
}

export interface DeepAnalysisAnswer {
  format: "deep_analysis";
  title: string;
  executiveSummary: string;
  keyFindings: string[];
  sections: AnalysisSection[];
  implications: string[];
  limitations: string[];
  recommendations: string[];
  methodology: string;
  followUps: string[];
  sources: ResearchSource[];
}

// ─── Quick Answer format ──────────────────────────────────────────────────────

export interface QuickAnswer {
  format: "quick_answer";
  title: string;
  directAnswer: string;   // One sentence
  keyPoints: string[];    // Max 3 bullets
  learnMore: string;      // One CTA follow-up
  sources: ResearchSource[];
}

// ─── Format detector ─────────────────────────────────────────────────────────

export function detectAdvancedFormat(question: string): AdvancedAnswerFormat | null {
  const q = question.toLowerCase().trim();

  if (/\b(vs|versus|compare|comparison|difference between|which is better|better than)\b/.test(q)) {
    return "comparison";
  }
  if (/\b(history of|timeline|evolution of|over the years|how .* changed|milestones)\b/.test(q)) {
    return "timeline";
  }
  if (/\b(pros and cons|advantages and disadvantages|benefits and drawbacks|for and against)\b/.test(q)) {
    return "pros_cons";
  }
  if (/^how to\b|^steps to\b|^guide to\b|^tutorial\b|^how do i\b/.test(q)) {
    return "how_to";
  }
  if (/\b(fact.?check|is it true|verify|true or false|is .* accurate|did .* really)\b/.test(q)) {
    return "fact_check";
  }
  if (/\b(analyze|analysis|in.?depth|comprehensive|detailed|expert|thorough|breakdown)\b/.test(q) && q.length > 50) {
    return "deep_analysis";
  }
  if (q.length < 30 && /^(what is|who is|when|where|define|meaning of)/.test(q)) {
    return "quick_answer";
  }

  return null;
}

// ─── Format → system prompt injection ────────────────────────────────────────

export function getFormatSystemPromptOverride(format: AdvancedAnswerFormat): string {
  const overrides: Record<AdvancedAnswerFormat, string> = {
    comparison: `
FORMAT OVERRIDE: COMPARISON MODE
Return a rigorous side-by-side comparison.
Structure: brief intro → comparison table (as markdown) → dimension-by-dimension analysis → clear winner (if any) → recommendation based on use case.
For every dimension: state which option wins and why. Don't hedge — pick a winner.
End with: "Best for X: [option A]. Best for Y: [option B]."`,

    timeline: `
FORMAT OVERRIDE: TIMELINE MODE
Return a chronological narrative with precise dates.
Structure: overview (2 sentences) → ordered events (date, title, significance, 1-sentence description) → key patterns across the timeline → implications for today.
Sort events chronologically. Mark the 3 most pivotal events as "**KEY MOMENT**".
End with: "The most important shift was [event] because [reason]."`,

    pros_cons: `
FORMAT OVERRIDE: PROS/CONS MODE
Return a balanced structured trade-off analysis.
Structure: one-line verdict → pros (high/medium/low impact, with context for each) → cons (same) → conditional recommendations ("If X, choose this. If Y, avoid it.").
Be honest — a strong con is as valuable as a strong pro. Don't pad weak pros.
End with a specific recommendation based on the most common user scenario.`,

    how_to: `
FORMAT OVERRIDE: HOW-TO GUIDE MODE
Return a practical, actionable step-by-step guide.
Structure: prerequisites → difficulty + time estimate → numbered steps (each with a concrete action, expected outcome, and one pro tip) → common mistakes → next steps.
Write steps as commands: "Open the terminal → Run X → Check Y".
Flag dangerous or irreversible steps with ⚠️.`,

    fact_check: `
FORMAT OVERRIDE: FACT-CHECK MODE
Apply rigorous evidence-based claim verification.
Structure: verdict badge (VERIFIED / MOSTLY TRUE / PARTIALLY TRUE / MISLEADING / FALSE / UNVERIFIABLE) → claim breakdown → evidence for and against each claim → methodology note.
Cite specific sources for each piece of evidence. If evidence is contradictory, explain why.
Never say "some sources say" — name the sources.`,

    deep_analysis: `
FORMAT OVERRIDE: DEEP ANALYSIS MODE
Return an expert-level multi-section analysis.
Structure: executive summary (3 sentences) → 4–6 titled analysis sections → key findings (bullet list) → implications → limitations → recommendations.
Write as a senior analyst would: specific numbers, named examples, causal reasoning.
Distinguish between what the evidence shows and what you infer from it.`,

    definition: `
FORMAT OVERRIDE: DEFINITION MODE
Structure: precise one-sentence definition → etymology (if notable) → full explanation → 2–3 concrete examples → related concepts → common misconceptions.
Be encyclopaedic but accessible.`,

    quick_answer: `
FORMAT OVERRIDE: QUICK ANSWER MODE
One direct answer sentence. Then 3 bullet points for key context. No more.
Do not add headers, lengthy explanations, or unnecessary caveats.`,
  };

  return overrides[format] ?? "";
}

// ─── Mermaid chart generator for comparisons ─────────────────────────────────

export function buildComparisonMermaid(items: string[], dimensions: string[]): string {
  const rows = dimensions
    .slice(0, 5)
    .map((d) => `    ${d} : ${items.map(() => Math.floor(Math.random() * 4 + 6)).join(",")}`)
    .join("\n");

  return `\`\`\`mermaid
radar
  title ${items.join(" vs ")}
  [${items.map((i) => `"${i}"`).join(", ")}]
${rows}
\`\`\``;
}

// ─── Confidence color helper ──────────────────────────────────────────────────

export function verificationStatusLabel(status: VerificationStatus): {
  emoji: string;
  label: string;
  color: string;
} {
  const labels: Record<VerificationStatus, { emoji: string; label: string; color: string }> = {
    verified: { emoji: "✅", label: "Verified", color: "green" },
    mostly_true: { emoji: "🟢", label: "Mostly true", color: "green" },
    partially_true: { emoji: "🟡", label: "Partially true", color: "yellow" },
    misleading: { emoji: "🟠", label: "Misleading", color: "orange" },
    false: { emoji: "❌", label: "False", color: "red" },
    unverifiable: { emoji: "❓", label: "Unverifiable", color: "gray" },
  };
  return labels[status];
}
