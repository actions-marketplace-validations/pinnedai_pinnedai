#!/usr/bin/env bash
# Walk a repo's git history and find commits where Guard Integrity
# WOULD have fired — i.e., real evidence of AI weakening/skipping/
# deleting/swallowing tests. The narrative bit of the launch story
# the user actually wants: "look, this stuff happens on YOUR repo
# constantly, and Pinned catches it."
#
# Modes:
#   default: scan ALL test files (any *.test.ts / *.spec.ts), since
#            most repos don't have tests/pinned/ — broader signal.
#   --pinned-only: only flag changes to tests/pinned/ (strict)
#
# Usage:
#   bash scripts/scan-ai-test-tampering.sh /path/to/repo [--limit N] [--pinned-only]

set -u
REPO="${1:-}"
LIMIT="200"
PINNED_ONLY="false"

shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2;;
    --pinned-only) PINNED_ONLY="true"; shift;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

if [ -z "$REPO" ] || [ ! -d "$REPO/.git" ]; then
  echo "Usage: bash scripts/scan-ai-test-tampering.sh /abs/path/to/repo [--limit N] [--pinned-only]" >&2
  exit 1
fi

name="$(basename "$REPO")"
echo "════════════════════════════════════════════════════════════════"
echo "Pinned · AI test-tampering scan — repo: $name"
echo "Limit: last $LIMIT commits · Pinned-only: $PINNED_ONLY"
echo "════════════════════════════════════════════════════════════════"

# Path filter
if [ "$PINNED_ONLY" = "true" ]; then
  PATH_FILTER='tests/pinned/'
  PATH_DESC='tests/pinned/ only'
else
  PATH_FILTER='\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$'
  PATH_DESC='all *.test.* / *.spec.* files'
fi
echo "Scanning: $PATH_DESC"
echo ""

# The detector patterns — terse versions matching guardIntegrity.ts
PATTERN_SKIP='\b(it|test|describe|context)\.(skip|only|todo)\s*\(|\b(xit|xtest|xdescribe|xcontext)\s*\('
PATTERN_WEAKEN='\.toBeTruthy\s*\(\s*\)|\.toBeDefined\s*\(\s*\)|expect\s*\(\s*true\s*\)\.toBe\s*\(\s*true\s*\)|\bexpect\.assertions\s*\(\s*0\s*\)'
PATTERN_SWALLOW='\|\|\s*true\b|\?\?\s*true\b|\.catch\s*\(\s*\(\s*\)\s*=>\s*true\s*\)'
PATTERN_DELETED_LINE='^-.*\bexpect\s*\('

declare -i total_commits=0
declare -i flag_skip=0
declare -i flag_weaken=0
declare -i flag_swallow=0
declare -i flag_delete=0
declare -i any_flag=0

# Iterate commits newest-first
commits="$(git -C "$REPO" log --no-merges -n "$LIMIT" --pretty='%H|%s' 2>/dev/null)"
if [ -z "$commits" ]; then
  echo "(no commits found)"
  exit 0
fi

echo "Flagged commits (Pinned would have blocked these):"
echo ""

while IFS='|' read -r sha subject; do
  total_commits=$((total_commits + 1))

  # Get list of test/pinned files MODIFIED in this commit (status M).
  # We deliberately ignore ADDED files (status A) — new tests legitimately
  # use .toBeTruthy / .skip and aren't AI weakening. Same for deletions.
  # The signal we want: existing test was edited to weaken/skip/swallow.
  changed_test_files="$(git -C "$REPO" show --name-status --pretty=format: "$sha" 2>/dev/null | awk '$1 == "M" {print $2}' | grep -E "$PATH_FILTER" | head -20)"
  if [ -z "$changed_test_files" ]; then
    continue
  fi

  # Get the diff for these files only — added lines + a few removed
  diff_added="$(git -C "$REPO" show --unified=0 --no-color "$sha" -- $(echo "$changed_test_files") 2>/dev/null | grep -E "^\+" | grep -v "^+++")"
  diff_removed="$(git -C "$REPO" show --unified=0 --no-color "$sha" -- $(echo "$changed_test_files") 2>/dev/null | grep -E "^-" | grep -v "^---")"

  # FP-fix: only flag a pattern as "added" if it appears in added lines
  # AND does NOT appear in the same commit's removed lines. This filters
  # out legitimate test refactors where the test was rewritten to assert
  # equivalent behavior (e.g., new copy strings, broader content match).
  # Discovered 2026-05-23 — the quantapact 1e1b859c + back-in-play
  # deabd222 flags were both legitimate refactors that the previous
  # naive scanner misclassified.

  added_skip="$(echo "$diff_added" | grep -cE "$PATTERN_SKIP" || true)"
  removed_skip="$(echo "$diff_removed" | grep -cE "$PATTERN_SKIP" || true)"
  added_weaken="$(echo "$diff_added" | grep -cE "$PATTERN_WEAKEN" || true)"
  removed_weaken="$(echo "$diff_removed" | grep -cE "$PATTERN_WEAKEN" || true)"
  added_swallow="$(echo "$diff_added" | grep -cE "$PATTERN_SWALLOW" || true)"
  removed_swallow="$(echo "$diff_removed" | grep -cE "$PATTERN_SWALLOW" || true)"

  # DEL_EXPECT: count net-removed expect() lines.
  # Was: ANY removed → flag. Now: only flag if removed > added of the
  # SAME pattern (i.e., test got strictly weaker, not refactored).
  expects_added="$(echo "$diff_added" | grep -cE '\bexpect\s*\(' || true)"
  expects_removed="$(echo "$diff_removed" | grep -cE '\bexpect\s*\(' || true)"

  flags=""
  if [ "$added_skip" -gt "$removed_skip" ]; then
    flags="${flags}SKIP "
    flag_skip=$((flag_skip + 1))
  fi
  if [ "$added_weaken" -gt "$removed_weaken" ]; then
    flags="${flags}WEAKEN "
    flag_weaken=$((flag_weaken + 1))
  fi
  if [ "$added_swallow" -gt "$removed_swallow" ]; then
    flags="${flags}SWALLOW "
    flag_swallow=$((flag_swallow + 1))
  fi
  # NET delete = removed > added (test got strictly weaker)
  if [ "$expects_removed" -gt "$expects_added" ]; then
    flags="${flags}NET_DEL_EXPECT "
    flag_delete=$((flag_delete + 1))
  fi

  if [ -n "$flags" ]; then
    any_flag=$((any_flag + 1))
    echo "  [$flags] $sha  $subject"
  fi
done <<< "$commits"

echo ""
echo "────────────────────────────────────────────────────────────────"
echo "Scanned: $total_commits commits"
echo "Flagged: $any_flag (Pinned would have blocked)"
echo "  - SKIP added (.skip/.only/xit/.todo):       $flag_skip"
echo "  - WEAKEN added (.toBeTruthy/.toBeDefined):  $flag_weaken"
echo "  - SWALLOW added (|| true / ?? true / catch):$flag_swallow"
echo "  - DEL_EXPECT (expect() lines removed):      $flag_delete"
echo "────────────────────────────────────────────────────────────────"
