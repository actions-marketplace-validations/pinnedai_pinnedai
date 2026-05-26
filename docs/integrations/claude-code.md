# Pinned + Claude Code

Claude Code is the terminal-first AI coder. `pinned init` already wires the statusline + UserPromptSubmit hook into `.claude/settings.json` automatically — Claude sees Pinned state in the bottom bar and gets transient messages when pins are added or broken.

If you want **clickable slash commands** in Claude Code (the same way the VS Code extension surfaces Quick Pick actions), opt in with:

```bash
npx pinnedai install-claude
```

This adds (with your confirmation):

| Slash command | What it does |
|---|---|
| `/pinned-status` | Shows current guard state |
| `/pinned-list` | Lists active guards |
| `/pinned-review` | Runs the full review (Guard Integrity + scan-diff + lessons check) |
| `/pinned-done` | Pre-completion check — call before saying a change is finished |

These live in `.claude/commands/` and are per-repo (not global). Remove anytime with `rm -rf .claude/commands/pinned-*.md`.

## Without slash commands

If you skip `install-claude`, Pinned still works:

- Statusline updates automatically (`◆ pinned · N guards · ✓`)
- The UserPromptSubmit hook injects a "Pinned added 3 new guards" message when guards are added
- Block events appear inline when Guard Integrity fires

## With MCP

If you also have `pinnedai-mcp` installed in Claude Desktop:

```json
// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "pinnedai": {
      "command": "npx",
      "args": ["-y", "pinnedai-mcp"]
    }
  }
}
```

Claude Desktop will see the Pinned tools (`pinned_before_code_change`, `pinned_before_done_check`, etc.) and use them at the right lifecycle moments.

## What gets written to CLAUDE.md

`pinned init` adds a marker-bounded block to `CLAUDE.md` (or appends to your existing one) with five rules + a pointer to `.pinned/ai-lessons.md`. The whole block is removable with `pinned ai-rules uninstall` — no orphan content, no surprise edits.
