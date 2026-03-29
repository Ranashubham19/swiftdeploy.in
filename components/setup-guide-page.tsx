import Link from "next/link";

import styles from "./setup-guide-page.module.css";

export type SetupGuideTopic =
  | "global-connect"
  | "workspace-connect"
  | "whatsapp-connect"
  | "task-picks";

type GuideSection = {
  title: string;
  intro: string;
  steps: Array<{
    line: string;
    hint?: string;
  }>;
  chips?: string[];
};

type GuideContent = {
  eyebrow: string;
  title: string;
  description: string;
  summaryTitle: string;
  summaryText: string;
  sections: GuideSection[];
  noteTitle: string;
  noteText: string;
  ctaHint: string;
};

const guideContentByTopic: Record<SetupGuideTopic, GuideContent> = {
  "global-connect": {
    eyebrow: "Setup Guide",
    title: "Connect Gmail, Calendar, and Drive with Global Connect",
    description:
      "Use this guide when full Google Workspace OAuth is unavailable on the current deployment. Gmail and Drive can prepare automatically from Google sign-in, and Calendar connects once you paste your private ICS link.",
    summaryTitle: "Best path for most users",
    summaryText:
      "Sign in with Google first, let Gmail and Drive finish automatically, then paste the private ICS calendar link once. After that, continue setup and link WhatsApp.",
    sections: [
      {
        title: "Gmail and Drive automatic connect",
        intro:
          "These two connections prepare automatically after Google sign-in, so you normally do not need to type anything.",
        chips: ["Automatic", "Global-safe", "Fastest setup"],
        steps: [
          {
            line: "Finish Google sign-in and wait a moment on the setup screen.",
            hint: "Gmail and Drive should switch from Preparing to Connected automatically.",
          },
          {
            line: "If either card does not connect, refresh once and wait 2 to 3 seconds.",
            hint: "The setup handoff now seeds those two connections before the rest of the page opens.",
          },
          {
            line: "Once both cards show Connected, continue to Calendar and WhatsApp.",
          },
        ],
      },
      {
        title: "Calendar ICS link",
        intro:
          "Calendar still needs one manual step because Google sign-in does not expose the private ICS feed automatically.",
        chips: ["One-time step", "Read-only", "Private ICS"],
        steps: [
          {
            line: "Open Google Calendar in a browser and choose the calendar you want ClawCloud to read.",
          },
          {
            line: "Go to Settings and sharing for that calendar.",
          },
          {
            line: "Open the Integrate calendar section and copy the Secret address in iCal format.",
            hint: "Use the secret/private ICS link, not the public embed link.",
          },
          {
            line: "Paste that link into the Calendar field in setup and press Connect.",
          },
        ],
      },
      {
        title: "Finish the setup flow",
        intro:
          "After Step 1 is done, ClawCloud is ready for the remaining setup pieces.",
        chips: ["Continue", "WhatsApp", "Tasks"],
        steps: [
          {
            line: "Press Continue to move to WhatsApp QR linking.",
          },
          {
            line: "Scan the QR from the WhatsApp account you want ClawCloud to run on.",
          },
          {
            line: "Choose the tasks you want active on launch, then finish setup.",
          },
        ],
      },
    ],
    noteTitle: "Privacy note",
    noteText:
      "Global Connect keeps the fallback flow public-safe when full Google Workspace OAuth is unavailable. Gmail and Drive use the signed-in identity, and Calendar stays read-only through the private ICS feed.",
    ctaHint: "When you are ready, go back to setup and continue from Step 1.",
  },
  "workspace-connect": {
    eyebrow: "Workspace Guide",
    title: "Connect Google Workspace in one consent flow",
    description:
      "Use this guide when the full Google Workspace connection is available. Gmail, Calendar, and optionally Drive can connect in one permission flow.",
    summaryTitle: "Recommended flow",
    summaryText:
      "Click Continue with Google, approve the requested scopes, wait for the connection badges to turn green, then continue directly to WhatsApp linking.",
    sections: [
      {
        title: "Start the Google consent flow",
        intro:
          "The setup page launches the Google OAuth window for Gmail, Calendar, and Drive when those scopes are available.",
        chips: ["One consent flow", "Gmail", "Calendar"],
        steps: [
          {
            line: "Press Continue with Google on Step 1.",
          },
          {
            line: "Choose the Google account you want ClawCloud to use.",
          },
          {
            line: "Review the permissions and approve the connection.",
          },
        ],
      },
      {
        title: "Wait for the cards to finish",
        intro:
          "ClawCloud updates the Gmail, Calendar, and Drive state after the callback returns to setup.",
        chips: ["Connected badges", "Return to setup"],
        steps: [
          {
            line: "Stay on the setup page until the cards stop showing Connecting.",
          },
          {
            line: "Confirm Gmail and Calendar show Connected before pressing Continue.",
          },
          {
            line: "If Drive is part of your enabled scope set, wait for Drive to connect too.",
          },
        ],
      },
    ],
    noteTitle: "Troubleshooting note",
    noteText:
      "If Google closes the flow before setup returns, open setup again and retry the same account. The latest auth handoff now preserves the correct origin and resumes cleanly.",
    ctaHint: "Return to setup when the Google window finishes.",
  },
  "whatsapp-connect": {
    eyebrow: "WhatsApp Guide",
    title: "Link your WhatsApp or AI number",
    description:
      "Use this guide to finish Step 2 cleanly, whether you want ClawCloud on your own number or on a second AI-only WhatsApp number.",
    summaryTitle: "Fastest option",
    summaryText:
      "Use your own WhatsApp account if you want the quickest setup. Use a second number only if you want ClawCloud to appear as a separate contact-style chat.",
    sections: [
      {
        title: "Scan the QR code",
        intro:
          "The QR shown in setup links the exact WhatsApp account ClawCloud will run on.",
        chips: ["Linked devices", "QR scan", "Secure session"],
        steps: [
          {
            line: "Open WhatsApp on the phone you want to connect.",
          },
          {
            line: "Go to Linked devices and choose Link a device.",
          },
          {
            line: "Scan the QR shown on the ClawCloud setup page.",
          },
        ],
      },
      {
        title: "Choose the right number",
        intro:
          "ClawCloud can run either on your own account or on a dedicated AI account.",
        chips: ["Own number", "Second number", "Self chat"],
        steps: [
          {
            line: "Use your own number if you want ClawCloud to message you in your self-chat thread.",
          },
          {
            line: "Use a second WhatsApp number if you want ClawCloud to appear as a separate live chat account.",
          },
          {
            line: "After a second number connects, send one hello message from your personal number to that AI number to establish the thread.",
          },
        ],
      },
      {
        title: "Finish and verify",
        intro:
          "The setup page should show the connected phone number before you continue.",
        chips: ["Connected", "Message test", "Continue"],
        steps: [
          {
            line: "Wait for the connected state to appear on the setup page.",
          },
          {
            line: "If it does not connect, refresh the QR once and rescan.",
          },
          {
            line: "Continue to the task selection step once the phone number is shown.",
          },
        ],
      },
    ],
    noteTitle: "Good to know",
    noteText:
      "The personal assistant channel lives inside WhatsApp. On your own number it usually appears in Message yourself or self-chat. On a second number it behaves like a separate chat thread.",
    ctaHint: "Go back to setup when you are ready to scan the QR.",
  },
  "task-picks": {
    eyebrow: "Task Guide",
    title: "Choose the right tasks before launch",
    description:
      "Use this guide to pick the best first tasks for ClawCloud without overloading your plan or enabling things you do not need yet.",
    summaryTitle: "Good default setup",
    summaryText:
      "Start with Morning briefing, Draft email replies, and Meeting reminders. Add more later after the core flow is working the way you want.",
    sections: [
      {
        title: "Pick the high-value tasks first",
        intro:
          "These are usually the fastest to prove value after setup.",
        chips: ["Morning briefing", "Drafts", "Reminders"],
        steps: [
          {
            line: "Enable Morning email briefing if you want one daily summary in WhatsApp.",
          },
          {
            line: "Enable Draft email replies if you want to ask ClawCloud for Gmail drafts on demand.",
          },
          {
            line: "Enable Meeting reminders if your calendar is connected and you want schedule nudges.",
          },
        ],
      },
      {
        title: "Stay inside your plan",
        intro:
          "Some tasks are trimmed automatically if they exceed the current plan allowance.",
        chips: ["Plan-safe", "Starter aware"],
        steps: [
          {
            line: "Choose the most important tasks first instead of selecting everything.",
          },
          {
            line: "If a task is skipped at launch, setup will keep the tasks your current plan allows.",
          },
          {
            line: "You can always adjust task choices later from the dashboard.",
          },
        ],
      },
    ],
    noteTitle: "Launch tip",
    noteText:
      "A smaller set of high-signal tasks usually makes the first ClawCloud experience feel much cleaner. Start simple, verify the outputs, then expand from the dashboard later.",
    ctaHint: "Go back to setup and continue to the task step when you are ready.",
  },
};

export function isSetupGuideTopic(value: string | undefined): value is SetupGuideTopic {
  return value === "global-connect"
    || value === "workspace-connect"
    || value === "whatsapp-connect"
    || value === "task-picks";
}

type SetupGuidePageProps = {
  topic: SetupGuideTopic;
};

export function SetupGuidePage({ topic }: SetupGuidePageProps) {
  const guide = guideContentByTopic[topic];

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <Link href="/" className={styles.brand}>
          <span className={styles.brandIcon}>AI</span>
          Claw<span className={styles.accent}>Cloud</span>
        </Link>
        <Link href="/setup" className={styles.backLink}>
          Back to setup
        </Link>
      </nav>

      <main className={styles.shell}>
        <section className={styles.hero}>
          <div className={styles.eyebrow}>{guide.eyebrow}</div>
          <h1 className={styles.title}>{guide.title}</h1>
          <p className={styles.description}>{guide.description}</p>
        </section>

        <section className={styles.content}>
          <div className={styles.summaryCard}>
            <h2 className={styles.summaryTitle}>{guide.summaryTitle}</h2>
            <p className={styles.summaryText}>{guide.summaryText}</p>
          </div>

          {guide.sections.map((section, sectionIndex) => (
            <article key={section.title} className={styles.sectionCard}>
              <div className={styles.sectionHeader}>
                <span className={styles.sectionNumber}>{sectionIndex + 1}</span>
                <h2 className={styles.sectionTitle}>{section.title}</h2>
              </div>
              <p className={styles.sectionText}>{section.intro}</p>
              {section.chips?.length ? (
                <div className={styles.chipRow}>
                  {section.chips.map((chip) => (
                    <span key={chip} className={styles.chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              ) : null}
              <ol className={styles.stepList}>
                {section.steps.map((step, stepIndex) => (
                  <li key={`${section.title}-${stepIndex}`} className={styles.stepItem}>
                    <span className={styles.stepBullet}>{stepIndex + 1}</span>
                    <div className={styles.stepBody}>
                      <div className={styles.stepLine}>{step.line}</div>
                      {step.hint ? <div className={styles.stepHint}>{step.hint}</div> : null}
                    </div>
                  </li>
                ))}
              </ol>
            </article>
          ))}

          <div className={styles.noteCard}>
            <h2 className={styles.noteTitle}>{guide.noteTitle}</h2>
            <p className={styles.noteText}>{guide.noteText}</p>
          </div>

          <div className={styles.ctaRow}>
            <div className={styles.ctaHint}>{guide.ctaHint}</div>
            <Link href="/setup" className={styles.ctaButton}>
              Return to setup
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
