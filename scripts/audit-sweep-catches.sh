#!/usr/bin/env bash
# FP audit on the compare-sweep results. For every real-catch, classify
# whether it represents a meaningful guard or a mechanical artifact.
#
# Automated suspicion rules (each fires independently — a catch can
# accumulate multiple flags):
#   - signature contains only `import`/`export`/`return` keywords with
#     no structural content (low semantic content)
#   - signature is < 15 chars after normalization (collision-prone)
#   - signature is purely whitespace/punct/braces after stripping
#   - signature is a comment line (//, /*, *, #)
#   - signature contains `console.log` / `console.error` (debug code)
#   - file path matches vendored / generated patterns we may have missed
#   - signature is identical between det and llm catches (dedupe gap)

set -u
SWEEP_DIR="${1:-/tmp/pinned-compare-20260526-012936}"
[ -d "$SWEEP_DIR" ] || { echo "✗ sweep dir not found: $SWEEP_DIR"; exit 1; }

OUT="$SWEEP_DIR/_fp-audit.txt"
TSV="$SWEEP_DIR/_fp-audit.tsv"
: > "$OUT"
: > "$TSV"
printf "repo\tmode\ttemplate\tflags\tfile\tsignature\n" >> "$TSV"

echo "═══════════════════════════════════════════════════════════════" | tee "$OUT"
echo "  FP audit · $SWEEP_DIR" | tee -a "$OUT"
echo "═══════════════════════════════════════════════════════════════" | tee -a "$OUT"

total_det=0; total_llm=0
suspicious_det=0; suspicious_llm=0

# Per-template counts (across all repos, both modes)
declare -a TEMPLATES
for f in "$SWEEP_DIR"/*.det.json "$SWEEP_DIR"/*.llm.json; do
  [ -s "$f" ] || continue
  while IFS=$'\t' read -r tpl; do
    [ -z "$tpl" ] && continue
    TEMPLATES+=("$tpl")
  done < <(jq -r '.fixes[]?.pins[]? | select(.classification == "real-catch") | .claim.template' "$f" 2>/dev/null)
done

# Process each JSON file
for f in "$SWEEP_DIR"/*.det.json "$SWEEP_DIR"/*.llm.json; do
  [ -s "$f" ] || continue
  base=$(basename "$f")
  repo="${base%.*.json}"
  mode="${base#*.}"; mode="${mode%.json}"

  # Extract every real-catch from this file
  while IFS=$'\t' read -r tpl file signature; do
    [ -z "$tpl" ] && continue

    # Apply suspicion rules
    flags=""

    # signature length after normalization
    norm_len=$(echo -n "$signature" | tr -d '[:space:]' | wc -c | tr -d ' ')
    [ "$norm_len" -lt 15 ] && flags="${flags}short-sig,"

    # comment line
    if echo "$signature" | grep -qE '^[[:space:]]*//|^[[:space:]]*/\*|^[[:space:]]*\*[^/]|^[[:space:]]*#' ; then
      flags="${flags}comment,"
    fi

    # debug code
    if echo "$signature" | grep -qE 'console\.(log|error|warn|debug)|debugger\b' ; then
      flags="${flags}debug-code,"
    fi

    # vendored / generated path missed by isVendoredPath
    if echo "$file" | grep -qE 'node_modules|/dist/|/build/|/coverage/|/\.next/|/__generated__/|\.lock$|\.lockfile' ; then
      flags="${flags}vendored-leak,"
    fi

    # whitespace / punct only after stripping
    if [ -z "$(echo "$signature" | tr -d '[:space:][:punct:]')" ]; then
      flags="${flags}punct-only,"
    fi

    # signature is purely a bare import/export with no symbol detail
    if echo "$signature" | grep -qE '^(import|export|return)[[:space:]]*[;{]?[[:space:]]*$' ; then
      flags="${flags}bare-keyword,"
    fi

    [ -n "$flags" ] && flags="${flags%,}" || flags="ok"

    # Track suspicious counts
    if [ "$flags" != "ok" ]; then
      if [ "$mode" = "det" ]; then
        suspicious_det=$((suspicious_det+1))
      else
        suspicious_llm=$((suspicious_llm+1))
      fi
    fi

    if [ "$mode" = "det" ]; then
      total_det=$((total_det+1))
    else
      total_llm=$((total_llm+1))
    fi

    # Truncate signature for the TSV (single-line, capped)
    sig_short=$(echo "$signature" | tr '\n\t' ' ' | head -c 80)
    printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$repo" "$mode" "$tpl" "$flags" "$file" "$sig_short" >> "$TSV"
  done < <(jq -r '.fixes[]?.pins[]? | select(.classification == "real-catch") | [.claim.template, (.claim.staticVerify.filePath // .claim.filePath // .claim.modulePath // .claim.routerFilePath // .claim.sourceFilePath // ""), (.claim.staticVerify.signature // .claim.signature // .claim.handlerSignature // .claim.urlLiteral // .claim.newValue // .claim.exportName // .claim.routePath // .claim.route // "")] | @tsv' "$f" 2>/dev/null)
done

# Aggregate per-template + per-mode
echo "" | tee -a "$OUT"
echo "── catches per template per mode ──" | tee -a "$OUT"
printf "%-30s %8s %8s %8s %8s %s\n" "template" "det-tot" "det-sus" "llm-tot" "llm-sus" "%suspicious" | tee -a "$OUT"
printf "%-30s %8s %8s %8s %8s %s\n" "------------------------------" "-------" "-------" "-------" "-------" "----------" | tee -a "$OUT"

# Get unique templates from TSV
awk -F'\t' 'NR>1 {print $3}' "$TSV" | sort -u | while IFS= read -r tpl; do
  [ -z "$tpl" ] && continue
  dt=$(awk -F'\t' -v t="$tpl" 'NR>1 && $3==t && $2=="det" {c++} END {print c+0}' "$TSV")
  ds=$(awk -F'\t' -v t="$tpl" 'NR>1 && $3==t && $2=="det" && $4!="ok" {c++} END {print c+0}' "$TSV")
  lt=$(awk -F'\t' -v t="$tpl" 'NR>1 && $3==t && $2=="llm" {c++} END {print c+0}' "$TSV")
  ls=$(awk -F'\t' -v t="$tpl" 'NR>1 && $3==t && $2=="llm" && $4!="ok" {c++} END {print c+0}' "$TSV")
  tot=$((dt+lt)); sus=$((ds+ls))
  pct="0%"
  [ "$tot" -gt 0 ] && pct="$((100*sus/tot))%"
  printf "%-30s %8d %8d %8d %8d %s\n" "$tpl" "$dt" "$ds" "$lt" "$ls" "$pct" | tee -a "$OUT"
done

echo "" | tee -a "$OUT"
printf "%-30s %8d %8d %8d %8d\n" "TOTAL" "$total_det" "$suspicious_det" "$total_llm" "$suspicious_llm" | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "── per-repo suspicious-rate ──" | tee -a "$OUT"
printf "%-30s %8s %8s %12s %8s %8s %12s\n" "repo" "det-tot" "det-sus" "det-sus-rate" "llm-tot" "llm-sus" "llm-sus-rate" | tee -a "$OUT"
printf "%-30s %8s %8s %12s %8s %8s %12s\n" "------------------------------" "-------" "-------" "------------" "-------" "-------" "------------" | tee -a "$OUT"
awk -F'\t' 'NR>1 {print $1}' "$TSV" | sort -u | while IFS= read -r r; do
  [ -z "$r" ] && continue
  dt=$(awk -F'\t' -v r="$r" 'NR>1 && $1==r && $2=="det" {c++} END {print c+0}' "$TSV")
  ds=$(awk -F'\t' -v r="$r" 'NR>1 && $1==r && $2=="det" && $4!="ok" {c++} END {print c+0}' "$TSV")
  lt=$(awk -F'\t' -v r="$r" 'NR>1 && $1==r && $2=="llm" {c++} END {print c+0}' "$TSV")
  ls=$(awk -F'\t' -v r="$r" 'NR>1 && $1==r && $2=="llm" && $4!="ok" {c++} END {print c+0}' "$TSV")
  dr="0%"; lr="0%"
  [ "$dt" -gt 0 ] && dr="$((100*ds/dt))%"
  [ "$lt" -gt 0 ] && lr="$((100*ls/lt))%"
  printf "%-30s %8d %8d %12s %8d %8d %12s\n" "$r" "$dt" "$ds" "$dr" "$lt" "$ls" "$lr" | tee -a "$OUT"
done

echo "" | tee -a "$OUT"
echo "── flag breakdown (which suspicion rule fired) ──" | tee -a "$OUT"
for flag in short-sig comment debug-code vendored-leak punct-only bare-keyword; do
  n=$(awk -F'\t' -v f="$flag" 'NR>1 && $4 ~ f {c++} END {print c+0}' "$TSV")
  printf "  %-20s %d\n" "$flag" "$n" | tee -a "$OUT"
done

echo "" | tee -a "$OUT"
echo "── sample suspicious (first 15) ──" | tee -a "$OUT"
awk -F'\t' 'NR>1 && $4!="ok" {printf "  [%s · %s · %s · flags:%s]\n    file: %s\n    sig:  %s\n", $1, $2, $3, $4, $5, $6}' "$TSV" | head -45 | tee -a "$OUT"

echo "" | tee -a "$OUT"
echo "Report: $OUT" | tee -a "$OUT"
echo "Raw:    $TSV" | tee -a "$OUT"
