import type {
  GlobalLiteConnection,
  GlobalLiteProvider,
} from "@/lib/clawcloud-global-lite";

import styles from "./setup-step1.module.css";

type SetupStepLitePanelProps = {
  connections: GlobalLiteConnection[];
  signedInWithGoogle: boolean;
  gmailEmail: string;
  calendarIcsUrl: string;
  driveLabel: string;
  saving: Partial<Record<GlobalLiteProvider, boolean>>;
  onChangeGmailEmail: (value: string) => void;
  onChangeCalendarIcsUrl: (value: string) => void;
  onChangeDriveLabel: (value: string) => void;
  onSave: (provider: GlobalLiteProvider) => void;
  onDisconnect: (provider: GlobalLiteProvider) => void;
  onSkip: () => void;
  onContinue: () => void;
  onShowHelp: () => void;
};

function joinClassNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function GmailColorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7.5v9"
        stroke="#4285F4"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M20 7.5v9"
        stroke="#34A853"
        strokeWidth="2.3"
        strokeLinecap="round"
      />
      <path
        d="M4 8.25 12 14l8-5.75"
        stroke="#EA4335"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4 16.5v-8l4.7 3.4"
        stroke="#FBBC04"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M20 16.5v-8l-4.7 3.4"
        stroke="#EA4335"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CalendarColorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="3" fill="#ffffff" />
      <path d="M7 3.5v4M17 3.5v4" stroke="#4285F4" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M4 9a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v2H4V9Z"
        fill="#4285F4"
      />
      <rect x="8" y="13" width="4" height="4" rx="1.2" fill="#4285F4" />
      <rect x="13.5" y="13" width="2.5" height="2.5" rx="0.9" fill="#D6E4FF" />
    </svg>
  );
}

function DriveColorIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M8.2 4.25h7.1l4.55 7.88h-7.1L8.2 4.25Z" fill="#0F9D58" />
      <path d="M8.2 4.25 3.65 12.13l3.55 6.12 4.55-7.87-3.55-6.13Z" fill="#F4B400" />
      <path d="M12.75 12.13h7.1l-3.55 6.12H9.2l3.55-6.12Z" fill="#4285F4" />
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
      <path
        d="M7.5 8.75V7.5a1.5 1.5 0 1 1 3 0v1.25"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <rect x="6.5" y="8.75" width="5" height="3.75" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function getConnection(
  connections: GlobalLiteConnection[],
  provider: GlobalLiteProvider,
) {
  return connections.find((connection) => connection.provider === provider) ?? null;
}

function getStatusLabel(connection: GlobalLiteConnection | null) {
  return connection ? "Lite connected" : "Not connected";
}

function getConnectionEmail(connection: GlobalLiteConnection | null) {
  const value = connection?.config.email;
  return typeof value === "string" ? value : "";
}

export function SetupStepLitePanel({
  connections,
  signedInWithGoogle,
  gmailEmail,
  calendarIcsUrl,
  driveLabel,
  saving,
  onChangeGmailEmail,
  onChangeCalendarIcsUrl,
  onChangeDriveLabel,
  onSave,
  onDisconnect,
  onSkip,
  onContinue,
  onShowHelp,
}: SetupStepLitePanelProps) {
  const gmailConnection = getConnection(connections, "gmail");
  const calendarConnection = getConnection(connections, "google_calendar");
  const driveConnection = getConnection(connections, "google_drive");
  const gmailAutoPreparing = Boolean(saving.gmail && !gmailConnection);
  const driveAutoPreparing = Boolean(saving.google_drive && !driveConnection);
  const gmailAutoReady = Boolean(gmailConnection);
  const driveAutoReady = Boolean(driveConnection);
  const gmailInputHidden = signedInWithGoogle || gmailAutoPreparing || gmailAutoReady;
  const driveInputHidden = signedInWithGoogle || driveAutoPreparing || driveAutoReady;
  const gmailIdentity = getConnectionEmail(gmailConnection) || gmailEmail.trim();

  return (
    <div className={styles.step1Panel}>
      <div className={styles.step1Head}>
        <div className={styles.stepTag}>Step 1 of 3</div>
        <h2 className={styles.step1HeadingWithIcon}>
          <span>Prepare Gmail, Calendar, and Drive</span>
          <span className={joinClassNames(styles.step1HeadingIcon, styles.step1HeadingIconColor)} aria-hidden="true">
            <GmailColorIcon />
          </span>
        </h2>
        <p>
          ClawCloud is using its public-safe Lite setup path here, so setup does not open the
          Google verification screen. Gmail Lite and Drive Lite can prepare automatically,
          and Calendar Lite stays on the safe private-ICS path. These are fallback workspace
          links, not full Google API connections.
        </p>
      </div>

      <div className={styles.step1Body}>
        <div
          className={joinClassNames(
            styles.serviceCard,
            styles.serviceCardStack,
            styles.serviceCardStatic,
            gmailAutoPreparing && styles.serviceCardConnecting,
            gmailConnection && styles.serviceCardConnected,
          )}
        >
          <div className={styles.serviceCardTop}>
            <span className={joinClassNames(styles.serviceIconWrap, styles.serviceIconWrapGoogle)} aria-hidden="true">
              <GmailColorIcon />
            </span>
            <span className={styles.serviceInfo}>
              <span className={styles.serviceName}>Gmail</span>
              <span className={styles.serviceDesc}>
                Prepare imported mail, forwarded threads, and inbox context without full Gmail OAuth.
              </span>
              <span className={styles.permTags}>
                <span className={styles.permTag}>Imported mail</span>
                <span className={styles.permTag}>Forwarded threads</span>
                <span className={styles.permTag}>Inbox context</span>
              </span>
            </span>
            <span
              className={joinClassNames(
                styles.serviceStatus,
                gmailAutoPreparing
                  ? styles.statusConnecting
                  : gmailConnection
                    ? styles.statusDone
                    : styles.statusIdle,
              )}
            >
              {gmailAutoPreparing ? "Preparing Lite" : getStatusLabel(gmailConnection)}
            </span>
          </div>

          {gmailInputHidden ? null : (
            <div className={styles.liteFieldRow}>
              <input
                className={styles.liteInput}
                type="email"
                value={gmailEmail}
                onChange={(event) => onChangeGmailEmail(event.target.value)}
                placeholder="you@example.com"
                readOnly={gmailAutoPreparing}
              />
              <button
                type="button"
                className={styles.liteButton}
                disabled={Boolean(saving.gmail)}
                onClick={() => onSave("gmail")}
              >
                {saving.gmail ? "Saving..." : gmailConnection ? "Update Gmail Lite" : "Enable Gmail Lite"}
              </button>
              {gmailConnection ? (
                <button
                  type="button"
                  className={styles.liteButtonSecondary}
                  disabled={Boolean(saving.gmail)}
                  onClick={() => onDisconnect("gmail")}
                >
                  Remove
                </button>
              ) : null}
            </div>
          )}

          <div className={styles.serviceDetailText}>
            {gmailAutoPreparing
              ? "ClawCloud is preparing Gmail Lite from your Google sign-in so imported or forwarded inbox snapshots stay ready."
              : gmailAutoReady
                ? signedInWithGoogle
                  ? `Gmail Lite is ready from your Google sign-in${gmailIdentity ? ` as ${gmailIdentity}` : ""}. It does not grant direct Gmail API inbox access on this deployment.`
                  : "Gmail Lite is ready for imported or forwarded inbox snapshots on this deployment."
                : signedInWithGoogle
                  ? "Google sign-in is active. Gmail Lite will prepare here automatically."
                  : "Save your inbox identity here to use Gmail Lite for imported mail and forwarding workflows."}
          </div>
        </div>

        <div
          className={joinClassNames(
            styles.serviceCard,
            styles.serviceCardStack,
            styles.serviceCardStatic,
            calendarConnection && styles.serviceCardConnected,
          )}
        >
          <div className={styles.serviceCardTop}>
            <span className={joinClassNames(styles.serviceIconWrap, styles.serviceIconWrapGoogle)} aria-hidden="true">
              <CalendarColorIcon />
            </span>
            <span className={styles.serviceInfo}>
              <span className={styles.serviceName}>
                Google Calendar
                <span className={styles.optionalTag}>Optional</span>
              </span>
              <span className={styles.serviceDesc}>
                Read upcoming events for meeting reminders, daily plans, and schedule context.
              </span>
              <span className={styles.permTags}>
                <span className={styles.permTag}>Read events</span>
                <span className={styles.permTag}>ICS feed</span>
                <span className={styles.permTag}>Read only</span>
              </span>
            </span>
            <span
              className={joinClassNames(
                styles.serviceStatus,
                calendarConnection ? styles.statusDone : styles.statusIdle,
              )}
            >
              {getStatusLabel(calendarConnection)}
            </span>
          </div>

          <div className={joinClassNames(styles.liteFieldRow, styles.liteFieldRowWide)}>
            <input
              className={styles.liteInput}
              value={calendarIcsUrl}
              onChange={(event) => onChangeCalendarIcsUrl(event.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
            />
            <button
              type="button"
              className={styles.liteButton}
              disabled={Boolean(saving.google_calendar)}
              onClick={() => onSave("google_calendar")}
            >
              {saving.google_calendar ? "Saving..." : calendarConnection ? "Update Calendar Lite" : "Enable Calendar Lite"}
            </button>
            {calendarConnection ? (
              <button
                type="button"
                className={styles.liteButtonSecondary}
                disabled={Boolean(saving.google_calendar)}
                onClick={() => onDisconnect("google_calendar")}
              >
                Remove
              </button>
            ) : null}
          </div>

          <div className={styles.serviceDetailText}>
            Calendar Lite is read-only and does not create or edit Google Calendar events on
            this deployment. Paste the private ICS link from your calendar once here, and
            ClawCloud will safely use it for agendas, reminders, and availability context.
          </div>
        </div>

        <div
          className={joinClassNames(
            styles.serviceCard,
            styles.serviceCardStack,
            styles.serviceCardStatic,
            driveAutoPreparing && styles.serviceCardConnecting,
            driveConnection && styles.serviceCardConnected,
          )}
        >
          <div className={styles.serviceCardTop}>
            <span className={joinClassNames(styles.serviceIconWrap, styles.serviceIconWrapGoogle)} aria-hidden="true">
              <DriveColorIcon />
            </span>
            <span className={styles.serviceInfo}>
              <span className={styles.serviceName}>Google Drive</span>
              <span className={styles.serviceDesc}>
                Prepare uploads, shared docs, and document-vault access without full Drive OAuth.
              </span>
              <span className={styles.permTags}>
                <span className={styles.permTag}>Uploads</span>
                <span className={styles.permTag}>Shared docs</span>
                <span className={styles.permTag}>Document vault</span>
              </span>
            </span>
            <span
              className={joinClassNames(
                styles.serviceStatus,
                driveAutoPreparing
                  ? styles.statusConnecting
                  : driveConnection
                    ? styles.statusDone
                    : styles.statusIdle,
              )}
            >
              {driveAutoPreparing ? "Preparing Lite" : getStatusLabel(driveConnection)}
            </span>
          </div>

          {driveInputHidden ? null : (
            <div className={styles.liteFieldRow}>
              <input
                className={styles.liteInput}
                value={driveLabel}
                onChange={(event) => onChangeDriveLabel(event.target.value)}
                placeholder="My ClawCloud document vault"
                readOnly={driveAutoPreparing}
              />
              <button
                type="button"
                className={styles.liteButton}
                disabled={Boolean(saving.google_drive)}
                onClick={() => onSave("google_drive")}
              >
                {saving.google_drive ? "Saving..." : driveConnection ? "Update Drive Lite" : "Enable Drive Lite"}
              </button>
              {driveConnection ? (
                <button
                  type="button"
                  className={styles.liteButtonSecondary}
                  disabled={Boolean(saving.google_drive)}
                  onClick={() => onDisconnect("google_drive")}
                >
                  Remove
                </button>
              ) : null}
            </div>
          )}

          <div className={styles.serviceDetailText}>
            {driveAutoPreparing
              ? "ClawCloud is preparing Drive Lite from your Google sign-in so uploads and shared docs stay ready."
              : driveAutoReady
                ? signedInWithGoogle
                  ? "Drive Lite is ready from your Google sign-in. It does not grant direct Google Drive API file browsing on this deployment."
                  : "Drive Lite is ready for uploads, shared docs, and document-vault workflows."
                : signedInWithGoogle
                  ? "Google sign-in is active. Drive Lite will prepare here automatically."
                  : "Enable Drive Lite now so ClawCloud can organize uploads and shared files for you."}
          </div>
        </div>

        <div className={styles.privacyNote}>
          <span className={styles.privacyNoteIcon} aria-hidden="true">
            <PrivacyIcon />
          </span>
          <p className={styles.privacyNoteText}>
            <strong>Your data stays private.</strong> ClawCloud uses only the connection
            details needed for inbox automation, calendar context, and document access. You
            can update or remove these connections any time from Settings.
          </p>
        </div>
      </div>

      <div className={styles.step1Foot}>
        <button type="button" className={styles.helpLink} onClick={onShowHelp}>
          Need help? View the Lite setup guide
        </button>
        <div className={styles.footRight}>
          <button type="button" className={styles.btnSkip} onClick={onSkip}>
            Skip for now
          </button>
          <button type="button" className={styles.btnContinue} onClick={onContinue}>
            Continue
            <span className={styles.btnArrow} aria-hidden="true">
              -&gt;
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
