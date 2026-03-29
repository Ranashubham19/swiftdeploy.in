"use client";

import { LegalPageShell, LegalSection } from "./legal-page-shell";

export function PrivacyPage() {
  return (
    <LegalPageShell
      title="Privacy Policy"
      lastUpdated="March 2026"
      relatedHref="/terms"
      relatedLabel="Terms of Service"
    >
      <LegalSection title="1. Information we collect">
        <p style={{ margin: 0 }}>When you use ClawCloud, we collect:</p>
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>
            <strong style={{ color: "#eeeef5" }}>Account info:</strong> Your name and email when
            you register via Google OAuth or email/password.
          </li>
          <li>
            <strong style={{ color: "#eeeef5" }}>OAuth tokens:</strong> Gmail, Google Calendar,
            and optional Google Drive / Sheets tokens, stored in our database with access controls
            and used only for actions you authorize.
          </li>
          <li>
            <strong style={{ color: "#eeeef5" }}>WhatsApp session:</strong> Your phone number and
            session credentials. Messages are processed in real time and not stored permanently.
          </li>
          <li>
            <strong style={{ color: "#eeeef5" }}>Usage data:</strong> Task run logs, email counts,
            and analytics shown in your dashboard.
          </li>
          <li>
            <strong style={{ color: "#eeeef5" }}>Payment data:</strong> Processed by Stripe
            (international) or Razorpay (India). We never store card details.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="2. How we use your information">
        <p style={{ margin: 0 }}>
          We use your data strictly to operate ClawCloud, to run AI tasks, send WhatsApp
          notifications, enforce plan limits, and process billing. We do{" "}
          <strong style={{ color: "#eeeef5" }}>not</strong> sell your data, use your email content
          to train AI models, or share your information with third parties for marketing.
        </p>
      </LegalSection>

      <LegalSection title="3. Gmail and Calendar access">
        <p style={{ margin: 0 }}>
          We use only the OAuth scopes you explicitly grant. Gmail access can include reading
          messages, creating drafts, sending replies, and inbox actions such as marking messages
          read, starring, or archiving on your behalf when you ask. Calendar access can include
          reading your schedule plus creating, updating, or cancelling events you explicitly
          request. Drive and Sheets access can be enabled separately when you choose those
          features. We process email and calendar content in real time and do not store full inbox
          copies by default, only metadata and AI-generated summaries where needed for the
          product.
        </p>
        <p style={{ margin: 0 }}>
          Revoke Google access at any time from{" "}
          <a
            href="https://myaccount.google.com/permissions"
            target="_blank"
            rel="noreferrer"
            style={{ color: "#ff4d4d" }}
          >
            myaccount.google.com/permissions
          </a>{" "}
          or via Settings.
        </p>
      </LegalSection>

      <LegalSection title="4. WhatsApp data">
        <p style={{ margin: 0 }}>
          Your session is managed via the Baileys library. Phone number and session credentials are
          stored securely. Messages are logged temporarily for continuity. We never send
          unsolicited messages.
        </p>
      </LegalSection>

      <LegalSection title="5. Data retention">
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>Task run logs: 90 days, then auto-deleted</li>
          <li>Analytics aggregates: 1 year</li>
          <li>WhatsApp messages: 30 days</li>
          <li>Account data: retained until you delete your account</li>
        </ul>
      </LegalSection>

      <LegalSection title="6. Security">
        <p style={{ margin: 0 }}>
          All data is encrypted in transit via TLS 1.3. Supabase row-level security and server-side
          access controls restrict which systems can reach your account data and connected account
          tokens. Payment data is handled by PCI-compliant processors only.
        </p>
      </LegalSection>

      <LegalSection title="7. Your rights">
        <p style={{ margin: 0 }}>
          You may access, export, or delete your data at any time from Settings - Danger Zone.
          Contact{" "}
          <a href="mailto:ranashubu8988@gmail.com" style={{ color: "#ff4d4d" }}>
            ranashubu8988@gmail.com
          </a>{" "}
          for any data requests.
        </p>
      </LegalSection>

      <LegalSection title="8. Cookies">
        <p style={{ margin: 0 }}>
          We use essential session cookies only. No advertising cookies and no third-party
          tracking. Disabling non-essential cookies will not affect core functionality.
        </p>
      </LegalSection>

      <LegalSection title="9. Children">
        <p style={{ margin: 0 }}>
          ClawCloud is not directed at children under 13. Contact us immediately if you believe we
          have inadvertently collected data from a child.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes">
        <p style={{ margin: 0 }}>
          Material changes will be communicated via email and in-app notification. Continued use
          after changes constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection title="11. Contact">
        <p style={{ margin: 0 }}>
          Questions?{" "}
          <a href="mailto:ranashubu8988@gmail.com" style={{ color: "#ff4d4d" }}>
            ranashubu8988@gmail.com
          </a>{" "}
          - ClawCloud Technologies, Bengaluru, Karnataka, India.
        </p>
      </LegalSection>
    </LegalPageShell>
  );
}
