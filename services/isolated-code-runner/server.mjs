import express from "express";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

const app = express();
app.use(express.json({ limit: "256kb" }));

const PORT = Number(process.env.PORT || 8081);
const RUNNER_API_KEY = String(process.env.RUNNER_API_KEY || "").trim();
const NODE_BIN = String(process.env.NODE_EXECUTABLE || "node").trim();
const PYTHON_BIN = String(process.env.PYTHON_EXECUTABLE || "python3").trim();
const MAX_CODE_BYTES = Math.max(256, Math.min(100_000, Number(process.env.RUNNER_MAX_CODE_BYTES || 25_000)));
const DEFAULT_TIMEOUT_MS = Math.max(100, Math.min(10_000, Number(process.env.RUNNER_DEFAULT_TIMEOUT_MS || 1500)));
const MAX_TIMEOUT_MS = Math.max(DEFAULT_TIMEOUT_MS, Math.min(20_000, Number(process.env.RUNNER_MAX_TIMEOUT_MS || 5000)));
const MAX_CONCURRENT_JOBS = Math.max(1, Math.min(32, Number(process.env.RUNNER_MAX_CONCURRENT_JOBS || 4)));
const MAX_REQUESTS_PER_MINUTE = Math.max(10, Math.min(10_000, Number(process.env.RUNNER_MAX_REQUESTS_PER_MINUTE || 240)));
const AUDIT_LOG_FILE = String(process.env.RUNNER_AUDIT_LOG_FILE || "/tmp/isolated-runner-audit.log").trim();
const AUDIT_LOG_ENABLED = (process.env.RUNNER_AUDIT_LOG_ENABLED || "true").toLowerCase() !== "false";
const EXECUTION_DISABLE_NETWORK = (process.env.RUNNER_DISABLE_NETWORK || "false").toLowerCase() === "true";
const EXECUTION_DISABLE_NETWORK_STRICT = (process.env.RUNNER_DISABLE_NETWORK_STRICT || "false").toLowerCase() === "true";
const SANDBOX_UID = Number(process.env.RUNNER_SANDBOX_UID || 10001);
const SANDBOX_GID = Number(process.env.RUNNER_SANDBOX_GID || 10001);
const CHILD_ENV_ALLOWLIST = new Set(["PATH", "LANG", "LC_ALL", "PYTHONIOENCODING"]);

let activeJobs = 0;
const rateCounter = new Map();

const logAudit = async (event, payload) => {
  if (!AUDIT_LOG_ENABLED) return;
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...payload,
    }) + "\n";
    await fs.appendFile(AUDIT_LOG_FILE, line, "utf8");
  } catch {}
};

const rateLimit = (req, res, next) => {
  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown")
    .split(",")[0]
    .trim();
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `${ip}:${bucket}`;
  const count = Number(rateCounter.get(key) || 0) + 1;
  rateCounter.set(key, count);
  if (count > MAX_REQUESTS_PER_MINUTE) {
    void logAudit("rate_limited", { ip, count });
    return res.status(429).json({ ok: false, error: "Rate limit exceeded" });
  }
  // prune old buckets opportunistically
  if (rateCounter.size > 5000) {
    for (const existingKey of rateCounter.keys()) {
      if (!existingKey.endsWith(`:${bucket}`)) rateCounter.delete(existingKey);
    }
  }
  next();
};

const auth = (req, res, next) => {
  if (!RUNNER_API_KEY) return next();
  const key = String(req.headers["x-runner-api-key"] || "").trim();
  if (!key || key !== RUNNER_API_KEY) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  next();
};

app.use(rateLimit);

const runProcess = (command, args, timeoutMs) =>
  new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const childEnv = {};
    for (const key of CHILD_ENV_ALLOWLIST) {
      if (process.env[key]) childEnv[key] = process.env[key];
    }
    childEnv.PYTHONIOENCODING = "utf-8";
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      env: childEnv,
      ...(Number.isInteger(SANDBOX_UID) && SANDBOX_UID > 0 ? { uid: SANDBOX_UID } : {}),
      ...(Number.isInteger(SANDBOX_GID) && SANDBOX_GID > 0 ? { gid: SANDBOX_GID } : {}),
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    child.stdout?.on("data", (d) => { stdout += String(d); if (stdout.length > 20000) stdout = stdout.slice(0, 20000); });
    child.stderr?.on("data", (d) => { stderr += String(d); if (stderr.length > 20000) stderr = stderr.slice(0, 20000); });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        command,
        args,
        exitCode: null,
        timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: error.message,
      });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0 && !timedOut,
        command,
        args,
        exitCode: code,
        timedOut,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });

const withTempFile = async (ext, content, fn) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runner-"));
  const file = path.join(dir, `snippet.${ext}`);
  try {
    await fs.writeFile(file, content, "utf8");
    return await fn(file);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
};

const maybeWrapNetworkIsolation = (command, args) => {
  if (!EXECUTION_DISABLE_NETWORK) {
    return { command, args, isolation: "none" };
  }
  const hasUnshare = fsSync.existsSync("/usr/bin/unshare") || fsSync.existsSync("/bin/unshare");
  if (!hasUnshare) {
    if (EXECUTION_DISABLE_NETWORK_STRICT) {
      throw new Error("RUNNER_DISABLE_NETWORK=true but 'unshare' is unavailable");
    }
    return { command, args, isolation: "none-unshare-missing" };
  }
  return {
    command: "unshare",
    args: ["-n", "--", command, ...args],
    isolation: "unshare-netns",
  };
};

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "isolated-code-runner",
    activeJobs,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    rateLimitPerMinute: MAX_REQUESTS_PER_MINUTE,
    networkIsolation: EXECUTION_DISABLE_NETWORK,
    sandboxUid: SANDBOX_UID,
    sandboxGid: SANDBOX_GID,
  });
});

app.post("/execute", auth, async (req, res) => {
  const code = String(req.body?.code || "");
  const language = String(req.body?.language || "").toLowerCase().trim();
  const timeoutMs = Math.max(100, Math.min(MAX_TIMEOUT_MS, Number(req.body?.timeoutMs || DEFAULT_TIMEOUT_MS)));

  if (!["javascript", "js", "python", "py"].includes(language)) {
    return res.status(400).json({ ok: false, error: "Unsupported language" });
  }
  if (!code.trim()) {
    return res.status(400).json({ ok: false, error: "Empty code" });
  }
  if (Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
    return res.status(413).json({ ok: false, error: "Code too large" });
  }

  let jobStarted = false;
  try {
    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      await logAudit("queue_reject", { language, activeJobs, max: MAX_CONCURRENT_JOBS });
      return res.status(503).json({ ok: false, error: "Runner busy" });
    }
    activeJobs += 1;
    jobStarted = true;
    if (language === "javascript" || language === "js") {
      const wrapped = maybeWrapNetworkIsolation(NODE_BIN, ["-e", code]);
      const result = await runProcess(wrapped.command, wrapped.args, timeoutMs);
      await logAudit("execute", {
        language: "javascript",
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        isolation: wrapped.isolation,
        bytes: Buffer.byteLength(code, "utf8"),
      });
      return res.json({ ...result, language: "javascript" });
    }
    const result = await withTempFile("py", code, async (file) => {
      const wrapped = maybeWrapNetworkIsolation(PYTHON_BIN, [file]);
      const out = await runProcess(wrapped.command, wrapped.args, timeoutMs);
      out._isolation = wrapped.isolation;
      return out;
    });
    await logAudit("execute", {
      language: "python",
      ok: result.ok,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      isolation: result._isolation || "unknown",
      bytes: Buffer.byteLength(code, "utf8"),
    });
    delete result._isolation;
    return res.json({ ...result, language: "python" });
  } catch (error) {
    await logAudit("execute_error", {
      language,
      error: error instanceof Error ? error.message : String(error),
      bytes: Buffer.byteLength(code, "utf8"),
    });
    return res.status(500).json({
      ok: false,
      language,
      command: "",
      args: [],
      exitCode: null,
      timedOut: false,
      stdout: "",
      stderr: "",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (jobStarted) {
      activeJobs = Math.max(0, activeJobs - 1);
    }
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`isolated-code-runner listening on ${PORT}`);
});
