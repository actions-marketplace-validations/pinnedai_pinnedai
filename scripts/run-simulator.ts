// Driver for the install-partway simulator. Invoked via tsx, not built
// into the CLI yet — once we trust the output, this becomes a real
// CLI subcommand. Args:
//   --repo <abs-path>          (required)
//   --install-at <0..1>        (default 0.6)
//   --max-replay <n>           (default 100)
//   --vitest-timeout <ms>      (default 60000)
//   --json                     (output full report as JSON to stdout)
//   --out <path>               (write JSON report to file)

import { writeFileSync } from "node:fs";
import { simulateRealInstall } from "../apps/cli/src/simulateRealInstall.js";

function arg(name: string, def?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return def;
  return process.argv[idx + 1] ?? def;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const repo = arg("repo");
  if (!repo) {
    process.stderr.write("usage: tsx scripts/run-simulator.ts --repo <abs-path> [--install-at 0.6] [--max-replay 100] [--out report.json]\n");
    process.exit(1);
  }
  const installAtPercent = Number(arg("install-at", "0.6"));
  const maxReplayCommits = Number(arg("max-replay", "100"));
  const vitestTimeoutMs = Number(arg("vitest-timeout", "60000"));
  const out = arg("out");
  const json = flag("json");

  const enableLlmProposer = flag("llm");
  process.stderr.write(`simulating: ${repo}  llm-proposer=${enableLlmProposer}\n`);
  const report = await simulateRealInstall({
    repoPath: repo,
    installAtPercent,
    maxReplayCommits,
    vitestTimeoutMs,
    verbose: true,
    enableLlmProposer,
  });

  // Human summary on stderr
  process.stderr.write(
    `\n══════════════════════════════════════════════════════════════════\n` +
    `simulator report: ${report.repo}\n` +
    `  total commits:           ${report.totalCommits}\n` +
    `  install commit idx:      ${report.installCommitIdx} (${report.installCommit.slice(0, 8)})\n` +
    `  replay window:           ${report.replayCommitCount} commits\n` +
    `  siblings enabled:        ${report.siblingsEnabled}\n` +
    `  baseline pins attempted: ${report.baselinePinsAttempted}\n` +
    `  baseline pins positive:  ${report.baselinePinsPositive}\n` +
    `  baseline pins dropped:   ${report.baselinePinsDropped}\n` +
    `  pins added on replay:    ${report.pinsAddedDuringReplay}\n` +
    `  sibling pins (total):    ${report.siblingPinsTotal}\n` +
    `  LLM pins (total):        ${report.llmPinsTotal}\n` +
    `  total live pins at end:  ${report.totalLivePinsAtEnd}\n` +
    `  ★ catches:              ${report.catches.length}  (siblings: ${report.catchesFromSiblings}, llm: ${report.catchesFromLlm})\n` +
    `  duration:                ${(report.durationMs / 1000).toFixed(1)}s\n`
  );
  if (report.catches.length > 0) {
    process.stderr.write(`  catches:\n`);
    for (const c of report.catches.slice(0, 20)) {
      const tags = [c.pinWasSibling ? "SIBLING" : null, c.pinWasFromLlm ? "LLM" : null].filter(Boolean).join(",");
      const tagStr = tags ? ` [${tags}]` : "";
      process.stderr.write(
        `    [${c.commitSha.slice(0, 8)}] ${c.pinTemplate}${tagStr}  pin=${c.pinFilename}  "${c.commitSubject.slice(0, 60)}"\n`
      );
    }
  }
  process.stderr.write(`══════════════════════════════════════════════════════════════════\n`);

  if (json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
}

main().catch((e) => {
  process.stderr.write(`simulator failed: ${(e as Error).message}\n${(e as Error).stack}\n`);
  process.exit(1);
});
