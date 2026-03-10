import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { executeCodeViaIsolatedRunner, getIsolatedRunnerConfig, isIsolatedRunnerConfigured } from "./isolatedRunnerClient.js";
import type { CodeExecutionResult } from "./executionTypes.js";

const CODE_EXECUTION_ENABLED =
  (process.env.ADVANCED_CODE_EXECUTION_ENABLED || "false").toLowerCase() === "true";

export const isSubprocessCodeExecutionEnabled = (): boolean => CODE_EXECUTION_ENABLED;

const JS_EXECUTABLE = (process.env.NODE_EXECUTABLE || "node").trim();
const PYTHON_CANDIDATES = [
  (process.env.PYTHON_EXECUTABLE || "").trim(),
  "python",
  "python3",
  "py",
].filter(Boolean);

const MAX_CODE_BYTES = Math.max(
  256,
  Math.min(80_000, Number(process.env.CODE_EXEC_MAX_BYTES || 20_000)),
);

const normalizeOutput = (value: string): string =>
  String(value || "").replace(/\0/g, "").slice(0, 12_000);

const runProcess = (
  command: string,
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<CodeExecutionResult> =>
  new Promise((resolve) => {
    const timeoutMs = Math.max(100, Math.min(10_000, Number(opts?.timeoutMs) || 1500));
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {}
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 20_000) stdout = stdout.slice(0, 20_000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 20_000) stderr = stderr.slice(0, 20_000);
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        language: "unknown",
        command,
        args,
        exitCode: null,
        timedOut,
        stdout: normalizeOutput(stdout),
        stderr: normalizeOutput(stderr),
        error: error.message,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        language: "unknown",
        command,
        args,
        exitCode: code,
        timedOut,
        stdout: normalizeOutput(stdout),
        stderr: normalizeOutput(stderr),
      });
    });
  });

const writeTempCodeFile = async (code: string, ext: string): Promise<string> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "swiftdeploy-code-"));
  const file = path.join(dir, `snippet.${ext}`);
  await fs.writeFile(file, code, "utf8");
  return file;
};

const cleanupTempCodeFile = async (filePath: string): Promise<void> => {
  try {
    const dir = path.dirname(filePath);
    await fs.rm(dir, { recursive: true, force: true });
  } catch {}
};

const choosePythonCommand = async (
  scriptPath: string,
  timeoutMs: number,
): Promise<{ command: string; args: string[]; result: CodeExecutionResult } | null> => {
  for (const candidate of PYTHON_CANDIDATES) {
    const args = candidate === "py" ? ["-3", scriptPath] : [scriptPath];
    const result = await runProcess(candidate, args, { timeoutMs });
    if (
      result.ok ||
      result.timedOut ||
      (result.exitCode !== null && !/not found|enoent/i.test(result.error || ""))
    ) {
      return { command: candidate, args, result };
    }
  }
  return null;
};

export const executeCodeWithSubprocess = async (
  code: string,
  languageHint: string,
  opts?: { timeoutMs?: number },
): Promise<CodeExecutionResult> => {
  const source = String(code || "").trim();
  const language = String(languageHint || "text").toLowerCase();
  const timeoutMs = Math.max(100, Math.min(10_000, Number(opts?.timeoutMs) || 1500));

  if (!CODE_EXECUTION_ENABLED) {
    return {
      ok: false,
      language,
      command: "",
      args: [],
      exitCode: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      error: "ADVANCED_CODE_EXECUTION_ENABLED=false",
    };
  }
  if (!source) {
    return {
      ok: false,
      language,
      command: "",
      args: [],
      exitCode: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      error: "Empty code",
    };
  }
  if (Buffer.byteLength(source, "utf8") > MAX_CODE_BYTES) {
    return {
      ok: false,
      language,
      command: "",
      args: [],
      exitCode: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      error: `Code too large for execution (${Buffer.byteLength(source, "utf8")} bytes)`,
    };
  }

  if (["javascript", "js"].includes(language)) {
    const result = await runProcess(JS_EXECUTABLE, ["-e", source], { timeoutMs });
    return { ...result, language };
  }

  if (["python", "py"].includes(language)) {
    const file = await writeTempCodeFile(source, "py");
    try {
      const chosen = await choosePythonCommand(file, timeoutMs);
      if (!chosen) {
        return {
          ok: false,
          language,
          command: "",
          args: [],
          exitCode: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          error: "Python executable not found",
        };
      }
      return { ...chosen.result, language };
    } finally {
      await cleanupTempCodeFile(file);
    }
  }

  return {
    ok: false,
    language,
    command: "",
    args: [],
    exitCode: null,
    timedOut: false,
    stdout: "",
    stderr: "",
    error: `Execution not supported for language: ${language}`,
  };
};

export const executeCodeWithExecutionLayer = async (
  code: string,
  languageHint: string,
  opts?: { timeoutMs?: number },
): Promise<CodeExecutionResult> => {
  const cfg = getIsolatedRunnerConfig();
  if (isIsolatedRunnerConfigured()) {
    try {
      const remote = await executeCodeViaIsolatedRunner({
        code,
        language: languageHint,
        timeoutMs: opts?.timeoutMs,
      });
      // If remote returns a valid structured response, prefer it. Fall back only on transport/config errors.
      if (remote.ok || remote.exitCode !== null || remote.timedOut || remote.stderr || remote.stdout) {
        return remote;
      }
      if (cfg.required) return remote;
    } catch (error) {
      if (cfg.required) {
        return {
          ok: false,
          language: String(languageHint || "text"),
          command: "",
          args: [],
          exitCode: null,
          timedOut: false,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  return executeCodeWithSubprocess(code, languageHint, opts);
};
