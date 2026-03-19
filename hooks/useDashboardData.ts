"use client";

import { useCallback, useEffect, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

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
  google_workspace_connect: DashboardRuntimeFeatureState;
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
};

type UseDashboardDataReturn = {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useDashboardData(config: PublicAppConfig): UseDashboardDataReturn {
  const supabase = getSupabaseBrowserClient({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  });

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => {
    setTick((current) => current + 1);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    const authClient = supabase;
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const { data: sessionData } = await authClient.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          if (!cancelled) {
            setLoading(false);
          }
          return;
        }

        const response = await fetch("/api/dashboard", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          const json = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error || "Failed to load dashboard data.");
        }

        const json = (await response.json()) as DashboardData;
        if (!cancelled) {
          setData(json);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load dashboard.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [supabase, tick]);

  return { data, loading, error, refetch };
}
