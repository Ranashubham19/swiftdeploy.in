import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

import { env } from "@/lib/env";

function getRequestOrigin(request: NextRequest) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  if (request.nextUrl.origin && request.nextUrl.origin !== "null") {
    return request.nextUrl.origin;
  }

  return env.NEXT_PUBLIC_APP_URL || env.NEXTJS_URL || "http://localhost:3000";
}

function buildErrorRedirect(origin: string, message: string) {
  const url = new URL("/auth", `${origin}/`);
  url.searchParams.set("error", message);
  return url;
}

export async function GET(request: NextRequest) {
  const origin = getRequestOrigin(request);

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    return NextResponse.redirect(
      buildErrorRedirect(origin, "Supabase auth is not configured yet."),
    );
  }

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });

  const redirectTo = new URL("/auth", `${origin}/`).toString();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    return NextResponse.redirect(
      buildErrorRedirect(origin, error?.message || "Unable to start Google sign-in."),
    );
  }

  return NextResponse.redirect(data.url, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
