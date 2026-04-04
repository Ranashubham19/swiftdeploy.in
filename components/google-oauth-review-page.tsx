import Link from "next/link";

import type { PublicAppConfig } from "@/lib/types";

type GoogleOauthReviewPageProps = {
  config: PublicAppConfig;
};

function statusTone(ok: boolean) {
  return {
    color: ok ? "#9ff7c4" : "#ffb1b1",
    border: ok ? "1px solid rgba(56, 216, 120, 0.35)" : "1px solid rgba(255, 86, 86, 0.35)",
    background: ok ? "rgba(20, 89, 52, 0.28)" : "rgba(112, 28, 28, 0.28)",
  };
}

function StatusChip({ label, ok }: { label: string; ok: boolean }) {
  const tone = statusTone(ok);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        borderRadius: 999,
        padding: "8px 12px",
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: "0.01em",
        ...tone,
      }}
    >
      <span>{ok ? "Live" : "Blocked"}</span>
      <span style={{ opacity: 0.78 }}>{label}</span>
    </span>
  );
}

export function GoogleOauthReviewPage({ config }: GoogleOauthReviewPageProps) {
  const appUrl = config.appUrl || "https://swift-deploy.in";
  const publicSignIn = config.googleRollout.publicSignInEnabled;
  const publicWorkspace = config.googleRollout.publicWorkspaceEnabled;
  const publicExtended = config.googleRollout.publicWorkspaceExtendedEnabled;
  const liteMode = config.googleRollout.setupLiteMode !== false;

  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top, rgba(0,159,170,0.16), transparent 34%), linear-gradient(180deg, #090b11 0%, #0d1018 100%)",
        color: "#f4f7fb",
        padding: "48px 20px 72px",
      }}
    >
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 24 }}>
        <section
          style={{
            borderRadius: 24,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(10,14,24,0.78)",
            backdropFilter: "blur(16px)",
            padding: 28,
            boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              borderRadius: 999,
              padding: "6px 12px",
              background: "rgba(0,159,170,0.14)",
              color: "#8be8ef",
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            ClawCloud OAuth Review
          </div>

          <h1 style={{ margin: "18px 0 12px", fontSize: "clamp(2rem, 5vw, 3.4rem)", lineHeight: 1.02 }}>
            Public Google OAuth test path for reviewers
          </h1>
          <p style={{ margin: 0, maxWidth: 760, color: "rgba(244,247,251,0.8)", fontSize: 17, lineHeight: 1.6 }}>
            This page is the public verification entry for ClawCloud&apos;s Google sign-in and Google Workspace
            consent flow. Reviewers can use the links below to start sign-in, complete Gmail and Calendar
            consent, verify the privacy documents, and inspect the live provider-health status.
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 22 }}>
            <StatusChip label="Google sign-in" ok={publicSignIn} />
            <StatusChip label="Gmail + Calendar consent" ok={publicWorkspace} />
            <StatusChip label="Drive + Sheets extended scopes" ok={publicExtended} />
            <StatusChip label="Lite-only mode" ok={!liteMode} />
          </div>
        </section>

        {!publicSignIn || !publicWorkspace || liteMode ? (
          <section
            style={{
              borderRadius: 20,
              border: "1px solid rgba(255,120,120,0.26)",
              background: "rgba(82, 24, 24, 0.42)",
              padding: 24,
            }}
          >
            <h2 style={{ margin: "0 0 10px", fontSize: 24 }}>Current blocker</h2>
            <p style={{ margin: "0 0 12px", color: "rgba(255,230,230,0.88)", lineHeight: 1.7 }}>
              Public reviewer access is still blocked if Google Workspace public connect is off, the temporary
              hold is on, or setup remains in Lite-only mode. For Google verification to pass, the live
              production deployment must expose the public Gmail and Calendar consent flow without a private
              allowlist.
            </p>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                borderRadius: 16,
                padding: 16,
                background: "rgba(7,10,18,0.72)",
                color: "#f9d7d7",
                overflowX: "auto",
              }}
            >
{`Required production flags
GOOGLE_WORKSPACE_PUBLIC_ENABLED=true
GOOGLE_WORKSPACE_EXTENDED_PUBLIC_ENABLED=false
GOOGLE_WORKSPACE_TEMPORARY_HOLD=false
GOOGLE_WORKSPACE_SETUP_LITE_ONLY=false`}
            </pre>
          </section>
        ) : null}

        <section
          style={{
            display: "grid",
            gap: 18,
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          }}
        >
          {[
            { href: "/auth", title: "1. Sign in", body: "Open the public auth page and use Continue with Google." },
            { href: "/setup", title: "2. Connect Gmail + Calendar", body: "After sign-in, open setup and start the Google Workspace consent flow." },
            { href: "/privacy", title: "3. Privacy policy", body: "Review the public privacy policy that matches the OAuth data-access description." },
            { href: "/terms", title: "4. Terms", body: "Review the public terms of service used in the verification submission." },
            {
              href: "/api/auth/google/provider-health",
              title: "5. Live provider health",
              body: "Check the live rollout and redirect status for Google sign-in and Workspace OAuth.",
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: "block",
                textDecoration: "none",
                color: "inherit",
                borderRadius: 20,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(11,15,24,0.72)",
                padding: 22,
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{item.title}</div>
              <div style={{ color: "rgba(244,247,251,0.78)", lineHeight: 1.65 }}>{item.body}</div>
            </Link>
          ))}
        </section>

        <section
          style={{
            borderRadius: 24,
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(10,14,24,0.78)",
            padding: 28,
          }}
        >
          <h2 style={{ margin: "0 0 14px", fontSize: 26 }}>Reviewer steps</h2>
          <ol style={{ margin: 0, paddingLeft: 22, display: "grid", gap: 10, lineHeight: 1.7, color: "rgba(244,247,251,0.84)" }}>
            <li>Open <strong>{appUrl}/auth</strong> and click <strong>Continue with Google</strong>.</li>
            <li>After the account is signed in, open <strong>{appUrl}/setup</strong>.</li>
            <li>Click the Google Workspace connection action to start Gmail and Calendar consent.</li>
            <li>Approve the requested Gmail and Calendar scopes on Google&apos;s consent screen.</li>
            <li>Return to ClawCloud and confirm Gmail and Calendar show as connected.</li>
            <li>Use the app to test inbox assistance, draft generation, calendar questions, and disconnect controls.</li>
          </ol>

          <div
            style={{
              marginTop: 18,
              borderRadius: 16,
              padding: 18,
              background: "rgba(0,159,170,0.12)",
              color: "rgba(230,251,253,0.9)",
              lineHeight: 1.7,
            }}
          >
            Public reviewer scope for this phase should be <strong>Gmail + Calendar only</strong>. This phase includes
            inbox reading, user-requested inbox actions, draft creation, explicit user-approved send, and
            calendar reading plus user-requested event management. Keep Drive and Sheets behind the extended
            rollout until Google approves those extra scopes.
          </div>
        </section>
      </div>
    </main>
  );
}
