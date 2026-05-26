// Template: webhook-handler-exists
//
// Asserts a webhook handler file still exists and still contains its
// captured-at-fix handler signature (e.g., "export async function POST(").
// Catches "edge function deleted" and "handler renamed away" classes.
// LOW FP: file presence + verbatim signature match.

import type { WebhookHandlerExistsClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = { prId: string };
export type GeneratedTest = { filename: string; content: string; claimId: string };

export function generateWebhookHandlerExistsTest(
  claim: WebhookHandlerExistsClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const content = `// ◆ Pinned by pinnedai — https://pinnedai.dev
// Template: webhook-handler-exists
// Protects: ${claim.provider} webhook handler at ${JSON.stringify(claim.filePath)}
// Retire:   pinned retire ${claimId} --reason="..."

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FILE_PATH = ${JSON.stringify(claim.filePath)};
const HANDLER_SIGNATURE = ${JSON.stringify(claim.handlerSignature)};
const PROVIDER = ${JSON.stringify(claim.provider)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};

describe("pinned: webhook-handler-exists " + PROVIDER + " at " + FILE_PATH, () => {
  it("webhook handler file exists and signature is present", () => {
    const full = resolve(process.cwd(), FILE_PATH);
    if (!existsSync(full)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "webhook-handler-exists: " + FILE_PATH + " is missing.\\n" +
        "Provider: " + PROVIDER + "\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n"
      );
    }
    const content = readFileSync(full, "utf8");
    // Normalize whitespace before comparing (same approach as auth-required's
    // static check) so lint reformat doesn't produce FPs.
    const norm = (s: string) => s.replace(/\\s+/g, "").replace(/,(?=[)\\]}])/g, "");
    if (!norm(content).includes(norm(HANDLER_SIGNATURE))) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "webhook-handler-exists: " + FILE_PATH + " no longer matches handler signature.\\n" +
        "Provider: " + PROVIDER + "\\n" +
        "Expected: " + HANDLER_SIGNATURE + "\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n" +
        "Restore the handler, or retire:\\n" +
        "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
      );
    }
    expect(norm(content).includes(norm(HANDLER_SIGNATURE))).toBe(true);
  });
});
`;
  return { filename, content, claimId };
}
