import { createClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

import { env } from "@/lib/env";

let cachedAdminClient: any | null = null;

function getSupabaseUrl() {
  return env.SUPABASE_URL;
}

function getSupabaseAnonKey() {
  return env.SUPABASE_ANON_KEY;
}

function getSupabaseServiceRoleKey() {
  return env.SUPABASE_SERVICE_ROLE_KEY;
}

export function isClawCloudSupabaseConfigured() {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey() && getSupabaseServiceRoleKey());
}

export function getClawCloudSupabaseAdmin(): any {
  const supabaseUrl = getSupabaseUrl();
  const serviceRoleKey = getSupabaseServiceRoleKey();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "ClawCloud backend requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  if (cachedAdminClient) {
    return cachedAdminClient;
  }

  cachedAdminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return cachedAdminClient;
}

export function getClawCloudBearerToken(request: NextRequest) {
  const header = request.headers.get("authorization")?.trim() ?? "";

  if (!header.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return header.slice(7).trim() || null;
}

export async function getClawCloudUserFromRequest(request: NextRequest) {
  const token = getClawCloudBearerToken(request);
  if (!token) {
    return null;
  }

  const supabaseAdmin = getClawCloudSupabaseAdmin();
  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return null;
  }

  return {
    accessToken: token,
    user,
  };
}

export async function requireClawCloudAuth(request: NextRequest) {
  const auth = await getClawCloudUserFromRequest(request);
  if (!auth) {
    return {
      ok: false as const,
      error: "Unauthorized",
      status: 401,
    };
  }

  return {
    ok: true as const,
    accessToken: auth.accessToken,
    user: auth.user,
  };
}

export function isValidSharedSecret(request: NextRequest, ...secrets: Array<string | undefined>) {
  const token = getClawCloudBearerToken(request);
  if (!token) {
    return false;
  }

  return secrets.filter(Boolean).some((secret) => secret === token);
}

export function getUserDisplayName(user: User) {
  const meta = user.user_metadata;
  if (typeof meta?.full_name === "string" && meta.full_name.trim()) {
    return meta.full_name.trim();
  }

  if (typeof meta?.name === "string" && meta.name.trim()) {
    return meta.name.trim();
  }

  if (typeof user.email === "string" && user.email.includes("@")) {
    return user.email.split("@")[0] ?? "";
  }

  return "";
}

export function getClawCloudErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error";
}
