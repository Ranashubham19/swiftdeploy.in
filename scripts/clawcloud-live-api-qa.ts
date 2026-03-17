import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

type LiveCase = {
  id: string;
  prompt: string;
  mustMatch: RegExp[];
};

type LiveResult = {
  id: string;
  prompt: string;
  ok: boolean;
  elapsedMs: number;
  violations: string[];
  preview: string;
};

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
    id: "EMAIL_DRAFT",
    prompt: "Draft a professional follow-up email to a client who missed a meeting.",
    mustMatch: [/(subject:|dear|best regards|follow-up)/i],
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
  const userId = (process.env.WHATSAPP_AUTO_TEST_USER_ID || "").trim();

  if (!baseUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL/NEXTJS_URL in env.");
  }
  if (!bearer) {
    throw new Error("Missing CRON_SECRET/AGENT_SECRET in env.");
  }
  if (!userId) {
    throw new Error("Missing WHATSAPP_AUTO_TEST_USER_ID in env.");
  }

  const results: LiveResult[] = [];

  for (const testCase of cases) {
    const started = performance.now();
    let answer = "";
    const violations: string[] = [];

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

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    targetBaseUrl: baseUrl,
    userIdPrefix: userId.slice(0, 8),
    total: results.length,
    passed,
    failed,
    results,
  }, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
