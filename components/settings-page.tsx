"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  useDashboardData,
  type DashboardRuntimeFeatureState,
} from "@/hooks/useDashboardData";
import {
  describeGlobalLiteConnection,
  type GlobalLiteConnection,
  type GlobalLiteProvider,
} from "@/lib/clawcloud-global-lite";
import { supportedClawCloudLocaleOptions } from "@/lib/clawcloud-locales";
import { useUpgrade } from "@/hooks/useUpgrade";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./settings-page.module.css";

type SettingsPageProps = { config: PublicAppConfig };
type TabId = "profile" | "notifications" | "integrations" | "agent" | "billing" | "danger";
type DisconnectResult = {
  result?: {
    provider?: "google" | "whatsapp" | "telegram";
    disconnected?: boolean;
    revokedTokens?: number;
    warnings?: string[];
  };
};

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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [gmailLiteEmail, setGmailLiteEmail] = useState("");
  const [calendarLiteIcsUrl, setCalendarLiteIcsUrl] = useState("");
  const [driveLiteLabel, setDriveLiteLabel] = useState("");

  useEffect(() => {
    if (data?.user) {
      setFullName(data.user.full_name ?? "");
      setTimezone(data.user.timezone ?? "Asia/Kolkata");
      setLanguage(data.user.language ?? "en");
    }
  }, [data?.user]);

  useEffect(() => {
    const connections = data?.global_lite_connections ?? [];
    const gmailLite = connections.find((connection) => connection.provider === "gmail");
    const calendarLite = connections.find((connection) => connection.provider === "google_calendar");
    const driveLite = connections.find((connection) => connection.provider === "google_drive");

    setGmailLiteEmail(
      typeof gmailLite?.config?.email === "string"
        ? gmailLite.config.email
        : (data?.user?.email ?? ""),
    );
    setCalendarLiteIcsUrl(
      typeof calendarLite?.config?.icsUrl === "string" ? calendarLite.config.icsUrl : "",
    );
    setDriveLiteLabel(driveLite?.label ?? "");
  }, [data?.global_lite_connections, data?.user?.email]);

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

  async function getAccessToken() {
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) throw new Error("Please sign in again.");
    return token;
  }

  async function authedFetch(path: string, init: RequestInit = {}) {
    const token = await getAccessToken();

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

  async function authedDownload(path: string) {
    const token = await getAccessToken();
    const response = await fetch(path, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const json = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(json.error || "Request failed.");
    }

    return response;
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
      const payload = (await authedFetch(`/api/settings/integrations/${provider}`, {
        method: "DELETE",
      })) as DisconnectResult;

      refetch();
      const warning = payload.result?.warnings?.[0];
      showToast(
        warning
          ? `${titleCase(provider)} disconnected locally. ${warning}`
          : `${titleCase(provider)} disconnected.`,
      );
    } catch (disconnectError) {
      showToast(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect.");
    } finally {
      setSaving((current) => ({ ...current, [provider]: false }));
    }
  }

  async function disconnectAll() {
    setSaving((current) => ({ ...current, disconnectAll: true }));
    try {
      const providerLabels = ["google", "whatsapp", "telegram"] as const;
      const results = await Promise.allSettled(
        providerLabels.map((provider) =>
          authedFetch(`/api/settings/integrations/${provider}`, { method: "DELETE" }),
        ),
      );

      const warnings: string[] = [];
      const failures: string[] = [];
      let successCount = 0;

      results.forEach((result) => {
        if (result.status === "fulfilled") {
          successCount += 1;
          const payload = result.value as DisconnectResult;
          if (payload.result?.warnings?.length) {
            warnings.push(...payload.result.warnings);
          }
          return;
        }

        failures.push(result.reason instanceof Error ? result.reason.message : "Disconnect failed.");
      });

      if (successCount > 0) {
        refetch();
      }

      if (failures.length > 0) {
        showToast(
          `Disconnected ${successCount} of ${providerLabels.length} integrations. ${failures[0]}`,
        );
        return;
      }

      if (warnings.length > 0) {
        showToast(`All integrations disconnected locally. ${warnings[0]}`);
        return;
      }

      showToast("All integrations disconnected.");
    } catch (disconnectError) {
      showToast(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect integrations.");
    } finally {
      setSaving((current) => ({ ...current, disconnectAll: false }));
    }
  }

  async function exportData() {
    setSaving((current) => ({ ...current, exportData: true }));
    try {
      const response = await authedDownload("/api/settings/export");
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") ?? "";
      const filenameMatch = disposition.match(/filename=\"?([^\";]+)\"?/i);
      const filename = filenameMatch?.[1]?.trim() || `clawcloud-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showToast("Data export downloaded.");
    } catch (exportError) {
      showToast(exportError instanceof Error ? exportError.message : "Unable to export your data.");
    } finally {
      setSaving((current) => ({ ...current, exportData: false }));
    }
  }

  async function deleteAccount() {
    const target = deleteConfirmationTarget;
    if (deleteConfirmation.trim() !== target) {
      showToast(`Type ${target} to confirm account deletion.`);
      return;
    }

    setSaving((current) => ({ ...current, deleteAccount: true }));

    try {
      await authedFetch("/api/settings/account", {
        method: "DELETE",
        body: JSON.stringify({ confirmation: deleteConfirmation.trim() }),
      });

      showToast("Account deleted. Redirecting to sign in...");
      setDeleteConfirmOpen(false);
      setDeleteConfirmation("");

      window.setTimeout(() => {
        void supabase?.auth.signOut().catch(() => null).finally(() => {
          window.location.assign("/auth");
        });
      }, 900);
    } catch (deleteError) {
      showToast(deleteError instanceof Error ? deleteError.message : "Unable to delete your account.");
    } finally {
      setSaving((current) => ({ ...current, deleteAccount: false }));
    }
  }

  async function startGoogleWorkspaceConnect(scopeSet: "core" | "extended") {
    const workspaceOauthAvailable =
      scopeSet === "extended"
        ? Boolean(featureStatus?.google_workspace_extended_connect.available)
        : Boolean(featureStatus?.google_workspace_connect.available);

    if (config.googleRollout.setupLiteMode !== false && !workspaceOauthAvailable) {
      showToast("Google is using the safe Lite setup flow right now. Opening setup instead of Google OAuth.");
      router.push("/setup");
      return;
    }

    setSaving((current) => ({ ...current, googleConnect: true }));
    try {
      const payload = (await authedFetch(
        `/api/auth/google?scopeSet=${scopeSet}&ts=${Date.now()}`,
        { method: "GET" },
      )) as { url?: string };

      if (!payload.url) {
        throw new Error("Unable to start Google Workspace connection.");
      }

      window.location.assign(payload.url);
    } catch (connectError) {
      showToast(connectError instanceof Error ? connectError.message : "Unable to start Google connection.");
    } finally {
      setSaving((current) => ({ ...current, googleConnect: false }));
    }
  }

  async function saveGlobalLiteConnection(provider: GlobalLiteProvider) {
    setSaving((current) => ({ ...current, [`lite-${provider}`]: true }));
    try {
      const body =
        provider === "gmail"
          ? { provider, email: gmailLiteEmail }
          : provider === "google_calendar"
            ? { provider, icsUrl: calendarLiteIcsUrl }
            : { provider, label: driveLiteLabel };

      await authedFetch("/api/global-lite/connections", {
        method: "POST",
        body: JSON.stringify(body),
      });
      refetch();
      showToast(
        provider === "gmail"
          ? "Gmail Lite saved."
          : provider === "google_calendar"
            ? "Calendar Lite saved."
            : "Drive Lite saved.",
      );
    } catch (saveError) {
      showToast(saveError instanceof Error ? saveError.message : "Unable to save Global Lite connection.");
    } finally {
      setSaving((current) => ({ ...current, [`lite-${provider}`]: false }));
    }
  }

  async function removeGlobalLiteConnection(provider: GlobalLiteProvider) {
    setSaving((current) => ({ ...current, [`lite-${provider}`]: true }));
    try {
      await authedFetch(`/api/global-lite/connections/${provider}`, {
        method: "DELETE",
      });
      refetch();
      if (provider === "gmail") {
        setGmailLiteEmail(data?.user?.email ?? "");
      }
      if (provider === "google_calendar") {
        setCalendarLiteIcsUrl("");
      }
      if (provider === "google_drive") {
        setDriveLiteLabel("");
      }
      showToast(
        provider === "gmail"
          ? "Gmail Lite removed."
          : provider === "google_calendar"
            ? "Calendar Lite removed."
            : "Drive Lite removed.",
      );
    } catch (removeError) {
      showToast(removeError instanceof Error ? removeError.message : "Unable to remove Global Lite connection.");
    } finally {
      setSaving((current) => ({ ...current, [`lite-${provider}`]: false }));
    }
  }

  const user = data?.user;
  const plan = (user?.plan ?? "free").toLowerCase();
  const planLabel = titleCase(plan);
  const displayName = fullName || user?.full_name || "ClawCloud User";
  const displayEmail = user?.email ?? "";
  const deleteConfirmationTarget = displayEmail || "DELETE MY ACCOUNT";
  const initials = getInitials(displayName, displayEmail);
  const title = tabs.find((tab) => tab.id === activeTab)?.title ?? tabs[0].title;

  const accounts = data?.connected_accounts ?? [];
  const globalLiteConnections = data?.global_lite_connections ?? [];
  const featureStatus = data?.feature_status;
  const tasks = data?.tasks ?? [];
  const subscription = data?.subscription;
  const agentStatus = data?.agent_status;

  const gmail = accounts.find((account) => account.provider === "gmail" && account.is_active);
  const calendar = accounts.find((account) => account.provider === "google_calendar" && account.is_active);
  const drive = accounts.find((account) => account.provider === "google_drive" && account.is_active);
  const gmailLite = globalLiteConnections.find((connection) => connection.provider === "gmail");
  const calendarLite = globalLiteConnections.find((connection) => connection.provider === "google_calendar");
  const driveLite = globalLiteConnections.find((connection) => connection.provider === "google_drive");
  const whatsapp = accounts.find((account) => account.provider === "whatsapp" && account.is_active);
  const telegram = accounts.find((account) => account.provider === "telegram" && account.is_active);
  const googleCapabilities = data?.google_capabilities;
  const googleConnected = Boolean(gmail || calendar || drive);
  const needsGoogleWriteReconnect = Boolean(
    googleConnected
    && googleCapabilities?.connected
    && (
      googleCapabilities.reconnectRequired
      || (Boolean(gmail) && (!googleCapabilities.gmailModify || !googleCapabilities.gmailCompose || !googleCapabilities.gmailSend))
      || (Boolean(calendar) && !googleCapabilities.calendarWrite)
      || (Boolean(drive) && (!googleCapabilities.driveRead || !googleCapabilities.sheetsWrite))
    ),
  );
  const needsGoogleReconnect = needsGoogleWriteReconnect;
  const googleReconnectScopeSet = Boolean(drive) && featureStatus?.google_workspace_extended_connect.available
    ? "extended"
    : "core";
  const googleReconnectTitle = "Reconnect Google to restore missing Workspace permissions";
  const googleReconnectDetail = needsGoogleWriteReconnect
    ? (googleCapabilities?.reconnectReason
      || "Your saved Google session is missing the permissions needed for the Google services already connected to this account.")
    : null;
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
        ["Global Lite Connect", featureStatus.global_lite_connect],
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
                  <div className={styles.sectionDescription}>Live status from connected accounts, fallback Lite links, and runtime checks.</div>
                </div>
                {!featureStatus?.google_workspace_connect.available && featureStatus?.global_lite_connect.available ? (
                  <div className={styles.integrationBanner}>
                    <div>
                      <div className={styles.integrationBannerTitle}>
                        Global Lite Connect is active for public users
                      </div>
                      <div className={styles.integrationBannerText}>
                        Google Workspace is not available on this deployment right now, so ClawCloud is
                        using Lite mode for Gmail, Calendar, and Drive until full OAuth is configured.
                        Lite mode keeps fallback identities and read-only imports ready, but it does
                        not grant full Gmail, Calendar, or Drive API access.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => router.push("/setup")}
                    >
                      Open setup
                    </button>
                  </div>
                ) : null}
                {needsGoogleReconnect ? (
                  <div className={styles.integrationBanner}>
                    <div>
                      <div className={styles.integrationBannerTitle}>
                        {googleReconnectTitle}
                      </div>
                      <div className={styles.integrationBannerText}>
                        {googleReconnectDetail}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={
                        !(featureStatus?.google_workspace_connect.available || featureStatus?.google_workspace_extended_connect.available)
                        || Boolean(saving.googleConnect)
                      }
                      onClick={() => void startGoogleWorkspaceConnect(googleReconnectScopeSet)}
                    >
                      {saving.googleConnect
                        ? "Connecting..."
                        : (featureStatus?.google_workspace_connect.available || featureStatus?.google_workspace_extended_connect.available)
                        ? "Reconnect Google"
                        : "Unavailable"}
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
                      {googleConnected ? (
                        <div className={styles.scopeText}>
                          {needsGoogleWriteReconnect
                            ? (googleCapabilities?.reconnectReason
                              || "Reconnect Google once to restore Gmail, Calendar, and Drive permissions.")
                            : drive
                              ? "Fully connected for Gmail, Calendar, and Drive."
                              : "Connected for Gmail and Calendar. Reconnect with Drive if you want file and sheet actions too."}
                        </div>
                      ) : null}
                    </div>
                    <div className={styles.integrationActions}>
                      <span className={(gmail || calendar || drive) && !needsGoogleWriteReconnect ? styles.connectedBadge : styles.statusBadgeMuted}>
                        {(gmail || calendar || drive)
                          ? needsGoogleWriteReconnect
                            ? "Reconnect needed"
                            : "Connected"
                          : "Needs setup"}
                      </span>
                      <button
                        type="button"
                        className={styles.primaryButton}
                        disabled={!featureStatus?.google_workspace_connect.available || Boolean(saving.googleConnect)}
                        onClick={() => void startGoogleWorkspaceConnect("core")}
                      >
                        {saving.googleConnect
                          ? "Connecting..."
                          : featureStatus?.google_workspace_connect.available
                            ? "Connect Google"
                            : "Unavailable"}
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
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => router.push(whatsapp ? "/dashboard#whatsapp-workspace" : "/setup")}
                      >
                        {whatsapp ? "Open dashboard panel" : "Open setup"}
                      </button>
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
                {featureStatus?.global_lite_connect.available ? (
                  <div className={styles.card}>
                    <div className={styles.sectionHead}>
                      <div className={styles.sectionTitle}>Global Lite Connect</div>
                      <div className={styles.sectionDescription}>
                        Public-safe fallback connections for Gmail, Calendar, and Drive while Google
                        is still reviewing the sensitive Workspace scopes.
                      </div>
                    </div>

                    <div className={styles.liteBlock}>
                      <div className={styles.liteHeader}>
                        <div>
                          <div className={styles.rowTitle}>Gmail Lite</div>
                          <div className={styles.rowDescription}>
                            {gmailLite
                              ? describeGlobalLiteConnection(gmailLite)
                              : "Save the inbox identity you want ClawCloud to organize under Lite mode."}
                          </div>
                        </div>
                        <span className={gmailLite ? styles.connectedBadge : styles.statusBadgeMuted}>
                          {gmailLite ? "Lite connected" : "Ready"}
                        </span>
                      </div>
                      <div className={styles.field}>
                        <div className={styles.label}>Inbox email</div>
                        <input
                          className={styles.input}
                          type="email"
                          value={gmailLiteEmail}
                          onChange={(event) => setGmailLiteEmail(event.target.value)}
                          placeholder="you@example.com"
                        />
                        <div className={styles.fieldHint}>
                          This keeps the Gmail Lite identity ready for imported or forwarded inbox
                          snapshots until full Gmail OAuth is reopened.
                        </div>
                      </div>
                      <div className={styles.cardFooter}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={Boolean(saving["lite-gmail"])}
                          onClick={() => void saveGlobalLiteConnection("gmail")}
                        >
                          {saving["lite-gmail"] ? "Saving..." : gmailLite ? "Update Gmail Lite" : "Enable Gmail Lite"}
                        </button>
                        {gmailLite ? (
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={Boolean(saving["lite-gmail"])}
                            onClick={() => void removeGlobalLiteConnection("gmail")}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className={styles.liteBlock}>
                      <div className={styles.liteHeader}>
                        <div>
                          <div className={styles.rowTitle}>Calendar Lite</div>
                          <div className={styles.rowDescription}>
                            {calendarLite
                              ? describeGlobalLiteConnection(calendarLite)
                              : "Paste a private ICS feed so ClawCloud can read agendas and availability without Calendar OAuth."}
                          </div>
                        </div>
                        <span className={calendarLite ? styles.connectedBadge : styles.statusBadgeMuted}>
                          {calendarLite ? "Lite connected" : "Ready"}
                        </span>
                      </div>
                      <div className={styles.field}>
                        <div className={styles.label}>Private ICS link</div>
                        <input
                          className={styles.input}
                          value={calendarLiteIcsUrl}
                          onChange={(event) => setCalendarLiteIcsUrl(event.target.value)}
                          placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                        />
                        <div className={styles.fieldHint}>
                          Calendar Lite is read-only, but it is the strongest global fallback
                          because it gives ClawCloud real schedule context today.
                        </div>
                      </div>
                      <div className={styles.cardFooter}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={Boolean(saving["lite-google_calendar"])}
                          onClick={() => void saveGlobalLiteConnection("google_calendar")}
                        >
                          {saving["lite-google_calendar"] ? "Saving..." : calendarLite ? "Update Calendar Lite" : "Enable Calendar Lite"}
                        </button>
                        {calendarLite ? (
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={Boolean(saving["lite-google_calendar"])}
                            onClick={() => void removeGlobalLiteConnection("google_calendar")}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className={styles.liteBlock}>
                      <div className={styles.liteHeader}>
                        <div>
                          <div className={styles.rowTitle}>Drive Lite</div>
                          <div className={styles.rowDescription}>
                            {driveLite
                              ? describeGlobalLiteConnection(driveLite)
                              : "Enable a document vault now so ClawCloud can organize uploads and shared docs whenever Drive OAuth is unavailable on this deployment."}
                          </div>
                        </div>
                        <span className={driveLite ? styles.connectedBadge : styles.statusBadgeMuted}>
                          {driveLite ? "Lite connected" : "Ready"}
                        </span>
                      </div>
                      <div className={styles.field}>
                        <div className={styles.label}>Vault label</div>
                        <input
                          className={styles.input}
                          value={driveLiteLabel}
                          onChange={(event) => setDriveLiteLabel(event.target.value)}
                          placeholder="My ClawCloud document vault"
                        />
                        <div className={styles.fieldHint}>
                          Drive Lite uses uploads and shared docs whenever full Google Drive OAuth is unavailable on this deployment.
                        </div>
                      </div>
                      <div className={styles.cardFooter}>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={Boolean(saving["lite-google_drive"])}
                          onClick={() => void saveGlobalLiteConnection("google_drive")}
                        >
                          {saving["lite-google_drive"] ? "Saving..." : driveLite ? "Update Drive Lite" : "Enable Drive Lite"}
                        </button>
                        {driveLite ? (
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={Boolean(saving["lite-google_drive"])}
                            onClick={() => void removeGlobalLiteConnection("google_drive")}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : null}
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
                  <div className={styles.sectionDescription}>These actions run against your live account data. Export excludes provider credentials, and account deletion is permanent.</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Disconnect all integrations</div>
                      <div className={styles.rowDescription}>Revokes Google tokens, disconnects your WhatsApp session, and unlinks Telegram where connected.</div>
                    </div>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      disabled={!supabase || Boolean(saving.disconnectAll)}
                      onClick={() => void disconnectAll()}
                    >
                      {saving.disconnectAll ? "Disconnecting..." : "Disconnect all"}
                    </button>
                  </div>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Export my data</div>
                      <div className={styles.rowDescription}>Download your profile, automations, billing, approvals, memory, research, saved live-answer evidence trails, and WhatsApp workspace data as JSON.</div>
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={!supabase || Boolean(saving.exportData)}
                      onClick={() => void exportData()}
                    >
                      {saving.exportData ? "Preparing..." : "Download export"}
                    </button>
                  </div>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Delete account</div>
                      <div className={styles.rowDescription}>Permanently deletes your ClawCloud account, connected sessions, research history, saved memory, and task data.</div>
                    </div>
                    <button
                      type="button"
                      className={styles.primaryDangerButton}
                      disabled={!supabase || Boolean(saving.deleteAccount)}
                      onClick={() => {
                        setDeleteConfirmOpen((current) => !current);
                        setDeleteConfirmation("");
                      }}
                    >
                      {deleteConfirmOpen ? "Cancel deletion" : "Delete account"}
                    </button>
                  </div>

                  {deleteConfirmOpen ? (
                    <div className={styles.confirmBox}>
                      <div className={styles.confirmTitle}>Delete account permanently</div>
                      <div className={styles.confirmDescription}>
                        This permanently removes your ClawCloud account and disconnects your active integrations. Type {deleteConfirmationTarget} below to confirm.
                      </div>
                      <div className={styles.field}>
                        <div className={styles.label}>Confirmation</div>
                        <input
                          className={styles.input}
                          value={deleteConfirmation}
                          onChange={(event) => setDeleteConfirmation(event.target.value)}
                          placeholder={deleteConfirmationTarget}
                          autoComplete="off"
                        />
                        <div className={styles.fieldHint}>
                          If your sign-in email changes, this target updates automatically to match the current account.
                        </div>
                      </div>
                      <div className={styles.confirmButtons}>
                        <button
                          type="button"
                          className={styles.secondaryButton}
                          onClick={() => {
                            setDeleteConfirmOpen(false);
                            setDeleteConfirmation("");
                          }}
                        >
                          Keep account
                        </button>
                        <button
                          type="button"
                          className={styles.primaryDangerButton}
                          disabled={
                            Boolean(saving.deleteAccount)
                            || deleteConfirmation.trim() !== deleteConfirmationTarget
                          }
                          onClick={() => void deleteAccount()}
                        >
                          {saving.deleteAccount ? "Deleting..." : "Delete permanently"}
                        </button>
                      </div>
                    </div>
                  ) : null}
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
