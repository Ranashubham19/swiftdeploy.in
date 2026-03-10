import vm from "node:vm";

export type CodeValidationResult = {
  ok: boolean;
  language: string;
  error?: string;
  output?: string;
};

export const validateGeneratedCode = (
  code: string,
  languageHint: string,
): CodeValidationResult => {
  const source = String(code || "").trim();
  const language = String(languageHint || "text").toLowerCase();
  if (!source) return { ok: false, language, error: "Empty code" };

  if (language === "json") {
    try {
      JSON.parse(source);
      return { ok: true, language };
    } catch (error) {
      return { ok: false, language, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (["javascript", "js", "typescript", "ts"].includes(language)) {
    try {
      // Syntax check only (no execution).
      new vm.Script(source);
      return { ok: true, language };
    } catch (error) {
      return { ok: false, language, error: error instanceof Error ? error.message : String(error) };
    }
  }

  if (["python", "py"].includes(language)) {
    // Lightweight heuristic only (no interpreter dependency required).
    const hasDef = /\bdef\s+\w+\s*\(/.test(source);
    const hasIndentBlock = /:\n\s{2,}\S/.test(source) || !/:\n\S/.test(source);
    if (hasDef && !hasIndentBlock) {
      return { ok: false, language, error: "Python code may have invalid indentation after ':'" };
    }
    return { ok: true, language };
  }

  return { ok: true, language };
};

export const runJavascriptInSandbox = async (
  code: string,
  opts?: { timeoutMs?: number },
): Promise<CodeValidationResult> => {
  const source = String(code || "").trim();
  if (!source) return { ok: false, language: "javascript", error: "Empty code" };

  const logs: string[] = [];
  const sandbox = {
    console: {
      log: (...args: unknown[]) => logs.push(args.map((a) => String(a)).join(" ")),
    },
    setTimeout: undefined,
    setInterval: undefined,
    process: undefined,
    require: undefined,
    global: undefined,
    globalThis: {},
  } as any;

  try {
    vm.createContext(sandbox);
    const script = new vm.Script(source);
    script.runInContext(sandbox, { timeout: Math.max(50, Math.min(2000, opts?.timeoutMs ?? 700)) });
    return {
      ok: true,
      language: "javascript",
      output: logs.join("\n").slice(0, 4000),
    };
  } catch (error) {
    return {
      ok: false,
      language: "javascript",
      error: error instanceof Error ? error.message : String(error),
      output: logs.join("\n").slice(0, 2000),
    };
  }
};
