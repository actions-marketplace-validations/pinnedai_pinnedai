// ═══════════════════════════════════════════════════════════════
// ◆ Pinned by pinnedai — https://pinnedai.dev
// ═══════════════════════════════════════════════════════════════
// Original PR claim: "Auth required on /api/projects"
// Source PR:         baseline-20260525
// Template:          auth-required
// Permanent:         this test fails if the claim is ever regressed.
//
// Retire when no longer applicable:
//   pinned retire baseline-20260525-auth-required-api-projects-1mbbq1 --reason="..."
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
const ORIGINAL_PR = "baseline-20260525";
const ORIGINAL_CLAIM = "Auth required on /api/projects";
const BAD_CASE = "an unauthenticated request to /api/projects returned 2xx instead of 401/403";
const TEST_FILENAME = "baseline-20260525-auth-required-api-projects-1mbbq1.test.ts";
// Static-mode fingerprint. Present when this pin was generated from
// a diff-aware detector that observed the auth check being added —
// the captured signature lets us verify the check is still present
// in source even without a live server. Production (PREVIEW_URL set)
// always uses the live fetch path; the static check runs in addition,
// catching the "AI deleted the auth code from source" failure mode
// that a live test can also catch but for which a static signal is
// faster + cheaper.
const STATIC_VERIFY = null;
// Optional fixture token for the "authed → 2xx" direction. When
// present, the with-auth direction runs and catches over-tightening
// regressions (route accidentally blocked even for authenticated users).
// When absent, that direction skips silently.
const TOKEN_AUTH = process.env.PREVIEW_TEST_TOKEN_AUTH;

function repairPrompt(actualStatus: number): string {
  return [
    "",
    "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
    "",
    "Fix the failing pinned claim in this test file:",
    "  Claim: " + ORIGINAL_CLAIM,
    "  Original PR: " + ORIGINAL_PR,
    "  Route: " + ROUTE,
    "  Bad case: " + BAD_CASE,
    "  Expected: unauthenticated GET to " + ROUTE + " returns 401 or 403",
    "  Actual: returned " + actualStatus,
    "",
    "Restore the auth check on " + ROUTE + ". Likely candidates:",
    "  - middleware.ts or src/middleware.ts (Next.js / Hono / generic)",
    "  - The route handler file for " + ROUTE,
    "  - Auth provider config (Clerk / Auth.js / Supabase / Lucia)",
    "Preserve authenticated behavior. Do not modify this pinned test file.",
    "",
    "After fixing, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
    "═══════════════════════════════════════════════════════════════",
    "",
  ].join("\n");
}

describe("pinned: auth-required on " + ROUTE, () => {
  // Skip — not fail — when PREVIEW_URL is unset. Lets background
  // post-commit auto-runs pass on machines that don't have it
  // configured. Manual runs still see a helpful message via the skip
  // reason. To force failure on missing env, set PINNED_REQUIRE_PREVIEW_URL=1.
  const previewMissing = !PREVIEW_URL;
  const forceRequire = process.env.PINNED_REQUIRE_PREVIEW_URL === "1";

  beforeAll(() => {
    if (previewMissing && forceRequire) {
      throw new Error(
        "PREVIEW_URL env var required for pinned auth-required tests. " +
          "See https://pinnedai.dev/docs/preview-url"
      );
    }
  });

  // Static-mode check — runs whenever the pin carries a fingerprint
  // (diff-aware pins always do; PR-claim-derived pins don't). Reads
  // the source file the auth check was added to and asserts the
  // captured signature is still present. Catches:
  //   - AI deleted the auth check from the route file
  //   - Refactor moved the route to a new file without the auth code
  // Does NOT catch: auth check replaced with a weaker one that
  // happens to contain the same signature substring (rare; live
  // mode catches that).
  it.skipIf(!STATIC_VERIFY)(
    "source still contains the auth check captured at pin time",
    () => {
      const sv = STATIC_VERIFY!;
      const abs = resolvePath(process.cwd(), sv.filePath);
      if (!existsSync(abs)) {
        throw new Error(
          [
            "",
            "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
            "",
            "Pinned auth-required pin failed (static check):",
            "  Claim: " + ORIGINAL_CLAIM,
            "  Original PR: " + ORIGINAL_PR,
            "  Route: " + ROUTE,
            "  Expected file: " + sv.filePath + " (missing)",
            "",
            "The route handler file that originally contained the auth check",
            "no longer exists. Either the file was renamed/moved, or the",
            "auth code was removed along with the file.",
            "",
            "If this is an intentional refactor, retire the pin:",
            "  pinned retire " + ORIGINAL_PR + " --reason=\"refactor: route moved\"",
            "═══════════════════════════════════════════════════════════════",
            "",
          ].join("\n")
        );
      }
      const raw = readFileSync(abs, "utf8");
      // Strip comments before searching so a parent file's
      // "// TODO: add requireAuth()" doesn't falsely satisfy the
      // signature check and mask a real catch. Same comment-stripping
      // the diff-aware detector uses when it captures the signature
      // — keeps the two ends symmetric.
      const content = raw
        .split("\n")
        .map((l: string) => l.replace(/\/\/.*$/, ""))
        .join("\n")
        .replace(/\/\*[\s\S]*?\*\//g, "");
      // Format-normalize both content and signature before comparing.
      // Lint reformatters (Prettier, ESLint --fix) often collapse
      // multi-line expressions or rearrange trailing commas. Without
      // normalization, a captured single-line signature wouldn't match
      // the same logical code split across lines in the parent — producing
      // FALSE POSITIVE catches on pure lint commits.
      // See [[lint-format-false-positives]] memory.
      const normalizeForSig = (s: string) => s.replace(/\s+/g, "").replace(/,(?=[)\]}])/g, "");
      const contentN = normalizeForSig(content);
      const sigN = normalizeForSig(sv.signature);
      if (!contentN.includes(sigN)) {
        throw new Error(
          [
            "",
            "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
            "",
            "Pinned auth-required pin failed (static check):",
            "  Claim: " + ORIGINAL_CLAIM,
            "  Original PR: " + ORIGINAL_PR,
            "  Route: " + ROUTE,
            "  File: " + sv.filePath,
            "  Missing auth signature: " + sv.signature,
            "",
            "The auth check that protects " + ROUTE + " has been removed or",
            "changed. The original fix introduced the snippet above; it's",
            "no longer present in the file.",
            "",
            "Restore the auth check, OR — if the route legitimately no longer",
            "requires auth — retire the pin:",
            "  pinned retire " + ORIGINAL_PR + " --reason=\"...\"",
            "═══════════════════════════════════════════════════════════════",
            "",
          ].join("\n")
        );
      }
      expect(contentN.includes(sigN)).toBe(true);
    }
  );

  // Direction 1 — REMOVAL CHECK (always runs given PREVIEW_URL)
  // Catches: auth check stripped from the route entirely.
  it.skipIf(previewMissing && !forceRequire)("returns 401 or 403 when called without an Authorization header", async () => {
    const url = PREVIEW_URL!.replace(/\/$/, "") + ROUTE;
    const res = await pinnedFetch(url, { method: "GET" });
    if (![401, 403].includes(res.status)) {
      throw new Error(repairPrompt(res.status));
    }
    expect([401, 403].includes(res.status)).toBe(true);
  });

  // Direction 2 — OVER-TIGHTENING CHECK (gated on PREVIEW_TEST_TOKEN_AUTH)
  // Catches: route accidentally blocked for authenticated users
  // ("we tightened auth and broke legit traffic"). Lower-stakes
  // than direction 1 but real — refactors that turn 200s into 403s
  // for the wrong reasons are a known AI mistake class.
  const authTokenMissing = !TOKEN_AUTH;
  it.skipIf((previewMissing || authTokenMissing) && !forceRequire)(
    "accepts authenticated requests with 2xx",
    async () => {
      const url = PREVIEW_URL!.replace(/\/$/, "") + ROUTE;
      const res = await pinnedFetch(url, {
        method: "GET",
        headers: { Authorization: "Bearer " + TOKEN_AUTH! },
      });
      if (res.status < 200 || res.status >= 300) {
        const msg = [
          "",
          "═══ PINNED FAILURE — paste this into Claude Code / Cursor ═══",
          "",
          "Fix the failing pinned claim in this test file:",
          "  Claim: " + ORIGINAL_CLAIM,
          "  Original PR: " + ORIGINAL_PR,
          "  Route: " + ROUTE,
          "  Direction: with-auth (over-tightening check)",
          "  Expected: 2xx for an authenticated GET to " + ROUTE,
          "  Actual: returned " + res.status + " (route may be over-restricted — legit authenticated users are blocked)",
          "",
          "Investigate why authenticated requests are failing on " + ROUTE + ".",
          "Likely candidates:",
          "  - Auth middleware now requires extra claims the token doesn't carry",
          "  - Route handler added new authorization checks that exclude the test user",
          "  - Session validation tightened too aggressively",
          "Preserve the no-auth → 401/403 contract (direction 1). Do not modify this pinned test file.",
          "",
          "After fixing, re-run:  npx vitest run tests/pinned/" + TEST_FILENAME,
          "═══════════════════════════════════════════════════════════════",
          "",
        ].join("\n");
        throw new Error(msg);
      }
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    }
  );
});
