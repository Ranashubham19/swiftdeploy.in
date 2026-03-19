import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
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

export type LocalePreferenceCommand =
  | { type: "set"; locale: SupportedLocale; label: string }
  | { type: "show" }
  | { type: "unsupported"; requested: string }
  | { type: "none" };

export function detectLocaleFromEmail(email: string): SupportedLocale {
  const lower = email.toLowerCase();
  for (const [tld, locale] of Object.entries(tldLocaleMap)) {
    if (lower.includes(tld)) {
      return locale;
    }
  }
  return DEFAULT_CLAW_CLOUD_LOCALE;
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

  return DEFAULT_CLAW_CLOUD_LOCALE;
}

export async function setUserLocale(userId: string, locale: SupportedLocale) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  await supabaseAdmin.from("user_preferences").upsert(
    { user_id: userId, language: locale, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
}

function normalizeLocaleRequest(value: string) {
  return value
    .trim()
    .replace(/^other[:\s]+/i, "")
    .replace(/[.!?]+$/g, "")
    .trim();
}

function extractLocalePreferenceCandidate(message: string): string | null {
  const patterns = [
    /^(?:always\s+)?(?:reply|respond|answer|speak|talk|write)(?:\s+to\s+me)?\s+in\s+(.+)$/i,
    /^(?:set|change|switch|update)\s+(?:my\s+)?(?:reply\s+)?language(?:\s+to)?\s+(.+)$/i,
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
    `I'll reply in ${label} from now on unless you ask for a translation or a different output language.`,
  ].join("\n");
}

export function buildLocalePreferenceStatusReply(locale: SupportedLocale) {
  const label = getLocaleLabel(locale);
  return [
    `Your current reply language is *${label}*.`,
    "",
    "You can change it anytime with messages like _reply in English_ or _set language to Hindi_.",
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

export async function translateMessage(message: string, locale: SupportedLocale) {
  if (locale === DEFAULT_CLAW_CLOUD_LOCALE) {
    return message;
  }

  const translated = await completeClawCloudPrompt({
    system: [
      `Translate the user's message into ${localeNames[locale]}. Return only the translated text.`,
      "Preserve Markdown formatting, placeholders like [Name] or [Date], numbers, dates, currency amounts, URLs, slash commands, stock tickers, UPI IDs, GST/TDS names, and product names exactly when they should stay unchanged.",
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
