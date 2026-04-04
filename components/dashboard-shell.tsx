"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useDashboardData } from "@/hooks/useDashboardData";
import { describeGlobalLiteConnection } from "@/lib/clawcloud-global-lite";
import {
  clawCloudStarterPromptSections,
  type ClawCloudStarterPromptSectionId,
} from "@/lib/clawcloud-starter-prompts";
import {
  buildDashboardJournalStorageKey,
  buildDashboardJournalSyncSignature,
  buildDashboardJournalThreadId,
  type DashboardJournalAppAccessConsent,
  type DashboardJournalConversationStyleRequest,
  ensureDashboardJournalDay,
  formatDashboardJournalLabel,
  formatDashboardJournalMessageTime,
  getDashboardJournalDateKey,
  mergeDashboardJournalCollections,
  normalizeDashboardJournalMessage,
  readLocalDashboardJournal,
  sortDashboardJournalThreads,
  type DashboardJournalMessage,
  type DashboardJournalThread,
} from "@/lib/clawcloud-dashboard-journal";
import { useUpgrade } from "@/hooks/useUpgrade";
import type { ClawCloudWhatsAppRuntimeStatus } from "@/lib/clawcloud-whatsapp-runtime";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type {
  ClawCloudAnswerBundle,
  ClawCloudModelAuditTrail,
  PublicAppConfig,
} from "@/lib/types";

import styles from "./dashboard-shell.module.css";

type DashboardShellProps = {
  config: PublicAppConfig;
};

type ChatMessage = DashboardJournalMessage;
type AgentMessagePayload = {
  response?: string | null;
  error?: string;
  liveAnswerBundle?: ClawCloudAnswerBundle | null;
  modelAuditTrail?: ClawCloudModelAuditTrail | null;
  consentRequest?: (Omit<DashboardJournalAppAccessConsent, "status"> & {
    status?: DashboardJournalAppAccessConsent["status"];
  }) | null;
  styleRequest?: (Omit<DashboardJournalConversationStyleRequest, "status"> & {
    status?: DashboardJournalConversationStyleRequest["status"];
  }) | null;
  consentResolved?: {
    token: string;
    status: "approved" | "denied";
  } | null;
};

type BotReplyOptions = {
  appAccessConsent?: DashboardJournalAppAccessConsent | null;
  conversationStyleRequest?: DashboardJournalConversationStyleRequest | null;
  liveAnswerBundle?: ClawCloudAnswerBundle | null;
  modelAuditTrail?: ClawCloudModelAuditTrail | null;
};

type ActivityItem = {
  id: string;
  tone: "green" | "blue" | "amber";
  title: string;
  detail: string;
  time: string;
};

type DashboardPanel = "agent" | "tasks" | null;
type TaskRequirement = "gmail" | "google_calendar" | "whatsapp";
type TaskTemplate = {
  name: string;
  description: string;
  icon: string;
  tags: string[];
  requirements: TaskRequirement[];
  minimumPlan: "free" | "starter" | "pro";
  installDefaults: {
    scheduleTime: string | null;
    scheduleDays: string[] | null;
    config: Record<string, unknown>;
    summary: string;
  } | null;
};

const ICONS = {
  lobster: "\u{1F99E}",
  dashboard: "\u229E",
  robot: "\u{1F916}",
  zap: "\u26A1",
  mail: "\u{1F4E7}",
  calendar: "\u{1F4C5}",
  chat: "\u{1F4AC}",
  link: "\u{1F517}",
  chartBar: "\u{1F4CA}",
  chartUp: "\u{1F4C8}",
  gear: "\u2699",
  arrowLeft: "\u2190",
  bell: "\u{1F514}",
  clock: "\u23F1",
  check: "\u2705",
  phone: "\u{1F4F1}",
  search: "\u{1F50D}",
  moon: "\u{1F319}",
  sun: "\u2600\uFE0F",
  pencil: "\u270D\uFE0F",
  alarm: "\u23F0",
  clipboard: "\u{1F4CB}",
  menu: "\u2630",
  dots: "\u22EF",
  lock: "\u{1F512}",
} as const;

const EVERY_DAY_SCHEDULE = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const TASK_TYPE_ORDER = [
  "morning_briefing",
  "draft_replies",
  "meeting_reminders",
  "email_search",
  "evening_summary",
  "custom_reminder",
  "weekly_spend",
] as const;

const TASK_LABELS: Record<string, TaskTemplate> = {
  morning_briefing: {
    name: "Morning email briefing",
    description: "Summarises your inbox and sends a daily briefing to WhatsApp at 7:00 AM",
    icon: ICONS.sun,
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, "\u{1F556} 7:00 AM daily"],
    requirements: ["gmail", "whatsapp"],
    minimumPlan: "free",
    installDefaults: {
      scheduleTime: "07:00",
      scheduleDays: [...EVERY_DAY_SCHEDULE],
      config: { briefing_time: "7:00 AM" },
      summary: "\u{1F556} 7:00 AM every day",
    },
  },
  draft_replies: {
    name: "Draft email replies",
    description: 'Say "draft reply to [name]" on WhatsApp and your AI writes it to Gmail drafts',
    icon: ICONS.pencil,
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, `${ICONS.zap} On demand`],
    requirements: ["gmail", "whatsapp"],
    minimumPlan: "free",
    installDefaults: null,
  },
  meeting_reminders: {
    name: "Meeting reminders",
    description: "Sends a WhatsApp reminder 30 mins before each meeting with email context",
    icon: ICONS.calendar,
    tags: [`${ICONS.calendar} Calendar`, `${ICONS.chat} WhatsApp`, `${ICONS.alarm} 30min before`],
    requirements: ["google_calendar", "whatsapp"],
    minimumPlan: "free",
    installDefaults: {
      scheduleTime: null,
      scheduleDays: null,
      config: { minutes_before: 30, include_context: true },
      summary: `${ICONS.alarm} 30 minutes before each meeting`,
    },
  },
  email_search: {
    name: "Search my email",
    description: 'Ask "what did [person] say about [topic]?" and get an instant summary',
    icon: ICONS.search,
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, `${ICONS.zap} On demand`],
    requirements: ["gmail", "whatsapp"],
    minimumPlan: "free",
    installDefaults: null,
  },
  evening_summary: {
    name: "Evening summary",
    description: "End-of-day recap: what you did, what needs attention tomorrow",
    icon: ICONS.moon,
    tags: [`${ICONS.mail} Gmail`, `${ICONS.calendar} Calendar`, "\u{1F558} 9:00 PM daily"],
    requirements: ["gmail", "google_calendar", "whatsapp"],
    minimumPlan: "starter",
    installDefaults: {
      scheduleTime: "21:00",
      scheduleDays: [...EVERY_DAY_SCHEDULE],
      config: {},
      summary: "\u{1F558} 9:00 PM every day",
    },
  },
  custom_reminder: {
    name: "Smart reminders",
    description: 'Say "Remind me at 5pm to call Priya" on WhatsApp',
    icon: ICONS.alarm,
    tags: [`${ICONS.chat} WhatsApp`, `${ICONS.zap} On demand`],
    requirements: ["whatsapp"],
    minimumPlan: "free",
    installDefaults: null,
  },
  weekly_spend: {
    name: "Weekly spend summary",
    description: "Summarises your recent spending and sends a weekly update",
    icon: "\u{1F4B3}",
    tags: [`${ICONS.chat} WhatsApp`, `${ICONS.zap} Weekly`],
    requirements: ["whatsapp"],
    minimumPlan: "free",
    installDefaults: {
      scheduleTime: "18:00",
      scheduleDays: ["sun"],
      config: {},
      summary: "\u{1F4C6} Sundays at 6:00 PM",
    },
  },
};

const STARTER_TASKS = new Set(["evening_summary"]);

const compactDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const integerFormatter = new Intl.NumberFormat("en-US");

const suggestionButtons = [
  {
    value: "Draft a reply to my last email from Priya",
    label: "Draft reply to Priya",
  },
  {
    value: "What meetings do I have tomorrow?",
    label: "Tomorrow's meetings",
  },
  {
    value: "Summarise unread emails from today",
    label: "Today's emails",
  },
  {
    value: "Remind me at 5pm to review the proposal",
    label: "Set a reminder",
  },
  {
    value: "Search for emails about the Q4 budget",
    label: "Search emails",
  },
];

function getTimeGreeting(date = new Date()) {
  const hour = date.getHours();

  if (hour < 12) {
    return "Good morning";
  }

  if (hour < 17) {
    return "Good afternoon";
  }

  return "Good evening";
}

function formatRelativeTime(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return `${Math.floor(hours / 24)}d ago`;
}

function formatCompactDateTime(iso: string | null) {
  if (!iso) {
    return "Not available";
  }

  try {
    return compactDateFormatter.format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatInteger(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "0";
  }

  return integerFormatter.format(Math.max(0, Math.trunc(value)));
}

function clampPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function useAnimatedNumber(
  target: number | null | undefined,
  options?: { durationMs?: number; round?: boolean },
) {
  const durationMs = options?.durationMs ?? 720;
  const round = options?.round ?? true;
  const normalizedTarget =
    typeof target === "number" && Number.isFinite(target)
      ? target
      : 0;
  const [value, setValue] = useState(() => (round ? Math.round(normalizedTarget) : normalizedTarget));
  const valueRef = useRef(normalizedTarget);

  useEffect(() => {
    const startValue = valueRef.current;
    if (Math.abs(normalizedTarget - startValue) < 0.01) {
      valueRef.current = normalizedTarget;
      setValue(round ? Math.round(normalizedTarget) : normalizedTarget);
      return;
    }

    let frameId = 0;
    const startedAt = performance.now();
    const animationDuration = Math.min(
      1_100,
      Math.max(220, durationMs + Math.abs(normalizedTarget - startValue) * 20),
    );

    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / animationDuration);
      const eased = 1 - ((1 - progress) ** 3);
      const nextValue = startValue + ((normalizedTarget - startValue) * eased);
      valueRef.current = nextValue;
      setValue(round ? Math.round(nextValue) : nextValue);

      if (progress < 1) {
        frameId = window.requestAnimationFrame(tick);
        return;
      }

      valueRef.current = normalizedTarget;
      setValue(round ? Math.round(normalizedTarget) : normalizedTarget);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [durationMs, normalizedTarget, round]);

  return value;
}

function titleCaseWords(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatWhatsAppConnectionLabel(
  runtime: ClawCloudWhatsAppRuntimeStatus | null | undefined,
  connectedFallback: boolean,
) {
  if (!runtime) {
    return connectedFallback ? "Connected" : "Not connected";
  }

  switch (runtime.connectionStatus) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "waiting":
      return runtime.qrReady ? "Waiting for QR" : "Preparing QR";
    case "disconnected":
    default:
      return "Disconnected";
  }
}

function formatWhatsAppHealthLabel(runtime: ClawCloudWhatsAppRuntimeStatus | null | undefined) {
  if (!runtime) {
    return "Runtime unavailable";
  }

  switch (runtime.health) {
    case "healthy":
      return "Healthy";
    case "syncing":
      return "Syncing";
    case "degraded":
      return "Degraded";
    case "reauth_required":
      return "Reauth required";
    default:
      return titleCaseWords(runtime.health);
  }
}

function formatWhatsAppSyncStateLabel(runtime: ClawCloudWhatsAppRuntimeStatus | null | undefined) {
  if (!runtime) {
    return "Unknown";
  }

  if (runtime.syncState === "idle") {
    return runtime.activeSyncJobs > 0 ? "Sync worker active" : "Idle";
  }

  return titleCaseWords(runtime.syncState);
}

function describeWhatsAppRuntimeNote(
  runtime: ClawCloudWhatsAppRuntimeStatus | null | undefined,
  connectedFallback: boolean,
) {
  if (!runtime) {
    return connectedFallback
      ? "The live WhatsApp worker is connected, but the detailed runtime snapshot is unavailable right now."
      : "Connect WhatsApp to unlock runtime health and sync telemetry here.";
  }

  if (runtime.requiresReauth) {
    return "A fresh QR reconnect is required before ClawCloud can safely read and sync WhatsApp again.";
  }

  if (runtime.lastSyncError) {
    return `Last sync issue: ${runtime.lastSyncError}`;
  }

  if (runtime.connectionStatus === "waiting") {
    return runtime.qrReady
      ? `Fresh QR ready${typeof runtime.qrAgeSeconds === "number" ? ` • ${runtime.qrAgeSeconds}s old` : ""}.`
      : "The worker is preparing a new QR for this account.";
  }

  if (runtime.connected) {
    const parts = [
      runtime.phone ? `Linked phone ${runtime.phone}` : "Linked WhatsApp session active",
      runtime.activeSyncJobs > 0
        ? `${runtime.activeSyncJobs} sync job${runtime.activeSyncJobs === 1 ? "" : "s"} running`
        : "No sync backlog right now",
    ].filter(Boolean);

    return `${parts.join(" • ")}.`;
  }

  return "No live WhatsApp session is loaded right now.";
}

function joinReadable(parts: string[]) {
  if (parts.length === 0) {
    return "";
  }

  if (parts.length === 1) {
    return parts[0] ?? "";
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function requirementLabel(requirement: TaskRequirement) {
  switch (requirement) {
    case "gmail":
      return "Gmail";
    case "google_calendar":
      return "Google Calendar";
    case "whatsapp":
      return "WhatsApp";
  }
}

function activityToneForTask(taskType: string, status: string): "green" | "blue" | "amber" {
  if (status === "failed") {
    return "amber";
  }

  if (taskType === "draft_replies") {
    return "blue";
  }

  return "green";
}

function extractDisplayName(
  metadata: Record<string, unknown> | undefined,
  email: string | undefined,
) {
  const fullName =
    typeof metadata?.full_name === "string"
      ? metadata.full_name
      : typeof metadata?.name === "string"
        ? metadata.name
        : [metadata?.first_name, metadata?.last_name]
            .filter((value): value is string => typeof value === "string" && value.length > 0)
            .join(" ");

  if (fullName) {
    return fullName;
  }

  if (email?.includes("@")) {
    return email.split("@")[0].replace(/[._-]+/g, " ");
  }

  return "";
}

function getInitials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "RK";
  const parts = source
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return "RK";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function createSeedActivity(): ActivityItem[] {
  return [
    {
      id: "activity-1",
      tone: "green",
      title: "Morning briefing sent",
      detail: "Summary delivered to WhatsApp",
      time: "Today, 7:00 AM",
    },
    {
      id: "activity-2",
      tone: "blue",
      title: "Draft replies",
      detail: "Saved to Gmail drafts",
      time: "Today, 7:01 AM",
    },
  ];
}

function renderMessageText(text: string): ReactNode {
  const lines = text.split("\n");

  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*.*?\*\*)/g).filter(Boolean);

    return (
      <Fragment key={`${line}-${lineIndex}`}>
        {parts.map((part, partIndex) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={`${part}-${partIndex}`}>{part.slice(2, -2)}</strong>
          ) : (
            <Fragment key={`${part}-${partIndex}`}>{part}</Fragment>
          ),
        )}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </Fragment>
    );
  });
}

function formatLiveAnswerBundleGeneratedAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

function formatLiveAnswerEvidencePublishedAt(value?: string | null) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function buildLiveAnswerBundleStrategyLabel(bundle: ClawCloudAnswerBundle) {
  const strategy = typeof bundle.metadata?.strategy === "string"
    ? bundle.metadata.strategy
    : "";

  if (strategy === "deterministic") {
    return "Deterministic";
  }

  if (strategy === "search_synthesis") {
    return "Source-backed";
  }

  return "Live";
}

function formatLiveAnswerEvidenceKind(kind: ClawCloudAnswerBundle["evidence"][number]["kind"]) {
  switch (kind) {
    case "official_api":
      return "Official API";
    case "official_page":
      return "Official page";
    case "weather_provider":
      return "Weather provider";
    case "market_data":
      return "Market data";
    case "search_result":
      return "Search result";
    case "report":
      return "Report";
    case "inferred":
      return "Inferred";
    default:
      return "Source";
  }
}

function formatModelAuditIntent(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatModelAuditSelection(selectedBy: ClawCloudModelAuditTrail["selectedBy"]) {
  switch (selectedBy) {
    case "single_success":
      return "Single success";
    case "heuristic":
      return "Heuristic winner";
    case "judge":
      return "Judge winner";
    case "fallback":
      return "Fallback";
    default:
      return "Unknown";
  }
}

function formatModelAuditStrategy(strategy: ClawCloudModelAuditTrail["planner"]["strategy"]) {
  return strategy === "collect_and_judge" ? "Collect and judge" : "Single pass";
}

export function DashboardShell({ config }: DashboardShellProps) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  });
  const { upgrade, loading: upgradeLoading } = useUpgrade();
  const {
    data: dashboardData,
    loading: dashboardLoading,
    error: dashboardError,
    refetch,
  } = useDashboardData(config);
  const previewMode = !supabase;

  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const responseTimersRef = useRef<number[]>([]);
  const targetHighlightTimerRef = useRef<number | null>(null);
  const journalSyncTimerRef = useRef<number | null>(null);
  const journalLastSyncedSignatureRef = useRef("");

  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentOn, setAgentOn] = useState(true);
  const [greeting, setGreeting] = useState("Welcome back");
  const [journalThreads, setJournalThreads] = useState<DashboardJournalThread[]>([]);
  const [activeJournalId, setActiveJournalId] = useState<string | null>(null);
  const [journalHydrated, setJournalHydrated] = useState(false);
  const [journalCloudReady, setJournalCloudReady] = useState(previewMode);
  const [typingVisible, setTypingVisible] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [sendingCommand, setSendingCommand] = useState(false);
  const [consentSubmittingToken, setConsentSubmittingToken] = useState<string | null>(null);
  const [expandedEvidenceMessageIds, setExpandedEvidenceMessageIds] = useState<string[]>([]);
  const [expandedModelAuditMessageIds, setExpandedModelAuditMessageIds] = useState<string[]>([]);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [taskToggling, setTaskToggling] = useState<Record<string, boolean>>({});
  const [taskCreating, setTaskCreating] = useState<Record<string, boolean>>({});
  const [highlightedDashboardTarget, setHighlightedDashboardTarget] = useState<string | null>(null);
  const [pendingDashboardJumpTarget, setPendingDashboardJumpTarget] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState<DashboardPanel>(null);

  const plan = (dashboardData?.user?.plan ?? "free") as "free" | "starter" | "pro";
  const planLabel = plan.toUpperCase();
  const hasLiveDashboardData = Boolean(dashboardData);
  const liveDashboardUnavailable = !previewMode && !dashboardLoading && !dashboardData;
  const agentStatus = dashboardData?.agent_status;
  const featureStatus = dashboardData?.feature_status;
  const analytics = dashboardData?.analytics?.today;
  const answerObservability = dashboardData?.analytics?.answer_observability;
  const todayRuns = agentStatus?.today_runs ?? 0;
  const dailyLimit = agentStatus?.daily_limit ?? 0;
  const runsRemaining = agentStatus?.runs_remaining ?? 0;
  const answerQualityUsesLiveGrounding = Boolean((answerObservability?.liveAnswerCount ?? 0) > 0);
  const answerQualityRate = answerQualityUsesLiveGrounding
    ? (answerObservability?.liveGroundedRate ?? 0)
    : (answerObservability?.modelAuditedRate ?? 0);
  const answerQualityValue = dashboardLoading
    ? "-"
    : hasLiveDashboardData
      ? (answerObservability?.totalResponses ?? 0) > 0
        ? `${answerQualityRate}%`
        : "\u2014"
      : "\u2014";
  const answerQualityLabel = answerQualityUsesLiveGrounding
    ? "Grounded live replies"
    : "Replies with model audit";
  const activeTaskLimit = agentStatus?.active_task_limit ?? 0;
  const isLimitReached = hasLiveDashboardData && runsRemaining <= 0;
  const isLimitWarning = hasLiveDashboardData && !isLimitReached && runsRemaining <= 2;
  const runPercentage =
    hasLiveDashboardData && dailyLimit > 0 ? Math.min((todayRuns / dailyLimit) * 100, 100) : 0;
  const whatsappWorkspace = dashboardData?.whatsapp_workspace;
  const whatsappSummary = whatsappWorkspace?.summary;
  const whatsappRuntime = whatsappWorkspace?.runtime ?? null;
  const whatsappSettings = whatsappWorkspace?.settings;
  const isWhatsAppActivelySyncing = Boolean(
    whatsappRuntime
    && (
      whatsappRuntime.health === "syncing"
      || whatsappRuntime.syncState !== "idle"
      || whatsappRuntime.activeSyncJobs > 0
    ),
  );
  const animatedWhatsAppOverallPercent = useAnimatedNumber(
    whatsappRuntime?.progress.overallPercent,
    { durationMs: 720 },
  );
  const animatedWhatsAppContactPercent = useAnimatedNumber(
    whatsappRuntime?.progress.contactPercent,
    { durationMs: 760 },
  );
  const animatedWhatsAppHistoryPercent = useAnimatedNumber(
    whatsappRuntime?.progress.historyPercent,
    { durationMs: 760 },
  );
  const animatedWhatsAppContactCount = useAnimatedNumber(
    whatsappRuntime?.contactCount,
    { durationMs: 880 },
  );
  const animatedWhatsAppHistoryCount = useAnimatedNumber(
    whatsappRuntime?.historyMessageCount,
    { durationMs: 920 },
  );
  const whatsappRuntimeRemainingContactsTarget = whatsappRuntime
    ? Math.max(0, whatsappRuntime.progress.contactTarget - whatsappRuntime.contactCount)
    : 0;
  const whatsappRuntimeRemainingHistoryTarget = whatsappRuntime
    ? Math.max(0, whatsappRuntime.progress.historyTarget - whatsappRuntime.historyMessageCount)
    : 0;
  const whatsappRuntimeRemainingItemsTarget =
    whatsappRuntimeRemainingContactsTarget + whatsappRuntimeRemainingHistoryTarget;
  const animatedWhatsAppRemainingItems = useAnimatedNumber(
    whatsappRuntimeRemainingItemsTarget,
    { durationMs: 980 },
  );
  const whatsappApprovals = (whatsappWorkspace?.approvals ?? []).filter(
    (approval) => approval.status === "pending",
  );
  const whatsappContacts = [...(whatsappWorkspace?.contacts ?? [])].sort((left, right) => {
    const awaitingDiff = Number(right.awaiting_reply) - Number(left.awaiting_reply);
    if (awaitingDiff !== 0) {
      return awaitingDiff;
    }

    const priorityRank = { vip: 3, high: 2, normal: 1, low: 0 } as const;
    const rankDiff = priorityRank[right.priority] - priorityRank[left.priority];
    if (rankDiff !== 0) {
      return rankDiff;
    }

    return String(right.last_message_at ?? right.last_seen_at ?? "").localeCompare(
      String(left.last_message_at ?? left.last_seen_at ?? ""),
    );
  });
  const whatsappPreviewContacts = whatsappContacts.slice(0, 4);

  const liveTasks = dashboardData?.tasks ?? [];
  const sortedTasks = TASK_TYPE_ORDER
    .map((taskType) => liveTasks.find((task) => task.task_type === taskType))
    .filter((task): task is (typeof liveTasks)[number] => Boolean(task));

  const displayName =
    userName || dashboardData?.user?.full_name || (previewMode ? "Rahul Kumar" : "ClawCloud User");
  const displayEmail =
    userEmail || dashboardData?.user?.email || (previewMode ? "rahul.kumar@gmail.com" : "");
  const firstName = displayName.split(" ")[0] || (previewMode ? "Rahul" : "there");
  const initials = getInitials(displayName, displayEmail);
  const activeCount = liveTasks.filter((task) => task.is_enabled).length;
  const remainingTaskSlots = hasLiveDashboardData ? Math.max(activeTaskLimit - activeCount, 0) : 0;
  const enabledTasks = sortedTasks.filter((task) => task.is_enabled);
  const journalOwnerKey = previewMode
    ? "preview"
    : dashboardData?.user?.id || (userEmail ? userEmail.toLowerCase() : null);
  const journalStorageKey = journalOwnerKey ? buildDashboardJournalStorageKey(journalOwnerKey) : null;
  const todayJournalDateKey = getDashboardJournalDateKey();
  const todayJournalId = buildDashboardJournalThreadId(todayJournalDateKey);

  const activeConnectedAccounts = (dashboardData?.connected_accounts ?? []).filter(
    (account) => account.is_active,
  );
  const activeGlobalLiteConnections = (dashboardData?.global_lite_connections ?? []).filter(
    (connection) => connection.is_active,
  );
  const showLiteFallbackStatus = Boolean(featureStatus?.global_lite_connect.available);
  const connectedProviders = new Set(activeConnectedAccounts.map((account) => account.provider));
  const connectedLiteProviders = new Set(
    activeGlobalLiteConnections.map((connection) => connection.provider),
  );
  const getActiveConnectedAccount = (provider: string) =>
    activeConnectedAccounts.find((account) => account.provider === provider);
  const getActiveLiteConnection = (provider: "gmail" | "google_calendar" | "google_drive") =>
    showLiteFallbackStatus
      ? activeGlobalLiteConnections.find((connection) => connection.provider === provider) ?? null
      : null;
  const isWhatsAppConnected =
    connectedProviders.has("whatsapp")
    || Boolean(whatsappRuntime?.connected)
    || Boolean(whatsappSummary?.connected);
  const starterPromptConnectionState: Record<ClawCloudStarterPromptSectionId, boolean> = {
    gmail: connectedProviders.has("gmail"),
    calendar: connectedProviders.has("google_calendar"),
    drive: connectedProviders.has("google_drive"),
    whatsapp: isWhatsAppConnected,
  };
  const installedTaskTypes = new Set(liveTasks.map((task) => task.task_type));
  const enabledTaskTypes = new Set(enabledTasks.map((task) => task.task_type));
  const planOrder: Record<"free" | "starter" | "pro", number> = {
    free: 0,
    starter: 1,
    pro: 2,
  };
  const dashboardStarterPromptSections = [...clawCloudStarterPromptSections].sort(
    (left, right) =>
      Number(starterPromptConnectionState[right.id]) - Number(starterPromptConnectionState[left.id]),
  );
  const connectedStarterPromptCount = dashboardStarterPromptSections.filter(
    (section) => starterPromptConnectionState[section.id],
  ).length;
  const starterPromptDashboardState = Object.fromEntries(
    dashboardStarterPromptSections.map((section) => {
      const connected = starterPromptConnectionState[section.id];
      const relatedTaskTypes = [...(section.taskTypes ?? [])];
      const installedRelatedTaskTypes = relatedTaskTypes.filter((taskType) => installedTaskTypes.has(taskType));
      const enabledRelatedTaskTypes = relatedTaskTypes.filter((taskType) => enabledTaskTypes.has(taskType));
      const installedRelatedTaskLabels = installedRelatedTaskTypes
        .map((taskType) => TASK_LABELS[taskType]?.name)
        .filter((value): value is string => Boolean(value));
      const enabledRelatedTaskLabels = enabledRelatedTaskTypes
        .map((taskType) => TASK_LABELS[taskType]?.name)
        .filter((value): value is string => Boolean(value));
      const installableRelatedTaskTypes = relatedTaskTypes.filter((taskType) => {
        const template = TASK_LABELS[taskType];
        if (!template || installedTaskTypes.has(taskType)) {
          return false;
        }

        return planOrder[template.minimumPlan] <= planOrder[plan];
      });
      const lockedRelatedTaskTypes = relatedTaskTypes.filter((taskType) => {
        const template = TASK_LABELS[taskType];
        if (!template || installedTaskTypes.has(taskType)) {
          return false;
        }

        return planOrder[template.minimumPlan] > planOrder[plan];
      });
      const installableRelatedTaskLabels = installableRelatedTaskTypes
        .map((taskType) => TASK_LABELS[taskType]?.name)
        .filter((value): value is string => Boolean(value));
      const highlightedEnabledTaskNames = joinReadable(enabledRelatedTaskLabels.slice(0, 2));
      const highlightedInstalledTaskNames = joinReadable(installedRelatedTaskLabels.slice(0, 2));
      const highlightedInstallableTaskNames = joinReadable(installableRelatedTaskLabels.slice(0, 2));
      const lockedTaskNames = joinReadable(
        lockedRelatedTaskTypes
          .map((taskType) => TASK_LABELS[taskType]?.name)
          .filter((value): value is string => Boolean(value))
          .slice(0, 2),
      );

      let statusLabel = connected ? "Connected" : "Connect first";
      let description = connected ? section.description : section.connectLabel;
      let note =
        connected && relatedTaskTypes.length === 0
          ? "Direct questions are ready immediately. This surface does not need extra task setup."
          : null;
      let actionLabel = connected ? "Focus command box" : section.id === "whatsapp" ? "Finish WhatsApp setup" : "Open settings";
      let actionIntent: "connect" | "task_library" | "upgrade" | "focus" = connected
        ? "focus"
        : "connect";

      if (connected) {
        if (enabledRelatedTaskTypes.length > 0) {
          statusLabel = `${enabledRelatedTaskTypes.length} live`;
          description =
            enabledRelatedTaskTypes.length === 1
              ? `${section.label} questions are ready, and 1 automation is already running here.`
              : `${section.label} questions are ready, and ${enabledRelatedTaskTypes.length} automations are already running here.`;
          note = highlightedEnabledTaskNames
            ? `Live now: ${highlightedEnabledTaskNames}${enabledRelatedTaskLabels.length > 2 ? ", and more." : "."}`
            : "Questions and proactive automations are both live here.";
          actionLabel = "Manage automations";
          actionIntent = "task_library";
        } else if (installedRelatedTaskTypes.length > 0) {
          statusLabel = "Paused";
          description = `${section.label} questions are ready, but your related automations are currently paused.`;
          note = highlightedInstalledTaskNames
            ? `Installed here: ${highlightedInstalledTaskNames}${installedRelatedTaskLabels.length > 2 ? ", and more." : "."}`
            : "Installed automations are available to re-enable from Task Library.";
          actionLabel = "Manage automations";
          actionIntent = "task_library";
        } else if (installableRelatedTaskTypes.length > 0) {
          statusLabel = "Ready now";
          description = `${section.label} questions are ready instantly, and you can add automations whenever you want.`;
          note = highlightedInstallableTaskNames
            ? `Suggested automations: ${highlightedInstallableTaskNames}${installableRelatedTaskLabels.length > 2 ? ", and more." : "."}`
            : "Open Task Library to add automations for this surface.";
          actionLabel = "Install automations";
          actionIntent = "task_library";
        } else if (lockedRelatedTaskTypes.length > 0) {
          statusLabel = "Ready now";
          description = `${section.label} questions are ready instantly on your current plan.`;
          note = lockedTaskNames
            ? `${titleCaseWords(
                plan === "free" ? "starter" : "pro",
              )} unlocks ${lockedTaskNames}.`
            : "Upgrade to unlock additional automations for this surface.";
          actionLabel = plan === "free" ? "Upgrade to Starter" : "Upgrade plan";
          actionIntent = "upgrade";
        }
      }

      return [
        section.id,
        {
          connected,
          statusLabel,
          description,
          note,
          actionLabel,
          actionIntent,
        },
      ];
    }),
  ) as Record<
    ClawCloudStarterPromptSectionId,
    {
      connected: boolean;
      statusLabel: string;
      description: string;
      note: string | null;
      actionLabel: string;
      actionIntent: "connect" | "task_library" | "upgrade" | "focus";
    }
  >;
  const gmailAccount = getActiveConnectedAccount("gmail");
  const calendarAccount = getActiveConnectedAccount("google_calendar");
  const driveAccount = getActiveConnectedAccount("google_drive");
  const gmailLiteAccount = getActiveLiteConnection("gmail");
  const calendarLiteAccount = getActiveLiteConnection("google_calendar");
  const driveLiteAccount = getActiveLiteConnection("google_drive");
  const telegramAccount = getActiveConnectedAccount("telegram");
  const whatsappAccount = getActiveConnectedAccount("whatsapp");
  const googleCapabilities = dashboardData?.google_capabilities;
  const googleConnected = connectedProviders.has("gmail")
    || connectedProviders.has("google_calendar")
    || connectedProviders.has("google_drive");
  const googleNeedsWriteReconnect = Boolean(
    googleConnected
    && googleCapabilities?.connected
    && (
      googleCapabilities.reconnectRequired
      || (connectedProviders.has("gmail") && (!googleCapabilities.gmailModify || !googleCapabilities.gmailCompose || !googleCapabilities.gmailSend))
      || (connectedProviders.has("google_calendar") && !googleCapabilities.calendarWrite)
      || (connectedProviders.has("google_drive") && (!googleCapabilities.driveRead || !googleCapabilities.sheetsWrite))
    ),
  );
  const activeJournalThread = journalThreads.find((thread) => thread.id === activeJournalId) ?? null;
  const journalMessages = activeJournalThread?.messages ?? [];
  const recentJournalThreads = journalThreads.slice(0, 7);
  const visibleJournalThreads = recentJournalThreads.filter((thread) => thread.messages.length > 0);
  const isLoadingLiveDashboard = dashboardLoading && !hasLiveDashboardData;

  const disconnectedAccountDetail = previewMode
    ? "Preview mode only"
    : isLoadingLiveDashboard
      ? "Loading live status..."
      : liveDashboardUnavailable
      ? "Live status unavailable"
      : "Not connected";
  const whatsappSessionDisplay = hasLiveDashboardData
    ? formatWhatsAppConnectionLabel(whatsappRuntime, isWhatsAppConnected)
    : previewMode
      ? "Preview only"
      : "Live status unavailable";
  const whatsappRuntimeHealthDisplay = hasLiveDashboardData
    ? formatWhatsAppHealthLabel(whatsappRuntime)
    : previewMode
      ? "Preview only"
      : "Live status unavailable";
  const whatsappRuntimeHeroPercent = hasLiveDashboardData && whatsappRuntime
    ? clampPercent(animatedWhatsAppOverallPercent)
    : 0;
  const whatsappRuntimeContactPercentValue = hasLiveDashboardData && whatsappRuntime
    ? clampPercent(animatedWhatsAppContactPercent)
    : 0;
  const whatsappRuntimeHistoryPercentValue = hasLiveDashboardData && whatsappRuntime
    ? clampPercent(animatedWhatsAppHistoryPercent)
    : 0;
  const whatsappRuntimeSyncDisplay = hasLiveDashboardData
    ? whatsappRuntime
      ? `${whatsappRuntimeHeroPercent}% synced`
      : isWhatsAppConnected
        ? "Waiting for data"
        : "Not available"
    : previewMode
      ? "Preview only"
      : "Live status unavailable";
  const whatsappRuntimeLastSyncDisplay = hasLiveDashboardData
    ? whatsappRuntime?.lastSuccessfulSyncAt
      ? formatCompactDateTime(whatsappRuntime.lastSuccessfulSyncAt)
      : whatsappRuntime?.lastSyncFinishedAt
        ? formatCompactDateTime(whatsappRuntime.lastSyncFinishedAt)
        : "Not available"
    : disconnectedAccountDetail;
  const whatsappRuntimeSyncStateDisplay = hasLiveDashboardData
    ? whatsappRuntime
      ? formatWhatsAppSyncStateLabel(whatsappRuntime)
      : isWhatsAppConnected
        ? "Waiting for data"
        : "Not available"
    : disconnectedAccountDetail;
  const whatsappRuntimeCountsDisplay = hasLiveDashboardData
    ? whatsappRuntime
      ? `${whatsappRuntime.contactCount} contacts • ${whatsappRuntime.historyMessageCount} msgs`
      : isWhatsAppConnected
        ? "Runtime unavailable"
        : disconnectedAccountDetail
    : disconnectedAccountDetail;
  const whatsappRuntimeLastActivityDisplay = hasLiveDashboardData
    ? whatsappRuntime?.lastActivityAt
      ? formatRelativeTime(whatsappRuntime.lastActivityAt)
      : "Not available"
    : disconnectedAccountDetail;
  const whatsappRuntimeConnectedAtDisplay = hasLiveDashboardData
    ? whatsappRuntime?.connectedAt
      ? formatCompactDateTime(whatsappRuntime.connectedAt)
      : "Not available"
    : disconnectedAccountDetail;
  const whatsappSessionToneClass = !hasLiveDashboardData || (!whatsappRuntime && !isWhatsAppConnected)
    ? styles.workspaceStatStatusMuted
    : whatsappRuntime
      && (
        whatsappRuntime.health === "syncing"
        || whatsappRuntime.connectionStatus === "connecting"
        || whatsappRuntime.connectionStatus === "waiting"
      )
      ? styles.workspaceStatStatusSyncing
      : isWhatsAppConnected
        ? styles.workspaceStatStatusConnected
        : styles.workspaceStatStatusMuted;
  const whatsappSessionMetaDisplay = hasLiveDashboardData
    ? isWhatsAppConnected
      ? whatsappRuntime?.connectedAt
        ? `Since ${whatsappRuntimeConnectedAtDisplay}`
        : "Live session ready"
      : disconnectedAccountDetail
    : disconnectedAccountDetail;
  const whatsappRuntimeSyncJobsDisplay = hasLiveDashboardData
    ? whatsappRuntime
      ? whatsappRuntime.activeSyncJobs > 0
        ? `${whatsappRuntime.activeSyncJobs} sync job${whatsappRuntime.activeSyncJobs === 1 ? "" : "s"} active`
        : whatsappRuntime.connected
          ? "Watching for new activity"
          : "No sync worker active"
      : isWhatsAppConnected
        ? "Waiting for runtime data"
        : disconnectedAccountDetail
    : disconnectedAccountDetail;
  const whatsappRuntimeAutoRefreshDisplay = hasLiveDashboardData
    ? isWhatsAppActivelySyncing
      ? "Live updates every 2.5 seconds while WhatsApp is syncing."
      : "Live status refreshes automatically in the background."
    : disconnectedAccountDetail;
  const whatsappRuntimeContactMetricDisplay = hasLiveDashboardData
    ? whatsappRuntime
      ? `${formatInteger(animatedWhatsAppContactCount)} / ${formatInteger(whatsappRuntime.progress.contactTarget)}`
      : disconnectedAccountDetail
    : disconnectedAccountDetail;
  const whatsappRuntimeHistoryMetricDisplay = hasLiveDashboardData
    ? whatsappRuntime
      ? `${formatInteger(animatedWhatsAppHistoryCount)} / ${formatInteger(whatsappRuntime.progress.historyTarget)}`
      : disconnectedAccountDetail
    : disconnectedAccountDetail;
  const whatsappRuntimeLiveCountsDisplay = hasLiveDashboardData
    ? whatsappRuntime
      ? `${formatInteger(animatedWhatsAppContactCount)} contacts, ${formatInteger(animatedWhatsAppHistoryCount)} msgs`
      : disconnectedAccountDetail
    : disconnectedAccountDetail;
  const whatsappRuntimeRemainingItemsValue = Math.max(0, Math.round(animatedWhatsAppRemainingItems));
  const whatsappRuntimeRemainingDigits = String(whatsappRuntimeRemainingItemsValue)
    .padStart(
      Math.max(
        4,
        String(Math.max(whatsappRuntimeRemainingItemsTarget, whatsappRuntimeRemainingItemsValue)).length,
      ),
      "0",
    )
    .split("");
  const showWhatsAppRuntimeCountdown = Boolean(
    hasLiveDashboardData
    && whatsappRuntime
    && (isWhatsAppActivelySyncing || whatsappRuntimeRemainingItemsTarget > 0),
  );
  const whatsappRuntimeCountdownLabel = whatsappRuntimeRemainingItemsValue > 0
    ? `${formatInteger(whatsappRuntimeRemainingItemsValue)} items left to scan`
    : "Finalizing latest scan";
  const whatsappRuntimeCountdownMeta = whatsappRuntime
    ? `${formatInteger(whatsappRuntimeRemainingContactsTarget)} contacts left • ${formatInteger(whatsappRuntimeRemainingHistoryTarget)} msgs left`
    : disconnectedAccountDetail;
  const whatsappRuntimeBadgeClass = !whatsappRuntime
    ? styles.runtimeBadgeMuted
    : whatsappRuntime.health === "healthy"
      ? styles.runtimeBadgeHealthy
      : whatsappRuntime.health === "syncing"
        ? styles.runtimeBadgeSyncing
        : styles.runtimeBadgeWarning;
  const whatsappRuntimeNote = hasLiveDashboardData
    ? describeWhatsAppRuntimeNote(whatsappRuntime, isWhatsAppConnected)
    : disconnectedAccountDetail;
  const whatsappSettingFallback = previewMode ? "Preview defaults" : "Live status unavailable";
  const automationModeDisplay = hasLiveDashboardData
    ? titleCaseWords(whatsappSettings?.automationMode ?? "auto_reply")
    : whatsappSettingFallback;
  const replyToneDisplay = hasLiveDashboardData
    ? titleCaseWords(whatsappSettings?.replyMode ?? "balanced")
    : whatsappSettingFallback;
  const groupBehaviorDisplay = hasLiveDashboardData
    ? titleCaseWords(whatsappSettings?.groupReplyMode ?? "mention_only")
    : whatsappSettingFallback;
  const sensitiveApprovalDisplay = hasLiveDashboardData
    ? whatsappSettings?.requireApprovalForSensitive
      ? "On"
      : "Off"
    : whatsappSettingFallback;
  const quietHoursDisplay = hasLiveDashboardData
    ? whatsappSettings?.quietHoursStart && whatsappSettings?.quietHoursEnd
      ? `${whatsappSettings.quietHoursStart} to ${whatsappSettings.quietHoursEnd}`
      : "Not set"
    : whatsappSettingFallback;
  const taskRunsDisplay = hasLiveDashboardData ? `${todayRuns} / ${dailyLimit}` : "\u2014";
  const activeTasksDisplay = hasLiveDashboardData ? `${activeCount} / ${activeTaskLimit}` : "\u2014";
  const greetingText = dashboardLoading
    ? "Loading your agent data..."
    : hasLiveDashboardData
      ? `Your agent is ${agentOn ? "active" : "paused"}. ${runsRemaining} of ${dailyLimit} daily runs remaining.`
      : "Live agent metrics are unavailable right now.";
  const taskUsageMeta = hasLiveDashboardData
    ? isLimitReached
      ? "Limit reached - upgrade for more runs"
      : `${runsRemaining} run${runsRemaining === 1 ? "" : "s"} remaining today`
    : "Live usage data is unavailable right now.";
  const statusUsageMeta = hasLiveDashboardData
    ? isLimitReached
      ? "Limit reached - upgrade to continue"
      : `${runsRemaining} run${runsRemaining === 1 ? "" : "s"} remaining today`
    : "Live usage data is unavailable right now.";
  const tasksSummaryText = hasLiveDashboardData
    ? `${activeCount} of ${activeTaskLimit} active`
    : previewMode
      ? "Preview only"
      : isLoadingLiveDashboard
        ? "Loading..."
      : "Live status unavailable";
  const tasksEmptyText = previewMode
    ? "Preview mode does not load live task configuration."
    : liveDashboardUnavailable
      ? "Live task configuration is unavailable right now."
      : "No tasks are configured yet.";
  const whatsappApprovalsEmptyText = previewMode
    ? "Preview mode does not load live WhatsApp approvals."
    : liveDashboardUnavailable
      ? "Live WhatsApp approvals are unavailable right now."
      : "No WhatsApp replies are waiting for review right now.";
  const whatsappContactsEmptyText = previewMode
    ? "Preview mode does not load live inbox priorities."
    : liveDashboardUnavailable
      ? "Live WhatsApp inbox priorities are unavailable right now."
      : "Connect WhatsApp to start building inbox priority rules.";
  const journalHeaderStatus = activeJournalThread
    ? `${formatDashboardJournalLabel(activeJournalThread.dateKey, todayJournalDateKey)} · ${
        journalMessages.length
      } message${journalMessages.length === 1 ? "" : "s"}`
    : "New daily page ready";
  const journalEmptyText = activeJournalThread
    ? activeJournalThread.dateKey === todayJournalDateKey
      ? "Today is empty. Ask anything from the starter panel or command box and it will stay only in this dashboard history."
      : "No dashboard conversation was saved for this day."
    : "Your daily dashboard journal is ready. Start a conversation and it will be stored here by day.";
  const cleanJournalHeaderStatus = activeJournalThread
    ? `${formatDashboardJournalLabel(activeJournalThread.dateKey, todayJournalDateKey)} - ${
        journalMessages.length
      } message${journalMessages.length === 1 ? "" : "s"}`
    : "New daily page ready";
  const activityEmptyText = liveDashboardUnavailable
    ? "Live activity is unavailable right now."
    : "No recent task runs yet.";
  const agentStatusLabel = hasLiveDashboardData
    ? agentOn
      ? "Running"
      : "Paused"
    : previewMode
      ? "Preview"
      : isLoadingLiveDashboard
        ? "Loading"
      : "Unavailable";
  const headerAgentLabel = hasLiveDashboardData
    ? agentOn
      ? "Agent online"
      : "Agent paused"
    : previewMode
      ? "Preview only"
      : isLoadingLiveDashboard
        ? "Loading live status"
      : "Live status unavailable";
  const sidebarPlanLabel = hasLiveDashboardData ? planLabel : previewMode ? "PREVIEW" : "\u2014";
  const gmailNavLabel = connectedProviders.has("gmail")
    ? "On"
    : showLiteFallbackStatus && connectedLiteProviders.has("gmail")
      ? "Lite"
    : previewMode
      ? "Preview"
      : isLoadingLiveDashboard
        ? "..."
      : liveDashboardUnavailable
        ? "N/A"
        : "Off";
  const calendarNavLabel = connectedProviders.has("google_calendar")
    ? "On"
    : showLiteFallbackStatus && connectedLiteProviders.has("google_calendar")
      ? "Lite"
    : previewMode
      ? "Preview"
      : isLoadingLiveDashboard
        ? "..."
      : liveDashboardUnavailable
        ? "N/A"
        : "Off";
  const whatsappNavLabel = isWhatsAppConnected
    ? "On"
    : previewMode
      ? "Preview"
      : isLoadingLiveDashboard
        ? "..."
      : liveDashboardUnavailable
        ? "N/A"
        : "Off";

  const isRequirementConnected = (requirement: TaskRequirement) => {
    switch (requirement) {
      case "gmail":
      case "google_calendar":
        return connectedProviders.has(requirement);
      case "whatsapp":
        return isWhatsAppConnected;
    }
  };

  const canRequirementBeConnected = (requirement: TaskRequirement) => {
    if (!featureStatus) {
      return false;
    }

    switch (requirement) {
      case "gmail":
      case "google_calendar":
        return featureStatus.google_workspace_connect.available;
      case "whatsapp":
        return featureStatus.whatsapp_agent.available;
    }
  };

  const getRequirementBlockedReason = (requirement: TaskRequirement) => {
    if (!featureStatus) {
      return "Live setup status is unavailable right now.";
    }

    switch (requirement) {
      case "gmail":
      case "google_calendar":
        return (
          featureStatus.google_workspace_connect.reason
          || "Google Workspace connect is unavailable."
        );
      case "whatsapp":
        return featureStatus.whatsapp_agent.reason || "WhatsApp connect is unavailable.";
    }
  };

  const agentConnections = [
    connectedProviders.has("gmail")
      ? {
          label: "Gmail",
          status: googleNeedsWriteReconnect ? "Reconnect required" : "Connected",
          detail: googleNeedsWriteReconnect
            ? (googleCapabilities?.reconnectReason
              || "Reconnect Google to restore Gmail inbox access.")
            : gmailAccount?.account_email || "Connected and ready for inbox tasks.",
          tone: googleNeedsWriteReconnect ? "neutral" as const : "good" as const,
        }
      : showLiteFallbackStatus && gmailLiteAccount
        ? {
            label: "Gmail",
            status: "Lite connected",
            detail: describeGlobalLiteConnection(gmailLiteAccount),
            tone: "neutral" as const,
          }
      : featureStatus?.google_workspace_connect.available
        ? {
            label: "Gmail",
            status: "Ready to connect",
            detail: "Open settings to connect Gmail for inbox summaries, search, and drafts.",
            tone: "neutral" as const,
          }
        : {
            label: "Gmail",
            status: "Unavailable",
            detail:
              featureStatus?.google_workspace_connect.reason
              || "Google Workspace connect is unavailable.",
            tone: "warn" as const,
          },
    connectedProviders.has("google_calendar")
      ? {
          label: "Google Calendar",
          status: googleNeedsWriteReconnect ? "Reconnect required" : "Connected",
          detail: googleNeedsWriteReconnect
            ? (googleCapabilities?.reconnectReason
              || "Reconnect Google to restore Calendar access.")
            : (
              calendarAccount?.account_email
              || "Live calendar events are available for reminders and summaries."
            ),
          tone: googleNeedsWriteReconnect ? "neutral" as const : "good" as const,
        }
      : showLiteFallbackStatus && calendarLiteAccount
        ? {
            label: "Google Calendar",
            status: "Lite connected",
            detail: describeGlobalLiteConnection(calendarLiteAccount),
            tone: "neutral" as const,
          }
      : featureStatus?.google_workspace_connect.available
        ? {
            label: "Google Calendar",
            status: "Ready to connect",
            detail: "Open settings to connect Calendar for meeting reminders.",
            tone: "neutral" as const,
          }
        : {
            label: "Google Calendar",
            status: "Unavailable",
            detail:
              featureStatus?.google_workspace_connect.reason
              || "Google Workspace connect is unavailable.",
            tone: "warn" as const,
          },
    connectedProviders.has("google_drive")
      ? {
          label: "Google Drive",
          status: googleNeedsWriteReconnect ? "Reconnect required" : "Connected",
          detail: googleNeedsWriteReconnect
            ? (googleCapabilities?.reconnectReason
              || "Reconnect Google to restore Drive and Sheets access.")
            : (
              driveAccount?.account_email
              || "Drive files are available for richer workspace workflows."
            ),
          tone: googleNeedsWriteReconnect ? "neutral" as const : "good" as const,
        }
      : showLiteFallbackStatus && driveLiteAccount
        ? {
            label: "Google Drive",
            status: "Lite connected",
            detail: describeGlobalLiteConnection(driveLiteAccount),
            tone: "neutral" as const,
          }
      : featureStatus?.google_workspace_extended_connect.available
        ? {
            label: "Google Drive",
            status: "Ready to connect",
            detail: "Open settings to connect Drive for file retrieval and richer workspace context.",
            tone: "neutral" as const,
          }
        : {
            label: "Google Drive",
            status: "Unavailable",
            detail:
              featureStatus?.google_workspace_extended_connect.reason
              || "Extended Google Workspace connect is unavailable.",
            tone: "warn" as const,
          },
    isWhatsAppConnected
      ? {
          label: "WhatsApp",
          status: "Connected",
          detail: whatsappAccount?.phone_number || "Live WhatsApp actions are enabled.",
          tone: "good" as const,
        }
      : featureStatus?.whatsapp_agent.available
        ? {
            label: "WhatsApp",
            status: "Ready to connect",
            detail: "Open setup or settings to connect your WhatsApp agent.",
            tone: "neutral" as const,
          }
        : {
            label: "WhatsApp",
            status: "Unavailable",
            detail: featureStatus?.whatsapp_agent.reason || "WhatsApp agent is unavailable.",
            tone: "warn" as const,
          },
    connectedProviders.has("telegram")
      ? {
          label: "Telegram",
          status: "Connected",
          detail:
            telegramAccount?.account_email
            || telegramAccount?.display_name
            || "Telegram bot linked.",
          tone: "good" as const,
        }
      : featureStatus?.telegram_bot.available
        ? {
            label: "Telegram",
            status: "Ready to connect",
            detail: "Telegram bot is available when you want a second chat surface.",
            tone: "neutral" as const,
          }
        : {
            label: "Telegram",
            status: "Unavailable",
            detail: featureStatus?.telegram_bot.reason || "Telegram bot is unavailable.",
            tone: "warn" as const,
          },
  ];

  const agentCapabilities = [
    {
      label: "Voice transcription",
      available: Boolean(featureStatus?.voice_transcription.available),
      detail: featureStatus?.voice_transcription.available
        ? "Ready for voice-note workflows."
        : featureStatus?.voice_transcription.reason || "Unavailable right now.",
    },
    {
      label: "Image analysis",
      available: Boolean(featureStatus?.image_analysis.available),
      detail: featureStatus?.image_analysis.available
        ? "Image understanding providers are configured."
        : featureStatus?.image_analysis.reason || "Unavailable right now.",
    },
    {
      label: "Image generation",
      available: Boolean(featureStatus?.image_generation.available),
      detail: featureStatus?.image_generation.available
        ? `Ready via ${
            joinReadable(featureStatus?.image_generation.providers ?? ["configured provider"])
            || "configured provider"
          }.`
        : featureStatus?.image_generation.reason || "Unavailable right now.",
    },
    {
      label: "Extended Google access",
      available:
        Boolean(connectedProviders.has("google_drive"))
        || Boolean(featureStatus?.google_workspace_extended_connect.available),
      detail: connectedProviders.has("google_drive")
        ? driveAccount?.account_email || "Google Drive is connected and ready for richer workspace workflows."
        : showLiteFallbackStatus && driveLiteAccount
        ? describeGlobalLiteConnection(driveLiteAccount)
        : featureStatus?.google_workspace_extended_connect.available
        ? "Drive-ready access is available for richer workspace workflows."
        : featureStatus?.google_workspace_extended_connect.reason || "Unavailable right now.",
    },
  ];

  const taskLibraryEntries = TASK_TYPE_ORDER.map((taskType) => {
    const template = TASK_LABELS[taskType];
    const existingTask = liveTasks.find((task) => task.task_type === taskType);
    const missingRequirements = template.requirements.filter(
      (requirement) => !isRequirementConnected(requirement),
    );
    const blockedRequirements = missingRequirements.filter(
      (requirement) => !canRequirementBeConnected(requirement),
    );
    const isStarterLocked = template.minimumPlan === "starter" && plan === "free" && !existingTask;
    const isAtTaskLimit = !existingTask && hasLiveDashboardData && activeCount >= activeTaskLimit;

    return {
      taskType,
      template,
      existingTask,
      missingRequirements,
      blockedRequirements,
      isStarterLocked,
      isAtTaskLimit,
      targetId: `task-${taskType}`,
    };
  });
  const installedLibraryCount = taskLibraryEntries.filter((entry) => entry.existingTask).length;

  const accounts = [
    {
      id: "gmail",
      icon: ICONS.mail,
      name: "Gmail",
      detail: connectedProviders.has("gmail")
        ? googleNeedsWriteReconnect
          ? (googleCapabilities?.reconnectReason || "Reconnect Google to restore Gmail access.")
          : gmailAccount?.account_email || disconnectedAccountDetail
        : showLiteFallbackStatus && gmailLiteAccount
          ? describeGlobalLiteConnection(gmailLiteAccount)
          : disconnectedAccountDetail,
      connected: connectedProviders.has("gmail") || Boolean(showLiteFallbackStatus && gmailLiteAccount),
      stateLabel: connectedProviders.has("gmail")
        ? googleNeedsWriteReconnect
          ? "Reconnect needed"
          : "Connected"
        : showLiteFallbackStatus && gmailLiteAccount
          ? "Lite connected"
          : null,
      actionLabel: "Open settings",
      actionCopy: previewMode
        ? "Connect Gmail in settings to replace preview data"
        : "Connect Gmail in settings",
    },
    {
      id: "calendar",
      icon: ICONS.calendar,
      name: "Google Calendar",
      detail: connectedProviders.has("google_calendar")
        ? googleNeedsWriteReconnect
          ? (googleCapabilities?.reconnectReason || "Reconnect Google to restore Calendar access.")
          : calendarAccount?.account_email || "Connected"
        : showLiteFallbackStatus && calendarLiteAccount
          ? describeGlobalLiteConnection(calendarLiteAccount)
          : disconnectedAccountDetail,
      connected: connectedProviders.has("google_calendar") || Boolean(showLiteFallbackStatus && calendarLiteAccount),
      stateLabel: connectedProviders.has("google_calendar")
        ? googleNeedsWriteReconnect
          ? "Reconnect needed"
          : "Connected"
        : showLiteFallbackStatus && calendarLiteAccount
          ? "Lite connected"
          : null,
      actionLabel: "Open settings",
      actionCopy: previewMode
        ? "Connect Calendar in settings to replace preview data"
        : "Connect Calendar in settings",
    },
    {
      id: "drive",
      icon: ICONS.clipboard,
      name: "Google Drive",
      detail: connectedProviders.has("google_drive")
        ? googleNeedsWriteReconnect
          ? (googleCapabilities?.reconnectReason || "Reconnect Google to restore Drive access.")
          : driveAccount?.account_email || "Connected"
        : showLiteFallbackStatus && driveLiteAccount
          ? describeGlobalLiteConnection(driveLiteAccount)
          : disconnectedAccountDetail,
      connected: connectedProviders.has("google_drive") || Boolean(showLiteFallbackStatus && driveLiteAccount),
      stateLabel: connectedProviders.has("google_drive")
        ? googleNeedsWriteReconnect
          ? "Reconnect needed"
          : "Connected"
        : showLiteFallbackStatus && driveLiteAccount
          ? "Lite connected"
          : null,
      actionLabel: "Open settings",
      actionCopy: previewMode
        ? "Connect Drive in settings to replace preview data"
        : "Connect Drive in settings",
    },
    {
      id: "whatsapp",
      icon: ICONS.chat,
      name: "WhatsApp",
      detail: whatsappAccount?.phone_number || disconnectedAccountDetail,
      connected: isWhatsAppConnected,
      stateLabel: isWhatsAppConnected ? "Connected" : null,
      actionLabel: "Open settings",
      actionCopy: isWhatsAppConnected ? "Open WhatsApp controls" : "Connect WhatsApp in settings",
    },
    {
      id: "telegram",
      icon: ICONS.phone,
      name: "Telegram",
      detail: connectedProviders.has("telegram")
        ? "Connected"
        : "Available on Starter plan",
      connected: connectedProviders.has("telegram"),
      stateLabel: connectedProviders.has("telegram") ? "Connected" : null,
      actionLabel: "Upgrade",
      actionCopy: "Upgrade to Starter to connect Telegram",
    },
    {
      id: "slack",
      icon: ICONS.bell,
      name: "Slack",
      detail: "Available on Pro plan",
      connected: false,
      stateLabel: null,
      actionLabel: "Upgrade",
      actionCopy: "Upgrade to Pro to connect Slack",
    },
  ];
  const connectedSurfaceCount = accounts.filter((account) => account.connected).length;
  const setupRemainingCount = accounts.filter(
    (account) => !account.connected && account.actionLabel === "Open settings",
  ).length;
  const upgradeSurfaceCount = accounts.filter(
    (account) => !account.connected && account.actionLabel === "Upgrade",
  ).length;
  const accountsSummaryTitle = connectedSurfaceCount > 0
    ? `${connectedSurfaceCount} surface${connectedSurfaceCount === 1 ? "" : "s"} ready`
    : "Complete your workspace setup";
  const accountsSummaryText = connectedSurfaceCount > 0
    ? isWhatsAppConnected
      ? "Your live surfaces are connected and the WhatsApp workspace is ready for commands, sync, and inbox review."
      : "Your connected surfaces are ready. Add WhatsApp next to unlock the live operator workspace."
    : "Connect Gmail, Calendar, and WhatsApp to turn this dashboard into a real operator workspace instead of a static panel.";

  const recentActivity: ActivityItem[] = (dashboardData?.recent_activity ?? [])
    .slice(0, 5)
    .map((run) => ({
      id: run.id,
      tone: activityToneForTask(run.task_type, run.status),
      title: TASK_LABELS[run.task_type]?.name ?? run.task_type,
      detail:
        run.status === "failed"
          ? "Failed"
          : run.status === "running"
            ? "Running..."
            : "Completed",
      time: formatRelativeTime(run.started_at),
    }));

  const displayActivity =
    recentActivity.length > 0
      ? recentActivity
      : previewMode
        ? createSeedActivity()
        : [];

  useEffect(() => {
    setGreeting(getTimeGreeting());
  }, []);

  useEffect(() => {
    if (agentStatus) {
      setAgentOn(agentStatus.is_active);
    }
  }, [agentStatus]);

  useEffect(() => {
    if (!journalStorageKey) {
      setJournalThreads([]);
      setActiveJournalId(null);
      setJournalHydrated(false);
      setJournalCloudReady(previewMode);
      return;
    }

    const localThreads = readLocalDashboardJournal(journalStorageKey);
    const ensured = ensureDashboardJournalDay(localThreads, getDashboardJournalDateKey());

    setJournalThreads(ensured.threads);
    setActiveJournalId(ensured.thread.id);
    setJournalHydrated(true);
    setJournalCloudReady(previewMode);
  }, [journalStorageKey, previewMode]);

  useEffect(() => {
    if (!journalHydrated || !journalStorageKey) {
      return;
    }

    window.localStorage.setItem(journalStorageKey, JSON.stringify(journalThreads));
  }, [journalHydrated, journalStorageKey, journalThreads]);

  useEffect(() => {
    if (!journalHydrated || previewMode || !supabase) {
      return;
    }

    const authClient = supabase;
    let cancelled = false;

    async function hydrateJournalFromCloud() {
      try {
        const { data: sessionData } = await authClient.auth.getSession();
        const token = sessionData.session?.access_token;

        if (!token) {
          return;
        }

        const response = await fetch("/api/dashboard/journal", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => ({}))) as {
          threads?: DashboardJournalThread[];
        };
        const remoteThreads = Array.isArray(payload.threads) ? payload.threads : [];
        const remoteEnsured = ensureDashboardJournalDay(remoteThreads, getDashboardJournalDateKey()).threads;

        if (cancelled) {
          return;
        }

        journalLastSyncedSignatureRef.current = buildDashboardJournalSyncSignature(remoteEnsured);
        setJournalThreads((current) =>
          ensureDashboardJournalDay(
            mergeDashboardJournalCollections(current, remoteEnsured),
            getDashboardJournalDateKey(),
          ).threads,
        );
      } finally {
        if (!cancelled) {
          setJournalCloudReady(true);
        }
      }
    }

    void hydrateJournalFromCloud();

    return () => {
      cancelled = true;
    };
  }, [journalHydrated, previewMode, supabase]);

  useEffect(() => {
    if (!journalHydrated || !journalCloudReady || previewMode || !supabase) {
      return;
    }

    const authClient = supabase;
    const nextSignature = buildDashboardJournalSyncSignature(journalThreads);
    if (!nextSignature || nextSignature === journalLastSyncedSignatureRef.current) {
      return;
    }

    const snapshotThreads = journalThreads;
    const snapshotSignature = nextSignature;
    journalSyncTimerRef.current = window.setTimeout(() => {
      void (async () => {
        try {
          const { data: sessionData } = await authClient.auth.getSession();
          const token = sessionData.session?.access_token;

          if (!token) {
            return;
          }

          const response = await fetch("/api/dashboard/journal", {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ threads: snapshotThreads }),
          });

          if (!response.ok) {
            return;
          }

          const payload = (await response.json().catch(() => ({}))) as {
            threads?: DashboardJournalThread[];
          };
          const syncedThreads = ensureDashboardJournalDay(
            mergeDashboardJournalCollections(snapshotThreads, Array.isArray(payload.threads) ? payload.threads : []),
            getDashboardJournalDateKey(),
          ).threads;
          const syncedSignature = buildDashboardJournalSyncSignature(syncedThreads);

          journalLastSyncedSignatureRef.current = syncedSignature || snapshotSignature;
          setJournalThreads((current) =>
            ensureDashboardJournalDay(
              mergeDashboardJournalCollections(current, syncedThreads),
              getDashboardJournalDateKey(),
            ).threads,
          );
        } catch {
          // Keep local journal intact and retry on the next change.
        }
      })();
    }, 900);

    return () => {
      if (journalSyncTimerRef.current) {
        window.clearTimeout(journalSyncTimerRef.current);
        journalSyncTimerRef.current = null;
      }
    };
  }, [journalCloudReady, journalHydrated, journalThreads, previewMode, supabase]);

  useEffect(() => {
    if (!journalHydrated) {
      return;
    }

    const interval = window.setInterval(() => {
      const dateKey = getDashboardJournalDateKey();
      const nextThreadId = buildDashboardJournalThreadId(dateKey);
      setJournalThreads((current) => ensureDashboardJournalDay(current, dateKey).threads);
      setActiveJournalId(nextThreadId);
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [journalHydrated]);

  useEffect(() => {
    if (!activePanel) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setActivePanel(null);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [activePanel]);

  useEffect(() => {
    if (!pendingDashboardJumpTarget) {
      return;
    }

    const target = document.getElementById(pendingDashboardJumpTarget);
    if (!target) {
      return;
    }

    const timer = window.setTimeout(() => {
      jumpToDashboardTarget(pendingDashboardJumpTarget, "Task card is not available yet.");
      setPendingDashboardJumpTarget(null);
    }, 60);

    return () => {
      window.clearTimeout(timer);
    };
  }, [pendingDashboardJumpTarget, sortedTasks.length]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      setError(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env to use this dashboard.",
      );
      return;
    }

    const authClient = supabase;
    let cancelled = false;

    async function loadUser() {
      const { data, error: authError } = await authClient.auth.getUser();

      if (cancelled) {
        return;
      }

      if (authError || !data.user) {
        router.replace("/auth");
        return;
      }

      setUserEmail(data.user.email ?? "");
      setUserName(extractDisplayName(data.user.user_metadata, data.user.email ?? undefined));
      setError("");
      setLoading(false);
    }

    loadUser().catch((loadError) => {
      if (!cancelled) {
        setLoading(false);
        setError(loadError instanceof Error ? loadError.message : "Unable to load dashboard.");
      }
    });

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        router.replace("/auth");
        return;
      }

      setUserEmail(session.user.email ?? "");
      setUserName(
        extractDisplayName(session.user.user_metadata, session.user.email ?? undefined),
      );
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }

      if (journalSyncTimerRef.current) {
        window.clearTimeout(journalSyncTimerRef.current);
      }

      if (targetHighlightTimerRef.current) {
        window.clearTimeout(targetHighlightTimerRef.current);
      }

      responseTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
    };
  }, []);

  function showToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
    }, 2600);
  }

  function clearPendingResponses() {
    responseTimersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    responseTimersRef.current = [];
    setTypingVisible(false);
  }

  function queueResponse(callback: () => void, delayMs: number) {
    const timer = window.setTimeout(() => {
      responseTimersRef.current = responseTimersRef.current.filter((id) => id !== timer);
      callback();
    }, delayMs);

    responseTimersRef.current.push(timer);
  }

  function buildTypedReplyFrames(text: string) {
    const tokens = text.match(/\S+\s*/g) ?? [text];
    if (!tokens.length) {
      return [text];
    }

    const targetFrames = Math.min(14, Math.max(3, Math.ceil(tokens.length / 4)));
    const tokensPerFrame = Math.max(1, Math.ceil(tokens.length / targetFrames));
    const frames: string[] = [];

    for (let index = 0; index < tokens.length; index += tokensPerFrame) {
      frames.push(tokens.slice(0, index + tokensPerFrame).join("").trimEnd());
    }

    const finalFrame = text.trimEnd();
    if (frames.length === 0 || frames[frames.length - 1] !== finalFrame) {
      frames.push(finalFrame);
    }

    return frames;
  }

  function typedReplyDurationMs(text: string) {
    return Math.min(1100, Math.max(260, Math.round(text.length * 1.8)));
  }

  function appendJournalMessage(
    role: ChatMessage["role"],
    text: string,
    options?: BotReplyOptions,
  ) {
    const createdAt = new Date().toISOString();
    const dateKey = getDashboardJournalDateKey(new Date(createdAt));
    const nextThreadId = buildDashboardJournalThreadId(dateKey);
    const nextMessage = normalizeDashboardJournalMessage({
      role,
      text,
      createdAt,
      time: formatDashboardJournalMessageTime(new Date(createdAt)),
      appAccessConsent: options?.appAccessConsent ?? null,
      conversationStyleRequest: options?.conversationStyleRequest ?? null,
      liveAnswerBundle: options?.liveAnswerBundle ?? null,
      modelAuditTrail: options?.modelAuditTrail ?? null,
    });

    setJournalThreads((current) => {
      const ensured = ensureDashboardJournalDay(current, dateKey);
      const updatedThread: DashboardJournalThread = {
        ...ensured.thread,
        updatedAt: createdAt,
        messages: [...ensured.thread.messages, nextMessage],
      };

      return sortDashboardJournalThreads([
        ...ensured.threads.filter((thread) => thread.id !== nextThreadId),
        updatedThread,
      ]);
    });
    setActiveJournalId(nextThreadId);
    return nextMessage.id;
  }

  function updateJournalMessageText(
    messageId: string,
    text: string,
    options?: BotReplyOptions,
  ) {
    setJournalThreads((current) =>
      sortDashboardJournalThreads(
        current.map((thread) => ({
          ...thread,
          messages: thread.messages.map((message) =>
            message.id === messageId
              ? normalizeDashboardJournalMessage({
                  ...message,
                  text,
                  appAccessConsent: options?.appAccessConsent ?? message.appAccessConsent ?? null,
                  conversationStyleRequest:
                    options?.conversationStyleRequest ?? message.conversationStyleRequest ?? null,
                  liveAnswerBundle: options?.liveAnswerBundle ?? message.liveAnswerBundle ?? null,
                  modelAuditTrail: options?.modelAuditTrail ?? message.modelAuditTrail ?? null,
                })
              : message,
          ),
        })),
      ),
    );
  }

  function showTypedJournalBotReply(text: string, options?: BotReplyOptions) {
    clearPendingResponses();
    const frames = buildTypedReplyFrames(text);
    const firstFrame = frames[0] ?? text;
    setTypingVisible(true);
    const messageId = appendJournalMessage("bot", firstFrame);

    if (frames.length <= 1) {
      updateJournalMessageText(messageId, text, options);
      setTypingVisible(false);
      return;
    }

    setTypingVisible(true);
    const stepDelayMs = Math.max(60, Math.round(typedReplyDurationMs(text) / (frames.length - 1)));

    frames.slice(1).forEach((frame, index) => {
      const isLast = index === frames.length - 2;
      queueResponse(() => {
        updateJournalMessageText(messageId, frame, isLast ? options : undefined);
        if (isLast) {
          setTypingVisible(false);
        }
      }, stepDelayMs * (index + 1));
    });
  }

  function updateJournalConsentStatus(
    token: string,
    status: DashboardJournalAppAccessConsent["status"],
  ) {
    setJournalThreads((current) =>
      sortDashboardJournalThreads(
        current.map((thread) => ({
          ...thread,
          messages: thread.messages.map((message) =>
            message.appAccessConsent?.token === token
              ? normalizeDashboardJournalMessage({
                  ...message,
                  appAccessConsent: {
                    ...message.appAccessConsent,
                    status,
                  },
                })
              : message,
          ),
        })),
      ),
    );
  }

  function updateJournalConversationStyleStatus(
    token: string,
    status: DashboardJournalConversationStyleRequest["status"],
  ) {
    setJournalThreads((current) =>
      sortDashboardJournalThreads(
        current.map((thread) => ({
          ...thread,
          messages: thread.messages.map((message) =>
            message.conversationStyleRequest?.token === token
              ? normalizeDashboardJournalMessage({
                  ...message,
                  conversationStyleRequest: {
                    ...message.conversationStyleRequest,
                    status,
                  },
                })
              : message,
          ),
        })),
      ),
    );
  }

  function toggleEvidenceInspector(messageId: string) {
    setExpandedEvidenceMessageIds((current) =>
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId],
    );
  }

  function toggleModelAuditInspector(messageId: string) {
    setExpandedModelAuditMessageIds((current) =>
      current.includes(messageId)
        ? current.filter((id) => id !== messageId)
        : [...current, messageId],
    );
  }

  function queueBotReply(text: string, startDelayMs: number, typingDelayMs: number) {
    clearPendingResponses();

    queueResponse(() => {
      setTypingVisible(true);

      queueResponse(() => {
        setTypingVisible(false);
        appendJournalMessage("bot", text);
      }, typingDelayMs);
    }, startDelayMs);
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function closePanel() {
    setActivePanel(null);
  }

  function openAgentPanel() {
    closeSidebar();
    setActivePanel("agent");
  }

  function openTaskLibraryPanel() {
    closeSidebar();
    setActivePanel("tasks");
  }

  function jumpToDashboardTarget(targetId: string, missingMessage: string) {
    closeSidebar();
    closePanel();

    const scrollToTarget = () => {
      const target = document.getElementById(targetId);

      if (!target) {
        showToast(missingMessage);
        return;
      }

      target.scrollIntoView({ behavior: "smooth", block: "start" });
      window.history.replaceState({}, "", `/dashboard#${targetId}`);
      setHighlightedDashboardTarget(targetId);

      if (targetHighlightTimerRef.current) {
        window.clearTimeout(targetHighlightTimerRef.current);
      }

      targetHighlightTimerRef.current = window.setTimeout(() => {
        setHighlightedDashboardTarget((current) => (current === targetId ? null : current));
      }, 1800);
    };

    window.setTimeout(scrollToTarget, 80);
  }

  function openGmailWorkspace() {
    jumpToDashboardTarget("connection-gmail", "Gmail section is not available yet");
  }

  function openCalendarWorkspace() {
    jumpToDashboardTarget("connection-calendar", "Calendar section is not available yet");
  }

  function openWhatsAppWorkspace() {
    jumpToDashboardTarget("whatsapp-workspace", "WhatsApp workspace is not available yet");
  }

  function openSettings() {
    closeSidebar();
    closePanel();
    router.push("/settings");
  }

  async function handleStarterPromptSectionAction(
    sectionId: ClawCloudStarterPromptSectionId,
    actionIntent: "connect" | "task_library" | "upgrade" | "focus",
  ) {
    if (actionIntent === "focus") {
      focusQuickCommand();
      return;
    }

    if (actionIntent === "task_library") {
      openTaskLibraryPanel();
      return;
    }

    if (actionIntent === "upgrade") {
      if (plan === "free") {
        await upgrade({ plan: "starter", period: "monthly", currency: "inr" });
        return;
      }

      await upgrade({ plan: "pro", period: "monthly", currency: "inr" });
      return;
    }

    if (sectionId === "whatsapp") {
      closeSidebar();
      closePanel();
      router.push("/setup");
      return;
    }

    openSettings();
  }

  async function handleAccountAction(accountId: string) {
    switch (accountId) {
      case "gmail":
      case "calendar":
      case "drive":
        openSettings();
        return;
      case "whatsapp":
        if (isWhatsAppConnected) {
          openWhatsAppWorkspace();
          return;
        }
        closeSidebar();
        closePanel();
        router.push("/setup");
        return;
      case "telegram":
        if (plan === "free") {
          await upgrade({ plan: "starter", period: "monthly", currency: "inr" });
          return;
        }
        openSettings();
        return;
      case "slack":
        await upgrade({ plan: "pro", period: "monthly", currency: "inr" });
        return;
      default:
        showToast("Action required.");
    }
  }

  function openActivityLog() {
    closeSidebar();
    closePanel();
    router.push("/activity");
  }

  function focusQuickCommand() {
    closePanel();
    window.setTimeout(() => {
      commandInputRef.current?.focus();
    }, 60);
  }

  function handleJournalDaySelect(threadId: string) {
    clearPendingResponses();
    setActiveJournalId(threadId);
  }

  async function handleCreateTask(taskType: (typeof TASK_TYPE_ORDER)[number]) {
    if (!supabase) {
      showToast("Auth not configured.");
      return;
    }

    if (!hasLiveDashboardData) {
      showToast("Live task data is unavailable right now.");
      return;
    }

    const template = TASK_LABELS[taskType];
    const missingRequirements = template.requirements.filter(
      (requirement) => !isRequirementConnected(requirement),
    );

    if (missingRequirements.length > 0) {
      const blockedRequirement = missingRequirements.find(
        (requirement) => !canRequirementBeConnected(requirement),
      );

      if (blockedRequirement) {
        showToast(getRequirementBlockedReason(blockedRequirement));
        return;
      }

      showToast(`Connect ${joinReadable(missingRequirements.map(requirementLabel))} first.`);
      return;
    }

    if (template.minimumPlan === "starter" && plan === "free") {
      await upgrade({ plan: "starter", period: "monthly", currency: "inr" });
      return;
    }

    if (activeCount >= activeTaskLimit) {
      showToast(
        `Your ${plan} plan allows ${activeTaskLimit} active task${activeTaskLimit === 1 ? "" : "s"}. Disable one or upgrade to add more.`,
      );
      if (plan === "free") {
        await upgrade({ plan: "starter", period: "monthly", currency: "inr" });
      }
      return;
    }

    setTaskCreating((current) => ({ ...current, [taskType]: true }));

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/auth");
        return;
      }

      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          task_type: taskType,
          schedule_time: template.installDefaults?.scheduleTime ?? null,
          schedule_days: template.installDefaults?.scheduleDays ?? null,
          config: template.installDefaults?.config ?? {},
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        showToast(payload.error || "Failed to add task.");
        return;
      }

      showToast(`${template.name} added`);
      closePanel();
      setPendingDashboardJumpTarget(`task-${taskType}`);
      refetch();
    } catch {
      showToast("Network error. Please try again.");
    } finally {
      setTaskCreating((current) => ({ ...current, [taskType]: false }));
    }
  }

  async function handleTaskToggle(taskId: string, nextEnabled: boolean) {
    if (!supabase) {
      showToast("Auth not configured.");
      return;
    }

    if (nextEnabled && activeCount >= activeTaskLimit) {
      showToast(
        `Your ${plan} plan allows ${activeTaskLimit} active task${activeTaskLimit === 1 ? "" : "s"}. Upgrade to enable more.`,
      );
      if (plan === "free") {
        await upgrade({ plan: "starter", period: "monthly", currency: "inr" });
      }
      return;
    }

    if (nextEnabled && isLimitReached) {
      showToast(`Daily limit reached (${dailyLimit} runs). Upgrade for more runs.`);
      return;
    }

    setTaskToggling((current) => ({ ...current, [taskId]: true }));

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/auth");
        return;
      }

      const response = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ is_enabled: nextEnabled }),
      });

      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };

      if (!response.ok) {
        showToast(json.error || "Failed to update task.");
        if (json.code === "TASK_LIMIT_REACHED" && plan === "free") {
          await upgrade({ plan: "starter", period: "monthly", currency: "inr" });
        }
        return;
      }

      showToast(nextEnabled ? "Task enabled \u2713" : "Task disabled");
      refetch();
    } catch {
      showToast("Network error. Please try again.");
    } finally {
      setTaskToggling((current) => ({ ...current, [taskId]: false }));
    }
  }

  function handleAgentToggle() {
    openAgentPanel();
  }

  function focusCommandInputWithValue(value: string) {
    setCommandInput(value);
    commandInputRef.current?.focus();
  }

  async function handleJournalConsentDecision(
    consent: DashboardJournalAppAccessConsent,
    decision: "approve" | "deny",
  ) {
    if (!supabase) {
      showToast("Auth not configured.");
      return;
    }

    if (consentSubmittingToken === consent.token) {
      return;
    }

    setConsentSubmittingToken(consent.token);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/auth");
        return;
      }

      const response = await fetch("/api/agent/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          consentToken: consent.token,
          consentDecision: decision,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as AgentMessagePayload;

      if (!response.ok) {
        appendJournalMessage("bot", payload.error || "Sorry, I could not complete that approval.");
        showToast(payload.error || "Approval failed.");
        return;
      }

      updateJournalConsentStatus(
        consent.token,
        decision === "approve" ? "approved" : "denied",
      );

      if (payload.response?.trim()) {
        showTypedJournalBotReply(payload.response.trim(), {
          liveAnswerBundle: payload.liveAnswerBundle ?? null,
          modelAuditTrail: payload.modelAuditTrail ?? null,
        });
      }

      showToast(
        decision === "approve"
          ? `${consent.summary} approved`
          : `${consent.summary} cancelled`,
      );
    } catch {
      appendJournalMessage("bot", "Network error. Please try again.");
      showToast("Network error. Please try again.");
    } finally {
      setConsentSubmittingToken(null);
    }
  }

  async function handleJournalConversationStyleDecision(
    request: DashboardJournalConversationStyleRequest,
    style: "professional" | "casual",
  ) {
    if (!supabase) {
      showToast("Auth not configured.");
      return;
    }

    if (consentSubmittingToken === request.token) {
      return;
    }

    setConsentSubmittingToken(request.token);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        router.replace("/auth");
        return;
      }

      const response = await fetch("/api/agent/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: style === "professional" ? request.professionalLabel : request.casualLabel,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as AgentMessagePayload;

      if (!response.ok) {
        appendJournalMessage("bot", payload.error || "Sorry, I could not apply that style.");
        showToast(payload.error || "Style update failed.");
        return;
      }

      updateJournalConversationStyleStatus(request.token, style);

      if (payload.response?.trim()) {
        showTypedJournalBotReply(payload.response.trim(), {
          appAccessConsent: payload.consentRequest
            ? {
                ...payload.consentRequest,
                status: payload.consentRequest.status ?? "pending",
              }
            : null,
          conversationStyleRequest: payload.styleRequest
            ? {
                ...payload.styleRequest,
                status: payload.styleRequest.status ?? "pending",
              }
            : null,
          liveAnswerBundle: payload.liveAnswerBundle ?? null,
          modelAuditTrail: payload.modelAuditTrail ?? null,
        });
      }

      showToast(style === "professional" ? "Professional mode selected" : "Casual mode selected");
    } catch {
      appendJournalMessage("bot", "Network error. Please try again.");
      showToast("Network error. Please try again.");
    } finally {
      setConsentSubmittingToken(null);
    }
  }

  async function submitAgentCommand(value: string) {
    if (!value) {
      showToast("Type a command first");
      return;
    }

    if (!agentOn) {
      showToast("Resume the agent before sending commands");
      return;
    }

    if (!supabase) {
      showToast("Auth not configured.");
      return;
    }

    appendJournalMessage("user", value);
    clearPendingResponses();
    setTypingVisible(true);
    setSendingCommand(true);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      if (!token) {
        setTypingVisible(false);
        router.replace("/auth");
        return;
      }

      const response = await fetch("/api/agent/message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: value }),
      });

      const payload = (await response.json().catch(() => ({}))) as AgentMessagePayload;

      if (!response.ok) {
        setTypingVisible(false);
        appendJournalMessage("bot", payload.error || "Sorry, I could not complete that request.");
        showToast(payload.error || "Command failed.");
        return;
      }

      showTypedJournalBotReply(
        payload.response?.trim() || "Sorry, I could not generate a response for that yet.",
        {
          liveAnswerBundle: payload.liveAnswerBundle ?? null,
          modelAuditTrail: payload.modelAuditTrail ?? null,
          appAccessConsent: payload.consentRequest
            ? {
                ...payload.consentRequest,
                status: payload.consentRequest.status ?? "pending",
              }
            : null,
          conversationStyleRequest: payload.styleRequest
            ? {
                ...payload.styleRequest,
                status: payload.styleRequest.status ?? "pending",
              }
            : null,
        },
      );
      showToast(
        payload.consentRequest
          ? "Security approval required"
          : payload.styleRequest
            ? "Choose Professional or Casual"
            : "Command sent to your agent",
      );
    } catch {
      setTypingVisible(false);
      appendJournalMessage("bot", "Network error. Please try again.");
      showToast("Network error. Please try again.");
    } finally {
      setSendingCommand(false);
    }
  }

  async function handleCommandSubmit() {
    const value = commandInput.trim();
    if (!value) {
      await submitAgentCommand(value);
      return;
    }

    setCommandInput("");
    await submitAgentCommand(value);
  }

  function handleCommandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleCommandSubmit();
    }
  }

  function handleSendQuickMessage() {
    const helloPrompt = "Hello! What can you do?";

    if (previewMode) {
      appendJournalMessage("user", helloPrompt);
      queueBotReply(
        `Hi ${firstName}! I can summarise your inbox, draft email replies, remind you of meetings, search your emails, and more. Just tell me what you need.`,
        300,
        1200,
      );
      showToast("Preview message sent \u2713");
      return;
    }

    if (liveDashboardUnavailable) {
      showToast("Live dashboard chat is unavailable right now.");
      return;
    }

    if (!agentOn) {
      showToast("Resume the agent before sending commands");
      return;
    }

    void submitAgentCommand(helloPrompt);
  }

  async function handleSignOut() {
    const authClient = supabase;

    if (!authClient) {
      return;
    }

    setSigningOut(true);
    const { error: signOutError } = await authClient.auth.signOut();
    setSigningOut(false);

    if (signOutError) {
      setError(signOutError.message);
      showToast(signOutError.message);
      return;
    }

    router.replace("/auth");
  }

  return (
    <main className={styles.shell}>
      <div
        className={`${styles.sidebarOverlay} ${sidebarOpen ? styles.sidebarOverlayOpen : ""}`}
        onClick={closeSidebar}
      />
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <Link href="/" className={styles.sidebarLogo} onClick={closeSidebar}>
          <span className={styles.logoIcon}>{ICONS.lobster}</span>
          <span>
            Claw<span className={styles.logoAccent}>Cloud</span>
          </span>
        </Link>

        <div className={styles.sidebarNav}>
          <div className={styles.navSectionLabel}>Main</div>
          <button type="button" className={`${styles.navItem} ${styles.navItemActive}`}>
            <span className={styles.navIcon}>{ICONS.dashboard}</span>
            Dashboard
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={openAgentPanel}
          >
            <span className={styles.navIcon}>{ICONS.robot}</span>
            My Agent
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={openTaskLibraryPanel}
          >
            <span className={styles.navIcon}>{ICONS.zap}</span>
            Tasks
            {hasLiveDashboardData ? <span className={styles.navBadge}>{liveTasks.length}</span> : null}
          </button>

          <div className={styles.navSectionLabel}>Connections</div>
          <button
            type="button"
            className={styles.navItem}
            onClick={openGmailWorkspace}
          >
            <span className={styles.navIcon}>{ICONS.mail}</span>
            Gmail
            <span
              className={`${styles.navBadge} ${
                connectedProviders.has("gmail") ? styles.navBadgeGreen : ""
              }`}
            >
              {gmailNavLabel}
            </span>
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={openCalendarWorkspace}
          >
            <span className={styles.navIcon}>{ICONS.calendar}</span>
            Calendar
            <span
              className={`${styles.navBadge} ${
                connectedProviders.has("google_calendar") ? styles.navBadgeGreen : ""
              }`}
            >
              {calendarNavLabel}
            </span>
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={openWhatsAppWorkspace}
          >
            <span className={styles.navIcon}>{ICONS.chat}</span>
            WhatsApp
            <span
              className={`${styles.navBadge} ${
                isWhatsAppConnected ? styles.navBadgeGreen : ""
              }`}
            >
              {whatsappNavLabel}
            </span>
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={openSettings}
          >
            <span className={styles.navIcon}>{ICONS.link}</span>
            Add account
          </button>

          <div className={styles.navSectionLabel}>Analytics</div>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => {
              closeSidebar();
              router.push("/activity");
            }}
          >
            <span className={styles.navIcon}>{ICONS.chartBar}</span>
            Activity log
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={openActivityLog}
          >
            <span className={styles.navIcon}>{ICONS.chartUp}</span>
            Usage stats
          </button>

          <div className={styles.navSectionLabel}>Account</div>
          <button
            type="button"
            className={styles.navItem}
            onClick={openSettings}
          >
            <span className={styles.navIcon}>{ICONS.gear}</span>
            Settings
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={handleSignOut}
            disabled={signingOut || loading}
          >
            <span className={styles.navIcon}>{ICONS.arrowLeft}</span>
            {signingOut ? "Signing out..." : "Sign out"}
          </button>
        </div>

        <div className={styles.sidebarUser}>
          <div className={styles.userAvatar}>{initials}</div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>{displayName}</div>
            <div className={styles.userPlan}>
              <span className={styles.planTag}>{sidebarPlanLabel}</span>
            </div>
          </div>
          <span className={styles.userMenu}>{ICONS.dots}</span>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              type="button"
              className={styles.mobileToggle}
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              {ICONS.menu}
            </button>
            <div className={styles.pageTitle}>Dashboard</div>
          </div>

          <div className={styles.topbarRight}>
            <div
              className={`${styles.agentPill} ${
                isLoadingLiveDashboard
                  ? styles.agentPillLoading
                  : hasLiveDashboardData && agentOn
                    ? styles.agentPillOnline
                    : styles.agentPillOffline
              }`}
            >
              <span className={styles.agentDot} />
              <span>{headerAgentLabel}</span>
            </div>

            <button
              type="button"
              className={styles.iconButton}
              title="Notifications"
              onClick={() => showToast("No new notifications")}
            >
              {ICONS.bell}
              <span className={styles.notificationDot} />
            </button>
            <button
              type="button"
              className={styles.iconButton}
              title="Settings"
              onClick={openSettings}
            >
              {ICONS.gear}
            </button>
          </div>
        </header>

        <div className={styles.content}>
          {loading ? (
            <div className={`${styles.statusNote} ${styles.statusLoading}`}>Checking your session...</div>
          ) : null}
          {error ? <div className={`${styles.statusNote} ${styles.statusError}`}>{error}</div> : null}
          {dashboardError ? (
            <div className={`${styles.statusNote} ${styles.statusError}`}>{dashboardError}</div>
          ) : null}
          {previewMode ? (
            <div className={`${styles.statusNote} ${styles.statusPreview}`}>
              Preview mode: showing sample WhatsApp feed and activity because Supabase auth is not
              configured. Live account and task data are not being synced here.
            </div>
          ) : null}

          {isLimitReached && !loading ? (
            <div className={styles.limitBanner}>
              <span>
                {ICONS.lock} Daily limit reached - {dailyLimit} runs used on {planLabel} plan.
              </span>
              <button
                type="button"
                className={styles.limitBannerButton}
                disabled={upgradeLoading}
                onClick={() => void upgrade({ plan: "starter", period: "monthly", currency: "inr" })}
              >
                {upgradeLoading ? "Opening..." : "Upgrade to Starter ->"}
              </button>
            </div>
          ) : null}

          {isLimitWarning && !isLimitReached && !loading ? (
            <div className={`${styles.limitBanner} ${styles.limitBannerWarning}`}>
              <span>
                {ICONS.alarm} Only {runsRemaining} run{runsRemaining === 1 ? "" : "s"} remaining today.
              </span>
              <button
                type="button"
                className={styles.limitBannerButton}
                disabled={upgradeLoading}
                onClick={() => void upgrade({ plan: "starter", period: "monthly", currency: "inr" })}
              >
                {upgradeLoading ? "Opening..." : "Upgrade ->"}
              </button>
            </div>
          ) : null}

          <div className={styles.greeting}>
            <h1 className={styles.greetingTitle}>
              {greeting}, {firstName} {"\u{1F44B}"}
            </h1>
            <p className={styles.greetingText}>{greetingText}</p>
          </div>

          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconGreen}`}>{ICONS.zap}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>today</div>
              </div>
              <div className={styles.statNumber}>
                {dashboardLoading ? "-" : hasLiveDashboardData ? todayRuns : "\u2014"}
              </div>
              <div className={styles.statLabel}>Task runs today</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconBlue}`}>{ICONS.mail}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>today</div>
              </div>
              <div className={styles.statNumber}>
                {dashboardLoading
                  ? "-"
                  : hasLiveDashboardData
                    ? (analytics?.emails_processed ?? 0)
                    : "\u2014"}
              </div>
              <div className={styles.statLabel}>Emails processed</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconAccent}`}>{ICONS.clock}</div>
              </div>
              <div className={styles.statNumber}>
                {dashboardLoading
                  ? "-"
                  : hasLiveDashboardData
                    ? Math.round(((analytics?.minutes_saved ?? 0) / 60) * 10) / 10
                    : "\u2014"}
                {hasLiveDashboardData && !dashboardLoading ? (
                  <span className={styles.statUnit}>hr</span>
                ) : null}
              </div>
              <div className={styles.statLabel}>Time saved today</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconAmber}`}>{ICONS.check}</div>
              </div>
              <div className={styles.statNumber}>
                {dashboardLoading
                  ? "-"
                  : hasLiveDashboardData
                    ? (analytics?.drafts_created ?? 0)
                    : "\u2014"}
              </div>
              <div className={styles.statLabel}>Drafts created today</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconBlue}`}>{ICONS.chartUp}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>
                  {answerObservability?.windowDays ?? 7}d
                </div>
              </div>
              <div className={styles.statNumber}>{answerQualityValue}</div>
              <div className={styles.statLabel}>{answerQualityLabel}</div>
            </div>
          </div>

          <div className={styles.mainGrid}>
            <div className={styles.leftColumn}>
              <div id="tasks-section" className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {ICONS.link} Connected accounts
                  </div>
                  <button
                    type="button"
                    className={styles.cardAction}
                    onClick={openSettings}
                  >
                    + Add account
                  </button>
                </div>

                <div className={styles.accountsWorkspace}>
                  <div className={styles.accountsRail}>
                    <div className={styles.accountsList}>
                      {accounts.map((account) => {
                        const accountTargetId = `connection-${account.id}`;

                        return (
                          <div
                            key={account.id}
                            id={accountTargetId}
                            className={`${styles.accountRow} ${
                              highlightedDashboardTarget === accountTargetId
                                ? styles.accountRowTargeted
                                : ""
                            }`}
                          >
                            <div
                              className={`${styles.accountIcon} ${
                                !account.connected ? styles.accountIconMuted : ""
                              }`}
                            >
                              {account.icon}
                            </div>
                            <div className={styles.accountInfo}>
                              <div
                                className={`${styles.accountName} ${
                                  !account.connected ? styles.accountNameMuted : ""
                                }`}
                              >
                                {account.name}
                              </div>
                              <div className={styles.accountDetail}>{account.detail}</div>
                            </div>
                            {account.stateLabel ? (
                              <div
                                className={`${styles.accountStatus} ${
                                  account.stateLabel === "Lite connected"
                                    ? styles.accountStatusLite
                                    : styles.accountStatusConnected
                                }`}
                              >
                                {`\u25CF ${account.stateLabel}`}
                              </div>
                            ) : (
                              <button
                                type="button"
                                className={styles.connectButton}
                                onClick={() => void handleAccountAction(account.id)}
                              >
                                {account.actionLabel ?? "Open settings"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <div className={styles.accountsOverview}>
                      <div className={styles.accountsOverviewHeader}>
                        <div className={styles.accountsOverviewTitle}>{accountsSummaryTitle}</div>
                        <div className={styles.accountsOverviewMeta}>Workspace overview</div>
                      </div>
                      <div className={styles.accountsOverviewGrid}>
                        <div className={styles.accountsOverviewStat}>
                          <span>Connected</span>
                          <strong>{connectedSurfaceCount}</strong>
                        </div>
                        <div className={styles.accountsOverviewStat}>
                          <span>Setup left</span>
                          <strong>{setupRemainingCount}</strong>
                        </div>
                        <div className={styles.accountsOverviewStat}>
                          <span>Upgrade paths</span>
                          <strong>{upgradeSurfaceCount}</strong>
                        </div>
                      </div>
                      <p className={styles.accountsOverviewText}>{accountsSummaryText}</p>
                      <button
                        type="button"
                        className={styles.accountsOverviewButton}
                        onClick={connectedSurfaceCount > 0 ? focusQuickCommand : openSettings}
                      >
                        {connectedSurfaceCount > 0 ? "Send a command" : "Finish setup"}
                      </button>
                    </div>
                  </div>

                  <div
                    id="whatsapp-workspace"
                    className={`${styles.whatsAppWorkspace} ${
                      highlightedDashboardTarget === "whatsapp-workspace"
                        ? styles.whatsAppWorkspaceTargeted
                        : ""
                    }`}
                  >
                    <div className={styles.workspaceHeader}>
                      <div>
                        <div className={styles.workspaceEyebrow}>WhatsApp workspace</div>
                        <div className={styles.workspaceTitle}>
                          {ICONS.chat} Combined WhatsApp controls
                        </div>
                      </div>
                      <Link href="/whatsapp" className={styles.workspaceLink}>
                        Open advanced workspace
                      </Link>
                    </div>

                    <div className={styles.workspaceStats}>
                      <div className={`${styles.workspaceStat} ${styles.workspaceStatSession}`}>
                        <span className={styles.workspaceStatLabel}>Session</span>
                        <strong className={`${styles.workspaceStatValue} ${styles.workspaceStatStatusValue}`}>
                          <span className={styles.workspaceStatStatusRow}>
                            <span className={`${styles.workspaceStatStatusDot} ${whatsappSessionToneClass}`} />
                            <span className={styles.workspaceStatStatusText}>{whatsappSessionDisplay}</span>
                          </span>
                        </strong>
                        <span className={styles.workspaceStatMeta}>{whatsappSessionMetaDisplay}</span>
                      </div>
                      <div className={styles.workspaceStat}>
                        <span className={styles.workspaceStatLabel}>Pending</span>
                        <strong className={styles.workspaceStatValue}>
                          {hasLiveDashboardData
                            ? (whatsappSummary?.pendingApprovalCount ?? 0)
                            : "\u2014"}
                        </strong>
                      </div>
                      <div className={styles.workspaceStat}>
                        <span className={styles.workspaceStatLabel}>Awaiting</span>
                        <strong className={styles.workspaceStatValue}>
                          {hasLiveDashboardData
                            ? (whatsappSummary?.awaitingReplyCount ?? 0)
                            : "\u2014"}
                        </strong>
                      </div>
                      <div className={styles.workspaceStat}>
                        <span className={styles.workspaceStatLabel}>High priority</span>
                        <strong className={styles.workspaceStatValue}>
                          {hasLiveDashboardData
                            ? (whatsappSummary?.highPriorityCount ?? 0)
                            : "\u2014"}
                        </strong>
                      </div>
                    </div>

                    <div className={styles.workspaceLayout}>
                      <div className={`${styles.workspacePanel} ${styles.workspaceRuntimePanel}`}>
                        <div className={styles.workspacePanelHeader}>
                          <div>
                            <div className={styles.workspacePanelTitle}>Runtime health</div>
                            <div className={styles.workspacePanelSubTitle}>{whatsappRuntimeAutoRefreshDisplay}</div>
                          </div>
                          <div className={`${styles.runtimeBadge} ${whatsappRuntimeBadgeClass}`}>
                            {whatsappRuntimeHealthDisplay}
                          </div>
                        </div>

                        <div className={styles.runtimeHero}>
                          <div className={styles.runtimeHeroCopy}>
                            <span className={styles.runtimeHeroLabel}>Sync progress</span>
                            <strong className={styles.runtimeHeroValue}>
                              {hasLiveDashboardData && whatsappRuntime
                                ? `${whatsappRuntimeHeroPercent}%`
                                : whatsappRuntimeSyncDisplay}
                            </strong>
                            <div className={styles.runtimeHeroMeta}>
                              <span>{whatsappRuntimeSyncStateDisplay}</span>
                              <span>{whatsappRuntimeSyncJobsDisplay}</span>
                            </div>
                          </div>

                          <div className={styles.runtimeHeroAside}>
                            <div className={styles.runtimeHeroStat}>
                              <span>Last sync</span>
                              <strong>{whatsappRuntimeLastSyncDisplay}</strong>
                            </div>
                            <div className={styles.runtimeHeroStat}>
                              <span>Last activity</span>
                              <strong>{whatsappRuntimeLastActivityDisplay}</strong>
                            </div>
                          </div>
                        </div>

                        <div className={styles.runtimeProgressTrackLg}>
                          <span
                            className={`${styles.runtimeProgressFill} ${
                              isWhatsAppActivelySyncing ? styles.runtimeProgressFillSyncing : ""
                            }`}
                            style={{ width: `${whatsappRuntimeHeroPercent}%` }}
                          />
                        </div>

                        {showWhatsAppRuntimeCountdown ? (
                          <div className={styles.runtimeScanTicker}>
                            <div className={styles.runtimeScanTickerCopy}>
                              <span className={styles.runtimeScanTickerLabel}>Scanning more data</span>
                              <strong className={styles.runtimeScanTickerValue}>
                                {whatsappRuntimeCountdownLabel}
                              </strong>
                              <span className={styles.runtimeScanTickerMeta}>
                                {whatsappRuntimeCountdownMeta}
                              </span>
                            </div>
                            <div className={styles.runtimeScanDigits} aria-hidden="true">
                              {whatsappRuntimeRemainingDigits.map((digit, index) => (
                                <span
                                  key={`runtime-scan-digit-${index}-${digit}`}
                                  className={styles.runtimeScanDigit}
                                >
                                  {digit}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className={styles.runtimeBreakdownGrid}>
                          <div className={styles.runtimeMetricCard}>
                            <div className={styles.runtimeMetricTop}>
                              <span className={styles.runtimeMetricLabel}>Contacts discovered</span>
                              <span className={styles.runtimeMetricSubvalue}>{whatsappRuntimeContactPercentValue}%</span>
                            </div>
                            <strong className={styles.runtimeMetricValue}>{whatsappRuntimeContactMetricDisplay}</strong>
                            <div className={styles.runtimeMiniTrack}>
                              <span
                                className={styles.runtimeMiniFill}
                                style={{ width: `${whatsappRuntimeContactPercentValue}%` }}
                              />
                            </div>
                          </div>

                          <div className={styles.runtimeMetricCard}>
                            <div className={styles.runtimeMetricTop}>
                              <span className={styles.runtimeMetricLabel}>History coverage</span>
                              <span className={styles.runtimeMetricSubvalue}>{whatsappRuntimeHistoryPercentValue}%</span>
                            </div>
                            <strong className={styles.runtimeMetricValue}>{whatsappRuntimeHistoryMetricDisplay}</strong>
                            <div className={styles.runtimeMiniTrack}>
                              <span
                                className={styles.runtimeMiniFill}
                                style={{ width: `${whatsappRuntimeHistoryPercentValue}%` }}
                              />
                            </div>
                          </div>

                          <div className={styles.runtimeMetricCard}>
                            <div className={styles.runtimeMetricTop}>
                              <span className={styles.runtimeMetricLabel}>Session state</span>
                              <span className={styles.runtimeMetricSubvalue}>{whatsappSessionMetaDisplay}</span>
                            </div>
                            <strong className={styles.runtimeMetricValue}>{whatsappRuntimeSyncStateDisplay}</strong>
                            <span className={styles.runtimeMetricSubvalue}>{whatsappRuntimeLiveCountsDisplay}</span>
                          </div>
                        </div>

                        <div className={`${styles.workspaceEmpty} ${styles.workspacePanelNote}`}>{whatsappRuntimeNote}</div>
                      </div>

                      <div className={styles.workspaceColumns}>
                        <div className={styles.workspacePanel}>
                          <div className={styles.workspacePanelTitle}>Automation rules</div>
                          <div className={styles.workspaceRows}>
                            <div className={styles.workspaceRow}>
                              <span className={styles.workspaceRowLabel}>Mode</span>
                              <span className={styles.workspaceRowValue}>{automationModeDisplay}</span>
                            </div>
                            <div className={styles.workspaceRow}>
                              <span className={styles.workspaceRowLabel}>Reply tone</span>
                              <span className={styles.workspaceRowValue}>{replyToneDisplay}</span>
                            </div>
                            <div className={styles.workspaceRow}>
                              <span className={styles.workspaceRowLabel}>Group behavior</span>
                              <span className={styles.workspaceRowValue}>{groupBehaviorDisplay}</span>
                            </div>
                            <div className={styles.workspaceRow}>
                              <span className={styles.workspaceRowLabel}>Sensitive-content safeguard</span>
                              <span className={styles.workspaceRowValue}>{sensitiveApprovalDisplay}</span>
                            </div>
                            <div className={styles.workspaceRow}>
                              <span className={styles.workspaceRowLabel}>Quiet hours</span>
                              <span className={styles.workspaceRowValue}>{quietHoursDisplay}</span>
                            </div>
                          </div>
                        </div>

                        <div className={styles.workspacePanel}>
                          <div className={styles.workspacePanelTitle}>Pending approvals</div>
                          {whatsappApprovals.length > 0 ? (
                            <div className={styles.workspaceStack}>
                              {whatsappApprovals.slice(0, 2).map((approval) => (
                                <div key={approval.id} className={styles.workspaceCard}>
                                  <div className={styles.workspaceCardTop}>
                                    <strong>{approval.contact_name || approval.remote_phone || "Contact"}</strong>
                                    <span className={styles.workspaceCardMeta}>{approval.sensitivity}</span>
                                  </div>
                                  <p className={styles.workspaceSnippet}>{approval.source_message}</p>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className={`${styles.workspaceEmpty} ${styles.workspaceEmptyState}`}>
                              {whatsappApprovalsEmptyText}
                            </div>
                          )}
                        </div>

                        <div className={styles.workspacePanel}>
                          <div className={styles.workspacePanelTitle}>Inbox priorities</div>
                          {whatsappPreviewContacts.length > 0 ? (
                            <div className={styles.workspaceStack}>
                              {whatsappPreviewContacts.map((contact) => (
                                <div key={contact.jid} className={styles.workspaceCard}>
                                  <div className={styles.workspaceCardTop}>
                                    <strong>{contact.display_name}</strong>
                                    <span className={styles.workspaceCardMeta}>{contact.priority}</span>
                                  </div>
                                  <div className={styles.workspaceCardSubmeta}>
                                    {contact.awaiting_reply ? "Awaiting reply" : "Monitoring"} |{" "}
                                    {formatCompactDateTime(contact.last_message_at || contact.last_seen_at)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className={`${styles.workspaceEmpty} ${styles.workspaceEmptyState}`}>
                              {whatsappContactsEmptyText}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {ICONS.zap} AI tasks
                    <span className={styles.cardTitleMeta}>
                      {tasksSummaryText}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.cardAction}
                    onClick={openTaskLibraryPanel}
                  >
                    + Add task
                  </button>
                </div>

                <div className={styles.runUsageBar}>
                  <div className={styles.runUsageTop}>
                    <span className={styles.runUsageLabel}>Daily task runs</span>
                    <span
                      className={`${styles.runUsageCount} ${
                        isLimitReached
                          ? styles.runUsageCountDanger
                          : isLimitWarning
                            ? styles.runUsageCountWarning
                            : ""
                      }`}
                    >
                      {taskRunsDisplay}
                      {hasLiveDashboardData ? (
                        <span className={styles.runUsagePlanNote}> ({plan.toLowerCase()} limit)</span>
                      ) : null}
                    </span>
                  </div>
                  <div className={styles.progressTrack}>
                    <div
                      className={`${styles.progressFill} ${
                        isLimitReached
                          ? styles.progressFillDanger
                          : isLimitWarning
                            ? styles.progressFillWarning
                            : ""
                      }`}
                      style={{ width: `${runPercentage}%` }}
                    />
                  </div>
                  <div className={styles.progressMeta}>{taskUsageMeta}</div>
                </div>

                <div className={styles.tasksList}>
                  {dashboardLoading ? (
                    <div className={styles.tasksLoading}>Loading your tasks...</div>
                  ) : sortedTasks.length === 0 ? (
                    <div className={styles.workspaceEmpty}>{tasksEmptyText}</div>
                  ) : (
                    sortedTasks.map((task) => {
                      const label = TASK_LABELS[task.task_type];
                      if (!label) {
                        return null;
                      }

                      const taskTargetId = `task-${task.task_type}`;
                      const isStarterTask = STARTER_TASKS.has(task.task_type);
                      const needsStarterUpgrade =
                        isStarterTask && plan === "free" && !task.is_enabled;
                      const isToggling = taskToggling[task.id] ?? false;

                      return (
                        <div
                          key={task.id}
                          id={taskTargetId}
                          className={`${styles.taskItem} ${
                            task.is_enabled ? styles.taskItemOn : styles.taskItemMuted
                          } ${needsStarterUpgrade ? styles.taskItemLocked : ""} ${
                            highlightedDashboardTarget === taskTargetId ? styles.taskItemTargeted : ""
                          }`}
                        >
                          <div className={styles.taskTop}>
                            <div className={styles.taskLeft}>
                              <span className={styles.taskEmoji}>{label.icon}</span>
                              <div>
                                <div className={styles.taskName}>
                                  {label.name}
                                  {isStarterTask && plan === "free" ? (
                                    <span className={styles.taskLockedBadge}>
                                      {ICONS.lock} Starter
                                    </span>
                                  ) : null}
                                </div>
                                <div className={styles.taskDescription}>{label.description}</div>
                              </div>
                            </div>

                            {needsStarterUpgrade ? (
                              <button
                                type="button"
                                className={styles.taskUpgradeButton}
                                onClick={() =>
                                  void upgrade({
                                    plan: "starter",
                                    period: "monthly",
                                    currency: "inr",
                                  })
                                }
                              >
                                Upgrade
                              </button>
                            ) : (
                              <label
                                className={`${styles.toggle} ${
                                  isToggling ? styles.toggleLoading : ""
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className={styles.toggleInput}
                                  checked={task.is_enabled}
                                  disabled={
                                    isToggling ||
                                    (!task.is_enabled &&
                                      (isLimitReached || activeCount >= activeTaskLimit))
                                  }
                                  onChange={(event) =>
                                    void handleTaskToggle(task.id, event.target.checked)
                                  }
                                />
                                <span className={styles.toggleTrack} />
                                <span className={styles.toggleThumb} />
                              </label>
                            )}
                          </div>

                          <div className={styles.taskMeta}>
                            {label.tags.map((tag) => (
                              <span key={`${task.id}-${tag}`} className={styles.taskTag}>
                                {tag}
                              </span>
                            ))}
                            {task.total_runs > 0 ? (
                              <span className={styles.taskRuns}>{`\u21BA ${task.total_runs} runs`}</span>
                            ) : null}
                            {task.last_run_at ? (
                              <span className={styles.taskLast}>
                                {`Last: ${formatRelativeTime(task.last_run_at)}`}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className={styles.rightColumn}>
              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {ICONS.robot} Agent status
                  </div>
                  <button type="button" className={styles.cardAction} onClick={handleAgentToggle}>
                    Open My Agent
                  </button>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.statusPanel}>
                    <div className={styles.statusHeaderRow}>
                      <span className={styles.statusLabel}>Status</span>
                      <div
                        className={`${styles.agentPill} ${
                          hasLiveDashboardData && agentOn
                            ? styles.agentPillOnline
                            : styles.agentPillOffline
                        } ${styles.statusPillCompact}`}
                      >
                        <span className={styles.agentDot} />
                        <span>{agentStatusLabel}</span>
                      </div>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Plan</span>
                      <span className={styles.statusValue}>
                        {hasLiveDashboardData ? planLabel : "\u2014"}
                      </span>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Runs today</span>
                      <span className={styles.statusValue}>{taskRunsDisplay}</span>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Active tasks</span>
                      <span className={styles.statusValueAccent}>{activeTasksDisplay}</span>
                    </div>
                  </div>

                  <div className={styles.usageWrap}>
                    <div className={styles.usageHeader}>
                      <span className={styles.statusLabel}>Daily task runs</span>
                      <span className={styles.statusValue}>
                        {taskRunsDisplay}
                        {hasLiveDashboardData ? (
                          <span className={styles.inlineMuted}>{` (${plan.toLowerCase()} limit)`}</span>
                        ) : null}
                      </span>
                    </div>
                    <div className={styles.progressTrack}>
                      <div
                        className={`${styles.progressFill} ${
                          isLimitReached
                            ? styles.progressFillDanger
                            : isLimitWarning
                              ? styles.progressFillWarning
                              : ""
                        }`}
                        style={{ width: `${runPercentage}%` }}
                      />
                    </div>
                    <div className={styles.progressMeta}>{statusUsageMeta}</div>
                  </div>
                </div>
              </div>

              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {ICONS.chat} Daily ClawCloud journal
                  </div>
                  <button type="button" className={styles.cardAction} onClick={handleSendQuickMessage}>
                    Ask hello -&gt;
                  </button>
                </div>

                <div className={styles.waMessages}>
                  <div className={styles.waHeaderBar}>
                    <div className={styles.waAvatar}>{ICONS.robot}</div>
                    <div>
                      <div className={styles.waHeaderName}>ClawCloud dashboard</div>
                      {journalMessages.length > 0 ? (
                        <div className={styles.waHeaderStatus}>{cleanJournalHeaderStatus}</div>
                      ) : null}
                    </div>
                  </div>

                  {visibleJournalThreads.length > 0 ? (
                    <div className={styles.journalTabs}>
                      {visibleJournalThreads.map((thread) => (
                        <button
                          key={thread.id}
                          type="button"
                          className={`${styles.journalTab} ${
                            thread.id === activeJournalId ? styles.journalTabActive : ""
                          }`}
                          onClick={() => handleJournalDaySelect(thread.id)}
                        >
                          <span className={styles.journalTabLabel}>
                            {formatDashboardJournalLabel(thread.dateKey, todayJournalDateKey)}
                          </span>
                          <span className={styles.journalTabMeta}>
                            {thread.messages.length} msg{thread.messages.length === 1 ? "" : "s"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className={styles.waBody}>
                    {journalMessages.length > 0 ? (
                      journalMessages.map((message) => (
                        <div
                          key={message.id}
                          className={`${styles.waMessage} ${
                            message.role === "bot" ? styles.waMessageBot : styles.waMessageUser
                          }`}
                        >
                          <div className={styles.waMessageText}>{renderMessageText(message.text)}</div>
                          {message.liveAnswerBundle ? (
                            <div className={styles.waEvidenceBox}>
                              <div className={styles.waEvidenceHeader}>
                                <span className={styles.waEvidenceLabel}>
                                  {buildLiveAnswerBundleStrategyLabel(message.liveAnswerBundle)} live evidence
                                </span>
                                {formatLiveAnswerBundleGeneratedAt(message.liveAnswerBundle.generatedAt) ? (
                                  <span className={styles.waEvidenceMeta}>
                                    {formatLiveAnswerBundleGeneratedAt(message.liveAnswerBundle.generatedAt)}
                                  </span>
                                ) : null}
                              </div>
                              {message.liveAnswerBundle.sourceSummary.length ? (
                                <div className={styles.waEvidenceSources}>
                                  {message.liveAnswerBundle.sourceSummary.join(" • ")}
                                </div>
                              ) : null}
                              {message.liveAnswerBundle.sourceNote ? (
                                <div className={styles.waEvidenceNote}>
                                  {message.liveAnswerBundle.sourceNote}
                                </div>
                              ) : null}
                              {message.liveAnswerBundle.evidence.length ? (
                                <>
                                  <button
                                    type="button"
                                    className={styles.waEvidenceToggle}
                                    onClick={() => toggleEvidenceInspector(message.id)}
                                  >
                                    {expandedEvidenceMessageIds.includes(message.id)
                                      ? "Hide evidence details"
                                      : `Inspect ${message.liveAnswerBundle.evidence.length} source${message.liveAnswerBundle.evidence.length === 1 ? "" : "s"}`}
                                  </button>
                                  {expandedEvidenceMessageIds.includes(message.id) ? (
                                    <div className={styles.waEvidenceInspector}>
                                      {message.liveAnswerBundle.question ? (
                                        <div className={styles.waEvidenceQuestion}>
                                          <span className={styles.waEvidenceInspectorLabel}>Question</span>
                                          <div>{message.liveAnswerBundle.question}</div>
                                        </div>
                                      ) : null}
                                      <div className={styles.waEvidenceList}>
                                        {message.liveAnswerBundle.evidence.map((item, index) => (
                                          <div key={`${message.id}-${item.domain}-${index}`} className={styles.waEvidenceItem}>
                                            <div className={styles.waEvidenceItemHeader}>
                                              <span className={styles.waEvidenceItemTitle}>{item.title}</span>
                                              <span className={styles.waEvidenceItemKind}>
                                                {formatLiveAnswerEvidenceKind(item.kind)}
                                              </span>
                                            </div>
                                            <div className={styles.waEvidenceItemMeta}>
                                              {item.domain}
                                              {formatLiveAnswerEvidencePublishedAt(item.publishedAt)
                                                ? ` • ${formatLiveAnswerEvidencePublishedAt(item.publishedAt)}`
                                                : ""}
                                            </div>
                                            {item.snippet ? (
                                              <div className={styles.waEvidenceItemSnippet}>{item.snippet}</div>
                                            ) : null}
                                            {item.url ? (
                                              <a
                                                className={styles.waEvidenceItemLink}
                                                href={item.url}
                                                target="_blank"
                                                rel="noreferrer"
                                              >
                                                Open source
                                              </a>
                                            ) : null}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                          ) : null}
                          {message.modelAuditTrail ? (
                            <div className={styles.waTraceBox}>
                              <div className={styles.waTraceHeader}>
                                <span className={styles.waTraceLabel}>Model audit</span>
                                <span className={styles.waTraceMeta}>
                                  {message.modelAuditTrail.responseMode} • {formatModelAuditSelection(message.modelAuditTrail.selectedBy)}
                                </span>
                              </div>
                              <div className={styles.waTraceSummary}>
                                {formatModelAuditIntent(message.modelAuditTrail.intent)} • {formatModelAuditStrategy(message.modelAuditTrail.planner.strategy)}
                                {message.modelAuditTrail.selectedModel ? ` • ${message.modelAuditTrail.selectedModel}` : ""}
                              </div>
                              <button
                                type="button"
                                className={styles.waTraceToggle}
                                onClick={() => toggleModelAuditInspector(message.id)}
                              >
                                {expandedModelAuditMessageIds.includes(message.id)
                                  ? "Hide model audit"
                                  : `Inspect ${message.modelAuditTrail.candidates.length} model${message.modelAuditTrail.candidates.length === 1 ? "" : "s"}`}
                              </button>
                              {expandedModelAuditMessageIds.includes(message.id) ? (
                                <div className={styles.waTraceInspector}>
                                  <div className={styles.waTraceInspectorSection}>
                                    <span className={styles.waTraceInspectorLabel}>Planner</span>
                                    <div className={styles.waTraceInspectorText}>
                                      {formatModelAuditStrategy(message.modelAuditTrail.planner.strategy)} • target {message.modelAuditTrail.planner.targetResponses} • batch {message.modelAuditTrail.planner.generatorBatchSize}
                                    </div>
                                  </div>
                                  <div className={styles.waTraceInspectorSection}>
                                    <span className={styles.waTraceInspectorLabel}>Decision</span>
                                    <div className={styles.waTraceInspectorText}>
                                      {formatModelAuditSelection(message.modelAuditTrail.selectedBy)}
                                      {message.modelAuditTrail.selectedModel ? ` • ${message.modelAuditTrail.selectedModel}` : ""}
                                    </div>
                                  </div>
                                  {message.modelAuditTrail.judge ? (
                                    <div className={styles.waTraceInspectorSection}>
                                      <span className={styles.waTraceInspectorLabel}>Judge</span>
                                      <div className={styles.waTraceInspectorText}>
                                        {message.modelAuditTrail.judge.used
                                          ? `${message.modelAuditTrail.judge.model ?? "Judge"} • ${message.modelAuditTrail.judge.confidence ?? "n/a"} confidence`
                                          : "Not invoked"}
                                        {message.modelAuditTrail.judge.materialDisagreement ? " • disagreement detected" : ""}
                                        {message.modelAuditTrail.judge.needsClarification ? " • clarification needed" : ""}
                                      </div>
                                      {message.modelAuditTrail.judge.reason ? (
                                        <div className={styles.waTraceJudgeReason}>
                                          {message.modelAuditTrail.judge.reason}
                                        </div>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  <div className={styles.waTraceCandidateList}>
                                    {message.modelAuditTrail.candidates.map((candidate, index) => (
                                      <div key={`${message.id}-${candidate.model}-${index}`} className={styles.waTraceCandidate}>
                                        <div className={styles.waTraceCandidateHeader}>
                                          <span className={styles.waTraceCandidateModel}>{candidate.model}</span>
                                          <span className={styles.waTraceCandidateMeta}>
                                            {candidate.tier} • {candidate.status} • {candidate.latencyMs}ms
                                          </span>
                                        </div>
                                        {candidate.heuristicScore !== null ? (
                                          <div className={styles.waTraceCandidateScore}>
                                            score {candidate.heuristicScore}
                                          </div>
                                        ) : null}
                                        {candidate.preview ? (
                                          <div className={styles.waTraceCandidatePreview}>{candidate.preview}</div>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          {message.appAccessConsent ? (
                            <div className={styles.waConsentBox}>
                              {message.appAccessConsent.status === "pending" ? (
                                <div className={styles.waConsentActions}>
                                  <button
                                    type="button"
                                    className={`${styles.waConsentButton} ${styles.waConsentButtonApprove}`}
                                    disabled={consentSubmittingToken === message.appAccessConsent.token}
                                    onClick={() =>
                                      void handleJournalConsentDecision(
                                        message.appAccessConsent!,
                                        "approve",
                                      )
                                    }
                                  >
                                    {consentSubmittingToken === message.appAccessConsent.token
                                      ? "Working..."
                                      : message.appAccessConsent.yesLabel}
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.waConsentButton} ${styles.waConsentButtonDeny}`}
                                    disabled={consentSubmittingToken === message.appAccessConsent.token}
                                    onClick={() =>
                                      void handleJournalConsentDecision(
                                        message.appAccessConsent!,
                                        "deny",
                                      )
                                    }
                                  >
                                    {message.appAccessConsent.noLabel}
                                  </button>
                                </div>
                              ) : (
                                <div className={styles.waConsentResolved}>
                                  {message.appAccessConsent.status === "approved"
                                    ? "Access approved"
                                    : "Access denied"}
                                </div>
                              )}
                            </div>
                          ) : null}
                          {message.conversationStyleRequest ? (
                            <div className={styles.waConsentBox}>
                              {message.conversationStyleRequest.status === "pending" ? (
                                <div className={styles.waConsentActions}>
                                  <button
                                    type="button"
                                    className={`${styles.waConsentButton} ${styles.waConsentButtonApprove}`}
                                    disabled={consentSubmittingToken === message.conversationStyleRequest.token}
                                    onClick={() =>
                                      void handleJournalConversationStyleDecision(
                                        message.conversationStyleRequest!,
                                        "professional",
                                      )
                                    }
                                  >
                                    {consentSubmittingToken === message.conversationStyleRequest.token
                                      ? "Working..."
                                      : message.conversationStyleRequest.professionalLabel}
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.waConsentButton} ${styles.waConsentButtonDeny}`}
                                    disabled={consentSubmittingToken === message.conversationStyleRequest.token}
                                    onClick={() =>
                                      void handleJournalConversationStyleDecision(
                                        message.conversationStyleRequest!,
                                        "casual",
                                      )
                                    }
                                  >
                                    {message.conversationStyleRequest.casualLabel}
                                  </button>
                                </div>
                              ) : (
                                <div className={styles.waConsentResolved}>
                                  {message.conversationStyleRequest.status === "professional"
                                    ? "Professional mode selected"
                                    : "Casual mode selected"}
                                </div>
                              )}
                            </div>
                          ) : null}
                          <div className={styles.waMessageTime}>{message.time}</div>
                        </div>
                      ))
                    ) : (
                      <div className={styles.waEmpty}>{journalEmptyText}</div>
                    )}

                    {typingVisible ? (
                      <div className={styles.waTyping}>
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {ICONS.clipboard} Recent activity
                  </div>
                  <button
                    type="button"
                    className={styles.cardAction}
                    onClick={openActivityLog}
                  >
                    View all
                  </button>
                </div>

                <div className={styles.activityList}>
                  {displayActivity.length > 0 ? (
                    displayActivity.map((item) => (
                      <div key={item.id} className={styles.activityItem}>
                        <div
                          className={`${styles.activityDot} ${
                            item.tone === "green"
                              ? styles.activityDotGreen
                              : item.tone === "blue"
                                ? styles.activityDotBlue
                                : styles.activityDotAmber
                          }`}
                        />
                        <div className={styles.activityBody}>
                          <div className={styles.activityText}>
                            <strong>{item.title}</strong> - {item.detail}
                          </div>
                          <div className={styles.activityTime}>{item.time}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className={styles.workspaceEmpty}>{activityEmptyText}</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.quickCommand}>
            <div className={styles.quickCommandHeader}>
              {ICONS.zap} Quick command - send to your agent
            </div>
            <div className={styles.commandInputRow}>
              <input
                ref={commandInputRef}
                type="text"
                className={styles.commandInput}
                value={commandInput}
                disabled={sendingCommand}
                onChange={(event) => setCommandInput(event.target.value)}
                onKeyDown={handleCommandKeyDown}
                placeholder='Try: "Summarise emails from last week" or "Remind me tomorrow at 9am about project review"'
              />
              <button
                type="button"
                className={styles.commandButton}
                onClick={() => void handleCommandSubmit()}
                disabled={sendingCommand}
              >
                {sendingCommand ? "Sending..." : "Send -&gt;"}
              </button>
            </div>
            <div className={styles.commandSuggestions}>
              {suggestionButtons.map((suggestion) => (
                <button
                  key={suggestion.value}
                  type="button"
                  className={styles.commandChip}
                  onClick={() => focusCommandInputWithValue(suggestion.value)}
                >
                  {suggestion.label}
                </button>
              ))}
            </div>

            <div className={styles.commandStarterPanel}>
              <div className={styles.commandStarterHead}>
                <div>
                  <div className={styles.commandStarterEyebrow}>What can I ask?</div>
                  <div className={styles.commandStarterTitle}>
                    Starter prompts for your connected apps
                  </div>
                </div>
                <div className={styles.commandStarterMeta}>
                  {connectedStarterPromptCount} live
                </div>
              </div>

              <div className={styles.commandStarterGrid}>
                {dashboardStarterPromptSections.map((section) => {
                  const sectionState = starterPromptDashboardState[section.id];
                  const connected = sectionState.connected;

                  return (
                    <div
                      key={section.id}
                      className={`${styles.commandStarterCard} ${
                        connected ? styles.commandStarterCardActive : styles.commandStarterCardMuted
                      }`}
                    >
                      <div className={styles.commandStarterCardHeader}>
                        <div>
                          <div className={styles.commandStarterLabel}>{section.label}</div>
                          <div className={styles.commandStarterDescription}>
                            {sectionState.description}
                          </div>
                        </div>
                        <span
                          className={`${styles.commandStarterStatus} ${
                            connected
                              ? styles.commandStarterStatusActive
                              : styles.commandStarterStatusMuted
                          }`}
                        >
                          {sectionState.statusLabel}
                        </span>
                      </div>

                      {sectionState.note ? (
                        <div className={styles.commandStarterNote}>{sectionState.note}</div>
                      ) : null}

                      <div className={styles.commandStarterExamples}>
                        {section.examples.map((example) => (
                          <button
                            key={example.prompt}
                            type="button"
                            className={styles.commandStarterExample}
                            disabled={!connected}
                            onClick={() => focusCommandInputWithValue(example.prompt)}
                          >
                            {example.label}
                          </button>
                        ))}
                      </div>

                      <button
                        type="button"
                        className={styles.commandStarterAction}
                        onClick={() =>
                          void handleStarterPromptSectionAction(
                            section.id,
                            sectionState.actionIntent,
                          )
                        }
                      >
                        {sectionState.actionLabel}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {plan === "free" && hasLiveDashboardData ? (
            <div className={styles.upgradeBanner}>
              <div className={styles.upgradeInfo}>
                <h3 className={styles.upgradeTitle}>
                  {`You're on the Free plan - ${
                    runsRemaining > 0 ? `${runsRemaining} runs left today` : "limit reached"
                  }`}
                </h3>
                <p className={styles.upgradeText}>
                  Upgrade to Starter for unlimited runs, Telegram, draft sending, and more -
                  just {" \u20B9"}799/month
                </p>
              </div>
              <button
                type="button"
                className={styles.upgradeButton}
                disabled={upgradeLoading}
                onClick={() =>
                  void upgrade({
                    plan: "starter",
                    period: "monthly",
                    currency: "inr",
                  })
                }
              >
                {upgradeLoading ? "Opening..." : "Upgrade to Starter ->"}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {activePanel ? (
        <div className={styles.drawerOverlay} onClick={closePanel}>
          <aside
            className={styles.drawerPanel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dashboard-panel-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.drawerHeader}>
              <div>
                <div className={styles.drawerEyebrow}>
                  {activePanel === "agent" ? "Live control center" : "Install automations"}
                </div>
                <h2 id="dashboard-panel-title" className={styles.drawerTitle}>
                  {activePanel === "agent" ? "My Agent" : "Task Library"}
                </h2>
                <p className={styles.drawerDescription}>
                  {activePanel === "agent"
                    ? "See what your agent can access right now, which automations are running, and what still needs to be connected."
                    : "Install production-ready task templates with honest plan, connection, and capacity checks."}
                </p>
              </div>
              <button type="button" className={styles.drawerClose} onClick={closePanel}>
                Close
              </button>
            </div>

            <div className={styles.drawerBody}>
              {activePanel === "agent" ? (
                <>
                  <section className={styles.drawerSection}>
                    <div className={styles.drawerStatsGrid}>
                      <div className={styles.drawerStatCard}>
                        <span className={styles.drawerStatLabel}>Status</span>
                        <strong className={styles.drawerStatValue}>{agentStatusLabel}</strong>
                        <span className={styles.drawerStatMeta}>{headerAgentLabel}</span>
                      </div>
                      <div className={styles.drawerStatCard}>
                        <span className={styles.drawerStatLabel}>Plan</span>
                        <strong className={styles.drawerStatValue}>
                          {hasLiveDashboardData ? planLabel : previewMode ? "PREVIEW" : "\u2014"}
                        </strong>
                        <span className={styles.drawerStatMeta}>
                          {hasLiveDashboardData
                            ? `${remainingTaskSlots} slot${remainingTaskSlots === 1 ? "" : "s"} free`
                            : "Live limits unavailable"}
                        </span>
                      </div>
                      <div className={styles.drawerStatCard}>
                        <span className={styles.drawerStatLabel}>Runs today</span>
                        <strong className={styles.drawerStatValue}>{taskRunsDisplay}</strong>
                        <span className={styles.drawerStatMeta}>{statusUsageMeta}</span>
                      </div>
                      <div className={styles.drawerStatCard}>
                        <span className={styles.drawerStatLabel}>Automations</span>
                        <strong className={styles.drawerStatValue}>{activeTasksDisplay}</strong>
                        <span className={styles.drawerStatMeta}>
                          {enabledTasks.length > 0
                            ? `${enabledTasks.length} running now`
                            : "No active automations yet"}
                        </span>
                      </div>
                    </div>
                  </section>

                  <section className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Connected surfaces</div>
                    <div className={styles.drawerStack}>
                      {agentConnections.map((connection) => (
                        <div key={connection.label} className={styles.drawerRow}>
                          <div className={styles.drawerRowBody}>
                            <div className={styles.drawerRowTitle}>{connection.label}</div>
                            <div className={styles.drawerRowText}>{connection.detail}</div>
                          </div>
                          <span
                            className={`${styles.drawerBadge} ${
                              connection.tone === "good"
                                ? styles.drawerBadgeGood
                                : connection.tone === "warn"
                                  ? styles.drawerBadgeWarn
                                  : styles.drawerBadgeNeutral
                            }`}
                          >
                            {connection.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Runtime capabilities</div>
                    <div className={styles.drawerStack}>
                      {agentCapabilities.map((capability) => (
                        <div key={capability.label} className={styles.drawerRow}>
                          <div className={styles.drawerRowBody}>
                            <div className={styles.drawerRowTitle}>{capability.label}</div>
                            <div className={styles.drawerRowText}>{capability.detail}</div>
                          </div>
                          <span
                            className={`${styles.drawerBadge} ${
                              capability.available ? styles.drawerBadgeGood : styles.drawerBadgeWarn
                            }`}
                          >
                            {capability.available ? "Ready" : "Blocked"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Active automations</div>
                    {enabledTasks.length > 0 ? (
                      <div className={styles.drawerMiniGrid}>
                        {enabledTasks.map((task) => {
                          const label = TASK_LABELS[task.task_type];
                          if (!label) {
                            return null;
                          }

                          return (
                            <button
                              key={task.id}
                              type="button"
                              className={styles.drawerMiniCard}
                              onClick={() =>
                                jumpToDashboardTarget(`task-${task.task_type}`, "Task card is not available yet.")
                              }
                            >
                              <span className={styles.drawerMiniIcon}>{label.icon}</span>
                              <span className={styles.drawerMiniTitle}>{label.name}</span>
                              <span className={styles.drawerMiniMeta}>
                                {task.last_run_at
                                  ? `Last run ${formatRelativeTime(task.last_run_at)}`
                                  : label.installDefaults?.summary || "On demand"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={styles.drawerEmpty}>
                        No enabled automations yet. Open the task library to install your first live workflow.
                      </div>
                    )}
                  </section>

                  <section className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Quick actions</div>
                    <div className={styles.drawerActionGrid}>
                      <button type="button" className={styles.drawerActionButton} onClick={focusQuickCommand}>
                        Send a command
                      </button>
                      <button type="button" className={styles.drawerActionButton} onClick={openTaskLibraryPanel}>
                        Open task library
                      </button>
                      <button type="button" className={styles.drawerActionButton} onClick={openSettings}>
                        Settings
                      </button>
                      <button type="button" className={styles.drawerActionButton} onClick={openActivityLog}>
                        Activity log
                      </button>
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <section className={styles.drawerSection}>
                    <div className={styles.drawerStatsGrid}>
                      <div className={styles.drawerStatCard}>
                        <span className={styles.drawerStatLabel}>Installed</span>
                        <strong className={styles.drawerStatValue}>{installedLibraryCount}</strong>
                        <span className={styles.drawerStatMeta}>templates already in your workspace</span>
                      </div>
                      <div className={styles.drawerStatCard}>
                        <span className={styles.drawerStatLabel}>Active</span>
                        <strong className={styles.drawerStatValue}>{activeCount}</strong>
                        <span className={styles.drawerStatMeta}>
                          {hasLiveDashboardData ? `${activeTaskLimit} allowed on ${planLabel}` : "Live limit unavailable"}
                        </span>
                      </div>
                      <div className={styles.drawerStatCard}>
                        <span className={styles.drawerStatLabel}>Open capacity</span>
                        <strong className={styles.drawerStatValue}>
                          {hasLiveDashboardData ? remainingTaskSlots : "\u2014"}
                        </strong>
                        <span className={styles.drawerStatMeta}>
                          {hasLiveDashboardData
                            ? `${remainingTaskSlots} more active task${remainingTaskSlots === 1 ? "" : "s"} can be enabled`
                            : "Needs live dashboard data"}
                        </span>
                      </div>
                      <div className={styles.drawerStatCard}>
                        <span className={styles.drawerStatLabel}>Plan</span>
                        <strong className={styles.drawerStatValue}>
                          {hasLiveDashboardData ? planLabel : previewMode ? "PREVIEW" : "\u2014"}
                        </strong>
                        <span className={styles.drawerStatMeta}>
                          {previewMode ? "Preview only" : "Used for install and limit checks"}
                        </span>
                      </div>
                    </div>
                  </section>

                  {previewMode ? (
                    <div className={styles.drawerNotice}>
                      Preview mode is showing the task catalog only. Connect auth to install live tasks.
                    </div>
                  ) : null}
                  {liveDashboardUnavailable ? (
                    <div className={styles.drawerNotice}>
                      Live task status is unavailable right now, so installs are temporarily disabled until dashboard data recovers.
                    </div>
                  ) : null}

                  <section className={styles.drawerSection}>
                    <div className={styles.drawerSectionTitle}>Available templates</div>
                    <div className={styles.drawerTaskGrid}>
                      {taskLibraryEntries.map((entry) => {
                        const { blockedRequirements, existingTask, isAtTaskLimit, isStarterLocked, missingRequirements, targetId, taskType, template } = entry;
                        const isCreating = taskCreating[taskType] ?? false;
                        const requirementText = joinReadable(
                          template.requirements.map(requirementLabel),
                        );
                        const missingRequirementText = joinReadable(
                          missingRequirements.map(requirementLabel),
                        );

                        let actionLabel = "Install task";
                        let action: () => void = () => void handleCreateTask(taskType);

                        if (previewMode) {
                          actionLabel = "Preview only";
                          action = () => showToast("Auth not configured.");
                        } else if (liveDashboardUnavailable) {
                          actionLabel = "Unavailable";
                          action = () => showToast("Live task data is unavailable right now.");
                        } else if (existingTask) {
                          actionLabel = "Open task";
                          action = () =>
                            jumpToDashboardTarget(targetId, "Task card is not available yet.");
                        } else if (missingRequirements.length > 0) {
                          actionLabel = "Open settings";
                          action = openSettings;
                        } else if (isStarterLocked || (isAtTaskLimit && plan === "free")) {
                          actionLabel = "Upgrade";
                          action = () =>
                            void upgrade({ plan: "starter", period: "monthly", currency: "inr" });
                        } else if (isAtTaskLimit) {
                          actionLabel = "Manage tasks";
                          action = () =>
                            jumpToDashboardTarget(
                              "tasks-section",
                              "Open your task list to manage capacity.",
                            );
                        }

                        let statusText = `Requirements: ${requirementText}. ${
                          template.installDefaults?.summary || "Runs on demand"
                        }.`;

                        if (previewMode) {
                          statusText = "Preview mode does not install live tasks.";
                        } else if (liveDashboardUnavailable) {
                          statusText = "Live task status is unavailable right now.";
                        } else if (existingTask) {
                          statusText = existingTask.is_enabled
                            ? "Installed and currently active in your workspace."
                            : "Installed but paused. Open the task card to enable it again.";
                        } else if (blockedRequirements.length > 0) {
                          statusText = getRequirementBlockedReason(blockedRequirements[0]);
                        } else if (missingRequirements.length > 0) {
                          statusText = `Connect ${missingRequirementText} before installing this task.`;
                        } else if (isStarterLocked) {
                          statusText = "Upgrade to Starter to install this scheduled summary.";
                        } else if (isAtTaskLimit) {
                          statusText = `Your ${plan} plan is already using all ${activeTaskLimit} active task slots.`;
                        }

                        return (
                          <div
                            key={taskType}
                            className={`${styles.drawerTaskCard} ${
                              existingTask ? styles.drawerTaskCardInstalled : ""
                            } ${isCreating ? styles.drawerTaskCardLoading : ""}`}
                          >
                            <div className={styles.drawerTaskTop}>
                              <div className={styles.drawerTaskMain}>
                                <span className={styles.drawerTaskIcon}>{template.icon}</span>
                                <div className={styles.drawerTaskText}>
                                  <div className={styles.drawerTaskTitleRow}>
                                    <div className={styles.drawerTaskTitle}>{template.name}</div>
                                    {template.minimumPlan !== "free" ? (
                                      <span className={`${styles.drawerBadge} ${styles.drawerBadgeWarn}`}>
                                        {titleCaseWords(template.minimumPlan)}
                                      </span>
                                    ) : null}
                                    {existingTask ? (
                                      <span
                                        className={`${styles.drawerBadge} ${
                                          existingTask.is_enabled
                                            ? styles.drawerBadgeGood
                                            : styles.drawerBadgeNeutral
                                        }`}
                                      >
                                        {existingTask.is_enabled ? "Installed" : "Paused"}
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className={styles.drawerTaskDescription}>{template.description}</div>
                                </div>
                              </div>
                              <button
                                type="button"
                                className={styles.drawerPrimaryButton}
                                disabled={isCreating}
                                onClick={action}
                              >
                                {isCreating ? "Installing..." : actionLabel}
                              </button>
                            </div>

                            <div className={styles.drawerTaskMeta}>
                              <span className={styles.drawerMetaChip}>
                                {template.installDefaults?.summary || "On demand"}
                              </span>
                              {template.tags.map((tag) => (
                                <span key={`${taskType}-${tag}`} className={styles.drawerMetaChip}>
                                  {tag}
                                </span>
                              ))}
                            </div>

                            <div className={styles.drawerTaskStatus}>{statusText}</div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      <div className={`${styles.toast} ${toastVisible ? styles.toastVisible : ""}`} role="status">
        {toastMessage || "Copied!"}
      </div>
    </main>
  );
}
