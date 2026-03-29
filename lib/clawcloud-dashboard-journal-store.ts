import { env } from "@/lib/env";
import {
  dashboardJournalRecordToThread,
  dashboardJournalThreadToRecord,
  ensureDashboardJournalDay,
  mergeDashboardJournalCollections,
  normalizeDashboardJournalMessage,
  normalizeDashboardJournalThread,
  sortDashboardJournalThreads,
  type DashboardJournalThread,
} from "@/lib/clawcloud-dashboard-journal";
import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";

const MAX_DASHBOARD_JOURNAL_THREADS = 120;
const MAX_DASHBOARD_JOURNAL_MESSAGES_PER_THREAD = 500;
const MAX_DASHBOARD_JOURNAL_MESSAGE_LENGTH = 12000;
const LEGACY_DASHBOARD_JOURNAL_PREFIX = "dashboard-journal";

function getDashboardJournalTableName() {
  return env.SUPABASE_DASHBOARD_JOURNAL_TABLE || "dashboard_journal_threads";
}

function getLegacyDashboardJournalTableName() {
  return env.SUPABASE_THREADS_TABLE || "chat_threads";
}

function isMissingRelationError(message: string) {
  const normalized = message.trim().toLowerCase();
  return (
    normalized.includes("could not find the table")
    || (normalized.includes("relation") && normalized.includes("does not exist"))
    || (normalized.includes("table") && normalized.includes("does not exist"))
    || normalized.includes("schema cache")
  );
}

function buildLegacyDashboardJournalRowId(userId: string, threadId: string) {
  return `${LEGACY_DASHBOARD_JOURNAL_PREFIX}:${userId}:${threadId}`;
}

function parseLegacyDashboardJournalRowId(userId: string, rowId: string) {
  const prefix = `${LEGACY_DASHBOARD_JOURNAL_PREFIX}:${userId}:`;
  return rowId.startsWith(prefix) ? rowId.slice(prefix.length) : rowId;
}

function sanitizeDashboardJournalThread(thread: DashboardJournalThread) {
  const normalized = normalizeDashboardJournalThread(thread);

  return normalizeDashboardJournalThread({
    ...normalized,
    title: normalized.title.slice(0, 160),
    messages: normalized.messages
      .slice(-MAX_DASHBOARD_JOURNAL_MESSAGES_PER_THREAD)
      .map((message) =>
        normalizeDashboardJournalMessage({
          ...message,
          text: message.text.slice(0, MAX_DASHBOARD_JOURNAL_MESSAGE_LENGTH),
        }),
      ),
  });
}

export function validateDashboardJournalThreads(threads: unknown) {
  if (!Array.isArray(threads)) {
    throw new Error("threads must be an array");
  }

  if (threads.length > MAX_DASHBOARD_JOURNAL_THREADS) {
    throw new Error(`You can sync up to ${MAX_DASHBOARD_JOURNAL_THREADS} journal days at once.`);
  }

  return threads.map((thread) => sanitizeDashboardJournalThread(normalizeDashboardJournalThread(thread as Partial<DashboardJournalThread>)));
}

export async function listDashboardJournalThreads(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from(getDashboardJournalTableName())
    .select("thread_key, date_key, title, messages, updated_at, created_at")
    .eq("user_id", userId)
    .order("date_key", { ascending: false });

  if (error) {
    if (isMissingRelationError(error.message)) {
      return listLegacyDashboardJournalThreads(userId);
    }

    throw new Error(error.message);
  }

  return sortDashboardJournalThreads(
    (data ?? []).map((row: Record<string, unknown>) => dashboardJournalRecordToThread(row)),
  );
}

async function listLegacyDashboardJournalThreads(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from(getLegacyDashboardJournalTableName())
    .select("id, title, updated_at, messages")
    .eq("user_id", userId)
    .like("id", `${LEGACY_DASHBOARD_JOURNAL_PREFIX}:${userId}:%`)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return sortDashboardJournalThreads(
    (data ?? []).map((row: Record<string, unknown>) =>
      normalizeDashboardJournalThread({
        id: parseLegacyDashboardJournalRowId(userId, String(row.id ?? "")),
        dateKey: parseLegacyDashboardJournalRowId(userId, String(row.id ?? "")).replace(/^dashboard-day-/, ""),
        title: typeof row.title === "string" ? row.title : undefined,
        updatedAt: typeof row.updated_at === "string" ? row.updated_at : undefined,
        messages: Array.isArray(row.messages) ? row.messages : [],
      }),
    ),
  );
}

export async function upsertDashboardJournalThreads(
  userId: string,
  threads: DashboardJournalThread[],
) {
  const normalizedThreads = validateDashboardJournalThreads(threads);
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const table = getDashboardJournalTableName();
  const threadKeys = normalizedThreads.map((thread) => thread.id);

  const existingRowsResult = threadKeys.length
    ? await supabaseAdmin
        .from(table)
      .select("thread_key, date_key, title, messages, updated_at, created_at")
      .eq("user_id", userId)
      .in("thread_key", threadKeys)
    : { data: [], error: null };

  if (existingRowsResult.error) {
    if (isMissingRelationError(existingRowsResult.error.message)) {
      return upsertLegacyDashboardJournalThreads(userId, normalizedThreads);
    }

    throw new Error(existingRowsResult.error.message);
  }

  const existingThreads = (existingRowsResult.data ?? []).map((row: Record<string, unknown>) =>
    dashboardJournalRecordToThread(row),
  );
  const mergedThreads = mergeDashboardJournalCollections(existingThreads, normalizedThreads);

  const payload = mergedThreads.map((thread) => ({
    user_id: userId,
    ...dashboardJournalThreadToRecord(thread),
  }));

  if (payload.length > 0) {
    const { error } = await supabaseAdmin
      .from(table)
      .upsert(payload, { onConflict: "user_id,thread_key" });

    if (error) {
      throw new Error(error.message);
    }
  }

  const currentThreads = await listDashboardJournalThreads(userId);
  const ensured = ensureDashboardJournalDay(currentThreads);
  return ensured.threads;
}

async function upsertLegacyDashboardJournalThreads(
  userId: string,
  threads: DashboardJournalThread[],
) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const existingThreads = await listLegacyDashboardJournalThreads(userId);
  const mergedThreads = mergeDashboardJournalCollections(existingThreads, threads);
  const payload = mergedThreads.map((thread) => ({
    id: buildLegacyDashboardJournalRowId(userId, thread.id),
    user_id: userId,
    title: thread.title,
    updated_at: thread.updatedAt,
    messages: thread.messages,
    progress: [],
    sources: [],
    active_result: null,
  }));

  if (payload.length > 0) {
    const { error } = await supabaseAdmin.from(getLegacyDashboardJournalTableName()).upsert(payload);

    if (error) {
      throw new Error(error.message);
    }
  }

  const currentThreads = await listLegacyDashboardJournalThreads(userId);
  const ensured = ensureDashboardJournalDay(currentThreads);
  return ensured.threads;
}
