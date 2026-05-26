// Template: url-literal-preserved
//
// Asserts a literal URL string still appears in a specific file.
// Catches the most common dyad-app fix class: endpoint typos, API
// version drift, redirect-URL changes ("use prod Supabase URL when
// deployed"). LOW FP because the literal is matched verbatim.

import type { UrlLiteralPreservedClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = { prId: string };
export type GeneratedTest = { filename: string; content: string; claimId: string };

export function generateUrlLiteralPreservedTest(
  claim: UrlLiteralPreservedClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const content = `// ◆ Pinned by pinnedai — https://pinnedai.dev
// Template: url-literal-preserved
// Protects: URL ${JSON.stringify(claim.urlLiteral)} in ${JSON.stringify(claim.filePath)}
// Retire:   pinned retire ${claimId} --reason="..."

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FILE_PATH = ${JSON.stringify(claim.filePath)};
const URL_LITERAL = ${JSON.stringify(claim.urlLiteral)};
const LABEL = ${JSON.stringify(claim.label)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};

describe("pinned: url-literal-preserved " + LABEL + " in " + FILE_PATH, () => {
  it("file " + FILE_PATH + " still contains URL " + URL_LITERAL, () => {
    const full = resolve(process.cwd(), FILE_PATH);
    if (!existsSync(full)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "url-literal-preserved: " + FILE_PATH + " is missing.\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n" +
        "Either restore the URL " + URL_LITERAL + " in " + FILE_PATH + ", or retire:\\n" +
        "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
      );
    }
    const content = readFileSync(full, "utf8");
    expect(content).toContain(URL_LITERAL);
  });
});
`;
  return { filename, content, claimId };
}
