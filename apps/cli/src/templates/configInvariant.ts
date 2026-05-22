// Template: config-invariant
//
// Asserts that a specific substring is present in a config file.
// Catches AI agents that "tidy" config (CLAUDE.md, .github/workflows/,
// .env.example, package.json) and accidentally remove load-bearing
// lines — like the GitHub Actions `id-token: write` permission, the
// Pinned guardrail block in CLAUDE.md, or a required env var entry in
// .env.example.
//
// Single substring contract: no fuzzy matching, no regex. The
// substring is checked verbatim. If the user wants to assert structure
// (JSON keys, YAML paths), they use a different template. This is
// deliberately the cheapest possible contract: "this exact text
// fragment must be present."

import type { ConfigInvariantClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = {
  prId: string;
};

export type GeneratedTest = {
  filename: string;
  content: string;
  claimId: string;
};

export function generateConfigInvariantTest(
  claim: ConfigInvariantClaim,
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
// Template:          config-invariant
// Protects:          ${claim.label} in ${claim.configPath}
// Permanent:         this test fails if the claim is ever regressed.
//
// Retire when the invariant intentionally changes:
//   pinned retire ${claimId} --reason="..."
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_PATH = ${JSON.stringify(claim.configPath)};
const EXPECTED = ${JSON.stringify(claim.expected)};
const LABEL = ${JSON.stringify(claim.label)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};
const TEST_FILENAME = ${JSON.stringify(filename)};

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
    "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"",
    "",
    "After resolving, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].join("\\n");
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
        ? contents.slice(0, 500) + "\\n... [truncated " + (contents.length - 500) + " bytes]"
        : contents;
      throw new Error(
        repairPrompt("substring not found in " + CONFIG_PATH + ".\\n  Looked for: " + JSON.stringify(EXPECTED) + "\\n  File content (first 500 chars):\\n" + preview)
      );
    }
    expect(contents).toContain(EXPECTED);
  });
});
`;

  return { filename, content, claimId };
}
