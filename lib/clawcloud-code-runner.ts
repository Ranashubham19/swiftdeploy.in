const PISTON_URL = "https://emkc.org/api/v2/piston/execute";
const EXEC_TIMEOUT_MS = 12_000;
const MAX_OUTPUT_CHARS = 2_000;

type ExtractedCode = {
  language: string;
  code: string;
  pistonConfig: { language: string; version: string } | null;
};

type PistonResult = {
  run?: {
    stdout?: string;
    stderr?: string;
    output?: string;
    code?: number | null;
    signal?: string | null;
  };
};

const PISTON_LANGUAGES: Record<string, { language: string; version: string }> = {
  python: { language: "python", version: "3.10.0" },
  python3: { language: "python", version: "3.10.0" },
  py: { language: "python", version: "3.10.0" },
  javascript: { language: "javascript", version: "18.15.0" },
  js: { language: "javascript", version: "18.15.0" },
  node: { language: "javascript", version: "18.15.0" },
  typescript: { language: "typescript", version: "5.0.3" },
  ts: { language: "typescript", version: "5.0.3" },
  java: { language: "java", version: "15.0.2" },
  "c++": { language: "c++", version: "10.2.0" },
  cpp: { language: "c++", version: "10.2.0" },
  c: { language: "c", version: "10.2.0" },
  rust: { language: "rust", version: "1.56.0" },
  go: { language: "go", version: "1.18.0" },
  golang: { language: "go", version: "1.18.0" },
  ruby: { language: "ruby", version: "3.0.1" },
  php: { language: "php", version: "8.2.3" },
  bash: { language: "bash", version: "5.2.0" },
  shell: { language: "bash", version: "5.2.0" },
  swift: { language: "swift", version: "5.5.0" },
  kotlin: { language: "kotlin", version: "1.6.10" },
  r: { language: "r", version: "4.1.1" },
  sql: { language: "sqlite3", version: "3.36.0" },
};

const RUN_CODE_PATTERNS = [
  /\b(run|execute|eval|test|check)\s+(this\s+)?(code|script|program|function)\b/i,
  /\b(run|execute)\s+(in\s+)?(python|javascript|js|java|c\+\+|cpp|rust|go|ruby|php|bash|typescript|swift|kotlin|r|sql)\b/i,
  /^run\b/i,
  /^execute\b/i,
  /^test this\b/i,
];

function stripLeadingInstruction(message: string) {
  return message
    .replace(/^(run|execute|test|check)\s+(this\s+)?/i, "")
    .replace(/^(in|using|with)\s+(python|javascript|js|java|c\+\+|cpp|rust|go|ruby|php|bash|typescript|swift|kotlin|r|sql)\s*/i, "")
    .replace(/^(code|script|program)\s*:?/i, "")
    .trim();
}

export function detectCodeRunIntent(message: string) {
  const hasPattern = RUN_CODE_PATTERNS.some((pattern) => pattern.test(message));
  const hasCodeBlock = message.includes("```");
  return hasPattern || (hasCodeBlock && /\b(run|execute|output|result|what does this|what will this)\b/i.test(message));
}

export function extractCode(message: string): ExtractedCode | null {
  const fencedMatch = message.match(/```([\w#+-]+)?\s*\n?([\s\S]+?)```/);
  if (fencedMatch) {
    const language = (fencedMatch[1] ?? "python").toLowerCase().trim();
    const code = fencedMatch[2].trim();
    return {
      language,
      code,
      pistonConfig: PISTON_LANGUAGES[language] ?? PISTON_LANGUAGES.python,
    };
  }

  const languageMatch = message.match(
    /\b(in|using|with)\s+(python|javascript|js|java|c\+\+|cpp|rust|go|ruby|php|bash|typescript|swift|kotlin|r|sql)\b/i,
  );
  const language = languageMatch?.[2]?.toLowerCase() ?? "python";
  const colonIndex = message.indexOf(":");
  const newlineIndex = message.indexOf("\n");
  const breakIndex = [colonIndex, newlineIndex].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  const candidate = breakIndex === undefined
    ? stripLeadingInstruction(message)
    : message.slice(breakIndex + 1).trim();

  if (candidate.length < 3) {
    return null;
  }

  return {
    language,
    code: candidate,
    pistonConfig: PISTON_LANGUAGES[language] ?? PISTON_LANGUAGES.python,
  };
}

async function executeWithPiston(language: string, version: string, code: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXEC_TIMEOUT_MS);

  try {
    const response = await fetch(PISTON_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language,
        version,
        files: [{ name: "main", content: code }],
        stdin: "",
        args: [],
        compile_timeout: 10_000,
        run_timeout: 8_000,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as PistonResult;
    return {
      output: (data.run?.stdout ?? data.run?.output ?? "").trim(),
      error: (data.run?.stderr ?? "").trim(),
      exitCode: data.run?.code ?? 0,
    };
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      return {
        output: "",
        error: "Execution timed out (10 second limit).",
        exitCode: 1,
      };
    }

    console.error("[code-runner] piston error:", error instanceof Error ? error.message : error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function formatExecutionResult(
  language: string,
  result: { output: string; error: string; exitCode: number },
) {
  const label = language.charAt(0).toUpperCase() + language.slice(1);
  const success = result.exitCode === 0;
  const lines = [`${success ? "✅" : "❌"} *${label} execution ${success ? "succeeded" : "failed"}*`, ""];

  if (result.output) {
    const output = result.output.slice(0, MAX_OUTPUT_CHARS);
    lines.push("*Output:*");
    lines.push("```");
    lines.push(output);
    if (result.output.length > MAX_OUTPUT_CHARS) {
      lines.push(`... (truncated from ${result.output.length} chars)`);
    }
    lines.push("```");
  }

  if (result.error) {
    lines.push(result.output ? "" : "", "*Error:*");
    lines.push("```");
    lines.push(result.error.slice(0, 800));
    lines.push("```");
  }

  if (!result.output && !result.error) {
    lines.push("_(No output)_");
  }

  lines.push("", `_Executed via Piston sandbox - ${label}_`);
  return lines.join("\n");
}

export async function runUserCode(message: string) {
  const extracted = extractCode(message);
  if (!extracted) {
    return [
      "💻 *Code execution*",
      "",
      "Send code in a fenced block or after a prompt like:",
      "_Run this Python code: print(2 + 2)_",
      "",
      "Supported: Python, JavaScript, TypeScript, Java, C++, Go, Rust, Ruby, PHP, Bash, Swift, Kotlin, R, SQL",
    ].join("\n");
  }

  if (!extracted.pistonConfig) {
    return `❌ *${extracted.language} isn't supported for execution right now.*`;
  }

  const result = await executeWithPiston(
    extracted.pistonConfig.language,
    extracted.pistonConfig.version,
    extracted.code,
  );

  if (!result) {
    return [
      "❌ *Code execution is temporarily unavailable.*",
      "",
      "Please try again in a moment.",
    ].join("\n");
  }

  return formatExecutionResult(extracted.language, result);
}

export function isCodeRunnerAvailable() {
  return true;
}
