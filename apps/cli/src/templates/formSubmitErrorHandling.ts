// Template: form-submit-error-handling
//
// Static guardrail. Asserts a form element's onSubmit handler in
// `filePath` still has a recognizable error-handling shape (try/catch
// or .catch). Catches AI removing the try/catch from a form handler,
// which surfaces as unhandled promise rejections in production.
//
// FP-safe: the signature captured at pin time is the exact added line
// (or a tight match). Replay just asserts substring presence.

import type { FormSubmitErrorHandlingClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = { prId: string };
export type GeneratedTest = { filename: string; content: string; claimId: string };

export function generateFormSubmitErrorHandlingTest(
  claim: FormSubmitErrorHandlingClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const content = `// ◆ Pinned by pinnedai — https://pinnedai.dev
// Template: form-submit-error-handling
// Protects: form submit handler keeps wrapping itself in try/catch or .catch
// File:     ${claim.filePath}
// Retire:   pinned retire ${claimId} --reason="..."

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const FILE_PATH = ${JSON.stringify(claim.filePath)};
const SIGNATURE = ${JSON.stringify(claim.signature)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};

describe("pinned: form-submit-error-handling " + FILE_PATH, () => {
  it("form's submit handler still wraps errors", () => {
    const full = resolve(process.cwd(), FILE_PATH);
    if (!existsSync(full)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "form-submit-error-handling: " + FILE_PATH + " is missing.\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n"
      );
    }
    const content = readFileSync(full, "utf8");
    // Whitespace-normalize before comparing — lint reformat shouldn't
    // false-fire this pin.
    const norm = (s: string) => s.replace(/\\s+/g, "").replace(/,(?=[)\\]}])/g, "");
    if (!norm(content).includes(norm(SIGNATURE))) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "form-submit-error-handling: " + FILE_PATH + " no longer contains the error-handling shape.\\n" +
        "Expected: " + SIGNATURE + "\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n" +
        "Restore the try/catch (or .catch()) around the form's submit handler, or retire:\\n" +
        "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
      );
    }
    expect(norm(content).includes(norm(SIGNATURE))).toBe(true);
  });
});
`;
  return { filename, content, claimId };
}
