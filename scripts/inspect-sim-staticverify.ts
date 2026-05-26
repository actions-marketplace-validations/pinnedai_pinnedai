// Diagnostic: at quantasyte's install commit, what do scanDiffFull
// suggestions and the staticVerify detectors actually produce?
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanDiffFull, detectAuthChecksInDiff, detectValidationAddedInDiff } from "../apps/cli/src/scanDiff.js";

const repoPath = "/Users/michaelzon/dyad-apps/quantasyte";
const installSha = "5e5414c9";
const wt = mkdtempSync(join(tmpdir(), "inspect-sv-"));

try {
  execFileSync("git", ["worktree", "add", "--detach", wt, installSha], { cwd: repoPath });

  const files: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const name of readdirSync(dir)) {
      if (name === ".git" || name === "node_modules" || name === "dist" || name === "build") continue;
      const full = join(dir, name);
      let st;
      try { st = lstatSync(full); } catch { continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(full, rel ? `${rel}/${name}` : name);
      else if (st.isFile()) files.push(rel ? `${rel}/${name}` : name);
    }
  };
  walk(wt, "");

  const changed = files.map((p) => ({ path: p, status: "added" as const }));
  const scan = scanDiffFull({ changedFiles: changed, prBodyClaims: [], existingPins: [] });
  const authBuckets = scan.suggestions.filter((s) => s.template === "auth-required");
  const rsBuckets = scan.suggestions.filter((s) => s.template === "returns-status");
  console.log(`scanDiffFull suggestions: ${scan.suggestions.length} total, auth=${authBuckets.length}, returns-status=${rsBuckets.length}`);
  console.log("first 3 auth suggestion routes:");
  for (const a of authBuckets.slice(0, 3)) console.log(`  ${a.route}  files=[${a.files.slice(0, 2).join(", ")}]`);

  // Now check what the staticVerify-capturing detectors find
  const diffByFile = new Map<string, string[]>();
  for (const f of changed) {
    try { const content = readFileSync(join(wt, f.path), "utf8"); diffByFile.set(f.path, content.split("\n")); } catch {}
  }
  const authHits = detectAuthChecksInDiff(diffByFile);
  const rsHits = detectValidationAddedInDiff(diffByFile);
  console.log(`\nstaticVerify-capturing detectors:`);
  console.log(`  detectAuthChecksInDiff hits: ${authHits.length}`);
  console.log(`  detectValidationAddedInDiff hits: ${rsHits.length}`);
  if (authHits.length > 0) {
    console.log(`  first auth hit:`);
    console.log(`    route: ${authHits[0].route}`);
    console.log(`    file: ${authHits[0].filePath}`);
    console.log(`    signature: ${authHits[0].signature.slice(0, 80)}...`);
  }
  if (rsHits.length > 0) {
    console.log(`  first returns-status hit:`);
    console.log(`    route: ${rsHits[0].route}`);
    console.log(`    file: ${rsHits[0].filePath}`);
    console.log(`    signature: ${rsHits[0].signature.slice(0, 80)}...`);
  }

  // Match: do the scanDiffFull routes overlap with the detector routes?
  const authScanRoutes = new Set(authBuckets.map((s) => s.route).filter(Boolean) as string[]);
  const authHitRoutes = new Set(authHits.map((h) => h.route));
  let overlap = 0;
  for (const r of authScanRoutes) if (authHitRoutes.has(r)) overlap++;
  console.log(`\nRoute overlap (scanDiffFull auth ∩ detectAuthChecksInDiff): ${overlap} / scan=${authScanRoutes.size} hits=${authHitRoutes.size}`);
} finally {
  try { execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: repoPath }); } catch { /* */ }
  try { rmSync(wt, { recursive: true, force: true }); } catch { /* */ }
}
