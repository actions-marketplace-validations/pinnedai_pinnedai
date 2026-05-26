// Template: import-path-resolves
//
// Asserts a specific import from a specific source file still
// resolves on disk (file exists for relative paths, or package
// resolves in node_modules for bare specifiers). Catches the
// "missing dep" / "module renamed" regression class. LOW FP: only
// fires when the source file still references the import path AND
// the target no longer resolves.

import type { ImportPathResolvesClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = { prId: string };
export type GeneratedTest = { filename: string; content: string; claimId: string };

export function generateImportPathResolvesTest(
  claim: ImportPathResolvesClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const content = `// ◆ Pinned by pinnedai — https://pinnedai.dev
// Template: import-path-resolves
// Protects: import ${JSON.stringify(claim.importPath)} from ${JSON.stringify(claim.sourceFilePath)}
// Retire:   pinned retire ${claimId} --reason="..."

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

const SOURCE_FILE = ${JSON.stringify(claim.sourceFilePath)};
const IMPORT_PATH = ${JSON.stringify(claim.importPath)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};

describe("pinned: import-path-resolves " + IMPORT_PATH + " in " + SOURCE_FILE, () => {
  it("source file still imports " + IMPORT_PATH + " AND the target resolves", () => {
    const srcFull = resolve(process.cwd(), SOURCE_FILE);
    if (!existsSync(srcFull)) {
      // Source file gone — treat as a pass (the import contract is
      // no longer in effect). Different from the export-stable case
      // where missing module IS the failure.
      return;
    }
    const src = readFileSync(srcFull, "utf8");
    // Confirm the import is still declared (otherwise no contract to verify)
    const escaped = IMPORT_PATH.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
    const importDeclRe = new RegExp(
      "(?:import\\\\s[^;]*from\\\\s*[\\"'\\\`]" + escaped + "[\\"'\\\`])|(?:require\\\\(\\\\s*[\\"'\\\`]" + escaped + "[\\"'\\\`]\\\\s*\\\\))"
    );
    if (!importDeclRe.test(src)) {
      // Import removed from source — pin's contract no longer applies. Pass.
      return;
    }
    // Verify the target resolves.
    const isBare = !IMPORT_PATH.startsWith(".") && !IMPORT_PATH.startsWith("/");
    if (isBare) {
      // bare specifier: check node_modules (top + workspace-up to 3 levels).
      let resolved = false;
      // Strip the leading package name (handles "@scope/pkg" too)
      const pkgName = IMPORT_PATH.startsWith("@")
        ? IMPORT_PATH.split("/").slice(0, 2).join("/")
        : IMPORT_PATH.split("/")[0];
      let dir = process.cwd();
      for (let i = 0; i < 4; i++) {
        const cand = join(dir, "node_modules", pkgName, "package.json");
        if (existsSync(cand)) { resolved = true; break; }
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
      if (!resolved) {
        throw new Error(
          "═══ PINNED FAILURE ═══\\n" +
          "import-path-resolves: " + SOURCE_FILE + " imports " + IMPORT_PATH +
          " but package " + pkgName + " is not installed.\\n" +
          "Claim: " + ORIGINAL_CLAIM + "\\n" +
          "PR: " + ORIGINAL_PR + "\\n" +
          "Install the package, or retire:\\n" +
          "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
        );
      }
      expect(resolved).toBe(true);
    } else {
      // relative: resolve relative to source file directory; try common extensions
      const baseDir = dirname(srcFull);
      const exts = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];
      let resolved = false;
      for (const ext of exts) {
        const cand = resolve(baseDir, IMPORT_PATH + ext);
        if (existsSync(cand)) { resolved = true; break; }
      }
      if (!resolved) {
        throw new Error(
          "═══ PINNED FAILURE ═══\\n" +
          "import-path-resolves: " + SOURCE_FILE + " imports " + IMPORT_PATH +
          " but the target file no longer exists.\\n" +
          "Claim: " + ORIGINAL_CLAIM + "\\n" +
          "PR: " + ORIGINAL_PR + "\\n" +
          "Restore the file (or update the import), or retire:\\n" +
          "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
        );
      }
      expect(resolved).toBe(true);
    }
  });
});
`;
  return { filename, content, claimId };
}
