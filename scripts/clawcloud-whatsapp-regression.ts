import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

type RegressionCase = {
  prompt: string;
  mustMatch: RegExp[];
};

type RegressionResult = {
  prompt: string;
  ok: boolean;
  elapsedMs: number;
  violations: string[];
  preview: string;
};

const cases: RegressionCase[] = [
  { prompt: "Can you write articles", mustMatch: [/article/i, /(yes|write)/i] },
  { prompt: "Can you write essays", mustMatch: [/essay/i, /(yes|write)/i] },
  { prompt: "Can you code", mustMatch: [/(code|program|script)/i] },
  { prompt: "Can you translate", mustMatch: [/(translate|languages)/i] },
  { prompt: "Can you explain quantum computing", mustMatch: [/(quantum|qubit|superposition)/i] },
  { prompt: "What is photosynthesis", mustMatch: [/(photosynthesis|chlorophyll|co2|oxygen)/i] },
  { prompt: "Capital of Japan", mustMatch: [/\btokyo\b/i] },
  { prompt: "Table of 12", mustMatch: [/(12\s*[x×]\s*10|120)/i] },
  { prompt: "15% of 840", mustMatch: [/\b126\b/i] },
  { prompt: "Who invented the telephone", mustMatch: [/(alexander graham bell|bell)/i] },
  { prompt: "When was ww2", mustMatch: [/(1939|1945|world war)/i] },
  { prompt: "Normal blood pressure", mustMatch: [/(mmhg|normal|stage)/i] },
  { prompt: "What is GDP", mustMatch: [/(gross domestic product|gdp)/i] },
  { prompt: "Speed of light", mustMatch: [/(299,?792,?458|3\s*[x×]\s*10\^?8|m\/s)/i] },
  { prompt: "Largest planet", mustMatch: [/\bjupiter\b/i] },
  { prompt: "Rat in maze", mustMatch: [/(maze|path|dfs|python|find_paths)/i] },
  { prompt: "What is mariana trench", mustMatch: [/(mariana|challenger deep|deepest)/i] },
  { prompt: "Write me an article about AI", mustMatch: [/(article|ai|innovation|productivity)/i] },
  { prompt: "Write a poem about nature", mustMatch: [/(poem|nature|earth|river|mountain)/i] },
  { prompt: "What are symptoms of diabetes", mustMatch: [/(diabetes|symptoms|thirst|urination|blood glucose)/i] },
];

const bannedPatterns = [
  /i got your message/i,
  /you asked about/i,
  /you asked:\s*_/i,
  /i received your question/i,
  /ask your question and i'll answer it completely/i,
  /coding reply/i,
  /i received:\s*_/i,
  /clean starter template/i,
];

function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    if (!key || process.env[key]) continue;
    let value = trimmed.slice(splitAt + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const { routeInboundAgentMessage } = await import("@/lib/clawcloud-agent");
  const userId = "regression-user";
  const results: RegressionResult[] = [];

  for (const testCase of cases) {
    const started = performance.now();
    const answer = (await routeInboundAgentMessage(userId, testCase.prompt)) ?? "";
    const elapsedMs = Number((performance.now() - started).toFixed(1));
    const violations: string[] = [];

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
      prompt: testCase.prompt,
      ok: violations.length === 0,
      elapsedMs,
      violations,
      preview: answer.replace(/\s+/g, " ").slice(0, 220),
    });
  }

  const passed = results.filter((row) => row.ok).length;
  const failed = results.length - passed;

  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
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
  console.error(error);
  process.exitCode = 1;
});
