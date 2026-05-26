# Publishing Pinned

Run-book for v0.1 launch. Execute top-to-bottom; each step is independent so you can resume mid-way.

## Prerequisites

```bash
# npm — token expired in last attempt
npm login

# GitHub CLI — already authed as mzon7
gh auth status

# VS Code Marketplace token
#   1. Sign in at https://dev.azure.com/<your-org>
#   2. User settings → Personal Access Tokens → New Token
#   3. Scope: Marketplace (Manage)
#   4. Copy to env: export VSCE_PAT=...

# Open VSX token
#   1. Sign in at https://open-vsx.org with GitHub
#   2. Profile → Access Tokens → Generate
#   3. export OVSX_PAT=...
```

## 1. npm: `pinnedai@0.1.0` (the CLI)

```bash
cd apps/cli
pnpm run build           # rebuild to be safe — dist/cli.js must include latest changes
ls -lh dist/ vscode-extension.vsix   # confirm both present
npm publish              # publishes pinnedai@0.1.0 (bump from 0.0.1 placeholder)
```

Verify:

```bash
npx pinnedai --version   # should print 0.1.0
```

## 2. npm: `pinnedai-mcp@0.1.0` (the MCP server)

```bash
cd apps/mcp
pnpm run build
npm publish              # publishes pinnedai-mcp@0.1.0
```

Verify:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | npx -y pinnedai-mcp
# expect a JSON response with serverInfo.name = "pinnedai-mcp"
```

## 3. GitHub repo

```bash
# From the monorepo root
gh repo create mzon7/pinnedai --public --source=. --remote=origin --description "Permanent guardrails for AI-coded apps" --homepage "https://pinnedai.dev"
git push -u origin master
```

## 4. VS Code Marketplace

```bash
cd apps/vscode-extension
# Confirm vsix is current
ls -lh pinnedai-vscode-0.1.2.vsix
# Publish
pnpm exec vsce publish --packagePath pinnedai-vscode-0.1.2.vsix
# Verify
open "https://marketplace.visualstudio.com/items?itemName=pinnedai.pinnedai-vscode"
```

## 5. Open VSX (for Cursor / Windsurf / Codium users)

```bash
cd apps/vscode-extension
pnpm exec ovsx publish pinnedai-vscode-0.1.2.vsix
# Verify
open "https://open-vsx.org/extension/pinnedai/pinnedai-vscode"
```

## 6. Domain + landing page

```bash
# Register pinnedai.dev (Namecheap, Porkbun — whoever has it cheapest)
# Then in Vercel:
cd apps/landing
pnpm exec vercel              # follow prompts; link to pinnedai.dev
pnpm exec vercel --prod
```

DNS for the apex domain → Vercel's A record (`76.76.21.21`) + CNAME `www → cname.vercel-dns.com`.

## 7. GitHub Marketplace Action

The action manifest already lives at `action/action.yml`. To list on the Marketplace:

1. Push a release tag: `git tag v0.1.0 && git push origin v0.1.0`
2. On GitHub: Repo → Releases → Draft new release → tag v0.1.0
3. Check "Publish this Action to the GitHub Marketplace"
4. Pick category: "Continuous integration" + "Code quality"
5. Confirm

## 8. README badge

After landing page is live, add to your project README:

```markdown
[![Pinned protected](https://pinnedai.dev/badge.svg)](https://pinnedai.dev)
```

## Smoke test after publish

```bash
# In a fresh tempdir:
mkdir /tmp/pinned-smoke && cd /tmp/pinned-smoke
git init -q && echo '{}' > package.json && git add . && git commit -m init --quiet
npx -y pinnedai@latest init --auto
ls -la tests/pinned/
npx pinnedai check-guard-removal && echo "✓ Guard Integrity green"
```

## Rollback / unpublish

npm only allows unpublish within 72 hours.

```bash
npm unpublish pinnedai@0.1.0 --force
npm unpublish pinnedai-mcp@0.1.0 --force
```

VS Code Marketplace + Open VSX both have unlist (not delete) options in their respective publisher dashboards.

## Founder Pro / Stripe — DEFERRED to v0.1.1

Do NOT set up Stripe before launch. The marketing page should show "Founder Pro — waitlist open" with an email-capture form, not a live payment link. Stripe payment links go live only after:

1. Free beta has ≥5 active users
2. At least one paid-feature concrete need has surfaced (BYOK exhaustion, custom-template request)
3. Payment link reviewed: `$9.99/mo` price ID locked, founder rate documented in product config
