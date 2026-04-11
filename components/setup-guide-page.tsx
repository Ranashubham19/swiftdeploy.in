"use client";

import Link from "next/link";

import styles from "./setup-guide-page.module.css";

export type SetupGuideTopic = "whatsapp-connect" | "task-picks";

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
  "whatsapp-connect": {
    eyebrow: "WhatsApp Guide",
    title: "Link your WhatsApp workspace",
    description:
      "Use this guide to finish the WhatsApp connection cleanly, whether you want ClawCloud on your own number or on a dedicated AI-only number.",
    summaryTitle: "Fastest path",
    summaryText:
      "Use your own WhatsApp account for the quickest setup. Use a second number only if you want ClawCloud to appear as a separate contact-style chat.",
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
            line: "Use your own number if you want ClawCloud to reply inside your Message yourself or self-chat thread.",
          },
          {
            line: "Use a second WhatsApp number if you want ClawCloud to appear as a separate live chat account.",
          },
          {
            line: "If you use a second number, send one hello message from your personal WhatsApp to that AI number after it connects.",
            hint: "That creates the thread ClawCloud will answer in later.",
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
            line: "Continue to task selection once the phone number is shown.",
          },
        ],
      },
    ],
    noteTitle: "Good to know",
    noteText:
      "This deployment is now configured around WhatsApp only, so setup, dashboard actions, and task picks all stay centered on the linked WhatsApp workspace.",
    ctaHint: "Go back to setup when you are ready to scan the QR.",
  },
  "task-picks": {
    eyebrow: "Task Guide",
    title: "Choose your WhatsApp tasks",
    description:
      "Use this guide to pick the best first WhatsApp tasks without enabling extra things you do not need yet.",
    summaryTitle: "Good default setup",
    summaryText:
      "Start with Smart reminders and Contact memory. Add Weekly spend summary if you want a scheduled WhatsApp update.",
    sections: [
      {
        title: "Start with the most useful tasks",
        intro:
          "These are usually the fastest to prove value once WhatsApp is linked.",
        chips: ["Reminders", "Contact memory", "Fast setup"],
        steps: [
          {
            line: 'Enable Smart reminders if you want commands like "Remind me at 5pm to call Raj" to work immediately.',
          },
          {
            line: "Enable Contact memory if you want accurate chat recall, summaries, and contact-aware answers inside WhatsApp.",
          },
          {
            line: "Enable Weekly spend summary if you want one scheduled WhatsApp summary each week.",
          },
        ],
      },
      {
        title: "Keep the first launch simple",
        intro:
          "A smaller task set usually feels cleaner and is easier to verify during the first run.",
        chips: ["Simple", "Accurate", "Expandable"],
        steps: [
          {
            line: "Choose only the tasks you know you will use right away.",
          },
          {
            line: "Launch setup, test the WhatsApp flow, and confirm the outputs feel right.",
          },
          {
            line: "You can always adjust task choices later from the dashboard.",
          },
        ],
      },
    ],
    noteTitle: "Launch tip",
    noteText:
      "Start small, verify the WhatsApp experience, and then expand. That keeps the first ClawCloud setup cleaner and easier to trust.",
    ctaHint: "Go back to setup and continue to the task step when you are ready.",
  },
};

export function isSetupGuideTopic(value: string | undefined): value is SetupGuideTopic {
  return value === "whatsapp-connect" || value === "task-picks";
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
              <ol className={styles.stepsList}>
                {section.steps.map((step) => (
                  <li key={step.line} className={styles.stepItem}>
                    <div>{step.line}</div>
                    {step.hint ? <div className={styles.stepHint}>{step.hint}</div> : null}
                  </li>
                ))}
              </ol>
            </article>
          ))}

          <div className={styles.noteCard}>
            <h2 className={styles.noteTitle}>{guide.noteTitle}</h2>
            <p className={styles.noteText}>{guide.noteText}</p>
          </div>
        </section>

        <footer className={styles.footer}>
          <div className={styles.footerHint}>{guide.ctaHint}</div>
          <Link href="/setup" className={styles.footerButton}>
            Return to setup
          </Link>
        </footer>
      </main>
    </div>
  );
}
