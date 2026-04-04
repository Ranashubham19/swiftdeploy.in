export function buildClawCloudSupabaseAuthStorageKey(supabaseUrl: string) {
  try {
    const hostname = new URL(supabaseUrl).hostname;
    const projectRef = hostname.split(".")[0]?.trim();
    return projectRef ? `sb-${projectRef}-auth-token` : "supabase.auth.token";
  } catch {
    return "supabase.auth.token";
  }
}

export function looksLikeHtmlDocument(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return (
    normalized.startsWith("<!doctype")
    || normalized.startsWith("<html")
    || normalized.startsWith("<head")
    || normalized.startsWith("<body")
  );
}

export function normalizeClawCloudEmailAuthErrorMessage(message: string) {
  const normalized = String(message ?? "").trim();

  if (
    /unexpected token\s*</i.test(normalized)
    || /is not valid json/i.test(normalized)
    || /unexpected html page/i.test(normalized)
    || /\b522\b/i.test(normalized)
    || /timed out/i.test(normalized)
    || looksLikeHtmlDocument(normalized)
  ) {
    return "Email auth is temporarily unavailable because the upstream auth service is not returning a valid response right now. Please try again shortly.";
  }

  if (/failed to fetch/i.test(normalized)) {
    return "Could not reach the auth service. Please try again in a moment.";
  }

  if (
    /already registered/i.test(normalized)
    || /already been registered/i.test(normalized)
  ) {
    return "An account with this email already exists. Please sign in instead.";
  }

  if (/invalid login credentials/i.test(normalized)) {
    return "Incorrect email or password. Please try again.";
  }

  return normalized;
}
