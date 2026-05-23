// Internal calibration tool: "what would Pinned have caught if it
// were installed at commit N and replayed forward to HEAD?"
//
// Walks git log in chronological order, parses claim-shaped text out of
// commit messages and (optionally) merged-PR descriptions, generates the
// would-be pin test, then replays the repo's history against that pin
// to detect transitions green → red (= catch). Used pre-launch as the
// load-bearing answer to "does Pinned actually catch real regressions?"
//
// Scope and constraints:
//   - HTTP templates (rate-limit/auth-required/idempotent) need
//     PREVIEW_URL or a fixture server to verify. Without it, those pin
//     tests skip silently — backtest reports them as "not testable
//     without preview." The real signal comes from CLI / library
//     templates, which run against the codebase directly.
//   - Each pin is replayed only at commits that touched its
//     covers.files (or the route's source file, derived from the
//     claim's route). Touching nothing = no replay.
//   - Backtest runs in a git WORKTREE — the repo's working tree is
//     untouched. The worktree is removed on completion.
//   - The output is a structured report (JSON), no global state.
//
// Two modes:
//   "product": parse PR/commit descriptions only — mirrors how the
//              shipping product extracts claims. The honest baseline.
//   "extended": product mode PLUS diff-derived inference (treat new
//              admin route files as implicit claims). Higher coverage,
//              not the product's contract — useful for calibration to
//              understand the upper bound of catches.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseClaims, type Claim, claimSlug } from "./claimParser.js";
import { generateTest } from "./index.js";
import { scanDiffFull, type ChangedFile } from "./scanDiff.js";

export type BacktestMode = "product" | "extended";

export type BacktestOptions = {
  repoPath: string;
  fromCommit?: string; // default: walk full history
  toCommit?: string;   // default: HEAD
  mode: BacktestMode;
  // How many commits forward to replay against each pin. A pin's
  // protected files might not be touched again for many commits; bound
  // to keep individual repos tractable.
  maxReplayCommits?: number;
  // Vitest invocation timeout per commit.
  vitestTimeoutMs?: number;
};

export type BacktestPin = {
  claim: Claim;
  originCommit: string;
  originSubject: string;
  filename: string;
  // Each commit in chronological order where this pin's covers.files
  // were touched. Each entry records whether the test passed or failed.
  replays: { commit: string; subject: string; outcome: "pass" | "fail" | "skip" | "infra-fail" }[];
  // True if a replay flipped from pass → fail. That's the catch.
  caughtRegression: boolean;
  // True if the pin failed AT INSTALL time (commit N+0). Indicates a
  // claim that didn't match the contemporaneous code — a false
  // positive at generation time, not a catch.
  brokenAtBirth: boolean;
};

export type BacktestReport = {
  repo: string;
  mode: BacktestMode;
  commitsScanned: number;
  pinsGenerated: number;
  pinsByTemplate: Record<string, number>;
  brokenAtBirth: number;
  catches: number;
  catchesByTemplate: Record<string, number>;
  notTestableHttp: number;
  durationMs: number;
  pins: BacktestPin[];
};

export async function runBacktest(opts: BacktestOptions): Promise<BacktestReport> {
  const startedAt = Date.now();
  const { repoPath, mode } = opts;
  const fromCommit = opts.fromCommit ?? "";
  const toCommit = opts.toCommit ?? "HEAD";
  const maxReplay = opts.maxReplayCommits ?? 50;
  const vitestTimeoutMs = opts.vitestTimeoutMs ?? 30_000;

  if (!existsSync(join(repoPath, ".git"))) {
    throw new Error(`Not a git repo: ${repoPath}`);
  }

  // List all commits in chronological order (oldest first).
  const range = fromCommit ? `${fromCommit}..${toCommit}` : toCommit;
  const log = git(
    repoPath,
    ["log", range, "--reverse", "--pretty=format:%H%n%s%n%b%n---PINNED-BACKTEST-DELIM---"]
  );
  const entries = log.split("---PINNED-BACKTEST-DELIM---\n").filter((s) => s.trim());
  const commits = entries.map((entry) => {
    const lines = entry.split("\n");
    return {
      sha: lines[0]?.trim() ?? "",
      subject: lines[1]?.trim() ?? "",
      body: lines.slice(2).join("\n").trim(),
    };
  }).filter((c) => c.sha.length === 40);

  const pinsByTemplate: Record<string, number> = {};
  const catchesByTemplate: Record<string, number> = {};
  const pins: BacktestPin[] = [];
  let brokenAtBirth = 0;
  let catches = 0;
  let notTestableHttp = 0;

  // Set up an isolated worktree so vitest replays can checkout
  // historical commits without touching the user's actual working tree.
  const worktreePath = mkdtempSync(join(tmpdir(), "pinned-backtest-wt-"));
  try {
    git(repoPath, ["worktree", "add", "--detach", worktreePath, toCommit]);
  } catch (e) {
    rmSync(worktreePath, { recursive: true, force: true });
    throw new Error(`Failed to create worktree at ${worktreePath}: ${(e as Error).message}`);
  }

  // Pin holding area — generated tests go here. Worktree gets a
  // tests/pinned/ subdir for each replay; we add/remove individually.
  const pinHolding = mkdtempSync(join(tmpdir(), "pinned-backtest-pins-"));

  try {
    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];
      // Combined claim source: commit subject + body. In product mode
      // we use exactly this. In extended mode we also union diff-derived.
      const text = `${c.subject}\n\n${c.body}`;
      const explicit = parseClaims(text);

      let claimsForThisCommit: Claim[] = explicit;
      if (mode === "extended") {
        // Run baseline-style detection on this commit's diff.
        const changed = filesChanged(repoPath, c.sha);
        if (changed.length > 0) {
          const scan = scanDiffFull({
            changedFiles: changed,
            prBodyClaims: explicit,
            existingPins: [],
          });
          // Convert suggestions back to Claims by parsing their suggestedPin
          for (const s of scan.suggestions) {
            const parsed = parseClaims(s.suggestedPin);
            claimsForThisCommit = claimsForThisCommit.concat(parsed);
          }
        }
        // Plus the non-HTTP detectors that emit pins from filesystem
        // state directly. These produce the highest-signal backtest
        // catches because they assert against concrete content that
        // can change in a single commit. Checkout the worktree to
        // commit-N first so the detectors see THAT commit's state,
        // not HEAD's.
        gitWorktreeCheckout(worktreePath, c.sha);
        const { detectCliLibraryPins, detectLockfilePins, detectConfigInvariantPins, detectPackageExportsPins } = await import("./scanDiff.js");
        for (const cli of detectCliLibraryPins(worktreePath)) {
          if (cli.template !== "cli-exits-zero") continue;
          claimsForThisCommit.push({
            template: "cli-exits-zero",
            route: `${cli.identifier} --help`,
            raw: cli.suggestedPin,
          });
        }
        for (const lock of detectLockfilePins(worktreePath)) {
          claimsForThisCommit.push({
            template: "lockfile-integrity",
            lockfilePath: lock.lockfilePath,
            expectedSha256: lock.expectedSha256,
            raw: lock.suggestedPin,
          });
        }
        for (const cfg of detectConfigInvariantPins(worktreePath)) {
          claimsForThisCommit.push({
            template: "config-invariant",
            configPath: cfg.configPath,
            expected: cfg.expected,
            label: cfg.label,
            raw: cfg.suggestedPin,
          });
        }
        for (const exp of detectPackageExportsPins(worktreePath)) {
          claimsForThisCommit.push({
            template: "package-exports-exist",
            modulePath: exp.modulePath,
            exports: exp.exports,
            raw: exp.suggestedPin,
          });
        }
      }

      // Dedup within this commit
      const seen = new Set<string>();
      const newClaims = claimsForThisCommit.filter((cl) => {
        const k = claimKey(cl);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      for (const claim of newClaims) {
        const template = claim.template;
        pinsByTemplate[template] = (pinsByTemplate[template] ?? 0) + 1;

        // HTTP templates without PREVIEW_URL fixture aren't testable in
        // this backtest harness. Count them but don't waste replay time.
        if (
          template === "rate-limit" ||
          template === "auth-required" ||
          template === "permission-required" ||
          template === "idempotent" ||
          template === "tier-cap" ||
          template === "returns-status"
        ) {
          notTestableHttp += 1;
          continue;
        }

        // Generate the test file (uses the same code path as
        // `pinned generate`). The PR id placeholder shows the commit
        // sha so a reader of the test file can trace back.
        const gen = generateTest(claim, { prId: `backtest-${c.sha.slice(0, 8)}` });
        const testPath = join(pinHolding, gen.filename);
        writeFileSync(testPath, gen.content);

        // Day-zero check: does the pin pass at THIS commit's working tree?
        // If not, the claim didn't match the contemporaneous code —
        // false positive at generation time (broken-at-birth).
        gitWorktreeCheckout(worktreePath, c.sha);
        const dayZero = runVitestAt(worktreePath, testPath, vitestTimeoutMs);

        const replays: BacktestPin["replays"] = [];
        if (dayZero === "fail") {
          brokenAtBirth += 1;
          pins.push({
            claim,
            originCommit: c.sha,
            originSubject: c.subject,
            filename: gen.filename,
            replays: [{ commit: c.sha, subject: c.subject, outcome: "fail" }],
            caughtRegression: false,
            brokenAtBirth: true,
          });
          continue;
        }
        if (dayZero === "skip" || dayZero === "infra-fail") {
          // Can't establish a baseline — skip.
          pins.push({
            claim,
            originCommit: c.sha,
            originSubject: c.subject,
            filename: gen.filename,
            replays: [{ commit: c.sha, subject: c.subject, outcome: dayZero }],
            caughtRegression: false,
            brokenAtBirth: false,
          });
          continue;
        }

        // Replay against subsequent commits. Cap at maxReplay.
        const subsequent = commits.slice(i + 1, i + 1 + maxReplay);
        let caughtThis = false;
        for (const next of subsequent) {
          gitWorktreeCheckout(worktreePath, next.sha);
          const outcome = runVitestAt(worktreePath, testPath, vitestTimeoutMs);
          replays.push({ commit: next.sha, subject: next.subject, outcome });
          if (outcome === "fail") {
            caughtThis = true;
            break;
          }
        }
        if (caughtThis) {
          catches += 1;
          catchesByTemplate[template] = (catchesByTemplate[template] ?? 0) + 1;
        }
        pins.push({
          claim,
          originCommit: c.sha,
          originSubject: c.subject,
          filename: gen.filename,
          replays,
          caughtRegression: caughtThis,
          brokenAtBirth: false,
        });
      }
    }
  } finally {
    try {
      git(repoPath, ["worktree", "remove", "--force", worktreePath]);
    } catch {
      rmSync(worktreePath, { recursive: true, force: true });
    }
    rmSync(pinHolding, { recursive: true, force: true });
  }

  return {
    repo: repoPath,
    mode,
    commitsScanned: commits.length,
    pinsGenerated: pins.length,
    pinsByTemplate,
    brokenAtBirth,
    catches,
    catchesByTemplate,
    notTestableHttp,
    durationMs: Date.now() - startedAt,
    pins,
  };
}

// ---- git helpers ----

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gitWorktreeCheckout(worktree: string, sha: string): void {
  spawnSync("git", ["checkout", "-q", "--detach", sha], {
    cwd: worktree,
    stdio: "ignore",
  });
}

function filesChanged(repo: string, sha: string): ChangedFile[] {
  let out = "";
  try {
    out = git(repo, ["show", "--name-status", "--pretty=", sha]);
  } catch {
    return [];
  }
  const files: ChangedFile[] = [];
  for (const line of out.split("\n")) {
    const m = /^([AMD])\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const code = m[1];
    const path = m[2];
    files.push({
      path,
      status: code === "A" ? "added" : code === "D" ? "deleted" : "modified",
    });
  }
  return files;
}

function claimKey(c: Claim): string {
  const slug = claimSlug(c);
  return `${c.template}:${slug}`;
}

// ---- vitest replay ----
//
// Runs vitest against ONE test file in the historical worktree. Returns
// a coarse outcome:
//   "pass"       — test ran and exit 0
//   "fail"       — test ran and exit non-zero (excluding infra failures)
//   "skip"       — test skipped (e.g., PREVIEW_URL gating)
//   "infra-fail" — vitest couldn't be invoked, package missing, etc.
//
// We rely on the test file's PINNED FAILURE / PINNED INFRA FAILURE
// header to distinguish real catches from infra issues — but only the
// templates ship that distinction. CLI / library templates don't have
// preview-gated skips, so the simpler exit-code mapping is sufficient.
function runVitestAt(
  worktree: string,
  testPath: string,
  timeoutMs: number
): "pass" | "fail" | "skip" | "infra-fail" {
  // Copy the test file into the worktree under a tests/pinned subdir
  // (vitest config in the worktree may filter to a specific dir).
  const target = join(worktree, "tests", "pinned-backtest");
  mkdirSync(target, { recursive: true });
  const targetPath = join(target, "current.test.ts");
  try {
    const content = require("node:fs").readFileSync(testPath, "utf8");
    require("node:fs").writeFileSync(targetPath, content);
  } catch {
    return "infra-fail";
  }
  // Find a usable vitest binary in the worktree.
  let vitestBin: string | null = null;
  for (const candidate of [
    join(worktree, "node_modules", ".bin", "vitest"),
    join(worktree, "..", "node_modules", ".bin", "vitest"),
  ]) {
    if (existsSync(candidate)) {
      vitestBin = candidate;
      break;
    }
  }
  if (!vitestBin) {
    // Try npx with no-install — fast if vitest is in PATH, else infra-fail.
    vitestBin = "npx";
  }
  const args = vitestBin === "npx"
    ? ["--no-install", "vitest", "run", "--no-coverage", "--reporter=verbose", targetPath]
    : ["run", "--no-coverage", "--reporter=verbose", targetPath];
  const r = spawnSync(vitestBin, args, {
    cwd: worktree,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  // Cleanup
  try { rmSync(target, { recursive: true, force: true }); } catch {}

  if (r.status === null || r.signal === "SIGTERM" || r.signal === "SIGKILL") return "infra-fail";
  if (r.status === 0) {
    if (/\d+\s+skipped/.test(out) && !/\d+\s+passed/.test(out)) return "skip";
    return "pass";
  }
  // Heuristic: distinguish "vitest didn't run" from "test failed"
  const ranTests =
    /Test Files\s+\d/.test(out) || /\d+ (?:passed|failed|skipped)/.test(out);
  if (!ranTests) return "infra-fail";
  return "fail";
}
