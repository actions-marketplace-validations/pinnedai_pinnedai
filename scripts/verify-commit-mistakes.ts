#!/usr/bin/env tsx
// Walk a target repo's git history and apply the REAL detectCommitMistakes
// detector to each commit's staged-equivalent diff. Produces CSV-shaped
// truth that supersedes the shell-scanner approximation.
//
// Usage:
//   tsx scripts/verify-commit-mistakes.ts /path/to/repo [--limit N]

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { detectCommitMistakes } from "../apps/cli/src/commitMistakes.js";

const args = process.argv.slice(2);
const repo = args[0];
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 500;

if (!repo) {
  console.error("usage: tsx scripts/verify-commit-mistakes.ts /path/to/repo [--limit N]");
  process.exit(1);
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const sha_subj = git(["log", `--max-count=${limit}`, "--pretty=%H\t%s"])
  .trim()
  .split("\n")
  .map((l) => {
    const [sha, ...rest] = l.split("\t");
    return { sha, subj: rest.join("\t") };
  })
  .filter((x) => x.sha);

const repoName = basename(repo);
console.log(`scan: ${repoName} · ${sha_subj.length} commits`);

type Row = { sha: string; subj: string; type: string; severity: string; file: string; evidence: string };
const rows: Row[] = [];
const byType = new Map<string, number>();
let touched = 0;
let withCatches = 0;

for (let i = 0; i < sha_subj.length; i++) {
  const { sha, subj } = sha_subj[i];
  if ((i + 1) % 50 === 0) process.stderr.write(`  ${i + 1}/${sha_subj.length}\n`);

  // Get name-status of files changed in this commit
  let nameStatus = "";
  try {
    nameStatus = git(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", sha]);
  } catch {
    continue;
  }
  if (!nameStatus.trim()) continue;
  touched++;

  type Entry = { path: string; status: "added" | "modified" | "deleted" };
  const entries: Entry[] = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const st = parts[0];
    const p = parts[parts.length - 1];
    if (st.startsWith("A")) entries.push({ path: p, status: "added" });
    else if (st.startsWith("M")) entries.push({ path: p, status: "modified" });
    else if (st.startsWith("D")) entries.push({ path: p, status: "deleted" });
  }
  if (!entries.length) continue;

  const addedByFile = new Map<string, string[]>();
  const removedByFile = new Map<string, string[]>();
  for (const e of entries) {
    if (e.status === "deleted") continue;
    let diff = "";
    try {
      diff = git(["diff-tree", "-p", "--unified=0", "--no-color", sha, "--", e.path]);
    } catch {
      continue;
    }
    const added: string[] = [];
    const removed: string[] = [];
    for (const line of diff.split("\n")) {
      if (line.startsWith("+++") || line.startsWith("---")) continue;
      if (line.startsWith("+")) added.push(line.slice(1));
      else if (line.startsWith("-")) removed.push(line.slice(1));
    }
    if (added.length) addedByFile.set(e.path, added);
    if (removed.length) removedByFile.set(e.path, removed);
  }

  const violations = detectCommitMistakes({
    repoRoot: repo,
    changedFiles: entries.map((e) => ({ path: e.path, status: e.status })),
    addedLinesByFile: addedByFile,
    removedLinesByFile: removedByFile,
  });

  if (violations.length) withCatches++;
  for (const v of violations) {
    rows.push({
      sha,
      subj,
      type: v.type,
      severity: v.severity,
      file: v.file,
      evidence: (v.matchedLine ?? v.evidence ?? "").slice(0, 200),
    });
    byType.set(v.type, (byType.get(v.type) ?? 0) + 1);
  }
}

console.log("");
console.log(`══ Results · ${repoName} ══`);
console.log(`  commits scanned: ${sha_subj.length}`);
console.log(`  commits with file changes: ${touched}`);
console.log(`  commits with detector catches: ${withCatches}`);
console.log(`  total catches: ${rows.length}`);
console.log(`  catch rate: ${((withCatches / Math.max(1, sha_subj.length)) * 100).toFixed(2)}%`);
console.log("");
console.log("Per-type:");
for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(28)} ${n}`);
}

const csvPath = `/tmp/oss-mining/${repoName}-detector-truth.csv`;
const csv = ["sha,subj,type,severity,file,evidence", ...rows.map((r) => {
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  return [r.sha, esc(r.subj), r.type, r.severity, esc(r.file), esc(r.evidence)].join(",");
})].join("\n");
writeFileSync(csvPath, csv);
console.log(`\nCSV: ${csvPath}`);
