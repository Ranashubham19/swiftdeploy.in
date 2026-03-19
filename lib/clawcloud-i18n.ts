import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type SupportedLocale =
  | "en"
  | "es"
  | "fr"
  | "ar"
  | "pt"
  | "hi"
  | "pa"
  | "de"
  | "it"
  | "tr"
  | "id"
  | "ms"
  | "sw"
  | "nl"
  | "pl"
  | "ru"
  | "ja"
  | "ko"
  | "zh"
  | "ta"
  | "te"
  | "kn"
  | "bn"
  | "mr"
  | "gu";

const localeNames: Record<SupportedLocale, string> = {
  en: "English",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
  pt: "Portuguese",
  hi: "Hindi",
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
  pa: "Punjabi",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  bn: "Bengali",
  mr: "Marathi",
  gu: "Gujarati",
};

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

export function detectLocaleFromEmail(email: string): SupportedLocale {
  const lower = email.toLowerCase();
  for (const [tld, locale] of Object.entries(tldLocaleMap)) {
    if (lower.includes(tld)) {
      return locale;
    }
  }
  return "en";
}

export async function getUserLocale(userId: string): Promise<SupportedLocale> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();

  const { data: prefs } = await supabaseAdmin
    .from("user_preferences")
    .select("language")
    .eq("user_id", userId)
    .maybeSingle();

  const preferredLanguage = prefs?.language as string | undefined;
  if (preferredLanguage && preferredLanguage in localeNames) {
    return preferredLanguage as SupportedLocale;
  }

  const { data: account } = await supabaseAdmin
    .from("connected_accounts")
    .select("account_email")
    .eq("user_id", userId)
    .eq("provider", "gmail")
    .maybeSingle();

  if (account?.account_email) {
    return detectLocaleFromEmail(account.account_email);
  }

  return "en";
}

export async function setUserLocale(userId: string, locale: SupportedLocale) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  await supabaseAdmin.from("user_preferences").upsert(
    { user_id: userId, language: locale },
    { onConflict: "user_id" },
  );
}

export async function translateMessage(message: string, locale: SupportedLocale) {
  if (locale === "en") {
    return message;
  }

  const translated = await completeClawCloudPrompt({
    system: [
      `Translate the user's message into ${localeNames[locale]}. Return only the translated text.`,
      "Preserve numbers, dates, currency amounts, URLs, slash commands, stock tickers, UPI IDs, GST/TDS names, and product names exactly when they should stay unchanged.",
      INDIAN_LOCALES.has(locale)
        ? "Use natural modern wording for Indian users and do not over-translate banking, tax, or app terms that are commonly kept in English."
        : "Keep the translation natural and concise.",
    ].join(" "),
    user: message,
    maxTokens: 1000,
    fallback: message,
  });

  return translated || message;
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

export { localeNames };
