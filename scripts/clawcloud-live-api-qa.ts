import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import { resolveClawCloudSharedUser, writeJsonReport } from "./clawcloud-script-helpers";

type LiveCase = {
  id: string;
  prompt: string;
  mustMatch: RegExp[];
  mustNotMatch?: RegExp[];
  userMode?: "fresh" | "shared";
};

type LiveResult = {
  id: string;
  prompt: string;
  ok: boolean;
  elapsedMs: number;
  violations: string[];
  preview: string;
};

const REPORT_PATH = "tmp-clawcloud-live-api-qa.json";

const cases: LiveCase[] = [
  {
    id: "MATH_PERCENT_Q1",
    prompt: "What is 15% of 840?",
    mustMatch: [/\b126\b/i],
  },
  {
    id: "MATH_PERCENT_Q2",
    prompt: "Calculate 15% of 840.",
    mustMatch: [/\b126\b/i],
  },
  {
    id: "GEO_CAPITAL",
    prompt: "What is the capital of Japan?",
    mustMatch: [/\btokyo\b/i],
  },
  {
    id: "CODE_NQUEENS",
    prompt: "Can you give Python code for N-Queens with a brief explanation?",
    mustMatch: [/(n_queens|backtracking|dfs)/i],
  },
  {
    id: "CODE_NQUEENS_JS",
    prompt: "ok what write code for n queen in js",
    mustMatch: [/n-?queens?/i, /```javascript/i, /\bsolveNQueens\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    id: "EMAIL_DRAFT",
    prompt: "Write a professional follow-up note to a client who missed a meeting. Include a subject line and a polite closing.",
    mustMatch: [/(subject:|dear|best regards|follow-up)/i],
  },
  {
    id: "HELP_HINGLISH_CAPABILITIES",
    prompt: "aap kya kya kr skte hai",
    mustMatch: [/quick guide|ask naturally/i, /coding|writing|math|planning/i],
    mustNotMatch: [/not confident enough/i, /too long to complete reliably/i],
  },
  {
    id: "EXPLAIN_AI_ML_DL",
    prompt: "Explain the difference between AI, ML, and deep learning in simple terms.",
    mustMatch: [/(ai|machine learning|deep learning)/i],
  },
  {
    id: "CLOUD_COSTS",
    prompt: "What are three practical ways to reduce cloud costs for a small startup?",
    mustMatch: [/(1\\.|2\\.|3\\.|rightsiz|spot|autoscal|shutdown|storage)/i],
  },
  {
    id: "BTC_LIVE",
    prompt: "What is the price of Bitcoin right now in USD?",
    mustMatch: [/(bitcoin|btc)/i, /(\$|usd)/i],
    mustNotMatch: [/\bitc\b/i],
  },
  {
    id: "GOLD_INDIA_INR",
    prompt: "in india how much is the current price of gold",
    mustMatch: [/\bgold\b/i, /(₹|inr)/i, /(per 10g|local market view|india)/i],
    mustNotMatch: [/\*Gold Apr 26\*/i],
  },
  {
    id: "WEATHER_MADRID_ES",
    prompt: "temperatura en madrid hoy",
    mustMatch: [/\bmadrid\b/i, /\btemperature\b|°c/i, /(wttr\.in|open-meteo)/i],
    mustNotMatch: [/\bprovided sources\b/i, /\bnot listed\b/i],
  },
  {
    id: "WEATHER_JALANDHAR_TYPO",
    prompt: "what is the current tempertature of jalandhar right now",
    mustMatch: [/\bjalandhar\b/i, /\btemperature\b|°c/i, /(wttr\.in|open-meteo)/i],
    mustNotMatch: [/\bprovided sources\b/i, /\bnot listed\b/i, /\btribune india\b/i, /\bhindustan times\b/i],
  },
  {
    id: "WEATHER_DELHI_HI",
    prompt: "दिल्ली का तापमान क्या है",
    mustMatch: [/\bdelhi\b|दिल्ली/i, /\btemperature\b|Â°c/i, /(wttr\.in|open-meteo)/i],
    mustNotMatch: [/\bprovided sources\b/i, /\bnot listed\b/i, /ask your question again in english/i],
  },
  {
    id: "UPDATE_CLARIFY",
    prompt: "What js the update of todays",
    mustMatch: [/(update|latest|news|topic|headline|clarify)/i],
    mustNotMatch: [/\b(weather in|temperature|humidity|wind speed|forecast for)\b/i],
  },
  {
    id: "RICH_RANKING_MIXED",
    prompt: "tell me top 10 richest persons and richest cities of the world",
    mustMatch: [/(richest|wealthiest|net worth)/i, /\bcities?\b/i],
    mustNotMatch: [/(available contacts|save contact|send direct|couldn't match \"?me\"?)/i],
  },
  {
    id: "RICH_CITIES_ONLY",
    prompt: "top 10 richest cities in the world",
    mustMatch: [/top wealthiest cities by resident millionaires/i, /\bnew york\b/i, /\bbay area\b/i],
    mustNotMatch: [/top richest people by live net worth/i, /\belon musk\b/i],
  },
  {
    id: "FIB_TS",
    prompt: "write fibonacci code in ts",
    mustMatch: [/(fibonacci|\bfib\b)/i, /```(?:ts|typescript)/i, /\bfunction fib\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    id: "RAT_JAVA",
    prompt: "show rat in a maze code in java",
    mustMatch: [/(rat in a maze|\bRatMaze\b|\bRatInMaze\b)/i, /```java/i, /\bclass\s+(Main|RatMaze|RatInMaze)\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    id: "PAL_JS",
    prompt: "write palindrome code in js",
    mustMatch: [/palindrome/i, /```(?:javascript|js)/i, /\bisPalindrome\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    id: "BINARY_JAVA",
    prompt: "write binary search in java",
    mustMatch: [/```java/i, /\bbinarySearch\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    id: "NQUEENS_TS",
    prompt: "write n queen ts",
    mustMatch: [/n-?queens?/i, /```ts/i, /\bsolveNQueens\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    id: "FIB_GO",
    prompt: "write fibonacci code in go",
    mustMatch: [/(fibonacci|\bfib\b)/i, /```go/i, /\bfunc (?:fib|Fibonacci)\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    id: "PAL_RUST",
    prompt: "write palindrome in rust",
    mustMatch: [/palindrome/i, /```rust/i, /\bfn is_palindrome\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    id: "GDP_CHINA",
    prompt: "what is the gdp of china",
    mustMatch: [/\bgdp\b/i, /(china|\$|usd|trillion|worldbank|world bank|year:)/i, /\b20\d{2}\b/i],
    mustNotMatch: [/(recommendation|trade-offs|visit the website|check the world bank|check the imf)/i],
  },
  {
    id: "POP_JAPAN_SEARCH_PREFIX",
    prompt: "Search the web and tell me Japan's current population using the latest reliable estimate, with source context.",
    mustMatch: [/\bpopulation\b/i, /\bjapan\b/i, /(worldbank|world bank)/i, /\b20\d{2}\b/i],
    mustNotMatch: [/\bsearch web and tell me japan\b/i, /\bcheck the world bank\b/i],
  },
  {
    id: "HISTORY_400_AD_POWER",
    prompt: "who was the top 10 most powerful countries in 400 ad",
    mustMatch: [/(400 ad|400 ce)/i, /(Eastern Roman Empire|Western Roman Empire)/i, /(Sasanian Empire|Gupta Empire)/i],
    mustNotMatch: [/\bHan Dynasty\b/i, /\bLiu Song\b/i],
  },
  {
    id: "PETROL_CHINA",
    prompt: "price of petrol in china right now",
    mustMatch: [/\b(china|petrol|gasoline)\b/i, /(cny|\$|usd)/i, /\bper liter\b/i, /\b20\d{2}\b/i],
    mustNotMatch: [/\bbest live sources\b/i, /\bwhat to trust most\b/i, /\babc news\b/i, /\bbbc\b/i],
  },
  {
    id: "USD_INR_NATURAL",
    prompt: "what is the price of 1 dollar in rs",
    mustMatch: [/(usd\/inr|usd to inr|1 usd =)/i, /(₹|â‚¹|inr)/i, /\*Source\*/i],
    mustNotMatch: [/\bcheck a reliable currency exchange website\b/i, /\bcurrency converter tool\b/i],
  },
  {
    id: "TOMATO_INDIA",
    prompt: "what is the price of tomato right now in india",
    mustMatch: [/\btomato\b/i, /\bindia\b/i, /(₹|â‚¹|inr)/i, /\bper kg\b/i, /\b20\d{2}\b/i, /consumer affairs|price monitoring system/i],
    mustNotMatch: [/\bbest live sources\b/i, /\bwhat to trust most\b/i],
  },
  {
    id: "TOMATO_CHINA_CLARIFY",
    prompt: "price of tomato right now in china",
    mustMatch: [/\btomato price lookup\b/i, /city- or market-specific/i, /country \+ city or market/i],
    mustNotMatch: [/\bbest live sources\b/i, /\bwhat to trust most\b/i],
  },
];

const bannedPatterns = [
  /__fast_fallback_internal__/i,
  /__deep_fallback_internal__/i,
  /i got your message/i,
  /you asked about/i,
  /ready to answer\./i,
  /reliable information for this detail is not available in the retrieved sources/i,
  /## short summary/i,
  /## key updates/i,
  /## detailed explanation/i,
];

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function askAgent(baseUrl: string, bearer: string, userId: string, prompt: string) {
  const response = await fetch(`${baseUrl}/api/agent/message`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      _internal: true,
      userId,
      message: prompt,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    response?: string;
    error?: string;
  };

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }

  return String(payload.response ?? "");
}

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTJS_URL || "").trim().replace(/\/+$/, "");
  const bearer = (process.env.CRON_SECRET || process.env.AGENT_SECRET || "").trim();
  const needsSharedUser = cases.some((testCase) => testCase.userMode === "shared");
  const sharedUser = needsSharedUser
    ? await resolveClawCloudSharedUser({ allowCreateAuditUser: true })
    : null;
  const sharedUserId = sharedUser?.userId ?? "";

  if (!baseUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL/NEXTJS_URL in env.");
  }
  if (!bearer) {
    throw new Error("Missing CRON_SECRET/AGENT_SECRET in env.");
  }
  const results: LiveResult[] = [];

  for (const testCase of cases) {
    const started = performance.now();
    let answer = "";
    const violations: string[] = [];
    const userId = testCase.userMode === "shared"
      ? sharedUserId
      : randomUUID();

    if (!userId) {
      throw new Error("Unable to resolve a shared QA user for shared-user live checks.");
    }

    try {
      answer = await askAgent(baseUrl, bearer, userId, testCase.prompt);
    } catch (error) {
      const elapsedMs = Number((performance.now() - started).toFixed(1));
      results.push({
        id: testCase.id,
        prompt: testCase.prompt,
        ok: false,
        elapsedMs,
        violations: [`Request failed: ${error instanceof Error ? error.message : String(error)}`],
        preview: "",
      });
      continue;
    }

    const elapsedMs = Number((performance.now() - started).toFixed(1));

    if (!answer.trim()) {
      violations.push("Empty answer");
    }

    for (const pattern of bannedPatterns) {
      if (pattern.test(answer)) {
        violations.push(`Contains banned fallback phrase: ${pattern}`);
      }
    }

    for (const expected of testCase.mustMatch) {
      if (!expected.test(answer)) {
        violations.push(`Missing expected pattern: ${expected}`);
      }
    }

    for (const forbidden of testCase.mustNotMatch ?? []) {
      if (forbidden.test(answer)) {
        violations.push(`Matched forbidden pattern: ${forbidden}`);
      }
    }

    results.push({
      id: testCase.id,
      prompt: testCase.prompt,
      ok: violations.length === 0,
      elapsedMs,
      violations,
      preview: answer.replace(/\s+/g, " ").slice(0, 240),
    });
  }

  const passed = results.filter((row) => row.ok).length;
  const failed = results.length - passed;

  const report = {
    checkedAt: new Date().toISOString(),
    targetBaseUrl: baseUrl,
    sharedUserIdPrefix: sharedUserId ? sharedUserId.slice(0, 8) : "",
    sharedUserSource: sharedUser?.source ?? null,
    staleConfiguredKeys: sharedUser?.staleConfiguredKeys ?? [],
    total: results.length,
    passed,
    failed,
    results,
  };

  writeJsonReport(REPORT_PATH, report);
  console.log(JSON.stringify(report, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
