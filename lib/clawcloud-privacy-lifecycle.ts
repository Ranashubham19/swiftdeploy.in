import { getClawCloudErrorMessage, getClawCloudSupabaseAdmin } from "@/lib/clawcloud-supabase";
import {
  isClawCloudMissingSchemaColumn,
  isClawCloudMissingSchemaMessage,
} from "@/lib/clawcloud-schema-compat";
import { listGlobalLiteConnections } from "@/lib/clawcloud-global-lite";
import { disconnectClawCloudWhatsApp } from "@/lib/clawcloud-whatsapp";
import {
  dashboardJournalRecordToThread,
  type DashboardJournalThread,
} from "@/lib/clawcloud-dashboard-journal";
import { decryptSecretValue } from "@/lib/clawcloud-secret-box";
import { exportWhatsAppWorkspaceData } from "@/lib/clawcloud-whatsapp-governance";

export type ClawCloudDisconnectProvider = "google" | "whatsapp" | "telegram";

export type ClawCloudDisconnectResult = {
  provider: ClawCloudDisconnectProvider;
  disconnected: boolean;
  revokedTokens: number;
  warnings: string[];
};

type ConnectedAccountRow = {
  id: string;
  provider: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expiry: string | null;
  account_email: string | null;
  phone_number: string | null;
  display_name: string | null;
  is_active: boolean;
  connected_at: string | null;
  last_used_at: string | null;
};

type OrphanedAccountData = {
  chatThreadIds: string[];
  researchRunIds: number[];
  dashboardJournalThreadIds: string[];
};

type ExportSummary = Record<string, number>;

type ClawCloudLiveAnswerAuditEntry = {
  thread_id: string;
  thread_title: string;
  date_key: string;
  message_id: string;
  created_at: string;
  generated_at: string;
  question: string;
  answer: string;
  answer_preview: string;
  badge: string | null;
  source_note: string | null;
  source_summary: string[];
  evidence: Array<{
    title: string;
    domain: string;
    kind: string;
    url?: string | null;
    snippet?: string | null;
    published_at?: string | null;
    observed_at?: string | null;
  }>;
  metadata: Record<string, string | number | boolean | null>;
};

type ClawCloudLiveAnswerAuditTrail = {
  summary: {
    journal_days_with_live_audits: number;
    live_answer_messages: number;
    evidence_items: number;
    source_domains: string[];
    deterministic_answers: number;
    source_backed_answers: number;
  };
  entries: ClawCloudLiveAnswerAuditEntry[];
};

type SafeOptionalResult<T> = {
  data: T;
  warning?: string;
};

const GOOGLE_CONNECTED_PROVIDERS = ["gmail", "google_calendar", "google_drive"] as const;

function formatWarning(prefix: string, error: unknown) {
  return `${prefix}: ${getClawCloudErrorMessage(error)}`;
}

function buildAuditAnswerPreview(answer: string) {
  return answer.replace(/\s+/g, " ").trim().slice(0, 280);
}

export function buildClawCloudLiveAnswerAuditTrail(
  threads: DashboardJournalThread[],
): ClawCloudLiveAnswerAuditTrail {
  const entries: ClawCloudLiveAnswerAuditEntry[] = [];
  const sourceDomains = new Set<string>();
  const journalDays = new Set<string>();
  let deterministicAnswers = 0;
  let sourceBackedAnswers = 0;
  let evidenceItems = 0;

  for (const thread of threads) {
    for (const message of thread.messages) {
      const bundle = message.liveAnswerBundle;
      if (!bundle) {
        continue;
      }

      journalDays.add(thread.dateKey);
      evidenceItems += bundle.evidence.length;

      const strategy = typeof bundle.metadata?.strategy === "string"
        ? bundle.metadata.strategy
        : "";
      if (strategy === "deterministic") {
        deterministicAnswers += 1;
      }
      if (strategy === "search_synthesis") {
        sourceBackedAnswers += 1;
      }

      for (const item of bundle.evidence) {
        if (item.domain) {
          sourceDomains.add(item.domain);
        }
      }

      entries.push({
        thread_id: thread.id,
        thread_title: thread.title,
        date_key: thread.dateKey,
        message_id: message.id,
        created_at: message.createdAt,
        generated_at: bundle.generatedAt,
        question: bundle.question,
        answer: bundle.answer,
        answer_preview: buildAuditAnswerPreview(bundle.answer),
        badge: bundle.badge,
        source_note: bundle.sourceNote,
        source_summary: bundle.sourceSummary,
        evidence: bundle.evidence.map((item) => ({
          title: item.title,
          domain: item.domain,
          kind: item.kind,
          url: item.url ?? null,
          snippet: item.snippet ?? null,
          published_at: item.publishedAt ?? null,
          observed_at: item.observedAt ?? null,
        })),
        metadata: bundle.metadata,
      });
    }
  }

  entries.sort((left, right) =>
    right.created_at.localeCompare(left.created_at) || right.message_id.localeCompare(left.message_id),
  );

  return {
    summary: {
      journal_days_with_live_audits: journalDays.size,
      live_answer_messages: entries.length,
      evidence_items: evidenceItems,
      source_domains: [...sourceDomains].sort((left, right) => left.localeCompare(right)).slice(0, 50),
      deterministic_answers: deterministicAnswers,
      source_backed_answers: sourceBackedAnswers,
    },
    entries,
  };
}

async function safeOptionalQuery<T>(
  label: string,
  fallback: T,
  run: () => Promise<{ data: T | null; error: { message?: string } | null }>,
): Promise<SafeOptionalResult<T>> {
  try {
    const { data, error } = await run();

    if (error) {
      if (isClawCloudMissingSchemaMessage(error.message ?? "")) {
        return {
          data: fallback,
          warning: `${label} is not available on this deployment yet.`,
        };
      }

      throw new Error(error.message || `Unable to load ${label}.`);
    }

    return {
      data: data ?? fallback,
    };
  } catch (error) {
    const message = getClawCloudErrorMessage(error);
    if (isClawCloudMissingSchemaMessage(message)) {
      return {
        data: fallback,
        warning: `${label} is not available on this deployment yet.`,
      };
    }

    throw error;
  }
}

async function listConnectedAccounts(userId: string) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("connected_accounts")
    .select(
      "id, provider, access_token, refresh_token, token_expiry, account_email, phone_number, display_name, is_active, connected_at, last_used_at",
    )
    .eq("user_id", userId)
    .order("provider", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as ConnectedAccountRow[]).map((account) => ({
    ...account,
    access_token: decryptSecretValue(account.access_token),
    refresh_token: decryptSecretValue(account.refresh_token),
  }));
}

async function deactivateProviders(userId: string, providers: readonly string[]) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin
    .from("connected_accounts")
    .update({
      is_active: false,
      access_token: null,
      refresh_token: null,
      token_expiry: null,
      last_used_at: null,
    })
    .eq("user_id", userId)
    .in("provider", [...providers]);

  if (error) {
    throw new Error(error.message);
  }
}

async function revokeGoogleToken(token: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }),
  });

  if (response.ok || response.status === 400) {
    return true;
  }

  const message = await response.text().catch(() => "");
  throw new Error(message || "Google token revocation failed.");
}

function sanitizeConnectedAccountForExport(account: ConnectedAccountRow) {
  return {
    id: account.id,
    provider: account.provider,
    account_email: account.account_email,
    phone_number: account.phone_number,
    display_name: account.display_name,
    is_active: account.is_active,
    connected_at: account.connected_at,
    last_used_at: account.last_used_at,
  };
}

async function resolveClawCloudUserEmail(userId: string, userEmailHint?: string | null) {
  const hinted = String(userEmailHint ?? "").trim().toLowerCase();
  if (hinted) {
    return hinted;
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const resolved = String((data as { email?: string | null } | null)?.email ?? "").trim().toLowerCase();
  return resolved || null;
}

async function queryResearchRunsForUser<T>(
  label: string,
  userId: string,
  userEmailHint: string | null | undefined,
  fallback: T,
  buildQuery: (ownerKey: "user_id" | "user_email", ownerValue: string) => Promise<{
    data: T | null;
    error: { message?: string } | null;
  }>,
): Promise<SafeOptionalResult<T>> {
  const byUserId = await buildQuery("user_id", userId);
  if (!byUserId.error) {
    return { data: byUserId.data ?? fallback };
  }

  const primaryMessage = byUserId.error.message ?? "";
  if (!isClawCloudMissingSchemaMessage(primaryMessage)) {
    throw new Error(primaryMessage || `Unable to load ${label}.`);
  }

  if (!isClawCloudMissingSchemaColumn(primaryMessage, "user_id")) {
    return {
      data: fallback,
      warning: `${label} is not available on this deployment yet.`,
    };
  }

  const userEmail = await resolveClawCloudUserEmail(userId, userEmailHint);
  if (!userEmail) {
    return {
      data: fallback,
      warning: `${label} uses a legacy research schema on this deployment, but no account email was available for compatibility lookup.`,
    };
  }

  const byEmail = await buildQuery("user_email", userEmail);
  if (byEmail.error) {
    const legacyMessage = byEmail.error.message ?? "";
    if (isClawCloudMissingSchemaMessage(legacyMessage)) {
      return {
        data: fallback,
        warning: `${label} is not available on this deployment yet.`,
      };
    }

    throw new Error(legacyMessage || `Unable to load ${label}.`);
  }

  return {
    data: byEmail.data ?? fallback,
    warning: `${label} were matched using legacy email ownership because research_runs.user_id is missing on this deployment.`,
  };
}

async function listOrphanedAccountData(userId: string, userEmailHint?: string | null) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();

  const [chatThreads, researchRunsResult, dashboardJournalThreads] = await Promise.all([
    supabaseAdmin
      .from("chat_threads")
      .select("id")
      .eq("user_id", userId),
    queryResearchRunsForUser(
      "Research run cleanup",
      userId,
      userEmailHint,
      [] as Array<{ id: number }>,
      async (ownerKey, ownerValue) =>
        supabaseAdmin
          .from("research_runs")
          .select("id")
          .eq(ownerKey, ownerValue),
    ),
    supabaseAdmin
      .from("dashboard_journal_threads")
      .select("id")
      .eq("user_id", userId),
  ]);

  if (chatThreads.error) {
    throw new Error(chatThreads.error.message);
  }

  if (dashboardJournalThreads.error && !isClawCloudMissingSchemaMessage(dashboardJournalThreads.error.message)) {
    throw new Error(dashboardJournalThreads.error.message);
  }

  return {
    chatThreadIds: (chatThreads.data ?? []).map((row: { id: string }) => row.id),
    researchRunIds: researchRunsResult.data.map((row: { id: number }) => row.id),
    dashboardJournalThreadIds: (dashboardJournalThreads.data ?? []).map((row: { id: string }) => row.id),
    warnings: researchRunsResult.warning ? [researchRunsResult.warning] : [],
  } satisfies OrphanedAccountData & { warnings: string[] };
}

async function deleteOrphanedRowsByIds(
  table: "chat_threads" | "research_runs" | "dashboard_journal_threads",
  ids: Array<string | number>,
) {
  if (ids.length === 0) {
    return 0;
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const { error } = await supabaseAdmin.from(table).delete().in("id", ids);

  if (error) {
    throw new Error(error.message);
  }

  return ids.length;
}

export async function disconnectClawCloudIntegration(
  userId: string,
  provider: ClawCloudDisconnectProvider,
): Promise<ClawCloudDisconnectResult> {
  const connectedAccounts = await listConnectedAccounts(userId);
  const warnings: string[] = [];

  if (provider === "google") {
    const googleAccounts = connectedAccounts.filter((account) =>
      GOOGLE_CONNECTED_PROVIDERS.includes(account.provider as (typeof GOOGLE_CONNECTED_PROVIDERS)[number]),
    );
    const revokeCandidates = new Set<string>();

    for (const account of googleAccounts) {
      const refreshToken = account.refresh_token?.trim();
      const accessToken = account.access_token?.trim();

      if (refreshToken) {
        revokeCandidates.add(refreshToken);
      } else if (accessToken) {
        revokeCandidates.add(accessToken);
      }
    }

    let revokedTokens = 0;
    for (const token of revokeCandidates) {
      try {
        await revokeGoogleToken(token);
        revokedTokens += 1;
      } catch (error) {
        warnings.push(formatWarning("Google token revocation could not be confirmed", error));
      }
    }

    await deactivateProviders(userId, GOOGLE_CONNECTED_PROVIDERS);

    return {
      provider,
      disconnected: googleAccounts.some((account) => account.is_active),
      revokedTokens,
      warnings,
    };
  }

  if (provider === "whatsapp") {
    try {
      await disconnectClawCloudWhatsApp(userId);
    } catch (error) {
      warnings.push(formatWarning("WhatsApp session disconnect could not be confirmed", error));
    }

    await deactivateProviders(userId, ["whatsapp"]);

    return {
      provider,
      disconnected: connectedAccounts.some(
        (account) => account.provider === "whatsapp" && account.is_active,
      ),
      revokedTokens: 0,
      warnings,
    };
  }

  await deactivateProviders(userId, ["telegram"]);

  return {
    provider,
    disconnected: connectedAccounts.some(
      (account) => account.provider === "telegram" && account.is_active,
    ),
    revokedTokens: 0,
    warnings,
  };
}

export async function disconnectAllClawCloudIntegrations(userId: string) {
  const providers: ClawCloudDisconnectProvider[] = ["google", "whatsapp", "telegram"];
  const results: ClawCloudDisconnectResult[] = [];

  for (const provider of providers) {
    try {
      results.push(await disconnectClawCloudIntegration(userId, provider));
    } catch (error) {
      results.push({
        provider,
        disconnected: false,
        revokedTokens: 0,
        warnings: [formatWarning(`${provider} disconnect failed`, error)],
      });
    }
  }

  return results;
}

export async function exportClawCloudAccountData(userId: string, userEmail?: string | null) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const warnings: string[] = [];

  const [
    profileResult,
    preferencesResult,
    memoryResult,
    connectedAccounts,
    customCommandsResult,
    tasksResult,
    taskRunsResult,
    analyticsResult,
    intentAnalyticsResult,
    answerObservabilityResult,
    subscriptionResult,
    replyApprovalsResult,
    chatThreadsResult,
    researchRunsResult,
    dashboardJournalResult,
    globalLiteConnections,
    upiTransactionsResult,
    whatsappWorkspaceResult,
  ] = await Promise.all([
    safeOptionalQuery<Record<string, unknown> | null>(
      "User profile",
      null,
      async () =>
      supabaseAdmin
        .from("users")
        .select("id, email, full_name, avatar_url, plan, onboarding_done, timezone, created_at, updated_at")
        .eq("id", userId)
        .maybeSingle(),
    ),
    safeOptionalQuery<Record<string, unknown> | null>(
      "User preferences",
      null,
      async () =>
      supabaseAdmin
        .from("user_preferences")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
    ),
    safeOptionalQuery("User memory", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("user_memory")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
    ),
    listConnectedAccounts(userId),
    safeOptionalQuery("Custom commands", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("custom_commands")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ),
    safeOptionalQuery("Agent tasks", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("agent_tasks")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ),
    safeOptionalQuery("Task runs", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("task_runs")
        .select("*")
        .eq("user_id", userId)
        .order("started_at", { ascending: false }),
    ),
    safeOptionalQuery("Analytics history", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("analytics_daily")
        .select("*")
        .eq("user_id", userId)
        .order("date", { ascending: false }),
    ),
    safeOptionalQuery("Intent analytics", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("intent_analytics_daily")
        .select("*")
        .eq("user_id", userId)
        .order("date", { ascending: false }),
    ),
    safeOptionalQuery("Answer observability", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("answer_observability_events")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ),
    safeOptionalQuery<Record<string, unknown> | null>(
      "Subscription",
      null,
      async () =>
      supabaseAdmin
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
    ),
    safeOptionalQuery("Reply approvals", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("reply_approvals")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false }),
    ),
    safeOptionalQuery("Conversation threads", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("chat_threads")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
    ),
    queryResearchRunsForUser(
      "Research runs",
      userId,
      userEmail ?? null,
      [] as Array<Record<string, unknown>>,
      async (ownerKey, ownerValue) =>
        supabaseAdmin
          .from("research_runs")
          .select("*")
          .eq(ownerKey, ownerValue)
          .order("created_at", { ascending: false }),
    ),
    safeOptionalQuery("Dashboard journal", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("dashboard_journal_threads")
        .select("*")
        .eq("user_id", userId)
        .order("date_key", { ascending: false }),
    ),
    listGlobalLiteConnections(userId).catch(() => []),
    safeOptionalQuery("UPI transactions", [] as Array<Record<string, unknown>>, async () =>
      supabaseAdmin
        .from("upi_transactions")
        .select("*")
        .eq("user_id", userId)
        .order("transacted_at", { ascending: false }),
    ),
    (async () => {
      try {
        return {
          data: await exportWhatsAppWorkspaceData(userId),
        } as SafeOptionalResult<Record<string, unknown> | null>;
      } catch (error) {
        const message = getClawCloudErrorMessage(error);
        if (isClawCloudMissingSchemaMessage(message)) {
          return {
            data: null,
            warning: "WhatsApp workspace export is not available on this deployment yet.",
          } satisfies SafeOptionalResult<Record<string, unknown> | null>;
        }

        throw error;
      }
    })(),
  ]);

  for (const result of [
    profileResult,
    preferencesResult,
    memoryResult,
    customCommandsResult,
    tasksResult,
    taskRunsResult,
    analyticsResult,
    intentAnalyticsResult,
    answerObservabilityResult,
    subscriptionResult,
    replyApprovalsResult,
    chatThreadsResult,
    researchRunsResult,
    dashboardJournalResult,
    upiTransactionsResult,
    whatsappWorkspaceResult,
  ]) {
    if (result.warning) {
      warnings.push(result.warning);
    }
  }

  const sanitizedAccounts = connectedAccounts.map(sanitizeConnectedAccountForExport);
  const normalizedDashboardJournalThreads = dashboardJournalResult.data.map((row) =>
    dashboardJournalRecordToThread(row),
  );
  const liveAnswerAuditTrail = buildClawCloudLiveAnswerAuditTrail(normalizedDashboardJournalThreads);
  const summary: ExportSummary = {
    connected_accounts: sanitizedAccounts.length,
    global_lite_connections: globalLiteConnections.length,
    custom_commands: customCommandsResult.data.length,
    tasks: tasksResult.data.length,
    task_runs: taskRunsResult.data.length,
    analytics_days: analyticsResult.data.length,
    intent_analytics_days: intentAnalyticsResult.data.length,
    answer_observability_events: answerObservabilityResult.data.length,
    memory_facts: memoryResult.data.length,
    reply_approvals: replyApprovalsResult.data.length,
    chat_threads: chatThreadsResult.data.length,
    research_runs: researchRunsResult.data.length,
    dashboard_journal_days: normalizedDashboardJournalThreads.length,
    dashboard_live_answer_messages: liveAnswerAuditTrail.summary.live_answer_messages,
    dashboard_live_evidence_items: liveAnswerAuditTrail.summary.evidence_items,
    upi_transactions: upiTransactionsResult.data.length,
    whatsapp_history: Array.isArray((whatsappWorkspaceResult.data as { history?: unknown[] } | null)?.history)
      ? (((whatsappWorkspaceResult.data as { history?: unknown[] }).history ?? []).length)
      : 0,
  };

  return {
    exported_at: new Date().toISOString(),
    format_version: 3,
    notes: {
      credentials_excluded: true,
      unavailable_sections: warnings,
      user_email_hint: userEmail ?? null,
      live_answer_audit_trail_included: liveAnswerAuditTrail.entries.length > 0,
      answer_observability_included: answerObservabilityResult.data.length > 0,
    },
    summary,
    account: {
      profile: profileResult.data,
      preferences: preferencesResult.data,
      connected_accounts: sanitizedAccounts,
      global_lite_connections: globalLiteConnections,
      subscription: subscriptionResult.data,
    },
    automations: {
      tasks: tasksResult.data,
      task_runs: taskRunsResult.data,
      custom_commands: customCommandsResult.data,
      analytics_daily: analyticsResult.data,
      intent_analytics_daily: intentAnalyticsResult.data,
      reply_approvals: replyApprovalsResult.data,
    },
    research: {
      chat_threads: chatThreadsResult.data,
      research_runs: researchRunsResult.data,
    },
    dashboard: {
      journal_threads: normalizedDashboardJournalThreads,
      live_answer_audit_trail: liveAnswerAuditTrail,
      answer_observability_events: answerObservabilityResult.data,
    },
    personalization: {
      user_memory: memoryResult.data,
    },
    finance: {
      upi_transactions: upiTransactionsResult.data,
    },
    channels: {
      whatsapp_workspace: whatsappWorkspaceResult.data,
    },
  };
}

export async function deleteClawCloudAccount(userId: string, userEmail?: string | null) {
  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const disconnectResults = await disconnectAllClawCloudIntegrations(userId);
  const orphaned = await listOrphanedAccountData(userId, userEmail ?? null);

  const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(userId, false);
  if (deleteUserError) {
    throw new Error(deleteUserError.message);
  }

  const warnings = [
    ...disconnectResults.flatMap((result) => result.warnings),
    ...orphaned.warnings,
  ];
  let deletedChatThreads = 0;
  let deletedResearchRuns = 0;
  let deletedDashboardJournalThreads = 0;

  try {
    deletedChatThreads = await deleteOrphanedRowsByIds("chat_threads", orphaned.chatThreadIds);
  } catch (error) {
    warnings.push(formatWarning("Conversation thread cleanup failed", error));
  }

  try {
    deletedResearchRuns = await deleteOrphanedRowsByIds("research_runs", orphaned.researchRunIds);
  } catch (error) {
    warnings.push(formatWarning("Research run cleanup failed", error));
  }

  try {
    deletedDashboardJournalThreads = await deleteOrphanedRowsByIds(
      "dashboard_journal_threads",
      orphaned.dashboardJournalThreadIds,
    );
  } catch (error) {
    warnings.push(formatWarning("Dashboard journal cleanup failed", error));
  }

  return {
    deleted: true,
    disconnected_integrations: disconnectResults,
    orphan_cleanup: {
      chat_threads: deletedChatThreads,
      research_runs: deletedResearchRuns,
      dashboard_journal_threads: deletedDashboardJournalThreads,
    },
    warnings,
  };
}
