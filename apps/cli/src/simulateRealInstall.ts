// Realistic "install-partway-through-history" simulator.
//
// What it does:
//   1. Pick install point X = commit at INSTALL_PERCENT through history
//   2. In a worktree at X: run scanDiffFull against the WHOLE codebase as
//      if every file were just added — same logic as `pinned init`'s
//      baseline scan. Generate pin test files. Run vitest to confirm
//      they all pass at install (positive controls). Drop the ones that
//      fail or error at baseline.
//   3. Walk commits X+1 → HEAD chronologically. At each commit:
//        - Check out the commit
//        - Run scanDiffFull on the commit's diff → add any new pins
//        - Run vitest against ALL accumulated pins
//        - Any pin that PASSED at the previous step but FAILS here is a
//          CATCH (the commit broke a behavior Pinned was guarding)
//   4. Aggregate report
//
// Why this is closer to the real user experience than backtest's
// product/extended modes:
//   - It accumulates pins (real users build up a registry over time)
//   - It tests the install-on-existing-codebase flow, not the
//     install-at-day-zero flow
//   - It runs vitest against the WHOLE pin set at each step, so cross-
//     pin interactions (or false-positives that fire on unrelated
//     commits) surface in the catch count
//
// What it cannot simulate:
//   - HTTP-template pins that need PREVIEW_URL — these skip and are
//     filtered out before replay begins
//   - PR-text-based pins — this simulates the auto-protect/diff path
//     only; the PR-text path is a separate signal (see backtest --mode=product)

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  lstatSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  scanDiffFull,
  findUnprotectedSiblings,
  AUTH_CHECK_PATTERNS,
  detectAuthChecksInDiff,
  detectValidationAddedInDiff,
  type ChangedFile,
  type DiffByFile,
} from "./scanDiff.js";
import {
  detectCliLibraryPins,
  detectLockfilePins,
  detectConfigInvariantPins,
  detectPackageExportsPins,
  detectReturnsStatusPins,
  detectSecretNotPublicPins,
} from "./scanDiff.js";
import { parseClaims, type Claim } from "./claimParser.js";
import { generateTest } from "./index.js";

// Parse `git diff --unified=0` patch output into a Map<file, addedLines[]>.
// Copied from backtest.ts:readAddedLinesByFile (not exported there).
function readAddedLinesForCommit(worktreePath: string, parent: string, sha: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let raw: string;
  try {
    raw = git(worktreePath, ["diff", "--unified=0", "--no-color", "--no-prefix", "--diff-filter=ACMR", `${parent}..${sha}`]);
  } catch {
    return out;
  }
  let currentFile: string | null = null;
  for (const line of raw.split("\n")) {
    const diffH = /^diff --git (\S+) (\S+)$/.exec(line);
    if (diffH) { currentFile = diffH[2]; continue; }
    if (!currentFile) continue;
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++") ||
        line.startsWith("index ") || line.startsWith("new file mode") ||
        line.startsWith("deleted file mode") || line.startsWith("similarity index") ||
        line.startsWith("rename from") || line.startsWith("rename to") ||
        line.startsWith("Binary files")) {
      continue;
    }
    if (line.startsWith("+")) {
      const added = line.slice(1);
      const existing = out.get(currentFile);
      if (existing) existing.push(added);
      else out.set(currentFile, [added]);
    }
  }
  return out;
}

function buildSyntheticDiffByFile(repoRoot: string, changedFiles: ChangedFile[]): DiffByFile {
  const out: DiffByFile = new Map();
  for (const f of changedFiles) {
    if (f.status === "deleted") continue;
    try {
      const content = readFileSync(join(repoRoot, f.path), "utf8");
      out.set(f.path, content.split("\n"));
    } catch {
      /* */
    }
  }
  return out;
}

const VALIDATION_SIBLING_PATTERNS: RegExp[] = [
  /\bz\.object\s*\(/,
  /\.parseAsync\s*\(/,
  /\.safeParse(?:Async)?\s*\(/,
  /\byup\.object\s*\(/,
  /\bvalidate\s*\([^)]*req\.body/,
  /\bschema\.parse\s*\(/,
  /\b(?:reply|res)\.(?:code|status)\s*\(\s*400\b/,
];

export type SimulateRealInstallOptions = {
  repoPath: string;
  /** 0..1, default 0.6 — install Pinned at this fraction through history */
  installAtPercent?: number;
  /** Cap replay commits past install (newest only). Default 100 */
  maxReplayCommits?: number;
  /** Per-vitest-run timeout. Default 60s — full pin-set runs are slower */
  vitestTimeoutMs?: number;
  /** Print progress lines to stderr. Default true */
  verbose?: boolean;
  /**
   * Enable sibling discovery: after each auth-required / returns-status
   * pin is generated, scan the repo for unprotected sibling files and
   * auto-add them as pins. Default true — matches production behavior
   * post-2026-05-23 autoProtect wiring.
   */
  enableSiblings?: boolean;
  /**
   * Enable LLM-as-proposer on each commit's diff. Requires
   * PINNEDAI_BYOK + PINNEDAI_OPENAI_KEY (or _ANTHROPIC_KEY) env vars.
   * Default false — opt-in. Adds ~$0.001-0.01 per commit in token cost.
   */
  enableLlmProposer?: boolean;
};

export type SimulateCatch = {
  commitSha: string;
  commitSubject: string;
  pinFilename: string;
  pinTemplate: string;
  pinIntroducedAt: "baseline" | string; // commit sha if added during replay
  pinWasSibling: boolean;
  pinWasFromLlm: boolean;
};

export type SimulateReport = {
  repo: string;
  totalCommits: number;
  installCommit: string;
  installCommitIdx: number;
  replayCommitCount: number;
  baselinePinsAttempted: number;
  baselinePinsPositive: number; // passed at install
  baselinePinsDropped: number; // failed/errored at install, removed
  pinsAddedDuringReplay: number;
  siblingPinsTotal: number; // subset of pins (baseline + replay) that came from sibling discovery
  llmPinsTotal: number; // subset of pins (replay only) that came from LLM proposer
  totalLivePinsAtEnd: number;
  catches: SimulateCatch[];
  catchesFromSiblings: number; // subset of catches whose source pin is a sibling
  catchesFromLlm: number; // subset of catches whose source pin is from LLM proposer
  siblingsEnabled: boolean;
  llmProposerEnabled: boolean;
  durationMs: number;
};

const VERBOSE_PREFIX = "[simulate-real-install]";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function gitWorktreeCheckout(worktree: string, sha: string): void {
  const r = spawnSync("git", ["checkout", "-q", "--detach", sha], {
    cwd: worktree,
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`git checkout ${sha} failed: ${r.stderr}`);
  }
}

function walkRepoFiles(root: string): string[] {
  const IGNORE = new Set([
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "out",
    ".turbo",
    ".cache",
    "coverage",
    "tests/pinned",
    "tests/pinned-sim",
  ]);
  const files: string[] = [];
  const walk = (rel: string): void => {
    const abs = join(root, rel);
    let entries: string[];
    try {
      entries = readdirSync(abs);
    } catch {
      return;
    }
    for (const name of entries) {
      const relPath = rel ? `${rel}/${name}` : name;
      if (IGNORE.has(relPath) || IGNORE.has(name)) continue;
      let st;
      try {
        st = lstatSync(join(abs, name));
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(relPath);
      else if (st.isFile()) files.push(relPath);
    }
  };
  walk("");
  return files;
}

async function installVitestInWorktree(worktreePath: string): Promise<void> {
  // Resolve from this module's own location (apps/cli/src/) which has a
  // stable relationship to apps/cli/node_modules. process.argv[1] varies
  // with caller (tsx script vs built CLI binary) and is unreliable.
  const selfUrl = new URL(import.meta.url);
  const selfPath = selfUrl.pathname; // apps/cli/{src,dist}/simulateRealInstall.{ts,js}
  const candidates = [
    resolve(selfPath, "..", "..", "node_modules"),                // apps/cli/node_modules (built or src)
    resolve(selfPath, "..", "..", "..", "..", "node_modules"),    // monorepo root node_modules
    resolve(selfPath, "..", "..", "..", "..", "..", "node_modules"),
    resolve(process.cwd(), "node_modules"),
    resolve(process.cwd(), "apps/cli/node_modules"),
  ];
  let ours: string | null = null;
  for (const c of candidates) {
    if (existsSync(`${c}/vitest`) || existsSync(`${c}/.bin/vitest`)) {
      ours = c;
      break;
    }
  }
  if (!ours) {
    process.stderr.write(`${VERBOSE_PREFIX} no local vitest found — pin runs will fail\n`);
    process.stderr.write(`${VERBOSE_PREFIX} candidates checked: ${candidates.join(", ")}\n`);
    return;
  }
  if (process.env.PINNED_SIM_DEBUG === "1") {
    process.stderr.write(`${VERBOSE_PREFIX} vitest source: ${ours}\n`);
  }
  const wtNm = `${worktreePath}/node_modules`;
  mkdirSync(`${wtNm}/.bin`, { recursive: true });
  try {
    symlinkSync(`${ours}/.bin/vitest`, `${wtNm}/.bin/vitest`);
  } catch {
    /* exists */
  }
  try {
    symlinkSync(`${ours}/vitest`, `${wtNm}/vitest`);
  } catch {
    /* exists */
  }
  if (!existsSync(`${worktreePath}/package.json`)) {
    writeFileSync(
      `${worktreePath}/package.json`,
      JSON.stringify({ name: "simulate-fixture", type: "module" }, null, 2)
    );
  }
}

type PinResultsByFile = Map<string, "pass" | "fail" | "skip" | "error">;

function runVitestOnPinDir(
  worktreePath: string,
  pinsRelDir: string,
  timeoutMs: number
): PinResultsByFile {
  const results: PinResultsByFile = new Map();
  const cfgPath = join(worktreePath, pinsRelDir, ".vitest.sim.config.mjs");
  mkdirSync(join(worktreePath, pinsRelDir), { recursive: true });
  writeFileSync(
    cfgPath,
    `import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["${pinsRelDir}/**/*.test.{ts,mts,js,mjs}"], root: ${JSON.stringify(worktreePath)}, passWithNoTests: true } });
`
  );
  const jsonOut = join(worktreePath, pinsRelDir, ".vitest.sim.results.json");
  try { rmSync(jsonOut, { force: true }); } catch {}

  const vitestBin = join(worktreePath, "node_modules", ".bin", "vitest");
  const useNpx = !existsSync(vitestBin);
  const cmd = useNpx ? "npx" : vitestBin;
  const args = useNpx
    ? ["--no-install", "vitest", "run", "--no-coverage", "--reporter=json", `--outputFile=${jsonOut}`, "--config", cfgPath]
    : ["run", "--no-coverage", "--reporter=json", `--outputFile=${jsonOut}`, "--config", cfgPath];

  const r = spawnSync(cmd, args, {
    cwd: worktreePath,
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });

  if (process.env.PINNED_SIM_DEBUG === "1") {
    process.stderr.write(`${VERBOSE_PREFIX} vitest status=${r.status} signal=${r.signal}\n`);
    if (r.stderr) process.stderr.write(`${VERBOSE_PREFIX} stderr=${r.stderr.slice(0, 2000)}\n`);
  }

  if (!existsSync(jsonOut)) {
    // vitest crashed before writing results — every pin marked error
    return results;
  }
  try {
    const parsed = JSON.parse(readFileSync(jsonOut, "utf8")) as {
      testResults?: Array<{ name: string; status: string }>;
    };
    for (const tr of parsed.testResults ?? []) {
      // Vitest JSON reporter uses relative-to-cwd or absolute paths.
      // Normalize to repo-relative path for our pin file keys.
      let rel = tr.name;
      if (rel.startsWith(worktreePath)) {
        rel = rel.slice(worktreePath.length).replace(/^[/\\]/, "");
      }
      let verdict: "pass" | "fail" | "skip" | "error" = "error";
      if (tr.status === "passed") verdict = "pass";
      else if (tr.status === "failed") verdict = "fail";
      else if (tr.status === "skipped" || tr.status === "pending") verdict = "skip";
      results.set(rel, verdict);
    }
  } catch {
    /* unparseable — return what we have */
  }
  return results;
}

type LivePin = {
  filename: string; // relative to worktreeRoot, e.g. tests/pinned-sim/foo.test.ts
  template: string;
  introducedAt: "baseline" | string; // sha
  isSibling: boolean;
  isFromLlm: boolean;
  lastVerdict?: "pass" | "fail" | "skip" | "error";
};

function generatePinFilesFromScan(
  scanResult: ReturnType<typeof scanDiffFull>,
  prId: string,
  worktreePath: string,
  changedFiles: ChangedFile[],
  enableSiblings: boolean
): Array<{ claim: Claim; filename: string; content: string; template: string; isSibling: boolean }> {
  const out: Array<{ claim: Claim; filename: string; content: string; template: string; isSibling: boolean }> = [];

  // Build staticVerify lookup maps so we can attach fingerprints to
  // auth-required / returns-status claims — mirrors the autoProtect.ts
  // production fix. Without these, generated pins skip silently in
  // CI unless the customer sets PREVIEW_URL.
  const syntheticDiff = buildSyntheticDiffByFile(worktreePath, changedFiles);
  const authSv = new Map<string, { filePath: string; signature: string }>();
  const validationSv = new Map<string, { filePath: string; signature: string }>();
  let middlewareAuth: { filePath: string; signature: string } | null = null;
  try {
    for (const h of detectAuthChecksInDiff(syntheticDiff)) {
      authSv.set(h.route, { filePath: h.filePath, signature: h.signature });
      if (h.route === "* (middleware)" && !middlewareAuth) {
        middlewareAuth = { filePath: h.filePath, signature: h.signature };
      }
    }
    for (const h of detectValidationAddedInDiff(syntheticDiff)) {
      validationSv.set(h.route, { filePath: h.filePath, signature: h.signature });
    }
  } catch {
    /* */
  }

  // Emit a middleware pin (separate from per-route ones) when global
  // auth middleware is detected. Catches the "middleware.ts auth
  // removed" regression class — the highest-value catch on
  // middleware-protected codebases like quantapact.
  if (middlewareAuth) {
    const mwClaim: Claim = {
      template: "auth-required",
      route: "* (middleware)",
      raw: `auth check in ${middlewareAuth.filePath}`,
      staticVerify: middlewareAuth,
    };
    try {
      const gen = generateTest(mwClaim, { prId });
      out.push({ claim: mwClaim, filename: gen.filename, content: gen.content, template: "auth-required", isSibling: false });
    } catch {
      /* */
    }
  }

  for (const s of scanResult.suggestions) {
    if (!s.route || !s.suggestedPin) continue;
    if (s.suggestedPin.includes("ships in v0.2")) continue;
    const reparsed = parseClaims(s.suggestedPin);
    if (reparsed.length !== 1) continue;
    let claim = reparsed[0];
    // Attach staticVerify if we captured one for this route
    if (claim.template === "auth-required") {
      const sv = authSv.get(s.route);
      if (sv) claim = { ...claim, staticVerify: sv };
    } else if (claim.template === "returns-status") {
      const sv = validationSv.get(s.route);
      if (sv) claim = { ...claim, staticVerify: sv };
    }
    try {
      const gen = generateTest(claim, { prId });
      out.push({ claim, filename: gen.filename, content: gen.content, template: claim.template, isSibling: false });
    } catch {
      continue;
    }

    // Sibling discovery: every auth-required / returns-status pin
    // generated from the diff triggers a repo-wide scan for unprotected
    // siblings. Mirrors the production auto-protect path (autoProtect.ts).
    if (!enableSiblings) continue;
    if (claim.template !== "auth-required" && claim.template !== "returns-status") continue;
    const category: "auth" | "validation" = claim.template === "auth-required" ? "auth" : "validation";
    const patterns = category === "auth" ? AUTH_CHECK_PATTERNS : VALIDATION_SIBLING_PATTERNS;
    const triggerFile = s.files[0];
    if (!triggerFile) continue;
    let siblings: ReturnType<typeof findUnprotectedSiblings>;
    try {
      siblings = findUnprotectedSiblings({
        repoPath: worktreePath,
        patterns,
        triggerFilePath: triggerFile,
        triggerRoute: claim.route,
        category,
      });
    } catch {
      continue;
    }
    for (const sib of siblings) {
      if (sib.confidence === "low") continue;
      const sibRoute = sib.route ?? "";
      if (!sibRoute) continue;
      let sibClaim: Claim;
      if (claim.template === "auth-required") {
        sibClaim = { template: "auth-required", route: sibRoute, raw: `auth required on ${sibRoute}` };
      } else {
        const method = (claim as { method?: "POST" | "PUT" | "PATCH" }).method ?? "POST";
        sibClaim = {
          template: "returns-status",
          route: sibRoute,
          method,
          status: 400,
          raw: `${sibRoute} returns 400 on bad body`,
        };
      }
      try {
        const gen = generateTest(sibClaim, { prId });
        out.push({ claim: sibClaim, filename: gen.filename, content: gen.content, template: sibClaim.template, isSibling: true });
      } catch {
        /* generator rejected */
      }
    }
  }
  return out;
}

function generateStaticDetectorPins(
  worktreePath: string,
  prId: string
): Array<{ claim: Claim; filename: string; content: string; template: string }> {
  // Static-content detectors that work without a diff context. Mirrors
  // the supplemental pinning that `pinned init` does on top of scanDiffFull.
  // Shape parity with cli.ts:1240+ (the baseline scan code path).
  const out: Array<{ claim: Claim; filename: string; content: string; template: string }> = [];
  const tryGen = (claim: Claim, template: string) => {
    try {
      const gen = generateTest(claim, { prId });
      out.push({ claim, filename: gen.filename, content: gen.content, template });
    } catch { /* template generator rejected the claim — skip */ }
  };

  // CLI library pins: parseClaims roundtrip on suggestedPin (cli.ts:1304 path).
  try {
    for (const p of detectCliLibraryPins(worktreePath)) {
      if (p.template !== "cli-exits-zero") continue;
      const reparsed = parseClaims(p.suggestedPin);
      if (reparsed.length === 1) tryGen(reparsed[0], "cli-exits-zero");
    }
  } catch { /* */ }

  // Lockfile-integrity (direct claim construction — cli.ts:1454)
  try {
    for (const p of detectLockfilePins(worktreePath)) {
      tryGen({
        template: "lockfile-integrity",
        lockfilePath: p.lockfilePath,
        expectedSha256: p.expectedSha256,
        packageJsonSha256: p.packageJsonSha256,
        raw: `lockfile-integrity ${p.lockfilePath} sha256 ${p.expectedSha256.slice(0, 12)}`,
      }, "lockfile-integrity");
    }
  } catch { /* */ }

  // Config-invariant (direct — cli.ts:1322)
  try {
    for (const cfg of detectConfigInvariantPins(worktreePath)) {
      tryGen({
        template: "config-invariant",
        configPath: cfg.configPath,
        expected: cfg.expected,
        label: cfg.label,
        raw: `config-invariant ${cfg.label} in ${cfg.configPath}`,
      }, "config-invariant");
    }
  } catch { /* */ }

  // Package-exports-exist (direct — cli.ts:1419)
  try {
    for (const e of detectPackageExportsPins(worktreePath)) {
      tryGen({
        template: "package-exports-exist",
        modulePath: e.modulePath,
        exports: e.exports,
        raw: `package-exports-exist ${e.modulePath} exports ${e.exports.length}`,
      }, "package-exports-exist");
    }
  } catch { /* */ }

  // Returns-status (Suggestion path — parseClaims on suggestedPin)
  try {
    for (const r of detectReturnsStatusPins(worktreePath)) {
      const reparsed = parseClaims(r.suggestedPin);
      if (reparsed.length === 1) tryGen(reparsed[0], "returns-status");
    }
  } catch { /* */ }

  // Secret-not-public (direct — cli.ts:1360)
  try {
    for (const s of detectSecretNotPublicPins(worktreePath)) {
      tryGen({
        template: "secret-not-public",
        publicPrefix: s.publicPrefix,
        secretMarkers: s.secretMarkers,
        raw: s.suggestedPin,
      }, "secret-not-public");
    }
  } catch { /* */ }

  return out;
}

export async function simulateRealInstall(opts: SimulateRealInstallOptions): Promise<SimulateReport> {
  const t0 = Date.now();
  const repoPath = resolve(opts.repoPath);
  const installAtPercent = opts.installAtPercent ?? 0.6;
  const maxReplayCommits = opts.maxReplayCommits ?? 100;
  const vitestTimeoutMs = opts.vitestTimeoutMs ?? 60_000;
  const verbose = opts.verbose !== false;
  const enableSiblings = opts.enableSiblings !== false;
  const enableLlmProposer = opts.enableLlmProposer === true;

  const log = (msg: string) => {
    if (verbose) process.stderr.write(`${VERBOSE_PREFIX} ${msg}\n`);
  };

  // Chronological commit list (oldest → newest)
  const log_out = git(repoPath, ["log", "--reverse", "--pretty=format:%H\t%s"]);
  const commits = log_out
    .split("\n")
    .map((line) => {
      const [sha, ...rest] = line.split("\t");
      return { sha, subject: rest.join("\t") };
    })
    .filter((c) => c.sha);
  if (commits.length < 5) {
    throw new Error(`Repo has only ${commits.length} commits; need ≥ 5 for a meaningful simulation`);
  }

  const installIdx = Math.min(commits.length - 2, Math.max(1, Math.floor(commits.length * installAtPercent)));
  const installCommit = commits[installIdx];
  let replayCommits = commits.slice(installIdx + 1);
  if (replayCommits.length > maxReplayCommits) {
    // Keep newest N — most likely to contain regressions worth catching
    replayCommits = replayCommits.slice(-maxReplayCommits);
  }
  log(`repo: ${repoPath}`);
  log(`total commits: ${commits.length}, install at idx ${installIdx} (${(installAtPercent * 100).toFixed(0)}%) = ${installCommit.sha.slice(0, 8)} "${installCommit.subject.slice(0, 60)}"`);
  log(`replay window: ${replayCommits.length} commits`);

  // Worktree at install commit
  const worktreePath = mkdtempSync(join(tmpdir(), "pinned-sim-wt-"));
  let report: SimulateReport;
  try {
    git(repoPath, ["worktree", "add", "--detach", worktreePath, installCommit.sha]);
    await installVitestInWorktree(worktreePath);

    // BASELINE SCAN: treat all files at install commit as "added"
    const pinsRelDir = "tests/pinned-sim";
    const pinsAbsDir = join(worktreePath, pinsRelDir);
    mkdirSync(pinsAbsDir, { recursive: true });

    const allFiles = walkRepoFiles(worktreePath);
    const changedAsAdded: ChangedFile[] = allFiles.map((p) => ({ path: p, status: "added" as const }));
    const baselineScan = scanDiffFull({
      changedFiles: changedAsAdded,
      prBodyClaims: [],
      existingPins: [],
    });
    const baselineFromScan = generatePinFilesFromScan(baselineScan, "sim-baseline", worktreePath, changedAsAdded, enableSiblings);
    const baselineFromStatic = generateStaticDetectorPins(worktreePath, "sim-baseline").map((p) => ({ ...p, isSibling: false }));
    const baselineAll = [...baselineFromScan, ...baselineFromStatic];

    // Dedup by filename
    const seen = new Set<string>();
    const baselineUnique = baselineAll.filter((p) => {
      if (seen.has(p.filename)) return false;
      seen.add(p.filename);
      return true;
    });

    log(`baseline pin candidates: ${baselineUnique.length} (scan=${baselineFromScan.length}, static=${baselineFromStatic.length})`);

    // Write all baseline pins to worktree
    for (const p of baselineUnique) {
      writeFileSync(join(worktreePath, pinsRelDir, p.filename), p.content);
    }

    // Run vitest at install commit — positive controls
    log(`running vitest at install commit (positive-control pass)...`);
    const baselineResults = runVitestOnPinDir(worktreePath, pinsRelDir, vitestTimeoutMs);

    const livePins: LivePin[] = [];
    let baselineDropped = 0;
    for (const p of baselineUnique) {
      const pinPath = `${pinsRelDir}/${p.filename}`;
      const v = baselineResults.get(pinPath);
      if (v === "pass") {
        livePins.push({
          filename: pinPath,
          template: p.template,
          introducedAt: "baseline",
          lastVerdict: "pass",
          isSibling: false,
          isFromLlm: false,
        });
      } else {
        // Pin didn't pass at baseline → drop. Reasons: no PREVIEW_URL,
        // imports unsupported in this codebase, etc. We cannot use a
        // non-passing pin to detect catches downstream.
        baselineDropped++;
        try { rmSync(join(worktreePath, pinPath), { force: true }); } catch {}
      }
    }
    log(`baseline: ${livePins.length} live, ${baselineDropped} dropped`);

    // REPLAY
    const catches: SimulateCatch[] = [];
    let pinsAddedDuringReplay = 0;

    for (let i = 0; i < replayCommits.length; i++) {
      const c = replayCommits[i];
      gitWorktreeCheckout(worktreePath, c.sha);

      // Re-establish our sim pin dir (checkout wipes untracked files
      // only if they conflict — but our test files might collide if a
      // historical commit happens to have tests/pinned-sim/). Recreate.
      mkdirSync(pinsAbsDir, { recursive: true });

      // Restore every live pin's test file to the worktree (checkout
      // doesn't carry our untracked files... actually it should leave
      // them. But pins introduced AT a later replay commit are now in
      // the worktree and we want them present. Recopy from a holding
      // dir would be cleaner — but for now just trust git checkout
      // not to remove untracked files.)

      // Detect new pins from this commit's diff
      const parent = `${c.sha}^`;
      let diffNames: string[] = [];
      try {
        diffNames = git(worktreePath, ["diff", "--name-status", parent, c.sha]).split("\n").filter(Boolean);
      } catch {
        // root commit — no parent
        diffNames = git(worktreePath, ["show", "--name-status", "--pretty=format:", c.sha]).split("\n").filter(Boolean);
      }
      const changed: ChangedFile[] = [];
      for (const line of diffNames) {
        // "<STATUS>\t<path>" or "R<score>\t<old>\t<new>" — ignore old in rename
        const parts = line.split("\t");
        const status = parts[0];
        const path = parts[parts.length - 1];
        if (!path) continue;
        let s: "added" | "modified" | "deleted" = "modified";
        if (status.startsWith("A")) s = "added";
        else if (status.startsWith("D")) s = "deleted";
        else if (status.startsWith("M") || status.startsWith("R") || status.startsWith("C")) s = "modified";
        changed.push({ path, status: s });
      }
      const incScan = scanDiffFull({ changedFiles: changed, prBodyClaims: [], existingPins: [] });
      const newPins = generatePinFilesFromScan(incScan, `sim-${c.sha.slice(0, 7)}`, worktreePath, changed, enableSiblings);
      let newPinsAdded = 0;
      let newSiblingsAdded = 0;
      let newLlmAdded = 0;
      for (const p of newPins) {
        const pinPath = `${pinsRelDir}/${p.filename}`;
        if (livePins.some((lp) => lp.filename === pinPath)) continue;
        writeFileSync(join(worktreePath, pinPath), p.content);
        livePins.push({
          filename: pinPath,
          template: p.template,
          introducedAt: c.sha,
          isSibling: p.isSibling,
          isFromLlm: false,
          lastVerdict: undefined,
        });
        newPinsAdded++;
        if (p.isSibling) newSiblingsAdded++;
        pinsAddedDuringReplay++;
      }

      // LLM-as-proposer (BYOK). Fires after the deterministic pass so
      // dedup-by-filename keeps the LLM from re-proposing what regex
      // already found. Translates LLM candidates to claims with
      // staticVerify (filePath + signature captured verbatim from the
      // diff). Per [[llm-proposer-deterministic-verifier-split]] memory.
      if (enableLlmProposer) {
        try {
          const addedLines = readAddedLinesForCommit(worktreePath, parent, c.sha);
          if (addedLines.size > 0) {
            const { proposeBugFixCandidates } = await import("./llmBugFixPropose.js");
            const llmResult = await proposeBugFixCandidates({
              commitMessage: c.subject,
              commitBody: "",
              diffByFile: addedLines,
            });
            if (llmResult.ok && llmResult.candidates.length > 0) {
              for (const cand of llmResult.candidates) {
                let llmClaim: Claim;
                if (cand.template === "auth-required") {
                  llmClaim = {
                    template: "auth-required",
                    route: cand.route ?? cand.filePath,
                    raw: cand.badCase ?? `[llm] auth check in ${cand.filePath}`,
                    staticVerify: { filePath: cand.filePath, signature: cand.signature },
                  };
                } else {
                  llmClaim = {
                    template: "returns-status",
                    route: cand.route ?? cand.filePath,
                    method: cand.method ?? "POST",
                    status: 400,
                    raw: cand.badCase ?? `[llm] validation in ${cand.filePath}`,
                    staticVerify: { filePath: cand.filePath, signature: cand.signature },
                  };
                }
                try {
                  const gen = generateTest(llmClaim, { prId: `sim-llm-${c.sha.slice(0, 7)}` });
                  const pinPath = `${pinsRelDir}/${gen.filename}`;
                  if (livePins.some((lp) => lp.filename === pinPath)) continue;
                  writeFileSync(join(worktreePath, pinPath), gen.content);
                  livePins.push({
                    filename: pinPath,
                    template: llmClaim.template,
                    introducedAt: c.sha,
                    isSibling: false,
                    isFromLlm: true,
                    lastVerdict: undefined,
                  });
                  newPinsAdded++;
                  newLlmAdded++;
                  pinsAddedDuringReplay++;
                } catch { /* generator rejected */ }
              }
            }
          }
        } catch (e) {
          if (verbose) log(`LLM proposer failed at ${c.sha.slice(0, 8)}: ${(e as Error).message}`);
        }
      }

      // Run vitest against all live pins
      const verdicts = runVitestOnPinDir(worktreePath, pinsRelDir, vitestTimeoutMs);

      // Detect catches: live pin that PASSED previously and FAILS now
      // (new pins get their initial reading here — never a catch on first read)
      for (const lp of livePins) {
        const v = verdicts.get(lp.filename);
        const newVerdict: "pass" | "fail" | "skip" | "error" = v ?? "error";
        if (lp.lastVerdict === "pass" && newVerdict === "fail") {
          catches.push({
            commitSha: c.sha,
            commitSubject: c.subject.slice(0, 100),
            pinFilename: lp.filename,
            pinTemplate: lp.template,
            pinIntroducedAt: lp.introducedAt,
            pinWasSibling: lp.isSibling,
            pinWasFromLlm: lp.isFromLlm,
          });
        }
        lp.lastVerdict = newVerdict;
      }

      if (verbose && (i === 0 || i === replayCommits.length - 1 || (i + 1) % 10 === 0 || newPinsAdded > 0)) {
        log(`commit ${i + 1}/${replayCommits.length} ${c.sha.slice(0, 8)} new-pins=${newPinsAdded} (sib=${newSiblingsAdded} llm=${newLlmAdded}) live=${livePins.length} catches=${catches.length}`);
      }
    }

    report = {
      repo: repoPath,
      totalCommits: commits.length,
      installCommit: installCommit.sha,
      installCommitIdx: installIdx,
      replayCommitCount: replayCommits.length,
      baselinePinsAttempted: baselineUnique.length,
      baselinePinsPositive: livePins.filter((p) => p.introducedAt === "baseline").length,
      baselinePinsDropped: baselineDropped,
      pinsAddedDuringReplay,
      siblingPinsTotal: livePins.filter((p) => p.isSibling).length,
      llmPinsTotal: livePins.filter((p) => p.isFromLlm).length,
      totalLivePinsAtEnd: livePins.length,
      catches,
      catchesFromSiblings: catches.filter((c) => c.pinWasSibling).length,
      catchesFromLlm: catches.filter((c) => c.pinWasFromLlm).length,
      siblingsEnabled: enableSiblings,
      llmProposerEnabled: enableLlmProposer,
      durationMs: Date.now() - t0,
    };
  } finally {
    try {
      git(repoPath, ["worktree", "remove", "--force", worktreePath]);
    } catch { /* */ }
    try { rmSync(worktreePath, { recursive: true, force: true }); } catch { /* */ }
  }

  return report;
}
