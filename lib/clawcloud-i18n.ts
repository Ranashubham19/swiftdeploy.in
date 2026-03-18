import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type SupportedLocale =
  | "en"
  | "es"
  | "fr"
  | "ar"
  | "pt"
  | "hi"
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
  | "pa";

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
    system: `Translate the user's message into ${localeNames[locale]}. Return only the translated text.`,
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
  ].join(" ");
}

export { localeNames };
