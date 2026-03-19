import { completeClawCloudFast } from "@/lib/clawcloud-ai";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

export type MemoryKey =
  | "name"
  | "preferred_name"
  | "city"
  | "country"
  | "profession"
  | "company"
  | "language_preference"
  | "timezone"
  | "age"
  | "interests"
  | "preferred_tone"
  | "wake_time"
  | "work_hours"
  | "goals"
  | "priorities"
  | "briefing_style"
  | "focus_areas"
  | "routine"
  | string;

export type MemorySource = "explicit" | "extracted" | "inferred";

export type MemoryRow = {
  id: string;
  user_id: string;
  key: MemoryKey;
  value: string;
  source: MemorySource;
  confidence: number;
  updated_at: string;
  created_at: string;
};

type ExtractedFact = {
  key: MemoryKey;
  value: string;
  confidence: number;
};

export type MemoryCommandIntent =
  | { type: "save_explicit"; key: MemoryKey; value: string }
  | { type: "forget_key"; key: MemoryKey }
  | { type: "forget_all" }
  | { type: "show_profile" }
  | { type: "show_suggestions" }
  | { type: "none" };

const EXTRACT_TIMEOUT_MS = 5_000;
const MAX_MEMORY_KEYS = 30;
const MIN_CONFIDENCE_TO_SAVE = 0.75;

const PROFESSION_HINT_RE =
  /\b(doctor|engineer|developer|designer|teacher|student|lawyer|nurse|manager|founder|ceo|cto|freelancer|consultant|analyst|writer|journalist|architect|scientist|marketer|accountant|product manager|salesperson)\b/i;

const LANGUAGE_HINT_RE =
  /\b(english|hindi|urdu|spanish|french|arabic|portuguese|german|italian|turkish|indonesian|malay|swahili|dutch|polish|russian|japanese|korean|chinese)\b/i;

const SELF_OR_REMINDER_CONTEXT_RE =
  /\b(i(?:'m| am| live| work)|my timezone|my local time|remind me|set (?:a )?reminder|today|tomorrow|tonight|morning|afternoon|evening|at \d{1,2}(?::\d{2})?\s?(?:am|pm)?)\b/i;

const THIRD_PARTY_LOCATION_QUERY_RE =
  /\b(weather|forecast|news|time in|capital of|population of|distance to|restaurants? in|hotels? in|flights? to)\b/i;

const KEY_LABELS: Record<string, string> = {
  name: "Name",
  preferred_name: "Preferred name",
  city: "City",
  country: "Country",
  profession: "Profession",
  company: "Company",
  language_preference: "Language preference",
  timezone: "Timezone",
  age: "Age",
  interests: "Interests",
  preferred_tone: "Preferred tone",
  wake_time: "Wake time",
  work_hours: "Work hours",
  goals: "Goals",
  priorities: "Priorities",
  briefing_style: "Briefing style",
  focus_areas: "Focus areas",
  routine: "Routine",
};

const MEMORY_GROUPS: Array<{ title: string; keys: MemoryKey[] }> = [
  {
    title: "Identity",
    keys: ["preferred_name", "name", "age", "city", "country", "timezone", "language_preference"],
  },
  {
    title: "Work",
    keys: ["profession", "company", "work_hours"],
  },
  {
    title: "Preferences",
    keys: ["preferred_tone", "briefing_style", "focus_areas", "interests"],
  },
  {
    title: "Goals and routines",
    keys: ["priorities", "goals", "routine", "wake_time"],
  },
];

const PERSONALIZATION_PROMPTS: Array<{ key: MemoryKey; prompt: string }> = [
  { key: "preferred_tone", prompt: "Remember my preferred tone is concise and direct" },
  { key: "focus_areas", prompt: "Remember my focus areas are product launches and hiring" },
  { key: "priorities", prompt: "Remember my priorities are closing enterprise deals and shipping Sprint 4" },
  { key: "wake_time", prompt: "Remember my wake time is 6:30 AM" },
  { key: "work_hours", prompt: "Remember my work hours are 9 AM to 6 PM IST" },
  { key: "goals", prompt: "Remember my goals are to grow revenue and stay fit" },
];

export async function saveMemoryFact(
  userId: string,
  key: MemoryKey,
  value: string,
  source: MemorySource = "extracted",
  confidence = 1.0,
): Promise<boolean> {
  const db = getClawCloudSupabaseAdmin();
  const normalizedValue = normalizeMemoryValue(key, value).slice(0, 500);
  if (!normalizedValue) return false;

  const { error } = await db.from("user_memory").upsert(
    {
      user_id: userId,
      key,
      value: normalizedValue,
      source,
      confidence,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,key" },
  );

  if (error) {
    console.error("[user-memory] saveMemoryFact error:", error.message);
    return false;
  }

  return true;
}

export async function getAllMemoryFacts(userId: string): Promise<MemoryRow[]> {
  const db = getClawCloudSupabaseAdmin();
  const { data, error } = await db
    .from("user_memory")
    .select("*")
    .eq("user_id", userId)
    .order("key", { ascending: true })
    .limit(MAX_MEMORY_KEYS);

  if (error) {
    console.error("[user-memory] getAllMemoryFacts error:", error.message);
    return [];
  }

  return (data ?? []) as MemoryRow[];
}

export async function deleteMemoryFact(userId: string, key: MemoryKey): Promise<boolean> {
  const db = getClawCloudSupabaseAdmin();
  const { data, error } = await db
    .from("user_memory")
    .delete()
    .eq("user_id", userId)
    .eq("key", key)
    .select("id");

  if (error) {
    console.error("[user-memory] deleteMemoryFact error:", error.message);
    return false;
  }

  return (data?.length ?? 0) > 0;
}

export async function clearAllMemoryFacts(userId: string): Promise<number> {
  const db = getClawCloudSupabaseAdmin();
  const { data, error } = await db
    .from("user_memory")
    .delete()
    .eq("user_id", userId)
    .select("id");

  if (error) {
    console.error("[user-memory] clearAllMemoryFacts error:", error.message);
    return 0;
  }

  return data?.length ?? 0;
}

export async function autoExtractAndSaveFacts(
  userId: string,
  message: string,
): Promise<void> {
  if (message.trim().length < 8) return;
  if (isMemoryCommand(message)) return;

  const facts = await extractFactsFromMessage(message);
  if (!facts.length) return;

  for (const fact of facts) {
    if (fact.confidence >= MIN_CONFIDENCE_TO_SAVE) {
      await saveMemoryFact(userId, fact.key, fact.value, "extracted", fact.confidence);
    }
  }
}

async function extractFactsFromMessage(message: string): Promise<ExtractedFact[]> {
  const systemPrompt = [
    "Extract personal facts about the user from their message.",
    "Return ONLY a JSON array of objects with: key, value, confidence (0-1).",
    "Keys must be one of: name, preferred_name, city, country, profession, company, age, interests, language_preference, preferred_tone, wake_time, work_hours, goals, priorities, briefing_style, focus_areas, routine.",
    "",
    "Rules:",
    "  - Only extract facts the user states about themselves, not hypotheticals or questions.",
    "  - 'I am a doctor' -> [{\"key\":\"profession\",\"value\":\"doctor\",\"confidence\":0.95}]",
    "  - 'I live in Delhi' -> [{\"key\":\"city\",\"value\":\"Delhi\",\"confidence\":0.95}]",
    "  - 'My name is Rahul' -> [{\"key\":\"name\",\"value\":\"Rahul\",\"confidence\":0.98}]",
    "  - 'Call me Raj' -> [{\"key\":\"preferred_name\",\"value\":\"Raj\",\"confidence\":0.95}]",
    "  - 'I work at Google' -> [{\"key\":\"company\",\"value\":\"Google\",\"confidence\":0.90}]",
    "  - 'I'm 28 years old' -> [{\"key\":\"age\",\"value\":\"28\",\"confidence\":0.95}]",
    "  - 'I love cricket and coding' -> [{\"key\":\"interests\",\"value\":\"cricket, coding\",\"confidence\":0.85}]",
    "  - 'Keep my briefings concise' -> [{\"key\":\"briefing_style\",\"value\":\"concise\",\"confidence\":0.88}]",
    "  - 'My preferred tone is direct and concise' -> [{\"key\":\"preferred_tone\",\"value\":\"direct and concise\",\"confidence\":0.92}]",
    "  - 'My priorities are hiring and the product launch' -> [{\"key\":\"priorities\",\"value\":\"hiring, product launch\",\"confidence\":0.9}]",
    "  - 'My focus areas are sales and customer success' -> [{\"key\":\"focus_areas\",\"value\":\"sales, customer success\",\"confidence\":0.88}]",
    "  - 'I wake up at 6:30 am' -> [{\"key\":\"wake_time\",\"value\":\"6:30 AM\",\"confidence\":0.9}]",
    "  - 'My work hours are 9am to 6pm' -> [{\"key\":\"work_hours\",\"value\":\"9am to 6pm\",\"confidence\":0.9}]",
    "  - 'My goals are to lose weight and grow the business' -> [{\"key\":\"goals\",\"value\":\"lose weight, grow the business\",\"confidence\":0.88}]",
    "  - If nothing extractable exists, return []",
    "  - Never add explanations or markdown.",
    "Return ONLY the JSON array.",
  ].join("\n");

  try {
    const raw = await Promise.race([
      completeClawCloudFast({
        system: systemPrompt,
        user: message.slice(0, 400),
        maxTokens: 220,
        fallback: "[]",
      }),
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("[]"), EXTRACT_TIMEOUT_MS);
      }),
    ]);

    if (!raw?.trim() || raw.trim() === "[]") {
      return [];
    }

    const cleaned = raw
      .replace(/```json|```/gi, "")
      .replace(/^[^[]*(\[[\s\S]*\])[^\]]*$/, "$1")
      .trim();

    const parsed = JSON.parse(cleaned) as Array<{
      key?: string;
      value?: string;
      confidence?: number;
    }>;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => typeof item.key === "string" && typeof item.value === "string")
      .map((item) => ({
        key: item.key as MemoryKey,
        value: String(item.value ?? "").trim(),
        confidence: typeof item.confidence === "number" ? item.confidence : 0.8,
      }))
      .filter((item) => item.value.length > 0)
      .slice(0, 8);
  } catch {
    return [];
  }
}

export async function autoDetectAndSaveTimezone(
  userId: string,
  message: string,
): Promise<void> {
  const detected = detectTimezoneFromText(message);
  if (!detected) return;

  await saveMemoryFact(userId, "timezone", detected, "inferred", 0.85);

  const db = getClawCloudSupabaseAdmin();

  const { error: prefsError } = await db.from("user_preferences").upsert(
    { user_id: userId, timezone: detected, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (prefsError) {
    console.error("[user-memory] user_preferences timezone sync error:", prefsError.message);
  }

  const { error: userError } = await db
    .from("users")
    .update({ timezone: detected })
    .eq("id", userId);
  if (userError) {
    console.error("[user-memory] users timezone sync error:", userError.message);
  }
}

function detectTimezoneFromText(message: string): string | null {
  const lower = message.toLowerCase();
  if (!SELF_OR_REMINDER_CONTEXT_RE.test(lower) && THIRD_PARTY_LOCATION_QUERY_RE.test(lower)) {
    return null;
  }

  const timezoneHints: Array<[RegExp, string]> = [
    [/\bist\b|\bindia\b|\bdelhi\b|\bmumbai\b|\bbangalore\b|\bkolkata\b|\bchennai\b|\bhyderabad\b|\bpune\b|\bhindi\b|\bujjain\b/, "Asia/Kolkata"],
    [/\bpst\b|\blos angeles\b|\bsan francisco\b|\bseattle\b|\bvancouver\b/, "America/Los_Angeles"],
    [/\best\b|\bnew york\b|\btoronto\b|\bboston\b|\bmiami\b/, "America/New_York"],
    [/\bcst\b|\bchicago\b|\bdallas\b|\bhouston\b/, "America/Chicago"],
    [/\bgmt\b|\butc\b|\blondon\b|\bdublin\b/, "Europe/London"],
    [/\bcet\b|\bparis\b|\bberlin\b|\brome\b|\bamsterdam\b/, "Europe/Paris"],
    [/\bdubai\b|\babu dhabi\b|\bgst\b/, "Asia/Dubai"],
    [/\bsingapore\b|\bsgt\b|\bsgst\b/, "Asia/Singapore"],
    [/\btokyo\b|\bjapan\b|\bjst\b/, "Asia/Tokyo"],
    [/\bsydney\b|\bmelbourne\b|\baest\b/, "Australia/Sydney"],
    [/\bkarachi\b|\bpakistan\b|\bpkst\b/, "Asia/Karachi"],
    [/\bdhaka\b|\bbangladesh\b|\bbst\b/, "Asia/Dhaka"],
    [/\bcolombo\b|\bsri lanka\b/, "Asia/Colombo"],
    [/\bnairobi\b|\beast africa\b|\beat\b/, "Africa/Nairobi"],
    [/\blagos\b|\bnigeria\b|\bwat\b/, "Africa/Lagos"],
    [/\bcairo\b|\begypt\b/, "Africa/Cairo"],
    [/\bsao paulo\b|\bbrazil\b|\bbrt\b/, "America/Sao_Paulo"],
    [/\bmexico city\b|\bcdmx\b/, "America/Mexico_City"],
    [/\bmoscow\b|\brussia\b|\bmsk\b/, "Europe/Moscow"],
  ];

  for (const [pattern, timezone] of timezoneHints) {
    if (pattern.test(lower)) {
      return timezone;
    }
  }

  return null;
}

export function detectMemoryCommand(text: string): MemoryCommandIntent {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();

  if (
    /^(what do you know about me|what do you remember about me|what have you (?:learned|remembered|saved) about me|show(?: my)? (?:profile|memory)|my profile|about me|mera profile|mujhe kya pata hai)\??$/i.test(lower)
  ) {
    return { type: "show_profile" };
  }

  if (
    /^(memory suggestions|how can i personalize you|what should i tell you about me|what else should i save|how do i make you more personal|how can you know me better)\??$/i.test(lower)
  ) {
    return { type: "show_suggestions" };
  }

  if (
    /^(forget everything(?: about me)?|clear(?: my)? memory|reset(?: my)? profile|delete all my (?:data|memory|info))\??$/i.test(lower)
  ) {
    return { type: "forget_all" };
  }

  const forgetMatch = trimmed.match(/^(?:forget|delete|remove|clear)\s+my\s+(.+?)\.?\s*$/i);
  if (forgetMatch) {
    const key = resolveKeyAlias(forgetMatch[1]);
    if (key) {
      return { type: "forget_key", key };
    }
  }

  const directKeyValueMatch = trimmed.match(
    /^(?:remember|save|note|update|change|set)\s+my\s+(.+?)\s+(?:is|to)\s+(.+?)\.?\s*$/i,
  );
  if (directKeyValueMatch) {
    const key = resolveKeyAlias(directKeyValueMatch[1]);
    if (key) {
      return {
        type: "save_explicit",
        key,
        value: normalizeMemoryValue(key, directKeyValueMatch[2]),
      };
    }
  }

  const rememberMatch = trimmed.match(
    /^(?:remember|save|note|store|keep in mind|update|change|set)(?:\s+that)?[:\s]+(.+)/i,
  );
  if (rememberMatch) {
    const factText = rememberMatch[1].trim().replace(/[.!?]+$/, "");
    const keyValueMatch = factText.match(/^(?:my\s+)?(.+?)\s+is\s+(.+)$/i);
    if (keyValueMatch) {
      const key = resolveKeyAlias(keyValueMatch[1]);
      if (key) {
        return {
          type: "save_explicit",
          key,
          value: normalizeMemoryValue(key, keyValueMatch[2]),
        };
      }
    }

    const extracted = extractFactFromShortStatement(factText);
    if (extracted) {
      return { type: "save_explicit", key: extracted.key, value: extracted.value };
    }
  }

  return { type: "none" };
}

export function isMemoryCommand(text: string): boolean {
  return detectMemoryCommand(text).type !== "none";
}

function groupMemoryFacts(facts: MemoryRow[]) {
  return MEMORY_GROUPS
    .map((group) => ({
      title: group.title,
      facts: group.keys
        .map((key) => facts.find((fact) => fact.key === key))
        .filter((fact): fact is MemoryRow => Boolean(fact)),
    }))
    .filter((group) => group.facts.length > 0);
}

function buildMissingPersonalizationPrompts(facts: MemoryRow[]) {
  const presentKeys = new Set(facts.map((fact) => fact.key));
  return PERSONALIZATION_PROMPTS
    .filter((item) => !presentKeys.has(item.key))
    .slice(0, 4);
}

function legacyFormatProfileReply(facts: MemoryRow[]): string {
  if (!facts.length) {
    return [
      "🧠 *I don't know much about you yet.*",
      "",
      "You can tell me things like:",
      "• _My name is Rahul_",
      "• _I live in Delhi_",
      "• _I am a software engineer_",
      "• _I work at Google_",
      "",
      "I'll remember them for future conversations.",
    ].join("\n");
  }

  return [
    `🧠 *Here's what I know about you (${facts.length} fact${facts.length === 1 ? "" : "s"}):*`,
    "",
    ...facts.map((fact) => {
      const label = KEY_LABELS[fact.key] ?? humanizeKey(fact.key);
      const sourceTag = fact.source === "explicit" ? "" : " _(auto-learned)_";
      return `• *${label}:* ${fact.value}${sourceTag}`;
    }),
    "",
    "To forget something: _Forget my profession_",
    "To clear everything: _Forget everything about me_",
  ].join("\n");
}

export function formatProfileReply(facts: MemoryRow[]): string {
  if (!facts.length) {
    return [
      "I do not know much about you yet.",
      "",
      "You can tell me things like:",
      "- _My name is Rahul_",
      "- _I live in Delhi_",
      "- _I am a software engineer_",
      "- _My priorities are product launches and hiring_",
      "",
      "I'll remember them for future conversations.",
    ].join("\n");
  }

  const grouped = groupMemoryFacts(facts);
  const missingPrompts = buildMissingPersonalizationPrompts(facts);
  const lines = [
    `Here is your saved profile (${facts.length} fact${facts.length === 1 ? "" : "s"}).`,
  ];

  for (const group of grouped) {
    lines.push("", `*${group.title}*`);
    for (const fact of group.facts) {
      const label = KEY_LABELS[fact.key] ?? humanizeKey(fact.key);
      const sourceTag = fact.source === "explicit" ? "" : " _(auto-learned)_";
      lines.push(`- *${label}:* ${fact.value}${sourceTag}`);
    }
  }

  if (missingPrompts.length) {
    lines.push("", "*Useful things you can still teach me:*");
    for (const suggestion of missingPrompts) {
      lines.push(`- _${suggestion.prompt}_`);
    }
  }

  lines.push("", "To update something: _Update my city to Bangalore_");
  lines.push("To forget something: _Forget my profession_");
  lines.push("To clear everything: _Forget everything about me_");
  return lines.join("\n");
}

export function formatMemorySuggestionsReply(facts: MemoryRow[]): string {
  const missingPrompts = buildMissingPersonalizationPrompts(facts);
  if (!missingPrompts.length) {
    return [
      "Your profile is already well personalized.",
      "",
      "You can still fine-tune it with things like:",
      "- _Update my priorities to closing deals and hiring_",
      "- _Remember my preferred tone is concise and direct_",
      "- _Remember my focus areas are product, sales, and hiring_",
    ].join("\n");
  }

  return [
    "Here are the highest-value things you can tell me to make ClawCloud more personal:",
    "",
    ...missingPrompts.map((item) => `- _${item.prompt}_`),
    "",
    "These help me personalize briefings, reusable commands, and follow-up suggestions.",
  ].join("\n");
}

function legacyFormatMemorySavedReply(key: MemoryKey, value: string): string {
  const label = KEY_LABELS[key] ?? humanizeKey(key);
  return [
    "🧠 *Got it! I'll remember that.*",
    "",
    `• *${label}:* ${value}`,
    "",
    `This will be used in future conversations. To remove it: _Forget my ${label.toLowerCase()}_`,
  ].join("\n");
}

export function formatMemorySavedReply(key: MemoryKey, value: string): string {
  const label = KEY_LABELS[key] ?? humanizeKey(key);
  return [
    "Got it. I'll remember that.",
    "",
    `- *${label}:* ${value}`,
    "",
    `This will be used in future conversations. To remove it: _Forget my ${label.toLowerCase()}_`,
    "To review everything I know: _Show my memory_",
  ].join("\n");
}

function legacyFormatMemoryForgotReply(key: MemoryKey, found: boolean): string {
  const label = KEY_LABELS[key] ?? humanizeKey(key);
  if (!found) {
    return `🧠 *I didn't have your ${label.toLowerCase()} saved anyway.*`;
  }
  return `🗑️ *Done - I've forgotten your ${label.toLowerCase()}.*`;
}

function legacyFormatMemoryClearedReply(count: number): string {
  if (!count) {
    return "🧠 *Nothing to clear - your memory profile was already empty.*";
  }

  return [
    "🗑️ *Memory cleared.*",
    "",
    `Removed *${count}* saved fact${count === 1 ? "" : "s"} about you.`,
    "I'll start fresh from your next message.",
  ].join("\n");
}

export function formatMemoryForgotReply(key: MemoryKey, found: boolean): string {
  const label = KEY_LABELS[key] ?? humanizeKey(key);
  if (!found) {
    return `I did not have your ${label.toLowerCase()} saved anyway.`;
  }
  return `Done. I have forgotten your ${label.toLowerCase()}.`;
}

export function formatMemoryClearedReply(count: number): string {
  if (!count) {
    return "Nothing to clear. Your memory profile was already empty.";
  }

  return [
    "*Memory cleared.*",
    "",
    `Removed *${count}* saved fact${count === 1 ? "" : "s"} about you.`,
    "I'll start fresh from your next message.",
  ].join("\n");
}

function legacyBuildUserProfileSnippet(facts: MemoryRow[]): string {
  const highConfidence = facts.filter((fact) => fact.confidence >= MIN_CONFIDENCE_TO_SAVE);
  if (!highConfidence.length) return "";

  return [
    "USER PROFILE:",
    ...highConfidence.map((fact) => {
      const label = KEY_LABELS[fact.key] ?? humanizeKey(fact.key);
      return `${label}: ${fact.value}`;
    }),
    "- Use profile details only when they improve the answer.",
    "- Do not mention this profile unless the user asks.",
  ].join("\n");
}

export function buildUserProfileSnippet(facts: MemoryRow[]): string {
  const highConfidence = facts.filter((fact) => fact.confidence >= MIN_CONFIDENCE_TO_SAVE);
  if (!highConfidence.length) return "";

  const grouped = groupMemoryFacts(highConfidence);
  const lines = ["USER PROFILE:"];

  for (const group of grouped) {
    lines.push(`${group.title}:`);
    for (const fact of group.facts) {
      const label = KEY_LABELS[fact.key] ?? humanizeKey(fact.key);
      lines.push(`- ${label}: ${fact.value}`);
    }
  }

  lines.push("- Use saved priorities, tone, and routine details to personalize briefings, reminders, and reusable workflows.");
  lines.push("- Use profile details only when they improve the answer.");
  lines.push("- Do not mention this profile unless the user asks.");
  return lines.join("\n");
}

export async function loadUserProfileSnippet(userId: string): Promise<string> {
  try {
    const facts = await getAllMemoryFacts(userId);
    return buildUserProfileSnippet(facts);
  } catch {
    return "";
  }
}

function resolveKeyAlias(raw: string): MemoryKey | null {
  const normalized = raw.toLowerCase().trim().replace(/[?.!,]+$/g, "");

  const aliases: Record<string, MemoryKey> = {
    name: "name",
    "my name": "name",
    "preferred name": "preferred_name",
    "nick name": "preferred_name",
    nickname: "preferred_name",
    city: "city",
    location: "city",
    town: "city",
    country: "country",
    nation: "country",
    profession: "profession",
    job: "profession",
    occupation: "profession",
    work: "profession",
    career: "profession",
    company: "company",
    employer: "company",
    language: "language_preference",
    "language preference": "language_preference",
    timezone: "timezone",
    age: "age",
    interests: "interests",
    hobbies: "interests",
    tone: "preferred_tone",
    "preferred tone": "preferred_tone",
    style: "briefing_style",
    "briefing style": "briefing_style",
    "wake time": "wake_time",
    "wake up time": "wake_time",
    "work hours": "work_hours",
    goals: "goals",
    goal: "goals",
    priorities: "priorities",
    priority: "priorities",
    focus: "focus_areas",
    "focus areas": "focus_areas",
    routine: "routine",
  };

  return aliases[normalized] ?? null;
}

function extractFactFromShortStatement(
  statement: string,
): { key: MemoryKey; value: string } | null {
  const trimmed = statement.trim().replace(/[.!?]+$/, "");

  const preferredNameMatch = trimmed.match(/^call me\s+(.{1,40})$/i);
  if (preferredNameMatch) {
    return {
      key: "preferred_name",
      value: normalizeMemoryValue("preferred_name", preferredNameMatch[1]),
    };
  }

  const nameMatch = trimmed.match(/^(?:my name is|mera naam)\s+(.{1,40})$/i);
  if (nameMatch) {
    return { key: "name", value: normalizeMemoryValue("name", nameMatch[1]) };
  }

  const cityMatch = trimmed.match(
    /^(?:i live in|i(?:'m| am) from|i(?:'m| am) in|i(?:'m| am) based in)\s+(.{2,50})$/i,
  );
  if (cityMatch) {
    return { key: "city", value: normalizeMemoryValue("city", cityMatch[1]) };
  }

  const companyMatch = trimmed.match(/^(?:i work at|i(?:'m| am) working at)\s+(.{2,80})$/i);
  if (companyMatch) {
    return { key: "company", value: normalizeMemoryValue("company", companyMatch[1]) };
  }

  const ageMatch = trimmed.match(/^i(?:'m| am)\s+(\d{1,3})\s+years?\s+old$/i);
  if (ageMatch) {
    return { key: "age", value: normalizeMemoryValue("age", ageMatch[1]) };
  }

  const interestsMatch = trimmed.match(
    /^(?:i love|i like|my hobbies are|my interests are)\s+(.{2,120})$/i,
  );
  if (interestsMatch) {
    return {
      key: "interests",
      value: normalizeMemoryValue("interests", interestsMatch[1]),
    };
  }

  const languageMatch = trimmed.match(/^(?:i speak|i prefer)\s+(.{2,40})$/i);
  if (languageMatch && LANGUAGE_HINT_RE.test(languageMatch[1])) {
    return {
      key: "language_preference",
      value: normalizeMemoryValue("language_preference", languageMatch[1]),
    };
  }

  const preferredToneMatch = trimmed.match(
    /^(?:my preferred tone is|i prefer a|keep it|make it|use a)\s+(.{2,60})\s*(?:tone|replies|messages|answers)?$/i,
  );
  if (preferredToneMatch) {
    return {
      key: "preferred_tone",
      value: normalizeMemoryValue("preferred_tone", preferredToneMatch[1]),
    };
  }

  const briefingStyleMatch = trimmed.match(
    /^(?:my briefing style is|keep my briefings|my briefings should be)\s+(.{2,60})$/i,
  );
  if (briefingStyleMatch) {
    return {
      key: "briefing_style",
      value: normalizeMemoryValue("briefing_style", briefingStyleMatch[1]),
    };
  }

  const prioritiesMatch = trimmed.match(
    /^(?:my top priorities are|my priorities are|my priority is)\s+(.{2,140})$/i,
  );
  if (prioritiesMatch) {
    return {
      key: "priorities",
      value: normalizeMemoryValue("priorities", prioritiesMatch[1]),
    };
  }

  const focusAreasMatch = trimmed.match(
    /^(?:my focus areas are|my focus is|i am focused on)\s+(.{2,140})$/i,
  );
  if (focusAreasMatch) {
    return {
      key: "focus_areas",
      value: normalizeMemoryValue("focus_areas", focusAreasMatch[1]),
    };
  }

  const goalsMatch = trimmed.match(
    /^(?:my goals are|my goal is|i am working toward|i'm working toward)\s+(.{2,140})$/i,
  );
  if (goalsMatch) {
    return {
      key: "goals",
      value: normalizeMemoryValue("goals", goalsMatch[1]),
    };
  }

  const wakeTimeMatch = trimmed.match(
    /^(?:i wake up at|my wake time is|i usually wake up at)\s+(.{2,40})$/i,
  );
  if (wakeTimeMatch) {
    return {
      key: "wake_time",
      value: normalizeMemoryValue("wake_time", wakeTimeMatch[1]),
    };
  }

  const workHoursMatch = trimmed.match(
    /^(?:my work hours are|i usually work|my working hours are)\s+(.{2,80})$/i,
  );
  if (workHoursMatch) {
    return {
      key: "work_hours",
      value: normalizeMemoryValue("work_hours", workHoursMatch[1]),
    };
  }

  const routineMatch = trimmed.match(
    /^(?:my routine is|every morning i|every day i)\s+(.{2,140})$/i,
  );
  if (routineMatch) {
    return {
      key: "routine",
      value: normalizeMemoryValue("routine", routineMatch[1]),
    };
  }

  const professionMatch = trimmed.match(/^i(?:'m| am)\s+(?:an?\s+)?(.{2,60})$/i);
  if (professionMatch && PROFESSION_HINT_RE.test(professionMatch[1])) {
    return {
      key: "profession",
      value: normalizeMemoryValue("profession", professionMatch[1]),
    };
  }

  return null;
}

function normalizeMemoryValue(key: MemoryKey, value: string): string {
  const trimmed = value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/g, "");
  if (!trimmed) return "";

  switch (key) {
    case "name":
    case "preferred_name":
    case "city":
    case "country":
    case "language_preference":
      return capitalizeWords(trimmed);
    case "age":
      return trimmed.replace(/[^\d]/g, "").slice(0, 3) || trimmed;
    case "interests":
    case "goals":
    case "priorities":
    case "focus_areas":
      return normalizeCommaList(trimmed);
    case "preferred_tone":
    case "briefing_style":
      return trimmed.toLowerCase();
    default:
      return trimmed;
  }
}

function normalizeCommaList(value: string) {
  return value
    .split(/,|\band\b/gi)
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
}

function capitalizeWords(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeKey(key: string) {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
