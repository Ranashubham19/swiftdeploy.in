import { completeClawCloudPrompt, type IntentType } from "@/lib/clawcloud-ai";
import {
  isCompleteIndiaConsumerPriceAnswer,
  looksLikeConsumerStaplePriceQuestion,
} from "@/lib/clawcloud-india-consumer-prices";
import {
  detectRetailFuelPriceQuestion,
  isCompleteRetailFuelAnswer,
} from "@/lib/clawcloud-retail-prices";
import {
  detectWorldBankCountryMetricQuestion,
  extractRichestRankingScope,
  isCompleteCountryMetricAnswer,
  shouldUseLiveSearch,
} from "@/lib/clawcloud-live-search";
import { detectAiModelRoutingDecision } from "@/lib/clawcloud-ai-model-routing";
import { extractExplicitQuestionYear, hasPastYearScope } from "@/lib/clawcloud-time-scope";
import {
  buildClawCloudReplyLanguageInstruction,
  inferClawCloudMessageLocale,
  localeNames,
  resolveClawCloudReplyLanguage,
  translateMessage,
} from "@/lib/clawcloud-i18n";
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

const SCIENTIFIC_LAW_CONTEXT_PATTERNS = [
  /\b(?:physical|scientific|natural|fundamental)\s+laws?\b/i,
  /\blaws?\s+of\s+(?:physics|nature|motion|thermodynamics|the universe|quantum mechanics|general relativity)\b/i,
  /\bgoverning the universe\b/i,
];

const SCIENCE_RESEARCH_PATTERNS = [
  /\b(quantum|relativity|physics|cosmology|thermodynamics|consciousness|decoherence|uncertainty principle|g[oö]del|chaos theory|computability|uncomputable|fixed-point|infinite regress|logical inconsistency|self-model(?:ing)?|simulate the universe|simulation hypothesis)\b/i,
];

const FINANCE_ADVICE_PATTERNS = [
  /\b(should i invest|where should i invest|which stock|which mutual fund|which sip|should i buy|should i sell|stock pick|portfolio advice|good investment|retirement plan|safe return|guaranteed return)\b/i,
  /\b(should i hold|is this a good stock|best stock to buy|best crypto to buy)\b/i,
];

const LIVE_EVIDENCE_PATTERNS = [
  /\blive data as of\b/i,
  /\bdata fetched:\s*/i,
  /\bsource note:\s*/i,
  /\bsearched:\s*/i,
  /\bsources?:\s*/i,
  /\bpublished:\s*/i,
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
  /\bwithout better grounding\b/i,
  /\b(?:the )?(?:answer|response) path took too long to complete reliably\b/i,
  /\buncertain\b/i,
];

const LIVE_REFUSAL_PATTERNS = [
  /\bno strong live sources found\b/i,
  /\bcould(?: not|n't) verify one precise current figure\b/i,
  /\bclosest reliable signals\b/i,
  /\bbest next step\b/i,
  /\blive search unavailable\b/i,
  /\bhaving trouble fetching live sources right now\b/i,
  /\bcould not verify enough reliable live sources\b/i,
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

const TOPIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "answer",
  "book",
  "detail",
  "detailed",
  "drama",
  "english",
  "explain",
  "explained",
  "explanation",
  "film",
  "full",
  "give",
  "in",
  "korean",
  "me",
  "movie",
  "of",
  "please",
  "plot",
  "season",
  "series",
  "show",
  "story",
  "summary",
  "tell",
  "the",
  "to",
  "what",
]);

const IRRELEVANT_ASSISTANT_LEAK_PATTERNS = [
  /\bclawcloud ai\b/i,
  /\bhelp with math, code, health, and legal questions\b/i,
  /\bprofessional and reliable service\b/i,
  /\bfeatures and benefits\b/i,
  /\bexplore its features\b/i,
  /\bget started with the service\b/i,
  /\bi can help you with\b/i,
  /\bask me anything\b/i,
  /\bwhat can i help you with\b/i,
  /\bpick one angle\b/i,
  /\b(beginner version|advanced technical version)\b/i,
  /\bwhat's your question\b/i,
];

const PROMPT_LEAK_PATTERNS = [
  /\byou are being asked to\b/i,
  /\boriginal user prompt\b/i,
  /\bromanized reading\b/i,
  /\benglish meaning\b/i,
  /\banswer the question described by the english meaning\b/i,
  /\bthe user wrote in\b/i,
  /\brespond in [a-z][a-z\s-]*, not in english\b/i,
  /\breturn only the english translation\b/i,
  /\bpreserving the original tone and formatting\b/i,
  /\bno exceptions or refusals based on the text'?s content or language\b/i,
  /\btask:\s*understand what the user is asking\b/i,
  /\bdo not ask for clarification\b/i,
  /\buse the english translation only to understand the question\b/i,
  /\btranslate the romanized\b/i,
];

const WRONG_MODE_TRANSLATION_PATTERNS = [
  /\bhere(?:'s| is) the translation\b/i,
  /\bdirect translation\b/i,
  /\bthe (?:provided|source) text is already in\b/i,
  /\byou(?:'ve| have) already provided the text in\b/i,
  /\balready in (?:korean|english|hindi|japanese|chinese|spanish|french|arabic)\b/i,
  /\bthere is no need for translation\b/i,
  /\bthe text remains as is\b/i,
  /\bif you'd like, i can help\b/i,
  /\bprovide more context\b/i,
  /\bplease let me know how i can assist\b/i,
  ...PROMPT_LEAK_PATTERNS,
];

const WRONG_MODE_STORY_CLARIFICATION_PATTERNS = [
  /\bshare the topic, tone, and target length\b/i,
  /\bwrite the complete piece directly\b/i,
  /\bwhat tone\b/i,
  /\btarget length\b/i,
  /\bcreative writing\b/i,
];

const WRONG_LANGUAGE_REPLY_PATTERNS = [
  /\bhere(?:'s| is) (?:the|your|a) (?:answer|reply|response) in\b/i,
  /\bi'll respond in\b/i,
  /\blet me answer (?:in|that in)\b/i,
  /\bswitching to\b/i,
  /\btranslating (?:my|the) (?:response|answer|reply)\b/i,
];

const PLACEHOLDER_TEMPLATE_PATTERNS = [
  /\[task\]/i, /\[time\]/i, /\[city\]/i, /\[name\]/i,
  /\[date\]/i, /\[location\]/i, /\[topic\]/i, /\[subject\]/i,
  /\[amount\]/i, /\[recipient\]/i, /\[email\]/i, /\[phone\]/i,
];

const GMAIL_QUALITY_PATTERNS = [
  /\braw html\b/i, /\b<div\b/i, /\b<table\b/i, /\b<span\b/i,
  /\bcontent-type:\s*text\/html/i,
];

const CALENDAR_QUALITY_PATTERNS = [
  /\bevent created at \[/i, /\breminder set for \[/i,
  /\btimezone not specified\b/i, /\bcould not parse the date\b/i,
  /\binvalid date format\b/i,
];

const WEATHER_QUALITY_PATTERNS = [
  /\bweather data (?:is )?unavailable\b/i,
  /\bcould not (?:fetch|get|retrieve) weather\b/i,
  /\bno weather information\b/i,
  /\bweather service (?:is )?(?:down|unavailable)\b/i,
];

function matchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function looksLikeHelpOrCapabilityQuestion(question: string) {
  return (
    /\b(help|what can you do|capabilities|features|how can you help|who are you|what are you)\b/i.test(question)
    || /\bclawcloud\b/i.test(question)
  );
}

function looksLikeStoryOrCultureQuestion(question: string) {
  return (
    /[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/u.test(question)
    || /\b(story|plot|storyline|summary|synopsis|ending|season|episode|character|drama|movie|film|series|show|anime|novel|book|tell me about|story of|plot of|summary of)\b/i.test(question)
  );
}

function looksLikeScienceOrResearchQuestion(question: string, intent: string, category: string) {
  return (
    /^(?:science|research)$/i.test(intent)
    || /^(?:science|research)$/i.test(category)
    || matchesAny(question, SCIENCE_RESEARCH_PATTERNS)
    || matchesAny(question, SCIENTIFIC_LAW_CONTEXT_PATTERNS)
  );
}

function looksLikeFreshnessSensitiveTechQuestion(question: string) {
  if (!question.trim() || hasPastYearScope(question)) {
    return false;
  }

  if (detectAiModelRoutingDecision(question)?.mode === "web_search") {
    return true;
  }

  return (
    /\b(latest|current|newest|right now|today|released?|release(?: date)?|launch(?:ed)?|announced?|availability|price|pricing|cost|features?|specs?|specifications?)\b/i.test(question)
    && (
      /\b(gpt|chatgpt|claude|gemini|grok|llama|deepseek|mistral|openai|anthropic|deepmind|google)\b/i.test(question)
      || /\b(iphone|samsung|galaxy|pixel|oneplus)\b/i.test(question)
      || /\bs\d{2}\s*ultra\b/i.test(question)
      || /\bs\d{2}\s*pro\b/i.test(question)
    )
  );
}

function requiresFreshLiveGroundingQuestion(question: string, category: string) {
  return category === "news"
    || category === "web_search"
    || shouldUseLiveSearch(question)
    || looksLikeFreshnessSensitiveTechQuestion(question);
}

function looksLikeLegalQuestion(question: string, intent: string, category: string) {
  if (intent === "law" || category === "law") {
    return true;
  }

  if (
    looksLikeScienceOrResearchQuestion(question, intent, category)
    && matchesAny(question, SCIENTIFIC_LAW_CONTEXT_PATTERNS)
  ) {
    return false;
  }

  return matchesAny(question, LEGAL_PATTERNS);
}

function normalizeExistingStoryWorkCandidate(candidate: string) {
  return candidate
    .replace(
      /\s+(?:and|&|plus|as)\s+(?:is|was|does|did|can|could|will|would|should|what|who|when|where|why|how)\b[\s\S]*$/i,
      "",
    )
    .replace(/\b(?:is|was)\s+it\s+based\s+on\s+true\s+events?\b[\s\S]*$/i, "")
    .replace(/\b(?:is|was)\s+it\s+(?:a\s+)?true\s+story\b[\s\S]*$/i, "")
    .replace(/\b(?:is|was)\s+it\s+real\b[\s\S]*$/i, "")
    .replace(/\b(?:did|does)\s+it\s+really\s+happen\b[\s\S]*$/i, "")
    .replace(/\b(?:ending|plot|summary|synopsis)\s+explained\b[\s\S]*$/i, "")
    .replace(/[,:-]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExistingStoryWorkCandidate(question: string) {
  const normalized = question
    .replace(/\b(?:in|into)\s+(?:english|korean|hindi|spanish|french|arabic|japanese|chinese|russian|portuguese|german|turkish|indonesian|malay|swahili|dutch|polish|punjabi|tamil|telugu|kannada|bengali|marathi|gujarati)\b[.!?]*$/i, "")
    .trim();

  const patterns = [
    /(?:tell me (?:the )?(?:story|plot|summary|synopsis|ending) of|story of|plot of|summary of|synopsis of|ending of)\s+(.+?)(?:\?|$)/i,
    /(?:what(?:'s| is) the (?:story|plot|summary|synopsis|ending) of)\s+(.+?)(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const candidate = normalizeExistingStoryWorkCandidate(normalized.match(pattern)?.[1]?.trim() ?? "");
    if (candidate) {
      return candidate;
    }
  }

  return "";
}

function looksLikeExistingStorySummaryQuestion(question: string) {
  const normalized = question.toLowerCase().trim();
  if (!normalized || /^(?:write|create|compose|generate|draft)\b/.test(normalized)) {
    return false;
  }

  if (!looksLikeStoryOrCultureQuestion(question)) {
    return false;
  }

  return (
    Boolean(extractExistingStoryWorkCandidate(question))
    || /\b(drama|movie|film|series|show|anime|novel|book|webtoon)\b/i.test(question)
  );
}

function normalizeTopicToken(token: string) {
  return token
    .normalize("NFKC")
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

function isGenericTopicToken(token: string) {
  if (!token) {
    return true;
  }

  if (TOPIC_STOP_WORDS.has(token)) {
    return true;
  }

  const genericKoreanToken = /^(?:\uc904\uac70\ub9ac|\uc2a4\ud1a0\ub9ac|\ub0b4\uc6a9|\uacb0\ub9d0|\uc694\uc57d|\uc124\uba85|\uc124\uba85\ud574\uc918|\uc790\uc138\ud788|\ud55c\uad6d\uc5b4|\uc2dc\uc98c|\uc5d0\ud53c\uc18c\ub4dc)$/u;
  if (genericKoreanToken.test(token)) {
    return true;
  }

  return (
    /^(story|plot|summary|ending|explain|korean|english|detailed|detail|answer|please)$/i.test(token)
    || /^(줄거리|스토리|내용|결말|요약|설명|설명해줘|자세히|한국어|시즌|에피소드)$/u.test(token)
  );
}

function extractTopicSignals(text: string) {
  const rawTokens = text.match(/[\p{L}\p{M}][\p{L}\p{M}\p{N}'’-]{1,}/gu) ?? [];
  const unique = new Set<string>();
  for (const token of rawTokens) {
    const normalized = normalizeTopicToken(token);
    if (!normalized || isGenericTopicToken(normalized)) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique].slice(0, 8);
}

function looksLikeTopicAnchoredQuestion(question: string) {
  return (
    /[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/u.test(question)
    || /\b(story|plot|summary|synopsis|ending|season|episode|character|drama|movie|film|series|show|anime|novel|book|tell me about|explain)\b/i.test(question)
  );
}

function looksLikeIrrelevantAssistantLeak(question: string, answer: string) {
  if (looksLikeHelpOrCapabilityQuestion(question)) {
    return false;
  }

  return matchesAny(answer, IRRELEVANT_ASSISTANT_LEAK_PATTERNS)
    || looksLikeInstructionLeakReply(answer);
}

export function looksLikeInstructionLeakReply(answer: string) {
  return answer.trim() ? matchesAny(answer.trim(), PROMPT_LEAK_PATTERNS) : false;
}

export function looksLikePlaceholderTemplateReply(answer: string) {
  return answer.trim() ? matchesAny(answer.trim(), PLACEHOLDER_TEMPLATE_PATTERNS) : false;
}

export function looksLikeWrongLanguageReply(answer: string) {
  return answer.trim() ? matchesAny(answer.trim(), WRONG_LANGUAGE_REPLY_PATTERNS) : false;
}

export function looksLikeRawGmailContent(answer: string) {
  return answer.trim() ? matchesAny(answer.trim(), GMAIL_QUALITY_PATTERNS) : false;
}

export function looksLikeBrokenCalendarReply(answer: string) {
  return answer.trim() ? matchesAny(answer.trim(), CALENDAR_QUALITY_PATTERNS) : false;
}

export function looksLikeWeatherFailure(answer: string) {
  return answer.trim() ? matchesAny(answer.trim(), WEATHER_QUALITY_PATTERNS) : false;
}

function looksLikeExplicitScopeBleed(question: string, answer: string) {
  const rankingScope = extractRichestRankingScope(question);
  if (!rankingScope || rankingScope === "mixed") {
    return false;
  }

  const hasPeopleSection = /\btop richest people by live net worth\b/i.test(answer);
  const hasCitiesSection = /\btop wealthiest cities by resident millionaires\b/i.test(answer);

  if (rankingScope === "cities" && hasPeopleSection) {
    return true;
  }

  if (rankingScope === "people" && hasCitiesSection) {
    return true;
  }

  return false;
}

function isSingleRichestPersonQuestion(question: string) {
  const normalized = question.toLowerCase();
  if (extractRichestRankingScope(question) !== "people") {
    return false;
  }

  if (/\btop\s*\d+\b/i.test(normalized)) {
    return false;
  }

  if (/\b(people|persons|billionaires?|list|ranking|rankings?|leaderboard)\b/i.test(normalized)) {
    return false;
  }

  return /\b(richest|wealthiest)\b/i.test(normalized);
}

function isCompleteRichestRankingAnswer(question: string, answer: string) {
  const rankingScope = extractRichestRankingScope(question);
  if (!rankingScope) {
    return true;
  }

  const hasFreshnessLine = /\bas of\b/i.test(answer) && /\b20\d{2}\b/.test(answer);
  const hasRichListSource = /\bforbes\b|\bbloomberg\b/i.test(answer);
  const hasHenleySource = /\bhenley\b|\bhenleyglobal\.com\b/i.test(answer);
  const hasPeopleSection = /\btop richest people by live net worth\b/i.test(answer);
  const hasCitiesSection = /\btop wealthiest cities by resident millionaires\b/i.test(answer);
  const hasSinglePersonLead = /\bcurrent richest person in the world\b/i.test(answer);
  const hasWorthFigure = /\$\d[\d,.]*\s*B\b/i.test(answer);

  if (rankingScope === "people") {
    if (isSingleRichestPersonQuestion(question)) {
      return hasFreshnessLine && hasRichListSource && hasSinglePersonLead && hasWorthFigure;
    }

    return hasFreshnessLine && hasRichListSource && hasPeopleSection;
  }

  if (rankingScope === "cities") {
    return hasCitiesSection && hasHenleySource;
  }

  return hasFreshnessLine && hasRichListSource && hasHenleySource && hasPeopleSection && hasCitiesSection;
}

export function looksLikeQuestionTopicMismatch(question: string, answer: string) {
  const trimmedAnswer = answer.trim();
  if (!trimmedAnswer) {
    return true;
  }

  if (matchesAny(trimmedAnswer, LOW_CONFIDENCE_PATTERNS) || matchesAny(trimmedAnswer, LIVE_REFUSAL_PATTERNS)) {
    return false;
  }

  if (looksLikeIrrelevantAssistantLeak(question, trimmedAnswer)) {
    return true;
  }

  if (looksLikeExplicitScopeBleed(question, trimmedAnswer)) {
    return true;
  }

  const topicSignals = extractTopicSignals(question);
  if (!topicSignals.length || !looksLikeTopicAnchoredQuestion(question)) {
    return false;
  }

  const normalizedAnswer = trimmedAnswer.normalize("NFKC").toLowerCase();
  const hitCount = topicSignals.filter((signal) => normalizedAnswer.includes(signal)).length;
  if (/[\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff]/u.test(question)) {
    return hitCount === 0;
  }

  return hitCount === 0 && trimmedAnswer.length > 120;
}

export function looksLikeWrongModeAnswer(question: string, answer: string) {
  const trimmedAnswer = answer.trim();
  if (!trimmedAnswer) {
    return false;
  }

  if (!looksLikeStoryOrCultureQuestion(question)) {
    return false;
  }

  return (
    matchesAny(trimmedAnswer, WRONG_MODE_TRANSLATION_PATTERNS)
    || (
      looksLikeExistingStorySummaryQuestion(question)
      && matchesAny(trimmedAnswer, WRONG_MODE_STORY_CLARIFICATION_PATTERNS)
    )
  );
}

function looksLikeClearDirectQuestion(question: string) {
  const normalized = question.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  const detectedLocale = inferClawCloudMessageLocale(question);
  if (detectedLocale && detectedLocale !== "en") {
    return question.trim().split(/\s+/).filter(Boolean).length >= 4;
  }

  if (looksLikeExistingStorySummaryQuestion(question)) {
    return true;
  }

  if (
    /\b(compare|difference between|vs\.?|versus|translate|translation|summarize|summary of|story of|plot of|solve|calculate|design)\b/i.test(question)
  ) {
    return true;
  }

  if (
    /^(?:what(?:'s| is| are)?|why|how|who|when|where|which|define|explain|describe|tell me|give me|write|draft|create|design|solve|calculate|summarize)\b/i.test(normalized)
    && !/^(?:what about|how about|why that|why it|and|also)\b/i.test(normalized)
  ) {
    return normalized.split(/\s+/).filter(Boolean).length >= 4;
  }

  return false;
}

export function shouldAttemptDirectAnswerRecovery(
  question: string,
  profile: ClawCloudAnswerQualityProfile,
) {
  if (!looksLikeClearDirectQuestion(question)) {
    return false;
  }

  if (profile.requiresLiveGrounding || profile.isHighStakes || profile.isDocumentBound) {
    return false;
  }

  return /^(?:coding|math|creative|explain|culture|language|technology|science|research|general)$/i.test(profile.intent);
}

export async function recoverDirectAnswer(input: {
  question: string;
  answer: string;
  intent: IntentType;
  failureReason?: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  extraInstruction?: string;
}) {
  const replyLanguageResolution = resolveClawCloudReplyLanguage({
    message: input.question,
    preferredLocale: "en",
  });
  const questionLocale = inferClawCloudMessageLocale(input.question);
  const englishGloss =
    questionLocale && questionLocale !== "en"
      ? (await translateMessage(input.question, "en", { force: true }).catch(() => "")).trim()
      : "";
  const normalizedQuestion = (
    englishGloss
    && englishGloss.toLowerCase() !== input.question.trim().toLowerCase()
    && inferClawCloudMessageLocale(englishGloss) === "en"
  )
    ? englishGloss
    : input.question;
  const localeAwareInstruction =
    questionLocale && questionLocale !== "en"
      ? [
        `The original user question is in ${localeNames[questionLocale]}.`,
        buildClawCloudReplyLanguageInstruction(replyLanguageResolution),
        "Understand the original question in that language and answer it directly instead of falling back to a clarification prompt.",
      ].join("\n")
      : buildClawCloudReplyLanguageInstruction(replyLanguageResolution);
  const modeHint = looksLikeExistingStorySummaryQuestion(normalizedQuestion)
    ? "This is a request for the story or plot of an existing work. Summarize the actual story directly, not a new original piece."
    : /\b(?:translate|translation)\b/i.test(normalizedQuestion)
      ? "This is a translation request. Return the translation directly in the requested target language."
      : /\b(?:explain|what is|what are|why|how|difference between|compare|vs\.?|versus)\b/i.test(normalizedQuestion)
        ? "This is a direct explanation request. Answer clearly and concretely instead of offering a menu or asking for extra framing."
        : "Answer the user's request directly in the most likely intended mode.";

  const repaired = await completeClawCloudPrompt({
    system: [
      "You are the direct-answer recovery layer for ClawCloud AI — the world's most capable AI assistant.",
      "The first draft did not produce a reliable final answer. Your job is to deliver the correct, authoritative answer.",
      "Recover by answering the user's original request directly, completely, and accurately.",
      "Do not mention the failed draft, the pipeline, or internal limitations.",
      "Do not ask for clarification unless the question is still genuinely ambiguous even after using the provided chat history.",
      "If the likely interpretation is clear, answer that interpretation with full confidence and specificity.",
      "Lead with the direct answer in the first sentence. No preamble, no filler.",
      "Be precise: use real names, numbers, dates, specific facts — not vague references.",
      "Self-verify: check your answer for internal consistency before responding.",
      "Preserve any requested output language or format.",
      localeAwareInstruction,
      modeHint,
      input.failureReason ? `Recovery context: ${input.failureReason}` : "",
      input.extraInstruction ?? "",
      "Return only the final answer — complete, accurate, and professional.",
    ].filter(Boolean).join("\n"),
    user: [
      "Original question:",
      input.question,
      englishGloss && englishGloss !== input.question.trim()
        ? `\nEnglish comprehension gloss:\n${englishGloss}`
        : "",
      "",
      "Draft that failed or used the wrong mode:",
      input.answer || "(empty draft)",
    ].join("\n"),
    history: input.history ?? [],
    intent: input.intent,
    responseMode: "deep",
    maxTokens: 1_800,
    fallback: "",
    skipCache: true,
    temperature: 0.1,
  }).catch(() => "");

  return repaired.trim();
}

export async function repairAnswerTopicMismatch(input: {
  question: string;
  answer: string;
  intent: IntentType;
}) {
  const repaired = await completeClawCloudPrompt({
    system: [
      "You are the final topical-relevance repair layer for ClawCloud AI.",
      "The previous answer drifted off-topic. Your job is to answer ONLY the user's exact question with precision.",
      "Stay strictly on the same topic, entity, work, event, or subject named in the question.",
      "Do not mention ClawCloud, its capabilities, pricing, setup, features, or benefits unless the question is explicitly about them.",
      "Do not add follow-up questions, extra suggestions, or calls to action.",
      "If the question asks for a story, plot, summary, or explanation of a drama/movie/book/series, answer only with that content.",
      "Lead with the direct answer. Be specific: use real names, numbers, dates.",
      "If some detail is still missing, answer with the safest topic-specific explanation you can support and name the single missing detail.",
      "Self-verify: does your answer actually address the specific question asked?",
      "Return only the final answer — accurate, specific, and on-topic.",
    ].join("\n"),
    user: `Question:\n${input.question}\n\nCandidate answer that drifted off-topic:\n${input.answer}`,
    history: [],
    intent: input.intent,
    responseMode: "deep",
    maxTokens: 1_600,
    fallback: "",
    skipCache: true,
    temperature: 0.1,
  }).catch(() => "");

  return repaired.trim();
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
  if (requiresFreshLiveGroundingQuestion(question, category)) return "live";
  if (intent === "finance" || category === "finance") return "finance";
  if (matchesAny(question, MENTAL_HEALTH_PATTERNS)) return "mental_health";
  if (intent === "health" || category === "health" || matchesAny(question, HEALTH_PATTERNS)) return "health";
  if (
    looksLikeScienceOrResearchQuestion(question, intent, category)
    && !(shouldUseLiveSearch(question) || category === "news" || category === "web_search")
  ) {
    return "general";
  }
  if (looksLikeLegalQuestion(question, intent, category)) return "legal";
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
  // Educational questions (explain, what is, how does, describe, etc.) about health/legal topics
  // should NOT require strict evidence/verification — they're academic, not personal advice
  const isEducationalQuery = /^(?:explain|what (?:is|are|was|were)|how (?:does|do|did|is)|describe|define|discuss|compare|analyze|summarize|tell me about|overview of)\b/i.test(question);
  const isHighStakes = domain === "health" || domain === "mental_health" || domain === "legal" || domain === "tax" || domain === "finance";
  const requiresLiveGrounding = domain === "live" || domain === "finance";
  const requiresEvidence = requiresLiveGrounding || (
    !isEducationalQuery && (domain === "health" || domain === "mental_health" || domain === "legal")
  );
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
    "Quality mode — ZERO TOLERANCE FOR FABRICATION:",
    "- Lead with established facts first. Answer, then context, then caveats.",
    "- Separate verified information from assumptions or uncertainty. Label each clearly.",
    "- If confidence is below medium, do not bluff; give the safest supportable answer and name the most important missing detail.",
    "- Never bluff, invent citations, fabricate statistics, or present uncertainty as certainty.",
    "- Self-verify all factual claims before including them. If two facts contradict, resolve before responding.",
    "- Calibrate confidence: state HIGH/MEDIUM/LOW confidence and the specific evidence supporting it.",
  ];

  if (profile.requiresLiveGrounding) {
    lines.push("- For current or fast-changing facts, only answer if the reply is grounded in live evidence.");
    lines.push("- If live evidence is weak, give only the safest general guidance and ask for the exact scope/timeframe needed for a source-backed update.");
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

function looksWeakGenericLiveAnswer(
  answer: string,
  question?: string,
): boolean {
  const normalized = answer.toLowerCase();
  const genericChoiceCount = (normalized.match(/\bmay be a good choice\b/g) ?? []).length;
  const rankingOrCompareQuestion = question
    ? /\b(top\s*\d+|best|most advanced|ranking|leaderboard|compare|comparison|difference between|vs\.?|versus)\b/i.test(question)
    : false;

  return (
    normalized.includes("some key points to consider")
    || /(^|\n)\d+\.\s*(strengths|trade-offs|when to choose each):\s*$/im.test(answer)
    || genericChoiceCount >= 2
    || (rankingOrCompareQuestion && normalized.includes("not explicitly ranked"))
    || (rankingOrCompareQuestion && normalized.includes("do not provide a clear ranking"))
    || (rankingOrCompareQuestion && normalized.includes("top ai certifications"))
    || (rankingOrCompareQuestion && normalized.includes("top ai companies"))
    || (rankingOrCompareQuestion && normalized.includes("top ai apps"))
  );
}

function looksUnsafeUngroundedLiveNumber(answer: string): boolean {
  const normalized = answer.toLowerCase();
  const hasNumbers = /\d+(?:\.\d+)?/.test(answer);
  const hasRiskLanguage = /unavailable|not found|could not|cannot|may shift|verify|subject to change/.test(normalized);
  return hasNumbers && !matchesAny(answer, LIVE_EVIDENCE_PATTERNS) && !hasRiskLanguage;
}

function looksPastYearFreshnessLeak(question: string | undefined, answer: string) {
  if (!question || !requiresFreshLiveGroundingQuestion(question, "")) {
    return false;
  }

  const explicitYear = extractExplicitQuestionYear(question);
  const currentYear = new Date().getUTCFullYear();
  if ((explicitYear !== null && explicitYear < currentYear) || hasPastYearScope(question)) {
    return false;
  }

  return [...answer.matchAll(/\b(20\d{2}|19\d{2})\b/g)]
    .some((match) => Number.parseInt(match[1] ?? "", 10) < currentYear);
}

export function isClawCloudGroundedLiveAnswer(input: {
  question?: string;
  answer: string | null | undefined;
}): boolean {
  const answer = input.answer?.trim() ?? "";
  if (!answer) return false;
  if (matchesAny(answer, LOW_CONFIDENCE_PATTERNS) || matchesAny(answer, LIVE_REFUSAL_PATTERNS)) {
    return false;
  }
  if (looksWeakGenericLiveAnswer(answer, input.question)) {
    return false;
  }
  if (!matchesAny(answer, LIVE_EVIDENCE_PATTERNS)) {
    return false;
  }
  if (looksUnsafeUngroundedLiveNumber(answer)) {
    return false;
  }
  if (looksPastYearFreshnessLeak(input.question, answer)) {
    return false;
  }
  if (input.question) {
    if (
      detectWorldBankCountryMetricQuestion(input.question)
      && !isCompleteCountryMetricAnswer(input.question, answer)
    ) {
      return false;
    }
    if (
      looksLikeConsumerStaplePriceQuestion(input.question)
      && !isCompleteIndiaConsumerPriceAnswer(input.question, answer)
    ) {
      return false;
    }
    if (
      detectRetailFuelPriceQuestion(input.question)
      && !isCompleteRetailFuelAnswer(input.question, answer)
    ) {
      return false;
    }
    if (
      extractRichestRankingScope(input.question)
      && !isCompleteRichestRankingAnswer(input.question, answer)
    ) {
      return false;
    }
  }
  return true;
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

  // Length signals — longer, more detailed answers are usually higher quality
  if (answer.length >= 100) score += 1;
  if (answer.length >= 250) score += 1;
  if (answer.length >= 500) score += 1;

  // Evidence and grounding signals
  if (clawCloudAnswerHasEvidenceSignals(answer, input.profile)) score += 2;
  if (input.profile.requiresEvidence && !clawCloudAnswerHasEvidenceSignals(answer, input.profile)) score -= 2;

  // Structured response signals (sections, headers, numbered steps)
  if (/\n.*\n/.test(answer)) score += 1; // Multi-paragraph
  if (/(^|\n)(?:•|-|\d+\.)\s/m.test(answer)) score += 1; // Has structure
  if (/\*[^*]+\*/m.test(answer)) score += 1; // Has bold formatting

  // Domain-specific quality signals
  if ((input.profile.intent === "coding") && /```/.test(answer)) score += 2; // Has code blocks
  if ((input.profile.intent === "math") && /final answer/i.test(answer)) score += 2; // Has final answer
  if ((input.profile.intent === "law") && /section\s+\d+/i.test(answer)) score += 1; // Cites law
  if ((input.profile.intent === "health") && /consult.*(?:doctor|physician|medical)/i.test(answer)) score += 1;

  // Appropriate hedging signals (shows calibrated confidence)
  if (/\bdepends on\b/i.test(answer) || /\bmay vary\b/i.test(answer) || /\bverify\b/i.test(answer)) score += 1;
  if (/\bconsult\b/i.test(answer) || /\bofficial source\b/i.test(answer)) score += 1;

  // Safety penalty signals
  if (hasUnsafeAdviceSignals(answer, input.profile)) score -= 4;
  if (input.profile.isAdvice && !/\bconsult\b/i.test(answer) && input.profile.isHighStakes) score -= 2;

  // Generic/lazy response penalties
  if (/\bas an ai\b/i.test(answer)) score -= 3;
  if (/\bi can't|i cannot|i'm unable\b/i.test(answer)) score -= 2;
  if (/\bsend.*your.*exact.*question\b/i.test(answer)) score -= 3;
  if (/\b(great question|certainly|of course)\b/i.test(answer.slice(0, 60))) score -= 1;

  if (score >= 5) return "high";
  if (score >= 2) return "medium";
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
    "You are the final answer quality verifier for ClawCloud AI — the world's most advanced AI assistant.",
    "Your job is to catch errors, fabrications, and quality issues BEFORE the answer reaches the user.",
    "You must be STRICTER than any human reviewer. Zero tolerance for mediocrity.",
    "",
    "VERIFICATION CHECKLIST (check ALL):",
    "1. FACTUAL ACCURACY: Does every fact, date, name, number, and statistic check out? Cross-verify internally.",
    "2. COMPLETENESS: Does it fully and thoroughly answer the question? Any critical aspect missing?",
    "3. SAFETY: Does it avoid giving dangerous medical, legal, or financial advice as certainty? Are disclaimers present for high-stakes domains?",
    "4. SPECIFICITY: Does it use specific names, numbers, dates, citations — or does it hide behind vague language (many, several, various)?",
    "5. STRUCTURE: Is it well-organized with headers, bullets, and logical flow?",
    "6. DIRECTNESS: Does it lead with the answer in the first sentence? Or waste space with filler/preamble?",
    "7. CONSISTENCY: Do all claims in the answer agree with each other? No internal contradictions?",
    "8. CODE QUALITY (if applicable): Is code complete, runnable, with all imports? No TODO/placeholder comments?",
    "9. MATH ACCURACY (if applicable): Are all calculations correct? Does the final answer have correct units?",
    "10. SOURCE QUALITY: Are any cited sources plausible and real? Fabricated citations are a REJECT.",
    "",
    "VERDICT CRITERIA:",
    "- REJECT if: fabricated facts/citations, factually wrong answer, empty/generic response, dangerous unqualified advice, incomplete code with placeholders, math with wrong result.",
    "- REVISE if: mostly correct but needs safety caveats, minor factual correction, missing key detail, or needs structure improvement. You MUST provide a full corrected replacement.",
    "- APPROVE if: accurate, complete, specific, well-structured, safe, and directly answers the question.",
    "",
    "Return exactly this structure:",
    "VERDICT: APPROVE | REVISE | REJECT",
    "CONFIDENCE: HIGH | MEDIUM | LOW",
    "RATIONALE: one short paragraph explaining your assessment — cite the specific issue found",
    "REVISION: only include a COMPLETE replacement answer when verdict is REVISE; otherwise leave blank",
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
    maxTokens: 1_200,
    fallback: "",
    skipCache: true,
    temperature: 0.05,
  }).catch(() => "");

  return parseVerificationBlock(answer);
}

/**
 * NEVER returns a "share more details" refusal. Instead, returns an internal
 * signal that triggers the emergency direct answer path in the agent layer.
 * This ensures the user ALWAYS gets a substantive answer, never a "scoped answer needed" refusal.
 */
export function buildClawCloudLowConfidenceReply(
  _question: string,
  _profile: ClawCloudAnswerQualityProfile,
  _rationale?: string,
): string {
  // Return internal signal — the agent layer will catch this and generate
  // a real answer via emergencyDirectAnswer() instead of showing a refusal.
  return "__LOW_CONFIDENCE_RECOVERY_SIGNAL__";
}

export function clawCloudConfidenceBelowFloor(
  actual: ClawCloudAnswerConfidence,
  floor: ClawCloudAnswerConfidence,
) {
  return compareConfidence(actual, floor) < 0;
}
