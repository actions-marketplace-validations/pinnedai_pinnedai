#!/usr/bin/env bash
# Side-by-side: deterministic vs LLM-mode bug-fix catches across the
# operator's local dyad-apps repos. Uses Claude Code passthrough for
# the LLM run (free, uses the operator's existing subscription).
#
# Heap caps enforced (16 GB machine guard — see backtest.ts changes
# from 2026-05-24 + JetsamEvent forensics).
#
# Usage:
#   scripts/compare-deterministic-vs-llm.sh
#   MAX_FIXES=20 scripts/compare-deterministic-vs-llm.sh
#   REPOS="/path/to/repo1 /path/to/repo2" scripts/compare-deterministic-vs-llm.sh

set -u
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
OUT_DIR="/tmp/pinned-compare-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/_compare-summary.txt"
TABLE="$OUT_DIR/_compare-table.txt"
: > "$SUMMARY"
: > "$TABLE"

MAX_FIXES="${MAX_FIXES:-10}"

# Default repo set: dyad-apps with enough history for fix-shaped commits.
# Override by exporting REPOS="path1 path2 ..."
DEFAULT_REPOS=(
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
if [ -n "${REPOS:-}" ]; then
  # shellcheck disable=SC2206
  REPO_LIST=($REPOS)
else
  REPO_LIST=("${DEFAULT_REPOS[@]}")
fi

if [ ! -f "$CLI" ]; then
  echo "✗ CLI not built. Run pnpm --filter pinnedai build first." >&2
  exit 1
fi
if ! command -v claude >/dev/null 2>&1; then
  echo "✗ claude CLI not on PATH. Required for the LLM-mode pass." >&2
  exit 1
fi

# Track totals for the bottom-of-table summary line.
det_total=0
llm_total=0
det_files_total=0
llm_files_total=0

echo "════════════════════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"
echo "Deterministic vs LLM (claude-code) bug-fix comparison" | tee -a "$SUMMARY"
echo "Started:   $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$SUMMARY"
echo "Max fixes per repo: $MAX_FIXES" | tee -a "$SUMMARY"
echo "Repos:     ${#REPO_LIST[@]}" | tee -a "$SUMMARY"
echo "Out dir:   $OUT_DIR" | tee -a "$SUMMARY"
echo "════════════════════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"

printf "%-30s %12s %12s %10s   %s\n" "repo" "det-catches" "llm-catches" "delta" "templates (llm-only)" | tee -a "$TABLE"
printf "%-30s %12s %12s %10s   %s\n" "------------------------------" "------------" "------------" "----------" "----------------------" | tee -a "$TABLE"

run_one() {
  local repo="$1" mode="$2" out="$3" err="$4"
  if [ "$mode" = "det" ]; then
    node "$CLI" backtest --mode=bug-fix --repo "$repo" --max-fixes "$MAX_FIXES" \
      --vitest-timeout 30000 --quiet --json > "$out" 2>"$err"
  else
    PINNEDAI_BYOK=claude-code node "$CLI" backtest --mode=bug-fix --repo "$repo" \
      --max-fixes "$MAX_FIXES" --vitest-timeout 30000 --quiet --json > "$out" 2>"$err"
  fi
}

for repo in "${REPO_LIST[@]}"; do
  name="$(basename "$repo")"
  if [ ! -d "$repo/.git" ]; then
    echo "  ✗ $name: not a git repo, skipping" | tee -a "$SUMMARY"
    continue
  fi

  echo "" | tee -a "$SUMMARY"
  echo "── $name ──" | tee -a "$SUMMARY"

  det_json="$OUT_DIR/$name.det.json"
  llm_json="$OUT_DIR/$name.llm.json"

  echo "  [det]  running..." | tee -a "$SUMMARY"
  run_one "$repo" "det" "$det_json" "$OUT_DIR/$name.det.err"
  det_exit=$?

  echo "  [llm]  running (claude-code)..." | tee -a "$SUMMARY"
  run_one "$repo" "llm" "$llm_json" "$OUT_DIR/$name.llm.err"
  llm_exit=$?

  if [ $det_exit -ne 0 ] || [ ! -s "$det_json" ]; then
    echo "  ✗ det failed (exit $det_exit) — see $OUT_DIR/$name.det.err" | tee -a "$SUMMARY"
    printf "%-30s %12s %12s %10s   %s\n" "$name" "ERR" "—" "—" "(det failed)" | tee -a "$TABLE"
    continue
  fi
  if [ $llm_exit -ne 0 ] || [ ! -s "$llm_json" ]; then
    echo "  ! llm failed (exit $llm_exit) — see $OUT_DIR/$name.llm.err" | tee -a "$SUMMARY"
    # Still print the deterministic number; LLM column blank.
    det_catches=$(jq -r '.realCatches // 0' "$det_json")
    det_files=$(jq -r '.fixCommitsMatched // 0' "$det_json")
    printf "%-30s %12s %12s %10s   %s\n" "$name" "$det_catches" "ERR" "—" "(llm failed)" | tee -a "$TABLE"
    det_total=$((det_total + det_catches))
    det_files_total=$((det_files_total + det_files))
    continue
  fi

  det_catches=$(jq -r '.realCatches // 0' "$det_json")
  llm_catches=$(jq -r '.realCatches // 0' "$llm_json")
  det_files=$(jq -r '.fixCommitsMatched // 0' "$det_json")
  llm_files=$(jq -r '.fixCommitsMatched // 0' "$llm_json")

  delta=$((llm_catches - det_catches))
  # Templates only LLM caught: set-difference on classification == real-catch templates
  llm_extra_tmpls=$(jq -r --slurpfile det "$det_json" '
    [.fixes[].pins[] | select(.classification == "real-catch") | .template] - [$det[0].fixes[].pins[] | select(.classification == "real-catch") | .template]
    | unique | join(", ")
  ' "$llm_json" 2>/dev/null)

  printf "%-30s %12s %12s %+10d   %s\n" "$name" "$det_catches" "$llm_catches" "$delta" "${llm_extra_tmpls:-—}" | tee -a "$TABLE"

  det_total=$((det_total + det_catches))
  llm_total=$((llm_total + llm_catches))
  det_files_total=$((det_files_total + det_files))
  llm_files_total=$((llm_files_total + llm_files))
done

echo "" | tee -a "$TABLE"
printf "%-30s %12s %12s %+10d\n" "TOTAL (real catches)" "$det_total" "$llm_total" "$((llm_total - det_total))" | tee -a "$TABLE"
printf "%-30s %12s %12s\n" "TOTAL (fix-shaped found)" "$det_files_total" "$llm_files_total" | tee -a "$TABLE"

echo "" | tee -a "$SUMMARY"
echo "════════════════════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"
echo "Comparison table:  $TABLE" | tee -a "$SUMMARY"
echo "Per-repo JSON:     $OUT_DIR/<repo>.det.json + .llm.json" | tee -a "$SUMMARY"
echo "Finished:  $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$SUMMARY"
echo "════════════════════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"
