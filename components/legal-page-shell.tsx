"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type LegalPageShellProps = {
  title: string;
  lastUpdated: string;
  relatedHref: string;
  relatedLabel: string;
  children: ReactNode;
};

type LegalSectionProps = {
  title: string;
  children: ReactNode;
};

const colors = {
  bg: "#0a0a0f",
  panel: "rgba(10, 10, 15, 0.92)",
  border: "rgba(255,255,255,0.06)",
  text: "#eeeef5",
  textMuted: "#a0a0b8",
  textDim: "#606078",
  accent: "#ff4d4d",
};

export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2
        style={{
          margin: 0,
          fontSize: 17,
          fontWeight: 700,
          color: colors.text,
          fontFamily: "var(--font-display), sans-serif",
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h2>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
          color: colors.textMuted,
          lineHeight: 1.75,
          fontSize: 14,
        }}
      >
        {children}
      </div>
    </section>
  );
}

export function LegalPageShell({
  title,
  lastUpdated,
  relatedHref,
  relatedLabel,
  children,
}: LegalPageShellProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: colors.bg,
        color: colors.text,
        fontFamily: "var(--font-sans), system-ui, sans-serif",
      }}
    >
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          height: 58,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 clamp(16px, 4vw, 40px)",
          background: colors.panel,
          backdropFilter: "blur(20px)",
          borderBottom: `1px solid ${colors.border}`,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            color: colors.text,
            textDecoration: "none",
            fontFamily: "var(--font-display), sans-serif",
            fontSize: 18,
            fontWeight: 800,
          }}
        >
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: colors.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            AI
          </span>
          Claw<span style={{ color: colors.accent }}>Cloud</span>
        </Link>

        <Link
          href="/"
          style={{
            color: colors.textDim,
            fontSize: 13,
            textDecoration: "none",
          }}
        >
          Back to home
        </Link>
      </nav>

      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "clamp(32px, 6vw, 64px) clamp(16px, 4vw, 32px) 80px",
        }}
      >
        <div style={{ marginBottom: 48 }}>
          <p
            style={{
              margin: "0 0 12px",
              color: colors.accent,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Legal
          </p>
          <h1
            style={{
              margin: "0 0 10px",
              fontSize: "clamp(26px, 5vw, 38px)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              fontFamily: "var(--font-display), sans-serif",
              lineHeight: 1.2,
            }}
          >
            {title}
          </h1>
          <p style={{ margin: 0, color: colors.textDim, fontSize: 13 }}>
            Last updated: {lastUpdated}
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>{children}</div>

        <div
          style={{
            marginTop: 56,
            paddingTop: 28,
            borderTop: `1px solid ${colors.border}`,
            display: "flex",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <Link
            href={relatedHref}
            style={{
              color: colors.accent,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            {relatedLabel}
          </Link>
          <Link
            href="/"
            style={{
              color: colors.textDim,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            Back to ClawCloud
          </Link>
        </div>
      </main>
    </div>
  );
}
