"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { clawCloudFrontendTaskMap } from "@/lib/clawcloud-types";
import { markOnboardingComplete } from "@/lib/onboarding";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import { SetupStepOnePanel } from "./setup-step1-panel";
import styles from "./setup-page.module.css";

type SetupPageProps = {
  config: PublicAppConfig;
};

type ConnectionStatus = "idle" | "connecting" | "done";
type TaskId = "morning" | "drafts" | "calendar" | "search" | "evening" | "remind";
type StepNumber = 1 | 2 | 3;
type ScanPhase = "waiting" | "verifying" | "connected";
type WhatsAppQrPayload = {
  status?: "connecting" | "waiting" | "connected";
  qr?: string;
  phone?: string | null;
  error?: string;
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

const googleWorkspaceRolloutMessage =
  "Google Workspace is temporarily paused while ClawCloud finishes verification. Continue setup now and connect Google later from the dashboard.";

const timeOptions = ["6:00 AM", "7:00 AM", "8:00 AM", "9:00 AM"] as const;

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

function buildWhatsAppChatLink(phone: string | null) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  return `https://wa.me/${digits}?text=${encodeURIComponent("Hi ClawCloud AI")}`;
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
  const showToastRef = useRef<(message: string) => void>(() => undefined);

  const [isCheckingSession, setIsCheckingSession] = useState(Boolean(supabase));
  const [sessionNotice, setSessionNotice] = useState("");
  const [currentStep, setCurrentStep] = useState<StepNumber>(1);
  const [gmailStatus, setGmailStatus] = useState<ConnectionStatus>("idle");
  const [calendarStatus, setCalendarStatus] = useState<ConnectionStatus>("idle");
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authAccessToken, setAuthAccessToken] = useState<string | null>(null);
  const [stepOneComplete, setStepOneComplete] = useState(false);
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
  const [morningTime, setMorningTime] = useState<(typeof timeOptions)[number]>("7:00 AM");
  const [setupComplete, setSetupComplete] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastVisible, setToastVisible] = useState(false);

  const qrCells = createQrCells(qrSeed);
  const isConfigured = Boolean(supabase);
  const gmailConnected = gmailStatus === "done";
  const calendarConnected = calendarStatus === "done";
  const waChatLink = buildWhatsAppChatLink(waPhone);

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

    async function loadUser() {
      const [{ data: userData, error }, { data: sessionData }] = await Promise.all([
        client.auth.getUser(),
        client.auth.getSession(),
      ]);

      if (cancelled) {
        return;
      }

      if (error || !userData.user) {
        setAuthUserId(null);
        setAuthAccessToken(null);
        router.replace("/auth");
        return;
      }

      setAuthUserId(userData.user.id);
      setAuthAccessToken(sessionData.session?.access_token ?? null);
      setSessionNotice("");
      setIsCheckingSession(false);
    }

    loadUser().catch((error) => {
      if (cancelled) {
        return;
      }

      setAuthUserId(null);
      setAuthAccessToken(null);
      setIsCheckingSession(false);
      setSessionNotice(error instanceof Error ? error.message : "Unable to verify your session.");
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) {
        setAuthUserId(null);
        setAuthAccessToken(null);
        router.replace("/auth");
        return;
      }

      setAuthUserId(session.user.id);
      setAuthAccessToken(session.access_token);
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

      clearGoogleTimeouts();
      clearScanTimeout();
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

    async function pollWhatsAppQr(showErrors: boolean) {
      if (cancelled) {
        return;
      }

      setWaLoading(true);

      try {
        const refreshNow = waForceRefreshRequested;
        const endpoint = refreshNow
          ? "/api/whatsapp/connect?refresh=1"
          : "/api/whatsapp/connect";

        const response = await fetch(endpoint, {
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
        if (showErrors) {
          showToastRef.current(message);
        }
      }
    }

    void pollWhatsAppQr(true);
    const pollId = window.setInterval(() => {
      void pollWhatsAppQr(false);
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(pollId);
    };
  }, [authAccessToken, currentStep, isConfigured, stepTwoComplete, waConnected, waForceRefreshRequested]);

  useEffect(() => {
    const gmailConnectedFromSearch = searchParams.get("gmail") === "connected";
    const nextStep = searchParams.get("step");
    const setupError = searchParams.get("error");

    if (gmailConnectedFromSearch) {
      clearGoogleTimeouts();
      setGoogleConnecting(false);
      setGmailStatus("done");
      setCalendarStatus("done");
      setStepOneComplete(true);
      setCurrentStep(nextStep === "2" ? 2 : 1);
    }

    if (setupError) {
      if (setupError === googleWorkspaceRolloutMessage) {
        setStepOneComplete(true);
      } else {
        showToast(setupError);
      }
    }
  }, [searchParams]);

  useEffect(() => {
    if (!config.googleRollout.publicWorkspaceEnabled) {
      clearGoogleTimeouts();
      setGoogleConnecting(false);
      setStepOneComplete(true);
    }
  }, [config.googleRollout.publicWorkspaceEnabled]);

  function handleGoToStep(step: StepNumber) {
    setCurrentStep(step);
  }

  function handleStartGmailConnect() {
    if (!config.googleRollout.publicWorkspaceEnabled) {
      showToast(googleWorkspaceRolloutMessage);
      return;
    }

    if (gmailConnected || googleConnecting) {
      return;
    }

    setGmailStatus("connecting");
  }

  function handleStartCalendarConnect() {
    if (!config.googleRollout.publicWorkspaceEnabled) {
      showToast(googleWorkspaceRolloutMessage);
      return;
    }

    if (calendarConnected || googleConnecting) {
      return;
    }

    setCalendarStatus("connecting");
  }

  async function handleConnectGoogle() {
    if (!config.googleRollout.publicWorkspaceEnabled) {
      showToast(googleWorkspaceRolloutMessage);
      return;
    }

    if (googleConnecting || (gmailConnected && calendarConnected)) {
      return;
    }

    if (authUserId) {
      const freshUrl = `/api/auth/google?userId=${encodeURIComponent(authUserId)}&ts=${Date.now()}`;
      window.location.assign(freshUrl);
      return;
    }

    clearGoogleTimeouts();
    setGoogleConnecting(true);
    setGmailStatus("connecting");
    setCalendarStatus("connecting");

    const gmailTimeout = window.setTimeout(() => {
      setGmailStatus("done");
    }, 1000);

    const calendarTimeout = window.setTimeout(() => {
      setCalendarStatus("done");
      setGoogleConnecting(false);
      setStepOneComplete(true);
      showToast("Gmail and Calendar connected ✓");
    }, 1800);

    googleTimeoutsRef.current = [gmailTimeout, calendarTimeout];
  }

  function handleSkipGmail() {
    clearGoogleTimeouts();
    setGoogleConnecting(false);
    setGmailStatus((current) => (current === "done" ? current : "idle"));
    setCalendarStatus((current) => (current === "done" ? current : "idle"));
    setStepOneComplete(true);
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

  async function handleFinishSetupAction() {
    if (supabase) {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        const selectedTaskTypes = selectedTasks.map((taskId) => clawCloudFrontendTaskMap[taskId]);
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
          showToast(payload?.error || "Could not finish setup.");
          return;
        }
      }
    }

    handleFinishSetup();
  }

  function handleDashboardLaunch() {
    markOnboardingComplete();
    router.push("/dashboard");
  }

  const selectedCount = selectedTasks.length;
  const qrMinutes = Math.floor(qrSeconds / 60);
  const qrRemainingSeconds = qrSeconds % 60;
  const summaryChips = [
    gmailConnected ? "📧 Gmail connected" : null,
    calendarConnected ? "📅 Calendar connected" : null,
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
          onClick={() => showToast("Opening help centre...")}
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
                    {step === 1 ? "Connect Gmail" : step === 2 ? "Link WhatsApp" : "Pick tasks"}
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
            <SetupStepOnePanel
              gmailStatus={gmailStatus}
              calendarStatus={calendarStatus}
              gmailConnected={gmailConnected}
              calendarConnected={calendarConnected}
              googleWorkspacePublicEnabled={config.googleRollout.publicWorkspaceEnabled}
              googleConnecting={googleConnecting}
              stepOneComplete={stepOneComplete}
              onStartGmailConnect={handleStartGmailConnect}
              onStartCalendarConnect={handleStartCalendarConnect}
              onConnectGoogle={handleConnectGoogle}
              onSkip={handleSkipGmail}
              onContinue={() => handleGoToStep(2)}
              onShowHelp={() => showToast("Opening Gmail setup guide...")}
            />
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
                  disabled={selectedCount === 0}
                  onClick={handleFinishSetupAction}
                >
                  Launch my agent 🚀
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
