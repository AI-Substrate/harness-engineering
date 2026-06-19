#!/usr/bin/env bash
# score-flow-eval.sh — deterministic gate for the the-flow migration eval
# (plan 027 / workshop 005). Re-derives the checks from run artifacts — NOT the
# agent's self-grade. Exit 0 = PASS, non-zero = FAIL (CI-gradable).
#
# Usage:
#   scripts/score-flow-eval.sh [FLOW_JSON] [EVENTS_NDJSON]
#   # With no args: resolve the latest run via `minih last-run flow-skill-eval`.
#
# Env:
#   HARNESS   override the CLI command (default: node harness/cli/bin/harness.js
#             if present, else `harness`). May be multi-word.

set -uo pipefail

FLOW="${1:-}"
EVENTS="${2:-}"

# --- CLI resolution (local HEAD bin preferred; has nav/rail) -------------------
if [ -n "${HARNESS:-}" ]; then HARNESS_CMD="$HARNESS"
elif [ -f harness/cli/bin/harness.js ]; then HARNESS_CMD="node harness/cli/bin/harness.js"
else HARNESS_CMD="harness"; fi
hflow() { $HARNESS_CMD flow "$@"; }

fail() { echo "❌ FAIL: $1" >&2; exit 1; }
ok()   { echo "✅ $1"; }

# --- Resolve FLOW + EVENTS from the latest run if not passed ------------------
if [ -z "$FLOW" ]; then
  RUN_JSON="$(minih last-run flow-skill-eval 2>/dev/null)" || fail "minih last-run flow-skill-eval failed"
  REPORT="$(printf '%s' "$RUN_JSON" | jq -r '.data.reportPath // empty')"
  RUN_DIR="$(printf '%s' "$RUN_JSON" | jq -r '.data.runDir // .data.dir // empty')"
  [ -z "$RUN_DIR" ] && [ -n "$REPORT" ] && RUN_DIR="$(dirname "$(dirname "$REPORT")")"
  if [ -n "$REPORT" ] && [ -f "$REPORT" ]; then
    FLOW="$(jq -r '.flowPath // empty' "$REPORT" 2>/dev/null)"
  fi
  [ -n "$RUN_DIR" ] && [ -z "$EVENTS" ] && EVENTS="$RUN_DIR/events.ndjson"
fi

[ -n "$FLOW" ] && [ -f "$FLOW" ] || fail "flow JSON not found (FLOW='$FLOW')"
echo "scoring flow: $FLOW"
[ -n "${EVENTS:-}" ] && echo "events:        $EVENTS"

# --- GATE 1: rail title is [the-flow] ----------------------------------------
RAIL="$(hflow rail --path "$FLOW" 2>/dev/null | jq -r '.data.rail // empty')"
[ -n "$RAIL" ] || fail "could not read rail (is the flow valid?)"
echo "rail: $RAIL"
case "$RAIL" in
  "[the-flow]"*) ok "GATE 1 — rail title is [the-flow]" ;;
  *) fail "GATE 1 — rail title is not [the-flow] (un-migrated create omits --agent the-flow → slug title): $RAIL" ;;
esac

# --- GATE 2: rail is spine-only (no Workshop/ADR text) ------------------------
case "$RAIL" in
  *Workshop*|*workshop*|*ADR*|*adr*) fail "GATE 2 — rail not clean; an excursion leaked onto the spine" ;;
  *) ok "GATE 2 — rail clean (no workshop/adr on the spine)" ;;
esac

# --- GATE 3: >=1 workshop AND every workshop/adr is a branch_of excursion -----
# The >=1 guard prevents a vacuous pass when there are zero workshops.
if jq -e '
  [ .nodes[] | select(.type=="workshop" or .type=="adr") ] as $w
  | ($w | length) > 0
    and ([ $w[] | select((.branch_of // "") == "") ] | length) == 0
' "$FLOW" >/dev/null 2>&1; then
  ok "GATE 3 — >=1 workshop/adr present AND all are branch_of excursions"
else
  fail "GATE 3 — need >=1 workshop/adr AND every one must carry a non-empty branch_of"
fi

# --- GATE 4: spine has research + plan + >=1 phase ----------------------------
SPINE="$(jq -r '[ .nodes[] | select((.branch_of // "") == "") | .type ] | join(" ")' "$FLOW")"
echo "spine: $SPINE"
case " $SPINE " in *" research "*) ;; *) fail "GATE 4 — spine missing research" ;; esac
case " $SPINE " in *" plan "*)     ;; *) fail "GATE 4 — spine missing plan" ;; esac
case " $SPINE " in *" phase "*)    ;; *) fail "GATE 4 — spine missing >=1 phase" ;; esac
ok "GATE 4 — spine shape has research + plan + phase"

# --- GATE 5: the flow validates (render exit 0; no E300/E308/E309) ------------
TMP="$(dirname "$FLOW")/.score-render.md"
if hflow render --path "$FLOW" --output "$TMP" >/dev/null 2>&1; then
  rm -f "$TMP"; ok "GATE 5 — flow validates (render exit 0)"
else
  rm -f "$TMP" 2>/dev/null
  fail "GATE 5 — flow does not validate (render non-zero — E300/E308/E309?)"
fi

# --- GATE 6: NO .the-flow-state.json under the eval scratch dir (plan 030) ----
# The migrated the-flow eliminates the hand-written state file; position lives in
# nav. This is the discriminating gate: un-migrated authors the file → FAIL.
EVAL_DIR="$(dirname "$FLOW")"
if find "$EVAL_DIR" -name '.the-flow-state.json' 2>/dev/null | grep -q .; then
  fail "GATE 6 — a .the-flow-state.json was authored under $EVAL_DIR (un-migrated the-flow hand-writes it; migrated must not)"
else
  ok "GATE 6 — no .the-flow-state.json under the eval scratch dir (state lives in nav)"
fi

# --- GATE 7: position derivable from the flight plan alone (nav.now real) -----
NOW="$(hflow nav show --path "$FLOW" 2>/dev/null | jq -r '.data.nav.now // empty')"
if [ -n "$NOW" ] && [ "$NOW" != "null" ]; then
  ok "GATE 7 — nav.now resolves to a real node ($NOW) — cold resume needs no state file"
else
  fail "GATE 7 — nav.now empty; position not derivable from the flight plan without a state file"
fi

# --- ADVISORY (not a gate): events show nav, not cursor ----------------------
if [ -n "${EVENTS:-}" ] && [ -f "$EVENTS" ]; then
  if grep -q 'flow nav' "$EVENTS" 2>/dev/null && ! grep -q 'flow cursor' "$EVENTS" 2>/dev/null; then
    ok "advisory — events show 'flow nav' and no 'flow cursor'"
  else
    echo "⚠️  advisory: events did not clearly show nav-without-cursor (structural gates are authoritative)" >&2
  fi
else
  echo "ℹ️  advisory: events.ndjson not found — skipping nav/cursor corroboration" >&2
fi

echo
echo "✅ ALL GATES PASS — migrated the-flow authors a clean, spine-only flight plan with NO state file (position in nav)"
exit 0
