# v0.1.1 follow-ups

Items deferred from the v0.1.0 launch. None are blocking — the launch
artifacts (npm, GitHub Marketplace Action, Open VSX, landing page) are
all live and functional.

## 1. VS Code Marketplace listing

**Status**: deferred. The `.vsix` is already bundled in `pinnedai@0.1.0`
on npm — every `pinned init` auto-installs it for stock VS Code / Cursor
/ Windsurf / Codium. The Marketplace listing is purely additional
discoverability for users browsing `marketplace.visualstudio.com`
directly.

**Why deferred**: Microsoft's signup flow on the day of launch kept
hard-redirecting `dev.azure.com` to `portal.azure.com` (Azure cloud, not
DevOps). Multiple incognito sessions, fresh personal accounts, and the
direct DevOps URL all failed — the account got auto-tagged as "needs
Azure subscription" and Microsoft refused to release it.

**To retry (when you have patience)**:

1. **Fresh browser profile** — not incognito, a brand-new profile (Chrome
   has profile switcher in top-right; Safari has separate profile windows
   in newer versions). Clear of all Microsoft cookies.
2. **Brand-new outlook.com account** — must be one Microsoft has never
   seen, NOT linked to any Xbox / Skype / Hotmail / etc. history.
3. **Direct URL**: `https://azure.microsoft.com/en-us/products/devops/`
   → click "Start free with GitHub" or "Start free". This is the
   cleanest entry point that bypasses the Azure cloud upsell.
4. **At any "$200 free Azure credit" prompt**: navigate away
   immediately. Do not click anything on `portal.azure.com`. That's the
   wrong product.
5. **Azure DevOps org name**: `zon7` or whatever fits all your projects.
   Customer-invisible.
6. **PAT scopes**: "All accessible organizations" + Marketplace (Manage)
7. **Marketplace publisher**: `pinnedai` (must match
   `apps/vscode-extension/package.json` publisher field).
8. **Publish command** (once token is in hand):
   ```bash
   cd apps/vscode-extension
   export VSCE_PAT=<your-token>
   pnpm exec vsce publish --packagePath pinnedai-vscode-0.1.2.vsix
   ```

**Alternative path**: use the `HaaLeo/publish-vscode-extension` GitHub
Action — still requires a PAT but its README walks through the Azure
DevOps signup specifically for VS Code publishing.

## 2. Open VSX namespace verification approval

**Status**: pending Eclipse Foundation maintainer review. We filed the
claim issue at https://github.com/EclipseFdn/open-vsx.org/issues/10718
and the DNS TXT record at `_open-vsx.pinnedai.dev` is live. Typical
turnaround is 1-3 business days. When approved, the "verified
publisher" badge appears automatically on
https://open-vsx.org/extension/pinnedai/pinnedai-vscode — no action
needed.

## 3. Acceptance fixtures (task #17)

GPT's list of three acceptance fixtures (URL typo, missing export,
TS build). Non-blocking — would strengthen the proof page if we add
them as positive controls but launch ships without.

## 4. README badge in real customer repos

After landing-page traffic settles, encourage adopters to add the
README badge:

```markdown
[![Pinned protected](https://pinnedai.dev/badge.svg)](https://pinnedai.dev)
```

## 5. Founder Pro waitlist / Stripe

Defer until ≥5 active free-beta users + at least one concrete
paid-feature pull signal. Per the locked memos: no live Stripe link
at launch.
