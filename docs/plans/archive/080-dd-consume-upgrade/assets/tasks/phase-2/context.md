# Phase 2 context brief — Round-3 trial: plan semantics on public primitives

**Tasks**: [tasks.dd.json](./tasks.dd.json) (`tk-0006..tk-000b`; read `tasks.dd.md` for the rendered view — never edit either by hand, use `harness dd` verbs)
**Prediction (read FIRST, it is the phase's spine)**: [prediction.md](./prediction.md) — committed `51558dbc`, BEFORE any trial work
**Plan**: [../../../plan.dd.json](../../../plan.dd.json) · **Phase-1 brief (rules carry over)**: [../phase-1/context.md](../phase-1/context.md) · **Proofs**: [../../backpressure.dd.json](../../backpressure.dd.json)

## Executive briefing

Phase 1 moved every import with a verified public home onto `@ai-substrate/dd` (pin
`a37a20ec`, dd branch `s002/sdk-build`). What remains on the fork is exactly the
plan-semantics surface: 6 symbols in `acts/plan/index.ts` (`buildPlanIndex`, `itemKey`,
`PlanDocument`, `ReadyReading`, `readPlanCheck`, `readPlanReadiness`) + 3 types in
`acts/plan/pr-body.ts` (`PlanEdge`, `PlanIndex`, `PlanItem`). This phase is the
**deciding round for upstream OQ-2**: re-implement that surface package-side on PUBLIC
primitives only, and report per-primitive sufficiency honestly. **Sufficiency is an
OUTCOME, never a `done_when`** — the phase succeeds by producing a true verdict either
way. The prediction file pre-commits the expected answer and the falsifier for each call
so the trial cannot be quietly shaped to agree with it.

## Hard rules (violations are review REJECTs; phase-1 rules 1–8 all still apply)

1. **Never edit `services/dd/plan/semantics.ts`** — it is byte-pinned
   (`dd-plan-semantics-frozen.test.ts` FROZEN_DIGEST). The re-implementation is a NEW
   module (under `acts/plan/` or a new `harness/cli/src/services/plan-semantics/`),
   never a mutation of the fork. If a change trips the pin, that is a wrong turn.
2. **Public subpaths only** in the new module: root barrel, `./core/*`, `./links`,
   `./schema*`, `./node`, `./render/renderer`. Zero `services/dd`, zero `acts/dd`, zero
   deep `node_modules/@ai-substrate/dd/dist/*` imports.
3. **Insufficiency = STOP, not shim.** A missing public surface or a dd-owned vocabulary
   need (`BUILTIN_RELS`, `CLAIMING_RELS`, `DEFAULT_GATE_TERMINAL_STATES`,
   `COMPLETION_STATES`) is a D-3 packet routed **through koala** to crab (dd exports →
   we re-pin → 12s reinstall). Never a local re-declaration — a re-declared vocabulary
   is the two-vocabularies hazard this plan exists to end, and it is the prediction's
   pre-committed scoring line.
4. **Falsifiers before implementation** (TDD, ratified): tk-0007's tests exist and run
   RED before tk-0008's implementation turns them green — commit order is the evidence.
5. **Behavioural bar**: the re-implemented check must produce a findings set EQUAL to the
   fork's on the same inputs (plan 080's own documents + the constructed contradiction
   and `--complete` orphan cases). Compiling is not sufficiency.
6. **Report contradictions loudly.** If the trial refutes prediction.md, the verdict says
   so in those words. Never reword the phase to fit the result.
7. **`tracked` branches on `=== false`, never `!tracked`** (A-2; carried from phase 1).
8. Harness commands run **in-tree**: `node harness/cli/bin/harness.js …`; worktree cwd
   resets between tool calls — `cd` per command; npm installs need the sandbox OFF.

## RESHAPE ADDENDUM (2026-08-09, post-ruling — supersedes the "rebuild" framing below)

Jordan ruled **semantic ontology leaves dd** (dd government `d8950eb`): dd keeps
MECHANISMS (claiming-vs-referencing, typed relations, minted ids, state machinery),
consumers bring VOCABULARY. Consequences, ratified by Jordan for this plan
("keep-and-promote", 2026-08-09):

- **tk-0008 is now a PROMOTION BY COPY, not a rebuild**: the fork's plan layer (which
  harness originated — dd's copy is the port of ours) becomes a harness-owned module.
  The fork stays byte-untouched until phase-3 deletion; no fence edits in phase 2.
- **Sanction inversion on vocabulary**: copying `core/constants` values
  (BUILTIN_RELS / states / prefixes) into the promoted module is now LEGITIMATE —
  builder-owned by the ruling. Hard rule 3's D-3 STOP now applies only to dd
  MECHANISMS that have a public home (import, never copy) — the temporary mechanism
  copies (constants/derive/rel/value/posix-path) are enumerated and pointed at dd's
  seam scoping (`6aaef35`), which is scoped but UNSCHEDULED upstream.
- **Authority during the overlap**: the promoted module is authoritative for consumers
  from the moment tk-0009 rewires them; the fork is inert-but-present (goldens oracle
  only). Two copies exist deliberately and briefly.
- **Goldens are the behavioural pin** (captured `5f8cfa44`, precondition met): the
  falsifier suite measures against golden literals, not the live fork. Live-corpus
  exception: plan 080's own docs keep the fork as oracle (they churn), assert
  non-vacuity, and convert to structural invariants at fork deletion — carry into
  phase 3.
- The prediction's rebuild framing is superseded, not silently rewritten — the trial
  report states this loudly, with the shared-cause record fault (dd's "does-not-ship"
  label + the prediction not questioning it) named on both sides.

## Known tripwires

- **s081 interaction (prime's notify, 2026-08-09, no file overlap)**: s081 bundled the
  flight-plan flow type, which silently ENABLED post-mutation overlay validation for
  every flight-plan flow — `acts/flow.ts` runtime behaviour changed with zero edits to
  it. Fail-closed direction: the risk is a legitimate flow mutation newly refused
  (E300), not corruption. If a flow mutation starts E300-ing during this phase,
  attribute to the s081 interaction FIRST — do not patch around it in the rewire, and
  do not change anything that decides whether an overlay resolves (schema resolution,
  flow kind) without flagging it to koala.
- The arch suite byte-pins `semantics.ts` — see hard rule 1.
- Two boundary guard tests skip package specifiers by design (D-4) — do not "fix" them.
- `DdLinkCell.rel` carries the DECLARED rel (resolved via `relOf`), not the
  effective-builtin mapping — do not assume it answers the `effectiveRel` question; that
  is exactly what tk-0007's non-builtin-rel falsifier probes (live case:
  `satisfies-toward`, registered in dw-0154's guard).
- `./links` is richer than older notes claim: `indexDocument`, `addressableAt`,
  `anchorForLocation`, `DdDocumentIndex`, `DdAddressableKind`, and all of
  `links/model` are public there. Verify against the INSTALLED `dist/*.d.ts`, never
  against memory or dd's working tree.

## Files touched

| File | Change |
|------|--------|
| new module (`acts/plan/…` or `services/plan-semantics/`) | the package-side re-implementation |
| `harness/cli/src/acts/plan/index.ts` | plan imports move off `services/dd/plan` |
| `harness/cli/src/acts/plan/pr-body.ts` | `PlanEdge`/`PlanIndex`/`PlanItem` move off the fork |
| `harness/cli/test/…` (new) | tk-0007 falsifier suite |
| `assets/tasks/phase-2/…` | trial report beside prediction.md |

Fork trees (`services/dd/**`, `acts/dd/**`) are **not deleted here** — that is phase 3,
behind the bidirectional drain checklist. Any OTHER edit to those trees is notify-first
to prime (through koala).
