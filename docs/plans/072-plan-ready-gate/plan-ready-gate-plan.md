# Plan Readiness Gate — `harness plan ready`

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-08-05
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

📚 Incorporates findings from `research-dossier.md`

### Research Context

The dossier established three things that shape this plan. **The unclaimed-criteria check already exists** — `plan validate --complete` emits `orphan-claim`, which is exactly "you have ACs but no task accounts for them" (F-01, F-02). **The backpressure check is absent on purpose** — `pressure` is deliberately excluded from the claiming relations, on the stated grounds that a backpressure row has no state and gates nothing (F-03). And **an empty plan currently scores perfectly**: a fresh scaffold returns `orphans: 0, error: 0`, because zero criteria cannot produce an unclaimed one (F-06, proven by probe).

### Summary

One command an agent runs at plan setup and again at gates, which answers whether a plan is ready to start work. It joins two substrates that today answer separately: the plan document (are criteria accounted for?) and the flight plan (was the backpressure survey done, or deliberately declined?). It composes existing checks rather than adding new analysis, and it **refuses to answer** when the plan is too empty to judge.

### Goals

- One command, one verdict, drilled into agents at plan setup and at gates.
- Answer "are acceptance criteria claimed by tasks?" — by composing the existing `orphan-claim` read.
- Answer "was backpressure done, or explicitly declined?" — from flight-plan chore status plus its receipt.
- **Refuse to call an empty plan ready.** A plan with nothing to check gets its own verdict, never a pass.
- Give CI real teeth without blocking a human at a terminal.

### Non-Goals

- **No per-criterion backpressure coverage.** Requiring every AC to name an instrument re-introduces the coverage predicate F-03 deliberately discarded. Out of scope unless that decision is overturned in writing.
- No new finding class in `semantics.ts`. The gate is a *consumer*.
- No change to `plan validate` semantics or output.
- No auto-fixing, no scaffolding of missing criteria.
- Not a replacement for `validate --complete`; a readiness verdict on top of it.

### Target Domains

_No `docs/domains/registry.md` exists in this repo; domains below are the logical code boundaries this change touches._

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| `dd/plan` | existing | **modify** | Add a readiness service that composes `readPlanSemantics`; no change to its semantics |
| `flow` | existing | **consume** | Read chore status + receipt comments; no writes |
| `cli/commands` | existing | **modify** | Register the `plan ready` subcommand and its envelope/exit mapping |

### Testing Strategy

- **Approach**: Lightweight — the logic is a verdict function over two readable inputs, not an algorithm.
- **Non-negotiable exception**: the vacuity refusal gets an adversarial fixture. A control only ever run against good input has been *demonstrated, not tested* — so the empty scaffold from F-06 becomes a committed fixture that **must not** read ready, and it must fail before the guard exists.
- **Focus areas**: the three-verdict boundary; vacuity; decline-with-receipt vs skip-without-receipt; absent flight plan.
- **Excluded**: re-testing `readPlanSemantics` (already covered).

### Mock Usage

Fakes over mocks, per constitution Principle 3. The flight-plan and document reads take real fixture files.

### Documentation Strategy

- **Location**: `docs/how/` (a new section in the dd how-to set).
- **Rationale**: this is a verb agents are drilled to run; it needs a discoverable home beyond `--help`.

### Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=1, D=0, N=1, F=0, T=1 → 4
- **Confidence**: 0.85
- **Assumptions**: receipts follow the doctrine's comment-first ordering. **Corrected after validation**: `harness flow chores --json` is NOT sufficient — `ChoreRow` (`flow-mutations.ts:425-438`) carries no comments, so receipts are unreachable through it. The survey dimension composes `readFlowDoc` + node comments directly.
- **Dependencies**: none beyond the existing dd and flow services.
- **Risks**: see § Risks & Assumptions.
- **Phases**: 1

### Acceptance Criteria

- **AC-01** — Given a plan whose acceptance criteria are all claimed by tasks, and a backpressure chore that is `done` with a receipt, `harness plan ready <target>` reports **ready** and exits 0.
- **AC-02** — Given a plan with ≥1 acceptance criterion that no task satisfies, the command reports **not-ready** and names each unclaimed criterion by address.
- **AC-03** — Given a plan with **zero** acceptance criteria, the command reports **can't-tell** with reason "nothing to check", exits 2, and **never** reports ready.
- **AC-04** — Given a backpressure chore that is `skipped` **and** carries a `decision` receipt, the survey dimension reads **satisfied** (a decline is a legitimate ready). **No basis match is required on a decline** — the doctrine's decline receipt carries the human's verbatim words and no `basis_sha256` at all, so requiring one made AC-04 unsatisfiable (found in review). The asymmetry is deliberate: a completed survey is a claim about specific plan bytes and goes stale when they change; a human's decline is a decision about the work, and does not.
- **AC-05** — Given a backpressure chore that is `skipped` with **no** receipt comment, the survey dimension reads **not satisfied**.
- **AC-06** — Given a plan with no flight plan alongside it, the survey dimension reports **can't-tell** rather than pass or fail, and the overall verdict is can't-tell.
- **AC-07** — With `--strict`, a **not-ready** verdict emits envelope status `error` and exits **1**; without it, not-ready emits `degraded` and exits 0. (`error`/1 is the only non-zero code the kernel's status mapping can express for this case — `exit.ts:4-13` maps by status alone, so a `degraded` verdict cannot exit non-zero. Chosen deliberately per constitution Principle 6.)
- **AC-08** — The command performs no writes to the plan document or the flight plan (read-only, provable by a byte-comparison fixture test).
- **AC-10** — A receipt whose `basis_sha256` does **not** match the target plan's current bytes reads **not satisfied**, reason `stale-basis` — never satisfied. (An edit after the survey must not inherit the old green.)
- **AC-11** — Non-vacuity is defined as **at least one claim row** (`PlanIndex.items[].claim`), not a count field — `PlanSemanticResult.counts` exposes no AC count (`model.ts:106-118`). A plan with claim rows but zero tasks is **not-ready** (the existing `orphan-claim` read already says so), never can't-tell.
- **AC-09** — `harness/cli/src/services/dd/plan/semantics.ts` is byte-unchanged by this work, enforced by a committed digest guard beside the existing architecture tests (folded in from the backpressure survey: finding 03's mitigation was "checkable by diff", which nothing actually checked).

### Risks & Assumptions

| Risk | Mitigation |
|------|-----------|
| **Reversing F-03 by accident** — gating on per-AC pressure links re-invents the discarded coverage predicate | Named as a Non-Goal; the survey dimension keys on the *chore*, never on per-AC links |
| **Vacuity inherited** — a gate that passes empty plans is worse than none | AC-03 plus a committed adversarial fixture that must fail before the guard exists |
| **Nag-by-default** (ruling ac-7007) — per-row warnings teach readers to ignore warnings | The verdict is one line; details print only for the dimension that failed |
| **Receipt-shape coupling** — the read composes `readFlowDoc` + node comments because no projected surface exposes receipts | Pin the shape in a fixture test so a model change fails loudly; extending `ChoreRow` with receipt evidence is the alternative, deliberately not taken (it widens a public contract for one consumer) |
| **Stale basis** — an old green receipt surviving a plan edit | AC-10: basis equality against the target's current bytes, or `stale-basis` |

### Open Questions

1. **Default teeth.** Resolved by design as `--strict` opt-in (see Key Finding 02): the terminal stays advisory per flow invariant #4, CI opts into non-zero. **This is the one decision worth a human ruling before implementation** — if the answer is "not-ready must always exit non-zero", it is a one-line change to the mapping, made deliberately rather than by default.
2. _(AC-11 closed the vacuity-threshold question — it was selected and declared open at the same time, which validation flagged. Now decided.)_
3. Should `ready` be reachable as `validate --ready` instead of its own verb? Taken as its own verb — a distinct question deserves a distinct answer surface, and `validate`'s output contract is already load-bearing.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| _(resolved — see AC-11)_ | — | The vacuity threshold was selected during validation rather than left open: ≥1 claim row is non-vacuous; claim rows with zero tasks are not-ready | — |

### Clarifications

#### Session 2026-08-05

- **Q: Workflow mode?** → Simple (user-specified: "simple plan, default settings").
- **Q: Testing / mock / docs?** → Defaults taken per user instruction: Lightweight testing, fakes over mocks (Principle 3), `docs/how/`.
- **Q: Does `ready` block anyone when it says not-ready?** → Asked; user replied "build the plan now" without ruling. Resolved by design as `--strict` opt-in and carried as Open Question 1 rather than silently defaulted.

## Planning Seam

_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: **Vacuity threshold** (unworkshopped)

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | Supplied F-01…F-08, ruling ac-7007, and the four risks |
| workshops/*.md | n | — |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical markers; the one open decision is recorded as a design choice, not a blocker |
| G2 | Constitution | PASS | Principles 5 (honesty/`unconfigured`) and 6 (documented exit codes) are load-bearing *for* this design, not violated by it |
| G3 | Architecture | PASS | Service in `services/dd/plan/`, adapter in the command layer; no `node:fs` in services |
| G4 | ADR Compliance | N/A | No `docs/adr/` in this repo |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | Lightweight + one mandatory adversarial fixture (T005 precedes T003) |
| G7 | Domain Completeness | PASS | No registry exists; logical domains named with status/relationship/role; manifest covers every file below |

### Summary

Add `harness plan ready <target>`: a read-only verdict that composes the existing `readPlanSemantics` output with the flight plan's backpressure chore state. Three verdicts map onto the existing envelope contract — ready→`ok`(0), not-ready→`degraded`(0, or non-zero under `--strict`), can't-tell→`unconfigured`(2). The design's centre of gravity is the refusal: a plan with nothing to check reports can't-tell, never ready.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/dd/plan/ready.ts` | `dd/plan` | internal | New: verdict model + the readiness computation |
| `harness/cli/src/services/dd/plan/semantics.ts` | `dd/plan` | contract | **Read-only consumer** — not modified |
| `harness/cli/src/services/flow/chores-read.ts` | `flow` | internal | New: chore status + receipt reader (or reuse if an equivalent exists) |
| `harness/cli/src/acts/plan/index.ts` | `cli/commands` | contract | Register `ready` subcommand; envelope + exit mapping |
| `harness/cli/test/services/dd/plan/ready.test.ts` | `dd/plan` | internal | Verdict boundaries incl. the vacuity fixture |
| `docs/how/dd/plan-ready.md` | docs | internal | The how-to |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | An empty scaffold returns `orphans: 0, error: 0` — the emptiest plan is currently the readiest (dossier F-06, proven) | Vacuity refusal is AC-03 and gets an adversarial fixture that must fail first |
| 02 | Critical | Flow invariant #4 forbids gating the human; the ask ("plan is not done until…") implies teeth | `--strict` opt-in: advisory at the terminal, non-zero for CI. Recorded as a deliberate reconciliation, carried as Open Question 1 |
| 03 | High | `pressure` is excluded from claiming relations **on purpose**, with a written rationale (dossier F-03) | Gate on the survey chore, never on per-AC pressure links. Named as a Non-Goal |
| 04 | High | Declined-vs-never-run is only knowable from the flight plan; a document-only plan cannot answer it (F-05, F-07) | Three-valued verdict; can't-tell is a first-class answer (AC-06) |
| 05 | Medium | Ruling ac-7007: per-row warnings teach readers to ignore warnings | One-line verdict; details only for the failing dimension |

### Implementation

**Objective**: Ship `harness plan ready <target>` as a read-only, three-valued readiness verdict that refuses to judge an empty plan.
**Testing Approach**: Lightweight, with one mandatory adversarial fixture written before the guard it proves.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Define the verdict model: `ready \| not-ready \| cant-tell`, per-dimension results (criteria, survey), and the reason each carries | `dd/plan` | `services/dd/plan/ready.ts` | Type compiles; every verdict carries a machine-readable reason code | Reasons are data, not prose |
| [x] | T002 | Read the criteria dimension by **composing** `readPlanSemantics` with `complete: true` and filtering `orphan-claim` | `dd/plan` | `services/dd/plan/ready.ts` | Unclaimed criteria are reported with their addresses; `semantics.ts` is unmodified | Per finding 03 — consumer only |
| [x] | T004 | Read the survey dimension by composing `readFlowDoc` + node comments (**not** `flow chores` — `ChoreRow` carries no comments, `flow-mutations.ts:425-438`): `done`/`skipped`+receipt whose `basis_sha256` matches the target's current bytes → satisfied; basis mismatch → `stale-basis`; `skipped` without receipt → not satisfied; no flight plan → can't-tell | `flow` | `services/flow/chores-read.ts` | AC-04, AC-05, AC-06, AC-10 hold against fixtures | **Moved ahead of T005**: the vacuity fixture cannot isolate vacuity until this dimension is readable |
| [x] | T005 | **Adversarial fixture first**: a plan that is **ready in every respect EXCEPT vacuity** — zero claim rows, but a flight plan whose backpressure chore is `done` with a basis-matching receipt. Assert it returns exactly `cant-tell` + reason `nothing-to-check`. Run it against the pre-guard code and record the FAILURE verbatim | `dd/plan` | `test/services/dd/plan/ready.test.ts` | The test fails before T003 lands, and the failure output is in the execution log | **The empty F-06 scaffold alone is NOT sufficient** — it also lacks a survey, so it would read non-ready for the wrong reason and the RED would prove nothing about vacuity |
| [x] | T003 | Implement the vacuity refusal: **zero claim rows** (`PlanIndex.items[].claim`, not a count field) → `cant-tell`, reason `nothing-to-check` | `dd/plan` | `services/dd/plan/ready.ts` | T005 now passes; AC-03 and AC-11 hold | The centre of the design |
| [x] | T006 | Register `harness plan ready <target>` with envelope + exit mapping: ready→`ok`(0), not-ready→`degraded`(0), cant-tell→`unconfigured`(2) | `cli/commands` | `src/acts/plan/index.ts` | `harness plan ready --help` lists it; exits match per constitution Principle 6 | |
| [x] | T007 | Add `--strict`: not-ready exits non-zero; default behaviour unchanged | `cli/commands` | `src/acts/plan/index.ts` | AC-07 holds both ways | Per finding 02 |
| [x] | T008 | Prove read-only: byte-compare the plan document and flight plan before/after a run | `dd/plan` | `test/services/dd/plan/ready.test.ts` | AC-08 holds; the before-state is asserted non-trivial first | A byte-identical comparison is a null result without a positive control |
| [x] | T010 | Digest guard: assert `services/dd/plan/semantics.ts` is byte-unchanged, beside the existing architecture tests | `dd/plan` | `test/architecture/dd-plan-semantics-frozen.test.ts` | AC-09 holds; the guard fires when the file is mutated (prove it by mutating, then revert) | Folded in from the backpressure survey — finding 03's mitigation was a promise nothing enforced |
| [x] | T009 | Write `docs/how/dd/plan-ready.md`: the three verdicts, what each dimension reads, and why a decline is green | docs | `docs/how/dd/plan-ready.md` | `npm run check:docs` passes | |
| [x] | T011 | R3-1: enforce the human-decline receipt authority and terminal status | `flow` | `services/flow/chores-read.ts`, `test/services/dd/plan/ready.test.ts` | Only `source: user` decisions on `skipped` nodes satisfy; agent-source and `done` controls stay not-ready | Re-review F001 |
| [x] | T012 | R3-2: make the current-basis node authoritative over historical nodes | `flow` | `services/flow/chores-read.ts`, `test/services/dd/plan/ready.test.ts` | A current `todo` re-basis node cannot be hidden by an old decline | Re-review F002 |
| [x] | T013 | R3-3: distinguish the doctrine's unavailable receipt from malformed validation | `flow` | `services/flow/chores-read.ts`, `test/services/dd/plan/ready.test.ts`, `docs/how/dd/plan-ready.md` | Only `decision:unavailable …` without a basis reads `missing-basis`; malformed validation is not-ready | Re-review F003 |
| [x] | T014 | R3-4: apply dissent ordering only after current-node selection | `flow` | `services/flow/chores-read.ts`, `test/services/dd/plan/ready.test.ts` | Historical stale evidence cannot outrank the current unavailable node | Re-review F004 |
| [x] | T016 | F006: bind the unavailable-receipt fixture to the in-repo doctrine | `dd/plan` | `test/services/dd/plan/ready.test.ts`, `skills/eng-harness-flow/SKILL.md` (read-only contract source) | The fixture's kind, source, and text marker are asserted against the doctrine text | Re-review F006 |
| [x] | T015 | Correct the R1/F001 execution-log evidence without rewriting history | docs | `execution.log.md` | Plan 071's demonstrated `type: chore` minting path is cited and the earlier narrow probe is marked as the cause of the mistaken note | Re-review F007 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T002, T004, T006 | `ready.test.ts` happy path |
| AC-02 | T002 | `ready.test.ts` unclaimed-criteria case |
| AC-03 | T005, T003 | `ready.test.ts` empty-scaffold fixture |
| AC-04 | T004 | `ready.test.ts` declined-with-receipt |
| AC-05 | T004 | `ready.test.ts` skipped-without-receipt |
| AC-06 | T004 | `ready.test.ts` no-flight-plan |
| AC-07 | T007 | `ready.test.ts` strict/non-strict exits |
| AC-08 | T008 | `ready.test.ts` byte-comparison |
| AC-10 | T004 | `ready.test.ts` stale-basis case |
| AC-11 | T003 | `ready.test.ts` claim-row predicate + zero-tasks case |
| AC-09 | T010 | `test/architecture/dd-plan-semantics-frozen.test.ts` |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Vacuity guard is written but never proven against bad input | Medium | High | T005 ordered before T003 and required to fail first |
| The `--strict` reconciliation is not what the user wanted | Medium | Low | Open Question 1; one-line change to the mapping |
| Per-AC pressure coverage creeps in during implementation | Low | High | Non-Goal + finding 03; `semantics.ts` must remain unmodified (checkable by diff) |
| `flow chores` output shape changes | Low | Medium | Consume the documented surface; a shape change fails the fixture loudly |
