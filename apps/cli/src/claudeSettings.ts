// Claude Code settings installer — wires `pinned statusline` into the
// `.claude/settings.json` statusLine config, and `pinned hook-failure`
// into the UserPromptSubmit hook.
//
// Idempotent: if Pinned commands are already present, we leave them
// alone. If the user has their own statusLine command, we DON'T
// override it without consent — return "conflict" instead.

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
} from "node:fs";
import { join, dirname } from "node:path";

// Claude Code's settings.json schema. Two corrections vs an earlier
// shape we used to write (and which Claude Code silently ignored):
//
//   1. statusLine requires `type: "command"` alongside the command
//      string — without `type`, Claude Code skips rendering.
//   2. Each hooks.UserPromptSubmit (and PreToolUse / PostToolUse) entry
//      is a wrapper object `{ matcher, hooks: [{ type, command }] }`,
//      NOT a flat `{ command, matcher }`. The wrapper carries one or
//      more inner hooks; only the inner objects have `type` + `command`.
type ClaudeHookCommand = { type: "command"; command: string };
type ClaudeHookEntry = { matcher?: string; hooks: ClaudeHookCommand[] };
type ClaudeSettings = {
  statusLine?: { type?: "command"; command?: string; padding?: number };
  hooks?: {
    UserPromptSubmit?: ClaudeHookEntry[];
    PreToolUse?: ClaudeHookEntry[];
    PostToolUse?: ClaudeHookEntry[];
  };
  [k: string]: unknown;
};

export type ClaudeInstallResult =
  | { status: "installed"; path: string }
  | { status: "already-installed"; path: string }
  | { status: "conflict"; path: string; reason: string };

const STATUSLINE_CMD = "node ./apps/cli/dist/cli.js statusline";
const STATUSLINE_FALLBACK_CMD = "npx pinnedai statusline";
const HOOK_CMD = "node ./apps/cli/dist/cli.js hook-failure";
const HOOK_FALLBACK_CMD = "npx pinnedai hook-failure";

function settingsPath(repoRoot: string): string {
  return join(repoRoot, ".claude", "settings.json");
}

function readSettings(path: string): ClaudeSettings {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings;
  } catch {
    return {};
  }
}

// Write settings safely. The .bak must always be the user's TRUE
// pre-Pinned state, never a half-installed snapshot from earlier in
// this same process. Constraints:
//
//   (a) If the file did not exist at the start of this process, do NOT
//       write a .bak — Pinned created the file from scratch, there is
//       nothing of the user's to preserve.
//   (b) If a .bak already exists from a prior `pinned init` run, do NOT
//       overwrite it. That .bak is the gold copy of the user's true
//       original; we never want to clobber it with a re-installed state.
//   (c) Use atomic temp+rename so a kill mid-write cannot leave a
//       half-truncated settings.json.
//
// `filesTouchedThisProcess` ensures install steps that share a process
// (statusline + failure hook in the same `pinned init`) cooperate: the
// first install captures the user's original; the second install adds
// to the same target without re-capturing the now-Pinned-touched file.
const filesTouchedThisProcess = new Set<string>();

function writeSettingsAtomic(path: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  if (
    !filesTouchedThisProcess.has(path) &&
    existsSync(path) &&
    !existsSync(path + ".bak")
  ) {
    try {
      copyFileSync(path, path + ".bak");
    } catch {
      // best-effort; do not block install on a backup error
    }
  }
  filesTouchedThisProcess.add(path);
  const tmp = path + ".tmp-" + process.pid;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + "\n");
  renameSync(tmp, path);
}

function detectBinCmd(repoRoot: string, full: string, fallback: string): string {
  // Use the workspace-local CLI if it's been built (dogfood case), else
  // fall back to `npx pinnedai` which works in a customer repo that
  // installed the package.
  return existsSync(join(repoRoot, "apps", "cli", "dist", "cli.js"))
    ? full
    : fallback;
}

export function installClaudeStatusline(repoRoot: string): ClaudeInstallResult {
  const path = settingsPath(repoRoot);
  const settings = readSettings(path);
  const desiredCmd = detectBinCmd(repoRoot, STATUSLINE_CMD, STATUSLINE_FALLBACK_CMD);

  const current = settings.statusLine?.command;
  if (current && current.includes("pinned") && current.includes("statusline")) {
    return { status: "already-installed", path };
  }
  if (current && !current.includes("pinned")) {
    return {
      status: "conflict",
      path,
      reason: `Existing statusLine.command is set to '${current}'. Remove it manually before installing Pinned.`,
    };
  }
  settings.statusLine = { type: "command", command: desiredCmd };
  writeSettingsAtomic(path, settings);
  return { status: "installed", path };
}

export function installClaudeFailureHook(repoRoot: string): ClaudeInstallResult {
  const path = settingsPath(repoRoot);
  const settings = readSettings(path);
  const desiredCmd = detectBinCmd(repoRoot, HOOK_CMD, HOOK_FALLBACK_CMD);

  const hooks = settings.hooks ?? {};
  const existing = hooks.UserPromptSubmit ?? [];
  // Walk the wrapper-and-inner-hooks shape; an entry counts as Pinned
  // if any inner hook's command references pinned + hook-failure.
  const alreadyHasPinned = existing.some((entry) =>
    (entry?.hooks ?? []).some(
      (h) =>
        typeof h?.command === "string" &&
        h.command.includes("pinned") &&
        h.command.includes("hook-failure")
    )
  );
  if (alreadyHasPinned) {
    return { status: "already-installed", path };
  }
  hooks.UserPromptSubmit = [
    ...existing,
    {
      matcher: "",
      hooks: [{ type: "command", command: desiredCmd }],
    },
  ];
  settings.hooks = hooks;
  writeSettingsAtomic(path, settings);
  return { status: "installed", path };
}

export function isClaudeStatuslineInstalled(repoRoot: string): boolean {
  const path = settingsPath(repoRoot);
  if (!existsSync(path)) return false;
  const settings = readSettings(path);
  const cmd = settings.statusLine?.command ?? "";
  return cmd.includes("pinned") && cmd.includes("statusline");
}
