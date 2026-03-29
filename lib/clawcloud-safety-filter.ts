// lib/clawcloud-safety-filter.ts
// -----------------------------------------------------------------------------
// CONTENT SAFETY FILTER — Pre-response and post-response safety screening
// Detects harmful content, prompt injection, and unsafe patterns BEFORE and
// AFTER model generation. This is the missing safety layer that makes ClawCloud
// production-grade for all use cases.
// -----------------------------------------------------------------------------

export type SafetyCategory =
  | "safe"
  | "harmful_instructions"
  | "violence_graphic"
  | "self_harm"
  | "illegal_activity"
  | "hate_speech"
  | "sexual_explicit"
  | "personal_data_leak"
  | "prompt_injection"
  | "weapons_manufacturing"
  | "drug_manufacturing"
  | "financial_fraud"
  | "impersonation";

export type SafetyVerdict = {
  allowed: boolean;
  category: SafetyCategory;
  confidence: "high" | "medium" | "low";
  reason: string;
  sanitizedInput?: string;
};

export type OutputSafetyVerdict = {
  safe: boolean;
  category: SafetyCategory;
  issues: string[];
  sanitizedOutput?: string;
};

// ---------------------------------------------------------------------------
// INPUT SAFETY — screen user messages BEFORE model generation
// ---------------------------------------------------------------------------

const HARMFUL_INSTRUCTION_PATTERNS = [
  /\b(how to make|how to build|how to create|instructions for|recipe for|steps to make)\b.*\b(bomb|explosive|weapon|poison|nerve agent|biological weapon|chemical weapon|ricin|anthrax|sarin|mustard gas|napalm)\b/i,
  /\b(synthesize|manufacture|produce|create|brew)\b.*\b(methamphetamine|meth|cocaine|heroin|fentanyl|lsd|mdma|ecstasy|dmt|pcp)\b/i,
  /\b(hack into|break into|exploit|vulnerability in)\b.*\b(bank|government|military|hospital|power grid|nuclear)\b/i,
  /\b(create|write|generate)\b.*\b(malware|ransomware|virus|trojan|keylogger|rootkit|botnet|worm)\b/i,
  /\b(forge|fake|counterfeit)\b.*\b(passport|identity|license|currency|money|documents|diploma|certificate)\b/i,
  /\b(how to|ways to)\b.*\b(launder money|evade taxes|commit fraud|insider trading)\b/i,
];

const SELF_HARM_PATTERNS = [
  /\b(how to|best way to|methods? (?:of|for)|painless way to)\b.*\b(kill myself|commit suicide|end my life|hang myself|overdose)\b/i,
  /\b(want to die|want to end it all|no reason to live|better off dead)\b/i,
];

const HATE_SPEECH_PATTERNS = [
  /\b(why (?:are|is)|prove that)\b.*\b(race|ethnicity|religion|gender)\b.*\b(inferior|superior|subhuman|evil|dangerous)\b/i,
  /\b(genocide|ethnic cleansing|racial purification|exterminate)\b.*\b(people|race|group|community)\b/i,
];

const PROMPT_INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget|override)\b.*\b(previous|above|system|all)\b.*\b(instructions?|prompts?|rules?|guidelines?|constraints?)\b/i,
  /\b(you are now|act as|pretend to be|roleplay as)\b.*\b(evil|unrestricted|unfiltered|jailbroken|dan|uncensored)\b/i,
  /\bsystem\s*prompt\s*:/i,
  /\b(reveal|show|display|output|print)\b.*\b(system prompt|instructions|hidden prompt|secret prompt)\b/i,
];

const WEAPONS_MANUFACTURING_PATTERNS = [
  /\b(3d print|manufacture|build|assemble)\b.*\b(gun|firearm|pistol|rifle|silencer|suppressor)\b/i,
  /\b(convert|modify)\b.*\b(semi.?auto|automatic|full auto)\b/i,
];

const PERSONAL_DATA_PATTERNS = [
  /\b(social security|ssn|aadhaar|pan card)\b.*\b(number|#)\b.*\b(of|for|belonging to)\b.*[A-Z][a-z]+/i,
  /\b(credit card|bank account|routing number)\b.*\b(of|for|belonging to)\b/i,
];

const IMPERSONATION_PATTERNS = [
  /\b(pretend|act like|speak as|respond as)\b.*\b(the president|prime minister|ceo of|doctor|lawyer|judge)\b.*\b(and (say|tell|write|advise|prescribe))\b/i,
];

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

export function screenInput(text: string): SafetyVerdict {
  const normalized = text.trim();
  if (!normalized) {
    return { allowed: true, category: "safe", confidence: "high", reason: "Empty input" };
  }

  // Self-harm — highest priority, requires special handling
  if (matchesAnyPattern(normalized, SELF_HARM_PATTERNS)) {
    return {
      allowed: false,
      category: "self_harm",
      confidence: "high",
      reason: "Self-harm or suicide-related content detected",
      sanitizedInput: buildCrisisResponse(),
    };
  }

  // Weapons manufacturing
  if (matchesAnyPattern(normalized, WEAPONS_MANUFACTURING_PATTERNS)) {
    return {
      allowed: false,
      category: "weapons_manufacturing",
      confidence: "high",
      reason: "Weapons manufacturing instructions requested",
    };
  }

  // Harmful instructions (bombs, poisons, etc.)
  if (matchesAnyPattern(normalized, HARMFUL_INSTRUCTION_PATTERNS)) {
    return {
      allowed: false,
      category: "harmful_instructions",
      confidence: "high",
      reason: "Harmful or dangerous instruction request detected",
    };
  }

  // Drug manufacturing
  if (/\b(how to|recipe|synthesis|cook|produce)\b.*\b(meth|cocaine|heroin|fentanyl|lsd)\b/i.test(normalized)) {
    return {
      allowed: false,
      category: "drug_manufacturing",
      confidence: "high",
      reason: "Drug manufacturing instructions requested",
    };
  }

  // Hate speech
  if (matchesAnyPattern(normalized, HATE_SPEECH_PATTERNS)) {
    return {
      allowed: false,
      category: "hate_speech",
      confidence: "high",
      reason: "Hate speech or discrimination content detected",
    };
  }

  // Financial fraud
  if (/\b(how to|teach me to|steps to)\b.*\b(scam|phishing|ponzi|pyramid scheme|money laundering|identity theft)\b/i.test(normalized)) {
    return {
      allowed: false,
      category: "financial_fraud",
      confidence: "high",
      reason: "Financial fraud instructions requested",
    };
  }

  // Prompt injection — don't block, but flag and sanitize
  if (matchesAnyPattern(normalized, PROMPT_INJECTION_PATTERNS)) {
    return {
      allowed: true, // Allow but log — the model should resist
      category: "prompt_injection",
      confidence: "medium",
      reason: "Potential prompt injection detected — model should resist",
    };
  }

  // Personal data extraction
  if (matchesAnyPattern(normalized, PERSONAL_DATA_PATTERNS)) {
    return {
      allowed: false,
      category: "personal_data_leak",
      confidence: "medium",
      reason: "Request for personal data of identifiable individual",
    };
  }

  // Impersonation with harmful intent
  if (matchesAnyPattern(normalized, IMPERSONATION_PATTERNS)) {
    return {
      allowed: true,
      category: "impersonation",
      confidence: "low",
      reason: "Professional impersonation detected — proceed with caution",
    };
  }

  return { allowed: true, category: "safe", confidence: "high", reason: "No safety concerns detected" };
}

// ---------------------------------------------------------------------------
// OUTPUT SAFETY — screen model responses AFTER generation
// ---------------------------------------------------------------------------

const OUTPUT_UNSAFE_PATTERNS: Array<{ pattern: RegExp; category: SafetyCategory; issue: string }> = [
  { pattern: /\b(step \d+:.*(?:mix|combine|heat|dissolve).*(?:acid|base|compound|chemical|reagent).*(?:explosive|toxic|lethal|dangerous))\b/i, category: "harmful_instructions", issue: "Chemical synthesis instructions in output" },
  { pattern: /\b(?:wire|connect|attach).*(?:detonator|fuse|timer|trigger).*(?:explosive|bomb|device)\b/i, category: "weapons_manufacturing", issue: "Weapon assembly instructions in output" },
  { pattern: /\b(?:inject|consume|ingest|snort|smoke)\s+\d+\s*(?:mg|ml|g|grams?|milligrams?)\b/i, category: "drug_manufacturing", issue: "Specific drug dosage instructions in output" },
  { pattern: /\b(?:your|the)\s+(?:ssn|social security|aadhaar|pan)\s+(?:number|#)\s*(?:is|:)\s*\d/i, category: "personal_data_leak", issue: "Personal identification number in output" },
  { pattern: /\b(?:password|secret|api.?key|token)\s*(?:is|:)\s*\S{8,}/i, category: "personal_data_leak", issue: "Credential or secret in output" },
];

const OUTPUT_QUALITY_ISSUES: Array<{ pattern: RegExp; issue: string }> = [
  { pattern: /\b(I'm just an AI|I'm only a language model|I cannot provide|I'm not able to help with)\b/i, issue: "Unnecessary refusal in output" },
  { pattern: /\b(I don't have access to|I cannot browse|I cannot search)\b/i, issue: "False capability limitation claim" },
  { pattern: /\[INSERT|REPLACE_ME|TODO:|FIXME:|PLACEHOLDER\]/i, issue: "Template/placeholder text leaked into output" },
];

export function screenOutput(text: string): OutputSafetyVerdict {
  const issues: string[] = [];
  let category: SafetyCategory = "safe";

  for (const check of OUTPUT_UNSAFE_PATTERNS) {
    if (check.pattern.test(text)) {
      issues.push(check.issue);
      category = check.category;
    }
  }

  for (const check of OUTPUT_QUALITY_ISSUES) {
    if (check.pattern.test(text)) {
      issues.push(check.issue);
    }
  }

  return {
    safe: category === "safe",
    category,
    issues,
  };
}

// ---------------------------------------------------------------------------
// CRISIS RESPONSE — for self-harm detection
// ---------------------------------------------------------------------------

function buildCrisisResponse(): string {
  return [
    "🤗 *I hear you, and I want you to know that you matter.*",
    "",
    "If you're going through a difficult time, please reach out to someone who can help:",
    "",
    "🇮🇳 *India:*",
    "• iCall: 9152987821",
    "• Vandrevala Foundation: 1860-2662-345",
    "• AASRA: 9820466726",
    "",
    "🌍 *International:*",
    "• Crisis Text Line: Text HOME to 741741",
    "• International Association for Suicide Prevention: https://www.iasp.info/resources/Crisis_Centres/",
    "",
    "You are not alone. Things can get better. 💙",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// BLOCKED RESPONSE BUILDERS — safe refusal messages
// ---------------------------------------------------------------------------

export function buildSafeRefusal(verdict: SafetyVerdict): string {
  switch (verdict.category) {
    case "self_harm":
      return verdict.sanitizedInput ?? buildCrisisResponse();

    case "harmful_instructions":
    case "weapons_manufacturing":
    case "drug_manufacturing":
      return "⚠️ I can't help with that request as it involves potentially dangerous or harmful activities. I'm here to help with safe, constructive, and legal questions across any topic. What else can I help you with?";

    case "hate_speech":
      return "⚠️ I can't generate content that promotes hatred or discrimination against any group. I'm happy to help with respectful discussions about culture, history, society, and diversity.";

    case "financial_fraud":
      return "⚠️ I can't provide instructions for fraudulent or illegal financial activities. I can help with legitimate financial planning, investing strategies, and understanding financial regulations.";

    case "personal_data_leak":
      return "⚠️ I can't provide personal identification data of specific individuals. I can help with general information about documents, procedures, and regulations.";

    case "sexual_explicit":
      return "⚠️ I can't generate explicit sexual content. I'm happy to discuss relationships, health, and biology in an educational context.";

    default:
      return "⚠️ I can't process that specific request, but I'm ready to help with virtually any other question across science, technology, finance, health, law, history, and more!";
  }
}

// ---------------------------------------------------------------------------
// SANITIZE — clean potential issues from model output
// ---------------------------------------------------------------------------

export function sanitizeOutput(text: string): string {
  let result = text;

  // Remove any accidentally leaked API keys or tokens
  result = result.replace(/\b(sk-[a-zA-Z0-9]{20,}|nvapi-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{20,}|xoxb-[a-zA-Z0-9-]+)\b/g, "[REDACTED]");

  // Remove accidentally leaked email addresses in sensitive contexts
  // (keep emails that are part of code examples or technical discussion)
  result = result.replace(/\b(password|secret|credential)s?\s*(?:is|are|:)\s*\S+/gi, "$1: [REDACTED]");

  return result;
}
