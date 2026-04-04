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
import { normalizeClawCloudUnderstandingMessage } from "@/lib/clawcloud-query-understanding";
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
  targetLanguageName?: string;
  /** When the user requests multiple output languages (e.g. "in Korean and Chinese") */
  additionalLocales?: SupportedLocale[];
};

const EXPLICIT_REPLY_LANGUAGE_REQUEST_RE =
  /\b(?:answer|reply|respond|write|tell me|explain|describe|summari[sz]e|story of|plot of|summary of|overview of|give me|say|send|draft|compose|rewrite|rephrase|polish|prepare|make|show|read|check|get|find|list)\b[\s\S]{0,240}\b(?:in|into)\s+([\p{L}][\p{L}\p{M}\s()+-]{1,48})[.!?]*$/iu;

function looksLikeTranslationFailureReply(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  return TRANSLATION_FAILURE_REPLY_PATTERNS.some((pattern) => pattern.test(trimmed));
}
const TRAILING_REPLY_LANGUAGE_REQUEST_RE =
  /\b(?:in|into)\s+([\p{L}][\p{L}\p{M}\s()+-]{1,48})[.!?]*$/iu;

const EXPLICIT_REPLY_LANGUAGE_CONTEXT_RE =
  /\b(?:story|plot|summary|synopsis|ending|tell me|explain|describe|summari[sz]e|overview|message|messages?|chat|conversation|history|texts?|reply|send|draft|compose|write|note|wish|greeting|text|email|mail|read|show|check|get|find|list)\b/i;

const MULTILINGUAL_EXPLICIT_REPLY_LANGUAGE_PATTERNS = [
  /(?:\u8bf7|\u8acb)?(?:\u7528|\u4ee5)\s*([\p{L}\p{M}\s()+-]{1,48}?)\s*(?:\u56de\u7b54|\u56de\u590d|\u56de\u8986|\u8bf4|\u8aaa|\u5199|\u5beb|\u8bb2|\u8b1b|\u7ffb\u8bd1|\u7ffb\u8b6f|\u544a\u8bc9|\u544a\u8a34|\u66ff\u6211|\u4ee3\u6211|\u5e2e\u6211|\u5e6b\u6211)/u,
  /([\p{L}\p{M}\s()+-]{1,48}?)\s*\u3067(?:(?:[\p{L}\p{M}\p{N}\s]+?)(?:\u3068|\u306b))?(?:\u7b54\u3048\u3066|\u8fd4\u4fe1\u3057\u3066|\u8fd4\u4e8b\u3057\u3066|\u8a71\u3057\u3066|\u8a00\u3063\u3066|\u66f8\u3044\u3066|\u7ffb\u8a33\u3057\u3066)/u,
  /([\p{L}\p{M}\s()+-]{1,48}?)(?:\ub85c|\uc73c\ub85c)[\p{L}\p{M}\p{N}\s]{0,48}?(?:\ub2f5\ud574|\ub300\ub2f5\ud574|\ub9d0\ud574|\uc368|\uc791\uc131\ud574|\ubc88\uc5ed\ud574)/u,
  /(?:\u0e15\u0e2d\u0e1a|\u0e15\u0e2d\u0e1a\u0e01\u0e25\u0e31\u0e1a|\u0e1e\u0e39\u0e14|\u0e1a\u0e2d\u0e01|\u0e40\u0e02\u0e35\u0e22\u0e19|\u0e41\u0e1b\u0e25|\u0e2a\u0e48\u0e07)[\p{L}\p{M}\p{N}\s]{0,64}?(?:\u0e40\u0e1b\u0e47\u0e19|\u0e14\u0e49\u0e27\u0e22)(?:\u0e20\u0e32\u0e29\u0e32)?\s*([\p{L}\p{M}\s()+-]{1,48})/u,
];

const MULTI_LOCALE_SEPARATOR_RE =
  /\s*(?:,|\/|&|\+|\band\b|\by\b|\bet\b|\bund\b|\be\b|\bve\b|\u548c|\u8207|\u4e0e|\u3068|\ubc0f|\uadf8\ub9ac\uace0)\s*/iu;

const SANSKRIT_EXPLICIT_LANGUAGE_RE =
  /\b(?:sanskrit|sanskritam|samskrit|samskritam|saṃskṛta(?:m)?|संस्कृत(?:म्|म)?|संस्कृतेन)\b/iu;
const SANSKRIT_SCRIPT_RE = /[\u0900-\u097f]/u;
const SANSKRIT_MARKER_RE =
  /(?:अस्ति|तर्हि|तथा|यदि|यदा|कथं|कथम्|कुत्र|भवति|भवन्ति|विशेषतः|व्यवहारिक|समय-जटिलता|स्थान-जटिलता|वितरित|प्रणालीषु|कार्यक्षमता|एल्गोरिद्मस्य|कस्यचित्|एतादृशस्य|उत्तरं|भाषायाम्|कृपया|कथय|वद|इति|[ः॥])/u;

function stripTrailingReplyLanguageRequestNoise(value: string) {
  return String(value ?? "")
    .replace(/\b(?:do\s+not|don't|dont)\s+change(?:\s+the)?\s+(?:text|message|words?)\b/gi, "")
    .replace(/\bonly\s+(?:paste|send|share|use)\s+(?:the\s+)?same\s+(?:text|test|message|words?)\b/gi, "")
    .replace(/\b(?:paste|copy)\s+(?:the\s+)?same\s+(?:text|test|message|words?)\b/gi, "")
    .replace(/\bok(?:ay)?\s+do\s+it\s+(?:professionally|properly)\b/gi, "")
    .replace(/\bdo\s+it\s+(?:professionally|properly)\b/gi, "")
    .replace(/\b(?:professionally|properly)\b[.!?]*$/gi, "")
    .replace(/\bplease\b[.!?]*$/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractExplicitReplyLocaleCandidate(message: string) {
  const normalized = stripTrailingReplyLanguageRequestNoise(normalizeMessageForLanguageDetection(message));
  if (!normalized) {
    return "";
  }

  const match =
    normalized.match(EXPLICIT_REPLY_LANGUAGE_REQUEST_RE)
    || (
      EXPLICIT_REPLY_LANGUAGE_CONTEXT_RE.test(normalized)
      ? normalized.match(TRAILING_REPLY_LANGUAGE_REQUEST_RE)
      : null
    );

  if (match?.[1]?.trim()) {
    return match[1].trim();
  }

  for (const pattern of MULTILINGUAL_EXPLICIT_REPLY_LANGUAGE_PATTERNS) {
    const localizedMatch = normalized.match(pattern);
    if (localizedMatch?.[1]?.trim()) {
      return localizedMatch[1].trim();
    }
  }

  const localizedOutputLanguageMatch = normalized.match(
    /\b([\p{L}\p{M}]{2,32})\s+(?:hikaye(?:si|sini)?|özet(?:i|ini)?|ozet(?:i|ini)?|story|plot|summary|sinopsis|resumen|translation|çeviri|ceviri)\b/iu,
  );

  return localizedOutputLanguageMatch?.[1]?.trim() ?? "";
}

function extractSpecialExplicitReplyLanguage(message: string): {
  locale: SupportedLocale;
  targetLanguageName: string;
} | null {
  const candidate = extractExplicitReplyLocaleCandidate(message);
  if (!candidate) {
    return null;
  }

  if (SANSKRIT_EXPLICIT_LANGUAGE_RE.test(candidate)) {
    return {
      locale: "hi",
      targetLanguageName: "Sanskrit",
    };
  }

  return null;
}

const MESSAGE_SCRIPT_PATTERNS: Array<{ locale: SupportedLocale; pattern: RegExp }> = [
  // ── Semitic / RTL scripts ──
  { locale: "he", pattern: /[\u0590-\u05ff]/u },
  { locale: "ar", pattern: /[\u0600-\u06ff]/u },
  { locale: "fa", pattern: /[\u0600-\u06ff].*[\u067e\u0686\u0698\u06af\u06cc]/u }, // Persian-specific chars
  { locale: "ur", pattern: /[\u0600-\u06ff].*[\u0679\u0688\u0691\u06ba\u06be\u06c1\u06d2]/u }, // Urdu-specific chars
  // ── Cyrillic scripts ──
  { locale: "uk", pattern: /[\u0400-\u04ff].*[\u0404\u0406\u0407\u0490\u0491]/u }, // Ukrainian-specific chars ЄІЇҐґ
  { locale: "bg", pattern: /[\u0400-\u04ff].*[\u0429\u044a\u044c]/u }, // Bulgarian hints
  { locale: "sr", pattern: /[\u0400-\u04ff].*[\u0402\u0403\u0409\u040a\u040b\u040f]/u }, // Serbian Cyrillic
  { locale: "ru", pattern: /[\u0400-\u04ff]/u },
  // ── East Asian scripts ──
  { locale: "ja", pattern: /[\u3040-\u30ff]/u },
  { locale: "ko", pattern: /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/u },
  { locale: "zh", pattern: /[\u4e00-\u9fff]/u },
  // ── Southeast Asian scripts ──
  { locale: "th", pattern: /[\u0e00-\u0e7f]/u },
  { locale: "lo", pattern: /[\u0e80-\u0eff]/u },
  { locale: "my", pattern: /[\u1000-\u109f]/u },
  { locale: "km", pattern: /[\u1780-\u17ff]/u },
  // ── South Asian scripts ──
  { locale: "pa", pattern: /[\u0a00-\u0a7f]/u },
  { locale: "gu", pattern: /[\u0a80-\u0aff]/u },
  { locale: "or", pattern: /[\u0b00-\u0b7f]/u },
  { locale: "bn", pattern: /[\u0980-\u09ff]/u },
  { locale: "as", pattern: /[\u0980-\u09ff].*[\u09f0\u09f1]/u }, // Assamese-specific
  { locale: "ta", pattern: /[\u0b80-\u0bff]/u },
  { locale: "te", pattern: /[\u0c00-\u0c7f]/u },
  { locale: "kn", pattern: /[\u0c80-\u0cff]/u },
  { locale: "ml", pattern: /[\u0d00-\u0d7f]/u },
  { locale: "si", pattern: /[\u0d80-\u0dff]/u },
  { locale: "ne", pattern: /[\u0900-\u097f]/u }, // Devanagari (same as Hindi, disambiguated by vocabulary)
  { locale: "hi", pattern: /[\u0900-\u097f]/u },
  // ── Caucasian / unique scripts ──
  { locale: "ka", pattern: /[\u10a0-\u10ff\u2d00-\u2d2f]/u },
  { locale: "hy", pattern: /[\u0530-\u058f]/u },
  // ── African scripts ──
  { locale: "am", pattern: /[\u1200-\u137f]/u },
  // ── Greek script ──
  { locale: "el", pattern: /[\u0370-\u03ff]/u },
];

const LATIN_LANGUAGE_PATTERNS: Array<{ locale: SupportedLocale; pattern: RegExp }> = [
  { locale: "es", pattern: /\b(?:hola|gracias|por favor|puedes|puedo|necesito|ayuda|explica|explicame|dime|como|porque|hoy|precio|noticias|clima|temperatura|quien|quién|fue|primer|primero|primera|presidente|cuál|cuantos|cuántos|donde|dónde|cuando|cuándo|también|también|pero|sobre|tiene|tienen|puede|pueden|hacer|decir|saber|quiero|ciudad|país|historia|mundo|guerra|rey|reina)\b/i },
  { locale: "fr", pattern: /\b(?:bonjour|merci|s'il vous plaît|besoin|aide|explique|dis-moi|comment|pourquoi|aujourd'hui|prix|actualités|météo|quelle|quel|quels|quelles|qui|était|premier|première|président|capitale|combien|aussi|mais|dans|peut|faire|dire|savoir|veux|ville|pays|histoire|monde|guerre|roi|reine)\b/i },
  { locale: "de", pattern: /\b(?:hallo|danke|bitte|hilfe|erkläre|erklären|sag mir|warum|heute|nachrichten|wetter|welche|welcher|welches|erste|erster|präsident|hauptstadt|wieviele|können|machen|sagen|wissen|möchte|stadt|geschichte|könig|königin)\b/i },
  { locale: "pt", pattern: /\b(?:olá|obrigado|obrigada|por favor|preciso|ajuda|explica|me diga|como|porque|hoje|preço|notícias|tempo)\b/i },
  { locale: "it", pattern: /\b(?:ciao|grazie|per favore|ho bisogno|aiuto|spiega|dimmi|come|perché|oggi|prezzo|notizie|meteo)\b/i },
  { locale: "tr", pattern: /\b(?:merhaba|teşekkürler|tesekkurler|lütfen|yardım|açıkla|acikla|söyle|soyle|nasıl|neden|bugün|fiyat|haberler|hava)\b/i },
  { locale: "id", pattern: /\b(?:halo|terima kasih|tolong|bantu|jelaskan|katakan|bagaimana|kenapa|mengapa|apakah|saya|kamu|anda|hari ini|harga|berita|cuaca)\b/i },
  { locale: "ms", pattern: /\b(?:terima kasih|tolong|bantu|jelaskan|beritahu|bagaimana|kenapa|awak|anda|saya|boleh|tak|tidak|hari ini|harga|berita|cuaca)\b/i },
  { locale: "sw", pattern: /\b(?:habari|asante|tafadhali|msaada|eleza|niambie|vipi|kwa nini|leo|bei|habari|hali ya hewa)\b/i },
  { locale: "nl", pattern: /\b(?:hallo|dank je|alsjeblieft|help|leg uit|vertel me|hoe|waarom|vandaag|prijs|nieuws|weer)\b/i },
  { locale: "pl", pattern: /\b(?:cześć|czesc|dziękuję|dziekuje|proszę|prosze|pomoc|wyjaśnij|wyjasnij|powiedz|jak|dlaczego|dzisiaj|cena|wiadomości|wiadomosci|pogoda)\b/i },
  // ── Additional Latin-script languages ──
  { locale: "vi", pattern: /\b(?:xin chào|cảm ơn|vui lòng|giúp|giải thích|tại sao|hôm nay|thời tiết|tin tức|bao nhiêu|ở đâu|khi nào|tôi|bạn|không|được|người|nước|thế giới)\b/i },
  { locale: "ro", pattern: /\b(?:bună|mulțumesc|multumesc|vă rog|ajutor|explică|de ce|azi|știri|stiri|vreme|cât|unde|când|cine|este|sunt|poate|face|spune|oraș|țară|lume)\b/i },
  { locale: "hu", pattern: /\b(?:szia|köszönöm|kérem|segítség|magyarázd|miért|ma|hírek|időjárás|mennyi|hol|mikor|ki|van|lehet|csinál|mond|tud|város|ország|világ)\b/i },
  { locale: "cs", pattern: /\b(?:ahoj|děkuji|dekuji|prosím|pomoc|vysvětli|proč|dnes|zprávy|počasí|kolik|kde|kdy|kdo|je|jsou|může|dělat|říct|město|země|svět)\b/i },
  { locale: "fi", pattern: /\b(?:hei|kiitos|ole hyvä|auta|selitä|miksi|tänään|uutiset|sää|paljonko|missä|milloin|kuka|on|ovat|voi|tehdä|sanoa|kaupunki|maa|maailma)\b/i },
  { locale: "sv", pattern: /\b(?:hej|tack|snälla|hjälp|förklara|varför|idag|nyheter|väder|hur mycket|var|när|vem|är|kan|göra|säga|stad|land|värld)\b/i },
  { locale: "no", pattern: /\b(?:hei|takk|vennligst|hjelp|forklar|hvorfor|i dag|nyheter|vær|hvor mye|hvor|når|hvem|er|kan|gjøre|si|by|land|verden)\b/i },
  { locale: "da", pattern: /\b(?:hej|tak|venligst|hjælp|forklar|hvorfor|i dag|nyheder|vejr|hvor meget|hvor|hvornår|hvem|er|kan|gøre|sige|by|land|verden)\b/i },
  { locale: "hr", pattern: /\b(?:bok|hvala|molim|pomoć|objasni|zašto|danas|vijesti|vrijeme|koliko|gdje|kada|tko|je|su|može|raditi|reći|grad|zemlja|svijet)\b/i },
  { locale: "sk", pattern: /\b(?:ahoj|ďakujem|prosím|pomoc|vysvetli|prečo|dnes|správy|počasie|koľko|kde|kedy|kto|je|sú|môže|robiť|povedať|mesto|krajina|svet)\b/i },
  { locale: "af", pattern: /\b(?:hallo|dankie|asseblief|help|verduidelik|hoekom|vandag|nuus|weer|hoeveel|waar|wanneer|wie|is|kan|maak|sê|stad|land|wêreld)\b/i },
  { locale: "fil", pattern: /\b(?:kamusta|salamat|pakiusap|tulong|ipaliwanag|bakit|ngayon|balita|panahon|magkano|saan|kailan|sino|ang|mga|pwede|gumawa|sabihin|lungsod|bansa|mundo)\b/i },
  { locale: "az", pattern: /\b(?:salam|təşəkkür|zəhmət|kömək|izah et|niyə|bu gün|xəbərlər|hava|nə qədər|harada|nə vaxt|kim|var|edir|bilir|etmək|demək|şəhər|ölkə|dünya)\b/i },
  { locale: "uz", pattern: /\b(?:salom|rahmat|iltimos|yordam|tushuntir|nima uchun|bugun|yangiliklar|ob-havo|qancha|qayerda|qachon|kim|bor|qilmoq|aytmoq|shahar|mamlakat|dunyo)\b/i },
  { locale: "sw", pattern: /\b(?:habari|asante|tafadhali|msaada|eleza|niambie|vipi|kwa nini|leo|bei|habari|hali ya hewa|nchi|jiji|dunia|watu|serikali|elimu)\b/i },
  { locale: "ha", pattern: /\b(?:sannu|nagode|don allah|taimako|bayyana|me yasa|yau|labarai|yanayi|nawa|ina|yaushe|wane|ne|iya|yi|ce|gari|kasa|duniya)\b/i },
  { locale: "yo", pattern: /\b(?:bawo|ẹ ku|jọwọ|iranlọwọ|ṣalaye|kilode|loni|iroyin|oju ojo|melo|nibo|nigbawo|tani|ni|le|ṣe|sọ|ilu|orile-ede|aye)\b/i },
  { locale: "ig", pattern: /\b(?:kedu|daalụ|biko|enyemaka|kọwaa|gịnị mere|taa|akụkọ|ihu igwe|ole|ebee|mgbe|onye|bụ|nwere|ike|mee|kwuo|obodo|ala|ụwa)\b/i },
];

const ROMAN_PUNJABI_SIGNAL_RE =
  /\b(?:sat\s*sri\s*akal|sri\s*akaal|tusi|tuhada|tuhanu|mainu|menu|sanu|kive|kiven|kidda|kida|ki\s+haal|changa|vadhiya|vadiya|gall|punjabi|paaji|paji|veer|kudi|munda|naal|vich|krdo|kardo)\b/i;
const ENGLISH_COMMAND_SIGNAL_RE =
  /(?:\b(?:talk|speak|chat|message|reply)\s+(?:to|with)\b|\b(?:start|begin)\s+(?:talking|replying|messaging|chatting)\s+(?:to|with)\b|\bstop\s+(?:talking|replying|messaging|chatting)\s+(?:to|with)\b|\bon\s+my\s+behalf\b|\bfor\s+me\b|\bwho\s+are\s+you\s+(?:talking|replying)\s+to\b|\bwhich\s+contact\s+is\s+active\b|\bactive\s+contact\b)/i;
const ENGLISH_SIGNAL_RE =
  /\b(?:the|and|what|why|how|please|can you|could you|would you|should i|help me|explain|tell me|show me|today|price|news|weather)\b/i;
const LATIN_SCRIPT_MESSAGE_RE = /^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u;
const SHORT_AMBIGUOUS_TOKENS = new Set([
  "h",
  "hi",
  "hii",
  "hiii",
  "hello",
  "hey",
  "hlo",
  "yo",
  "sup",
  "ok",
  "okay",
  "k",
  "hm",
  "hmm",
  "hmmm",
  "ping",
  "test",
  "hai",
]);
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
  "hello",
  "hi",
  "hii",
  "has",
  "how",
  "in",
  "is",
  "it",
  "its",
  "list",
  "message",
  "messages",
  "my",
  "of",
  "replying",
  "reply",
  "send",
  "show",
  "speak",
  "start",
  "stop",
  "talk",
  "talking",
  "tell",
  "the",
  "to",
  "yes",
  "no",
  "behalf",
  "branch",
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
  return normalizeClawCloudUnderstandingMessage(value)
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeRomanPunjabiMessage(normalized: string) {
  if (!LATIN_SCRIPT_MESSAGE_RE.test(normalized)) {
    return false;
  }

  return ROMAN_PUNJABI_SIGNAL_RE.test(normalized);
}

function isShortAmbiguousMessage(normalized: string) {
  if (!normalized) {
    return true;
  }

  const rawTokens = normalized.split(/\s+/).filter(Boolean);
  if (rawTokens.length > 2 || normalized.length > 24) {
    return false;
  }

  const tokens = rawTokens
    .map((token) => token.toLowerCase().replace(/[^a-z]/g, ""))
    .filter(Boolean);
  if (!tokens.length) {
    return true;
  }

  return tokens.every((token) => SHORT_AMBIGUOUS_TOKENS.has(token));
}

function shouldPreserveRomanScriptForLocale(locale: SupportedLocale | null, normalized: string) {
  if (!locale) {
    return false;
  }

  return INDIAN_LOCALES.has(locale) && LATIN_SCRIPT_MESSAGE_RE.test(normalized);
}

function looksLikeSanskritMessage(normalized: string) {
  return SANSKRIT_SCRIPT_RE.test(normalized) && SANSKRIT_MARKER_RE.test(normalized);
}

export function resolveClawCloudSpecialReplyLanguage(message: string): {
  locale: SupportedLocale;
  targetLanguageName: string;
  source: "explicit_request" | "mirrored_message";
} | null {
  const normalized = normalizeMessageForLanguageDetection(message);
  if (!normalized) {
    return null;
  }

  const explicitLanguage = extractSpecialExplicitReplyLanguage(normalized);
  if (explicitLanguage) {
    return {
      ...explicitLanguage,
      source: "explicit_request",
    };
  }

  if (looksLikeSanskritMessage(normalized)) {
    return {
      locale: "hi",
      targetLanguageName: "Sanskrit",
      source: "mirrored_message",
    };
  }

  return null;
}

function getRequestedLanguageDisplayName(locale: SupportedLocale, targetLanguageName?: string) {
  return targetLanguageName?.trim() || localeNames[locale];
}

function buildSanskritLanguageFallback(message: string) {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("full equation")
    || normalized.includes("given values")
    || normalized.includes("step by step")
  ) {
    return [
      "अस्मिन् प्रयासे अहं यथार्थं प्रत्यक्षं उत्तरं दातुं न अशक्नुवम्।",
      "",
      "कृपया पूर्णं समीकरणं वा सर्वाणि दत्तमूल्यानि, तथा किम् अवगन्तुम् वा समाधातुम् इच्छसि इति स्पष्टतया लिख।",
      "ततः अहं क्रमशः समाधानं करिष्यामि।",
    ].join("\n");
  }

  if (
    normalized.includes("concept")
    || normalized.includes("assumptions")
    || normalized.includes("model")
    || normalized.includes("theorem")
  ) {
    return [
      "अस्मिन् प्रयासे अहं विश्वसनीयम् प्रत्यक्षम् उत्तरं न दातुं शशाक।",
      "",
      "कृपया विशिष्टं तत्त्वं, मान्यताः, प्रतिमानम्, वा प्रमेयम् स्पष्टतया लिख, तथा कियत् विस्तारः अपेक्षितः इति अपि सूचय।",
      "ततः अहं तत् प्रत्यक्षतया व्याख्यास्यामि।",
    ].join("\n");
  }

  return [
    "अस्मिन् प्रयासे अहं विश्वसनीयम् प्रत्यक्षम् उत्तरं पूर्णतया न दातुं शशाक।",
    "",
    "कृपया प्रश्नस्य पूर्णं विवरणं वा आवश्यकाः सर्वे तथ्यानि पुनः स्पष्टतया प्रेषय।",
    "ततः अहं तस्य उत्तरं संस्कृतेन प्रत्यक्षतया दास्यामि।",
  ].join("\n");
}

export function buildClawCloudReplyLanguageFallback(targetLanguageName: string | undefined, message: string) {
  if (targetLanguageName === "Sanskrit") {
    return buildSanskritLanguageFallback(message);
  }

  return message;
}

export function extractExplicitReplyLocaleRequest(message: string): SupportedLocale | null {
  const locales = extractExplicitReplyLocaleRequests(message);
  if (locales.length !== 1) {
    return null;
  }

  return locales[0] ?? null;
}

export function extractExplicitReplyLocaleRequests(message: string): SupportedLocale[] {
  const candidate = extractExplicitReplyLocaleCandidate(message);
  if (!candidate) {
    return [];
  }

  const cleaned = candidate.replace(/\bnatural\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return [];
  }

  const singleLocale = resolveSupportedLocale(cleaned);
  if (singleLocale) {
    return [singleLocale];
  }

  const parts = cleaned
    .split(MULTI_LOCALE_SEPARATOR_RE)
    .map((value) => value.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return [];
  }

  const locales: SupportedLocale[] = [];
  for (const part of parts) {
    const resolved = resolveSupportedLocale(part);
    if (!resolved) {
      return [];
    }

    if (!locales.includes(resolved)) {
      locales.push(resolved);
    }
  }

  return locales;
}

function looksLikeEnglishMessage(normalized: string) {
  if (!LATIN_SCRIPT_MESSAGE_RE.test(normalized)) {
    return false;
  }

  if (ENGLISH_COMMAND_SIGNAL_RE.test(normalized)) {
    return true;
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

  // Non-Latin scripts always win (Arabic, CJK, Indic, etc.)
  for (const candidate of MESSAGE_SCRIPT_PATTERNS) {
    if (candidate.pattern.test(normalized)) {
      return candidate.locale;
    }
  }

  if (looksLikeRomanPunjabiMessage(normalized)) {
    return "pa";
  }

  // CRITICAL: Check English FIRST before other Latin languages to prevent
  // false positives from homonym words (e.g., German "was" = English "what").
  // English is the dominant language on WhatsApp and should take priority
  // when the message clearly looks English.
  if (looksLikeEnglishMessage(normalized)) {
    return "en";
  }

  for (const candidate of LATIN_LANGUAGE_PATTERNS) {
    if (candidate.pattern.test(normalized)) {
      return candidate.locale;
    }
  }

  return null;
}

export function resolveClawCloudReplyLanguage(input: {
  message: string;
  preferredLocale: SupportedLocale;
  recentUserMessages?: string[];
}): ClawCloudReplyLanguageResolution {
  const normalized = normalizeMessageForLanguageDetection(input.message);
  const specialReplyLanguage = resolveClawCloudSpecialReplyLanguage(normalized);
  if (specialReplyLanguage?.source === "explicit_request") {
    return {
      locale: specialReplyLanguage.locale,
      source: "explicit_request",
      detectedLocale: specialReplyLanguage.locale,
      preserveRomanScript: false,
      targetLanguageName: specialReplyLanguage.targetLanguageName,
    };
  }
  const explicitLocales = extractExplicitReplyLocaleRequests(normalized);
  if (explicitLocales.length === 1) {
    return {
      locale: explicitLocales[0]!,
      source: "explicit_request",
      detectedLocale: explicitLocales[0]!,
      preserveRomanScript: false,
    };
  }
  if (explicitLocales.length > 1) {
    return {
      locale: explicitLocales[0]!,
      source: "explicit_request",
      detectedLocale: explicitLocales[0]!,
      preserveRomanScript: false,
      additionalLocales: explicitLocales.slice(1),
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

  if (specialReplyLanguage?.source === "mirrored_message") {
    return {
      locale: specialReplyLanguage.locale,
      source: "mirrored_message",
      detectedLocale: specialReplyLanguage.locale,
      preserveRomanScript: false,
      targetLanguageName: specialReplyLanguage.targetLanguageName,
    };
  }

  const currentMessageLocale = inferClawCloudMessageLocale(normalized);
  const isLatinOnlyMessage = LATIN_SCRIPT_MESSAGE_RE.test(normalized);

  // Protect against history-driven language drift on Latin-script inputs.
  // If the current Latin message does not strongly map to another locale,
  // default to English instead of inheriting stale past-language context.
  if (!currentMessageLocale && isLatinOnlyMessage) {
    return {
      locale: "en",
      source: "mirrored_message",
      detectedLocale: "en",
      preserveRomanScript: false,
    };
  }

  const allowHistoryFallback =
    !looksLikeEnglishMessage(normalized)
    && !isShortAmbiguousMessage(normalized)
    && !isLatinOnlyMessage;
  const historyLocale = allowHistoryFallback
    ? input.recentUserMessages?.map((message) => inferClawCloudMessageLocale(message)).find(Boolean)
    : null;

  // If the current message has a clear detected locale, use it directly.
  // Only fall back to conversation history if the current message is ambiguous.
  // This prevents old non-English messages from overriding a clearly English current message.
  const detectedLocale =
    currentMessageLocale
    || historyLocale
    || null;
  const preserveRomanScript = shouldPreserveRomanScriptForLocale(detectedLocale, normalized);

  if (detectedLocale && detectedLocale !== input.preferredLocale) {
    return {
      locale: detectedLocale,
      source: "mirrored_message",
      detectedLocale,
      preserveRomanScript,
    };
  }

  return {
    locale: input.preferredLocale,
    source: "stored_preference",
    detectedLocale,
    preserveRomanScript: preserveRomanScript && detectedLocale === input.preferredLocale,
  };
}

export function buildClawCloudReplyLanguageInstruction(resolution: ClawCloudReplyLanguageResolution) {
  if (resolution.source === "explicit_request" && resolution.detectedLocale) {
    const detectedLanguageName = getRequestedLanguageDisplayName(
      resolution.detectedLocale,
      resolution.targetLanguageName,
    );
    // Multi-language request: "in Korean and Chinese"
    if (resolution.additionalLocales?.length) {
      const allLocales = [resolution.detectedLocale, ...resolution.additionalLocales];
      const langNames = allLocales.map((l) => localeNames[l] ?? l).join(" AND ");
      return `The user explicitly asked for the answer in MULTIPLE languages: ${langNames}. You MUST provide the complete answer in EACH of these languages, one after another. Use a heading like *[Language Name]* before each section. Do NOT omit any language — the user expects output in ALL requested languages.`;
    }

    if (resolution.detectedLocale === "en") {
      return "The user explicitly asked for the answer in English. Reply fully in natural English.";
    }

    return `The user explicitly asked for the answer in ${detectedLanguageName}. Reply fully in that language and keep the answer natural and fluent.`;
  }

  if (resolution.source === "hinglish_message") {
    return "The user is writing in Hinglish. Reply in natural Hinglish using Roman script, and keep the same casual human tone.";
  }

  if (resolution.source === "mirrored_message" && resolution.detectedLocale) {
    const mirroredLanguageName = getRequestedLanguageDisplayName(
      resolution.detectedLocale,
      resolution.targetLanguageName,
    );
    if (resolution.detectedLocale === "en") {
      return "The user's current message is in English. Reply fully in natural English. Do not switch into Hindi, Hinglish, or any other language unless the user explicitly asks for that language.";
    }

    if (resolution.preserveRomanScript) {
      return `The user is writing in ${mirroredLanguageName} using Roman script. Mirror that language naturally and keep the reply fully in Roman script only. Do not switch into native scripts.`;
    }

    return `The user is writing in ${mirroredLanguageName}. Mirror that language naturally in your reply and preserve the user's tone and formality.`;
  }

  if (resolution.preserveRomanScript && resolution.locale !== "en") {
    return `Reply in ${getRequestedLanguageDisplayName(resolution.locale, resolution.targetLanguageName)} using natural Roman script only. Do not switch into native scripts unless the user explicitly asks for that script.`;
  }

  if (resolution.locale === "en") {
    return "Reply in natural English by default. Only switch into Hindi, Hinglish, or any other language if the user explicitly asks for it or clearly writes the current message in that language.";
  }

  return `Reply in ${getRequestedLanguageDisplayName(resolution.locale, resolution.targetLanguageName)} unless the user explicitly asks for a different output language.`;
}

/**
 * Pre-send language verification guard.
 * Checks if the AI reply language matches the user's expected language.
 */
export function verifyReplyLanguageMatch(input: {
  userMessage: string;
  aiReply: string;
  resolution: ClawCloudReplyLanguageResolution;
}): { verified: boolean; expected: string; detected: string | null } {
  const expectedLocale = input.resolution.locale;
  const replyLocale = inferClawCloudMessageLocale(input.aiReply);
  const expectedLanguage = input.resolution.targetLanguageName ?? expectedLocale;

  if (!input.aiReply.trim() || input.aiReply.trim().length < 20) {
    return { verified: true, expected: expectedLanguage, detected: replyLocale };
  }

  if (input.resolution.source === "hinglish_message") {
    return { verified: true, expected: "hinglish", detected: replyLocale };
  }

  if (input.resolution.targetLanguageName === "Sanskrit") {
    return {
      verified: looksLikeSanskritMessage(normalizeMessageForLanguageDetection(input.aiReply)),
      expected: "Sanskrit",
      detected: replyLocale,
    };
  }

  if (expectedLocale === "en") {
    const replyIsEnglish = !replyLocale || replyLocale === "en";
    return { verified: replyIsEnglish, expected: "en", detected: replyLocale };
  }

  if (!replyLocale) {
    return { verified: true, expected: expectedLocale, detected: null };
  }

  return { verified: replyLocale === expectedLocale, expected: expectedLocale, detected: replyLocale };
}

/**
 * Builds a language correction instruction when the AI reply is in the wrong language.
 */
export function buildLanguageCorrectionInstruction(expected: string, detected: string | null): string {
  const expectedName = localeNames[expected as SupportedLocale] ?? expected;
  const detectedName = detected ? (localeNames[detected as SupportedLocale] ?? detected) : "unknown";
  return [
    `CRITICAL LANGUAGE ERROR: Your reply was detected as ${detectedName} but the user expects ${expectedName}.`,
    `You MUST rewrite your ENTIRE reply in ${expectedName}.`,
    `Do NOT mix languages. Translate ALL content into ${expectedName}.`,
  ].join("\n");
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
    targetLanguageName?: string;
    preferredModels?: string[];
  },
) {
  if (locale === DEFAULT_CLAW_CLOUD_LOCALE && !options?.force) {
    return message;
  }

  const targetLanguageName = getRequestedLanguageDisplayName(locale, options?.targetLanguageName);
  const isSanskritTarget = options?.targetLanguageName === "Sanskrit";

  // Detect source language for Indic scripts to provide explicit hints and use better models
  const detectedSourceLocale = inferClawCloudMessageLocale(message);
  const isIndicSource = detectedSourceLocale ? INDIAN_LOCALES.has(detectedSourceLocale) : false;
  const sourceLanguageName = detectedSourceLocale ? (localeNames[detectedSourceLocale] ?? null) : null;
  const indicModels = (isIndicSource || isSanskritTarget) ? [
    "qwen/qwen3.5-397b-a17b",
    "meta/llama-3.1-405b-instruct",
    "deepseek-ai/deepseek-v3.1-terminus",
    "moonshotai/kimi-k2.5",
    "mistralai/mistral-large-3-675b-instruct-2512",
  ] : undefined;

  // For Indic→English translation, romanize first and translate the romanized text
  // (models understand romanized Indic text much better than native scripts)
  const romanizedForTranslation = (isIndicSource && locale === "en" && options?.force)
    ? romanizeIndicScript(message)
    : null;
  const effectiveMessage = (romanizedForTranslation && romanizedForTranslation !== message)
    ? romanizedForTranslation
    : message;

  const translated = await completeClawCloudPrompt({
    system: [
      `Translate the user's message into ${targetLanguageName}. Return only the translated text.`,
      isIndicSource && sourceLanguageName && romanizedForTranslation
        ? `The source text is romanized ${sourceLanguageName}. ${sourceLanguageName} shares many words with Hindi and Sanskrit. Use your Hindi/Sanskrit knowledge to understand the vocabulary.`
        : isIndicSource && sourceLanguageName
          ? `The source text is written in ${sourceLanguageName} script. Read and understand it as ${sourceLanguageName} text before translating.`
          : null,
      isSanskritTarget
        ? "The target language is Sanskrit (संस्कृतम्). Write in Devanagari script only. Do not answer in Hindi or English."
        : null,
      isSanskritTarget
        ? "Preserve technical symbols such as O(n log n), n→∞, arrays, and algorithm names where needed, but translate the surrounding explanation fully into natural Sanskrit."
        : null,
      "Preserve the original tone, warmth, directness, and level of formality. Make it sound like a natural human reply, not a stiff machine translation.",
      `The source text may already contain some ${targetLanguageName} words, quoted titles, proper nouns, or mixed-language phrases. Still translate the surrounding prose faithfully.`,
      `Never say the text is already in ${targetLanguageName}. Never refuse translation for that reason.`,
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
    user: effectiveMessage,
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
        : (
          options?.targetLanguageName === "Sanskrit"
            ? !looksLikeSanskritMessage(normalizedCandidate)
            : candidateLocale !== locale
        )
    );

  if (shouldRetryForTargetLocale) {
    const retried = await completeClawCloudPrompt({
      system: [
        "You are a translation engine.",
        `Translate the user's text into natural ${targetLanguageName} only.`,
        `Your entire output must be in ${targetLanguageName}.`,
        isIndicSource && sourceLanguageName
          ? `The source text is in ${sourceLanguageName}. Read and understand the ${sourceLanguageName} script carefully before translating.`
          : null,
        isSanskritTarget
          ? "The target language is Sanskrit (संस्कृतम्). Use Devanagari script only. Do not answer in Hindi or English."
          : null,
        `The source text may include some ${targetLanguageName} words, titles, or names already. Do not refuse translation for that reason.`,
        options?.preserveRomanScript
          ? "Use natural Roman script instead of native script."
          : "Use the natural native script for that language where appropriate.",
        "Do not summarize, explain, ask questions, or add commentary.",
        `Do not say things like 'here is the translation', 'direct translation', or 'the text is already in ${targetLanguageName}'.`,
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
  targetLanguageName?: string;
}) {
  const normalized = normalizeMessageForLanguageDetection(input.message);
  if (!normalized) {
    return input.message;
  }

  if (input.preserveRomanScript) {
    if (detectHinglish(normalized)) {
      return input.message;
    }

    const romanTargetLocale: SupportedLocale = input.locale === "en" ? "hi" : input.locale;
    return translateMessage(input.message, romanTargetLocale, {
      force: true,
      preserveRomanScript: true,
      targetLanguageName: input.targetLanguageName,
    });
  }

  const detectedLocale = inferClawCloudMessageLocale(normalized);
  const looksHinglish = detectHinglish(normalized);
  const needsTranslation =
    input.targetLanguageName === "Sanskrit"
      ? !looksLikeSanskritMessage(normalized)
      : input.locale === "en"
        ? (
          looksHinglish
          || (detectedLocale !== null && detectedLocale !== "en")
          || (LATIN_SCRIPT_MESSAGE_RE.test(normalized) && normalized.length > 24 && !looksLikeLikelyEnglishReply(normalized))
        )
        : detectedLocale !== input.locale;

  if (!needsTranslation) {
    return input.message;
  }

  // First translation attempt
  const firstAttempt = await translateMessage(input.message, input.locale, {
    force: true,
    preserveRomanScript: input.preserveRomanScript,
    targetLanguageName: input.targetLanguageName,
  });

  // Verify the translation actually landed in the target language
  const normalizedFirstAttempt = normalizeMessageForLanguageDetection(firstAttempt);
  const firstAttemptLocale = inferClawCloudMessageLocale(normalizedFirstAttempt);
  const translationSucceeded =
    input.targetLanguageName === "Sanskrit"
      ? looksLikeSanskritMessage(normalizedFirstAttempt)
      : input.locale === "en"
        ? (!firstAttemptLocale || firstAttemptLocale === "en")
        : firstAttemptLocale === input.locale;

  if (translationSucceeded || !firstAttempt.trim()) {
    return firstAttempt;
  }

  // Second attempt with stronger instruction if first translation missed
  const secondAttempt = await translateMessage(firstAttempt, input.locale, {
    force: true,
    preserveRomanScript: input.preserveRomanScript,
    targetLanguageName: input.targetLanguageName,
  }).catch(() => firstAttempt);

  if (input.targetLanguageName === "Sanskrit") {
    const normalizedSecondAttempt = normalizeMessageForLanguageDetection(secondAttempt);
    if (!looksLikeSanskritMessage(normalizedSecondAttempt)) {
      const dedicatedRewrite = await completeClawCloudPrompt({
        system: [
          "You are a translation engine.",
          "Rewrite the user's text fully into natural Sanskrit (संस्कृतम्).",
          "Use Devanagari script only.",
          "Do not answer in English or Hindi.",
          "Preserve Markdown, numbering, bullets, mathematical notation, symbols like O(n log n) and n→∞, and technical identifiers where they should stay unchanged.",
          "Return only the Sanskrit rewrite.",
        ].join(" "),
        user: input.message,
        maxTokens: 1000,
        fallback: secondAttempt,
        skipCache: true,
        temperature: 0.05,
        preferredModels: [
          "qwen/qwen3.5-397b-a17b",
          "meta/llama-3.1-405b-instruct",
          "deepseek-ai/deepseek-v3.1-terminus",
          "moonshotai/kimi-k2.5",
          "mistralai/mistral-large-3-675b-instruct-2512",
        ],
      }).catch(() => secondAttempt);

      if (looksLikeSanskritMessage(normalizeMessageForLanguageDetection(dedicatedRewrite))) {
        return dedicatedRewrite;
      }

      return buildSanskritLanguageFallback(input.message);
    }
  }

  return secondAttempt || firstAttempt;
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
