// Reads JSON output from run-eval-suite.sh and produces:
//   /tmp/pinned-eval/eval.csv        — one row per (repo × mode)
//   /tmp/pinned-eval/summary.md      — aggregate + launch-bar verdict
//
// Decides "useful vs noise" per the launch-criteria-three-tracks memory:
//   useful   = auth/validation/permission/webhook/sibling catches
//   noise    = pure lockfile drift, lint-format FP class, broken-at-fix
//
// Renders the exact statusline string a user would see for each repo
// after install (baseline) + the most prominent transient event.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = process.argv[2] ?? "/tmp/pinned-eval";

type BugfixReport = {
  realCatches?: number;
  realCatchesByTemplate?: Record<string, number>;
  fixCommitsMatched?: number;
  fixCommitsEvaluated?: number;
  pinsGenerated?: number;
  fixes?: Array<{
    fixCommit: string;
    subject: string;
    pins: Array<{
      classification: string;
      claim: { template: string; route?: string; staticVerify?: { filePath?: string; signature?: string } };
      filename: string;
    }>;
  }>;
};

type SimReport = {
  repo: string;
  totalCommits: number;
  installCommitIdx: number;
  replayCommitCount: number;
  baselinePinsPositive: number;
  pinsAddedDuringReplay: number;
  totalLivePinsAtEnd: number;
  siblingPinsTotal?: number;
  catches: Array<{
    commitSha: string;
    commitSubject: string;
    pinTemplate: string;
    pinFilename: string;
    pinIntroducedAt: string;
    pinWasSibling?: boolean;
  }>;
};

const NOT_USEFUL_TEMPLATES = new Set(["lockfile-integrity"]);

function classifyCatch(template: string, signature?: string): "useful" | "noise-lockfile" | "noise-lint-fp" {
  if (NOT_USEFUL_TEMPLATES.has(template)) return "noise-lockfile";
  // Lint-FP heuristic: signature is JS code captured in a single-line
  // form. We can't tell from JSON alone whether the parent had the same
  // logic in multi-line form. Mark suspected if signature contains
  // .safeParse(.+) all on one line (the documenso pattern).
  if (signature && /\.(safeParse|parse|parseAsync)\(.{20,}\)\s*[;,]?$/.test(signature.trim())) {
    return "noise-lint-fp";
  }
  return "useful";
}

function buildBaselineStatusline(pinCount: number, lessonCount: number, recentCatchCount: number): string {
  const lessonsTail = lessonCount > 0 ? ` · ${lessonCount} lessons` : "";
  if (recentCatchCount > 0) {
    return `◆ pinned · ${pinCount} pins${lessonsTail} · ★ ${recentCatchCount} ${recentCatchCount === 1 ? "catch" : "catches"} today`;
  }
  return `◆ pinned · ${pinCount} pins${lessonsTail} · ✓`;
}

function valuePerception(useful: number, totalCatches: number, pins: number): "high" | "medium" | "low" | "none" {
  if (useful >= 3) return "high";
  if (useful >= 1) return "medium";
  if (pins >= 10) return "low"; // pin coverage but no catches yet — protection in place
  return "none";
}

type Row = {
  repo: string;
  mode: "bug-fix" | "walk-forward";
  pins: number;
  catchesMechanical: number;
  catchesUseful: number;
  catchesNoiseLockfile: number;
  catchesNoiseLintFp: number;
  lessonsWouldAdd: number;
  statusline: string;
  valuePerception: string;
  topCatchExample: string;
};

const rows: Row[] = [];

const files = readdirSync(OUT_DIR);
const bugfixFiles = files.filter((f) => f.endsWith("-bugfix.json"));
const simFiles = files.filter((f) => f.endsWith("-sim.json"));

for (const f of bugfixFiles) {
  const name = f.replace(/-bugfix\.json$/, "");
  let report: BugfixReport;
  try {
    report = JSON.parse(readFileSync(join(OUT_DIR, f), "utf8"));
  } catch {
    continue;
  }
  let useful = 0, noiseLock = 0, noiseLint = 0;
  let topExample = "";
  for (const fx of report.fixes ?? []) {
    for (const p of fx.pins) {
      if (p.classification !== "real-catch") continue;
      const klass = classifyCatch(p.claim.template, p.claim.staticVerify?.signature);
      if (klass === "useful") {
        useful++;
        if (!topExample) topExample = `${p.claim.template} on ${p.claim.route ?? "?"} (${fx.subject.slice(0, 50)})`;
      } else if (klass === "noise-lockfile") noiseLock++;
      else if (klass === "noise-lint-fp") noiseLint++;
    }
  }
  const totalCatches = (report.realCatches ?? 0);
  // Each useful catch would also become a lesson via the LEARNED auto-fire path
  const lessons = useful;
  const statusline = buildBaselineStatusline(report.pinsGenerated ?? 0, lessons, useful);
  rows.push({
    repo: name,
    mode: "bug-fix",
    pins: report.pinsGenerated ?? 0,
    catchesMechanical: totalCatches,
    catchesUseful: useful,
    catchesNoiseLockfile: noiseLock,
    catchesNoiseLintFp: noiseLint,
    lessonsWouldAdd: lessons,
    statusline,
    valuePerception: valuePerception(useful, totalCatches, report.pinsGenerated ?? 0),
    topCatchExample: topExample || "(none)",
  });
}

for (const f of simFiles) {
  const name = f.replace(/-sim\.json$/, "");
  let report: SimReport;
  try {
    report = JSON.parse(readFileSync(join(OUT_DIR, f), "utf8"));
  } catch {
    continue;
  }
  let useful = 0, noiseLock = 0, noiseLint = 0;
  let topExample = "";
  for (const c of report.catches) {
    const klass = classifyCatch(c.pinTemplate);
    if (klass === "useful") {
      useful++;
      if (!topExample) topExample = `${c.pinTemplate} (${c.commitSubject.slice(0, 50)})`;
    } else if (klass === "noise-lockfile") noiseLock++;
    else if (klass === "noise-lint-fp") noiseLint++;
  }
  const lessons = useful;
  const statusline = buildBaselineStatusline(report.totalLivePinsAtEnd, lessons, useful);
  rows.push({
    repo: name,
    mode: "walk-forward",
    pins: report.totalLivePinsAtEnd,
    catchesMechanical: report.catches.length,
    catchesUseful: useful,
    catchesNoiseLockfile: noiseLock,
    catchesNoiseLintFp: noiseLint,
    lessonsWouldAdd: lessons,
    statusline,
    valuePerception: valuePerception(useful, report.catches.length, report.totalLivePinsAtEnd),
    topCatchExample: topExample || "(none)",
  });
}

// --- write CSV ---
const csvHeader = [
  "repo",
  "mode",
  "pins",
  "catches_mechanical",
  "catches_useful",
  "catches_noise_lockfile",
  "catches_noise_lint_fp",
  "lessons_would_add",
  "statusline_user_sees",
  "value_perception",
  "top_catch_example",
].join(",");

function csvEscape(s: string | number): string {
  const str = String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const csvBody = rows.map((r) => [
  r.repo,
  r.mode,
  r.pins,
  r.catchesMechanical,
  r.catchesUseful,
  r.catchesNoiseLockfile,
  r.catchesNoiseLintFp,
  r.lessonsWouldAdd,
  r.statusline,
  r.valuePerception,
  r.topCatchExample,
].map(csvEscape).join(","));

writeFileSync(join(OUT_DIR, "eval.csv"), [csvHeader, ...csvBody].join("\n") + "\n");

// --- write summary.md ---
const totalUseful = rows.reduce((a, r) => a + r.catchesUseful, 0);
const totalMechanical = rows.reduce((a, r) => a + r.catchesMechanical, 0);
const totalNoiseLock = rows.reduce((a, r) => a + r.catchesNoiseLockfile, 0);
const totalNoiseLintFp = rows.reduce((a, r) => a + r.catchesNoiseLintFp, 0);
const reposWithUseful = new Set(rows.filter((r) => r.catchesUseful > 0).map((r) => r.repo)).size;
const reposTotal = new Set(rows.map((r) => r.repo)).size;

const verdictPath1 =
  totalUseful >= 5 && reposWithUseful >= 2 ? "✅ MET" : `❌ ${totalUseful} useful catches across ${reposWithUseful} repo${reposWithUseful === 1 ? "" : "s"} (need 5+ across 2+ repos)`;
const walkUseful = rows.filter((r) => r.mode === "walk-forward").reduce((a, r) => a + r.catchesUseful, 0);
const verdictPath2 = walkUseful >= 3 ? "✅ MET" : `❌ ${walkUseful} walk-forward useful catches (need 3+)`;

const summaryLines: string[] = [];
summaryLines.push("# Pinned Evaluation — would a user perceive / actually get value?");
summaryLines.push("");
summaryLines.push(`Generated: ${new Date().toISOString()}`);
summaryLines.push("");
summaryLines.push("## Headline numbers");
summaryLines.push("");
summaryLines.push(`- **Useful catches across all repos & modes: ${totalUseful}**`);
summaryLines.push(`- Mechanical catches (incl. noise): ${totalMechanical}`);
summaryLines.push(`  - of which lockfile noise: ${totalNoiseLock}`);
summaryLines.push(`  - of which lint-format FP class: ${totalNoiseLintFp}`);
summaryLines.push(`- Repos with ≥1 useful catch: ${reposWithUseful} / ${reposTotal}`);
summaryLines.push(`- Walk-forward useful catches: ${walkUseful}`);
summaryLines.push("");
summaryLines.push("## Launch-bar verdict (per launch-criteria-three-tracks memory)");
summaryLines.push("");
summaryLines.push(`- **Path 1** (5+ multi-repo bug-fix useful catches): ${verdictPath1}`);
summaryLines.push(`- **Path 2** (3+ walk-forward useful catches): ${verdictPath2}`);
summaryLines.push(`- **Path 3** (15 positive controls + multi-repo + zero noisy blocks): see audit/positive-controls/_results.json (separate)`);
summaryLines.push("");
summaryLines.push("## Per-repo statusline (what user actually sees after install)");
summaryLines.push("");
summaryLines.push("| Repo | Mode | Pins | Useful catches | Noise | Statusline user sees | Value perception |");
summaryLines.push("|---|---|---|---|---|---|---|");
for (const r of rows) {
  const noise = r.catchesNoiseLockfile + r.catchesNoiseLintFp;
  summaryLines.push(`| ${r.repo} | ${r.mode} | ${r.pins} | ${r.catchesUseful} | ${noise} | \`${r.statusline}\` | ${r.valuePerception} |`);
}
summaryLines.push("");
summaryLines.push("## What would catch / what would be learned");
summaryLines.push("");
for (const r of rows) {
  if (r.catchesUseful === 0) continue;
  summaryLines.push(`### ${r.repo} (${r.mode})`);
  summaryLines.push(`- ${r.catchesUseful} useful catches → ${r.lessonsWouldAdd} lessons added to \`.pinned/ai-lessons.md\``);
  summaryLines.push(`- Example: ${r.topCatchExample}`);
  summaryLines.push("");
}
if (rows.every((r) => r.catchesUseful === 0)) {
  summaryLines.push("(No useful catches across any repo × mode. Pins are generated and would PROTECT future regressions, but the historical replay didn't surface any auth/validation regressions that the deterministic detectors recognize.)");
  summaryLines.push("");
}
summaryLines.push("## Honest call: perceived vs actual value");
summaryLines.push("");
if (totalUseful >= 5) {
  summaryLines.push(`A user installing Pinned today on a similar repo would, based on this replay, **see real catches** — ${totalUseful} demonstrable regressions Pinned would have caught. Per-repo perception varies: high-value repos show 3+ catches in the statusline ("★ N catches today"), low-value repos show just the baseline coverage ("N pins · ✓"). Pro features (cross-repo lessons, PR comment automation) would amplify the value.`);
} else if (totalUseful > 0) {
  summaryLines.push(`A user installing Pinned today would see ${totalUseful} useful catches across ${reposWithUseful}/${reposTotal} repos. Some repos produce real "AHA" events, others stay at baseline coverage. Honest positioning: "Pinned protects auth/validation/webhook code; catches depend on whether your repo's commit history exercises those classes."`);
} else {
  summaryLines.push(`**No useful catches surfaced in this eval window.** Pinned still adds value via:`);
  summaryLines.push(`  - Guard Integrity (23/23 mutation-test bypass attempts blocked) — daily-relevant when AI tries to weaken tests`);
  summaryLines.push(`  - AI Lessons file + agent config wiring — keeps AI agents from repeating mistakes`);
  summaryLines.push(`  - Pin baseline (auto-generated from repo state) — provides coverage that catches future regressions`);
  summaryLines.push("");
  summaryLines.push(`But the **historical replay didn't find regressions in the deterministic detector surface**. Either:`);
  summaryLines.push(`  - The repos tested didn't have auth/validation/webhook regressions in the replay window, OR`);
  summaryLines.push(`  - The detectors don't recognize the repo's specific idioms (custom auth helper names, framework-specific patterns).`);
  summaryLines.push("");
  summaryLines.push(`Honest launch positioning: lead with **Guard Integrity** (real, daily, blocks AI bypass). Bug-fix catches are bonus, not headline.`);
}

writeFileSync(join(OUT_DIR, "summary.md"), summaryLines.join("\n") + "\n");

process.stderr.write(`\nCSV:     ${join(OUT_DIR, "eval.csv")}\n`);
process.stderr.write(`Summary: ${join(OUT_DIR, "summary.md")}\n`);
