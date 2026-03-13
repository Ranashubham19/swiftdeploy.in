"use client";

import {
  type ReactNode,
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { buildConversationMemory } from "@/lib/conversation-memory";
import { getFirebaseAuth } from "@/lib/firebase-client";
import type {
  AuthenticatedUser,
  ConversationMessage,
  ConversationThread,
  PublicAppConfig,
  ResearchProgressStep,
  ResearchRunResult,
  ResearchSource,
} from "@/lib/types";

const LOCAL_THEME_KEY = "sd-theme";
const LOCAL_THREADS_KEY = "sd-thread-cache-v2";

const starterPrompts = [
  "What are the latest major AI developments this week?",
  "Compare Tavily and SerpAPI for production research workflows.",
  "Write a TypeScript helper that groups records by key with proper types.",
  "Analyze https://www.openai.com and summarize the homepage messaging.",
];

function parseEventBlock(block: string) {
  const lines = block.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));

  if (!eventLine || !dataLine) {
    return null;
  }

  try {
    return {
      event: eventLine.slice(6).trim(),
      data: JSON.parse(dataLine.slice(5).trim()),
    };
  } catch {
    return null;
  }
}

function clipLabel(value: string, limit = 44) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function clipCopy(value: string, limit = 180) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function humanizeLabel(value: string | undefined) {
  if (!value) {
    return "";
  }

  return value
    .split("_")
    .join(" ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function sourceDomainLabel(source: ResearchSource) {
  if (source.domain) {
    return source.domain;
  }

  try {
    return new URL(source.url).hostname.replace(/^www\./, "");
  } catch {
    return source.url;
  }
}

function sourcePublishedLabel(source: ResearchSource) {
  if (!source.publishedDate) {
    return null;
  }

  const parsed = new Date(source.publishedDate);
  if (Number.isNaN(parsed.getTime())) {
    return source.publishedDate;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

function formatDurationMs(value: number) {
  if (value <= 0) {
    return "0ms";
  }

  if (value < 1000) {
    return `${value}ms`;
  }

  return `${(value / 1000).toFixed(1)}s`;
}

function searchProviderLabel(provider: "tavily" | "serpapi" | "jina") {
  switch (provider) {
    case "tavily":
      return "Tavily";
    case "serpapi":
      return "SerpAPI";
    case "jina":
      return "Jina";
  }
}

function computeProviderHealth(
  summary:
    | {
        attemptedQueries: number;
        successfulQueries: number;
        failedQueries: number;
        averageDurationMs: number;
      }
    | undefined,
) {
  if (!summary || summary.attemptedQueries <= 0) {
    return {
      tone: "na" as const,
      label: "N/A",
      detail: "No diagnostics yet",
    };
  }

  const successRate = summary.successfulQueries / Math.max(summary.attemptedQueries, 1);
  if (successRate >= 0.8 && summary.failedQueries === 0) {
    return {
      tone: "ok" as const,
      label: "Up",
      detail: formatDurationMs(summary.averageDurationMs),
    };
  }

  if (summary.successfulQueries > 0) {
    return {
      tone: "warn" as const,
      label: "Degraded",
      detail: formatDurationMs(summary.averageDurationMs),
    };
  }

  return {
    tone: "down" as const,
    label: "Down",
    detail: "No successful queries",
  };
}

function flattenNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(flattenNodeText).join("");
  }

  if (!node || typeof node !== "object") {
    return "";
  }

  if ("props" in node) {
    const props = node.props as { children?: ReactNode };
    return flattenNodeText(props.children);
  }

  return "";
}

function normalizeMessage(raw: Partial<ConversationMessage>, fallbackRole: "user" | "assistant") {
  return {
    id: raw.id || crypto.randomUUID(),
    role: raw.role || fallbackRole,
    content: raw.content || "",
    createdAt: raw.createdAt || new Date().toISOString(),
    status: raw.status || "done",
    answerMode: raw.answerMode,
  } satisfies ConversationMessage;
}

function normalizeThread(raw: Partial<ConversationThread>): ConversationThread {
  const messages = Array.isArray(raw.messages)
    ? raw.messages.map((message, index) =>
        normalizeMessage(message, index % 2 === 0 ? "user" : "assistant"),
      )
    : [];

  return {
    id: raw.id || crypto.randomUUID(),
    title: raw.title || "New chat",
    userId: raw.userId ?? null,
    updatedAt: raw.updatedAt || new Date().toISOString(),
    messages,
    progress: Array.isArray(raw.progress) ? raw.progress : [],
    sources: Array.isArray(raw.sources) ? raw.sources : [],
    activeResult: raw.activeResult ?? null,
    persistence: raw.persistence ?? {
      mode: "local",
      synced: true,
      updatedAt: raw.updatedAt || new Date().toISOString(),
    },
  };
}

function mergeThreads(left: ConversationThread[], right: ConversationThread[]) {
  const merged = new Map<string, ConversationThread>();

  for (const thread of [...left, ...right]) {
    const current = merged.get(thread.id);
    if (!current) {
      merged.set(thread.id, normalizeThread(thread));
      continue;
    }

    const currentUpdatedAt = new Date(current.updatedAt).getTime();
    const nextUpdatedAt = new Date(thread.updatedAt).getTime();
    merged.set(
      thread.id,
      normalizeThread(nextUpdatedAt >= currentUpdatedAt ? thread : current),
    );
  }

  return [...merged.values()].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

function readLocalThreads() {
  try {
    const raw = window.localStorage.getItem(LOCAL_THREADS_KEY);
    if (!raw) {
      return [] as ConversationThread[];
    }

    const parsed = JSON.parse(raw) as Partial<ConversationThread>[];
    if (!Array.isArray(parsed)) {
      return [] as ConversationThread[];
    }

    return parsed.map(normalizeThread);
  } catch {
    return [] as ConversationThread[];
  }
}

function providerLabels(config: PublicAppConfig) {
  const labels = [
    config.providerSnapshot.tavily ? "Tavily" : null,
    config.providerSnapshot.serpapi ? "SerpAPI" : null,
    config.providerSnapshot.firecrawl ? "Firecrawl" : null,
    config.providerSnapshot.apify ? "Apify" : null,
    config.providerSnapshot.brightdata ? "BrightData" : null,
    config.providerSnapshot.jina ? "Jina" : null,
    config.providerSnapshot.cohere ? "Cohere" : null,
    config.providerSnapshot.voyage ? "Voyage" : null,
    config.providerSnapshot.pinecone ? "Pinecone" : null,
  ].filter(Boolean) as string[];

  return labels.slice(0, 6);
}

type ThemeMode = "light" | "dark";

export function ResearchConsole({ config }: { config: PublicAppConfig }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [progress, setProgress] = useState<ResearchProgressStep[]>([]);
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [activeResult, setActiveResult] = useState<ResearchRunResult | null>(null);
  const [isResearching, setIsResearching] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [threadId, setThreadId] = useState(() => crypto.randomUUID());
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [syncState, setSyncState] = useState<ConversationThread["persistence"]>({
    mode: "local",
    synced: true,
  });
  const [isHydrated, setIsHydrated] = useState(false);
  const chatScrollerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem(LOCAL_THEME_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextTheme =
      savedTheme === "dark" || savedTheme === "light"
        ? (savedTheme as ThemeMode)
        : prefersDark
          ? "dark"
          : "light";

    setTheme(nextTheme);

    const localThreads = readLocalThreads();
    setThreads(localThreads);
    if (localThreads[0]) {
      setThreadId(localThreads[0].id);
      setMessages(localThreads[0].messages);
      setProgress(localThreads[0].progress);
      setSources(localThreads[0].sources);
      setActiveResult(localThreads[0].activeResult);
      setSyncState(localThreads[0].persistence);
    }

    setIsHydrated(true);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(LOCAL_THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    window.localStorage.setItem(LOCAL_THREADS_KEY, JSON.stringify(threads));
  }, [isHydrated, threads]);

  useEffect(() => {
    if (!config.providerSnapshot.firebase) {
      setAuthReady(true);
      return;
    }

    const auth = getFirebaseAuth(config.firebase);
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(
        user
          ? {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
              photoURL: user.photoURL,
            }
          : null,
      );
      setAuthReady(true);
    });

    return unsubscribe;
  }, [config.firebase, config.providerSnapshot.firebase]);

  useEffect(() => {
    const scroller = chatScrollerRef.current;
    if (!scroller) {
      return;
    }

    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sources, progress]);

  useEffect(() => {
    if (!authReady || !config.providerSnapshot.supabase) {
      return;
    }

    let cancelled = false;

    async function loadRemoteThreads() {
      try {
        const query = currentUser?.uid
          ? `?userId=${encodeURIComponent(currentUser.uid)}`
          : "";
        const response = await fetch(`/api/threads${query}`, {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              threads?: Partial<ConversationThread>[];
              persistence?: ConversationThread["persistence"];
            }
          | null;

        if (cancelled || !payload) {
          return;
        }

        const remoteThreads = (payload.threads ?? []).map(normalizeThread);
        if (remoteThreads.length) {
          setThreads((previous) => mergeThreads(previous, remoteThreads));

          if (!messages.length && remoteThreads[0]) {
            const latest = remoteThreads[0];
            setThreadId(latest.id);
            setMessages(latest.messages);
            setProgress(latest.progress);
            setSources(latest.sources);
            setActiveResult(latest.activeResult);
          }
        }

        if (payload.persistence) {
          setSyncState(payload.persistence);
        }
      } catch {
        setSyncState({
          mode: "local",
          synced: false,
          reason: "Thread sync is unavailable. Using local history.",
        });
      }
    }

    void loadRemoteThreads();

    return () => {
      cancelled = true;
    };
  }, [authReady, config.providerSnapshot.supabase, currentUser?.uid]);

  useEffect(() => {
    if (!messages.length) {
      return;
    }

    const firstUserPrompt =
      messages.find((message) => message.role === "user")?.content ?? "New chat";
    setThreads((previous) => {
      const existing = previous.find((thread) => thread.id === threadId);
      const snapshot = normalizeThread({
        id: threadId,
        title: clipLabel(firstUserPrompt, 54),
        userId: currentUser?.uid ?? null,
        updatedAt: new Date().toISOString(),
        messages,
        progress,
        sources,
        activeResult,
        persistence: {
          ...(existing?.persistence ?? syncState),
          mode: existing?.persistence.mode ?? syncState.mode,
        },
      });

      return mergeThreads(previous, [snapshot]);
    });
  }, [threadId, messages, progress, sources, activeResult, currentUser?.uid, syncState]);

  useEffect(() => {
    if (!isHydrated || isResearching || !messages.length || !config.providerSnapshot.supabase) {
      return;
    }

    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) {
      return;
    }

    if (
      thread.persistence.mode === "supabase" &&
      thread.persistence.synced &&
      thread.persistence.updatedAt === thread.updatedAt
    ) {
      return;
    }

    const handle = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/threads", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(thread),
        });
        const payload = (await response.json().catch(() => null)) as
          | { persistence?: ConversationThread["persistence"] }
          | null;

        if (payload?.persistence) {
          setSyncState(payload.persistence);
          setThreads((previous) =>
            previous.map((candidate) =>
              candidate.id === thread.id
                ? {
                    ...candidate,
                    persistence: payload.persistence ?? candidate.persistence,
                  }
                : candidate,
            ),
          );
        }
      } catch {
        setSyncState({
          mode: "local",
          synced: false,
          reason: "Thread sync is unavailable. Using local history.",
        });
      }
    }, 700);

    return () => window.clearTimeout(handle);
  }, [
    config.providerSnapshot.supabase,
    isHydrated,
    isResearching,
    messages.length,
    threadId,
    threads,
  ]);

  const latestAssistantMessageId = useMemo(
    () =>
      [...messages]
        .reverse()
        .find((message) => message.role === "assistant")?.id,
    [messages],
  );
  const statusLabel = useMemo(() => {
    if (!isResearching) {
      return null;
    }

    const latestProgress = progress.at(-1);
    return latestProgress?.label ?? "Thinking...";
  }, [isResearching, progress]);
  const followUps = activeResult?.answer.followUps ?? [];
  const searchDiagnostics = activeResult?.searchDiagnostics ?? null;
  const providerDiagnostics = searchDiagnostics?.providerSummary ?? [];
  const recentProgress = progress.slice(-8);
  const currentThreadTitle = useMemo(() => {
    if (!messages.length) {
      return "New chat";
    }

    const firstUserPrompt =
      messages.find((message) => message.role === "user")?.content ?? "New chat";
    return clipLabel(firstUserPrompt, 80);
  }, [messages]);
  const providerPills = useMemo(() => providerLabels(config), [config]);
  const searchProviderHealthBadges = useMemo(() => {
    const summaryByProvider = new Map(
      providerDiagnostics.map((summary) => [summary.provider, summary]),
    );
    const providers = ["tavily", "serpapi", "jina"] as const;

    return providers.map((provider) => {
      const summary = summaryByProvider.get(provider);
      const health = computeProviderHealth(summary);
      return {
        provider,
        providerLabel: searchProviderLabel(provider),
        ...health,
      };
    });
  }, [providerDiagnostics]);
  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === threadId) ?? null,
    [threadId, threads],
  );
  const displayedSyncState = activeThread?.persistence ?? syncState;

  function toggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  function resetWorkspace() {
    if (isResearching) {
      return;
    }

    setThreadId(crypto.randomUUID());
    setQuestion("");
    setMessages([]);
    setProgress([]);
    setSources([]);
    setActiveResult(null);
    setSyncState({
      mode: "local",
      synced: true,
    });
  }

  function loadThread(targetThreadId: string) {
    if (isResearching) {
      return;
    }

    const thread = threads.find((candidate) => candidate.id === targetThreadId);
    if (!thread) {
      return;
    }

    setThreadId(thread.id);
    setQuestion("");
    setMessages(thread.messages);
    setProgress(thread.progress);
    setSources(thread.sources);
    setActiveResult(thread.activeResult);
    setSyncState(thread.persistence);
  }

  function seedQuestion(prompt: string) {
    setQuestion(prompt);
  }

  function updateAssistantMessage(
    messageId: string,
    updater: (message: ConversationMessage) => ConversationMessage,
  ) {
    setMessages((previous) =>
      previous.map((message) =>
        message.id === messageId ? updater(message) : message,
      ),
    );
  }

  async function consumeResearchStream(
    response: Response,
    assistantMessageId: string,
  ) {
    if (!response.body) {
      throw new Error("Research stream is unavailable.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completeReceived = false;
    let streamError: string | null = null;

    const handleEvent = (event: { event: string; data: unknown }) => {
      if (event.event === "progress") {
        const step = event.data as ResearchProgressStep;
        setProgress((previous) => [...previous, step]);
        updateAssistantMessage(assistantMessageId, (message) => ({
          ...message,
          content: step.detail ? `${step.label}\n\n${step.detail}` : step.label,
        }));
        return;
      }

      if (event.event === "token") {
        return;
      }

      if (event.event === "sources") {
        setSources((event.data as { sources?: ResearchSource[] } | null)?.sources ?? []);
        return;
      }

      if (event.event === "complete") {
        completeReceived = true;
        const result = event.data as ResearchRunResult;
        startTransition(() => {
          setProgress(result.progress);
          setSources(result.sources);
          setActiveResult(result);
          updateAssistantMessage(assistantMessageId, (message) => ({
            ...message,
            content: result.answer.markdown,
            status: "done",
            answerMode: result.classification.mode,
          }));
        });
        return;
      }

      if (event.event === "error") {
        const failureMessage =
          (event.data as { message?: string })?.message || "The request failed.";
        streamError = failureMessage;
        updateAssistantMessage(assistantMessageId, (message) => ({
          ...message,
          content: failureMessage,
          status: "error",
        }));
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");

      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        const event = parseEventBlock(block);
        if (!event) {
          continue;
        }

        handleEvent(event);
      }
    }

    const trailing = buffer.trim();
    if (trailing) {
      const trailingEvent = parseEventBlock(trailing);
      if (trailingEvent) {
        handleEvent(trailingEvent);
      }
    }

    if (!completeReceived) {
      const failureMessage =
        streamError ||
        "The response stream ended before completion. Please retry for a full answer.";
      updateAssistantMessage(assistantMessageId, (message) => ({
        ...message,
        content: failureMessage,
        status: "error",
      }));
    }
  }

  async function submitResearch(nextQuestion?: string) {
    const rawQuestion = (nextQuestion ?? question).trim();
    if (!rawQuestion || isResearching) {
      return;
    }

    const assistantMessageId = crypto.randomUUID();
    const userMessageId = crypto.randomUUID();
    const now = new Date().toISOString();
    const history = messages
      .filter((message) => message.status !== "streaming")
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
    const memory = buildConversationMemory(
      rawQuestion,
      history,
      activeResult?.memory ?? null,
    );

    setQuestion("");
    setSources([]);
    setProgress([]);
    setActiveResult(null);
    setIsResearching(true);
    setMessages((previous) => [
      ...previous,
      {
        id: userMessageId,
        role: "user",
        content: rawQuestion,
        createdAt: now,
        status: "done",
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "Thinking...",
        createdAt: now,
        status: "streaming",
      },
    ]);

    try {
      const response = await fetch("/api/research", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question: rawQuestion,
          threadId,
          history,
          memory,
          user: currentUser
            ? {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
              }
            : null,
        }),
      });

      if (!response.ok) {
        throw new Error(`Research request failed with ${response.status}`);
      }

      await consumeResearchStream(response, assistantMessageId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Research request failed.";
      updateAssistantMessage(assistantMessageId, (current) => ({
        ...current,
        content: message,
        status: "error",
      }));
    } finally {
      setIsResearching(false);
    }
  }

  function handleComposerSubmit() {
    void submitResearch();
  }

  async function handleSignIn() {
    try {
      const auth = getFirebaseAuth(config.firebase);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      setSyncState({
        mode: "local",
        synced: false,
        reason:
          error instanceof Error ? error.message : "Google sign-in failed.",
      });
    }
  }

  async function handleSignOut() {
    try {
      const auth = getFirebaseAuth(config.firebase);
      await signOut(auth);
      setSyncState({
        mode: "local",
        synced: true,
        reason: "Signed out. Using local history.",
      });
    } catch (error) {
      setSyncState({
        mode: "local",
        synced: false,
        reason:
          error instanceof Error ? error.message : "Sign-out failed.",
      });
    }
  }

  return (
    <main className="assistant-app">
      <aside className="assistant-sidebar">
        <div className="sidebar-top">
          <div className="sidebar-brand">
            <div className="sidebar-brand-mark">SD</div>
          <div className="sidebar-brand-copy">
              <strong>Adaptive AI Search</strong>
              <span>AI research assistant</span>
            </div>
          </div>

          <div className="sidebar-stack">
            <div className="stack-label">Active stack</div>
            <div className="stack-pills">
              {providerPills.map((label) => (
                <span key={label} className="stack-pill">
                  {label}
                </span>
              ))}
            </div>

            <div className="stack-health">
              <div className="stack-label">Search health</div>
              <div className="stack-health-pills">
                {searchProviderHealthBadges.map((badge) => (
                  <span
                    key={badge.provider}
                    className={`stack-health-pill stack-health-pill--${badge.tone}`}
                    title={`${badge.providerLabel}: ${badge.label} (${badge.detail})`}
                  >
                    <strong>{badge.providerLabel}</strong>
                    <em>{badge.label}</em>
                    <small>{badge.detail}</small>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            className="sidebar-new-chat"
            onClick={resetWorkspace}
            disabled={isResearching}
          >
            New chat
          </button>
        </div>

        <section className="sidebar-history">
          <div className="sidebar-section-head">
            <span>History</span>
            <strong>{threads.length}</strong>
          </div>

          {threads.length ? (
            <div className="history-list">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  type="button"
                  className={`history-item ${
                    thread.id === threadId && messages.length ? "history-item--active" : ""
                  }`}
                  onClick={() => loadThread(thread.id)}
                >
                  <strong>{thread.title}</strong>
                  <span>{humanizeLabel(thread.persistence.mode)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="sidebar-empty">
              Your conversations appear here automatically. If Supabase is unavailable,
              they stay local.
            </p>
          )}
        </section>

        <div className="sidebar-footer">
          <div className="session-card">
            <div className="session-head">
              <span>{authReady ? "Session" : "Connecting..."}</span>
              <strong>{displayedSyncState.synced ? "Synced" : "Local only"}</strong>
            </div>
            <p>
              {currentUser?.email ||
                currentUser?.displayName ||
                "Sign in with Google to attach chat history to your Firebase user."}
            </p>
            {displayedSyncState.reason ? (
              <span className="session-note">{displayedSyncState.reason}</span>
            ) : null}
          </div>

          <div className="sidebar-actions">
            {currentUser ? (
              <button type="button" className="theme-toggle" onClick={handleSignOut}>
                Sign out
              </button>
            ) : (
              <button type="button" className="theme-toggle" onClick={handleSignIn}>
                Sign in with Google
              </button>
            )}
            <button type="button" className="theme-toggle" onClick={toggleTheme}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
          </div>
        </div>
      </aside>

      <section className="assistant-main">
        <header className="assistant-header">
          <div>
            <span className="assistant-header-label">Current chat</span>
            <h1>{currentThreadTitle}</h1>
          </div>

          <div className="header-status-group">
            <div className="header-status-card">
              <span>History</span>
              <strong>{humanizeLabel(displayedSyncState.mode)}</strong>
            </div>
            <button type="button" className="theme-toggle theme-toggle--mobile" onClick={toggleTheme}>
              {theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </header>

        <div ref={chatScrollerRef} className="assistant-scroll">
          {!messages.length ? (
            <section className="empty-state">
              <div className="empty-state-copy">
                <span className="assistant-header-label">ChatGPT fluency, Perplexity workflow</span>
                <h2>Ask anything. It routes, searches, reranks, and cites.</h2>
                <p>
                  Adaptive AI Search expands the query, searches the live web, retrieves evidence,
                  reranks sources, and synthesizes a cited answer before responding.
                </p>
              </div>

              <div className="starter-grid">
                {starterPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="starter-card"
                    onClick={() => seedQuestion(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <div className="message-list">
              {messages.map((message) => {
                const isLatestAssistant =
                  message.role === "assistant" && message.id === latestAssistantMessageId;

                return (
                  <article
                    key={message.id}
                    className={`message-row ${
                      message.role === "user" ? "message-row--user" : "message-row--assistant"
                    }`}
                  >
                    <div className="message-shell">
                      <div className="message-meta">
                        <span>{message.role === "user" ? "You" : "Adaptive AI"}</span>
                        {message.answerMode ? (
                          <span>{humanizeLabel(message.answerMode)}</span>
                        ) : null}
                      </div>

                      <div
                        className={`message-body ${
                          message.status === "error" ? "message-body--error" : ""
                        }`}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            a: ({ children, href, ...props }) => {
                              return (
                                <a
                                  {...props}
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-citation"
                                >
                                  {children}
                                </a>
                              );
                            },
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>

                        {isLatestAssistant && message.status === "streaming" ? (
                          <div className="message-stream">
                            <span />
                            <span />
                            <span />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </article>
                );
              })}

              {recentProgress.length ? (
                <section className="progress-panel">
                  <div className="answer-footnote-head">
                    <strong>Run Progress</strong>
                    <span>{recentProgress.length} recent steps</span>
                  </div>
                  <div className="progress-list">
                    {recentProgress.map((step) => (
                      <article
                        key={step.id}
                        className={`progress-item ${
                          step.status === "error" ? "progress-item--error" : ""
                        }`}
                      >
                        <strong>{step.label}</strong>
                        {step.detail ? <span className="progress-item-detail">{step.detail}</span> : null}
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              {searchDiagnostics && providerDiagnostics.length ? (
                <section className="answer-footnote diagnostics-panel">
                  <div className="answer-footnote-head">
                    <strong>Search Diagnostics</strong>
                    <span>
                      {searchDiagnostics.rawResultCount} raw hits {"->"} {searchDiagnostics.dedupedResultCount} deduped
                    </span>
                  </div>

                  <div className="diagnostics-grid">
                    {providerDiagnostics.map((provider) => (
                      <article key={provider.provider} className="diagnostics-card">
                        <strong>{provider.provider}</strong>
                        <span>
                          {provider.attemptedQueries
                            ? `${provider.successfulQueries}/${provider.attemptedQueries} successful`
                            : "Not configured"}
                        </span>
                        <p>
                          {provider.totalResults} hits, {formatDurationMs(provider.averageDurationMs)} avg
                        </p>
                        {provider.lastError ? (
                          <small>Last error: {clipCopy(provider.lastError, 110)}</small>
                        ) : null}
                      </article>
                    ))}
                  </div>

                  {searchDiagnostics.retryCount > 0 ? (
                    <div className="diagnostics-retry">
                      <strong>Retry details</strong>
                      <p>{searchDiagnostics.retryReason || "Automatic retry was triggered for low coverage."}</p>
                      {searchDiagnostics.retryQueries?.length ? (
                        <div className="diagnostics-retry-list">
                          {searchDiagnostics.retryQueries.map((query) => (
                            <code key={query}>{query}</code>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              ) : null}

              {followUps.length ? (
                <section className="answer-footnote">
                  {followUps.length ? (
                    <div className="follow-up-panel">
                      <div className="answer-footnote-head">
                        <strong>Follow-ups</strong>
                        <span>Ask the next thing directly.</span>
                      </div>
                      <div className="follow-up-list">
                        {followUps.map((followUp) => (
                          <button
                            key={followUp}
                            type="button"
                            className="follow-up-item"
                            onClick={() => {
                              setQuestion(followUp);
                              void submitResearch(followUp);
                            }}
                          >
                            <strong>{followUp}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          )}
        </div>

        <div className="composer-dock">
          {statusLabel ? <div className="composer-status">{statusLabel}</div> : null}

          <form
            className="assistant-composer"
            onSubmit={(event) => {
              event.preventDefault();
              handleComposerSubmit();
            }}
          >
            <textarea
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Message Adaptive AI Search..."
              aria-label="Ask Adaptive AI Search"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleComposerSubmit();
                }
              }}
            />

            <div className="composer-actions">
              <span className="composer-hint">
                Search, retrieve, rerank, synthesize, and cite.
              </span>
              <button
                type="button"
                className="composer-send"
                disabled={isResearching || !question.trim()}
                aria-label="Send message"
                onClick={handleComposerSubmit}
              >
                {isResearching ? "Sending..." : "Send"}
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
