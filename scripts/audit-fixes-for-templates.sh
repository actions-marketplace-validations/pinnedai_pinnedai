#!/usr/bin/env bash
# Walk every dyad-apps repo. For each repo, collect the last N fix-shaped
# commits with: subject, body, files touched, extensions touched. Emit
# one TSV row per commit so the classifier (awk pass below) can bucket
# each fix into a template category.
#
# Aggregates produced:
#   per-template-count.txt   — fixes-caught + repos-covered per candidate template
#   per-fix-classified.tsv   — raw data: repo<TAB>sha<TAB>template<TAB>subject
#   _template-audit.md       — human-readable ranking by coverage × FP safety
#
# Templates are tagged with a FP-risk bucket (low/med/HIGH). The launch
# bar [[lint-format-false-positives]] memory makes clear: only LOW-FP
# templates are launch-eligible. HIGH-FP candidates appear in the report
# but are flagged "do not build" until the FP shape is solved.

set -u
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=2048}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="/tmp/pinned-template-audit-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"
TSV="$OUT_DIR/per-fix-classified.tsv"
SUMMARY="$OUT_DIR/_template-audit.md"
: > "$TSV"

MAX_FIXES_PER_REPO="${MAX_FIXES_PER_REPO:-50}"

# Same fix-keyword regex backtest uses (kept in sync intentionally).
FIX_RE='\b(fix(es|ed)?|bug|regression|prevent|bypass|unauthor[iz]ed|quota|cap|capped|webhook|idempotent|permission|auth|race|tenant|leak)\b'

REPOS=()
for d in /Users/michaelzon/dyad-apps/*/; do
  name="$(basename "$d")"
  [ "$name" = "pinnedai" ] && continue
  [ "$name" = "pinnedai-public" ] && continue
  [ -d "$d/.git" ] || continue
  commits=$(cd "$d" && git rev-list --count HEAD 2>/dev/null || echo 0)
  if [ "$commits" -ge 20 ]; then
    REPOS+=("$d")
  fi
done

echo "Repos in scope: ${#REPOS[@]}"
echo "Max fixes per repo: $MAX_FIXES_PER_REPO"
echo ""

# ──────────────────────────────────────────────────────────────────────
# Classifier
# ──────────────────────────────────────────────────────────────────────
# Inputs (via env vars): SUBJECT, BODY, FILES (newline-separated)
# Output: one template label on stdout (or "unclassified")
classify() {
  local subject="$1" body="$2" files="$3"
  local subj_lower="$(echo "$subject" | tr '[:upper:]' '[:lower:]')"
  local body_lower="$(echo "$body" | tr '[:upper:]' '[:lower:]')"
  local combined="${subj_lower}\n${body_lower}"

  # ── existing templates (already shipped or wired in scanDiff) ──

  # auth-required: subject mentions auth/login/session/token AND files include route handlers
  if echo "$combined" | grep -qE 'auth|login|signin|session|token|requireauth|jwt' && \
     echo "$files" | grep -qE '(route|middleware|api/|pages/api/|app/api/|/auth)\.tsx?$|middleware\.ts'; then
    echo "auth-required"; return
  fi

  # returns-status / validation-added
  if echo "$combined" | grep -qE 'validat|400|bad request|invalid (body|input)|missing field'; then
    echo "returns-status"; return
  fi

  # idempotent
  if echo "$combined" | grep -qE 'idempoten|duplicat|dedup|already.processed|replay'; then
    echo "idempotent"; return
  fi

  # rate-limit
  if echo "$combined" | grep -qE 'rate.?limit|throttl|429|too many request|quota'; then
    echo "rate-limit"; return
  fi

  # permission-required (ownership / role)
  if echo "$combined" | grep -qE 'permission|role|admin only|forbidden|403|owner|rbac|tenant.scope'; then
    echo "permission-required"; return
  fi

  # webhook handler — even if not idempotent
  if echo "$combined" | grep -qE 'webhook|signature.verif|stripe.event|sendgrid.event' || \
     echo "$files" | grep -qE 'webhook'; then
    echo "webhook-handler-exists"; return
  fi

  # ── proposed templates (NEW — what this audit is for) ──

  # tsc-clean — TS/build errors
  if echo "$combined" | grep -qE 'typescript|ts (error|build)|tsc|build (fail|error)|type.error|implicit any|unused|missing import|missing module'; then
    echo "tsc-clean"; return
  fi

  # syntax error in code
  if echo "$combined" | grep -qE 'syntax.error|parse.error|unexpected token'; then
    echo "tsc-clean"; return
  fi

  # url-literal-preserved — endpoint typos / URL drift
  if echo "$combined" | grep -qE 'url|endpoint|path|route.*(fix|wrong|typo|incorrect|404)|404|api.*v[0-9]|missing slash|trailing slash'; then
    echo "url-literal-preserved"; return
  fi

  # env-var-required — pins that a needed env var keeps being referenced
  if echo "$combined" | grep -qE '\.env|env var|environment variable|process\.env|missing.+env|undefined.+env'; then
    echo "env-var-referenced"; return
  fi

  # dependency-present — fixes that add a missing dep
  if echo "$combined" | grep -qE 'add(ed)? .+package|added .+dep|missing (dep|package|module)|install .+package|cannot find module'; then
    echo "dependency-present"; return
  fi

  # supabase-rls / db migration / schema
  if echo "$combined" | grep -qE 'rls|row level security|policy|migration|schema'; then
    echo "supabase-rls-preserved"; return
  fi

  # cron / scheduled job
  if echo "$combined" | grep -qE 'cron|schedule|interval|periodic'; then
    echo "cron-handler-exists"; return
  fi

  # response error handling
  if echo "$combined" | grep -qE 'error handling|catch (block|error)|try.catch|unhandled|on.error|\.catch\('; then
    echo "client-error-handling"; return
  fi

  # ── known out-of-scope ──

  # UI/visual fixes — Pinned doesn't catch these
  if echo "$combined" | grep -qE 'ui|css|style|color|layout|render|component|jsx|tsx page|button|modal|dialog|spinner|loader|broken.+page|admin panel'; then
    echo "_out-of-scope:ui"; return
  fi

  # Refactor / rename / formatting
  if echo "$combined" | grep -qE 'refactor|rename|cleanup|format|prettier|lint(ing)? fix'; then
    echo "_out-of-scope:refactor"; return
  fi

  # Docs / readme
  if echo "$combined" | grep -qE 'readme|docs|comment|typo (in|on) (readme|docs)'; then
    echo "_out-of-scope:docs"; return
  fi

  echo "_unclassified"
}

# ──────────────────────────────────────────────────────────────────────
# Per-repo walk: emit one TSV row per fix commit
# ──────────────────────────────────────────────────────────────────────
total_fixes=0
for repo in "${REPOS[@]}"; do
  name="$(basename "$repo")"
  cd "$repo"

  # Walk last N fix-shaped commits.
  shas=$(git log --max-count=2000 --pretty=format:"%H%x09%s" 2>/dev/null \
    | grep -iE "$FIX_RE" \
    | head -n "$MAX_FIXES_PER_REPO" \
    | awk -F'\t' '{print $1}')

  while IFS= read -r sha; do
    [ -z "$sha" ] && continue
    subject="$(git show -s --format=%s "$sha")"
    body="$(git show -s --format=%b "$sha" | tr '\n' ' ')"
    files="$(git diff-tree --no-commit-id --name-only -r "$sha" 2>/dev/null | tr '\n' ' ')"
    template="$(classify "$subject" "$body" "$files")"
    printf '%s\t%s\t%s\t%s\n' "$name" "$sha" "$template" "$subject" >> "$TSV"
    total_fixes=$((total_fixes + 1))
  done <<< "$shas"
done
cd "$ROOT"

echo "Classified $total_fixes fix commits across ${#REPOS[@]} repos -> $TSV"
echo ""

# ──────────────────────────────────────────────────────────────────────
# Aggregate
# ──────────────────────────────────────────────────────────────────────
echo "# Template audit — dyad-apps fix-commit coverage" > "$SUMMARY"
echo "" >> "$SUMMARY"
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$SUMMARY"
echo "Repos: ${#REPOS[@]} · Fixes: $total_fixes · Max per repo: $MAX_FIXES_PER_REPO" >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo "## Coverage table — fixes-caught × repos-covered per template" >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo "FP-risk legend: **LOW** = deterministic signature/hash. **MED** = needs runtime smoke or env state. **HIGH** = heuristic only — do NOT build." >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo "| template | fp-risk | fixes | repos | status |" >> "$SUMMARY"
echo "|---|---|---:|---:|---|" >> "$SUMMARY"

# FP-risk + status for each known template label.
declare -a TEMPLATE_ORDER=(
  "auth-required:LOW:shipped"
  "returns-status:LOW:shipped"
  "idempotent:LOW:shipped"
  "rate-limit:LOW:shipped"
  "permission-required:LOW:shipped"
  "webhook-handler-exists:LOW:proposed"
  "tsc-clean:LOW:proposed"
  "url-literal-preserved:LOW:proposed"
  "env-var-referenced:MED:proposed"
  "dependency-present:LOW:proposed"
  "supabase-rls-preserved:LOW:proposed"
  "cron-handler-exists:LOW:proposed"
  "client-error-handling:LOW:shipped"
  "_out-of-scope:ui:n/a:rejected"
  "_out-of-scope:refactor:n/a:rejected"
  "_out-of-scope:docs:n/a:rejected"
  "_unclassified:n/a:investigate"
)

for entry in "${TEMPLATE_ORDER[@]}"; do
  IFS=':' read -r tpl fp status <<< "$entry"
  fixes=$(awk -F'\t' -v t="$tpl" '$3 == t { c++ } END { print c+0 }' "$TSV")
  repos=$(awk -F'\t' -v t="$tpl" '$3 == t { print $1 }' "$TSV" | sort -u | wc -l | tr -d ' ')
  printf '| %s | %s | %d | %d | %s |\n' "$tpl" "$fp" "$fixes" "$repos" "$status" >> "$SUMMARY"
done

echo "" >> "$SUMMARY"
echo "## Top sample fixes per proposed (non-shipped) template" >> "$SUMMARY"
echo "" >> "$SUMMARY"
for tpl in tsc-clean url-literal-preserved env-var-referenced dependency-present supabase-rls-preserved cron-handler-exists webhook-handler-exists; do
  count=$(awk -F'\t' -v t="$tpl" '$3 == t { c++ } END { print c+0 }' "$TSV")
  [ "$count" -eq 0 ] && continue
  echo "### $tpl ($count fixes)" >> "$SUMMARY"
  echo "" >> "$SUMMARY"
  awk -F'\t' -v t="$tpl" '$3 == t { print "- **" $1 "** `" substr($2,1,8) "` " $4 }' "$TSV" | head -8 >> "$SUMMARY"
  echo "" >> "$SUMMARY"
done

echo "## Unclassified — needs eyeballing (top 30)" >> "$SUMMARY"
echo "" >> "$SUMMARY"
awk -F'\t' '$3 == "_unclassified" { print "- **" $1 "** `" substr($2,1,8) "` " $4 }' "$TSV" | head -30 >> "$SUMMARY"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "Report: $SUMMARY"
echo "Raw:    $TSV"
echo "════════════════════════════════════════════════════════════════"
