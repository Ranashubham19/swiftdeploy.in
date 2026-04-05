import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import {
  getClawCloudGmailMessages,
  isClawCloudGoogleNotConnectedError,
  isClawCloudGoogleReconnectRequiredError,
} from "@/lib/clawcloud-google";
import { getUserLocale, translateMessage } from "@/lib/clawcloud-i18n";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  sendClawCloudWhatsAppMessage,
  type ClawCloudWhatsAppSelfDeliveryMode,
} from "@/lib/clawcloud-whatsapp";

export type CalendarAttendee = {
  email: string;
  displayName?: string;
};

type EmailThread = {
  from: string;
  subject: string;
  snippet: string;
  date?: string;
};

type MeetingBriefingInput = {
  userId: string;
  eventId: string;
  eventTitle: string;
  eventStart: string;
  hangoutLink?: string | null;
  attendees: CalendarAttendee[];
  minutesBefore?: number;
  deliveryMode?: ClawCloudWhatsAppSelfDeliveryMode;
};

const MAX_THREADS_PER_ATTENDEE = 3;
const MAX_ATTENDEES_TO_RESEARCH = 4;
const MAX_SNIPPET_CHARS = 220;
const BRIEFING_DEDUP_WINDOW_MINUTES = 25;

async function getUserTimezone(userId: string): Promise<string> {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("users")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  return (data?.timezone as string | undefined) ?? "Asia/Kolkata";
}

function filterResearchableAttendees(attendees: CalendarAttendee[]): CalendarAttendee[] {
  const skipPatterns = [
    /no.?reply/i,
    /calendar-notification/i,
    /googlegroups\.com/i,
    /resource\.calendar\.google\.com/i,
    /group\.calendar\.google\.com/i,
    /@meet\.google\.com/i,
    /zoom\.us/i,
  ];

  return attendees.filter((attendee) => {
    if (!attendee.email || !attendee.email.includes("@")) return false;
    return !skipPatterns.some((pattern) => pattern.test(attendee.email));
  });
}

async function fetchLastThreadsWith(
  userId: string,
  attendee: CalendarAttendee,
): Promise<EmailThread[]> {
  const messages = await getClawCloudGmailMessages(userId, {
    query: `from:${attendee.email} OR to:${attendee.email}`,
    maxResults: MAX_THREADS_PER_ATTENDEE,
  });

  return messages.map((message) => ({
    from: message.from,
    subject: message.subject,
    snippet: (message.snippet ?? "").slice(0, MAX_SNIPPET_CHARS),
    date: message.date,
  }));
}

async function fetchEmailContextForAttendees(
  userId: string,
  attendees: CalendarAttendee[],
): Promise<Map<string, EmailThread[]>> {
  const contextMap = new Map<string, EmailThread[]>();

  await Promise.all(
    attendees.map(async (attendee) => {
      try {
        const threads = await fetchLastThreadsWith(userId, attendee);
        if (threads.length) {
          contextMap.set(attendee.email, threads);
        }
      } catch (error) {
        if (
          isClawCloudGoogleReconnectRequiredError(error)
          || isClawCloudGoogleNotConnectedError(error, "gmail")
        ) {
          return;
        }
        console.warn(
          `[briefing] Failed to fetch Gmail context for ${attendee.email}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }),
  );

  return contextMap;
}

function buildSimpleBriefing(input: {
  eventTitle: string;
  meetingTime: string;
  timeZone: string;
  minutesBefore: number;
  hangoutLink?: string | null;
  attendees: CalendarAttendee[];
}): string {
  const lines = [
    `📅 *Meeting in ${input.minutesBefore} minutes*`,
    "",
    `🗓️ *${input.eventTitle}*`,
    `⏰ *Time:* ${input.meetingTime} (${input.timeZone})`,
  ];

  if (input.attendees.length) {
    lines.push(
      `👥 *With:* ${input.attendees
        .map((attendee) => attendee.displayName || attendee.email.split("@")[0])
        .slice(0, 4)
        .join(", ")}`,
    );
  }

  if (input.hangoutLink) {
    lines.push(`🔗 *Join:* ${input.hangoutLink}`);
  }

  lines.push("");
  lines.push("_No recent email context found for this meeting._");
  lines.push("✅ You're ready for this one.");

  return lines.join("\n");
}

async function buildBriefingMessage(input: {
  eventTitle: string;
  meetingTime: string;
  timeZone: string;
  minutesBefore: number;
  hangoutLink?: string | null;
  attendees: CalendarAttendee[];
  emailContexts: Map<string, EmailThread[]>;
}): Promise<string> {
  const {
    eventTitle,
    meetingTime,
    timeZone,
    minutesBefore,
    hangoutLink,
    attendees,
    emailContexts,
  } = input;

  const fallback = buildSimpleBriefing({
    eventTitle,
    meetingTime,
    timeZone,
    minutesBefore,
    hangoutLink,
    attendees,
  });

  if (!emailContexts.size) {
    return fallback;
  }

  const contextLines: string[] = [];
  for (const attendee of attendees) {
    const threads = emailContexts.get(attendee.email) ?? [];
    if (!threads.length) continue;

    const displayName = attendee.displayName || attendee.email.split("@")[0];
    contextLines.push(`Recent emails with ${displayName} (${attendee.email}):`);
    for (const thread of threads) {
      contextLines.push(
        [
          thread.date ? `[${thread.date}]` : "",
          `Subject: ${thread.subject}`,
          thread.snippet ? `Preview: ${thread.snippet}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
    }
    contextLines.push("");
  }

  const answer = await completeClawCloudPrompt({
    system: [
      "You are ClawCloud AI preparing a pre-meeting WhatsApp briefing.",
      "Use only the supplied email context.",
      "Start with the meeting title and time.",
      "Then list 2-4 concise bullets with the most relevant context from the emails.",
      "Mention real dates, topics, and amounts when present.",
      "If context is thin, say so instead of inventing details.",
      "Keep it under 200 words.",
      "Use WhatsApp formatting with *bold* and bullets.",
      "End with: ✅ You're ready for this one.",
    ].join("\n"),
    user: [
      `Meeting: *${eventTitle}*`,
      `Time: ${minutesBefore} minutes from now at ${meetingTime} (${timeZone})`,
      hangoutLink ? `Join link: ${hangoutLink}` : "",
      `Attendees: ${attendees.map((attendee) => attendee.displayName || attendee.email).join(", ")}`,
      "",
      contextLines.join("\n").trim(),
    ]
      .filter(Boolean)
      .join("\n"),
    intent: "research",
    responseMode: "fast",
    maxTokens: 400,
    temperature: 0.3,
    skipCache: true,
    fallback,
  });

  return answer.trim() || fallback;
}

async function checkBriefingAlreadySent(userId: string, eventId: string): Promise<boolean> {
  const windowStart = new Date(
    Date.now() - BRIEFING_DEDUP_WINDOW_MINUTES * 60 * 1000,
  ).toISOString();

  const { data } = await getClawCloudSupabaseAdmin()
    .from("meeting_reminder_log")
    .select("id")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .gte("reminded_at", windowStart)
    .maybeSingle()
    .catch(() => ({ data: null }));

  return Boolean(data);
}

async function markBriefingSent(userId: string, eventId: string): Promise<void> {
  await getClawCloudSupabaseAdmin()
    .from("meeting_reminder_log")
    .upsert(
      {
        user_id: userId,
        event_id: eventId,
        reminded_at: new Date().toISOString(),
      },
      { onConflict: "user_id,event_id" },
    )
    .catch((error) => {
      console.warn(
        "[briefing] Failed to record meeting briefing:",
        error instanceof Error ? error.message : error,
      );
    });
}

export async function sendMeetingBriefing(input: MeetingBriefingInput): Promise<boolean> {
  const minutesBefore = input.minutesBefore ?? 30;

  if (await checkBriefingAlreadySent(input.userId, input.eventId)) {
    return false;
  }

  const locale = await getUserLocale(input.userId);
  const timeZone = await getUserTimezone(input.userId);
  const meetingTime = new Date(input.eventStart).toLocaleTimeString("en-IN", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });

  const researchableAttendees = filterResearchableAttendees(input.attendees).slice(
    0,
    MAX_ATTENDEES_TO_RESEARCH,
  );
  const emailContexts = await fetchEmailContextForAttendees(input.userId, researchableAttendees);
  const briefing = await buildBriefingMessage({
    eventTitle: input.eventTitle,
    meetingTime,
    timeZone,
    minutesBefore,
    hangoutLink: input.hangoutLink,
    attendees: researchableAttendees.length ? researchableAttendees : input.attendees,
    emailContexts,
  });

  const delivered = await sendClawCloudWhatsAppMessage(
    input.userId,
    await translateMessage(briefing, locale),
    { deliveryMode: input.deliveryMode ?? "background" },
  );
  if (!delivered) {
    return false;
  }

  await markBriefingSent(input.userId, input.eventId);
  await upsertAnalyticsDaily(input.userId, { tasks_run: 1, wa_messages_sent: 1 });
  return true;
}

export function parseCalendarAttendees(event: Record<string, unknown>): CalendarAttendee[] {
  const rawAttendees = event.attendees;
  if (!Array.isArray(rawAttendees)) {
    return [];
  }

  return rawAttendees
    .filter(
      (attendee): attendee is { email: string; displayName?: string | null } =>
        typeof attendee === "object"
        && attendee !== null
        && typeof (attendee as { email?: unknown }).email === "string",
    )
    .map((attendee) => ({
      email: attendee.email,
      displayName:
        typeof attendee.displayName === "string" && attendee.displayName.trim()
          ? attendee.displayName
          : undefined,
    }));
}
