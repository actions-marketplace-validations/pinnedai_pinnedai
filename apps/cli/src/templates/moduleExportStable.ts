// Template: module-export-stable
//
// Asserts a named export keeps appearing in a specific module file.
// Catches "missing X export" regressions (e.g., the dyad-apps
// "missing showWarning export in toast utils" class). LOW FP: looks
// for `export ... <name>` at the source level. Doesn't try dynamic
// import (would force vitest to also load the module's transitive
// imports — fragile across repos).

import type { ModuleExportStableClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = { prId: string };
export type GeneratedTest = { filename: string; content: string; claimId: string };

export function generateModuleExportStableTest(
  claim: ModuleExportStableClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const content = `// ◆ Pinned by pinnedai — https://pinnedai.dev
// Template: module-export-stable
// Protects: named export ${JSON.stringify(claim.exportName)} from ${JSON.stringify(claim.modulePath)}
// Retire:   pinned retire ${claimId} --reason="..."

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const MODULE_PATH = ${JSON.stringify(claim.modulePath)};
const EXPORT_NAME = ${JSON.stringify(claim.exportName)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};

describe("pinned: module-export-stable " + EXPORT_NAME + " in " + MODULE_PATH, () => {
  it("module " + MODULE_PATH + " still exports " + EXPORT_NAME, () => {
    const full = resolve(process.cwd(), MODULE_PATH);
    if (!existsSync(full)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "module-export-stable: " + MODULE_PATH + " is missing.\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n" +
        "Restore the file, or retire:\\n" +
        "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
      );
    }
    const content = readFileSync(full, "utf8");
    // Look for one of:
    //   export { X }                  (named re-export)
    //   export { X as ...}            (named alias)
    //   export const X
    //   export function X
    //   export async function X
    //   export class X
    //   export type X
    //   export interface X
    //   export default function X
    //   export default class X
    const escaped = EXPORT_NAME.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
    const re = new RegExp(
      "\\\\bexport\\\\s+(?:default\\\\s+)?" +
      "(?:" +
        "(?:async\\\\s+)?function\\\\s+" + escaped + "\\\\b" + "|" +
        "class\\\\s+" + escaped + "\\\\b" + "|" +
        "(?:const|let|var)\\\\s+" + escaped + "\\\\b" + "|" +
        "(?:type|interface|enum)\\\\s+" + escaped + "\\\\b" +
      ")"
    );
    const reBracketed = new RegExp(
      "\\\\bexport\\\\s*\\\\{[^}]*\\\\b" + escaped + "\\\\b(?:\\\\s+as\\\\s+\\\\w+)?[^}]*\\\\}"
    );
    if (!re.test(content) && !reBracketed.test(content)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "module-export-stable: " + MODULE_PATH + " no longer exports " + EXPORT_NAME + ".\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n" +
        "Restore the export, or retire:\\n" +
        "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
      );
    }
    expect(re.test(content) || reBracketed.test(content)).toBe(true);
  });
});
`;
  return { filename, content, claimId };
}
