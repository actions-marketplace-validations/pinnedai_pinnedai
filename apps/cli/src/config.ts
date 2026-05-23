// pinnedai per-repo config. Lives at `.pinnedai/config.json` at the
// repo root (NOT under tests/pinned/, because the config governs
// behavior across the whole repo, not just the pin registry).
//
// auto_protect mode — three levels of automation:
//
//   "safe":  classifier auto-adds pins for deterministic, low-risk
//            behaviors (CLI exits-zero, CLI flag exists, etc.). Skips
//            anything that needs business-context to test (rate limits,
//            idempotency keys, specific output strings).
//   "ask":   classifier writes a suggestions cache; statusline shows
//            `+N suggested`; user runs `pinned protect` to approve.
//            Never writes test files without explicit user confirmation.
//   "off":   classifier never runs. No suggestions surface. Pin count
//            grows only when the user explicitly runs `pinned generate`
//            or accepts via `pinned protect`.
//
// Default: "safe" for solo AI-coder repos (chosen during `pinned init`).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

export type AutoProtectMode = "safe" | "ask" | "off";

export type PinnedConfig = {
  version: 1;
  auto_protect: AutoProtectMode;
  // Hard cap on how many pins auto-protect may add per invocation.
  // Protects against a runaway diff dumping 50 generated tests.
  // Documented at config write time so the value is visible.
  safety_budget_per_run: number;
  // Whether the statusline should show "changes pending" when the
  // working tree differs from the last-checked snapshot. Without
  // `pinned watch` running, this state persists between commits — so
  // users who find it noisy can set false to fall through to the
  // cached green/red status with age instead.
  show_pending_changes: boolean;
  // Minimum number of Pinned-relevant changed files before the chat
  // hook fires a background auto-protect run. Below this, the queue
  // accumulates ("N to review" in the statusline) without triggering
  // work. High-risk paths (admin routes, webhooks, middleware, env
  // files) bypass this threshold and fire immediately. Default 10 —
  // 3 felt too twitchy in normal AI-coding; 10 is calmer.
  auto_review_threshold: number;
  // Whether the statusline surfaces "N to review" / "active editing"
  // when there are Pinned-relevant uncommitted changes. Default true.
  // Disable if you find the count distracting — the chat hook will
  // still auto-trigger reviews under the threshold, and `pinned review`
  // still works manually. With false, the statusline only shows ✓ in
  // the calm-green state regardless of pending edits.
  show_review_count: boolean;
  // Statusline visibility mode. Controls what shows in the calm states.
  //   "all":     default — always show ✓ / N to review / active editing /
  //              transient celebrations / actionable warnings.
  //   "minimal": ONLY show the line when something is actionable or worth
  //              celebrating — broken pins, caught regressions, risks,
  //              suggestions, newly-added pins. The default green state
  //              and "N to review" / "active editing" return empty
  //              output (which Claude Code + the VS Code extension treat
  //              as "hide the item"). For users who find the always-on
  //              indicator distracting.
  statusline_mode: "all" | "minimal";
  // HTTP-pin verification mode. Where Pinned points its 6 HTTP-route
  // templates (rate-limit / auth-required / permission-required /
  // idempotent / tier-cap / returns-status). Three modes:
  //
  //   "local":   Pinned will spawn `start` (default: `npm run dev`)
  //              during `pinned test`, wait for `url` to respond, run
  //              HTTP pins against it, then tear down ONLY processes
  //              that Pinned started (never kills user's pre-existing
  //              dev server). Best for solo AI coders with no
  //              preview-deploy infrastructure.
  //   "preview": HTTP pins read PREVIEW_URL from env (set by the user's
  //              CI / their Vercel/Netlify integration). No local
  //              process spawning. Best for CI + repos with PR previews.
  //   "off":     HTTP pins skip entirely. Pinned tests only CLI /
  //              library / config / lockfile pins. For users who don't
  //              care about HTTP behavior verification.
  //
  // Pinned NEVER spawns a dev server from statusline / chat hook —
  // only during the explicit `pinned test` command. Per the GPT
  // "passive vs explicit" guardrail.
  http: HttpConfig;
};

export type HttpMode = "local" | "preview" | "off";

export type HttpConfig = {
  mode: HttpMode;
  // Command Pinned runs when mode=local AND the URL doesn't already
  // respond. Tokenized at spawn time (no shell). Default: "npm run dev".
  start: string;
  // URL the HTTP pins target. For mode=local, the URL Pinned probes
  // to detect the dev server is ready, then exports as PREVIEW_URL
  // for the vitest invocation. For mode=preview, ignored — PREVIEW_URL
  // comes from the env var the customer's CI sets.
  url: string;
  // Path on the URL Pinned hits to detect "server is ready". Defaults
  // to "/". Frameworks with auth at the root may prefer "/api/health"
  // or similar.
  ready_path: string;
  // Max seconds Pinned waits for the dev server to respond before
  // giving up. Default 60s (Next.js cold start can take 10-30s on a
  // moderate-size project).
  timeout_seconds: number;
};

export const CONFIG_DIRNAME = ".pinnedai";
export const CONFIG_FILENAME = "config.json";

export const DEFAULT_CONFIG: PinnedConfig = {
  version: 1,
  auto_protect: "safe",
  safety_budget_per_run: 5,
  // Default OFF — without `pinned watch` running, "changes pending"
  // would show ~90% of the time, which is noise. Users who want the
  // live drift indicator can flip this to true.
  show_pending_changes: false,
  // 10 is calmer than 3 — Cursor/Claude can touch 3 files in one
  // small change and we don't want Pinned to feel constantly "reviewing."
  auto_review_threshold: 10,
  // Whether the statusline should surface "N to review" when there
  // are Pinned-relevant uncommitted changes. Default true. Set false
  // if you find the count distracting — the chat hook still triggers
  // auto-protect under the threshold, and `pinned review` still works.
  show_review_count: true,
  statusline_mode: "all",
  // Default: "off" — users explicitly opt into HTTP testing during
  // `pinned init`. Without an explicit choice, HTTP pins are saved
  // but skipped with the "not verified — no preview URL" message,
  // exactly the behavior we already ship. Choosing "local" or
  // "preview" during init flips this.
  http: {
    mode: "off",
    start: "npm run dev",
    url: "http://localhost:3000",
    ready_path: "/",
    timeout_seconds: 60,
  },
};

export function configPath(repoRoot: string): string {
  return join(repoRoot, CONFIG_DIRNAME, CONFIG_FILENAME);
}

export function readConfig(repoRoot: string): PinnedConfig {
  const path = configPath(repoRoot);
  if (!existsSync(path)) return DEFAULT_CONFIG;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PinnedConfig>;
    const mode = isValidMode(raw.auto_protect) ? raw.auto_protect : DEFAULT_CONFIG.auto_protect;
    const budget =
      typeof raw.safety_budget_per_run === "number" && raw.safety_budget_per_run >= 0
        ? raw.safety_budget_per_run
        : DEFAULT_CONFIG.safety_budget_per_run;
    const showPending =
      typeof raw.show_pending_changes === "boolean"
        ? raw.show_pending_changes
        : DEFAULT_CONFIG.show_pending_changes;
    const threshold =
      typeof raw.auto_review_threshold === "number" &&
      raw.auto_review_threshold >= 1
        ? raw.auto_review_threshold
        : DEFAULT_CONFIG.auto_review_threshold;
    const showReviewCount =
      typeof raw.show_review_count === "boolean"
        ? raw.show_review_count
        : DEFAULT_CONFIG.show_review_count;
    const statuslineMode =
      raw.statusline_mode === "all" || raw.statusline_mode === "minimal"
        ? raw.statusline_mode
        : DEFAULT_CONFIG.statusline_mode;
    const http: HttpConfig = readHttpConfig(raw.http);
    return {
      version: 1,
      auto_protect: mode,
      safety_budget_per_run: budget,
      show_pending_changes: showPending,
      auto_review_threshold: threshold,
      show_review_count: showReviewCount,
      statusline_mode: statuslineMode,
      http,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function readHttpConfig(raw: unknown): HttpConfig {
  const def = DEFAULT_CONFIG.http;
  if (!raw || typeof raw !== "object") return def;
  const r = raw as Partial<HttpConfig>;
  const mode: HttpMode =
    r.mode === "local" || r.mode === "preview" || r.mode === "off"
      ? r.mode
      : def.mode;
  const start = typeof r.start === "string" && r.start.length > 0 ? r.start : def.start;
  const url = typeof r.url === "string" && r.url.startsWith("http") ? r.url : def.url;
  const ready_path =
    typeof r.ready_path === "string" && r.ready_path.startsWith("/")
      ? r.ready_path
      : def.ready_path;
  const timeout_seconds =
    typeof r.timeout_seconds === "number" && r.timeout_seconds >= 5 && r.timeout_seconds <= 600
      ? r.timeout_seconds
      : def.timeout_seconds;
  return { mode, start, url, ready_path, timeout_seconds };
}

export function writeConfig(repoRoot: string, config: PinnedConfig): void {
  const path = configPath(repoRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n");
}

function isValidMode(m: unknown): m is AutoProtectMode {
  return m === "safe" || m === "ask" || m === "off";
}

// Human-readable label for the mode — used in statusline + prompts.
export function modeLabel(m: AutoProtectMode): string {
  switch (m) {
    case "safe":
      return "auto-protect: safe (recommended)";
    case "ask":
      return "auto-protect: ask before adding";
    case "off":
      return "auto-protect: manual only";
  }
}

// Env-var override — useful for CI ("PINNEDAI_AUTO_PROTECT=off") and for
// users who want to disable auto-protect for one run without editing
// the config file.
export function effectiveMode(repoRoot: string): AutoProtectMode {
  const envOverride = (process.env.PINNEDAI_AUTO_PROTECT ?? "").toLowerCase();
  if (isValidMode(envOverride)) return envOverride;
  return readConfig(repoRoot).auto_protect;
}
