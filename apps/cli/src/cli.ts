#!/usr/bin/env node
// pinnedai — pin PR description claims as permanent CI tests.
//
// npm: `pinnedai` (binary name `pinned`)
//
// Usage flow (target end state):
//   1. Dev opens a PR with description containing claims:
//        "Rate-limits /api/users to 60 req/min."
//        "Auth required on /api/admin/export."
//   2. `pinned check` (or the GitHub Action wrapper) parses the
//      claims, generates a test file per claim under tests/pinned/
//   3. The generated test is shown in a PR comment for review +
//      committed to the branch (in Pro mode).
//   4. The test joins the suite permanently — future commits that
//      break the claim fail CI with a back-reference to the
//      original PR.
//
// Today this CLI is a stub. The next milestones (see ROADMAP.md):
//   - claim parser (regex + LLM fallback)
//   - rate-limit / auth-required / idempotent test generators
//   - GitHub Action wrapper that posts PR comments
//   - retire flow + audit log

import { Command } from "commander";
import process from "node:process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(__dirname, "..", "package.json");
const { version } = JSON.parse(readFileSync(pkgPath, "utf8")) as {
  version: string;
};

const program = new Command();

program
  .name("pinned")
  .description(
    "Pin PR description claims as permanent CI tests. Future regressions break CI with a back-reference to the original PR."
  )
  .version(version);

program
  .command("check", { isDefault: true })
  .description(
    "Parse a PR description for claims and report which template each maps to. Today: prints the parsed structure. Next milestone: generate test files per claim."
  )
  .option(
    "--description <text>",
    "PR description text to parse. If omitted, reads from stdin or the GITHUB_PR_BODY env var."
  )
  .action(async (opts: { description?: string }) => {
    const body =
      opts.description ??
      process.env.GITHUB_PR_BODY ??
      (await readStdin());
    if (!body || !body.trim()) {
      process.stderr.write(
        "✗ No PR description provided. Pass via --description, pipe stdin, or set GITHUB_PR_BODY.\n"
      );
      process.exit(1);
    }
    // STUB — claim parser lands in the next commit. For now just
    // confirm the CLI is wired up and echo the body length so the
    // shell of the product is verifiable.
    process.stdout.write(
      `pinned@${version}: read ${body.length} chars of PR description.\n` +
        `(Next milestone: parse claims into structured templates.)\n`
    );
  });

program
  .command("generate")
  .description(
    "Generate test file(s) from claims in a PR description. Stub — lands in week 1 of the MVP."
  )
  .argument("<pr-id>", "PR identifier — used to namespace the generated test files (e.g. pr-1247)")
  .action((prId: string) => {
    process.stdout.write(
      `pinned generate ${prId}: not implemented yet. See ROADMAP.md.\n`
    );
    process.exit(2);
  });

program
  .command("retire")
  .description(
    "Retire a previously-pinned claim — moves the test from tests/pinned/ to tests/pinned/retired/ with an audit-log entry. Stub."
  )
  .argument("<claim-id>", "Claim identifier (filename without extension)")
  .option(
    "--reason <text>",
    "Why this claim no longer applies — written into the audit log"
  )
  .action(
    (claimId: string, opts: { reason?: string }) => {
      process.stdout.write(
        `pinned retire ${claimId}: not implemented yet. ` +
          `Reason captured: ${opts.reason ?? "(none)"}\n`
      );
      process.exit(2);
    }
  );

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data;
}

await program.parseAsync(process.argv);
