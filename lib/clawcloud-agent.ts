import OpenAI from "openai";

import {
  createClawCloudGmailDraft,
  getClawCloudCalendarEvents,
  getClawCloudGmailMessages,
} from "@/lib/clawcloud-google";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  clawCloudActiveTaskLimits,
  clawCloudDefaultTaskSeeds,
  clawCloudRunLimits,
  formatDateKey,
  type ClawCloudPlan,
  type ClawCloudTaskConfig,
  type ClawCloudTaskType,
} from "@/lib/clawcloud-types";
import { env } from "@/lib/env";
import { sendClawCloudWhatsAppMessage } from "@/lib/clawcloud-whatsapp";

type AgentTaskRow = {
  id: string;
  user_id: string;
  task_type: ClawCloudTaskType;
  is_enabled: boolean;
  schedule_time: string | null;
  schedule_days: string[] | null;
  config: ClawCloudTaskConfig | null;
  total_runs: number;
  last_run_at: string | null;
};

type RunTaskInput = {
  userId: string;
  taskType: ClawCloudTaskType;
  userMessage?: string | null;
  bypassEnabledCheck?: boolean;
};

let cachedOpenAIClient: OpenAI | null = null;

function getOpenAIClient() {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  if (!cachedOpenAIClient) {
    cachedOpenAIClient = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }

  return cachedOpenAIClient;
}

async function completeClawCloudPrompt(input: {
  user: string;
  system?: string;
  maxTokens?: number;
  fallback: string;
}) {
  const client = getOpenAIClient();
  if (!client) {
    return input.fallback;
  }

  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL || "gpt-4o-mini",
    max_tokens: input.maxTokens ?? 300,
    messages: [
      ...(input.system ? [{ role: "system" as const, content: input.system }] : []),
      { role: "user" as const, content: input.user },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || input.fallback;
}

async function getTaskRow(userId: string, taskType: ClawCloudTaskType) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("agent_tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("task_type", taskType)
    .maybeSingle();

  return (data ?? null) as AgentTaskRow | null;
}

async function getUserPlan(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data } = await supabaseAdmin
    .from("users")
    .select("plan")
    .eq("id", userId)
    .maybeSingle();

  return (data?.plan ?? "free") as ClawCloudPlan;
}

async function getTodayRunCount(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabaseAdmin
    .from("task_runs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("started_at", todayStart.toISOString());

  return count ?? 0;
}

async function upsertAnalyticsDaily(
  userId: string,
  updates: Partial<{
    emails_processed: number;
    drafts_created: number;
    tasks_run: number;
    minutes_saved: number;
    wa_messages_sent: number;
  }>,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const date = formatDateKey();

  const { data: current } = await supabaseAdmin
    .from("analytics_daily")
    .select("*")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle();

  const nextRecord = {
    user_id: userId,
    date,
    emails_processed: (current?.emails_processed ?? 0) + (updates.emails_processed ?? 0),
    drafts_created: (current?.drafts_created ?? 0) + (updates.drafts_created ?? 0),
    tasks_run: (current?.tasks_run ?? 0) + (updates.tasks_run ?? 0),
    minutes_saved: (current?.minutes_saved ?? 0) + (updates.minutes_saved ?? 0),
    wa_messages_sent: (current?.wa_messages_sent ?? 0) + (updates.wa_messages_sent ?? 0),
  };

  await supabaseAdmin
    .from("analytics_daily")
    .upsert(nextRecord, { onConflict: "user_id,date" });
}

async function seedClawCloudDefaultTasks(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const rows = clawCloudDefaultTaskSeeds.map((task) => ({
    user_id: userId,
    task_type: task.taskType,
    is_enabled: task.enabledByDefault,
    schedule_time: task.scheduleTime,
    schedule_days: task.scheduleDays,
    config: task.config,
  }));

  await supabaseAdmin.from("agent_tasks").upsert(rows, {
    onConflict: "user_id,task_type",
  });
}

function parseReminderMessage(message: string) {
  const trimmed = message.trim();
  const atMatch = trimmed.match(/at\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (!atMatch) {
    return null;
  }

  const hour = Number(atMatch[1] ?? "0");
  const minute = Number(atMatch[2] ?? "0");
  const meridiem = (atMatch[3] ?? "").toLowerCase();
  let hour24 = hour % 12;
  if (meridiem === "pm") {
    hour24 += 12;
  }

  const fireAt = new Date();
  fireAt.setHours(hour24, minute, 0, 0);
  if (fireAt.getTime() <= Date.now()) {
    fireAt.setDate(fireAt.getDate() + 1);
  }

  const reminderText = trimmed
    .replace(/^remind me/i, "")
    .replace(atMatch[0], "")
    .replace(/\bto\b/i, "")
    .trim();

  return {
    fireAt: fireAt.toISOString(),
    reminderText: reminderText || "Reminder",
  };
}

async function runMorningBriefing(
  userId: string,
  config: ClawCloudTaskConfig,
) {
  const emails = await getClawCloudGmailMessages(userId, {
    query: "is:unread",
    maxResults: Number(config.max_emails ?? 50),
  });
  const events = await getClawCloudCalendarEvents(userId, {
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  });

  const emailContext = emails
    .slice(0, 20)
    .map(
      (email) =>
        `From: ${email.from}\nSubject: ${email.subject}\nSnippet: ${email.snippet}`,
    )
    .join("\n---\n");
  const eventContext = events
    .map((event) => `${event.start} - ${event.summary}${event.hangoutLink ? ` (${event.hangoutLink})` : ""}`)
    .join("\n");

  const message = await completeClawCloudPrompt({
    system:
      "You are ClawCloud AI, a concise personal assistant writing a WhatsApp morning briefing.",
    user: `Create a concise morning briefing.\n\nUnread emails: ${emails.length}\n${emailContext}\n\nToday's events:\n${eventContext || "No events today"}\n\nKeep it under 300 words and mention which emails need replies.`,
    maxTokens: 500,
    fallback: `Good morning. You have ${emails.length} unread emails and ${events.length} event${events.length === 1 ? "" : "s"} today.`,
  });

  await sendClawCloudWhatsAppMessage(userId, message);
  await upsertAnalyticsDaily(userId, {
    emails_processed: emails.length,
    tasks_run: 1,
    minutes_saved: Math.max(15, Math.min(60, emails.length * 2)),
    wa_messages_sent: 1,
  });

  return {
    message,
    emailCount: emails.length,
    eventCount: events.length,
  };
}

async function runDraftReplies(
  userId: string,
  config: ClawCloudTaskConfig,
  userMessage: string | null | undefined,
) {
  const emails = await getClawCloudGmailMessages(userId, {
    query: "is:unread",
    maxResults: /all|every|each/i.test(userMessage ?? "") ? 10 : 5,
  });

  if (emails.length === 0) {
    const message = "No emails found that need a reply right now.";
    await sendClawCloudWhatsAppMessage(userId, message);
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { drafted: 0, message };
  }

  const targetName = userMessage?.match(/to\s+(\w+)/i)?.[1]?.toLowerCase() ?? null;
  const targetEmails = targetName
    ? emails.filter((email) => email.from.toLowerCase().includes(targetName))
    : emails.slice(0, /all|every|each/i.test(userMessage ?? "") ? emails.length : 1);

  const drafts: Array<{ from: string; subject: string; draftId: string }> = [];

  for (const email of targetEmails) {
    const body = await completeClawCloudPrompt({
      system:
        "You write polished, concise email drafts. Return only the reply body without a subject line.",
      user: `Write a professional reply to this email.\n\nFrom: ${email.from}\nSubject: ${email.subject}\nBody:\n${email.body || email.snippet}\n\nTone: ${String(config.tone ?? "professional")}`,
      maxTokens: 400,
      fallback: `Hi,\n\nThanks for your email. I have reviewed this and will get back to you shortly.\n\nBest regards,`,
    });

    const draftId = await createClawCloudGmailDraft(userId, {
      to: email.replyTo || email.from,
      subject: `Re: ${email.subject}`,
      body,
      inReplyTo: email.messageId || null,
    });

    drafts.push({
      from: email.from,
      subject: email.subject,
      draftId,
    });
  }

  const confirmation =
    drafts.length === 1
      ? `Draft created for ${drafts[0]?.from} and saved to Gmail Drafts.`
      : `${drafts.length} drafts created and saved to Gmail Drafts.`;

  await sendClawCloudWhatsAppMessage(userId, confirmation);
  await upsertAnalyticsDaily(userId, {
    drafts_created: drafts.length,
    tasks_run: 1,
    wa_messages_sent: 1,
  });

  return {
    drafted: drafts.length,
    drafts,
  };
}

async function runMeetingReminders(
  userId: string,
  config: ClawCloudTaskConfig,
) {
  const minutesBefore = Number(config.minutes_before ?? 30);
  const now = Date.now();
  const windowStart = new Date(now + minutesBefore * 60 * 1000);
  const windowEnd = new Date(windowStart.getTime() + 5 * 60 * 1000);
  const events = await getClawCloudCalendarEvents(userId, {
    timeMin: windowStart.toISOString(),
    timeMax: windowEnd.toISOString(),
  });

  if (events.length === 0) {
    return { reminded: 0 };
  }

  for (const event of events) {
    const message = `Meeting in ${minutesBefore} minutes.\n\n${event.summary}\n${event.start}${event.hangoutLink ? `\n${event.hangoutLink}` : ""}`;
    await sendClawCloudWhatsAppMessage(userId, message);
  }

  await upsertAnalyticsDaily(userId, {
    tasks_run: 1,
    wa_messages_sent: events.length,
  });

  return { reminded: events.length };
}

async function runEmailSearch(
  userId: string,
  userMessage: string | null | undefined,
) {
  if (!userMessage?.trim()) {
    const message = "Tell me what you want me to search for in Gmail.";
    await sendClawCloudWhatsAppMessage(userId, message);
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { found: 0, answer: message };
  }

  const gmailQuery = await completeClawCloudPrompt({
    user: `Convert this natural language request into a concise Gmail search query string: "${userMessage}"`,
    maxTokens: 50,
    fallback: userMessage,
  });

  const emails = await getClawCloudGmailMessages(userId, {
    query: gmailQuery,
    maxResults: 5,
  });

  if (emails.length === 0) {
    const message = `No emails found for: ${userMessage}`;
    await sendClawCloudWhatsAppMessage(userId, message);
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { found: 0, answer: message };
  }

  const answer = await completeClawCloudPrompt({
    user: `Answer this question based on the email snippets.\nQuestion: ${userMessage}\n\n${emails.map((email) => `${email.from}: ${email.snippet}`).join("\n\n")}`,
    maxTokens: 250,
    fallback: emails[0]?.snippet || "Relevant emails found.",
  });

  await sendClawCloudWhatsAppMessage(
    userId,
    `Search: ${userMessage}\n\n${answer}\n\nFound ${emails.length} relevant email(s).`,
  );
  await upsertAnalyticsDaily(userId, {
    tasks_run: 1,
    wa_messages_sent: 1,
  });

  return { found: emails.length, answer };
}

async function runEveningSummary(
  userId: string,
) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [emails, events, taskRuns] = await Promise.all([
    getClawCloudGmailMessages(userId, {
      query: `after:${Math.floor(todayStart.getTime() / 1000)}`,
      maxResults: 30,
    }),
    getClawCloudCalendarEvents(userId, {
      timeMin: todayStart.toISOString(),
      timeMax: new Date().toISOString(),
    }),
    getClawCloudSupabaseAdmin()
      .from("task_runs")
      .select("task_type,status")
      .eq("user_id", userId)
      .gte("started_at", todayStart.toISOString()),
  ]);

  const summary = await completeClawCloudPrompt({
    user: `Create a concise evening summary.\nEmails today: ${emails.length}\nMeetings today: ${events.length}\nAI tasks run: ${taskRuns.data?.length ?? 0}\n\nEmails needing attention:\n${emails.filter((email) => !email.isRead).slice(0, 5).map((email) => `- ${email.from}: ${email.subject}`).join("\n") || "None"}`,
    maxTokens: 250,
    fallback: `Today you received ${emails.length} emails, attended ${events.length} meetings, and ran ${taskRuns.data?.length ?? 0} AI task(s).`,
  });

  await sendClawCloudWhatsAppMessage(userId, summary);
  await upsertAnalyticsDaily(userId, {
    emails_processed: emails.length,
    tasks_run: 1,
    wa_messages_sent: 1,
  });

  return { message: summary };
}

async function runCustomReminder(
  userId: string,
  userMessage: string | null | undefined,
) {
  const rawMessage = userMessage?.trim() ?? "";
  if (!rawMessage) {
    throw new Error("Custom reminder requires a message.");
  }

  const parsed = parseReminderMessage(rawMessage);
  if (!parsed) {
    const message =
      "I could not parse that reminder. Try: Remind me at 5pm to call Priya.";
    await sendClawCloudWhatsAppMessage(userId, message);
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { set: false, message };
  }

  await getClawCloudSupabaseAdmin()
    .from("agent_tasks")
    .upsert(
      {
        user_id: userId,
        task_type: "custom_reminder",
        is_enabled: true,
        config: {
          reminder_text: parsed.reminderText,
          fire_at: parsed.fireAt,
          one_time: true,
          source_message: rawMessage,
        },
      },
      { onConflict: "user_id,task_type" },
    );

  const confirmation = `Reminder set for ${new Date(parsed.fireAt).toLocaleString("en-IN")}.\n\n${parsed.reminderText}`;
  await sendClawCloudWhatsAppMessage(userId, confirmation);
  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });

  return {
    set: true,
    fireAt: parsed.fireAt,
    reminderText: parsed.reminderText,
  };
}

export async function runClawCloudTask(input: RunTaskInput) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const task = await getTaskRow(input.userId, input.taskType);

  if (!task) {
    throw new Error(`Task ${input.taskType} is not configured for this user.`);
  }

  if (!input.bypassEnabledCheck && !task.is_enabled) {
    throw new Error(`Task ${input.taskType} is disabled.`);
  }

  const plan = await getUserPlan(input.userId);
  const todayRunCount = await getTodayRunCount(input.userId);
  const dailyLimit = clawCloudRunLimits[plan];

  if (todayRunCount >= dailyLimit) {
    await sendClawCloudWhatsAppMessage(
      input.userId,
      `You have reached your daily limit of ${dailyLimit} task runs on the ${plan} plan.`,
    );
    throw new Error("Daily limit reached.");
  }

  const { data: taskRun } = await supabaseAdmin
    .from("task_runs")
    .insert({
      user_id: input.userId,
      task_id: task.id,
      task_type: input.taskType,
      status: "running",
      input_data: input.userMessage ? { user_message: input.userMessage } : {},
    })
    .select("id")
    .single();

  const startedAt = Date.now();

  try {
    let result: Record<string, unknown>;

    switch (input.taskType) {
      case "morning_briefing":
        result = await runMorningBriefing(input.userId, task.config ?? {});
        break;
      case "draft_replies":
        result = await runDraftReplies(input.userId, task.config ?? {}, input.userMessage);
        break;
      case "meeting_reminders":
        result = await runMeetingReminders(input.userId, task.config ?? {});
        break;
      case "email_search":
        result = await runEmailSearch(input.userId, input.userMessage);
        break;
      case "evening_summary":
        result = await runEveningSummary(input.userId);
        break;
      case "custom_reminder":
        result = await runCustomReminder(input.userId, input.userMessage);
        break;
      default:
        throw new Error(`Unsupported task type: ${input.taskType}`);
    }

    const durationMs = Date.now() - startedAt;
    await supabaseAdmin
      .from("task_runs")
      .update({
        status: "success",
        output_data: result,
        duration_ms: durationMs,
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskRun.id);

    await supabaseAdmin
      .from("agent_tasks")
      .update({
        total_runs: (task.total_runs ?? 0) + 1,
        last_run_at: new Date().toISOString(),
      })
      .eq("id", task.id);

    return result;
  } catch (error) {
    await supabaseAdmin
      .from("task_runs")
      .update({
        status: "failed",
        error_message: error instanceof Error ? error.message : "Unknown task failure.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", taskRun.id);

    throw error;
  }
}

export async function runClawCloudMorningBriefing(userId: string) {
  return runClawCloudTask({
    userId,
    taskType: "morning_briefing",
    bypassEnabledCheck: true,
  });
}

export async function completeClawCloudOnboarding(input: {
  userId: string;
  selectedTasks: ClawCloudTaskType[];
  taskConfigs: Partial<Record<ClawCloudTaskType, ClawCloudTaskConfig>>;
}) {
  await seedClawCloudDefaultTasks(input.userId);

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  await supabaseAdmin
    .from("agent_tasks")
    .update({ is_enabled: false })
    .eq("user_id", input.userId);

  for (const taskType of input.selectedTasks) {
    const config = input.taskConfigs[taskType] ?? {};
    const scheduleTime =
      typeof config.schedule_time === "string" ? config.schedule_time : undefined;
    await supabaseAdmin
      .from("agent_tasks")
      .update({
        is_enabled: true,
        ...(scheduleTime !== undefined ? { schedule_time: scheduleTime } : {}),
        config,
      })
      .eq("user_id", input.userId)
      .eq("task_type", taskType);
  }

  await supabaseAdmin
    .from("users")
    .update({ onboarding_done: true })
    .eq("id", input.userId);

  return {
    success: true,
    tasksEnabled: input.selectedTasks.length,
  };
}

export async function getClawCloudDashboardData(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const today = formatDateKey();

  const [userProfile, connectedAccounts, agentTasks, recentRuns, todayAnalytics, last7Days] =
    await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id, email, full_name, avatar_url, plan, onboarding_done, timezone")
        .eq("id", userId)
        .maybeSingle(),
      supabaseAdmin
        .from("connected_accounts")
        .select("provider, account_email, phone_number, display_name, is_active, connected_at, last_used_at")
        .eq("user_id", userId),
      supabaseAdmin
        .from("agent_tasks")
        .select("id, task_type, is_enabled, schedule_time, schedule_days, config, total_runs, last_run_at")
        .eq("user_id", userId)
        .order("created_at"),
      supabaseAdmin
        .from("task_runs")
        .select("id, task_type, status, duration_ms, started_at, completed_at, output_data")
        .eq("user_id", userId)
        .order("started_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("analytics_daily")
        .select("*")
        .eq("user_id", userId)
        .eq("date", today)
        .maybeSingle(),
      supabaseAdmin
        .from("analytics_daily")
        .select("date, tasks_run, emails_processed, drafts_created, minutes_saved")
        .eq("user_id", userId)
        .order("date", { ascending: false })
        .limit(7),
    ]);

  const userPlan = (userProfile.data?.plan ?? "free") as ClawCloudPlan;
  const todayRuns = await getTodayRunCount(userId);
  const dashboardTasks = (agentTasks.data ?? []) as AgentTaskRow[];

  return {
    user: userProfile.data,
    connected_accounts: connectedAccounts.data ?? [],
    tasks: dashboardTasks,
    recent_activity: recentRuns.data ?? [],
    analytics: {
      today:
        todayAnalytics.data ?? {
          emails_processed: 0,
          drafts_created: 0,
          tasks_run: 0,
          minutes_saved: 0,
          wa_messages_sent: 0,
        },
      last_7_days: last7Days.data ?? [],
    },
    agent_status: {
      is_active: dashboardTasks.some((task) => task.is_enabled),
      active_task_count: dashboardTasks.filter((task) => task.is_enabled).length,
      today_runs: todayRuns,
      daily_limit: clawCloudRunLimits[userPlan],
      runs_remaining: Math.max(0, clawCloudRunLimits[userPlan] - todayRuns),
      active_task_limit: clawCloudActiveTaskLimits[userPlan],
    },
  };
}

export async function createClawCloudTask(input: {
  userId: string;
  taskType: ClawCloudTaskType;
  scheduleTime?: string | null;
  scheduleDays?: string[] | null;
  config?: ClawCloudTaskConfig;
}) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const plan = await getUserPlan(input.userId);
  const { data: existingTasks } = await supabaseAdmin
    .from("agent_tasks")
    .select("id")
    .eq("user_id", input.userId)
    .eq("is_enabled", true);

  if ((existingTasks?.length ?? 0) >= clawCloudActiveTaskLimits[plan]) {
    throw new Error(`Task limit reached for the ${plan} plan.`);
  }

  const { data, error } = await supabaseAdmin
    .from("agent_tasks")
    .upsert(
      {
        user_id: input.userId,
        task_type: input.taskType,
        is_enabled: true,
        schedule_time: input.scheduleTime ?? null,
        schedule_days: input.scheduleDays ?? null,
        config: input.config ?? {},
      },
      { onConflict: "user_id,task_type" },
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function updateClawCloudTask(
  userId: string,
  taskId: string,
  updates: Partial<{
    is_enabled: boolean;
    schedule_time: string | null;
    schedule_days: string[] | null;
    config: ClawCloudTaskConfig;
  }>,
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data: task } = await supabaseAdmin
    .from("agent_tasks")
    .select("id, user_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || task.user_id !== userId) {
    throw new Error("Task not found.");
  }

  const { data, error } = await supabaseAdmin
    .from("agent_tasks")
    .update(updates)
    .eq("id", taskId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function deleteClawCloudTask(userId: string, taskId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data: task } = await supabaseAdmin
    .from("agent_tasks")
    .select("id, user_id")
    .eq("id", taskId)
    .maybeSingle();

  if (!task || task.user_id !== userId) {
    throw new Error("Task not found.");
  }

  const { error } = await supabaseAdmin.from("agent_tasks").delete().eq("id", taskId);
  if (error) {
    throw new Error(error.message);
  }

  return true;
}

export async function runDueClawCloudTasks() {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, "0")}:${now
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
  const currentDay = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()] ?? "sun";

  const { data: scheduledTasks, error } = await supabaseAdmin
    .from("agent_tasks")
    .select("id, user_id, task_type, schedule_time, schedule_days, is_enabled")
    .eq("is_enabled", true)
    .eq("schedule_time", currentTime);

  if (error) {
    throw new Error(error.message);
  }

  const fired: Array<{ userId: string; taskType: ClawCloudTaskType }> = [];
  const errors: Array<{ userId: string; taskType: ClawCloudTaskType; error: string }> = [];

  for (const task of (scheduledTasks ?? []) as AgentTaskRow[]) {
    const scheduledDays = task.schedule_days ?? [
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
    ];

    if (!scheduledDays.includes(currentDay)) {
      continue;
    }

    try {
      await runClawCloudTask({
        userId: task.user_id,
        taskType: task.task_type,
        bypassEnabledCheck: true,
      });
      fired.push({ userId: task.user_id, taskType: task.task_type });
    } catch (error) {
      errors.push({
        userId: task.user_id,
        taskType: task.task_type,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const { data: reminderTasks } = await supabaseAdmin
    .from("agent_tasks")
    .select("id, user_id, config")
    .eq("task_type", "custom_reminder")
    .eq("is_enabled", true);

  for (const reminder of reminderTasks ?? []) {
    const fireAt = (reminder.config as { fire_at?: string })?.fire_at;
    if (!fireAt) {
      continue;
    }

    const fireTime = new Date(fireAt).getTime();
    if (fireTime > Date.now() || fireTime < Date.now() - 60 * 1000) {
      continue;
    }

    try {
      const reminderText =
        (reminder.config as { reminder_text?: string })?.reminder_text || "Reminder";
      await sendClawCloudWhatsAppMessage(reminder.user_id, `Reminder\n\n${reminderText}`);
      await supabaseAdmin
        .from("agent_tasks")
        .update({ is_enabled: false })
        .eq("id", reminder.id);
      fired.push({ userId: reminder.user_id, taskType: "custom_reminder" });
    } catch (error) {
      errors.push({
        userId: reminder.user_id,
        taskType: "custom_reminder",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const { data: meetingTasks } = await supabaseAdmin
    .from("agent_tasks")
    .select("user_id")
    .eq("task_type", "meeting_reminders")
    .eq("is_enabled", true);

  for (const meetingTask of meetingTasks ?? []) {
    try {
      await runClawCloudTask({
        userId: meetingTask.user_id,
        taskType: "meeting_reminders",
        bypassEnabledCheck: true,
      });
    } catch {
      // Meeting reminders are silent when nothing is due.
    }
  }

  return {
    timestamp: now.toISOString(),
    fired,
    errors,
  };
}
