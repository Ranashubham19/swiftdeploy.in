import { NextResponse } from "next/server";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { getClawCloudSupabaseAdmin, isClawCloudSupabaseConfigured } from "@/lib/clawcloud-supabase";

type RateLimitPolicy = {
  limit: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const rateLimitFallbackWarnings = new Set<string>();

function sweepRateLimitBuckets(now: number) {
  for (const [key, bucket] of rateLimitBuckets.entries()) {
    if (bucket.resetAt <= now) {
      rateLimitBuckets.delete(key);
    }
  }
}

function logRateLimitFallback(reason: string, error: unknown) {
  if (rateLimitFallbackWarnings.has(reason)) {
    return;
  }

  rateLimitFallbackWarnings.add(reason);
  const message = error instanceof Error ? error.message : String(error ?? "");
  console.warn(`[api-guards] Falling back to in-memory rate limiting for ${reason}: ${message}`);
}

export function takeClawCloudRateLimitLocal(
  scope: string,
  identifier: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): RateLimitResult {
  if (policy.limit <= 0 || policy.windowMs <= 0) {
    return {
      ok: true,
      limit: Math.max(policy.limit, 0),
      remaining: Math.max(policy.limit, 0),
      resetAt: now,
      retryAfterSeconds: 0,
    };
  }

  sweepRateLimitBuckets(now);

  const key = `${scope}:${identifier}`;
  const activeBucket = rateLimitBuckets.get(key);
  const bucket =
    !activeBucket || activeBucket.resetAt <= now
      ? {
          count: 0,
          resetAt: now + policy.windowMs,
        }
      : activeBucket;

  if (!activeBucket || activeBucket.resetAt <= now) {
    rateLimitBuckets.set(key, bucket);
  }

  if (bucket.count >= policy.limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.resetAt - now) / 1000),
    );
    return {
      ok: false,
      limit: policy.limit,
      remaining: 0,
      resetAt: bucket.resetAt,
      retryAfterSeconds,
    };
  }

  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);

  return {
    ok: true,
    limit: policy.limit,
    remaining: Math.max(policy.limit - bucket.count, 0),
    resetAt: bucket.resetAt,
    retryAfterSeconds: 0,
  };
}

type DistributedRateLimitRow = {
  ok?: boolean | null;
  limit?: number | null;
  remaining?: number | null;
  reset_at?: string | null;
  retry_after_seconds?: number | null;
};

function normalizeDistributedRateLimitRow(
  row: DistributedRateLimitRow | null | undefined,
  fallbackPolicy: RateLimitPolicy,
  now: number,
): RateLimitResult | null {
  if (!row) {
    return null;
  }

  const resetAt = Date.parse(String(row.reset_at ?? ""));
  if (!Number.isFinite(resetAt)) {
    return null;
  }

  return {
    ok: Boolean(row.ok),
    limit: Number.isFinite(Number(row.limit)) ? Number(row.limit) : fallbackPolicy.limit,
    remaining: Number.isFinite(Number(row.remaining)) ? Number(row.remaining) : 0,
    resetAt: resetAt || now,
    retryAfterSeconds: Number.isFinite(Number(row.retry_after_seconds))
      ? Number(row.retry_after_seconds)
      : Math.max(0, Math.ceil((resetAt - now) / 1000)),
  };
}

async function takeDistributedClawCloudRateLimit(
  scope: string,
  identifier: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): Promise<RateLimitResult | null> {
  if (!isClawCloudSupabaseConfigured()) {
    return null;
  }

  try {
    const supabaseAdmin = getClawCloudSupabaseAdmin();
    const { data, error } = await supabaseAdmin.rpc("take_clawcloud_rate_limit", {
      p_scope: scope,
      p_identifier: identifier,
      p_limit: policy.limit,
      p_window_seconds: Math.max(1, Math.ceil(policy.windowMs / 1000)),
      p_now: new Date(now).toISOString(),
    });

    if (error) {
      throw new Error(error.message);
    }

    const row = Array.isArray(data) ? data[0] : data;
    return normalizeDistributedRateLimitRow(row as DistributedRateLimitRow | null | undefined, policy, now);
  } catch (error) {
    logRateLimitFallback(`${scope}:${identifier}`, error);
    return null;
  }
}

export async function takeClawCloudRateLimit(
  scope: string,
  identifier: string,
  policy: RateLimitPolicy,
  now = Date.now(),
): Promise<RateLimitResult> {
  const distributed = await takeDistributedClawCloudRateLimit(scope, identifier, policy, now);
  return distributed ?? takeClawCloudRateLimitLocal(scope, identifier, policy, now);
}

export function withRateLimitHeaders<T extends Response>(
  response: T,
  result: RateLimitResult,
) {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set(
    "X-RateLimit-Reset",
    String(Math.ceil(result.resetAt / 1000)),
  );

  if (!result.ok) {
    response.headers.set("Retry-After", String(result.retryAfterSeconds));
  }

  return response;
}

export function buildRateLimitErrorResponse(
  result: RateLimitResult,
  message = "Too many requests. Please wait and try again.",
) {
  return withRateLimitHeaders(
    NextResponse.json({ error: message }, { status: 429 }),
    result,
  );
}

type PublicUrlParseOptions = {
  allowedHosts?: string[];
};

type PublicUrlResolveOptions = PublicUrlParseOptions & {
  dnsLookup?: (
    hostname: string,
    options: { all: true; verbatim: true }
  ) => Promise<Array<{ address: string; family: number }> | { address: string; family: number }>;
};

function normalizeHostname(hostname: string) {
  const trimmed = hostname.trim().toLowerCase().replace(/\.+$/g, "");
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseIpv4Token(token: string) {
  if (!token) {
    return null;
  }

  if (/^0x[0-9a-f]+$/i.test(token)) {
    return Number.parseInt(token.slice(2), 16);
  }

  if (/^0[0-7]+$/.test(token) && token !== "0") {
    return Number.parseInt(token, 8);
  }

  if (/^\d+$/.test(token)) {
    return Number.parseInt(token, 10);
  }

  return null;
}

function expandLooseIpv4(hostname: string): number[] | null {
  const normalized = normalizeHostname(hostname);
  if (!normalized || normalized.includes(":")) {
    return null;
  }

  const parts = normalized.split(".");
  if (!parts.length || parts.length > 4 || parts.some((part) => part.length === 0)) {
    return null;
  }

  const parsedParts = parts.map(parseIpv4Token);
  if (parsedParts.some((part) => part === null)) {
    return null;
  }

  const values = parsedParts as number[];
  const pushNumberAsOctets = (value: number, octetCount: number) => {
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** (octetCount * 8)) {
      return null;
    }

    const octets = new Array<number>(octetCount);
    let working = value;
    for (let index = octetCount - 1; index >= 0; index -= 1) {
      octets[index] = working % 256;
      working = Math.floor(working / 256);
    }
    return octets;
  };

  if (values.length === 1) {
    return pushNumberAsOctets(values[0], 4);
  }

  if (values.length === 2) {
    if (values[0] > 255) return null;
    const tail = pushNumberAsOctets(values[1], 3);
    return tail ? [values[0], ...tail] : null;
  }

  if (values.length === 3) {
    if (values[0] > 255 || values[1] > 255) return null;
    const tail = pushNumberAsOctets(values[2], 2);
    return tail ? [values[0], values[1], ...tail] : null;
  }

  if (values.some((value) => value > 255)) {
    return null;
  }

  return values;
}

function looksLikeNonPublicIpv4(hostname: string) {
  const parts = expandLooseIpv4(hostname);
  if (!parts) {
    return false;
  }

  if (parts[0] === 0 || parts[0] === 10 || parts[0] === 127) {
    return true;
  }

  if (parts[0] === 169 && parts[1] === 254) {
    return true;
  }

  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true;
  }

  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
    return true;
  }

  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) {
    return true;
  }

  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) {
    return true;
  }

  if (parts[0] === 192 && parts[1] === 168) {
    return true;
  }

  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) {
    return true;
  }

  if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) {
    return true;
  }

  if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) {
    return true;
  }

  if (parts[0] >= 224) {
    return true;
  }

  return false;
}

function looksLikeLoopbackOrLocalHost(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return (
    normalized === "localhost"
    || normalized === "0.0.0.0"
    || normalized === "::"
    || normalized === "::1"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".localdomain")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".home.arpa")
    || normalized.endsWith(".lan")
  );
}

function looksLikeNonPublicIpv6(hostname: string) {
  const normalized = normalizeHostname(hostname);
  if (isIP(normalized) !== 6) {
    return false;
  }

  if (normalized === "::" || normalized === "::1") {
    return true;
  }

  if (/^f[cd][0-9a-f]{2}:/i.test(normalized) || /^f[cd][0-9a-f]{0,2}$/i.test(normalized)) {
    return true;
  }

  if (/^fe[89ab][0-9a-f]:/i.test(normalized) || /^fe[89ab][0-9a-f]{0,1}$/i.test(normalized)) {
    return true;
  }

  if (/^ff/i.test(normalized) || /^2001:db8:/i.test(normalized)) {
    return true;
  }

  const mappedIpv4Match = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4Match && looksLikeNonPublicIpv4(mappedIpv4Match[1])) {
    return true;
  }

  return false;
}

function looksLikeNonPublicInternetAddress(address: string) {
  const normalized = normalizeHostname(address);
  return (
    !normalized
    || looksLikeLoopbackOrLocalHost(normalized)
    || looksLikeNonPublicIpv4(normalized)
    || looksLikeNonPublicIpv6(normalized)
    || isIP(normalized) === 0
  );
}

function looksLikeSingleLabelHost(hostname: string) {
  const normalized = normalizeHostname(hostname);
  return Boolean(normalized) && !normalized.includes(".") && isIP(normalized) === 0;
}

function hostnameMatchesAllowList(hostname: string, allowedHosts: string[]) {
  const normalizedHost = normalizeHostname(hostname);
  const normalizedAllowList = allowedHosts
    .map((host) => normalizeHostname(host))
    .filter(Boolean);

  if (!normalizedAllowList.length) {
    return true;
  }

  return normalizedAllowList.some((allowedHost) =>
    normalizedHost === allowedHost || normalizedHost.endsWith(`.${allowedHost}`)
  );
}

export function parsePublicHttpUrl(value: string, options: PublicUrlParseOptions = {}) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_048) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const hostname = normalizeHostname(parsed.hostname);

    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      || !hostname
      || Boolean(parsed.username || parsed.password)
      || looksLikeLoopbackOrLocalHost(hostname)
      || looksLikeSingleLabelHost(hostname)
      || looksLikeNonPublicIpv4(hostname)
      || looksLikeNonPublicIpv6(hostname)
      || !hostnameMatchesAllowList(hostname, options.allowedHosts ?? [])
    ) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function resolvePublicHttpUrl(
  value: string,
  options: PublicUrlResolveOptions = {},
) {
  const parsed = parsePublicHttpUrl(value, options);
  if (!parsed) {
    return null;
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isIP(hostname)) {
    return parsed;
  }

  try {
    const lookupResult = await (options.dnsLookup ?? dnsLookup)(hostname, {
      all: true,
      verbatim: true,
    });
    const records = Array.isArray(lookupResult) ? lookupResult : [lookupResult];
    if (!records.length) {
      return null;
    }

    if (records.some((record) => looksLikeNonPublicInternetAddress(record.address))) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
