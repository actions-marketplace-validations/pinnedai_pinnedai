// Template: lockfile-integrity
//
// Detects the *suspicious* class of lockfile changes — NOT every edit.
// Generic dep updates (where the user also bumped package.json) are
// noise and we deliberately let them pass. The only catches that survive
// are the high-signal ones:
//
//   - lockfile removed / pm switched  → FAIL
//   - silent regen (lockfile changed but package.json did not) → FAIL
//   - everything else (intentional update — package.json moved too) → PASS
//
// "Silent regen" is the failure mode worth users' attention: an AI
// agent ran `npm install` for no declared reason, transitive deps
// shifted, build is now mystery-fragile. Routine dep bumps are
// expected lifecycle and should not trip the pin.
//
// Backward compat: pre-v0.1.x pins without packageJsonSha256 fall
// back to strict hash equality (the old behavior). New baselines
// always populate it.

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
// Permanent:         this test fails ONLY on suspicious lockfile
//                    drift — not on routine dep updates.
//
// Retire when you intentionally remove the lockfile or switch package
// managers (rare):
//   pinned retire ${claimId} --reason="<describe>"
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const LOCKFILE_PATH = ${JSON.stringify(claim.lockfilePath)};
const EXPECTED_LOCK_SHA256 = ${JSON.stringify(claim.expectedSha256)};
const EXPECTED_PKG_JSON_SHA256 = ${JSON.stringify(claim.packageJsonSha256 ?? null)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};
const TEST_FILENAME = ${JSON.stringify(filename)};

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function repairPrompt(reason: string): string {
  return [
    "",
    "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
    "",
    "Lockfile integrity pin failed:",
    "  Claim: " + ORIGINAL_CLAIM,
    "  Original PR: " + ORIGINAL_PR,
    "  Lockfile: " + LOCKFILE_PATH,
    "  Failure: " + reason,
    "",
    "This pin only fires on suspicious drift — silent regenerations",
    "(lockfile changed but package.json didn't), the lockfile being",
    "removed, or a package manager switch. Routine dep updates where",
    "package.json moved too pass automatically.",
    "",
    "Two paths to resolve:",
    "  (a) UNINTENTIONAL silent regen: restore the lockfile via",
    "      'git checkout " + LOCKFILE_PATH + "' or 'git restore " + LOCKFILE_PATH + "'.",
    "  (b) INTENTIONAL pm switch / lockfile removal: retire so a fresh",
    "      baseline gets captured:",
    "      pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"<describe>\\"",
    "",
    "Do not modify this pinned test file.",
    "",
    "After resolving, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].join("\\n");
}

describe("pinned: lockfile-integrity " + LOCKFILE_PATH, () => {
  it("lockfile is intact OR a dep-update moved package.json too", () => {
    const lockfileAbs = resolve(process.cwd(), LOCKFILE_PATH);
    if (!existsSync(lockfileAbs)) {
      throw new Error(
        repairPrompt("lockfile not found at " + LOCKFILE_PATH + " — was it deleted or did the package manager switch?")
      );
    }
    let actualLockSha: string;
    try {
      actualLockSha = sha256(lockfileAbs);
    } catch (e) {
      throw new Error(
        repairPrompt("could not read lockfile: " + (e as Error).message)
      );
    }
    if (actualLockSha === EXPECTED_LOCK_SHA256) {
      // Lockfile unchanged — pass.
      expect(actualLockSha).toBe(EXPECTED_LOCK_SHA256);
      return;
    }

    // Lockfile changed. Gate on package.json delta — if it moved too,
    // this is almost certainly an intentional dep update (not the
    // silent-regen failure mode). Only fail when the package.json sha
    // is identical to what it was at pin time.
    if (EXPECTED_PKG_JSON_SHA256 === null) {
      // Legacy pin (pre-gating). Fall back to strict hash equality.
      throw new Error(
        repairPrompt("SHA-256 changed (legacy pin without package.json gating).\\n  expected: " + EXPECTED_LOCK_SHA256 + "\\n  actual:   " + actualLockSha)
      );
    }
    const pkgJsonAbs = resolve(process.cwd(), "package.json");
    if (!existsSync(pkgJsonAbs)) {
      // package.json gone — can't gate. Treat as suspicious.
      throw new Error(
        repairPrompt("lockfile changed and package.json is missing — cannot verify whether this was an intentional dep update.")
      );
    }
    const actualPkgSha = sha256(pkgJsonAbs);
    if (actualPkgSha === EXPECTED_PKG_JSON_SHA256) {
      // Silent regen — the failure mode this pin protects against.
      throw new Error(
        repairPrompt(
          "lockfile regenerated WITHOUT a package.json change — likely a stray 'npm install' / 'pnpm install' that silently shifted transitive deps.\\n" +
          "  lockfile sha (expected → actual): " + EXPECTED_LOCK_SHA256 + " → " + actualLockSha + "\\n" +
          "  package.json sha (unchanged):    " + actualPkgSha
        )
      );
    }
    // Lockfile changed AND package.json changed — accept as legit
    // dep update. Soft-pass.
    expect(actualPkgSha).not.toBe(EXPECTED_PKG_JSON_SHA256);
  });
});
`;

  return { filename, content, claimId };
}
