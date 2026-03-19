export const supportedClawCloudLocales = [
  "en",
  "es",
  "fr",
  "ar",
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
] as const;

export type SupportedLocale = (typeof supportedClawCloudLocales)[number];

export const DEFAULT_CLAW_CLOUD_LOCALE: SupportedLocale = "en";

export const localeNames: Record<SupportedLocale, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
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
};

const localeAliasMap: Record<string, SupportedLocale> = {
  english: "en",
  en: "en",
  spanish: "es",
  espanol: "es",
  es: "es",
  french: "fr",
  fr: "fr",
  arabic: "ar",
  ar: "ar",
  portuguese: "pt",
  portuguese_br: "pt",
  pt: "pt",
  hindi: "hi",
  hi: "hi",
  punjabi: "pa",
  pa: "pa",
  german: "de",
  de: "de",
  italian: "it",
  it: "it",
  turkish: "tr",
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
  japanese: "ja",
  ja: "ja",
  korean: "ko",
  ko: "ko",
  chinese: "zh",
  mandarin: "zh",
  zh: "zh",
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
    .trim()
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z\s_+-]/g, "")
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

  return isSupportedLocale(normalized) ? normalized : null;
}

export function getLocaleLabel(locale: SupportedLocale) {
  return localeNames[locale];
}
