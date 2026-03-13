"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./activity-log.module.css";

type RunStatus = "success" | "failed" | "running" | "pending";

type TaskRun = {
  id: string;
  task_type: string;
  status: RunStatus;
  duration_ms: number | null;
  tokens_used: number | null;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  output_data: Record<string, unknown> | null;
};

type DailyStat = {
  date: string;
  tasks_run: number;
  emails_processed: number;
  drafts_created: number;
  minutes_saved: number;
  wa_messages_sent: number;
};

type FilterStatus = "all" | "success" | "failed";
type DateRange = "today" | "7d" | "30d" | "all";

type ActivityLogPageProps = {
  config: PublicAppConfig;
};

const taskMeta: Record<string, { icon: string; label: string; color: string }> = {
  morning_briefing: { icon: "\u{1F305}", label: "Morning briefing", color: "#ffb347" },
  draft_replies: { icon: "\u270D\uFE0F", label: "Draft replies", color: "#4da6ff" },
  meeting_reminders: { icon: "\u{1F4C5}", label: "Meeting reminder", color: "#c77dff" },
  email_search: { icon: "\u{1F50D}", label: "Email search", color: "#00e676" },
  evening_summary: { icon: "\u{1F319}", label: "Evening summary", color: "#ff8c42" },
  custom_reminder: { icon: "\u23F0", label: "Custom reminder", color: "#ff6eb4" },
  weekly_spend: { icon: "\u{1F4B3}", label: "Spend summary", color: "#00bcd4" },
};

const seedRuns: TaskRun[] = [
  {
    id: "r1",
    task_type: "morning_briefing",
    status: "success",
    duration_ms: 3240,
    tokens_used: 820,
    started_at: new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 1.5 * 60 * 60 * 1000 + 3240).toISOString(),
    error_message: null,
    output_data: {
      emailCount: 31,
      eventCount: 2,
      message: "Morning briefing sent. 31 emails, 2 events.",
    },
  },
  {
    id: "r2",
    task_type: "draft_replies",
    status: "success",
    duration_ms: 5810,
    tokens_used: 1640,
    started_at: new Date(Date.now() - 1.49 * 60 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 1.49 * 60 * 60 * 1000 + 5810).toISOString(),
    error_message: null,
    output_data: {
      drafted: 4,
      drafts: [
        { from: "Priya Sharma", subject: "Q4 budget" },
        { from: "Vikram Nair", subject: "Partnership" },
      ],
    },
  },
  {
    id: "r3",
    task_type: "meeting_reminders",
    status: "success",
    duration_ms: 980,
    tokens_used: 120,
    started_at: new Date(Date.now() - 1.5 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 1.5 * 60 * 1000 + 980).toISOString(),
    error_message: null,
    output_data: { reminded: 1 },
  },
  {
    id: "r4",
    task_type: "email_search",
    status: "success",
    duration_ms: 2100,
    tokens_used: 380,
    started_at: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 26 * 60 * 60 * 1000 + 2100).toISOString(),
    error_message: null,
    output_data: {
      found: 3,
      answer: "Found 3 emails from Priya about the Q4 budget approval.",
    },
  },
  {
    id: "r5",
    task_type: "evening_summary",
    status: "failed",
    duration_ms: 1200,
    tokens_used: null,
    started_at: new Date(Date.now() - 27 * 60 * 60 * 1000).toISOString(),
    completed_at: new Date(Date.now() - 27 * 60 * 60 * 1000 + 1200).toISOString(),
    error_message: "Gmail token expired. Reconnect Gmail in Settings.",
    output_data: null,
  },
  {
    id: "r6",
    task_type: "weekly_spend",
    status: "success",
    duration_ms: 1700,
    tokens_used: 420,
    started_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    completed_at: null,
    error_message: null,
    output_data: {
      totalSpend: "Rs 12,400",
      topCategory: "Cloud / SaaS",
    },
  },
];

const seedStats: DailyStat[] = Array.from({ length: 7 }, (_, index) => {
  const date = new Date();
  date.setDate(date.getDate() - index);

  return {
    date: date.toISOString().slice(0, 10),
    tasks_run: Math.max(0, 6 - index),
    emails_processed: Math.max(0, 28 - index * 2),
    drafts_created: Math.max(0, 4 - Math.floor(index / 2)),
    minutes_saved: Math.max(0, 82 - index * 10),
    wa_messages_sent: Math.max(0, 5 - Math.floor(index / 2)),
  };
});

const dateOptions: Array<{ key: DateRange; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "All time" },
];

function formatTimestamp(iso: string) {
  const value = new Date(iso);
  const now = new Date();
  const isToday = value.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const isYesterday = value.toDateString() === yesterday.toDateString();
  const time = value.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  if (isToday) {
    return `Today, ${time}`;
  }

  if (isYesterday) {
    return `Yesterday, ${time}`;
  }

  return `${value.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}, ${time}`;
}

function formatDuration(milliseconds: number | null) {
  if (!milliseconds) {
    return "-";
  }

  if (milliseconds < 1000) {
    return `${milliseconds}ms`;
  }

  return `${(milliseconds / 1000).toFixed(1)}s`;
}

function getSummaryLine(run: TaskRun) {
  const output = run.output_data;
  if (!output) {
    return run.error_message ?? "No details available.";
  }

  switch (run.task_type) {
    case "morning_briefing":
      return `${output.emailCount ?? "?"} emails summarised, ${output.eventCount ?? 0} events briefed`;
    case "draft_replies":
      return `${output.drafted ?? 0} draft${Number(output.drafted) === 1 ? "" : "s"} saved to Gmail`;
    case "meeting_reminders":
      return `Reminder sent for ${output.reminded ?? 0} upcoming meeting${Number(output.reminded) === 1 ? "" : "s"}`;
    case "email_search":
      return String(output.answer ?? `Found ${output.found ?? 0} emails`).slice(0, 90);
    case "evening_summary":
      return "End-of-day recap sent via WhatsApp";
    case "custom_reminder":
      return String(output.message ?? "Reminder delivered");
    case "weekly_spend":
      return `Total spend: ${output.totalSpend ?? "-"} | Top: ${output.topCategory ?? "-"}`;
    default:
      return "Task completed";
  }
}

function groupRunsByDay(runs: TaskRun[]) {
  const groups = new Map<string, TaskRun[]>();
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const run of runs) {
    const value = new Date(run.started_at);
    const label =
      value.toDateString() === now.toDateString()
        ? "Today"
        : value.toDateString() === yesterday.toDateString()
          ? "Yesterday"
          : value.toLocaleDateString("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "short",
            });

    const current = groups.get(label) ?? [];
    current.push(run);
    groups.set(label, current);
  }

  return Array.from(groups.entries()).map(([label, groupedRuns]) => ({
    label,
    runs: groupedRuns,
  }));
}

async function fetchActivity(token: string) {
  const response = await fetch("/api/activity", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return {
      runs: seedRuns,
      stats: seedStats,
    };
  }

  const data = (await response.json()) as {
    runs?: TaskRun[];
    stats?: DailyStat[];
  };

  return {
    runs: data.runs?.length ? data.runs : seedRuns,
    stats: data.stats?.length ? data.stats : seedStats,
  };
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const width = max > 0 ? Math.round((value / max) * 100) : 0;

  return (
    <div className={styles.miniBarTrack}>
      <div className={styles.miniBarFill} style={{ width: `${width}%` }} />
    </div>
  );
}

function RunRow({ run }: { run: TaskRun }) {
  const [open, setOpen] = useState(false);
  const meta = taskMeta[run.task_type] ?? {
    icon: "\u26A1",
    label: run.task_type,
    color: "#a0a0b8",
  };

  return (
    <div className={`${styles.runRow} ${open ? styles.runRowOpen : ""}`}>
      <button
        type="button"
        className={styles.runRowButton}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        <span className={styles.runIcon} style={{ background: `${meta.color}18`, color: meta.color }}>
          {meta.icon}
        </span>

        <div className={styles.runMeta}>
          <span className={styles.runLabel}>{meta.label}</span>
          {!open ? <span className={styles.runSummary}>{getSummaryLine(run)}</span> : null}
        </div>

        <div className={styles.runRight}>
          <span className={`${styles.runStatus} ${styles[`runStatus${run.status[0]?.toUpperCase()}${run.status.slice(1)}`]}`}>
            {run.status === "success" ? "Success" : null}
            {run.status === "failed" ? "Failed" : null}
            {run.status === "running" ? "Running" : null}
            {run.status === "pending" ? "Pending" : null}
          </span>
          <span className={styles.runTime}>{formatTimestamp(run.started_at)}</span>
          <span className={`${styles.runChevron} ${open ? styles.runChevronOpen : ""}`}>{"\u203A"}</span>
        </div>
      </button>

      {open ? (
        <div className={styles.runDetail}>
          <div className={styles.runDetailStats}>
            <div className={styles.runDetailStat}>
              <span className={styles.runDetailStatLabel}>Duration</span>
              <span className={styles.runDetailStatValue}>{formatDuration(run.duration_ms)}</span>
            </div>
            <div className={styles.runDetailStat}>
              <span className={styles.runDetailStatLabel}>Tokens</span>
              <span className={styles.runDetailStatValue}>
                {run.tokens_used != null ? run.tokens_used.toLocaleString() : "-"}
              </span>
            </div>
            <div className={styles.runDetailStat}>
              <span className={styles.runDetailStatLabel}>Completed</span>
              <span className={styles.runDetailStatValue}>
                {run.completed_at ? formatTimestamp(run.completed_at) : "-"}
              </span>
            </div>
          </div>

          {run.status === "failed" && run.error_message ? (
            <div className={styles.runError}>
              <span className={styles.runErrorIcon}>{"\u26A0"}</span>
              {run.error_message}
            </div>
          ) : null}

          {run.output_data ? (
            <div className={styles.runOutput}>
              <span className={styles.runOutputLabel}>Output</span>
              <pre className={styles.runOutputPre}>{JSON.stringify(run.output_data, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ActivityLogPage({ config }: ActivityLogPageProps) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  });

  const searchRef = useRef<HTMLInputElement | null>(null);

  const [runs, setRuns] = useState<TaskRun[]>(seedRuns);
  const [stats, setStats] = useState<DailyStat[]>(seedStats);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<FilterStatus>("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        const accessToken = data.session?.access_token ?? null;
        if (!accessToken) {
          router.replace("/auth");
          return;
        }

        try {
          const activity = await fetchActivity(accessToken);
          if (!cancelled) {
            setRuns(activity.runs);
            setStats(activity.stats);
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [router, supabase]);

  const cutoff = (() => {
    const now = new Date();
    if (dateRange === "today") {
      const value = new Date(now);
      value.setHours(0, 0, 0, 0);
      return value;
    }
    if (dateRange === "7d") {
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
    if (dateRange === "30d") {
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    return null;
  })();

  const filteredRuns = runs.filter((run) => {
    if (statusFilter !== "all" && run.status !== statusFilter) {
      return false;
    }

    if (typeFilter !== "all" && run.task_type !== typeFilter) {
      return false;
    }

    if (cutoff && new Date(run.started_at) < cutoff) {
      return false;
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      const meta = taskMeta[run.task_type];
      return (
        (meta?.label ?? run.task_type).toLowerCase().includes(query) ||
        getSummaryLine(run).toLowerCase().includes(query) ||
        (run.error_message ?? "").toLowerCase().includes(query)
      );
    }

    return true;
  });

  const groupedRuns = groupRunsByDay(filteredRuns);
  const successCount = filteredRuns.filter((run) => run.status === "success").length;
  const failedCount = filteredRuns.filter((run) => run.status === "failed").length;
  const successRuns = runs.filter((run) => run.status === "success").length;
  const failedRuns = runs.filter((run) => run.status === "failed").length;
  const totalDuration = filteredRuns.reduce((sum, run) => sum + (run.duration_ms ?? 0), 0);
  const totalTokens = filteredRuns.reduce((sum, run) => sum + (run.tokens_used ?? 0), 0);
  const sparkData = [...stats].sort((left, right) => left.date.localeCompare(right.date)).slice(-7);
  const sparkMax = Math.max(...sparkData.map((stat) => stat.tasks_run), 1);
  const taskTypes = Array.from(new Set(runs.map((run) => run.task_type)));
  const todayStats =
    stats.find((stat) => stat.date === new Date().toISOString().slice(0, 10)) ?? {
      date: "",
      tasks_run: 0,
      emails_processed: 0,
      drafts_created: 0,
      minutes_saved: 0,
      wa_messages_sent: 0,
    };

  return (
    <div className={styles.shell}>
      <Link href="/dashboard" className={styles.mobileBackLink}>
        {"<- Back to dashboard"}
      </Link>

      <header className={styles.topbar}>
        <div className={styles.topbarLeft}>
          <Link href="/dashboard" className={styles.backLink}>
            {"\u2190 Dashboard"}
          </Link>
          <span className={styles.topbarDivider} />
          <h1 className={styles.pageTitle}>Activity log</h1>
        </div>

        <div className={styles.topbarRight}>
          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>{"\u{1F50D}"}</span>
            <input
              ref={searchRef}
              type="text"
              className={styles.searchInput}
              placeholder="Search runs..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery ? (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => {
                  setSearchQuery("");
                  searchRef.current?.focus();
                }}
              >
                x
              </button>
            ) : null}
          </div>

          <div className={styles.dateRow}>
            {dateOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                className={`${styles.dateButton} ${dateRange === option.key ? styles.dateButtonActive : ""}`}
                onClick={() => setDateRange(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className={styles.statusTabsScroll}>
        {(["all", "success", "failed"] as FilterStatus[]).map((status) => (
          <button
            key={status}
            type="button"
            className={`${styles.statusTab} ${statusFilter === status ? styles.statusTabActive : ""} ${status !== "all" ? styles[`statusTab${status[0]?.toUpperCase()}${status.slice(1)}`] : ""}`}
            onClick={() => setStatusFilter(status)}
          >
            {status === "all" ? `All (${runs.length})` : null}
            {status === "success" ? `Success (${successRuns})` : null}
            {status === "failed" ? `Failed (${failedRuns})` : null}
          </button>
        ))}
      </div>

      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <div className={styles.sideCard}>
            <div className={styles.sideCardLabel}>Summary</div>
            <div className={styles.summaryGrid}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryValue}>{filteredRuns.length}</span>
                <span className={styles.summaryLabel}>Total runs</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={`${styles.summaryValue} ${styles.summaryValueGreen}`}>{successCount}</span>
                <span className={styles.summaryLabel}>Succeeded</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={`${styles.summaryValue} ${styles.summaryValueRed}`}>{failedCount}</span>
                <span className={styles.summaryLabel}>Failed</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryValue}>{formatDuration(totalDuration || null)}</span>
                <span className={styles.summaryLabel}>Total time</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryValue}>
                  {totalTokens > 0
                    ? totalTokens >= 1000
                      ? `${(totalTokens / 1000).toFixed(1)}k`
                      : totalTokens
                    : "-"}
                </span>
                <span className={styles.summaryLabel}>Tokens used</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={`${styles.summaryValue} ${successCount + failedCount > 0 ? styles.summaryValueBlue : ""}`}>
                  {successCount + failedCount > 0
                    ? `${Math.round((successCount / (successCount + failedCount)) * 100)}%`
                    : "-"}
                </span>
                <span className={styles.summaryLabel}>Success rate</span>
              </div>
            </div>
          </div>

          <div className={styles.sideCard}>
            <div className={styles.sideCardLabel}>Runs per day</div>
            <div className={styles.sparkline}>
              {sparkData.map((stat) => (
                <div key={stat.date} className={styles.sparkColumn}>
                  <div className={styles.sparkBarWrap}>
                    <div
                      className={styles.sparkBar}
                      style={{ height: `${Math.max(4, (stat.tasks_run / sparkMax) * 48)}px` }}
                      title={`${stat.date}: ${stat.tasks_run} runs`}
                    />
                  </div>
                  <span className={styles.sparkLabel}>
                    {new Date(`${stat.date}T00:00:00`).toLocaleDateString("en-IN", {
                      weekday: "short",
                    }).slice(0, 2)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.sideCard}>
            <div className={styles.sideCardLabel}>Today</div>
            <div className={styles.dailyRows}>
              {[
                { label: "Emails processed", value: todayStats.emails_processed, max: 60 },
                { label: "Drafts created", value: todayStats.drafts_created, max: 10 },
                { label: "Minutes saved", value: todayStats.minutes_saved, max: 120 },
                { label: "WA messages", value: todayStats.wa_messages_sent, max: 20 },
              ].map((row) => (
                <div key={row.label} className={styles.dailyRow}>
                  <div className={styles.dailyRowTop}>
                    <span className={styles.dailyLabel}>{row.label}</span>
                    <span className={styles.dailyValue}>{row.value}</span>
                  </div>
                  <MiniBar value={row.value} max={row.max} />
                </div>
              ))}
            </div>
          </div>

          <div className={styles.sideCard}>
            <div className={styles.sideCardLabel}>Filter by task</div>
            <div className={styles.typeFilters}>
              <button
                type="button"
                className={`${styles.typeButton} ${typeFilter === "all" ? styles.typeButtonActive : ""}`}
                onClick={() => setTypeFilter("all")}
              >
                All types
              </button>
              {taskTypes.map((taskType) => {
                const meta = taskMeta[taskType] ?? {
                  icon: "\u26A1",
                  label: taskType,
                  color: "#a0a0b8",
                };

                return (
                  <button
                    key={taskType}
                    type="button"
                    className={`${styles.typeButton} ${typeFilter === taskType ? styles.typeButtonActive : ""}`}
                    onClick={() => setTypeFilter(typeFilter === taskType ? "all" : taskType)}
                    style={
                      typeFilter === taskType
                        ? {
                            borderColor: meta.color,
                            color: meta.color,
                            background: `${meta.color}18`,
                          }
                        : undefined
                    }
                  >
                    {`${meta.icon} ${meta.label}`}
                  </button>
                );
              })}
            </div>
          </div>
        </aside>

        <main className={styles.main}>
          <div className={styles.statusTabs}>
            {(["all", "success", "failed"] as FilterStatus[]).map((status) => (
              <button
                key={status}
                type="button"
                className={`${styles.statusTab} ${statusFilter === status ? styles.statusTabActive : ""} ${status !== "all" ? styles[`statusTab${status[0]?.toUpperCase()}${status.slice(1)}`] : ""}`}
                onClick={() => setStatusFilter(status)}
              >
                {status === "all" ? `All (${runs.length})` : null}
                {status === "success" ? `Success (${successRuns})` : null}
                {status === "failed" ? `Failed (${failedRuns})` : null}
              </button>
            ))}
            <span className={styles.statusTabsSpacer} />
            {filteredRuns.length !== runs.length ? (
              <span className={styles.filterNote}>{`Showing ${filteredRuns.length} of ${runs.length}`}</span>
            ) : null}
          </div>

          {loading ? (
            <div className={styles.loadState}>
              <span className={styles.loadSpinner} />
              Loading activity...
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>{"\u{1F4ED}"}</div>
              <div className={styles.emptyTitle}>No runs match your filters</div>
              <button
                type="button"
                className={styles.emptyReset}
                onClick={() => {
                  setStatusFilter("all");
                  setTypeFilter("all");
                  setDateRange("7d");
                  setSearchQuery("");
                }}
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className={styles.timeline}>
              {groupedRuns.map((group) => (
                <div key={group.label} className={styles.dayGroup}>
                  <div className={styles.dayLabel}>
                    <span className={styles.dayLabelText}>{group.label}</span>
                    <span className={styles.dayLabelCount}>{`${group.runs.length} run${group.runs.length === 1 ? "" : "s"}`}</span>
                  </div>
                  <div className={styles.dayRuns}>
                    {group.runs.map((run) => (
                      <RunRow key={run.id} run={run} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
