import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { detectHinglish } from "@/lib/clawcloud-hinglish";
import { emailMatchesTld } from "@/lib/clawcloud-intent-match";
import {
  DEFAULT_CLAW_CLOUD_LOCALE,
  getLocaleLabel,
  localeNames,
  resolveSupportedLocale,
  type SupportedLocale,
} from "@/lib/clawcloud-locales";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type { SupportedLocale } from "@/lib/clawcloud-locales";

const tldLocaleMap: Record<string, SupportedLocale> = {
  ".mx": "es",
  ".ar": "es",
  ".co": "es",
  ".cl": "es",
  ".pe": "es",
  ".es": "es",
  ".fr": "fr",
  ".de": "de",
  ".it": "it",
  ".br": "pt",
  ".pt": "pt",
  ".in": "hi",
  ".sa": "ar",
  ".ae": "ar",
  ".eg": "ar",
  ".tr": "tr",
  ".id": "id",
  ".my": "ms",
  ".ke": "sw",
  ".tz": "sw",
  ".nl": "nl",
  ".pl": "pl",
  ".ru": "ru",
  ".jp": "ja",
  ".kr": "ko",
  ".cn": "zh",
};

const INDIAN_LOCALES = new Set<SupportedLocale>(["hi", "pa", "ta", "te", "kn", "bn", "mr", "gu"]);

const TRANSLATION_FAILURE_REPLY_PATTERNS = [
  /\bi could not complete a reliable direct answer\b/i,
  /\bneeds one key detail or clearer scope\b/i,
  /\bshare the exact topic or full problem statement\b/i,
  /\bshare the exact name, date, version, or location\b/i,
  /\bshare the topic, tone, and target length\b/i,
];

export type LocalePreferenceCommand =
  | { type: "set"; locale: SupportedLocale; label: string }
  | { type: "show" }
  | { type: "unsupported"; requested: string }
  | { type: "none" };

export type ClawCloudReplyLanguageResolution = {
  locale: SupportedLocale;
  source: "stored_preference" | "mirrored_message" | "hinglish_message" | "explicit_request";
  detectedLocale: SupportedLocale | null;
  preserveRomanScript: boolean;
};

const EXPLICIT_REPLY_LANGUAGE_REQUEST_RE =
  /\b(?:answer|reply|respond|write|tell me|explain|describe|summari[sz]e|story of|plot of|summary of|overview of|give me|say)\b[\s\S]{0,160}?\b(?:in|into)\s+([a-z][a-z\s()+-]{1,24})[.!?]*$/i;

function looksLikeTranslationFailureReply(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  return TRANSLATION_FAILURE_REPLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}
const TRAILING_REPLY_LANGUAGE_REQUEST_RE =
  /\b(?:in|into)\s+([a-z][a-z\s()+-]{1,24})[.!?]*$/i;

const MESSAGE_SCRIPT_PATTERNS: Array<{ locale: SupportedLocale; pattern: RegExp }> = [
  { locale: "ar", pattern: /[\u0600-\u06ff]/u },
  { locale: "ru", pattern: /[\u0400-\u04ff]/u },
  { locale: "ja", pattern: /[\u3040-\u30ff]/u },
  { locale: "ko", pattern: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u },
  { locale: "zh", pattern: /[\u4e00-\u9fff]/u },
  { locale: "pa", pattern: /[\u0a00-\u0a7f]/u },
  { locale: "gu", pattern: /[\u0a80-\u0aff]/u },
  { locale: "bn", pattern: /[\u0980-\u09ff]/u },
  { locale: "ta", pattern: /[\u0b80-\u0bff]/u },
  { locale: "te", pattern: /[\u0c00-\u0c7f]/u },
  { locale: "kn", pattern: /[\u0c80-\u0cff]/u },
  { locale: "hi", pattern: /[\u0900-\u097f]/u },
];

const LATIN_LANGUAGE_PATTERNS: Array<{ locale: SupportedLocale; pattern: RegExp }> = [
  { locale: "es", pattern: /\b(?:hola|gracias|por favor|puedes|puedo|necesito|ayuda|explica|explicame|dime|como|porque|hoy|precio|noticias|clima|temperatura)\b/i },
  { locale: "fr", pattern: /\b(?:bonjour|merci|s'il vous plaît|besoin|aide|explique|dis-moi|comment|pourquoi|aujourd'hui|prix|actualités|météo)\b/i },
  { locale: "de", pattern: /\b(?:hallo|danke|bitte|hilfe|erkläre|erklären|sag mir|wie|warum|heute|preis|nachrichten|wetter)\b/i },
  { locale: "pt", pattern: /\b(?:olá|obrigado|obrigada|por favor|preciso|ajuda|explica|me diga|como|porque|hoje|preço|notícias|tempo)\b/i },
  { locale: "it", pattern: /\b(?:ciao|grazie|per favore|ho bisogno|aiuto|spiega|dimmi|come|perché|oggi|prezzo|notizie|meteo)\b/i },
  { locale: "tr", pattern: /\b(?:merhaba|teşekkürler|tesekkurler|lütfen|yardım|açıkla|acikla|söyle|soyle|nasıl|neden|bugün|fiyat|haberler|hava)\b/i },
  { locale: "id", pattern: /\b(?:halo|terima kasih|tolong|bantu|jelaskan|katakan|bagaimana|kenapa|hari ini|harga|berita|cuaca)\b/i },
  { locale: "ms", pattern: /\b(?:hai|terima kasih|tolong|bantu|jelaskan|beritahu|bagaimana|kenapa|hari ini|harga|berita|cuaca)\b/i },
  { locale: "sw", pattern: /\b(?:habari|asante|tafadhali|msaada|eleza|niambie|vipi|kwa nini|leo|bei|habari|hali ya hewa)\b/i },
  { locale: "nl", pattern: /\b(?:hallo|dank je|alsjeblieft|help|leg uit|vertel me|hoe|waarom|vandaag|prijs|nieuws|weer)\b/i },
  { locale: "pl", pattern: /\b(?:cześć|czesc|dziękuję|dziekuje|proszę|prosze|pomoc|wyjaśnij|wyjasnij|powiedz|jak|dlaczego|dzisiaj|cena|wiadomości|wiadomosci|pogoda)\b/i },
];

const ENGLISH_SIGNAL_RE =
  /\b(?:the|and|what|why|how|please|can you|could you|would you|should i|help me|explain|tell me|show me|today|price|news|weather)\b/i;
const LATIN_SCRIPT_MESSAGE_RE = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u;
const ENGLISH_FALLBACK_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "can",
  "condition",
  "could",
  "do",
  "does",
  "did",
  "explain",
  "for",
  "from",
  "give",
  "help",
  "how",
  "in",
  "is",
  "it",
  "list",
  "of",
  "show",
  "stop",
  "tell",
  "the",
  "to",
  "war",
  "what",
  "when",
  "where",
  "which",
  "why",
  "will",
  "with",
  "would",
  "you",
]);
const SHORT_ENGLISH_REPLY_RE =
  /^(?:yes|no|maybe|sure|okay|ok|right|done|connected|healthy|running|idle|thanks|thank you|not available|just now|pending|loading(?:\s+live\s+status)?|none|n\/a|\d+(?:[.,]\d+)?%?)$/i;

function normalizeMessageForLanguageDetection(value: string) {
  return value
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractExplicitReplyLocaleRequest(message: string): SupportedLocale | null {
  const normalized = normalizeMessageForLanguageDetection(message);
  if (!normalized) {
    return null;
  }

  const match =
    normalized.match(EXPLICIT_REPLY_LANGUAGE_REQUEST_RE)
    || (
      /\b(?:story|plot|summary|synopsis|ending|tell me|explain|describe|summari[sz]e|overview)\b/i.test(normalized)
      ? normalized.match(TRAILING_REPLY_LANGUAGE_REQUEST_RE)
      : null
    );

  const candidate = match?.[1]?.trim();
  if (!candidate) {
    return null;
  }

  return resolveSupportedLocale(candidate.replace(/\bnatural\b/gi, "").trim());
}

function looksLikeEnglishMessage(normalized: string) {
  if (!LATIN_SCRIPT_MESSAGE_RE.test(normalized)) {
    return false;
  }

  if (ENGLISH_SIGNAL_RE.test(normalized)) {
    return true;
  }

  const tokens = normalized.toLowerCase().match(/[a-z]+/g) ?? [];
  if (tokens.length < 3) {
    return false;
  }

  const englishHitCount = tokens.filter((token) => ENGLISH_FALLBACK_WORDS.has(token)).length;
  if (englishHitCount >= Math.max(2, Math.floor(tokens.length * 0.4))) {
    return true;
  }

  return (
    englishHitCount >= 2
    && /^(?:what|why|how|when|where|who|which|can|could|would|should|is|are|do|does|did|tell|explain|show|give|list|compare|summarize)\b/i.test(normalized)
  );
}

function looksLikeLikelyEnglishReply(normalized: string) {
  return SHORT_ENGLISH_REPLY_RE.test(normalized) || looksLikeEnglishMessage(normalized);
}

export function inferClawCloudMessageLocale(message: string): SupportedLocale | null {
  const normalized = normalizeMessageForLanguageDetection(message);
  if (!normalized) {
    return null;
  }

  for (const candidate of MESSAGE_SCRIPT_PATTERNS) {
    if (candidate.pattern.test(normalized)) {
      return candidate.locale;
    }
  }

  for (const candidate of LATIN_LANGUAGE_PATTERNS) {
    if (candidate.pattern.test(normalized)) {
      return candidate.locale;
    }
  }

  if (looksLikeEnglishMessage(normalized)) {
    return "en";
  }

  return null;
}

export function resolveClawCloudReplyLanguage(input: {
  message: string;
  preferredLocale: SupportedLocale;
  recentUserMessages?: string[];
}): ClawCloudReplyLanguageResolution {
  const normalized = normalizeMessageForLanguageDetection(input.message);
  const explicitLocale = extractExplicitReplyLocaleRequest(normalized);
  if (explicitLocale) {
    return {
      locale: explicitLocale,
      source: "explicit_request",
      detectedLocale: explicitLocale,
      preserveRomanScript: false,
    };
  }

  if (detectHinglish(normalized)) {
    return {
      locale: "en",
      source: "hinglish_message",
      detectedLocale: "hi",
      preserveRomanScript: true,
    };
  }

  const detectedLocale =
    inferClawCloudMessageLocale(normalized)
    || input.recentUserMessages?.map((message) => inferClawCloudMessageLocale(message)).find(Boolean)
    || null;

  if (detectedLocale && detectedLocale !== input.preferredLocale) {
    return {
      locale: detectedLocale,
      source: "mirrored_message",
      detectedLocale,
      preserveRomanScript: false,
    };
  }

  return {
    locale: input.preferredLocale,
    source: "stored_preference",
    detectedLocale,
    preserveRomanScript: false,
  };
}

export function buildClawCloudReplyLanguageInstruction(resolution: ClawCloudReplyLanguageResolution) {
  if (resolution.source === "explicit_request" && resolution.detectedLocale) {
    if (resolution.detectedLocale === "en") {
      return "The user explicitly asked for the answer in English. Reply fully in natural English.";
    }

    return `The user explicitly asked for the answer in ${localeNames[resolution.detectedLocale]}. Reply fully in that language and keep the answer natural and fluent.`;
  }

  if (resolution.source === "hinglish_message") {
    return "The user is writing in Hinglish. Reply in natural Hinglish using Roman script, and keep the same casual human tone.";
  }

  if (resolution.source === "mirrored_message" && resolution.detectedLocale) {
    if (resolution.detectedLocale === "en") {
      return "The user's current message is in English. Reply fully in natural English. Do not switch into Hindi, Hinglish, or any other language unless the user explicitly asks for that language.";
    }

    return `The user is writing in ${localeNames[resolution.detectedLocale]}. Mirror that language naturally in your reply and preserve the user's tone and formality.`;
  }

  if (resolution.locale === "en") {
    return "Reply in natural English by default. Only switch into Hindi, Hinglish, or any other language if the user explicitly asks for it or clearly writes the current message in that language.";
  }

  return `Reply in ${localeNames[resolution.locale]} unless the user explicitly asks for a different output language.`;
}

export function detectLocaleFromEmail(email: string): SupportedLocale {
  for (const [tld, locale] of Object.entries(tldLocaleMap)) {
    if (emailMatchesTld(email, tld)) {
      return locale;
    }
  }
  return DEFAULT_CLAW_CLOUD_LOCALE;
}

export async function getUserLocale(userId: string): Promise<SupportedLocale> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();

  const { data: prefs } = await supabaseAdmin
    .from("user_preferences")
    .select("language,updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  const { data: explicitReplyLanguageMemory } = await supabaseAdmin
    .from("user_memory")
    .select("value,source,confidence,updated_at")
    .eq("user_id", userId)
    .eq("key", "reply_language")
    .eq("source", "explicit")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .catch(() => ({ data: null }));

  const { data: legacyLanguageMemory } = await supabaseAdmin
    .from("user_memory")
    .select("value,source,confidence,updated_at")
    .eq("user_id", userId)
    .eq("key", "language_preference")
    .eq("source", "explicit")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .catch(() => ({ data: null }));

  const preferredLanguage = prefs?.language as string | undefined;
  const replyLanguageLocale = resolveSupportedLocale(explicitReplyLanguageMemory?.value ?? "");
  const legacyLocale = resolveSupportedLocale(legacyLanguageMemory?.value ?? "");
  const explicitLocale = replyLanguageLocale ?? legacyLocale;
  const prefUpdatedAt = Date.parse(String((prefs as { updated_at?: string } | null)?.updated_at ?? ""));
  const memoryUpdatedAt = Date.parse(String((explicitReplyLanguageMemory ?? legacyLanguageMemory)?.updated_at ?? ""));

  if (
    explicitLocale
    && (!preferredLanguage
      || !(preferredLanguage in localeNames)
      || (Number.isFinite(memoryUpdatedAt) && (!Number.isFinite(prefUpdatedAt) || memoryUpdatedAt >= prefUpdatedAt)))
  ) {
    return explicitLocale;
  }

  if (preferredLanguage && preferredLanguage in localeNames) {
    return preferredLanguage as SupportedLocale;
  }

  if (explicitLocale) {
    return explicitLocale;
  }

  return DEFAULT_CLAW_CLOUD_LOCALE;
}

export async function setUserLocale(userId: string, locale: SupportedLocale) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const updatedAt = new Date().toISOString();
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from("user_preferences")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (lookupError) {
    console.error("[i18n] user_preferences locale lookup error:", lookupError.message);
  }

  const mutation = existing?.user_id
    ? supabaseAdmin
      .from("user_preferences")
      .update({ language: locale, updated_at: updatedAt })
      .eq("user_id", userId)
    : supabaseAdmin
      .from("user_preferences")
      .insert({ user_id: userId, language: locale, updated_at: updatedAt });

  const { error } = await mutation;
  if (error) {
    console.error("[i18n] user_preferences locale save error:", error.message);
  }
}

function normalizeLocaleRequest(value: string) {
  return value
    .trim()
    .replace(/^other[:\s]+/i, "")
    .replace(/\s+(?:unless|except|but|and)\b[\s\S]*$/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function extractLocalePreferenceCandidate(message: string): string | null {
  const patterns = [
    /^(?:from\s+now\s+on\s+)?(?:always\s+)?(?:reply|respond|answer|speak|talk|write)(?:\s+to\s+me)?\s+in\s+(.+)$/i,
    /^(?:from\s+now\s+on\s+)?(?:always\s+)?(?:reply|respond|answer|speak|talk|write)(?:\s+to\s+me)?\s+only\s+in\s+(.+)$/i,
    /^(?:set|change|switch|update)\s+(?:my\s+)?(?:reply\s+)?language(?:\s+to)?\s+(.+)$/i,
    /^(?:switch|change|move|go)\s+back\s+to\s+(.+)$/i,
    /^(?:switch|change)\s+to\s+(.+)$/i,
    /^(?:my\s+)?(?:preferred\s+)?language(?:\s+is|:)\s+(.+)$/i,
    /^(.+?)\s+only$/i,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return normalizeLocaleRequest(match[1]);
    }
  }

  return null;
}

export function detectLocalePreferenceCommand(message: string): LocalePreferenceCommand {
  const trimmed = message.trim();
  if (!trimmed) {
    return { type: "none" };
  }

  if (
    /^(?:what(?:'s| is)|show|check)\s+my\s+(?:language|language preference|reply language)\??$/i.test(trimmed)
    || /^(?:current\s+)?(?:reply\s+)?language\??$/i.test(trimmed)
    || /^what\s+language\s+are\s+you\s+(?:set|configured)\s+to(?:\s+for\s+me)?(?:\s+right\s+now)?\??$/i.test(trimmed)
    || /^(?:what(?:'s| is)\s+)?language\s+are\s+you\s+(?:set|configured)\s+to(?:\s+for\s+me)?(?:\s+right\s+now)?\??$/i.test(trimmed)
    || /^(?:what(?:'s| is)\s+)?my\s+current\s+(?:reply\s+)?language(?:\s+right\s+now)?\??$/i.test(trimmed)
    || /^(?:what(?:'s| is)\s+)?which\s+language\s+are\s+you\s+replying\s+in\??$/i.test(trimmed)
  ) {
    return { type: "show" };
  }

  const candidate = extractLocalePreferenceCandidate(trimmed);
  if (!candidate) {
    return { type: "none" };
  }

  const locale = resolveSupportedLocale(candidate);
  if (!locale) {
    return {
      type: "unsupported",
      requested: candidate,
    };
  }

  return {
    type: "set",
    locale,
    label: getLocaleLabel(locale),
  };
}

export function buildLocalePreferenceSavedReply(locale: SupportedLocale) {
  const label = getLocaleLabel(locale);
  return [
    `Language updated to *${label}*.`,
    "",
    `I'll reply in ${label} from now on unless you ask for a translation or clearly switch to a different language in your message.`,
  ].join("\n");
}

export function buildLocalePreferenceStatusReply(locale: SupportedLocale) {
  const label = getLocaleLabel(locale);
  return [
    `Your current reply language is *${label}*.`,
    "",
    "You can change it anytime with messages like _reply in English_ or _set language to Hindi_.",
    "If you clearly switch languages in a message, I'll usually mirror that message naturally too.",
  ].join("\n");
}

export function buildLocalePreferenceUnsupportedReply(requested: string) {
  return [
    `I couldn't set the reply language from *${requested.trim() || "that request"}*.`,
    "",
    "Try one of these:",
    "- _Reply in English_",
    "- _Reply in Hindi_",
    "- _Set language to Spanish_",
  ].join("\n");
}

export async function translateMessage(
  message: string,
  locale: SupportedLocale,
  options?: {
    force?: boolean;
    preserveRomanScript?: boolean;
    preferredModels?: string[];
  },
) {
  if (locale === DEFAULT_CLAW_CLOUD_LOCALE && !options?.force) {
    return message;
  }

  // Detect source language for Indic scripts to provide explicit hints and use better models
  const detectedSourceLocale = inferClawCloudMessageLocale(message);
  const isIndicSource = detectedSourceLocale ? INDIAN_LOCALES.has(detectedSourceLocale) : false;
  const sourceLanguageName = detectedSourceLocale ? (localeNames[detectedSourceLocale] ?? null) : null;
  const indicModels = isIndicSource ? [
    "qwen/qwen3.5-397b-a17b",
    "meta/llama-3.1-405b-instruct",
    "deepseek-ai/deepseek-v3.1-terminus",
    "moonshotai/kimi-k2.5",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ] : undefined;

  const translated = await completeClawCloudPrompt({
    system: [
      `Translate the user's message into ${localeNames[locale]}. Return only the translated text.`,
      isIndicSource && sourceLanguageName
        ? `The source text is written in ${sourceLanguageName} script. Read and understand it as ${sourceLanguageName} text before translating.`
        : null,
      "Preserve the original tone, warmth, directness, and level of formality. Make it sound like a natural human reply, not a stiff machine translation.",
      `The source text may already contain some ${localeNames[locale]} words, quoted titles, proper nouns, or mixed-language phrases. Still translate the surrounding prose faithfully.`,
      `Never say the text is already in ${localeNames[locale]}. Never refuse translation for that reason.`,
      "Preserve Markdown formatting, placeholders like [Name] or [Date], numbers, dates, currency amounts, URLs, slash commands, stock tickers, UPI IDs, GST/TDS names, and product names exactly when they should stay unchanged.",
      "Do not add disclaimers, caveats, explanations, or extra commentary.",
      options?.preserveRomanScript
        ? "Keep the translation in natural Roman script instead of switching to a native script."
        : null,
      INDIAN_LOCALES.has(locale)
        ? options?.preserveRomanScript
          ? "Use natural modern wording for Indian users, keep commonly used app and finance terms readable, and stay fully in Roman script."
          : "Use natural modern wording for Indian users, prefer the native script for the target language by default (for example, Devanagari for Hindi), and do not over-translate banking, tax, or app terms that are commonly kept in English."
        : "Keep the translation natural and concise.",
    ].filter(Boolean).join(" "),
    user: message,
    maxTokens: 1000,
    fallback: message,
    skipCache: true,
    temperature: 0.1,
    preferredModels: options?.preferredModels ?? indicModels,
  });

  const candidate = looksLikeTranslationFailureReply(translated) ? message : (translated || message);
  const normalizedCandidate = normalizeMessageForLanguageDetection(candidate);
  const candidateLocale = inferClawCloudMessageLocale(normalizedCandidate);
  const isNonLatinCandidate = !LATIN_SCRIPT_MESSAGE_RE.test(normalizedCandidate);
  const shouldRetryForTargetLocale =
    options?.force
    && normalizedCandidate.length > 24
    && (
      locale === "en"
        ? (
          // Retry if result still contains non-Latin characters (translation didn't work)
          isNonLatinCandidate
          // OR if result is Latin but not actually English
          || (LATIN_SCRIPT_MESSAGE_RE.test(normalizedCandidate) && !looksLikeLikelyEnglishReply(normalizedCandidate))
        )
        : candidateLocale !== locale
    );

  if (shouldRetryForTargetLocale) {
    const retried = await completeClawCloudPrompt({
      system: [
        "You are a translation engine.",
        `Translate the user's text into natural ${localeNames[locale]} only.`,
        `Your entire output must be in ${localeNames[locale]}.`,
        isIndicSource && sourceLanguageName
          ? `The source text is in ${sourceLanguageName}. Read and understand the ${sourceLanguageName} script carefully before translating.`
          : null,
        `The source text may include some ${localeNames[locale]} words, titles, or names already. Do not refuse translation for that reason.`,
        options?.preserveRomanScript
          ? "Use natural Roman script instead of native script."
          : "Use the natural native script for that language where appropriate.",
        "Do not summarize, explain, ask questions, or add commentary.",
        `Do not say things like 'here is the translation', 'direct translation', or 'the text is already in ${localeNames[locale]}'.`,
        "Preserve Markdown, numbers, dates, currencies, URLs, stock tickers, and product names where appropriate.",
        "Return only the translated text.",
      ].filter(Boolean).join(" "),
      user: message,
      maxTokens: 1000,
      fallback: candidate,
      skipCache: true,
      temperature: 0.05,
      preferredModels: options?.preferredModels ?? indicModels,
    });

    return looksLikeTranslationFailureReply(retried) ? candidate : (retried || candidate);
  }

  if (
    locale === "en"
    && options?.force
    && LATIN_SCRIPT_MESSAGE_RE.test(normalizedCandidate)
    && normalizedCandidate.length > 24
    && !looksLikeLikelyEnglishReply(normalizedCandidate)
  ) {
    const retried = await completeClawCloudPrompt({
      system: [
        "You are a translation engine.",
        "Translate the user's text into natural English only.",
        "Your entire output must be in English.",
        isIndicSource && sourceLanguageName
          ? `The source text is in ${sourceLanguageName}. Read the ${sourceLanguageName} script carefully.`
          : null,
        "Do not leave Spanish, Hindi, Hinglish, or any other language in the answer.",
        "Do not summarize, explain, or add commentary. Translate the full meaning faithfully.",
        "Preserve Markdown, numbers, dates, currencies, URLs, and product names where appropriate.",
      ].filter(Boolean).join(" "),
      user: message,
      maxTokens: 1000,
      fallback: candidate,
      skipCache: true,
      temperature: 0.05,
      preferredModels: options?.preferredModels ?? indicModels,
    });

    return looksLikeTranslationFailureReply(retried) ? candidate : (retried || candidate);
  }

  return candidate;
}

export async function enforceClawCloudReplyLanguage(input: {
  message: string;
  locale: SupportedLocale;
  preserveRomanScript?: boolean;
}) {
  const normalized = normalizeMessageForLanguageDetection(input.message);
  if (!normalized) {
    return input.message;
  }

  if (input.preserveRomanScript) {
    if (detectHinglish(normalized)) {
      return input.message;
    }

    return translateMessage(input.message, "hi", {
      force: true,
      preserveRomanScript: true,
    });
  }

  const detectedLocale = inferClawCloudMessageLocale(normalized);
  const looksHinglish = detectHinglish(normalized);
  const needsTranslation =
    input.locale === "en"
      ? (
        looksHinglish
        || (detectedLocale !== null && detectedLocale !== "en")
        || (LATIN_SCRIPT_MESSAGE_RE.test(normalized) && normalized.length > 24 && !looksLikeLikelyEnglishReply(normalized))
      )
      : detectedLocale !== input.locale;

  if (!needsTranslation) {
    return input.message;
  }

  return translateMessage(input.message, input.locale, {
    force: true,
    preserveRomanScript: input.preserveRomanScript,
  });
}

export function buildMultilingualBriefingSystem(locale: SupportedLocale) {
  const languageName = localeNames[locale];
  return [
    "You are ClawCloud AI, a concise personal assistant writing a morning briefing.",
    `Write the entire response in ${languageName}.`,
    "Keep it warm, brief, and easy to read on a phone screen.",
    "Use short paragraphs and line breaks.",
    INDIAN_LOCALES.has(locale)
      ? "Keep app names, reminders, commands, and important financial terms in their most natural user-facing form."
      : "Preserve product names and commands exactly where needed.",
  ].join(" ");
}

// ── INDIC SCRIPT ROMANIZATION ──
// Converts native Indic scripts (Kannada, Tamil, Telugu, Devanagari, Bengali, Gujarati, Gurmukhi)
// to romanized text so that AI models which cannot read native scripts can still understand the content.

type IndicScriptConfig = {
  base: number; // Unicode block start
  consonants: string[];
  independentVowels: string[];
  vowelDiacritics: string[]; // mapped to same indices as independentVowels (minus 'a')
  virama: number; // offset from base
  anusvara: number;
  visarga: number;
  digits?: number; // offset of digit '0'
};

// Independent vowels at offsets 0x05-0x14 from script base
// Covers: a, aa, i, ii, u, uu, ri, lri, candra-e/short-e, short-e, e, ai, candra-o/short-o, short-o, o, au
const ROMANIZATION_INDEP_VOWELS = ["a", "aa", "i", "ee", "u", "oo", "ru", "lu", "e", "e", "ee", "ai", "o", "o", "oo", "au"];
// Vowel diacritics (matras) at offsets 0x3E-0x4C from script base
// Covers: aa, i, ii, u, uu, ri, rii, candra-e/short-e, short-e, ee, ai, candra-o/short-o, short-o, oo, au
const ROMANIZATION_DIACRITICS = ["aa", "i", "ee", "u", "oo", "ru", "ruu", "e", "e", "ee", "ai", "o", "o", "oo", "au"];

const INDIC_SCRIPTS: Record<string, IndicScriptConfig> = {
  // Devanagari (Hindi, Marathi, Sanskrit) — U+0900
  devanagari: {
    base: 0x0900,
    independentVowels: ROMANIZATION_INDEP_VOWELS,
    consonants: [
      "ka","kha","ga","gha","nga",
      "cha","chha","ja","jha","nya",
      "Ta","Tha","Da","Dha","Na",
      "ta","tha","da","dha","na","nna",
      "pa","pha","ba","bha","ma",
      "ya","ra","ra","la","La","lLa","va",
      "sha","Sha","sa","ha",
    ],
    vowelDiacritics: ROMANIZATION_DIACRITICS,
    virama: 0x4D, anusvara: 0x02, visarga: 0x03, digits: 0x66,
  },
  // Kannada — U+0C80
  kannada: {
    base: 0x0C80,
    independentVowels: ROMANIZATION_INDEP_VOWELS,
    consonants: [
      "ka","kha","ga","gha","nga",
      "cha","chha","ja","jha","nya",
      "Ta","Tha","Da","Dha","Na",
      "ta","tha","da","dha","na","nna",
      "pa","pha","ba","bha","ma",
      "ya","ra","Ra","la","La","lLa","va",
      "sha","Sha","sa","ha",
    ],
    vowelDiacritics: ROMANIZATION_DIACRITICS,
    virama: 0x4D, anusvara: 0x02, visarga: 0x03, digits: 0x66,
  },
  // Tamil — U+0B80
  tamil: {
    base: 0x0B80,
    independentVowels: ROMANIZATION_INDEP_VOWELS,
    consonants: [
      "ka","","ga","","nga",
      "cha","","ja","","nya",
      "Ta","","Da","","Na",
      "ta","","da","","na","nna",
      "pa","","ba","","ma",
      "ya","ra","Ra","la","La","lLa","va",
      "sha","Sha","sa","ha",
    ],
    vowelDiacritics: ROMANIZATION_DIACRITICS,
    virama: 0x4D, anusvara: 0x02, visarga: 0x03, digits: 0x66,
  },
  // Telugu — U+0C00
  telugu: {
    base: 0x0C00,
    independentVowels: ROMANIZATION_INDEP_VOWELS,
    consonants: [
      "ka","kha","ga","gha","nga",
      "cha","chha","ja","jha","nya",
      "Ta","Tha","Da","Dha","Na",
      "ta","tha","da","dha","na","nna",
      "pa","pha","ba","bha","ma",
      "ya","ra","Ra","la","La","lLa","va",
      "sha","Sha","sa","ha",
    ],
    vowelDiacritics: ROMANIZATION_DIACRITICS,
    virama: 0x4D, anusvara: 0x02, visarga: 0x03, digits: 0x66,
  },
  // Bengali — U+0980
  bengali: {
    base: 0x0980,
    independentVowels: ROMANIZATION_INDEP_VOWELS,
    consonants: [
      "ka","kha","ga","gha","nga",
      "cha","chha","ja","jha","nya",
      "Ta","Tha","Da","Dha","Na",
      "ta","tha","da","dha","na","nna",
      "pa","pha","ba","bha","ma",
      "ya","ra","","la","","","va",
      "sha","Sha","sa","ha",
    ],
    vowelDiacritics: ROMANIZATION_DIACRITICS,
    virama: 0x4D, anusvara: 0x02, visarga: 0x03, digits: 0x66,
  },
  // Gujarati — U+0A80
  gujarati: {
    base: 0x0A80,
    independentVowels: ROMANIZATION_INDEP_VOWELS,
    consonants: [
      "ka","kha","ga","gha","nga",
      "cha","chha","ja","jha","nya",
      "Ta","Tha","Da","Dha","Na",
      "ta","tha","da","dha","na","nna",
      "pa","pha","ba","bha","ma",
      "ya","ra","","la","La","","va",
      "sha","Sha","sa","ha",
    ],
    vowelDiacritics: ROMANIZATION_DIACRITICS,
    virama: 0x4D, anusvara: 0x02, visarga: 0x03, digits: 0x66,
  },
  // Gurmukhi (Punjabi) — U+0A00
  gurmukhi: {
    base: 0x0A00,
    independentVowels: ROMANIZATION_INDEP_VOWELS,
    consonants: [
      "ka","kha","ga","gha","nga",
      "cha","chha","ja","jha","nya",
      "Ta","Tha","Da","Dha","Na",
      "ta","tha","da","dha","na","nna",
      "pa","pha","ba","bha","ma",
      "ya","ra","","la","La","","va",
      "sha","Sha","sa","ha",
    ],
    vowelDiacritics: ROMANIZATION_DIACRITICS,
    virama: 0x4D, anusvara: 0x02, visarga: 0x03, digits: 0x66,
  },
};

const LOCALE_TO_SCRIPT: Record<string, string> = {
  hi: "devanagari", mr: "devanagari",
  kn: "kannada",
  ta: "tamil",
  te: "telugu",
  bn: "bengali",
  gu: "gujarati",
  pa: "gurmukhi",
};

function getScriptForCodepoint(cp: number): IndicScriptConfig | null {
  for (const script of Object.values(INDIC_SCRIPTS)) {
    if (cp >= script.base && cp < script.base + 0x80) return script;
  }
  return null;
}

/**
 * Romanize a string containing Indic script characters.
 * Returns the original string with Indic characters replaced by romanized equivalents.
 * ASCII characters, numbers, and punctuation are preserved as-is.
 */
export function romanizeIndicScript(text: string): string {
  const result: string[] = [];
  const chars = [...text]; // proper Unicode iteration

  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0)!;
    const script = getScriptForCodepoint(cp);

    if (!script) {
      result.push(chars[i]);
      continue;
    }

    const offset = cp - script.base;

    // Anusvara (nasal)
    if (offset === script.anusvara) {
      result.push("m");
      continue;
    }

    // Visarga
    if (offset === script.visarga) {
      result.push("h");
      continue;
    }

    // Independent vowels: typically at offsets 0x05-0x14
    if (offset >= 0x05 && offset <= 0x14) {
      const vowelIdx = offset - 0x05;
      result.push(script.independentVowels[vowelIdx] ?? chars[i]);
      continue;
    }

    // Consonants: typically at offsets 0x15-0x39
    if (offset >= 0x15 && offset <= 0x39) {
      const consIdx = offset - 0x15;
      const consonant = script.consonants[consIdx];
      if (!consonant) {
        result.push(chars[i]);
        continue;
      }

      // Check if next char is a virama (halant) — strips inherent 'a'
      const nextCp = (i + 1 < chars.length) ? chars[i + 1].codePointAt(0)! : 0;
      const nextOffset = nextCp - script.base;

      if (nextOffset === script.virama) {
        // Consonant without inherent vowel
        result.push(consonant.replace(/a$/, ""));
        i++; // skip virama
        continue;
      }

      // Check if next char is a vowel diacritic (matra): offsets 0x3E-0x4C
      if (nextOffset >= 0x3E && nextOffset <= 0x4C) {
        const matraIdx = nextOffset - 0x3E;
        const matra = script.vowelDiacritics[matraIdx] ?? "a";
        result.push(consonant.replace(/a$/, "") + matra);
        i++; // skip matra
        continue;
      }

      // Default: consonant with inherent 'a'
      result.push(consonant);
      continue;
    }

    // Vowel diacritics appearing alone (shouldn't normally happen)
    if (offset >= 0x3E && offset <= 0x4C) {
      const matraIdx = offset - 0x3E;
      result.push(script.vowelDiacritics[matraIdx] ?? "");
      continue;
    }

    // Virama alone
    if (offset === script.virama) {
      continue;
    }

    // Digits
    if (script.digits && offset >= script.digits && offset <= script.digits + 9) {
      result.push(String(offset - script.digits));
      continue;
    }

    // Unknown — pass through
    result.push(chars[i]);
  }

  return result.join("");
}

/**
 * Check if text contains significant non-Latin Indic script characters
 * and return a romanized version suitable for AI model comprehension.
 * Returns null if text doesn't contain Indic script.
 */
export function romanizeIfIndicScript(text: string, detectedLocale?: SupportedLocale | null): string | null {
  const scriptName = detectedLocale ? LOCALE_TO_SCRIPT[detectedLocale] : null;
  if (!scriptName && !/[\u0900-\u0D7F]/u.test(text)) {
    return null;
  }
  const romanized = romanizeIndicScript(text);
  // Only return if we actually changed something
  if (romanized === text) return null;
  return romanized;
}

export { localeNames };
