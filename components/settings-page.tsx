"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  useDashboardData,
  type DashboardRuntimeFeatureState,
} from "@/hooks/useDashboardData";
import { supportedClawCloudLocaleOptions } from "@/lib/clawcloud-locales";
import { useUpgrade } from "@/hooks/useUpgrade";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./settings-page.module.css";

type SettingsPageProps = { config: PublicAppConfig };
type TabId = "profile" | "notifications" | "integrations" | "agent" | "billing" | "danger";

const tabs = [
  { id: "profile", icon: "\u{1F464}", label: "Profile", title: "\u{1F464} Profile" },
  { id: "notifications", icon: "\u{1F514}", label: "Notifications", title: "\u{1F514} Notifications" },
  { id: "integrations", icon: "\u{1F517}", label: "Integrations", title: "\u{1F517} Integrations" },
  { id: "agent", icon: "\u{1F916}", label: "Agent settings", title: "\u{1F916} Agent settings" },
  { id: "billing", icon: "\u{1F4B3}", label: "Plan & billing", title: "\u{1F4B3} Plan & billing" },
  { id: "danger", icon: "\u26A0\uFE0F", label: "Danger zone", title: "\u26A0\uFE0F Danger zone" },
] as const satisfies Array<{ id: TabId; icon: string; label: string; title: string }>;

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Europe/London", "America/New_York", "America/Los_Angeles"] as const;

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function titleCase(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(name: string, email: string) {
  const source = name.trim() || email.split("@")[0] || "CC";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "CC";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatSubscriptionDate(value: string | null | undefined) {
  if (!value) return "No renewal date available";
  try {
    return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
  } catch {
    return value;
  }
}

export function SettingsPage({ config }: SettingsPageProps) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  });
  const { data, loading, error, refetch } = useDashboardData(config);
  const { upgrade, loading: upgradeLoading, error: upgradeError } = useUpgrade();

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handledSearchStateRef = useRef("");
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [fullName, setFullName] = useState("");
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [language, setLanguage] = useState("en");
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (data?.user) {
      setFullName(data.user.full_name ?? "");
      setTimezone(data.user.timezone ?? "Asia/Kolkata");
      setLanguage(data.user.language ?? "en");
    }
  }, [data?.user]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    const driveStatus = params.get("drive");
    const errorMessage = params.get("error");
    const signature = `${params.toString()}::${driveStatus ?? ""}::${errorMessage ?? ""}`;

    if (tab === "integrations") {
      setActiveTab("integrations");
    }

    if (handledSearchStateRef.current === signature) {
      return;
    }

    let handled = false;
    if (driveStatus === "connected") {
      showToast("Google Drive connected.");
      refetch();
      handled = true;
    }

    if (errorMessage) {
      showToast(errorMessage);
      handled = true;
    }

    if (!handled) {
      return;
    }

    handledSearchStateRef.current = signature;
    const nextParams = new URLSearchParams(params.toString());
    nextParams.delete("drive");
    nextParams.delete("error");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/settings?${nextQuery}` : "/settings");
  }, [refetch, router]);

  useEffect(() => {
    if (upgradeError) showToast(upgradeError);
  }, [upgradeError]);

  function showToast(message: string) {
    setToast(message);
    setToastVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setToastVisible(false), 2600);
  }

  async function authedFetch(path: string, init: RequestInit = {}) {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Please sign in again.");

    const response = await fetch(path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const json = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new Error(json.error || "Request failed.");
    return json;
  }

  async function saveProfile() {
    const trimmedName = fullName.trim().replace(/\s+/g, " ");
    if (!trimmedName) {
      showToast("Full name is required.");
      return;
    }
    setSaving((current) => ({ ...current, profile: true }));
    try {
      await authedFetch("/api/settings/profile", {
        method: "PATCH",
        body: JSON.stringify({ full_name: trimmedName, timezone, language }),
      });
      refetch();
      showToast("Profile updated.");
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Unable to save profile.");
    } finally {
      setSaving((current) => ({ ...current, profile: false }));
    }
  }

  async function disconnect(provider: "google" | "whatsapp" | "telegram") {
    setSaving((current) => ({ ...current, [provider]: true }));
    try {
      await authedFetch(`/api/settings/integrations/${provider}`, { method: "DELETE" });
      refetch();
      showToast(`${titleCase(provider)} disconnected.`);
    } catch (disconnectError) {
      showToast(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect.");
    } finally {
      setSaving((current) => ({ ...current, [provider]: false }));
    }
  }

  async function disconnectAll() {
    setSaving((current) => ({ ...current, disconnectAll: true }));
    try {
      await Promise.allSettled([
        authedFetch("/api/settings/integrations/google", { method: "DELETE" }),
        authedFetch("/api/settings/integrations/whatsapp", { method: "DELETE" }),
        authedFetch("/api/settings/integrations/telegram", { method: "DELETE" }),
      ]);
      refetch();
      showToast("All integrations disconnected.");
    } finally {
      setSaving((current) => ({ ...current, disconnectAll: false }));
    }
  }

  const user = data?.user;
  const plan = (user?.plan ?? "free").toLowerCase();
  const planLabel = titleCase(plan);
  const displayName = fullName || user?.full_name || "ClawCloud User";
  const displayEmail = user?.email ?? "";
  const initials = getInitials(displayName, displayEmail);
  const title = tabs.find((tab) => tab.id === activeTab)?.title ?? tabs[0].title;

  const accounts = data?.connected_accounts ?? [];
  const featureStatus = data?.feature_status;
  const tasks = data?.tasks ?? [];
  const subscription = data?.subscription;
  const agentStatus = data?.agent_status;

  const gmail = accounts.find((account) => account.provider === "gmail" && account.is_active);
  const calendar = accounts.find((account) => account.provider === "google_calendar" && account.is_active);
  const drive = accounts.find((account) => account.provider === "google_drive" && account.is_active);
  const whatsapp = accounts.find((account) => account.provider === "whatsapp" && account.is_active);
  const telegram = accounts.find((account) => account.provider === "telegram" && account.is_active);
  const needsGoogleReconnect = Boolean((gmail || calendar) && !drive);
  const telegramBotUsername = (config.telegramBotUsername ?? "").trim();
  const telegramBotLink = telegramBotUsername
    ? `https://t.me/${telegramBotUsername}?start=${encodeURIComponent(user?.id ?? "")}`
    : "";
  const canOpenTelegramBot = Boolean(telegramBotLink);

  const taskBadges = [
    ["Morning briefing", tasks.some((task) => task.task_type === "morning_briefing" && task.is_enabled)],
    ["Meeting reminders", tasks.some((task) => task.task_type === "meeting_reminders" && task.is_enabled)],
    ["Draft replies", tasks.some((task) => task.task_type === "draft_replies" && task.is_enabled)],
    ["Evening summary", tasks.some((task) => task.task_type === "evening_summary" && task.is_enabled)],
    ["Weekly spend summary", tasks.some((task) => task.task_type === "weekly_spend" && task.is_enabled)],
  ] as const;

  const featureRows: Array<[string, DashboardRuntimeFeatureState]> = featureStatus
    ? [
        ["Google Workspace connect", featureStatus.google_workspace_connect],
        ["WhatsApp agent backend", featureStatus.whatsapp_agent],
        ["Telegram bot", featureStatus.telegram_bot],
        ["Voice transcription", featureStatus.voice_transcription],
        ["Image analysis", featureStatus.image_analysis],
        ["Image generation", featureStatus.image_generation],
        ["Live cricket", featureStatus.cricket_live],
        ["Live train status", featureStatus.train_live],
      ]
    : [];

  const dailyLimit = agentStatus?.daily_limit ?? 10;
  const todayRuns = agentStatus?.today_runs ?? 0;
  const activeTaskLimit = agentStatus?.active_task_limit ?? 3;
  const activeTaskCount = agentStatus?.active_task_count ?? 0;

  return (
    <div className={styles.shell}>
      <div className={cx(styles.sidebarOverlay, sidebarOpen && styles.sidebarOverlayOpen)} onClick={() => setSidebarOpen(false)} />
      <aside className={cx(styles.sidebar, sidebarOpen && styles.sidebarOpen)}>
        <div className={styles.sidebarTop}>
          <div className={styles.logoLink}>
            <div className={styles.logoIcon}>{"\u{1F99E}"}</div>
            <div>
              <div className={styles.logoText}>Claw<span>Cloud</span></div>
              <button type="button" className={styles.backLink} style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }} onClick={() => router.push("/dashboard")}>
                {"\u2190 Back to dashboard"}
              </button>
            </div>
          </div>
        </div>
        <div className={styles.navSectionLabel}>Settings</div>
        <div className={styles.tabNav}>
          {tabs.map((tab) => (
            <button key={tab.id} type="button" className={cx(styles.tabButton, activeTab === tab.id && styles.tabButtonActive)} onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}>
              <span className={styles.tabIcon}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles.sidebarUser}>
          <div className={styles.userAvatar}>{initials}</div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>{displayName}</div>
            <span className={styles.planTag}>{planLabel.toUpperCase()}</span>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button type="button" className={styles.mobileToggle} aria-label="Toggle settings menu" onClick={() => setSidebarOpen((current) => !current)}>
              {"\u2630"}
            </button>
            <div className={styles.pageTitle}>{title}</div>
          </div>
          <div className={styles.topbarRight}>
            <button type="button" className={styles.topbarButton} onClick={() => { refetch(); showToast("Refreshing live data..."); }}>
              Refresh data
            </button>
          </div>
        </header>

        <div className={styles.scrollArea}>
          {loading ? <div className={cx(styles.statusNote, styles.statusLoading)}>Loading your live ClawCloud settings...</div> : null}
          {error ? <div className={cx(styles.statusNote, styles.statusError)}>{error}</div> : null}

          {activeTab === "profile" ? (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Personal information</div>
                  <div className={styles.sectionDescription}>These values are loaded from your real account profile.</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.avatarRow}>
                    <div className={styles.avatarLarge}>{initials}</div>
                    <div className={styles.avatarMeta}>
                      <div className={styles.avatarName}>{displayName}</div>
                      <div className={styles.avatarEmail}>{displayEmail || "No email found"}</div>
                    </div>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Full name</div>
                    <input className={styles.input} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your name" />
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Email address</div>
                    <input className={styles.input} type="email" value={displayEmail} readOnly />
                    <div className={styles.fieldHint}>Email is managed by your auth account.</div>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Timezone</div>
                    <select className={styles.select} value={timezone} onChange={(event) => setTimezone(event.target.value)}>
                      {Array.from(new Set([timezone, ...TIMEZONES])).map((option) => (
                        <option key={option} value={option}>{option}</option>
                      ))}
                    </select>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Reply language</div>
                    <select className={styles.select} value={language} onChange={(event) => setLanguage(event.target.value)}>
                      {supportedClawCloudLocaleOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <div className={styles.fieldHint}>This controls the language ClawCloud uses by default in WhatsApp replies.</div>
                  </div>
                  <div className={styles.cardFooter}>
                    <button type="button" className={styles.primaryButton} disabled={Boolean(saving.profile)} onClick={() => void saveProfile()}>
                      {saving.profile ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "notifications" ? (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Automation-driven notifications</div>
                  <div className={styles.sectionDescription}>These statuses come from your real enabled tasks, not browser-only toggles.</div>
                </div>
                <div className={styles.card}>
                  {taskBadges.map(([label, enabled]) => (
                    <div key={label} className={styles.notificationRow}>
                      <div>
                        <div className={styles.rowTitle}>{label}</div>
                        <div className={styles.rowDescription}>Live state from your configured tasks.</div>
                      </div>
                      <span className={enabled ? styles.connectedBadge : styles.statusBadgeMuted}>{enabled ? "Enabled" : "Disabled"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "integrations" ? (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Connected accounts</div>
                  <div className={styles.sectionDescription}>Live status from connected accounts and runtime checks.</div>
                </div>
                {needsGoogleReconnect ? (
                  <div className={styles.integrationBanner}>
                    <div>
                      <div className={styles.integrationBannerTitle}>
                        {featureStatus?.google_workspace_extended_connect.available
                          ? "Reconnect Google to enable Drive & Sheets"
                          : "Drive & Sheets verification pending"}
                      </div>
                      <div className={styles.integrationBannerText}>
                        {featureStatus?.google_workspace_extended_connect.available
                          ? "Gmail or Calendar is active, but the newer Drive scopes are still missing."
                          : (
                            featureStatus?.google_workspace_extended_connect.reason
                            || "Drive and Sheets will stay hidden until the extended Google review is approved."
                          )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={!featureStatus?.google_workspace_extended_connect.available}
                      onClick={() => user?.id
                        ? window.location.assign(`/api/auth/google?userId=${encodeURIComponent(user.id)}&scopeSet=extended`)
                        : showToast("User account is not loaded yet.")}
                    >
                      {featureStatus?.google_workspace_extended_connect.available
                        ? "Reconnect Google"
                        : "Awaiting approval"}
                    </button>
                  </div>
                ) : null}
                <div className={styles.card}>
                  <div className={styles.integrationRow}>
                    <div className={styles.integrationIcon}>{"\u{1F4E7}"}</div>
                    <div className={styles.integrationBody}>
                      <div className={styles.rowTitle}>Google Workspace</div>
                      <div className={styles.rowDescription}>Gmail, Calendar, and Drive access for ClawCloud workflows.</div>
                      <div className={styles.scopeText}>{gmail?.account_email || featureStatus?.google_workspace_connect.reason || "Not connected"}</div>
                    </div>
                    <div className={styles.integrationActions}>
                      <span className={(gmail || calendar || drive) ? styles.connectedBadge : styles.statusBadgeMuted}>{(gmail || calendar || drive) ? "Connected" : "Needs setup"}</span>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={!featureStatus?.google_workspace_connect.available}
                        onClick={() => user?.id
                          ? window.location.assign(`/api/auth/google?userId=${encodeURIComponent(user.id)}`)
                          : showToast("User account is not loaded yet.")}
                      >
                        Connect Google
                      </button>
                      {(gmail || calendar || drive) ? <button type="button" className={styles.dangerButton} disabled={Boolean(saving.google)} onClick={() => void disconnect("google")}>{saving.google ? "Working..." : "Disconnect"}</button> : null}
                    </div>
                  </div>
                  <div className={styles.integrationRow}>
                    <div className={styles.integrationIcon}>{"\u{1F4AC}"}</div>
                    <div className={styles.integrationBody}>
                      <div className={styles.rowTitle}>WhatsApp</div>
                      <div className={styles.rowDescription}>Primary messaging channel for your assistant.</div>
                      <div className={styles.scopeText}>{whatsapp?.phone_number || featureStatus?.whatsapp_agent.reason || "Not connected"}</div>
                    </div>
                    <div className={styles.integrationActions}>
                      <span className={whatsapp ? styles.connectedBadge : styles.statusBadgeMuted}>{whatsapp ? "Connected" : "Needs setup"}</span>
                      <button type="button" className={styles.secondaryButton} onClick={() => router.push("/setup")}>Open setup</button>
                      {whatsapp ? <button type="button" className={styles.dangerButton} disabled={Boolean(saving.whatsapp)} onClick={() => void disconnect("whatsapp")}>{saving.whatsapp ? "Working..." : "Disconnect"}</button> : null}
                    </div>
                  </div>
                  <div className={styles.integrationRow}>
                    <div className={styles.integrationIcon}>{"\u2708\uFE0F"}</div>
                    <div className={styles.integrationBody}>
                      <div className={styles.rowTitle}>Telegram</div>
                      <div className={styles.rowDescription}>Secondary channel for text-based assistant flows.</div>
                      <div className={styles.scopeText}>{telegram?.account_email || telegram?.phone_number || (plan === "free" ? "Upgrade to Starter to connect" : featureStatus?.telegram_bot.reason || "Open the bot to connect")}</div>
                    </div>
                    <div className={styles.integrationActions}>
                      <span className={telegram ? styles.connectedBadge : styles.statusBadgeMuted}>{telegram ? "Connected" : "Needs setup"}</span>
                      <button
                        type="button"
                        className={telegram ? styles.secondaryButton : styles.primaryButton}
                        disabled={
                          telegram
                            ? !canOpenTelegramBot
                            : plan === "free"
                              ? false
                              : !featureStatus?.telegram_bot.available || !canOpenTelegramBot
                        }
                        onClick={
                          telegram
                            ? () => window.open(telegramBotLink, "_blank")
                            : plan === "free"
                              ? () => void upgrade({ plan: "starter", period: "monthly", currency: "inr" })
                              : () => window.open(telegramBotLink, "_blank")
                        }
                      >
                        {telegram ? "Open bot" : plan === "free" ? "Upgrade" : "Open bot"}
                      </button>
                      {telegram ? <button type="button" className={styles.dangerButton} disabled={Boolean(saving.telegram)} onClick={() => void disconnect("telegram")}>{saving.telegram ? "Working..." : "Disconnect"}</button> : null}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "agent" ? (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Runtime feature status</div>
                  <div className={styles.sectionDescription}>This is the honest deployment-level view of what ClawCloud can do right now.</div>
                </div>
                <div className={styles.card}>
                  {featureRows.map(([label, state]) => (
                    <div key={label} className={styles.notificationRow}>
                      <div>
                        <div className={styles.rowTitle}>{label}</div>
                        <div className={styles.rowDescription}>{state.available ? (state.providers?.length ? `Available via ${state.providers.join(", ")}.` : "Available.") : state.reason || "Unavailable."}</div>
                      </div>
                      <span className={state.available ? styles.connectedBadge : styles.statusBadgeMuted}>{state.available ? "Ready" : "Needs setup"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "billing" ? (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Current plan</div>
                  <div className={styles.sectionDescription}>Live usage and subscription information from your account.</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.planHeader}>
                    <div>
                      <div className={styles.planName}>{planLabel} plan</div>
                      <div className={styles.planDescription}>{dailyLimit} runs/day · {activeTaskLimit} active automations</div>
                    </div>
                    <span className={styles.planTagLarge}>{planLabel.toUpperCase()}</span>
                  </div>
                  <div className={styles.divider} />
                  <div className={styles.metricGroup}>
                    <div className={styles.metricHeader}><span>Daily runs used</span><span>{todayRuns} / {dailyLimit}</span></div>
                    <div className={styles.progressTrack}><div className={styles.progressFillFull} style={{ width: `${Math.min((todayRuns / Math.max(dailyLimit, 1)) * 100, 100)}%` }} /></div>
                  </div>
                  <div className={styles.metricGroup}>
                    <div className={styles.metricHeader}><span>Active automations</span><span>{activeTaskCount} / {activeTaskLimit}</span></div>
                    <div className={styles.progressTrack}><div className={styles.progressFillAmber} style={{ width: `${Math.min((activeTaskCount / Math.max(activeTaskLimit, 1)) * 100, 100)}%` }} /></div>
                  </div>
                  <div className={styles.metricGroup}>
                    <div className={styles.metricHeader}><span>Subscription status</span><span>{subscription ? titleCase(subscription.status) : "Free tier"}</span></div>
                    <div className={styles.rowDescription}>{subscription ? `Renews on ${formatSubscriptionDate(subscription.current_period_end)}${subscription.cancel_at_period_end ? " and will cancel at period end." : "."}` : "You are currently using the free plan."}</div>
                  </div>
                </div>
              </div>
              <div className={styles.section}>
                <div className={styles.upgradeCard}>
                  <div>
                    <div className={styles.upgradeTitle}>Starter - INR 799/month</div>
                    <div className={styles.upgradeDescription}>Higher daily limits, more automations, and connected assistant workflows for regular use.</div>
                  </div>
                  <button type="button" className={styles.primaryButton} disabled={upgradeLoading} onClick={() => void upgrade({ plan: "starter", period: "monthly", currency: "inr" })}>
                    {upgradeLoading ? "Opening..." : "See Starter"}
                  </button>
                </div>
                <div className={cx(styles.upgradeCard, styles.upgradeCardMuted)}>
                  <div>
                    <div className={styles.upgradeTitle}>Pro - INR 2,499/month</div>
                    <div className={styles.upgradeDescription}>Highest limits, priority workflows, and the full ClawCloud experience for power users.</div>
                  </div>
                  <button type="button" className={styles.secondaryButton} disabled={upgradeLoading} onClick={() => void upgrade({ plan: "pro", period: "monthly", currency: "inr" })}>
                    {upgradeLoading ? "Opening..." : "See Pro"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "danger" ? (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Danger zone</div>
                  <div className={styles.sectionDescription}>Only real actions are active here. Anything not built is labeled honestly.</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Disconnect all integrations</div>
                      <div className={styles.rowDescription}>Revokes Google, WhatsApp, and Telegram access where connected.</div>
                    </div>
                    <button type="button" className={styles.dangerButton} disabled={Boolean(saving.disconnectAll)} onClick={() => void disconnectAll()}>
                      {saving.disconnectAll ? "Disconnecting..." : "Disconnect all"}
                    </button>
                  </div>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Export my data</div>
                      <div className={styles.rowDescription}>Not implemented yet. This button is intentionally honest.</div>
                    </div>
                    <button type="button" className={styles.secondaryButton} onClick={() => showToast("Data export is not implemented yet.")}>Coming soon</button>
                  </div>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Delete account</div>
                      <div className={styles.rowDescription}>Self-serve account deletion is not implemented yet.</div>
                    </div>
                    <button type="button" className={styles.primaryDangerButton} disabled>Not available yet</button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className={cx(styles.toast, toastVisible && styles.toastVisible)}>{toast}</div>
    </div>
  );
}
