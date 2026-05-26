#!/usr/bin/env bash
# End-to-end evaluation suite. For each of 5 repos, runs:
#   1. pinned backtest --mode=bug-fix    (catches Pinned would generate from real fixes)
#   2. simulate-real-install              (walk-forward catches if Pinned installed mid-history)
#
# Captures per-repo JSON results into /tmp/pinned-eval/ then hands off to
# eval-summarize.ts to compute the CSV + summary.md.
#
# Goal: answer "would a user perceive value or actually get value from Pinned?"

set -u
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
SIM_RUNNER="$ROOT/scripts/run-simulator.ts"
TSX="$ROOT/apps/cli/node_modules/.bin/tsx"
OUT_DIR="/tmp/pinned-eval"
mkdir -p "$OUT_DIR"

REPOS=(
  "/Users/michaelzon/dyad-apps/quantasyte"
  "/Users/michaelzon/dyad-apps/quantapact"
  "/tmp/pinned-oss/documenso"
  "/tmp/pinned-oss/formbricks"
  "/tmp/pinned-oss/next-auth"
)

MAX_FIXES=20
SIM_INSTALL_AT=0.5
SIM_MAX_REPLAY=40

if [ ! -f "$CLI" ]; then
  echo "✗ CLI not built. Run pnpm build first." >&2
  exit 1
fi

echo "════════════════════════════════════════════════════════════════"
echo "Pinned evaluation suite"
echo "Started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Repos: ${#REPOS[@]}"
echo "Bug-fix max-fixes: $MAX_FIXES · Sim install-at: $SIM_INSTALL_AT · Sim max-replay: $SIM_MAX_REPLAY"
echo "════════════════════════════════════════════════════════════════"

for repo in "${REPOS[@]}"; do
  name="$(basename "$repo")"
  if [ ! -d "$repo/.git" ]; then
    echo "  ✗ $name: not a git repo, skipping"
    continue
  fi

  echo ""
  echo "── $name ──"

  # 1. Bug-fix backtest
  bf_json="$OUT_DIR/${name}-bugfix.json"
  echo "  → bug-fix backtest (max-fixes=$MAX_FIXES)..."
  node "$CLI" backtest --mode=bug-fix \
    --repo "$repo" \
    --max-fixes "$MAX_FIXES" \
    --vitest-timeout 30000 \
    --quiet \
    --json > "$bf_json" 2>"$OUT_DIR/${name}-bugfix.err"
  bf_rc=$?
  if [ $bf_rc -eq 0 ]; then
    bf_catches="$(jq -r '.realCatches' "$bf_json")"
    echo "    real catches: $bf_catches"
  else
    echo "    ✗ bug-fix failed (exit $bf_rc)"
  fi

  # 2. Walk-forward simulator
  sim_json="$OUT_DIR/${name}-sim.json"
  echo "  → walk-forward sim (install-at=$SIM_INSTALL_AT, max-replay=$SIM_MAX_REPLAY)..."
  "$TSX" "$SIM_RUNNER" \
    --repo "$repo" \
    --install-at "$SIM_INSTALL_AT" \
    --max-replay "$SIM_MAX_REPLAY" \
    --vitest-timeout 45000 \
    --out "$sim_json" \
    > "$OUT_DIR/${name}-sim.log" 2>&1
  sim_rc=$?
  if [ $sim_rc -eq 0 ] && [ -f "$sim_json" ]; then
    sim_catches="$(jq -r '.catches | length' "$sim_json")"
    sim_pins="$(jq -r '.totalLivePinsAtEnd' "$sim_json")"
    echo "    catches: $sim_catches · pins-at-end: $sim_pins"
  else
    echo "    ✗ sim failed (exit $sim_rc)"
  fi
done

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "Raw JSON: $OUT_DIR/"
echo "Now running eval-summarize.ts to produce CSV + summary.md..."
echo "════════════════════════════════════════════════════════════════"

"$TSX" "$ROOT/scripts/eval-summarize.ts" "$OUT_DIR"
