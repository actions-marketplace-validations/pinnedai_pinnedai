# PinnedAI — /proof page spec

> Source: GPT spec (2026-05-25). Goal: public proof page that convinces devs
> Pinned works on real AI-coder failure modes without overclaiming.
> Updates the earlier draft per [[pinned-proof-page-launch-deliverable]] memory.

## Core public framing

**"Pinned protects AI-coded repos by turning known failure patterns into guards, lessons, and audits."**

## Hero

- **Title:** "Proof Pinned works"
- **Subtitle option A:** "We tested Pinned against the failure modes AI coders actually create: weakened tests, deleted guards, missing auth/error-handling patterns, broken exports, and repeated mistakes across similar code paths."
- **Subtitle option B:** "Pinned is local-first. These tests measure whether it creates useful guards, blocks guard-bypass attempts, and finds sibling risks in real JS/TS repos."

## Page structure

### 1. Top summary card

```
Pinned Free Beta Proof

✓ Install scan
X/Y JS/TS repos produced useful guards on first run.

✓ Guard integrity
X/Y deliberate guard-bypass attempts blocked.

✓ AI lessons
X repo-specific lessons generated from real guards/fixes.

✓ Learned audit
X sibling code paths checked; Y useful candidates surfaced.

✓ Bug-fix replay
X replay-verified guards failed before the fix and passed after.
```

**Rule:** real numbers only. If not measured: show "pending" or omit.

### 2. Section: Install scan

**Heading:** "1. Install scan: useful guards on first run"

**Copy:** "When you install Pinned, it scans the current repo for high-confidence things worth protecting: package exports, CLI entrypoints, secret exposure, config invariants, client API patterns, and guard integrity."

**Example output:**
```
◆ Pinned · BASELINE CREATED

Created 8 guards:
✓ package exports stay stable
✓ CLI command must keep working
✓ no public secrets
✓ client API auth headers preserved
✓ contact form keeps non-OK error handling
✓ pinned workflow protected
✓ guard weakening blocked
✓ AI lessons protected

Created 3 AI lessons:
✓ Do not remove authHeaders() from protected API calls
✓ Do not weaken pinned tests to make CI pass
✓ Do not expose NEXT_PUBLIC_* secrets
```

**Results format:** "Tested on X real JS/TS repos. Y produced at least 3 useful guards on install."

**Limitation:** "Not every repo exposes the same guardable surface. Small/static repos may produce fewer guards."

### 3. Section: Guard Integrity Benchmark (strongest section)

**Heading:** "2. Guard integrity: blocking AI test-bypass attempts"

**Copy:** "AI coding agents are often optimized around making tests pass. Pinned treats protected guards as part of the safety boundary. It blocks edits that delete, skip, weaken, or bypass those guards."

**Blocked categories:**
- deleted pinned test
- `.skip()` / `xit()` / `describe.skip`
- weakened assertion
- exact status assertion changed to truthy assertion
- `|| true` / `?? true` / catch fallthrough
- commented assertion
- Pinned workflow disabled
- guard registry tampered
- AI lessons removed/weakened

**Results format:** "We seeded X deliberate guard-bypass attempts. Pinned blocked Y/X."

**Example card:**
```
Blocked assertion weakening

Before:
expect(status).toBe(401)

AI changed:
expect(status).toBeTruthy()

Pinned result:
⛔ BLOCK · assertion weakened
```

**Note:** "This benchmark tests deliberate bypass attempts. It does not claim every AI agent will attempt these in every repo."

### 4. Section: AI Lessons

**Heading:** "3. AI lessons: mistakes become repo memory"

**Copy:** "When Pinned learns a bug pattern, it writes a short repo-specific lesson to `.pinned/ai-lessons.md`. Agent files are opt-in; Pinned does not silently rewrite `CLAUDE.md`, Cursor rules, or Copilot instructions."

**Example:**
```
## Auth headers in protected API calls

Past mistake:
`getReport()` failed because the Authorization header was missing.

Rule:
Do not remove `authHeaders()` from protected API client calls unless the endpoint is explicitly public.

Guard:
`client-getReport-authHeaders`
```

**Results format:** "Across the benchmark repos, Pinned generated X lessons tied to guards."

**Privacy note:** "Lessons stay in the repo. Pinned is local-first by default."

### 5. Section: Learned-pattern audit (sibling pins)

**Heading:** "4. Learned audits: checking sibling code paths"

**Copy:** "After Pinned learns a mistake pattern, it can audit similar code paths. The goal is to find places where the same mistake may exist or may be repeated later."

**Example:**
```
Learned from:
`getReport()` was missing `authHeaders()`.

Audit result:
✓ `updateAccount()` includes authHeaders()
⚠ `exportReport()` may call a protected endpoint without authHeaders()
⚠ `getBillingUsage()` may need the same guard
```

**Results format:** "Pinned checked X sibling candidates and surfaced Y useful candidates."

**Confidence framing:** "High-confidence findings are shown by default. Medium-confidence findings can be reviewed manually. Low-confidence findings stay hidden unless verbose mode is enabled."

**Limitation:** "Siblings are candidates unless validated by a guard, replay, or user confirmation."

### 6. Section: Bug-fix replay (be honest)

**Heading:** "5. Bug-fix replay: fail before, pass after"

**Copy:** "Pinned can learn from real fixes. When a fix adds or corrects a guardable behavior, Pinned creates a regression guard and replays it against the parent commit and the fixed commit."

**Definition:** "Replay-verified means:
- parent commit: guard fails
- fixed commit: guard passes"

**Example:**
```
Fix added auth headers to a protected API client call.

Result:
✓ Parent commit failed
✓ Fixed commit passed
✓ Guard created: client API call must include authHeaders()
```

**Important honesty:** "Bug-fix replay is one pin source, not the whole product. Some fixes are not guardable by static templates, especially complex UI state bugs or app-specific behavior requiring fixtures."

**Results format:** "Across X sampled fix commits, Pinned generated Y replay-verified guards."

**Limitation:** "Bug-fix-derived catching is still improving. Pinned also creates guards from install scans, PR claims, live diffs, user-authored pins, and guard integrity rules."

### 7. Section: What Pinned does NOT claim (trust-builder)

**Heading:** "What this does not prove"

**Bullets:**
- Pinned does not catch every bug.
- Pinned is not a generic code reviewer.
- Pinned is not a full SAST scanner.
- Pinned is not a visual regression tool.
- Some app-specific bugs require fixtures or runtime tests.
- AI lessons guide agents, but guards enforce the rules.
- LLM-assisted mode proposes guards; deterministic checks enforce them.

**Close:** "Pinned is a safety layer for AI-coded repos, not a replacement for tests, review, or security scanning."

### 8. Section: Methodology (collapsible / lower)

**Heading:** "How we tested"

**Subsections:**

**A. Repos** — real JS/TS repos, count, don't expose private names unless authorized.

**B. Install scan test** — run `pinned init --auto`, count useful guards, human-reviewed.

**C. Guard integrity benchmark** — seed deliberate bypass attempts, count blocked.

**D. Learned audit** — generate lessons/guards, run audit, manually review siblings.

**E. Bug-fix replay** — sample fix commits, generate guard, run parent + fixed, count replay-verified.

**F. Scoring definitions:** useful guard, useful candidate, false positive, replay-verified, no-signal, not applicable.

### 9. CTA

**End with:** "Try it locally"

```bash
npx pinned init --auto
npx pinned guard
npx pinned audit --learned
```

**CTA copy:** "Pinned runs locally. No account required for the free beta."

**Secondary:** "Read the methodology" · "Join Founder Pro waitlist"

## Tone & design

- Confident but honest
- No hype / no "AI magic"
- Developer-native
- Terminal examples over marketing fluff
- Result cards, terminal snippets, before/after diff cards
- Small methodology notes + limitations box
- NEVER show internal checklist language ("Question: Does Pinned block...")
- Use public proof framing: "Pinned was tested against X. It blocked Y/Z."

## README teaser (links to /proof)

```markdown
## Proof it works

Pinned was tested against:
- install-time guard creation on real JS/TS repos
- deliberate guard-bypass attempts like `.skip()`, deleted guards, and weakened assertions
- learned-pattern audits across sibling code paths
- replay-verified bug-fix guards

See full proof: https://pinnedai.dev/proof
```

## Hard rules

- Real numbers only. Pending or omit if not measured.
- Don't overclaim broad bug-catching.
- Don't imply AI lessons guarantee every AI obeys.
- Always tie memory/lessons back to guards: **"Lessons guide the AI. Guards enforce the lesson."**
