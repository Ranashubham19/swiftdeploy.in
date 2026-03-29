import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { formatDateKey } from "@/lib/clawcloud-types";

const CLAWCLOUD_RUN_RESET_OFFSET = "+05:30";
const LEGACY_USAGE_TASK_TYPE = "custom_reminder";

export function buildClawCloudRunWindow(now = new Date()) {
  const dateKey = formatDateKey(now, "Asia/Kolkata");
  const startDate = new Date(`${dateKey}T00:00:00${CLAWCLOUD_RUN_RESET_OFFSET}`);
  const endDate = new Date(startDate.getTime() + 86_400_000);

  return {
    dateKey,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
  };
}

export function resolveClawCloudTodayRunCount(input: {
  taskRunsCount?: number | null;
  analyticsDailyTasksRun?: number | null;
}) {
  if (
    typeof input.analyticsDailyTasksRun === "number"
    && Number.isFinite(input.analyticsDailyTasksRun)
  ) {
    return Math.max(0, Math.trunc(input.analyticsDailyTasksRun));
  }

  if (typeof input.taskRunsCount === "number" && Number.isFinite(input.taskRunsCount)) {
    return Math.max(0, Math.trunc(input.taskRunsCount));
  }

  return 0;
}

export async function getClawCloudTodayRunCount(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const window = buildClawCloudRunWindow();
  const analyticsDailyResult = await supabaseAdmin
    .from("analytics_daily")
    .select("tasks_run")
    .eq("user_id", userId)
    .eq("date", window.dateKey)
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (typeof analyticsDailyResult.data?.tasks_run === "number") {
    return resolveClawCloudTodayRunCount({
      analyticsDailyTasksRun: analyticsDailyResult.data.tasks_run,
    });
  }

  const cappedLimit = Number(process.env.CLAWCLOUD_RUN_COUNT_CAP ?? "");
  const useCappedLookup = Number.isFinite(cappedLimit) && cappedLimit > 0;

  if (useCappedLookup) {
    const cappedResult = await supabaseAdmin
      .from("task_runs")
      .select("id")
      .eq("user_id", userId)
      .neq("task_type", "chat_message")
      .gte("started_at", window.startIso)
      .lt("started_at", window.endIso)
      .order("started_at", { ascending: false })
      .limit(Math.trunc(cappedLimit) + 1)
      .catch(() => ({ data: null, error: new Error("capped lookup failed") }));

    if (!cappedResult.error && Array.isArray(cappedResult.data)) {
      return resolveClawCloudTodayRunCount({
        taskRunsCount: cappedResult.data.length,
      });
    }
  }

  const taskRunsResult = await supabaseAdmin
    .from("task_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .neq("task_type", "chat_message")
    .gte("started_at", window.startIso)
    .lt("started_at", window.endIso);

  if (!taskRunsResult.error) {
    return resolveClawCloudTodayRunCount({
      taskRunsCount: taskRunsResult.count ?? 0,
    });
  }

  return resolveClawCloudTodayRunCount({
    analyticsDailyTasksRun: Number(analyticsDailyResult.data?.tasks_run ?? 0),
  });
}

export async function getClawCloudTodayRunCountUpToLimit(userId: string, limit: number) {
  const normalizedLimit = Math.max(1, Math.trunc(limit));
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const window = buildClawCloudRunWindow();

  const analyticsDailyResult = await supabaseAdmin
    .from("analytics_daily")
    .select("tasks_run")
    .eq("user_id", userId)
    .eq("date", window.dateKey)
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (typeof analyticsDailyResult.data?.tasks_run === "number") {
    return resolveClawCloudTodayRunCount({
      analyticsDailyTasksRun: analyticsDailyResult.data.tasks_run,
    });
  }

  const taskRunsResult = await supabaseAdmin
    .from("task_runs")
    .select("id")
    .eq("user_id", userId)
    .neq("task_type", "chat_message")
    .gte("started_at", window.startIso)
    .lt("started_at", window.endIso)
    .order("started_at", { ascending: false })
    .limit(normalizedLimit + 1)
    .catch(() => ({ data: null, error: new Error("task_runs lookup failed") }));

  if (!taskRunsResult.error && Array.isArray(taskRunsResult.data)) {
    return taskRunsResult.data.length;
  }

  return resolveClawCloudTodayRunCount({
    analyticsDailyTasksRun: Number(analyticsDailyResult.data?.tasks_run ?? 0),
  });
}

export async function ensureClawCloudLegacyUsageTaskId(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const existingTask = await supabaseAdmin
    .from("agent_tasks")
    .select("id")
    .eq("user_id", userId)
    .eq("task_type", LEGACY_USAGE_TASK_TYPE)
    .maybeSingle()
    .catch(() => ({ data: null }));

  if (existingTask.data?.id) {
    return String(existingTask.data.id);
  }

  const createdTask = await supabaseAdmin
    .from("agent_tasks")
    .insert({
      user_id: userId,
      task_type: LEGACY_USAGE_TASK_TYPE,
      is_enabled: false,
      config: {},
    })
    .select("id")
    .single()
    .catch(() => ({ data: null }));

  return createdTask.data?.id ? String(createdTask.data.id) : null;
}

export async function recordClawCloudChatRun(input: {
  userId: string;
  status?: "success" | "failed";
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  durationMs?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
}) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const startedAt = input.startedAt ?? new Date().toISOString();
  const completedAt = input.completedAt ?? startedAt;
  const durationMs = Math.max(0, Math.round(Number(input.durationMs ?? 0)));
  const payload = {
    user_id: input.userId,
    task_id: null,
    task_type: "chat_message",
    status: input.status ?? "success",
    input_data: input.inputData ?? {},
    output_data: input.outputData ?? {},
    duration_ms: durationMs,
    started_at: startedAt,
    completed_at: completedAt,
  };

  const directInsert = await supabaseAdmin
    .from("task_runs")
    .insert(payload)
    .catch(() => null);

  if (!directInsert?.error) {
    return;
  }

  const legacyTaskId = await ensureClawCloudLegacyUsageTaskId(input.userId);
  if (!legacyTaskId) {
    return;
  }

  await supabaseAdmin
    .from("task_runs")
    .insert({
      ...payload,
      task_id: legacyTaskId,
    })
    .catch(() => null);
}
