import { NextRequest, NextResponse } from "next/server";

import {
  looksLikeHtmlDocument,
  normalizeClawCloudEmailAuthErrorMessage,
} from "@/lib/clawcloud-email-auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type EmailAuthIntent = "login" | "signup" | "forgot";

type EmailAuthRequestBody = {
  intent?: string;
  email?: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  redirectTo?: string;
  codeChallenge?: string;
  codeChallengeMethod?: "plain" | "s256";
};

type SupabaseAuthPayload = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  user?: {
    id?: string;
    email?: string;
  } | null;
  error?: string;
  error_description?: string;
  msg?: string;
  code?: string;
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function withNoStoreHeaders(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return withNoStoreHeaders(NextResponse.json(body, { status }));
}

function normalizeEmail(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return emailPattern.test(normalized) ? normalized : "";
}

function sanitizeRedirectTo(request: NextRequest, redirectTo: unknown, fallbackPath: string) {
  const baseOrigin = (() => {
    try {
      return new URL(env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).origin;
    } catch {
      return request.nextUrl.origin;
    }
  })();

  try {
    const url = new URL(String(redirectTo ?? "").trim() || fallbackPath, `${baseOrigin}/`);
    if (url.origin !== baseOrigin) {
      return new URL(fallbackPath, `${baseOrigin}/`).toString();
    }
    return url.toString();
  } catch {
    return new URL(fallbackPath, `${baseOrigin}/`).toString();
  }
}

function buildSupabaseAuthUrl(path: string, redirectTo?: string) {
  const normalizedPath = path.replace(/^\/+/, "");
  const [pathname, queryString = ""] = normalizedPath.split("?");
  const url = new URL(`/auth/v1/${pathname}`, env.SUPABASE_URL);
  if (queryString) {
    const params = new URLSearchParams(queryString);
    params.forEach((value, key) => {
      url.searchParams.set(key, value);
    });
  }
  if (redirectTo) {
    url.searchParams.set("redirect_to", redirectTo);
  }
  return url.toString();
}

function getSupabaseAuthHeaders() {
  return {
    "Content-Type": "application/json;charset=UTF-8",
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
  };
}

async function readSupabaseAuthPayload(response: Response) {
  const raw = await response.text();
  if (!raw.trim()) {
    return {} as SupabaseAuthPayload;
  }

  try {
    return JSON.parse(raw) as SupabaseAuthPayload;
  } catch {
    if (looksLikeHtmlDocument(raw)) {
      throw new Error("The upstream auth service returned an unexpected HTML page.");
    }
    throw new Error("The upstream auth service returned a non-JSON response.");
  }
}

function extractSupabaseSession(payload: SupabaseAuthPayload) {
  if (!payload.access_token || !payload.refresh_token) {
    return null;
  }

  const expiresIn = Number(payload.expires_in ?? 0);
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    token_type: payload.token_type ?? "bearer",
    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : undefined,
    expires_at:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Math.round(Date.now() / 1000) + expiresIn
        : undefined,
    user: payload.user ?? null,
  };
}

function getSupabaseErrorMessage(payload: SupabaseAuthPayload, fallback: string) {
  return normalizeClawCloudEmailAuthErrorMessage(
    payload.error_description || payload.msg || payload.error || fallback,
  );
}

async function handleSignup(request: NextRequest, body: EmailAuthRequestBody) {
  const email = normalizeEmail(body.email);
  if (!email) {
    return jsonResponse({ error: "Please enter a valid email address." }, 400);
  }

  const password = String(body.password ?? "");
  if (password.length < 8) {
    return jsonResponse({ error: "Password must be at least 8 characters." }, 400);
  }

  const redirectTo = sanitizeRedirectTo(request, body.redirectTo, "/auth");
  const payload = {
    email,
    password,
    data: {
      first_name: String(body.firstName ?? "").trim(),
      last_name: String(body.lastName ?? "").trim(),
    },
    code_challenge: typeof body.codeChallenge === "string" ? body.codeChallenge.trim() : undefined,
    code_challenge_method:
      body.codeChallengeMethod === "plain" || body.codeChallengeMethod === "s256"
        ? body.codeChallengeMethod
        : undefined,
  };

  const response = await fetch(buildSupabaseAuthUrl("signup", redirectTo), {
    method: "POST",
    headers: getSupabaseAuthHeaders(),
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const json = await readSupabaseAuthPayload(response);
  if (!response.ok) {
    return jsonResponse(
      { error: getSupabaseErrorMessage(json, "Unable to create your account right now.") },
      response.status,
    );
  }

  const session = extractSupabaseSession(json);
  return jsonResponse({
    user: json.user ?? null,
    session,
    needsEmailConfirmation: !session,
  });
}

async function handleLogin(body: EmailAuthRequestBody) {
  const email = normalizeEmail(body.email);
  if (!email) {
    return jsonResponse({ error: "Please enter a valid email address." }, 400);
  }

  const password = String(body.password ?? "");
  if (!password) {
    return jsonResponse({ error: "Password is required." }, 400);
  }

  const response = await fetch(buildSupabaseAuthUrl("token?grant_type=password"), {
    method: "POST",
    headers: getSupabaseAuthHeaders(),
    body: JSON.stringify({
      email,
      password,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const json = await readSupabaseAuthPayload(response);
    return jsonResponse(
      { error: getSupabaseErrorMessage(json, "Unable to sign in right now.") },
      response.status,
    );
  }

  const json = await readSupabaseAuthPayload(response);
  const session = extractSupabaseSession(json);
  if (!session) {
    return jsonResponse({ error: "Auth login completed without a usable session." }, 502);
  }

  return jsonResponse({
    user: json.user ?? null,
    session,
  });
}

async function handleForgot(request: NextRequest, body: EmailAuthRequestBody) {
  const email = normalizeEmail(body.email);
  if (!email) {
    return jsonResponse({ error: "Please enter a valid email address." }, 400);
  }

  const redirectTo = sanitizeRedirectTo(request, body.redirectTo, "/reset-password");
  const response = await fetch(buildSupabaseAuthUrl("recover", redirectTo), {
    method: "POST",
    headers: getSupabaseAuthHeaders(),
    body: JSON.stringify({
      email,
      code_challenge: typeof body.codeChallenge === "string" ? body.codeChallenge.trim() : undefined,
      code_challenge_method:
        body.codeChallengeMethod === "plain" || body.codeChallengeMethod === "s256"
          ? body.codeChallengeMethod
          : undefined,
    }),
    cache: "no-store",
  });

  const json = await readSupabaseAuthPayload(response);
  if (!response.ok) {
    return jsonResponse(
      { error: getSupabaseErrorMessage(json, "Unable to send the reset email right now.") },
      response.status,
    );
  }

  return jsonResponse({ ok: true });
}

export async function POST(request: NextRequest) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return jsonResponse({ error: "Supabase auth is not configured on the server." }, 503);
  }

  let body = {} as EmailAuthRequestBody;
  try {
    body = (await request.json()) as EmailAuthRequestBody;
  } catch {
    return jsonResponse({ error: "Invalid auth request body." }, 400);
  }

  const intent = String(body.intent ?? "").trim().toLowerCase() as EmailAuthIntent;

  try {
    if (intent === "signup") {
      return await handleSignup(request, body);
    }

    if (intent === "login") {
      return await handleLogin(body);
    }

    if (intent === "forgot") {
      return await handleForgot(request, body);
    }

    return jsonResponse({ error: "Unsupported auth intent." }, 400);
  } catch (error) {
    return jsonResponse(
      {
        error: normalizeClawCloudEmailAuthErrorMessage(
          error instanceof Error ? error.message : "Unexpected email auth failure.",
        ),
      },
      502,
    );
  }
}
