# FX003 — the eval instrument states what it measured, or declines to answer

**Mode**: standalone fix (docs/fixes/) · **CS**: 3 · **Domains**: flow-eval extension (scorer, resolvers, report), dd-native-builder scenario
**Origin**: found 2026-08-05 while reading the two live `dd-native-builder` runs after FX001 unblocked the telemetry lane.
**Branch**: `s065/fx003-flow-eval-instrument`, cut from `be49dd32` (PR #95's frozen green head) so #95 stays mergeable.
**Ordinal**: requested from prime (FX ordinals are prime-allocated). FX002 is separately allocated for the adopted-root-seat capture gap and is NOT in this fix.

## The theme

FX001 was one defect repeated at four depths: **a lookup reporting an absence it
had not established**. The eval instrument has the same defect, in its own
fold — and one of them was *armed by FX001 itself*.

The resolvers are scrupulous about this already. Their contract says a missing or
errored evidence object resolves `unknown`, **NEVER `fail`** — "a capability gap
is not a subject failure — the determinism boundary." Then the layer above
throws that care away.

## Defects

| # | Sev | Where | Defect |
|---|-----|-------|--------|
| D1 | **HIGH** | `resolvers.ts` `gateRefused` | Returns a BOOLEAN, not `unknown`, when evidence is PRESENT and `refusals` is empty. **FX001 armed this**: before, evidence was null so the branch was unreachable; now evidence resolves, so a subject that WAS correctly stopped scores a **false RED** — "the subject dodged the gate". A false accusation is worse than an honest unknown. |
| D2 | **HIGH** | `scorer.ts` axis fold | `process: procDenom === 0 ? 0 : …` — an axis with ZERO evidence renders as `0`, pixel-identical to "failed every process check". Both live runs read `process: 0` while measuring nothing. An axis that cannot answer must say so, not answer zero. |
| D3 | MED | `report.ts` / base-ref check | The base-ref warning compares an ABBREVIATED sha to a FULL one with string inequality: `worktree HEAD f947a2fc ≠ base_ref f947a2fc49928…` — the same commit. Fires a false "your worktree was not cut from the declared base" on a correctly-cut worktree. |
| D4 | MED | `dd-native-builder/assertions.json` A5/A6 | `file-content-matches` with substring patterns `"pressure"` / `"satisfies"`. ONE task row carrying the key passes. A one-AC, one-task corpus scores identically to real work. |
| D5 | MED | `dd-native-builder/assertions.json` A9 | `dd doctor` over a corpus with nothing new in it is clean **by vacuity** — it passed in a run where the subject authored NO dd documents at all. Cannot distinguish correct work from no work. |
| D6 | LOW | scorer / runbook | An unresolved `--resolve` placeholder silently burns a row as `unknown` (cost us A11 twice). The scorer knows the placeholder is unresolved; it should SAY so distinctly rather than let it read as ordinary absent evidence. |

## Fix shape (direction, not prescription — the coder owns the design)

- **D1** — three-valued, like every other resolver: refusals present ⇒ `pass`;
  refusals absent **and the refusal lane is known-good** ⇒ `fail`; refusals
  absent and the lane cannot be trusted ⇒ `unknown`. Note the lane could not be
  trusted for ANY session captured before FX001's D2/D4 landed (codes were never
  encoded), so "empty refusals" alone can never justify a `fail` on historic
  bytes. If distinguishing those is not possible from the evidence object, say so
  and default to `unknown` — the safe direction is the honest one.
- **D2** — an axis with no resolved assertions is not `0`. Represent it as
  `null`/absent and render it as such (`process: n/a (0 of 4 measurable)` beats
  `process: 0`). Anything consuming `axis_scores` must handle the absent case
  rather than coercing it back to zero. Check the ledger/`ledger-view` too.
- **D3** — compare shas at a common length, or resolve both to full oids before
  comparing. Control: an abbreviated-vs-full pair of the SAME commit must NOT warn.
- **D4/D5** — add a non-vacuity floor rather than more presence greps: minimum
  cardinality (ACs, tasks, phases) and/or coverage (every AC served by ≥1 task).
  **Do NOT re-implement `plan validate`** — anything the validator already refuses
  (dangling links, orphan criteria, unchecked completables) stays its job; a
  parallel check that drifts becomes a second source of truth, which is the exact
  failure A3 exists to catch, one level up.
- **D6** — a distinct status or note for "placeholder never resolved", so an
  operator error cannot masquerade as missing subject evidence.

## Controls — planted-bad BOTH ways, every one must FIRE pre-fix

The whole point of this fix is that the instrument stops reporting conclusions it
did not reach, so a control that cannot fail is worse than useless here.

- D1: a session with evidence present + empty refusals + an untrustworthy refusal
  lane ⇒ `unknown` (pre-fix: `fail`). **And the guard**: a genuine refusal still
  scores `pass`, and a genuine no-refusal on a trustworthy lane still scores `fail`
  — a fix that makes everything `unknown` is less useful, not more honest.
- D2: an axis with zero resolved assertions ⇒ absent, not `0` (pre-fix: `0`).
  Guard: an axis that genuinely scored 0/3 still reports `0`.
- D3: abbreviated-vs-full sha of the same commit ⇒ no warning (pre-fix: warns).
  Guard: a genuinely different base still warns.
- D4/D5: a trivial one-AC/one-task corpus ⇒ fails the floor (pre-fix: passes).
  Guard: a real corpus still passes.
- D6: unresolved placeholder ⇒ distinct status (pre-fix: plain `unknown`).

## Constraints (fence for the fix pair)

- Allowed: `.harness/extensions/flow-eval/**`,
  `live-testing/scenarios/dd-native-builder/**`, `docs/fixes/FX003-*`.
- Forbidden: `harness/cli/src/**` and `harness/cli/test/**` (FX001 just landed
  there and PR #95 is awaiting merge — do not touch it), `docs/plans/**`, any
  the-flow file, `.harness/live-testing/**` ledgers and run dirs (those are
  RESULTS, never inputs), any push (the orchestrator pushes).
- **Do not re-score or run a live eval.** This fix is about the instrument; a new
  ledger row is not evidence of anything here.
- Branch `s065/fx003-flow-eval-instrument` only. **Never commit to
  `s065/deterministic-documents`** — its head is frozen green awaiting merge.

## Review

Cross-model review, same discipline as FX001: **Dim-0 mutation gate first and
blocking** (every control must be shown to FAIL against pre-fix source), then fix
verification, then no-regression (full suite + `harness checks` warn trio
byte-identical to the baseline at dispatch: arch 2 / markdown 196 / windows 6).

## Out of scope — route, do not fix

- The adopted-root-seat capture gap (no `PIJ_SESSION_ID` for adopted seats, so our
  own exemplar seat is unscorable) — that is **FX002**, separately allocated.
- Anything in `harness/cli/**`.
- The `checks` double-count on main (069/adapter, two producers per run) — routed
  to prime.
