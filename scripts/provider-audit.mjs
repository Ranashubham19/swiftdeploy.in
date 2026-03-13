import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();

loadEnvFile(path.join(cwd, ".env"));
loadEnvFile(path.join(cwd, ".env.local"));

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function pickDefined(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

function sanitize(value, keyName = "") {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, innerValue]) => [key, sanitize(innerValue, key)]),
    );
  }

  if (
    typeof value === "string" &&
    /(?:api_?key|password|secret|token|authorization)/i.test(keyName)
  ) {
    if (value.length <= 8) {
      return "***redacted***";
    }
    return `${value.slice(0, 4)}***${value.slice(-4)}`;
  }

  return value;
}

function asNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function firstNumber(obj, candidates) {
  for (const key of candidates) {
    const value = asNumber(obj?.[key]);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

async function requestJson(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    let json;

    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      json,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function success(name, details = {}) {
  return {
    name,
    authStatus: "working",
    ...details,
  };
}

function failure(name, details = {}) {
  return {
    name,
    authStatus: "failing",
    ...details,
  };
}

function blocked(name, details = {}) {
  return {
    name,
    authStatus: "blocked",
    ...details,
  };
}

function missing(name, envNames) {
  return blocked(name, {
    reason: `Missing required config: ${envNames.join(", ")}`,
    quotaStatus: "unknown",
  });
}

function isAuthFailure(response) {
  const text = `${response?.text ?? ""} ${JSON.stringify(response?.json ?? {})}`.toLowerCase();
  return (
    response?.status === 401 ||
    response?.status === 403 ||
    text.includes("invalid api key") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("invalid token") ||
    text.includes("authentication failed")
  );
}

async function checkTavily() {
  const key = process.env.TAVILY_API_KEY;
  if (!key) {
    return missing("Tavily", ["TAVILY_API_KEY"]);
  }

  const response = await requestJson("https://api.tavily.com/usage", {
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    return isAuthFailure(response)
      ? failure("Tavily", {
          reason: `HTTP ${response.status}`,
          quotaStatus: "unknown",
        })
      : blocked("Tavily", {
          reason: response.error ?? `HTTP ${response.status}`,
          quotaStatus: "unknown",
        });
  }

  return success("Tavily", {
    quotaStatus: "available",
    usage: response.json,
  });
}

async function checkFirecrawl() {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) {
    return missing("Firecrawl", ["FIRECRAWL_API_KEY"]);
  }

  const response = await requestJson("https://api.firecrawl.dev/v2/team/credit-usage", {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    return isAuthFailure(response)
      ? failure("Firecrawl", {
          reason: `HTTP ${response.status}`,
          quotaStatus: "unknown",
        })
      : blocked("Firecrawl", {
          reason: response.error ?? `HTTP ${response.status}`,
          quotaStatus: "unknown",
        });
  }

  const payload = response.json?.data ?? response.json ?? {};
  const limit = firstNumber(payload, [
    "remainingCredits",
    "remaining_credits",
    "remaining",
    "creditsRemaining",
  ]);

  return success("Firecrawl", {
    quotaStatus: "available",
    usage: payload,
    derivedQuota: pickDefined({
      remaining: limit,
    }),
  });
}

async function checkSerpApi() {
  const key = process.env.SERPAPI_API_KEY;
  if (!key) {
    return missing("SerpAPI", ["SERPAPI_API_KEY"]);
  }

  const endpoint = new URL("https://serpapi.com/account.json");
  endpoint.searchParams.set("api_key", key);

  const response = await requestJson(endpoint);
  if (!response.ok) {
    return isAuthFailure(response)
      ? failure("SerpAPI", {
          reason: `HTTP ${response.status}`,
          quotaStatus: "unknown",
        })
      : blocked("SerpAPI", {
          reason: response.error ?? `HTTP ${response.status}`,
          quotaStatus: "unknown",
        });
  }

  const payload = response.json ?? {};
  const remaining = firstNumber(payload, [
    "plan_searches_left",
    "searches_left",
    "searchesLeft",
  ]);
  const total = firstNumber(payload, [
    "total_searches_left",
    "total_searches",
    "plan_searches",
  ]);

  return success("SerpAPI", {
    quotaStatus: "available",
    usage: payload,
    derivedQuota: pickDefined({
      total,
      remaining,
    }),
  });
}

async function checkScraperApi() {
  const key = process.env.SCRAPERAPI_KEY;
  if (!key) {
    return missing("ScraperAPI", ["SCRAPERAPI_KEY"]);
  }

  const endpoint = new URL("https://api.scraperapi.com/account");
  endpoint.searchParams.set("api_key", key);

  const response = await requestJson(endpoint);
  if (!response.ok) {
    return isAuthFailure(response)
      ? failure("ScraperAPI", {
          reason: `HTTP ${response.status}`,
          quotaStatus: "unknown",
        })
      : blocked("ScraperAPI", {
          reason: response.error ?? `HTTP ${response.status}`,
          quotaStatus: "unknown",
        });
  }

  const payload = response.json ?? {};
  const remaining = firstNumber(payload, [
    "remaining_requests",
    "remainingRequests",
    "requestsLeft",
    "requests_left",
  ]);
  const limit = firstNumber(payload, [
    "request_limit",
    "requestLimit",
    "max_requests",
    "maxRequests",
  ]);
  const used = firstNumber(payload, [
    "request_count",
    "requestCount",
    "used_requests",
    "usedRequests",
  ]);

  return success("ScraperAPI", {
    quotaStatus: "available",
    usage: payload,
    derivedQuota: pickDefined({
      limit,
      used,
      remaining: remaining ?? (limit !== undefined && used !== undefined ? limit - used : undefined),
    }),
  });
}

async function checkSupabase() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const table = process.env.SUPABASE_PERSISTENCE_TABLE || "research_runs";
  if (!url || !anonKey) {
    return missing("Supabase", ["SUPABASE_URL", "SUPABASE_ANON_KEY"]);
  }

  const endpoint = new URL(`/rest/v1/${table}`, url);
  endpoint.searchParams.set("select", "*");
  endpoint.searchParams.set("limit", "1");

  const response = await requestJson(endpoint, {
    headers: buildSupabaseHeaders(anonKey),
  });

  if (response.ok || response.status === 404 || response.status === 406) {
    return success("Supabase", {
      quotaStatus: "not_exposed",
      detail: `REST API reachable with status ${response.status}`,
    });
  }

  if (isAuthFailure(response)) {
    return failure("Supabase", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Supabase", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

function buildSupabaseHeaders(apiKey) {
  const headers = new Headers();
  headers.set("apikey", apiKey);

  if (apiKey.split(".").length === 3) {
    headers.set("Authorization", `Bearer ${apiKey}`);
  }

  return Object.fromEntries(headers.entries());
}

async function checkFirebase() {
  const key = process.env.FIREBASE_API_KEY;
  if (!key) {
    return missing("Firebase", ["FIREBASE_API_KEY"]);
  }

  const response = await requestJson(
    `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(key)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier: "audit@example.com",
        continueUri: "https://example.com",
      }),
    },
  );

  if (response.ok) {
    return success("Firebase", {
      quotaStatus: "not_exposed",
      detail: "Identity Toolkit accepted the API key",
    });
  }

  const errorMessage = String(
    response.json?.error?.message ??
      response.json?.error?.status ??
      response.text ??
      response.error ??
      "",
  ).toLowerCase();

  if (errorMessage.includes("api key")) {
    return failure("Firebase", {
      reason: `HTTP ${response.status}: ${response.json?.error?.message ?? "API key rejected"}`,
      quotaStatus: "not_exposed",
    });
  }

  if (response.status && response.status < 500) {
    return success("Firebase", {
      quotaStatus: "not_exposed",
      detail: `API key accepted; endpoint returned ${response.status} for request payload`,
    });
  }

  return blocked("Firebase", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkPinecone() {
  const key = process.env.PINECONE_API_KEY;
  if (!key) {
    return missing("Pinecone", ["PINECONE_API_KEY"]);
  }

  const response = await requestJson("https://api.pinecone.io/indexes", {
    headers: {
      "Api-Key": key,
      "X-Pinecone-API-Version": "2025-04",
    },
  });

  if (response.ok) {
    return success("Pinecone", {
      quotaStatus: "not_exposed",
      detail: `Control plane reachable; indexes listed`,
      usage: Array.isArray(response.json) ? { indexCount: response.json.length } : response.json,
    });
  }

  if (isAuthFailure(response)) {
    return failure("Pinecone", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Pinecone", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkWeaviate() {
  const host = process.env.WEAVIATE_HOST;
  const key = process.env.WEAVIATE_API_KEY;
  if (!host || !key) {
    return missing("Weaviate", ["WEAVIATE_HOST", "WEAVIATE_API_KEY"]);
  }

  const response = await requestJson(`https://${host}/v1/meta`, {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  if (response.ok) {
    return success("Weaviate", {
      quotaStatus: "not_exposed",
      usage: pickDefined({
        version: response.json?.version,
        hostname: response.json?.hostname,
      }),
    });
  }

  if (isAuthFailure(response)) {
    return failure("Weaviate", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Weaviate", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkApify() {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    return missing("Apify", ["APIFY_API_TOKEN"]);
  }

  const [me, limits] = await Promise.all([
    requestJson("https://api.apify.com/v2/users/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
    requestJson("https://api.apify.com/v2/users/me/limits", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }),
  ]);

  if (!me.ok && isAuthFailure(me)) {
    return failure("Apify", {
      reason: `HTTP ${me.status}`,
      quotaStatus: "unknown",
    });
  }

  if (!me.ok) {
    return blocked("Apify", {
      reason: me.error ?? `HTTP ${me.status}`,
      quotaStatus: "unknown",
    });
  }

  const usage = limits.ok ? limits.json?.data ?? limits.json ?? {} : {};
  const current = usage.current ?? {};
  const configuredLimits = usage.limits ?? {};
  const monthlyUsed = firstNumber(current, [
    "monthlyUsageUsd",
    "monthly_usage_usd",
    "currentMonthlyUsageUsd",
  ]);
  const monthlyLimit = firstNumber(configuredLimits, [
    "maxMonthlyUsageUsd",
    "max_monthly_usage_usd",
    "monthlyUsageLimitUsd",
  ]);

  return success("Apify", {
    quotaStatus: limits.ok ? "available" : "not_exposed",
    usage: {
      user: me.json?.data ?? me.json,
      limits: limits.ok ? usage : undefined,
    },
    derivedQuota: pickDefined({
      monthlyUsdLimit: monthlyLimit,
      monthlyUsdUsed: monthlyUsed,
      monthlyUsdRemaining:
        monthlyLimit !== undefined && monthlyUsed !== undefined
          ? monthlyLimit - monthlyUsed
          : undefined,
    }),
  });
}

async function checkBrightData() {
  const key = process.env.BRIGHTDATA_API_KEY;
  if (!key) {
    return missing("Bright Data", ["BRIGHTDATA_API_KEY"]);
  }

  const response = await requestJson("https://api.brightdata.com/status", {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  if (response.ok) {
    return success("Bright Data", {
      quotaStatus: "not_exposed",
      usage: response.json,
    });
  }

  if (isAuthFailure(response)) {
    return failure("Bright Data", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Bright Data", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkQdrant() {
  const url = process.env.QDRANT_URL;
  const key = process.env.QDRANT_API_KEY;
  if (!url || !key) {
    return missing("Qdrant", ["QDRANT_URL", "QDRANT_API_KEY"]);
  }

  const response = await requestJson(`${url.replace(/\/$/, "")}/collections`, {
    headers: {
      "api-key": key,
    },
  });

  if (response.ok) {
    return success("Qdrant", {
      quotaStatus: "not_exposed",
      usage: pickDefined({
        collectionCount: Array.isArray(response.json?.result?.collections)
          ? response.json.result.collections.length
          : undefined,
      }),
    });
  }

  if (isAuthFailure(response)) {
    return failure("Qdrant", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Qdrant", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkZilliz() {
  const key = process.env.ZILLIZ_API_KEY;
  if (!key) {
    return missing("Zilliz", ["ZILLIZ_API_KEY"]);
  }

  const response = await requestJson("https://api.cloud.zilliz.com/v2/projects", {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  if (response.ok) {
    return success("Zilliz", {
      quotaStatus: "not_exposed",
      usage: pickDefined({
        projectCount: Array.isArray(response.json?.data) ? response.json.data.length : undefined,
      }),
    });
  }

  if (isAuthFailure(response)) {
    return failure("Zilliz", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Zilliz", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkCohere() {
  const key = process.env.COHERE_API_KEY;
  if (!key) {
    return missing("Cohere", ["COHERE_API_KEY"]);
  }

  const response = await requestJson("https://api.cohere.com/v1/check-api-key", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (response.ok) {
    return success("Cohere", {
      quotaStatus: "not_exposed",
      usage: response.json,
    });
  }

  if (isAuthFailure(response)) {
    return failure("Cohere", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Cohere", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkJina() {
  const key = process.env.JINA_API_KEY;
  if (!key) {
    return missing("Jina AI", ["JINA_API_KEY"]);
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  let response = await requestJson("https://api.jina.ai/v1/models", {
    headers,
  });

  if (!response.ok && response.status === 404) {
    response = await requestJson("https://api.jina.ai/v1/embeddings", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: "jina-embeddings-v3",
        input: ["hello"],
      }),
    });
  }

  if (response.ok) {
    return success("Jina AI", {
      quotaStatus: "not_exposed",
      usage: Array.isArray(response.json?.data)
        ? { itemCount: response.json.data.length }
        : response.json,
    });
  }

  if (isAuthFailure(response)) {
    return failure("Jina AI", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Jina AI", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkVoyage() {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) {
    return missing("Voyage", ["VOYAGE_API_KEY"]);
  }

  const headers = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  const body = JSON.stringify({
    model: "voyage-3.5-lite",
    input: ["hello"],
  });

  let response = await requestJson("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers,
    body,
  });

  if (!response.ok && response.status === 404) {
    response = await requestJson("https://api.voyageai.com/v1/embed", {
      method: "POST",
      headers,
      body,
    });
  }

  if (response.ok) {
    return success("Voyage", {
      quotaStatus: "not_exposed",
      usage: pickDefined({
        totalTokens: response.json?.usage?.total_tokens,
      }),
    });
  }

  if (isAuthFailure(response)) {
    return failure("Voyage", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("Voyage", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

async function checkLangSmith() {
  const key = process.env.LANGSMITH_API_KEY;
  if (!key) {
    return missing("LangSmith", ["LANGSMITH_API_KEY"]);
  }

  const response = await requestJson("https://api.smith.langchain.com/api/v1/sessions?limit=1", {
    headers: {
      "x-api-key": key,
    },
  });

  if (response.ok || response.status === 404) {
    return success("LangSmith", {
      quotaStatus: "not_exposed",
      detail: `API responded with status ${response.status}`,
    });
  }

  if (isAuthFailure(response)) {
    return failure("LangSmith", {
      reason: `HTTP ${response.status}`,
      quotaStatus: "not_exposed",
    });
  }

  return blocked("LangSmith", {
    reason: response.error ?? `HTTP ${response.status}`,
    quotaStatus: "not_exposed",
  });
}

const checks = [
  checkTavily,
  checkFirecrawl,
  checkSerpApi,
  checkScraperApi,
  checkSupabase,
  checkFirebase,
  checkPinecone,
  checkWeaviate,
  checkApify,
  checkBrightData,
  checkQdrant,
  checkZilliz,
  checkCohere,
  checkJina,
  checkVoyage,
  checkLangSmith,
];

const results = await Promise.all(checks.map((check) => check()));

const summary = {
  total: results.length,
  working: results.filter((item) => item.authStatus === "working").length,
  failing: results.filter((item) => item.authStatus === "failing").length,
  blocked: results.filter((item) => item.authStatus === "blocked").length,
  quotaAvailable: results.filter((item) => item.quotaStatus === "available").length,
  quotaNotExposed: results.filter((item) => item.quotaStatus === "not_exposed").length,
  quotaUnknown: results.filter((item) => item.quotaStatus === "unknown").length,
};

console.log(
  JSON.stringify(
    sanitize({ generatedAt: new Date().toISOString(), summary, results }),
    null,
    2,
  ),
);
