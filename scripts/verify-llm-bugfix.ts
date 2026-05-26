#!/usr/bin/env tsx
// Walk a repo's git history, filter to fix/bug-shaped commits, and
// run llmBugFixPropose against each. Reports candidate pins the LLM
// suggests vs what the deterministic detector already finds.
//
// Usage:
//   PINNEDAI_BYOK=openai PINNEDAI_OPENAI_KEY=sk-... \
//     tsx scripts/verify-llm-bugfix.ts /path/to/repo [--limit N] [--max-fix N]

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { basename } from "node:path";
import { proposeBugFixCandidates } from "../apps/cli/src/llmBugFixPropose.js";

const args = process.argv.slice(2);
const repo = args[0];
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : 500;
const maxFixIdx = args.indexOf("--max-fix");
const maxFix = maxFixIdx >= 0 ? Number(args[maxFixIdx + 1]) : 30;

if (!repo) {
  console.error("usage: tsx scripts/verify-llm-bugfix.ts /path/to/repo [--limit N] [--max-fix N]");
  process.exit(1);
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// Pull commit history, filter to fix/bug/regress-shaped
const all = git(["log", `--max-count=${limit}`, "--pretty=%H%x09%s"]).trim().split("\n").map((l) => {
  const [sha, ...rest] = l.split("\t");
  return { sha, subj: rest.join("\t") };
}).filter((x) => x.sha);

const fixShaped = all.filter((x) => /\b(fix|fixed|fixes|bug|regress|patch)[\s:(\-]/i.test(x.subj));
console.log(`scan: ${basename(repo)} — total ${all.length} commits, fix-shaped: ${fixShaped.length}, running on first ${Math.min(maxFix, fixShaped.length)}`);

type Row = { sha: string; subj: string; status: string; candidatesJson: string; note: string };
const rows: Row[] = [];
let totalCandidates = 0;
let commitsWithCandidates = 0;

async function main() {
for (let i = 0; i < Math.min(maxFix, fixShaped.length); i++) {
  const { sha, subj } = fixShaped[i];
  process.stderr.write(`  [${i + 1}/${Math.min(maxFix, fixShaped.length)}] ${sha.slice(0, 8)} ${subj.slice(0, 80)}\n`);

  // Get full commit message body
  let body = "";
  try {
    body = git(["log", "-1", "--pretty=%b", sha]);
  } catch { /* */ }

  // Get added lines per file
  let nameStatus = "";
  try {
    nameStatus = git(["diff-tree", "--no-commit-id", "--name-status", "-r", "--root", sha]);
  } catch {
    rows.push({ sha, subj, status: "diff-tree-fail", candidatesJson: "[]", note: "git diff-tree failed" });
    continue;
  }

  const diffByFile = new Map<string, string[]>();
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    const st = parts[0];
    if (st === "D") continue;
    const path = parts[parts.length - 1];
    try {
      const raw = git(["diff-tree", "-p", "--unified=0", "--no-color", sha, "--", path]);
      const added: string[] = [];
      for (const dl of raw.split("\n")) {
        if (dl.startsWith("+++") || dl.startsWith("---")) continue;
        if (dl.startsWith("+")) added.push(dl.slice(1));
      }
      if (added.length) diffByFile.set(path, added);
    } catch { /* */ }
  }

  if (diffByFile.size === 0) {
    rows.push({ sha, subj, status: "empty-diff", candidatesJson: "[]", note: "no added lines" });
    continue;
  }

  // Call LLM
  const result = await proposeBugFixCandidates({
    commitMessage: subj,
    commitBody: body,
    diffByFile,
  });

  if (result.ok) {
    rows.push({ sha, subj, status: "ok", candidatesJson: JSON.stringify(result.candidates), note: `provider=${result.provider} tokens=${result.rawTokens ?? "?"}` });
    if (result.candidates.length > 0) {
      commitsWithCandidates++;
      totalCandidates += result.candidates.length;
      for (const c of result.candidates) {
        console.log(`    → ${c.template} · ${c.filePath} · sig: ${c.signature.slice(0, 60)}`);
      }
    }
  } else {
    rows.push({ sha, subj, status: result.reason, candidatesJson: "[]", note: "reason" in result ? result.reason : "" });
    console.log(`    ✗ ${result.reason}${("error" in result && result.error) ? ": " + result.error.slice(0, 100) : ""}`);
  }
}

console.log("");
console.log(`══ Results · ${basename(repo)} ══`);
console.log(`  fix commits inspected: ${Math.min(maxFix, fixShaped.length)}`);
console.log(`  commits with LLM candidates: ${commitsWithCandidates}`);
console.log(`  total candidates proposed: ${totalCandidates}`);

const csv = ["sha,subj,status,candidates,note", ...rows.map((r) => {
  const esc = (s: string) => `"${(s ?? "").replace(/"/g, '""')}"`;
  return [r.sha, esc(r.subj), r.status, esc(r.candidatesJson), esc(r.note)].join(",");
})].join("\n");

const csvPath = `/tmp/oss-mining/${basename(repo)}-llm-bugfix.csv`;
writeFileSync(csvPath, csv);
console.log(`\nCSV: ${csvPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
