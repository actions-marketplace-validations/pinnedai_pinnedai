#!/usr/bin/env bash
# Sweep bug-fix backtest across 3 OSS repos in BOTH deterministic-only
# and BYOK gpt-4o LLM-proposer modes. Outputs a side-by-side comparison.
# Used to settle: does Pinned generalize beyond quantasyte (Path 1 of
# the launch bar), and does LLM proposer add catches (free vs Pro lever).

set -u
# Cap the driver's V8 heap so the sweep can't drift toward Jetsam on a
# 16 GB machine. The vitest child gets its own cap inside backtest.ts.
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"
MODE="${MODE:-deterministic}"  # deterministic | llm
PROVIDER="${PROVIDER:-openai}" # openai | anthropic | claude-code | github-models
LLM_MODEL="${LLM_MODEL:-gpt-4o-mini}"  # only used for openai/github-models. anthropic/claude-code ignore this.
if [ "$MODE" != "deterministic" ] && [ "$MODE" != "llm" ]; then
  echo "MODE must be 'deterministic' or 'llm'" >&2
  exit 1
fi
case "$PROVIDER" in
  openai|anthropic|claude-code|github-models) ;;
  *) echo "PROVIDER must be openai | anthropic | claude-code | github-models (got '$PROVIDER')" >&2; exit 1 ;;
esac
# Provider-specific env var guards. Surface a clear error up front so
# the sweep doesn't burn N minutes only to fail every repo with
# "byok-key-missing".
if [ "$MODE" = "llm" ]; then
  case "$PROVIDER" in
    openai)
      if [ -z "${PINNEDAI_OPENAI_KEY:-}" ]; then echo "PROVIDER=openai requires PINNEDAI_OPENAI_KEY" >&2; exit 1; fi
      ;;
    anthropic)
      if [ -z "${PINNEDAI_ANTHROPIC_KEY:-}" ]; then echo "PROVIDER=anthropic requires PINNEDAI_ANTHROPIC_KEY" >&2; exit 1; fi
      ;;
    claude-code)
      if ! command -v claude >/dev/null 2>&1; then echo "PROVIDER=claude-code requires the 'claude' CLI on PATH" >&2; exit 1; fi
      ;;
    github-models)
      if [ -z "${PINNEDAI_GITHUB_TOKEN:-}" ] && [ -z "${GITHUB_TOKEN:-}" ]; then echo "PROVIDER=github-models requires PINNEDAI_GITHUB_TOKEN or GITHUB_TOKEN" >&2; exit 1; fi
      ;;
  esac
fi
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/apps/cli/dist/cli.js"
out_suffix="$MODE"
if [ "$MODE" = "llm" ]; then
  case "$PROVIDER" in
    claude-code|anthropic) out_suffix="llm-$PROVIDER" ;;
    *)                     out_suffix="llm-$PROVIDER-$LLM_MODEL" ;;
  esac
fi
OUT_DIR="/tmp/pinned-oss-sweep-$out_suffix"
mkdir -p "$OUT_DIR"
SUMMARY="$OUT_DIR/_sweep-summary.txt"
: > "$SUMMARY"

REPOS=(
  "/tmp/pinned-oss/documenso"
  "/tmp/pinned-oss/formbricks"
  "/tmp/pinned-oss/next-auth"
)
MAX_FIXES=20

if [ ! -f "$CLI" ]; then
  echo "✗ CLI not built. Run pnpm --filter pinnedai build first." >&2
  exit 1
fi

label="$MODE"
if [ "$MODE" = "llm" ]; then
  case "$PROVIDER" in
    claude-code|anthropic) label="$MODE ($PROVIDER)" ;;
    *)                     label="$MODE ($PROVIDER · $LLM_MODEL)" ;;
  esac
fi
echo "════════════════════════════════════════════════════════════════" | tee -a "$SUMMARY"
echo "OSS bug-fix sweep — mode: $label" | tee -a "$SUMMARY"
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

  if [ "$MODE" = "llm" ]; then
    # Compose the env prefix for the chosen provider. claude-code +
    # anthropic don't take a model flag here (haiku is hardcoded);
    # openai + github-models pass PINNEDAI_OPENAI_MODEL /
    # PINNEDAI_GITHUB_MODEL so the same LLM_MODEL var configures both.
    case "$PROVIDER" in
      openai)
        PINNEDAI_BYOK=openai PINNEDAI_OPENAI_MODEL="$LLM_MODEL" node "$CLI" backtest --mode=bug-fix \
          --repo "$repo" --max-fixes "$MAX_FIXES" --vitest-timeout 30000 --quiet --json \
          > "$json_out" 2>"$OUT_DIR/$name.err"
        ;;
      anthropic)
        PINNEDAI_BYOK=anthropic node "$CLI" backtest --mode=bug-fix \
          --repo "$repo" --max-fixes "$MAX_FIXES" --vitest-timeout 30000 --quiet --json \
          > "$json_out" 2>"$OUT_DIR/$name.err"
        ;;
      claude-code)
        PINNEDAI_BYOK=claude-code node "$CLI" backtest --mode=bug-fix \
          --repo "$repo" --max-fixes "$MAX_FIXES" --vitest-timeout 30000 --quiet --json \
          > "$json_out" 2>"$OUT_DIR/$name.err"
        ;;
      github-models)
        PINNEDAI_BYOK=github-models PINNEDAI_GITHUB_MODEL="$LLM_MODEL" node "$CLI" backtest --mode=bug-fix \
          --repo "$repo" --max-fixes "$MAX_FIXES" --vitest-timeout 30000 --quiet --json \
          > "$json_out" 2>"$OUT_DIR/$name.err"
        ;;
    esac
  else
    node "$CLI" backtest --mode=bug-fix \
      --repo "$repo" \
      --max-fixes "$MAX_FIXES" \
      --vitest-timeout 30000 \
      --quiet \
      --json > "$json_out" 2>"$OUT_DIR/$name.err"
  fi

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
  echo "  fix-shaped:     $fixMatched (evaluated $fixEvaluated)" | tee -a "$SUMMARY"
  echo "  pins-generated: $pinsGenerated" | tee -a "$SUMMARY"
  echo "  ★ real catches: $realCatches  [$byTemplate]" | tee -a "$SUMMARY"
  echo "  duration:       ${durationS}s" | tee -a "$SUMMARY"
  if [ "$realCatches" -gt 0 ]; then
    jq -r '.fixes[] | select(.pins[] | .classification == "real-catch") | "    " + .fixCommit[:8] + "  " + (.subject[:70])' "$json_out" \
      | sort -u | tee -a "$SUMMARY"
  fi
done

echo "" | tee -a "$SUMMARY"
echo "Summary: $SUMMARY" | tee -a "$SUMMARY"
