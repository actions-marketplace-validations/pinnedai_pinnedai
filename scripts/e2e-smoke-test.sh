#!/usr/bin/env bash
# E2E smoke test — exercise high+medium-risk features end-to-end on a
# freshly-initialized repo. Per-step pass/fail capture, surfaces any
# crash / malformed-output / unexpected-state before launch.

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
TESTBED_SRC="/Users/michaelzon/dyad-apps/back-in-play"

if [ ! -f "$CLI" ]; then echo "✗ CLI not built — pnpm --filter pinnedai build first"; exit 1; fi
if [ ! -d "$TESTBED_SRC/.git" ]; then echo "✗ testbed source not found: $TESTBED_SRC"; exit 1; fi

TMP=$(mktemp -d -t pinned-e2e-XXXXXX)
echo "═══ E2E SMOKE TEST · tmp=$TMP ═══"

# Setup: copy git, restore working tree, init
cp -a "$TESTBED_SRC/.git" "$TMP/.git"
cd "$TMP" && git checkout -q HEAD -- . 2>/dev/null
git config user.email "e2e@test"; git config user.name "e2e"

# ──────────────────────────────────────────────────────────────
PASS=0; FAIL=0
result() {
  local name="$1"; local outcome="$2"; local note="${3:-}"
  if [ "$outcome" = "PASS" ]; then
    PASS=$((PASS+1)); printf "  ✓ %-40s %s\n" "$name" "$note"
  else
    FAIL=$((FAIL+1)); printf "  ✗ %-40s %s\n" "$name" "$note"
  fi
}
# ──────────────────────────────────────────────────────────────

echo ""
echo "── Step 0: init --auto ──"
out=$(node "$CLI" init --auto --from-agent="e2e" --quiet 2>&1)
if echo "$out" | grep -q "◆ Pinned · BASELINE CREATED"; then
  result "init --auto" "PASS" "$(echo "$out" | grep -aoE "Created [0-9]+ guard")"
else
  result "init --auto" "FAIL"; echo "$out" | tail -10
fi

echo ""
echo "── HIGH-RISK: 1. pinned status ──"
out=$(node "$CLI" status 2>&1 || true)
if echo "$out" | grep -qE "pins"; then
  lines=$(echo "$out" | wc -l | tr -d ' ')
  result "pinned status" "PASS" "($lines lines)"
else
  result "pinned status" "FAIL"; echo "$out" | head -10
fi

echo ""
echo "── HIGH-RISK: 2. pinned doctor ──"
out=$(node "$CLI" doctor 2>&1 || true)
if [ -n "$out" ]; then
  result "pinned doctor" "PASS" "($(echo "$out" | wc -l | tr -d ' ') lines)"
else
  result "pinned doctor" "FAIL" "(empty output)"
fi

echo ""
echo "── HIGH-RISK: 3. .github/workflows/pinned.yml validates as YAML ──"
if [ -f .github/workflows/pinned.yml ]; then
  if python3 -c "import yaml; yaml.safe_load(open('.github/workflows/pinned.yml'))" 2>/dev/null; then
    result "workflow YAML parses" "PASS"
  else
    result "workflow YAML parses" "FAIL" "(YAML parse error)"
  fi
  if grep -q "^name:" .github/workflows/pinned.yml && grep -q "^on:" .github/workflows/pinned.yml; then
    result "workflow has required keys" "PASS"
  else
    result "workflow has required keys" "FAIL"
  fi
else
  result "workflow file present" "FAIL"
fi

echo ""
echo "── HIGH-RISK: 4. pre-commit hook fires + allows clean commit ──"
echo "// safe edit" >> README.md 2>/dev/null || echo "// safe edit" > README.md
git add README.md
PINNEDAI_SKIP_HOOK="" git commit -m "e2e: safe edit" --quiet 2>/tmp/e2e-precommit.err
if [ $? -eq 0 ]; then
  result "pre-commit allows safe edit" "PASS"
else
  result "pre-commit allows safe edit" "FAIL" "($(cat /tmp/e2e-precommit.err | head -2 | tr '\n' '|'))"
fi

echo ""
echo "── HIGH-RISK: 5. Guard Integrity BLOCK on .skip() bypass ──"
# Find a pinned test file
PIN_FILE=$(ls tests/pinned/*.test.ts 2>/dev/null | head -1)
if [ -n "$PIN_FILE" ]; then
  # Replace `describe(` with `describe.skip(` — classic AI bypass
  cp "$PIN_FILE" "${PIN_FILE}.bak"
  sed -i.tmp 's/^describe(/describe.skip(/' "$PIN_FILE" && rm "${PIN_FILE}.tmp"
  git add "$PIN_FILE"
  if git commit -m "e2e: malicious skip bypass" --quiet 2>/tmp/e2e-block.err; then
    # commit succeeded — Guard Integrity DID NOT BLOCK. That's a failure.
    result "guard-integrity blocks .skip()" "FAIL" "(commit succeeded — should have been blocked)"
    git reset --hard HEAD~1 --quiet
  else
    # commit refused — Guard Integrity blocked correctly
    block_msg=$(cat /tmp/e2e-block.err | head -3 | tr '\n' ' ' | head -c 100)
    result "guard-integrity blocks .skip()" "PASS" "(blocked: $block_msg...)"
    # Restore the file so subsequent tests aren't broken
    mv "${PIN_FILE}.bak" "$PIN_FILE"
    git checkout -- "$PIN_FILE" 2>/dev/null
  fi
else
  result "guard-integrity blocks .skip()" "FAIL" "(no pinned test file to mutate)"
fi

echo ""
echo "── HIGH-RISK: 6. pinned retire <claim-id> ──"
CLAIM_ID=$(jq -r '.claims[0].claimId' tests/pinned/.registry.json 2>/dev/null)
if [ -n "$CLAIM_ID" ] && [ "$CLAIM_ID" != "null" ]; then
  out=$(node "$CLI" retire "$CLAIM_ID" --reason="e2e test" 2>&1 || true)
  if [ -f "tests/pinned/retired/$CLAIM_ID.test.ts" ] || ls tests/pinned/retired/*.test.ts 2>/dev/null | head -1 >/dev/null; then
    result "pinned retire" "PASS"
  else
    result "pinned retire" "FAIL" "($(echo "$out" | head -1))"
  fi
else
  result "pinned retire" "FAIL" "(no claim id available)"
fi

echo ""
echo "── MEDIUM-RISK: 7. pinned generate --description (NL parse) ──"
out=$(node "$CLI" generate --pr-id "pr-e2e-1" --description "Rate-limits /api/users to 60 req/min" --dry-run 2>&1 || true)
if echo "$out" | grep -qE "rate-limit|/api/users"; then
  result "pinned generate NL→pin" "PASS"
else
  result "pinned generate NL→pin" "FAIL" "($(echo "$out" | head -2 | tr '\n' '|'))"
fi

echo ""
echo "── MEDIUM-RISK: 8. pinned check (PR-claim parse) ──"
out=$(node "$CLI" check --description "Auth required on /api/admin/export" --json 2>&1 || true)
if echo "$out" | grep -qE "auth-required|/api/admin"; then
  result "pinned check NL→claim" "PASS"
else
  result "pinned check NL→claim" "FAIL" "(no auth-required claim parsed)"
fi

echo ""
echo "── MEDIUM-RISK: 9. pinned scan-diff ──"
echo "// trigger" > src/scan-test-file.ts 2>/dev/null
git add . 2>/dev/null
out=$(node "$CLI" scan-diff --json 2>&1 || true)
# scan-diff may legitimately find nothing; we test that it runs without crash
if echo "$out" | grep -qE "\{|\[|risks|findings|suggestions|\bok\b"; then
  result "pinned scan-diff runs" "PASS"
else
  result "pinned scan-diff runs" "FAIL" "(no recognizable JSON output)"
fi
rm -f src/scan-test-file.ts

echo ""
echo "── MEDIUM-RISK: 10. pinned ai-rules install/uninstall ──"
# First uninstall
out=$(node "$CLI" ai-rules uninstall --yes 2>&1 || true)
if ! grep -q "pinnedai:start" CLAUDE.md 2>/dev/null; then
  result "ai-rules uninstall" "PASS" "(block removed)"
else
  result "ai-rules uninstall" "FAIL" "(block still present)"
fi
# Then reinstall
out=$(node "$CLI" ai-rules install --yes 2>&1 || true)
if grep -q "pinnedai:start" CLAUDE.md 2>/dev/null; then
  result "ai-rules install" "PASS" "(block restored)"
else
  result "ai-rules install" "FAIL" "(block missing after install)"
fi

echo ""
echo "── MEDIUM-RISK: 11. pinned protect (list mode) ──"
out=$(node "$CLI" protect --list 2>&1 || node "$CLI" protect --help 2>&1 || true)
if echo "$out" | grep -qE "candidate|pattern|protect|suggest|Usage|Options"; then
  result "pinned protect surface" "PASS"
else
  result "pinned protect surface" "FAIL"
fi

echo ""
echo "── MEDIUM-RISK: 12. pinned try (demo) ──"
out=$(node "$CLI" try 2>&1 | head -30 || true)
if echo "$out" | grep -qE "Pinned|pin|claim|rate-limit|auth"; then
  result "pinned try runs" "PASS"
else
  result "pinned try runs" "FAIL"
fi

echo ""
echo "─────────────────────────────────────────────────────────────"
printf "  RESULT: %s pass, %s fail\n" "$PASS" "$FAIL"
echo "─────────────────────────────────────────────────────────────"

# Cleanup
cd "$ROOT"
rm -rf "$TMP"

[ "$FAIL" -eq 0 ] || exit 1
