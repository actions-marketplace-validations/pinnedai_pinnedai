# Pinned — launch headline (locked)

## Hero (homepage / README opening)

> **Pinned creates a local AI-coder safety net on install, writes
> repo-specific lessons, and blocks attempts to weaken protected guards.**

## Honest proof claim (with measured numbers from 2026-05-25 sweep)

> Tested on 11 real JS/TS repos with ~684 fix-shaped commits replayed.
> Pinned generated catches on **9 of 11 repos**. After filtering pin-explosion
> classes, **~91 deterministic catches** were verified (fail at parent commit,
> pass at fix commit). Claude Code passthrough mode (BYOK) adds **+46 catches
> on top** (~50% lift).
>
> Headline catch counts before FP-class filtering: **186 deterministic / 236 with LLM**.
>
> Guard Integrity: **17/17 deliberate guard-bypass mutations blocked** in our
> adversarial harness.

## What we explicitly DO NOT claim

- Pinned does not catch every bug.
- Pinned is not a generic code reviewer.
- Pinned is not a SAST scanner.
- Pinned is not a visual regression tool.
- Some app-specific bugs (state management, UI rendering, business logic) require
  fixtures or runtime tests Pinned doesn't provide.

## Repos where Pinned consistently catches (server / contract surface)

- quantasyte (130 det / 147 llm)
- back-in-play (32 / 34)
- sAles repI (~17 init pins; bug-fix mode produces strong catches)
- TradingAndArbIB (8 / 12)
- myhpifinal (5 det / 21 llm — LLM mode catches Retell URL fixes)

## Repos where Pinned does NOT catch (out-of-scope class)

- MediniDyad (0 / 0) — fixes are state management, scheduling logic, env routing,
  data correctness, query tuning, CSS animations. None map to Pinned's templates.
- researchAi (0 / 0) — UI heavy
- quantapact (0 det / 4 llm) — mostly version bumps + extension code + infra fixes;
  LLM finds a few patterns the regex misses

## Honest framing for the audience

> Pinned protects **AI-prone failure modes** in the patterns where AI agents
> commonly misbehave: removing auth, dropping validation, breaking idempotency,
> reverting URL fixes, deleting exports, weakening assertions. **It does not
> protect business logic, state management, or visual regressions** — those need
> different tools (E2E test runners, visual regression, code review).
