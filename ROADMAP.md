# pinnedai — 4-week MVP roadmap

Started **2026-05-18**. Target: working npm package + GitHub Action + landing page + 3 design partners signed up by **2026-06-15**.

- **npm**: `pinnedai` (binary: `pinned`)
- **Website**: `pinnedai.dev` (to register)
- **Repo**: `github.com/mzon7/pinnedai`

---

## Week 0 — scaffold (TODAY)

- [x] Folder structure, pnpm workspace, TypeScript config
- [x] CLI shell: `pinned check`, `pinned generate`, `pinned retire` commands stubbed
- [x] GitHub Action manifest (composite action wrapping `npx pinnedai`)
- [x] CI workflow on the repo itself
- [x] README + ROADMAP
- [x] `pnpm install && pnpm build` runs clean
- [ ] First commit + push to `mzon7/pinnedai`
- [ ] Register `pinnedai.dev` domain
- [ ] Reserve `pinnedai` on npm (zero-content publish so a squatter can't grab it before week-4 publish)

## Week 1 — Foundation + Template 1 (rate-limit)

- [ ] Claim parser: regex + LLM fallback. Returns structured `{template, route, rate}`.
- [ ] Test generator for `rate-limit:<route>:<rate>`. Emits a Vitest test file.
- [ ] Local end-to-end: `pinned generate pr-1247` writes a test file, vitest runs it against a localhost rate-limited server.
- [ ] Configurable `PREVIEW_URL` env var for behavioral tests.

## Week 2 — GitHub Action + PR comment + paste mode

- [ ] Action triggers on `pull_request: [opened, synchronize, edited]`.
- [ ] Parses PR description from event payload.
- [ ] Generates test file as a string + posts in a PR comment.
- [ ] Multi-claim support (one PR description → multiple test files).
- [ ] Friendly "no claims found" path with examples.

## Week 3 — Templates 2 + 3 + retire flow

- [ ] Template 2: `auth-required:<route>`. Single request, expects 401/403.
- [ ] Template 3: `idempotent:<webhook>:<id-field>`. Fires same payload twice.
- [ ] `pinned retire <claim-id> --reason="..."` — moves test to `tests/pinned/retired/`.
- [ ] First end-to-end demo on a real repo: open PR with claim, action comments, paste the test, merge, watch CI prove the claim. Then INTENTIONALLY break the claim in a follow-up commit and watch CI fail.

## Week 4 — Polish + landing + design partners

- [ ] Auto-commit mode (Pro feature): action pushes the generated test directly to the PR branch.
- [ ] Landing page on `pinnedai.dev`: single page, tagline + demo GIF + install command + 4-tier price card.
- [ ] `npm publish pinnedai@0.1.0`
- [ ] GitHub Marketplace submission for the action (`pinnedai-action`)
- [ ] Record demo GIF (open PR → comment posts → break claim → CI fails)
- [ ] Outreach to 20 names from your X/Twitter network who post about Cursor / Claude Code / Devin
- [ ] Goal: 3 design partners signed up

---

## Post-MVP (v0.2+) — expansion paths in priority order

1. **More claim templates**: input-validation, env-var-defined, no-sensitive-data-returned, new-public-route, schema-migration-reversible
2. **LLM diff-to-claim inference**: when PR description is garbage, infer claims FROM the diff (the "Inferred" framing — best v0.2 feature add)
3. **Custom claim templates**: customers define their own template patterns
4. **Org policies**: "every PR must pin ≥1 claim" (Team tier feature)
5. **Slack alerts** on claim breaks in main (Team tier)
6. **Multi-language**: today Vitest/Node only. Add Python/pytest, Go/test, Ruby/rspec.
7. **Self-hosted runner** (Enterprise tier)
8. **SOC 2 / ISO 27001 audit-trail export** — every claim becomes a signed change-management evidence entry

---

## Honest risks tracker

| Risk | Mitigation |
|---|---|
| LLM hallucinates wrong claim → wrong test → user loses trust | Constrained template generation — LLM only fills slots, never writes test logic. Only ship templates where the pattern is deterministic. |
| Behavioral tests need a running app | v1 requires `PREVIEW_URL` env var. Most Vercel/Netlify users already have this. v0.2 adds "spin up local server in CI" mode. |
| Auto-generated tests in customer repos feel intrusive | Default mode is "paste-in-comment", not auto-commit. Auto-commit is opt-in (Pro feature). |
| CodeRabbit / Greptile ships the same feature | Persistence is the moat. Generating *tests in the codebase* is architecturally different from posting review comments. Their codebase doesn't easily pivot. |
| Customer has no preview deploy | v0.2 adds "unit test mode" — generated tests use mocks instead of HTTP calls. Weaker evidence but works without preview deploys. |
