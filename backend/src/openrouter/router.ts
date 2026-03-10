import {
  FALLBACK_MODEL_ID,
  FORCE_OPENROUTER_FREE_ONLY_MODE,
  MODEL_REGISTRY,
  resolveModelFromKey,
} from "./models.js";

export type Intent =
  | "coding"
  | "math"
  | "general"
  | "current_events";

export type ProfessionalIntent =
  | "greeting"
  | "casual_conversation"
  | "capability_question"
  | "technical_question"
  | "coding_request"
  | "follow_up"
  | "clarification"
  | "problem_solving"
  | "opinion_request"
  | "unclear";

const PROFESSIONAL_INTENT_LABELS: Record<ProfessionalIntent, string> = {
  greeting: "Greeting",
  casual_conversation: "Casual Conversation",
  capability_question: "Capability Question",
  technical_question: "Technical Question",
  coding_request: "Coding Request",
  follow_up: "Follow Up",
  clarification: "Clarification",
  problem_solving: "Problem Solving",
  opinion_request: "Opinion Request",
  unclear: "Unclear",
};

type NormalizedIncomingMessage = {
  normalizedText: string;
  loweredText: string;
  corrected: boolean;
  corrections: string[];
};

const INCOMING_SHORTHAND_FIXES: Array<{ pattern: RegExp; replacement: string; label: string }> = [
  { pattern: /\bcn\b/g, replacement: "can", label: "cn->can" },
  { pattern: /\bu\b/g, replacement: "you", label: "u->you" },
  { pattern: /\bmk\b/g, replacement: "make", label: "mk->make" },
  { pattern: /\bfr\b/g, replacement: "for", label: "fr->for" },
  { pattern: /\btg\b/g, replacement: "telegram", label: "tg->telegram" },
  { pattern: /\bwat\b/g, replacement: "what", label: "wat->what" },
  { pattern: /\babt\b/g, replacement: "about", label: "abt->about" },
  { pattern: /\bdat\b/g, replacement: "that", label: "dat->that" },
  { pattern: /\br u\b/g, replacement: "are you", label: "r u->are you" },
  { pattern: /\bcuz\b/g, replacement: "because", label: "cuz->because" },
];

const TYPO_CORRECTIONS: Record<string, string> = {
  waht: "what",
  whta: "what",
  teh: "the",
  pyhton: "python",
  typscript: "typescript",
  javascritp: "javascript",
  codee: "code",
  coddde: "code",
  programing: "programming",
  canu: "can you",
  frnd: "friend",
};

const fixTypos = (input: string): string =>
  String(input || "").replace(/\b[a-z][a-z0-9_-]*\b/gi, (token) => {
    const corrected = TYPO_CORRECTIONS[token.toLowerCase()];
    return corrected || token;
  });

export const normalizeIncomingUserMessage = (text: string): NormalizedIncomingMessage => {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) {
    return {
      normalizedText: "",
      loweredText: "",
      corrected: false,
      corrections: [],
    };
  }

  const lowered = raw.toLowerCase();
  let normalized = lowered;
  const corrections: string[] = [];

  for (const fix of INCOMING_SHORTHAND_FIXES) {
    const next = normalized.replace(fix.pattern, fix.replacement);
    if (next !== normalized) {
      normalized = next;
      corrections.push(fix.label);
    }
  }

  const typoFixed = fixTypos(normalized);
  if (typoFixed !== normalized) {
    normalized = typoFixed;
    corrections.push("typo_correction");
  }

  normalized = normalized.replace(/\s+/g, " ").trim();

  return {
    normalizedText: normalized || lowered,
    loweredText: lowered,
    corrected: corrections.length > 0,
    corrections,
  };
};

const isGreetingPrompt = (text: string): boolean =>
  /^(hi|hello|hey|hii|yo|good morning|good afternoon|good evening)\b/i.test(text);

const isCasualConversationPrompt = (text: string): boolean =>
  /^(thanks|thank you|ok|okay|cool|nice|great|awesome|lol|haha|hmm|hmmm|yo|sup|good night|bye|see you)\b/i.test(text);

const isClarificationPrompt = (text: string): boolean =>
  /\b(clarify|what do you mean|which one|can you clarify|please clarify|explain that part|did you mean|what exactly|more clear)\b/i.test(text);

const isOpinionRequestPrompt = (text: string): boolean =>
  /\b(what do you think|your opinion|do you think|is it better|which is better|recommend|should i|would you choose|pros and cons)\b/i.test(text);

const isProblemSolvingPrompt = (text: string): boolean =>
  /\b(error|issue|problem|not working|does not work|doesn't work|fails?|failing|failed|crash|stuck|cannot|can't|unable to|troubleshoot|fix this|why is this broken)\b/i.test(text);

const isCapabilityQuestionPrompt = (text: string): boolean => {
  const value = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!value) return false;
  if (/\b(write|generate|create|build|implement|fix|debug|refactor|optimize)\b/.test(value) && /\b(code|script|api|function|class|program|bot)\b/.test(value)) {
    return false;
  }
  return /\b(what can you do|what do you do|capabilities|your capabilities|do you know coding|can you code|can you do coding|what kind of code can you do|what type of code can you do|which programming languages|what languages can you|languages do you support|can you help with coding)\b/.test(value)
    || (/^(do you|can you)\b/.test(value) && /\b(code|coding|program)\b/.test(value) && !/\b(write|generate|create|build|implement|fix|debug)\b/.test(value));
};

const isCodingImplementationRequest = (text: string): boolean => {
  const value = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!value || isCapabilityQuestionPrompt(value)) return false;
  const explicitRequest =
    /\b(write|generate|create|build|make|implement|debug|fix|refactor|optimize|convert|show|give|provide)\b/.test(value)
    && /\b(code|script|function|class|api|endpoint|bot|query|algorithm|program|module|component|sql|regex|logic)\b/.test(value);
  const implementationPhrase =
    /\b(generate code|write (?:a|an)?\s*(python|javascript|typescript|java|c\+\+|c#|go|rust|php|ruby|swift|kotlin)?\s*(script|program|function|class|api|bot)|create implementation|code for|implement this|implement that)\b/.test(value);
  const syntaxSignals = /```|#include\s*<|def\s+\w+\s*\(|class\s+\w+|function\s+\w+\s*\(|public\s+class\s+\w+/.test(value);
  return explicitRequest || implementationPhrase || (syntaxSignals && !isCapabilityQuestionPrompt(value));
};

const isMathLikePrompt = (text: string): boolean =>
  /\b(math|algebra|calculus|equation|differentiate|integrate|solve|probability|statistics|matrix|derive)\b|[0-9]+\s*[\+\-*/]\s*[0-9]+/i.test(text);

const isCurrentEventsPrompt = (text: string): boolean =>
  /\b(news|latest|today|yesterday|breaking|current events|what happened|stock today|election today|as of)\b/i.test(text);

const isFollowUpReferencePrompt = (text: string): boolean => {
  const value = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!value) return false;
  return /^(that|it|this|what about that|what about this|about that|about this|more|explain more|continue|go on|and that one|wat about that|wat abt dat|dat one)$/i.test(value)
    || /\b(previous|last|above|earlier|that one|this one|same one)\b/.test(value);
};

const isTechnicalQuestionPrompt = (text: string): boolean => {
  const value = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!value) return false;
  const technicalSignals =
    /\b(api|database|server|backend|frontend|docker|kubernetes|cloud|linux|network|http|https|oauth|jwt|cache|queue|microservice|architecture|typescript|javascript|python|java|c\+\+|sql|redis|postgres|mongodb|deployment|devops)\b/.test(value);
  const questionSignals = /\b(what|why|how|when|where|which|explain|difference|compare|best practice)\b/.test(value) || /\?$/.test(value);
  return technicalSignals && questionSignals;
};

const looksUnclearPrompt = (text: string, hasHistory: boolean): boolean => {
  const value = String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!value) return true;
  if (isGreetingPrompt(value) || isCasualConversationPrompt(value)) return false;
  if (isCapabilityQuestionPrompt(value) || isCodingImplementationRequest(value)) return false;
  if (isProblemSolvingPrompt(value) || isOpinionRequestPrompt(value) || isClarificationPrompt(value)) return false;
  if (isMathLikePrompt(value) || isCurrentEventsPrompt(value) || isTechnicalQuestionPrompt(value)) return false;

  const tokenCount = value.split(/\s+/).filter(Boolean).length;
  if (tokenCount <= 2 && !/^(hi|hello|hey|ok|okay|thanks|yes|no)$/.test(value)) {
    return true;
  }
  if (!hasHistory && /\b(this|that|it|these|those|dat)\b/.test(value) && tokenCount <= 8) {
    return true;
  }
  return false;
};

export const classifyProfessionalIntent = (
  text: string,
  hasHistory = false,
): ProfessionalIntent => {
  const normalized = normalizeIncomingUserMessage(text);
  const value = normalized.normalizedText || normalized.loweredText;
  if (!value) return "unclear";

  if (hasHistory && isFollowUpReferencePrompt(value)) return "follow_up";
  if (isGreetingPrompt(value)) return "greeting";
  if (isCapabilityQuestionPrompt(value)) return "capability_question";
  if (isCodingImplementationRequest(value)) return "coding_request";
  if (isProblemSolvingPrompt(value)) return "problem_solving";
  if (isClarificationPrompt(value)) return "clarification";
  if (isOpinionRequestPrompt(value)) return "opinion_request";
  if (isTechnicalQuestionPrompt(value)) return "technical_question";
  if (isCasualConversationPrompt(value)) return "casual_conversation";
  if (looksUnclearPrompt(value, hasHistory)) return "unclear";
  return "casual_conversation";
};

export const mapProfessionalIntentToRuntimeIntent = (
  intent: ProfessionalIntent,
  text: string,
): Intent => {
  const value = String(text || "").toLowerCase();
  if (isMathLikePrompt(value)) return "math";
  if (isCurrentEventsPrompt(value)) return "current_events";
  if (intent === "coding_request") return "coding";
  return "general";
};

export const detectIntent = (text: string): Intent =>
  mapProfessionalIntentToRuntimeIntent(classifyProfessionalIntent(text, false), text);

export const buildIntentRoutingInstruction = (intent: ProfessionalIntent): string => {
  const label = PROFESSIONAL_INTENT_LABELS[intent] || PROFESSIONAL_INTENT_LABELS.technical_question;
  if (intent === "coding_request") {
    return `Intent classification: ${label}\nRouting rule:\n- User explicitly asked for implementation. Provide production-quality code and a concise explanation.`;
  }
  if (intent === "capability_question") {
    return `Intent classification: ${label}\nRouting rule:\n- Explain capabilities and supported areas only.\n- Do not generate sample code unless the user explicitly asks for implementation.`;
  }
  if (intent === "follow_up") {
    return `Intent classification: ${label}\nRouting rule:\n- Continue from recent conversation context.\n- Do not treat this as a new unrelated question.`;
  }
  if (intent === "clarification" || intent === "unclear") {
    return `Intent classification: ${label}\nRouting rule:\n- Ask one concise clarifying question.\n- Do not guess missing intent details.`;
  }
  if (intent === "problem_solving") {
    return `Intent classification: ${label}\nRouting rule:\n- Diagnose likely root cause first.\n- Provide practical resolution steps and verification checks.`;
  }
  if (intent === "opinion_request") {
    return `Intent classification: ${label}\nRouting rule:\n- Provide a balanced opinion with reasoning and trade-offs.`;
  }
  if (intent === "greeting" || intent === "casual_conversation") {
    return `Intent classification: ${label}\nRouting rule:\n- Reply naturally in concise conversational tone.\n- Avoid repetitive canned greetings.`;
  }
  return `Intent classification: ${label}\nRouting rule:\n- Give a direct technical answer with clear structure and practical details.`;
};

export type RoutedModel = {
  modelId: string;
  modelKey: string;
  temperature: number;
  maxTokens: number;
  autoRouted: boolean;
};

export const routeModel = (
  selectedModelKey: string | null | undefined,
  intent: Intent,
): RoutedModel => {
  const selected = resolveModelFromKey(selectedModelKey);

  if (selected && selected.key !== "auto") {
    return {
      modelId: selected.id,
      modelKey: selected.key,
      temperature: selected.temperature,
      maxTokens: selected.maxTokens,
      autoRouted: false,
    };
  }

  if (selectedModelKey && !selected && selectedModelKey !== "auto") {
    return {
      modelId: selectedModelKey,
      modelKey: "custom",
      temperature: 0.4,
      maxTokens: 1200,
      autoRouted: false,
    };
  }

  if (intent === "coding") {
    const model = MODEL_REGISTRY.code;
    return {
      modelId: model.id,
      modelKey: model.key,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      autoRouted: true,
    };
  }

  if (intent === "math") {
    const model = MODEL_REGISTRY.math;
    return {
      modelId: model.id,
      modelKey: model.key,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      autoRouted: true,
    };
  }

  if (intent === "current_events") {
    const model = FORCE_OPENROUTER_FREE_ONLY_MODE
      ? MODEL_REGISTRY.smart
      : MODEL_REGISTRY.fast;
    return {
      modelId: model.id,
      modelKey: model.key,
      temperature: 0.2,
      maxTokens: model.maxTokens,
      autoRouted: true,
    };
  }

  const model = MODEL_REGISTRY.fast;
  return {
    modelId: model.id || FALLBACK_MODEL_ID,
    modelKey: model.key,
    temperature: model.temperature,
    maxTokens: model.maxTokens,
    autoRouted: true,
  };
};

export const currentEventsDisclaimer =
  "I do not have live web browsing in this setup. I can still help with background context and likely scenarios based on known information.";
