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

type ReminderParseOptions = {
  now?: Date | number | string;
  userTimezone?: string;
};

type ReminderLocalDate = {
  year: number;
  month: number;
  day: number;
};

type ReminderLocalDateTime = ReminderLocalDate & {
  hour: number;
  minute: number;
  second?: number;
  weekday: number;
};

type ReminderTimeParts = {
  hour: number;
  minute: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const RECUR_DAILY_PATTERN = /\b(every day|daily|har roz|roz)\b/u;
const RECUR_WEEKDAYS_PATTERN = /\b(every weekday|weekdays|mon.?fri|working day)\b/u;
const RECUR_WEEKENDS_PATTERN = /\b(every weekend|weekends|sat.?sun)\b/u;
const RECUR_WEEKLY_PATTERN = /\bevery (week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u;
const RECUR_MONTHLY_PATTERN = /\b(every month|monthly)\b/u;
const RELATIVE_TIME_PATTERN = /\b(?:in|after)\s+(\d+)\s*(minute|min|hour|hr|hours|minutes|ghanta|ghante)\b/i;
const MONTHLY_DAY_PATTERN = /\b(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:\s+day)?\s+of\s+every\s+month\b/i;
const EXPLICIT_TIME_WITH_PREFIX_PATTERN = /\b(?:at|by|around|@)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)?\b/i;
const EXPLICIT_CLOCK_PATTERN = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/i;
const EXPLICIT_MERIDIEM_PATTERN = /\b(\d{1,2})\s*(am|pm|baje)\b/i;
const SCHEDULE_CUE_PATTERN =
  /\b(in\s+\d+\s*(?:minute|min|hour|hr|hours|minutes|ghanta|ghante)|after\s+\d+\s*(?:minute|min|hour|hr|hours|minutes|ghanta|ghante)|today|aaj|tomorrow|tonight|day after tomorrow|next week|every day|daily|every weekday|weekdays|every weekend|weekends|every week|every month|monthly|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|night|subah|dopahar|shaam|sham|raat|at\s+\d|by\s+\d|around\s+\d|@\d|\d{1,2}:\d{2}|\d{1,2}\s*(?:am|pm|baje)|\d{1,2}(?:st|nd|rd|th)?\s+of\s+every\s+month)\b/i;

export async function parseReminderAI(
  rawText: string,
  userTimezone = DEFAULT_TIMEZONE,
): Promise<ReminderParseResult> {
  const deterministic = parseReminderRegex(rawText, { userTimezone });
  if (deterministic) {
    return deterministic;
  }

  if (!looksLikeReminderScheduleCue(rawText)) {
    return null;
  }

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
      return parseReminderRegex(rawText, { userTimezone });
    }

    const fireAtMs = Date.parse(parsed.fireAt ?? "");
    const reminderText = sanitizeReminderText(parsed.reminderText);

    if (!Number.isFinite(fireAtMs) || !reminderText) {
      return parseReminderRegex(rawText, { userTimezone });
    }

    const recurRule = isRecurRule(parsed.recurRule) ? parsed.recurRule : null;
    return {
      fireAt: normalizeReminderFireAt(new Date(fireAtMs).toISOString(), recurRule, Date.now()),
      reminderText,
      recurRule,
    };
  } catch {
    return parseReminderRegex(rawText, { userTimezone });
  }
}

export function parseReminderRegex(
  text: string,
  options: ReminderParseOptions = {},
): ReminderParseResult {
  const userTimezone = options.userTimezone ?? DEFAULT_TIMEZONE;
  const now = resolveReminderBaseDate(options.now);
  const localNow = getReminderLocalDateTime(now, userTimezone);
  const lower = text.toLowerCase();
  let fireAt: Date | null = null;
  const recurRule = detectReminderRecurRule(lower);
  const relativeMatch = text.match(RELATIVE_TIME_PATTERN);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const multiplier = unit.startsWith("h") || unit.startsWith("g") ? 60 * 60 * 1_000 : 60 * 1_000;
    fireAt = new Date(now.getTime() + amount * multiplier);
  }

  const monthlyDay = extractMonthlyReminderDay(lower);
  const explicitToday = /\b(today|aaj)\b/u.test(lower);
  const dayOffset =
    /\b(day after tomorrow|parso)\b/u.test(lower)
      ? 2
      : /\b(tomorrow|kal)\b/u.test(lower)
        ? 1
        : /\bnext week\b/u.test(lower)
          ? 7
          : 0;

  const explicitTime = extractReminderExplicitTime(text, lower, dayOffset > 0 || !!recurRule || monthlyDay !== null);
  if (!fireAt && monthlyDay !== null) {
    const monthlyDate = buildMonthlyReminderDate(localNow, monthlyDay);
    fireAt = buildReminderDateTimeInTimezone(
      monthlyDate,
      explicitTime ?? { hour: 9, minute: 0 },
      userTimezone,
    );
  }

  if (!fireAt) {
    if (explicitTime) {
      const targetDate = shiftReminderLocalDate(localNow, dayOffset);
      fireAt = buildReminderDateTimeInTimezone(targetDate, explicitTime, userTimezone);
    }
  }

  if (!fireAt) {
    if (/\b(subah|morning)\b/u.test(lower)) {
      fireAt = buildReminderDateTimeInTimezone(
        shiftReminderLocalDate(localNow, dayOffset || 0),
        { hour: 8, minute: 0 },
        userTimezone,
      );
    } else if (/\b(dopahar|afternoon|lunch)\b/u.test(lower)) {
      fireAt = buildReminderDateTimeInTimezone(
        shiftReminderLocalDate(localNow, dayOffset || 0),
        { hour: 13, minute: 0 },
        userTimezone,
      );
    } else if (/\b(shaam|sham|evening)\b/u.test(lower)) {
      fireAt = buildReminderDateTimeInTimezone(
        shiftReminderLocalDate(localNow, dayOffset || 0),
        { hour: 18, minute: 0 },
        userTimezone,
      );
    } else if (/\b(raat|night|tonight)\b/u.test(lower)) {
      fireAt = buildReminderDateTimeInTimezone(
        shiftReminderLocalDate(localNow, dayOffset || 0),
        { hour: 21, minute: 0 },
        userTimezone,
      );
    }
  }

  if (!fireAt && dayOffset > 0) {
    fireAt = buildReminderDateTimeInTimezone(
      shiftReminderLocalDate(localNow, dayOffset),
      { hour: 9, minute: 0 },
      userTimezone,
    );
  }

  if (!fireAt && explicitToday) {
    fireAt = buildReminderDateTimeInTimezone(
      shiftReminderLocalDate(localNow, 0),
      explicitTime ?? { hour: 9, minute: 0 },
      userTimezone,
    );
  }

  if (!fireAt) {
    const weekdayMatch = lower.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/u);
    if (weekdayMatch) {
      const targetDay = WEEKDAY_INDEX[weekdayMatch[2]];
      if (targetDay >= 0) {
        let offset = (targetDay - localNow.weekday + 7) % 7;
        if (weekdayMatch[1] || offset === 0) {
          offset = offset || 7;
        }
        fireAt = buildReminderDateTimeInTimezone(
          shiftReminderLocalDate(localNow, offset),
          explicitTime ?? { hour: 9, minute: 0 },
          userTimezone,
        );
      }
    }
  }

  if (!fireAt && recurRule) {
    fireAt = buildReminderDateTimeInTimezone(
      buildRecurringReminderStartDate(localNow, recurRule),
      explicitTime ?? { hour: 9, minute: 0 },
      userTimezone,
    );
  }

  if (!fireAt) {
    return null;
  }

  return {
    fireAt: normalizeReminderFireAt(fireAt.toISOString(), recurRule, now.getTime()),
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
    /\b(remind me|set (a\s+)?reminder|alert me|notify me|mujhe .*yaad dilao|yaad kara|don't let me forget|dont let me forget)\b/u.test(t) ||
    /\bremind\b.*\b(at|in|on|by|tomorrow|tonight|next|every|kal|parso)\b/u.test(t) ||
    /\breminder\b.*\b(at|for|on|in)\b/u.test(t)
  ) {
    return { intent: "set" };
  }

  if (
    /\b(reminder|remind|alert)\b/u.test(t) &&
    /\b(status|scheduled|check|when|show|view|next|upcoming)\b/u.test(t)
  ) {
    return { intent: "status" };
  }

  return { intent: "unknown" };
}

function legacyFormatReminderSetReply(
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

export function formatReminderSetReply(
  reminder: ReminderRow,
  total: number,
  timeZone = DEFAULT_TIMEZONE,
): string {
  const lines = [
    "*Reminder saved.*",
    "",
    `Task: ${reminder.reminder_text}`,
    `When: ${formatReminderTime(reminder.fire_at, timeZone)}`,
  ];

  if (reminder.recur_rule) {
    lines.push(`Repeats: ${formatRecurLabel(reminder.recur_rule)}`);
  }

  lines.push("");
  lines.push(`You now have *${total}* active reminder${total === 1 ? "" : "s"}.`);
  lines.push("Reply _show reminders_ to manage them.");

  if (!reminder.recur_rule) {
    lines.push("");
    lines.push("For routines, you can save a one-tap shortcut like:");
    lines.push("_save /rent as remind me on the 1st of every month to pay rent_");
  }

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

function resolveReminderBaseDate(input?: Date | number | string) {
  if (input instanceof Date) {
    return new Date(input.getTime());
  }

  if (typeof input === "number") {
    return new Date(input);
  }

  if (typeof input === "string") {
    return new Date(input);
  }

  return new Date();
}

function getReminderLocalDateTime(date: Date, timeZone: string): ReminderLocalDateTime {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(date);
  const lookup = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekdayToken = lookup("weekday").toLowerCase();

  return {
    year: Number(lookup("year")),
    month: Number(lookup("month")),
    day: Number(lookup("day")),
    hour: Number(lookup("hour")),
    minute: Number(lookup("minute")),
    second: Number(lookup("second")),
    weekday: WEEKDAY_INDEX[expandReminderWeekdayToken(weekdayToken)] ?? 0,
  };
}

function expandReminderWeekdayToken(token: string) {
  if (token.startsWith("mon")) return "monday";
  if (token.startsWith("tue")) return "tuesday";
  if (token.startsWith("wed")) return "wednesday";
  if (token.startsWith("thu")) return "thursday";
  if (token.startsWith("fri")) return "friday";
  if (token.startsWith("sat")) return "saturday";
  return "sunday";
}

function getReminderTimeZoneOffsetMs(timeZone: string, date: Date) {
  const localParts = getReminderLocalDateTime(date, timeZone);
  const projectedUtc = Date.UTC(
    localParts.year,
    localParts.month - 1,
    localParts.day,
    localParts.hour,
    localParts.minute,
    localParts.second,
  );
  return projectedUtc - date.getTime();
}

function buildReminderDateTimeInTimezone(
  date: ReminderLocalDate,
  time: ReminderTimeParts,
  timeZone: string,
) {
  let utcGuess = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getReminderTimeZoneOffsetMs(timeZone, new Date(utcGuess));
    const corrected = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute, 0) - offset;
    if (corrected === utcGuess) {
      break;
    }
    utcGuess = corrected;
  }

  return new Date(utcGuess);
}

function shiftReminderLocalDate(base: ReminderLocalDate, dayOffset: number): ReminderLocalDate {
  const shifted = new Date(Date.UTC(base.year, base.month - 1, base.day + dayOffset, 12, 0, 0));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function buildMonthlyReminderDate(base: ReminderLocalDateTime, targetDay: number) {
  const thisMonth = clampReminderDayOfMonth(base.year, base.month, targetDay);
  const useNextMonth = base.day > thisMonth;
  const shifted = shiftReminderMonth(
    base.year,
    base.month,
    useNextMonth ? 1 : 0,
    targetDay,
  );
  return {
    year: shifted.year,
    month: shifted.month,
    day: shifted.day,
  };
}

function shiftReminderMonth(year: number, month: number, monthOffset: number, targetDay: number) {
  const shifted = new Date(Date.UTC(year, month - 1 + monthOffset, 1, 12, 0, 0));
  const shiftedYear = shifted.getUTCFullYear();
  const shiftedMonth = shifted.getUTCMonth() + 1;
  return {
    year: shiftedYear,
    month: shiftedMonth,
    day: clampReminderDayOfMonth(shiftedYear, shiftedMonth, targetDay),
  };
}

function buildRecurringReminderStartDate(base: ReminderLocalDateTime, recurRule: Exclude<RecurRule, null>) {
  switch (recurRule) {
    case "daily":
    case "weekly":
    case "monthly":
      return { year: base.year, month: base.month, day: base.day };
    case "weekdays":
      if (base.weekday >= 1 && base.weekday <= 5) {
        return { year: base.year, month: base.month, day: base.day };
      }
      return shiftReminderLocalDate(base, base.weekday === 6 ? 2 : 1);
    case "weekends":
      if (base.weekday === 0 || base.weekday === 6) {
        return { year: base.year, month: base.month, day: base.day };
      }
      return shiftReminderLocalDate(base, 6 - base.weekday);
  }
}

function clampReminderDayOfMonth(year: number, month: number, targetDay: number) {
  const lastDay = new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
  return Math.max(1, Math.min(targetDay, lastDay));
}

function detectReminderRecurRule(lower: string): RecurRule {
  if (RECUR_DAILY_PATTERN.test(lower)) return "daily";
  if (RECUR_WEEKDAYS_PATTERN.test(lower)) return "weekdays";
  if (RECUR_WEEKENDS_PATTERN.test(lower)) return "weekends";
  if (RECUR_WEEKLY_PATTERN.test(lower)) return "weekly";
  if (RECUR_MONTHLY_PATTERN.test(lower) || MONTHLY_DAY_PATTERN.test(lower)) return "monthly";
  return null;
}

function extractMonthlyReminderDay(lower: string) {
  const match = lower.match(MONTHLY_DAY_PATTERN);
  if (!match) {
    return null;
  }

  const day = parseInt(match[1] ?? "", 10);
  return Number.isFinite(day) && day >= 1 && day <= 31 ? day : null;
}

function extractReminderExplicitTime(text: string, lower: string, allowClockWithoutPrefix: boolean) {
  const prefixed = text.match(EXPLICIT_TIME_WITH_PREFIX_PATTERN);
  if (prefixed) {
    return normalizeReminderTimeParts(prefixed[1], prefixed[2], prefixed[3]);
  }

  if (allowClockWithoutPrefix) {
    const clock = text.match(EXPLICIT_CLOCK_PATTERN);
    if (clock) {
      return normalizeReminderTimeParts(clock[1], clock[2], clock[3]);
    }
  }

  const meridiem = text.match(EXPLICIT_MERIDIEM_PATTERN);
  if (meridiem) {
    return normalizeReminderTimeParts(meridiem[1], undefined, meridiem[2]);
  }

  if (/\b(subah|morning)\b/u.test(lower)) {
    return { hour: 8, minute: 0 };
  }
  if (/\b(dopahar|afternoon|lunch)\b/u.test(lower)) {
    return { hour: 13, minute: 0 };
  }
  if (/\b(shaam|sham|evening)\b/u.test(lower)) {
    return { hour: 18, minute: 0 };
  }
  if (/\b(raat|night|tonight)\b/u.test(lower)) {
    return { hour: 21, minute: 0 };
  }

  return null;
}

function normalizeReminderTimeParts(
  hourToken?: string,
  minuteToken?: string,
  meridiemToken?: string,
): ReminderTimeParts | null {
  if (!hourToken) {
    return null;
  }

  let hour = parseInt(hourToken, 10);
  const minute = parseInt(minuteToken ?? "0", 10);
  const meridiem = meridiemToken?.toLowerCase();

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) {
    return null;
  }

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (meridiem === "baje" && (hour < 0 || hour > 23)) {
    return null;
  }

  if (!meridiem && !minuteToken) {
    return null;
  }

  if (hour < 0 || hour > 23) {
    return null;
  }

  return { hour, minute };
}

function looksLikeReminderScheduleCue(text: string) {
  return SCHEDULE_CUE_PATTERN.test(text.toLowerCase());
}

function normalizeReminderFireAt(
  fireAt: string,
  recurRule: RecurRule,
  referenceNowMs = Date.now(),
) {
  const fireAtMs = Date.parse(fireAt);
  if (!Number.isFinite(fireAtMs)) {
    return fireAt;
  }

  if (fireAtMs > referenceNowMs || !recurRule) {
    return new Date(fireAtMs).toISOString();
  }

  return computeNextFireAt(new Date(fireAtMs).toISOString(), recurRule, referenceNowMs);
}

function computeNextFireAt(
  currentFireAt: string,
  rule: Exclude<RecurRule, null>,
  referenceNowMs = Date.now(),
) {
  const next = new Date(currentFireAt);

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
  } while (next.getTime() <= referenceNowMs);

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
    .replace(/\b((?:in|after)\s+\d+\s*(minute|min|hour|hr|hours|minutes|ghanta|ghante))\b/giu, "")
    .replace(/\b(day after tomorrow|tomorrow|today|tonight|kal|parso|next week|aaj)\b/giu, "")
    .replace(/\b(every\s+(day|weekday|weekdays|weekend|weekends|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|daily|monthly)\b/giu, "")
    .replace(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/giu, "")
    .replace(/\b(?:on\s+)?(?:the\s+)?\d{1,2}(?:st|nd|rd|th)?(?:\s+day)?\s+of\s+every\s+month\b/giu, "")
    .replace(/\b(at|by|around|on)\s+\d{1,2}(?::\d{2})?\s*(am|pm|baje)?\b/giu, "")
    .replace(/\b\d{1,2}:\d{2}\s*(am|pm)?\b/giu, "")
    .replace(/\b\d{1,2}\s*(am|pm|baje)\b/giu, "")
    .replace(/\b(subah|morning|dopahar|afternoon|lunch|shaam|sham|evening|raat|night)\b/giu, "")
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
