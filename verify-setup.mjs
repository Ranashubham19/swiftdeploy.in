// ============================================================================
// CLAWCLOUD -- LOCAL SETUP VERIFIER
// Run with: npm run verify:setup
// Make sure .env.local is filled and `npm run dev` is running first.
// ============================================================================

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

const PASS = "[PASS]";
const FAIL = "[FAIL]";
const WARN = "[WARN]";
const INFO = "[INFO]";

const rootDir = process.cwd();
const envPath = resolve(rootDir, ".env.local");
const baseEnvPath = resolve(rootDir, ".env");

let failureCount = 0;
let warningCount = 0;

function section(title) {
  console.log(`\n${"-".repeat(72)}`);
  console.log(title);
  console.log("-".repeat(72));
}

function record(status, label, detail = "") {
  console.log(`${status} ${label}${detail ? ` -> ${detail}` : ""}`);

  if (status === FAIL) {
    failureCount += 1;
  } else if (status === WARN) {
    warningCount += 1;
  }
}

function stripOuterQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\"")) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function parseEnvFile(filePath) {
  const parsed = {};
  const content = readFileSync(filePath, "utf-8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    const value = stripOuterQuotes(line.slice(equalsIndex + 1).trim());
    parsed[key] = value;
  }

  return parsed;
}

function getErrorMessage(error) {
  if (error instanceof Error) {
    const cause =
      error.cause instanceof Error
        ? error.cause.message
        : typeof error.cause === "string"
          ? error.cause
          : "";
    return cause ? `${error.message} (${cause})` : error.message;
  }

  return String(error);
}

function isPlaceholder(value) {
  if (!value) {
    return true;
  }

  const normalized = value.trim().toLowerCase();

  return [
    "your-",
    "your_",
    "replace",
    "...your",
    "generate-a-",
    "example",
    "placeholder",
  ].some((token) => normalized.includes(token));
}

function firstConfigured(envVars, keys) {
  for (const key of keys) {
    const value = envVars[key];
    if (value && !isPlaceholder(value)) {
      return value;
    }
  }

  return "";
}

function hasConfigured(envVars, keys) {
  return Boolean(firstConfigured(envVars, keys));
}

async function fetchJson(url, init = {}, timeoutMs = 5000) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  let json = null;

  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  return {
    response,
    text,
    json,
  };
}

function formatHttpError(response, text) {
  return `HTTP ${response.status}${text ? ` - ${text.slice(0, 180)}` : ""}`;
}

function parseUrlSafe(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocalHostname(hostname) {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  );
}

section("1. Checking .env.local");

if (!existsSync(envPath)) {
  record(FAIL, ".env.local not found", "Create it in the project root beside package.json.");
  printSummary();
  process.exit(1);
}

record(PASS, ".env.local found", envPath);

const baseEnvVars = existsSync(baseEnvPath) ? parseEnvFile(baseEnvPath) : {};
const localEnvVars = parseEnvFile(envPath);
const envVars = { ...baseEnvVars, ...localEnvVars };

if (existsSync(baseEnvPath)) {
  record(INFO, ".env found", "Using it as fallback for values not present in .env.local.");
}

section("2. Checking required environment variables");

const requiredVariables = [
  {
    label: "SUPABASE_URL",
    keys: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
    hint: "Get this from Supabase -> Settings -> API.",
  },
  {
    label: "SUPABASE_ANON_KEY",
    keys: ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    hint: "Get this from Supabase -> Settings -> API.",
  },
  {
    label: "SUPABASE_SERVICE_ROLE_KEY",
    keys: ["SUPABASE_SERVICE_ROLE_KEY"],
    hint: "Get this from Supabase -> Settings -> API.",
  },
  {
    label: "NVIDIA_API_KEY",
    keys: ["NVIDIA_API_KEY"],
    hint: "Get this from build.nvidia.com.",
  },
  {
    label: "NEXT_PUBLIC_APP_URL",
    keys: ["NEXT_PUBLIC_APP_URL", "NEXTJS_URL"],
    hint: "Use http://localhost:3000 for local development.",
  },
  {
    label: "CRON_SECRET",
    keys: ["CRON_SECRET"],
    hint: "Generate a random 32-byte secret.",
  },
  {
    label: "AGENT_SECRET",
    keys: ["AGENT_SECRET"],
    hint: "Generate a different random 32-byte secret.",
  },
];

const optionalVariables = [
  {
    label: "Search provider",
    keys: ["TAVILY_API_KEY", "SERPAPI_API_KEY", "JINA_API_KEY"],
    hint: "Configure Tavily, SerpAPI, or Jina for web search results.",
  },
  {
    label: "GOOGLE_CLIENT_ID",
    keys: ["GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"],
    hint: "Needed for Gmail and Calendar integration.",
  },
  {
    label: "GOOGLE_CLIENT_SECRET",
    keys: ["GOOGLE_CLIENT_SECRET", "GOOGLE_OAUTH_CLIENT_SECRET"],
    hint: "Needed for Gmail and Calendar integration.",
  },
  {
    label: "GOOGLE_REDIRECT_URI",
    keys: ["GOOGLE_REDIRECT_URI"],
    hint: "Usually http://localhost:3000/api/auth/google/callback locally.",
  },
  {
    label: "AGENT_SERVER_URL",
    keys: ["AGENT_SERVER_URL"],
    hint: "Needed for WhatsApp and background automation.",
  },
  {
    label: "RAZORPAY_KEY_ID",
    keys: ["RAZORPAY_KEY_ID"],
    hint: "Needed for INR billing.",
  },
  {
    label: "STRIPE_SECRET_KEY",
    keys: ["STRIPE_SECRET_KEY"],
    hint: "Needed for USD billing.",
  },
  {
    label: "TELEGRAM_BOT_TOKEN",
    keys: ["TELEGRAM_BOT_TOKEN"],
    hint: "Needed only if Telegram support is enabled.",
  },
];

for (const item of requiredVariables) {
  if (hasConfigured(envVars, item.keys)) {
    record(PASS, item.label);
  } else {
    record(FAIL, item.label, `Missing. ${item.hint}`);
  }
}

console.log("\nOptional integrations:");
for (const item of optionalVariables) {
  if (hasConfigured(envVars, item.keys)) {
    record(PASS, item.label);
  } else {
    record(WARN, item.label, item.hint);
  }
}

const baseUrl =
  process.env.APP_URL ||
  firstConfigured(envVars, ["NEXT_PUBLIC_APP_URL", "NEXTJS_URL"]) ||
  "http://localhost:3000";

section(`3. Checking app health at ${baseUrl}`);

let healthJson = null;

try {
  const { response, json, text } = await fetchJson(`${baseUrl}/api/health`);
  if (!response.ok || !json) {
    record(FAIL, "/api/health", formatHttpError(response, text));
    console.log("\nRun `npm run dev` in a separate terminal, wait for localhost:3000, then re-run this verifier.");
    printSummary();
    process.exit(1);
  }

  healthJson = json;
  record(PASS, "/api/health responded", `ok=${String(Boolean(json.ok))}`);
} catch (error) {
  record(
    FAIL,
    "/api/health unreachable",
    `Start the app with npm run dev. ${getErrorMessage(error)}`,
  );
  printSummary();
  process.exit(1);
}

section("4. Checking provider status");

const providerLabels = {
  nvidia: "NVIDIA AI",
  supabase: "Supabase",
  tavily: "Tavily",
  serpapi: "SerpAPI",
  jina: "Jina",
  firecrawl: "Firecrawl",
  apify: "Apify",
  brightdata: "BrightData",
  scraperapi: "ScraperAPI",
  cohere: "Cohere",
  voyage: "Voyage",
  pinecone: "Pinecone",
  weaviate: "Weaviate",
  firebase: "Firebase",
  langsmith: "LangSmith",
};

if (healthJson?.providers && typeof healthJson.providers === "object") {
  const providerEntries = Object.entries(healthJson.providers);
  let activeProviders = 0;

  for (const [key, enabled] of providerEntries) {
    const label = providerLabels[key] ?? key;
    if (enabled) {
      activeProviders += 1;
      record(PASS, label, "configured");
    } else {
      record(WARN, label, "not configured");
    }
  }

  console.log(`\n${INFO} Active providers: ${activeProviders} / ${providerEntries.length}`);
} else {
  record(WARN, "Provider snapshot", "No provider data returned by /api/health.");
}

section("5. Checking Supabase database tables");

const supabaseUrl = firstConfigured(envVars, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
const serviceRoleKey = firstConfigured(envVars, ["SUPABASE_SERVICE_ROLE_KEY"]);
const anonKey = firstConfigured(envVars, ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
const supabaseKey = serviceRoleKey || anonKey;

if (!supabaseUrl || !supabaseKey) {
  record(FAIL, "Supabase table verification", "Missing Supabase URL or API key.");
} else {
  if (serviceRoleKey) {
    record(PASS, "Supabase table verifier", "Using service role key for reliable checks.");
  } else {
    record(WARN, "Supabase table verifier", "Using anon key. Some table checks may be blocked by RLS.");
  }

  const tables = [
    "users",
    "connected_accounts",
    "agent_tasks",
    "task_runs",
    "dashboard_journal_threads",
    "global_lite_connections",
    "whatsapp_messages",
    "analytics_daily",
    "subscriptions",
    "user_preferences",
    "reply_approvals",
    "chat_threads",
    "research_runs",
    "cron_log",
    "meeting_reminder_log",
    "cron_health",
  ];

  let tablesPassed = 0;

  for (const table of tables) {
    try {
      const { response, json, text } = await fetchJson(
        `${supabaseUrl}/rest/v1/${table}?select=*&limit=1`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        },
      );

      if (response.ok) {
        tablesPassed += 1;
        record(PASS, `Table: ${table}`);
        continue;
      }

      if ((response.status === 401 || response.status === 403) && !serviceRoleKey) {
        record(WARN, `Table: ${table}`, "Blocked by RLS with anon key. Re-run after adding SUPABASE_SERVICE_ROLE_KEY.");
        continue;
      }

      if (
        (response.status === 400 || response.status === 404) &&
        typeof json?.message === "string" &&
        json.message.toLowerCase().includes("schema cache")
      ) {
        record(
          FAIL,
          `Table: ${table}`,
          "Missing from the Supabase REST schema cache. Run the complete migration SQL, then refresh schema access if needed.",
        );
        continue;
      }

      if (response.status === 400 || response.status === 404) {
        record(FAIL, `Table: ${table}`, "Not found. Run the complete Supabase migration SQL.");
        continue;
      }

      record(WARN, `Table: ${table}`, formatHttpError(response, text));
    } catch (error) {
      record(
        FAIL,
        `Table: ${table}`,
        getErrorMessage(error),
      );
    }
  }

  console.log(`\n${INFO} Tables found: ${tablesPassed} / ${tables.length}`);

  section("5b. Checking Supabase critical columns");

  const criticalColumns = [
    {
      table: "research_runs",
      column: "user_id",
      hint: "Apply the secure research/thread migration so privacy export and account deletion can match research runs to the signed-in user.",
    },
    {
      table: "research_runs",
      column: "search_diagnostics",
      hint: "Apply the latest research schema migration so diagnostic capture and legacy compatibility stay aligned.",
    },
    {
      table: "dashboard_journal_threads",
      column: "user_id",
      hint: "Apply the dashboard journal migration so cross-device journal sync is fully enabled.",
    },
    {
      table: "global_lite_connections",
      column: "user_id",
      hint: "Apply the Global Lite Connect migration so the public-safe Gmail, Calendar, and Drive fallback stores cleanly in its own table.",
    },
  ];

  for (const item of criticalColumns) {
    try {
      const { response, json, text } = await fetchJson(
        `${supabaseUrl}/rest/v1/${item.table}?select=${encodeURIComponent(item.column)}&limit=1`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        },
      );

      if (response.ok) {
        record(PASS, `Column: ${item.table}.${item.column}`);
        continue;
      }

      const message = typeof json?.message === "string" ? json.message.toLowerCase() : "";
      const missingColumn =
        response.status === 400
        && (
          message.includes("could not find the column")
          || message.includes("does not have the column")
          || (message.includes("column") && message.includes("does not exist"))
          || message.includes("schema cache")
        );

      if ((response.status === 401 || response.status === 403) && !serviceRoleKey) {
        record(WARN, `Column: ${item.table}.${item.column}`, "Blocked by RLS with anon key. Re-run after adding SUPABASE_SERVICE_ROLE_KEY.");
        continue;
      }

      if (missingColumn) {
        record(FAIL, `Column: ${item.table}.${item.column}`, item.hint);
        continue;
      }

      record(WARN, `Column: ${item.table}.${item.column}`, formatHttpError(response, text));
    } catch (error) {
      record(FAIL, `Column: ${item.table}.${item.column}`, getErrorMessage(error));
    }
  }
}

section("6. Checking /api/search");

try {
  const { response, json, text } = await fetchJson(
    `${baseUrl}/api/search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "clawcloud test query" }),
    },
    10000,
  );

  if (!response.ok) {
    record(FAIL, "/api/search", formatHttpError(response, text));
  } else if (!json || !Array.isArray(json.results)) {
    record(WARN, "/api/search", "Endpoint responded, but the payload shape was unexpected.");
  } else if (Number(json.count ?? 0) > 0) {
    record(PASS, "/api/search works", `returned ${json.count} results`);
  } else {
    record(
      WARN,
      "/api/search works",
      "Returned 0 results. Configure Tavily, SerpAPI, or Jina to get live search results.",
    );
  }
} catch (error) {
    record(
      FAIL,
      "/api/search failed",
      getErrorMessage(error),
    );
}

section("7. Checking agent server");

const agentServerUrl = firstConfigured(envVars, ["AGENT_SERVER_URL"]);
const parsedAgentServerUrl = parseUrlSafe(agentServerUrl);
const parsedBaseUrl = parseUrlSafe(baseUrl);

if (!agentServerUrl) {
  record(WARN, "AGENT_SERVER_URL", "Not configured. WhatsApp and background automations will stay offline.");
} else {
  if (
    parsedAgentServerUrl &&
    parsedBaseUrl &&
    !isLocalHostname(parsedAgentServerUrl.hostname) &&
    isLocalHostname(parsedBaseUrl.hostname)
  ) {
    record(
      FAIL,
      "Agent callback URL",
      `AGENT_SERVER_URL points to a remote host, but NEXT_PUBLIC_APP_URL/NEXTJS_URL is ${baseUrl}. A remote WhatsApp agent cannot call back to localhost.`,
    );
  }

  try {
    const { response, json, text } = await fetchJson(`${agentServerUrl}/health`);
    if (!response.ok || !json) {
      record(WARN, "Agent server health", formatHttpError(response, text));
    } else {
      const status = String(json.status ?? "unknown");
      const configured =
        typeof json.configured === "boolean" ? json.configured : status === "ok";
      const missingRequiredEnv = Array.isArray(json.missingRequiredEnv)
        ? json.missingRequiredEnv
        : [];

      if (status === "ok" && configured) {
        record(PASS, "Agent server health", `status=${status}`);
      } else {
        const detail = missingRequiredEnv.length
          ? `status=${status}; missing ${missingRequiredEnv.join(", ")}`
          : `status=${status}`;
        record(FAIL, "Agent server health", detail);
      }
    }
  } catch (error) {
    record(
      WARN,
      "Agent server health",
      getErrorMessage(error),
    );
  }
}

section("8. Checking cron health endpoint");

const cronSecret = firstConfigured(envVars, ["CRON_SECRET"]);

if (!cronSecret) {
  record(WARN, "CRON_SECRET", "Missing. Cron health verification skipped.");
} else {
  try {
    const { response, json, text } = await fetchJson(
      `${baseUrl}/api/agent/cron/health`,
      {
        headers: {
          Authorization: `Bearer ${cronSecret}`,
        },
      },
    );

    if (response.ok && json) {
      record(PASS, "Cron health", `healthy=${String(Boolean(json.healthy))}`);
    } else if (
      response.status === 503 &&
      typeof json?.error === "string" &&
      json.error.toLowerCase().includes("schema cache")
    ) {
      record(WARN, "Cron health", "Supabase schema cache looks stale. The cron tables may exist, but PostgREST has not refreshed yet.");
    } else {
      record(WARN, "Cron health", formatHttpError(response, text));
    }
  } catch (error) {
    record(
      WARN,
      "Cron health",
      getErrorMessage(error),
    );
  }
}

printSummary();

function printSummary() {
  console.log(`\n${"=".repeat(72)}`);

  if (failureCount === 0) {
    console.log("Setup verification passed.");
    if (warningCount > 0) {
      console.log(`Warnings: ${warningCount}. Optional or non-blocking items still need attention.`);
    } else {
      console.log("All required checks passed and the local app looks ready.");
    }
  } else {
    console.log(`Setup verification failed with ${failureCount} blocking issue(s).`);
    if (warningCount > 0) {
      console.log(`Warnings: ${warningCount}.`);
    }
    console.log("Fix the failed checks above, then run `npm run verify:setup` again.");
  }

  console.log("=".repeat(72));
}
