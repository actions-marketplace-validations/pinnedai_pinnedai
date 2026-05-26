// Template: tsc-clean
//
// Spawns `npx tsc --noEmit` against the repo's tsconfig and asserts
// exit 0. Catches TS build/syntax errors that lint can't surface.
// LOW FP because tsc is deterministic; only fails when the codebase
// genuinely doesn't typecheck. Skips silently if tsc isn't available
// (e.g., JS-only repos), since the alternative is a hard infra-fail.

import type { TscCleanClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = { prId: string };
export type GeneratedTest = { filename: string; content: string; claimId: string };

export function generateTscCleanTest(
  claim: TscCleanClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const content = `// ◆ Pinned by pinnedai — https://pinnedai.dev
// Template: tsc-clean
// Protects: \`tsc --noEmit\` keeps exiting 0
// Retire:   pinned retire ${claimId} --reason="..."

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const TSCONFIG_PATH = ${JSON.stringify(claim.tsconfigPath)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};

describe("pinned: tsc-clean " + TSCONFIG_PATH, () => {
  // Hard-skip when the tsconfig is missing — we don't fail loudly on
  // a repo without TS setup; that's not a regression we want to pin.
  const tsconfigFull = resolve(process.cwd(), TSCONFIG_PATH);
  const tsconfigMissing = !existsSync(tsconfigFull);

  it.skipIf(tsconfigMissing)("tsc --noEmit exits 0", () => {
    const r = spawnSync("npx", ["--no-install", "tsc", "--noEmit", "-p", TSCONFIG_PATH], {
      encoding: "utf8",
      timeout: 60_000,
      cwd: process.cwd(),
    });
    if (r.status !== 0) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "tsc-clean: TypeScript compilation failed.\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n" +
        "Exit: " + r.status + "\\n" +
        "Output (tail):\\n" + ((r.stdout ?? "") + (r.stderr ?? "")).slice(-2000) + "\\n" +
        "Fix the TS errors, OR retire:\\n" +
        "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
      );
    }
    expect(r.status).toBe(0);
  });
});
`;
  return { filename, content, claimId };
}
