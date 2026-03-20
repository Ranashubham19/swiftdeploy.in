import { completeClawCloudPrompt, type IntentType } from "@/lib/clawcloud-ai";
import { shouldUseLiveSearch } from "@/lib/clawcloud-live-search";
import { detectTaxQuery } from "@/lib/clawcloud-tax";

export type ClawCloudAnswerDomain =
  | "general"
  | "live"
  | "finance"
  | "health"
  | "mental_health"
  | "legal"
  | "tax"
  | "document";

export type ClawCloudAnswerConfidence = "low" | "medium" | "high";

export type ClawCloudAnswerQualityProfile = {
  intent: string;
  category: string;
  domain: ClawCloudAnswerDomain;
  isDocumentBound: boolean;
  isHighStakes: boolean;
  isAdvice: boolean;
  requiresEvidence: boolean;
  requiresLiveGrounding: boolean;
  requiresVerification: boolean;
  confidenceFloor: ClawCloudAnswerConfidence;
};

export type ClawCloudAnswerVerification = {
  verdict: "approve" | "revise" | "reject";
  confidence: ClawCloudAnswerConfidence;
  rationale: string;
  revisedAnswer: string;
};

const HEALTH_PATTERNS = [
  /\b(symptom|symptoms|disease|illness|diagnosis|diagnose|medicine|medication|tablet|capsule|dose|dosage|treatment|doctor|hospital|surgery|side effects?|infection|fever|pain|blood pressure|cholesterol|diabetes|cancer|anxiety|depression|pregnan|mental health)\b/i,
  /\b(can i take|should i take|what should i take|how much .* take|is it safe to take|mix .* medicine|combine .* medicine)\b/i,
  /\b(my child|my father|my mother|my wife|my husband|my symptoms|i have .* pain|i feel .* pain)\b/i,
];

const MENTAL_HEALTH_PATTERNS = [
  /\b(anxiety|depression|panic attack|panic attacks|mental health|therapy|therapist|psychiatrist|counsellor|counselor|burnout|trauma|grief|hopeless|empty inside)\b/i,
  /\b(i feel numb|i feel hopeless|i cannot cope|i can't cope|i do not feel okay|i don't feel okay)\b/i,
];

const LEGAL_PATTERNS = [
  /\b(legal|law|laws|court|judge|lawyer|attorney|rights|contract|notice|fir|bail|appeal|crime|criminal|civil|sue|lawsuit|divorce|tenant|eviction|trademark|copyright|patent|jurisdiction)\b/i,
  /\b(can i sue|is it legal|what are my rights|am i liable|what is the law|file a case|legal notice)\b/i,
];

const FINANCE_ADVICE_PATTERNS = [
  /\b(should i invest|where should i invest|which stock|which mutual fund|which sip|should i buy|should i sell|stock pick|portfolio advice|good investment|retirement plan|safe return|guaranteed return)\b/i,
  /\b(should i hold|is this a good stock|best stock to buy|best crypto to buy)\b/i,
];

const LIVE_EVIDENCE_PATTERNS = [
  /\blive data as of\b/i,
  /\bdata fetched:\b/i,
  /\bsource note:\b/i,
  /\bsearched:\b/i,
  /\bsources?:\b/i,
  /\bpublished:\b/i,
  /\baccording to\b/i,
  /\bofficial\b/i,
  /\bas of\b/i,
];

const HIGH_STAKES_EVIDENCE_PATTERNS = [
  /\bgeneral information\b/i,
  /\bgenerally\b/i,
  /\btypically\b/i,
  /\bdepends on\b/i,
  /\bjurisdiction\b/i,
  /\bguideline\b/i,
  /\bestablished\b/i,
  /\bnew regime\b/i,
  /\bsection\s+\d+[a-z]?\b/i,
  /\bu\/s\s*\d+/i,
  /\bconsult\b/i,
  /\bqualified\b/i,
  /\bdoctor\b/i,
  /\blawyer\b/i,
  /\bchartered accountant\b/i,
  /\bfinancial advisor\b/i,
];

const LOW_CONFIDENCE_PATTERNS = [
  /\bi'm not confident enough\b/i,
  /\bi am not confident enough\b/i,
  /\bi could not verify\b/i,
  /\bcannot verify\b/i,
  /\bnot enough reliable\b/i,
  /\buncertain\b/i,
];

const UNSAFE_HEALTH_PATTERNS = [
  /\byou definitely have\b/i,
  /\bthis is definitely\b/i,
  /\btake\s+\d+\s*(mg|ml|tablets?|capsules?)\b/i,
  /\bstart taking\b/i,
  /\bstop taking\b/i,
];

const UNSAFE_LEGAL_PATTERNS = [
  /\byou will win\b/i,
  /\byou can definitely sue\b/i,
  /\bfile the case immediately\b/i,
  /\byou are guaranteed\b/i,
];

const UNSAFE_FINANCE_PATTERNS = [
  /\bguaranteed return\b/i,
  /\bdouble your money\b/i,
  /\bbuy this stock\b/i,
  /\bsell immediately\b/i,
  /\ball in\b/i,
];

const SUPPORTIVE_MENTAL_HEALTH_PATTERNS = [
  /\btherapist\b/i,
  /\bmental health professional\b/i,
  /\bsupport person\b/i,
  /\bif you feel unsafe\b/i,
  /\bimmediate help\b/i,
  /\byou are not alone\b/i,
];

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function clampConfidenceLevel(value: string | null | undefined): ClawCloudAnswerConfidence {
  const normalized = (value ?? "").trim().toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "medium") return "medium";
  return "low";
}

function domainForQuestion(question: string, intent: string, category: string, isDocumentBound: boolean): ClawCloudAnswerDomain {
  if (isDocumentBound) return "document";
  if (intent === "language" || category === "language") return "general";
  if (detectTaxQuery(question)) return "tax";
  if (intent === "finance" || category === "finance") return "finance";
  if (matchesAny(question, MENTAL_HEALTH_PATTERNS)) return "mental_health";
  if (intent === "health" || category === "health" || matchesAny(question, HEALTH_PATTERNS)) return "health";
  if (intent === "law" || category === "law" || matchesAny(question, LEGAL_PATTERNS)) return "legal";
  if (shouldUseLiveSearch(question) || category === "news" || category === "web_search") return "live";
  return "general";
}

export function buildClawCloudAnswerQualityProfile(input: {
  question: string;
  intent: string;
  category: string;
  isDocumentBound?: boolean;
}): ClawCloudAnswerQualityProfile {
  const question = input.question.trim();
  const isDocumentBound = Boolean(input.isDocumentBound);
  const domain = domainForQuestion(question, input.intent, input.category, isDocumentBound);
  const isAdvice =
    matchesAny(question, FINANCE_ADVICE_PATTERNS)
    || /\bshould i\b/i.test(question)
    || /\bwhat should i do\b/i.test(question)
    || /\bcan i take\b/i.test(question)
    || /\bhow much tax\b/i.test(question)
    || /\bwhich option is best for me\b/i.test(question);
  const isHighStakes = domain === "health" || domain === "mental_health" || domain === "legal" || domain === "tax" || domain === "finance";
  const requiresLiveGrounding = domain === "live" || domain === "finance";
  const requiresEvidence = requiresLiveGrounding || domain === "health" || domain === "mental_health" || domain === "legal";
  const requiresVerification =
    domain === "live"
      ? false
      : requiresEvidence || domain === "tax" || isAdvice || input.category === "news";

  return {
    intent: input.intent,
    category: input.category,
    domain,
    isDocumentBound,
    isHighStakes,
    isAdvice,
    requiresEvidence,
    requiresLiveGrounding,
    requiresVerification,
    confidenceFloor: requiresLiveGrounding || requiresVerification ? "medium" : "low",
  };
}

export function buildClawCloudEvidenceInstruction(profile: ClawCloudAnswerQualityProfile): string {
  if (profile.domain === "document") {
    return [
      "Answer using only the document text already provided.",
      "Do not introduce outside facts or assumptions as if they are proven.",
    ].join("\n");
  }

  const lines = [
    "Quality mode:",
    "- Lead with what is established first.",
    "- Separate verified/general information from assumptions or uncertainty.",
    "- If confidence is below medium, say exactly: I'm not confident enough to answer that safely without verified sources.",
    "- Never bluff, invent citations, or present uncertainty as certainty.",
  ];

  if (profile.requiresLiveGrounding) {
    lines.push("- For current or fast-changing facts, only answer if the reply is grounded in live evidence.");
    lines.push("- If live evidence is weak, say you are not confident enough right now.");
  }

  if (profile.domain === "health") {
    lines.push("- Do not diagnose, prescribe dosage, or tell the user to ignore medical care.");
    lines.push("- Explain general guidance, red flags, and the safest next step.");
  }

  if (profile.domain === "mental_health") {
    lines.push("- Do not diagnose the user or speak with false certainty about their condition.");
    lines.push("- Respond with calm, supportive language, general guidance, and encourage licensed mental health support when needed.");
    lines.push("- If the user sounds unsafe or at risk of self-harm, prioritize immediate local emergency help.");
  }

  if (profile.domain === "legal") {
    lines.push("- Do not present personal legal strategy as certain.");
    lines.push("- State the general legal principle, what depends on jurisdiction/facts, and the safest next step.");
  }

  if (profile.domain === "tax") {
    lines.push("- State assumptions, tax year/regime if relevant, and note when a CA should verify the case.");
  }

  if (profile.domain === "finance") {
    lines.push("- Do not give personalized buy/sell advice or guaranteed outcomes.");
    lines.push("- Separate live facts from opinion and note any missing evidence.");
  }

  return lines.join("\n");
}

export function clawCloudAnswerHasEvidenceSignals(
  answer: string,
  profile: ClawCloudAnswerQualityProfile,
): boolean {
  if (!answer.trim()) return false;

  if (matchesAny(answer, LIVE_EVIDENCE_PATTERNS)) {
    return true;
  }

  if (profile.isHighStakes && matchesAny(answer, HIGH_STAKES_EVIDENCE_PATTERNS)) {
    return true;
  }

  return false;
}

function hasUnsafeAdviceSignals(answer: string, profile: ClawCloudAnswerQualityProfile) {
  if (profile.domain === "health") {
    return matchesAny(answer, UNSAFE_HEALTH_PATTERNS);
  }
  if (profile.domain === "mental_health") {
    return matchesAny(answer, UNSAFE_HEALTH_PATTERNS) || !matchesAny(answer, SUPPORTIVE_MENTAL_HEALTH_PATTERNS);
  }
  if (profile.domain === "legal") {
    return matchesAny(answer, UNSAFE_LEGAL_PATTERNS);
  }
  if (profile.domain === "finance" || profile.domain === "tax") {
    return matchesAny(answer, UNSAFE_FINANCE_PATTERNS);
  }
  return false;
}

function compareConfidence(
  left: ClawCloudAnswerConfidence,
  right: ClawCloudAnswerConfidence,
) {
  const order: Record<ClawCloudAnswerConfidence, number> = {
    low: 0,
    medium: 1,
    high: 2,
  };
  return order[left] - order[right];
}

export function scoreClawCloudAnswerConfidence(input: {
  question: string;
  answer: string;
  profile: ClawCloudAnswerQualityProfile;
}): ClawCloudAnswerConfidence {
  const answer = input.answer.trim();
  if (!answer || matchesAny(answer, LOW_CONFIDENCE_PATTERNS)) {
    return "low";
  }

  let score = 0;

  if (answer.length >= 120) score += 1;
  if (answer.length >= 280) score += 1;
  if (clawCloudAnswerHasEvidenceSignals(answer, input.profile)) score += 2;
  if (input.profile.requiresEvidence && !clawCloudAnswerHasEvidenceSignals(answer, input.profile)) score -= 2;
  if (/\bdepends on\b/i.test(answer) || /\bmay vary\b/i.test(answer) || /\bverify\b/i.test(answer)) score += 1;
  if (/\bconsult\b/i.test(answer) || /\bofficial source\b/i.test(answer)) score += 1;
  if (hasUnsafeAdviceSignals(answer, input.profile)) score -= 3;
  if (input.profile.isAdvice && !/\bconsult\b/i.test(answer) && input.profile.isHighStakes) score -= 1;

  if (score >= 4) return "high";
  if (score >= 1) return "medium";
  return "low";
}

function parseVerificationBlock(raw: string): ClawCloudAnswerVerification | null {
  const verdictMatch = raw.match(/VERDICT:\s*(APPROVE|REVISE|REJECT)/i);
  const confidenceMatch = raw.match(/CONFIDENCE:\s*(HIGH|MEDIUM|LOW)/i);
  if (!verdictMatch || !confidenceMatch) {
    return null;
  }

  const rationaleMatch = raw.match(/RATIONALE:\s*([\s\S]*?)(?:\nREVISION:|$)/i);
  const revisionMatch = raw.match(/REVISION:\s*([\s\S]*)$/i);

  return {
    verdict: verdictMatch[1].toLowerCase() as "approve" | "revise" | "reject",
    confidence: clampConfidenceLevel(confidenceMatch[1]),
    rationale: rationaleMatch?.[1]?.trim() ?? "",
    revisedAnswer: revisionMatch?.[1]?.trim() ?? "",
  };
}

function verifierIntentForProfile(profile: ClawCloudAnswerQualityProfile): IntentType {
  switch (profile.domain) {
    case "health":
    case "mental_health":
      return "health";
    case "legal":
      return "law";
    case "tax":
    case "finance":
      return "economics";
    case "live":
      return "research";
    default:
      return "general";
  }
}

export async function verifyClawCloudAnswer(input: {
  question: string;
  answer: string;
  profile: ClawCloudAnswerQualityProfile;
}): Promise<ClawCloudAnswerVerification | null> {
  if (!input.profile.requiresVerification || !input.answer.trim()) {
    return null;
  }

  const verifierPrompt = [
    "You are the final answer verifier for ClawCloud.",
    "Review the candidate answer for factual safety, completeness, and overconfidence.",
    "Reject answers that bluff, invent current facts, or give personalized medical, legal, mental-health, financial, or tax advice as certainty.",
    "If the answer is mostly good but needs caveats or safer wording, revise it.",
    "If the answer is acceptable, approve it.",
    "Return exactly this structure:",
    "VERDICT: APPROVE | REVISE | REJECT",
    "CONFIDENCE: HIGH | MEDIUM | LOW",
    "RATIONALE: one short paragraph",
    "REVISION: only include a full replacement answer when verdict is REVISE; otherwise leave blank",
  ].join("\n");

  const answer = await completeClawCloudPrompt({
    system: verifierPrompt,
    user: [
      `Domain: ${input.profile.domain}`,
      `Requires evidence: ${input.profile.requiresEvidence ? "yes" : "no"}`,
      `Requires live grounding: ${input.profile.requiresLiveGrounding ? "yes" : "no"}`,
      `Question: ${input.question}`,
      "",
      "Candidate answer:",
      input.answer,
    ].join("\n"),
    history: [],
    intent: verifierIntentForProfile(input.profile),
    responseMode: "fast",
    maxTokens: 700,
    fallback: "",
    skipCache: true,
    temperature: 0.05,
  }).catch(() => "");

  return parseVerificationBlock(answer);
}

export function buildClawCloudLowConfidenceReply(
  question: string,
  profile: ClawCloudAnswerQualityProfile,
  rationale?: string,
): string {
  const reason = rationale?.trim();

  if (profile.domain === "health") {
    return [
      "I'm not confident enough to answer that safely without verified medical sources.",
      "",
      "If this is about symptoms, diagnosis, dosage, or medication safety, please check with a qualified doctor.",
      "If you want, I can still give general background information or help you phrase the question more clearly.",
      reason ? `\nReason: ${reason}` : "",
    ].filter(Boolean).join("\n");
  }

  if (profile.domain === "mental_health") {
    return [
      "I want to be careful here because mental-health questions can be personal and high-stakes.",
      "",
      "I'm not confident enough to answer this as personal guidance without better context and, where needed, support from a licensed mental-health professional.",
      "If you want, I can still offer general coping ideas, help you phrase what you're feeling, or help you decide what kind of support to seek next.",
      reason ? `\nReason: ${reason}` : "",
    ].filter(Boolean).join("\n");
  }

  if (profile.domain === "legal") {
    return [
      "I'm not confident enough to answer that safely without verified legal context.",
      "",
      "Laws vary by jurisdiction and facts, so please verify this with a qualified lawyer before acting on it.",
      "If you want, I can help with a general explanation or help narrow the question by country/state.",
      reason ? `\nReason: ${reason}` : "",
    ].filter(Boolean).join("\n");
  }

  if (profile.domain === "tax" || profile.domain === "finance") {
    return [
      "I'm not confident enough to answer that safely without verified current facts and assumptions.",
      "",
      "Please verify the exact tax or financial details with official sources or a qualified CA/advisor before making a decision.",
      "If you want, I can help break the problem into smaller verified parts.",
      reason ? `\nReason: ${reason}` : "",
    ].filter(Boolean).join("\n");
  }

  if (profile.requiresLiveGrounding) {
    return [
      "I'm not confident enough to answer that accurately right now from verified live sources.",
      "",
      "Try a narrower query with the exact person, company, date, or event, and I will check again.",
      reason ? `\nReason: ${reason}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    "I'm not confident enough to answer that safely without better grounding.",
    "",
    "If you want, ask it in a narrower way and I will try again.",
    reason ? `\nReason: ${reason}` : "",
  ].filter(Boolean).join("\n");
}

export function clawCloudConfidenceBelowFloor(
  actual: ClawCloudAnswerConfidence,
  floor: ClawCloudAnswerConfidence,
) {
  return compareConfidence(actual, floor) < 0;
}
