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
  /\b(symptom|disease|illness|diagnosis|medicine|drug|dose|dosage|tablet|injection|surgery|treatment|doctor|hospital|cancer|diabetes|infection|fever|pain|blood pressure|cholesterol|anxiety|depression|mental health|side effects?)\b/i,
  /\b(is it safe to|can i take|should i take|overdose|interaction between|combine .* with|mix .* with)\b/i,
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

function firstMatchingDisclaimer(ctx: DisclaimerContext): string | null {
  const question = ctx.question.toLowerCase();

  if (
    !isBlockedIntent(ctx.intent)
    && !isBlockedIntent(ctx.category)
    && !alreadyHasEquivalentDisclaimer(ctx.answer, "health")
    && (HEALTH_INTENTS.has(ctx.intent) || HEALTH_INTENTS.has(ctx.category)
      || HEALTH_PATTERNS.some((pattern) => pattern.test(question)))
  ) {
    return HEALTH_DISCLAIMER;
  }

  if (
    !isBlockedIntent(ctx.intent)
    && !isBlockedIntent(ctx.category)
    && !alreadyHasEquivalentDisclaimer(ctx.answer, "legal")
    && (LEGAL_INTENTS.has(ctx.intent) || LEGAL_INTENTS.has(ctx.category)
      || LEGAL_PATTERNS.some((pattern) => pattern.test(question)))
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

  if (
    !alreadyHasLiveSafetyLabel(ctx.answer)
    && !alreadyHasEquivalentDisclaimer(ctx.answer, "freshness")
    && FRESHNESS_PATTERNS.some((pattern) => pattern.test(question))
  ) {
    return FRESHNESS_DISCLAIMER;
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
