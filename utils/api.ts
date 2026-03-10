const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");
const PRODUCTION_PROXY_BASE = "/api";

const isLocalhost = (hostname: string): boolean => {
  return hostname === "localhost" || hostname === "127.0.0.1";
};

export const getApiBaseUrl = (): string => {
  const fromEnv = (import.meta.env.VITE_API_URL || "").trim();
  if (fromEnv) {
    return trimTrailingSlash(fromEnv);
  }

  if (typeof window === "undefined") {
    return "http://localhost:4000";
  }

  const { hostname } = window.location;

  if (isLocalhost(hostname)) {
    return `http://${hostname}:4000`;
  }

  // In production, route API calls through same-origin proxy (/api/*).
  return PRODUCTION_PROXY_BASE;
};

export const apiUrl = (path: string): string => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = trimTrailingSlash(getApiBaseUrl());

  // Vercel serverless route is a literal catch-all file: /api/[...path].
  // Encode requested API path as repeated `path` query params for reliable proxying.
  if (baseUrl === PRODUCTION_PROXY_BASE) {
    const [pathnamePart, queryPart = ""] = normalizedPath.split("?");
    const segments = pathnamePart
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);

    const query = new URLSearchParams(queryPart);
    segments.forEach((segment) => query.append("path", segment));

    const queryString = query.toString();
    return `${PRODUCTION_PROXY_BASE}/[...path]${queryString ? `?${queryString}` : ""}`;
  }

  return `${baseUrl}${normalizedPath}`;
};
