// Same diagnostic as quantasyte but for quantapact — show what
// scanDiffFull + detectAuthChecksInDiff produce at install commit.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanDiffFull, detectAuthChecksInDiff, detectValidationAddedInDiff } from "../apps/cli/src/scanDiff.js";

const repoPath = "/Users/michaelzon/dyad-apps/quantapact";
const installSha = "9dfdd624";
const wt = mkdtempSync(join(tmpdir(), "inspect-qp-"));

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
  console.log(`total files at install: ${files.length}`);

  const changed = files.map((p) => ({ path: p, status: "added" as const }));
  const scan = scanDiffFull({ changedFiles: changed, prBodyClaims: [], existingPins: [] });
  console.log(`scanDiffFull suggestions: ${scan.suggestions.length}`);
  const byTemplate = new Map<string, number>();
  for (const s of scan.suggestions) byTemplate.set(s.template, (byTemplate.get(s.template) ?? 0) + 1);
  for (const [t, n] of byTemplate) console.log(`  ${t}: ${n}`);

  const authBuckets = scan.suggestions.filter((s) => s.template === "auth-required");
  if (authBuckets.length > 0) {
    console.log(`\nfirst 5 auth-required routes:`);
    for (const a of authBuckets.slice(0, 5)) console.log(`  ${a.route}  ← ${a.files[0]}`);
  }

  // staticVerify-capturing detectors
  const diffByFile = new Map<string, string[]>();
  for (const f of changed) {
    try { const content = readFileSync(join(wt, f.path), "utf8"); diffByFile.set(f.path, content.split("\n")); } catch {}
  }
  const authHits = detectAuthChecksInDiff(diffByFile);
  const rsHits = detectValidationAddedInDiff(diffByFile);
  console.log(`\ndetectAuthChecksInDiff hits: ${authHits.length}`);
  console.log(`detectValidationAddedInDiff hits: ${rsHits.length}`);
  if (authHits.length > 0) {
    console.log(`first 3 auth hits:`);
    for (const h of authHits.slice(0, 3)) {
      console.log(`  route=${h.route}  file=${h.filePath}`);
      console.log(`  signature: ${h.signature.slice(0, 100)}`);
    }
  }

  // Overlap
  const authScanRoutes = new Set(authBuckets.map((s) => s.route).filter(Boolean) as string[]);
  const authHitRoutes = new Set(authHits.map((h) => h.route));
  let overlap = 0;
  for (const r of authScanRoutes) if (authHitRoutes.has(r)) overlap++;
  console.log(`\nRoute overlap (scanDiffFull auth ∩ detectAuthChecksInDiff): ${overlap} / scan=${authScanRoutes.size} hits=${authHitRoutes.size}`);
} finally {
  try { execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: repoPath }); } catch { /* */ }
  try { rmSync(wt, { recursive: true, force: true }); } catch { /* */ }
}
