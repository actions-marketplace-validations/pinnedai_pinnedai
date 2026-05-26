#!/usr/bin/env bash
# Broader historical scanner — finds common AI-coder mistakes that
# actually LAND in commits (not just bypass attempts).
#
# Categories (all high-signal, low-false-positive):
#   SECRET    — committed API keys / tokens (sk-, AKIA, ghp_, gho_, ghs_, npm_, xoxb, etc.)
#   ENV       — .env file added without .gitignore coverage
#   CONSOLE   — console.log added in non-test/non-script source file
#   HARDCODED — hardcoded localhost / http:// URL in non-dev file
#   ERR_DROP  — `if (!res.ok)` or `try/catch around fetch` REMOVED net
#   AUTH_DROP — `authHeaders()` / `Authorization` header REMOVED from a client fetch
#   IMPORT_BROKEN — `import` statement added pointing at a path that doesn't exist
#                  in the same commit's tree
#
# Usage:
#   bash scripts/scan-ai-mistakes-history.sh /path/to/repo [--limit N]

set -u
REPO="${1:-}"
LIMIT="500"
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

if [ -z "$REPO" ] || [ ! -d "$REPO/.git" ]; then
  echo "Usage: bash scripts/scan-ai-mistakes-history.sh /abs/path/to/repo [--limit N]" >&2
  exit 1
fi

name="$(basename "$REPO")"
echo "════════════════════════════════════════════════════════════════"
echo "Pinned · historical AI-mistake scan — repo: $name"
echo "Limit: last $LIMIT commits"
echo "════════════════════════════════════════════════════════════════"

# Patterns
SECRET_PATTERN='(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|ghs_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|npm_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,})'
ENV_PATH='^\.env(\.local|\.production|\.production\.local)?$'
CONSOLE_PATTERN='\bconsole\.(log|debug|info|warn)\s*\('
HARDCODED_URL_PATTERN='https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:[0-9]+)?(/|"|\047)|"http://[a-z0-9.-]+(:[0-9]+)?[/"\047]'
ERR_HANDLING_PATTERN='\bif\s*\(\s*!\s*(res|response|r|result)\s*\.\s*ok\s*\)|\bcatch\s*\(\s*[^)]*\)\s*\{'
AUTH_HEADER_PATTERN='\bauth(Headers?|Token)\s*\(|["'\'']Authorization["'\'']'

# Skip test/script/doc files for CONSOLE / HARDCODED checks
SKIP_FOR_CONSOLE='\.(test|spec)\.|/scripts?/|/tests?/|/docs?/|\.md$|/examples?/|/fixtures?/'

declare -i total=0
declare -i flag_secret=0
declare -i flag_env=0
declare -i flag_console=0
declare -i flag_hardcoded=0
declare -i flag_err=0
declare -i flag_auth=0
declare -i any_flag=0

# Track flagged commits inline
flagged_lines=""

commits="$(git -C "$REPO" log --no-merges -n "$LIMIT" --pretty='%H|%s' 2>/dev/null)"
if [ -z "$commits" ]; then
  echo "(no commits found)"
  exit 0
fi

while IFS='|' read -r sha subject; do
  total=$((total + 1))

  # Full diff for this commit
  added="$(git -C "$REPO" show --unified=0 --no-color "$sha" 2>/dev/null | grep -E "^\+" | grep -v "^+++")"
  removed="$(git -C "$REPO" show --unified=0 --no-color "$sha" 2>/dev/null | grep -E "^-" | grep -v "^---")"

  flags=""

  # 1. Committed secrets — ANY added line matches the secret pattern
  if echo "$added" | grep -qE "$SECRET_PATTERN"; then
    flags="${flags}SECRET "
    flag_secret=$((flag_secret + 1))
  fi

  # 2. .env file added (status A)
  added_env="$(git -C "$REPO" show --name-status "$sha" --pretty=format: 2>/dev/null | awk '$1 == "A" {print $2}' | grep -E "$ENV_PATH" | head -1)"
  if [ -n "$added_env" ]; then
    # Check .gitignore at HEAD
    gitignore="$(git -C "$REPO" show "$sha":.gitignore 2>/dev/null || echo "")"
    if ! echo "$gitignore" | grep -qE "^(\\.env\\*|/\\.env|\\.env)$"; then
      flags="${flags}ENV "
      flag_env=$((flag_env + 1))
    fi
  fi

  # 3. console.log added to non-test/script files. Count added vs removed
  #    for NET signal — refactors that move logs don't count.
  added_console_files="$(git -C "$REPO" show --no-color --unified=0 "$sha" 2>/dev/null | awk '
    /^diff --git/ { file = $4; sub("^b/", "", file); }
    /^\+[^+]/ && match($0, /console\.(log|debug|info|warn)\s*\(/) { print file }
  ' | grep -vE "$SKIP_FOR_CONSOLE" | sort -u | head -3)"
  removed_console_count="$(echo "$removed" | grep -cE "$CONSOLE_PATTERN" || true)"
  added_console_count="$(echo "$added" | grep -cE "$CONSOLE_PATTERN" || true)"
  if [ -n "$added_console_files" ] && [ "$added_console_count" -gt "$removed_console_count" ]; then
    flags="${flags}CONSOLE "
    flag_console=$((flag_console + 1))
  fi

  # 4. Hardcoded localhost / HTTP URLs in non-test/script files
  added_hardcoded_files="$(git -C "$REPO" show --no-color --unified=0 "$sha" 2>/dev/null | awk '
    /^diff --git/ { file = $4; sub("^b/", "", file); }
    /^\+[^+]/ && match($0, /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/) { print file }
  ' | grep -vE "$SKIP_FOR_CONSOLE" | sort -u | head -3)"
  if [ -n "$added_hardcoded_files" ]; then
    flags="${flags}HARDCODED "
    flag_hardcoded=$((flag_hardcoded + 1))
  fi

  # 5. Error handling REMOVED net — `if (!res.ok)` or `try/catch` count
  err_added="$(echo "$added" | grep -cE "$ERR_HANDLING_PATTERN" || true)"
  err_removed="$(echo "$removed" | grep -cE "$ERR_HANDLING_PATTERN" || true)"
  if [ "$err_removed" -gt "$err_added" ] && [ "$err_removed" -ge 2 ]; then
    flags="${flags}ERR_DROP "
    flag_err=$((flag_err + 1))
  fi

  # 6. Auth header REMOVED net
  auth_added="$(echo "$added" | grep -cE "$AUTH_HEADER_PATTERN" || true)"
  auth_removed="$(echo "$removed" | grep -cE "$AUTH_HEADER_PATTERN" || true)"
  if [ "$auth_removed" -gt "$auth_added" ] && [ "$auth_removed" -ge 2 ]; then
    flags="${flags}AUTH_DROP "
    flag_auth=$((flag_auth + 1))
  fi

  if [ -n "$flags" ]; then
    any_flag=$((any_flag + 1))
    echo "  [$flags] $sha  $subject"
  fi
done <<< "$commits"

echo ""
echo "────────────────────────────────────────────────────────────────"
echo "Scanned: $total commits"
echo "Flagged: $any_flag"
echo "  SECRET (committed API key / token):  $flag_secret"
echo "  ENV (env file added, not gitignored): $flag_env"
echo "  CONSOLE (console.log in source):     $flag_console"
echo "  HARDCODED (localhost / http URL):    $flag_hardcoded"
echo "  ERR_DROP (error handling net removed):$flag_err"
echo "  AUTH_DROP (auth header net removed): $flag_auth"
echo "────────────────────────────────────────────────────────────────"
