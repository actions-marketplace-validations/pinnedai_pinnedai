// Catch-impact translator: turns a Claim into a plain-English
// "what would have shipped to users if AI later removed this guard"
// description. Used by:
//   - `pinned catches` (layman-friendly listing)
//   - CATCHES.md auto-generated ledger
//   - Chat hook (injects severity-tagged context so the AI can
//     answer "what did Pinned catch?" without reading raw JSON)
//
// Deterministic mapping — no LLM. Keeps the "no false claims"
// invariant from [[pinned-proof-page-launch-deliverable]] AND
// stays fast enough to compute at catch-record time.
//
// Severity tiers (for display + filtering):
//   critical — security incident / large customer-data exposure
//   high     — visible user-facing breakage / silent data loss
//   medium   — UX degradation, error-handling weakening, config drift
//   low      — basic sanity (CLI exits 0, etc.)
//   info     — telemetric, not a real "save" (lockfile-integrity)

import type { Claim } from "./claimParser.js";

export type CatchSeverity = "critical" | "high" | "medium" | "low" | "info";

export type CatchImpact = {
  severity: CatchSeverity;
  // 3-6 word layman headline — replaces the jargon technical title
  // in `pinned catches` and CATCHES.md. Example: "Admin dashboard
  // auth check" instead of "auth required on * (middleware) (added
  // in this fix)".
  headline: string;
  // 1-2 sentence plain-English description of the user-facing
  // consequence if this guard were removed. Written for the
  // non-developer founder reading their dashboard, not for the dev
  // reading the test file.
  impact: string;
  // ANSI-friendly badge (for terminal output: `pinned catches`)
  badgeAnsi: string;
  // Plain-text badge for places without color (CATCHES.md, JSON)
  badgePlain: string;
};

// Color-coded badge per severity. Reset is always included.
function badge(sev: CatchSeverity, useColor = true): { ansi: string; plain: string } {
  const labels: Record<CatchSeverity, string> = {
    critical: "🔴 CRITICAL",
    high: "🟠 HIGH",
    medium: "🟡 MEDIUM",
    low: "🔵 LOW",
    info: "⚪ INFO",
  };
  const plain = labels[sev];
  if (!useColor) return { ansi: plain, plain };
  const colorCodes: Record<CatchSeverity, string> = {
    critical: "\x1b[31m", // red
    high: "\x1b[33m",     // yellow (orange-ish)
    medium: "\x1b[33m",   // yellow
    low: "\x1b[36m",      // cyan
    info: "\x1b[2m",      // dim
  };
  return {
    ansi: `${colorCodes[sev]}${plain}\x1b[0m`,
    plain,
  };
}

export function deriveCatchImpact(claim: Claim): CatchImpact {
  const t = claim.template;

  // auth-required — covers server routes, middleware, client fetches,
  // client error handling (all use the auth-required template per the
  // [[pinned-client-side-scope-expansion]] decision, route-prefix is
  // how we differentiate)
  if (t === "auth-required") {
    const route = claim.route ?? "";
    if (route === "* (middleware)") {
      const b = badge("critical");
      return {
        severity: "critical",
        headline: "Site-wide auth middleware",
        impact:
          "Without this protection, AI changes could quietly expose every admin or internal page to anyone with the URL. Customer data could be accessed by the public.",
        badgeAnsi: b.ansi,
        badgePlain: b.plain,
      };
    }
    if (/^\/api\/(?:admin|internal)/i.test(route)) {
      const b = badge("critical");
      return {
        severity: "critical",
        headline: `Admin route auth (${route})`,
        impact:
          "Without this protection, an admin or internal API endpoint could become publicly callable. Customer data, billing details, or internal controls could be exposed.",
        badgeAnsi: b.ansi,
        badgePlain: b.plain,
      };
    }
    if (route.startsWith("client:")) {
      const file = route.replace(/^client:/, "");
      const b = badge("high");
      return {
        severity: "high",
        headline: `Client API call sends required headers (${shortFile(file)})`,
        impact:
          "Without this protection, the app's calls to the backend could stop sending login credentials or other required headers. Signed-in users could see broken pages, dashboards stuck on 'loading…', or be unexpectedly logged out.",
        badgeAnsi: b.ansi,
        badgePlain: b.plain,
      };
    }
    if (route.startsWith("client-err:")) {
      const file = route.replace(/^client-err:/, "");
      const b = badge("high");
      return {
        severity: "high",
        headline: `Client handles backend errors (${shortFile(file)})`,
        impact:
          "Without this protection, when the backend fails the app could silently pretend it succeeded — forms showing 'Thanks!' for messages that never arrived, payments appearing to go through, or users seeing blank screens instead of helpful error messages.",
        badgeAnsi: b.ansi,
        badgePlain: b.plain,
      };
    }
    // Generic server route auth
    const b = badge("high");
    return {
      severity: "high",
      headline: `Route requires auth (${route})`,
      impact:
        "Without this protection, the route could become accessible without a logged-in user. Data this route returns or actions it performs could happen for visitors who shouldn't have access.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  if (t === "returns-status") {
    const b = badge("medium");
    return {
      severity: "medium",
      headline: `Input validation (${claim.method} ${claim.route})`,
      impact:
        "Without this protection, the endpoint could start accepting bad input — empty fields, wrong types, malformed payloads — and either save broken data to the database or crash trying to process it.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  if (t === "secret-not-public") {
    const b = badge("critical");
    return {
      severity: "critical",
      headline: "Public env-var doesn't carry a secret",
      impact:
        "Without this protection, an environment variable that gets inlined into the public app bundle (visible to every visitor) could end up named with a 'secret-shaped' suffix and contain a real credential. Visitors could view-source and steal it.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  if (t === "config-invariant") {
    const b = badge("medium");
    const label = (claim as { label?: string }).label ?? "configuration value";
    return {
      severity: "medium",
      headline: `Config invariant: ${label}`,
      impact:
        "Without this protection, an important configuration line (workflow permission, env requirement, AI-coder instructions) could be deleted without anyone noticing. The thing it controlled would silently stop working.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  if (t === "package-exports-exist") {
    const b = badge("medium");
    return {
      severity: "medium",
      headline: `Package exports stay intact (${shortFile((claim as { modulePath?: string }).modulePath ?? "")})`,
      impact:
        "Without this protection, an exported function or value could be renamed or removed. Other code (including external users of the package) that imported it would break with no warning until run time.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  if (t === "lockfile-integrity") {
    // Per the lockfile-demotion decision, generic lockfile changes
    // are info-level. The pin only fires on suspicious cases (silent
    // regen / lockfile removed / pm switched), so when it DOES fire,
    // it's worth medium severity.
    const b = badge("medium");
    return {
      severity: "medium",
      headline: "Lockfile silently changed",
      impact:
        "Without this protection, AI agents running `npm install` (or similar) for no declared reason could silently shift the versions of dependencies you didn't intend to update — leading to mystery breakage on the next build.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  if (t === "cli-exits-zero" || t === "cli-flag-supported" || t === "cli-json-shape" || t === "cli-output-contains" || t === "cli-creates-file") {
    const b = badge("low");
    return {
      severity: "low",
      headline: `CLI sanity check (${claim.route})`,
      impact:
        "Without this protection, the CLI could start crashing on basic invocations — users running `--help`, `--version`, or a documented flag would see Node stack traces.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  if (t === "library-returns") {
    const b = badge("medium");
    return {
      severity: "medium",
      headline: `Library function return shape (${(claim as { functionName?: string }).functionName ?? "?"})`,
      impact:
        "Without this protection, a function this library exports could start returning a different shape. Anything calling it would break in subtle ways.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  if (t === "rate-limit" || t === "idempotent" || t === "tier-cap" || t === "permission-required") {
    const b = badge("high");
    return {
      severity: "high",
      headline: `${humanizeTemplate(t)} on ${claim.route}`,
      impact:
        "Without this protection, this app rule could be bypassed by a coding mistake. Users could exceed limits, trigger duplicate actions, or access things their plan doesn't allow for.",
      badgeAnsi: b.ansi,
      badgePlain: b.plain,
    };
  }

  // Default fallback
  const b = badge("medium");
  return {
    severity: "medium",
    headline: `${t} pin`,
    impact: "An app promise that Pinned was protecting.",
    badgeAnsi: b.ansi,
    badgePlain: b.plain,
  };
}

function shortFile(p: string): string {
  // Strip leading apps/web/, apps/app/, src/ if present to keep
  // headlines scannable in terminal output. Don't go past 60 chars.
  let s = p.replace(/^(?:apps\/[^/]+\/)?(?:src\/)?/, "");
  if (s.length > 60) s = "…" + s.slice(-60);
  return s;
}

function humanizeTemplate(t: string): string {
  return t.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

// Convenience for ordering catches by severity in lists.
export const SEVERITY_RANK: Record<CatchSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};
