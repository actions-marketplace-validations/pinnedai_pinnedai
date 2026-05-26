// ═══════════════════════════════════════════════════════════════
// ◆ Pinned by pinnedai — https://pinnedai.dev
// ═══════════════════════════════════════════════════════════════
// Original PR claim: "config-invariant OIDC permission in .github/workflows/pinned.yml"
// Source PR:         baseline-20260525
// Template:          config-invariant
// Protects:          OIDC permission in .github/workflows/pinned.yml
// Permanent:         this test fails if the claim is ever regressed.
//
// Retire when the invariant intentionally changes:
//   pinned retire baseline-20260525-config-invariant-config-github-workflows-pinned-yml-oidc-permission-utap8d --reason="..."
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_PATH = ".github/workflows/pinned.yml";
const EXPECTED = "id-token: write";
const LABEL = "OIDC permission";
const ORIGINAL_PR = "baseline-20260525";
const ORIGINAL_CLAIM = "config-invariant OIDC permission in .github/workflows/pinned.yml";
const TEST_FILENAME = "baseline-20260525-config-invariant-config-github-workflows-pinned-yml-oidc-permission-utap8d.test.ts";

function repairPrompt(reason: string): string {
  return [
    "",
    "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
    "",
    "Config-invariant pin failed:",
    "  Claim: " + ORIGINAL_CLAIM,
    "  Original PR: " + ORIGINAL_PR,
    "  File: " + CONFIG_PATH,
    "  What's missing: " + LABEL,
    "  Required substring: " + EXPECTED,
    "  Failure: " + reason,
    "",
    "Why this matters: the substring above is a load-bearing config",
    "fragment. Common causes of this failure:",
    "  - AI 'cleaned up' the file and removed a section it didn't",
    "    recognize as important",
    "  - A refactor moved the config elsewhere (move it back, or pin",
    "    the new location and retire this pin)",
    "  - The line was intentionally dropped (ask the user to confirm,",
    "    then retire the pin)",
    "",
    "Do not modify this pinned test file. Restore the config content",
    "or retire the pin via:",
    "  pinned retire " + "baseline-20260525-config-invariant-config-github-workflows-pinned-yml-oidc-permission-utap8d" + " --reason=\"...\"",
    "",
    "After resolving, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].join("\n");
}

describe("pinned: config-invariant " + LABEL + " in " + CONFIG_PATH, () => {
  it("config file contains the expected " + LABEL + " content", () => {
    const full = resolve(process.cwd(), CONFIG_PATH);
    if (!existsSync(full)) {
      throw new Error(
        repairPrompt("config file " + CONFIG_PATH + " not found (was it deleted?)")
      );
    }
    let contents: string;
    try {
      contents = readFileSync(full, "utf8");
    } catch (e) {
      throw new Error(
        repairPrompt("could not read config file: " + (e as Error).message)
      );
    }
    if (!contents.includes(EXPECTED)) {
      const preview = contents.length > 500
        ? contents.slice(0, 500) + "\n... [truncated " + (contents.length - 500) + " bytes]"
        : contents;
      throw new Error(
        repairPrompt("substring not found in " + CONFIG_PATH + ".\n  Looked for: " + JSON.stringify(EXPECTED) + "\n  File content (first 500 chars):\n" + preview)
      );
    }
    expect(contents).toContain(EXPECTED);
  });
});
