// Local dev-server lifecycle for `pinned test` HTTP-pin verification.
//
// When config.http.mode === "local", `pinned test` calls startIfNeeded()
// before invoking vitest. The function:
//
//   1. Probes config.http.url + config.http.ready_path.
//      a. Server already responding → return { url, started: false }.
//         We will NOT shut it down — it was already running, the user
//         doesn't expect us to kill it (per GPT's safety rule).
//      b. Not responding → spawn config.http.start (default: `npm run dev`)
//         as a child process. Tokenized with parseSimpleArgv (no shell).
//   2. Polls the URL every 500ms until it responds with any HTTP status
//      (we don't require 200 — auth-gated dev servers often return 401
//      at "/", which still means the server is up). Timeout from
//      config.http.timeout_seconds (default 60s).
//   3. Returns { url, started: true, stop } so the caller can clean up
//      the spawned process when vitest completes.
//
// SAFETY rules (per GPT's guardrails):
//   - Never spawn from statusline / chat hook — only from explicit
//     `pinned test`. Statusline / hooks DON'T call this module.
//   - Only kill processes we started. The probe-first design ensures
//     we attach to existing dev servers without taking ownership.
//   - Timeouts surface as a clear "dev server not ready in N seconds"
//     message — never a silent hang.
//   - Show child-process logs only on FAILURE (startup timeout or
//     non-zero exit). On success, the dev server's output is suppressed
//     to keep the terminal clean.
//
// This module is Node-only. Browser-safe code (claimParser, scanDiff,
// templates) must not import it.

import { spawn, type ChildProcess } from "node:child_process";
import { parseSimpleArgv } from "./templates/cliOutputContains.js";

export type DevServerHandle = {
  url: string;
  // True when this module spawned the process. False when an existing
  // dev server was detected and reused.
  started: boolean;
  // Best-effort cleanup. Only sends signals to the process we started;
  // a noop when started=false (we don't own the externally-running
  // server).
  stop: () => Promise<void>;
};

export type DevServerOptions = {
  start: string;
  url: string;
  readyPath: string;
  timeoutSeconds: number;
  cwd: string;
  // Optional logger. Defaults to console.error so the line shows up
  // alongside vitest output, not on stdout (which AI agents may parse).
  log?: (msg: string) => void;
};

export async function startIfNeeded(opts: DevServerOptions): Promise<DevServerHandle> {
  const log = opts.log ?? ((msg) => process.stderr.write(msg + "\n"));
  const probeUrl = stripTrailingSlash(opts.url) + opts.readyPath;

  // Step 1: probe the URL. If it responds, reuse and skip spawning.
  if (await probe(probeUrl)) {
    log(`◆ pinned dev: reusing existing dev server at ${opts.url}`);
    return { url: opts.url, started: false, stop: async () => undefined };
  }

  // Step 2: spawn the start command. Tokenize argv without a shell.
  const argv = parseSimpleArgv(opts.start);
  if (argv.length === 0) {
    throw new Error(
      `pinned: http.start is empty — set config.http.start (e.g. "npm run dev")`
    );
  }
  log(`◆ pinned dev: starting "${opts.start}" (waiting up to ${opts.timeoutSeconds}s for ${probeUrl})...`);

  let logBuf = "";
  const proc: ChildProcess = spawn(argv[0], argv.slice(1), {
    cwd: opts.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    // detached:false keeps the child in our process group, so a
    // SIGTERM to the parent (e.g. ctrl-C) reaches the dev server too.
    detached: false,
    env: { ...process.env, BROWSER: "none" },
  });
  proc.stdout?.on("data", (c: Buffer) => {
    logBuf += c.toString("utf8");
    // Cap log buffer at 1MB — long-running dev servers can emit a lot.
    if (logBuf.length > 1_000_000) logBuf = logBuf.slice(-500_000);
  });
  proc.stderr?.on("data", (c: Buffer) => {
    logBuf += c.toString("utf8");
    if (logBuf.length > 1_000_000) logBuf = logBuf.slice(-500_000);
  });

  let earlyExitCode: number | null = null;
  let earlyExitSignal: NodeJS.Signals | null = null;
  proc.on("exit", (code, signal) => {
    earlyExitCode = code;
    earlyExitSignal = signal;
  });

  // Step 3: poll for readiness.
  const deadline = Date.now() + opts.timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    // Check if the process died before becoming ready.
    if (earlyExitCode !== null || earlyExitSignal !== null) {
      const tail = tailLog(logBuf, 30);
      await killProcess(proc);
      throw new Error(
        `pinned: dev server exited before becoming ready (code=${earlyExitCode}, signal=${earlyExitSignal})\nLast lines of output:\n${tail}`
      );
    }
    if (await probe(probeUrl)) {
      log(`◆ pinned dev: ready at ${opts.url}`);
      return {
        url: opts.url,
        started: true,
        stop: async () => {
          await killProcess(proc);
        },
      };
    }
    await sleep(500);
  }

  // Step 4: timeout — kill and surface logs.
  const tail = tailLog(logBuf, 30);
  await killProcess(proc);
  throw new Error(
    `pinned: dev server did not respond at ${probeUrl} within ${opts.timeoutSeconds}s.\n` +
      `Suggestion: try increasing config.http.timeout_seconds, or set http.ready_path to a path your app responds to faster (e.g. "/api/health").\n\n` +
      `Last lines of dev server output:\n${tail}`
  );
}

// Helper: HTTP HEAD/GET probe with short timeout. Any response status
// counts as "server is up" — auth-gated dev servers may return 401 at /
// before they have a real session, which still means the process is
// listening.
async function probe(url: string, timeoutMs = 1500): Promise<boolean> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    // Consume body to avoid leaks.
    try {
      await res.arrayBuffer();
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function killProcess(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  // SIGTERM first — gives the dev server a chance to clean up child
  // processes (Next.js spawns its own subprocess pool).
  proc.kill("SIGTERM");
  // Wait up to 5s for graceful shutdown, then SIGKILL.
  await Promise.race([
    new Promise<void>((resolve) => proc.once("exit", () => resolve())),
    sleep(5000),
  ]);
  if (proc.exitCode === null && !proc.killed) {
    proc.kill("SIGKILL");
  }
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function tailLog(buf: string, lines: number): string {
  const arr = buf.split("\n");
  return arr.slice(-lines).join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
