export type DisclaimerContext = {
  intent: string;
  category: string;
  question: string;
  answer: string;
};

export type DisclaimerResult = {
  answer: string;
  disclaimer: string | null;
  combined: string;
};

const HEALTH_DISCLAIMER =
  "\n\n⚕️ _This is general health information, not medical advice. Consult a qualified doctor for diagnosis, treatment, or medication decisions._";

const LEGAL_DISCLAIMER =
  "\n\n⚖️ _This is general legal information, not legal advice. Laws vary by jurisdiction. Consult a qualified lawyer for your specific situation._";

const FINANCE_DISCLAIMER =
  "\n\n📊 _This is general financial information, not investment advice. Consult a qualified financial advisor before making investment decisions._";

const FRESHNESS_DISCLAIMER =
  "\n\n📅 _Details about current people, roles, rules, or fast-changing topics may have changed. Verify the latest information from official sources._";

const DISCLAIMER_BLOCKLIST = new Set([
  "calendar",
  "email",
  "finance",
  "greeting",
  "help",
  "memory",
  "news",
  "reminder",
  "save_contact",
  "send_message",
  "spending",
  "weather",
  "web_search",
]);

const HEALTH_INTENTS = new Set(["health", "medicine", "medical"]);
const LEGAL_INTENTS = new Set(["law", "legal"]);

const HEALTH_PATTERNS = [
  /\b(symptom|symptoms|disease|illness|diagnosis|diagnose|medicine|medication|drug|dose|dosage|tablet|capsule|injection|surgery|hospital|cancer|diabetes|infection|fever|pain|blood pressure|cholesterol|anxiety|depression|mental health|side effects?)\b/i,
  /\b(treatment (?:for|of)|medical treatment|doctor said|doctor told me|prescribed|prescription)\b/i,
  /\b(is it safe to|can i take|should i take|overdose|interaction between|combine .* with|mix .* with)\b/i,
];

const PERSONAL_HEALTH_ADVICE_PATTERNS = [
  /\b(can i take|should i take|is it safe to take|how much .* take|what medicine should i take|which medicine should i take)\b/i,
  /\b(dose|dosage|tablet|capsule|injection|prescribed|prescription|side effects?)\b/i,
  /\b(my child|my baby|my father|my mother|my wife|my husband|i have .* pain|i am having .* pain)\b/i,
];

const NON_CLINICAL_HEALTH_CONTEXT_PATTERNS = [
  /\b(treatment coefficient|treatment effect|effect estimate)\b/i,
  /\b(difference-?in-?differences?|parallel trends|event study|policy evaluation|regression)\b/i,
  /\b(t-?stat(?:istic)?|confidence interval|standard error|beta coefficient|att estimator)\b/i,
];

const LEGAL_PATTERNS = [
  /\b(can i sue|is it legal|legal advice|lawsuit|fir|bail|court|judge|rights|copyright|trademark|contract|eviction|tenant rights|labor law|consumer rights|property dispute)\b/i,
  /\b(am i liable|who is responsible|what are my rights|what is the law)\b/i,
];

const FINANCE_RECOMMENDATION_PATTERNS = [
  /\b(should i invest|where should i invest|which mutual fund|which stock|stock pick|portfolio advice|best fund|sip recommendation|should i buy|should i sell)\b/i,
  /\b(good investment|investment advice|tax advice|retirement plan)\b/i,
];

const FRESHNESS_PATTERNS = [
  /\b(current ceo|current cto|current coo|current founder|current president|current prime minister|current pm|who currently leads|who runs .* now|who owns .* now)\b/i,
  /\b(latest version|current version|newest model|most recent model|latest regulation|current regulation|latest policy|current policy)\b/i,
  /\b(this year|last year|in 20[2-9]\d)\b/i,
];

function alreadyHasLiveSafetyLabel(answer: string): boolean {
  return /live data as of|source note:|sources?:|not financial advice/i.test(answer);
}

function alreadyHasEquivalentDisclaimer(answer: string, kind: "health" | "legal" | "finance" | "freshness"): boolean {
  const normalized = answer.toLowerCase();

  if (kind === "health") {
    return normalized.includes("not medical advice");
  }

  if (kind === "legal") {
    return normalized.includes("not legal advice");
  }

  if (kind === "finance") {
    return normalized.includes("not investment advice") || normalized.includes("not financial advice");
  }

  return normalized.includes("verify the latest information") || normalized.includes("may have changed");
}

function isBlockedIntent(intentOrCategory: string): boolean {
  return DISCLAIMER_BLOCKLIST.has(intentOrCategory);
}

function looksLikeHealthQuestion(ctx: DisclaimerContext, question: string): boolean {
  if (HEALTH_INTENTS.has(ctx.intent) || HEALTH_INTENTS.has(ctx.category)) {
    return true;
  }

  if (NON_CLINICAL_HEALTH_CONTEXT_PATTERNS.some((pattern) => pattern.test(question))) {
    return false;
  }

  return HEALTH_PATTERNS.some((pattern) => pattern.test(question));
}

function looksLikePersonalHealthAdviceQuestion(ctx: DisclaimerContext, question: string): boolean {
  return looksLikeHealthQuestion(ctx, question)
    && PERSONAL_HEALTH_ADVICE_PATTERNS.some((pattern) => pattern.test(question));
}

function firstMatchingDisclaimer(ctx: DisclaimerContext): string | null {
  const question = ctx.question.toLowerCase();

  if (
    !isBlockedIntent(ctx.intent)
    && !isBlockedIntent(ctx.category)
    && !alreadyHasEquivalentDisclaimer(ctx.answer, "health")
    && looksLikePersonalHealthAdviceQuestion(ctx, question)
  ) {
    return HEALTH_DISCLAIMER;
  }

  if (
    !isBlockedIntent(ctx.intent)
    && !isBlockedIntent(ctx.category)
    && !alreadyHasEquivalentDisclaimer(ctx.answer, "legal")
    && LEGAL_PATTERNS.some((pattern) => pattern.test(question))
  ) {
    return LEGAL_DISCLAIMER;
  }

  if (
    !isBlockedIntent(ctx.intent)
    && !isBlockedIntent(ctx.category)
    && !alreadyHasEquivalentDisclaimer(ctx.answer, "finance")
    && FINANCE_RECOMMENDATION_PATTERNS.some((pattern) => pattern.test(question))
  ) {
    return FINANCE_DISCLAIMER;
  }

  return null;
}

export function buildDisclaimer(ctx: DisclaimerContext): string | null {
  return firstMatchingDisclaimer(ctx);
}

export function applyDisclaimer(ctx: DisclaimerContext): DisclaimerResult {
  const disclaimer = buildDisclaimer(ctx);
  return {
    answer: ctx.answer,
    disclaimer,
    combined: disclaimer ? `${ctx.answer}${disclaimer}` : ctx.answer,
  };
}
