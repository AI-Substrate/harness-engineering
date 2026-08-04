# Proposal — pre-commit telemetry capture

**Status**: **ACCEPTED — o-prime ruling of 2026-08-04
(`government/rulings/2026-08-04-pre-commit-telemetry-capture.md`), PROCEED
under five binding conditions.** Build lands on this plan (phase 2); the
enablement commit (the hook file itself) returns to the o-prime gated on C3's
measured numbers. Option 2 (separate opt-in) struck as already-solved: hooks
here are opt-in per clone via `just install-hooks` already.

## The five binding conditions (verbatim intent, condensed)

- **C1 — `set -u` is BANNED; `trap "exit 0" EXIT` must be the first executable
  line.** Git HONOURS pre-commit's exit code (unlike post-commit's, which it
  ignores) — the o-prime measured that copying post-commit's `set -uo
  pipefail` idiom into pre-commit **ate the commit** on an unbound variable
  before any `|| true`/`exit 0` guard could run. Exit-0 must be unconditional
  via trap, not discipline.
- **C2 — `git commit --amend` fires this hook** (measured matrix: commit YES,
  amend YES; rebase-replay/cherry-pick/merge-no-ff NO). On amend, HEAD is the
  parent of the commit being REPLACED — the segment anchors to a discarded
  commit. The implementation must state its disposition (dedupe / supersede /
  accept-as-noise), test it, and record the quiet ops as MEASURED.
- **C3 — latency measured UNDER FLEET LOAD, never idle.** p95 with the fleet
  running, plus the idle number reported separately and labelled idle — both,
  or the enablement gate is not met. (The o-prime's own logged error: an idle
  measurement of post-commit said "near-instant"; under load it was 2m39s.
  Pre-commit is on the critical path of every commit — s065 was 84+ commits.)
- **C4 — the budget must be an instrument, not a comment**: hook duration
  surfaced by `harness doctor` (which already warns on hook state), or an
  explicit recorded decision that latency is deliberately unmonitored. A
  control only ever run against good input has been demonstrated, not tested.
- **C5 — both kill switches ship with known-bad fixtures**: each proves no-op
  WHEN SET **and** captures WHEN UNSET — the second half is the one that gets
  skipped, and without it a permanently-broken hook passes its own kill-switch
  test forever.

**Header ask**: the new hook carries a safety-rationale header equal to
post-commit's, saying plainly that ITS EXIT CODE IS HONOURED where
post-commit's is ignored.

**Closed by the o-prime**: `.harness/temp/` is gitignored (verified), so
capture cannot dirty the tree or index.

## Enablement rulings (o-prime, 2026-08-04, second ruling)

- **C3: MET; the idle baseline is formally WAIVED, not deferred.** The idle
  number was a guard against mislabeling an idle measurement as general — the
  box was never idle (load1 54–76 / 16 cores all phase), the coder refused to
  mint the label, and demanding the number anyway would require the very
  fabrication the condition existed to prevent. The load numbers stand: p95
  217–485 ms vs the 2000 ms budget (~4× headroom, worst case, real captures
  per fire; ~45 s total on a 94-commit stream).
- **Merge-as-enablement APPROVED — the file lands at `.githooks/pre-commit`,
  no inert parking.** The auto-armed population is exactly the population
  that already opted into hooks on identical terms, and C4's doctor gauge
  means drift on another box surfaces instead of rotting. The coder's
  surfacing of the auto-arm fact ("worth more than the answer") is on the
  record.
- **Binding addendum: the latency harness must be TRACKED under `scripts/`**
  and referenced from the hook header — an instrument in gitignored scratch
  leaves a measurement without the ability to re-measure, which is a
  demonstrated control rather than a tested one.
- C1 noted as exceeding the ask: the eaten-commit incident is now a permanent
  CI test pair (trap present = commit lands; trap removed = commit eaten).

## Problem

File-event → commit attribution anchors on the `product_commit` observed at
capture time, so evidence anchors correctly ONLY when some harness verb runs
between editing and committing. Today that correctness is **rhythm-dependent**:
the work prompts must say "run `harness checks` before every commit", and when
an agent (or human) skips it, the post-commit hook's capture fires *after*
HEAD moves — anchoring the evidence one commit late. Measured live twice
during the 066 work (the all-zeros attribution table; my own adapter-fix
commit anchoring to itself). A discipline that must be prompted is a
discipline that will be skipped.

## Design (fail-safe by construction)

A `pre-commit` hook that runs **capture only — never sync, never push, never
checks**:

1. Runs the capture preamble for the active session (the same code path every
   harness verb already runs), buffering one segment with `product_commit` =
   current HEAD = the about-to-be-parent. Nothing else.
2. **Exit 0 always** — capture failure, missing CLI, missing node_modules,
   detached HEAD: all silent no-ops. The hook can never block or fail a
   commit. (Same contract the post-commit hook already honours.)
3. **No subprocess fan-out**: capture spawns no push, no gate, no recursive
   git operations — the recursion class that caused the load-175 incident
   (a pre-push gate whose own push re-fired it) is structurally absent: a
   capture cannot trigger a commit.
4. **Kill switches**: honours `HARNESS_NO_TELEMETRY=1` (existing) plus a
   dedicated `HARNESS_NO_TELEMETRY_PRECOMMIT=1`, so the hook can be disarmed
   without losing post-commit flush behaviour.
5. **Time budget, measured before enabling**: capture is in-process and fast
   for normal windows (sub-second observed), but a first capture of a very
   long transcript can be slower — the enablement gate is a measured p95 on
   this repo's real sessions, with a documented budget (proposed: warn in the
   hook comment if >2s is ever observed; never enforce via timeout-kill,
   which would strand cursors).

## What it buys

- Anchoring becomes deterministic — the flush-timing skew class (misattributed
  commits, over/under-counted agent share) dies for every harness at once.
- The "run checks before commit" prompt line demotes from load-bearing to good
  practice; agents can no longer silently break attribution by skipping it.

## Risks, stated against the house history

- The repo removed a pre-commit-adjacent gate before (pre-push checks) after
  recursion; this hook shares the *location* but not the *mechanism* — no
  push, no gate, no way to re-enter git. The honest residual risks are (a)
  latency on giant-transcript first-captures and (b) one more moving part in
  every commit. (a) is bounded by measurement-before-enable; (b) is the price
  of deterministic attribution.
- Interaction with 067: the post-commit hook remains the flush point; this
  hook only buffers. A commit therefore runs capture (pre) + sync (post,
  ~0.2s since 067). Combined budget stays well under a second in steady state.

## Ask

A ruling on: (1) proceed to implementation (own plan + pair fleet + tests
including a hook-latency measurement harness), (2) proceed but opt-in per
clone (separate hooksPath target), or (3) reject with reasons recorded here.
