"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { useDashboardData } from "@/hooks/useDashboardData";
import { useUpgrade } from "@/hooks/useUpgrade";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./dashboard-shell.module.css";

type DashboardShellProps = {
  config: PublicAppConfig;
};

type ChatMessage = {
  id: string;
  role: "bot" | "user";
  text: string;
  time: string;
};

type ActivityItem = {
  id: string;
  tone: "green" | "blue" | "amber";
  title: string;
  detail: string;
  time: string;
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

const TASK_LABELS: Record<
  string,
  { name: string; description: string; icon: string; tags: string[] }
> = {
  morning_briefing: {
    name: "Morning email briefing",
    description: "Summarises your inbox and sends a daily briefing to WhatsApp at 7:00 AM",
    icon: ICONS.sun,
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, "\u{1F556} 7:00 AM daily"],
  },
  draft_replies: {
    name: "Draft email replies",
    description: 'Say "draft reply to [name]" on WhatsApp and your AI writes it to Gmail drafts',
    icon: ICONS.pencil,
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, `${ICONS.zap} On demand`],
  },
  meeting_reminders: {
    name: "Meeting reminders",
    description: "Sends a WhatsApp reminder 30 mins before each meeting with email context",
    icon: ICONS.calendar,
    tags: [`${ICONS.calendar} Calendar`, `${ICONS.chat} WhatsApp`, `${ICONS.alarm} 30min before`],
  },
  email_search: {
    name: "Search my email",
    description: 'Ask "what did [person] say about [topic]?" and get an instant summary',
    icon: ICONS.search,
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, `${ICONS.zap} On demand`],
  },
  evening_summary: {
    name: "Evening summary",
    description: "End-of-day recap: what you did, what needs attention tomorrow",
    icon: ICONS.moon,
    tags: [`${ICONS.mail} Gmail`, `${ICONS.calendar} Calendar`, "\u{1F558} 9:00 PM daily"],
  },
  custom_reminder: {
    name: "Smart reminders",
    description: 'Say "Remind me at 5pm to call Priya" on WhatsApp',
    icon: ICONS.alarm,
    tags: [`${ICONS.chat} WhatsApp`, `${ICONS.zap} On demand`],
  },
  weekly_spend: {
    name: "Weekly spend summary",
    description: "Summarises your recent spending and sends a weekly update",
    icon: "\u{1F4B3}",
    tags: [`${ICONS.chat} WhatsApp`, `${ICONS.zap} Weekly`],
  },
};

const TASK_TYPE_ORDER = [
  "morning_briefing",
  "draft_replies",
  "meeting_reminders",
  "email_search",
  "evening_summary",
  "custom_reminder",
  "weekly_spend",
];

const STARTER_TASKS = new Set(["evening_summary", "draft_replies"]);

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const compactDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

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

function formatMessageTime(date = new Date()) {
  return `${timeFormatter.format(date)} \u2713\u2713`;
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

function titleCaseWords(value: string) {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
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

function createSeedMessages(firstName: string): ChatMessage[] {
  const greeting = getTimeGreeting();

  return [
    {
      id: "seed-1",
      role: "bot",
      text: `${greeting} ${firstName}! ${ICONS.sun} You have **31 emails** - 4 need replies. Want me to draft them?`,
      time: "7:00 AM \u2713\u2713",
    },
    {
      id: "seed-2",
      role: "user",
      text: "Yes draft them all",
      time: "7:01 AM \u2713\u2713",
    },
    {
      id: "seed-3",
      role: "bot",
      text: `Done ${ICONS.check} 4 drafts saved to Gmail. Your **10am call** is in 30 mins. Want a briefing?`,
      time: "7:01 AM \u2713\u2713",
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

  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const responseTimersRef = useRef<number[]>([]);
  const messageIdRef = useRef(3);

  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [agentOn, setAgentOn] = useState(true);
  const [greeting, setGreeting] = useState("Welcome back");
  const [messages, setMessages] = useState<ChatMessage[]>(() => createSeedMessages("Rahul"));
  const [hasInteractiveMessages, setHasInteractiveMessages] = useState(false);
  const [typingVisible, setTypingVisible] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [sendingCommand, setSendingCommand] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [taskToggling, setTaskToggling] = useState<Record<string, boolean>>({});

  const plan = (dashboardData?.user?.plan ?? "free") as "free" | "starter" | "pro";
  const planLabel = plan.toUpperCase();
  const agentStatus = dashboardData?.agent_status;
  const analytics = dashboardData?.analytics?.today;
  const todayRuns = agentStatus?.today_runs ?? 0;
  const dailyLimit = agentStatus?.daily_limit ?? 10;
  const runsRemaining = agentStatus?.runs_remaining ?? dailyLimit;
  const activeTaskLimit = agentStatus?.active_task_limit ?? 3;
  const isLimitReached = runsRemaining <= 0;
  const isLimitWarning = !isLimitReached && runsRemaining <= 2;
  const runPercentage = dailyLimit > 0 ? Math.min((todayRuns / dailyLimit) * 100, 100) : 0;
  const whatsappWorkspace = dashboardData?.whatsapp_workspace;
  const whatsappSummary = whatsappWorkspace?.summary;
  const whatsappSettings = whatsappWorkspace?.settings;
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
  const whatsappPreviewWorkflows = (whatsappWorkspace?.workflows ?? []).slice(0, 4);
  const whatsappPreviewHistory = (whatsappWorkspace?.history ?? []).slice(0, 4);

  const liveTasks = dashboardData?.tasks ?? [];
  const sortedTasks = TASK_TYPE_ORDER
    .map((taskType) => liveTasks.find((task) => task.task_type === taskType))
    .filter((task): task is (typeof liveTasks)[number] => Boolean(task));

  const displayName = userName || dashboardData?.user?.full_name || "Rahul Kumar";
  const displayEmail = userEmail || dashboardData?.user?.email || "rahul.kumar@gmail.com";
  const firstName = displayName.split(" ")[0] || "Rahul";
  const initials = getInitials(displayName, displayEmail);
  const activeCount = liveTasks.filter((task) => task.is_enabled).length;

  const connectedProviders = new Set(
    (dashboardData?.connected_accounts ?? [])
      .filter((account) => account.is_active)
      .map((account) => account.provider),
  );
  const isWhatsAppConnected = connectedProviders.has("whatsapp") || Boolean(whatsappSummary?.connected);
  const feedMessages =
    hasInteractiveMessages
      ? messages
      : whatsappPreviewHistory.length > 0
        ? [...whatsappPreviewHistory]
            .reverse()
            .map((entry) => ({
              id: `wa-${entry.id}`,
              role: entry.direction === "outbound" ? ("user" as const) : ("bot" as const),
              text: entry.content,
              time: formatRelativeTime(entry.sent_at),
            }))
        : createSeedMessages(firstName);

  const accounts = [
    {
      id: "gmail",
      icon: ICONS.mail,
      name: "Gmail",
      detail:
        dashboardData?.connected_accounts.find((account) => account.provider === "gmail")
          ?.account_email || displayEmail,
      status: connectedProviders.has("gmail") ? ("connected" as const) : ("upgrade" as const),
      upgradeCopy: "Connect Gmail in settings",
    },
    {
      id: "calendar",
      icon: ICONS.calendar,
      name: "Google Calendar",
      detail: connectedProviders.has("google_calendar") ? "Connected" : "Connect in settings",
      status: connectedProviders.has("google_calendar")
        ? ("connected" as const)
        : ("upgrade" as const),
      upgradeCopy: "Connect Calendar in settings",
    },
    {
      id: "whatsapp",
      icon: ICONS.chat,
      name: "WhatsApp",
      detail:
        dashboardData?.connected_accounts.find((account) => account.provider === "whatsapp")
          ?.phone_number || "Connect in settings",
      status: isWhatsAppConnected
        ? ("connected" as const)
        : ("upgrade" as const),
      upgradeCopy: isWhatsAppConnected ? "Open WhatsApp controls" : "Connect WhatsApp in settings",
    },
    {
      id: "telegram",
      icon: ICONS.phone,
      name: "Telegram",
      detail: connectedProviders.has("telegram")
        ? "Connected"
        : "Available on Starter plan",
      status: connectedProviders.has("telegram")
        ? ("connected" as const)
        : ("upgrade" as const),
      upgradeCopy: "Upgrade to Starter to connect Telegram",
    },
    {
      id: "slack",
      icon: ICONS.bell,
      name: "Slack",
      detail: "Available on Pro plan",
      status: "upgrade" as const,
      upgradeCopy: "Upgrade to Pro to connect Slack",
    },
  ];

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
      : [
          {
            id: "activity-1",
            tone: "green" as const,
            title: "Morning briefing sent",
            detail: "Summary delivered to WhatsApp",
            time: "Today, 7:00 AM",
          },
          {
            id: "activity-2",
            tone: "blue" as const,
            title: "Draft replies",
            detail: "Saved to Gmail drafts",
            time: "Today, 7:01 AM",
          },
        ];

  useEffect(() => {
    setGreeting(getTimeGreeting());
  }, []);

  useEffect(() => {
    if (agentStatus) {
      setAgentOn(agentStatus.is_active);
    }
  }, [agentStatus]);

  useEffect(() => {
    if (!hasInteractiveMessages) {
      setMessages(createSeedMessages(firstName));
    }
  }, [firstName, hasInteractiveMessages]);

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

  function appendMessage(role: ChatMessage["role"], text: string) {
    messageIdRef.current += 1;

    setMessages((current) => [
      ...current,
      {
        id: `msg-${messageIdRef.current}`,
        role,
        text,
        time: formatMessageTime(new Date()),
      },
    ]);
  }

  function queueBotReply(text: string, startDelayMs: number, typingDelayMs: number) {
    clearPendingResponses();

    queueResponse(() => {
      setTypingVisible(true);

      queueResponse(() => {
        setTypingVisible(false);
        appendMessage("bot", text);
      }, typingDelayMs);
    }, startDelayMs);
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  function openSettings() {
    closeSidebar();
    router.push("/settings");
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
    const nextState = !agentOn;
    setAgentOn(nextState);
    showToast(nextState ? "Agent is now running" : "Agent paused - no tasks will run");
  }

  function focusCommandInputWithValue(value: string) {
    setCommandInput(value);
    commandInputRef.current?.focus();
  }

  async function handleCommandSubmit() {
    const value = commandInput.trim();

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

    setHasInteractiveMessages(true);
    appendMessage("user", value);
    setCommandInput("");
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

      const payload = (await response.json().catch(() => ({}))) as {
        response?: string | null;
        error?: string;
      };

      setTypingVisible(false);

      if (!response.ok) {
        appendMessage("bot", payload.error || "Sorry, I could not complete that request.");
        showToast(payload.error || "Command failed.");
        return;
      }

      appendMessage(
        "bot",
        payload.response?.trim() || "Sorry, I could not generate a response for that yet.",
      );
      showToast("Command sent to your agent");
    } catch {
      setTypingVisible(false);
      appendMessage("bot", "Network error. Please try again.");
      showToast("Network error. Please try again.");
    } finally {
      setSendingCommand(false);
    }
  }

  function handleCommandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void handleCommandSubmit();
    }
  }

  function handleSendQuickMessage() {
    if (!agentOn) {
      showToast("Resume the agent before sending commands");
      return;
    }

    setHasInteractiveMessages(true);
    appendMessage("user", "Hello! What can you do?");
    queueBotReply(
      `Hi ${firstName}! I can summarise your inbox, draft email replies, remind you of meetings, search your emails, and more. Just tell me what you need.`,
      300,
      1200,
    );
    showToast("Test message sent \u2713");
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
            onClick={() => showToast("My Agent coming soon")}
          >
            <span className={styles.navIcon}>{ICONS.robot}</span>
            My Agent
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => showToast("Opening tasks...")}
          >
            <span className={styles.navIcon}>{ICONS.zap}</span>
            Tasks
            <span className={styles.navBadge}>6</span>
          </button>

          <div className={styles.navSectionLabel}>Connections</div>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => showToast("Gmail connected")}
          >
            <span className={styles.navIcon}>{ICONS.mail}</span>
            Gmail
            <span className={`${styles.navBadge} ${styles.navBadgeGreen}`}>On</span>
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => showToast("Calendar connected")}
          >
            <span className={styles.navIcon}>{ICONS.calendar}</span>
            Calendar
            <span className={`${styles.navBadge} ${styles.navBadgeGreen}`}>On</span>
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => showToast("WhatsApp connected")}
          >
            <span className={styles.navIcon}>{ICONS.chat}</span>
            WhatsApp
            <span className={`${styles.navBadge} ${styles.navBadgeGreen}`}>On</span>
          </button>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => showToast("Opening account manager...")}
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
            onClick={() => showToast("Opening usage stats...")}
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
              <span className={styles.planTag}>{planLabel}</span>
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
              className={`${styles.agentPill} ${agentOn ? styles.agentPillOnline : styles.agentPillOffline}`}
            >
              <span className={styles.agentDot} />
              <span>{agentOn ? "Agent online" : "Agent paused"}</span>
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
            <p className={styles.greetingText}>
              {dashboardLoading
                ? "Loading your agent data..."
                : `Your agent is ${agentOn ? "active" : "paused"}. ${runsRemaining} of ${dailyLimit} daily runs remaining.`}
            </p>
          </div>

          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconGreen}`}>{ICONS.zap}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>today</div>
              </div>
              <div className={styles.statNumber}>{dashboardLoading ? "-" : todayRuns}</div>
              <div className={styles.statLabel}>Task runs today</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconBlue}`}>{ICONS.mail}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>today</div>
              </div>
              <div className={styles.statNumber}>
                {dashboardLoading ? "-" : (analytics?.emails_processed ?? 0)}
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
                  : Math.round(((analytics?.minutes_saved ?? 0) / 60) * 10) / 10}
                {!dashboardLoading ? <span className={styles.statUnit}>hr</span> : null}
              </div>
              <div className={styles.statLabel}>Time saved today</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconAmber}`}>{ICONS.check}</div>
              </div>
              <div className={styles.statNumber}>
                {dashboardLoading ? "-" : (analytics?.drafts_created ?? 0)}
              </div>
              <div className={styles.statLabel}>Drafts created today</div>
            </div>
          </div>

          <div className={styles.mainGrid}>
            <div className={styles.leftColumn}>
              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {ICONS.link} Connected accounts
                  </div>
                  <button
                    type="button"
                    className={styles.cardAction}
                    onClick={() => showToast("Opening account manager...")}
                  >
                    + Add account
                  </button>
                </div>

                <div className={styles.accountsWorkspace}>
                  <div className={styles.accountsList}>
                    {accounts.map((account) => (
                      <div key={account.id} className={styles.accountRow}>
                        <div
                          className={`${styles.accountIcon} ${
                            account.status === "upgrade" ? styles.accountIconMuted : ""
                          }`}
                        >
                          {account.icon}
                        </div>
                        <div className={styles.accountInfo}>
                          <div
                            className={`${styles.accountName} ${
                              account.status === "upgrade" ? styles.accountNameMuted : ""
                            }`}
                          >
                            {account.name}
                          </div>
                          <div className={styles.accountDetail}>{account.detail}</div>
                        </div>
                        {account.status === "connected" ? (
                          <div className={`${styles.accountStatus} ${styles.accountStatusConnected}`}>
                            {"\u25CF Connected"}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={styles.connectButton}
                            onClick={() => showToast(account.upgradeCopy ?? "Upgrade required")}
                          >
                            Upgrade -&gt;
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  <div id="whatsapp-workspace" className={styles.whatsAppWorkspace}>
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
                      <div className={styles.workspaceStat}>
                        <span className={styles.workspaceStatLabel}>Session</span>
                        <strong className={styles.workspaceStatValue}>
                          {isWhatsAppConnected ? "Connected" : "Not connected"}
                        </strong>
                      </div>
                      <div className={styles.workspaceStat}>
                        <span className={styles.workspaceStatLabel}>Pending</span>
                        <strong className={styles.workspaceStatValue}>
                          {whatsappSummary?.pendingApprovalCount ?? 0}
                        </strong>
                      </div>
                      <div className={styles.workspaceStat}>
                        <span className={styles.workspaceStatLabel}>Awaiting</span>
                        <strong className={styles.workspaceStatValue}>
                          {whatsappSummary?.awaitingReplyCount ?? 0}
                        </strong>
                      </div>
                      <div className={styles.workspaceStat}>
                        <span className={styles.workspaceStatLabel}>High priority</span>
                        <strong className={styles.workspaceStatValue}>
                          {whatsappSummary?.highPriorityCount ?? 0}
                        </strong>
                      </div>
                    </div>

                    <div className={styles.workspaceGrid}>
                      <div className={styles.workspacePanel}>
                        <div className={styles.workspacePanelTitle}>Automation rules</div>
                        <div className={styles.workspaceRows}>
                          <div className={styles.workspaceRow}>
                            <span className={styles.workspaceRowLabel}>Mode</span>
                            <span className={styles.workspaceRowValue}>
                              {titleCaseWords(whatsappSettings?.automationMode ?? "auto_reply")}
                            </span>
                          </div>
                          <div className={styles.workspaceRow}>
                            <span className={styles.workspaceRowLabel}>Reply tone</span>
                            <span className={styles.workspaceRowValue}>
                              {titleCaseWords(whatsappSettings?.replyMode ?? "balanced")}
                            </span>
                          </div>
                          <div className={styles.workspaceRow}>
                            <span className={styles.workspaceRowLabel}>Group behavior</span>
                            <span className={styles.workspaceRowValue}>
                              {titleCaseWords(whatsappSettings?.groupReplyMode ?? "mention_only")}
                            </span>
                          </div>
                          <div className={styles.workspaceRow}>
                            <span className={styles.workspaceRowLabel}>Sensitive approval</span>
                            <span className={styles.workspaceRowValue}>
                              {whatsappSettings?.requireApprovalForSensitive ? "On" : "Off"}
                            </span>
                          </div>
                          <div className={styles.workspaceRow}>
                            <span className={styles.workspaceRowLabel}>Quiet hours</span>
                            <span className={styles.workspaceRowValue}>
                              {whatsappSettings?.quietHoursStart && whatsappSettings?.quietHoursEnd
                                ? `${whatsappSettings.quietHoursStart} to ${whatsappSettings.quietHoursEnd}`
                                : "Not set"}
                            </span>
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
                          <div className={styles.workspaceEmpty}>
                            No WhatsApp replies are waiting for review right now.
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
                          <div className={styles.workspaceEmpty}>
                            Connect WhatsApp to start building inbox priority rules.
                          </div>
                        )}
                      </div>

                      <div className={styles.workspacePanel}>
                        <div className={styles.workspacePanelTitle}>Workflow studio</div>
                        {whatsappPreviewWorkflows.length > 0 ? (
                          <div className={styles.workspaceStack}>
                            {whatsappPreviewWorkflows.map((workflow) => (
                              <div key={workflow.id} className={styles.workspaceCard}>
                                <div className={styles.workspaceCardTop}>
                                  <strong>{workflow.title}</strong>
                                  <span className={styles.workspaceCardMeta}>
                                    {workflow.is_enabled ? "Enabled" : "Off"}
                                  </span>
                                </div>
                                <div className={styles.workspaceCardSubmeta}>
                                  {workflow.delay_minutes} min | {titleCaseWords(workflow.scope)}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.workspaceEmpty}>
                            Workflow seeds will appear here after your WhatsApp workspace loads.
                          </div>
                        )}
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
                      {activeCount} of {activeTaskLimit} active
                    </span>
                  </div>
                  <button
                    type="button"
                    className={styles.cardAction}
                    onClick={() => showToast("Opening task library...")}
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
                      {todayRuns} / {dailyLimit}
                      <span className={styles.runUsagePlanNote}> ({plan.toLowerCase()} limit)</span>
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
                  <div className={styles.progressMeta}>
                    {isLimitReached
                      ? "Limit reached - upgrade for more runs"
                      : `${runsRemaining} run${runsRemaining === 1 ? "" : "s"} remaining today`}
                  </div>
                </div>

                <div className={styles.tasksList}>
                  {dashboardLoading ? (
                    <div className={styles.tasksLoading}>Loading your tasks...</div>
                  ) : (
                    sortedTasks.map((task) => {
                      const label = TASK_LABELS[task.task_type];
                      if (!label) {
                        return null;
                      }

                      const isStarterOnly = STARTER_TASKS.has(task.task_type) && plan === "free";
                      const isToggling = taskToggling[task.id] ?? false;

                      return (
                        <div
                          key={task.id}
                          className={`${styles.taskItem} ${
                            task.is_enabled ? styles.taskItemOn : styles.taskItemMuted
                          } ${isStarterOnly ? styles.taskItemLocked : ""}`}
                        >
                          <div className={styles.taskTop}>
                            <div className={styles.taskLeft}>
                              <span className={styles.taskEmoji}>{label.icon}</span>
                              <div>
                                <div className={styles.taskName}>
                                  {label.name}
                                  {isStarterOnly ? (
                                    <span className={styles.taskLockedBadge}>
                                      {ICONS.lock} Starter
                                    </span>
                                  ) : null}
                                </div>
                                <div className={styles.taskDescription}>{label.description}</div>
                              </div>
                            </div>

                            {isStarterOnly ? (
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
                    {agentOn ? "Pause agent" : "Resume agent"}
                  </button>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.statusPanel}>
                    <div className={styles.statusHeaderRow}>
                      <span className={styles.statusLabel}>Status</span>
                      <div
                        className={`${styles.agentPill} ${
                          agentOn ? styles.agentPillOnline : styles.agentPillOffline
                        } ${styles.statusPillCompact}`}
                      >
                        <span className={styles.agentDot} />
                        <span>{agentOn ? "Running" : "Paused"}</span>
                      </div>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Plan</span>
                      <span className={styles.statusValue}>{planLabel}</span>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Runs today</span>
                      <span className={styles.statusValue}>{`${todayRuns} / ${dailyLimit}`}</span>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Active tasks</span>
                      <span className={styles.statusValueAccent}>
                        {`${activeCount} / ${activeTaskLimit}`}
                      </span>
                    </div>
                  </div>

                  <div className={styles.usageWrap}>
                    <div className={styles.usageHeader}>
                      <span className={styles.statusLabel}>Daily task runs</span>
                      <span className={styles.statusValue}>
                        {todayRuns} / {dailyLimit}
                        <span className={styles.inlineMuted}>{` (${plan.toLowerCase()} limit)`}</span>
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
                    <div className={styles.progressMeta}>
                      {isLimitReached
                        ? "Limit reached - upgrade to continue"
                        : `${runsRemaining} run${runsRemaining === 1 ? "" : "s"} remaining today`}
                    </div>
                  </div>
                </div>
              </div>

              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {ICONS.chat} Live WhatsApp feed
                  </div>
                  <button type="button" className={styles.cardAction} onClick={handleSendQuickMessage}>
                    Send test -&gt;
                  </button>
                </div>

                <div className={styles.waMessages}>
                  <div className={styles.waHeaderBar}>
                    <div className={styles.waAvatar}>{ICONS.robot}</div>
                    <div>
                      <div className={styles.waHeaderName}>ClawCloud AI</div>
                      <div className={styles.waHeaderStatus}>
                        {isWhatsAppConnected
                          ? `${whatsappSummary?.recentMessageCount ?? 0} messages this week`
                          : "waiting for connection"}
                      </div>
                    </div>
                  </div>

                  <div className={styles.waBody}>
                    {feedMessages.map((message) => (
                      <div
                        key={message.id}
                        className={`${styles.waMessage} ${
                          message.role === "bot" ? styles.waMessageBot : styles.waMessageUser
                        }`}
                      >
                        <div className={styles.waMessageText}>{renderMessageText(message.text)}</div>
                        <div className={styles.waMessageTime}>{message.time}</div>
                      </div>
                    ))}

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
                    onClick={() => router.push("/activity")}
                  >
                    View all
                  </button>
                </div>

                <div className={styles.activityList}>
                  {displayActivity.map((item) => (
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
                  ))}
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
          </div>

          {plan === "free" ? (
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

      <div className={`${styles.toast} ${toastVisible ? styles.toastVisible : ""}`} role="status">
        {toastMessage || "Copied!"}
      </div>
    </main>
  );
}
