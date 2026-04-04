"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  GlobalLiteConnection,
  GlobalLiteProvider,
} from "@/lib/clawcloud-global-lite";
import {
  deriveClawCloudSetupGoogleWorkspaceAvailability,
  deriveClawCloudSetupConnectionState,
  shouldDeferSetupCallbackProcessing,
  type ClawCloudSetupStatusSnapshot,
} from "@/lib/clawcloud-setup-status";
import { clawCloudFrontendTaskMap } from "@/lib/clawcloud-types";
import { clawCloudStarterPromptSections } from "@/lib/clawcloud-starter-prompts";
import { markOnboardingComplete } from "@/lib/onboarding";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import { SetupStepLitePanel } from "./setup-step-lite-panel";
import styles from "./setup-page.module.css";

type SetupPageProps = {
  config: PublicAppConfig;
};

type ConnectionStatus = "idle" | "connecting" | "done";
type TaskId = "morning" | "drafts" | "calendar" | "search" | "evening" | "remind";
type StepNumber = 1 | 2 | 3;
type ScanPhase = "waiting" | "verifying" | "connected";
type GoogleWorkspaceConnectProvider = "gmail" | "google_calendar" | "google_drive";
type GoogleWorkspaceConnectScope = GoogleWorkspaceConnectProvider | "core" | "extended";
type SetupCardTone = "idle" | "connecting" | "done";
type WhatsAppQrPayload = {
  status?: "connecting" | "waiting" | "connected";
  qr?: string;
  phone?: string | null;
  error?: string;
  poll_after_ms?: number | null;
};

type GoogleWorkspaceAccessPayload = {
  core?: {
    available?: boolean;
    allowlisted?: boolean;
    reason?: string | null;
  };
  extended?: {
    available?: boolean;
    allowlisted?: boolean;
    reason?: string | null;
  };
};

type SetupStatusPayload = ClawCloudSetupStatusSnapshot & {
  user?: {
    id: string;
    email: string | null;
  } | null;
  error?: string;
};

type SetupStatusCacheEntry = {
  savedAt: number;
  data: SetupStatusPayload;
};

type TaskDefinition = {
  id: TaskId;
  icon: string;
  title: string;
  description: string;
  tags: string[];
  badge: "free" | "starter";
  hasSchedule?: boolean;
};

const onboardingTasks: readonly TaskDefinition[] = [
  {
    id: "morning",
    icon: "☀️",
    title: "Morning email briefing",
    description: "Every morning your agent summarises your inbox and sends a briefing to WhatsApp",
    tags: ["📧 Gmail", "💬 WhatsApp"],
    badge: "free",
    hasSchedule: true,
  },
  {
    id: "drafts",
    icon: "✍️",
    title: "Draft email replies",
    description: 'Say "draft reply to [name]" on WhatsApp and your agent writes it to Gmail drafts',
    tags: ["📧 Gmail", "💬 WhatsApp", "⚡ On demand"],
    badge: "free",
  },
  {
    id: "calendar",
    icon: "📅",
    title: "Meeting reminders",
    description:
      "Get a WhatsApp reminder 30 minutes before each meeting with a context briefing from your last emails with that person",
    tags: ["📅 Calendar", "💬 WhatsApp", "⏰ 30 min before"],
    badge: "free",
  },
  {
    id: "search",
    icon: "🔍",
    title: "Email search via WhatsApp",
    description:
      'Ask "what did Priya say about the budget?" and get an instant plain-English answer from your inbox',
    tags: ["📧 Gmail", "💬 WhatsApp", "⚡ On demand"],
    badge: "free",
  },
  {
    id: "evening",
    icon: "🌙",
    title: "Evening summary",
    description: "End-of-day recap sent to WhatsApp — what happened, what needs attention tomorrow",
    tags: ["📧 Gmail", "📅 Calendar", "💬 WhatsApp"],
    badge: "starter",
  },
  {
    id: "remind",
    icon: "⏰",
    title: "Custom reminders",
    description:
      'Set any reminder via WhatsApp: "Remind me at 5pm to follow up with Vikram" — done',
    tags: ["💬 WhatsApp", "⚡ On demand"],
    badge: "free",
  },
] as const;

const taskChipLabels: Record<TaskId, string> = {
  morning: "☀️ Morning briefing",
  drafts: "✍️ Draft replies",
  calendar: "📅 Meeting reminders",
  search: "🔍 Email search",
  evening: "🌙 Evening summary",
  remind: "⏰ Custom reminders",
};

const unifiedActivationTaskIds: TaskId[] = ["morning", "drafts", "calendar"];

const googleWorkspaceRolloutMessage =
  "Google Workspace connect is unavailable for this account right now. Continue setup now and reconnect Google later from Settings once this deployment is fully configured.";

const timeOptions = ["6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM"] as const;
const GOOGLE_SIGNIN_PROVIDER_MARKER = "clawcloud-auth-provider";
const GOOGLE_WORKSPACE_CONNECT_TARGET_MARKER = "clawcloud-setup-google-connect-target";
const SETUP_STATUS_CACHE_KEY = "clawcloud:setup-cache:v1";
const SETUP_STATUS_CACHE_TTL_MS = 10 * 60_000;
const SETUP_STATUS_FETCH_TIMEOUT_MS = 1_600;
const GOOGLE_WORKSPACE_ACCESS_TIMEOUT_MS = 900;
const GLOBAL_LITE_PROVIDER_ORDER: GlobalLiteProvider[] = [
  "gmail",
  "google_calendar",
  "google_drive",
];

function parseGoogleWorkspaceConnectProvider(
  value: string | null | undefined,
): GoogleWorkspaceConnectProvider | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "gmail") {
    return "gmail";
  }

  if (normalized === "google_calendar") {
    return "google_calendar";
  }

  if (normalized === "google_drive") {
    return "google_drive";
  }

  return null;
}

function rememberGoogleWorkspaceConnectTarget(provider: GoogleWorkspaceConnectProvider | null) {
  if (typeof window === "undefined") {
    return;
  }

  if (!provider) {
    window.sessionStorage.removeItem(GOOGLE_WORKSPACE_CONNECT_TARGET_MARKER);
    return;
  }

  window.sessionStorage.setItem(GOOGLE_WORKSPACE_CONNECT_TARGET_MARKER, provider);
}

function readRememberedGoogleWorkspaceConnectTarget() {
  if (typeof window === "undefined") {
    return null;
  }

  return parseGoogleWorkspaceConnectProvider(
    window.sessionStorage.getItem(GOOGLE_WORKSPACE_CONNECT_TARGET_MARKER),
  );
}

function readSetupStatusCacheEntry(storage: Storage | null) {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(SETUP_STATUS_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<SetupStatusCacheEntry>;
    if (
      typeof parsed.savedAt !== "number"
      || !parsed.data
      || Date.now() - parsed.savedAt > SETUP_STATUS_CACHE_TTL_MS
    ) {
      storage.removeItem(SETUP_STATUS_CACHE_KEY);
      return null;
    }

    return parsed as SetupStatusCacheEntry;
  } catch {
    return null;
  }
}

function readSetupStatusCache() {
  if (typeof window === "undefined") {
    return null;
  }

  const candidates = [
    readSetupStatusCacheEntry(window.sessionStorage),
    readSetupStatusCacheEntry(window.localStorage),
  ].filter((entry): entry is SetupStatusCacheEntry => Boolean(entry));

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.savedAt - left.savedAt);
  return candidates[0]?.data ?? null;
}

function writeSetupStatusCache(data: SetupStatusPayload) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: SetupStatusCacheEntry = {
    savedAt: Date.now(),
    data,
  };
  const serialized = JSON.stringify(payload);

  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.setItem(SETUP_STATUS_CACHE_KEY, serialized);
    } catch {
      // Best-effort cache only.
    }
  }
}

function clearSetupStatusCache() {
  if (typeof window === "undefined") {
    return;
  }

  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      storage.removeItem(SETUP_STATUS_CACHE_KEY);
    } catch {
      // Ignore cache cleanup failures.
    }
  }
}

const qrAnchorCells = new Set<number>([
  0, 1, 2, 3, 4, 5, 6, 7, 14, 18, 19, 20, 21, 22, 23, 24, 126, 127, 128, 129, 130,
  131, 132, 133, 140, 144, 145, 146, 147, 148, 149, 150, 216, 217, 218, 219, 220,
  221, 222, 228, 235, 234, 236, 237, 238, 239, 240, 32, 34, 36, 38, 41, 43, 46, 48,
  52, 55, 57, 60, 63, 66, 70, 74, 78, 82, 86, 90, 94, 98, 102, 106, 110, 114, 118,
  122, 155, 158, 161, 164, 167, 170, 173, 176, 179, 182, 185, 188, 191, 194, 197,
  200, 203, 206, 243, 246, 249, 252, 255, 258, 261, 264, 267, 270, 273, 276, 279,
  282, 285, 288, 291, 294, 297, 299, 302, 305, 308, 311, 314, 317, 320, 323, 326,
  329, 332, 335,
]);

function createQrCells(seed: number) {
  return Array.from({ length: 361 }, (_, index) => {
    if (qrAnchorCells.has(index)) {
      return true;
    }

    const row = Math.floor(index / 19);
    const column = index % 19;
    return ((row * 17 + column * 11 + seed * 13 + index) % 10) > 3;
  });
}

function getStepState(step: StepNumber, currentStep: StepNumber, setupComplete: boolean) {
  if (setupComplete || step < currentStep) {
    return "done";
  }

  if (step === currentStep) {
    return "active";
  }

  return "idle";
}

function buildWhatsAppChatLink(phone: string | null, message = "Hi ClawCloud AI") {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

function getWorkspaceCardPresentation(options: {
  connected: boolean;
  connecting: boolean;
  googleSignedInReady?: boolean;
}) {
  if (options.connected) {
    return {
      tone: "done" as SetupCardTone,
      label: "Connected",
    };
  }

  if (options.connecting) {
    return {
      tone: "connecting" as SetupCardTone,
      label: "Connecting...",
    };
  }

  if (options.googleSignedInReady) {
    return {
      tone: "done" as SetupCardTone,
      label: "Google signed in",
    };
  }

  return {
    tone: "idle" as SetupCardTone,
    label: "Not connected",
  };
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77a6.61 6.61 0 0 1-3.71 1.06c-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11.01 11.01 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09A6.77 6.77 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11.1 11.1 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11.01 11.01 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function GmailSetupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="4.5" y="6.5" width="15" height="11" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M6.5 8.5 12 12.5l5.5-4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarSetupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="5" y="6.5" width="14" height="12.5" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 4.8v3.4M16 4.8v3.4M5 10h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function DriveSetupIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M9 5.5h5.4L18.5 12l-4.1 6.5H9L4.9 12 9 5.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M7.1 15.3h9.8M8.1 8.9l3.2 5.2M15.9 8.9l-3.2 5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PrivacyShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M12 4.5c2.7 1.7 5.1 2.4 7 2.7v5.3c0 4.4-2.7 6.9-7 8.9-4.3-2-7-4.5-7-8.9V7.2c1.9-.3 4.3-1 7-2.7Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="m9.4 12 1.8 1.8 3.5-3.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function isSupabaseAuthLockError(error: unknown) {
  return error instanceof Error
    && error.message.includes("Lock broken by another request with the 'steal' option.");
}

function getSetupSessionErrorMessage(error: unknown) {
  if (isSupabaseAuthLockError(error)) {
    return "Another sign-in or setup tab is still finishing authentication. Close extra ClawCloud or Google tabs, wait a moment, and reload setup.";
  }

  return error instanceof Error ? error.message : "Unable to verify your session.";
}

function didUserSignInWithGoogle(
  user:
    | {
        app_metadata?: {
          provider?: string;
          providers?: string[];
        };
        identities?: Array<{
          provider?: string;
        }> | null;
      }
    | null
    | undefined,
) {
  const directProvider = String(user?.app_metadata?.provider ?? "").trim().toLowerCase();
  if (directProvider === "google") {
    return true;
  }

  const providers = Array.isArray(user?.app_metadata?.providers)
    ? user.app_metadata.providers.map((value) => String(value).trim().toLowerCase())
    : [];
  if (providers.includes("google")) {
    return true;
  }

  const identities = Array.isArray(user?.identities)
    ? user.identities.map((identity) => String(identity?.provider ?? "").trim().toLowerCase())
    : [];
  return identities.includes("google");
}

function sortGlobalLiteConnections(connections: GlobalLiteConnection[]) {
  return [...connections].sort((left, right) => {
    const leftIndex = GLOBAL_LITE_PROVIDER_ORDER.indexOf(left.provider);
    const rightIndex = GLOBAL_LITE_PROVIDER_ORDER.indexOf(right.provider);
    return leftIndex - rightIndex;
  });
}

function buildSetupSeededGlobalLiteConnection(
  provider: GlobalLiteProvider,
  options?: {
    email?: string;
  },
): GlobalLiteConnection {
  const now = new Date().toISOString();

  if (provider === "gmail") {
    return {
      provider,
      mode: "gmail_capture",
      label: "Gmail Lite",
      config: options?.email ? { email: options.email.trim().toLowerCase() } : {},
      is_active: true,
      connected_at: now,
      updated_at: now,
    };
  }

  if (provider === "google_drive") {
    return {
      provider,
      mode: "drive_uploads",
      label: "Drive Lite",
      config: {},
      is_active: true,
      connected_at: now,
      updated_at: now,
    };
  }

  return {
    provider,
    mode: "calendar_ics",
    label: "Calendar Lite",
    config: {},
    is_active: true,
    connected_at: now,
    updated_at: now,
  };
}

export function SetupPage({ config }: SetupPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = getSupabaseBrowserClient({
    supabaseUrl: config.supabaseUrl,
    supabaseAnonKey: config.supabaseAnonKey,
  });

  const toastTimerRef = useRef<number | null>(null);
  const googleTimeoutsRef = useRef<number[]>([]);
  const scanTimeoutRef = useRef<number | null>(null);
  const dashboardRedirectTimeoutRef = useRef<number | null>(null);
  const initialSetupCacheAppliedRef = useRef(false);
  const showToastRef = useRef<(message: string) => void>(() => undefined);
  const handledSearchStateRef = useRef("");
  const unifiedGoogleRedirectStartedRef = useRef(false);
  const unifiedAutoFinishStartedRef = useRef(false);
  const globalLiteAutoProvisionedRef = useRef(false);
  const autoAdvancedFromGoogleRef = useRef(false);

  const [isCheckingSession, setIsCheckingSession] = useState(Boolean(supabase));
  const [sessionNotice, setSessionNotice] = useState("");
  const [currentStep, setCurrentStep] = useState<StepNumber>(1);
  const [signedInEmail, setSignedInEmail] = useState("");
  const [signedInWithGoogle, setSignedInWithGoogle] = useState(false);
  const [googleConnectTarget, setGoogleConnectTarget] = useState<GoogleWorkspaceConnectProvider | null>(null);
  const [gmailStatus, setGmailStatus] = useState<ConnectionStatus>("idle");
  const [calendarStatus, setCalendarStatus] = useState<ConnectionStatus>("idle");
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [authAccessToken, setAuthAccessToken] = useState<string | null>(null);
  const [googleWorkspaceAccessAllowed, setGoogleWorkspaceAccessAllowed] = useState(false);
  const [googleWorkspaceExtendedAccessAllowed, setGoogleWorkspaceExtendedAccessAllowed] = useState(false);
  const [globalLiteConnections, setGlobalLiteConnections] = useState<GlobalLiteConnection[]>([]);
  const [globalLiteLoaded, setGlobalLiteLoaded] = useState(false);
  const [globalLiteSaving, setGlobalLiteSaving] = useState<Partial<Record<GlobalLiteProvider, boolean>>>({});
  const [gmailLiteEmail, setGmailLiteEmail] = useState("");
  const [calendarLiteIcsUrl, setCalendarLiteIcsUrl] = useState("");
  const [driveLiteLabel, setDriveLiteLabel] = useState("");
  const [waConnected, setWaConnected] = useState(false);
  const [waPhone, setWaPhone] = useState<string | null>(null);
  const [waQrImage, setWaQrImage] = useState<string | null>(null);
  const [waQrError, setWaQrError] = useState("");
  const [waLoading, setWaLoading] = useState(false);
  const [waForceRefreshRequested, setWaForceRefreshRequested] = useState(false);
  const [stepTwoComplete, setStepTwoComplete] = useState(false);
  const [qrSeed, setQrSeed] = useState(1);
  const [qrSeconds, setQrSeconds] = useState(299);
  const [scanPhase, setScanPhase] = useState<ScanPhase>("waiting");
  const [selectedTasks, setSelectedTasks] = useState<TaskId[]>(["morning", "drafts"]);
  const [driveConnected, setDriveConnected] = useState(false);
  const [unifiedActivationPending, setUnifiedActivationPending] = useState(false);
  const [autoLaunchingAgent, setAutoLaunchingAgent] = useState(false);
  const [autoRedirectToDashboard, setAutoRedirectToDashboard] = useState(false);
  const [morningTime, setMorningTime] = useState<(typeof timeOptions)[number]>("7:00 AM");
  const [setupComplete, setSetupComplete] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  const qrCells = createQrCells(qrSeed);
  const isConfigured = Boolean(supabase);
  const gmailConnected = gmailStatus === "done";
  const calendarConnected = calendarStatus === "done";
  const waChatLink = buildWhatsAppChatLink(waPhone);
  const {
    googleWorkspaceSetupLiteOnly,
    googleWorkspaceEnabledForUser,
    googleWorkspaceExtendedEnabledForUser,
  } = deriveClawCloudSetupGoogleWorkspaceAvailability({
    setupLiteMode: config.googleRollout.setupLiteMode,
    publicWorkspaceEnabled: config.googleRollout.publicWorkspaceEnabled,
    publicWorkspaceExtendedEnabled: config.googleRollout.publicWorkspaceExtendedEnabled,
    coreAccessAllowed: googleWorkspaceAccessAllowed,
    extendedAccessAllowed: googleWorkspaceExtendedAccessAllowed,
  });
  const gmailLiteConnection =
    globalLiteConnections.find((connection) => connection.provider === "gmail") ?? null;
  const calendarLiteConnection =
    globalLiteConnections.find((connection) => connection.provider === "google_calendar") ?? null;
  const driveLiteConnection =
    globalLiteConnections.find((connection) => connection.provider === "google_drive") ?? null;
  const googleWorkspaceConnected =
    googleWorkspaceEnabledForUser
    && gmailConnected
    && calendarConnected
    && (!googleWorkspaceExtendedEnabledForUser || driveConnected);
  const googleConnectTargetOrAll = googleConnecting ? googleConnectTarget : null;
  const gmailCardStatus: ConnectionStatus = gmailConnected
    ? "done"
    : googleConnectTargetOrAll === null && googleConnecting
      ? "connecting"
      : googleConnectTargetOrAll === "gmail"
        ? "connecting"
        : "idle";
  const calendarCardStatus: ConnectionStatus = calendarConnected
    ? "done"
    : googleConnectTargetOrAll === null && googleConnecting
      ? "connecting"
      : googleConnectTargetOrAll === "google_calendar"
        ? "connecting"
        : "idle";
  const driveCardStatus: ConnectionStatus = driveConnected
    ? "done"
    : googleConnectTargetOrAll === null && googleConnecting
      ? "connecting"
      : googleConnectTargetOrAll === "google_drive"
        ? "connecting"
        : "idle";
  const googleWorkspaceSignInReady =
    signedInWithGoogle
    && googleWorkspaceEnabledForUser
    && !googleWorkspaceConnected;
  const gmailCardPresentation = getWorkspaceCardPresentation({
    connected: gmailConnected,
    connecting: gmailCardStatus === "connecting",
    googleSignedInReady: googleWorkspaceSignInReady,
  });
  const calendarCardPresentation = getWorkspaceCardPresentation({
    connected: calendarConnected,
    connecting: calendarCardStatus === "connecting",
    googleSignedInReady: googleWorkspaceSignInReady,
  });
  const driveCardPresentation = getWorkspaceCardPresentation({
    connected: driveConnected,
    connecting: driveCardStatus === "connecting",
  });
  const stepOneComplete =
    !googleWorkspaceEnabledForUser
    || googleWorkspaceConnected;
  const starterPromptConnectionState = {
    gmail: gmailConnected,
    calendar: calendarConnected,
    drive: driveConnected,
    whatsapp: waConnected,
  } as const;
  const connectedStarterPromptCount = clawCloudStarterPromptSections.filter(
    (section) => starterPromptConnectionState[section.id],
  ).length;
  const selectedTaskTypes = selectedTasks.map((taskId) => clawCloudFrontendTaskMap[taskId]);
  const onboardingTaskTitlesByType = Object.fromEntries(
    onboardingTasks.map((task) => [clawCloudFrontendTaskMap[task.id], task.title]),
  ) as Record<string, string>;
  const onboardingTaskBadgesByType = Object.fromEntries(
    onboardingTasks.map((task) => [clawCloudFrontendTaskMap[task.id], task.badge]),
  ) as Record<string, TaskDefinition["badge"]>;
  const setupStarterPromptState = Object.fromEntries(
    clawCloudStarterPromptSections.map((section) => {
      const connected = starterPromptConnectionState[section.id];
      const relatedTaskTypes = [...(section.taskTypes ?? [])];
      const selectedRelatedTaskTypes = relatedTaskTypes.filter((taskType) =>
        selectedTaskTypes.includes(taskType),
      );
      const selectedRelatedTaskLabels = selectedRelatedTaskTypes
        .map((taskType) => onboardingTaskTitlesByType[taskType])
        .filter((value): value is string => Boolean(value));
      const selectableRelatedTaskLabels = relatedTaskTypes
        .map((taskType) => onboardingTaskTitlesByType[taskType])
        .filter((value): value is string => Boolean(value));
      const starterSelected = selectedRelatedTaskTypes.filter(
        (taskType) => onboardingTaskBadgesByType[taskType] === "starter",
      );
      const selectedTaskSummary =
        selectedRelatedTaskLabels.length > 0
          ? selectedRelatedTaskLabels.join(", ")
          : null;
      const selectableTaskSummary =
        selectableRelatedTaskLabels.length > 0
          ? selectableRelatedTaskLabels.join(", ")
          : null;

      let statusLabel = connected ? "Ready at launch" : "Waiting";
      let description = connected
        ? `${section.label} questions will be ready as soon as setup finishes.`
        : section.connectLabel;
      let note = connected
        ? "Prefill any prompt now, then send it once ClawCloud finishes launching."
        : "Connect this surface first to unlock its questions and automations.";

      if (connected) {
        if (relatedTaskTypes.length === 0) {
          note =
            "No extra automation setup is needed here. Finish setup, then you can ask these right away.";
        } else if (selectedRelatedTaskTypes.length > 0) {
          statusLabel = `${selectedRelatedTaskTypes.length} selected`;
          description =
            selectedRelatedTaskTypes.length === 1
              ? `${section.label} questions will be ready at launch, and 1 selected automation will start once setup finishes.`
              : `${section.label} questions will be ready at launch, and ${selectedRelatedTaskTypes.length} selected automations will start once setup finishes.`;
          note = selectedTaskSummary
            ? `Selected for launch: ${selectedTaskSummary}.`
            : "Selected automations will launch after setup finishes.";

          if (starterSelected.length > 0) {
            note += " Starter-only items may need an upgrade later if your current plan does not include them.";
          }
        } else {
          description = `${section.label} questions will be ready at launch. You can still add related automations in step 3.`;
          note = selectableTaskSummary
            ? `You can add in step 3: ${selectableTaskSummary}.`
            : "You can add related automations in step 3 if you want proactive help here.";
        }
      }

      return [
        section.id,
        {
          connected,
          statusLabel,
          description,
          note,
        },
      ];
    }),
  ) as Record<
    (typeof clawCloudStarterPromptSections)[number]["id"],
    {
      connected: boolean;
      statusLabel: string;
      description: string;
      note: string;
    }
  >;

  function showToast(message: string) {
    setToastMessage(message);
    setToastVisible(true);

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToastVisible(false);
    }, 2800);
  }

  showToastRef.current = showToast;

  function clearGoogleTimeouts() {
    googleTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    googleTimeoutsRef.current = [];
  }

  function clearScanTimeout() {
    if (scanTimeoutRef.current) {
      window.clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
  }

  function clearDashboardRedirectTimeout() {
    if (dashboardRedirectTimeoutRef.current) {
      window.clearTimeout(dashboardRedirectTimeoutRef.current);
      dashboardRedirectTimeoutRef.current = null;
    }
  }

  const applySetupStatusSnapshot = useCallback(
    (payload: SetupStatusPayload | null) => {
      if (!payload) {
        return;
      }

      const liveState = deriveClawCloudSetupConnectionState(payload);
      setGlobalLiteConnections(liveState.globalLiteConnections);
      setGlobalLiteLoaded(true);
      setGmailStatus(liveState.gmailConnected ? "done" : "idle");
      setCalendarStatus(liveState.calendarConnected ? "done" : "idle");
      setDriveConnected(liveState.driveConnected);

      if (
        liveState.gmailConnected
        && liveState.calendarConnected
        && (!googleWorkspaceExtendedEnabledForUser || liveState.driveConnected)
      ) {
        setGoogleConnectTarget(null);
        rememberGoogleWorkspaceConnectTarget(null);
      }

      setWaConnected(liveState.whatsappConnected);
      setWaPhone(liveState.whatsappPhone);

      if (liveState.whatsappConnected) {
        setStepTwoComplete(true);
        setScanPhase("connected");
      }
    },
    [googleWorkspaceExtendedEnabledForUser],
  );

  const refreshSetupStatusSnapshot = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!authAccessToken) {
        if (isCheckingSession) {
          return false;
        }

        clearSetupStatusCache();
        setGlobalLiteConnections([]);
        setGlobalLiteLoaded(false);
        setGmailStatus("idle");
        setCalendarStatus("idle");
        setDriveConnected(false);
        setWaConnected(false);
        setWaPhone(null);
        return false;
      }

      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), SETUP_STATUS_FETCH_TIMEOUT_MS);
        let response: Response;
        try {
          response = await fetch("/api/setup/status", {
            headers: {
              Authorization: `Bearer ${authAccessToken}`,
            },
            cache: "no-store",
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
        const payload = (await response.json().catch(() => null)) as SetupStatusPayload | null;

        if (!response.ok) {
          throw new Error(payload?.error || "Unable to load live setup status.");
        }

        if (payload) {
          writeSetupStatusCache(payload);
        }
        applySetupStatusSnapshot(payload);
        return true;
      } catch (error) {
        setGlobalLiteLoaded(true);
        if (!options?.silent) {
          showToastRef.current(
            error instanceof Error ? error.message : "Unable to refresh setup status.",
          );
        }
        return false;
      }
    },
    [applySetupStatusSnapshot, authAccessToken, isCheckingSession],
  );

  useEffect(() => {
    if (initialSetupCacheAppliedRef.current) {
      return;
    }

    initialSetupCacheAppliedRef.current = true;
    const cachedSetupSnapshot = readSetupStatusCache();
    if (!cachedSetupSnapshot) {
      return;
    }

    applySetupStatusSnapshot(cachedSetupSnapshot);
    if (cachedSetupSnapshot.user?.email) {
      setSignedInEmail((current) => current || cachedSetupSnapshot.user?.email || "");
    }
  }, [applySetupStatusSnapshot]);

  useEffect(() => {
    const authClient = supabase;

    if (!authClient) {
      setIsCheckingSession(false);
      setSessionNotice(
        "Supabase auth is not configured yet. This setup page will work as a polished preview until you add your auth keys.",
      );
      return;
    }

    const client = authClient;
    let cancelled = false;
    let retryTimeoutId: number | null = null;

    async function loadUser(attempt = 0) {
      try {
        const { data: sessionData, error } = await client.auth.getSession();

        if (cancelled) {
          return;
        }

        if (error) {
          throw error;
        }

        const session = sessionData.session;
        if (!session?.user) {
          clearSetupStatusCache();
          setAuthAccessToken(null);
          setSignedInEmail("");
          setSignedInWithGoogle(false);
          setIsCheckingSession(false);
          router.replace("/auth");
          return;
        }

        setAuthAccessToken(session.access_token ?? null);
        setSignedInEmail(session.user.email ?? "");
        setSignedInWithGoogle(didUserSignInWithGoogle(session.user));
        setSessionNotice("");
        setIsCheckingSession(false);
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isSupabaseAuthLockError(error) && attempt < 2) {
          retryTimeoutId = window.setTimeout(() => {
            retryTimeoutId = null;
            void loadUser(attempt + 1);
          }, 400);
          return;
        }

        setAuthAccessToken(null);
        setSignedInEmail("");
        setSignedInWithGoogle(false);
        setIsCheckingSession(false);
        setSessionNotice(getSetupSessionErrorMessage(error));
      }
    }

    void loadUser();

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        clearSetupStatusCache();
        setAuthAccessToken(null);
        setSignedInEmail("");
        setSignedInWithGoogle(false);
        setIsCheckingSession(false);
        router.replace("/auth");
        return;
      }

      setAuthAccessToken(session.access_token);
      setSignedInEmail(session.user.email ?? "");
      setSignedInWithGoogle(didUserSignInWithGoogle(session.user));
      setSessionNotice("");
      setIsCheckingSession(false);
    });

    return () => {
      cancelled = true;
      if (retryTimeoutId) {
        window.clearTimeout(retryTimeoutId);
      }
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }

      clearGoogleTimeouts();
      clearScanTimeout();
      clearDashboardRedirectTimeout();
    };
  }, []);

  useEffect(() => {
    if (currentStep !== 2 || waConnected || stepTwoComplete) {
      return;
    }

    setQrSeconds(299);
    setQrSeed((seed) => seed + 1);
    setScanPhase("waiting");
    setWaQrError("");
    setWaForceRefreshRequested(false);
  }, [currentStep, stepTwoComplete, waConnected]);

  useEffect(() => {
    if (currentStep !== 2 || !waQrImage) {
      return;
    }

    setQrSeconds(299);
  }, [currentStep, waQrImage]);

  useEffect(() => {
    if (currentStep !== 2 || waConnected || stepTwoComplete || scanPhase !== "waiting") {
      return;
    }

    const timerId = window.setInterval(() => {
      setQrSeconds((current) => {
        if (current <= 1) {
          setQrSeed((seed) => seed + 1);
          setScanPhase("waiting");
          setWaForceRefreshRequested(true);
          showToastRef.current("Refreshing live QR...");
          return 299;
        }

        return current - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, [currentStep, scanPhase, stepTwoComplete, waConnected]);

  useEffect(() => {
    if (currentStep !== 2 || !isConfigured || !authAccessToken || waConnected || stepTwoComplete) {
      return;
    }

    let cancelled = false;
    let pollTimer: number | null = null;

    function clearPollTimer() {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function scheduleNextPoll(delayMs: number) {
      clearPollTimer();
      if (cancelled) {
        return;
      }

      pollTimer = window.setTimeout(() => {
        void pollWhatsAppQr(false);
      }, delayMs);
    }

    async function pollWhatsAppQr(showErrors: boolean) {
      if (cancelled) {
        return;
      }

      setWaLoading((current) => current || !waQrImage);

      try {
        const refreshNow = waForceRefreshRequested;
        const endpoint = refreshNow
          ? "/api/whatsapp/connect?refresh=1"
          : "/api/whatsapp/connect";

        const response = await fetch(endpoint, {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${authAccessToken}`,
          },
        });

        const payload = (await response.json().catch(() => null)) as WhatsAppQrPayload | null;
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          const message = payload?.error || "Unable to start WhatsApp connection.";
          setWaQrError(message);
          setWaLoading(false);
          if (refreshNow) {
            setWaForceRefreshRequested(false);
          }
          scheduleNextPoll(1500);
          if (showErrors) {
            showToastRef.current(message);
          }
          return;
        }

        setWaQrError("");
        setWaPhone(payload?.phone ?? null);

        if (payload?.status === "connected") {
          setWaConnected(true);
          setStepTwoComplete(true);
          setScanPhase("connected");
          setWaQrImage(payload.qr ?? null);
          setWaLoading(false);
          clearPollTimer();
          void refreshSetupStatusSnapshot({ silent: true }).catch(() => undefined);
          showToastRef.current("WhatsApp connected successfully ✓");
          return;
        }

        const nextScanPhase: ScanPhase = payload?.phone ? "verifying" : "waiting";

        setScanPhase(nextScanPhase);
        setWaQrImage(payload?.qr ?? null);
        setWaLoading(false);
        if (refreshNow) {
          setWaForceRefreshRequested(false);
        }
        scheduleNextPoll(
          typeof payload?.poll_after_ms === "number" && Number.isFinite(payload.poll_after_ms)
            ? Math.max(350, payload.poll_after_ms)
            : payload?.qr
              ? 1200
              : 700,
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unable to reach the WhatsApp agent server.";
        setWaQrError(message);
        setWaLoading(false);
        if (waForceRefreshRequested) {
          setWaForceRefreshRequested(false);
        }
        scheduleNextPoll(1500);
        if (showErrors) {
          showToastRef.current(message);
        }
      }
    }

    void pollWhatsAppQr(true);

    return () => {
      cancelled = true;
      clearPollTimer();
    };
  }, [authAccessToken, currentStep, isConfigured, refreshSetupStatusSnapshot, stepTwoComplete, waConnected, waForceRefreshRequested, waQrImage]);

  useEffect(() => {
    if (!authAccessToken) {
      setGoogleWorkspaceAccessAllowed(false);
      setGoogleWorkspaceExtendedAccessAllowed(false);
      return;
    }

    let cancelled = false;

    async function loadGoogleWorkspaceAccess() {
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(
          () => controller.abort(),
          GOOGLE_WORKSPACE_ACCESS_TIMEOUT_MS,
        );
        let response: Response;
        try {
          response = await fetch("/api/auth/google/access", {
            headers: {
              Authorization: `Bearer ${authAccessToken}`,
            },
            signal: controller.signal,
          });
        } finally {
          window.clearTimeout(timeoutId);
        }
        const payload = (await response.json().catch(() => null)) as GoogleWorkspaceAccessPayload | null;

        if (cancelled) {
          return;
        }

        setGoogleWorkspaceAccessAllowed(Boolean(payload?.core?.available));
        setGoogleWorkspaceExtendedAccessAllowed(Boolean(payload?.extended?.available));
      } catch {
        if (!cancelled) {
          setGoogleWorkspaceAccessAllowed(false);
          setGoogleWorkspaceExtendedAccessAllowed(false);
        }
      }
    }

    void loadGoogleWorkspaceAccess();

    return () => {
      cancelled = true;
    };
  }, [authAccessToken]);

  useEffect(() => {
    if (!authAccessToken) {
      globalLiteAutoProvisionedRef.current = false;
      return;
    }

    void refreshSetupStatusSnapshot({ silent: true }).catch(() => undefined);
  }, [authAccessToken, refreshSetupStatusSnapshot]);

  useEffect(() => {
    if (
      !authAccessToken
      || googleWorkspaceEnabledForUser
      || !globalLiteLoaded
      || globalLiteAutoProvisionedRef.current
    ) {
      return;
    }

    const shouldProvisionGmail = !gmailLiteConnection && Boolean(signedInEmail);
    const shouldProvisionDrive = !driveLiteConnection;

    if (!shouldProvisionGmail && !shouldProvisionDrive) {
      globalLiteAutoProvisionedRef.current = true;
      return;
    }

    globalLiteAutoProvisionedRef.current = true;
    let cancelled = false;
    const defaultDriveLabel = driveLiteLabel.trim() || "My ClawCloud document vault";

    if (!driveLiteLabel.trim()) {
      setDriveLiteLabel(defaultDriveLabel);
    }

    if (!gmailLiteEmail.trim() && signedInEmail) {
      setGmailLiteEmail(signedInEmail);
    }

    setGlobalLiteSaving((current) => ({
      ...current,
      ...(shouldProvisionGmail ? { gmail: true } : {}),
      ...(shouldProvisionDrive ? { google_drive: true } : {}),
    }));

    void (async () => {
      try {
        const requests: Promise<void>[] = [];

        if (shouldProvisionGmail && signedInEmail) {
          requests.push(
            (async () => {
              const response = await fetch("/api/global-lite/connections", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${authAccessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  provider: "gmail",
                  email: signedInEmail,
                }),
              });
              const payload = (await response.json().catch(() => null)) as {
                error?: string;
                connection?: GlobalLiteConnection;
              } | null;

              if (!response.ok) {
                throw new Error(payload?.error || "Unable to prepare Gmail automatically.");
              }

              if (!cancelled && payload?.connection) {
                upsertGlobalLiteConnectionState(payload.connection);
              }
            })(),
          );
        }

        if (shouldProvisionDrive) {
          requests.push(
            (async () => {
              const response = await fetch("/api/global-lite/connections", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${authAccessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  provider: "google_drive",
                  label: defaultDriveLabel,
                }),
              });
              const payload = (await response.json().catch(() => null)) as {
                error?: string;
                connection?: GlobalLiteConnection;
              } | null;

              if (!response.ok) {
                throw new Error(payload?.error || "Unable to prepare Drive automatically.");
              }

              if (!cancelled && payload?.connection) {
                upsertGlobalLiteConnectionState(payload.connection);
              }
            })(),
          );
        }

        await Promise.all(requests);

        if (cancelled) {
          return;
        }

        void refreshGlobalLiteConnections().catch(() => undefined);
        showToastRef.current(
          signedInWithGoogle
            ? "Gmail and Drive were connected automatically from Google sign-in. Add a private ICS link if you want Calendar too."
            : "Gmail and Drive were connected automatically during setup. Add a private ICS link if you want Calendar too.",
        );
      } catch (error) {
        if (!cancelled) {
          showToastRef.current(
            error instanceof Error
              ? error.message
              : "Unable to prepare Global Lite Connect automatically.",
          );
        }
      } finally {
        if (!cancelled) {
          setGlobalLiteSaving((current) => ({
            ...current,
            gmail: false,
            google_drive: false,
          }));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authAccessToken,
    driveLiteConnection,
    driveLiteLabel,
    gmailLiteConnection,
    gmailLiteEmail,
    globalLiteLoaded,
    googleWorkspaceEnabledForUser,
    signedInEmail,
    signedInWithGoogle,
  ]);

  useEffect(() => {
    if (gmailLiteConnection) {
      const email =
        typeof gmailLiteConnection.config.email === "string"
          ? gmailLiteConnection.config.email
          : "";
      setGmailLiteEmail(email || signedInEmail);
      return;
    }

    if (signedInEmail && !gmailLiteEmail) {
      setGmailLiteEmail(signedInEmail);
    }
  }, [gmailLiteConnection, gmailLiteEmail, signedInEmail]);

  useEffect(() => {
    if (!calendarLiteConnection) {
      return;
    }

    const icsUrl =
      typeof calendarLiteConnection.config.icsUrl === "string"
        ? calendarLiteConnection.config.icsUrl
        : "";
    setCalendarLiteIcsUrl(icsUrl);
  }, [calendarLiteConnection]);

  useEffect(() => {
    if (!driveLiteConnection) {
      return;
    }

    setDriveLiteLabel(driveLiteConnection.label ?? "");
  }, [driveLiteConnection]);

  useEffect(() => {
    if (signedInWithGoogle || typeof window === "undefined") {
      return;
    }

    const storedProvider = window.sessionStorage.getItem(GOOGLE_SIGNIN_PROVIDER_MARKER);
    if (storedProvider === "google") {
      setSignedInWithGoogle(true);
    }
  }, [signedInWithGoogle]);

  useEffect(() => {
    if (googleConnectTarget) {
      return;
    }

    const rememberedTarget = readRememberedGoogleWorkspaceConnectTarget();
    if (rememberedTarget) {
      setGoogleConnectTarget(rememberedTarget);
    }
  }, [googleConnectTarget]);

  useEffect(() => {
    const signature = searchParams.toString();
    if (handledSearchStateRef.current === signature) {
      return;
    }

    const authProvider = searchParams.get("auth_provider");
    const gmailLiteConnectedFromSearch = searchParams.get("gmail_lite") === "connected";
    const driveLiteConnectedFromSearch = searchParams.get("drive_lite") === "connected";
    const globalConnectBootstrap = searchParams.get("global_connect") === "bootstrap";
    const gmailConnectedFromSearch = searchParams.get("gmail") === "connected";
    const calendarConnectedFromSearch = searchParams.get("calendar") === "connected";
    const driveConnectedFromSearch = searchParams.get("drive") === "connected";
    const activationFromSearch = searchParams.get("activation") === "all";
    const nextStep = searchParams.get("step");
    const setupError = searchParams.get("error");
    const sourceProviderFromSearch = parseGoogleWorkspaceConnectProvider(searchParams.get("source"));

    if (shouldDeferSetupCallbackProcessing({
      authProvider,
      gmailLiteConnectedFromSearch,
      driveLiteConnectedFromSearch,
      globalConnectBootstrap,
      gmailConnectedFromSearch,
      calendarConnectedFromSearch,
      driveConnectedFromSearch,
      activationFromSearch,
      setupError,
      authAccessTokenAvailable: Boolean(authAccessToken),
      isCheckingSession,
    })) {
      return;
    }

    let handled = false;

    if (authProvider === "google") {
      setSignedInWithGoogle(true);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(GOOGLE_SIGNIN_PROVIDER_MARKER, "google");
      }
      handled = true;
    }

    if (globalConnectBootstrap || gmailLiteConnectedFromSearch || driveLiteConnectedFromSearch) {
      if (gmailLiteConnectedFromSearch || driveLiteConnectedFromSearch) {
        setGlobalLiteLoaded(true);
      }
      setGlobalLiteConnections((current) => {
        let next = [...current];

        if (gmailLiteConnectedFromSearch) {
          next = next.filter((connection) => connection.provider !== "gmail");
          next.push(
            buildSetupSeededGlobalLiteConnection("gmail", {
              email: signedInEmail,
            }),
          );
        }

        if (driveLiteConnectedFromSearch) {
          next = next.filter((connection) => connection.provider !== "google_drive");
          next.push(buildSetupSeededGlobalLiteConnection("google_drive"));
        }

        return sortGlobalLiteConnections(next);
      });
      handled = true;
    }

    let shouldRefreshLiveSnapshot = false;

    if (gmailConnectedFromSearch || calendarConnectedFromSearch || driveConnectedFromSearch) {
      const resolvedConnectTarget = sourceProviderFromSearch ?? readRememberedGoogleWorkspaceConnectTarget();
      clearGoogleTimeouts();
      setGoogleConnecting(false);
      setGoogleConnectTarget(resolvedConnectTarget);
      rememberGoogleWorkspaceConnectTarget(resolvedConnectTarget);
      setGmailStatus(gmailConnectedFromSearch ? "done" : "idle");
      setCalendarStatus(calendarConnectedFromSearch ? "done" : "idle");
      if (driveConnectedFromSearch) {
        setDriveConnected(true);
      }
      setCurrentStep(nextStep === "2" ? 2 : 1);
      shouldRefreshLiveSnapshot = true;
      handled = true;
    }

    if (activationFromSearch) {
      setUnifiedActivationPending(true);
      setCurrentStep(2);
      handled = true;
    }

    if (setupError) {
      showToast(setupError);
      handled = true;
    }

    handledSearchStateRef.current = signature;

    if (!handled) {
      return;
    }

    if (shouldRefreshLiveSnapshot || handled) {
      void refreshSetupStatusSnapshot({ silent: true }).catch(() => undefined);
    }

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("auth_provider");
    nextParams.delete("gmail_lite");
    nextParams.delete("drive_lite");
    nextParams.delete("global_connect");
    nextParams.delete("gmail");
    nextParams.delete("calendar");
    nextParams.delete("drive");
    nextParams.delete("step");
    nextParams.delete("activation");
    nextParams.delete("error");
    nextParams.delete("source");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `/setup?${nextQuery}` : "/setup");
  }, [authAccessToken, isCheckingSession, refreshSetupStatusSnapshot, router, searchParams]);

  useEffect(() => {
    if (!googleWorkspaceEnabledForUser) {
      clearGoogleTimeouts();
      setGoogleConnecting(false);
    }
  }, [googleWorkspaceEnabledForUser]);

  useEffect(() => {
    if (!googleWorkspaceConnected) {
      autoAdvancedFromGoogleRef.current = false;
      return;
    }

    if (currentStep !== 1 || googleConnecting || autoAdvancedFromGoogleRef.current) {
      return;
    }

    autoAdvancedFromGoogleRef.current = true;
    showToast("Google connected. Continue when you're ready for the WhatsApp QR step.");
  }, [currentStep, googleConnecting, googleWorkspaceConnected]);

  useEffect(() => {
    if (!googleWorkspaceConnected) {
      return;
    }

    setGoogleConnectTarget(null);
    rememberGoogleWorkspaceConnectTarget(null);
  }, [googleWorkspaceConnected]);

  useEffect(() => {
    if (!waConnected || !stepTwoComplete || setupComplete) {
      return;
    }

    setUnifiedActivationPending(true);
  }, [setupComplete, stepTwoComplete, waConnected]);

  useEffect(() => {
    if (!unifiedActivationPending || setupComplete) {
      return;
    }

    if (!waConnected || !stepTwoComplete) {
      if (currentStep !== 2) {
        setCurrentStep(2);
      }
      return;
    }

    const autoLaunch = async () => {
      const preferredScopeSet = googleWorkspaceExtendedEnabledForUser
        ? "extended"
        : googleWorkspaceEnabledForUser
          ? "core"
          : null;

      if ((!gmailConnected || !calendarConnected || (preferredScopeSet === "extended" && !driveConnected))
        && !googleConnecting) {
        if (!preferredScopeSet) {
          if (!unifiedAutoFinishStartedRef.current) {
            unifiedAutoFinishStartedRef.current = true;
            setAutoLaunchingAgent(true);
            setAutoRedirectToDashboard(true);
            setCurrentStep(3);
            setSelectedTasks(unifiedActivationTaskIds);
            showToast(
              "WhatsApp is linked. Google Workspace is unavailable for this account right now, so ClawCloud finished the rest of setup with the supported features.",
            );
            try {
              await handleFinishSetupAction(unifiedActivationTaskIds);
            } finally {
              setAutoLaunchingAgent(false);
              setUnifiedActivationPending(false);
            }
          }
          return;
        }

        if (!authAccessToken || unifiedGoogleRedirectStartedRef.current) {
          return;
        }

        unifiedGoogleRedirectStartedRef.current = true;
        setGoogleConnecting(true);
        setGmailStatus("connecting");
        setCalendarStatus("connecting");
        showToast(
          preferredScopeSet === "extended"
            ? "WhatsApp linked. Finishing activation with Google Workspace and Drive..."
            : "WhatsApp linked. Finishing activation with Google Workspace...",
        );

        try {
          await startGoogleWorkspaceConnect(preferredScopeSet, "setup_unified");
        } catch (error) {
          unifiedGoogleRedirectStartedRef.current = false;
          setGoogleConnecting(false);
          setGmailStatus((current) => (current === "done" ? current : "idle"));
          setCalendarStatus((current) => (current === "done" ? current : "idle"));
          showToast(
            error instanceof Error
              ? error.message
              : "Unable to continue automatic Google activation.",
          );
        }
        return;
      }

      if (unifiedAutoFinishStartedRef.current) {
        return;
      }

      unifiedAutoFinishStartedRef.current = true;
      setAutoLaunchingAgent(true);
      setAutoRedirectToDashboard(true);
      setCurrentStep(3);
      setSelectedTasks(unifiedActivationTaskIds);
      showToast("All supported connections are ready. Launching your ClawCloud agent...");

      try {
        await handleFinishSetupAction(unifiedActivationTaskIds);
      } finally {
        setAutoLaunchingAgent(false);
        setUnifiedActivationPending(false);
      }
    };

    void autoLaunch();
  }, [
    authAccessToken,
    calendarConnected,
    currentStep,
    driveConnected,
    gmailConnected,
    googleConnecting,
    googleWorkspaceEnabledForUser,
    googleWorkspaceExtendedEnabledForUser,
    setupComplete,
    stepTwoComplete,
    unifiedActivationPending,
    waConnected,
  ]);

  function handleGoToStep(step: StepNumber) {
    setCurrentStep(step);
  }

  function getCurrentSetupGuideHref() {
    if (currentStep === 1) {
      return googleWorkspaceEnabledForUser
        ? "/setup-guide?topic=workspace-connect"
        : "/setup-guide?topic=global-connect";
    }

    if (currentStep === 2) {
      return "/setup-guide?topic=whatsapp-connect";
    }

    return "/setup-guide?topic=task-picks";
  }

  function handleOpenSetupHelp() {
    router.push(getCurrentSetupGuideHref());
  }

  async function refreshGlobalLiteConnections() {
    await refreshSetupStatusSnapshot({ silent: true });
  }

  function upsertGlobalLiteConnectionState(connection: GlobalLiteConnection) {
    setGlobalLiteConnections((current) => {
      const next = current.filter((item) => item.provider !== connection.provider);
      next.push(connection);
      return sortGlobalLiteConnections(next);
    });
  }

  function removeGlobalLiteConnectionState(provider: GlobalLiteProvider) {
    setGlobalLiteConnections((current) =>
      sortGlobalLiteConnections(current.filter((item) => item.provider !== provider)),
    );
  }

  async function handleSaveGlobalLiteConnection(provider: GlobalLiteProvider) {
    if (!authAccessToken) {
      showToast("Please sign in again.");
      return;
    }

    const body =
      provider === "gmail"
        ? { provider, email: gmailLiteEmail }
        : provider === "google_calendar"
          ? { provider, icsUrl: calendarLiteIcsUrl }
          : { provider, label: driveLiteLabel };

    setGlobalLiteSaving((current) => ({ ...current, [provider]: true }));

    try {
      const response = await fetch("/api/global-lite/connections", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        connection?: GlobalLiteConnection;
      } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to save Global Lite connection.");
      }

      if (payload?.connection) {
        upsertGlobalLiteConnectionState(payload.connection);
      } else {
        void refreshGlobalLiteConnections().catch(() => undefined);
      }
      showToast(
        provider === "gmail"
          ? "Gmail Lite saved."
          : provider === "google_calendar"
            ? "Calendar Lite saved."
            : "Drive Lite saved.",
      );
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to save the Global Lite connection.",
      );
    } finally {
      setGlobalLiteSaving((current) => ({ ...current, [provider]: false }));
    }
  }

  async function handleDeleteGlobalLiteConnection(provider: GlobalLiteProvider) {
    if (!authAccessToken) {
      showToast("Please sign in again.");
      return;
    }

    setGlobalLiteSaving((current) => ({ ...current, [provider]: true }));

    try {
      const response = await fetch(`/api/global-lite/connections/${provider}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authAccessToken}`,
        },
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Unable to remove Global Lite connection.");
      }

      removeGlobalLiteConnectionState(provider);
      void refreshGlobalLiteConnections().catch(() => undefined);

      if (provider === "gmail") {
        setGmailLiteEmail(signedInEmail);
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
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Unable to remove the Global Lite connection.",
      );
    } finally {
      setGlobalLiteSaving((current) => ({ ...current, [provider]: false }));
    }
  }

  async function startGoogleWorkspaceConnect(
    scopeSet: GoogleWorkspaceConnectScope,
    flow: "default" | "setup_step1" | "setup_unified" = "default",
    sourceProvider?: GoogleWorkspaceConnectProvider,
  ) {
    if (config.googleRollout.setupLiteMode !== false) {
      const safeSetupUrl = new URL("/setup", window.location.origin);
      safeSetupUrl.searchParams.set("global_connect", "bootstrap");
      safeSetupUrl.searchParams.set("ts", String(Date.now()));

      if (flow === "setup_unified") {
        safeSetupUrl.searchParams.set("step", "2");
      }

      window.location.assign(safeSetupUrl.toString());
      return;
    }

    let accessToken = authAccessToken;
    if (!accessToken && supabase) {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        throw sessionError;
      }

      const session = sessionData.session;
      accessToken = session?.access_token ?? null;

      if (session?.user) {
        setAuthAccessToken(session.access_token ?? null);
        setSignedInEmail(session.user.email ?? "");
        setSignedInWithGoogle(didUserSignInWithGoogle(session.user));
        setSessionNotice("");
        setIsCheckingSession(false);
      }
    }

    if (!accessToken) {
      throw new Error("Please sign in again.");
    }

    const params = new URLSearchParams({
      ts: String(Date.now()),
      scopeSet,
    });

    if (flow !== "default") {
      params.set("flow", flow);
    }

    if (sourceProvider) {
      params.set("sourceProvider", sourceProvider);
    }

    const response = await fetch(`/api/auth/google?${params.toString()}`, {
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const payload = (await response.json().catch(() => null)) as { error?: string; url?: string } | null;

    if (!response.ok || !payload?.url) {
      throw new Error(payload?.error || "Unable to start Google Workspace connection.");
    }

    window.location.assign(payload.url);
  }

  async function handleConnectGoogle(target: GoogleWorkspaceConnectScope = "gmail") {
    if (!googleWorkspaceEnabledForUser) {
      handleGoToStep(2);
      return;
    }

    const googleWorkspaceConnected =
      gmailConnected
      && calendarConnected
      && (!googleWorkspaceExtendedEnabledForUser || driveConnected);

    if (googleConnecting || googleWorkspaceConnected) {
      return;
    }

    const sourceProvider: GoogleWorkspaceConnectProvider | null =
      target === "core" || target === "extended"
        ? null
        : target;
    const requestIncludesGmail =
      target === "core" || target === "extended" || target === "gmail";
    const requestIncludesCalendar =
      target === "core" || target === "extended" || target === "google_calendar";
    const requestIncludesDrive =
      target === "extended" || target === "google_drive";

    setGoogleConnectTarget(sourceProvider);
    rememberGoogleWorkspaceConnectTarget(sourceProvider);

    if (isConfigured) {
      try {
        setGoogleConnecting(true);
        setGmailStatus(requestIncludesGmail ? "connecting" : "idle");
        setCalendarStatus(requestIncludesCalendar ? "connecting" : "idle");
        if (requestIncludesDrive) {
          setDriveConnected(false);
        }
        await startGoogleWorkspaceConnect(
          target,
          "setup_step1",
          sourceProvider ?? undefined,
        );
      } catch (error) {
        setGoogleConnecting(false);
        setGmailStatus("idle");
        setCalendarStatus("idle");
        setGoogleConnectTarget(null);
        rememberGoogleWorkspaceConnectTarget(null);
        showToast(error instanceof Error ? error.message : "Unable to connect Google Workspace.");
      }
      return;
    }

    clearGoogleTimeouts();
    setGoogleConnecting(true);
    setGmailStatus(requestIncludesGmail ? "connecting" : "idle");
    setCalendarStatus(requestIncludesCalendar ? "connecting" : "idle");

    const gmailTimeout = window.setTimeout(() => {
      if (requestIncludesGmail) {
        setGmailStatus("done");
      }
      if (requestIncludesCalendar) {
        setCalendarStatus("done");
      }
      if (requestIncludesDrive) {
        setDriveConnected(true);
      }
    }, 1000);

    const calendarTimeout = window.setTimeout(() => {
      if (requestIncludesCalendar) {
        setCalendarStatus("done");
      }
      if (requestIncludesDrive) {
        setDriveConnected(true);
      }
      setGoogleConnecting(false);
      showToast(
        googleWorkspaceExtendedEnabledForUser
          ? "Gmail, Calendar, and Drive connected ✓"
          : "Gmail and Calendar connected ✓",
      );
    }, 1800);

    googleTimeoutsRef.current = [gmailTimeout, calendarTimeout];
  }

  function handleSkipGmail() {
    clearGoogleTimeouts();
    setGoogleConnecting(false);
    setGoogleConnectTarget(null);
    rememberGoogleWorkspaceConnectTarget(null);
    setGmailStatus((current) => (current === "done" ? current : "idle"));
    setCalendarStatus((current) => (current === "done" ? current : "idle"));
    setCurrentStep(2);
    showToast("Skipped — you can connect Gmail later from dashboard");
  }

  function handleSimulateScan() {
    if (isConfigured || scanPhase !== "waiting" || waConnected) {
      return;
    }

    clearScanTimeout();
    setScanPhase("verifying");

    scanTimeoutRef.current = window.setTimeout(() => {
      setWaConnected(true);
      setStepTwoComplete(true);
      setScanPhase("connected");
      showToast("WhatsApp connected successfully ✓");
    }, 1400);
  }

  function handleSkipWhatsApp() {
    clearScanTimeout();
    setStepTwoComplete(true);
    setScanPhase("waiting");
    setCurrentStep(3);
    showToast("Skipped — you can link WhatsApp later from dashboard");
  }

  function handleTaskToggle(taskId: TaskId) {
    const isSelected = selectedTasks.includes(taskId);
    const task = onboardingTasks.find((item) => item.id === taskId);

    if (!isSelected && task?.badge === "starter") {
      showToast("Evening summary needs Starter plan — you can upgrade later");
    }

    setSelectedTasks((current) => {
      const taskIsSelected = current.includes(taskId);

      if (taskIsSelected) {
        return current.filter((task) => task !== taskId);
      }

      return [...current, taskId];
    });
  }

  function handleTaskCardKeyDown(event: React.KeyboardEvent<HTMLDivElement>, taskId: TaskId) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleTaskToggle(taskId);
    }
  }

  function handleFinishSetup() {
    markOnboardingComplete();
    setSetupComplete(true);
    showToast("Agent launched 🚀");
  }

  async function handleFinishSetupAction(taskIds: TaskId[] = selectedTasks) {
    if (supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        const selectedTaskTypes = taskIds.map((taskId) => clawCloudFrontendTaskMap[taskId]);
        const response = await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            selectedTasks: selectedTaskTypes,
            taskConfigs: {
              morning_briefing: {
                briefing_time: morningTime,
              },
            },
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          setAutoRedirectToDashboard(false);
          showToast(payload?.error || "Could not finish setup.");
          return;
        }

        const payload = (await response.json().catch(() => null)) as
          | { tasksEnabled?: number; tasksSkipped?: number }
          | null;
        const tasksEnabled = Math.max(
          0,
          Math.min(taskIds.length, Number(payload?.tasksEnabled ?? taskIds.length)),
        );
        const enabledTaskIds = taskIds.slice(0, tasksEnabled);

        if (enabledTaskIds.length > 0) {
          setSelectedTasks(enabledTaskIds);
        }

        if ((payload?.tasksSkipped ?? 0) > 0) {
          showToast(
            `Activated the first ${tasksEnabled} task${tasksEnabled === 1 ? "" : "s"} allowed on your current plan.`,
          );
        }
      }
    }

    handleFinishSetup();
  }

  function handleDashboardLaunch() {
    clearDashboardRedirectTimeout();
    setAutoRedirectToDashboard(false);
    markOnboardingComplete();
    router.push("/dashboard");
  }

  useEffect(() => {
    if (!setupComplete || !autoRedirectToDashboard) {
      return;
    }

    clearDashboardRedirectTimeout();
    dashboardRedirectTimeoutRef.current = window.setTimeout(() => {
      clearDashboardRedirectTimeout();
      markOnboardingComplete();
      router.push("/dashboard");
    }, 2400);

    return () => {
      clearDashboardRedirectTimeout();
    };
  }, [autoRedirectToDashboard, router, setupComplete]);

  const selectedCount = selectedTasks.length;
  const qrMinutes = Math.floor(qrSeconds / 60);
  const qrRemainingSeconds = qrSeconds % 60;
  const summaryChips = [
    gmailConnected ? "📧 Gmail connected" : null,
    calendarConnected ? "📅 Calendar connected" : null,
    driveConnected ? "🗂️ Drive connected" : null,
    waConnected ? "💬 WhatsApp linked" : null,
    ...onboardingTasks
      .filter((task) => selectedTasks.includes(task.id))
      .map((task) => taskChipLabels[task.id]),
  ].filter((value): value is string => Boolean(value));

  const previewHasMorningBrief = selectedTasks.includes("morning");
  const previewHasMeetings = selectedTasks.includes("calendar");
  const previewTaskCount = (
    <b>
      {selectedCount} task{selectedCount === 1 ? "" : "s"} ready
    </b>
  );
  const googleAuthProviderFromSearch = searchParams.get("auth_provider") === "google";
  const globalConnectBootstrapFromSearch = searchParams.get("global_connect") === "bootstrap";
  const hasGoogleSetupBootstrapHint =
    googleAuthProviderFromSearch || globalConnectBootstrapFromSearch || signedInWithGoogle;
  const hasSetupStatusPreview =
    globalLiteConnections.length > 0
    || gmailConnected
    || calendarConnected
    || driveConnected
    || waConnected
    || Boolean(waPhone);
  const shouldHoldGlobalConnectUi =
    !googleWorkspaceEnabledForUser
    && currentStep === 1
    && hasGoogleSetupBootstrapHint
    && !hasSetupStatusPreview
    && (
      isCheckingSession
      || !authAccessToken
      || !globalLiteLoaded
      || Boolean(globalLiteSaving.gmail)
      || Boolean(globalLiteSaving.google_drive)
    );

  return (
    <main className={styles.page}>
      <div className={`${styles.orb} ${styles.orb1}`} />
      <div className={`${styles.orb} ${styles.orb2}`} />

      <nav className={styles.nav}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoIcon}>🦞</span>
          Claw<span className={styles.brandAccent}>Cloud</span>
        </Link>
        <button
          type="button"
          className={styles.navHelp}
          onClick={handleOpenSetupHelp}
        >
          Need help?
        </button>
      </nav>

      {isCheckingSession ? (
        <div className={`${styles.statusBanner} ${styles.statusLoading}`}>Checking your session...</div>
      ) : null}

      {!isCheckingSession && sessionNotice ? (
        <div
          className={`${styles.statusBanner} ${
            isConfigured ? styles.statusError : styles.statusNotice
          }`}
        >
          {sessionNotice}
        </div>
      ) : null}

      <div className={styles.stepper}>
        <div className={styles.stepperTrack}>
          {[1, 2, 3].map((stepNumber, index) => {
            const step = stepNumber as StepNumber;
            const state = getStepState(step, currentStep, setupComplete);

            return (
              <div key={step} className={styles.stepperSegment}>
                <div
                  className={`${styles.stepNode} ${
                    state === "active"
                      ? styles.stepNodeActive
                      : state === "done"
                        ? styles.stepNodeDone
                        : ""
                  }`}
                >
                  <div
                    className={`${styles.stepCircle} ${
                      state === "active"
                        ? styles.stepCircleActive
                        : state === "done"
                          ? styles.stepCircleDone
                          : ""
                    }`}
                  >
                    {state === "done" ? "✓" : step}
                  </div>
                  <div className={styles.stepLabel}>
                    {step === 1
                      ? googleWorkspaceEnabledForUser
                        ? "Connect Google"
                        : "Connect Gmail"
                      : step === 2
                        ? "Link WhatsApp"
                        : "Pick tasks"}
                  </div>
                </div>

                {index < 2 ? (
                  <div className={styles.stepLine}>
                    <div
                      className={`${styles.stepLineFill} ${
                        currentStep > step || setupComplete ? styles.stepLineFillActive : ""
                      }`}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <section className={styles.card}>
        {setupComplete ? (
          <div className={styles.successScreen}>
            <div className={styles.successOrb}>🎉</div>
            <h2>
              Your agent is <span>live!</span>
            </h2>
            <p>
              ClawCloud AI is now running in the background. It&apos;ll message you on WhatsApp
              when it has something for you.
            </p>
            {autoRedirectToDashboard ? (
              <p>Opening your dashboard automatically in about 2-3 seconds...</p>
            ) : null}

            <div className={styles.summaryChips}>
              {summaryChips.map((chip) => (
                <div key={chip} className={`${styles.summaryChip} ${styles.summaryChipActive}`}>
                  {chip}
                </div>
              ))}
            </div>

            <div className={styles.waPreviewMsg}>
              <div className={styles.waPreviewSender}>ClawCloud AI · just now</div>
              <div>
                Hey! Your AI agent is now live 🎉{" "}
                {previewHasMorningBrief ? (
                  <>
                    I&apos;ll send your first briefing tomorrow morning at <b>{morningTime}</b>.
                  </>
                ) : (
                  <>
                    I&apos;ve got {previewTaskCount}.
                  </>
                )}{" "}
                {previewHasMeetings ? (
                  <>
                    You have <b>2 meetings</b> today — I&apos;ll remind you before each one.
                  </>
                ) : previewHasMorningBrief ? (
                  <>
                    I&apos;ve got {previewTaskCount}.
                  </>
                ) : null}{" "}
                Just message me here anytime you need something!
              </div>
            </div>

            <button type="button" className={styles.btnGo} onClick={handleDashboardLaunch}>
              Go to dashboard <span>→</span>
            </button>
          </div>
        ) : currentStep === 1 ? (
          <div className={styles.panel}>
            {shouldHoldGlobalConnectUi ? (
              <div>
                <div className={styles.stepHead}>
                  <div className={styles.stepNumTag}>Step 1 of 3</div>
                  <h2>Finishing your Google setup</h2>
                  <p>
                    Connecting Gmail and Drive automatically from your Google sign-in. This
                    usually takes just a moment.
                  </p>
                </div>
                <div className={styles.stepBody}>
                  <div className={`${styles.statusBanner} ${styles.statusLoading}`}>
                    Preparing your updated Global Connect workspace...
                  </div>
                </div>
              </div>
            ) : googleWorkspaceEnabledForUser ? (
              <div>
                <div className={styles.stepHead}>
                  <div className={styles.stepNumTag}>Step 1 of 3</div>
                  <h2>Connect Google Workspace</h2>
                  <p>
                    {googleWorkspaceSignInReady
                      ? `Your Google account is already signed in. Finish one secure consent step to enable ${
                          googleWorkspaceExtendedEnabledForUser
                            ? "Gmail, Calendar, and Drive"
                            : "Gmail and Calendar"
                        } actions inside ClawCloud.`
                      : `Give ClawCloud secure access to ${
                          googleWorkspaceExtendedEnabledForUser
                            ? "Gmail, Calendar, and Drive"
                            : "Gmail and Calendar"
                        } in one Google consent flow so setup can activate your workspace faster.`}
                  </p>
                </div>

                <div className={`${styles.stepBody} ${styles.workspaceStepBody}`}>
                  <div className={styles.workspaceCardStack}>
                    <div
                      className={`${styles.workspaceConnectCard} ${
                        gmailConnected ? styles.workspaceConnectCardConnected : ""
                      }`}
                    >
                      <div className={styles.workspaceConnectCardIcon}>
                        <GmailSetupIcon />
                      </div>
                      <div className={styles.workspaceConnectCardBody}>
                        <div className={styles.workspaceConnectCardTop}>
                          <div className={styles.workspaceConnectCardTitle}>Gmail</div>
                          <div
                            className={`${styles.workspaceConnectCardState} ${
                              gmailCardPresentation.tone === "done"
                                ? styles.workspaceConnectCardStateDone
                                : gmailCardPresentation.tone === "connecting"
                                  ? styles.workspaceConnectCardStateConnecting
                                  : styles.workspaceConnectCardStateIdle
                            }`}
                          >
                            {gmailCardPresentation.label}
                          </div>
                        </div>
                        <div className={styles.workspaceConnectCardDesc}>
                          Read threads, prepare smart drafts, and power WhatsApp inbox briefings.
                        </div>
                        <div className={styles.workspaceConnectCardTags}>
                          <span className={styles.workspaceConnectCardTag}>Read email</span>
                          <span className={styles.workspaceConnectCardTag}>Create drafts</span>
                          <span className={styles.workspaceConnectCardTag}>Send replies</span>
                        </div>
                      </div>
                    </div>

                    <div
                      className={`${styles.workspaceConnectCard} ${
                        calendarConnected ? styles.workspaceConnectCardConnected : ""
                      }`}
                    >
                      <div className={styles.workspaceConnectCardIcon}>
                        <CalendarSetupIcon />
                      </div>
                      <div className={styles.workspaceConnectCardBody}>
                        <div className={styles.workspaceConnectCardTop}>
                          <div className={styles.workspaceConnectCardTitleRow}>
                            <div className={styles.workspaceConnectCardTitle}>Google Calendar</div>
                            <span className={styles.workspaceConnectOptional}>Optional</span>
                          </div>
                          <div
                            className={`${styles.workspaceConnectCardState} ${
                              calendarCardPresentation.tone === "done"
                                ? styles.workspaceConnectCardStateDone
                                : calendarCardPresentation.tone === "connecting"
                                  ? styles.workspaceConnectCardStateConnecting
                                  : styles.workspaceConnectCardStateIdle
                            }`}
                          >
                            {calendarCardPresentation.label}
                          </div>
                        </div>
                        <div className={styles.workspaceConnectCardDesc}>
                          Read upcoming events for meeting reminders, daily plans, and context-aware updates.
                        </div>
                        <div className={styles.workspaceConnectCardTags}>
                          <span className={styles.workspaceConnectCardTag}>Create events</span>
                          <span className={styles.workspaceConnectCardTag}>Update meetings</span>
                        </div>
                      </div>
                    </div>

                    {googleWorkspaceExtendedEnabledForUser ? (
                      <div
                        className={`${styles.workspaceConnectCard} ${
                          driveConnected ? styles.workspaceConnectCardConnected : ""
                        }`}
                      >
                        <div className={styles.workspaceConnectCardIcon}>
                          <DriveSetupIcon />
                        </div>
                        <div className={styles.workspaceConnectCardBody}>
                          <div className={styles.workspaceConnectCardTop}>
                            <div className={styles.workspaceConnectCardTitle}>Google Drive</div>
                            <div
                              className={`${styles.workspaceConnectCardState} ${
                                driveCardPresentation.tone === "done"
                                  ? styles.workspaceConnectCardStateDone
                                  : driveCardPresentation.tone === "connecting"
                                    ? styles.workspaceConnectCardStateConnecting
                                    : styles.workspaceConnectCardStateIdle
                              }`}
                            >
                              {driveCardPresentation.label}
                            </div>
                          </div>
                          <div className={styles.workspaceConnectCardDesc}>
                            Search documents, read Drive files, and use Sheets when you ask ClawCloud
                            to work with your workspace.
                          </div>
                          <div className={styles.workspaceConnectCardTags}>
                            <span className={styles.workspaceConnectCardTag}>Read files</span>
                            <span className={styles.workspaceConnectCardTag}>Use Sheets</span>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    className={`${styles.workspacePrimaryButton} ${
                      googleWorkspaceConnected ? styles.workspacePrimaryButtonDone : ""
                    }`}
                    onClick={() => void handleConnectGoogle(googleWorkspaceExtendedEnabledForUser ? "extended" : "core")}
                    disabled={googleConnecting}
                  >
                    {googleConnecting ? (
                      <span className={styles.workspacePrimarySpinner} />
                    ) : (
                      <span className={styles.workspacePrimaryGoogleIcon}>
                        <GoogleIcon />
                      </span>
                    )}
                    <span>
                      {googleConnecting
                        ? googleWorkspaceExtendedEnabledForUser
                          ? "Connecting Gmail, Calendar, and Drive..."
                          : "Connecting Gmail and Calendar..."
                        : googleWorkspaceSignInReady
                          ? googleWorkspaceExtendedEnabledForUser
                            ? "Finish Google access for Gmail, Calendar, and Drive"
                            : "Finish Google access for Gmail and Calendar"
                          : googleWorkspaceExtendedEnabledForUser
                            ? "Continue with Google to connect Gmail, Calendar, and Drive"
                            : "Continue with Google to connect Gmail and Calendar"}
                    </span>
                  </button>

                  <div className={styles.workspacePrivacyCard}>
                    <div className={styles.workspacePrivacyHeader}>
                      <span className={styles.workspacePrivacyIcon}>
                        <PrivacyShieldIcon />
                      </span>
                      <div>
                        <div className={styles.workspacePrivacyTitle}>Your data stays private.</div>
                        <p className={styles.workspacePrivacyText}>
                          Access is limited to the permissions needed for inbox automation and meeting
                          context. You can revoke Google access at any time.
                        </p>
                      </div>
                    </div>
                    <div className={styles.workspacePrivacyChecks}>
                      <span className={styles.workspacePrivacyCheck}>
                        <span className={styles.workspacePrivacyDot} />
                        Minimum required scopes
                      </span>
                      <span className={styles.workspacePrivacyCheck}>
                        <span className={styles.workspacePrivacyDot} />
                        No inbox cloning
                      </span>
                      <span className={styles.workspacePrivacyCheck}>
                        <span className={styles.workspacePrivacyDot} />
                        Live processing only
                      </span>
                      <span className={styles.workspacePrivacyCheck}>
                        <span className={styles.workspacePrivacyDot} />
                        Revocable from Google
                      </span>
                    </div>
                  </div>
                </div>

                <div className={styles.stepFoot}>
                  <button
                    type="button"
                    className={styles.workspaceGuideLink}
                    onClick={handleOpenSetupHelp}
                  >
                    Need help? View the Gmail setup guide
                  </button>
                  <div className={styles.workspaceFooterActions}>
                    <button type="button" className={styles.workspaceSkipButton} onClick={handleSkipGmail}>
                      Skip for now
                    </button>
                    <button
                      type="button"
                      className={styles.workspaceContinueButton}
                      disabled={!stepOneComplete}
                      onClick={() => handleGoToStep(2)}
                    >
                      Continue <span>→</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <SetupStepLitePanel
                connections={globalLiteConnections}
                signedInWithGoogle={signedInWithGoogle}
                gmailEmail={gmailLiteEmail}
                calendarIcsUrl={calendarLiteIcsUrl}
                driveLabel={driveLiteLabel}
                saving={globalLiteSaving}
                onChangeGmailEmail={setGmailLiteEmail}
                onChangeCalendarIcsUrl={setCalendarLiteIcsUrl}
                onChangeDriveLabel={setDriveLiteLabel}
                onSave={handleSaveGlobalLiteConnection}
                onDisconnect={handleDeleteGlobalLiteConnection}
                onSkip={handleSkipGmail}
                onContinue={() => handleGoToStep(2)}
                onShowHelp={handleOpenSetupHelp}
              />
            )}
            {/*
            <div className={step1Styles.step1Panel}>
              <div className={step1Styles.step1Head}>
              <div className={styles.stepNumTag}>Step 1 of 3</div>
              <h2>Connect your Gmail 📧</h2>
              <p>
                Your AI reads your inbox to create briefings and draft replies. We only request the
                permissions we need — nothing more.
              </p>
            </div>

            <div className={styles.stepBody}>
              <button
                type="button"
                className={`${styles.oauthCard} ${gmailConnected ? styles.oauthCardSelected : ""}`}
                onClick={handleStartGmailConnect}
              >
                <div className={styles.oauthIcon}>📧</div>
                <div className={styles.oauthInfo}>
                  <div className={styles.oauthName}>Gmail</div>
                  <div className={styles.oauthDesc}>
                    Read emails, access threads, create drafts in your inbox
                  </div>
                  <div className={styles.oauthPerms}>
                    <span className={styles.permTag}>Read emails</span>
                    <span className={styles.permTag}>Create drafts</span>
                    <span className={styles.permTag}>Send on your behalf</span>
                  </div>
                </div>
                <div
                  className={`${styles.oauthStatus} ${
                    gmailStatus === "done"
                      ? styles.oauthStatusDone
                      : gmailStatus === "connecting"
                        ? styles.oauthStatusConnecting
                        : styles.oauthStatusIdle
                  }`}
                >
                  {gmailStatus === "done"
                    ? "✓ Connected"
                    : gmailStatus === "connecting"
                      ? "Connecting…"
                      : "Not connected"}
                </div>
              </button>

              <button
                type="button"
                className={`${styles.oauthCard} ${calendarConnected ? styles.oauthCardSelected : ""}`}
                onClick={handleStartCalendarConnect}
              >
                <div className={styles.oauthIcon}>📅</div>
                <div className={styles.oauthInfo}>
                  <div className={styles.oauthName}>
                    Google Calendar <span className={styles.optionalLabel}>(optional)</span>
                  </div>
                  <div className={styles.oauthDesc}>
                    Read upcoming events for meeting reminders and briefings
                  </div>
                  <div className={styles.oauthPerms}>
                    <span className={styles.permTag}>Read events</span>
                    <span className={styles.permTag}>Read-only</span>
                  </div>
                </div>
                <div
                  className={`${styles.oauthStatus} ${
                    calendarStatus === "done"
                      ? styles.oauthStatusDone
                      : calendarStatus === "connecting"
                        ? styles.oauthStatusConnecting
                        : styles.oauthStatusIdle
                  }`}
                >
                  {calendarStatus === "done"
                    ? "✓ Connected"
                    : calendarStatus === "connecting"
                      ? "Connecting…"
                      : "Not connected"}
                </div>
              </button>

              <button
                type="button"
                className={`${styles.connectGoogleBtn} ${
                  gmailConnected && calendarConnected ? styles.connectGoogleBtnDone : ""
                }`}
                onClick={handleConnectGoogle}
                disabled={googleConnecting}
              >
                {googleConnecting ? (
                  <span className={styles.spinner} />
                ) : (
                  <span className={styles.googleIcon}>
                    <GoogleIcon />
                  </span>
                )}
                {googleConnecting
                  ? "Connecting to Google…"
                  : gmailConnected && calendarConnected
                    ? "✓ Gmail & Calendar connected!"
                    : "Sign in with Google to connect Gmail & Calendar"}
              </button>

              <div className={styles.privacyNote}>
                <span className={styles.privacyIcon}>🔒</span>
                <p>
                  <b>Your data stays private.</b> We use read-only OAuth access. We never store
                  your emails — your agent processes them in real-time and only sends you summaries.
                  You can revoke access anytime from Google.
                </p>
              </div>
            </div>

            <div className={styles.stepFoot}>
              <button
                type="button"
                className={styles.footHint}
                onClick={() => showToast("Opening Gmail setup guide...")}
              >
                Need help? View Gmail setup guide →
              </button>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btnSkip} onClick={handleSkipGmail}>
                  Skip for now
                </button>
                <button
                  type="button"
                  className={styles.btnNext}
                  disabled={!stepOneComplete}
                  onClick={() => handleGoToStep(2)}
                >
                  Continue <span>→</span>
                </button>
              </div>
            </div>
          </div>
            */}
          </div>
        ) : currentStep === 2 ? (
          <div className={styles.panel}>
            <div className={styles.stepHead}>
              <div className={styles.stepNumTag}>Step 2 of 3</div>
              <h2>Connect your WhatsApp or AI number 💬</h2>
              <p>
                Scan the QR with the WhatsApp account you want ClawCloud to run on. Use your own
                number for the fastest setup, or use a second number if you want ClawCloud to appear
                as a separate chat contact.
              </p>
            </div>

            <div className={styles.stepBody}>
              <div className={styles.modeNote}>
                <div className={styles.modeNoteTitle}>
                  Want a separate ClawCloud AI chat like a normal person?
                </div>
                <div className={styles.modeNoteText}>
                  Scan this QR with a second WhatsApp number dedicated to ClawCloud. After it
                  connects, open a chat to that number from your personal WhatsApp and send{" "}
                  <b>hi</b> once. From then on, ClawCloud can reply in that separate thread and use
                  it for future briefings.
                </div>
              </div>

              {waConnected ? (
                <div className={styles.phoneConnected}>
                  <div className={styles.connectedIcon}>✅</div>
                  <div className={styles.connectedTitle}>WhatsApp connected!</div>
                  <div className={styles.connectedSub}>
                    Your agent is now running on WhatsApp number{" "}
                    <b>{waPhone || "on WhatsApp"}</b>
                  </div>
                  <div className={styles.connectedMessageCard}>
                    <div className={styles.connectedMessageLabel}>
                      Test message sent to your WhatsApp:
                    </div>
                    <div className={styles.connectedMessageText}>
                      👋 Hey! Your <b>ClawCloud AI agent</b> is now connected. I&apos;ll start
                      helping you once you finish setup. See you on the other side! 🎉
                    </div>
                  </div>
                  <div className={styles.connectedTip}>
                    If you used a dedicated AI number, message <b>{waPhone || "that number"}</b>{" "}
                    from your personal WhatsApp once. ClawCloud will keep that as your live chat.
                  </div>
                  <div className={styles.starterPanel}>
                    <div className={styles.starterPanelHead}>
                      <div>
                        <div className={styles.starterPanelEyebrow}>What can I ask?</div>
                        <div className={styles.starterPanelTitle}>
                          Starter prompts for your ClawCloud chat
                        </div>
                      </div>
                      <div className={styles.starterPanelMeta}>
                        {connectedStarterPromptCount} connected · {selectedCount} selected
                      </div>
                    </div>
                    <div className={styles.starterPanelText}>
                      Tap any connected prompt to prefill it in WhatsApp. Send it once setup
                      finishes, and ClawCloud will answer using whatever tools and automations you
                      launched.
                    </div>
                    <div className={styles.starterGrid}>
                      {clawCloudStarterPromptSections.map((section) => {
                        const sectionState = setupStarterPromptState[section.id];
                        const connected = sectionState.connected;

                        return (
                          <div
                            key={section.id}
                            className={`${styles.starterCard} ${
                              connected ? styles.starterCardActive : styles.starterCardMuted
                            }`}
                          >
                            <div className={styles.starterCardHead}>
                              <div>
                                <div className={styles.starterCardLabel}>{section.label}</div>
                                <div className={styles.starterCardDescription}>
                                  {sectionState.description}
                                </div>
                              </div>
                              <span
                                className={`${styles.starterCardStatus} ${
                                  connected
                                    ? styles.starterCardStatusActive
                                    : styles.starterCardStatusMuted
                                }`}
                              >
                                {sectionState.statusLabel}
                              </span>
                            </div>

                            <div className={styles.starterCardNote}>{sectionState.note}</div>

                            <div className={styles.starterExamples}>
                              {section.examples.map((example) => {
                                const href = connected
                                  ? buildWhatsAppChatLink(waPhone, example.prompt)
                                  : null;

                                return href ? (
                                  <a
                                    key={example.prompt}
                                    href={href}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={styles.starterExampleLink}
                                  >
                                    {example.label}
                                  </a>
                                ) : (
                                  <button
                                    key={example.prompt}
                                    type="button"
                                    className={styles.starterExampleButton}
                                    disabled
                                  >
                                    {example.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  {unifiedActivationPending || autoLaunchingAgent || googleConnecting ? (
                    <div className={styles.connectedTip}>
                      ClawCloud is finishing the rest of your activation automatically now.
                    </div>
                  ) : null}
                  {waChatLink ? (
                    <a
                      href={waChatLink}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.openChatButton}
                    >
                      Open agent chat in WhatsApp <span>→</span>
                    </a>
                  ) : null}
                </div>
              ) : (
                <div className={styles.qrContainer}>
                  <div className={styles.qrBox}>
                    <div className={styles.qrLayout}>
                      <div className={styles.qrColumn}>
                        <div
                          className={`${styles.qrCode} ${
                            scanPhase === "verifying" ? styles.qrCodeFaded : ""
                          }`}
                        >
                          {isConfigured ? (
                            waQrImage ? (
                              <img
                                src={waQrImage}
                                alt="WhatsApp QR code"
                                className={styles.qrImage}
                              />
                            ) : (
                              <div className={styles.qrPlaceholder}>
                                {waQrError ? (
                                  <>
                                    <b>Couldn&apos;t load QR</b>
                                    <span>{waQrError}</span>
                                  </>
                                ) : waLoading ? (
                                  <>
                                    <b>Generating QR…</b>
                                    <span>Preparing your live WhatsApp session</span>
                                  </>
                                ) : (
                                  <>
                                    <b>Waiting for QR…</b>
                                    <span>The agent server is starting your session</span>
                                  </>
                                )}
                              </div>
                            )
                          ) : (
                            <>
                              <div className={styles.qrGrid}>
                                {qrCells.map((filled, index) => (
                                  <div
                                    key={`${qrSeed}-${index}`}
                                    className={`${styles.qrCell} ${filled ? "" : styles.qrCellBlank}`}
                                  />
                                ))}
                              </div>
                              {scanPhase === "waiting" ? <div className={styles.qrScanLine} /> : null}
                            </>
                          )}
                        </div>
                        <div className={styles.qrTimer}>
                          {qrMinutes}:{qrRemainingSeconds < 10 ? "0" : ""}
                          {qrRemainingSeconds}
                        </div>
                        <div className={styles.qrTimerLabel}>QR expires in</div>
                      </div>

                      <div className={styles.instructionsColumn}>
                        <div className={styles.waInstructions}>
                          {[
                            "Open WhatsApp on your phone",
                            "Tap the three dots menu (Android) or Settings (iPhone)",
                            "Tap Linked devices → Link a device",
                            "Point your camera at the QR code on the left",
                          ].map((instruction, index) => (
                            <div
                              key={instruction}
                              className={`${styles.waStep} ${waConnected ? styles.waStepDone : ""}`}
                            >
                              <div className={styles.waStepNum}>
                                {waConnected ? "✓" : index + 1}
                              </div>
                              <div className={styles.waStepText}>{instruction}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className={styles.qrStatus}>
                      <div
                        className={`${styles.qrStatusLabel} ${
                          scanPhase === "verifying"
                            ? styles.qrStatusLabelGreen
                            : styles.qrStatusLabelAmber
                        }`}
                      >
                        <span
                          className={`${styles.statusDot} ${
                            scanPhase === "verifying"
                              ? styles.statusDotGreen
                              : styles.statusDotAmber
                          }`}
                        />
                        {scanPhase === "verifying"
                          ? "Phone detected — verifying…"
                          : "Waiting for scan…"}
                      </div>
                      <div className={styles.qrStatusSub}>
                        {waQrError
                          ? "Check the agent server or refresh the QR by waiting a few seconds"
                          : scanPhase === "verifying"
                            ? isConfigured
                              ? "Preparing the live QR or verifying your phone"
                              : "This usually takes just a second"
                            : isConfigured
                              ? "The live QR refreshes automatically until your phone links"
                              : "The QR code refreshes automatically"}
                      </div>
                    </div>
                  </div>

                  {isConfigured ? (
                    <button
                      type="button"
                      className={styles.demoButton}
                      onClick={() => {
                        setWaForceRefreshRequested(true);
                        setWaQrError("");
                        setWaQrImage(null);
                        setWaLoading(true);
                        setScanPhase("waiting");
                        showToast("Refreshing live QR...");
                      }}
                    >
                      Refresh live QR now
                    </button>
                  ) : null}

                  {!isConfigured ? (
                    <button
                      type="button"
                      className={styles.demoButton}
                      onClick={handleSimulateScan}
                    >
                      🔧 Demo: simulate phone scan →
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            <div className={styles.stepFoot}>
              <button type="button" className={styles.footHint} onClick={() => handleGoToStep(1)}>
                ← Back
              </button>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btnSkip} onClick={handleSkipWhatsApp}>
                  Skip for now
                </button>
                <button
                  type="button"
                  className={styles.btnNext}
                  disabled={!stepTwoComplete}
                  onClick={() => handleGoToStep(3)}
                >
                  Continue <span>→</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.panel}>
            <div className={styles.stepHead}>
              <div className={styles.stepNumTag}>Step 3 of 3</div>
              <h2>Choose your AI tasks ⚡</h2>
              <p>
                Pick what you want your agent to do. You can change these anytime from your
                dashboard.
              </p>
            </div>

            <div className={styles.stepBody}>
              <div className={styles.selectedCount}>
                {selectedCount === 0 ? (
                  "Select at least 1 task to continue"
                ) : (
                  <>
                    <b>
                      {selectedCount} task{selectedCount === 1 ? "" : "s"} selected
                    </b>{" "}
                    — ready to go
                  </>
                )}
              </div>

              <div className={styles.tasksGrid}>
                {onboardingTasks.map((task) => {
                  const isSelected = selectedTasks.includes(task.id);

                  return (
                    <div
                      key={task.id}
                      className={`${styles.taskCard} ${isSelected ? styles.taskCardSelected : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleTaskToggle(task.id)}
                      onKeyDown={(event) => handleTaskCardKeyDown(event, task.id)}
                    >
                      <div
                        className={`${styles.taskCheck} ${isSelected ? styles.taskCheckSelected : ""}`}
                      >
                        {isSelected ? "✓" : ""}
                      </div>
                      <span className={styles.taskEmoji}>{task.icon}</span>
                      <div className={styles.taskInfo}>
                        <div className={styles.taskTitle}>{task.title}</div>
                        <div className={styles.taskDesc}>{task.description}</div>
                        <div className={styles.taskMeta}>
                          {task.tags.map((tag) => (
                            <span key={`${task.id}-${tag}`} className={styles.taskTag}>
                              {tag}
                            </span>
                          ))}
                        </div>
                        <span
                          className={`${styles.taskBadge} ${
                            task.badge === "free" ? styles.taskBadgeFree : styles.taskBadgeStarter
                          }`}
                        >
                          {task.badge === "free" ? "Free plan" : "Starter plan"}
                        </span>

                        {task.hasSchedule ? (
                          <div
                            className={styles.scheduleRow}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <span className={styles.scheduleLabel}>Send at:</span>
                            <select
                              className={styles.timeSelect}
                              value={morningTime}
                              onChange={(event) =>
                                setMorningTime(event.target.value as (typeof timeOptions)[number])
                              }
                            >
                              {timeOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                            <span className={styles.scheduleLabel}>every day</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className={styles.stepFoot}>
              <button type="button" className={styles.footHint} onClick={() => handleGoToStep(2)}>
                ← Back
              </button>
              <div className={styles.btnRow}>
                <button
                  type="button"
                  className={styles.btnNext}
                  disabled={selectedCount === 0 || autoLaunchingAgent}
                  onClick={() => void handleFinishSetupAction()}
                >
                  {autoLaunchingAgent ? "Launching your agent..." : "Launch my agent 🚀"}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className={`${styles.toast} ${toastVisible ? styles.toastVisible : ""}`} role="status">
        {toastMessage}
      </div>
    </main>
  );
}
