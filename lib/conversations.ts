import type { ConversationThread, PersistenceState } from "@/lib/types";

import { getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import { env } from "@/lib/env";

const INTERNAL_THREAD_PREFIXES = [
  "global-lite:",
  "dashboard-journal:",
  "app-access-consent:",
] as const;

function missingPersistence(reason: string): PersistenceState {
  return {
    mode: "supabase",
    synced: false,
    reason,
  };
}

function supabaseEnabled() {
  return Boolean(env.SUPABASE_THREADS_TABLE && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_URL);
}

type SupabaseThreadRow = {
  id: string;
  title: string;
  user_id: string | null;
  updated_at: string;
  messages: ConversationThread["messages"];
  progress: ConversationThread["progress"];
  sources: ConversationThread["sources"];
  active_result: ConversationThread["activeResult"];
};

function normalizeThread(row: SupabaseThreadRow): ConversationThread {
  return {
    id: row.id,
    title: row.title,
    userId: row.user_id,
    updatedAt: row.updated_at,
    messages: row.messages ?? [],
    progress: row.progress ?? [],
    sources: row.sources ?? [],
    activeResult: row.active_result ?? null,
    persistence: {
      mode: "supabase",
      synced: true,
      updatedAt: row.updated_at,
    },
  };
}

function isInternalThreadId(threadId: string) {
  return INTERNAL_THREAD_PREFIXES.some((prefix) => threadId.startsWith(prefix));
}

export async function listConversationThreads(userId: string) {
  if (!supabaseEnabled()) {
    return {
      threads: [] as ConversationThread[],
      persistence: missingPersistence("Supabase is not configured."),
    };
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from(env.SUPABASE_THREADS_TABLE)
    .select("id,title,user_id,updated_at,messages,progress,sources,active_result")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    return {
      threads: [] as ConversationThread[],
      persistence: missingPersistence(`Supabase threads query failed: ${error.message}`),
    };
  }

  const rows = (data ?? []) as SupabaseThreadRow[];
  return {
    threads: rows.filter((row) => !isInternalThreadId(row.id)).map(normalizeThread),
    persistence: {
      mode: "supabase",
      synced: true,
      updatedAt: new Date().toISOString(),
    } satisfies PersistenceState,
  };
}

export async function persistConversationThread(userId: string, thread: ConversationThread) {
  if (!supabaseEnabled()) {
    return missingPersistence("Supabase is not configured.");
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data: existingRow, error: existingError } = await supabaseAdmin
    .from(env.SUPABASE_THREADS_TABLE)
    .select("user_id")
    .eq("id", thread.id)
    .maybeSingle();

  if (existingError) {
    return missingPersistence(`Supabase thread ownership check failed: ${existingError.message}`);
  }

  if (existingRow?.user_id && existingRow.user_id !== userId) {
    return missingPersistence("Thread ownership mismatch.");
  }

  const { data, error } = await supabaseAdmin
    .from(env.SUPABASE_THREADS_TABLE)
    .upsert(
      {
        id: thread.id,
        title: thread.title,
        user_id: userId,
        updated_at: thread.updatedAt,
        messages: thread.messages,
        progress: thread.progress,
        sources: thread.sources,
        active_result: thread.activeResult,
      },
      { onConflict: "id" },
    )
    .select("updated_at")
    .limit(1);

  if (error) {
    return missingPersistence(`Supabase thread sync failed: ${error.message}`);
  }

  const rows = (data ?? []) as Array<Pick<SupabaseThreadRow, "updated_at">>;
  return {
    mode: "supabase",
    synced: true,
    updatedAt: rows[0]?.updated_at ?? thread.updatedAt,
  } satisfies PersistenceState;
}
