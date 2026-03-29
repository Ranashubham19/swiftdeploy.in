import {
  buildGoogleNotConnectedReply,
  buildGoogleReconnectRequiredReply,
  createClawCloudCalendarEvent,
  deleteClawCloudCalendarEvent,
  getClawCloudCalendarEvents,
  isClawCloudGoogleNotConnectedError,
  isClawCloudGoogleReconnectRequiredError,
  updateClawCloudCalendarEvent,
  type CalendarEvent,
} from "@/lib/clawcloud-google";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { looksLikeCalendarKnowledgeQuestion } from "@/lib/clawcloud-workspace-knowledge";

export type CalendarActionIntent = "calendar_create" | "calendar_update" | "calendar_cancel";

type ParsedCalendarAction =
  | {
      kind: "create";
      title: string | null;
      startIso: string | null;
      endIso: string | null;
      location: string | null;
      attendeeEmails: string[];
      timeZone: string;
    }
  | {
      kind: "update";
      targetHint: string | null;
      nextTitle: string | null;
      nextStartIso: string | null;
      nextEndIso: string | null;
      nextLocation: string | null;
      attendeeEmails: string[] | null;
      timeZone: string;
    }
  | {
      kind: "cancel";
      targetHint: string | null;
      timeZone: string;
    };

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getTimeZoneParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "long",
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  ) as Record<string, string>;

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "00" : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday.toLowerCase(),
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = getTimeZoneParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedDateToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
) {
  const guess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0));
  const offset = getTimeZoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offset);
}

function addDays(parts: { year: number; month: number; day: number }, days: number) {
  const next = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  next.setUTCDate(next.getUTCDate() + days);
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function parseClockTime(value: string) {
  const match = value.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) {
    return null;
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridiem = match[3];

  if (meridiem === "pm" && hour < 12) {
    hour += 12;
  }
  if (meridiem === "am" && hour === 12) {
    hour = 0;
  }
  if (!meridiem && hour <= 7) {
    hour += 12;
  }
  if (hour > 23 || minute > 59) {
    return null;
  }

  return { hour, minute };
}

function parseDurationMinutes(text: string) {
  const match = text.match(/\bfor\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b/i);
  if (!match?.[1]) {
    return 30;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = (match[2] ?? "minutes").toLowerCase();
  if (!Number.isFinite(amount) || amount <= 0) {
    return 30;
  }

  return unit.startsWith("h") ? amount * 60 : amount;
}

function resolveDateParts(text: string, timeZone: string) {
  const normalized = text.toLowerCase();
  const now = new Date();
  const current = getTimeZoneParts(now, timeZone);
  const base = { year: current.year, month: current.month, day: current.day };

  if (/\btomorrow\b/.test(normalized)) {
    return addDays(base, 1);
  }

  const monthMatch = normalized.match(/\bon\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\b/);
  if (monthMatch?.[1] && monthMatch[2]) {
    const day = Number.parseInt(monthMatch[1], 10);
    const monthIndex = MONTH_INDEX[monthMatch[2]];
    if (Number.isFinite(day) && monthIndex !== undefined) {
      let year = current.year;
      const candidate = zonedDateToUtc(
        { year, month: monthIndex + 1, day, hour: 12, minute: 0 },
        timeZone,
      );
      if (candidate.getTime() < now.getTime() - 12 * 60 * 60 * 1000) {
        year += 1;
      }
      return { year, month: monthIndex + 1, day };
    }
  }

  for (const weekday of WEEKDAYS) {
    const pattern = new RegExp(`\\b(?:next\\s+)?${weekday}\\b`, "i");
    if (!pattern.test(normalized)) {
      continue;
    }

    const currentIndex = WEEKDAYS.indexOf(current.weekday as (typeof WEEKDAYS)[number]);
    const targetIndex = WEEKDAYS.indexOf(weekday);
    let delta = (targetIndex - currentIndex + 7) % 7;
    if (delta === 0 || new RegExp(`\\bnext\\s+${weekday}\\b`, "i").test(normalized)) {
      delta += 7;
    }
    return addDays(base, delta);
  }

  return base;
}

function parseDateTimeWindow(text: string, timeZone: string) {
  const dateParts = resolveDateParts(text, timeZone);
  const rangeMatch =
    text.match(/\b(?:from|between)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+(?:to|and|-)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i)
    ?? text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);

  let startClock: { hour: number; minute: number } | null = null;
  let endClock: { hour: number; minute: number } | null = null;

  if (rangeMatch?.[1] && rangeMatch[2]) {
    startClock = parseClockTime(rangeMatch[1]);
    endClock = parseClockTime(rangeMatch[2]);
  } else {
    const atMatch = text.match(/\bat\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i);
    if (!atMatch?.[1]) {
      return null;
    }
    startClock = parseClockTime(atMatch[1]);
    if (!startClock) {
      return null;
    }
    const duration = parseDurationMinutes(text);
    const startMinutes = startClock.hour * 60 + startClock.minute;
    const endMinutes = startMinutes + duration;
    endClock = {
      hour: Math.floor(endMinutes / 60),
      minute: endMinutes % 60,
    };
  }

  if (!startClock || !endClock) {
    return null;
  }

  let endDate = dateParts;
  if (endClock.hour > 23) {
    endDate = addDays(dateParts, Math.floor(endClock.hour / 24));
    endClock = {
      hour: endClock.hour % 24,
      minute: endClock.minute,
    };
  }

  const startUtc = zonedDateToUtc(
    { ...dateParts, hour: startClock.hour, minute: startClock.minute },
    timeZone,
  );
  const endUtc = zonedDateToUtc(
    { ...endDate, hour: endClock.hour, minute: endClock.minute },
    timeZone,
  );

  if (!(endUtc.getTime() > startUtc.getTime())) {
    return null;
  }

  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
  };
}

function extractAttendeeEmails(text: string) {
  return Array.from(
    new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []),
  );
}

function extractLocation(text: string) {
  const match =
    text.match(/\blocation\s+(?:is\s+)?(.+?)(?=\s+\b(?:called|titled|with|for|from|to|tomorrow|today|next|on|at)\b|$)/i)
    ?? text.match(/\bin\s+([A-Za-z0-9 &().,_-]{3,60})(?=\s+\b(?:tomorrow|today|next|on|at|for)\b|$)/i);

  return normalizeText(match?.[1] ?? "") || null;
}

function extractCreateTitle(text: string) {
  const quoted = text.match(/["']([^"']{3,120})["']/);
  if (quoted?.[1]) {
    return normalizeText(quoted[1]);
  }

  const titled =
    text.match(/\b(?:called|titled)\s+(.+?)(?=\s+\b(?:tomorrow|today|next|on|at|for|location|in)\b|$)/i)
    ?? text.match(/\b(?:event|meeting|appointment)\s+(?:called|titled)?\s*(.+?)(?=\s+\b(?:tomorrow|today|next|on|at|for|location|in)\b|$)/i);
  if (titled?.[1]) {
    return normalizeText(titled[1]);
  }

  const withMatch = text.match(/\bmeeting\s+with\s+(.+?)(?=\s+\b(?:tomorrow|today|next|on|at|for|location|in)\b|$)/i);
  if (withMatch?.[1]) {
    return `Meeting with ${normalizeText(withMatch[1])}`;
  }

  return null;
}

function extractTargetHint(text: string) {
  const quoted = text.match(/["']([^"']{3,120})["']/);
  if (quoted?.[1]) {
    return normalizeText(quoted[1]);
  }

  const explicit =
    text.match(/\b(?:meeting|event|appointment)\s+(?:called|titled|with)\s+(.+?)(?=\s+\b(?:to|for|tomorrow|today|next|on|at)\b|$)/i)
    ?? text.match(/\b(?:my\s+)?latest\s+(?:meeting|event|appointment)\s+with\s+(.+?)(?=\s+\b(?:to|for|tomorrow|today|next|on|at)\b|$)/i);

  return normalizeText(explicit?.[1] ?? "") || null;
}

async function getUserCalendarTimezone(userId: string) {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("users")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  return (data?.timezone as string | undefined) ?? "Asia/Kolkata";
}

function scoreCalendarEventMatch(event: CalendarEvent, hint: string | null) {
  if (!hint) {
    return 0;
  }

  const tokens = hint
    .toLowerCase()
    .split(/[^a-z0-9@.]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  if (!tokens.length) {
    return 0;
  }

  const haystack = [
    event.summary,
    event.location ?? "",
    event.description ?? "",
    ...event.attendees.flatMap((attendee) => [attendee.email ?? "", attendee.displayName ?? ""]),
  ].join(" ").toLowerCase();

  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

async function resolveCalendarTargetEvent(userId: string, hint: string | null) {
  const events = await getClawCloudCalendarEvents(userId, {
    timeMin: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    timeMax: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    maxResults: 40,
  });

  if (!events.length) {
    return null;
  }

  const ranked = [...events].sort((left, right) => {
    const leftScore = scoreCalendarEventMatch(left, hint);
    const rightScore = scoreCalendarEventMatch(right, hint);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return new Date(left.start).getTime() - new Date(right.start).getTime();
  });

  const best = ranked[0];
  if (!best) {
    return null;
  }

  if (hint && scoreCalendarEventMatch(best, hint) <= 0) {
    return null;
  }

  return best;
}

function formatCalendarEventRange(startIso: string, endIso: string, timeZone: string) {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateLabel = start.toLocaleDateString("en-IN", {
    timeZone,
    day: "numeric",
    month: "short",
  });
  const startLabel = start.toLocaleTimeString("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  const endLabel = end.toLocaleTimeString("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${dateLabel}, ${startLabel} - ${endLabel}`;
}

function buildCalendarCreateHelpReply() {
  return [
    "I can add that to your calendar. I just need a clear title and time.",
    "",
    "Examples:",
    "_Create a calendar event called Project Sync tomorrow at 4pm for 45 minutes_",
    "_Schedule a meeting with Priya next Tuesday at 11am_",
  ].join("\n");
}

function buildCalendarUpdateHelpReply() {
  return [
    "I can reschedule that meeting, but I need which event and the new time.",
    "",
    "Examples:",
    "_Reschedule my meeting with Priya to tomorrow at 6pm_",
    "_Move Project Sync to next Monday at 11am for 1 hour_",
  ].join("\n");
}

function buildCalendarCancelHelpReply() {
  return [
    "I can cancel a calendar event when you tell me which one.",
    "",
    "Examples:",
    "_Cancel my meeting with Priya tomorrow_",
    "_Delete the Project Sync event next Monday_",
  ].join("\n");
}

export function detectCalendarActionIntent(text: string): CalendarActionIntent | null {
  const normalized = text.toLowerCase();

  if (looksLikeCalendarKnowledgeQuestion(text)) {
    return null;
  }

  if (
    /\b(cancel|delete|remove)\b/.test(normalized)
    && /\b(calendar|meeting|event|appointment)\b/.test(normalized)
  ) {
    return "calendar_cancel";
  }

  if (
    /\b(reschedule|move|shift|change)\b/.test(normalized)
    && /\b(calendar|meeting|event|appointment)\b/.test(normalized)
  ) {
    return "calendar_update";
  }

  if (
    /\b(create|schedule|add|book)\b/.test(normalized)
    && /\b(calendar|meeting|event|appointment)\b/.test(normalized)
  ) {
    return "calendar_create";
  }

  return null;
}

async function parseCalendarAction(text: string, userId: string): Promise<ParsedCalendarAction | null> {
  const timeZone = await getUserCalendarTimezone(userId);
  const intent = detectCalendarActionIntent(text);
  if (!intent) {
    return null;
  }

  if (intent === "calendar_create") {
    const window = parseDateTimeWindow(text, timeZone);
    return {
      kind: "create",
      title: extractCreateTitle(text),
      startIso: window?.startIso ?? null,
      endIso: window?.endIso ?? null,
      location: extractLocation(text),
      attendeeEmails: extractAttendeeEmails(text),
      timeZone,
    };
  }

  if (intent === "calendar_update") {
    const window = parseDateTimeWindow(text, timeZone);
    return {
      kind: "update",
      targetHint: extractTargetHint(text),
      nextTitle: extractCreateTitle(text),
      nextStartIso: window?.startIso ?? null,
      nextEndIso: window?.endIso ?? null,
      nextLocation: extractLocation(text),
      attendeeEmails: extractAttendeeEmails(text),
      timeZone,
    };
  }

  return {
    kind: "cancel",
    targetHint: extractTargetHint(text),
    timeZone,
  };
}

export async function handleCalendarActionRequest(userId: string, text: string) {
  const action = await parseCalendarAction(text, userId);
  if (!action) {
    return null;
  }

  try {
    if (action.kind === "create") {
      if (!action.title || !action.startIso || !action.endIso) {
        return buildCalendarCreateHelpReply();
      }

      const created = await createClawCloudCalendarEvent(userId, {
        summary: action.title,
        start: action.startIso,
        end: action.endIso,
        location: action.location,
        attendeeEmails: action.attendeeEmails,
        timeZone: action.timeZone,
      });

      return [
        "Calendar event created.",
        "",
        `Title: ${created.summary}`,
        `When: ${formatCalendarEventRange(created.start, created.end, action.timeZone)}`,
        created.location ? `Location: ${created.location}` : "",
        action.attendeeEmails.length ? `Attendees: ${action.attendeeEmails.join(", ")}` : "",
      ].filter(Boolean).join("\n");
    }

    if (action.kind === "update") {
      if (!action.targetHint || !action.nextStartIso || !action.nextEndIso) {
        return buildCalendarUpdateHelpReply();
      }

      const target = await resolveCalendarTargetEvent(userId, action.targetHint);
      if (!target) {
        return `I couldn't find a calendar event matching "${action.targetHint}". Try the event title or attendee name more specifically.`;
      }

      const updated = await updateClawCloudCalendarEvent(userId, {
        eventId: target.id,
        summary: action.nextTitle ?? undefined,
        start: action.nextStartIso,
        end: action.nextEndIso,
        location: action.nextLocation ?? undefined,
        attendeeEmails: (action.attendeeEmails ?? []).length ? action.attendeeEmails ?? undefined : undefined,
        timeZone: action.timeZone,
      });

      return [
        "Calendar event updated.",
        "",
        `Title: ${updated.summary}`,
        `When: ${formatCalendarEventRange(updated.start, updated.end, action.timeZone)}`,
        updated.location ? `Location: ${updated.location}` : "",
      ].filter(Boolean).join("\n");
    }

    if (!action.targetHint) {
      return buildCalendarCancelHelpReply();
    }

    const target = await resolveCalendarTargetEvent(userId, action.targetHint);
    if (!target) {
      return `I couldn't find a calendar event matching "${action.targetHint}". Try the event title or attendee name more specifically.`;
    }

    await deleteClawCloudCalendarEvent(userId, target.id);
    return [
      "Calendar event cancelled.",
      "",
      `Title: ${target.summary}`,
      `Was scheduled for: ${formatCalendarEventRange(target.start, target.end, action.timeZone)}`,
    ].join("\n");
  } catch (error) {
    if (isClawCloudGoogleReconnectRequiredError(error)) {
      return buildGoogleReconnectRequiredReply("Google Calendar");
    }
    if (isClawCloudGoogleNotConnectedError(error, "google_calendar")) {
      return buildGoogleNotConnectedReply("Google Calendar");
    }
    throw error;
  }
}
