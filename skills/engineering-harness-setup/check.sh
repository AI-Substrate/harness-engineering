#!/usr/bin/env sh
# check.sh — self-checks for the engineering-harness-setup skill package.
#
# Four invariants are enforced (see AUTHORING.md § Load-bearing invariants):
#   boundary             Canonical boundary sentence is byte-identical across ≥5 files.
#   privacy              Shipped prose contains no private-source contamination.
#   magic-wand           Magic-wand wording is byte-identical across ≥6 surfaces.
#   placeholder-syntax   All {{…}} markers in templates match the canonical form.
#   all                  Run all four (the Group G pre-commit gate).
#
# Also:
#   --inline-fallback   Concatenate templates into a single-file SKILL.md
#                       variant; used if the pi runtime ever rejects
#                       multi-file skill packages.

set -eu

# Resolve script directory so the checks work from any cwd.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$SCRIPT_DIR"
TEMPLATES_DIR="$PKG_DIR/templates"

# Canonical strings (single source of truth: the two template files).
BOUNDARY_SENTENCE='The agent harness drives. The engineering harness proves.'
MAGIC_WAND_MARKER='If you had a magic wand, what ONE thing would you change'

fail() {
  printf 'check.sh: FAIL — %s\n' "$1" >&2
  exit 1
}

ok() {
  printf 'check.sh: ok — %s\n' "$1"
}

cmd_boundary() {
  # Assertion (a): grep -rcF reports ≥1 match in at least 5 files under the package.
  match_count=$(grep -rcF -- "$BOUNDARY_SENTENCE" "$PKG_DIR" 2>/dev/null | awk -F: '$2 > 0 { c++ } END { print c+0 }')
  if [ "$match_count" -lt 5 ]; then
    fail "boundary sentence found in only $match_count files (need ≥5). Expected in SKILL.md, templates/root-HARNESS.md, templates/agents-md-snippet.md, templates/harness-onboard-agent-session.md, templates/install-report.md."
  fi

  # Assertion (b): canonical-boundary.txt is byte-identical to the canonical form.
  expected_file="$TEMPLATES_DIR/canonical-boundary.txt"
  if [ ! -f "$expected_file" ]; then
    fail "templates/canonical-boundary.txt is missing."
  fi
  expected="$BOUNDARY_SENTENCE"
  actual=$(cat "$expected_file")
  if [ "$actual" != "$expected" ]; then
    fail "templates/canonical-boundary.txt does not match the canonical sentence byte-for-byte."
  fi

  ok "boundary sentence is byte-identical in $match_count files; canonical-boundary.txt matches."
}

cmd_privacy() {
  # Scope: shipped surfaces only (SKILL.md + templates/). AUTHORING.md and
  # check.sh are repo-internal and legitimately reference the foundation
  # paths and the pattern strings; they are not installed to target repos.
  shipped_scope="$PKG_DIR/SKILL.md $TEMPLATES_DIR"

  # Patterns that must never appear in shipped prose.
  priv_paths='harness-foundations/|docs/plans/|scratch/|source-notes/'
  priv_ids='S00[1-4]|N2-S00|M00'

  matches=$(grep -rE "($priv_paths|$priv_ids)" $shipped_scope 2>/dev/null || true)
  if [ -n "$matches" ]; then
    printf '%s\n' "$matches" >&2
    fail "private-source contamination detected (paths or IDs) in shipped surfaces."
  fi

  # Substrate names — allowed only inside HTML comments.
  # Strategy: strip <!-- ... --> regions, then grep for the names.
  substrate_hits=""
  for f in $(find $shipped_scope -type f 2>/dev/null); do
    # Use awk to strip HTML-comment regions, then grep.
    stripped=$(awk '
      BEGIN { in_comment = 0 }
      {
        line = $0
        while (1) {
          if (in_comment) {
            end_idx = index(line, "-->")
            if (end_idx == 0) { line = ""; break }
            line = substr(line, end_idx + 3)
            in_comment = 0
          }
          start_idx = index(line, "<!--")
          if (start_idx == 0) { print line; break }
          # Find matching end on same line, else mark in_comment.
          rest = substr(line, start_idx + 4)
          end_idx = index(rest, "-->")
          if (end_idx == 0) {
            print substr(line, 1, start_idx - 1)
            in_comment = 1
            break
          }
          line = substr(line, 1, start_idx - 1) substr(rest, end_idx + 3)
        }
      }
    ' "$f")
    if printf '%s' "$stripped" | grep -qE '(^|[^<])(minih|chainglass)'; then
      substrate_hits="$substrate_hits$f\n"
    fi
  done
  if [ -n "$substrate_hits" ]; then
    printf 'substrate-name leak in:\n%b' "$substrate_hits" >&2
    fail "substrate names (minih|chainglass) detected outside HTML comments in shipped surfaces."
  fi

  ok "no private-source contamination detected in shipped surfaces."
}

cmd_magic_wand() {
  match_count=$(grep -rcF -- "$MAGIC_WAND_MARKER" "$PKG_DIR" 2>/dev/null | awk -F: '$2 > 0 { c++ } END { print c+0 }')
  if [ "$match_count" -lt 6 ]; then
    fail "magic-wand wording found in only $match_count surfaces (need ≥6). Expected in templates/magic-wand-prompt.md, templates/root-HARNESS.md (Rule 5), templates/harness-friction-log.md, templates/harness-proof-note.md, templates/install-report.md, templates/retrospective-schema.json."
  fi

  ok "magic-wand wording is byte-identical in $match_count surfaces."
}

cmd_placeholder_syntax() {
  # Verify that every {{...}} marker in shipped templates matches the canonical
  # form: {{[A-Z_][A-Z0-9_]*}}. Catches author typos like {X}}, {{X}, {{lowercase}},
  # {{Mixed_Case}}, etc. The runtime placeholder-LEAK check (whether markers
  # actually got substituted by the install flow) is in the CLI itself — see
  # assert_no_placeholder_leaks() in cli-{python,node}-harness.{py,mjs}.
  scope=$(find "$TEMPLATES_DIR" -type f 2>/dev/null)
  hits=""
  for f in $scope; do
    # Find double-brace tokens that DON'T match the canonical form.
    bad=$(grep -oE '\{\{[^}]*\}\}' "$f" 2>/dev/null | grep -vE '^\{\{[A-Z_][A-Z0-9_]*\}\}$' || true)
    if [ -n "$bad" ]; then
      hits="$hits$f:\n$bad\n"
    fi
  done
  if [ -n "$hits" ]; then
    printf 'malformed placeholder syntax in:\n%b' "$hits" >&2
    fail "placeholder markers must match {{[A-Z_][A-Z0-9_]*}}."
  fi

  ok "all placeholder markers match the canonical form {{NAME}}."
}

cmd_inline_fallback() {
  # v0.2 fallback: concatenate every template into one SKILL.md variant.
  # Writes to skills/engineering-harness-setup/SKILL.md.inline-fallback so the
  # canonical multi-file SKILL.md is preserved.
  out="$PKG_DIR/SKILL.md.inline-fallback"
  {
    cat "$PKG_DIR/SKILL.md"
    printf '\n\n<!-- ===== inline-fallback: bundled templates ===== -->\n\n'
    for f in "$TEMPLATES_DIR"/*; do
      base=$(basename "$f")
      printf '\n## Bundled template: %s\n\n```\n' "$base"
      cat "$f"
      printf '```\n'
    done
  } > "$out"
  ok "inline-fallback written to $out"
}

cmd_all() {
  cmd_boundary
  cmd_privacy
  cmd_magic_wand
  cmd_placeholder_syntax
  ok "all invariants pass."
}

case "${1:-all}" in
  boundary)              cmd_boundary ;;
  privacy)               cmd_privacy ;;
  magic-wand)            cmd_magic_wand ;;
  placeholder-syntax)    cmd_placeholder_syntax ;;
  placeholders)          cmd_placeholder_syntax ;;  # legacy alias
  all|"")                cmd_all ;;
  --inline-fallback)     cmd_inline_fallback ;;
  -h|--help|help)
    sed -n '2,18p' "$0"
    exit 0 ;;
  *)
    fail "unknown subcommand: $1 (try: boundary, privacy, magic-wand, placeholder-syntax, all, --inline-fallback)" ;;
esac
