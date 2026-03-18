import { completeClawCloudFast } from "@/lib/clawcloud-ai";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_SNOOZE_MINUTES = 30;
const MAX_ACTIVE_REMINDERS = 20;
const PARSE_TIMEOUT_MS = 8_000;
const DUE_LOOKBACK_MS = 90_000;
const DUE_LOOKAHEAD_MS = 30_000;
const ACTION_WINDOW_MS = 24 * 60 * 60 * 1_000;

export type RecurRule = null | "daily" | "weekdays" | "weekends" | "weekly" | "monthly";

export type ReminderRow = {
  id: string;
  user_id: string;
  reminder_text: string;
  fire_at: string;
  recur_rule: RecurRule;
  is_active: boolean;
  fired_at: string | null;
  source_message: string | null;
  created_at: string;
  updated_at?: string;
};

type ReminderParseResult =
  | {
      fireAt: string;
      reminderText: string;
      recurRule: RecurRule;
    }
  | null;

export type ReminderIntentResult =
  | { intent: "set" }
  | { intent: "list" }
  | { intent: "cancel_index"; index: number }
  | { intent: "cancel_all" }
  | { intent: "snooze"; minutes: number }
  | { intent: "done" }
  | { intent: "status" }
  | { intent: "unknown" };

export async function parseReminderAI(
  rawText: string,
  userTimezone = DEFAULT_TIMEZONE,
): Promise<ReminderParseResult> {
  const nowIso = new Date().toISOString();
  const system = [
    "You extract reminder data from the user's message.",
    `Current UTC time: ${nowIso}`,
    `User timezone: ${userTimezone}`,
    "",
    "Return only valid JSON with exactly these keys:",
    '{ "fireAt": "ISO 8601 UTC string", "reminderText": "short task", "recurRule": null | "daily" | "weekdays" | "weekends" | "weekly" | "monthly" }',
    "",
    "Rules:",
    "- Convert all dates and times to UTC.",
    "- If the user gives no exact time, default to 09:00 in the user's timezone.",
    "- If the time has already passed today, schedule the next valid future time.",
    "- 'every day' => daily",
    "- 'every weekday', 'Mon-Fri' => weekdays",
    "- 'every weekend', 'Sat-Sun' => weekends",
    "- 'every week' or a repeated weekday => weekly",
    "- 'every month' => monthly",
    "- 'subah' means morning around 8am, 'shaam' means evening around 6pm, 'raat' means night around 9pm.",
    '- If you cannot confidently parse the reminder, return only {"error":"cannot_parse"}.',
  ].join("\n");

  try {
    const raw = await promiseWithTimeout(
      completeClawCloudFast({
        system,
        user: rawText,
        maxTokens: 140,
        fallback: "",
      }),
      PARSE_TIMEOUT_MS,
    );

    const withoutCodeFences = raw.replace(/```json|```/gi, "").trim();
    const jsonStart = withoutCodeFences.indexOf("{");
    const jsonEnd = withoutCodeFences.lastIndexOf("}");
    const cleaned =
      jsonStart >= 0 && jsonEnd >= jsonStart
        ? withoutCodeFences.slice(jsonStart, jsonEnd + 1).trim()
        : withoutCodeFences;

    if (!cleaned) {
      throw new Error("Empty parser response");
    }

    const parsed = JSON.parse(cleaned) as {
      fireAt?: string;
      reminderText?: string;
      recurRule?: RecurRule;
      error?: string;
    };

    if (parsed.error === "cannot_parse") {
      return parseReminderRegex(rawText);
    }

    const fireAtMs = Date.parse(parsed.fireAt ?? "");
    const reminderText = sanitizeReminderText(parsed.reminderText);

    if (!Number.isFinite(fireAtMs) || !reminderText) {
      return parseReminderRegex(rawText);
    }

    const recurRule = isRecurRule(parsed.recurRule) ? parsed.recurRule : null;
    return {
      fireAt: normalizeReminderFireAt(new Date(fireAtMs).toISOString(), recurRule),
      reminderText,
      recurRule,
    };
  } catch {
    return parseReminderRegex(rawText);
  }
}

export function parseReminderRegex(text: string): ReminderParseResult {
  const now = new Date();
  const lower = text.toLowerCase();
  let fireAt: Date | null = null;
  let recurRule: RecurRule = null;

  if (/\b(every day|daily|har roz|roz)\b/u.test(lower)) recurRule = "daily";
  else if (/\b(every weekday|weekdays|mon.?fri|working day)\b/u.test(lower)) recurRule = "weekdays";
  else if (/\b(every weekend|weekends|sat.?sun)\b/u.test(lower)) recurRule = "weekends";
  else if (/\bevery (week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u.test(lower))
    recurRule = "weekly";
  else if (/\bevery month\b/u.test(lower)) recurRule = "monthly";

  const relativeMatch = text.match(/\bin\s+(\d+)\s*(minute|min|hour|hr|hours|minutes|ghanta|ghante)\b/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const multiplier = unit.startsWith("h") || unit.startsWith("g") ? 60 * 60 * 1_000 : 60 * 1_000;
    fireAt = new Date(now.getTime() + amount * multiplier);
  }

  const dayOffset =
    /\b(day after tomorrow|parso)\b/u.test(lower)
      ? 2
      : /\b(tomorrow|kal)\b/u.test(lower)
        ? 1
        : /\bnext week\b/u.test(lower)
          ? 7
          : 0;

  if (!fireAt) {
    const timeMatch = text.match(/\b(?:at|for|by|@)?\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/i);
    if (timeMatch) {
      let hour = parseInt(timeMatch[1], 10);
      const minute = parseInt(timeMatch[2] ?? "0", 10);
      const meridiem = timeMatch[3]?.toLowerCase();

      if (meridiem === "pm" && hour < 12) hour += 12;
      if (meridiem === "am" && hour === 12) hour = 0;

      fireAt = new Date(now);
      fireAt.setDate(fireAt.getDate() + dayOffset);
      fireAt.setHours(hour, minute, 0, 0);

      if (fireAt <= now && dayOffset === 0 && !recurRule) {
        fireAt.setDate(fireAt.getDate() + 1);
      }
    }
  }

  if (!fireAt) {
    if (/\b(subah|morning)\b/u.test(lower)) {
      fireAt = buildRelativeDate(now, dayOffset || 0, 8, 0);
    } else if (/\b(dopahar|afternoon|lunch)\b/u.test(lower)) {
      fireAt = buildRelativeDate(now, dayOffset || 0, 13, 0);
    } else if (/\b(shaam|sham|evening)\b/u.test(lower)) {
      fireAt = buildRelativeDate(now, dayOffset || 0, 18, 0);
    } else if (/\b(raat|night|tonight)\b/u.test(lower)) {
      fireAt = buildRelativeDate(now, dayOffset || 0, 21, 0);
    }
  }

  if (!fireAt && dayOffset > 0) {
    fireAt = buildRelativeDate(now, dayOffset, 9, 0);
  }

  if (!fireAt) {
    const weekdayMatch = lower.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u);
    if (weekdayMatch) {
      const weekdayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const targetDay = weekdayNames.indexOf(weekdayMatch[2]);
      if (targetDay >= 0) {
        const offset = (targetDay - now.getDay() + 7) % 7 || 7;
        fireAt = buildRelativeDate(now, offset, 9, 0);
      }
    }
  }

  if (!fireAt) {
    return null;
  }

  return {
    fireAt: normalizeReminderFireAt(fireAt.toISOString(), recurRule),
    reminderText: extractReminderText(text),
    recurRule,
  };
}

export async function saveReminder(
  userId: string,
  fireAt: string,
  reminderText: string,
  recurRule: RecurRule,
  sourceMessage: string,
): Promise<ReminderRow> {
  const db = getClawCloudSupabaseAdmin();
  const { count, error: countError } = await db
    .from("user_reminders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (countError) {
    throw new Error(countError.message);
  }

  if ((count ?? 0) >= MAX_ACTIVE_REMINDERS) {
    throw new Error(
      `You already have ${MAX_ACTIVE_REMINDERS} active reminders. Cancel one before adding another.`,
    );
  }

  const { data, error } = await db
    .from("user_reminders")
    .insert({
      user_id: userId,
      reminder_text: sanitizeReminderText(reminderText) ?? "Reminder",
      fire_at: fireAt,
      recur_rule: recurRule,
      is_active: true,
      source_message: sourceMessage,
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save reminder");
  }

  return data as ReminderRow;
}

export async function listActiveReminders(userId: string): Promise<ReminderRow[]> {
  const db = getClawCloudSupabaseAdmin();
  const { data, error } = await db
    .from("user_reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("fire_at", { ascending: true })
    .limit(MAX_ACTIVE_REMINDERS);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ReminderRow[];
}

export async function cancelReminderByIndex(userId: string, index: number): Promise<string | null> {
  const reminders = await listActiveReminders(userId);
  const target = reminders[index - 1];
  if (!target) {
    return null;
  }

  const db = getClawCloudSupabaseAdmin();
  const { error } = await db
    .from("user_reminders")
    .update({ is_active: false })
    .eq("id", target.id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(error.message);
  }

  return target.reminder_text;
}

export async function cancelAllReminders(userId: string): Promise<number> {
  const reminders = await listActiveReminders(userId);
  if (!reminders.length) {
    return 0;
  }

  const db = getClawCloudSupabaseAdmin();
  const { error } = await db
    .from("user_reminders")
    .update({ is_active: false })
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    throw new Error(error.message);
  }

  return reminders.length;
}

export async function snoozeLatestReminder(
  userId: string,
  minutes = DEFAULT_SNOOZE_MINUTES,
): Promise<{ reminderText: string; newFireAt: string } | null> {
  const target = await findLatestTriggeredReminder(userId);
  if (!target) {
    return null;
  }

  const newFireAt = new Date(Date.now() + minutes * 60 * 1_000).toISOString();
  const db = getClawCloudSupabaseAdmin();
  const { error } = await db
    .from("user_reminders")
    .update({
      fire_at: newFireAt,
      fired_at: null,
      is_active: true,
    })
    .eq("id", target.id);

  if (error) {
    throw new Error(error.message);
  }

  return {
    reminderText: target.reminder_text,
    newFireAt,
  };
}

export async function markLatestReminderDone(userId: string): Promise<string | null> {
  const target = await findLatestTriggeredReminder(userId);
  if (!target) {
    return null;
  }

  const db = getClawCloudSupabaseAdmin();
  const updates = target.recur_rule
    ? { fired_at: null }
    : { is_active: false };

  const { error } = await db.from("user_reminders").update(updates).eq("id", target.id);
  if (error) {
    throw new Error(error.message);
  }

  return target.reminder_text;
}

export async function fetchDueReminders(): Promise<ReminderRow[]> {
  const db = getClawCloudSupabaseAdmin();
  const now = Date.now();
  const windowStart = new Date(now - DUE_LOOKBACK_MS).toISOString();
  const windowEnd = new Date(now + DUE_LOOKAHEAD_MS).toISOString();

  const { data, error } = await db
    .from("user_reminders")
    .select("*")
    .eq("is_active", true)
    .gte("fire_at", windowStart)
    .lte("fire_at", windowEnd)
    .order("fire_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as ReminderRow[];
}

export async function fireReminder(reminder: ReminderRow): Promise<void> {
  const db = getClawCloudSupabaseAdmin();
  const firedAt = new Date().toISOString();

  if (!reminder.recur_rule) {
    const { error } = await db
      .from("user_reminders")
      .update({
        is_active: false,
        fired_at: firedAt,
      })
      .eq("id", reminder.id);

    if (error) {
      throw new Error(error.message);
    }
    return;
  }

  const nextFireAt = computeNextFireAt(reminder.fire_at, reminder.recur_rule);
  const { error } = await db
    .from("user_reminders")
    .update({
      fire_at: nextFireAt,
      fired_at: firedAt,
      is_active: true,
    })
    .eq("id", reminder.id);

  if (error) {
    throw new Error(error.message);
  }
}

export function detectReminderIntent(text: string): ReminderIntentResult {
  const t = text.toLowerCase().trim();

  if (/^(done|dismiss|completed?|ok done|finished|haan|ho gaya|ho gya)$/u.test(t)) {
    return { intent: "done" };
  }

  const snoozeMatch = t.match(
    /\b(snooze|later|baad mein|baad me|thodi der baad)\b(?:\s*(?:for)?\s*(\d+)\s*(min|mins|minute|minutes|hour|hours|hr|hrs)?)?/u,
  );
  if (snoozeMatch) {
    const amount = snoozeMatch[2] ? parseInt(snoozeMatch[2], 10) : DEFAULT_SNOOZE_MINUTES;
    const unit = (snoozeMatch[3] ?? "min").toLowerCase();
    const minutes = unit.startsWith("h") ? amount * 60 : amount;
    return { intent: "snooze", minutes: Math.min(Math.max(minutes, 1), 24 * 60) };
  }

  if (
    /^(reminders?|my reminders?)$/u.test(t) ||
    /\b(show|list|see|view|what are|meri)\b.*\b(reminder|reminders|alerts?)\b/u.test(t)
  ) {
    return { intent: "list" };
  }

  if (/\b(cancel|delete|remove|clear|hatao|band karo)\b.*\b(all|sab|sabhi)\b.*\b(reminder|reminders|alerts?)\b/u.test(t)) {
    return { intent: "cancel_all" };
  }

  const cancelMatch = t.match(
    /\b(cancel|delete|remove|hatao|band karo)\b\s+(?:reminder\s*)?(?:#|number\s*)?(\d+)\b/u,
  );
  if (cancelMatch) {
    return { intent: "cancel_index", index: parseInt(cancelMatch[2], 10) };
  }

  if (
    /\b(reminder|remind|alert)\b/u.test(t) &&
    /\b(status|scheduled|set|check|when|show|view)\b/u.test(t)
  ) {
    return { intent: "status" };
  }

  if (
    /\b(remind me|set (a\s+)?reminder|alert me|notify me|mujhe .*yaad dilao|yaad kara|don't let me forget|dont let me forget)\b/u.test(t) ||
    /\bremind\b.*\b(at|in|on|by|tomorrow|tonight|next|every|kal|parso)\b/u.test(t) ||
    /\breminder\b.*\b(at|for|on|in)\b/u.test(t)
  ) {
    return { intent: "set" };
  }

  return { intent: "unknown" };
}

export function formatReminderSetReply(
  reminder: ReminderRow,
  total: number,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const lines = [
    "✅ *Reminder saved.*",
    "",
    `📌 *Task:* ${reminder.reminder_text}`,
    `⏰ *When:* ${formatReminderTime(reminder.fire_at, timeZone)}`,
  ];

  if (reminder.recur_rule) {
    lines.push(`🔁 *Repeats:* ${formatRecurLabel(reminder.recur_rule)}`);
  }

  lines.push("");
  lines.push(`You now have *${total}* active reminder${total === 1 ? "" : "s"}.`);
  lines.push("Reply _show reminders_ to manage them.");
  return lines.join("\n");
}

export function formatReminderListReply(
  reminders: ReminderRow[],
  timeZone = DEFAULT_TIMEZONE,
): string {
  if (!reminders.length) {
    return [
      "⏰ *No active reminders.*",
      "",
      "Try: _Remind me at 6pm to call Raj_",
    ].join("\n");
  }

  const lines = [`⏰ *Your reminders (${reminders.length})*`, ""];
  for (const [index, reminder] of reminders.entries()) {
    const recur = reminder.recur_rule ? ` • ${formatRecurLabel(reminder.recur_rule)}` : "";
    lines.push(
      `*${index + 1}.* ${reminder.reminder_text}`,
      `   📅 ${formatReminderTime(reminder.fire_at, timeZone)}${recur}`,
    );
  }

  lines.push("");
  lines.push("Cancel one: _cancel reminder 1_");
  lines.push("Cancel all: _cancel all reminders_");
  return lines.join("\n");
}

export function formatReminderFireMessage(reminder: ReminderRow): string {
  const lines = [
    "⏰ *Reminder!*",
    "",
    `📌 ${reminder.reminder_text}`,
    "",
    "Reply *DONE* to dismiss or *SNOOZE* for 30 minutes.",
  ];

  if (reminder.recur_rule) {
    lines.push(`🔁 ${formatRecurLabel(reminder.recur_rule)}`);
  }

  return lines.join("\n");
}

export function formatCancelReply(reminderText: string, index: number): string {
  return `🗑️ *Reminder ${index} cancelled.*\n\n_"${reminderText}"_`;
}

export function formatCancelAllReply(count: number): string {
  if (count === 0) {
    return "⏰ *You do not have any active reminders.*";
  }

  return `🗑️ *Cancelled ${count} reminder${count === 1 ? "" : "s"}.*`;
}

export function formatSnoozeReply(
  reminderText: string,
  newFireAt: string,
  minutes: number,
  timeZone = DEFAULT_TIMEZONE,
): string {
  return [
    `⏰ *Snoozed for ${minutes} minute${minutes === 1 ? "" : "s"}.*`,
    "",
    `📌 ${reminderText}`,
    `🕐 New time: ${formatReminderTime(newFireAt, timeZone)}`,
  ].join("\n");
}

export function formatDoneReply(reminderText: string): string {
  return `✅ *Done.*\n\n_"${reminderText}"_`;
}

export function formatStatusReply(
  reminders: ReminderRow[],
  timeZone = DEFAULT_TIMEZONE,
): string {
  if (!reminders.length) {
    return [
      "⏰ *No active reminders found.*",
      "",
      "Try: _Remind me tomorrow morning to send the report_",
    ].join("\n");
  }

  const next = reminders.find((reminder) => Date.parse(reminder.fire_at) >= Date.now()) ?? reminders[0];
  const lines = [
    "✅ *Your next reminder is set.*",
    "",
    `📌 *Task:* ${next.reminder_text}`,
    `⏰ *When:* ${formatReminderTime(next.fire_at, timeZone)}`,
  ];

  if (next.recur_rule) {
    lines.push(`🔁 *Repeats:* ${formatRecurLabel(next.recur_rule)}`);
  }

  lines.push("");
  lines.push(`Total active reminders: *${reminders.length}*`);
  return lines.join("\n");
}

async function findLatestTriggeredReminder(userId: string): Promise<ReminderRow | null> {
  const db = getClawCloudSupabaseAdmin();
  const since = new Date(Date.now() - ACTION_WINDOW_MS).toISOString();
  const { data, error } = await db
    .from("user_reminders")
    .select("*")
    .eq("user_id", userId)
    .not("fired_at", "is", null)
    .gte("fired_at", since)
    .order("fired_at", { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? [])[0] ?? null) as ReminderRow | null;
}

function buildRelativeDate(base: Date, dayOffset: number, hour: number, minute: number) {
  const value = new Date(base);
  value.setDate(value.getDate() + dayOffset);
  value.setHours(hour, minute, 0, 0);
  if (value <= base && dayOffset === 0) {
    value.setDate(value.getDate() + 1);
  }
  return value;
}

function normalizeReminderFireAt(fireAt: string, recurRule: RecurRule) {
  const fireAtMs = Date.parse(fireAt);
  if (!Number.isFinite(fireAtMs)) {
    return fireAt;
  }

  if (fireAtMs > Date.now() || !recurRule) {
    return new Date(fireAtMs).toISOString();
  }

  return computeNextFireAt(new Date(fireAtMs).toISOString(), recurRule);
}

function computeNextFireAt(currentFireAt: string, rule: Exclude<RecurRule, null>) {
  const next = new Date(currentFireAt);
  const nowMs = Date.now();

  do {
    switch (rule) {
      case "daily":
        next.setDate(next.getDate() + 1);
        break;
      case "weekdays":
        next.setDate(next.getDate() + 1);
        while (next.getDay() === 0 || next.getDay() === 6) {
          next.setDate(next.getDate() + 1);
        }
        break;
      case "weekends":
        next.setDate(next.getDate() + 1);
        while (next.getDay() !== 0 && next.getDay() !== 6) {
          next.setDate(next.getDate() + 1);
        }
        break;
      case "weekly":
        next.setDate(next.getDate() + 7);
        break;
      case "monthly":
        next.setMonth(next.getMonth() + 1);
        break;
    }
  } while (next.getTime() <= nowMs);

  return next.toISOString();
}

function formatReminderTime(isoUtc: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(isoUtc));
  } catch {
    return new Date(isoUtc).toLocaleString("en-IN", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }
}

function formatRecurLabel(rule: RecurRule) {
  switch (rule) {
    case "daily":
      return "every day";
    case "weekdays":
      return "every weekday";
    case "weekends":
      return "every weekend";
    case "weekly":
      return "every week";
    case "monthly":
      return "every month";
    default:
      return "";
  }
}

function extractReminderText(text: string) {
  const candidate =
    text.match(/\bto\s+(.+)/i)?.[1] ??
    text.match(/\bki\s+(.+)/i)?.[1] ??
    text.match(/\bfor\s+(.+)/i)?.[1] ??
    text;

  const cleaned = candidate
    .replace(/\b(remind me|set (a\s+)?reminder|alert me|notify me|mujhe .*yaad dilao)\b/giu, "")
    .replace(/\b(in\s+\d+\s*(minute|min|hour|hr|hours|minutes|ghanta|ghante))\b/giu, "")
    .replace(/\b(tomorrow|today|tonight|kal|parso|next week)\b/giu, "")
    .replace(/\b(every\s+(day|weekday|weekdays|weekend|weekends|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/giu, "")
    .replace(/\b(at|for|by|on)\s+\d{1,2}(?::\d{2})?\s*(am|pm|baje)?\b/giu, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return sanitizeReminderText(cleaned) ?? "Reminder";
}

function sanitizeReminderText(value: string | undefined) {
  const cleaned = (value ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, 120);
}

function isRecurRule(value: unknown): value is RecurRule {
  return (
    value === null ||
    value === "daily" ||
    value === "weekdays" ||
    value === "weekends" ||
    value === "weekly" ||
    value === "monthly"
  );
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error("Timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
