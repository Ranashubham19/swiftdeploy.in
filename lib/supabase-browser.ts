import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { buildClawCloudSupabaseAuthStorageKey } from "@/lib/clawcloud-email-auth";

type SupabaseBrowserConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

const PKCE_COOKIE_MAX_AGE_SECONDS = 15 * 60;

let cachedClient: SupabaseClient | null = null;
let cachedKey = "";

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function generatePkceVerifier() {
  const verifierLength = 56;

  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") {
    const charSet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let verifier = "";
    for (let index = 0; index < verifierLength; index += 1) {
      verifier += charSet.charAt(Math.floor(Math.random() * charSet.length));
    }
    return verifier;
  }

  const array = new Uint32Array(verifierLength);
  crypto.getRandomValues(array);
  return Array.from(array, (value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });

  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function generatePkceChallenge(verifier: string) {
  const hasWebCrypto =
    typeof crypto !== "undefined"
    && typeof crypto.subtle !== "undefined"
    && typeof TextEncoder !== "undefined";

  if (!hasWebCrypto) {
    return verifier;
  }

  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToBase64Url(new Uint8Array(hash));
}

function isPkceVerifierKey(key: string) {
  return key.toLowerCase().includes("code-verifier");
}

function encodeCookieKey(key: string) {
  if (!isBrowser()) {
    return "";
  }

  return `clawcloud-pkce-${window.btoa(key).replace(/=+$/g, "")}`;
}

function readCookie(name: string) {
  if (!isBrowser()) {
    return null;
  }

  const encodedPrefix = `${encodeURIComponent(name)}=`;
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(encodedPrefix));

  if (!match) {
    return null;
  }

  const rawValue = match.slice(encodedPrefix.length);
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

function writeCookie(name: string, value: string) {
  if (!isBrowser()) {
    return;
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = [
    `${encodeURIComponent(name)}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${PKCE_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    secure,
  ].join("; ");
}

function deleteCookie(name: string) {
  if (!isBrowser()) {
    return;
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = [
    `${encodeURIComponent(name)}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    secure,
  ].join("; ");
}

const pkceBackedStorage = {
  getItem(key: string) {
    if (!isBrowser()) {
      return null;
    }

    try {
      const localValue = window.localStorage.getItem(key);
      if (localValue) {
        return localValue;
      }
    } catch {
      // Fall back to cookie storage below.
    }

    if (!isPkceVerifierKey(key)) {
      return null;
    }

    return readCookie(encodeCookieKey(key));
  },

  setItem(key: string, value: string) {
    if (!isBrowser()) {
      return;
    }

    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Cookie mirror below still preserves PKCE flow.
    }

    if (isPkceVerifierKey(key)) {
      writeCookie(encodeCookieKey(key), value);
    }
  },

  removeItem(key: string) {
    if (!isBrowser()) {
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage cleanup issues.
    }

    if (isPkceVerifierKey(key)) {
      deleteCookie(encodeCookieKey(key));
    }
  },
};

export function getSupabaseBrowserAuthStorageKey(supabaseUrl: string) {
  return buildClawCloudSupabaseAuthStorageKey(supabaseUrl);
}

export async function prepareSupabaseBrowserPkce(
  config: Pick<SupabaseBrowserConfig, "supabaseUrl">,
  options?: {
    isPasswordRecovery?: boolean;
  },
) {
  if (!isBrowser()) {
    throw new Error("PKCE preparation requires a browser environment.");
  }

  const storageKey = getSupabaseBrowserAuthStorageKey(config.supabaseUrl);
  const codeVerifier = generatePkceVerifier();
  const storedCodeVerifier = options?.isPasswordRecovery
    ? `${codeVerifier}/PASSWORD_RECOVERY`
    : codeVerifier;

  pkceBackedStorage.setItem(`${storageKey}-code-verifier`, storedCodeVerifier);

  const codeChallenge = await generatePkceChallenge(codeVerifier);
  return {
    storageKey,
    codeChallenge,
    codeChallengeMethod: codeChallenge === codeVerifier ? "plain" : "s256",
  } as const;
}

export function getSupabaseBrowserClient(config: SupabaseBrowserConfig) {
  const { supabaseUrl, supabaseAnonKey } = config;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  const nextKey = `${supabaseUrl}::${supabaseAnonKey}`;
  if (cachedClient && cachedKey === nextKey) {
    return cachedClient;
  }

  cachedKey = nextKey;
  cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      storage: pkceBackedStorage,
    },
  });

  return cachedClient;
}
