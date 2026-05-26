// Commit-time mistake detectors — the "AI quietly committed something
// it shouldn't have" surface. Each detector takes a diff snapshot
// (added lines per file + status) and returns violations.
//
// Discovered + validated 2026-05-23 via historical scan of 19 repos
// (15 personal + 4 held-out OSS). Generalization verified:
// patterns hit on held-out repos comparable rate to training.
// See [[strategic-pivot-guard-integrity]] P0 expansion.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChangedFile } from "./scanDiff.js";

export type CommitMistakeViolation = {
  type:
    | "secret-committed"        // sk-, AKIA, ghp_, etc. in added lines
    | "env-file-committed"      // .env / .env.production added without gitignore
    | "hardcoded-localhost"     // localhost / 127.0.0.1 URL in production source
    | "error-handling-removed"  // net-removed if(!res.ok) / try/catch
    | "auth-header-removed";    // net-removed authHeaders / Authorization
  severity: "block" | "warn";
  file: string;
  evidence: string;
  /** Optional line context for PR-comment formatting */
  matchedLine?: string;
};

export type CommitMistakeInput = {
  repoRoot: string;
  changedFiles: ChangedFile[];
  /** Optional pre-parsed per-file added-line list (matches DiffByFile shape) */
  addedLinesByFile?: Map<string, string[]>;
  /** Optional per-file removed-line list */
  removedLinesByFile?: Map<string, string[]>;
  /**
   * Opt-in low-precision detectors. Off by default after the
   * 2026-05-23 dogfood empirical run showed these produce mostly
   * noise on real codebases (env-var fallbacks, intentional
   * refactors, config files). Users who want the extra signal can
   * pass `--strict` to the CLI hook. See [[dogfood-empirical-2026-05-23]].
   */
  strict?: boolean;
};

// 1. Committed secrets — patterns the regex is very specific about
//    to keep FP rate low. Each pattern is anchored to known token
//    prefixes that real keys use (OpenAI: sk-, AWS: AKIA, GitHub:
//    ghp_/gho_/ghs_, npm: npm_, Slack: xox[baprs]-).
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\bsk-proj-[A-Za-z0-9_-]{30,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{30,}\b/,
  /\bgho_[A-Za-z0-9]{30,}\b/,
  /\bghs_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{50,}\b/,
  /\bnpm_[A-Za-z0-9]{30,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/, // Google API
];

// File types where a "secret-looking" string is most likely a real
// secret (vs documentation). We skip docs / examples / fixtures.
function fileLikelyHasRealSecret(path: string): boolean {
  if (/\.(md|mdx|txt|rst)$/i.test(path)) return false;
  if (/(?:^|\/)(docs?|examples?|fixtures?|samples?|README)/i.test(path)) return false;
  if (/\.test\.|\.spec\./.test(path)) return false;
  return true;
}

function detectSecretsInDiff(input: CommitMistakeInput): CommitMistakeViolation[] {
  const out: CommitMistakeViolation[] = [];
  const added = input.addedLinesByFile ?? new Map();
  for (const [filePath, lines] of added) {
    if (!fileLikelyHasRealSecret(filePath)) continue;
    const joined = lines.join("\n");
    for (const re of SECRET_PATTERNS) {
      const m = re.exec(joined);
      if (m) {
        out.push({
          type: "secret-committed",
          severity: "block",
          file: filePath,
          evidence: `Looks like a real API key / token was committed (pattern: ${m[0].slice(0, 8)}...). Rotate immediately, remove from git history, and store in .env (gitignored).`,
          matchedLine: lines.find((l: string) => re.test(l))?.slice(0, 80),
        });
        break; // one violation per file
      }
    }
  }
  return out;
}

// 2. .env files added without .gitignore coverage
const ENV_FILE_PATHS = [".env", ".env.local", ".env.production", ".env.production.local", ".env.development.local"];

function detectEnvAdded(input: CommitMistakeInput): CommitMistakeViolation[] {
  const out: CommitMistakeViolation[] = [];
  for (const f of input.changedFiles) {
    if (f.status !== "added") continue;
    if (!ENV_FILE_PATHS.some((n) => f.path === n || f.path.endsWith(`/${n}`))) continue;

    // Check gitignore coverage
    let gitignore = "";
    try {
      gitignore = readFileSync(join(input.repoRoot, ".gitignore"), "utf8");
    } catch { /* */ }
    const ignored = gitignore.split("\n").some((line) => {
      const t = line.trim();
      return t === f.path || t === `/${f.path}` || t === ".env*" || t === ".env" || t === "*.env";
    });
    if (ignored) continue;

    out.push({
      type: "env-file-committed",
      severity: "block",
      file: f.path,
      evidence: `${f.path} added to the repo without .gitignore coverage. If this file contains real secrets, ROTATE them immediately and add to .gitignore. If it's a template/example, rename to ${f.path}.example.`,
    });
  }
  return out;
}

// 3. Hardcoded localhost / 127.0.0.1 / 0.0.0.0 URLs in production source
const LOCALHOST_PATTERN = /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:[0-9]+)?(\/|"|'|`|\s|$)/;

const SKIP_FOR_LOCALHOST = /(?:^|\/)(?:tests?|scripts?|docs?|examples?|fixtures?|dev|playground|\.next|\.turbo|dist|build|out|coverage|node_modules)\//i;

function detectHardcodedLocalhost(input: CommitMistakeInput): CommitMistakeViolation[] {
  const out: CommitMistakeViolation[] = [];
  const added = input.addedLinesByFile ?? new Map();
  for (const [filePath, lines] of added) {
    if (SKIP_FOR_LOCALHOST.test(filePath)) continue;
    if (/\.(test|spec)\./.test(filePath)) continue;
    if (/\.(md|mdx|txt)$/i.test(filePath)) continue;
    for (const line of lines) {
      if (LOCALHOST_PATTERN.test(line)) {
        out.push({
          type: "hardcoded-localhost",
          severity: "warn",
          file: filePath,
          evidence: `Hardcoded localhost / 127.0.0.1 URL added to production source. Use an env var (NEXT_PUBLIC_API_URL / process.env.*) instead.`,
          matchedLine: line.trim().slice(0, 80),
        });
        break;
      }
    }
  }
  return out;
}

// 4. Net-removed error handling — `if (!res.ok)` or `try/catch` block
//    count went down without being replaced.
const ERR_HANDLING_PATTERNS: RegExp[] = [
  /\bif\s*\(\s*!\s*(?:res|response|r|result)\s*\.\s*ok\s*\)/,
  /\bcatch\s*\(\s*(?:e|err|error|ex)\w*\s*\)/,
  /\bthrowIfNotOk\s*\(/,
  /\bensureOk\s*\(/,
];

function countMatches(lines: string[] | undefined, patterns: RegExp[]): number {
  if (!lines) return 0;
  let n = 0;
  for (const line of lines) {
    for (const re of patterns) {
      if (re.test(line)) {
        n++;
        break;
      }
    }
  }
  return n;
}

function detectErrHandlingRemoved(input: CommitMistakeInput): CommitMistakeViolation[] {
  const out: CommitMistakeViolation[] = [];
  const added = input.addedLinesByFile ?? new Map();
  const removed = input.removedLinesByFile ?? new Map();
  const files = new Set<string>([...added.keys(), ...removed.keys()]);
  for (const filePath of files) {
    if (/\.(test|spec)\./.test(filePath)) continue;
    if (SKIP_FOR_LOCALHOST.test(filePath)) continue;
    const addCount = countMatches(added.get(filePath), ERR_HANDLING_PATTERNS);
    const remCount = countMatches(removed.get(filePath), ERR_HANDLING_PATTERNS);
    if (remCount > addCount && remCount >= 2) {
      out.push({
        type: "error-handling-removed",
        severity: "warn",
        file: filePath,
        evidence: `Net-removed ${remCount - addCount} error-handling pattern${remCount - addCount === 1 ? "" : "s"} (if(!res.ok) / try/catch). If intentional (e.g., centralizing error handling), confirm errors still surface. Otherwise restore.`,
      });
    }
  }
  return out;
}

// 5. Net-removed auth header — `authHeaders()` / `Authorization` etc.
//    removed from a client fetch without being replaced.
const AUTH_HEADER_PATTERNS: RegExp[] = [
  /\bauth(?:Headers?|Token|orize|orized)\s*\(/,
  /['"]Authorization['"]\s*:/,
  /\bcredentials\s*:\s*['"](?:include|same-origin)['"]/,
  /\bgetCsrfToken\s*\(/i,
];

function detectAuthHeaderRemoved(input: CommitMistakeInput): CommitMistakeViolation[] {
  const out: CommitMistakeViolation[] = [];
  const added = input.addedLinesByFile ?? new Map();
  const removed = input.removedLinesByFile ?? new Map();
  const files = new Set<string>([...added.keys(), ...removed.keys()]);
  for (const filePath of files) {
    if (/\.(test|spec)\./.test(filePath)) continue;
    if (SKIP_FOR_LOCALHOST.test(filePath)) continue;
    const addCount = countMatches(added.get(filePath), AUTH_HEADER_PATTERNS);
    const remCount = countMatches(removed.get(filePath), AUTH_HEADER_PATTERNS);
    if (remCount > addCount && remCount >= 2) {
      out.push({
        type: "auth-header-removed",
        severity: "block",
        file: filePath,
        evidence: `Net-removed ${remCount - addCount} auth-header pattern${remCount - addCount === 1 ? "" : "s"} (authHeaders() / Authorization / credentials). If intentional (route is now public), confirm explicitly. Otherwise restore — dropped auth is a security regression.`,
      });
    }
  }
  return out;
}

export function detectCommitMistakes(input: CommitMistakeInput): CommitMistakeViolation[] {
  const out: CommitMistakeViolation[] = [];
  // Default-on (high precision, validated on dogfood):
  out.push(...detectSecretsInDiff(input));
  out.push(...detectEnvAdded(input));
  out.push(...detectAuthHeaderRemoved(input));
  // Opt-in (--strict). Low precision on real codebases:
  if (input.strict) {
    out.push(...detectHardcodedLocalhost(input));
    out.push(...detectErrHandlingRemoved(input));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// State-based detectors — scan the REPO AT HEAD, not a single diff.
// Used by the install-baseline audit to surface pre-existing issues
// the customer may not know about (e.g., a secret committed years
// before Pinned was installed). Diff-only scans systematically miss
// these.
// ─────────────────────────────────────────────────────────────────────

export type StateAuditInput = {
  repoRoot: string;
  /** Maximum file count to scan (perf cap). Default 2000. */
  maxFiles?: number;
};

export type StateAuditFinding = {
  type:
    | "secret-in-code"           // SECRET regex match in a current file
    | "hardcoded-localhost-in-code" // localhost URL in current production file
    | "env-file-in-tree"         // .env exists in working tree without gitignore coverage
    | "src-test-discrepancy";    // diff-style historical findings deferred
  severity: "block" | "warn";
  file: string;
  line?: number;
  evidence: string;
  matchedLine?: string;
};

// Lightweight FS walker (avoids depending on scanDiff's internal walker
// to keep this module self-contained).
import { readdirSync, lstatSync } from "node:fs";

function walkFiles(root: string, maxFiles: number): string[] {
  const out: string[] = [];
  const IGNORE = new Set([
    "node_modules", ".git", ".next", "dist", "build", "out",
    ".turbo", ".cache", "coverage", ".vercel", ".netlify",
  ]);
  const walk = (rel: string): void => {
    if (out.length >= maxFiles) return;
    const abs = join(root, rel);
    let entries: string[];
    try { entries = readdirSync(abs); } catch { return; }
    for (const name of entries) {
      if (IGNORE.has(name)) continue;
      const next = rel ? `${rel}/${name}` : name;
      let st;
      try { st = lstatSync(join(abs, name)); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(next);
      else if (st.isFile()) out.push(next);
      if (out.length >= maxFiles) return;
    }
  };
  walk("");
  return out;
}

export function auditCurrentState(input: StateAuditInput): StateAuditFinding[] {
  const out: StateAuditFinding[] = [];
  const maxFiles = input.maxFiles ?? 2000;
  const files = walkFiles(input.repoRoot, maxFiles);

  // 1. Secrets currently in code (any committed secret left behind)
  for (const rel of files) {
    if (!fileLikelyHasRealSecret(rel)) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|json|env|yaml|yml|toml)$/i.test(rel)) continue;
    let content: string;
    try { content = readFileSync(join(input.repoRoot, rel), "utf8"); } catch { continue; }
    if (content.length > 256 * 1024) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const re of SECRET_PATTERNS) {
        const m = re.exec(line);
        if (m) {
          out.push({
            type: "secret-in-code",
            severity: "block",
            file: rel,
            line: i + 1,
            evidence: `Looks like a real API key / token exists in your repo today (pattern: ${m[0].slice(0, 8)}...). Rotate immediately, remove from git history (git-filter-repo), and move into a gitignored .env.`,
            matchedLine: line.slice(0, 80),
          });
          break;
        }
      }
    }
  }

  // 2. Hardcoded localhost in current production code
  for (const rel of files) {
    if (SKIP_FOR_LOCALHOST.test(rel)) continue;
    if (/\.(test|spec)\./.test(rel)) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(rel)) continue;
    let content: string;
    try { content = readFileSync(join(input.repoRoot, rel), "utf8"); } catch { continue; }
    if (content.length > 256 * 1024) continue;
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (LOCALHOST_PATTERN.test(lines[i])) {
        out.push({
          type: "hardcoded-localhost-in-code",
          severity: "warn",
          file: rel,
          line: i + 1,
          evidence: `Hardcoded localhost / 127.0.0.1 URL in production source. Replace with env var (process.env.* or NEXT_PUBLIC_*) so the deployed version doesn't try to reach localhost.`,
          matchedLine: lines[i].trim().slice(0, 80),
        });
        break;
      }
    }
  }

  // 3. .env file present without .gitignore coverage
  for (const envName of ENV_FILE_PATHS) {
    const abs = join(input.repoRoot, envName);
    if (!existsSync(abs)) continue;
    let gitignore = "";
    try { gitignore = readFileSync(join(input.repoRoot, ".gitignore"), "utf8"); } catch { /* */ }
    const ignored = gitignore.split("\n").some((line) => {
      const t = line.trim();
      return t === envName || t === `/${envName}` || t === ".env*" || t === ".env" || t === "*.env";
    });
    if (!ignored) {
      out.push({
        type: "env-file-in-tree",
        severity: "block",
        file: envName,
        evidence: `${envName} present in repo without .gitignore coverage. If it contains real secrets, ROTATE them and add to .gitignore.`,
      });
    }
  }

  return out;
}
