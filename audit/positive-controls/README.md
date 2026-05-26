# Pinned positive controls

Deterministic bug→fix fixtures that prove the Pinned pipeline produces a `real-catch` verdict (pin fails at the buggy parent commit, passes at the fix commit). Each fixture is built into a temp git repo at runtime by `scripts/run-positive-controls.sh`.

**Launch gate** (per `[[fifteen-positive-controls-launch-spec]]`): ≥80% of variations must pass per category. Below threshold → do not announce launch.

**Layout:**

```
audit/positive-controls/
├── README.md                         (this file)
├── <NN-category-name>/
│   ├── <variation-name>/             (one per detector idiom)
│   │   ├── README.md                 describes the bug + fix
│   │   ├── parent/                   files at the buggy commit
│   │   ├── fixed/                    files at the fix commit
│   │   └── expected.json             expected backtest verdict
```

**`expected.json` shape:**

```json
{
  "realCatches": 1,
  "byTemplate": { "auth-required": 1 },
  "minClassification": "real-catch"
}
```

**Categories** (from [[fifteen-positive-controls-launch-spec]]):

1. admin-route-requires-auth
2. normal-user-cannot-admin
3. deleted-user-cannot-login
4. user-a-cannot-access-user-b
5. account-id-filter-cannot-be-removed
6. free-user-cannot-exceed-cap
7. downgraded-user-no-paid-webhook
8. paid-only-setting-not-enableable-by-free
9. webhook-idempotent-by-event-id
10. alert-webhook-idempotent
11. quota-no-concurrent-bypass
12. rate-limiter-blocks-burst
13. duplicate-returns-duplicate-reason
14. soft-delete-preserves-audit
15. guard-removal-blocked (meta — tests `pinned check-guard-removal`)

**Running:**

```bash
scripts/run-positive-controls.sh
# or specific fixture(s):
scripts/run-positive-controls.sh 01-admin-route-requires-auth
```

The runner produces a scorecard at `audit/positive-controls/_results.json` consumable by the proof-page builder (per `[[pinned-proof-page-launch-deliverable]]`).
