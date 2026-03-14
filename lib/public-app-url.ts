import type { PublicAppConfig } from "@/lib/types";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

function normalizeOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";

  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
}

function isLocalOrigin(origin: string) {
  if (!origin) return false;

  try {
    return LOCAL_HOSTS.has(new URL(origin).hostname);
  } catch {
    return false;
  }
}

export function getPreferredAppOrigin(config: Pick<PublicAppConfig, "appUrl">) {
  const configuredOrigin = normalizeOrigin(config.appUrl);

  if (typeof window === "undefined") {
    return configuredOrigin;
  }

  const browserOrigin = window.location.origin;

  if (configuredOrigin && !isLocalOrigin(configuredOrigin)) {
    return configuredOrigin;
  }

  if (!isLocalOrigin(browserOrigin)) {
    return browserOrigin;
  }

  return configuredOrigin || browserOrigin;
}

export function getPublicRedirectUrl(
  config: Pick<PublicAppConfig, "appUrl">,
  path: string,
) {
  const origin = getPreferredAppOrigin(config);
  if (!origin) {
    return path;
  }

  return new URL(path, `${origin}/`).toString();
}
