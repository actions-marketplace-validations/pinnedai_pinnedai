// Template: cli-json-shape
//
// Spawns the command via spawnSync, parses stdout as JSON, asserts that
// every required key is present at the top level of the parsed object.
//
// Why "shape" not "value": values change between runs (counts, IDs,
// timestamps) but the SHAPE — which keys exist — is part of the public
// API contract that machine consumers depend on. This is the strongest
// non-HTTP CLI pin: catches both JSON-validity drift AND key-rename
// drift in one assertion.

import type { CliJsonShapeClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";
import { parseSimpleArgv } from "./cliOutputContains.js";

export type GenerateOpts = {
  prId: string;
};

export type GeneratedTest = {
  filename: string;
  content: string;
  claimId: string;
};

export function generateCliJsonShapeTest(
  claim: CliJsonShapeClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const argv = parseSimpleArgv(claim.route);

  const content = `// ═══════════════════════════════════════════════════════════════
// ◆ Pinned by pinnedai — https://pinnedai.dev
// ═══════════════════════════════════════════════════════════════
// Original PR claim: ${JSON.stringify(claim.raw)}
// Source PR:         ${opts.prId}
// Template:          cli-json-shape
// Permanent:         this test fails if the claim is ever regressed.
//
// Retire when no longer applicable:
//   pinned retire ${claimId} --reason="..."
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";

const COMMAND = ${JSON.stringify(claim.route)};
const ARGV = ${JSON.stringify(argv)};
const REQUIRED_KEYS = ${JSON.stringify(claim.keys)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};
const TEST_FILENAME = ${JSON.stringify(filename)};

function repairPrompt(reason: string): string {
  return [
    "",
    "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
    "",
    "Fix the failing pinned claim in this test file:",
    "  Claim: " + ORIGINAL_CLAIM,
    "  Original PR: " + ORIGINAL_PR,
    "  Command: " + COMMAND,
    "  Required keys: " + REQUIRED_KEYS.join(", "),
    "  Failure: " + reason,
    "",
    "Either restore the JSON output shape, or, if the contract intentionally",
    "changed, ask the user to retire the pin:",
    "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"",
    "",
    "Do not modify this pinned test file. Fix the application code first.",
    "",
    "After fixing, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].join("\\n");
}

describe("pinned: cli-json-shape \`" + COMMAND + "\`", () => {
  it("returns valid JSON with required keys: " + REQUIRED_KEYS.join(", "), () => {
    if (ARGV.length === 0) {
      throw new Error(
        "[pinned skip] empty command after parsing — claim text appears malformed."
      );
    }
    const [bin, ...args] = ARGV;
    const result = spawnSync(bin, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.status !== 0) {
      throw new Error(
        repairPrompt("command exited with non-zero status " + result.status + " — stderr: " + (result.stderr ?? ""))
      );
    }
    const stdout = result.stdout ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      throw new Error(
        repairPrompt("stdout was not valid JSON: " + (e as Error).message + " — first 500 bytes: " + stdout.slice(0, 500))
      );
    }
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error(
        repairPrompt("parsed JSON is not a top-level object (got " + typeof parsed + ")")
      );
    }
    const obj = parsed as Record<string, unknown>;
    const missing: string[] = [];
    for (const key of REQUIRED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        repairPrompt("missing required key(s): " + missing.join(", ") + ". Present keys: " + Object.keys(obj).join(", "))
      );
    }
    expect(missing).toEqual([]);
  });
});
`;

  return { filename, content, claimId };
}
