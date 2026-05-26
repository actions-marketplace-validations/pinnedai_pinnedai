// ═══════════════════════════════════════════════════════════════
// ◆ Pinned by pinnedai — https://pinnedai.dev
// ═══════════════════════════════════════════════════════════════
// Original PR claim: "lockfile-integrity pnpm-lock.yaml sha256 e7a06ea703b2"
// Source PR:         baseline-20260525
// Template:          lockfile-integrity
// Permanent:         this test fails ONLY on suspicious lockfile
//                    drift — not on routine dep updates.
//
// Retire when you intentionally remove the lockfile or switch package
// managers (rare):
//   pinned retire baseline-20260525-lockfile-integrity-lockfile-pnpm-lock-yaml-e7a06ea703b2-tb6mqy --reason="<describe>"
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const LOCKFILE_PATH = "pnpm-lock.yaml";
const EXPECTED_LOCK_SHA256 = "e7a06ea703b2d8d78f6bedd37f52967ed4baf2d2c74c58e99e7e32053b7cd1e5";
const EXPECTED_PKG_JSON_SHA256 = "cf41a8cc4d5c611fb1de5194d3ebac3796538363d919c8e1bae14c85ddbdffad";
const ORIGINAL_PR = "baseline-20260525";
const ORIGINAL_CLAIM = "lockfile-integrity pnpm-lock.yaml sha256 e7a06ea703b2";
const TEST_FILENAME = "baseline-20260525-lockfile-integrity-lockfile-pnpm-lock-yaml-e7a06ea703b2-tb6mqy.test.ts";

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
    "      pinned retire " + "baseline-20260525-lockfile-integrity-lockfile-pnpm-lock-yaml-e7a06ea703b2-tb6mqy" + " --reason=\"<describe>\"",
    "",
    "Do not modify this pinned test file.",
    "",
    "After resolving, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].join("\n");
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
        repairPrompt("SHA-256 changed (legacy pin without package.json gating).\n  expected: " + EXPECTED_LOCK_SHA256 + "\n  actual:   " + actualLockSha)
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
          "lockfile regenerated WITHOUT a package.json change — likely a stray 'npm install' / 'pnpm install' that silently shifted transitive deps.\n" +
          "  lockfile sha (expected → actual): " + EXPECTED_LOCK_SHA256 + " → " + actualLockSha + "\n" +
          "  package.json sha (unchanged):    " + actualPkgSha
        )
      );
    }
    // Lockfile changed AND package.json changed — accept as legit
    // dep update. Soft-pass.
    expect(actualPkgSha).not.toBe(EXPECTED_PKG_JSON_SHA256);
  });
});
