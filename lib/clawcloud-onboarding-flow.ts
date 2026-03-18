import { setUserLocale, type SupportedLocale } from "@/lib/clawcloud-i18n";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { autoDetectAndSaveTimezone, saveMemoryFact } from "@/lib/clawcloud-user-memory";

export type OnboardingStep = 1 | 2 | 3;

type OnboardingState = {
  step: OnboardingStep;
  name?: string;
  city?: string;
};

const ONBOARDING_STATE_KEY = "_onboarding_state";

const LANGUAGE_MAP: Record<string, { locale: SupportedLocale; label: string }> = {
  english: { locale: "en", label: "English" },
  en: { locale: "en", label: "English" },
  hindi: { locale: "hi", label: "Hindi" },
  hi: { locale: "hi", label: "Hindi" },
  "हिंदी": { locale: "hi", label: "Hindi" },
  spanish: { locale: "es", label: "Spanish" },
  es: { locale: "es", label: "Spanish" },
  french: { locale: "fr", label: "French" },
  fr: { locale: "fr", label: "French" },
  arabic: { locale: "ar", label: "Arabic" },
  ar: { locale: "ar", label: "Arabic" },
  portuguese: { locale: "pt", label: "Portuguese" },
  pt: { locale: "pt", label: "Portuguese" },
  german: { locale: "de", label: "German" },
  de: { locale: "de", label: "German" },
  italian: { locale: "it", label: "Italian" },
  it: { locale: "it", label: "Italian" },
  turkish: { locale: "tr", label: "Turkish" },
  tr: { locale: "tr", label: "Turkish" },
  indonesian: { locale: "id", label: "Indonesian" },
  id: { locale: "id", label: "Indonesian" },
  malay: { locale: "ms", label: "Malay" },
  ms: { locale: "ms", label: "Malay" },
  dutch: { locale: "nl", label: "Dutch" },
  nl: { locale: "nl", label: "Dutch" },
  polish: { locale: "pl", label: "Polish" },
  pl: { locale: "pl", label: "Polish" },
  russian: { locale: "ru", label: "Russian" },
  ru: { locale: "ru", label: "Russian" },
  japanese: { locale: "ja", label: "Japanese" },
  ja: { locale: "ja", label: "Japanese" },
  korean: { locale: "ko", label: "Korean" },
  ko: { locale: "ko", label: "Korean" },
  chinese: { locale: "zh", label: "Chinese" },
  zh: { locale: "zh", label: "Chinese" },
  punjabi: { locale: "pa", label: "Punjabi" },
  pa: { locale: "pa", label: "Punjabi" },
  "ਪੰਜਾਬੀ": { locale: "pa", label: "Punjabi" },
  tamil: { locale: "ta", label: "Tamil" },
  ta: { locale: "ta", label: "Tamil" },
  "தமிழ்": { locale: "ta", label: "Tamil" },
  telugu: { locale: "te", label: "Telugu" },
  te: { locale: "te", label: "Telugu" },
  "తెలుగు": { locale: "te", label: "Telugu" },
  kannada: { locale: "kn", label: "Kannada" },
  kn: { locale: "kn", label: "Kannada" },
  "ಕನ್ನಡ": { locale: "kn", label: "Kannada" },
  bengali: { locale: "bn", label: "Bengali" },
  bangla: { locale: "bn", label: "Bengali" },
  bn: { locale: "bn", label: "Bengali" },
  "বাংলা": { locale: "bn", label: "Bengali" },
  marathi: { locale: "mr", label: "Marathi" },
  mr: { locale: "mr", label: "Marathi" },
  "मराठी": { locale: "mr", label: "Marathi" },
  gujarati: { locale: "gu", label: "Gujarati" },
  gu: { locale: "gu", label: "Gujarati" },
  "ગુજરાતી": { locale: "gu", label: "Gujarati" },
};

function capitalizeWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function step1Message(): string {
  return [
    "🦞 *Welcome to ClawCloud AI!*",
    "",
    "I'm your personal AI assistant on WhatsApp.",
    "",
    "*What should I call you?*",
    "_Just type your name or what you'd like to be called._",
  ].join("\n");
}

function step2Message(name: string): string {
  return [
    `Nice to meet you, *${name}!*`,
    "",
    "*What city are you in?*",
    "_For example: Mumbai, Dubai, London, Singapore._",
  ].join("\n");
}

function step3Message(city: string): string {
  return [
    `Got it - *${city}* ✅`,
    "",
    "*What language do you prefer?*",
    "Reply with: *English*, *Hindi*, *Punjabi*, *Tamil*, *Telugu*, *Kannada*, *Bengali*, *Marathi*, *Gujarati*, or *other: Spanish*.",
  ].join("\n");
}

function completionMessage(name: string, city: string, language: string): string {
  return [
    `✅ *All set, ${name}!*`,
    "",
    `📍 City: *${city}*`,
    `🌐 Language: *${language}*`,
    "",
    "I can help with code, email, reminders, calendar, news, finance, images, voice notes, and documents.",
    "",
    "*What's your first question?*",
  ].join("\n");
}

async function getOnboardingState(userId: string): Promise<OnboardingState | null> {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("user_memory")
    .select("value")
    .eq("user_id", userId)
    .eq("key", ONBOARDING_STATE_KEY)
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (!data?.value || typeof data.value !== "string") {
    return null;
  }

  try {
    return JSON.parse(data.value) as OnboardingState;
  } catch {
    return null;
  }
}

async function setOnboardingState(userId: string, state: OnboardingState): Promise<void> {
  await saveMemoryFact(userId, ONBOARDING_STATE_KEY, JSON.stringify(state), "inferred", 1);
}

async function clearOnboardingState(userId: string): Promise<void> {
  await getClawCloudSupabaseAdmin()
    .from("user_memory")
    .delete()
    .eq("user_id", userId)
    .eq("key", ONBOARDING_STATE_KEY)
    .catch(() => null);
}

async function markOnboardingComplete(userId: string): Promise<void> {
  await getClawCloudSupabaseAdmin()
    .from("users")
    .update({ onboarding_done: true })
    .eq("id", userId)
    .catch(() => null);
}

function extractName(text: string): string | null {
  const cleaned = text
    .replace(/^\[replying to:[^\]]+\]\s*/i, "")
    .replace(/^(my name is|i am|i'm|call me|naam hai|mera naam|naam)\s+/i, "")
    .replace(/[^\p{L}\p{M}\s'-]/gu, "")
    .trim();

  if (!cleaned || cleaned.length < 2 || cleaned.length > 40) {
    return null;
  }
  if (/^(yes|no|ok|okay|sure|fine|hello|hi|hey)$/i.test(cleaned)) {
    return null;
  }

  return capitalizeWords(cleaned.split(/\s+/)[0] ?? cleaned);
}

function extractCity(text: string): string | null {
  const cleaned = text
    .replace(/^\[replying to:[^\]]+\]\s*/i, "")
    .replace(/^(i live in|i am in|i'm in|city is|from|in|main|mera shahar)\s+/i, "")
    .replace(/[^\p{L}\p{M}\s'-]/gu, "")
    .trim();

  if (!cleaned || cleaned.length < 2 || cleaned.length > 50) {
    return null;
  }
  if (/^(yes|no|ok|okay|sure|skip)$/i.test(cleaned)) {
    return null;
  }

  return capitalizeWords(cleaned);
}

function parseLanguageReply(text: string): { locale: SupportedLocale; label: string } {
  const normalized = text.trim().toLowerCase();
  const otherMatch = normalized.match(/^other[:\s]+(.+)$/);
  if (otherMatch) {
    const choice = otherMatch[1].trim();
    return LANGUAGE_MAP[choice] ?? { locale: "en", label: capitalizeWords(choice) || "English" };
  }

  return LANGUAGE_MAP[normalized] ?? { locale: "en", label: "English" };
}

export async function getActiveOnboardingState(
  userId: string,
): Promise<OnboardingState | null> {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("users")
    .select("onboarding_done")
    .eq("id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (data?.onboarding_done === true) {
    return null;
  }

  return getOnboardingState(userId);
}

export async function startOnboarding(userId: string): Promise<string> {
  await setOnboardingState(userId, { step: 1 });
  return step1Message();
}

export async function handleOnboardingReply(
  userId: string,
  userMessage: string,
): Promise<string | null> {
  const state = await getOnboardingState(userId);
  if (!state) {
    return null;
  }

  const trimmed = userMessage.trim();

  if (state.step === 1) {
    const name = extractName(trimmed);
    if (!name) {
      return [
        "I didn't quite catch that.",
        "",
        "*What should I call you?*",
      ].join("\n");
    }

    await saveMemoryFact(userId, "name", name, "explicit", 1);
    await setOnboardingState(userId, { step: 2, name });
    return step2Message(name);
  }

  if (state.step === 2) {
    const city = extractCity(trimmed);
    if (!city) {
      return [
        "I didn't catch the city clearly.",
        "",
        "*What city are you in?*",
      ].join("\n");
    }

    await saveMemoryFact(userId, "city", city, "explicit", 1);
    void autoDetectAndSaveTimezone(userId, city).catch(() => null);
    await setOnboardingState(userId, {
      step: 3,
      name: state.name,
      city,
    });
    return step3Message(city);
  }

  const language = parseLanguageReply(trimmed);
  const name = state.name ?? "there";
  const city = state.city ?? "your city";

  await setUserLocale(userId, language.locale);
  await saveMemoryFact(userId, "language_preference", language.label, "explicit", 1);
  await clearOnboardingState(userId);
  await markOnboardingComplete(userId);

  return completionMessage(name, city, language.label);
}

export async function isNewUserNeedingOnboarding(userId: string): Promise<boolean> {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("users")
    .select("onboarding_done, created_at")
    .eq("id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (!data || data.onboarding_done === true) {
    return false;
  }

  if (data.created_at) {
    const ageMs = Date.now() - new Date(data.created_at).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > 7) {
      return false;
    }
  }

  return true;
}
