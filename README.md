# pinnedai

> Pin PR description claims as permanent CI tests. Future regressions break CI with a back-reference to the original PR.

**Status: pre-MVP scaffold (week 0).** Building toward a 4-week MVP — see [`ROADMAP.md`](./ROADMAP.md).

- **npm**: `pinnedai` (binary: `pinned`)
- **Website**: [pinnedai.dev](https://pinnedai.dev)
- **GitHub**: [github.com/mzon7/pinnedai](https://github.com/mzon7/pinnedai)

---

## The pitch

AI coding agents (Cursor, Claude Code, Devin, Copilot Workspace) ship PRs that *claim* to do things — add auth, rate-limit a route, make a webhook idempotent — but reviewers don't have time to verify every claim against the actual diff.

**Pinned fixes that by pinning claims as permanent tests:**

1. Dev opens a PR with a claim in the description:
   *"Rate-limits `/api/users` to 60 req/min."*
2. Pinned parses the claim, generates a test file:
   ```ts
   // tests/pinned/pr-1247-rate-limit.test.ts
   // AUTO-GENERATED from PR #1247
   test("claim: /api/users is rate-limited to 60/min", async () => { ... });
   ```
3. Dev reviews + merges. The test joins the suite **permanently**.
4. Six months later, someone refactors the rate limiter and breaks it. CI fails with:
   *"This commit breaks claim made in PR #1247: 'Rate-limits /api/users to 60 req/min.'"*

**Tagline**: *Your PR description is the test. Forever.*

---

## Why this beats AI code-review bots

| | CodeRabbit / Greptile / Copilot Workspace | Pinned |
|---|---|---|
| **Value moment** | PR review, then gone | Every commit, forever |
| **What carries forward when you cancel** | Nothing | 1,000s of tests in your codebase |
| **Verifies arbitrary claims** | LLM judgment | Constrained templates (deterministic) |
| **Cost per PR at scale** | LLM calls + compute | Runs in your existing test suite |

---

## v1 claim templates (week 1-3 of MVP)

Each template is a parameterized test generator — the LLM fills in slots, never writes test logic. Keeps false-positive rate near zero.

| Template | Example claim | Generated test |
|---|---|---|
| `rate-limit:<route>:<rate>` | "Rate-limits /api/users to 60/min" | Fires N+5 requests, expects ≥1 returns 429 |
| `auth-required:<route>` | "Auth required on /api/admin/export" | Fires unauth'd request, expects 401/403 |
| `idempotent:<webhook>:<key>` | "Webhook /api/stripe is idempotent on event.id" | Fires same payload twice, expects no double-side-effect |

Expansion path (v0.2+): input validation, env-var-defined, no-sensitive-data-returned, schema-migration-reversible, retry-with-backoff, new-public-route-flagged.

---

## Install (when published)

```bash
npm install -g pinnedai
pinned --help
```

GitHub Action:

```yaml
# .github/workflows/pinned.yml
on: { pull_request: { types: [opened, synchronize, edited] } }
permissions: { pull-requests: write, contents: write }
jobs:
  pin:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: mzon7/pinnedai-action@v1
        with: { mode: comment }   # or 'commit' to push the test
```

---

## Local dev

```bash
git clone https://github.com/mzon7/pinnedai
cd pinnedai
pnpm install
pnpm --filter pinnedai dev -- check --description "Rate-limits /api/users to 60/min"
```

---

## Pricing (planned)

| Tier | Price | What |
|---|---|---|
| Free | $0 | 1 repo · up to 5 active claims · PR comment paste mode · public repos |
| Pro | $19/mo | Unlimited repos / claims · auto-commit mode · private repos · custom templates |
| Team | $199/mo | Org-wide policies · audit log · Slack alerts · CODEOWNERS routing |
| Enterprise | $20K+/yr | Self-hosted runner · SSO · SOC 2 CC8.1 change-management evidence export |

The Enterprise wedge: **every change has a runnable, signed audit-trail entry.** That's what SOC 2 / ISO 27001 want, except today it's a Notion doc. Here it's runnable.

---

## Apache 2.0
