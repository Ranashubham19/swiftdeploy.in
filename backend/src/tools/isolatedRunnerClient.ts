import type { CodeExecutionResult } from "./executionTypes.js";

type IsolatedRunnerRequest = {
  code: string;
  language: string;
  timeoutMs?: number;
};

type IsolatedRunnerWireResponse = Partial<CodeExecutionResult> & {
  ok?: boolean;
};

const clean = (value: unknown): string => String(value || "").trim();

export const getIsolatedRunnerConfig = (): {
  url: string;
  apiKey: string;
  timeoutMs: number;
  required: boolean;
} => {
  const url = clean(process.env.ISOLATED_CODE_RUNNER_URL);
  const apiKey = clean(process.env.ISOLATED_CODE_RUNNER_API_KEY);
  const timeoutMs = Math.max(300, Math.min(15_000, Number(process.env.ISOLATED_CODE_RUNNER_TIMEOUT_MS || 2500)));
  const required =
    (process.env.ISOLATED_CODE_RUNNER_REQUIRED || "false").toLowerCase() === "true";
  return { url, apiKey, timeoutMs, required };
};

export const isIsolatedRunnerConfigured = (): boolean =>
  Boolean(getIsolatedRunnerConfig().url);

export const normalizeIsolatedRunnerResponse = (
  data: IsolatedRunnerWireResponse,
  language: string,
): CodeExecutionResult => ({
  ok: Boolean(data?.ok),
  language: clean(data?.language) || language,
  command: clean(data?.command),
  args: Array.isArray(data?.args) ? data!.args!.map((v) => String(v)) : [],
  exitCode:
    typeof data?.exitCode === "number" && Number.isFinite(data.exitCode)
      ? data.exitCode
      : null,
  timedOut: Boolean(data?.timedOut),
  stdout: clean(data?.stdout),
  stderr: clean(data?.stderr),
  error: clean(data?.error) || undefined,
});

export const executeCodeViaIsolatedRunner = async (
  payload: IsolatedRunnerRequest,
): Promise<CodeExecutionResult> => {
  const cfg = getIsolatedRunnerConfig();
  if (!cfg.url) {
    throw new Error("ISOLATED_CODE_RUNNER_URL is not configured");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(`${cfg.url.replace(/\/+$/, "")}/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { "x-runner-api-key": cfg.apiKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => ({}))) as IsolatedRunnerWireResponse;
    const normalized = normalizeIsolatedRunnerResponse(data, payload.language);
    if (!res.ok && !normalized.error) {
      normalized.error = `Runner HTTP ${res.status}`;
    }
    return normalized;
  } finally {
    clearTimeout(timeout);
  }
};
