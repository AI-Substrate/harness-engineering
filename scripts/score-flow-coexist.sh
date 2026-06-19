#!/usr/bin/env bash
# score-flow-coexist.sh — deterministic gate for the the-flow + eng-harness-flow
# COEXISTENCE eval (plan 032 T203 / AC-11 + AC-13). Re-derives the checks from the
# the-flow.json the loop injected chores into — NOT the agent's self-grade.
# Exit 0 = PASS, non-zero = FAIL (CI-gradable).
#
# Usage:
#   scripts/score-flow-coexist.sh THE_FLOW_JSON [REINJECTED_JSON]
#     THE_FLOW_JSON   the-flow.json after the loop injected its four fire-hook chores
#     REINJECTED_JSON (optional) a second snapshot after re-running the injection;
#                     present → G2 asserts byte-identical node sets (idempotency)
#   # With no args: resolve the latest run via `minih last-run flow-coexist-eval`.
#
# Env:
#   HARNESS   override the CLI command (default: node harness/cli/bin/harness.js
#             if present, else `harness`). May be multi-word.

set -uo pipefail

FLOW="${1:-}"
FLOW2="${2:-}"

if [ -n "${HARNESS:-}" ]; then HARNESS_CMD="$HARNESS"
elif [ -f harness/cli/bin/harness.js ]; then HARNESS_CMD="node harness/cli/bin/harness.js"
else HARNESS_CMD="harness"; fi
hflow() { $HARNESS_CMD flow "$@"; }
hjson() { $HARNESS_CMD --json flow "$@"; }

fail() { echo "❌ FAIL: $1" >&2; exit 1; }
ok()   { echo "✅ $1"; }

# --- Resolve FLOW from the latest run if not passed ---------------------------
if [ -z "$FLOW" ]; then
  RUN_JSON="$(minih last-run flow-coexist-eval 2>/dev/null)" || fail "minih last-run flow-coexist-eval failed"
  REPORT="$(printf '%s' "$RUN_JSON" | jq -r '.data.reportPath // empty')"
  if [ -n "$REPORT" ] && [ -f "$REPORT" ]; then
    FLOW="$(jq -r '.theFlowPath // .flowPath // empty' "$REPORT" 2>/dev/null)"
    FLOW2="${FLOW2:-$(jq -r '.reinjectedPath // empty' "$REPORT" 2>/dev/null)}"
  fi
fi

[ -n "$FLOW" ] && [ -f "$FLOW" ] || fail "the-flow JSON not found (FLOW='$FLOW')"
echo "scoring the-flow (with injected chores): $FLOW"
EVAL_DIR="$(dirname "$FLOW")"

HOOKS="pre-flight pre-coding post-coding post-flight"

# --- GATE 1: exactly 4 chore nodes, one per fire-hook token (dedup key) -------
# A chore = a node carrying `.chore`; its `command` must name `/eng-harness-flow
# --hook <hook>`. Dedup key = the `--hook <X>` token: exactly one chore per hook.
CHORE_CMDS="$(jq -r '[ .nodes[] | select(.chore != null) | .command // "" ] | .[]' "$FLOW" 2>/dev/null)"
TOTAL_CHORES="$(printf '%s\n' "$CHORE_CMDS" | grep -c '/eng-harness-flow --hook ' || true)"
DUPES=0; MISSING=""
for hook in $HOOKS; do
  c="$(printf '%s\n' "$CHORE_CMDS" | grep -c -- "--hook $hook" || true)"
  [ "$c" -eq 0 ] && MISSING="$MISSING $hook"
  [ "$c" -gt 1 ] && DUPES=$((DUPES + 1))
done
[ -z "$MISSING" ] || fail "GATE 1 — missing fire-hook chore(s):$MISSING"
[ "$DUPES" -eq 0 ] || fail "GATE 1 — duplicate chore(s) for $DUPES hook(s) (dedup on --hook token failed)"
[ "$TOTAL_CHORES" -eq 4 ] || fail "GATE 1 — expected exactly 4 fire-hook chores, found $TOTAL_CHORES"
ok "GATE 1 — exactly 4 fire-hook chores, one per --hook token (pre-flight·pre-coding·post-coding·post-flight)"

# --- GATE 2: injection is idempotent -----------------------------------------
if [ -n "$FLOW2" ] && [ -f "$FLOW2" ]; then
  if diff <(jq -S '.nodes' "$FLOW") <(jq -S '.nodes' "$FLOW2") >/dev/null 2>&1; then
    ok "GATE 2 — re-injection produced a byte-identical node set (idempotent)"
  else fail "GATE 2 — re-injection changed the node set (not idempotent)"; fi
else
  # No second snapshot → the dedup invariant from GATE 1 is the idempotency proxy.
  ok "GATE 2 — dedup invariant holds (exactly one chore per hook); no re-injection snapshot supplied for byte-diff"
fi

# --- GATE 3: nav.now still resolves to a real node ---------------------------
NOW="$(hjson nav show --path "$FLOW" 2>/dev/null | jq -r '.data.nav.now // empty')"
if [ -n "$NOW" ] && [ "$NOW" != "null" ] && jq -e --arg n "$NOW" 'any(.nodes[]; .id==$n)' "$FLOW" >/dev/null 2>&1; then
  ok "GATE 3 — nav.now still resolves after injection ($NOW)"
else fail "GATE 3 — nav.now empty or dangling after injection ('$NOW')"; fi

# --- GATE 4: NO .harness/loop.flow.json while the-flow is active --------------
# Search ONLY the eval scratch dir for a standalone loop file (must be absent).
# Never scan the repo root — the tracked `.harness/loop.flow.json` (T104/D-05)
# is a legitimate standalone-loop artifact and would false-fail a correct run.
if find "$EVAL_DIR" -maxdepth 4 -name 'loop.flow.json' 2>/dev/null | grep -q .; then
  fail "GATE 4 — a loop.flow.json exists while the-flow is active (loop must live as chores, not a separate plan)"
else
  ok "GATE 4 — no .harness/loop.flow.json present (loop lives as chores in the-flow.json)"
fi

# --- GATE 5: the four chores are USER-VISIBLE (chores + rail) — AC-13 ---------
CHORE_COUNT="$(hjson chores --path "$FLOW" 2>/dev/null | jq -r '.data.count // 0')"
[ "$CHORE_COUNT" -ge 4 ] || fail "GATE 5 — \`flow chores\` lists $CHORE_COUNT (<4); chores not discoverable"
RAIL="$(hjson rail --path "$FLOW" --chores show 2>/dev/null | jq -r '.data.rail // empty')"
# square pip (□ todo · ■ done · ▨ skipped · ▣ strongly-rec todo) proves chores ride the rail
case "$RAIL" in
  *□*|*■*|*▨*|*▣*) ok "GATE 5 — chores are user-visible: \`flow chores\` lists $CHORE_COUNT and the rail shows chore pips (AC-13)" ;;
  *) fail "GATE 5 — rail shows no chore pips (□/■/▨/▣); the 'stop missing things' outcome is not visible: $RAIL" ;;
esac

echo
echo "✅ ALL GATES PASS — the loop's four fire hooks ride as idempotent, dedup-keyed chores ON the-flow's rail; nav still resolves; no separate loop plan exists. The 'stop missing things' outcome is observable."
exit 0
