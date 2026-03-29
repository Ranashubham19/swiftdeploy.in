import { performance } from "node:perf_hooks";

import {
  maskUserId,
  loadClawCloudEnv,
  parseFlag,
  parseOption,
  resolveClawCloudSharedUser,
  writeJsonReport,
} from "./clawcloud-script-helpers";

type CanaryCase = {
  id: string;
  prompt: string;
  mustMatch: RegExp[];
};

type CanaryResult = {
  id: string;
  prompt: string;
  ok: boolean;
  elapsedMs: number;
  violations: string[];
  preview: string;
};

const DEFAULT_REPORT_PATH = "tmp-clawcloud-daily-canary.json";

const cases: CanaryCase[] = [
  {
    id: "math_percent",
    prompt: "What is 15% of 840?",
    mustMatch: [/\b126\b/i],
  },
  {
    id: "capital_japan",
    prompt: "What is the capital of Japan?",
    mustMatch: [/\btokyo\b/i],
  },
  {
    id: "followup_email",
    prompt: "Write a professional follow-up note to a client who missed a meeting. Include a subject line and a polite closing.",
    mustMatch: [/(subject:|best regards|follow-up)/i],
  },
  {
    id: "ai_ml_dl",
    prompt: "Explain the difference between AI, ML, and deep learning in simple terms.",
    mustMatch: [/(artificial intelligence|machine learning|deep learning)/i],
  },
];

const bannedPatterns = [
  /__fast_fallback_internal__/i,
  /__deep_fallback_internal__/i,
  /i got your message/i,
  /you asked about/i,
];

async function askAgent(baseUrl: string, bearer: string, userId: string, prompt: string) {
  const started = performance.now();
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

  return {
    answer: String(payload.response ?? ""),
    elapsedMs: Number((performance.now() - started).toFixed(1)),
  };
}

async function main() {
  loadClawCloudEnv();

  const reportPath = parseOption("--report") ?? DEFAULT_REPORT_PATH;
  const baseUrl = (parseOption("--base-url") ?? process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXTJS_URL ?? "").trim().replace(/\/+$/, "");
  const bearer = (process.env.CRON_SECRET ?? process.env.AGENT_SECRET ?? "").trim();
  const dryRun = parseFlag("--dry-run");
  let sharedUser:
    | Awaited<ReturnType<typeof resolveClawCloudSharedUser>>
    | null = null;
  let userId = (parseOption("--user") ?? process.env.CLAWCLOUD_AUDIT_USER_ID ?? process.env.WHATSAPP_AUTO_TEST_USER_ID ?? "").trim();

  if (!dryRun) {
    sharedUser = await resolveClawCloudSharedUser({
      cliUserId: parseOption("--user"),
      allowCreateAuditUser: true,
    });
    userId = sharedUser.userId;
  }

  const reportBase = {
    checkedAt: new Date().toISOString(),
    baseUrl,
    userIdPrefix: maskUserId(userId),
    sharedUserSource: sharedUser?.source ?? null,
    staleConfiguredKeys: sharedUser?.staleConfiguredKeys ?? [],
    cases: cases.map((item) => item.id),
  };

  if (dryRun) {
    const report = {
      ...reportBase,
      healthy: false,
      dryRun: true,
      notes: [
        "Dry-run mode skipped network calls.",
        "Set NEXT_PUBLIC_APP_URL and CRON_SECRET or AGENT_SECRET to run the live canary.",
        "The script auto-resolves a valid shared QA user from CLAWCLOUD_AUDIT_USER_ID, WHATSAPP_AUTO_TEST_USER_ID, or the dedicated audit user.",
      ],
    };
    writeJsonReport(reportPath, report);
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (!baseUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL or NEXTJS_URL.");
  }
  if (!bearer) {
    throw new Error("Missing CRON_SECRET or AGENT_SECRET.");
  }

  const healthResponse = await fetch(`${baseUrl}/api/health`);
  const healthJson = (await healthResponse.json().catch(() => null)) as
    | {
      ok?: boolean;
      providers?: Record<string, boolean>;
      build?: { sha?: string | null };
    }
    | null;

  if (!healthResponse.ok || !healthJson?.ok) {
    throw new Error(`Health check failed with HTTP ${healthResponse.status}`);
  }

  const results: CanaryResult[] = [];
  for (const testCase of cases) {
    const violations: string[] = [];
    try {
      const result = await askAgent(baseUrl, bearer, userId, testCase.prompt);
      const answer = result.answer;

      if (!answer.trim()) {
        violations.push("Empty answer");
      }

      for (const pattern of bannedPatterns) {
        if (pattern.test(answer)) {
          violations.push(`Contains banned fallback phrase: ${pattern}`);
        }
      }

      for (const pattern of testCase.mustMatch) {
        if (!pattern.test(answer)) {
          violations.push(`Missing expected pattern: ${pattern}`);
        }
      }

      results.push({
        id: testCase.id,
        prompt: testCase.prompt,
        ok: violations.length === 0,
        elapsedMs: result.elapsedMs,
        violations,
        preview: answer.replace(/\s+/g, " ").slice(0, 220),
      });
    } catch (error) {
      results.push({
        id: testCase.id,
        prompt: testCase.prompt,
        ok: false,
        elapsedMs: 0,
        violations: [error instanceof Error ? error.message : String(error)],
        preview: "",
      });
    }
  }

  const passed = results.filter((row) => row.ok).length;
  const report = {
    ...reportBase,
    dryRun: false,
    healthy: passed === results.length,
    health: {
      buildSha: healthJson.build?.sha ?? null,
      providers: healthJson.providers ?? {},
    },
    total: results.length,
    passed,
    failed: results.length - passed,
    results,
  };

  writeJsonReport(reportPath, report);
  console.log(JSON.stringify(report, null, 2));

  if (!report.healthy) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
