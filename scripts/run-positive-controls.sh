#!/usr/bin/env bash
# Run the bug-fix benchmark against every positive-control fixture
# under audit/positive-controls/. For each fixture:
#   1. mkdtemp a working dir, `git init` it.
#   2. Copy <fixture>/parent/* in, commit as the buggy state.
#   3. Copy <fixture>/fixed/* in, commit as the fix.
#   4. Run `pinned backtest --mode=bug-fix --json` against the temp repo.
#   5. Compare the report against <fixture>/expected.json.
#   6. Aggregate pass/fail into audit/positive-controls/_results.json.
#
# Usage:
#   scripts/run-positive-controls.sh                 # run all
#   scripts/run-positive-controls.sh 01-admin-route  # run a category
#
# Exit codes:
#   0 — every fixture met its expected verdict (passed the launch gate)
#   1 — at least one fixture fell below its expected real-catch count
#   2 — runner infra-failure (CLI not found, git error, etc.)

set -euo pipefail
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_CONTROLS="$ROOT/audit/positive-controls"
CLI="$ROOT/apps/cli/dist/cli.js"
RESULTS="$ROOT_CONTROLS/_results.json"
FILTER="${1:-}"

if [ ! -f "$CLI" ]; then
  echo "✗ CLI not found at $CLI. Run \`pnpm --filter pinnedai build\` first." >&2
  exit 2
fi

# Collect fixtures: every leaf <category>/<variation>/ with an expected.json.
# Using a portable while-read loop because macOS ships an old bash without
# `mapfile`. Use a temp file so the while loop runs in the current shell
# and `fixtures` survives the loop.
fixtures=()
fixtures_tmp="$(mktemp)"
find "$ROOT_CONTROLS" -name expected.json -type f 2>/dev/null \
  | while read -r f; do dirname "$f"; done \
  | sort > "$fixtures_tmp"
while IFS= read -r line; do
  [ -n "$line" ] && fixtures+=("$line")
done < "$fixtures_tmp"
rm -f "$fixtures_tmp"

if [ ${#fixtures[@]} -eq 0 ]; then
  echo "✗ No fixtures found under $ROOT_CONTROLS (expected.json files)." >&2
  exit 2
fi

pass=0
fail=0
declare -a results=()

for fixture_dir in "${fixtures[@]}"; do
  rel="${fixture_dir#$ROOT_CONTROLS/}"
  if [ -n "$FILTER" ] && [[ "$rel" != "$FILTER"* ]]; then continue; fi
  expected="$fixture_dir/expected.json"
  parent_dir="$fixture_dir/parent"
  fixed_dir="$fixture_dir/fixed"
  if [ ! -d "$parent_dir" ] || [ ! -d "$fixed_dir" ]; then
    echo "✗ $rel: missing parent/ or fixed/ subdir" >&2
    fail=$((fail+1))
    continue
  fi

  fixture_subject="$(jq -r '.fixSubject // "fix"' "$expected" 2>/dev/null)"
  expected_real_catches="$(jq -r '.expect.minRealCatches // 1' "$expected")"
  expected_templates="$(jq -r '.expect.templates // [] | join(",")' "$expected")"

  tmp="$(mktemp -d -t pinned-fixture-XXXXXX)"
  trap "rm -rf '$tmp'" RETURN

  (
    cd "$tmp"
    git init -q
    git config user.email "fixture@pinnedai.local"
    git config user.name "Pinned Fixture Runner"

    # Commit parent (buggy) state
    cp -R "$parent_dir/." "$tmp/"
    git add -A
    git commit -qm "parent: buggy baseline"

    # Apply fix — copy fixed/ on top, then commit. Files removed by
    # the fix (rare in our shape) would need explicit rm; current
    # fixtures only add/modify.
    cp -R "$fixed_dir/." "$tmp/"
    git add -A
    git commit -qm "$fixture_subject"
  )

  report="$tmp/_pinned-report.json"
  if ! node "$CLI" backtest --mode=bug-fix --repo "$tmp" --max-fixes 5 --vitest-timeout 30000 --quiet --json > "$report" 2>"$tmp/_err.log"; then
    echo "✗ $rel: backtest invocation failed"
    cat "$tmp/_err.log" >&2 || true
    fail=$((fail+1))
    results+=("$(jq -n --arg f "$rel" --arg s "infra-fail" '{fixture:$f,status:$s}')")
    rm -rf "$tmp"
    continue
  fi

  actual_real_catches="$(jq -r '.realCatches // 0' "$report")"
  actual_by_template="$(jq -r '.realCatchesByTemplate // {} | to_entries | map(.key) | join(",")' "$report")"

  if [ "$actual_real_catches" -ge "$expected_real_catches" ]; then
    echo "✓ $rel — $actual_real_catches real-catch(es) [$actual_by_template]"
    pass=$((pass+1))
    results+=("$(jq -n --arg f "$rel" --argjson c "$actual_real_catches" --arg t "$actual_by_template" --arg s "pass" '{fixture:$f,status:$s,realCatches:$c,byTemplate:($t | split(","))}')")
  else
    echo "✗ $rel — expected ≥$expected_real_catches real-catch(es) [$expected_templates], got $actual_real_catches [$actual_by_template]"
    fail=$((fail+1))
    results+=("$(jq -n --arg f "$rel" --argjson c "$actual_real_catches" --arg exp "$expected_real_catches" --arg s "fail" --arg t "$actual_by_template" '{fixture:$f,status:$s,realCatches:$c,expectedRealCatches:($exp|tonumber),byTemplate:($t | split(","))}')")
  fi

  rm -rf "$tmp"
done

total=$((pass + fail))
threshold=80  # ≥80% per launch spec
pct=0
if [ $total -gt 0 ]; then
  pct=$((pass * 100 / total))
fi

# Write scorecard
{
  echo "{"
  echo "  \"runAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
  echo "  \"summary\": { \"passed\": $pass, \"failed\": $fail, \"total\": $total, \"percentPassing\": $pct, \"thresholdPercent\": $threshold },"
  echo "  \"fixtures\": ["
  for i in "${!results[@]}"; do
    sep=","
    if [ "$i" -eq $((${#results[@]}-1)) ]; then sep=""; fi
    echo "    ${results[$i]}$sep"
  done
  echo "  ]"
  echo "}"
} > "$RESULTS"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Scorecard: $pass / $total fixtures passing ($pct%)"
echo "  Launch threshold: ≥${threshold}% per category"
echo "  Full report: $RESULTS"
echo "═══════════════════════════════════════════════════════"

if [ $pct -lt $threshold ]; then exit 1; fi
exit 0
