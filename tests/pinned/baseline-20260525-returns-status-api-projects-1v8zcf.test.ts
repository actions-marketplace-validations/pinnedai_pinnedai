// ═══════════════════════════════════════════════════════════════
// ◆ Pinned by pinnedai — https://pinnedai.dev
// ═══════════════════════════════════════════════════════════════
// Original PR claim: "POST /api/projects returns 400 on missing body"
// Source PR:         baseline-20260525
// Template:          returns-status
// Permanent:         this test fails if the claim is ever regressed.
//
// Mechanism: sends a POST to the route with a
// minimally-invalid body ("missing body") and
// asserts the response status code is 400.
//
// Retire when no longer applicable:
//   pinned retire baseline-20260525-returns-status-api-projects-1v8zcf --reason="..."
// ═══════════════════════════════════════════════════════════════

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

// ─── Shared by Pinned templates (do not edit; regenerated per-pin) ───
// Wraps global fetch with:
//   - X-Pinned-Test: 1 header (so your app can exclude Pinned traffic
//     from rate limits, billing counters, analytics — see
//     https://pinnedai.dev/docs/x-pinned-test-header)
//   - Retry-with-backoff on transient 5xx and network errors (mitigates
//     cold-start preview false-positives — Vercel/Fly/Cloudflare often
//     return 502/503 on the first request after inactivity)
//   - Infra-failure classification: after retries are exhausted, throws
//     a tagged "PINNED_INFRA_FAILURE" error. The test wrapper catches
//     this and emits a "PINNED INFRA FAILURE" prompt instead of the
//     "PINNED FAILURE" catch prompt — so infra issues don't pollute
//     the catch ledger as real regressions.
class PinnedInfraFailure extends Error {
  pinnedInfraFailure = true;
  constructor(public reason: string, public details: string) {
    super("PINNED_INFRA_FAILURE: " + reason + " — " + details);
  }
}
async function pinnedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const baseHeaders = (init.headers ?? {}) as Record<string, string>;
  const headers = { ...baseHeaders, "X-Pinned-Test": "1" };
  const finalInit = { ...init, headers };
  let lastError: unknown;
  let lastTransientStatus: number | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, finalInit);
      // Retry transient gateway errors (502/503/504) but NOT 500 — a
      // genuine application bug should still surface. 5xx other than
      // 500 is almost always edge/proxy.
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastTransientStatus = res.status;
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        // Retries exhausted on transient 5xx → infra failure, not catch.
        throw new PinnedInfraFailure(
          "gateway-error",
          "received " + res.status + " from " + url + " after " + (attempt + 1) + " retries (preview may be down)"
        );
      }
      return res;
    } catch (e) {
      // If it's already an infra-failure (from the 5xx branch above), rethrow.
      if (e && (e as { pinnedInfraFailure?: boolean }).pinnedInfraFailure) {
        throw e;
      }
      lastError = e;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
    }
  }
  // Network error after retries — infra failure, not catch.
  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new PinnedInfraFailure(
    "network-error",
    "failed to reach " + url + ": " + msg + " (preview may be unreachable — check DNS / VPN / firewall)"
  );
}

// Helper for templates: wrap an it() body so that PinnedInfraFailure
// errors emit a distinct "PINNED INFRA FAILURE" prompt (NOT counted
// as a catch by `pinned test`'s catch-ledger). Real assertion
// failures fall through and emit the usual "PINNED FAILURE" prompt.
function pinnedWrapInfra(reason: string, body: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await body();
    } catch (e) {
      if (e && (e as { pinnedInfraFailure?: boolean }).pinnedInfraFailure) {
        const details = (e as { details: string }).details;
        throw new Error([
          "",
          "═══ PINNED INFRA FAILURE — preview environment issue, NOT a catch ═══",
          "",
          "  Direction: " + reason,
          "  Cause: " + details,
          "",
          "  This is classified as an INFRASTRUCTURE failure (preview down,",
          "  DNS issue, network blip), NOT a regression catch. Pinned's",
          "  catch ledger will NOT increment.",
          "",
          "  Fix the preview deployment, then re-run.",
          "  If you believe this IS a real catch, set PINNED_TREAT_INFRA_AS_CATCH=1",
          "  and re-run — that will count it as a catch.",
          "═══════════════════════════════════════════════════════════════════",
          "",
        ].join("\n"));
      }
      throw e;
    }
  };
}

// Production-URL guard: detect when PREVIEW_URL looks like a real
// production domain rather than a preview/staging environment. Pins
// that fire bursts of traffic (rate-limit, idempotent retries, tier-
// cap probing) against production are dangerous:
//   - rate-limit pin's 61-request burst → DOS your own users for 30s
//   - idempotent pin's duplicate POST → real side effect (charge,
//     email send, DB write)
//   - tier-cap pin's at-cap test → consumes real customer's quota
// Block with a loud warning unless PINNED_ALLOW_PRODUCTION_URL=1 is
// set. The list of "preview-like" markers is conservative.
function pinnedAssertNonProductionUrl(url: string, riskyTemplate: string): void {
  if (process.env.PINNED_ALLOW_PRODUCTION_URL === "1") return;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const isLikelyPreview =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host.startsWith("127.") ||
      host.endsWith(".local") ||
      host.includes("preview") ||
      host.includes("staging") ||
      host.includes("stage") ||
      host.includes("dev.") ||
      host.includes(".dev.") ||
      host.endsWith(".dev") && host !== "vercel.dev" /* keep loose */ ||
      host.endsWith(".test") ||
      host.includes("test.") ||
      host.endsWith(".pages.dev") /* Cloudflare Pages preview */ ||
      host.endsWith(".vercel.app") /* Vercel preview */ ||
      host.endsWith(".onrender.com") /* Render */ ||
      host.endsWith(".fly.dev") /* Fly */ ||
      host.endsWith(".railway.app") /* Railway PR env */ ||
      host.endsWith(".trycloudflare.com") /* CF tunnel */ ||
      host.includes("review-app") ||
      host.includes("pr-");
    if (!isLikelyPreview) {
      throw new Error([
        "",
        "═══ PINNED PRODUCTION-URL GUARD — refusing to run " + riskyTemplate + " against " + host + " ═══",
        "",
        "  PREVIEW_URL points at what looks like a production domain.",
        "  " + riskyTemplate + " pins fire bursts/retries/duplicate writes that",
        "  could damage real customers:",
        "    - rate-limit:  61 requests in seconds → DOS your own traffic",
        "    - idempotent:  duplicate POST → real charge/email/DB write",
        "    - tier-cap:    at-cap probing → consumes real quota",
        "",
        "  To run anyway (you've confirmed " + host + " is safe):",
        "    PINNED_ALLOW_PRODUCTION_URL=1 npx vitest run",
        "",
        "  Recommended: point PREVIEW_URL at a staging/preview deploy.",
        "  See https://pinnedai.dev/docs/preview-url",
        "═══════════════════════════════════════════════════════════════════",
        "",
      ].join("\n"));
    }
  } catch (e) {
    // If e is the production-guard error we threw, rethrow.
    if (e instanceof Error && e.message.includes("PRODUCTION-URL GUARD")) {
      throw e;
    }
    // URL parse failure — let the test deal with it.
  }
}
// ─────────────────────────────────────────────────────────────────────

// ─── Static-mode helper (shared by auth-required, rate-limit, idempotent,
//     permission-required when carrying a staticVerify fingerprint) ──
// Reads the source file the protection was added to, strips comments,
// normalizes whitespace/trailing commas (so lint reformatters don't
// produce false-positive catches per [[lint-format-false-positives]])
// and asserts the captured signature substring is still present.
// Returns null on pass; on fail returns a structured detail object the
// caller turns into a template-specific repair prompt + throws.
import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
function pinnedStaticVerify(
  sv: { filePath: string; signature: string }
): { kind: "file-missing" } | { kind: "signature-missing" } | null {
  const abs = resolvePath(process.cwd(), sv.filePath);
  if (!existsSync(abs)) return { kind: "file-missing" };
  const raw = readFileSync(abs, "utf8");
  const content = raw
    .split("\n")
    .map((l: string) => l.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const normalize = (s: string) => s.replace(/\s+/g, "").replace(/,(?=[)\]}])/g, "");
  if (!normalize(content).includes(normalize(sv.signature))) {
    return { kind: "signature-missing" };
  }
  return null;
}
// ─────────────────────────────────────────────────────────────────────

const PREVIEW_URL = process.env.PREVIEW_URL;
const ROUTE = "/api/projects";
const METHOD = "POST";
const EXPECTED_STATUS = 400;
const CONDITION = "missing body";
const ORIGINAL_PR = "baseline-20260525";
const ORIGINAL_CLAIM = "POST /api/projects returns 400 on missing body";
const BAD_CASE = "POST /api/projects (missing body) returned a status other than 400 (validation removed or weakened)";
const TEST_FILENAME = "baseline-20260525-returns-status-api-projects-1v8zcf.test.ts";
// Static-mode fingerprint — present when this pin was generated
// from the diff-aware validation detector. Lets the test verify
// the captured validation signature is still in source even
// without a live server. Same shape as the auth-required template.
const STATIC_VERIFY = null;

function repairPrompt(actualStatus: number): string {
  return [
    "",
    "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
    "",
    "Fix the failing pinned claim in this test file:",
    "  Claim: " + ORIGINAL_CLAIM,
    "  Original PR: " + ORIGINAL_PR,
    "  Route: " + METHOD + " " + ROUTE,
    "  Condition: " + CONDITION,
    "  Bad case: " + BAD_CASE,
    "  Expected: status " + EXPECTED_STATUS,
    "  Actual: returned " + actualStatus,
    "",
    "Restore the validation (or response code) on " + ROUTE + ". Common causes:",
    "  - Validation library removed or weakened (Zod, Joi, Yup, Valibot)",
    "  - Route handler short-circuits before validation",
    "  - Middleware reordered so validation runs after auth",
    "Preserve healthy-input behavior. Do not modify this pinned test file.",
    "",
    "After fixing, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].join("\n");
}

describe("pinned: returns-status " + METHOD + " " + ROUTE + " → " + EXPECTED_STATUS, () => {
  const previewMissing = !PREVIEW_URL;
  const forceRequire = process.env.PINNED_REQUIRE_PREVIEW_URL === "1";

  beforeAll(() => {
    if (previewMissing && forceRequire) {
      throw new Error(
        "PREVIEW_URL env var required for pinned returns-status tests. " +
          "See https://pinnedai.dev/docs/preview-url"
      );
    }
  });

  it.skipIf(previewMissing && !forceRequire)("returns " + EXPECTED_STATUS + " on " + CONDITION, async () => {
    const url = PREVIEW_URL!.replace(/\/$/, "") + ROUTE;
    const init: RequestInit = {
      method: METHOD,
      headers: { "Content-Type": "application/json" },
    };
    const body = JSON.stringify({});
    if (body !== undefined) (init as { body: string }).body = body;
    const res = await pinnedFetch(url, init);
    if (res.status !== EXPECTED_STATUS) {
      throw new Error(repairPrompt(res.status));
    }
    expect(res.status).toBe(EXPECTED_STATUS);
  });

  // Static-mode check — same role as the auth-required template's.
  // Reads the route's source file and asserts the validation
  // signature is still present. Catches deletions/refactors of the
  // validation code even when PREVIEW_URL is unset.
  it.skipIf(!STATIC_VERIFY)(
    "source still contains the validation signature captured at pin time",
    () => {
      const sv = STATIC_VERIFY!;
      const abs = resolvePath(process.cwd(), sv.filePath);
      if (!existsSync(abs)) {
        throw new Error(
          [
            "",
            "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
            "",
            "Pinned returns-status pin failed (static check):",
            "  Claim: " + ORIGINAL_CLAIM,
            "  Original PR: " + ORIGINAL_PR,
            "  Route: " + METHOD + " " + ROUTE,
            "  Expected file: " + sv.filePath + " (missing)",
            "",
            "The handler file that originally contained the validation no",
            "longer exists. Either it was renamed/moved, or the validation",
            "was removed along with the file.",
            "═══════════════════════════════════════════════════════════════",
            "",
          ].join("\n")
        );
      }
      const raw = readFileSync(abs, "utf8");
      // Comment-stripped match — see the auth-required template for
      // the same reasoning. "// TODO: add Zod schema" in a parent
      // file should not falsely satisfy a Zod-signature pin.
      const content = raw
        .split("\n")
        .map((l: string) => l.replace(/\/\/.*$/, ""))
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      // Format-normalize: lint reformat (Prettier) collapses multi-line
      // expressions to single line, making the captured signature
      // text-differ from parent content even when the logic is the same.
      // See [[lint-format-false-positives]].
      const normalizeForSig = (s: string) => s.replace(/\s+/g, "").replace(/,(?=[)\]}])/g, "");
      const contentN = normalizeForSig(content);
      const sigN = normalizeForSig(sv.signature);
      if (!contentN.includes(sigN)) {
        throw new Error(
          [
            "",
            "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
            "",
            "Pinned returns-status pin failed (static check):",
            "  Claim: " + ORIGINAL_CLAIM,
            "  Original PR: " + ORIGINAL_PR,
            "  Route: " + METHOD + " " + ROUTE,
            "  File: " + sv.filePath,
            "  Missing validation signature: " + sv.signature,
            "",
            "The validation that protects " + ROUTE + " was removed or",
            "rewritten. The original fix introduced the snippet above; it's",
            "no longer present in the file.",
            "═══════════════════════════════════════════════════════════════",
            "",
          ].join("\n")
        );
      }
      expect(contentN.includes(sigN)).toBe(true);
    }
  );
});
