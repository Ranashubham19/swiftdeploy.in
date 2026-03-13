import type { ConversationThread, PersistenceState } from "@/lib/types";

import { env } from "@/lib/env";
import { buildSupabaseHeaders } from "@/lib/supabase-headers";

function missingPersistence(reason: string): PersistenceState {
  return {
    mode: "supabase",
    synced: false,
    reason,
  };
}

function supabaseEnabled() {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_THREADS_TABLE);
}

async function supabaseFetch(path: string, init?: RequestInit) {
  return fetch(`${env.SUPABASE_URL}${path}`, {
    cache: "no-store",
    ...init,
    headers: buildSupabaseHeaders(env.SUPABASE_ANON_KEY, init?.headers),
  });
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

export async function listConversationThreads(userId: string | null) {
  if (!supabaseEnabled()) {
    return {
      threads: [] as ConversationThread[],
      persistence: missingPersistence("Supabase is not configured."),
    };
  }

  const filters = new URLSearchParams();
  filters.set("select", "id,title,user_id,updated_at,messages,progress,sources,active_result");
  filters.set("order", "updated_at.desc");
  filters.set("limit", "25");

  if (userId) {
    filters.set("user_id", `eq.${userId}`);
  }

  const response = await supabaseFetch(`/rest/v1/${env.SUPABASE_THREADS_TABLE}?${filters.toString()}`);
  if (!response.ok) {
    return {
      threads: [] as ConversationThread[],
      persistence: missingPersistence(`Supabase threads query failed with ${response.status}.`),
    };
  }

  const rows = (await response.json()) as SupabaseThreadRow[];
  return {
    threads: rows.map(normalizeThread),
    persistence: {
      mode: "supabase",
      synced: true,
      updatedAt: new Date().toISOString(),
    } satisfies PersistenceState,
  };
}

export async function persistConversationThread(thread: ConversationThread) {
  if (!supabaseEnabled()) {
    return missingPersistence("Supabase is not configured.");
  }

  const response = await supabaseFetch(`/rest/v1/${env.SUPABASE_THREADS_TABLE}`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify([
      {
        id: thread.id,
        title: thread.title,
        user_id: thread.userId,
        updated_at: thread.updatedAt,
        messages: thread.messages,
        progress: thread.progress,
        sources: thread.sources,
        active_result: thread.activeResult,
      },
    ]),
  });

  if (!response.ok) {
    return missingPersistence(`Supabase thread sync failed with ${response.status}.`);
  }

  const rows = (await response.json().catch(() => [])) as SupabaseThreadRow[];
  return {
    mode: "supabase",
    synced: true,
    updatedAt: rows[0]?.updated_at ?? thread.updatedAt,
  } satisfies PersistenceState;
}
