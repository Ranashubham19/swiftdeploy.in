import vm from "node:vm";
import { executeCodeWithExecutionLayer, isSubprocessCodeExecutionEnabled } from "./processCodeRunner.js";

const CODE_TOOL_ENABLED =
  (process.env.CODE_TOOL_ENABLED || "false").toLowerCase() === "true";

export const isCodeToolEnabled = (): boolean => CODE_TOOL_ENABLED;
export const isProcessCodeToolEnabled = (): boolean =>
  CODE_TOOL_ENABLED && isSubprocessCodeExecutionEnabled();

export const validateJsSyntax = (code: string): string => {
  const source = String(code || "").trim();
  if (!source) throw new Error("code is required");
  new vm.Script(source);
  return "JavaScript syntax OK";
};

export const runJsSandbox = (code: string, timeoutMs = 700): string => {
  const source = String(code || "").trim();
  if (!source) throw new Error("code is required");
  if (!CODE_TOOL_ENABLED) {
    throw new Error("CODE_TOOL_ENABLED=false");
  }

  const logs: string[] = [];
  const ctx = vm.createContext({
    console: {
      log: (...args: unknown[]) => logs.push(args.map((x) => String(x)).join(" ")),
    },
  });
  const script = new vm.Script(source);
  script.runInContext(ctx, {
    timeout: Math.max(50, Math.min(2000, Number(timeoutMs) || 700)),
  });
  return logs.join("\n") || "(no output)";
};

export const runCodeSubprocessTool = async (
  code: string,
  language: string,
  timeoutMs = 1200,
): Promise<string> => {
  if (!CODE_TOOL_ENABLED) {
    throw new Error("CODE_TOOL_ENABLED=false");
  }
  const result = await executeCodeWithExecutionLayer(code, language, { timeoutMs });
  const payload = {
    ok: result.ok,
    language: result.language,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
  return JSON.stringify(payload);
};
