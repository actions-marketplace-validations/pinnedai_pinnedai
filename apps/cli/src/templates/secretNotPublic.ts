// Template: secret-not-public
//
// Scans `.env*` files + source code for any env var matching the
// pattern <publicPrefix>...<SECRET-MARKER>... (e.g.
// NEXT_PUBLIC_STRIPE_SECRET_KEY). Fails if any match is found.
//
// Why this is high-leverage: in Next.js / Vite / CRA, env vars
// starting with the framework's public prefix get INLINED into the
// client bundle at build time. If a server-only secret gets
// accidentally renamed to start with that prefix (an easy AI
// mistake during refactors), the secret leaks to every page visitor.
// One real PR can blow your Stripe / OpenAI / AWS budget.
//
// Pure filesystem scan: no preview URL, no test runner fixtures.
// Just reads .env*, .env.example, .env.local, and source files
// looking for the dangerous pattern.

import type { SecretNotPublicClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = {
  prId: string;
};

export type GeneratedTest = {
  filename: string;
  content: string;
  claimId: string;
};

export function generateSecretNotPublicTest(
  claim: SecretNotPublicClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;

  const content = `// ═══════════════════════════════════════════════════════════════
// ◆ Pinned by pinnedai — https://pinnedai.dev
// ═══════════════════════════════════════════════════════════════
// Original PR claim: ${JSON.stringify(claim.raw)}
// Source PR:         ${opts.prId}
// Template:          secret-not-public
// Protects:          server secrets from leaking via ${claim.publicPrefix}*
//
// Retire when intentionally changing the prefix convention:
//   pinned retire ${claimId} --reason="..."
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PUBLIC_PREFIX = ${JSON.stringify(claim.publicPrefix)};
const SECRET_MARKERS = ${JSON.stringify(claim.secretMarkers)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};
const TEST_FILENAME = ${JSON.stringify(filename)};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  ".pinnedai",
  "tests/pinned",
]);
const SCAN_EXTS = [".env", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

type Match = { file: string; line: number; text: string; varName: string };

function repairPrompt(matches: Match[]): string {
  const lines: string[] = [
    "",
    "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
    "",
    "secret-not-public pin failed:",
    "  Claim: " + ORIGINAL_CLAIM,
    "  Original PR: " + ORIGINAL_PR,
    "  Public prefix: " + PUBLIC_PREFIX,
    "  Secret markers: " + SECRET_MARKERS.join(", "),
    "",
    "Found env var(s) starting with " + PUBLIC_PREFIX + " that contain a",
    "secret-shaped marker. These get INLINED into the client bundle by",
    "Next.js / Vite / CRA — meaning every page visitor downloads the value.",
    "",
    "Matches:",
  ];
  for (const m of matches) {
    lines.push("  " + m.file + ":" + m.line + " — " + m.varName);
  }
  lines.push("");
  lines.push("Fix: rename the variable WITHOUT the " + PUBLIC_PREFIX + " prefix");
  lines.push("(so it stays server-only). For example:");
  lines.push("  " + PUBLIC_PREFIX + "STRIPE_SECRET_KEY  →  STRIPE_SECRET_KEY");
  lines.push("");
  lines.push("If the rename was intentional and the var is genuinely safe to");
  lines.push("expose (extremely unusual for a secret-named var), retire the pin:");
  lines.push("  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"");
  lines.push("");
  lines.push("Do not modify this pinned test file.");
  lines.push("");
  lines.push("After resolving, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME);
  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("");
  return lines.join("\\n");
}

function shouldScanPath(relPath: string): boolean {
  // env files match by basename starting with .env
  const base = relPath.split("/").pop() ?? "";
  if (base.startsWith(".env")) return true;
  return SCAN_EXTS.some((ext) => relPath.endsWith(ext));
}

function isSkipDir(name: string): boolean {
  if (SKIP_DIRS.has(name)) return true;
  if (name.startsWith(".") && name !== ".env" && !name.startsWith(".env.")) return true;
  return false;
}

function walk(rootRel: string, cwd: string, out: string[]): void {
  const abs = join(cwd, rootRel);
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (isSkipDir(e.name)) continue;
    const childRel = rootRel ? rootRel + "/" + e.name : e.name;
    if (e.isDirectory()) {
      walk(childRel, cwd, out);
    } else if (e.isFile() && shouldScanPath(childRel)) {
      out.push(childRel);
    }
    if (out.length > 5000) return;
  }
}

describe("pinned: secret-not-public " + PUBLIC_PREFIX, () => {
  it("no " + PUBLIC_PREFIX + "* env var contains a secret-shaped marker", () => {
    const cwd = process.cwd();
    const files: string[] = [];
    walk("", cwd, files);

    // Build a regex that matches PUBLIC_PREFIX at an identifier
    // boundary, followed by zero-or-more WORD_ segments, a secret
    // marker as a complete segment, and an optional trailing suffix.
    //
    // The two boundary guards are load-bearing:
    //   - Lookbehind (?<![A-Z0-9_]): prefix must NOT be in the middle
    //     of a longer identifier. Without this, ORG_INVITE_SECRET
    //     matches as VITE_SECRET (the substring starts at "V" inside
    //     "INVITE") — a real FP we hit on Quantasyte's invite-token code.
    //   - Lookahead (?![A-Z0-9]): marker must be followed by _ or
    //     end-of-name. Without this, API_KEYS_ENABLED matches as
    //     API_KEY — another real Quantasyte FP (feature-flag bool).
    const escapedPrefix = PUBLIC_PREFIX.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&");
    const markerAlt = SECRET_MARKERS
      .map((m) => m.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&"))
      .join("|");
    const re = new RegExp(
      "(?<![A-Z0-9_])" +
        escapedPrefix +
        "(?:[A-Z0-9]+_)*?(?:" + markerAlt + ")(?:_[A-Z0-9_]*)?(?![A-Z0-9])",
      "g"
    );

    const matches: Match[] = [];
    for (const file of files) {
      let content: string;
      try {
        content = readFileSync(join(cwd, file), "utf8");
      } catch {
        continue;
      }
      // Skip every pin test file — they reference PUBLIC_PREFIX and
      // SECRET_MARKERS in constants and would self-match. Production
      // pins live under tests/pinned/; the backtest harness places
      // generated pins under tests/pinned-backtest/. Without the
      // second skip, the bug-fix benchmark always self-fails on the
      // generated test's own constants — a real bug we hit during
      // the v0.1 calibration run.
      if (file.startsWith("tests/pinned/")) continue;
      if (file.startsWith("tests/pinned-backtest/")) continue;
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx") || file.endsWith(".test.js")) {
        // Belt-and-suspenders: a test file with this template's own
        // shape is almost certainly a pinned test in a non-standard
        // location (custom test dir, copied fixture, etc.). Skipping
        // all *.test.* files is too broad (would miss real leaks in
        // application tests) — but skipping tests that explicitly
        // self-reference the template name is correct.
        const head = content.slice(0, 2048);
        if (head.includes("pinned: secret-not-public") || head.includes("secret-not-public pin")) continue;
      }
      const lines = content.split("\\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m: RegExpExecArray | null;
        re.lastIndex = 0;
        while ((m = re.exec(line)) !== null) {
          matches.push({ file, line: i + 1, text: line, varName: m[0] });
          if (matches.length > 100) break;
        }
        if (matches.length > 100) break;
      }
      if (matches.length > 100) break;
    }

    if (matches.length > 0) {
      throw new Error(repairPrompt(matches));
    }
    expect(matches).toEqual([]);
  });
});
`;

  return { filename, content, claimId };
}
