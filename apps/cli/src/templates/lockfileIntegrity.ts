// Template: lockfile-integrity
//
// Asserts the SHA-256 of a lockfile (package-lock.json / pnpm-lock.yaml /
// yarn.lock / bun.lockb) matches the value captured at pin time.
// Catches AI agents that regenerate lockfiles silently — a common
// "AI ran `npm install` and broke reproducibility" failure mode.
//
// Why SHA-256 of the whole file instead of parsing the lockfile and
// hashing individual entries: simpler, no per-lockfile-format code,
// and ANY change to the lockfile (even comments / formatting) catches
// the regeneration event. If the user *intentionally* updates deps,
// they retire the pin via `pinned retire ... --reason="dep update"`
// and a fresh baseline scan generates a new pin with the new hash.

import type { LockfileIntegrityClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = {
  prId: string;
};

export type GeneratedTest = {
  filename: string;
  content: string;
  claimId: string;
};

export function generateLockfileIntegrityTest(
  claim: LockfileIntegrityClaim,
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
// Template:          lockfile-integrity
// Permanent:         this test fails if the claim is ever regressed.
//
// Retire when you intentionally regenerate the lockfile:
//   pinned retire ${claimId} --reason="dep update: <describe>"
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const LOCKFILE_PATH = ${JSON.stringify(claim.lockfilePath)};
const EXPECTED_SHA256 = ${JSON.stringify(claim.expectedSha256)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};
const TEST_FILENAME = ${JSON.stringify(filename)};

function repairPrompt(reason: string): string {
  return [
    "",
    "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
    "",
    "Lockfile integrity pin failed:",
    "  Claim: " + ORIGINAL_CLAIM,
    "  Original PR: " + ORIGINAL_PR,
    "  Lockfile: " + LOCKFILE_PATH,
    "  Expected SHA-256: " + EXPECTED_SHA256,
    "  Failure: " + reason,
    "",
    "Why this matters: a changed lockfile means transitive dependencies",
    "may have shifted. Even if package.json declares the same versions,",
    "the resolved transitive tree can pick different patch versions of",
    "indirect deps — which is how AI agents silently introduce mystery",
    "build / runtime breakage by running 'npm install'.",
    "",
    "Two paths to resolve:",
    "  (a) If the regeneration was UNINTENTIONAL: restore the lockfile",
    "      via 'git checkout " + LOCKFILE_PATH + "' or 'git restore " + LOCKFILE_PATH + "'.",
    "  (b) If the regeneration was INTENTIONAL (e.g., dependency update):",
    "      ask the user to retire the pin so a fresh hash is captured:",
    "      pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"dep update: ...\\"",
    "",
    "Do not modify this pinned test file.",
    "",
    "After resolving, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].join("\\n");
}

describe("pinned: lockfile-integrity " + LOCKFILE_PATH, () => {
  it("lockfile SHA-256 matches the value captured at pin time", () => {
    const lockfileAbs = resolve(process.cwd(), LOCKFILE_PATH);
    if (!existsSync(lockfileAbs)) {
      throw new Error(
        repairPrompt("lockfile not found at " + LOCKFILE_PATH + ". Did someone delete it?")
      );
    }
    let contents: Buffer;
    try {
      contents = readFileSync(lockfileAbs);
    } catch (e) {
      throw new Error(
        repairPrompt("could not read lockfile: " + (e as Error).message)
      );
    }
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== EXPECTED_SHA256) {
      throw new Error(
        repairPrompt("SHA-256 changed.\\n  expected: " + EXPECTED_SHA256 + "\\n  actual:   " + actual)
      );
    }
    expect(actual).toBe(EXPECTED_SHA256);
  });
});
`;

  return { filename, content, claimId };
}
