// Template: happy-path-with-side-effect
//
// Sends a valid POST/PUT/PATCH to the route with X-Pinned-Test: 1
// and asserts:
//   1. Status is 200 (or 201/202)
//   2. Response includes X-Pinned-Side-Effect header matching the
//      captured side-effect kind (db-write for v0.2)
//   3. X-Pinned-Side-Effect-Target matches the captured target table
//   4. X-Pinned-Side-Effect-Id is non-empty
//
// Why the header convention (Option C, locked 2026-06-02): a customer
// endpoint that returns 200 without actually doing the work is the
// worst-case Pinned failure mode (misleading-green). The header
// convention lets the customer's endpoint TELL Pinned what it did,
// without requiring Pinned to query the customer's DB or polling
// endpoint. Wrapper code is ~5-10 LOC, added by the customer's AI
// agent via the AGENT SETUP REQUIRED prompt emitted by `pinned init`.
//
// Once the wrapper is added, IT is itself protected by Pinned —
// future AI edits that remove the wrapper get caught recursively.

import type { HappyPathWithSideEffectClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";
import type { GenerateOpts, GeneratedTest } from "./rateLimit.js";
import { PINNED_FETCH_HELPER_SRC } from "./sharedFetch.js";

export function generateHappyPathWithSideEffectTest(
  claim: HappyPathWithSideEffectClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;

  const content = `// ═══════════════════════════════════════════════════════════════
// ◆ Pinned by pinnedai — https://pinnedai.dev
// ═══════════════════════════════════════════════════════════════
// Original PR claim: ${JSON.stringify(claim.raw)}
// Source PR:         ${opts.prId}
// Template:          happy-path-with-side-effect
// Permanent:         this test fails if the claim is ever regressed.
//
// Mechanism: sends a valid ${claim.method} to ${claim.route} with
// X-Pinned-Test: 1 and asserts the response includes
// X-Pinned-Side-Effect:${claim.sideEffectKind} +
// X-Pinned-Side-Effect-Target:${claim.sideEffectTarget} headers.
//
// REQUIRES: customer's route handler emits the X-Pinned-Side-Effect
// header on test-marked requests. See https://pinnedai.dev/docs/x-pinned-side-effect
// for the ~5-10 LOC wrapper.
//
// Retire when no longer applicable:
//   pinned retire ${claimId} --reason="..."
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
${PINNED_FETCH_HELPER_SRC}
const PREVIEW_URL = process.env.PREVIEW_URL;
const ROUTE = ${JSON.stringify(claim.route)};
const METHOD = ${JSON.stringify(claim.method)};
const EXPECTED_KIND = ${JSON.stringify(claim.sideEffectKind)};
const EXPECTED_TARGET = ${JSON.stringify(claim.sideEffectTarget)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};
const TEST_FILENAME = ${JSON.stringify(filename)};

function repairPrompt(message: string, status?: number, headers?: Record<string, string>): string {
  return [
    "",
    "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
    "",
    "Fix the failing pinned claim in this test file:",
    "  Claim: " + ORIGINAL_CLAIM,
    "  Original PR: " + ORIGINAL_PR,
    "  Route: " + METHOD + " " + ROUTE,
    "  Expected: 2xx + X-Pinned-Side-Effect: " + EXPECTED_KIND + " + X-Pinned-Side-Effect-Target: " + EXPECTED_TARGET,
    status !== undefined ? "  Status: " + status : "",
    headers ? "  Headers seen: " + JSON.stringify(headers) : "",
    "  Issue: " + message,
    "",
    "This pin asserts that " + METHOD + " " + ROUTE + " actually performs",
    "its side-effect (a " + EXPECTED_KIND + " to '" + EXPECTED_TARGET + "'), not just",
    "returns a happy status. If the endpoint stubbed out the side-effect,",
    "this test catches it.",
    "",
    "If the X-Pinned-Side-Effect headers are MISSING from the response:",
    "  Your route handler needs to emit them on requests carrying",
    "  X-Pinned-Test: 1. See https://pinnedai.dev/docs/x-pinned-side-effect",
    "  for the wrapper. Example (Next.js app router):",
    "",
    "    export async function " + METHOD + "(req: Request) {",
    "      const body = await req.json();",
    "      const result = await yourExistingHandler(body);",
    "      return Response.json(result, {",
    "        headers: req.headers.get('X-Pinned-Test') === '1' ? {",
    "          'X-Pinned-Side-Effect': '" + EXPECTED_KIND + "',",
    "          'X-Pinned-Side-Effect-Target': '" + EXPECTED_TARGET + "',",
    "          'X-Pinned-Side-Effect-Id': result.id || String(Date.now()),",
    "        } : {},",
    "      });",
    "    }",
    "",
    "If the headers ARE present but values don't match:",
    "  The side-effect type or target changed. Update the pin (intentional",
    "  change) by retiring + regenerating, OR fix the handler to match the",
    "  original contract.",
    "",
    "After fixing, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].filter(Boolean).join("\\n");
}

// Build a minimal valid-shape body. Customer can edit this if the
// endpoint needs a richer payload — the test file is theirs to tweak.
function buildValidBody(): Record<string, unknown> {
  return {
    pinnedTest: true,
    placeholderField: "pinned-test-value",
  };
}

describe("pinned: happy-path-with-side-effect " + METHOD + " " + ROUTE, () => {
  const previewMissing = !PREVIEW_URL;
  const forceRequire = process.env.PINNED_REQUIRE_PREVIEW_URL === "1";

  beforeAll(() => {
    if (previewMissing && forceRequire) {
      throw new Error(
        "PREVIEW_URL env var required for pinned happy-path-with-side-effect tests. " +
          "See https://pinnedai.dev/docs/preview-url"
      );
    }
  });

  it.skipIf(previewMissing && !forceRequire)(
    "returns 2xx AND emits X-Pinned-Side-Effect headers",
    async () => {
      const url = PREVIEW_URL!.replace(/\\/$/, "") + ROUTE;
      const res = await pinnedFetch(url, {
        method: METHOD,
        headers: {
          "Content-Type": "application/json",
          "X-Pinned-Test": "1",
        },
        body: JSON.stringify(buildValidBody()),
      });

      if (res.status < 200 || res.status >= 300) {
        throw new Error(repairPrompt("non-2xx status", res.status));
      }

      const sideEffectKind = res.headers.get("X-Pinned-Side-Effect") || res.headers.get("x-pinned-side-effect");
      const sideEffectTarget = res.headers.get("X-Pinned-Side-Effect-Target") || res.headers.get("x-pinned-side-effect-target");
      const sideEffectId = res.headers.get("X-Pinned-Side-Effect-Id") || res.headers.get("x-pinned-side-effect-id");

      if (!sideEffectKind) {
        throw new Error(
          repairPrompt(
            "endpoint returned 2xx but X-Pinned-Side-Effect header is missing — endpoint may be a stub returning a happy status without doing the work (misleading-green)",
            res.status
          )
        );
      }
      if (sideEffectKind !== EXPECTED_KIND) {
        throw new Error(
          repairPrompt(
            "X-Pinned-Side-Effect mismatch (got '" + sideEffectKind + "', expected '" + EXPECTED_KIND + "')",
            res.status
          )
        );
      }
      if (sideEffectTarget && sideEffectTarget.toLowerCase() !== EXPECTED_TARGET.toLowerCase()) {
        throw new Error(
          repairPrompt(
            "X-Pinned-Side-Effect-Target mismatch (got '" + sideEffectTarget + "', expected '" + EXPECTED_TARGET + "')",
            res.status
          )
        );
      }
      if (!sideEffectId) {
        throw new Error(
          repairPrompt(
            "X-Pinned-Side-Effect-Id missing — handler emitted side-effect type but not the resulting ID, which means we can't verify a unique work item was created",
            res.status
          )
        );
      }

      expect(sideEffectKind).toBe(EXPECTED_KIND);
      expect(sideEffectId).toBeTruthy();
    }
  );
});
`;

  return { filename, content, claimId };
}
