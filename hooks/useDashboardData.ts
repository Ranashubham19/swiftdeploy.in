"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";

import type { ClawCloudGoogleCapabilityStatus } from "@/lib/clawcloud-google";
import type { GlobalLiteConnection } from "@/lib/clawcloud-global-lite";
import type { ClawCloudWhatsAppRuntimeStatus } from "@/lib/clawcloud-whatsapp-runtime";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";
import type {
  WhatsAppHistoryEntry,
  WhatsAppInboxContact,
  WhatsAppInboxSummary,
  WhatsAppReplyApproval,
  WhatsAppSettings,
  WhatsAppWorkflow,
  WhatsAppWorkflowRun,
} from "@/lib/clawcloud-whatsapp-workspace-types";

export type DashboardAgentStatus = {
  is_active: boolean;
  active_task_count: number;
  today_runs: number;
  daily_limit: number;
  runs_remaining: number;
  active_task_limit: number;
};

export type DashboardAnalytics = {
  today: {
    emails_processed: number;
    drafts_created: number;
    tasks_run: number;
    minutes_saved: number;
    wa_messages_sent: number;
  };
  last_7_days: Array<{
    date: string;
    tasks_run: number;
    emails_processed: number;
  }>;
  answer_observability: {
    windowDays: number;
    totalResponses: number;
    answeredCount: number;
    refusalCount: number;
    consentPromptCount: number;
    failedCount: number;
    fallbackCount: number;
    fallbackRate: number;
    liveAnswerCount: number;
    liveGroundedCount: number;
    liveGroundedRate: number;
    modelAuditedCount: number;
    modelAuditedRate: number;
    disagreementCount: number;
    disagreementRate: number;
    avgLatencyMs: number;
    topIntents: Array<{
      intent: string;
      count: number;
      fallbackRate: number;
      avgLatencyMs: number;
    }>;
  };
};

export type DashboardTask = {
  id: string;
  task_type: string;
  is_enabled: boolean;
  schedule_time: string | null;
  schedule_days: string[] | null;
  config: Record<string, unknown> | null;
  total_runs: number;
  last_run_at: string | null;
};

export type DashboardConnectedAccount = {
  provider: string;
  account_email?: string | null;
  phone_number?: string | null;
  display_name?: string | null;
  is_active: boolean;
};

export type DashboardRuntimeFeatureState = {
  available: boolean;
  reason: string | null;
  providers?: string[];
};

export type DashboardFeatureStatus = {
  global_lite_connect: DashboardRuntimeFeatureState;
  google_workspace_connect: DashboardRuntimeFeatureState;
  google_workspace_extended_connect: DashboardRuntimeFeatureState;
  whatsapp_agent: DashboardRuntimeFeatureState;
  telegram_bot: DashboardRuntimeFeatureState;
  voice_transcription: DashboardRuntimeFeatureState;
  image_analysis: DashboardRuntimeFeatureState;
  image_generation: DashboardRuntimeFeatureState;
  cricket_live: DashboardRuntimeFeatureState;
  train_live: DashboardRuntimeFeatureState;
};

export type DashboardData = {
  user: {
    id: string;
    email: string;
    plan: string;
    full_name: string | null;
    timezone?: string | null;
    language?: string | null;
  } | null;
  connected_accounts: DashboardConnectedAccount[];
  global_lite_connections: GlobalLiteConnection[];
  tasks: DashboardTask[];
  recent_activity: Array<{
    id: string;
    task_type: string;
    status: string;
    started_at: string;
    duration_ms: number | null;
  }>;
  analytics: DashboardAnalytics;
  agent_status: DashboardAgentStatus;
  subscription: {
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
  } | null;
  feature_status: DashboardFeatureStatus;
  google_capabilities: ClawCloudGoogleCapabilityStatus;
  whatsapp_workspace: {
    settings: WhatsAppSettings;
    summary: WhatsAppInboxSummary;
    runtime: ClawCloudWhatsAppRuntimeStatus | null;
    approvals: WhatsAppReplyApproval[];
    contacts: WhatsAppInboxContact[];
    workflows: WhatsAppWorkflow[];
    workflow_runs: WhatsAppWorkflowRun[];
    history: WhatsAppHistoryEntry[];
  };
};

type UseDashboardDataReturn = {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

type DashboardCacheEntry = {
  savedAt: number;
  data: DashboardData;
};

type DashboardRuntimeResponse = {
  runtime: ClawCloudWhatsAppRuntimeStatus | null;
};

const DASHBOARD_CACHE_KEY = "clawcloud:dashboard-cache:v3";
const DASHBOARD_CACHE_TTL_MS = 10 * 60_000;
const DASHBOARD_FAST_FETCH_TIMEOUT_MS = 1_800;
const DASHBOARD_FETCH_TIMEOUT_MS = 4_500;
const DASHBOARD_BACKGROUND_FETCH_TIMEOUT_MS = 3_000;
const DASHBOARD_RUNTIME_FETCH_TIMEOUT_MS = 1_500;
const DASHBOARD_EMPTY_POLL_MS = 3_000;
const DASHBOARD_FULL_POLL_MS = 20_000;
const DASHBOARD_RUNTIME_SYNC_POLL_MS = 1_000;
const DASHBOARD_RUNTIME_CONNECTED_POLL_MS = 4_000;

function readDashboardCacheEntry(storage: Storage | null) {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(DASHBOARD_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<DashboardCacheEntry>;
    if (
      typeof parsed.savedAt !== "number"
      || !parsed.data
      || Date.now() - parsed.savedAt > DASHBOARD_CACHE_TTL_MS
    ) {
      storage.removeItem(DASHBOARD_CACHE_KEY);
      return null;
    }

    return parsed as DashboardCacheEntry;
  } catch {
    return null;
  }
}

function readDashboardCache() {
  if (typeof window === "undefined") {
    return null;
  }

  const candidates = [
    readDashboardCacheEntry(window.sessionStorage),
    readDashboardCacheEntry(window.localStorage),
  ].filter((entry): entry is DashboardCacheEntry => Boolean(entry));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.savedAt - left.savedAt);
  return candidates[0]?.data ?? null;
}

function writeDashboardCache(data: DashboardData) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: DashboardCacheEntry = {
    savedAt: Date.now(),
    data,
  };
  const serialized = JSON.stringify(payload);

  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.setItem(DASHBOARD_CACHE_KEY, serialized);
    } catch {
      // Best-effort cache only.
    }
  }
}

function clearDashboardCache() {
  if (typeof window === "undefined") {
    return;
  }

  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.removeItem(DASHBOARD_CACHE_KEY);
    } catch {
      // Ignore cache cleanup failures.
    }
  }
}

async function fetchDashboardSnapshot(input: {
  path: string;
  token: string;
  timeoutMs: number;
}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(input.path, {
      headers: { Authorization: `Bearer ${input.token}` },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || "Failed to load dashboard data.");
    }

    return (await response.json()) as DashboardData;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function mergeDashboardRuntime(
  current: DashboardData | null,
  runtime: ClawCloudWhatsAppRuntimeStatus | null,
) {
  if (!current || runtime === null) {
    return current;
  }

  const nextData: DashboardData = {
    ...current,
    whatsapp_workspace: {
      ...current.whatsapp_workspace,
      runtime,
      summary: runtime
        ? {
          ...current.whatsapp_workspace.summary,
          connected: current.whatsapp_workspace.summary.connected || runtime.connected,
          contactCount: Math.max(current.whatsapp_workspace.summary.contactCount, runtime.contactCount),
        }
        : current.whatsapp_workspace.summary,
    },
  };

  return nextData;
}

export function useDashboardData(config: PublicAppConfig): UseDashboardDataReturn {
  const supabase = getSupabaseBrowserClient({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  });

  const initialCacheRef = useRef<DashboardData | null>(null);
  const initialCacheLoadedRef = useRef(false);
  if (!initialCacheLoadedRef.current) {
    initialCacheRef.current = readDashboardCache();
    initialCacheLoadedRef.current = true;
  }

  const [data, setData] = useState<DashboardData | null>(() => initialCacheRef.current);
  const [loading, setLoading] = useState(() => !initialCacheRef.current);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const initialLoadRef = useRef(!initialCacheRef.current);
  const dataRef = useRef<DashboardData | null>(initialCacheRef.current);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const refetch = useCallback(() => {
    startTransition(() => {
      setTick((current) => current + 1);
    });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const authClient = supabase;
    let cancelled = false;

    async function load() {
      const currentData = dataRef.current;
      const showBlockingLoader = initialLoadRef.current && !currentData;
      if (showBlockingLoader) {
        setLoading(true);
      }

      try {
        const { data: sessionData } = await authClient.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          if (!cancelled) {
            clearDashboardCache();
            dataRef.current = null;
            setData(null);
            setLoading(false);
            setError(null);
            initialLoadRef.current = false;
          }
          return;
        }

        const commitDashboardData = (next: DashboardData) => {
          if (cancelled) {
            return;
          }

          dataRef.current = next;
          setData(next);
          writeDashboardCache(next);
          setError(null);
        };

        let hasBootstrapData = Boolean(currentData);

        if (!currentData) {
          try {
            const bootstrapData = await fetchDashboardSnapshot({
              path: "/api/dashboard?mode=fast",
              token,
              timeoutMs: DASHBOARD_FAST_FETCH_TIMEOUT_MS,
            });
            if (!cancelled) {
              commitDashboardData(bootstrapData);
              setLoading(false);
              initialLoadRef.current = false;
              hasBootstrapData = true;
            }
          } catch {
            hasBootstrapData = false;
          }
        }

        const fullData = await fetchDashboardSnapshot({
          path: "/api/dashboard",
          token,
          timeoutMs: hasBootstrapData
            ? DASHBOARD_BACKGROUND_FETCH_TIMEOUT_MS
            : DASHBOARD_FETCH_TIMEOUT_MS,
        });

        if (!cancelled) {
          commitDashboardData(fullData);
        }
      } catch (loadError) {
        if (!cancelled) {
          const hasFallbackData = Boolean(dataRef.current);
          if (!hasFallbackData) {
            setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard.");
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          initialLoadRef.current = false;
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [supabase, tick]);

  const shouldPollRuntimeAggressively = Boolean(
    data?.whatsapp_workspace?.runtime
    && (
      data.whatsapp_workspace.runtime.health === "syncing"
      || data.whatsapp_workspace.runtime.syncState !== "idle"
      || data.whatsapp_workspace.runtime.activeSyncJobs > 0
    ),
  );

  useEffect(() => {
    if (typeof window === "undefined" || !supabase) {
      return;
    }

    const intervalMs = data ? DASHBOARD_FULL_POLL_MS : DASHBOARD_EMPTY_POLL_MS;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      startTransition(() => {
        setTick((current) => current + 1);
      });
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [data, supabase]);

  const shouldPollWhatsAppRuntime = Boolean(
    data?.connected_accounts?.some((account) => account.provider === "whatsapp" && account.is_active)
    || data?.whatsapp_workspace?.summary.connected
    || data?.whatsapp_workspace?.runtime,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !supabase || !shouldPollWhatsAppRuntime) {
      return;
    }

    const authClient = supabase;
    let cancelled = false;

    async function loadRuntime() {
      try {
        const { data: sessionData } = await authClient.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          return;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), DASHBOARD_RUNTIME_FETCH_TIMEOUT_MS);
        let response: Response;

        try {
          response = await fetch("/api/dashboard/runtime", {
            headers: { Authorization: `Bearer ${token}` },
            cache: "no-store",
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

        if (!response.ok) {
          return;
        }

        const json = (await response.json().catch(() => ({}))) as DashboardRuntimeResponse;
        if (cancelled || !("runtime" in json)) {
          return;
        }

        setData((current) => {
          const next = mergeDashboardRuntime(current, json.runtime ?? null);
          if (next) {
            dataRef.current = next;
            writeDashboardCache(next);
          }
          return next;
        });
      } catch {
        // Keep the current dashboard snapshot if runtime polling misses a beat.
      }
    }

    void loadRuntime();

    const intervalMs = shouldPollRuntimeAggressively
      ? DASHBOARD_RUNTIME_SYNC_POLL_MS
      : DASHBOARD_RUNTIME_CONNECTED_POLL_MS;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void loadRuntime();
    }, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [shouldPollRuntimeAggressively, shouldPollWhatsAppRuntime, supabase]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleFocus = () => {
      startTransition(() => {
        setTick((current) => current + 1);
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        startTransition(() => {
          setTick((current) => current + 1);
        });
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return { data, loading, error, refetch };
}
