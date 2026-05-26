#!/usr/bin/env bash
# Det-only sweep — runs the bug-fix backtest in deterministic mode only,
# prints per-repo rows immediately as each repo completes. Companion to
# compare-deterministic-vs-llm.sh but skips the slow LLM pass.

set -u
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
OUT_DIR="/tmp/pinned-det-only-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/_summary.txt"
: > "$SUMMARY"
MAX_FIXES="${MAX_FIXES:-30}"

REPOS=(
  "/Users/michaelzon/dyad-apps/MediniDyad"
  "/Users/michaelzon/dyad-apps/back-in-play"
  "/Users/michaelzon/dyad-apps/quantapact"
  "/Users/michaelzon/dyad-apps/Ai-Book"
  "/Users/michaelzon/dyad-apps/aiconciergeairbnb_prod"
  "/Users/michaelzon/dyad-apps/myhpifinal"
  "/Users/michaelzon/dyad-apps/TradingAndArbIB"
  "/Users/michaelzon/dyad-apps/quantasyte"
  "/Users/michaelzon/dyad-apps/aiconciergeairbnb"
  "/Users/michaelzon/dyad-apps/zon-incubator-sdk"
  "/Users/michaelzon/dyad-apps/researchAi"
)

[ -f "$CLI" ] || { echo "✗ CLI not built"; exit 1; }

echo "Det-only sweep · ${#REPOS[@]} repos · MAX_FIXES=$MAX_FIXES · started $(date -u +%H:%M:%SZ)" | tee -a "$SUMMARY"
printf "%-30s %12s %12s %10s   %s\n" "repo" "catches" "pins-gen" "duration" "templates" | tee -a "$SUMMARY"
printf "%-30s %12s %12s %10s   %s\n" "------------------------------" "-------" "--------" "--------" "--------" | tee -a "$SUMMARY"

total_catches=0
total_pins=0
for repo in "${REPOS[@]}"; do
  name="$(basename "$repo")"
  if [ ! -d "$repo/.git" ]; then
    printf "%-30s %s\n" "$name" "(not a git repo)" | tee -a "$SUMMARY"
    continue
  fi
  json="$OUT_DIR/$name.json"
  err="$OUT_DIR/$name.err"
  start=$(date +%s)
  node "$CLI" backtest --mode=bug-fix --repo "$repo" --max-fixes "$MAX_FIXES" \
    --vitest-timeout 30000 --quiet --json > "$json" 2>"$err"
  exit_code=$?
  end=$(date +%s)
  dur=$((end - start))
  if [ $exit_code -ne 0 ] || [ ! -s "$json" ]; then
    printf "%-30s %s\n" "$name" "(failed: exit $exit_code · ${dur}s)" | tee -a "$SUMMARY"
    continue
  fi
  catches=$(jq -r '.realCatches // 0' "$json")
  pins=$(jq -r '.pinsGenerated // 0' "$json")
  by_t=$(jq -r '.realCatchesByTemplate // {} | to_entries | map("\(.key):\(.value)") | join(", ")' "$json")
  printf "%-30s %12s %12s %10s   %s\n" "$name" "$catches" "$pins" "${dur}s" "${by_t:-—}" | tee -a "$SUMMARY"
  total_catches=$((total_catches + catches))
  total_pins=$((total_pins + pins))
done

echo "" | tee -a "$SUMMARY"
printf "%-30s %12s %12s\n" "TOTAL" "$total_catches" "$total_pins" | tee -a "$SUMMARY"
echo "Out dir: $OUT_DIR" | tee -a "$SUMMARY"
