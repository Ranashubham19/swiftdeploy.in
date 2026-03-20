"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition, type FormEvent } from "react";

import {
  type WhatsAppAuditEntry,
  defaultWhatsAppSettings,
  type WhatsAppGroupThreadInsight,
  type WhatsAppHistoryEntry,
  type WhatsAppHistoryInsights,
  type WhatsAppInboxContact,
  type WhatsAppInboxSummary,
  type WhatsAppMediaSummary,
  type WhatsAppPrivacyDeleteMode,
  type WhatsAppReplyApproval,
  type WhatsAppSettings,
  type WhatsAppWorkflow,
  type WhatsAppWorkflowRun,
} from "@/lib/clawcloud-whatsapp-workspace-types";

import styles from "./whatsapp-control-center.module.css";

type ControlResponse = { settings: WhatsAppSettings; summary: WhatsAppInboxSummary };
type ApprovalsResponse = { approvals: WhatsAppReplyApproval[] };
type HistoryResponse = {
  history: WhatsAppHistoryEntry[];
  insights: WhatsAppHistoryInsights;
  groupThreads: WhatsAppGroupThreadInsight[];
  mediaSummary: WhatsAppMediaSummary;
};
type ContactsResponse = { contacts: WhatsAppInboxContact[] };
type WorkflowsResponse = { workflows: WhatsAppWorkflow[]; runs: WhatsAppWorkflowRun[] };
type AuditResponse = { audit: WhatsAppAuditEntry[] };

const EMPTY_SUMMARY: WhatsAppInboxSummary = {
  connected: false,
  contactCount: 0,
  pendingApprovalCount: 0,
  awaitingReplyCount: 0,
  highPriorityCount: 0,
  recentMessageCount: 0,
  groupThreadCount: 0,
  mediaMessageCount: 0,
  sensitiveMessageCount: 0,
};

const EMPTY_INSIGHTS: WhatsAppHistoryInsights = {
  resultCount: 0,
  awaitingReplyCount: 0,
  sensitiveCount: 0,
  blockedCount: 0,
  groupCount: 0,
  mediaCount: 0,
};

const EMPTY_MEDIA: WhatsAppMediaSummary = {
  image: 0,
  audio: 0,
  document: 0,
  video: 0,
  other: 0,
};

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not available";
  try {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return "n/a";
  return `${Math.round(value * 100)}%`;
}

async function readJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload as T;
}

export function WhatsAppControlCenter() {
  const [settings, setSettings] = useState(defaultWhatsAppSettings);
  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [approvals, setApprovals] = useState<WhatsAppReplyApproval[]>([]);
  const [history, setHistory] = useState<WhatsAppHistoryEntry[]>([]);
  const [insights, setInsights] = useState(EMPTY_INSIGHTS);
  const [groups, setGroups] = useState<WhatsAppGroupThreadInsight[]>([]);
  const [media, setMedia] = useState(EMPTY_MEDIA);
  const [contacts, setContacts] = useState<WhatsAppInboxContact[]>([]);
  const [workflows, setWorkflows] = useState<WhatsAppWorkflow[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<WhatsAppWorkflowRun[]>([]);
  const [auditEntries, setAuditEntries] = useState<WhatsAppAuditEntry[]>([]);
  const [approvalDrafts, setApprovalDrafts] = useState<Record<string, string>>({});
  const [contactDrafts, setContactDrafts] = useState<Record<string, { priority: string; tags: string }>>({});
  const [workflowDrafts, setWorkflowDrafts] = useState<Record<string, {
    is_enabled: boolean;
    approval_required: boolean;
    delay_minutes: number;
    scope: string;
    template: string;
    trigger_keywords: string;
  }>>({});
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyContact, setHistoryContact] = useState("");
  const [historyChatType, setHistoryChatType] = useState("all");
  const [historyApprovalState, setHistoryApprovalState] = useState("all");
  const [historySensitivity, setHistorySensitivity] = useState("all");
  const [historyDirection, setHistoryDirection] = useState("all");
  const [historyMediaOnly, setHistoryMediaOnly] = useState(false);
  const [historyAwaitingOnly, setHistoryAwaitingOnly] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [contactView, setContactView] = useState<"all" | "awaiting" | "priority" | "vip">("all");
  const [privacyMode, setPrivacyMode] = useState<WhatsAppPrivacyDeleteMode>("retention");
  const [privacyContact, setPrivacyContact] = useState("");
  const [privacyPreview, setPrivacyPreview] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingKey, setSavingKey] = useState("");
  const [isPending, startTransition] = useTransition();

  function historyQueryString(overrides?: Partial<Record<string, string | boolean>>) {
    const params = new URLSearchParams({ limit: "150" });
    const values = {
      q: overrides?.q ?? historyQuery,
      contact: overrides?.contact ?? historyContact,
      chatType: overrides?.chatType ?? historyChatType,
      approvalState: overrides?.approvalState ?? historyApprovalState,
      sensitivity: overrides?.sensitivity ?? historySensitivity,
      direction: overrides?.direction ?? historyDirection,
      mediaOnly: overrides?.mediaOnly ?? historyMediaOnly,
      awaitingOnly: overrides?.awaitingOnly ?? historyAwaitingOnly,
    };

    if (String(values.q).trim()) params.set("q", String(values.q).trim());
    if (String(values.contact).trim()) params.set("contact", String(values.contact).trim());
    if (values.chatType !== "all") params.set("chatType", String(values.chatType));
    if (values.approvalState !== "all") params.set("approvalState", String(values.approvalState));
    if (values.sensitivity !== "all") params.set("sensitivity", String(values.sensitivity));
    if (values.direction !== "all") params.set("direction", String(values.direction));
    if (values.mediaOnly) params.set("mediaOnly", "true");
    if (values.awaitingOnly) params.set("awaitingOnly", "true");
    return params.toString();
  }

  function applyHistory(snapshot: HistoryResponse) {
    setHistory(snapshot.history);
    setInsights(snapshot.insights);
    setGroups(snapshot.groupThreads);
    setMedia(snapshot.mediaSummary);
  }

  async function refreshControl() {
    const control = await readJson<ControlResponse>("/api/whatsapp/control");
    setSettings(control.settings);
    setSummary(control.summary);
  }

  async function refreshApprovals() {
    const response = await readJson<ApprovalsResponse>("/api/whatsapp/approvals");
    setApprovals(response.approvals);
    setApprovalDrafts((current) => {
      const next = { ...current };
      for (const approval of response.approvals) next[approval.id] = next[approval.id] ?? approval.draft_reply;
      return next;
    });
  }

  async function refreshContacts() {
    const response = await readJson<ContactsResponse>("/api/whatsapp/contacts");
    setContacts(response.contacts);
    setContactDrafts((current) => {
      const next = { ...current };
      for (const contact of response.contacts) {
        next[contact.jid] = next[contact.jid] ?? { priority: contact.priority, tags: contact.tags.join(", ") };
      }
      return next;
    });
  }

  async function refreshWorkflows() {
    const response = await readJson<WorkflowsResponse>("/api/whatsapp/workflows");
    setWorkflows(response.workflows);
    setWorkflowRuns(response.runs);
    setWorkflowDrafts((current) => {
      const next = { ...current };
      for (const workflow of response.workflows) {
        next[workflow.workflow_type] = next[workflow.workflow_type] ?? {
          is_enabled: workflow.is_enabled,
          approval_required: workflow.approval_required,
          delay_minutes: workflow.delay_minutes,
          scope: workflow.scope,
          template: workflow.template ?? "",
          trigger_keywords: workflow.trigger_keywords.join(", "),
        };
      }
      return next;
    });
  }

  async function refreshAudit() {
    const response = await readJson<AuditResponse>("/api/whatsapp/audit?limit=120");
    setAuditEntries(response.audit);
  }

  async function refreshHistory(query = historyQueryString()) {
    applyHistory(await readJson<HistoryResponse>(`/api/whatsapp/history?${query}`));
  }

  async function refreshAll(query = historyQueryString()) {
    const [control, approvalsResponse, contactsResponse, historyResponse, workflowsResponse, auditResponse] = await Promise.all([
      readJson<ControlResponse>("/api/whatsapp/control"),
      readJson<ApprovalsResponse>("/api/whatsapp/approvals"),
      readJson<ContactsResponse>("/api/whatsapp/contacts"),
      readJson<HistoryResponse>(`/api/whatsapp/history?${query}`),
      readJson<WorkflowsResponse>("/api/whatsapp/workflows"),
      readJson<AuditResponse>("/api/whatsapp/audit?limit=120"),
    ]);

    setSettings(control.settings);
    setSummary(control.summary);
    setApprovals(approvalsResponse.approvals);
    applyHistory(historyResponse);
    setContacts(contactsResponse.contacts);
    setWorkflows(workflowsResponse.workflows);
    setWorkflowRuns(workflowsResponse.runs);
    setAuditEntries(auditResponse.audit);
    setApprovalDrafts((current) => {
      const next = { ...current };
      for (const approval of approvalsResponse.approvals) next[approval.id] = next[approval.id] ?? approval.draft_reply;
      return next;
    });
    setContactDrafts((current) => {
      const next = { ...current };
      for (const contact of contactsResponse.contacts) {
        next[contact.jid] = next[contact.jid] ?? { priority: contact.priority, tags: contact.tags.join(", ") };
      }
      return next;
    });
    setWorkflowDrafts((current) => {
      const next = { ...current };
      for (const workflow of workflowsResponse.workflows) {
        next[workflow.workflow_type] = next[workflow.workflow_type] ?? {
          is_enabled: workflow.is_enabled,
          approval_required: workflow.approval_required,
          delay_minutes: workflow.delay_minutes,
          scope: workflow.scope,
          template: workflow.template ?? "",
          trigger_keywords: workflow.trigger_keywords.join(", "),
        };
      }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    void refreshAll().catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Failed to load WhatsApp control center.");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function handleSettingsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingKey("settings");
    setError("");
    setNotice("");
    try {
      const response = await readJson<{ settings: WhatsAppSettings }>("/api/whatsapp/control", {
        method: "PATCH",
        body: JSON.stringify(settings),
      });
      setSettings(response.settings);
      await refreshControl();
      setNotice("WhatsApp control settings updated.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not save settings.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleApprovalAction(approval: WhatsAppReplyApproval, action: "send" | "skip") {
    setSavingKey(approval.id);
    setError("");
    setNotice("");
    try {
      await readJson(`/api/whatsapp/approvals/${approval.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action, draftReply: approvalDrafts[approval.id] ?? approval.draft_reply }),
      });
      await Promise.all([refreshControl(), refreshApprovals(), refreshHistory()]);
      setNotice(action === "send" ? "Approval sent to WhatsApp." : "Approval skipped.");
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "Could not update approval.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleContactSave(contact: WhatsAppInboxContact) {
    setSavingKey(contact.jid);
    setError("");
    setNotice("");
    const draft = contactDrafts[contact.jid] ?? { priority: contact.priority, tags: contact.tags.join(", ") };
    try {
      await readJson("/api/whatsapp/contacts", {
        method: "PATCH",
        body: JSON.stringify({
          jid: contact.jid,
          priority: draft.priority,
          tags: draft.tags.split(",").map((value) => value.trim()).filter(Boolean),
        }),
      });
      await Promise.all([refreshControl(), refreshContacts()]);
      setNotice(`Updated ${contact.display_name}.`);
    } catch (contactError) {
      setError(contactError instanceof Error ? contactError.message : "Could not save contact.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleWorkflowSave(workflowType: string) {
    const draft = workflowDrafts[workflowType];
    if (!draft) {
      return;
    }

    setSavingKey(workflowType);
    setError("");
    setNotice("");
    try {
      await readJson("/api/whatsapp/workflows", {
        method: "PATCH",
        body: JSON.stringify({
          workflowType,
          patch: {
            is_enabled: draft.is_enabled,
            approval_required: draft.approval_required,
            delay_minutes: draft.delay_minutes,
            scope: draft.scope,
            template: draft.template,
            trigger_keywords: draft.trigger_keywords
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          },
        }),
      });
      await Promise.all([refreshWorkflows(), refreshAudit()]);
      setNotice("Workflow updated.");
    } catch (workflowError) {
      setError(workflowError instanceof Error ? workflowError.message : "Could not update workflow.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleProcessWorkflows() {
    setSavingKey("workflow-process");
    setError("");
    setNotice("");
    try {
      await readJson("/api/whatsapp/workflows/process", { method: "POST", body: JSON.stringify({}) });
      await Promise.all([refreshApprovals(), refreshWorkflows(), refreshAudit(), refreshControl()]);
      setNotice("Processed due workflows.");
    } catch (processError) {
      setError(processError instanceof Error ? processError.message : "Could not process workflows.");
    } finally {
      setSavingKey("");
    }
  }

  async function handleExportData() {
    setSavingKey("privacy-export");
    setError("");
    setNotice("");
    try {
      const payload = await readJson<Record<string, unknown>>("/api/whatsapp/privacy/export");
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `clawcloud-whatsapp-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("WhatsApp export downloaded.");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Could not export WhatsApp data.");
    } finally {
      setSavingKey("");
    }
  }

  async function handlePrivacyDelete(dryRun: boolean) {
    setSavingKey(dryRun ? "privacy-dry-run" : "privacy-delete");
    setError("");
    setNotice("");
    try {
      const result = await readJson<{ deleted: Record<string, number> }>("/api/whatsapp/privacy/delete", {
        method: "POST",
        body: JSON.stringify({
          mode: privacyMode,
          contact: privacyMode === "contact" ? privacyContact : null,
          retentionDays: settings.retentionDays,
          dryRun,
        }),
      });
      setPrivacyPreview(result.deleted);
      if (!dryRun) {
        await Promise.all([refreshAll(), refreshAudit()]);
      }
      setNotice(dryRun ? "Privacy cleanup preview ready." : "Privacy cleanup completed.");
    } catch (privacyError) {
      setError(privacyError instanceof Error ? privacyError.message : "Could not run privacy cleanup.");
    } finally {
      setSavingKey("");
    }
  }

  function handleHistorySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    startTransition(() => {
      void refreshHistory().catch((historyError) => {
        setError(historyError instanceof Error ? historyError.message : "Could not search history.");
      });
    });
  }

  function resetHistoryFilters() {
    setHistoryQuery("");
    setHistoryContact("");
    setHistoryChatType("all");
    setHistoryApprovalState("all");
    setHistorySensitivity("all");
    setHistoryDirection("all");
    setHistoryMediaOnly(false);
    setHistoryAwaitingOnly(false);
    startTransition(() => {
      void refreshHistory("limit=150").catch((historyError) => {
        setError(historyError instanceof Error ? historyError.message : "Could not reset history filters.");
      });
    });
  }

  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const filteredContacts = useMemo(() => {
    const normalized = contactSearch.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (contactView === "awaiting" && !contact.awaiting_reply) return false;
      if (contactView === "priority" && contact.priority !== "high" && contact.priority !== "vip") return false;
      if (contactView === "vip" && contact.priority !== "vip") return false;
      if (!normalized) return true;
      return (
        contact.display_name.toLowerCase().includes(normalized)
        || String(contact.phone_number ?? "").toLowerCase().includes(normalized)
        || contact.aliases.some((alias) => alias.toLowerCase().includes(normalized))
        || contact.tags.some((tag) => tag.toLowerCase().includes(normalized))
      );
    });
  }, [contactSearch, contactView, contacts]);

  return (
    <div className={styles.shell}>
      <div className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>WhatsApp Control Center</p>
          <h1 className={styles.title}>Operate ClawCloud like a real WhatsApp assistant.</h1>
          <p className={styles.subtitle}>Tune automation, search history, watch groups and media, and manage inbox priority from one place.</p>
        </div>
        <div className={styles.heroActions}>
          <Link href="/dashboard" className={styles.secondaryLink}>Back to dashboard</Link>
          <Link href="/settings?tab=integrations" className={styles.primaryLink}>Open integrations</Link>
        </div>
      </div>

      {notice ? <div className={styles.notice}>{notice}</div> : null}
      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={styles.summaryGrid}>
        <article className={styles.summaryCard}><span className={styles.cardLabel}>Session</span><strong className={styles.cardValue}>{summary.connected ? "Connected" : "Not connected"}</strong><p className={styles.cardMeta}>Current WhatsApp runtime status.</p></article>
        <article className={styles.summaryCard}><span className={styles.cardLabel}>Pending approvals</span><strong className={styles.cardValue}>{summary.pendingApprovalCount}</strong><p className={styles.cardMeta}>Replies waiting for review.</p></article>
        <article className={styles.summaryCard}><span className={styles.cardLabel}>Awaiting reply</span><strong className={styles.cardValue}>{summary.awaitingReplyCount}</strong><p className={styles.cardMeta}>Chats marked for follow-up.</p></article>
        <article className={styles.summaryCard}><span className={styles.cardLabel}>High priority</span><strong className={styles.cardValue}>{summary.highPriorityCount}</strong><p className={styles.cardMeta}>High and VIP contacts.</p></article>
        <article className={styles.summaryCard}><span className={styles.cardLabel}>Active groups</span><strong className={styles.cardValue}>{summary.groupThreadCount}</strong><p className={styles.cardMeta}>Group threads seen this week.</p></article>
        <article className={styles.summaryCard}><span className={styles.cardLabel}>Media / sensitive</span><strong className={styles.cardValue}>{summary.mediaMessageCount} / {summary.sensitiveMessageCount}</strong><p className={styles.cardMeta}>Media items and sensitive messages this week.</p></article>
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.panelEyebrow}>Phase 1 to 3</p><h2 className={styles.panelTitle}>Automation rules</h2></div>
            <span className={styles.panelBadge}>{loading ? "Loading" : "Live"}</span>
          </div>
          <form className={styles.form} onSubmit={handleSettingsSubmit}>
            <label className={styles.field}><span>Automation mode</span><select className={styles.select} value={settings.automationMode} onChange={(event) => setSettings((current) => ({ ...current, automationMode: event.target.value as WhatsAppSettings["automationMode"] }))}><option value="read_only">Read only</option><option value="suggest_only">Suggest only</option><option value="approve_before_send">Approve before send</option><option value="auto_reply">Auto reply</option></select></label>
            <label className={styles.field}><span>Reply tone</span><select className={styles.select} value={settings.replyMode} onChange={(event) => setSettings((current) => ({ ...current, replyMode: event.target.value as WhatsAppSettings["replyMode"] }))}><option value="balanced">Balanced</option><option value="professional">Professional</option><option value="friendly">Friendly</option><option value="brief">Brief</option></select></label>
            <label className={styles.field}><span>Group behavior</span><select className={styles.select} value={settings.groupReplyMode} onChange={(event) => setSettings((current) => ({ ...current, groupReplyMode: event.target.value as WhatsAppSettings["groupReplyMode"] }))}><option value="mention_only">Only when mentioned</option><option value="allow">Allow group replies</option><option value="never">Never reply in groups</option></select></label>
            <div className={styles.switchGroup}>
              <label className={styles.toggle}><input type="checkbox" checked={settings.requireApprovalForSensitive} onChange={(event) => setSettings((current) => ({ ...current, requireApprovalForSensitive: event.target.checked }))} /><span>Require approval for sensitive content</span></label>
              <label className={styles.toggle}><input type="checkbox" checked={settings.allowGroupReplies} onChange={(event) => setSettings((current) => ({ ...current, allowGroupReplies: event.target.checked }))} /><span>Allow group replies</span></label>
              <label className={styles.toggle}><input type="checkbox" checked={settings.allowDirectSendCommands} onChange={(event) => setSettings((current) => ({ ...current, allowDirectSendCommands: event.target.checked }))} /><span>Allow direct send commands</span></label>
              <label className={styles.toggle}><input type="checkbox" checked={settings.requireApprovalForNewContacts} onChange={(event) => setSettings((current) => ({ ...current, requireApprovalForNewContacts: event.target.checked }))} /><span>Require approval for new contacts</span></label>
              <label className={styles.toggle}><input type="checkbox" checked={settings.requireApprovalForFirstOutreach} onChange={(event) => setSettings((current) => ({ ...current, requireApprovalForFirstOutreach: event.target.checked }))} /><span>Require approval for first outreach</span></label>
              <label className={styles.toggle}><input type="checkbox" checked={settings.allowWorkflowAutoSend} onChange={(event) => setSettings((current) => ({ ...current, allowWorkflowAutoSend: event.target.checked }))} /><span>Allow workflows to auto-send when safe</span></label>
              <label className={styles.toggle}><input type="checkbox" checked={settings.maskSensitivePreviews} onChange={(event) => setSettings((current) => ({ ...current, maskSensitivePreviews: event.target.checked }))} /><span>Mask sensitive previews in exports and workspace tools</span></label>
            </div>
            <div className={styles.inlineFields}>
              <label className={styles.field}><span>Quiet hours start</span><input className={styles.input} type="time" value={settings.quietHoursStart ?? ""} onChange={(event) => setSettings((current) => ({ ...current, quietHoursStart: event.target.value || null }))} /></label>
              <label className={styles.field}><span>Quiet hours end</span><input className={styles.input} type="time" value={settings.quietHoursEnd ?? ""} onChange={(event) => setSettings((current) => ({ ...current, quietHoursEnd: event.target.value || null }))} /></label>
            </div>
            <label className={styles.field}><span>Retention days</span><input className={styles.input} type="number" min={7} max={3650} value={settings.retentionDays} onChange={(event) => setSettings((current) => ({ ...current, retentionDays: Number(event.target.value) || current.retentionDays }))} /></label>
            <button className={styles.primaryButton} type="submit" disabled={savingKey === "settings"}>{savingKey === "settings" ? "Saving..." : "Save controls"}</button>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.panelEyebrow}>Phase 1</p><h2 className={styles.panelTitle}>Pending approvals</h2></div>
            <span className={styles.panelBadge}>{pendingApprovals.length} waiting</span>
          </div>
          <div className={styles.stack}>
            {pendingApprovals.length === 0 ? <div className={styles.emptyState}>No WhatsApp replies are waiting for approval right now.</div> : pendingApprovals.map((approval) => (
              <article key={approval.id} className={styles.approvalCard}>
                <div className={styles.approvalHeader}><div><strong>{approval.contact_name || approval.remote_phone || "Contact"}</strong><p className={styles.mutedText}>{approval.reason || "Queued for review"} | {approval.sensitivity} | {formatConfidence(approval.confidence)}</p></div><span className={styles.statusPill}>{approval.status}</span></div>
                <div className={styles.messageBlock}><span className={styles.blockLabel}>Incoming</span><p>{approval.source_message}</p></div>
                <label className={styles.field}><span>Draft reply</span><textarea className={styles.textarea} value={approvalDrafts[approval.id] ?? approval.draft_reply} onChange={(event) => setApprovalDrafts((current) => ({ ...current, [approval.id]: event.target.value }))} /></label>
                <div className={styles.actionRow}>
                  <button type="button" className={styles.primaryButton} disabled={savingKey === approval.id} onClick={() => void handleApprovalAction(approval, "send")}>{savingKey === approval.id ? "Working..." : "Send reply"}</button>
                  <button type="button" className={styles.secondaryButton} disabled={savingKey === approval.id} onClick={() => void handleApprovalAction(approval, "skip")}>Skip</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.panelEyebrow}>Phase 2, 6 and 7</p><h2 className={styles.panelTitle}>History intelligence</h2></div>
            <span className={styles.panelBadge}>{insights.resultCount} rows</span>
          </div>
          <form className={styles.historyFilterForm} onSubmit={handleHistorySubmit}>
            <div className={styles.searchRow}>
              <input className={styles.input} placeholder="Search message text" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} />
              <input className={styles.input} placeholder="Filter by contact or number" value={historyContact} onChange={(event) => setHistoryContact(event.target.value)} />
            </div>
            <div className={styles.filterGrid}>
              <label className={styles.field}><span>Chat type</span><select className={styles.select} value={historyChatType} onChange={(event) => setHistoryChatType(event.target.value)}><option value="all">All</option><option value="direct">Direct</option><option value="group">Group</option><option value="self">Self</option></select></label>
              <label className={styles.field}><span>Approval state</span><select className={styles.select} value={historyApprovalState} onChange={(event) => setHistoryApprovalState(event.target.value)}><option value="all">All</option><option value="pending">Pending</option><option value="blocked">Blocked</option><option value="skipped">Skipped</option><option value="approved">Approved</option><option value="not_required">Auto-sent</option></select></label>
              <label className={styles.field}><span>Sensitivity</span><select className={styles.select} value={historySensitivity} onChange={(event) => setHistorySensitivity(event.target.value)}><option value="all">All</option><option value="normal">Normal</option><option value="sensitive">Sensitive</option><option value="critical">Critical</option></select></label>
              <label className={styles.field}><span>Direction</span><select className={styles.select} value={historyDirection} onChange={(event) => setHistoryDirection(event.target.value)}><option value="all">All</option><option value="inbound">Inbound</option><option value="outbound">Outbound</option></select></label>
            </div>
            <div className={styles.toggleRow}>
              <label className={styles.toggle}><input type="checkbox" checked={historyMediaOnly} onChange={(event) => setHistoryMediaOnly(event.target.checked)} /><span>Media only</span></label>
              <label className={styles.toggle}><input type="checkbox" checked={historyAwaitingOnly} onChange={(event) => setHistoryAwaitingOnly(event.target.checked)} /><span>Awaiting reply only</span></label>
            </div>
            <div className={styles.actionRow}>
              <button className={styles.primaryButton} type="submit" disabled={isPending}>{isPending ? "Searching..." : "Search history"}</button>
              <button className={styles.secondaryButton} type="button" onClick={resetHistoryFilters}>Reset filters</button>
            </div>
          </form>
          <div className={styles.insightGrid}>
            <article className={styles.insightCard}><span className={styles.cardLabel}>Awaiting</span><strong>{insights.awaitingReplyCount}</strong></article>
            <article className={styles.insightCard}><span className={styles.cardLabel}>Sensitive</span><strong>{insights.sensitiveCount}</strong></article>
            <article className={styles.insightCard}><span className={styles.cardLabel}>Groups</span><strong>{insights.groupCount}</strong></article>
            <article className={styles.insightCard}><span className={styles.cardLabel}>Media</span><strong>{insights.mediaCount}</strong></article>
          </div>
          <div className={styles.historySubgrid}>
            <div className={styles.subPanel}>
              <div className={styles.subPanelHeader}><strong>Group watchlist</strong><span>{groups.length}</span></div>
              <div className={styles.subPanelStack}>
                {groups.length === 0 ? <div className={styles.emptyState}>No group activity matched the current filters.</div> : groups.map((group) => (
                  <article key={group.jid} className={styles.groupCard}>
                    <div className={styles.groupHeader}><strong>{group.display_name}</strong><span>{group.message_count} msgs</span></div>
                    <p className={styles.mutedText}>Pending: {group.pending_approval_count} | Sensitive: {group.sensitive_count}</p>
                    <p className={styles.preview}>{group.last_message_preview || "No preview yet."}</p>
                  </article>
                ))}
              </div>
            </div>
            <div className={styles.subPanel}>
              <div className={styles.subPanelHeader}><strong>Media lane</strong><span>{summary.mediaMessageCount} this week</span></div>
              <div className={styles.mediaGrid}>
                <article className={styles.mediaCard}><span>Images</span><strong>{media.image}</strong></article>
                <article className={styles.mediaCard}><span>Audio</span><strong>{media.audio}</strong></article>
                <article className={styles.mediaCard}><span>Documents</span><strong>{media.document}</strong></article>
                <article className={styles.mediaCard}><span>Videos</span><strong>{media.video}</strong></article>
              </div>
            </div>
          </div>
          <div className={styles.historyList}>
            {history.length === 0 ? <div className={styles.emptyState}>No history matched your search.</div> : history.map((entry) => (
              <article key={entry.id} className={styles.historyItem}>
                <div className={styles.historyMeta}><strong>{entry.contact_name || entry.remote_phone || entry.remote_jid || "Unknown chat"}</strong><span>{formatDateTime(entry.sent_at)}</span></div>
                <div className={styles.metaPills}>
                  <span className={styles.metaPill}>{entry.direction}</span>
                  <span className={styles.metaPill}>{entry.chat_type}</span>
                  <span className={styles.metaPill}>{entry.message_type}</span>
                  <span className={styles.metaPill}>{entry.priority}</span>
                  <span className={styles.metaPill}>{entry.sensitivity}</span>
                  <span className={styles.metaPill}>{entry.approval_state}</span>
                </div>
                <p className={styles.historyText}>{entry.content}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.panelEyebrow}>Phase 4 and 5</p><h2 className={styles.panelTitle}>Inbox priorities</h2></div>
            <span className={styles.panelBadge}>{filteredContacts.length} shown</span>
          </div>
          <div className={styles.toolbar}>
            <input className={styles.input} placeholder="Search contacts, aliases, or tags" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} />
            <div className={styles.segmented}>
              <button type="button" className={contactView === "all" ? styles.segmentActive : styles.segment} onClick={() => setContactView("all")}>All</button>
              <button type="button" className={contactView === "awaiting" ? styles.segmentActive : styles.segment} onClick={() => setContactView("awaiting")}>Awaiting</button>
              <button type="button" className={contactView === "priority" ? styles.segmentActive : styles.segment} onClick={() => setContactView("priority")}>High</button>
              <button type="button" className={contactView === "vip" ? styles.segmentActive : styles.segment} onClick={() => setContactView("vip")}>VIP</button>
            </div>
          </div>
          <div className={styles.contactList}>
            {filteredContacts.length === 0 ? <div className={styles.emptyState}>No contacts matched the current inbox view.</div> : filteredContacts.map((contact) => {
              const draft = contactDrafts[contact.jid] ?? { priority: contact.priority, tags: contact.tags.join(", ") };
              return (
                <article key={contact.jid} className={styles.contactCard}>
                  <div className={styles.contactHeader}><div><strong>{contact.display_name}</strong><p className={styles.mutedText}>{contact.phone_number || contact.jid}{contact.awaiting_reply ? " | awaiting reply" : ""}</p></div><span className={styles.statusPill}>{contact.priority}</span></div>
                  <p className={styles.mutedText}>Last activity: {formatDateTime(contact.last_message_at || contact.last_seen_at)}</p>
                  {contact.aliases.length ? <p className={styles.mutedText}>Aliases: {contact.aliases.join(", ")}</p> : null}
                  {contact.last_message_preview ? <p className={styles.preview}>{contact.last_message_preview}</p> : null}
                  {contact.tags.length ? <div className={styles.metaPills}>{contact.tags.map((tag) => <span key={`${contact.jid}-${tag}`} className={styles.metaPill}>{tag}</span>)}</div> : null}
                  <div className={styles.inlineFields}>
                    <label className={styles.field}><span>Priority</span><select className={styles.select} value={draft.priority} onChange={(event) => setContactDrafts((current) => ({ ...current, [contact.jid]: { ...draft, priority: event.target.value } }))}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="vip">VIP</option></select></label>
                    <label className={styles.field}><span>Tags</span><input className={styles.input} value={draft.tags} onChange={(event) => setContactDrafts((current) => ({ ...current, [contact.jid]: { ...draft, tags: event.target.value } }))} placeholder="family, client, urgent" /></label>
                  </div>
                  <button type="button" className={styles.secondaryButton} disabled={savingKey === contact.jid} onClick={() => void handleContactSave(contact)}>{savingKey === contact.jid ? "Saving..." : "Save contact rules"}</button>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.panelEyebrow}>Phase 8 and 9</p><h2 className={styles.panelTitle}>Workflow studio</h2></div>
            <button type="button" className={styles.secondaryButton} disabled={savingKey === "workflow-process"} onClick={() => void handleProcessWorkflows()}>{savingKey === "workflow-process" ? "Running..." : "Run due workflows now"}</button>
          </div>
          <div className={styles.stack}>
            {workflows.map((workflow) => {
              const draft = workflowDrafts[workflow.workflow_type] ?? {
                is_enabled: workflow.is_enabled,
                approval_required: workflow.approval_required,
                delay_minutes: workflow.delay_minutes,
                scope: workflow.scope,
                template: workflow.template ?? "",
                trigger_keywords: workflow.trigger_keywords.join(", "),
              };

              return (
                <article key={workflow.id} className={styles.contactCard}>
                  <div className={styles.contactHeader}><div><strong>{workflow.title}</strong><p className={styles.mutedText}>{workflow.description || "No description yet."}</p></div><span className={styles.statusPill}>{draft.is_enabled ? "enabled" : "disabled"}</span></div>
                  <div className={styles.switchGroup}>
                    <label className={styles.toggle}><input type="checkbox" checked={draft.is_enabled} onChange={(event) => setWorkflowDrafts((current) => ({ ...current, [workflow.workflow_type]: { ...draft, is_enabled: event.target.checked } }))} /><span>Enabled</span></label>
                    <label className={styles.toggle}><input type="checkbox" checked={draft.approval_required} onChange={(event) => setWorkflowDrafts((current) => ({ ...current, [workflow.workflow_type]: { ...draft, approval_required: event.target.checked } }))} /><span>Require approval</span></label>
                  </div>
                  <div className={styles.inlineFields}>
                    <label className={styles.field}><span>Delay minutes</span><input className={styles.input} type="number" min={5} max={10080} value={draft.delay_minutes} onChange={(event) => setWorkflowDrafts((current) => ({ ...current, [workflow.workflow_type]: { ...draft, delay_minutes: Number(event.target.value) || draft.delay_minutes } }))} /></label>
                    <label className={styles.field}><span>Scope</span><select className={styles.select} value={draft.scope} onChange={(event) => setWorkflowDrafts((current) => ({ ...current, [workflow.workflow_type]: { ...draft, scope: event.target.value } }))}><option value="direct">Direct</option><option value="group">Group</option><option value="all">All</option></select></label>
                  </div>
                  <label className={styles.field}><span>Trigger keywords</span><input className={styles.input} value={draft.trigger_keywords} onChange={(event) => setWorkflowDrafts((current) => ({ ...current, [workflow.workflow_type]: { ...draft, trigger_keywords: event.target.value } }))} placeholder="payment, invoice, proposal" /></label>
                  <label className={styles.field}><span>Suggested template</span><textarea className={styles.textarea} value={draft.template} onChange={(event) => setWorkflowDrafts((current) => ({ ...current, [workflow.workflow_type]: { ...draft, template: event.target.value } }))} /></label>
                  <button type="button" className={styles.secondaryButton} disabled={savingKey === workflow.workflow_type} onClick={() => void handleWorkflowSave(workflow.workflow_type)}>{savingKey === workflow.workflow_type ? "Saving..." : "Save workflow"}</button>
                </article>
              );
            })}
          </div>

          <div className={styles.subPanel}>
            <div className={styles.subPanelHeader}><strong>Recent workflow runs</strong><span>{workflowRuns.length}</span></div>
            <div className={styles.subPanelStack}>
              {workflowRuns.slice(0, 8).map((run) => (
                <article key={run.id} className={styles.groupCard}>
                  <div className={styles.groupHeader}><strong>{run.workflow_type}</strong><span>{run.status}</span></div>
                  <p className={styles.mutedText}>{run.contact_name || run.remote_phone || run.remote_jid || "Unknown target"} | due {formatDateTime(run.due_at)}</p>
                  <p className={styles.preview}>{run.suggested_reply || "No suggested reply."}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div><p className={styles.panelEyebrow}>Phase 10</p><h2 className={styles.panelTitle}>Privacy and governance</h2></div>
            <button type="button" className={styles.secondaryButton} disabled={savingKey === "privacy-export"} onClick={() => void handleExportData()}>{savingKey === "privacy-export" ? "Preparing..." : "Export data"}</button>
          </div>
          <div className={styles.form}>
            <label className={styles.field}><span>Cleanup mode</span><select className={styles.select} value={privacyMode} onChange={(event) => setPrivacyMode(event.target.value as WhatsAppPrivacyDeleteMode)}><option value="retention">Retention cleanup</option><option value="contact">Delete one contact thread</option><option value="all">Delete all WhatsApp data</option></select></label>
            {privacyMode === "contact" ? <label className={styles.field}><span>Contact filter</span><input className={styles.input} value={privacyContact} onChange={(event) => setPrivacyContact(event.target.value)} placeholder="Name, phone, or jid" /></label> : null}
            <div className={styles.actionRow}>
              <button type="button" className={styles.secondaryButton} disabled={savingKey === "privacy-dry-run"} onClick={() => void handlePrivacyDelete(true)}>{savingKey === "privacy-dry-run" ? "Checking..." : "Preview cleanup"}</button>
              <button type="button" className={styles.primaryButton} disabled={savingKey === "privacy-delete"} onClick={() => void handlePrivacyDelete(false)}>{savingKey === "privacy-delete" ? "Working..." : "Run cleanup"}</button>
            </div>
            {privacyPreview ? (
              <div className={styles.subPanel}>
                <div className={styles.subPanelHeader}><strong>Cleanup preview</strong><span>{privacyMode}</span></div>
                <div className={styles.metaPills}>
                  {Object.entries(privacyPreview).map(([key, value]) => (
                    <span key={key} className={styles.metaPill}>{key}: {value}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className={styles.subPanel}>
            <div className={styles.subPanelHeader}><strong>Audit timeline</strong><span>{auditEntries.length}</span></div>
            <div className={styles.subPanelStack}>
              {auditEntries.slice(0, 12).map((entry) => (
                <article key={entry.id} className={styles.groupCard}>
                  <div className={styles.groupHeader}><strong>{entry.event_type}</strong><span>{formatDateTime(entry.created_at)}</span></div>
                  <p className={styles.mutedText}>{entry.actor} | {entry.target_type}{entry.target_value ? ` | ${entry.target_value}` : ""}</p>
                  <p className={styles.preview}>{entry.summary}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
