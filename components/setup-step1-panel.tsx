import styles from "./setup-step1.module.css";

type ConnectionStatus = "idle" | "connecting" | "done";

type SetupStepOnePanelProps = {
  gmailStatus: ConnectionStatus;
  calendarStatus: ConnectionStatus;
  gmailConnected: boolean;
  calendarConnected: boolean;
  googleWorkspacePublicEnabled: boolean;
  googleConnecting: boolean;
  stepOneComplete: boolean;
  onStartGmailConnect: () => void;
  onStartCalendarConnect: () => void;
  onConnectGoogle: () => void;
  onSkip: () => void;
  onContinue: () => void;
  onShowHelp: () => void;
};

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function getStatusLabel(status: ConnectionStatus, googleWorkspacePublicEnabled: boolean) {
  if (!googleWorkspacePublicEnabled && status !== "done") {
    return "Paused temporarily";
  }

  if (status === "done") {
    return "Connected";
  }

  if (status === "connecting") {
    return "Connecting...";
  }

  return "Not connected";
}

function getStatusClass(status: ConnectionStatus, googleWorkspacePublicEnabled: boolean) {
  if (!googleWorkspacePublicEnabled && status !== "done") {
    return styles.statusPending;
  }

  if (status === "done") {
    return styles.statusDone;
  }

  if (status === "connecting") {
    return styles.statusConnecting;
  }

  return styles.statusIdle;
}

function GoogleColorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M19.6 10.227c0-.709-.064-1.39-.182-2.045H10v3.867h5.382a4.6 4.6 0 0 1-1.996 3.018v2.51h3.232c1.891-1.742 2.982-4.305 2.982-7.35Z"
      />
      <path
        fill="#34A853"
        d="M10 20c2.7 0 4.964-.895 6.618-2.423l-3.232-2.51c-.895.6-2.04.955-3.386.955-2.604 0-4.809-1.759-5.595-4.123H1.064v2.59A9.996 9.996 0 0 0 10 20Z"
      />
      <path
        fill="#FBBC04"
        d="M4.405 11.9A6.013 6.013 0 0 1 4.091 10c0-.663.114-1.308.314-1.9V5.51H1.064A9.996 9.996 0 0 0 0 10c0 1.614.386 3.14 1.064 4.49l3.34-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M10 3.977c1.468 0 2.786.505 3.823 1.496l2.868-2.869C14.959.99 12.695 0 10 0A9.996 9.996 0 0 0 1.064 5.51l3.34 2.59C5.192 5.736 7.396 3.977 10 3.977Z"
      />
    </svg>
  );
}

function GmailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M2.25 4.5A1.5 1.5 0 0 1 3.75 3h10.5a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H3.75a1.5 1.5 0 0 1-1.5-1.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="m3.75 5.25 4.44 3.7a1.25 1.25 0 0 0 1.62 0l4.44-3.7"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2.25" y="3.75" width="13.5" height="12" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.25 2.25v3M12.75 2.25v3M2.25 7.5h13.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6.25 10.25h2.5v2.5h-2.5z" fill="currentColor" />
    </svg>
  );
}

function PrivacyIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M9 2.25 13.5 4v4.37c0 3.02-1.88 5.77-4.5 6.88-2.62-1.11-4.5-3.86-4.5-6.88V4L9 2.25Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M7.5 8.75V7.5a1.5 1.5 0 1 1 3 0v1.25" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="6.5" y="8.75" width="5" height="3.75" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function SetupStepOnePanel({
  gmailStatus,
  calendarStatus,
  gmailConnected,
  calendarConnected,
  googleWorkspacePublicEnabled,
  googleConnecting,
  stepOneComplete,
  onStartGmailConnect,
  onStartCalendarConnect,
  onConnectGoogle,
  onSkip,
  onContinue,
  onShowHelp,
}: SetupStepOnePanelProps) {
  const googleConnected = gmailConnected && calendarConnected;

  return (
    <div className={styles.step1Panel}>
      <div className={styles.step1Head}>
        <div className={styles.stepTag}>Step 1 of 3</div>
        <h2>Connect Gmail and Calendar</h2>
        <p>
          Give ClawCloud secure access to your inbox and schedule so it can draft replies, create
          briefings, and prepare meeting context professionally. Drive and Sheets access can be
          added later from Settings when you need it.
        </p>
      </div>

      <div className={styles.step1Body}>
        {!googleWorkspacePublicEnabled ? (
          <div className={styles.rolloutNotice}>
            <strong className={styles.rolloutTitle}>Google Workspace verification is pending</strong>
            <p className={styles.rolloutText}>
              Gmail and Calendar connect stays behind a rollout gate until Google approves the app
              for public use. You can continue setup right now, test the rest of ClawCloud, and
              connect Google later from the dashboard without sending users into the raw
              unverified-app warning.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          className={joinClassNames(
            styles.serviceCard,
            !googleWorkspacePublicEnabled && styles.serviceCardDisabled,
            gmailStatus === "done" && styles.serviceCardConnected,
            gmailStatus === "connecting" && styles.serviceCardConnecting,
          )}
          onClick={onStartGmailConnect}
          disabled={!googleWorkspacePublicEnabled && gmailStatus !== "done"}
        >
          <span className={styles.serviceIconWrap} aria-hidden="true">
            <GmailIcon />
          </span>
          <span className={styles.serviceInfo}>
            <span className={styles.serviceName}>Gmail</span>
            <span className={styles.serviceDesc}>
              Read threads, prepare smart drafts, and power WhatsApp inbox briefings.
            </span>
            <span className={styles.permTags}>
              <span className={styles.permTag}>Read email</span>
              <span className={styles.permTag}>Create drafts</span>
              <span className={styles.permTag}>Send replies</span>
            </span>
          </span>
          <span
            className={joinClassNames(
              styles.serviceStatus,
              getStatusClass(gmailStatus, googleWorkspacePublicEnabled),
            )}
          >
            {getStatusLabel(gmailStatus, googleWorkspacePublicEnabled)}
          </span>
        </button>

        <button
          type="button"
          className={joinClassNames(
            styles.serviceCard,
            !googleWorkspacePublicEnabled && styles.serviceCardDisabled,
            calendarStatus === "done" && styles.serviceCardConnected,
            calendarStatus === "connecting" && styles.serviceCardConnecting,
          )}
          onClick={onStartCalendarConnect}
          disabled={!googleWorkspacePublicEnabled && calendarStatus !== "done"}
        >
          <span className={styles.serviceIconWrap} aria-hidden="true">
            <CalendarIcon />
          </span>
          <span className={styles.serviceInfo}>
            <span className={styles.serviceName}>
              Google Calendar
              <span className={styles.optionalTag}>Optional</span>
            </span>
            <span className={styles.serviceDesc}>
              Read upcoming events for meeting reminders, daily plans, and context-aware updates.
            </span>
            <span className={styles.permTags}>
              <span className={styles.permTag}>Read events</span>
              <span className={styles.permTag}>Read only</span>
            </span>
          </span>
          <span
            className={joinClassNames(
              styles.serviceStatus,
              getStatusClass(calendarStatus, googleWorkspacePublicEnabled),
            )}
          >
            {getStatusLabel(calendarStatus, googleWorkspacePublicEnabled)}
          </span>
        </button>

        <button
          type="button"
          className={joinClassNames(styles.googleBtn, googleConnected && styles.googleBtnConnected)}
          onClick={onConnectGoogle}
          disabled={googleConnecting || googleConnected || !googleWorkspacePublicEnabled}
        >
          {googleConnecting ? (
            <span className={styles.googleBtnSpinner} aria-hidden="true" />
          ) : (
            <span className={styles.googleBtnIcon} aria-hidden="true">
              <GoogleColorIcon />
            </span>
          )}
          <span>
            {googleConnecting
              ? "Connecting to Google..."
              : googleConnected
                ? "Gmail and Calendar connected"
                : googleWorkspacePublicEnabled
                  ? "Continue with Google"
                  : "Google Workspace verification pending"}
          </span>
        </button>

        <div className={styles.privacyNote}>
          <span className={styles.privacyNoteIcon} aria-hidden="true">
            <PrivacyIcon />
          </span>
          <p className={styles.privacyNoteText}>
            <strong>Your data stays private.</strong> Access is limited to the permissions needed
            for inbox automation and meeting context. You can revoke Google access at any time.
          </p>
        </div>

        <div className={styles.trustRow}>
          <span className={styles.trustBadge}>Minimum required scopes</span>
          <span className={styles.trustBadge}>No inbox cloning</span>
          <span className={styles.trustBadge}>Live processing only</span>
          <span className={styles.trustBadge}>Revocable from Google</span>
        </div>
      </div>

      <div className={styles.step1Foot}>
        <button type="button" className={styles.helpLink} onClick={onShowHelp}>
          Need help? View the Gmail setup guide
        </button>
        <div className={styles.footRight}>
          <button type="button" className={styles.btnSkip} onClick={onSkip}>
            Skip for now
          </button>
          <button type="button" className={styles.btnContinue} disabled={!stepOneComplete} onClick={onContinue}>
            {googleWorkspacePublicEnabled || googleConnected ? "Continue" : "Continue without Google"}
            <span className={styles.btnArrow} aria-hidden="true">
              -&gt;
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
