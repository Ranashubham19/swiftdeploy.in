"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./dashboard-shell.module.css";

type DashboardShellProps = {
  config: PublicAppConfig;
};

type Task = {
  id: string;
  icon: string;
  name: string;
  toastName: string;
  description: string;
  tags: string[];
  runs?: string;
  timing?: string;
  enabled: boolean;
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
} as const;

const TOTAL_RUNS = 847;
const FREE_ACTIVE_LIMIT = 3;

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

const initialTasks: Task[] = [
  {
    id: "task-morning",
    icon: ICONS.sun,
    name: "Morning email briefing",
    toastName: "Morning briefing",
    description: "Summarises your inbox and sends a daily briefing to WhatsApp at 7:00 AM",
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, "\u{1F556} 7:00 AM daily"],
    runs: "\u21BA 14 runs",
    timing: "Last: today 7:01 AM",
    enabled: true,
  },
  {
    id: "task-drafts",
    icon: ICONS.pencil,
    name: "Draft email replies",
    toastName: "Draft replies",
    description: 'Say "draft reply to [name]" on WhatsApp and your AI writes it to Gmail drafts',
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, `${ICONS.zap} On demand`],
    runs: "\u21BA 4 runs today",
    timing: "Last: 7:01 AM",
    enabled: true,
  },
  {
    id: "task-calendar",
    icon: ICONS.calendar,
    name: "Meeting reminders",
    toastName: "Meeting reminders",
    description: "Sends a WhatsApp reminder 30 mins before each meeting with email context",
    tags: [`${ICONS.calendar} Calendar`, `${ICONS.chat} WhatsApp`, `${ICONS.alarm} 30min before`],
    runs: "\u21BA 2 today",
    timing: "Next: 9:30 AM",
    enabled: true,
  },
  {
    id: "task-search",
    icon: ICONS.search,
    name: "Search my email",
    toastName: "Email search",
    description: 'Ask "what did [person] say about [topic]?" and get an instant summary',
    tags: [`${ICONS.mail} Gmail`, `${ICONS.chat} WhatsApp`, `${ICONS.zap} On demand`],
    enabled: false,
  },
  {
    id: "task-evening",
    icon: ICONS.moon,
    name: "Evening summary",
    toastName: "Evening summary",
    description: "End-of-day recap: what you did, what needs attention tomorrow",
    tags: [`${ICONS.mail} Gmail`, `${ICONS.calendar} Calendar`, "\u{1F558} 9:00 PM daily"],
    enabled: false,
  },
];

const activityItems: ActivityItem[] = [
  {
    id: "activity-1",
    tone: "green",
    title: "Morning briefing sent",
    detail: "31 emails summarised",
    time: "Today, 7:00 AM",
  },
  {
    id: "activity-2",
    tone: "blue",
    title: "4 email drafts",
    detail: "created and saved to Gmail",
    time: "Today, 7:01 AM",
  },
  {
    id: "activity-3",
    tone: "amber",
    title: "Meeting reminder",
    detail: "Priya call at 10:00 AM",
    time: "Today, 9:30 AM",
  },
  {
    id: "activity-4",
    tone: "green",
    title: "Email search",
    detail: '"budget from Priya" answered',
    time: "Yesterday, 3:14 PM",
  },
  {
    id: "activity-5",
    tone: "blue",
    title: "Gmail connected",
    detail: "successfully",
    time: "3 days ago",
  },
];

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

function getAIResponse(command: string) {
  const normalized = command.toLowerCase();

  if (normalized.includes("draft") || normalized.includes("reply")) {
    return "On it! I'll check your latest emails and create the draft now. It'll be in your Gmail drafts in about 30 seconds.";
  }

  if (normalized.includes("meeting") || normalized.includes("tomorrow")) {
    return "\u{1F4C5} You have 2 meetings tomorrow:\n\u2022 10:00 AM - Team standup (Google Meet)\n\u2022 3:00 PM - Client review with Priya";
  }

  if (normalized.includes("remind")) {
    return "Reminder set! I'll message you here at the specified time.";
  }

  if (normalized.includes("email") || normalized.includes("inbox")) {
    return "You have 31 unread emails. 4 need replies from Priya, Vikram, Sarah, and Ankit. Want me to draft responses?";
  }

  if (normalized.includes("search")) {
    return "Searching your inbox... Found 3 relevant emails. The most recent was from Priya on March 10 about the Q4 budget approval of Rs 2.4L.";
  }

  return "Got it! Working on that now. I'll update you here when it's done.";
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
  const [totalRunsDisplay, setTotalRunsDisplay] = useState(0);
  const [tasks, setTasks] = useState(initialTasks);
  const [messages, setMessages] = useState<ChatMessage[]>(() => createSeedMessages("Rahul"));
  const [hasInteractiveMessages, setHasInteractiveMessages] = useState(false);
  const [typingVisible, setTypingVisible] = useState(false);
  const [commandInput, setCommandInput] = useState("");
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  const displayName = userName || "Rahul Kumar";
  const displayEmail = userEmail || "rahul.kumar@gmail.com";
  const firstName = displayName.split(" ")[0] || "Rahul";
  const initials = getInitials(displayName, displayEmail);
  const activeCount = tasks.filter((task) => task.enabled).length;

  const accounts = [
    { id: "gmail", icon: ICONS.mail, name: "Gmail", detail: displayEmail, status: "connected" as const },
    {
      id: "calendar",
      icon: ICONS.calendar,
      name: "Google Calendar",
      detail: "2 events today",
      status: "connected" as const,
    },
    {
      id: "whatsapp",
      icon: ICONS.chat,
      name: "WhatsApp",
      detail: "+91 98765 43210 - Active",
      status: "connected" as const,
    },
    {
      id: "telegram",
      icon: ICONS.phone,
      name: "Telegram",
      detail: "Available on Starter plan",
      status: "upgrade" as const,
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

  useEffect(() => {
    setGreeting(getTimeGreeting());
  }, []);

  useEffect(() => {
    if (!hasInteractiveMessages) {
      setMessages(createSeedMessages(firstName));
    }
  }, [firstName, hasInteractiveMessages]);

  useEffect(() => {
    let current = 0;
    const step = Math.ceil(TOTAL_RUNS / 40);

    const timer = window.setInterval(() => {
      current = Math.min(current + step, TOTAL_RUNS);
      setTotalRunsDisplay(current);

      if (current >= TOTAL_RUNS) {
        window.clearInterval(timer);
      }
    }, 30);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

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

  function handleTaskToggle(taskId: string, nextEnabled: boolean) {
    const targetTask = tasks.find((task) => task.id === taskId);

    if (!targetTask) {
      return;
    }

    if (nextEnabled && !targetTask.enabled && activeCount >= FREE_ACTIVE_LIMIT) {
      showToast(`Free plan supports ${FREE_ACTIVE_LIMIT} active tasks. Upgrade to enable more.`);
      return;
    }

    setTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, enabled: nextEnabled } : task)),
    );

    showToast(nextEnabled ? `${targetTask.toastName} enabled \u2713` : `${targetTask.toastName} paused`);
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

  function handleCommandSubmit() {
    const value = commandInput.trim();

    if (!value) {
      showToast("Type a command first");
      return;
    }

    if (!agentOn) {
      showToast("Resume the agent before sending commands");
      return;
    }

    setHasInteractiveMessages(true);
    appendMessage("user", value);
    setCommandInput("");
    queueBotReply(getAIResponse(value), 400, 1500);
    showToast("Command sent to your agent");
  }

  function handleCommandKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCommandSubmit();
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
            onClick={() => showToast("Opening activity log...")}
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
            onClick={() => showToast("Opening settings...")}
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
              <span className={styles.planTag}>FREE</span>
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
              onClick={() => showToast("Opening settings...")}
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

          <div className={styles.greeting}>
            <h1 className={styles.greetingTitle}>
              {greeting}, {firstName} {"\u{1F44B}"}
            </h1>
            <p className={styles.greetingText}>
              Your agent has been running for 3 days. Here&apos;s what&apos;s happening today.
            </p>
          </div>

          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconGreen}`}>{ICONS.zap}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>+12%</div>
              </div>
              <div className={styles.statNumber}>{totalRunsDisplay.toLocaleString()}</div>
              <div className={styles.statLabel}>Total task runs</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconBlue}`}>{ICONS.mail}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>+8</div>
              </div>
              <div className={styles.statNumber}>31</div>
              <div className={styles.statLabel}>Emails processed today</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconAccent}`}>{ICONS.clock}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>+22min</div>
              </div>
              <div className={styles.statNumber}>
                1.5<span className={styles.statUnit}>hr</span>
              </div>
              <div className={styles.statLabel}>Time saved today</div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statTop}>
                <div className={`${styles.statIcon} ${styles.statIconAmber}`}>{ICONS.check}</div>
                <div className={`${styles.statChange} ${styles.statChangeUp}`}>+2</div>
              </div>
              <div className={styles.statNumber}>4</div>
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
              </div>

              <div className={styles.sectionCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>
                    {ICONS.zap} AI tasks
                    <span className={styles.cardTitleMeta}>
                      {activeCount} of {FREE_ACTIVE_LIMIT} active
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

                <div className={styles.tasksList}>
                  {tasks.map((task) => (
                    <div
                      key={task.id}
                      className={`${styles.taskItem} ${task.enabled ? styles.taskItemOn : styles.taskItemMuted}`}
                    >
                      <div className={styles.taskTop}>
                        <div className={styles.taskLeft}>
                          <span className={styles.taskEmoji}>{task.icon}</span>
                          <div>
                            <div className={styles.taskName}>{task.name}</div>
                            <div className={styles.taskDescription}>{task.description}</div>
                          </div>
                        </div>

                        <label className={styles.toggle}>
                          <input
                            type="checkbox"
                            className={styles.toggleInput}
                            checked={task.enabled}
                            onChange={(event) => handleTaskToggle(task.id, event.target.checked)}
                          />
                          <span className={styles.toggleTrack} />
                          <span className={styles.toggleThumb} />
                        </label>
                      </div>

                      <div className={styles.taskMeta}>
                        {task.tags.map((tag) => (
                          <span key={`${task.id}-${tag}`} className={styles.taskTag}>
                            {tag}
                          </span>
                        ))}
                        {task.runs ? <span className={styles.taskRuns}>{task.runs}</span> : null}
                        {task.timing ? <span className={styles.taskLast}>{task.timing}</span> : null}
                      </div>
                    </div>
                  ))}
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
                      <span className={styles.statusLabel}>Uptime</span>
                      <span className={styles.statusValue}>3d 4h 12m</span>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Region</span>
                      <span className={styles.statusValue}>Mumbai (ap-south-1)</span>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Active tasks</span>
                      <span className={styles.statusValueAccent}>{activeCount} running</span>
                    </div>
                    <div className={styles.statusRow}>
                      <span className={styles.statusLabel}>Next scheduled run</span>
                      <span className={styles.statusValue}>9:30 AM today</span>
                    </div>
                  </div>

                  <div className={styles.usageWrap}>
                    <div className={styles.usageHeader}>
                      <span className={styles.statusLabel}>Daily task runs</span>
                      <span className={styles.statusValue}>
                        7 / 10 <span className={styles.inlineMuted}>(free limit)</span>
                      </span>
                    </div>
                    <div className={styles.progressTrack}>
                      <div className={styles.progressFill} />
                    </div>
                    <div className={styles.progressMeta}>3 runs remaining today</div>
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
                      <div className={styles.waHeaderStatus}>online</div>
                    </div>
                  </div>

                  <div className={styles.waBody}>
                    {messages.map((message) => (
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
                    onClick={() => showToast("Opening full activity log...")}
                  >
                    View all
                  </button>
                </div>

                <div className={styles.activityList}>
                  {activityItems.map((item) => (
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
                onChange={(event) => setCommandInput(event.target.value)}
                onKeyDown={handleCommandKeyDown}
                placeholder='Try: "Summarise emails from last week" or "Remind me tomorrow at 9am about project review"'
              />
              <button type="button" className={styles.commandButton} onClick={handleCommandSubmit}>
                Send -&gt;
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

          <div className={styles.upgradeBanner}>
            <div className={styles.upgradeInfo}>
              <h3 className={styles.upgradeTitle}>You&apos;re on the Free plan - 3 runs left today</h3>
              <p className={styles.upgradeText}>
                Upgrade to Starter for unlimited runs, Telegram, draft sending, and more - just
                {" \u20B9"}799/month
              </p>
            </div>
            <button
              type="button"
              className={styles.upgradeButton}
              onClick={() => showToast("Opening upgrade flow...")}
            >
              Upgrade to Starter -&gt;
            </button>
          </div>
        </div>
      </div>

      <div className={`${styles.toast} ${toastVisible ? styles.toastVisible : ""}`} role="status">
        {toastMessage || "Copied!"}
      </div>
    </main>
  );
}
