export const supportedClawCloudLocales = [
  "en",
  "es",
  "fr",
  "ar",
  "th",
  "pt",
  "hi",
  "pa",
  "de",
  "it",
  "tr",
  "id",
  "ms",
  "sw",
  "nl",
  "pl",
  "ru",
  "ja",
  "ko",
  "zh",
  "ta",
  "te",
  "kn",
  "bn",
  "mr",
  "gu",
  // ── Additional world languages ──
  "vi",   // Vietnamese
  "uk",   // Ukrainian
  "he",   // Hebrew
  "fa",   // Persian (Farsi)
  "ur",   // Urdu
  "ne",   // Nepali
  "si",   // Sinhala
  "my",   // Burmese (Myanmar)
  "km",   // Khmer (Cambodian)
  "lo",   // Lao
  "fil",  // Filipino (Tagalog)
  "ro",   // Romanian
  "hu",   // Hungarian
  "cs",   // Czech
  "el",   // Greek
  "fi",   // Finnish
  "sv",   // Swedish
  "no",   // Norwegian
  "da",   // Danish
  "am",   // Amharic
  "af",   // Afrikaans
  "zu",   // Zulu
  "ha",   // Hausa
  "yo",   // Yoruba
  "ig",   // Igbo
  "sr",   // Serbian
  "hr",   // Croatian
  "bg",   // Bulgarian
  "sk",   // Slovak
  "ka",   // Georgian
  "hy",   // Armenian
  "az",   // Azerbaijani
  "kk",   // Kazakh
  "uz",   // Uzbek
  "ml",   // Malayalam
  "or",   // Odia
  "as",   // Assamese
] as const;

export type SupportedLocale = (typeof supportedClawCloudLocales)[number];

export const DEFAULT_CLAW_CLOUD_LOCALE: SupportedLocale = "en";

export const localeNames: Record<SupportedLocale, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
  th: "Thai",
  pt: "Portuguese",
  hi: "Hindi",
  pa: "Punjabi",
  de: "German",
  it: "Italian",
  tr: "Turkish",
  id: "Indonesian",
  ms: "Malay",
  sw: "Swahili",
  nl: "Dutch",
  pl: "Polish",
  ru: "Russian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese (Simplified)",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  bn: "Bengali",
  mr: "Marathi",
  gu: "Gujarati",
  vi: "Vietnamese",
  uk: "Ukrainian",
  he: "Hebrew",
  fa: "Persian",
  ur: "Urdu",
  ne: "Nepali",
  si: "Sinhala",
  my: "Burmese",
  km: "Khmer",
  lo: "Lao",
  fil: "Filipino",
  ro: "Romanian",
  hu: "Hungarian",
  cs: "Czech",
  el: "Greek",
  fi: "Finnish",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  am: "Amharic",
  af: "Afrikaans",
  zu: "Zulu",
  ha: "Hausa",
  yo: "Yoruba",
  ig: "Igbo",
  sr: "Serbian",
  hr: "Croatian",
  bg: "Bulgarian",
  sk: "Slovak",
  ka: "Georgian",
  hy: "Armenian",
  az: "Azerbaijani",
  kk: "Kazakh",
  uz: "Uzbek",
  ml: "Malayalam",
  or: "Odia",
  as: "Assamese",
};

const localeAliasMap: Record<string, SupportedLocale> = {
  english: "en",
  en: "en",
  "\u82f1\u6587": "en",
  "\u82f1\u8bed": "en",
  "\u82f1\u8a9e": "en",
  "\uc601\uc5b4": "en",
  spanish: "es",
  espanol: "es",
  es: "es",
  "\u897f\u73ed\u7259\u8bed": "es",
  "\u897f\u73ed\u7259\u8a9e": "es",
  "\u30b9\u30da\u30a4\u30f3\u8a9e": "es",
  "\uc2a4\ud398\uc778\uc5b4": "es",
  french: "fr",
  fr: "fr",
  "\u6cd5\u8bed": "fr",
  "\u6cd5\u8a9e": "fr",
  "\u30d5\u30e9\u30f3\u30b9\u8a9e": "fr",
  "\ud504\ub791\uc2a4\uc5b4": "fr",
  francais: "fr",
  arabic: "ar",
  ar: "ar",
  "\u963f\u62c9\u4f2f\u8bed": "ar",
  "\u963f\u62c9\u4f2f\u8a9e": "ar",
  "\u30a2\u30e9\u30d3\u30a2\u8a9e": "ar",
  "\uc544\ub78d\uc5b4": "ar",
  "\u0627\u0644\u0639\u0631\u0628\u064a\u0629": "ar",
  thai: "th",
  th: "th",
  tayca: "th",
  taylandaca: "th",
  tay_dili: "th",
  tailandes: "th",
  tailandesce: "th",
  tailandese: "th",
  bahasa_thailand: "th",
  thai_language: "th",
  "\u0e44\u0e17\u0e22": "th",
  "\u0e20\u0e32\u0e29\u0e32\u0e44\u0e17\u0e22": "th",
  "\u0e2d\u0e31\u0e07\u0e01\u0e24\u0e29": "en",
  "\u0e20\u0e32\u0e29\u0e32\u0e2d\u0e31\u0e07\u0e01\u0e24\u0e29": "en",
  "\u0e08\u0e35\u0e19": "zh",
  "\u0e20\u0e32\u0e29\u0e32\u0e08\u0e35\u0e19": "zh",
  "\u0e0d\u0e35\u0e48\u0e1b\u0e38\u0e48\u0e19": "ja",
  "\u0e20\u0e32\u0e29\u0e32\u0e0d\u0e35\u0e48\u0e1b\u0e38\u0e48\u0e19": "ja",
  "\u0e40\u0e01\u0e32\u0e2b\u0e25\u0e35": "ko",
  "\u0e20\u0e32\u0e29\u0e32\u0e40\u0e01\u0e32\u0e2b\u0e25\u0e35": "ko",
  portuguese: "pt",
  portuguese_br: "pt",
  pt: "pt",
  "\u8461\u8404\u7259\u8bed": "pt",
  "\u8461\u8404\u7259\u8a9e": "pt",
  "\u30dd\u30eb\u30c8\u30ac\u30eb\u8a9e": "pt",
  "\ud3ec\ub974\ud22c\uac08\uc5b4": "pt",
  portugues: "pt",
  hindi: "hi",
  hi: "hi",
  "\u5370\u5730\u8bed": "hi",
  "\u5370\u5730\u8a9e": "hi",
  "\u30d2\u30f3\u30c7\u30a3\u30fc\u8a9e": "hi",
  "\ud78c\ub514\uc5b4": "hi",
  "\u0939\u093f\u0902\u0926\u0940": "hi",
  punjabi: "pa",
  pa: "pa",
  german: "de",
  de: "de",
  "\u5fb7\u8bed": "de",
  "\u5fb7\u8a9e": "de",
  "\u30c9\u30a4\u30c4\u8a9e": "de",
  "\ub3c5\uc77c\uc5b4": "de",
  deutsch: "de",
  italian: "it",
  it: "it",
  "\u610f\u5927\u5229\u8bed": "it",
  "\u610f\u5927\u5229\u8a9e": "it",
  "\u30a4\u30bf\u30ea\u30a2\u8a9e": "it",
  "\uc774\ud0c8\ub9ac\uc544\uc5b4": "it",
  turkish: "tr",
  turkce: "tr",
  türkçe: "tr",
  tr: "tr",
  indonesian: "id",
  bahasa_indonesia: "id",
  id: "id",
  malay: "ms",
  bahasa_melayu: "ms",
  ms: "ms",
  swahili: "sw",
  sw: "sw",
  dutch: "nl",
  nl: "nl",
  polish: "pl",
  pl: "pl",
  russian: "ru",
  ru: "ru",
  "\u4fc4\u8bed": "ru",
  "\u4fc4\u8a9e": "ru",
  "\u30ed\u30b7\u30a2\u8a9e": "ru",
  "\ub7ec\uc2dc\uc544\uc5b4": "ru",
  "\u0440\u0443\u0441\u0441\u043a\u0438\u0439": "ru",
  japanese: "ja",
  japonca: "ja",
  ja: "ja",
  "\u65e5\u6587": "ja",
  "\u65e5\u8bed": "ja",
  "\u65e5\u8a9e": "ja",
  "\u65e5\u672c\u8a9e": "ja",
  "\uc77c\ubcf8\uc5b4": "ja",
  korean: "ko",
  korece: "ko",
  ko: "ko",
  "\u97e9\u8bed": "ko",
  "\u97d3\u8bed": "ko",
  "\u97d3\u8a9e": "ko",
  "\u97e9\u56fd\u8bed": "ko",
  "\u97d3\u570b\u8a9e": "ko",
  "\ud55c\uad6d\uc5b4": "ko",
  "\ud55c\uad6d\ub9d0": "ko",
  chinese: "zh",
  cince: "zh",
  çince: "zh",
  mandarin: "zh",
  zh: "zh",
  "\u4e2d\u6587": "zh",
  "\u6c49\u8bed": "zh",
  "\u6f22\u8a9e": "zh",
  "\u666e\u901a\u8bdd": "zh",
  "\u666e\u901a\u8a71": "zh",
  "\u4e2d\u56fd\u8bed": "zh",
  "\u4e2d\u570b\u8a9e": "zh",
  "\u4e2d\u6587_\u7b80\u4f53": "zh",
  "\u4e2d\u6587_\u7e41\u9ad4": "zh",
  "\uc911\uad6d\uc5b4": "zh",
  tamil: "ta",
  ta: "ta",
  telugu: "te",
  te: "te",
  kannada: "kn",
  kn: "kn",
  bengali: "bn",
  bangla: "bn",
  bn: "bn",
  marathi: "mr",
  mr: "mr",
  gujarati: "gu",
  gu: "gu",
  // ── Additional world languages ──
  vietnamese: "vi",
  vi: "vi",
  ukrainian: "uk",
  uk: "uk",
  hebrew: "he",
  he: "he",
  persian: "fa",
  farsi: "fa",
  fa: "fa",
  urdu: "ur",
  ur: "ur",
  nepali: "ne",
  ne: "ne",
  sinhala: "si",
  sinhalese: "si",
  si: "si",
  burmese: "my",
  myanmar: "my",
  khmer: "km",
  cambodian: "km",
  km: "km",
  lao: "lo",
  laotian: "lo",
  lo: "lo",
  filipino: "fil",
  tagalog: "fil",
  fil: "fil",
  romanian: "ro",
  ro: "ro",
  hungarian: "hu",
  hu: "hu",
  czech: "cs",
  cs: "cs",
  greek: "el",
  el: "el",
  finnish: "fi",
  fi: "fi",
  swedish: "sv",
  sv: "sv",
  norwegian: "no",
  no: "no",
  danish: "da",
  da: "da",
  amharic: "am",
  am: "am",
  afrikaans: "af",
  af: "af",
  zulu: "zu",
  zu: "zu",
  hausa: "ha",
  ha: "ha",
  yoruba: "yo",
  yo: "yo",
  igbo: "ig",
  ig: "ig",
  serbian: "sr",
  sr: "sr",
  croatian: "hr",
  hr: "hr",
  bulgarian: "bg",
  bg: "bg",
  slovak: "sk",
  sk: "sk",
  georgian: "ka",
  ka: "ka",
  armenian: "hy",
  hy: "hy",
  azerbaijani: "az",
  azeri: "az",
  az: "az",
  kazakh: "kk",
  kk: "kk",
  uzbek: "uz",
  uz: "uz",
  malayalam: "ml",
  ml: "ml",
  odia: "or",
  oriya: "or",
  or: "or",
  assamese: "as",
  as: "as",
};

export const supportedClawCloudLocaleOptions = supportedClawCloudLocales.map((locale) => ({
  value: locale,
  label: localeNames[locale],
}));

export function isSupportedLocale(value: string): value is SupportedLocale {
  return supportedClawCloudLocales.includes(value as SupportedLocale);
}

export function normalizeLocaleAlias(value: string) {
  return value
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^\p{L}\p{M}\p{N}\s_+-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[+\s-]+/g, "_");
}

export function resolveSupportedLocale(value: string): SupportedLocale | null {
  const normalized = normalizeLocaleAlias(value);
  if (!normalized) {
    return null;
  }

  if (localeAliasMap[normalized]) {
    return localeAliasMap[normalized];
  }

  const accentInsensitive = normalized
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .normalize("NFC");

  if (localeAliasMap[accentInsensitive]) {
    return localeAliasMap[accentInsensitive];
  }

  return isSupportedLocale(normalized) ? normalized : null;
}

export function getLocaleLabel(locale: SupportedLocale) {
  return localeNames[locale];
}
