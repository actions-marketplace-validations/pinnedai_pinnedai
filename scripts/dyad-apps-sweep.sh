#!/usr/bin/env bash
# Run pinned backtest --mode=bug-fix against the operator's other
# dyad-apps repos to broaden the in-the-wild catch denominator
# beyond quantasyte. Regex-only by default (no LLM cost); set
# PINNEDAI_BYOK + key env vars to ALSO get the AI-enhanced run.
#
# Output: per-repo summary + a `_sweep-summary.txt` aggregating
# every repo's real-catch count and the lift from LLM if active.

set -u
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
OUT_DIR="/tmp/pinned-dyad-sweep"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/_sweep-summary.txt"
: > "$SUMMARY"

# Repos with enough history + fix-shaped commits to be worth running.
# Sized to fit a focused sweep (cumulative ~4-6 minute runtime).
REPOS=(
  "/Users/michaelzon/dyad-apps/back-in-play"
  "/Users/michaelzon/dyad-apps/myhpifinal"
  "/Users/michaelzon/dyad-apps/TradingAndArbIB"
  "/Users/michaelzon/dyad-apps/aiconciergeairbnb"
)
MAX_FIXES=30

if [ ! -f "$CLI" ]; then
  echo "✗ CLI not built. Run pnpm --filter pinnedai build first." >&2
  exit 1
fi

byok="${PINNEDAI_BYOK:-}"
mode_label="regex-only"
if [ -n "$byok" ]; then
  mode_label="regex + LLM ($byok)"
fi

echo "════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"
echo "dyad-apps backtest sweep — mode: $mode_label" | tee -a "$SUMMARY"
echo "Started at: $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$SUMMARY"
echo "Max fixes per repo: $MAX_FIXES" | tee -a "$SUMMARY"
echo "════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"

for repo in "${REPOS[@]}"; do
  name="$(basename "$repo")"
  if [ ! -d "$repo/.git" ]; then
    echo "  ✗ $name: not a git repo, skipping" | tee -a "$SUMMARY"
    continue
  fi
  json_out="$OUT_DIR/$name.json"
  echo "" | tee -a "$SUMMARY"
  echo "── $name ──" | tee -a "$SUMMARY"
  node "$CLI" backtest --mode=bug-fix \
    --repo "$repo" \
    --max-fixes "$MAX_FIXES" \
    --vitest-timeout 30000 \
    --quiet \
    --json > "$json_out" 2>"$OUT_DIR/$name.err"
  exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo "  ✗ benchmark failed (exit $exit_code) — see $OUT_DIR/$name.err" | tee -a "$SUMMARY"
    continue
  fi
  realCatches="$(jq -r '.realCatches' "$json_out")"
  fixMatched="$(jq -r '.fixCommitsMatched' "$json_out")"
  fixEvaluated="$(jq -r '.fixCommitsEvaluated' "$json_out")"
  pinsGenerated="$(jq -r '.pinsGenerated' "$json_out")"
  durationS="$(jq -r '(.durationMs / 1000) | floor' "$json_out")"
  byTemplate="$(jq -r '.realCatchesByTemplate // {} | to_entries | map("\(.key): \(.value)") | join(", ")' "$json_out")"
  echo "  fix-shaped:   $fixMatched (evaluated $fixEvaluated)" | tee -a "$SUMMARY"
  echo "  pins-generated: $pinsGenerated" | tee -a "$SUMMARY"
  echo "  ★ real catches: $realCatches  [$byTemplate]" | tee -a "$SUMMARY"
  echo "  duration:     ${durationS}s" | tee -a "$SUMMARY"
  if [ "$realCatches" -gt 0 ]; then
    jq -r '.fixes[] | select(.pins[] | .classification == "real-catch") | "    " + .fixCommit[:8] + "  " + (.subject[:70])' "$json_out" \
      | sort -u | tee -a "$SUMMARY"
  fi
done

echo "" | tee -a "$SUMMARY"
echo "════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"
echo "Per-repo JSON: $OUT_DIR/*.json" | tee -a "$SUMMARY"
echo "Summary: $SUMMARY" | tee -a "$SUMMARY"
