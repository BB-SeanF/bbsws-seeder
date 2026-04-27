#!/usr/bin/env node
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSeederContext, resolveAuthFileForSchool } from "./ui.js";
import { goToCategoryPage } from "./nav.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const webDir = path.join(rootDir, "web");

const port = Number(process.env.PORT || 4310);

let nextJobId = 1;
const jobs = [];
let active = null;
let pendingRun = null;
const sessionStatusCache = new Map();
const schoolValidationCache = new Map();

const SESSION_STATUS_TTL_MS = 30_000;
const SCHOOL_VALIDATION_TTL_MS = 5 * 60_000;
const VALID_RUN_TYPES = ["news", "events", "text", "links", "lists", "downloads", "photos"];

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function sendText(res, status, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(text);
}

function sendFile(res, filePath, contentType) {
  if (!fs.existsSync(filePath)) {
    sendText(res, 404, `Missing ${path.relative(rootDir, filePath)}`);
    return;
  }

  sendText(res, 200, fs.readFileSync(filePath, "utf8"), contentType);
}

function createJob(type, command, args, metadata = {}) {
  const job = {
    id: String(nextJobId++),
    type,
    command,
    args,
    metadata,
    status: "running",
    startedAt: nowIso(),
    endedAt: null,
    exitCode: null,
    logs: ""
  };
  jobs.unshift(job);
  if (jobs.length > 50) jobs.length = 50;
  return job;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function appendLog(job, text) {
  if (!text) return;
  job.logs += text;
  if (job.logs.length > 2_000_000) {
    job.logs = job.logs.slice(-1_000_000);
  }
}

function canStartProcess() {
  return active == null;
}

function childEnv() {
  return {
    ...process.env,
    BBSWS_WEB_MODE: "1"
  };
}

function shouldAutoRecoverSession(job, code) {
  if (!job || job.type !== "seed-all" || code === 0) return false;
  if (!/SESSION_EXPIRED|AUTH_MISSING/.test(job.logs || "")) return false;

  const retryCount = Number(job.metadata?.options?._sessionRetryCount || 0);
  return retryCount < 1;
}

function spawnJob({ type, command, args, metadata }) {
  if (!canStartProcess()) {
    throw new Error("Another process is already running");
  }

  const job = createJob(type, command, args, metadata);
  const completion = deferred();
  const child = spawn(command, args, {
    cwd: rootDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: childEnv()
  });

  active = {
    type,
    child,
    jobId: job.id,
    cancelled: false,
    completion: completion.promise
  };

  child.stdout.on("data", (buf) => appendLog(job, buf.toString()));
  child.stderr.on("data", (buf) => appendLog(job, buf.toString()));

  child.on("error", (err) => {
    appendLog(job, `\n[server] process error: ${err.message}\n`);
    completion.reject(err);
  });

  child.on("close", (code) => {
    job.status = active?.cancelled ? "stopped" : (code === 0 ? "completed" : "failed");
    job.exitCode = code;
    job.endedAt = nowIso();

    const finishedType = active?.type;
    active = null;

    if (shouldAutoRecoverSession(job, code)) {
      const school = job.metadata?.school;
      const options = {
        ...(job.metadata?.options || {}),
        _sessionRetryCount: Number(job.metadata?.options?._sessionRetryCount || 0) + 1
      };
      const authMissing = /AUTH_MISSING/.test(job.logs || "");
      const recoveryReason = authMissing ? "Missing auth" : "Session expired";

      appendLog(job, `\n[server] ${recoveryReason}. Starting login flow automatically so the run can resume.\n`);
      pendingRun = { school, options };

      try {
        const loginJob = startLoginJob(school);
        appendLog(job, `[server] Login job ${loginJob.id} started. Complete BBID and click Complete Login.\n`);
      } catch (err) {
        appendLog(job, `[server] Failed to auto-start login recovery: ${err.message}\n`);
        pendingRun = null;
      }
      return;
    }

    if (finishedType === "login" && code === 0 && pendingRun) {
      const next = pendingRun;
      pendingRun = null;
      refreshSessionStatus(next.school, true);
      try {
        startRunJob(next.school, next.options);
      } catch (err) {
        const pendingJob = createJob(
          "seed-all",
          "node",
          ["./scripts/seed-all.js"],
          {
            school: next.school,
            options: next.options,
            launchedFromPending: true
          }
        );
        pendingJob.status = "failed";
        pendingJob.endedAt = nowIso();
        pendingJob.exitCode = 1;
        appendLog(pendingJob, `[server] failed to auto-start pending run: ${err.message}\n`);
      }
    }

    if (finishedType === "login" && code !== 0) {
      pendingRun = null;
    }

    if (finishedType === "login") {
      refreshSessionStatus(job.metadata?.school, true);
    }

    completion.resolve({
      jobId: job.id,
      type: job.type,
      exitCode: code,
      status: job.status
    });
  });

  return job;
}

function normalizeSchool(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

function authFileFor(school) {
  return resolveAuthFileForSchool(school, rootDir);
}

function schoolUrlFor(school) {
  return `https://${school}.myschoolapp.com/`;
}

async function probeSchoolAvailability(school) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(schoolUrlFor(school), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "User-Agent": "bbsws-seeder-web/1.0"
      }
    });

    if ((res.status >= 200 && res.status < 400) || res.status === 401 || res.status === 403) {
      return { ok: true };
    }

    return {
      ok: false,
      detail: `School site check failed with HTTP ${res.status}.`
    };
  } catch (err) {
    if (err?.name === "AbortError") {
      return { ok: false, detail: "School site check timed out." };
    }

    return {
      ok: false,
      detail: "School site could not be reached."
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateSchoolOrThrow(school) {
  const cached = schoolValidationCache.get(school);
  const isFresh = cached && Date.now() - cached.checkedAt < SCHOOL_VALIDATION_TTL_MS;

  if (isFresh) {
    if (cached.ok) return;
    throw new Error(cached.message);
  }

  const result = await probeSchoolAvailability(school);
  const message = result.ok
    ? ""
    : `Unknown or unreachable school: ${school}. ${result.detail} Check the school slug and try again.`;

  schoolValidationCache.set(school, {
    ok: result.ok,
    checkedAt: Date.now(),
    message
  });

  if (!result.ok) {
    throw new Error(message);
  }
}

async function probeSessionStatus(school) {
  if (!school) {
    return { status: "unknown", detail: "Select a school to check auth." };
  }

  const authFile = authFileFor(school);
  if (!fs.existsSync(authFile)) {
    return { status: "missing", detail: "No saved auth file for this school." };
  }

  let browser;
  try {
    const contextBundle = await createSeederContext(authFile, true);
    browser = contextBundle.browser;
    await goToCategoryPage(contextBundle.page, { school, type: "text", timeoutMs: 8000 });
    return { status: "active", detail: "Saved auth is active." };
  } catch (err) {
    if (String(err?.message || "").includes("SESSION_EXPIRED")) {
      return { status: "expired", detail: "Saved auth has expired or is no longer valid." };
    }
    return { status: "error", detail: err?.message || "Unable to verify auth." };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

function refreshSessionStatus(school, force = false) {
  const normalizedSchool = normalizeSchool(school);
  if (!normalizedSchool) return;

  const key = normalizedSchool;
  const existing = sessionStatusCache.get(key);
  const isFresh = existing && Date.now() - existing.updatedAt < SESSION_STATUS_TTL_MS;

  if (!force && (existing?.inFlight || isFresh)) {
    return;
  }

  sessionStatusCache.set(key, {
    value: {
      status: "checking",
      detail: "Checking saved auth...",
      school: normalizedSchool,
      checkedAt: existing?.value?.checkedAt || null
    },
    updatedAt: existing?.updatedAt || 0,
    inFlight: probeSessionStatus(normalizedSchool)
      .then((value) => {
        sessionStatusCache.set(key, {
          value: {
            ...value,
            school: normalizedSchool,
            checkedAt: nowIso()
          },
          updatedAt: Date.now(),
          inFlight: null
        });
      })
      .catch((err) => {
        sessionStatusCache.set(key, {
          value: {
            status: "error",
            detail: err?.message || "Unable to verify auth.",
            school: normalizedSchool,
            checkedAt: nowIso()
          },
          updatedAt: Date.now(),
          inFlight: null
        });
      })
  });
}

function getSessionStatusSnapshot(school) {
  const normalizedSchool = normalizeSchool(school);

  if (!normalizedSchool) {
    return {
      status: "unknown",
      detail: "Select a school to check auth.",
      school: "",
      checkedAt: null
    };
  }

  const key = normalizedSchool;
  const existing = sessionStatusCache.get(key);
  const isFresh = existing && Date.now() - existing.updatedAt < SESSION_STATUS_TTL_MS;

  if (!existing || !isFresh) {
    refreshSessionStatus(normalizedSchool);
  }

  return existing?.value || {
    status: "checking",
    detail: "Checking saved auth...",
    school: normalizedSchool,
    checkedAt: null
  };
}

function splitTypes(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeRunTypeToken(token) {
  return String(token || "")
    .trim()
    .toLowerCase()
    .replace(/^seed-/, "")
    .replace(/\.js$/, "");
}

function validateTypesOrThrow(raw) {
  const requested = splitTypes(raw).map((token) => normalizeRunTypeToken(token));
  if (requested.length === 0) return;

  const invalid = [...new Set(requested.filter((token) => !VALID_RUN_TYPES.includes(token)))];
  if (invalid.length === 0) return;

  throw new Error(
    `Invalid --types value(s): ${invalid.join(", ")}. Supported types: ${VALID_RUN_TYPES.join(", ")}`
  );
}

function startLoginJob(school) {
  const args = ["./scripts/login.js", "--school", school];
  return spawnJob({
    type: "login",
    command: "node",
    args,
    metadata: { school }
  });
}

function startRunJob(school, options = {}) {
  const args = ["./scripts/seed-all.js", "--school", school];

  const types = splitTypes(options.types);
  if (types.length > 0) {
    args.push("--types", types.join(","));
  }

  if (options.preCheck !== false) args.push("--pre-check");
  if (options.dryRun) args.push("--dry-run");

  if (options.headless !== false) {
    args.push("--headless");
  } else {
    args.push("--headed");
  }

  const timeoutMs = Number(options.timeoutMs || 5000);
  if (Number.isFinite(timeoutMs) && timeoutMs >= 1000) {
    args.push("--timeout-ms", String(timeoutMs));
  }

  // Web server owns session recovery and user prompts; disable CLI self-retry here.
  args.push("--no-auto-login-retry");

  return spawnJob({
    type: "seed-all",
    command: "node",
    args,
    metadata: { school, options }
  });
}

function getState(school = "") {
  const recent = jobs.slice(0, 10).map((job) => ({
    id: job.id,
    type: job.type,
    status: job.status,
    startedAt: job.startedAt,
    endedAt: job.endedAt,
    exitCode: job.exitCode,
    metadata: job.metadata
  }));

  return {
    active: active
      ? {
          type: active.type,
          jobId: active.jobId
        }
      : null,
    pendingRun,
    sessionStatus: getSessionStatusSnapshot(school),
    recentJobs: recent
  };
}

function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/app.css") {
    sendFile(res, path.join(webDir, "app.css"), "text/css; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/") {
    sendFile(res, path.join(webDir, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, getState(url.searchParams.get("school") || ""));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const id = url.pathname.split("/").at(-1);
    const job = jobs.find((j) => j.id === id);
    if (!job) {
      sendJson(res, 404, { error: "Job not found" });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login/start") {
    readBody(req)
      .then(async (raw) => {
        const body = safeJsonParse(raw) || {};
        const school = normalizeSchool(body.school);

        if (!school) {
          sendJson(res, 400, { error: "school is required" });
          return;
        }

        if (!canStartProcess()) {
          sendJson(res, 409, { error: "Another process is running", active: getState().active });
          return;
        }

        await validateSchoolOrThrow(school);

        pendingRun = null;
        const job = startLoginJob(school);
        sendJson(res, 200, {
          ok: true,
          message: "Login started. Complete BBID in the opened browser, then click Complete Login.",
          jobId: job.id
        });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/login/complete") {
    if (!active || active.type !== "login") {
      sendJson(res, 400, { error: "No active login process" });
      return;
    }

    const loginCompletion = active.completion;
    const hadPendingRun = !!pendingRun;

    active.child.stdin.write("\n");

    loginCompletion
      .then(() => {
        const resumedRunJobId = hadPendingRun && active?.type === "seed-all" ? active.jobId : null;
        sendJson(res, 200, {
          ok: true,
          message: resumedRunJobId
            ? "Login completed. Resuming queued seeder run."
            : "Login completed.",
          resumedRunJobId
        });
      })
      .catch((err) => {
        sendJson(res, 500, { error: err?.message || "Login completion failed" });
      });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/run") {
    readBody(req)
      .then(async (raw) => {
        const body = safeJsonParse(raw) || {};
        const school = normalizeSchool(body.school);
        const options = {
          types: body.types || "",
          preCheck: body.preCheck !== false,
          dryRun: !!body.dryRun,
          headless: body.headless !== false,
          timeoutMs: body.timeoutMs
        };

        if (!school) {
          sendJson(res, 400, { error: "school is required" });
          return;
        }

        if (!canStartProcess()) {
          sendJson(res, 409, { error: "Another process is running", active: getState().active });
          return;
        }

        validateTypesOrThrow(options.types);
        await validateSchoolOrThrow(school);

        const authFile = authFileFor(school);
        if (!fs.existsSync(authFile)) {
          pendingRun = { school, options };
          const loginJob = startLoginJob(school);
          sendJson(res, 200, {
            ok: true,
            status: "login-required",
            message: `No saved login state found for school '${school}'. Login started; complete sign-in to continue.`,
            loginJobId: loginJob.id
          });
          return;
        }

        const job = startRunJob(school, options);
        sendJson(res, 200, { ok: true, status: "running", jobId: job.id });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/active/cancel") {
    if (!active) {
      sendJson(res, 400, { error: "No active process" });
      return;
    }

    const child = active.child;
    let exited = false;

    active.cancelled = true;

    try {
      child.kill("SIGTERM");

      const killTimeout = setTimeout(() => {
        // Only send SIGKILL if process hasn't exited yet
        if (!exited && child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 2000);

      child.once("exit", () => {
        exited = true;
        clearTimeout(killTimeout);
      });
    } catch (err) {
      const msg = `[server] Cancel error: ${err.message}\n`;
      if (jobs.length > 0) appendLog(jobs[0], msg);
    }

    pendingRun = null;
    sendJson(res, 200, { ok: true, message: "Cancel signal sent" });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

const server = http.createServer(route);
server.listen(port, () => {
  console.log(`Web runner available at http://localhost:${port}`);
});
