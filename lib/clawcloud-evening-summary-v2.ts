import { completeClawCloudPrompt } from "@/lib/clawcloud-ai";
import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import { getClawCloudCalendarEvents, getClawCloudGmailMessages } from "@/lib/clawcloud-google";
import { getUserLocale, translateMessage } from "@/lib/clawcloud-i18n";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { sendClawCloudWhatsAppMessage } from "@/lib/clawcloud-whatsapp";

type TaskRunSummary = {
  taskType: string;
  status: "success" | "failed";
  count: number;
};

const TASK_TYPE_LABELS: Record<string, string> = {
  morning_briefing: "Morning briefing",
  draft_replies: "Email drafts",
  meeting_reminders: "Meeting reminders",
  email_search: "Email searches",
  custom_reminder: "Custom reminders",
  evening_summary: "Evening summary",
  weekly_spend: "Spend summary",
};

async function getUserTimezone(userId: string): Promise<string> {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("users")
    .select("timezone")
    .eq("id", userId)
    .maybeSingle()
    .catch(() => ({ data: null }));

  return (data?.timezone as string | undefined) ?? "Asia/Kolkata";
}

async function fetchTodayTaskRuns(userId: string, todayStart: Date): Promise<TaskRunSummary[]> {
  const { data } = await getClawCloudSupabaseAdmin()
    .from("task_runs")
    .select("task_type, status")
    .eq("user_id", userId)
    .gte("started_at", todayStart.toISOString())
    .neq("task_type", "evening_summary")
    .neq("task_type", "chat_message")
    .order("started_at", { ascending: false })
    .limit(100)
    .catch(() => ({ data: null }));

  if (!data?.length) {
    return [];
  }

  const grouped = new Map<string, TaskRunSummary>();
  for (const run of data as Array<{ task_type: string; status: string }>) {
    const status = run.status === "success" ? "success" : "failed";
    const key = `${run.task_type}:${status}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      grouped.set(key, {
        taskType: run.task_type,
        status,
        count: 1,
      });
    }
  }

  return [...grouped.values()].sort((left, right) => right.count - left.count);
}

async function fetchPendingReminders(
  userId: string,
): Promise<Array<{ reminder_text: string; fire_at: string }>> {
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 2);

  const { data } = await getClawCloudSupabaseAdmin()
    .from("user_reminders")
    .select("reminder_text, fire_at")
    .eq("user_id", userId)
    .eq("is_active", true)
    .gte("fire_at", new Date().toISOString())
    .lte("fire_at", horizon.toISOString())
    .order("fire_at", { ascending: true })
    .limit(5)
    .catch(() => ({ data: null }));

  return (data ?? []) as Array<{ reminder_text: string; fire_at: string }>;
}

function prioritizeUrgentEmails<T extends { from: string; subject: string }>(emails: T[]): T[] {
  const automated = /noreply|no-reply|notifications?|alerts?|digest|newsletter|unsubscribe/i;
  return [
    ...emails.filter((email) => !automated.test(email.from)),
    ...emails.filter((email) => automated.test(email.from)),
  ];
}

function extractFirstName(fromField: string): string {
  const displayName = fromField.replace(/<[^>]+>/g, "").replace(/["']/g, "").trim();
  if (displayName && !displayName.includes("@")) {
    return displayName.split(/\s+/)[0] ?? displayName;
  }

  return fromField.match(/([^@<\s"']+)@/)?.[1] ?? fromField.slice(0, 20);
}

function formatDate(date: Date, timeZone: string): string {
  return date.toLocaleDateString("en-IN", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function formatReminderTime(value: string, timeZone: string): string {
  return new Date(value).toLocaleString("en-IN", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function buildMotivationalClose(
  taskRuns: TaskRunSummary[],
  unreadCount: number,
  tomorrowMeetings: number,
): string {
  const totalTaskRuns = taskRuns.reduce((sum, run) => sum + run.count, 0);

  if (totalTaskRuns === 0 && unreadCount === 0 && tomorrowMeetings === 0) {
    return "_Quiet day. Enjoy your evening!_";
  }
  if (tomorrowMeetings >= 3) {
    return "_Busy day tomorrow. Rest well tonight._";
  }
  if (unreadCount > 10) {
    return "_Inbox needs some love. Fresh eyes tomorrow morning will help._";
  }
  return "_Great work today. See you tomorrow._";
}

async function polishSummaryMessage(rawMessage: string, locale: string): Promise<string> {
  if (locale !== "en") {
    return rawMessage;
  }

  const polished = await completeClawCloudPrompt({
    system: [
      "You are ClawCloud AI writing an evening WhatsApp summary.",
      "Keep every fact and section from the source message.",
      "Make it sound warm and conversational without changing the meaning.",
      "Preserve bullets, counts, and the header.",
      "Keep it under 280 words.",
    ].join("\n"),
    user: rawMessage,
    intent: "research",
    responseMode: "fast",
    maxTokens: 400,
    temperature: 0.4,
    skipCache: true,
    fallback: rawMessage,
  });

  return polished.trim() || rawMessage;
}

async function buildEveningSummaryMessage(input: {
  locale: string;
  timeZone: string;
  todayEmails: Array<{ from: string; subject: string; isRead?: boolean }>;
  tomorrowEvents: Array<{ summary: string; start: string; hangoutLink?: string | null }>;
  taskRuns: TaskRunSummary[];
  pendingReminders: Array<{ reminder_text: string; fire_at: string }>;
}): Promise<string> {
  const { locale, timeZone, todayEmails, tomorrowEvents, taskRuns, pendingReminders } = input;
  const unreadEmails = todayEmails.filter((email) => email.isRead === false || email.isRead === undefined);
  const urgentEmails = prioritizeUrgentEmails(unreadEmails);
  const lines: string[] = [];

  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(new Date()),
  );

  lines.push(hour < 20 ? "🌆 *Evening Summary*" : "🌙 *End of Day Summary*");
  lines.push(`_${formatDate(new Date(), timeZone)}_`);
  lines.push("");

  if (taskRuns.length) {
    lines.push("🤖 *Your AI worked on:*");
    for (const taskRun of taskRuns) {
      const label = TASK_TYPE_LABELS[taskRun.taskType] ?? taskRun.taskType;
      const statusEmoji = taskRun.status === "success" ? "✅" : "⚠️";
      lines.push(`• ${statusEmoji} ${label} (${taskRun.count}x)`);
    }
    lines.push("");
  }

  if (urgentEmails.length) {
    lines.push(`📧 *Needs your attention (${unreadEmails.length} unread):*`);
    for (const email of urgentEmails.slice(0, 5)) {
      lines.push(`• *${extractFirstName(email.from)}* - ${email.subject}`);
    }
    if (unreadEmails.length > 5) {
      lines.push(`• _+ ${unreadEmails.length - 5} more_`);
    }
    lines.push("");
  } else {
    lines.push("📧 *Inbox:* All clear - no unread emails ✅");
    lines.push("");
  }

  if (tomorrowEvents.length) {
    lines.push("📅 *Tomorrow's agenda:*");
    for (const event of tomorrowEvents) {
      const time = new Date(event.start).toLocaleTimeString("en-IN", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      lines.push(`• *${time}* - ${event.summary}${event.hangoutLink ? " 🔗" : ""}`);
    }
    lines.push("");
  } else {
    lines.push("📅 *Tomorrow:* No meetings scheduled 🎉");
    lines.push("");
  }

  if (pendingReminders.length) {
    lines.push("⏰ *Upcoming reminders:*");
    for (const reminder of pendingReminders.slice(0, 3)) {
      lines.push(`• ${reminder.reminder_text} _at ${formatReminderTime(reminder.fire_at, timeZone)}_`);
    }
    lines.push("");
  }

  lines.push(buildMotivationalClose(taskRuns, unreadEmails.length, tomorrowEvents.length));

  return polishSummaryMessage(lines.join("\n"), locale).catch(() => lines.join("\n"));
}

export async function sendEveningSummary(userId: string): Promise<{ message: string }> {
  const locale = await getUserLocale(userId);
  const timeZone = await getUserTimezone(userId);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const tomorrowEnd = new Date(tomorrowStart);
  tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

  const [todayEmails, tomorrowEvents, taskRuns, pendingReminders] = await Promise.all([
    getClawCloudGmailMessages(userId, {
      query: "is:unread newer_than:1d",
      maxResults: 20,
    }).catch(() => []),
    getClawCloudCalendarEvents(userId, {
      timeMin: tomorrowStart.toISOString(),
      timeMax: tomorrowEnd.toISOString(),
    }).catch(() => []),
    fetchTodayTaskRuns(userId, todayStart),
    fetchPendingReminders(userId),
  ]);

  const message = await buildEveningSummaryMessage({
    locale,
    timeZone,
    todayEmails,
    tomorrowEvents,
    taskRuns,
    pendingReminders,
  });
  const translated = await translateMessage(message, locale);

  await sendClawCloudWhatsAppMessage(userId, translated);
  await upsertAnalyticsDaily(userId, {
    emails_processed: todayEmails.length,
    tasks_run: 1,
    wa_messages_sent: 1,
  });

  return { message: translated };
}
