// Template: changed-literal-preserved
//
// The detector pairs a removed literal + an added literal within the
// same hunk (URL, status code, env key, route path). This template
// emits a static check that the fix's NEW value keeps appearing in
// the file. Catches the largest dyad-apps fix class: URL typos,
// API-version drift, status-code corrections.
//
// FP-safe by design:
//   - Only asserts newValue PRESENT. The "oldValue absent" check is
//     deliberately omitted at runtime — legitimate refactors may
//     keep both values temporarily during a transition. Detector-
//     side already filtered for same-shape pairs.

import type { ChangedLiteralPreservedClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = { prId: string };
export type GeneratedTest = { filename: string; content: string; claimId: string };

export function generateChangedLiteralPreservedTest(
  claim: ChangedLiteralPreservedClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const content = `// ◆ Pinned by pinnedai — https://pinnedai.dev
// Template: changed-literal-preserved
// Shape:    ${claim.shape}
// Protects: ${JSON.stringify(claim.newValue)} in ${JSON.stringify(claim.filePath)}
// Fix replaced: ${JSON.stringify(claim.oldValue)} → ${JSON.stringify(claim.newValue)}
// Retire:   pinned retire ${claimId} --reason="..."

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FILE_PATH = ${JSON.stringify(claim.filePath)};
const NEW_VALUE = ${JSON.stringify(claim.newValue)};
const OLD_VALUE = ${JSON.stringify(claim.oldValue)};
const SHAPE = ${JSON.stringify(claim.shape)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};

describe("pinned: changed-literal-preserved " + SHAPE + " in " + FILE_PATH, () => {
  it("file still contains the fix's new " + SHAPE + " value " + NEW_VALUE, () => {
    const full = resolve(process.cwd(), FILE_PATH);
    if (!existsSync(full)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "changed-literal-preserved: " + FILE_PATH + " is missing.\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n"
      );
    }
    const content = readFileSync(full, "utf8");
    if (!content.includes(NEW_VALUE)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "changed-literal-preserved: " + FILE_PATH + " no longer contains " + NEW_VALUE + ".\\n" +
        "The fix replaced " + OLD_VALUE + " with " + NEW_VALUE + ". That change has been reverted/lost.\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n" +
        "Restore the fix's value, or retire:\\n" +
        "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
      );
    }
    expect(content).toContain(NEW_VALUE);
  });
});
`;
  return { filename, content, claimId };
}
