import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

function loadEnvFile(filename: string) {
  const filepath = resolve(process.cwd(), filename);
  if (!existsSync(filepath)) return;

  const content = readFileSync(filepath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const { routeInboundAgentMessage } = await import("../lib/clawcloud-agent");

  const userId = "00000000-0000-0000-0000-000000000001";

  const cases = [
    {
      key: "coding",
      question:
        "Design a zero-downtime migration from at-least-once Stripe webhooks to an exactly-once ledger-based billing system. Include invariants, schema and constraints, transaction boundaries, replay and rollback strategy, duplicate prevention during cutover, and TypeScript pseudocode.",
    },
    {
      key: "math",
      question:
        "A trading system wins 43% of the time, average win is 2.7R, average loss is 1R, pairwise return correlation under stress is 0.25, I risk 1.2% of equity per trade, and I take 180 trades per year. Estimate expectancy, CAGR implications under fixed-fraction sizing, and the probability of a 30% drawdown. State assumptions clearly.",
    },
    {
      key: "research",
      question:
        "Write a decision memo for a regulated healthcare enterprise choosing between long-context-only, classic RAG, agentic retrieval, and a hybrid approach for a clinical support copilot over 80000 internal docs with daily policy updates. Cover latency, cost, hallucination control, auditability, PHI risk, evaluation, rollout, and the recommended architecture.",
    },
  ];

  const results: Array<{ key: string; durationMs: number; answer: string | null }> = [];

  for (const testCase of cases) {
    const startedAt = performance.now();
    const answer = await routeInboundAgentMessage(userId, testCase.question);
    const finishedAt = performance.now();

    results.push({
      key: testCase.key,
      durationMs: Math.round(finishedAt - startedAt),
      answer: answer ?? null,
    });
  }

  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
