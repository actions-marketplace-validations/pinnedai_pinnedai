# pinnedai-mcp

Model Context Protocol (MCP) server for [Pinned](https://pinnedai.dev). Lets MCP-aware AI tools — Claude Desktop, Cursor, Cline, Continue — call Pinned natively, the same way they call file_read or bash.

The AI sees these tools and decides when to use them:

| Tool | When the AI calls it |
|---|---|
| `pinned_suggest_init` | Starting work on an unfamiliar repo — recommends `pinned init` if the codebase isn't yet protected. |
| `pinned_before_code_change` | Before editing code. Returns active guards, recent AI lessons learned in the repo, current safety notes — so the agent knows what protected behaviors must not regress. |
| `pinned_before_done_check` | Before saying a code change is complete. Runs the full Pinned review + Guard Integrity. Returns PASS / REVIEW / BLOCK in a `human_summary` the agent must include in its final response. |
| `pinned_scan_diff` | During code-change work; called internally by `pinned_before_done_check`. Surfaces unprotected risk surfaces in the current diff. |
| `pinned_list_guards` | When the user asks "what's protected here?" |
| `pinned_check_pr_description` | When the user shows a PR body or asks "what does this PR claim to do?" |

## Install

```bash
npm install -g pinnedai-mcp
# or use npx in your MCP config (recommended)
```

## Configure your AI tool

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on Windows/Linux:

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

Restart Claude Desktop. The Pinned tools appear in the tool drawer.

### Cursor

Cursor's MCP support lives under Settings → MCP. Add:

```
Name:    pinnedai
Command: npx -y pinnedai-mcp
```

### Cline (VS Code)

Cline reads `~/.cline/mcp_settings.json`:

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

### Continue

In Continue's config, under `mcpServers`:

```json
{
  "mcpServers": [
    {
      "name": "pinnedai",
      "transport": { "type": "stdio", "command": "npx", "args": ["-y", "pinnedai-mcp"] }
    }
  ]
}
```

## How it works

The server is stateless. Each tool shells out to the `pinned` CLI in the working directory and returns the output. All state stays in the customer's repo under `tests/pinned/` — no telemetry, no cloud calls, no API keys.

If `pinned` is in `node_modules/.bin/` (workspace install) the server uses that. Otherwise it falls back to `npx --no-install pinnedai`.

## License

Apache-2.0
