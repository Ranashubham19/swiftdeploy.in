"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { getPostAuthRedirectPath } from "@/lib/onboarding";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { buildSupabaseHeaders } from "@/lib/supabase-headers";
import type { PublicAppConfig } from "@/lib/types";

import styles from "./auth-page.module.css";

type AuthPanel = "login" | "signup" | "forgot" | "reset";

type AuthPageProps = {
  config: PublicAppConfig;
};

type LoginForm = {
  email: string;
  password: string;
};

type SignupForm = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
};

type ForgotForm = {
  email: string;
};

type ResetForm = {
  password: string;
  confirmPassword: string;
};

type FieldErrors = Partial<Record<string, string>>;
type SupabaseAuthSettings = {
  external?: {
    google?: boolean;
  };
};

type AuthExchangeResult = {
  errorMessage: string | null;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const authCodeExchangeCache = new Map<string, Promise<AuthExchangeResult>>();

function normalizeAuthErrorMessage(message: string) {
  if (message === "Failed to fetch") {
    return "Could not reach Supabase to finish Google sign-in. Retry once, and if it still fails make sure your browser can reach your Supabase project and that localhost:3000 is allowed in Supabase Authentication URL configuration.";
  }

  return message;
}

function exchangeAuthCodeOnce(
  authClient: NonNullable<ReturnType<typeof getSupabaseBrowserClient>>,
  authCode: string,
) {
  const cachedExchange = authCodeExchangeCache.get(authCode);
  if (cachedExchange) {
    return cachedExchange;
  }

  const exchangePromise = authClient.auth
    .exchangeCodeForSession(authCode)
    .then(({ error }) => ({
      errorMessage: error ? normalizeAuthErrorMessage(error.message) : null,
    }))
    .catch((error) => ({
      errorMessage: normalizeAuthErrorMessage(
        error instanceof Error ? error.message : "Unable to complete Google sign-in.",
      ),
    }));

  authCodeExchangeCache.set(authCode, exchangePromise);
  return exchangePromise;
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77a6.61 6.61 0 0 1-3.71 1.06c-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11.01 11.01 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09A6.77 6.77 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11.1 11.1 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11.01 11.01 0 0 0 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
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
    color: score ? palette[score - 1] : "rgba(255,255,255,0.12)",
    label: score ? labels[score - 1] : "",
  };
}

export function AuthPage({ config }: AuthPageProps) {
  const router = useRouter();
  const supabase = useMemo(
    () =>
      getSupabaseBrowserClient({
        supabaseUrl: config.supabaseUrl,
        supabaseAnonKey: config.supabaseAnonKey,
      }),
    [config.supabaseAnonKey, config.supabaseUrl],
  );
  const recoveryFlowRef = useRef(false);

  const [panel, setPanel] = useState<AuthPanel>("login");
  const [globalError, setGlobalError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [loadingAction, setLoadingAction] = useState<
    "google-login" | "google-signup" | "login" | "signup" | "forgot" | "reset" | null
  >(null);
  const [login, setLogin] = useState<LoginForm>({ email: "", password: "" });
  const [signup, setSignup] = useState<SignupForm>({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [forgot, setForgot] = useState<ForgotForm>({ email: "" });
  const [reset, setReset] = useState<ResetForm>({ password: "", confirmPassword: "" });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showPasswords, setShowPasswords] = useState({
    login: false,
    signup: false,
    signupConfirm: false,
    reset: false,
    resetConfirm: false,
  });

  const passwordStrength = scorePassword(signup.password);
  const isConfigured = Boolean(supabase);

  function clearFeedback() {
    setGlobalError("");
    setSuccessMessage("");
  }

  function activatePanel(nextPanel: AuthPanel) {
    clearFeedback();
    setFieldErrors({});
    setPanel(nextPanel);
  }

  function setFieldError(name: string, message: string) {
    setFieldErrors((current) => ({ ...current, [name]: message }));
  }

  function clearFieldError(name: string) {
    setFieldErrors((current) => {
      if (!(name in current)) {
        return current;
      }

      const next = { ...current };
      delete next[name];
      return next;
    });
  }

  function getRedirectUrl(path: string) {
    if (typeof window === "undefined") {
      return path;
    }

    return `${window.location.origin}${path}`;
  }

  async function resolvePostAuthRedirectPath(userId?: string) {
    if (!supabase || !userId) {
      return getPostAuthRedirectPath();
    }

    try {
      const { data, error } = await supabase
        .from("users")
        .select("onboarding_done")
        .eq("id", userId)
        .maybeSingle();

      if (!error && data?.onboarding_done === true) {
        return "/dashboard";
      }

      if (!error && data?.onboarding_done === false) {
        return "/setup";
      }
    } catch {
      // Fall back to local onboarding state below.
    }

    return getPostAuthRedirectPath();
  }

  useEffect(() => {
    if (!isConfigured || !supabase) {
      setGlobalError(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env to enable Google and email sign-in.",
      );
      return;
    }

    const authClient = supabase;
    let cancelled = false;

    async function initializeAuthState() {
      const params = new URLSearchParams(window.location.search);
      const authCode = params.get("code");
      const authType = params.get("type");
      const mode = params.get("mode");
      const providerError = params.get("error_description") ?? params.get("error") ?? "";

      if (providerError) {
        setGlobalError(providerError);
      }

      if (mode === "reset" || authType === "recovery") {
        recoveryFlowRef.current = true;
        setPanel("reset");
      }

      if (authCode) {
        const isRecoveryFlow = authType === "recovery" || mode === "reset";
        window.history.replaceState({}, "", isRecoveryFlow ? "/auth?mode=reset" : "/auth");
        setLoadingAction("google-login");
        const { errorMessage } = await exchangeAuthCodeOnce(authClient, authCode);

        if (cancelled) {
          return;
        }

        setLoadingAction(null);

        if (errorMessage) {
          authCodeExchangeCache.delete(authCode);
          setGlobalError(errorMessage);
        } else if (isRecoveryFlow) {
          recoveryFlowRef.current = true;
          setPanel("reset");
          setSuccessMessage("Choose a new password for your account.");
          return;
        } else {
          const { data: userData } = await authClient.auth.getUser();
          router.replace(await resolvePostAuthRedirectPath(userData.user?.id));
          return;
        }
      }

      const { data, error } = await authClient.auth.getSession();
      if (cancelled) {
        return;
      }

      if (!error && data.session && !recoveryFlowRef.current) {
        router.replace(await resolvePostAuthRedirectPath(data.session.user.id));
      }
    }

    initializeAuthState().catch((error) => {
      if (!cancelled) {
        setGlobalError(error instanceof Error ? error.message : "Unable to initialize auth.");
      }
    });

    const {
      data: { subscription },
    } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        recoveryFlowRef.current = true;
        setLoadingAction(null);
        setPanel("reset");
        setSuccessMessage("Choose a new password for your account.");
        return;
      }

      if (event === "SIGNED_IN" && session && !recoveryFlowRef.current) {
        void resolvePostAuthRedirectPath(session.user.id).then((path) => {
          router.replace(path);
        });
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [isConfigured, router, supabase]);

  async function handleGoogle(mode: "login" | "signup") {
    clearFeedback();

    if (!supabase) {
      setGlobalError(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env first.",
      );
      return;
    }

    const loadingKey = mode === "login" ? "google-login" : "google-signup";
    setLoadingAction(loadingKey);

    try {
      const settingsResponse = await fetch(`${config.supabaseUrl}/auth/v1/settings`, {
        headers: buildSupabaseHeaders(config.supabaseAnonKey),
      });

      if (settingsResponse.ok) {
        const settings = (await settingsResponse.json()) as SupabaseAuthSettings;

        if (!settings.external?.google) {
          setLoadingAction(null);
          setGlobalError(
            "Google sign-in is not enabled in Supabase yet. In Supabase dashboard open Authentication > Sign In / Providers > Google, enable Google, paste the Google client ID and client secret there, and add your login email under Google OAuth consent screen > Test users if the app is still in testing.",
          );
          return;
        }
      }
    } catch {
      // If the settings check fails, fall back to Supabase's normal OAuth flow.
    }

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getRedirectUrl("/auth"),
      },
    });

    if (error) {
      setLoadingAction(null);
      setGlobalError(error.message);
    }
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setFieldErrors({});

    let valid = true;
    if (!emailPattern.test(login.email.trim())) {
      setFieldError("login.email", "Please enter a valid email address.");
      valid = false;
    }
    if (!login.password) {
      setFieldError("login.password", "Password is required.");
      valid = false;
    }
    if (!valid) {
      return;
    }

    if (!supabase) {
      setGlobalError(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env first.",
      );
      return;
    }

    setLoadingAction("login");
    const { error } = await supabase.auth.signInWithPassword({
      email: login.email.trim(),
      password: login.password,
    });
    setLoadingAction(null);

    if (error) {
      setGlobalError(error.message);
      return;
    }

    setSuccessMessage("Signed in. Redirecting...");
    const { data } = await supabase.auth.getUser();
    router.replace(await resolvePostAuthRedirectPath(data.user?.id));
  }

  async function handleSignup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setFieldErrors({});

    let valid = true;

    if (!signup.firstName.trim()) {
      setFieldError("signup.firstName", "First name is required.");
      valid = false;
    }
    if (!emailPattern.test(signup.email.trim())) {
      setFieldError("signup.email", "Please enter a valid email address.");
      valid = false;
    }
    if (signup.password.length < 8) {
      setFieldError("signup.password", "Password must be at least 8 characters.");
      valid = false;
    }
    if (signup.password !== signup.confirmPassword) {
      setFieldError("signup.confirmPassword", "Passwords do not match.");
      valid = false;
    }

    if (!valid) {
      return;
    }

    if (!supabase) {
      setGlobalError(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env first.",
      );
      return;
    }

    setLoadingAction("signup");
    const { data, error } = await supabase.auth.signUp({
      email: signup.email.trim(),
      password: signup.password,
      options: {
        data: {
          first_name: signup.firstName.trim(),
          last_name: signup.lastName.trim(),
        },
        emailRedirectTo: getRedirectUrl("/auth"),
      },
    });
    setLoadingAction(null);

    if (error) {
      setGlobalError(error.message);
      return;
    }

    if (data.session) {
      setSuccessMessage("Account created. Redirecting...");
      router.replace(await resolvePostAuthRedirectPath(data.session.user.id));
      return;
    }

    setSuccessMessage("Check your email to confirm your account, then come back to sign in.");
  }

  async function handleForgot(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setFieldErrors({});

    if (!emailPattern.test(forgot.email.trim())) {
      setFieldError("forgot.email", "Please enter a valid email address.");
      return;
    }

    if (!supabase) {
      setGlobalError(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env first.",
      );
      return;
    }

    setLoadingAction("forgot");
    const { error } = await supabase.auth.resetPasswordForEmail(forgot.email.trim(), {
      redirectTo: getRedirectUrl("/reset-password"),
    });
    setLoadingAction(null);

    if (error) {
      setGlobalError(error.message);
      return;
    }

    setSuccessMessage("Reset link sent. Check your inbox to continue.");
  }

  async function handleReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearFeedback();
    setFieldErrors({});

    let valid = true;
    if (reset.password.length < 8) {
      setFieldError("reset.password", "Password must be at least 8 characters.");
      valid = false;
    }
    if (reset.password !== reset.confirmPassword) {
      setFieldError("reset.confirmPassword", "Passwords do not match.");
      valid = false;
    }

    if (!valid) {
      return;
    }

    if (!supabase) {
      setGlobalError(
        "Supabase auth is not configured yet. Add SUPABASE_URL and SUPABASE_ANON_KEY to .env first.",
      );
      return;
    }

    setLoadingAction("reset");
    const { error } = await supabase.auth.updateUser({
      password: reset.password,
    });
    setLoadingAction(null);

    if (error) {
      setGlobalError(error.message);
      return;
    }

    recoveryFlowRef.current = false;
    setSuccessMessage("Password updated. Redirecting...");
    const { data } = await supabase.auth.getUser();
    router.replace(await resolvePostAuthRedirectPath(data.user?.id));
  }

  return (
    <main className={styles.page}>
      <section className={styles.rightPanel}>
        <div className={styles.authBox}>
          <Link href="/" className={styles.mobileLogo}>
            <span className={styles.logoMark}>CC</span>
            Claw<span className={styles.brandAccent}>Cloud</span>
          </Link>

          <div className={styles.authTabs}>
            <button
              type="button"
              className={`${styles.tabButton} ${
                panel === "login" ? styles.tabButtonActive : ""
              }`}
              onClick={() => activatePanel("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`${styles.tabButton} ${
                panel === "signup" ? styles.tabButtonActive : ""
              }`}
              onClick={() => activatePanel("signup")}
            >
              Create account
            </button>
          </div>

          {isConfigured ? null : (
            <div className={styles.configNote}>
              Supabase auth is not configured in this project yet. Add SUPABASE_URL and
              SUPABASE_ANON_KEY to .env to activate Google and email auth.
            </div>
          )}

          {globalError ? <div className={styles.errorBanner}>{globalError}</div> : null}
          {successMessage ? <div className={styles.successBox}>{successMessage}</div> : null}

          {panel === "login" ? (
            <>
              <h1 className={styles.title}>Welcome back 👋</h1>
              <p className={styles.subtitle}>Sign in to your ClawCloud account.</p>

              <button
                type="button"
                className={styles.googleButton}
                onClick={() => handleGoogle("login")}
                disabled={loadingAction !== null}
              >
                {loadingAction === "google-login" ? <span className={styles.spinner} /> : <GoogleIcon />}
                Continue with Google
              </button>

              <div className={styles.divider}>or sign in with email</div>

              <form className={styles.form} onSubmit={handleLogin}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="login-email">
                    Email address
                  </label>
                  <input
                    id="login-email"
                    className={`${styles.input} ${fieldErrors["login.email"] ? styles.inputError : ""}`}
                    type="email"
                    value={login.email}
                    autoComplete="email"
                    placeholder="you@example.com"
                    onChange={(event) => {
                      setLogin((current) => ({ ...current, email: event.target.value }));
                      clearFieldError("login.email");
                    }}
                  />
                  {fieldErrors["login.email"] ? (
                    <div className={styles.fieldError}>{fieldErrors["login.email"]}</div>
                  ) : null}
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="login-password">
                    Password
                  </label>
                  <div className={styles.pwWrap}>
                    <input
                      id="login-password"
                      className={`${styles.input} ${fieldErrors["login.password"] ? styles.inputError : ""}`}
                      type={showPasswords.login ? "text" : "password"}
                      value={login.password}
                      autoComplete="current-password"
                      placeholder="Enter your password"
                      onChange={(event) => {
                        setLogin((current) => ({ ...current, password: event.target.value }));
                        clearFieldError("login.password");
                      }}
                    />
                    <button
                      type="button"
                      className={styles.pwToggle}
                      onClick={() =>
                        setShowPasswords((current) => ({ ...current, login: !current.login }))
                      }
                    >
                      {showPasswords.login ? "Hide" : "Show"}
                    </button>
                  </div>
                  {fieldErrors["login.password"] ? (
                    <div className={styles.fieldError}>{fieldErrors["login.password"]}</div>
                  ) : null}
                </div>

                <div className={styles.forgotRow}>
                  <button
                    type="button"
                    className={styles.secondaryLinkButton}
                    onClick={() => activatePanel("forgot")}
                  >
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={loadingAction !== null}
                >
                  {loadingAction === "login" ? <span className={styles.spinner} /> : null}
                  {loadingAction === "login" ? "Signing in..." : "Sign in ->"}
                </button>
              </form>

              <p className={styles.terms}>
                Don&apos;t have an account?{" "}
                <button
                  type="button"
                  className={styles.inlineLink}
                  onClick={() => activatePanel("signup")}
                >
                  Create one free
                </button>
              </p>
            </>
          ) : null}

          {panel === "signup" ? (
            <>
              <h1 className={styles.title}>Start for free ✨</h1>
              <p className={styles.subtitle}>
                Create your ClawCloud account. No credit card required.
              </p>

              <button
                type="button"
                className={styles.googleButton}
                onClick={() => handleGoogle("signup")}
                disabled={loadingAction !== null}
              >
                {loadingAction === "google-signup" ? (
                  <span className={styles.spinner} />
                ) : (
                  <GoogleIcon />
                )}
                Sign up with Google
              </button>

              <div className={styles.divider}>or sign up with email</div>

              <form className={styles.form} onSubmit={handleSignup}>
                <div className={styles.nameRow}>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="signup-first-name">
                      First name
                    </label>
                    <input
                      id="signup-first-name"
                      className={`${styles.input} ${fieldErrors["signup.firstName"] ? styles.inputError : ""}`}
                      type="text"
                      autoComplete="given-name"
                      placeholder="Rahul"
                      value={signup.firstName}
                      onChange={(event) => {
                        setSignup((current) => ({ ...current, firstName: event.target.value }));
                        clearFieldError("signup.firstName");
                      }}
                    />
                    {fieldErrors["signup.firstName"] ? (
                      <div className={styles.fieldError}>{fieldErrors["signup.firstName"]}</div>
                    ) : null}
                  </div>

                  <div className={styles.field}>
                    <label className={styles.label} htmlFor="signup-last-name">
                      Last name
                    </label>
                    <input
                      id="signup-last-name"
                      className={styles.input}
                      type="text"
                      autoComplete="family-name"
                      placeholder="Kumar"
                      value={signup.lastName}
                      onChange={(event) =>
                        setSignup((current) => ({ ...current, lastName: event.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="signup-email">
                    Email address
                  </label>
                  <input
                    id="signup-email"
                    className={`${styles.input} ${fieldErrors["signup.email"] ? styles.inputError : ""}`}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={signup.email}
                    onChange={(event) => {
                      setSignup((current) => ({ ...current, email: event.target.value }));
                      clearFieldError("signup.email");
                    }}
                  />
                  {fieldErrors["signup.email"] ? (
                    <div className={styles.fieldError}>{fieldErrors["signup.email"]}</div>
                  ) : null}
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="signup-password">
                    Password
                  </label>
                  <div className={styles.pwWrap}>
                    <input
                      id="signup-password"
                      className={`${styles.input} ${fieldErrors["signup.password"] ? styles.inputError : ""}`}
                      type={showPasswords.signup ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Minimum 8 characters"
                      value={signup.password}
                      onChange={(event) => {
                        setSignup((current) => ({ ...current, password: event.target.value }));
                        clearFieldError("signup.password");
                      }}
                    />
                    <button
                      type="button"
                      className={styles.pwToggle}
                      onClick={() =>
                        setShowPasswords((current) => ({ ...current, signup: !current.signup }))
                      }
                    >
                      {showPasswords.signup ? "Hide" : "Show"}
                    </button>
                  </div>
                  <div className={styles.strengthBar}>
                    {Array.from({ length: 4 }).map((_, index) => (
                      <span
                        key={index}
                        className={styles.strengthSegment}
                        style={{
                          background:
                            index < passwordStrength.score
                              ? passwordStrength.color
                              : "rgba(255,255,255,0.12)",
                        }}
                      />
                    ))}
                  </div>
                  <div className={styles.strengthLabel}>{passwordStrength.label}</div>
                  {fieldErrors["signup.password"] ? (
                    <div className={styles.fieldError}>{fieldErrors["signup.password"]}</div>
                  ) : null}
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="signup-confirm">
                    Confirm password
                  </label>
                  <div className={styles.pwWrap}>
                    <input
                      id="signup-confirm"
                      className={`${styles.input} ${fieldErrors["signup.confirmPassword"] ? styles.inputError : ""}`}
                      type={showPasswords.signupConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repeat your password"
                      value={signup.confirmPassword}
                      onChange={(event) => {
                        setSignup((current) => ({
                          ...current,
                          confirmPassword: event.target.value,
                        }));
                        clearFieldError("signup.confirmPassword");
                      }}
                    />
                    <button
                      type="button"
                      className={styles.pwToggle}
                      onClick={() =>
                        setShowPasswords((current) => ({
                          ...current,
                          signupConfirm: !current.signupConfirm,
                        }))
                      }
                    >
                      {showPasswords.signupConfirm ? "Hide" : "Show"}
                    </button>
                  </div>
                  {fieldErrors["signup.confirmPassword"] ? (
                    <div className={styles.fieldError}>
                      {fieldErrors["signup.confirmPassword"]}
                    </div>
                  ) : null}
                </div>

                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={loadingAction !== null}
                >
                  {loadingAction === "signup" ? <span className={styles.spinner} /> : null}
                  {loadingAction === "signup" ? "Creating account..." : "Create free account ->"}
                </button>
              </form>

              <p className={styles.terms}>
                By signing up you agree to our{" "}
                <Link href="/" className={styles.inlineLink}>
                  Terms
                </Link>{" "}
                and{" "}
                <Link href="/" className={styles.inlineLink}>
                  Privacy Policy
                </Link>
                .
              </p>
            </>
          ) : null}

          {panel === "forgot" ? (
            <>
              <h1 className={styles.title}>Reset password 🔑</h1>
              <p className={styles.subtitle}>We&apos;ll send a password reset link to your email.</p>

              <form className={styles.form} onSubmit={handleForgot}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="forgot-email">
                    Email address
                  </label>
                  <input
                    id="forgot-email"
                    className={`${styles.input} ${fieldErrors["forgot.email"] ? styles.inputError : ""}`}
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={forgot.email}
                    onChange={(event) => {
                      setForgot({ email: event.target.value });
                      clearFieldError("forgot.email");
                    }}
                  />
                  {fieldErrors["forgot.email"] ? (
                    <div className={styles.fieldError}>{fieldErrors["forgot.email"]}</div>
                  ) : null}
                </div>

                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={loadingAction !== null}
                >
                  {loadingAction === "forgot" ? <span className={styles.spinner} /> : null}
                  {loadingAction === "forgot" ? "Sending reset link..." : "Send reset link ->"}
                </button>
              </form>

              <p className={styles.terms}>
                <button
                  type="button"
                  className={styles.inlineLink}
                  onClick={() => activatePanel("login")}
                >
                  &lt;- Back to sign in
                </button>
              </p>
            </>
          ) : null}

          {panel === "reset" ? (
            <>
              <h1 className={styles.title}>Choose a new password</h1>
              <p className={styles.subtitle}>Set a fresh password for your ClawCloud account.</p>

              <form className={styles.form} onSubmit={handleReset}>
                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reset-password">
                    New password
                  </label>
                  <div className={styles.pwWrap}>
                    <input
                      id="reset-password"
                      className={`${styles.input} ${fieldErrors["reset.password"] ? styles.inputError : ""}`}
                      type={showPasswords.reset ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Minimum 8 characters"
                      value={reset.password}
                      onChange={(event) => {
                        setReset((current) => ({ ...current, password: event.target.value }));
                        clearFieldError("reset.password");
                      }}
                    />
                    <button
                      type="button"
                      className={styles.pwToggle}
                      onClick={() =>
                        setShowPasswords((current) => ({ ...current, reset: !current.reset }))
                      }
                    >
                      {showPasswords.reset ? "Hide" : "Show"}
                    </button>
                  </div>
                  {fieldErrors["reset.password"] ? (
                    <div className={styles.fieldError}>{fieldErrors["reset.password"]}</div>
                  ) : null}
                </div>

                <div className={styles.field}>
                  <label className={styles.label} htmlFor="reset-confirm-password">
                    Confirm new password
                  </label>
                  <div className={styles.pwWrap}>
                    <input
                      id="reset-confirm-password"
                      className={`${styles.input} ${fieldErrors["reset.confirmPassword"] ? styles.inputError : ""}`}
                      type={showPasswords.resetConfirm ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder="Repeat your new password"
                      value={reset.confirmPassword}
                      onChange={(event) => {
                        setReset((current) => ({
                          ...current,
                          confirmPassword: event.target.value,
                        }));
                        clearFieldError("reset.confirmPassword");
                      }}
                    />
                    <button
                      type="button"
                      className={styles.pwToggle}
                      onClick={() =>
                        setShowPasswords((current) => ({
                          ...current,
                          resetConfirm: !current.resetConfirm,
                        }))
                      }
                    >
                      {showPasswords.resetConfirm ? "Hide" : "Show"}
                    </button>
                  </div>
                  {fieldErrors["reset.confirmPassword"] ? (
                    <div className={styles.fieldError}>
                      {fieldErrors["reset.confirmPassword"]}
                    </div>
                  ) : null}
                </div>

                <button
                  type="submit"
                  className={styles.submitButton}
                  disabled={loadingAction !== null}
                >
                  {loadingAction === "reset" ? <span className={styles.spinner} /> : null}
                  {loadingAction === "reset" ? "Updating password..." : "Update password ->"}
                </button>
              </form>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}
