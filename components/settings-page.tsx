"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useUpgrade } from "@/hooks/useUpgrade";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./settings-page.module.css";

type SettingsPageProps = { config: PublicAppConfig };
type TabId = "profile" | "notifications" | "integrations" | "agent" | "billing" | "danger";
type NotificationKey =
  | "morningBriefing"
  | "meetingReminders"
  | "draftReadyAlerts"
  | "weeklySummary"
  | "agentErrorAlerts"
  | "productUpdates";

const tabs = [
  { id: "profile", icon: "\u{1F464}", label: "Profile", title: "\u{1F464} Profile" },
  { id: "notifications", icon: "\u{1F514}", label: "Notifications", title: "\u{1F514} Notifications" },
  { id: "integrations", icon: "\u{1F517}", label: "Integrations", title: "\u{1F517} Integrations" },
  { id: "agent", icon: "\u{1F916}", label: "Agent settings", title: "\u{1F916} Agent settings" },
  { id: "billing", icon: "\u{1F4B3}", label: "Plan & billing", title: "\u{1F4B3} Plan & billing" },
  { id: "danger", icon: "\u26A0\uFE0F", label: "Danger zone", title: "\u26A0\uFE0F Danger zone" },
] as const satisfies Array<{ id: TabId; icon: string; label: string; title: string }>;

const notifications: Array<{ key: NotificationKey; title: string; description: string }> = [
  { key: "morningBriefing", title: "Morning briefing", description: "Daily email + calendar summary sent to WhatsApp" },
  { key: "meetingReminders", title: "Meeting reminders", description: "30-minute heads-up before each calendar event" },
  { key: "draftReadyAlerts", title: "Draft ready alerts", description: "Notified when a reply draft is saved to Gmail" },
  { key: "weeklySummary", title: "Weekly summary", description: "Sunday recap of your week's activity" },
  { key: "agentErrorAlerts", title: "Agent error alerts", description: "Alerts when your agent fails to complete a task" },
  { key: "productUpdates", title: "Product updates", description: "New features and announcements from ClawCloud" },
];

const integrations = [
  { icon: "\u{1F4E7}", name: "Gmail", description: "Read-only access to your inbox", scope: "Read emails, labels, threads", connected: true, actionLabel: "Disconnect", toast: "Gmail disconnected" },
  { icon: "\u{1F4C5}", name: "Google Calendar", description: "View your upcoming events", scope: "Read calendar events", connected: true, actionLabel: "Disconnect", toast: "Calendar disconnected" },
  { icon: "\u{1F4AC}", name: "WhatsApp", description: "Send and receive messages via your agent", scope: "Linked to +91 98765 43210", connected: true, actionLabel: "Disconnect", toast: "WhatsApp disconnected" },
  { icon: "\u2708\uFE0F", name: "Telegram", description: "Alternative messaging channel", scope: "Available on Starter plan", connected: false, actionLabel: "Connect \u2192", toast: "Upgrade to Starter to connect Telegram" },
] as const;

const timeOptions = ["6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM"] as const;
const passwordPlaceholder = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function Toggle({
  on,
  label,
  onClick,
}: {
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={cx(styles.toggle, on && styles.toggleOn)}
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
    >
      <span className={styles.toggleThumb} />
    </button>
  );
}

export function SettingsPage({ config }: SettingsPageProps) {
  void config;

  const router = useRouter();
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { upgrade, loading: upgradeLoading, error: upgradeError } = useUpgrade();
  const [activeTab, setActiveTab] = useState<TabId>("profile");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedTime, setSelectedTime] = useState("7:00 AM");
  const [pauseAgent, setPauseAgent] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [notificationState, setNotificationState] = useState<Record<NotificationKey, boolean>>({
    morningBriefing: true,
    meetingReminders: true,
    draftReadyAlerts: true,
    weeklySummary: false,
    agentErrorAlerts: true,
    productUpdates: false,
  });

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (upgradeError) {
      showToast(upgradeError);
    }
  }, [upgradeError]);

  function showToast(message: string) {
    setToast(message);
    setToastVisible(true);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastVisible(false), 2600);
  }

  function save(key: string, message: string) {
    setSaving((current) => ({ ...current, [key]: true }));
    setTimeout(() => {
      setSaving((current) => ({ ...current, [key]: false }));
      showToast(message);
    }, 800);
  }

  function switchTab(next: TabId) {
    setActiveTab(next);
    setSidebarOpen(false);
    if (next !== "danger") {
      setDeleteOpen(false);
      setDeleteText("");
    }
  }

  const title = tabs.find((tab) => tab.id === activeTab)?.title ?? tabs[0].title;

  return (
    <div className={styles.shell}>
      <div
        className={cx(styles.sidebarOverlay, sidebarOpen && styles.sidebarOverlayOpen)}
        onClick={() => setSidebarOpen(false)}
      />
      <aside className={cx(styles.sidebar, sidebarOpen && styles.sidebarOpen)}>
        <div className={styles.sidebarTop}>
          <div className={styles.logoLink}>
            <div className={styles.logoIcon}>{"\u{1F99E}"}</div>
            <div>
              <div className={styles.logoText}>Claw<span>Cloud</span></div>
              <button
                type="button"
                className={styles.backLink}
                style={{ border: "none", background: "none", padding: 0, cursor: "pointer" }}
                onClick={() => {
                  showToast("Going back to dashboard...");
                  router.push("/dashboard");
                }}
              >
                {"\u2190 Back to dashboard"}
              </button>
            </div>
          </div>
        </div>
        <div className={styles.navSectionLabel}>Settings</div>
        <div className={styles.tabNav}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={cx(styles.tabButton, activeTab === tab.id && styles.tabButtonActive)}
              onClick={() => switchTab(tab.id)}
            >
              <span className={styles.tabIcon}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
        <div className={styles.sidebarUser}>
          <div className={styles.userAvatar}>RK</div>
          <div className={styles.userInfo}>
            <div className={styles.userName}>Rahul Kumar</div>
            <span className={styles.planTag}>FREE</span>
          </div>
        </div>
      </aside>
      <div className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            <button
              type="button"
              className={styles.mobileToggle}
              aria-label="Toggle settings menu"
              onClick={() => setSidebarOpen((current) => !current)}
            >
              {"\u2630"}
            </button>
            <div className={styles.pageTitle}>{title}</div>
          </div>
          <div className={styles.topbarRight}>
            <button type="button" className={styles.topbarButton} onClick={() => showToast("Saved!")}>
              Save changes
            </button>
          </div>
        </header>
        <div className={styles.scrollArea}>
          {activeTab === "profile" && (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Personal information</div>
                  <div className={styles.sectionDescription}>Update your name and display preferences</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.avatarRow}>
                    <div className={styles.avatarLarge}>RK</div>
                    <div className={styles.avatarMeta}>
                      <div className={styles.avatarName}>Rahul Kumar</div>
                      <div className={styles.avatarEmail}>rahul@example.com</div>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => showToast("Photo upload coming soon")}
                      >
                        Change photo
                      </button>
                    </div>
                  </div>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <div className={styles.label}>First name</div>
                      <input className={styles.input} defaultValue="Rahul" />
                    </div>
                    <div className={styles.field}>
                      <div className={styles.label}>Last name</div>
                      <input className={styles.input} defaultValue="Kumar" />
                    </div>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Email address</div>
                    <input className={styles.input} type="email" defaultValue="rahul@example.com" />
                    <div className={styles.fieldHint}>Changing email requires re-verification</div>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Timezone</div>
                    <select className={styles.select} defaultValue="India Standard Time (IST, UTC+5:30)">
                      <option>India Standard Time (IST, UTC+5:30)</option>
                      <option>Gulf Standard Time (GST, UTC+4)</option>
                      <option>Greenwich Mean Time (GMT, UTC+0)</option>
                      <option>Eastern Time (ET, UTC-5)</option>
                      <option>Pacific Time (PT, UTC-8)</option>
                    </select>
                  </div>
                  <div className={styles.cardFooter}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={Boolean(saving.profile)}
                      onClick={() => save("profile", "Profile saved \u2713")}
                    >
                      {saving.profile ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </div>
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Password</div>
                  <div className={styles.sectionDescription}>Update your login password</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.field}>
                    <div className={styles.label}>Current password</div>
                    <input className={styles.input} type="password" placeholder={passwordPlaceholder} />
                  </div>
                  <div className={styles.fieldRow}>
                    <div className={styles.field}>
                      <div className={styles.label}>New password</div>
                      <input className={styles.input} type="password" placeholder={passwordPlaceholder} />
                    </div>
                    <div className={styles.field}>
                      <div className={styles.label}>Confirm password</div>
                      <input className={styles.input} type="password" placeholder={passwordPlaceholder} />
                    </div>
                  </div>
                  <div className={styles.cardFooter}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={Boolean(saving.password)}
                      onClick={() => save("password", "Password updated \u2713")}
                    >
                      {saving.password ? "Saving..." : "Update password"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === "notifications" && (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>WhatsApp notifications</div>
                  <div className={styles.sectionDescription}>
                    Control which messages your agent sends to you
                  </div>
                </div>
                <div className={styles.card}>
                  {notifications.map((item) => (
                    <div key={item.key} className={styles.notificationRow}>
                      <div>
                        <div className={styles.rowTitle}>{item.title}</div>
                        <div className={styles.rowDescription}>{item.description}</div>
                      </div>
                      <Toggle
                        on={notificationState[item.key]}
                        label={item.title}
                        onClick={() =>
                          setNotificationState((current) => ({
                            ...current,
                            [item.key]: !current[item.key],
                          }))
                        }
                      />
                    </div>
                  ))}
                  <div className={styles.cardFooter}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={Boolean(saving.notifications)}
                      onClick={() => save("notifications", "Notification preferences saved \u2713")}
                    >
                      {saving.notifications ? "Saving..." : "Save preferences"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === "integrations" && (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Connected accounts</div>
                  <div className={styles.sectionDescription}>
                    Manage the services your agent has access to
                  </div>
                </div>
                <div className={styles.card}>
                  {integrations.map((item) => (
                    <div key={item.name} className={styles.integrationRow}>
                      <div className={styles.integrationIcon}>{item.icon}</div>
                      <div className={styles.integrationBody}>
                        <div className={styles.rowTitle}>{item.name}</div>
                        <div className={styles.rowDescription}>{item.description}</div>
                        <div className={styles.scopeText}>{item.scope}</div>
                      </div>
                      <div className={styles.integrationActions}>
                        {item.connected && (
                          <span className={styles.connectedBadge}>{"\u2713 Connected"}</span>
                        )}
                        <button
                          type="button"
                          className={item.connected ? styles.dangerButton : styles.primaryButton}
                          onClick={() => showToast(item.toast)}
                        >
                          {item.actionLabel}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          {activeTab === "agent" && (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Agent configuration</div>
                  <div className={styles.sectionDescription}>Tune how and when your AI agent works</div>
                </div>
                <div className={styles.card}>
                  <div className={styles.field}>
                    <div className={styles.label}>Morning briefing time</div>
                    <div className={styles.timeOptions}>
                      {timeOptions.map((time) => (
                        <button
                          key={time}
                          type="button"
                          className={cx(
                            styles.timeButton,
                            selectedTime === time && styles.timeButtonActive,
                          )}
                          onClick={() => setSelectedTime(time)}
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.label}>Agent region</div>
                    <select className={styles.select} defaultValue="Mumbai (ap-south-1)">
                      <option>Mumbai (ap-south-1)</option>
                      <option>Singapore (ap-southeast-1)</option>
                      <option>Frankfurt (eu-central-1)</option>
                      <option>Virginia (us-east-1)</option>
                    </select>
                    <div className={styles.fieldHint}>
                      Closer region = faster responses. Mumbai recommended for India.
                    </div>
                  </div>
                  <div className={styles.toggleField}>
                    <div>
                      <div className={styles.rowTitle}>Auto-send draft replies</div>
                      <div className={styles.rowDescription}>
                        Agent sends drafted replies automatically - Pro plan only
                      </div>
                    </div>
                    <Toggle
                      on={false}
                      label="Auto-send draft replies"
                      onClick={() => showToast("Auto-send requires Pro plan - upgrade to enable")}
                    />
                  </div>
                  <div className={styles.toggleField}>
                    <div>
                      <div className={styles.rowTitle}>Pause agent</div>
                      <div className={styles.rowDescription}>
                        Temporarily stop all automations without disconnecting integrations
                      </div>
                    </div>
                    <Toggle
                      on={pauseAgent}
                      label="Pause agent"
                      onClick={() =>
                        setPauseAgent((current) => {
                          const next = !current;
                          showToast(next ? "Agent paused" : "Agent resumed \u2713");
                          return next;
                        })
                      }
                    />
                  </div>
                  <div className={styles.cardFooter}>
                    <button
                      type="button"
                      className={styles.primaryButton}
                      disabled={Boolean(saving.agent)}
                      onClick={() => save("agent", "Agent settings saved \u2713")}
                    >
                      {saving.agent ? "Saving..." : "Save agent settings"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === "billing" && (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Current plan</div>
                  <div className={styles.sectionDescription}>
                    Manage your subscription and billing
                  </div>
                </div>
                <div className={styles.card}>
                  <div className={styles.planHeader}>
                    <div>
                      <div className={styles.planName}>Free plan</div>
                      <div className={styles.planDescription}>
                        1 active automation · 3 runs/day · WhatsApp only
                      </div>
                    </div>
                    <span className={styles.planTagLarge}>FREE</span>
                  </div>
                  <div className={styles.divider} />
                  <div className={styles.rowTitle}>Usage this month</div>
                  <div className={styles.metricGroup}>
                    <div className={styles.metricHeader}>
                      <span>Daily runs used</span>
                      <span>3 / 3</span>
                    </div>
                    <div className={styles.progressTrack}>
                      <div className={styles.progressFillFull} />
                    </div>
                  </div>
                  <div className={styles.metricGroup}>
                    <div className={styles.metricHeader}>
                      <span>Active automations</span>
                      <span>1 / 1</span>
                    </div>
                    <div className={styles.progressTrack}>
                      <div className={styles.progressFillAmber} />
                    </div>
                  </div>
                </div>
              </div>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Upgrade your plan</div>
                  <div className={styles.sectionDescription}>
                    Unlock more automations, unlimited runs, and Telegram support
                  </div>
                </div>
                <div className={styles.upgradeCard}>
                  <div>
                    <div className={styles.upgradeTitle}>{"Starter - \u20B9799/month"}</div>
                    <div className={styles.upgradeDescription}>
                      5 automations · Unlimited runs · Gmail + Calendar + WhatsApp + Telegram · Draft replies
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={upgradeLoading}
                    onClick={() =>
                      void upgrade({ plan: "starter", period: "monthly", currency: "inr" })
                    }
                  >
                    {upgradeLoading ? "Opening..." : "Upgrade \u2192"}
                  </button>
                </div>
                <div className={cx(styles.upgradeCard, styles.upgradeCardMuted)}>
                  <div>
                    <div className={styles.upgradeTitle}>{"Pro - \u20B92,499/month"}</div>
                    <div className={styles.upgradeDescription}>
                      Unlimited automations · All integrations · Auto-send · Custom schedules · Priority support
                    </div>
                  </div>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    disabled={upgradeLoading}
                    onClick={() =>
                      void upgrade({ plan: "pro", period: "monthly", currency: "inr" })
                    }
                  >
                    {upgradeLoading ? "Opening..." : "Get Pro \u2192"}
                  </button>
                </div>
              </div>
            </div>
          )}
          {activeTab === "danger" && (
            <div className={styles.tabPanel}>
              <div className={styles.section}>
                <div className={styles.sectionHead}>
                  <div className={styles.sectionTitle}>Danger zone</div>
                  <div className={styles.sectionDescription}>
                    Irreversible actions - please read carefully before proceeding
                  </div>
                </div>
                <div className={styles.card}>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Export my data</div>
                      <div className={styles.rowDescription}>
                        Download all your data including agent logs, messages, and account info
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => showToast("Export started - download link sent to WhatsApp")}
                    >
                      Export data
                    </button>
                  </div>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Disconnect all integrations</div>
                      <div className={styles.rowDescription}>
                        Revoke Gmail, Calendar, and WhatsApp access. Your account remains active.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.dangerButton}
                      onClick={() => showToast("All integrations disconnected")}
                    >
                      Disconnect all
                    </button>
                  </div>
                  <div className={styles.dangerRow}>
                    <div>
                      <div className={styles.rowTitle}>Delete account</div>
                      <div className={styles.rowDescription}>
                        Permanently delete your account and all data. This cannot be undone.
                      </div>
                    </div>
                    <button
                      type="button"
                      className={styles.primaryDangerButton}
                      onClick={() => setDeleteOpen(true)}
                    >
                      Delete account
                    </button>
                  </div>
                </div>
                {deleteOpen && (
                  <div className={styles.confirmBox}>
                    <div className={styles.confirmTitle}>{"\u26A0\uFE0F Are you absolutely sure?"}</div>
                    <div className={styles.confirmDescription}>
                      This will permanently delete your account, all automations, agent history, and integrations.
                      Type <strong>DELETE</strong> to confirm.
                    </div>
                    <input
                      className={styles.input}
                      placeholder="Type DELETE to confirm"
                      value={deleteText}
                      onChange={(event) => setDeleteText(event.target.value)}
                    />
                    <div className={styles.confirmButtons}>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => {
                          setDeleteOpen(false);
                          setDeleteText("");
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className={styles.primaryDangerButton}
                        disabled={deleteText !== "DELETE"}
                        onClick={() => {
                          showToast("Account deleted");
                          setDeleteOpen(false);
                          setDeleteText("");
                        }}
                      >
                        Yes, delete my account
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className={cx(styles.toast, toastVisible && styles.toastVisible)}>{toast}</div>
    </div>
  );
}
