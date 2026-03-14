import {
  createClawCloudGmailDraft,
  getClawCloudCalendarEvents,
  getClawCloudGmailMessages,
} from "@/lib/clawcloud-google";
import { upsertAnalyticsDaily } from "@/lib/clawcloud-analytics";
import {
  completeClawCloudFast,
  completeClawCloudPrompt,
  hasClawCloudChatProvider,
  type IntentType,
} from "@/lib/clawcloud-ai";
import { handleReplyApprovalCommand, sendReplyApprovalRequests } from "@/lib/clawcloud-reply-approval";
import { answerSpendingQuestion, runWeeklySpendSummary } from "@/lib/clawcloud-spending";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  buildMultilingualBriefingSystem,
  getUserLocale,
  translateMessage,
  type SupportedLocale,
} from "@/lib/clawcloud-i18n";
import { sendClawCloudTelegramMessage } from "@/lib/clawcloud-telegram";
import {
  clawCloudActiveTaskLimits,
  clawCloudDefaultTaskSeeds,
  clawCloudRunLimits,
  formatDateKey,
  type ClawCloudPlan,
  type ClawCloudTaskConfig,
  type ClawCloudTaskType,
} from "@/lib/clawcloud-types";
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

type ConversationHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

type SupabaseAdminClient = ReturnType<typeof getClawCloudSupabaseAdmin>;

type AgentIntentKind =
  | "help"
  | "spending"
  | "draft_email"
  | "email_search"
  | "reminder"
  | "calendar"
  | "greeting"
  | "coding"
  | "math"
  | "creative"
  | "research"
  | "general";

type DetectedAgentIntent = {
  kind: AgentIntentKind;
  aiIntent: IntentType;
};

const conversationalFallbackMessage =
  "I can help with questions, coding, writing, Gmail search, reminders, calendar summaries, and spending analysis.";
const repeatedReplyRecoveryMessage =
  "Tell me the exact task or question and I'll handle it. For reminders, include the time, for example: 'Remind me at 5pm to call Priya.'";
const capabilityHelpMessage =
  "I can answer questions, write and debug code, draft replies, search Gmail, summarize your calendar, set reminders, and explain spending patterns from receipts and invoices.";
const conversationalSystemPrompt =
  [
    "You are ClawCloud AI, a world-class personal assistant for chat.",
    "Give the answer first, then add only the most useful context.",
    "Be accurate, practical, and direct.",
    "Format for chat: short paragraphs, clear bullets when helpful, no rambling, no filler.",
    "For WhatsApp or Telegram style replies, keep sections easy to scan and naturally human.",
    "Never say you completed an external action unless the system already triggered it.",
    "Never fall back to generic boilerplate when the user asked a specific question.",
    "If uncertainty exists, say what is certain and what is uncertain.",
  ].join(" ");
const specialistSystemPrompts: Partial<Record<IntentType, string>> = {
  greeting:
    "For greetings, reply warmly, sound energetic but professional, and mention 4 or 5 concrete things you can help with in one short message.",
  general:
    "For general questions, lead with the direct answer, then add only the most useful context, examples, or nuance.",
  coding:
    "For coding help, prefer complete working examples, strong debugging guidance, exact fixes, and explicit next steps. Avoid pseudocode unless the user asks for high-level design only.",
  math:
    "For math, show the reasoning step by step, keep notation readable in plain text, and end with a clear final answer.",
  email:
    "For email help, be polished, concise, and ready to send. When summarizing email results, stay factual and specific about sender, subject, and next action.",
  reminder:
    "For reminders, be explicit about the task and the time so the user can confirm it quickly. If reminder details are incomplete, say exactly what is missing.",
  calendar:
    "For calendar help, surface schedule status first, then times, titles, links, and locations. Highlight conflicts, gaps, and urgent upcoming meetings when relevant.",
  spending:
    "For spending questions, answer only from the available evidence, summarize the numbers clearly, and call out uncertainty or missing data.",
  research:
    "For research or analysis, structure the answer with a clear conclusion, key points, and practical takeaway. Be comprehensive without becoming verbose.",
  creative:
    "For creative writing, match the requested tone closely, be vivid and specific, and finish the piece cleanly without trailing off.",
};
const greetingPattern =
  /^(?:hi+|hello+|hey+|good\s+(?:morning|afternoon|evening)|namaste|hola|howdy|yo|sup|what'?s up)\b/i;
const helpIntentPattern =
  /^(?:help|\?)$|\b(what can you do|what else can you do|can you do more|capabilities|features|how can you help|what do you do)\b/i;
const reminderIntentPattern =
  /\b(remind me|set reminder|set up (?:a )?reminder|setup (?:a )?reminder|alert me|notify me|don'?t let me forget)\b/i;
const emailDraftIntentPattern =
  /\b(draft|reply|respond|write|compose|create|send)\b[\s\S]{0,40}\b(email|mail|message|response|follow.?up)\b/i;
const emailSearchIntentPattern =
  /\b(search|find|check|show|get|look\s+up)\b[\s\S]{0,40}\b(email|emails|inbox|mail|messages?)\b/i;
const emailSearchFollowPattern =
  /\b(email from|what did .+ (say|write|send|email)|did .+ (reply|respond|email|send))\b/i;
const calendarIntentPattern =
  /\b(calendar|schedule|agenda|meeting|meetings|appointment|appointments|event|events)\b/i;
const calendarQuestionPattern =
  /\bwhat('s|\s+is)\s+(on\s+)?(my\s+)?(calendar|schedule|agenda|plate)\b/i;
const spendingIntentPattern =
  /\b(spend|spent|spending|budget|expense|expenses|transaction|transactions|receipt|receipts|invoice|invoices|merchant|payment|payments|cost me|how much)\b/i;
const codingIntentPattern =
  /\b(code|coding|debug|bug|exception|error|stack trace|traceback|syntax error|typescript|javascript|python|java|react|next\.js|node|sql|api|function|component|endpoint|schema|query|algorithm)\b/i;
const mathIntentPattern =
  /\b(calculate|solve|equation|formula|derivative|integral|probability|statistics|percentage|percent|mean|median)\b/i;
const creativeIntentPattern =
  /\b(story|poem|poetry|script|caption|tagline|slogan|joke|lyrics|creative|fiction)\b/i;
const researchIntentPattern =
  /\b(explain|analyze|compare|summarize|summary|difference|pros and cons|overview|tell me about|research|describe|history of|meaning of|advantages|disadvantages)\b/i;

function ensureAgentReply(message: string | null | undefined) {
  const trimmed = message?.trim();
  return trimmed ? trimmed : conversationalFallbackMessage;
}

function normalizeAgentReply(message: string) {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

function stripReminderLeadIn(message: string) {
  return message
    .replace(/^(?:please\s+)?remind me\b/i, "")
    .replace(/^(?:please\s+)?set(?:\s+up)?\s+(?:a\s+)?reminder\b/i, "")
    .replace(/^(?:please\s+)?alert me\b/i, "")
    .replace(/^(?:please\s+)?notify me\b/i, "")
    .trim();
}

function clipConversationMessage(message: string, maxLength = 500) {
  const trimmed = message.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength).trimEnd()}...`;
}

async function getRecentWhatsAppConversation(
  userId: string,
  limit = 10,
): Promise<ConversationHistoryMessage[]> {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("whatsapp_messages")
    .select("direction, content, sent_at")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(limit);

  if (error || !data?.length) {
    return [];
  }

  return (data as Array<{ direction: string; content: string | null }>)
    .slice()
    .reverse()
    .map((row) => ({
      role: (row.direction === "inbound" ? "user" : "assistant") as
        | "user"
        | "assistant",
      content: clipConversationMessage(String(row.content ?? "")),
    }))
    .filter((row) => row.content.length > 0);
}

function removeDuplicateCurrentUserMessage(
  history: ConversationHistoryMessage[],
  message: string,
) {
  const nextHistory = history.slice();
  const lastMessage = nextHistory[nextHistory.length - 1];

  if (
    lastMessage?.role === "user" &&
    normalizeAgentReply(lastMessage.content) === normalizeAgentReply(message)
  ) {
    nextHistory.pop();
  }

  return nextHistory;
}

function resolveRepeatedAgentReply(
  reply: string,
  history: ConversationHistoryMessage[],
) {
  const safeReply = ensureAgentReply(reply);
  const lastAssistantReply = [...history]
    .reverse()
    .find((message) => message.role === "assistant")
    ?.content?.trim();

  if (!lastAssistantReply) {
    return safeReply;
  }

  if (normalizeAgentReply(lastAssistantReply) !== normalizeAgentReply(safeReply)) {
    return safeReply;
  }

  if (normalizeAgentReply(safeReply) === normalizeAgentReply(conversationalFallbackMessage)) {
    return repeatedReplyRecoveryMessage;
  }

  return `${safeReply}\n\nTell me the next specific thing you want me to do.`;
}

function buildConversationalSystemPrompt(
  intent: IntentType,
  extraSystemPrompt?: string,
) {
  return [
    conversationalSystemPrompt,
    specialistSystemPrompts[intent] ?? specialistSystemPrompts.general,
    extraSystemPrompt,
  ]
    .filter(Boolean)
    .join(" ");
}

function detectAgentIntent(message: string): DetectedAgentIntent {
  const trimmed = message.trim();
  const normalized = trimmed.toLowerCase();

  if (helpIntentPattern.test(trimmed)) {
    return { kind: "help", aiIntent: "general" };
  }

  if (emailDraftIntentPattern.test(trimmed)) {
    return { kind: "draft_email", aiIntent: "email" };
  }

  if (
    emailSearchIntentPattern.test(trimmed) ||
    emailSearchFollowPattern.test(trimmed)
  ) {
    return { kind: "email_search", aiIntent: "email" };
  }

  if (reminderIntentPattern.test(trimmed)) {
    return { kind: "reminder", aiIntent: "reminder" };
  }

  if (spendingIntentPattern.test(trimmed)) {
    return { kind: "spending", aiIntent: "spending" };
  }

  if (
    calendarIntentPattern.test(trimmed) ||
    calendarQuestionPattern.test(trimmed)
  ) {
    return { kind: "calendar", aiIntent: "calendar" };
  }

  if (greetingPattern.test(trimmed) && trimmed.split(/\s+/).length <= 6) {
    return { kind: "greeting", aiIntent: "greeting" };
  }

  if (
    codingIntentPattern.test(trimmed) ||
    /\b(write|build|create|implement|fix|refactor|optimize)\b[\s\S]{0,24}\b(function|script|component|endpoint|query|api|app|bot|tool)\b/i.test(
      trimmed,
    )
  ) {
    return { kind: "coding", aiIntent: "coding" };
  }

  if (
    mathIntentPattern.test(trimmed) ||
    /\d+\s*[\+\-\*\/\^%]\s*\d+/.test(trimmed) ||
    /\bwhat is\s+\d+/i.test(trimmed)
  ) {
    return { kind: "math", aiIntent: "math" };
  }

  if (creativeIntentPattern.test(trimmed)) {
    return { kind: "creative", aiIntent: "creative" };
  }

  if (researchIntentPattern.test(trimmed) || normalized.length > 120) {
    return { kind: "research", aiIntent: "research" };
  }

  return { kind: "general", aiIntent: "general" };
}

async function createFastAcknowledgement(
  locale: SupportedLocale,
  instruction: string,
) {
  const reply = await completeClawCloudFast({
    system: [
      conversationalSystemPrompt,
      "Write a short acknowledgement in one or two sentences.",
      "Be specific about the action that is already being triggered.",
      "Sound polished and confident.",
      "Do not mention internal systems or hidden implementation details.",
    ].join(" "),
    user: instruction,
    maxTokens: 100,
    fallback: "On it. Give me a moment.",
  });

  return translateMessage(ensureAgentReply(reply), locale);
}

async function createMissingAiProviderResponse(
  locale: SupportedLocale,
  intent: DetectedAgentIntent,
) {
  const intentHint =
    intent.kind === "coding"
      ? "After that, send the exact code, error, or task you want help with."
      : intent.kind === "math"
        ? "After that, send the exact problem and I will work it through in the strong formatted style."
        : intent.kind === "creative"
          ? "After that, send the exact tone, format, and prompt you want."
          : "After that, send your message again and the agent will answer in the upgraded professional format.";

  return translateMessage(
    [
      "Chat AI is not configured in the runtime that is currently answering this message.",
      "",
      "Add NVIDIA_API_KEY or OPENAI_API_KEY, then restart the Next.js app and the WhatsApp agent.",
      "If you are testing through the deployed WhatsApp connection, redeploy or restart the live app and Railway agent too.",
      "",
      intentHint,
    ].join("\n"),
    locale,
  );
}

async function generateConversationalReply(
  userId: string,
  userMessage: string,
  options?: {
    locale?: SupportedLocale;
    maxTokens?: number;
    intent?: IntentType;
    extraSystemPrompt?: string;
    fallback?: string;
  },
) {
  const locale = options?.locale ?? (await getUserLocale(userId));
  const history = removeDuplicateCurrentUserMessage(
    await getRecentWhatsAppConversation(userId),
    userMessage,
  );
  const intent = options?.intent ?? "general";
  const systemPrompt = buildConversationalSystemPrompt(
    intent,
    options?.extraSystemPrompt,
  );

  const reply = await completeClawCloudPrompt({
    system: systemPrompt,
    history,
    user: userMessage,
    maxTokens: options?.maxTokens ?? 350,
    intent,
    fallback: options?.fallback ?? conversationalFallbackMessage,
    skipCache: history.length > 0,
  });

  const finalReply = resolveRepeatedAgentReply(reply, history);
  return ensureAgentReply(await translateMessage(finalReply, locale));
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
  const relativeMatch = trimmed.match(/\bin\s+(\d{1,3})\s+(minute|minutes|hour|hours)\b/i);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1] ?? "0");
    const unit = (relativeMatch[2] ?? "").toLowerCase();

    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    const fireAt = new Date();
    fireAt.setSeconds(0, 0);
    fireAt.setTime(
      fireAt.getTime() + amount * (unit.startsWith("hour") ? 60 * 60 * 1000 : 60 * 1000),
    );

    const reminderText = stripReminderLeadIn(trimmed)
      .replace(relativeMatch[0], "")
      .replace(/^\s*to\b/i, "")
      .trim();

    return {
      fireAt: fireAt.toISOString(),
      reminderText: reminderText || "Reminder",
    };
  }

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

  const reminderText = stripReminderLeadIn(trimmed)
    .replace(atMatch[0], "")
    .replace(/^\s*to\b/i, "")
    .trim();

  return {
    fireAt: fireAt.toISOString(),
    reminderText: reminderText || "Reminder",
  };
}

function getCurrentTimeInTz(timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());

    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
    return `${hour === "24" ? "00" : hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  } catch {
    const now = new Date();
    return `${now.getUTCHours().toString().padStart(2, "0")}:${now
      .getUTCMinutes()
      .toString()
      .padStart(2, "0")}`;
  }
}

function getCurrentDayInTz(timeZone: string) {
  const fallbackDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    })
      .format(new Date())
      .toLowerCase()
      .slice(0, 3);

    return fallbackDays.includes(weekday as (typeof fallbackDays)[number])
      ? weekday
      : fallbackDays[new Date().getUTCDay()] ?? "sun";
  } catch {
    return fallbackDays[new Date().getUTCDay()] ?? "sun";
  }
}

function getTaskTimezone(
  relation:
    | { timezone?: string | null }
    | Array<{ timezone?: string | null }>
    | null
    | undefined,
) {
  if (Array.isArray(relation)) {
    return relation[0]?.timezone ?? "Asia/Kolkata";
  }

  return relation?.timezone ?? "Asia/Kolkata";
}

function minuteBucket(date: Date) {
  const bucket = new Date(date);
  bucket.setSeconds(0, 0);
  return bucket.toISOString();
}

async function claimCronSlot(
  supabaseAdmin: SupabaseAdminClient,
  taskId: string,
  userId: string,
  bucket: string,
) {
  const { error } = await supabaseAdmin.from("cron_log").insert({
    task_id: taskId,
    user_id: userId,
    minute_bucket: bucket,
  });

  if (!error) {
    return true;
  }

  if (error.code === "23505") {
    return false;
  }

  console.warn("[cron] cron_log insert error:", error.message);
  return true;
}

async function isMeetingAlreadyReminded(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  eventId: string,
) {
  const { data } = await supabaseAdmin
    .from("meeting_reminder_log")
    .select("id")
    .eq("user_id", userId)
    .eq("event_id", eventId)
    .maybeSingle();

  return data !== null;
}

async function markMeetingReminded(
  supabaseAdmin: SupabaseAdminClient,
  userId: string,
  eventId: string,
) {
  await supabaseAdmin.from("meeting_reminder_log").upsert(
    {
      user_id: userId,
      event_id: eventId,
    },
    { onConflict: "user_id,event_id" },
  );
}

async function updateCronHealth(
  supabaseAdmin: SupabaseAdminClient,
  fired: number,
  errors: number,
) {
  await supabaseAdmin
    .from("cron_health")
    .update({
      last_run_at: new Date().toISOString(),
      last_fired: fired,
      last_errors: errors,
    })
    .eq("id", 1);

  await supabaseAdmin.rpc("increment_cron_health_total_runs" as never).maybeSingle().catch(() => {
    // Ignore if the RPC is not installed yet.
  });
}

async function insertCronTaskRun(
  supabaseAdmin: SupabaseAdminClient,
  input: {
    userId: string;
    taskId: string;
    taskType: ClawCloudTaskType;
    status: "success" | "failed";
    startedAt: string;
    completedAt: string;
    durationMs: number;
    outputData?: Record<string, unknown>;
    errorMessage?: string;
  },
) {
  await supabaseAdmin.from("task_runs").insert({
    user_id: input.userId,
    task_id: input.taskId,
    task_type: input.taskType,
    status: input.status,
    output_data: input.outputData,
    error_message: input.errorMessage,
    duration_ms: input.durationMs,
    started_at: input.startedAt,
    completed_at: input.completedAt,
  });
}

async function bumpCronTaskTotals(
  supabaseAdmin: SupabaseAdminClient,
  taskId: string,
  totalRuns: number | null | undefined,
  increment = 1,
) {
  await supabaseAdmin
    .from("agent_tasks")
    .update({
      total_runs: (totalRuns ?? 0) + increment,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", taskId);
}

async function runMorningBriefing(
  userId: string,
  config: ClawCloudTaskConfig,
) {
  const [emails, events, locale] = await Promise.all([
    getClawCloudGmailMessages(userId, {
      query: "is:unread",
      maxResults: Number(config.max_emails ?? 50),
    }),
    getClawCloudCalendarEvents(userId, {
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }),
    getUserLocale(userId),
  ]);

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
    system: buildMultilingualBriefingSystem(locale),
    user: `Create a concise morning briefing.\n\nUnread emails: ${emails.length}\n${emailContext}\n\nToday's events:\n${eventContext || "No events today"}\n\nKeep it under 300 words and mention which emails need replies.`,
    maxTokens: 500,
    intent: "research",
    fallback: `Good morning. You have ${emails.length} unread emails and ${events.length} event${events.length === 1 ? "" : "s"} today.`,
    skipCache: true,
  });

  await sendClawCloudWhatsAppMessage(userId, message);
  try {
    await sendClawCloudTelegramMessage(userId, message);
  } catch {
    // Telegram is optional, so skip delivery errors silently.
  }
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
      intent: "email",
      fallback: `Hi,\n\nThanks for your email. I have reviewed this and will get back to you shortly.\n\nBest regards,`,
      skipCache: true,
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

function resolveCalendarAgendaWindow(userMessage: string | null | undefined) {
  const now = new Date();
  const normalized = (userMessage ?? "").toLowerCase();

  if (/\btomorrow\b/.test(normalized)) {
    const start = new Date(now);
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { label: "tomorrow", start, end };
  }

  if (/\b(this week|next week|next 7 days)\b/.test(normalized)) {
    const start = new Date(now);
    const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return { label: "the next 7 days", start, end };
  }

  const start = new Date(now);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (end.getTime() <= start.getTime()) {
    end.setTime(start.getTime() + 24 * 60 * 60 * 1000);
  }

  return { label: "today", start, end };
}

async function runCalendarAgenda(
  userId: string,
  userMessage: string | null | undefined,
) {
  const locale = await getUserLocale(userId);
  const { label, start, end } = resolveCalendarAgendaWindow(userMessage);
  const events = await getClawCloudCalendarEvents(userId, {
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
  });

  if (events.length === 0) {
    const message = await translateMessage(
      `Your calendar is clear for ${label}.`,
      locale,
    );
    await sendClawCloudWhatsAppMessage(userId, message);
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { eventCount: 0, message };
  }

  const fallback = [
    `Calendar for ${label}`,
    "",
    ...events.map((event) => {
      const startText = new Date(event.start).toLocaleString("en-IN", {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
      const locationOrLink = event.hangoutLink || event.location;
      return locationOrLink
        ? `- ${startText}: ${event.summary} (${locationOrLink})`
        : `- ${startText}: ${event.summary}`;
    }),
  ].join("\n");

  const message = await completeClawCloudPrompt({
    system: [
      buildMultilingualBriefingSystem(locale),
      "Summarize the calendar agenda for chat.",
      "Lead with schedule status, then list times, titles, and any meeting links or locations.",
      "Keep it concise and actionable.",
    ].join(" "),
    user: [
      `Create a concise calendar agenda for ${label}.`,
      "",
      ...events.map((event) =>
        [
          `Title: ${event.summary}`,
          `Starts: ${event.start}`,
          `Ends: ${event.end}`,
          `Location: ${event.location || "None"}`,
          `Link: ${event.hangoutLink || "None"}`,
          `Description: ${event.description || "None"}`,
        ].join("\n"),
      ),
    ].join("\n\n"),
    intent: "calendar",
    maxTokens: 450,
    fallback,
    skipCache: true,
  });

  await sendClawCloudWhatsAppMessage(userId, message);
  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });

  return { eventCount: events.length, message };
}

async function runEmailSearch(
  userId: string,
  userMessage: string | null | undefined,
) {
  const locale = await getUserLocale(userId);

  if (!userMessage?.trim()) {
    const message = await translateMessage(
      "Tell me what you want me to search for in Gmail.",
      locale,
    );
    await sendClawCloudWhatsAppMessage(userId, message);
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { found: 0, answer: message };
  }

  const gmailQuery = await completeClawCloudPrompt({
    system:
      "Convert the request into a concise Gmail search query. Return only the query string with no explanation.",
    user: userMessage,
    maxTokens: 60,
    intent: "email",
    fallback: userMessage,
    skipCache: true,
  });

  const emails = await getClawCloudGmailMessages(userId, {
    query: gmailQuery,
    maxResults: 6,
  });

  if (emails.length === 0) {
    const message = await translateMessage(
      `No emails found for: ${userMessage}`,
      locale,
    );
    await sendClawCloudWhatsAppMessage(userId, message);
    await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });
    return { found: 0, answer: message };
  }

  const answer = await completeClawCloudPrompt({
    system: [
      buildMultilingualBriefingSystem(locale),
      "Answer strictly from the provided email snippets.",
      "Mention uncertainty when the snippets are incomplete.",
      "Keep the response concise and scannable.",
    ].join(" "),
    user: `Question: ${userMessage}\n\nEmail snippets:\n${emails
      .map(
        (email) =>
          `From: ${email.from}\nSubject: ${email.subject}\nSnippet: ${email.snippet}`,
      )
      .join("\n\n")}`,
    maxTokens: 320,
    intent: "email",
    fallback: emails[0]?.snippet || "Relevant emails found.",
    skipCache: true,
  });

  const summaryMessage = [
    `Search results for: ${userMessage}`,
    "",
    answer,
    "",
    `Found ${emails.length} relevant email(s).`,
  ].join("\n");

  await sendClawCloudWhatsAppMessage(
    userId,
    summaryMessage,
  );
  await upsertAnalyticsDaily(userId, {
    tasks_run: 1,
    wa_messages_sent: 1,
  });

  return { found: emails.length, answer: summaryMessage };
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
    intent: "research",
    fallback: `Today you received ${emails.length} emails, attended ${events.length} meetings, and ran ${taskRuns.data?.length ?? 0} AI task(s).`,
    skipCache: true,
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
  const locale = await getUserLocale(userId);
  const rawMessage = userMessage?.trim() ?? "";
  if (!rawMessage) {
    throw new Error("Custom reminder requires a message.");
  }

  const parsed = parseReminderMessage(rawMessage);
  if (!parsed) {
    const message = await translateMessage(
      [
        "I can set that reminder, but I need both the time and the task.",
        "",
        "Try messages like:",
        "• Remind me at 5pm to call Priya",
        "• Remind me in 30 minutes to send the invoice",
        "• Remind me tomorrow to review the report",
      ].join("\n"),
      locale,
    );
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

  const confirmation = await translateMessage(
    [
      "Reminder set.",
      "",
      `Task: ${parsed.reminderText}`,
      `When: ${new Date(parsed.fireAt).toLocaleString("en-IN")}`,
    ].join("\n"),
    locale,
  );
  await sendClawCloudWhatsAppMessage(userId, confirmation);
  await upsertAnalyticsDaily(userId, { tasks_run: 1, wa_messages_sent: 1 });

  return {
    set: true,
    fireAt: parsed.fireAt,
    reminderText: parsed.reminderText,
  };
}

export async function routeInboundAgentMessage(
  userId: string,
  message: string,
): Promise<string | null> {
  const trimmed = message.trim();
  if (!trimmed) {
    return null;
  }

  const approvalResult = await handleReplyApprovalCommand(userId, trimmed);
  if (approvalResult.handled) {
    return approvalResult.response;
  }

  const locale = await getUserLocale(userId);
  const intent = detectAgentIntent(trimmed);

  if (
    !hasClawCloudChatProvider() &&
    !["help", "spending", "draft_email", "email_search", "reminder", "calendar"].includes(
      intent.kind,
    )
  ) {
    return createMissingAiProviderResponse(locale, intent);
  }

  switch (intent.kind) {
    case "help":
      return translateMessage(capabilityHelpMessage, locale);

    case "spending":
      return answerSpendingQuestion(userId, trimmed);

    case "draft_email": {
      const response = await createFastAcknowledgement(
        locale,
        `The user asked for email help: "${trimmed}". Confirm that reply drafts are being prepared now.`,
      );
      void sendReplyApprovalRequests(
        userId,
        /all|every|each/i.test(trimmed) ? 3 : 1,
      ).catch(() => undefined);
      return response;
    }

    case "email_search": {
      const response = await createFastAcknowledgement(
        locale,
        `The user asked to search Gmail for: "${trimmed}". Confirm that the inbox search is running now.`,
      );
      void runClawCloudTask({
        userId,
        taskType: "email_search",
        userMessage: trimmed,
        bypassEnabledCheck: true,
      }).catch(() => undefined);
      return response;
    }

    case "reminder": {
      const response = await createFastAcknowledgement(
        locale,
        `The user asked for a reminder: "${trimmed}". Confirm that the reminder is being scheduled now.`,
      );
      void runClawCloudTask({
        userId,
        taskType: "custom_reminder",
        userMessage: trimmed,
        bypassEnabledCheck: true,
      }).catch(() => undefined);
      return response;
    }

    case "calendar": {
      const response = await createFastAcknowledgement(
        locale,
        `The user asked for calendar details: "${trimmed}". Confirm that the schedule is being checked now.`,
      );
      void runCalendarAgenda(userId, trimmed).catch(() => undefined);
      return response;
    }

    case "greeting":
      return generateConversationalReply(userId, trimmed, {
        locale,
        intent: "greeting",
        maxTokens: 180,
      });

    case "coding":
      return generateConversationalReply(userId, trimmed, {
        locale,
        intent: "coding",
        maxTokens: 950,
      });

    case "math":
      return generateConversationalReply(userId, trimmed, {
        locale,
        intent: "math",
        maxTokens: 500,
      });

    case "creative":
      return generateConversationalReply(userId, trimmed, {
        locale,
        intent: "creative",
        maxTokens: 700,
      });

    case "research":
      return generateConversationalReply(userId, trimmed, {
        locale,
        intent: "research",
        maxTokens: 750,
      });

    default:
      return generateConversationalReply(userId, trimmed, {
        locale,
        intent: intent.aiIntent,
        maxTokens: 450,
      });
  }
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
      case "weekly_spend":
        result = await runWeeklySpendSummary(input.userId);
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

export async function getClawCloudActivityData(input: {
  userId: string;
  limit?: number;
  days?: number;
}) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const nextLimit =
    typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : 100;
  const nextDays =
    typeof input.days === "number" && Number.isFinite(input.days) ? input.days : 30;
  const limit = Math.min(Math.max(nextLimit, 1), 500);
  const days = Math.min(Math.max(nextDays, 1), 365);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const statsFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const [runsResult, statsResult] = await Promise.all([
    supabaseAdmin
      .from("task_runs")
      .select(
        "id, task_type, status, duration_ms, tokens_used, started_at, completed_at, error_message, output_data",
      )
      .eq("user_id", input.userId)
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("analytics_daily")
      .select(
        "date, tasks_run, emails_processed, drafts_created, minutes_saved, wa_messages_sent",
      )
      .eq("user_id", input.userId)
      .gte("date", statsFrom)
      .order("date", { ascending: false })
      .limit(30),
  ]);

  if (runsResult.error) {
    throw new Error(runsResult.error.message);
  }

  if (statsResult.error) {
    throw new Error(statsResult.error.message);
  }

  return {
    runs: runsResult.data ?? [],
    stats: statsResult.data ?? [],
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
  const bucket = minuteBucket(now);
  const fired: Array<{ userId: string; taskType: ClawCloudTaskType }> = [];
  const errors: Array<{ userId: string; taskType: ClawCloudTaskType; error: string }> = [];

  const { data: scheduledTasks, error: scheduledError } = await supabaseAdmin
    .from("agent_tasks")
    .select(`
      id,
      user_id,
      task_type,
      schedule_time,
      schedule_days,
      is_enabled,
      users!inner (
        timezone
      )
    `)
    .eq("is_enabled", true)
    .not("schedule_time", "is", null);

  if (scheduledError) {
    throw new Error(scheduledError.message);
  }

  for (const task of (scheduledTasks ?? []) as Array<
    AgentTaskRow & {
      users?: { timezone?: string | null } | Array<{ timezone?: string | null }> | null;
    }
  >) {
    const timeZone = getTaskTimezone(task.users);
    const userLocalTime = getCurrentTimeInTz(timeZone);
    const userLocalDay = getCurrentDayInTz(timeZone);
    const storedTime = task.schedule_time?.slice(0, 5);
    const scheduledDays = task.schedule_days ?? ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    if (storedTime !== userLocalTime || !scheduledDays.includes(userLocalDay)) {
      continue;
    }

    const claimed = await claimCronSlot(supabaseAdmin, task.id, task.user_id, bucket);
    if (!claimed) {
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

  const { data: meetingTasks } = await supabaseAdmin
    .from("agent_tasks")
    .select("id, user_id, config, total_runs")
    .eq("task_type", "meeting_reminders")
    .eq("is_enabled", true);

  for (const meetingTask of (meetingTasks ?? []) as Array<{
    id: string;
    user_id: string;
    config: ClawCloudTaskConfig | null;
    total_runs: number | null;
  }>) {
    const minutesBefore = Number(meetingTask.config?.minutes_before ?? 30);
    const windowStart = new Date(now.getTime() + minutesBefore * 60 * 1000);
    const windowEnd = new Date(windowStart.getTime() + 2 * 60 * 1000);
    let remindersSent = 0;

    try {
      const events = await getClawCloudCalendarEvents(meetingTask.user_id, {
        timeMin: windowStart.toISOString(),
        timeMax: windowEnd.toISOString(),
      });

      for (const event of events) {
        if (!event.id) {
          continue;
        }

        const alreadySent = await isMeetingAlreadyReminded(
          supabaseAdmin,
          meetingTask.user_id,
          event.id,
        );
        if (alreadySent) {
          continue;
        }

        const startedAt = new Date();
        const message = `Meeting in ${minutesBefore} minutes\n\n${event.summary}\n${event.start}${
          event.hangoutLink ? `\n${event.hangoutLink}` : ""
        }`;

        await sendClawCloudWhatsAppMessage(meetingTask.user_id, message);
        await markMeetingReminded(supabaseAdmin, meetingTask.user_id, event.id);
        await insertCronTaskRun(supabaseAdmin, {
          userId: meetingTask.user_id,
          taskId: meetingTask.id,
          taskType: "meeting_reminders",
          status: "success",
          startedAt: startedAt.toISOString(),
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt.getTime(),
          outputData: {
            event_id: event.id,
            summary: event.summary,
            start: event.start,
          },
        });

        remindersSent += 1;
        fired.push({ userId: meetingTask.user_id, taskType: "meeting_reminders" });
      }

      if (remindersSent > 0) {
        await bumpCronTaskTotals(
          supabaseAdmin,
          meetingTask.id,
          meetingTask.total_runs,
          remindersSent,
        );
        await upsertAnalyticsDaily(meetingTask.user_id, {
          tasks_run: remindersSent,
          wa_messages_sent: remindersSent,
        });
      }
    } catch (error) {
      if (error instanceof Error && /token|credentials|not connected/i.test(error.message)) {
        continue;
      }

      errors.push({
        userId: meetingTask.user_id,
        taskType: "meeting_reminders",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const { data: reminderTasks } = await supabaseAdmin
    .from("agent_tasks")
    .select("id, user_id, config, total_runs")
    .eq("task_type", "custom_reminder")
    .eq("is_enabled", true);

  for (const reminder of (reminderTasks ?? []) as Array<{
    id: string;
    user_id: string;
    config: ClawCloudTaskConfig | null;
    total_runs: number | null;
  }>) {
    const fireAt =
      typeof reminder.config?.fire_at === "string" ? reminder.config.fire_at : null;
    if (!fireAt) {
      continue;
    }

    const fireTime = new Date(fireAt).getTime();
    const diff = now.getTime() - fireTime;
    if (diff < 0 || diff > 60 * 1000) {
      continue;
    }

    const claimed = await claimCronSlot(supabaseAdmin, reminder.id, reminder.user_id, bucket);
    if (!claimed) {
      continue;
    }

    try {
      const startedAt = new Date();
      const reminderText =
        typeof reminder.config?.reminder_text === "string"
          ? reminder.config.reminder_text
          : "Reminder";
      await sendClawCloudWhatsAppMessage(reminder.user_id, `Reminder\n\n${reminderText}`);
      await supabaseAdmin
        .from("agent_tasks")
        .update({
          is_enabled: false,
          total_runs: (reminder.total_runs ?? 0) + 1,
          last_run_at: new Date().toISOString(),
        })
        .eq("id", reminder.id);
      await insertCronTaskRun(supabaseAdmin, {
        userId: reminder.user_id,
        taskId: reminder.id,
        taskType: "custom_reminder",
        status: "success",
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        outputData: {
          reminder_text: reminderText,
          fire_at: fireAt,
        },
      });
      await upsertAnalyticsDaily(reminder.user_id, {
        tasks_run: 1,
        wa_messages_sent: 1,
      });
      fired.push({ userId: reminder.user_id, taskType: "custom_reminder" });
    } catch (error) {
      await insertCronTaskRun(supabaseAdmin, {
        userId: reminder.user_id,
        taskId: reminder.id,
        taskType: "custom_reminder",
        status: "failed",
        startedAt: now.toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      }).catch(() => {
        // Ignore secondary logging failures.
      });

      errors.push({
        userId: reminder.user_id,
        taskType: "custom_reminder",
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (now.getMinutes() === 0) {
    supabaseAdmin.rpc("cleanup_cron_logs" as never).then(() => {}).catch(() => {});
  }

  await updateCronHealth(supabaseAdmin, fired.length, errors.length).catch(() => {});

  return {
    timestamp: now.toISOString(),
    fired,
    errors,
  };
}
