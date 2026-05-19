# pinnedai — handoff for future Claude sessions

> **READ THIS FIRST** if you're a Claude session picking up this project for the first time. It contains the positioning, the scope rules, the file map, the next concrete tasks, and the rejected alternatives so you don't waste the user's time rehashing decisions.

---

## What this project is

**pinnedai** — a developer tool that turns PR description claims into permanent CI tests.

**npm name**: `pinnedai` (binary: `pinned`)
**Website**: `pinnedai.dev` (not yet registered)
**GitHub**: `github.com/mzon7/pinnedai` (not yet pushed)
**Project dir**: `/Users/michaelzon/dyad-apps/pinnedai/`

**Tagline**: *"Your PR description is the test. Forever."*

### The product wedge

AI coding agents (Cursor, Claude Code, Devin, Copilot Workspace) ship PRs that *claim* to do things — "adds auth", "rate-limits this route", "makes webhook idempotent" — but reviewers don't have time to verify every claim against the actual diff. **Pinned generates a test file per claim and joins the user's test suite permanently.** Future commits that break the claim fail CI with a back-reference to the original PR.

### Demo flow (the thing that sells)

1. Dev opens PR with description: *"Rate-limits `/api/users` to 60 req/min."*
2. Pinned parses the claim → generates `tests/pinned/pr-1247-rate-limit.test.ts`
3. PR comment shows the generated test for review
4. Dev merges → test joins the suite **permanently**
5. Six months later, dev #4 refactors and accidentally breaks the rate limiter → **CI fails** with: *"This commit breaks claim made in PR #1247."*

### Why this beats CodeRabbit / Greptile / Copilot Workspace

| | Code-review bots | Pinned |
|---|---|---|
| Value moment | PR open, then gone | Every commit, forever |
| What carries forward when you cancel | Nothing | 1000s of tests in your codebase |
| Verification mechanism | LLM judgment | Constrained templates (deterministic) |
| Cost per PR at scale | LLM calls + compute | Runs in your existing test suite |

**The moat is persistence.** That's not a feature, it's the architectural choice. Generating *tests in the customer's codebase* is structurally different from posting review comments. CodeRabbit can't pivot to this without redesigning their product.

---

## Locked decisions (do not re-debate)

These were settled after a long iteration. If the user asks "should we rename / repivot / add a SaaS dashboard / etc.", remind them of the rationale here before agreeing.

### Naming
- **Project + npm name**: `pinnedai`. Picked over `claimlock`, `sigil`, `proofci`, `claimkit`, `etchd`, `vowly`, `pinned-ci`, `MergeProof`, `ChangeProof`, `Inferred`, `AI Change Verifier`, `AI Commit Reviewer`.
- **Binary name**: `pinned` (shorter, the verb).
- Reasoning: `.ai` TLD signal for the AI-coding audience + the metaphor IS the product (pin a claim to CI) + every cleaner alternative is already taken on npm. `sigil` was the runner-up brand pick but the npm name was reserved (unpublished 2013) and every reasonable domain was registered.

### Idea framing
The iteration went: Migration Guard → AI Change Verifier → Pinned (claims-as-tests) → MergeProof (preview deploy diff) → Inferred (LLM diff-to-claim) → settled on **Pinned**. The user explicitly closed the iteration with: "every time i ask ill get a new idea/answer, so how do I know what the best one is". The answer: stop polling LLMs, ship the simplest viable wedge, let real users select the next pivot. **Don't reopen the idea debate.**

### Architecture pillars (the three things that must hold)

1. **Constrained generation only.** The LLM never writes test logic. It only fills slots in deterministic templates (route name, rate, threshold). This keeps false-positive rate near zero. If you find yourself wanting the LLM to write a test from scratch, that's scope creep — push back.
2. **Tests live in the customer's repo.** Not on our cloud. Cancelling Pinned means losing nothing — the tests stay. That's the moat working.
3. **Default to paste-mode, not auto-commit.** Customers review the generated test before it lands in their repo. Auto-commit is a Pro-tier upgrade, NOT the default.

### What we are NOT

- **Not a code-review bot** (CodeRabbit, Greptile, Copilot Workspace own that)
- **Not a runtime smoke tester** (Chromatic, Percy, Argos own that)
- **Not a dependency scanner** (Socket, Snyk own that)
- **Not a secrets scanner** (Gitleaks, GitHub native own that)
- **Not a SaaS dashboard** (until proven; Free + Pro should be 100% GitHub-Action-based)

Pinned does exactly one thing: **transforms PR claims into runnable, persistent CI artifacts.** Everything else is out of scope until the wedge is proven.

---

## Tier model (planned)

| Tier | Price | What |
|---|---|---|
| Free | $0 | 1 repo · up to 5 active claims · PR comment paste mode · public repos |
| Pro | $19/mo | Unlimited repos / claims · auto-commit mode · private repos · custom templates |
| Team | $199/mo | Org-wide policies · audit log · Slack alerts · CODEOWNERS routing |
| Enterprise | $20K+/yr | Self-hosted runner · SSO · SOC 2 CC8.1 change-management evidence export |

**The Enterprise wedge**: every change has a runnable, signed audit-trail entry. That's what SOC 2 / ISO 27001 / FedRAMP want, except today it's a Notion doc. With Pinned, the audit trail is *runnable*. This ties into the user's other project (Quantasyte) which has compliance content — there's a cross-sell story long-term.

---

## Current state (week 0 — TODAY)

What's done:
- ✅ Folder + pnpm workspace + TypeScript config
- ✅ CLI shell at `apps/cli/src/cli.ts`: `pinned check`, `pinned generate`, `pinned retire` commands stubbed (each prints a friendly "not implemented yet, see ROADMAP")
- ✅ GitHub Action manifest at `action/action.yml` (composite action wrapping `npx pinnedai`)
- ✅ Self-CI workflow at `.github/workflows/ci.yml`
- ✅ README + ROADMAP + this CLAUDE.md
- ✅ `pnpm install && pnpm build` works clean
- ✅ Smoke test: `node apps/cli/dist/cli.js check --description "Rate-limits /api/users to 60 req/min."` runs and prints expected output

What's STUBBED (next concrete tasks):
- ⏳ Claim parser — currently the CLI just counts characters of the PR body
- ⏳ Test generator for `rate-limit` — currently `pinned generate` exits with code 2
- ⏳ Test generator for `auth-required` — same
- ⏳ Test generator for `idempotent` — same
- ⏳ Retire flow — currently `pinned retire` exits with code 2

---

## Architecture (current)

```
/Users/michaelzon/dyad-apps/pinnedai/
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml             # workspaces: apps/*
├── tsconfig.json                   # shared TS config
├── LICENSE                         # Apache 2.0
├── README.md                       # public-facing pitch + install + tier table
├── ROADMAP.md                      # week 0 → week 4 task list
├── CLAUDE.md                       # THIS FILE — handoff to future Claudes
├── .gitignore
├── .github/
│   └── workflows/
│       └── ci.yml                  # self-CI: typecheck + build on PR
├── action/
│   └── action.yml                  # GitHub Action wrapping `npx pinnedai`
└── apps/
    └── cli/
        ├── package.json            # name: "pinnedai", bin: "pinned"
        ├── tsconfig.json
        └── src/
            ├── cli.ts              # Command shell — DONE (stubbed)
            ├── claimParser.ts      # NEXT (week 1)
            └── templates/
                ├── rateLimit.ts    # NEXT (week 1)
                ├── authRequired.ts # week 3
                └── idempotent.ts   # week 3
```

---

## The 4-week MVP roadmap (see ROADMAP.md for the full version)

### Week 1 — Foundation + Template 1 (rate-limit)
- Claim parser: regex + LLM fallback. Returns `{template: "rate-limit", route, rate}`.
- Test generator for `rate-limit:<route>:<rate>`. Emits a Vitest test file.
- Local end-to-end: `pinned generate pr-1247` writes test file, vitest runs it against a localhost rate-limited server.

### Week 2 — GitHub Action + PR comment + paste mode
- Action triggers on `pull_request: [opened, synchronize, edited]`.
- Generates test file as a string + posts in a PR comment ("paste-in-comment" mode).
- Multi-claim support.

### Week 3 — Templates 2 + 3 + retire flow
- `auth-required:<route>` template
- `idempotent:<webhook>:<id-field>` template
- `pinned retire <claim-id> --reason="..."` — moves test to `tests/pinned/retired/`
- First end-to-end demo on a real repo

### Week 4 — Polish + landing + design partners
- Auto-commit mode (Pro)
- Landing page at `pinnedai.dev`
- `npm publish pinnedai@0.1.0`
- GitHub Marketplace submission
- Outreach to 20 Cursor / Claude Code / Devin power-users → 3 design partners signed up

---

## How to run

```bash
cd /Users/michaelzon/dyad-apps/pinnedai
pnpm install            # one-time
pnpm build              # builds apps/cli/dist/cli.js
pnpm dev                # runs `tsx apps/cli/src/cli.ts` via the workspace alias

# Smoke test
node apps/cli/dist/cli.js --version
node apps/cli/dist/cli.js check --description "Rate-limits /api/users to 60 req/min."

# Direct workspace invocation
pnpm --filter pinnedai dev -- check --description "Auth required on /api/admin/export"
```

---

## Stack + dependencies

- **Node 20+** (`engines.node` in apps/cli/package.json)
- **TypeScript 5.6**
- **pnpm 9** (matches user's other projects)
- **commander 12** for CLI (matches Quantasyte's CLI pattern)
- **tsup** for ESM bundling
- **vitest** (target test framework for generated tests; not yet installed)

When adding the claim parser:
- For regex-first matching: pure JS, no dep
- For LLM fallback: `openai` SDK (gpt-4o-mini). Set `OPENAI_API_KEY` env var. Only call when regex fails.

---

## Distribution strategy

Mirrors the Quantasyte CLI approach (user's other project, same patterns):

1. **npm**: publish `pinnedai` unscoped (the scoped form is overkill for the first product).
2. **GitHub Marketplace**: separate repo `mzon7/pinnedai-action` so the action versioning is independent of the CLI.
3. **Landing page**: `pinnedai.dev` (domain to register). Single-page Vite + React. Tagline, demo GIF, install command, 4-tier price card. Pattern matches `quantasyte.com`.
4. **Launch posts**: Show HN, r/devsecops, r/javascript, dev.to. The demo GIF (open PR → comment → break claim → CI fails) IS the marketing.

---

## What the user has flagged

- **Verify before committing decisions**: the user has explicitly said they're done with idea-shopping. If they ask for a name change or pivot, push back once with the rationale here, then defer to them.
- **Ship-fast bias**: prefer the cheap, shippable path over the architecturally pure one. Hard cutoff at week 4 for v0.1.0 on npm.
- **Time-to-validation > idea quality**: real-user feedback in 4 weeks beats another month of LLM iteration.

---

## Related projects (for cross-reference)

- **Quantasyte** (`/Users/michaelzon/dyad-apps/quantasyte/`) — user's main project. Post-quantum security scanner. Pinned shares the OSS-CLI-on-npm distribution pattern + the GitHub-Action wrapper architecture. Code patterns to reuse: `apps/cli/src/cli.ts` shape, `apps/cli/scripts/publish.mjs` dual-publish pattern. **Don't pull Quantasyte source directly — pinnedai is independent. But the patterns are battle-tested.**
- The user runs both projects solo with AI tooling. Operating cost target: ~$0/month for pinnedai during MVP (no API server needed; the action runs in customer CI).

---

## Outstanding TODOs (not yet started, in rough priority)

1. Reserve `pinnedai` on npm (zero-content publish — `npm publish` with a placeholder version so a squatter can't grab the name before week-4 v0.1.0 ships).
2. Register `pinnedai.dev` domain.
3. Create GitHub repo `mzon7/pinnedai`, push initial scaffold.
4. Build the claim parser (week 1 day 1-3 task).
5. Build the rate-limit test generator (week 1 day 4-7 task).

---

## Honest risks (from ROADMAP.md, copied here for visibility)

| Risk | Mitigation |
|---|---|
| LLM hallucinates wrong claim → wrong test → user loses trust | Constrained template generation. LLM only fills slots. Only ship templates where the pattern is deterministic. |
| Behavioral tests need a running app | v1 requires `PREVIEW_URL` env var. v0.2 adds local-server mode. |
| Auto-generated tests in repos feel intrusive | Default is paste-in-comment, not auto-commit. Auto-commit is opt-in (Pro). |
| CodeRabbit / Greptile ships the same feature | Persistence is the moat. Generating *tests in the codebase* is architecturally different. They can't pivot easily. |
| Customer has no preview deploy | v0.2 adds unit-test mode with mocks. Weaker evidence but works. |

---

## Quick contact / context for the user

- **Founder**: Michael Zon (michaelzon7@gmail.com — verified working inbox)
- **Other project**: Quantasyte (compliance scanner, also pre-revenue, also AI-assisted solo build)
- **Tool stack the user is fluent in**: TypeScript, pnpm, Vite, React, Fastify, Supabase, Fly.io, Vercel, GitHub Actions
- **Style preference**: terse responses, no padding, no "let me know if I can help" trailing lines. Surface specific paths + line numbers when referencing code.

---

**If you're picking this up fresh: start by running `pnpm install && pnpm build`, then read ROADMAP.md, then start week 1 task 1 (claim parser).** Don't re-debate the name, the wedge, or the moat unless the user explicitly asks.
