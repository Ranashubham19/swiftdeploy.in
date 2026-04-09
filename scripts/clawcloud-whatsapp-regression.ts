import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import {
  parseOption,
  writeJsonReport,
} from "./clawcloud-script-helpers";

type RegressionCase = {
  prompt: string;
  mustMatch: RegExp[];
  mustNotMatch?: RegExp[];
};

type RegressionResult = {
  prompt: string;
  ok: boolean;
  elapsedMs: number;
  violations: string[];
  preview: string;
};

type RegressionProfile = "full" | "scorecard";

const cases: RegressionCase[] = [
  { prompt: "Can you write articles", mustMatch: [/article/i, /(yes|write)/i] },
  { prompt: "Can you write essays", mustMatch: [/essay/i, /(yes|write)/i] },
  { prompt: "Can you code", mustMatch: [/(code|program|script)/i] },
  { prompt: "Can you translate", mustMatch: [/(translate|languages)/i] },
  { prompt: "Can you explain quantum computing", mustMatch: [/(quantum|qubit|superposition)/i] },
  { prompt: "What is moist", mustMatch: [/(moist|slightly wet|water)/i] },
  { prompt: "What is difference between ai and ml", mustMatch: [/(ai|ml|machine learning|artificial intelligence|subset)/i] },
  {
    prompt: "tell me top 10 richest persons and richest cities of the world",
    mustMatch: [/(richest|wealthiest|net worth)/i, /\bcities?\b/i],
    mustNotMatch: [/(available contacts|save contact|send direct|couldn't match \"?me\"?)/i],
  },
  {
    prompt: "What js the update of todays",
    mustMatch: [/(update|latest|news|topic|headline|clarify|developments?|\b\d{1,2}\s+[A-Za-z]{3}\s+20\d{2}\b)/i],
    mustNotMatch: [/\b(weather in|temperature|humidity|wind speed|forecast for)\b/i],
  },
  { prompt: "What is photosynthesis", mustMatch: [/(photosynthesis|chlorophyll|co2|oxygen)/i] },
  { prompt: "Capital of Japan", mustMatch: [/\btokyo\b/i] },
  { prompt: "Table of 12", mustMatch: [/(12\s*[x×]\s*10|120)/i] },
  { prompt: "15% of 840", mustMatch: [/\b126\b/i] },
  { prompt: "Who invented the telephone", mustMatch: [/(alexander graham bell|bell)/i] },
  { prompt: "When was ww2", mustMatch: [/(1939|1945|world war)/i] },
  { prompt: "Normal blood pressure", mustMatch: [/(mmhg|normal|stage)/i] },
  { prompt: "What is GDP", mustMatch: [/(gross domestic product|gdp)/i] },
  {
    prompt: "ok what write code for n queen in js",
    mustMatch: [/n-?queens?/i, /```javascript/i, /\bsolveNQueens\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    prompt: "write fibonacci code in ts",
    mustMatch: [/(fibonacci|\bfib\b)/i, /```(?:ts|typescript)/i, /\bfunction fib\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    prompt: "show rat in a maze code in java",
    mustMatch: [/(rat in a maze|\bRatMaze\b|\bRatInMaze\b)/i, /```java/i, /\bclass\s+(Main|RatMaze|RatInMaze)\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    prompt: "write palindrome code in js",
    mustMatch: [/palindrome/i, /```(?:javascript|js)/i, /\bisPalindrome\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    prompt: "write binary search in java",
    mustMatch: [/```java/i, /\bbinarySearch\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    prompt: "write n queen ts",
    mustMatch: [/n-?queens?/i, /```ts/i, /\bsolveNQueens\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    prompt: "write fibonacci code in go",
    mustMatch: [/(fibonacci|\bfib\b)/i, /```go/i, /\bfunc (?:fib|Fibonacci)\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    prompt: "write palindrome in rust",
    mustMatch: [/palindrome/i, /```rust/i, /\bfn is_palindrome\b/i],
    mustNotMatch: [/```python/i],
  },
  {
    prompt: "what is the gdp of china",
    mustMatch: [/\bgdp\b/i, /(china|\$|usd|trillion|worldbank|world bank|year:)/i, /\b20\d{2}\b/i],
    mustNotMatch: [/(recommendation|trade-offs|visit the website|check the world bank|check the imf)/i],
  },
  {
    prompt: "Search the web and tell me Japan's current population using the latest reliable estimate, with source context.",
    mustMatch: [/\bpopulation\b/i, /\bjapan\b/i, /(worldbank|world bank)/i, /\b20\d{2}\b/i],
    mustNotMatch: [/\bsearch web and tell me japan\b/i, /\bcheck the world bank\b/i],
  },
  {
    prompt: "who was the top 10 most powerful countries in 400 ad",
    mustMatch: [/(400 ad|400 ce)/i, /(Eastern Roman Empire|Western Roman Empire)/i, /(Sasanian Empire|Gupta Empire)/i],
    mustNotMatch: [/\bHan Dynasty\b/i, /\bLiu Song\b/i],
  },
  {
    prompt: "price of petrol in china right now",
    mustMatch: [/\b(china|petrol|gasoline)\b/i, /(cny|\$|usd)/i, /\bper liter\b/i, /\b20\d{2}\b/i],
    mustNotMatch: [/\bbest live sources\b/i, /\bwhat to trust most\b/i, /\babc news\b/i, /\bbbc\b/i],
  },
  {
    prompt: "what is the price of 1 dollar in rs",
    mustMatch: [/(usd\/inr|usd to inr|1 usd =)/i, /(₹|â‚¹|inr)/i, /\*Source\*/i],
    mustNotMatch: [/\bcheck a reliable currency exchange website\b/i, /\bcurrency converter tool\b/i],
  },
  {
    prompt: "what is the price of tomato right now in india",
    mustMatch: [/\btomato\b/i, /\bindia\b/i, /(₹|â‚¹|inr)/i, /\bper kg\b/i, /\b20\d{2}\b/i, /consumer affairs|price monitoring system/i],
    mustNotMatch: [/\bbest live sources\b/i, /\bwhat to trust most\b/i],
  },
  {
    prompt: "price of tomato right now in china",
    mustMatch: [/\btomato price lookup\b/i, /city- or market-specific/i, /country \+ city or market/i],
    mustNotMatch: [/\bbest live sources\b/i, /\bwhat to trust most\b/i],
  },
  {
    prompt: "in india how much is the current price of gold",
    mustMatch: [/\bgold\b/i, /(₹|inr)/i, /(per 10g|local market view|india)/i],
    mustNotMatch: [/\*Gold Apr 26\*/i],
  },
  {
    prompt: "temperatura en madrid hoy",
    mustMatch: [/\bmadrid\b/i, /\btemperature\b|°c/i, /(wttr\.in|open-meteo)/i],
    mustNotMatch: [/\bprovided sources\b/i, /\bnot listed\b/i],
  },
  { prompt: "Speed of light", mustMatch: [/(299,?792,?458|3\s*[x×]\s*10\^?8|m\/s)/i] },
  {
    prompt: "दिल्ली का तापमान क्या है",
    mustMatch: [/\bdelhi\b|दिल्ली/i, /\btemperature\b|Â°c/i, /(wttr\.in|open-meteo)/i],
    mustNotMatch: [/\bprovided sources\b/i, /\bnot listed\b/i, /ask your question again in english/i],
  },
  { prompt: "Largest planet", mustMatch: [/\bjupiter\b/i] },
  { prompt: "Rat in maze", mustMatch: [/(maze|path|dfs|python|find_paths)/i] },
  { prompt: "What is mariana trench", mustMatch: [/(mariana|challenger deep|deepest)/i] },
  { prompt: "Write me an article about AI", mustMatch: [/(article|ai|innovation|productivity)/i] },
  { prompt: "Write a poem about nature", mustMatch: [/(poem|nature|earth|river|mountain)/i] },
  { prompt: "What are symptoms of diabetes", mustMatch: [/(diabetes|symptoms|thirst|urination|blood glucose)/i] },
  {
    prompt: "GST on Rs 1000 capacity planning",
    mustMatch: [/(gst rate applies|good or service classification|item\/service|service category)/i],
    mustNotMatch: [/i'?m not confident enough/i],
  },
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
  /ready to answer\./i,
  /i can explain any technology/i,
];

const DEFAULT_REPORT_PATH = "tmp-clawcloud-whatsapp-regression.json";
const DEFAULT_CONCURRENCY = 4;

const scorecardPrompts = new Set([
  "What js the update of todays",
  "Capital of Japan",
  "ok what write code for n queen in js",
  "write fibonacci code in ts",
  "who was the top 10 most powerful countries in 400 ad",
]);

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
  const requestedProfile = (parseOption("--profile") ?? "full").trim().toLowerCase();
  const profile: RegressionProfile = requestedProfile === "scorecard" ? "scorecard" : "full";
  const activeCases = profile === "scorecard"
    ? cases.filter((testCase) => scorecardPrompts.has(testCase.prompt))
    : cases;
  const reportPath = parseOption("--report")
    ?? (profile === "scorecard"
      ? "tmp-clawcloud-whatsapp-regression.scorecard.json"
      : DEFAULT_REPORT_PATH);
  const requestedConcurrency = Number.parseInt(parseOption("--concurrency") ?? "", 10);
  const concurrency = Number.isFinite(requestedConcurrency) && requestedConcurrency > 0
    ? Math.min(requestedConcurrency, activeCases.length)
    : DEFAULT_CONCURRENCY;
  const results = new Array<RegressionResult>(activeCases.length);
  let cursor = 0;

  const evaluateCase = async (testCase: RegressionCase, index: number) => {
    const userId = `00000000-0000-0000-0000-${String(703 + index).padStart(12, "0")}`;
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

    for (const forbidden of testCase.mustNotMatch ?? []) {
      if (forbidden.test(answer)) {
        violations.push(`Matched forbidden pattern: ${forbidden}`);
      }
    }

    results[index] = {
      prompt: testCase.prompt,
      ok: violations.length === 0,
      elapsedMs,
      violations,
      preview: answer.replace(/\s+/g, " ").slice(0, 220),
    };
  };

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= activeCases.length) {
        return;
      }

      await evaluateCase(activeCases[index], index);
    }
  });

  await Promise.all(workers);

  const passed = results.filter((row) => row.ok).length;
  const failed = results.length - passed;
  const report = {
    checkedAt: new Date().toISOString(),
    reportPath,
    profile,
    concurrency,
    total: results.length,
    passed,
    failed,
    results,
  };

  writeJsonReport(reportPath, report);
  console.log(JSON.stringify(report, null, 2));

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
