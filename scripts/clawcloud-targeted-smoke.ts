import { existsSync, readFileSync } from "node:fs";

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

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const { routeInboundAgentMessage } = await import("@/lib/clawcloud-agent");
  const user = "targeted-smoke-user";
  const prompts = [
    "Ok give me code for n queen",
    "Rat in maze",
    "Ok what is mariana trench",
    "Ok what is the news of today",
    "What is the whether today",
  ];

  const rows: Array<{ prompt: string; answer: string }> = [];
  for (const prompt of prompts) {
    const answer = (await routeInboundAgentMessage(user, prompt)) ?? "";
    rows.push({ prompt, answer });
  }

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
