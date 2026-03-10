import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateBotResponse } from '../aiService.js';

type EvalCase = {
  id: string;
  category?: string;
  prompt: string;
  minChars?: number;
  mustIncludeAny?: string[];
  mustIncludeAll?: string[];
};

type EvalResult = {
  id: string;
  category: string;
  ok: boolean;
  latencyMs: number;
  responseChars: number;
  checks: string[];
  errors: string[];
  prompt: string;
  responsePreview: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendDir = path.resolve(__dirname, '..');

const DEFAULT_PROMPTS_PATH = path.resolve(backendDir, 'evals', 'smoke-prompts.json');
const DEFAULT_TIMEOUT_MS = Math.max(10_000, Number(process.env.AI_EVAL_TIMEOUT_MS || 45_000));

const LOW_VALUE_PATTERNS: RegExp[] = [
  /ask (?:one clear )?question/i,
  /ask any question and i will answer/i,
  /i am ready to help/i,
  /temporary .* issue/i,
  /please resend the same question/i,
  /reliable answer unavailable/i,
  /could not generate a reliable answer/i,
  /could not process that request right now/i,
];

const ERROR_MARKERS: RegExp[] = [
  /^AI_GENERATION_FAILED:/i,
  /^INVALID_PROVIDER_KEY:/i,
  /^RATE_LIMIT_EXCEEDED:/i,
  /^NETWORK_ERROR:/i,
  /\bOPENROUTER_ERROR\b/i,
  /\bGEMINI_ERROR\b/i,
];

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs)
    )
  ]);
};

const parseArgs = (): { promptsPath: string; timeoutMs: number } => {
  const args = process.argv.slice(2);
  let promptsPath = DEFAULT_PROMPTS_PATH;
  let timeoutMs = DEFAULT_TIMEOUT_MS;

  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i] || '');
    if ((arg === '--prompts' || arg === '-p') && args[i + 1]) {
      promptsPath = path.resolve(process.cwd(), String(args[i + 1]));
      i += 1;
      continue;
    }
    if ((arg === '--timeout' || arg === '-t') && args[i + 1]) {
      const parsed = Number(args[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) timeoutMs = parsed;
      i += 1;
      continue;
    }
  }

  return { promptsPath, timeoutMs };
};

const normalizeText = (value: string): string =>
  String(value || '')
    .replace(/```[\s\S]*?```/g, ' code ')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const evaluateOne = async (testCase: EvalCase, timeoutMs: number): Promise<EvalResult> => {
  const startedAt = Date.now();
  const checks: string[] = [];
  const errors: string[] = [];
  let response = '';

  try {
    response = await withTimeout(
      generateBotResponse(String(testCase.prompt || '').trim()),
      timeoutMs,
      testCase.id || 'eval'
    );
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: testCase.id,
      category: testCase.category || 'unknown',
      ok: false,
      latencyMs,
      responseChars: 0,
      checks,
      errors: [`runtime_error:${message}`],
      prompt: testCase.prompt,
      responsePreview: ''
    };
  }

  const output = String(response || '').trim();
  const normalized = normalizeText(output);
  const latencyMs = Date.now() - startedAt;

  if (output) checks.push('non_empty');
  if (!output) errors.push('empty_output');

  if (testCase.minChars && output.length >= testCase.minChars) {
    checks.push(`min_chars:${testCase.minChars}`);
  } else if (testCase.minChars) {
    errors.push(`too_short:${output.length}<${testCase.minChars}`);
  }

  if (testCase.mustIncludeAny?.length) {
    const matched = testCase.mustIncludeAny.some((token) =>
      output.toLowerCase().includes(String(token).toLowerCase())
    );
    if (matched) {
      checks.push('must_include_any');
    } else {
      errors.push(`missing_any:${testCase.mustIncludeAny.join('|')}`);
    }
  }

  if (testCase.mustIncludeAll?.length) {
    const missing = testCase.mustIncludeAll.filter(
      (token) => !output.toLowerCase().includes(String(token).toLowerCase())
    );
    if (missing.length === 0) {
      checks.push('must_include_all');
    } else {
      errors.push(`missing_all:${missing.join('|')}`);
    }
  }

  if (ERROR_MARKERS.some((pattern) => pattern.test(output))) {
    errors.push('error_marker_output');
  } else {
    checks.push('no_error_marker');
  }

  if (LOW_VALUE_PATTERNS.some((pattern) => pattern.test(normalized))) {
    errors.push('generic_deflection_output');
  } else {
    checks.push('no_generic_deflection');
  }

  const ok = errors.length === 0;
  return {
    id: testCase.id,
    category: testCase.category || 'unknown',
    ok,
    latencyMs,
    responseChars: output.length,
    checks,
    errors,
    prompt: testCase.prompt,
    responsePreview: output.slice(0, 500)
  };
};

const main = async (): Promise<void> => {
  const { promptsPath, timeoutMs } = parseArgs();
  const raw = await fs.readFile(promptsPath, 'utf8');
  const cases = JSON.parse(raw) as EvalCase[];

  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`No eval cases found in ${promptsPath}`);
  }

  console.log(`[AI_EVAL] cases=${cases.length} timeoutMs=${timeoutMs}`);
  console.log(`[AI_EVAL] prompts=${promptsPath}`);
  console.log(`[AI_EVAL] openrouter=${Boolean(process.env.OPENROUTER_API_KEY)} gemini=${Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)}`);

  const results: EvalResult[] = [];
  for (const testCase of cases) {
    const result = await evaluateOne(testCase, timeoutMs);
    results.push(result);
    const status = result.ok ? 'PASS' : 'FAIL';
    console.log(
      `[${status}] ${result.id} (${result.category}) ${result.latencyMs}ms chars=${result.responseChars}`
      + (result.errors.length ? ` errors=${result.errors.join(',')}` : '')
    );
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const avgLatency = Math.round(
    results.reduce((sum, r) => sum + r.latencyMs, 0) / Math.max(1, results.length)
  );

  const reportsDir = path.resolve(backendDir, 'evals', 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.resolve(reportsDir, `ai-eval-${timestamp}.json`);

  await fs.writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        promptsPath,
        timeoutMs,
        summary: {
          total: results.length,
          passed,
          failed,
          avgLatencyMs: avgLatency
        },
        results
      },
      null,
      2
    ),
    'utf8'
  );

  console.log(`[AI_EVAL] summary total=${results.length} passed=${passed} failed=${failed} avgLatencyMs=${avgLatency}`);
  console.log(`[AI_EVAL] report=${reportPath}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error('[AI_EVAL] fatal', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
