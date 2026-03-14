import { runClawCloudTask } from "@/lib/clawcloud-agent";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  clawCloudActiveTaskLimits,
  clawCloudDefaultTaskSeeds,
  clawCloudRunLimits,
  formatDateKey,
  normalizeClawCloudTaskType,
  presentClawCloudTaskType,
  type ClawCloudPlan,
  type ClawCloudTaskConfig,
  type ClawCloudTaskType,
} from "@/lib/clawcloud-types";

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

type SupabaseAdminClient = ReturnType<typeof getClawCloudSupabaseAdmin>;

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

  // Keep cron resilient even if the dedupe table is unavailable.
  return true;
}

export async function completeClawCloudOnboarding(input: {
  userId: string;
  selectedTasks: ClawCloudTaskType[];
  taskConfigs: Partial<Record<ClawCloudTaskType, ClawCloudTaskConfig>>;
}) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const selectedTasks = Array.from(
    new Set(input.selectedTasks.map((taskType) => normalizeClawCloudTaskType(taskType))),
  );

  const normalizedTaskConfigs = Object.fromEntries(
    Object.entries(input.taskConfigs).map(([taskType, config]) => [
      normalizeClawCloudTaskType(taskType as ClawCloudTaskType),
      config ?? {},
    ]),
  ) as Partial<Record<ClawCloudTaskType, ClawCloudTaskConfig>>;

  const disableResult = await supabaseAdmin
    .from("agent_tasks")
    .update({ is_enabled: false })
    .eq("user_id", input.userId);
  if (disableResult.error) {
    throw new Error(disableResult.error.message);
  }

  if (selectedTasks.length > 0) {
    const rows = selectedTasks.map((taskType) => {
      const config = normalizedTaskConfigs[taskType] ?? {};

      return {
        user_id: input.userId,
        task_type: taskType,
        is_enabled: true,
        schedule_time:
          typeof config.schedule_time === "string" ? config.schedule_time : null,
        schedule_days: Array.isArray(config.schedule_days)
          ? (config.schedule_days.filter((value): value is string => typeof value === "string") ??
              null)
          : null,
        config: {
          ...clawCloudDefaultTaskSeeds[taskType],
          ...config,
        },
      };
    });

    const upsertResult = await supabaseAdmin
      .from("agent_tasks")
      .upsert(rows, { onConflict: "user_id,task_type" });

    if (upsertResult.error) {
      throw new Error(upsertResult.error.message);
    }
  }

  const userResult = await supabaseAdmin
    .from("users")
    .update({ onboarding_done: true })
    .eq("id", input.userId);
  if (userResult.error) {
    throw new Error(userResult.error.message);
  }

  return {
    success: true,
    tasksEnabled: selectedTasks.length,
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
  const dashboardTasks = ((agentTasks.data ?? []) as AgentTaskRow[]).map((task) => ({
    ...task,
    task_type: presentClawCloudTaskType(task.task_type),
  }));
  const recentActivity = ((recentRuns.data ?? []) as Array<Record<string, unknown>>).map((run) => ({
    ...run,
    task_type: presentClawCloudTaskType(run.task_type as ClawCloudTaskType),
  }));

  return {
    user: userProfile.data,
    connected_accounts: connectedAccounts.data ?? [],
    tasks: dashboardTasks,
    recent_activity: recentActivity,
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
    runs: (runsResult.data ?? []).map((run) => ({
      ...run,
      task_type: presentClawCloudTaskType(run.task_type as ClawCloudTaskType),
    })),
    stats: statsResult.data ?? [],
  };
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

  return {
    ...data,
    task_type: presentClawCloudTaskType(data.task_type as ClawCloudTaskType),
  };
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
    .select(
      `
        id,
        user_id,
        task_type,
        schedule_time,
        schedule_days,
        is_enabled,
        users!inner (
          timezone
        )
      `,
    )
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
    const scheduledDays =
      task.schedule_days ?? ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

    if (storedTime !== userLocalTime || !scheduledDays.includes(userLocalDay)) {
      continue;
    }

    const claimed = await claimCronSlot(supabaseAdmin, task.id, task.user_id, bucket);
    if (!claimed) {
      continue;
    }

    const normalizedTaskType = normalizeClawCloudTaskType(task.task_type);

    try {
      await runClawCloudTask({
        userId: task.user_id,
        taskType: normalizedTaskType,
        bypassEnabledCheck: true,
      });
      fired.push({
        userId: task.user_id,
        taskType: presentClawCloudTaskType(normalizedTaskType),
      });
    } catch (error) {
      errors.push({
        userId: task.user_id,
        taskType: presentClawCloudTaskType(normalizedTaskType),
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return {
    timestamp: now.toISOString(),
    fired,
    errors,
  };
}
