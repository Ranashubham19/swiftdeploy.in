"use client";

import { LegalPageShell, LegalSection } from "./legal-page-shell";

export function TermsPage() {
  return (
    <LegalPageShell
      title="Terms of Service"
      lastUpdated="March 2026"
      relatedHref="/privacy"
      relatedLabel="Privacy Policy"
    >
      <LegalSection title="1. Acceptance">
        <p style={{ margin: 0 }}>
          By creating an account or using ClawCloud, you agree to be bound by these Terms. If you
          do not agree, do not use the Service. ClawCloud is operated by ClawCloud Technologies.
        </p>
      </LegalSection>

      <LegalSection title="2. The Service">
        <p style={{ margin: 0 }}>
          ClawCloud is an AI-powered personal productivity assistant connecting your Gmail, Google
          Calendar, and WhatsApp to automate routine tasks including email summarization, draft
          generation, meeting reminders, and email search. The Service is provided on an "as is"
          basis and features may change with reasonable notice.
        </p>
      </LegalSection>

      <LegalSection title="3. Account registration">
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>You must be 13 years or older to use ClawCloud.</li>
          <li>You are responsible for the security of your account credentials.</li>
          <li>You agree to provide accurate and current information.</li>
          <li>You are responsible for all activity that occurs under your account.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Acceptable use">
        <p style={{ margin: 0 }}>
          You agree not to use ClawCloud to send spam, violate any applicable laws, attempt to
          reverse-engineer the Service, circumvent plan or rate limits through technical means, or
          use the Service for any unlawful, harmful, or abusive purpose. We may suspend or
          terminate accounts that violate these terms.
        </p>
      </LegalSection>

      <LegalSection title="5. Third-party integrations">
        <p style={{ margin: 0 }}>
          ClawCloud integrates with Google (Gmail, Calendar), WhatsApp (via Baileys), Stripe, and
          Razorpay. Your use of these integrations is also subject to each third party's terms of
          service. We are not responsible for the availability or actions of third-party platforms.
        </p>
      </LegalSection>

      <LegalSection title="6. Plans, billing, and cancellation">
        <ul style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>
            <strong style={{ color: "#eeeef5" }}>Free:</strong> 10 task runs/day, 1 WhatsApp
            connection. No credit card required.
          </li>
          <li>
            <strong style={{ color: "#eeeef5" }}>Starter:</strong> Rs 799/mo or $29/mo - unlimited
            runs, Telegram, Gmail + Calendar, and draft replies.
          </li>
          <li>
            <strong style={{ color: "#eeeef5" }}>Pro:</strong> Rs 2,499/mo or $79/mo - all
            features, unlimited automations, auto-send, and priority support.
          </li>
        </ul>
        <p style={{ margin: 0 }}>
          Cancel anytime from Settings - Plan and Billing. Cancellation takes effect at the end of
          the current billing period. No prorated refunds for unused time except where required by
          law.
        </p>
      </LegalSection>

      <LegalSection title="7. Refunds">
        <p style={{ margin: 0 }}>
          If you are not satisfied within the first 7 days of a paid plan, contact{" "}
          <a href="mailto:ranashubu8988@gmail.com" style={{ color: "#ff4d4d" }}>
            ranashubu8988@gmail.com
          </a>{" "}
          for a full refund. After 7 days, refunds are at our discretion.
        </p>
      </LegalSection>

      <LegalSection title="8. Intellectual property">
        <p style={{ margin: 0 }}>
          ClawCloud and all associated intellectual property, including software, design, brand
          assets, and AI models, are owned by ClawCloud Technologies. AI-generated outputs created
          for you belong to you. We make no claim to ownership of outputs generated on your behalf.
        </p>
      </LegalSection>

      <LegalSection title="9. Limitation of liability">
        <p style={{ margin: 0 }}>
          To the maximum extent permitted by law, ClawCloud Technologies shall not be liable for
          any indirect, incidental, or consequential damages arising from your use of the Service,
          including missed emails, meetings, or inaccurate AI-generated content. Our total
          liability for any claim shall not exceed the amount you paid us in the 3 months preceding
          the claim.
        </p>
      </LegalSection>

      <LegalSection title="10. Disclaimer of warranties">
        <p style={{ margin: 0 }}>
          The Service is provided on an "as is" basis without warranty of any kind. We do not
          guarantee uninterrupted or error-free service. Always review AI-generated email drafts
          before sending - use is at your own discretion.
        </p>
      </LegalSection>

      <LegalSection title="11. Governing law">
        <p style={{ margin: 0 }}>
          These Terms are governed by the laws of India. Disputes shall be subject to the exclusive
          jurisdiction of courts in Bengaluru, Karnataka, India.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes to terms">
        <p style={{ margin: 0 }}>
          We may update these Terms with reasonable notice. Material changes will be communicated
          via email or in-app notification. Continued use after changes constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection title="13. Contact">
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
