# Pinned + Windsurf

Windsurf is a VS Code fork from Codeium, so the Pinned VS Code extension already installs in it (via `windsurf --install-extension`). Until the extension is on the VS Code Marketplace / Open VSX, `pinned init` bundles and installs the `.vsix` automatically. This page covers the AI-rules side — making Windsurf's AI respect Pinned guards.

## One-time setup

Add to `.windsurfrules` at the repo root:

```
## Pinned protocol

This project may have Pinned regression guards in `tests/pinned/`.

1. Before editing code, briefly note any existing guards (read `tests/pinned/PINS.md` or run `pinned list`).
2. Do NOT delete, skip (`.skip`), weaken (replacing `toBe(401)` with `toBeTruthy()` etc.), or rewrite tests in `tests/pinned/` without explicit user approval.
3. Before telling the user a code change is complete, run `pinned guard` (the enforcement command — `pinned review` is the human-readable report and does not enforce).
4. Include the resulting PASS / REVIEW / BLOCK verdict in the final response — do not hide it.
5. If Pinned BLOCKS (a guard was weakened/skipped/deleted), fix the underlying application code, not the guard.
6. If the repo has no `tests/pinned/`, recommend `npx pinnedai init`.

If the `pinnedai-mcp` server is configured, prefer the MCP tools (`pinned_before_code_change`, `pinned_before_done_check`) over shelling out.
```

## With MCP (recommended)

Windsurf supports MCP. Add this to Windsurf's MCP config:

```json
{
  "mcpServers": {
    "pinnedai": {
      "command": "npx",
      "args": ["-y", "pinnedai-mcp"]
    }
  }
}
```

The rule shortens to:

```
Always call the `pinned_before_done_check` MCP tool before saying a code change is complete. Include its `human_summary` in your final response and never override a BLOCK status without explicit user acknowledgement.
```
