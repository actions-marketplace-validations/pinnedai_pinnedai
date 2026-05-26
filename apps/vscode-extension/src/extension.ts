// pinnedai VS Code extension.
//
// Brings the Pinned statusline to VS Code, Cursor, and every VS Code-
// family editor. The extension is intentionally thin:
//   - Activates only when the workspace looks like a pinnedai repo
//     (presence of `tests/pinned/.registry.json` or `.pinnedai/config.json`)
//   - Reads the CLI's emitted statusline via shelling out to `pinned statusline`
//   - Refreshes every N seconds + on file save (configurable)
//   - Adds Pinned commands to the command palette
//
// We deliberately don't re-implement statusline rendering in TS here.
// The CLI is the source of truth for state shape, and any future
// statusline state we add to the CLI is automatically picked up by
// this extension.

import * as vscode from "vscode";
import { spawn } from "node:child_process";

const PINNED_BIN_HINTS = [
  // Workspace-installed (`npm install pinnedai`)
  "node_modules/.bin/pinned",
  // Monorepo dogfood location
  "apps/cli/dist/cli.js",
  "node_modules/pinnedai/dist/cli.js",
];

let statusBarItem: vscode.StatusBarItem | undefined;
let refreshTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration("pinnedai");
  if (cfg.get<boolean>("statusBar.enabled", true)) {
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    statusBarItem.command = "pinnedai.showInfo";
    context.subscriptions.push(statusBarItem);
    refresh();

    const intervalSec = Math.max(2, cfg.get<number>("statusBar.refreshIntervalSeconds", 10));
    refreshTimer = setInterval(refresh, intervalSec * 1000);
    context.subscriptions.push({ dispose: () => refreshTimer && clearInterval(refreshTimer) });

    // Also refresh on file save — the most likely moment for state to change.
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(refresh)
    );
  }

  // Commands wired into the command palette + status bar click target.
  context.subscriptions.push(
    vscode.commands.registerCommand("pinnedai.review", () => runInTerminal("review")),
    vscode.commands.registerCommand("pinnedai.status", () => runInTerminal("status")),
    vscode.commands.registerCommand("pinnedai.list", () => runInTerminal("list --verbose")),
    vscode.commands.registerCommand("pinnedai.openSite", () => {
      vscode.env.openExternal(vscode.Uri.parse("https://pinnedai.dev"));
    }),
    vscode.commands.registerCommand("pinnedai.showInfo", showInfoQuickPick)
  );
}

export function deactivate(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  if (statusBarItem) statusBarItem.dispose();
}

// ---- helpers ----

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

// Resolve a pinned binary command. Searches workspace-relative hints
// first, then falls back to `pinned` on PATH, then `npx --no-install
// pinnedai`. Returns a 2-tuple [executable, prefixArgs] so the caller
// can append the subcommand.
function resolveBin(root: string): { cmd: string; args: string[] } {
  const cfg = vscode.workspace.getConfiguration("pinnedai");
  const explicit = cfg.get<string>("binaryPath", "").trim();
  if (explicit) {
    if (explicit.endsWith(".js")) return { cmd: "node", args: [explicit] };
    return { cmd: explicit, args: [] };
  }
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  for (const hint of PINNED_BIN_HINTS) {
    const abs = path.join(root, hint);
    if (fs.existsSync(abs)) {
      if (hint.endsWith(".js")) return { cmd: "node", args: [abs] };
      return { cmd: abs, args: [] };
    }
  }
  // Fallback: assume `pinned` is on PATH (global install) or use npx.
  return { cmd: "npx", args: ["--no-install", "pinnedai"] };
}

function refresh(): void {
  if (!statusBarItem) return;
  const root = workspaceRoot();
  if (!root) {
    statusBarItem.hide();
    return;
  }
  const { cmd, args } = resolveBin(root);
  const child = spawn(cmd, [...args, "statusline"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout?.on("data", (b: Buffer) => (out += b.toString("utf8")));
  child.on("close", (code) => {
    if (!statusBarItem) return;
    if (code !== 0) {
      // CLI not installed / not pinned-initialized — hide silently.
      statusBarItem.hide();
      return;
    }
    // Strip ANSI codes the CLI emits for terminal coloring; VS Code's
    // status bar uses its own theme tokens.
    const clean = out.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (!clean) {
      statusBarItem.hide();
      return;
    }
    statusBarItem.text = clean;
    statusBarItem.tooltip = buildTooltip(root);
    statusBarItem.show();
  });
  child.on("error", () => {
    if (statusBarItem) statusBarItem.hide();
  });
}

// Build a rich MarkdownString tooltip from on-disk Pinned state. Falls back
// to a plain one-liner if the state files aren't readable. Cipherwake-style
// hover: surface pin count, recently saved guards, AI lessons, and last
// block event, plus clickable command links.
function buildTooltip(root: string): vscode.MarkdownString {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const md = new vscode.MarkdownString();
  md.isTrusted = true;
  md.supportHtml = false;

  type LastStatus = {
    status?: string;
    totalPins?: number;
    safetyNotes?: number;
    failingCount?: number;
    recentlyAddedSummaries?: string[];
    lessonsLifetime?: number;
    guardsSavedLifetime?: number;
    lastLessonSummary?: string;
    lastBlockEventSummary?: string;
    updatedAt?: string;
  };
  let s: LastStatus = {};
  try {
    const raw = fs.readFileSync(
      path.join(root, "tests/pinned/.last-status.json"),
      "utf8"
    );
    s = JSON.parse(raw) as LastStatus;
  } catch {
    // No state yet — show a minimal hover.
    md.appendMarkdown("**Pinned**\n\nRun `pinned init` to start protecting this repo.");
    return md;
  }

  const dot =
    s.status === "red" ? "🔴" : s.status === "yellow" ? "🟡" : "🟢";
  md.appendMarkdown(`**${dot} Pinned — ${s.totalPins ?? 0} guards active**\n\n`);

  if ((s.failingCount ?? 0) > 0) {
    md.appendMarkdown(`⚠️ **${s.failingCount} guard(s) failing.** Run \`pinned status\` for details.\n\n`);
  }

  if ((s.guardsSavedLifetime ?? 0) > 0) {
    md.appendMarkdown(`Lifetime: **${s.guardsSavedLifetime}** guards saved, **${s.lessonsLifetime ?? 0}** AI lessons learned\n\n`);
  }

  const recent = (s.recentlyAddedSummaries ?? []).slice(0, 3);
  if (recent.length > 0) {
    md.appendMarkdown(`*Recently added:*\n`);
    for (const r of recent) {
      const short = r.length > 90 ? r.slice(0, 87) + "…" : r;
      md.appendMarkdown(`- ${short}\n`);
    }
    md.appendMarkdown("\n");
  }

  if (s.lastLessonSummary) {
    const short =
      s.lastLessonSummary.length > 110
        ? s.lastLessonSummary.slice(0, 107) + "…"
        : s.lastLessonSummary;
    md.appendMarkdown(`*Latest lesson:* ${short}\n\n`);
  }

  if (s.safetyNotes && s.safetyNotes > 0) {
    md.appendMarkdown(`${s.safetyNotes} safety note(s) — run \`pinned status\` to review.\n\n`);
  }

  md.appendMarkdown(`---\n`);
  md.appendMarkdown(
    `[Status](command:pinnedai.status) · [List](command:pinnedai.list) · [Review](command:pinnedai.review) · [pinnedai.dev](command:pinnedai.openSite)`
  );
  return md;
}

// Click-target for the status bar item. Opens a Quick Pick that
// surfaces the same rich state shown on hover (pin count, recent guards,
// latest lesson, etc.) PLUS actionable commands. Clicking an item runs
// the underlying command — no separate "open terminal" detour needed.
async function showInfoQuickPick(): Promise<void> {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("Pinned: no workspace folder open.");
    return;
  }
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  type LastStatus = {
    status?: string;
    totalPins?: number;
    failingCount?: number;
    safetyNotes?: number;
    recentlyAddedSummaries?: string[];
    lessonsLifetime?: number;
    guardsSavedLifetime?: number;
    lastLessonSummary?: string;
    lastBlockEventSummary?: string;
  };
  let s: LastStatus = {};
  try {
    s = JSON.parse(
      fs.readFileSync(path.join(root, "tests/pinned/.last-status.json"), "utf8")
    ) as LastStatus;
  } catch {
    // No state yet — show a minimal panel.
    const pick = await vscode.window.showQuickPick(
      [
        { label: "$(rocket) Run `pinned init`", description: "Set up regression guards", action: "init" },
        { label: "$(globe) Open pinnedai.dev", action: "site" },
      ],
      { placeHolder: "Pinned isn't initialized in this repo yet" }
    );
    if (pick?.action === "init") return runInTerminal("init");
    if (pick?.action === "site") return void vscode.commands.executeCommand("pinnedai.openSite");
    return;
  }

  const dot = s.status === "red" ? "$(error)" : s.status === "yellow" ? "$(warning)" : "$(pass)";
  const items: Array<vscode.QuickPickItem & { action?: string }> = [];

  // Info rows (non-actionable). They render as enabled-looking items but
  // the action handler ignores them. Using a divider-like description.
  items.push({
    label: `${dot} Pinned — ${s.totalPins ?? 0} guard(s) active`,
    description: s.failingCount && s.failingCount > 0 ? `${s.failingCount} failing` : "all green",
    detail:
      `${s.guardsSavedLifetime ?? 0} guards saved · ${s.lessonsLifetime ?? 0} AI lessons learned` +
      (s.safetyNotes ? ` · ${s.safetyNotes} safety note(s)` : ""),
  });

  const recent = (s.recentlyAddedSummaries ?? []).slice(0, 3);
  for (const r of recent) {
    items.push({
      label: `$(plus) ${r.length > 90 ? r.slice(0, 87) + "…" : r}`,
      description: "recently added",
    });
  }

  if (s.lastLessonSummary) {
    items.push({
      label: `$(lightbulb) ${
        s.lastLessonSummary.length > 90
          ? s.lastLessonSummary.slice(0, 87) + "…"
          : s.lastLessonSummary
      }`,
      description: "latest AI lesson",
    });
  }

  if (s.lastBlockEventSummary) {
    items.push({
      label: `$(shield) ${
        s.lastBlockEventSummary.length > 90
          ? s.lastBlockEventSummary.slice(0, 87) + "…"
          : s.lastBlockEventSummary
      }`,
      description: "last block event",
    });
  }

  // Separator so the actions are visually distinct from the info rows.
  items.push({ label: "", kind: vscode.QuickPickItemKind.Separator });

  items.push(
    { label: "$(terminal) Run `pinned status` in terminal", action: "status" },
    { label: "$(list-unordered) Run `pinned list` in terminal", action: "list" },
    { label: "$(checklist) Run `pinned review` in terminal", action: "review" },
    { label: "$(globe) Open pinnedai.dev", action: "site" }
  );

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: "Pinned — pick an action",
    matchOnDescription: true,
  });

  switch (pick?.action) {
    case "status":
      return runInTerminal("status");
    case "list":
      return runInTerminal("list --verbose");
    case "review":
      return runInTerminal("review");
    case "site":
      return void vscode.commands.executeCommand("pinnedai.openSite");
    default:
      // Info-only row clicked — no action.
      return;
  }
}

function runInTerminal(subcommand: string): void {
  const root = workspaceRoot();
  if (!root) {
    vscode.window.showWarningMessage("Pinned: no workspace folder open.");
    return;
  }
  const { cmd, args } = resolveBin(root);
  const fullCmd = [cmd, ...args, ...subcommand.split(" ")].join(" ");

  // Reuse an existing Pinned terminal if one is open, otherwise spawn.
  const existing = vscode.window.terminals.find((t) => t.name === "Pinned");
  const terminal = existing ?? vscode.window.createTerminal({ name: "Pinned", cwd: root });
  terminal.show();
  terminal.sendText(fullCmd);
}
