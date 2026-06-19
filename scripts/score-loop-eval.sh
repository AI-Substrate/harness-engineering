#!/usr/bin/env bash
# score-loop-eval.sh — deterministic gate for the eng-harness-flow STANDALONE LOOP
# eval (plan 032 T202 / AC-10). Re-derives the checks from the driven flow file —
# NOT the agent's self-grade. Exit 0 = PASS, non-zero = FAIL (CI-gradable).
#
# Usage:
#   scripts/score-loop-eval.sh [FLOW_JSON]
#   # With no arg: resolve the latest run via `minih last-run loop-flow-eval`.
#
# Env:
#   HARNESS   override the CLI command (default: node harness/cli/bin/harness.js
#             if present, else `harness`). May be multi-word.

set -uo pipefail

FLOW="${1:-}"

# --- CLI resolution (local HEAD bin preferred; has nav/rail/chores) ------------
if [ -n "${HARNESS:-}" ]; then HARNESS_CMD="$HARNESS"
elif [ -f harness/cli/bin/harness.js ]; then HARNESS_CMD="node harness/cli/bin/harness.js"
else HARNESS_CMD="harness"; fi
hflow() { $HARNESS_CMD flow "$@"; }
hjson() { $HARNESS_CMD --json flow "$@"; }

fail() { echo "❌ FAIL: $1" >&2; exit 1; }
ok()   { echo "✅ $1"; }

# --- Resolve FLOW from the latest run if not passed ---------------------------
if [ -z "$FLOW" ]; then
  RUN_JSON="$(minih last-run loop-flow-eval 2>/dev/null)" || fail "minih last-run loop-flow-eval failed"
  REPORT="$(printf '%s' "$RUN_JSON" | jq -r '.data.reportPath // empty')"
  [ -n "$REPORT" ] && [ -f "$REPORT" ] && FLOW="$(jq -r '.flowPath // empty' "$REPORT" 2>/dev/null)"
fi

[ -n "$FLOW" ] && [ -f "$FLOW" ] || fail "loop flow JSON not found (FLOW='$FLOW')"
echo "scoring loop flow: $FLOW"

# --- GATE 1: rail title is [harness-loop] ------------------------------------
RAIL="$(hjson rail --path "$FLOW" 2>/dev/null | jq -r '.data.rail // empty')"
[ -n "$RAIL" ] || fail "could not read rail (is the flow valid?)"
echo "rail: $RAIL"
case "$RAIL" in
  "[harness-loop]"*) ok "GATE 1 — rail title is [harness-loop]" ;;
  *) fail "GATE 1 — rail title is not [harness-loop]: $RAIL" ;;
esac

# --- GATE 2: loop spine shape (boot + observe + a retro + improve), acyclic ---
SPINE="$(jq -r '[ .nodes[] | select((.branch_of // "") == "") | .id ] | join(" ")' "$FLOW")"
echo "spine: $SPINE"
for need in boot observe improve; do
  case " $SPINE " in *" $need "*) ;; *) fail "GATE 2 — loop spine missing '$need'" ;; esac
done
# at least one retro node (retro-drain / retro-harvest / retro)
if jq -e '[ .nodes[] | select(.type=="retro") ] | length >= 1' "$FLOW" >/dev/null 2>&1; then
  :
else fail "GATE 2 — loop spine has no retro node"; fi
# acyclic terminal: improve has no outgoing edge (cycle = nav reset, not a back-edge)
if jq -e '.nodes[] | select(.id=="improve") | (.next | length) == 0' "$FLOW" >/dev/null 2>&1; then
  ok "GATE 2 — loop spine shape (boot · observe · retro · improve), improve terminal (acyclic)"
else fail "GATE 2 — improve is not terminal (improve.next must be [] — the cycle is a nav reset)"; fi

# --- GATE 3: nav.now resolves to a real node ---------------------------------
NOW="$(hjson nav show --path "$FLOW" 2>/dev/null | jq -r '.data.nav.now // empty')"
if [ -n "$NOW" ] && [ "$NOW" != "null" ] && jq -e --arg n "$NOW" 'any(.nodes[]; .id==$n)' "$FLOW" >/dev/null 2>&1; then
  ok "GATE 3 — nav.now resolves to a real node ($NOW)"
else fail "GATE 3 — nav.now empty or dangling ('$NOW')"; fi

# --- GATE 4: the flow validates (render exit 0; no E300/E308/E309) ------------
TMP="$(dirname "$FLOW")/.score-loop-render.md"
if hflow render --path "$FLOW" --output "$TMP" >/dev/null 2>&1; then
  rm -f "$TMP"; ok "GATE 4 — flow validates (render exit 0)"
else rm -f "$TMP" 2>/dev/null; fail "GATE 4 — flow does not validate (render non-zero)"; fi

# --- GATE 5: the four fire nodes carry their --hook commands ------------------
# The standalone loop is self-documenting: boot/backpressure/retro-drain/retro-harvest
# each carry `run /eng-harness-flow --hook <X>`. Assert all four hook tokens present.
CMDS="$(jq -r '[ .nodes[] | .command // empty ] | join("\n")' "$FLOW")"
MISSING=""
for hook in pre-flight pre-coding post-coding post-flight; do
  printf '%s\n' "$CMDS" | grep -q -- "--hook $hook" || MISSING="$MISSING $hook"
done
if [ -z "$MISSING" ]; then
  ok "GATE 5 — all four fire hooks present as node commands (pre-flight·pre-coding·post-coding·post-flight)"
else fail "GATE 5 — missing --hook command(s):$MISSING"; fi

echo
echo "✅ ALL GATES PASS — the standalone harness loop is a real, CLI-driven flight plan: [harness-loop] rail, acyclic loop spine, nav.now resolves, renders clean, and carries the four fire-hook commands."
exit 0
