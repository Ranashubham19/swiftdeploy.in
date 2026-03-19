import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

function stripOuterQuotes(value: string) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function loadEnvFile(filename: string) {
  const filePath = resolve(process.cwd(), filename);
  if (!existsSync(filePath)) {
    return;
  }

  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) {
      continue;
    }

    const key = trimmed.slice(0, splitAt).trim();
    if (!key || process.env[key]) {
      continue;
    }

    const value = stripOuterQuotes(trimmed.slice(splitAt + 1).trim());
    process.env[key] = value;
  }
}

export function loadClawCloudEnv() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");
}

export function parseFlag(flag: string) {
  return process.argv.includes(flag);
}

export function parseOption(flag: string) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }

  const next = process.argv[index + 1];
  return next && !next.startsWith("--") ? next : null;
}

export function writeJsonReport(reportPath: string, payload: unknown) {
  writeFileSync(
    resolve(process.cwd(), reportPath),
    `${JSON.stringify(payload, null, 2)}\n`,
    "utf8",
  );
}

export function maskUserId(value: string) {
  if (!value) {
    return "";
  }

  return value.length <= 8 ? value : `${value.slice(0, 8)}...`;
}

function tryParseJson(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

export function extractLastJsonPayload(raw: string) {
  const direct = tryParseJson(raw);
  if (direct !== null) {
    return direct;
  }

  for (let index = raw.lastIndexOf("{"); index >= 0; index = raw.lastIndexOf("{", index - 1)) {
    const candidate = raw.slice(index).trim();
    const parsed = tryParseJson(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

export function runTsxJsonScript(scriptPath: string, args: string[] = []) {
  const command = process.execPath;
  const cliPath = resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const result = spawnSync(
    command,
    [cliPath, scriptPath, ...args],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
    },
  );

  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const json = extractLastJsonPayload(stdout);

  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout,
    stderr,
    json,
  };
}
