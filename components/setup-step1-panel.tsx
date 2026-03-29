import styles from "./setup-step1.module.css";

type ConnectionStatus = "idle" | "connecting" | "done";
type GoogleWorkspaceConnectProvider = "gmail" | "google_calendar" | "google_drive";

type SetupStepOnePanelProps = {
  gmailStatus: ConnectionStatus;
  calendarStatus: ConnectionStatus;
  driveStatus: ConnectionStatus;
  gmailConnected: boolean;
  calendarConnected: boolean;
  driveConnected: boolean;
  googleWorkspacePublicEnabled: boolean;
  googleWorkspaceExtendedEnabled: boolean;
  googleConnecting: boolean;
  stepOneComplete: boolean;
  onConnectGoogle: (provider: GoogleWorkspaceConnectProvider) => void;
  onSkip: () => void;
  onContinue: () => void;
  onShowHelp: () => void;
};

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function getStatusLabel(status: ConnectionStatus, googleWorkspacePublicEnabled: boolean) {
  if (!googleWorkspacePublicEnabled && status !== "done") {
    return "Unavailable right now";
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

function DriveIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M6.1 3.2h5.2l3.35 5.82-2.6 4.48H6.9L3.6 7.78 6.1 3.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M6.1 3.2 3.6 7.78h6.65L12.7 3.2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M6.9 13.5 10.25 7.78h4.2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
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
  driveStatus,
  gmailConnected,
  calendarConnected,
  driveConnected,
  googleWorkspacePublicEnabled,
  googleWorkspaceExtendedEnabled,
  googleConnecting,
  stepOneComplete,
  onConnectGoogle,
  onSkip,
  onContinue,
  onShowHelp,
}: SetupStepOnePanelProps) {
  const googleConnected =
    gmailConnected && calendarConnected && (!googleWorkspaceExtendedEnabled || driveConnected);
  const workspaceVerificationPending = !googleWorkspacePublicEnabled;
  const cardActionDisabled = workspaceVerificationPending || googleConnecting || googleConnected;
  const connectHint = workspaceVerificationPending
    ? "Google Workspace is unavailable on this deployment right now, so Continue stays available without it."
    : googleConnected
      ? "Google Workspace is connected. Continue is now unlocked."
      : googleConnecting
        ? "Finishing the Google handoff for the service you selected and verifying the live connection..."
        : "Tap Gmail, Calendar, or Drive to connect that service with only the scopes ClawCloud needs for it.";

  return (
    <div className={styles.step1Panel}>
      <div className={styles.step1Head}>
        <div className={styles.stepTag}>Step 1 of 3</div>
        <h2>
          {googleWorkspaceExtendedEnabled
            ? "Connect Google Workspace"
            : "Connect Gmail and Calendar"}
        </h2>
        <p>
          {googleWorkspaceExtendedEnabled
            ? "Connect the Google services you want ClawCloud to use. Each card starts its own Google consent flow and asks only for the scopes that service needs."
            : "Connect Gmail or Calendar separately so ClawCloud can draft replies, create briefings, and prepare meeting context without asking for unnecessary access."}
        </p>
      </div>

      <div className={styles.step1Body}>
        {!googleWorkspacePublicEnabled ? (
          <div className={styles.rolloutNotice}>
            <strong className={styles.rolloutTitle}>Google Workspace is unavailable right now</strong>
            <p className={styles.rolloutText}>
              Gmail, Calendar, and Drive connect is not available on this deployment for the
              moment. You can continue setup right now, test the rest of ClawCloud, and reconnect
              Google later from the dashboard once the deployment is fully configured.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          className={joinClassNames(
            styles.serviceCard,
            !googleWorkspacePublicEnabled && styles.serviceCardDisabled,
            googleConnected && styles.serviceCardStatic,
            gmailStatus === "done" && styles.serviceCardConnected,
            gmailStatus === "connecting" && styles.serviceCardConnecting,
          )}
          onClick={() => onConnectGoogle("gmail")}
          disabled={cardActionDisabled}
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
            googleConnected && styles.serviceCardStatic,
            calendarStatus === "done" && styles.serviceCardConnected,
            calendarStatus === "connecting" && styles.serviceCardConnecting,
          )}
          onClick={() => onConnectGoogle("google_calendar")}
          disabled={cardActionDisabled}
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

        {googleWorkspaceExtendedEnabled ? (
          <button
            type="button"
            className={joinClassNames(
              styles.serviceCard,
              !googleWorkspacePublicEnabled && styles.serviceCardDisabled,
              googleConnected && styles.serviceCardStatic,
              driveStatus === "done" && styles.serviceCardConnected,
              driveStatus === "connecting" && styles.serviceCardConnecting,
            )}
            onClick={() => onConnectGoogle("google_drive")}
            disabled={cardActionDisabled}
          >
            <span className={styles.serviceIconWrap} aria-hidden="true">
              <DriveIcon />
            </span>
            <span className={styles.serviceInfo}>
              <span className={styles.serviceName}>Google Drive</span>
              <span className={styles.serviceDesc}>
                Search files, open documents, and power context from Drive and Sheets.
              </span>
              <span className={styles.permTags}>
                <span className={styles.permTag}>Read files</span>
                <span className={styles.permTag}>Sheets access</span>
                <span className={styles.permTag}>Workspace search</span>
              </span>
            </span>
            <span
              className={joinClassNames(
                styles.serviceStatus,
                getStatusClass(driveStatus, googleWorkspacePublicEnabled),
              )}
            >
              {getStatusLabel(driveStatus, googleWorkspacePublicEnabled)}
            </span>
          </button>
        ) : null}

        <div
          className={joinClassNames(
            styles.continueHint,
            googleConnected && styles.continueHintReady,
          )}
        >
          {connectHint}
        </div>

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
          <button
            type="button"
            className={joinClassNames(
              styles.btnContinue,
              stepOneComplete && styles.btnContinueReady,
            )}
            disabled={!stepOneComplete}
            onClick={onContinue}
          >
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
