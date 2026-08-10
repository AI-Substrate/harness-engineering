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

## Ruling #1 (2026-08-05, pij-related-koala — coder fence questions 1–3)

- **Q1 (D2 shape) — CONFIRMED.** Three places independently decide "is this axis
  measured" (`scorer.ts` wrong, `report.ts` `axisMeasured()` right, `ledger.ts`
  `scorable()` right), so `report.md` was honest only by RE-DERIVING what the
  scorer got wrong. That is the same "one implementation, not two" failure
  FX001's D1 ruled on. `AxisScores` → `number|null` in the scorer; report and
  ledger CONSUME it. Conditions: the back-compat reader must never coerce
  `null → 0` downstream; `ledger-view.ts` ruled in or out explicitly; and the log
  must state that HISTORIC `report.json` rows carry numeric `0` for unmeasured
  axes and cannot be retroactively corrected (prospective, like FX001's D2/D4).
- **Q2 (new `corpus-floor` assertion type) — APPROVED, additive-only.** The
  existing vocabulary is all presence-greps; "every AC served by ≥1 task" needs
  to parse and count, and a typed tested assertion beats hiding dd semantics in a
  shell string. **Condition**: an UNKNOWN assertion type must resolve `unknown` —
  never crash, never pass — with a control. The vocabulary is first-party (all
  consumer scenarios are in-repo), so this is not FX001's closed-set problem.
- **Q3 (base-ref) — REDIRECTED.** Full-oid comparison is right for the
  abbreviated-vs-full case, but the coder's consequence — a scenario declaring
  `ref: 'HEAD'` can NEVER warn — installs a control that cannot fail, inside a fix
  whose whole purpose is that the instrument stops asserting what it did not
  establish. `scaffold` writes `ref: 'HEAD'` BY DEFAULT, so that would ship a
  permanently inert check. **Rule**: a literal `HEAD` is not a pinned base, it is
  the ABSENCE of one — surface it as its own state (the run is not reproducible),
  not as silence. A third state, not a permanent pass.
- **Hole flagged in the coder's D1 discriminator**: `evidence.source` (buffer =
  trustworthy) correctly handles D2 (the roll destroying the code) but NOT D4 — a
  pre-D4 buffer segment has no `command_exit` for a refusal at all, so `source:
  buffer` proves the roll did not eat the code, not that the capture ever fired.
  Suggested shape (design is the coder's): ask whether the refusal lane has
  DEMONSTRATED it can record — e.g. ≥1 `command_exit` carrying a code anywhere in
  the session — a capability proof rather than a date proof, which keeps a genuine
  `fail` reachable.

**Finding routed (not fixed here — forbidden path):** the CLI↔extension lock-step
proof at `harness/cli/test/extensions/flow-eval/session-evidence-lockstep.test.ts`
is DEAD. `tsc` runs `-p harness/cli/tsconfig.json` whose `include` is `['src']`,
and vitest transpiles without typechecking, so nothing typechecks it; its SAMPLE
already omits four required `CliEvidence` fields (`token_evidence`, `refusals`,
`source`, `ref_checked`) and no gate notices. Proved by the coder with a throwaway
tsconfig. FX001 reported this as a suspicion; this establishes the mechanism.

## Ruling #2 (2026-08-05, pij-related-koala — review round 2, MAJOR FX003-R2)

**The reviewer's finding is CONFIRMED** — I read the path rather than taking the
report. `parseSessionEvidence` validates `refusals` only as "an object of finite
numbers" (`isNumMap`), so two malformed maps survive and then license a `fail`:

- `{ malformed: 1 }` — a key that is not an error code at all.
- `{ E440: 0.5 }` — finite and `> 0`, so `refusalCount` returns it as evidence.

Either makes `refusalLaneDemonstrated` true, and a query naming an absent `E443`
then resolves **`fail`** — the exact false accusation D1 exists to prevent, arriving
by a different door.

**AND ITS OTHER FACE, WHICH THE REVIEW DID NOT NAME.** `gateRefused` with no `code`
param sums `refusalCount` across *all* values, so `{ malformed: 5 }` gives
`observed = 5 >= min = 1` and resolves **`pass`**. That is a false GREEN on
`gate-refused` — the instrument certifying that a gate stopped the subject when
nothing did. It is arguably worse than the false red: a false fail gets argued with,
a false pass gets believed. **Control both directions or the fix is half done.**

**This predicate has now been wrong FOUR ways**, every time the same mistake —
taking the presence of a structure for evidence of the thing:

1. a boolean where three states were needed;
2. `source: 'buffer'` as a date proof, blind to a capture that never fired;
3. a KEY where a positive COUNT is the evidence;
4. a WELL-FORMED-LOOKING key/value where a *valid* one is the evidence.

The comment table beside the predicate gets a fourth row.

**Fix direction (design is the coder's):**

- **Exclude invalid entries; do NOT reject the payload.** Refusing the whole
  envelope over one unrecognised refusal key would discard good skill/verb evidence —
  the precise over-claiming the coder already corrected once in R1b. An invalid entry
  contributes nothing and is otherwise inert.
- **One place decides validity, as R1a established.** Key shape and magnitude are
  decided in the same helper `refusalCount` already owns, used by *both* the observed
  sum and the lane-demonstrated predicate, so the two can never disagree about what a
  refusal is. Counts must be positive **integers** — a fractional occurrence count is
  not an occurrence.
- **Name the closed-set decision out loud.** A key regex is a *closed vocabulary of
  error codes*, and a code shape we did not anticipate would be silently discarded —
  pushing a genuine `fail` to `unknown`. That direction is the safe one and is
  acceptable, but it must be a **stated decision with a comment**, not an accident:
  FX001's first defect was a closed set nobody declared.

**Controls — both polarities, every one must fire pre-fix:**

- `{ malformed: 1 }` + query `E443` ⇒ `unknown` (pre-fix: `fail`).
- `{ E440: 0.5 }` + query `E443` ⇒ `unknown` (pre-fix: `fail`).
- `{ malformed: 5 }` + bare `gate-refused` ⇒ NOT `pass` (pre-fix: `pass`). **This is
  the false-green control; it is the one most likely to be forgotten.**
- Guards kept: `{ E440: 2 }` + query `E443` still `fail`; `{ E440: 2 }` bare still
  `pass`; `{ E440: 0, E441: 2 }` still licenses a fail on `E443`.
