// /proof — proof page. Spec: docs/proof-page-spec.md.
//
// Numbers come from the 2026-05-25 sweep across 11 of the operator's
// own dyad-apps repos. Real catch counts (parent=fail, fix=pass).
// All numbers cited here are MEASURED; placeholders marked "pending"
// will be replaced as new benchmarks land.

export function Proof(): JSX.Element {
  return (
    <div className="page">
      <main className="proof">
        <header className="proof-hero">
          <h1>Proof Pinned works</h1>
          <p className="lede">
            Pinned was tested against the failure modes AI coders actually
            create: weakened tests, deleted guards, missing
            auth/error-handling patterns, broken exports, and repeated
            mistakes across similar code paths. Pinned is local-first.
          </p>
        </header>

        <section className="proof-summary">
          <h2>Free Beta Proof — summary</h2>
          <ul className="proof-stats">
            <li>
              <strong>Install scan:</strong> 11/11 JS/TS repos produced
              at least 2 useful guards on first run. Average ~10 guards
              per repo.
            </li>
            <li>
              <strong>Guard integrity:</strong> 17/17 deliberate
              guard-bypass mutations (`.skip()`, weakened assertions,
              deleted files, disabled workflow) blocked in our
              mutation-test harness.
            </li>
            <li>
              <strong>AI lessons:</strong> 2–5 lessons generated per
              repo, tied to real guards with Past mistake / Rule /
              Plain English structure.
            </li>
            <li>
              <strong>Learned audit:</strong> Up to 20 sibling
              candidates surfaced on the larger repos
              (`pinned audit --learned`).
            </li>
            <li>
              <strong>Bug-fix replay:</strong> 186 deterministic
              real-catches across 11 repos / 684 fix-shaped commits.
              +46 additional catches via BYOK Claude Code passthrough
              (~50% lift). 9 of 11 repos produced at least one catch.
            </li>
          </ul>
        </section>

        <section className="proof-section">
          <h2>1. Install scan — useful guards on first run</h2>
          <p>
            When you install Pinned, it scans your repo for
            high-confidence things worth protecting: package exports,
            CLI entrypoints, secret exposure, config invariants,
            client API patterns, webhook handlers, and guard integrity.
          </p>
          <pre className="proof-block">{`◆ Pinned · BASELINE CREATED

Protecting your code (8 guards):
  ✓ no \`VITE_*\` env var leaks a secret to the client bundle
  ✓ Lockfile changes can't sneak past package.json bumps
  ✓ \`/api/admin\` requires login (AI can't strip the auth check)
  ✓ Client API in \`src/lib/api.ts\` keeps its Authorization header
  ✓ Route \`/dashboard\` stays registered in \`src/App.tsx\`
  ✓ Form in \`src/pages/Login.tsx\` keeps its submit-handler error handling
  ✓ Stripe webhook signature still verified in \`api/webhook.ts\`
  ✓ Fix preserved: \`/api/v2/agent\` stays in \`src/lib/retell.ts\`

Created 4 AI lessons:
  ✓ Do not expose server secrets with public env prefixes.
  ✓ Do not regenerate the lockfile without a real dep change.
  ✓ Do not weaken pinned tests to make CI pass.
  ✓ Do not break the CLI binary's --help command.`}</pre>
          <p>
            <em>Limitation:</em> not every repo exposes the same
            guardable surface. UI-heavy / static-content repos produce
            fewer pins (2–5 baseline); server-side or contract-shaped
            repos produce more (15–45).
          </p>
        </section>

        <section className="proof-section">
          <h2>2. Guard integrity — blocking AI test-bypass attempts</h2>
          <p>
            AI coding agents are often optimized around making tests
            pass. Pinned treats protected guards as part of the safety
            boundary. It blocks edits that delete, skip, weaken, or
            bypass guards. Defense is two-layered: a pre-commit hook
            blocks at the local git layer; the CI workflow blocks a
            second time even if the pre-commit was bypassed with
            <code>--no-verify</code>.
          </p>
          <pre className="proof-block">{`Blocked categories:
  · deleted pinned test
  · .skip() / xit() / describe.skip
  · weakened assertion (toBe(401) → toBeTruthy())
  · || true / ?? true / catch fallthrough
  · commented assertions
  · Pinned workflow disabled
  · guard registry tampered
  · AI lessons removed/weakened

Example: AI changed expect(status).toBe(401) → expect(status).toBeTruthy()
Pinned result: ⛔ BLOCK · assertion weakened`}</pre>
          <p>
            <strong>Result: 17 / 17 deliberate bypass attempts blocked
            in our mutation-test harness.</strong> This benchmark tests
            deliberate bypass attempts — it doesn't claim every AI
            agent in every repo will attempt these.
          </p>
        </section>

        <section className="proof-section">
          <h2>3. AI lessons — mistakes become repo memory</h2>
          <p>
            When Pinned learns a bug pattern, it writes a short
            repo-specific lesson to <code>.pinned/ai-lessons.md</code>.
            Agent files are opt-in; Pinned does not silently rewrite
            CLAUDE.md, Cursor rules, or Copilot instructions —
            <code>pinned ai-rules install</code> writes a clearly
            marked, removable block only.
          </p>
          <pre className="proof-block">{`## Auth headers in protected API calls

**Past mistake:**
\`getReport()\` failed because the Authorization header was missing.

**Rule:**
Do not remove \`authHeaders()\` from protected API client calls.

**Guard:** \`client-getReport-authHeaders\`

**Plain English:** Don't drop authHeaders() from protected API calls.`}</pre>
          <p>
            Across the benchmark repos Pinned generated 2–5 lessons per
            repo, each tied to a real guard. Lessons stay in the repo
            — Pinned is local-first by default.
          </p>
        </section>

        <section className="proof-section">
          <h2>4. Learned audits — checking sibling code paths</h2>
          <p>
            After Pinned learns a mistake pattern, it audits similar
            code paths for the same gap. Goal: find places where the
            same mistake may already exist or may be repeated later.
          </p>
          <pre className="proof-block">{`◆ Pinned · AUDIT

Checked similar code paths based on 4 lessons.
Found 20 places worth a look:

  Worth checking when you have time:
    · /api/billing  —  looks like a route file with no login check
    · /api/admin    —  looks like a route file with no login check
    · /api/contact  —  looks like a write route with no input validation
    ...

Open each file and decide:
  • Add the same protection — then re-run \`pinned init --auto\` to capture.
  • Mark as intentionally public — ignore.`}</pre>
          <p>
            High-confidence findings are shown by default. Medium-
            confidence is verbose-only. <em>Siblings are candidates
            unless validated by a guard, replay, or user confirmation.</em>
          </p>
        </section>

        <section className="proof-section">
          <h2>5. Bug-fix replay — fail before, pass after</h2>
          <p>
            Pinned can learn from real fixes. When a fix adds or
            corrects a guardable behavior, Pinned creates a regression
            guard and replays it against the parent commit and the
            fixed commit. <strong>Replay-verified means:</strong> parent
            commit fails the guard; fixed commit passes.
          </p>
          <p>
            <strong>Across 684 fix-shaped commits in 11 real repos:
            186 deterministic real-catches + 46 additional with BYOK
            Claude Code (~50% lift). 9 of 11 repos produced at least
            one catch.</strong>
          </p>
          <p>
            <em>Honest caveat:</em> bug-fix replay is one pin source,
            not the whole product. Pinned also creates guards from
            install scans, PR claims, live diffs, user-authored pins,
            and guard integrity rules. Some fixes are not guardable by
            static templates — UI state, visual rendering, business
            logic. Those need different tools.
          </p>
        </section>

        <section className="proof-section">
          <h2>What this does NOT prove</h2>
          <ul>
            <li>Pinned does not catch every bug.</li>
            <li>Pinned is not a generic code reviewer.</li>
            <li>Pinned is not a full SAST scanner.</li>
            <li>Pinned is not a visual regression tool.</li>
            <li>Some app-specific bugs require fixtures or runtime tests.</li>
            <li>
              AI lessons guide agents but guards enforce the rules —
              an agent can still ignore lessons; only the guards block
              its commits.
            </li>
          </ul>
          <p>
            <strong>
              Pinned is a safety layer for AI-coded repos, not a
              replacement for tests, review, or security scanning.
            </strong>
          </p>
        </section>

        <section className="proof-section">
          <h2>Try it locally</h2>
          <pre className="proof-block">{`npx pinnedai init       # creates baseline guards + AI lessons
npx pinnedai status     # see active guards + recent events
npx pinnedai audit --learned   # check similar code paths`}</pre>
          <p>
            <strong>Pinned runs locally. No account required for the free beta.</strong>
          </p>
          <p>
            <a href="/">← back to home</a>
          </p>
        </section>
      </main>
    </div>
  );
}
