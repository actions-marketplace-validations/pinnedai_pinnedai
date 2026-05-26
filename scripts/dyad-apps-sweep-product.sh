#!/usr/bin/env bash
# Run pinned backtest --mode=product (the SHIPPING product's claim
# extraction path: PR/commit text only, replayed forward) against
# the operator's dyad-apps repos. Mirrors what a real user installing
# Pinned would see. See [[internal-testing-uses-product-mode]] memory.
#
# Output: per-repo summary + a `_sweep-summary.txt` aggregating
# every repo's real-catch count.

set -u
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
MODE="${MODE:-product}"
if [ "$MODE" != "product" ] && [ "$MODE" != "extended" ]; then
  echo "✗ MODE must be 'product' or 'extended' (got '$MODE')" >&2
  exit 1
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
OUT_DIR="/tmp/pinned-dyad-sweep-$MODE"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/_sweep-summary.txt"
: > "$SUMMARY"

# Same 4 sibling repos as the bug-fix sweep + quantasyte (the
# headline best-case repo) so we have apples-to-apples comparison.
REPOS=(
  "/Users/michaelzon/dyad-apps/quantasyte"
  "/Users/michaelzon/dyad-apps/back-in-play"
  "/Users/michaelzon/dyad-apps/myhpifinal"
  "/Users/michaelzon/dyad-apps/TradingAndArbIB"
  "/Users/michaelzon/dyad-apps/aiconciergeairbnb"
)
MAX_REPLAY=50

if [ ! -f "$CLI" ]; then
  echo "✗ CLI not built. Run pnpm --filter pinnedai build first." >&2
  exit 1
fi

byok="${PINNEDAI_BYOK:-}"
mode_label="$MODE (regex-only)"
if [ -n "$byok" ]; then
  mode_label="$MODE + LLM ($byok)"
fi

echo "════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"
echo "dyad-apps walk-forward backtest sweep — mode: $mode_label" | tee -a "$SUMMARY"
echo "Started at: $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$SUMMARY"
echo "Max replay per pin: $MAX_REPLAY commits" | tee -a "$SUMMARY"
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
  node "$CLI" backtest --mode="$MODE" \
    --repo "$repo" \
    --max-replay "$MAX_REPLAY" \
    --vitest-timeout 30000 \
    --quiet \
    --json > "$json_out" 2>"$OUT_DIR/$name.err"
  exit_code=$?
  if [ $exit_code -ne 0 ]; then
    echo "  ✗ benchmark failed (exit $exit_code) — see $OUT_DIR/$name.err" | tee -a "$SUMMARY"
    continue
  fi
  # Product mode reports differ from bug-fix — pull the right keys.
  pinsGenerated="$(jq -r '.pinsGenerated // .pins // 0' "$json_out")"
  realCatches="$(jq -r '.realCatches // 0' "$json_out")"
  noSignal="$(jq -r '.noSignal // 0' "$json_out")"
  commitsScanned="$(jq -r '.commitsScanned // .commits // 0' "$json_out")"
  claimsFound="$(jq -r '.claimsFound // 0' "$json_out")"
  durationS="$(jq -r '(.durationMs / 1000) | floor' "$json_out")"
  byTemplate="$(jq -r '.realCatchesByTemplate // {} | to_entries | map("\(.key): \(.value)") | join(", ")' "$json_out")"
  echo "  commits scanned:  $commitsScanned" | tee -a "$SUMMARY"
  echo "  claims found:     $claimsFound" | tee -a "$SUMMARY"
  echo "  pins generated:   $pinsGenerated" | tee -a "$SUMMARY"
  echo "  no-signal pins:   $noSignal" | tee -a "$SUMMARY"
  echo "  ★ real catches:   $realCatches  [$byTemplate]" | tee -a "$SUMMARY"
  echo "  duration:         ${durationS}s" | tee -a "$SUMMARY"
done

echo "" | tee -a "$SUMMARY"
echo "════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"
echo "Per-repo JSON: $OUT_DIR/*.json" | tee -a "$SUMMARY"
echo "Summary: $SUMMARY" | tee -a "$SUMMARY"
