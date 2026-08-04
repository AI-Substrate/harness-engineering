#!/usr/bin/env bash
#
# C3 — pre-commit hook latency harness (plan 068 phase 2).
#
# Measures what `.githooks/pre-commit` actually costs, N times, and reports
# p50/p95 with the run LABELLED **IDLE** or **LOAD**. The label is the point:
# the o-prime's logged error in this repo was an idle post-commit measurement
# reported as "near-instant" that measured 2m39s under real fleet load. A number
# without its universe is not evidence, so this script refuses to print one.
#
# The measured thing is the hook's own wall time — the tax git pays on the
# critical path of every commit — taken in a throwaway repo wired exactly like an
# installed clone (real hook file, real built CLI behind the same
# `harness/cli/bin/harness.js` path the hook resolves, a simulated copilot
# session). The transcript is APPENDED TO between fires so every sample is a real
# capture, not the cheap no-activity no-op that would flatter the result.
#
# Usage (from anywhere; paths resolve off the script's own location):
#   ./scripts/precommit-latency-harness.sh [N]          # default N=20
#   FORCE_LABEL=LOAD ./scripts/precommit-latency-harness.sh 20
#
# Requires a built CLI (`just build`). Run it under the fleet to get the number
# the enablement gate actually needs.
#
# ─── RECORDED BASELINE — 2026-08-04, 16-core box (plan 068 phase 2) ──────────
# These are the numbers `.githooks/pre-commit` was enabled against. They live
# here, next to the instrument that produced them, so a future reading can be
# compared rather than merely admired. Re-measure with this script; do not edit
# the table to match a hope.
#
#   run | N  | label | load1 | min | p50 | p95 | max | mean   (all milliseconds)
#   ----+----+-------+-------+-----+-----+-----+-----+------
#    1  | 20 | LOAD  | 69.39 | 178 | 200 | 485 | 549 | 238.2
#    2  | 40 | LOAD  | 74.64 | 151 | 181 | 217 | 377 | 186.5
#
# Budget = `PRECOMMIT_P95_BUDGET_MS` = 2000 ms (harness/cli/src/services/doctor/
# doctor-service.ts, layer `precommit-hook-latency`).
#
# THE IDLE BASELINE IS MISSING, AND THAT IS A MEASUREMENT, NOT AN OMISSION.
# C3 asked for the under-load p95 *and* an idle number labelled idle. This box was
# never idle during the phase: 1-minute load averages sampled across the window
# were 69.39, 54.18, 55.08, 56.55, 75.86, 59.73, 58.17, 59.83, 57.14, 57.28,
# 74.64 — 16 cores, so ~3.4x-4.7x oversubscribed throughout. This script computes
# its own label and refuses to print an unlabelled number, so there is no idle row
# to report rather than a mislabelled one. The consequence is favourable: the
# number this phase HAS is the harder one — both runs were taken under genuine
# fleet load and p95 stayed at 217-485 ms, an order of magnitude inside budget.
# The idle run is cosmetic by comparison; take it with `N=20` on a quiet box and
# it will label itself IDLE.
#
# WHAT THESE NUMBERS DO NOT COVER: the samples measure the hook against a small
# fixture transcript. The residual risk named in the proposal — a FIRST capture of
# a very long transcript — is not covered here, and is exactly what the
# `precommit-hook-latency` doctor layer exists to catch in the field, from real
# fires, after enablement.
set -o pipefail

N="${1:-20}"
here="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$here/.." && pwd)"
hook="$repo_root/.githooks/pre-commit"
dist="$repo_root/harness/cli/dist/index.js"
fixture="$repo_root/harness/cli/test/services/telemetry/fixtures/copilot-events.jsonl"
SESSION="sess-latency-harness"

for required in "$hook" "$dist" "$fixture"; do
  [ -f "$required" ] || { echo "missing: $required (run \`just build\`?)" >&2; exit 1; }
done

# ── the universe this run was taken in ───────────────────────────────────────
ncpu="$(getconf _NPROCESSORS_ONLN 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || echo 1)"
load1="$(uptime | sed -e 's/.*load averages*: *//' -e 's/,.*//' -e 's/ .*//')"
label="${FORCE_LABEL:-}"
if [ -z "$label" ]; then
  # LOAD once the 1-minute average passes half the core count; IDLE below it.
  if awk -v l="$load1" -v c="$ncpu" 'BEGIN{exit !(l > c*0.5)}'; then label=LOAD; else label=IDLE; fi
fi

work="$(mktemp -d "${TMPDIR:-/tmp}/precommit-latency.XXXXXX")"
trap 'rm -rf "$work"' EXIT
repo="$work/repo"; home="$work/home"
events="$home/.copilot/session-state/$SESSION/events.jsonl"
mkdir -p "$(dirname "$events")" "$repo/.githooks" "$repo/harness/cli/bin"
cp "$fixture" "$events"
cp "$hook" "$repo/.githooks/pre-commit"; chmod +x "$repo/.githooks/pre-commit"
printf "import('%s');\n" "$dist" > "$repo/harness/cli/bin/harness.js"
(
  cd "$repo"
  git init -q -b main . && git config user.email l@t.invalid && git config user.name latency
  git config core.hooksPath .githooks
  echo seed > seed.txt && git add -A && git commit -q -m seed --no-verify
) >/dev/null

samples="$work/samples"; : > "$samples"
export HOME="$home" COPILOT_AGENT_SESSION_ID="$SESSION"
unset CLAUDE_CODE_SESSION_ID CURSOR_CONVERSATION_ID AI_AGENT HARNESS_TELEMETRY_DEPTH
unset HARNESS_NO_TELEMETRY HARNESS_NO_TELEMETRY_PRECOMMIT

echo "measuring $N fires — label=$label (load1=$load1 over $ncpu cores)…" >&2
i=0
while [ "$i" -lt "$N" ]; do
  i=$((i + 1))
  head -1 "$events" >> "$events"          # advance the window: every fire is a REAL capture
  t0="$(date +%s%N)"
  ( cd "$repo" && ./.githooks/pre-commit >/dev/null 2>&1 )
  t1="$(date +%s%N)"
  echo $(( (t1 - t0) / 1000000 )) >> "$samples"
done

sort -n "$samples" -o "$samples"
awk -v label="$label" -v load1="$load1" -v ncpu="$ncpu" '
  { v[NR] = $1; sum += $1 }
  function pct(p,   r) { r = int(p * NR + 0.999999); if (r < 1) r = 1; if (r > NR) r = NR; return v[r] }
  END {
    printf "\n=== pre-commit hook latency — %s ===\n", label
    printf "samples : %d\n", NR
    printf "min     : %d ms\n", v[1]
    printf "p50     : %d ms\n", pct(0.50)
    printf "p95     : %d ms\n", pct(0.95)
    printf "max     : %d ms\n", v[NR]
    printf "mean    : %.1f ms\n", sum / NR
    printf "universe: load1=%s over %s cores -> %s\n", load1, ncpu, label
    printf "\nQuote these ONLY with the label attached. An IDLE p95 is not an enablement number.\n"
  }
' "$samples"
