"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./approvals-page.module.css";

type ApprovalStatus = "pending" | "sent" | "skipped" | "edit_requested";

type Approval = {
  id: string;
  email_from: string;
  email_subject: string;
  draft_body: string;
  status: ApprovalStatus;
  created_at: string;
};

type FilterTab = "pending" | "sent" | "skipped" | "all";

type ApprovalsPageProps = {
  config: PublicAppConfig;
};

const seedApprovals: Approval[] = [
  {
    id: "seed-1",
    email_from: "Priya Sharma <priya.sharma@acmecorp.in>",
    email_subject: "Q4 budget approval - need sign-off by Friday",
    draft_body: `Hi Priya,

Thanks for flagging this. I reviewed the Q4 budget proposal and it looks well structured. A few quick thoughts before I give final sign-off:

1. The Rs 2.4L allocation for cloud infrastructure looks reasonable given the usage spikes we saw in Q3.
2. I would suggest adding a small buffer to the marketing line item.
3. Can you confirm the procurement timeline for the new laptops?

Once you clarify point 3, I am happy to approve.

Best,`,
    status: "pending",
    created_at: new Date(Date.now() - 8 * 60_000).toISOString(),
  },
  {
    id: "seed-2",
    email_from: "Vikram Nair <v.nair@techbridge.io>",
    email_subject: "Partnership proposal - initial call",
    draft_body: `Hi Vikram,

Thank you for reaching out about the partnership opportunity.

I had a chance to look at the overview you shared, and I think there could be strong alignment here. I would be happy to set up a short intro call to explore it further.

Would Thursday or Friday afternoon work on your side?

Looking forward to connecting,`,
    status: "pending",
    created_at: new Date(Date.now() - 25 * 60_000).toISOString(),
  },
  {
    id: "seed-3",
    email_from: "Sarah Mitchell <sarah@clientco.com>",
    email_subject: "Re: Project timeline update",
    draft_body: `Hi Sarah,

Thanks for the update on the timeline.

The revised delivery date works for us. We will adjust our internal milestones accordingly and keep the review meeting on the calendar for the 28th.

Please do flag any blockers early so we can keep things moving.

Best,`,
    status: "sent",
    created_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
  },
  {
    id: "seed-4",
    email_from: "newsletter@productdigest.co",
    email_subject: "This week in product - issue #182",
    draft_body: `Hi,

Thanks for the newsletter. I will take a look when I get a chance.

Best,`,
    status: "skipped",
    created_at: new Date(Date.now() - 6 * 60 * 60_000).toISOString(),
  },
];

const filterTabs: Array<{ key: FilterTab; label: string }> = [
  { key: "pending", label: "Pending" },
  { key: "sent", label: "Sent" },
  { key: "skipped", label: "Skipped" },
  { key: "all", label: "All" },
];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function senderInitials(from: string) {
  const name = from.replace(/<.*>/, "").trim() || from;
  const parts = name.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}`.toUpperCase();
  }

  return name.slice(0, 2).toUpperCase();
}

function senderName(from: string) {
  const match = from.match(/^(.+?)\s*</);
  if (match?.[1]) {
    return match[1].trim();
  }

  return from.split("@")[0] || from;
}

function senderEmail(from: string) {
  const match = from.match(/<([^>]+)>/);
  if (match?.[1]) {
    return match[1];
  }

  return from;
}

function relativeTime(iso: string) {
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

function avatarColor(from: string) {
  const colors = [
    "#ff4d4d",
    "#ff8c42",
    "#ffb347",
    "#00e676",
    "#4da6ff",
    "#c77dff",
    "#ff6eb4",
    "#00bcd4",
  ];

  let hash = 0;
  for (let index = 0; index < from.length; index += 1) {
    hash = from.charCodeAt(index) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length] || colors[0];
}

async function fetchApprovals(token: string): Promise<Approval[]> {
  const response = await fetch("/api/approvals", {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    return seedApprovals;
  }

  const data = (await response.json()) as { approvals?: Approval[] };
  return Array.isArray(data.approvals) ? data.approvals : seedApprovals;
}

async function updateApproval(
  token: string,
  id: string,
  action: "send" | "skip",
  draftBody?: string,
) {
  const response = await fetch(`/api/approvals/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action,
      ...(draftBody !== undefined ? { draft_body: draftBody } : {}),
    }),
  });

  return response.ok;
}

async function generateApprovals(token: string) {
  await fetch("/api/approvals/generate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

export function ApprovalsPage({ config }: ApprovalsPageProps) {
  const router = useRouter();
  const supabase = getSupabaseBrowserClient({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  });

  const toastTimerRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [approvals, setApprovals] = useState<Approval[]>(seedApprovals);
  const [selectedId, setSelectedId] = useState<string | null>(seedApprovals[0]?.id ?? null);
  const [filter, setFilter] = useState<FilterTab>("pending");
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<"send" | "skip" | null>(null);
  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [toast, setToast] = useState("");
  const [toastVisible, setToastVisible] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

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

        if (cancelled) {
          return;
        }

        setToken(accessToken);

        try {
          const nextApprovals = await fetchApprovals(accessToken);
          if (!cancelled) {
            setApprovals(nextApprovals);
            setSelectedId(nextApprovals[0]?.id ?? null);
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

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      const length = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(length, length);
    }
  }, [editing]);

  const filtered = useMemo(
    () => approvals.filter((approval) => (filter === "all" ? true : approval.status === filter)),
    [approvals, filter],
  );

  const selected = useMemo(() => {
    return approvals.find((approval) => approval.id === selectedId) ?? filtered[0] ?? null;
  }, [approvals, filtered, selectedId]);

  useEffect(() => {
    if (filtered.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }

    const hasSelected = selectedId ? filtered.some((approval) => approval.id === selectedId) : false;
    if (!hasSelected) {
      setSelectedId(filtered[0]?.id ?? null);
    }
  }, [filtered, selectedId]);

  function showToast(message: string) {
    setToast(message);
    setToastVisible(true);

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
    }, 2800);
  }

  function handleSelect(id: string) {
    setSelectedId(id);
    setEditing(false);
  }

  function handleStartEdit() {
    if (!selected) {
      return;
    }

    setEditBody(selected.draft_body);
    setEditing(true);
  }

  function handleCancelEdit() {
    setEditing(false);
    setEditBody("");
  }

  async function handleAction(action: "send" | "skip") {
    if (!selected) {
      return;
    }

    setActionLoading(action);

    const draftBody = action === "send" && editing ? editBody.trim() : undefined;
    const ok = token ? await updateApproval(token, selected.id, action, draftBody) : true;

    if (!ok) {
      setActionLoading(null);
      showToast("Something went wrong. Please try again.");
      return;
    }

    const nextStatus: ApprovalStatus = action === "send" ? "sent" : "skipped";
    setApprovals((current) =>
      current.map((approval) =>
        approval.id === selected.id
          ? {
              ...approval,
              status: nextStatus,
              ...(draftBody ? { draft_body: draftBody } : {}),
            }
          : approval,
      ),
    );
    setEditing(false);
    setEditBody("");

    if (filter === "pending") {
      const remaining = filtered.filter(
        (approval) => approval.id !== selected.id && approval.status === "pending",
      );
      setSelectedId(remaining[0]?.id ?? null);
    }

    showToast(
      action === "send"
        ? `Reply sent to ${senderName(selected.email_from)}`
        : `Skipped ${senderName(selected.email_from)}`,
    );
    setActionLoading(null);
  }

  async function handleGenerate() {
    if (!token) {
      showToast("Connect Gmail first to generate real drafts.");
      return;
    }

    setGenerating(true);

    try {
      await generateApprovals(token);
      const freshApprovals = await fetchApprovals(token);
      setApprovals(freshApprovals);
      setSelectedId(freshApprovals[0]?.id ?? null);
      showToast("Drafts generated from your inbox.");
    } catch {
      showToast("Unable to generate drafts right now.");
    } finally {
      setGenerating(false);
    }
  }

  const pendingCount = approvals.filter((approval) => approval.status === "pending").length;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.sidebarTop}>
          <Link href="/dashboard" className={styles.backLink}>
            <span className={styles.backArrow} aria-hidden="true">
              {"\u2190"}
            </span>
            Dashboard
          </Link>

          <div className={styles.logoRow}>
            <span className={styles.logoIcon} aria-hidden="true">
              {"\u{1F99E}"}
            </span>
            <span className={styles.logoText}>
              Claw<span className={styles.logoAccent}>Cloud</span>
            </span>
          </div>

          <div className={styles.pageLabel}>Reply approvals</div>
          <p className={styles.pageSub}>AI drafted replies waiting for your review.</p>
        </div>

        <div className={styles.tabNav}>
          {filterTabs.map((tab) => {
            const label =
              tab.key === "pending" ? `${tab.label} (${pendingCount})` : tab.label;

            return (
              <button
                key={tab.key}
                type="button"
                className={cx(styles.tabButton, filter === tab.key && styles.tabButtonActive)}
                onClick={() => {
                  setFilter(tab.key);
                  setEditing(false);
                }}
              >
                <span className={styles.tabDot} data-status={tab.key} />
                {label}
              </button>
            );
          })}
        </div>

        <div className={styles.generateWrap}>
          <button
            type="button"
            className={styles.generateButton}
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <>
                <span className={styles.spinner} />
                Scanning inbox...
              </>
            ) : (
              <>
                <span aria-hidden="true">{"\u26A1"}</span>
                Generate new drafts
              </>
            )}
          </button>
          <p className={styles.generateHint}>Scans Gmail for emails that need replies.</p>
        </div>
      </aside>

      <div className={styles.listPane}>
        <div className={styles.listHeader}>
          <span className={styles.listTitle}>
            {filter === "all" ? "All approvals" : `${filter[0]?.toUpperCase()}${filter.slice(1)}`}
          </span>
          <span className={styles.listCount}>{filtered.length}</span>
        </div>

        {loading ? (
          <div className={styles.emptyState}>
            <span className={styles.emptySpinner} />
            <span>Loading...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon} aria-hidden="true">
              {filter === "pending" ? "\u2709\uFE0F" : filter === "sent" ? "\u2714" : "\u{1F4ED}"}
            </span>
            <span className={styles.emptyLabel}>
              {filter === "pending"
                ? "No pending approvals"
                : filter === "sent"
                  ? "Nothing sent yet"
                  : filter === "skipped"
                    ? "Nothing skipped yet"
                    : "No approvals yet"}
            </span>
            {filter === "pending" ? (
              <button
                type="button"
                className={styles.emptyAction}
                onClick={handleGenerate}
                disabled={generating}
              >
                Generate drafts
              </button>
            ) : null}
          </div>
        ) : (
          <ul className={styles.approvalList}>
            {filtered.map((approval) => {
              const isActive = approval.id === selected?.id;
              const color = avatarColor(approval.email_from);

              return (
                <li key={approval.id}>
                  <button
                    type="button"
                    className={cx(
                      styles.approvalItem,
                      isActive && styles.approvalItemActive,
                      approval.status !== "pending" && styles.approvalItemDim,
                    )}
                    onClick={() => handleSelect(approval.id)}
                  >
                    <div
                      className={styles.avatar}
                      style={{ background: `${color}22`, color }}
                    >
                      {senderInitials(approval.email_from)}
                    </div>
                    <div className={styles.itemMeta}>
                      <div className={styles.itemRow}>
                        <span className={styles.itemSender}>{senderName(approval.email_from)}</span>
                        <span className={styles.itemTime}>{relativeTime(approval.created_at)}</span>
                      </div>
                      <div className={styles.itemSubject}>{approval.email_subject}</div>
                      <div className={styles.itemSnippet}>
                        {approval.draft_body.slice(0, 80).replace(/\n+/g, " ")}
                        {approval.draft_body.length > 80 ? "..." : ""}
                      </div>
                    </div>
                    <span
                      className={cx(
                        styles.statusPill,
                        approval.status === "pending" && styles.statusPillPending,
                        approval.status === "sent" && styles.statusPillSent,
                        approval.status !== "pending" &&
                          approval.status !== "sent" &&
                          styles.statusPillSkipped,
                      )}
                    >
                      {approval.status === "pending"
                        ? "\u25CF"
                        : approval.status === "sent"
                          ? "\u2713"
                          : "-"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={styles.detailPane}>
        {!selected ? (
          <div className={styles.detailEmpty}>
            <div className={styles.detailEmptyIcon} aria-hidden="true">
              {"\u2709\uFE0F"}
            </div>
            <div className={styles.detailEmptyTitle}>Select a draft to review</div>
            <div className={styles.detailEmptySub}>
              Your AI can draft replies for emails that need attention. Review, edit, and
              send them from one place.
            </div>
          </div>
        ) : (
          <div className={styles.detail}>
            <div className={styles.detailHeader}>
              <div className={styles.detailHeaderLeft}>
                <div
                  className={styles.detailAvatar}
                  style={{
                    background: `${avatarColor(selected.email_from)}22`,
                    color: avatarColor(selected.email_from),
                  }}
                >
                  {senderInitials(selected.email_from)}
                </div>
                <div>
                  <div className={styles.detailSender}>
                    {senderName(selected.email_from)}
                    <span className={styles.detailEmail}>
                      {`<${senderEmail(selected.email_from)}>`}
                    </span>
                  </div>
                  <div className={styles.detailSubject}>{selected.email_subject}</div>
                </div>
              </div>

              <div className={styles.detailHeaderRight}>
                <span
                  className={cx(
                    styles.detailStatusBadge,
                    selected.status === "pending" && styles.detailStatusPending,
                    selected.status === "sent" && styles.detailStatusSent,
                    selected.status !== "pending" &&
                      selected.status !== "sent" &&
                      styles.detailStatusSkipped,
                  )}
                >
                  {selected.status === "pending"
                    ? "Pending"
                    : selected.status === "sent"
                      ? "Sent"
                      : "Skipped"}
                </span>
                <span className={styles.detailTime}>{relativeTime(selected.created_at)}</span>
              </div>
            </div>

            <div className={styles.draftLabel}>
              <span className={styles.draftLabelIcon} aria-hidden="true">
                {"\u{1F916}"}
              </span>
              AI drafted reply - review before sending
            </div>

            <div className={styles.draftWrap}>
              {editing ? (
                <textarea
                  ref={textareaRef}
                  className={styles.draftTextarea}
                  value={editBody}
                  onChange={(event) => setEditBody(event.target.value)}
                  rows={14}
                  spellCheck
                />
              ) : (
                <pre className={styles.draftBody}>{selected.draft_body}</pre>
              )}
            </div>

            {selected.status === "pending" ? (
              <div className={styles.actionBar}>
                {editing ? (
                  <>
                    <button
                      type="button"
                      className={styles.buttonCancel}
                      onClick={handleCancelEdit}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.buttonSkip}
                      onClick={() => handleAction("skip")}
                      disabled={actionLoading !== null}
                    >
                      Skip
                    </button>
                    <button
                      type="button"
                      className={styles.buttonSend}
                      onClick={() => handleAction("send")}
                      disabled={actionLoading !== null || !editBody.trim()}
                    >
                      {actionLoading === "send" ? (
                        <>
                          <span className={styles.spinner} />
                          Sending...
                        </>
                      ) : (
                        "Send edited reply"
                      )}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={styles.buttonSkip}
                      onClick={() => handleAction("skip")}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === "skip" ? <span className={styles.spinner} /> : "Skip"}
                    </button>
                    <button
                      type="button"
                      className={styles.buttonEdit}
                      onClick={handleStartEdit}
                      disabled={actionLoading !== null}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={styles.buttonSend}
                      onClick={() => handleAction("send")}
                      disabled={actionLoading !== null}
                    >
                      {actionLoading === "send" ? (
                        <>
                          <span className={styles.spinner} />
                          Sending...
                        </>
                      ) : (
                        "Send reply"
                      )}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className={styles.resolvedBar}>
                {selected.status === "sent"
                  ? "This reply was sent through Gmail."
                  : "This draft was skipped."}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={cx(styles.toast, toastVisible && styles.toastVisible)}>{toast}</div>
    </div>
  );
}
