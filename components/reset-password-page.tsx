"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./reset-password-page.module.css";

type ResetPasswordPageProps = {
  config: PublicAppConfig;
};

type RecoveryStatus = "checking" | "ready" | "invalid" | "success";

function normalizeAuthErrorMessage(message: string) {
  if (message === "Failed to fetch") {
    return "Could not reach Supabase to verify the recovery link. Check your auth URL settings and try again.";
  }

  return message;
}

function scorePassword(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const palette = ["#ff4d4d", "#ff9f43", "#ffd166", "#00e676"];
  const labels = ["Weak", "Fair", "Good", "Strong"];

  return {
    score,
    color: score ? palette[score - 1] : "rgba(255,255,255,0.1)",
    label: score ? labels[score - 1] : "",
  };
}

export function ResetPasswordPage({ config }: ResetPasswordPageProps) {
  const router = useRouter();
  const redirectTimerRef = useRef<number | null>(null);
  const supabase = useMemo(
    () =>
      getSupabaseBrowserClient({
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
      }),
    [config.supabaseAnonKey, config.supabaseUrl],
  );

  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [configMessage, setConfigMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const strength = scorePassword(password);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!supabase) {
      setConfigMessage(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to activate password recovery.",
      );
      setStatus("ready");
      return;
    }

    const authClient = supabase;
    let cancelled = false;

    async function initializeRecovery() {
      const params = new URLSearchParams(window.location.search);
      const authCode = params.get("code");
      const authType = params.get("type");
      const mode = params.get("mode");
      const tokenHash = params.get("token_hash");

      let recoveryReady = false;

      if (authCode) {
        const { error } = await authClient.auth.exchangeCodeForSession(authCode);

        if (error) {
          if (!cancelled) {
            setErrorMessage(normalizeAuthErrorMessage(error.message));
          }
        } else {
          recoveryReady = true;
          window.history.replaceState({}, "", "/reset-password");
        }
      } else if (tokenHash && (authType === "recovery" || mode === "reset")) {
        const { error } = await authClient.auth.verifyOtp({
          type: "recovery",
          token_hash: tokenHash,
        });

        if (error) {
          if (!cancelled) {
            setErrorMessage(normalizeAuthErrorMessage(error.message));
          }
        } else {
          recoveryReady = true;
          window.history.replaceState({}, "", "/reset-password");
        }
      } else {
        const { data, error } = await authClient.auth.getSession();

        if (!error && data.session) {
          recoveryReady = true;
        }
      }

      if (!cancelled) {
        setStatus(recoveryReady ? "ready" : "invalid");
      }
    }

    initializeRecovery().catch((error) => {
      if (!cancelled) {
        setErrorMessage(
          normalizeAuthErrorMessage(
            error instanceof Error ? error.message : "Unable to verify your recovery link.",
          ),
        );
        setStatus("invalid");
      }
    });

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((event, session) => {
      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session) {
        setErrorMessage("");
        setStatus("ready");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    if (!supabase) {
      setErrorMessage(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY first.",
      );
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (error) {
      setErrorMessage(normalizeAuthErrorMessage(error.message));
      return;
    }

    setStatus("success");
    redirectTimerRef.current = window.setTimeout(() => {
      router.replace("/dashboard");
    }, 1800);
  }

  return (
    <main className={styles.page}>
      <div className={`${styles.orb} ${styles.orb1}`} />
      <div className={`${styles.orb} ${styles.orb2}`} />

      <section className={styles.box}>
        <Link href="/" className={styles.logo}>
          <span className={styles.logoIcon}>AI</span>
          Claw<span className={styles.brandAccent}>Cloud</span>
        </Link>

        {status === "checking" ? (
          <div className={styles.loadingBox}>
            <div className={styles.bigSpinner} />
            <div className={styles.loadingText}>Verifying your reset link...</div>
          </div>
        ) : null}

        {status === "ready" ? (
          <>
            <h1 className={styles.title}>Set new password</h1>
            <p className={styles.subtitle}>Choose a strong password for your ClawCloud account.</p>

            {configMessage ? <div className={styles.noticeBanner}>{configMessage}</div> : null}
            {errorMessage ? <div className={styles.errorBanner}>{errorMessage}</div> : null}

            <form className={styles.form} onSubmit={handleSubmit}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="reset-password">
                  New password
                </label>
                <div className={styles.passwordWrap}>
                  <input
                    id="reset-password"
                    className={styles.formInput}
                    type={showPassword ? "text" : "password"}
                    placeholder="Min. 8 characters"
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <div className={styles.strengthRow}>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <span
                      key={index}
                      className={styles.strengthSegment}
                      style={{
                        background:
                          index < strength.score ? strength.color : "rgba(255,255,255,0.08)",
                      }}
                    />
                  ))}
                </div>
                <div className={styles.strengthLabel} style={{ color: strength.score ? strength.color : undefined }}>
                  {strength.label}
                </div>
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel} htmlFor="reset-confirm-password">
                  Confirm password
                </label>
                <div className={styles.passwordWrap}>
                  <input
                    id="reset-confirm-password"
                    className={styles.formInput}
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowConfirmPassword((current) => !current)}
                  >
                    {showConfirmPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </div>

              <button className={styles.submitButton} type="submit" disabled={submitting}>
                {submitting ? <span className={styles.spinner} /> : null}
                {submitting ? "Updating password..." : "Update password →"}
              </button>
            </form>
          </>
        ) : null}

        {status === "invalid" ? (
          <div className={styles.invalidBox}>
            <div className={styles.invalidIcon}>⌛</div>
            <h1 className={styles.title}>Link expired</h1>
            <p className={styles.subtitle}>
              This password reset link has expired or already been used. Request a fresh one to continue.
            </p>
            {errorMessage ? <div className={styles.errorBanner}>{errorMessage}</div> : null}
            <Link href="/auth" className={styles.primaryLink}>
              Request new link →
            </Link>
          </div>
        ) : null}

        {status === "success" ? (
          <div className={styles.successBox}>
            <div className={styles.successIcon}>✓</div>
            <h1 className={styles.title}>Password updated</h1>
            <p className={styles.subtitle}>You&apos;ll be redirected to your dashboard in a moment.</p>
          </div>
        ) : null}

        <Link href="/auth" className={styles.backLink}>
          ← Back to sign in
        </Link>
      </section>
    </main>
  );
}
