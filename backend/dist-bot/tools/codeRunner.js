import vm from "node:vm";
import { executeCodeWithExecutionLayer, isSubprocessCodeExecutionEnabled } from "./processCodeRunner.js";
const CODE_TOOL_ENABLED = (process.env.CODE_TOOL_ENABLED || "false").toLowerCase() === "true";
export const isCodeToolEnabled = () => CODE_TOOL_ENABLED;
export const isProcessCodeToolEnabled = () => CODE_TOOL_ENABLED && isSubprocessCodeExecutionEnabled();
export const validateJsSyntax = (code) => {
    const source = String(code || "").trim();
    if (!source)
        throw new Error("code is required");
    new vm.Script(source);
    return "JavaScript syntax OK";
};
export const runJsSandbox = (code, timeoutMs = 700) => {
    const source = String(code || "").trim();
    if (!source)
        throw new Error("code is required");
    if (!CODE_TOOL_ENABLED) {
        throw new Error("CODE_TOOL_ENABLED=false");
    }
    const logs = [];
    const ctx = vm.createContext({
        console: {
            log: (...args) => logs.push(args.map((x) => String(x)).join(" ")),
        },
    });
    const script = new vm.Script(source);
    script.runInContext(ctx, {
        timeout: Math.max(50, Math.min(2000, Number(timeoutMs) || 700)),
    });
    return logs.join("\n") || "(no output)";
};
export const runCodeSubprocessTool = async (code, language, timeoutMs = 1200) => {
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
