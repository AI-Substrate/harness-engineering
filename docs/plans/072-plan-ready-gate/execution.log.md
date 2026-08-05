# Execution Log — 072 Plan Readiness Gate

**Plan**: `docs/plans/072-plan-ready-gate/plan-ready-gate-plan.md`
**Mode**: Simple (inline task table)
**Phase**: Implementation (single phase)

---

## T001 — Verdict model · `dd/plan` · completed

**Files**: `harness/cli/src/services/dd/plan/ready.ts` (new)

`ReadyVerdict = 'ready' | 'not-ready' | 'cant-tell'`, two dimensions (`CriteriaDimension`,
`SurveyReading`), and a reason code on every one of them. Reasons are data —
`all-claimed`, `unclaimed-criteria`, `nothing-to-check`, `plan-unreadable` on the criteria side;
the survey's own union lives with its reader (T004). Every dimension is three-valued: `satisfied:
boolean | null`, where `null` means *cannot be determined*, never *no*.

`computeReadiness` fixes the precedence explicitly, because the design has no other place to
put it:

1. a **known failure outranks an unknown** — an unclaimed criterion makes a plan not-ready
   whether or not the flight plan is readable;
2. an **unknown outranks a pass** — a dimension nobody can read is not a dimension that passed;
3. `ready` only when both are affirmatively satisfied.

**Evidence**: `npx tsc -p harness/cli/tsconfig.json --noEmit` → exit 0.

---

## T002 — Criteria dimension by composition · `dd/plan` · completed

**Files**: `harness/cli/src/services/dd/plan/ready.ts`

`readCriteriaDimension(check: PlanCheckResult)` reads `orphan-claim` findings off a
`PlanCheckResult` — the same reading `plan validate` and the flow's departure gate already take.
Unclaimed criteria carry `address` / `owner` / `message` straight through, unre-worded.

`semantics.ts` is **not** touched, extended, or imported for anything but its published result
type. The `pressure` exclusion in `CLAIMING_RELS` is a written decision (dossier F-03); the gate
is a consumer of that decision, not a second opinion about it. T010 turns "we promised not to
touch it" into a check.

A blocking mechanical error (`check.ok === false`, or `check.index === null`) reads
`plan-unreadable` / `satisfied: null` — a plan nobody could parse has not failed readiness, it
has failed to be asked.

**Evidence**: typecheck clean; proven behaviourally by the T005/T008 fixtures below.

---

## T004 — Survey dimension · `flow` · completed

**Files**: `harness/cli/src/services/flow/chores-read.ts` (new)

`readBackpressureSurvey(flowPath, deps, expectedBasis)` composes `readFlowDoc` and reads node
comments directly.

**Not** `harness flow chores --json`, and this is the correction that came out of validation:
`ChoreRow` (`flow-mutations.ts:425-438`) projects `id/label/status/kind/importance/command/
anchor/runnable` and **no comments**, and the JSON act returns exactly those rows
(`acts/flow.ts:639-646`). Receipts are unreachable through that surface. Widening a public row
for one consumer was the alternative, deliberately not taken; the risk it leaves — coupling to
the node shape — is pinned by fixtures instead.

Two shape findings taken from the live flight plan (`docs/plans/072-plan-ready-gate/the-flow.json`)
rather than assumed:

| Discovery | Consequence |
|---|---|
| The re-basis node `backpressure-752982794591` carries **no `chore` marker** — only `type: "backpressure"` | The reader keys on `node.type`, never on the presence of `chore`. Keying on `chore` would have missed the very node that re-surveyed the current bytes. |
| Receipts arrive as `kind: "validation"` (agent attempt) and `kind: "decision"` (human decline), text `decision:… basis_sha256:<64 hex> time:…` | Receipt kinds restricted to those two: the doctrine reserves receipts for append-only comments, and a `note` is overwritable. |

Resolution order when several backpressure nodes exist: **matching receipt → stale receipt →
terminal-without-receipt → not-run**. A survey that happened for the current bytes is the truth
however many superseded ones are lying around.

**Evidence**: typecheck clean; AC-04/05/06/10 fixtures below.

---

## T005 — Adversarial vacuity fixture, RED FIRST · `dd/plan` · completed

**Files**: `harness/cli/test/services/dd/plan/ready.test.ts` (new)

Ordered before T003 on purpose. A guard only ever run against good input has been
*demonstrated, not tested*, and "the check passed because there was nothing to check" is the
exact defect this feature exists to prevent — so the fixture was committed and run against code
that had **no** vacuity guard.

The fixture is **ready in every respect except vacuity**: zero claim rows, but a real flight plan
whose `backpressure` node is `done` and carries a `validation` receipt whose `basis_sha256`
equals the plan document's current bytes. The bare F-06 scaffold would not have done — it also
lacks a survey, so its RED would have come from the missing flight plan and proven nothing about
vacuity.

### The observed pre-guard failure, verbatim

```
 RUN  v4.1.10 /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli

 × test/services/dd/plan/ready.test.ts > plan ready — vacuity (T005, AC-03, AC-11) > refuses to judge a plan with zero claim rows, however green everything else is 18ms
   → expected 'ready' to be 'cant-tell' // Object.is equality

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/services/dd/plan/ready.test.ts > plan ready — vacuity (T005, AC-03, AC-11) > refuses to judge a plan with zero claim rows, however green everything else is
AssertionError: expected 'ready' to be 'cant-tell' // Object.is equality

Expected: "cant-tell"
Received: "ready"

 ❯ test/services/dd/plan/ready.test.ts:176:29
    174|
    175|     // The refusal itself.
    176|     expect(reading.verdict).toBe('cant-tell');
       |                             ^
    177|     expect(reading.reason).toBe('nothing-to-check');
    178|     expect(reading.criteria.satisfied).toBeNull();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed (1)
```

**Read the failure line, not just the colour.** It failed at **line 176** — the verdict
assertion — which means the four positive-control assertions above it (lines 169-172:
`survey.satisfied === true`, `survey.reason === 'survey-done'`, `criteria.unclaimed === []`,
`criteria.claims === 0`) all **passed**. The RED therefore says precisely one thing:

> presented with a plan that was green on every readable dimension and contained nothing at all
> to judge, the gate answered **`ready`**.

That is dossier F-06 reproduced inside the new verb — the emptiest plan scoring readiest — and it
is the failure T003 exists to close. Had the test been written after the guard, it would have gone
green on the day it was written and proven none of this.

---

## T003 — The vacuity refusal · `dd/plan` · completed

**Files**: `harness/cli/src/services/dd/plan/ready.ts`

Zero claim rows → `satisfied: null`, reason `nothing-to-check`. Non-vacuity is read off
`PlanIndex.items[].claim` — the relation-derived flag — and **not** off a count field, because
`PlanSemanticResult.counts` (`model.ts:106-118`) exposes no criterion count at all.

One decision the plan did not spell out, made here and worth a reviewer's eye: **vacuity refuses
outright, ahead of the known-failure rule.** `computeReadiness` checks `nothing-to-check` first,
so a vacuous plan reports `cant-tell` even when the survey has affirmatively failed. AC-03 is
unconditional ("never reports ready", "reason nothing-to-check"), and answering "not ready,
because the survey is missing" would imply the plan was otherwise judgeable. It was not.

**Evidence**: the T005 fixture flipped RED → GREEN on exactly this change, with nothing else
touched.

---

## T006 / T007 — The verb, its envelope, and `--strict` · `cli/commands` · completed

**Files**: `harness/cli/src/acts/plan/index.ts`, `harness/cli/src/output/error-codes.ts`,
`harness/cli/src/services/dd/plan/index.ts` (barrel)

`harness plan ready <target> [--flow <path>] [--strict]`. Mapping, per constitution Principle 6:

| Verdict | Status | Exit |
|---|---|---|
| ready | `ok` | 0 |
| not-ready | `degraded` | 0 |
| not-ready `--strict` | `error` (`E462`) | 1 |
| cant-tell | `unconfigured` | 2 |

`--strict` is `error`/1 rather than `degraded`/non-zero because `exit.ts:4-13` maps exit codes
from **status alone** — a `degraded` envelope cannot exit non-zero, and no per-command override
exists or should. The kernel mapping is not bypassed.

`--strict` deliberately does **not** escalate `cant-tell`. Strict adds teeth to a *known*
not-ready; "I cannot tell" is not a not-ready, and reporting it as one would be the gate
inventing an answer it does not have.

Prose lives in the act (`explainReadiness`), never in the service — reason codes are data, and a
service returning sentences makes every future caller re-parse English for what it already knew.
Per ruling ac-7007 the `next_action` is **one line naming only the deciding dimension**; the full
structured reading is always in `data` for anything that wants to consume it.

**Two plan-manifest inaccuracies, corrected rather than worked around** (flagged for the record):

| Plan said | Reality |
|---|---|
| `harness/cli/src/commands/plan.ts` | No `src/commands/` exists. The plan verb family is registered in `src/acts/plan/index.ts`. |
| (silent on error codes) | `E4xx` codes are a **frozen surface**: `test/acts/dd-surface.test.ts` counts them and requires a manifest row. See the deviation note at the end. |

---

## T008 — Read-only, with a positive control · `dd/plan` · completed

**Files**: `harness/cli/test/services/dd/plan/ready.test.ts`

Byte-compares the plan document, its task file, and the flight plan across a run. A
byte-identical before/after is a **null result on its own** — two empty files, or a command that
exploded before touching anything, compare equal just as happily. So before any comparison the
test asserts the before-state is non-trivial (each file over a size floor, and each containing
the specific content whose survival is the claim: `ac-0001`, `tk-0001`, `basis_sha256`), and
after the run asserts the command actually produced a verdict (`exit 0`, `verdict: ready`). Only
then does "the bytes did not move" mean anything.

---

## T010 — The `semantics.ts` digest guard, proven both ways · `dd/plan` · completed

**Files**: `harness/cli/test/architecture/dd-plan-semantics-frozen.test.ts` (new)

Two assertions: the file's SHA-256 equals a pinned constant, and it still carries the written
rationale for excluding `pressure` from `CLAIMING_RELS`. The digest catches any change; the
second assertion makes a failure point at the *argument* rather than at a hash.

Folded in from the backpressure survey: finding 03's mitigation was recorded as "checkable by
diff", and nothing checked it. The guard does not forbid editing the file — it forbids the
**silent** edit. Changing the pinned constant is the sanctioned way to change `semantics.ts`, in
a diff a reviewer sees.

### Proof the guard fires (mutate → red → revert)

1. **Baseline** on the untouched file: `2 passed`.
2. **Mutated** `CLAIMING_RELS` to `['proven_by', 'satisfies', 'derives', 'pressure']` — the exact
   reversal of the decision being protected. Both assertions failed:

   ```
   × has not changed since the readiness gate composed it
     → expected '54bce047402eec74e91cb5b3f9e6bc406657e…' to be '3856153824f7fd3448aaf285197054a2f4a25…'

   Expected: "3856153824f7fd3448aaf285197054a2f4a2524ed80c0fffe6dc9a3f8526f150"
   Received: "54bce047402eec74e91cb5b3f9e6bc406657e153c1e895321f1beb3c2a9aae4a"

   × still carries the written rationale for excluding `pressure` from the claiming relations
     → expected 'import { effectiveRel } from \'../cor…' to contain 'const CLAIMING_RELS = new Set([\'prov…'

    Test Files  1 failed (1)
         Tests  2 failed (2)
   ```

3. **Reverted**; `git diff harness/cli/src/services/dd/plan/semantics.ts` is empty and the guard
   is green again. **AC-09 holds: `semantics.ts` is byte-unchanged by this work.**

---

## T009 — The how-to · docs · completed

**Files**: `docs/how/dd/plan-ready.md` (new), `docs/how/dd/README.md` (chapter index row)

Covers the three verdicts and their exit codes, what each dimension reads, why a receipted
decline is green, why the basis matters, what the verb deliberately does **not** check (the
per-criterion pressure Non-Goal), and how CI opts into teeth.

**Evidence**: `npm run check:docs` → `check:docs OK — no drift`. `markdown-lint` reports **zero**
findings in the added/edited docs (repo total unchanged at 196).

---

## Discoveries & Learnings

| # | Tag | Discovery | Disposition |
|---|-----|-----------|-------------|
| D1 | Noteworthy | **`ready.ts` importing `services/flow` broke four architecture rules.** The first cut had the verdict model importing `SurveyReading` from `flow/chores-read.ts`. That type-only import transitively dragged the flow's fs/clock/git ports and `output/error-codes` into `dd/plan`, tripping `dd-plan-never-imports-output`, `dd-plan-never-imports-node-adapters` and `no-circular` — **14 arch-check violations, all mine**. | Fixed by reversing the direction, never by weakening a rule (the rule's own note forbids that). The survey dimension's shape now lives with the rest of the verdict model in `ready.ts`, and `chores-read.ts` imports it through dd's published barrel — the one seam the flow spine is permitted to reach for. **14 → 2**, and both survivors are pre-existing `services/telemetry` warnings this work never touched. |
| D2 | Noteworthy | **A new `E4xx` code is a frozen-surface renegotiation, not an addition.** `DD_PLAN_NOT_READY` (E462) made `test/acts/dd-surface.test.ts` fail on a *count*, by design. | Recorded the renegotiation in the manifest (`docs/plans/065-…/dd-surface.md`) with the reasoning, and adjusted the count 62 → 63. Reusing `DD_PLAN_INCOMPLETE` (E457) was the alternative and was rejected: readiness can fail on a stale or missing backpressure receipt, which is not a statement about plan completeness, and an agent switching on E457 would be told the wrong thing. **This file is outside the brief's stated fence — see the deviation note.** |
| D3 | Noteworthy | **Re-basis survey nodes carry no `chore` marker.** Read off the live flight plan: `backpressure-752982794591` has `type: "backpressure"` and no `chore` block. A reader keyed on the chore marker would have missed the only node that surveyed the current bytes. | The reader keys on `node.type`. Pinned by a fixture. |
| D4 | Noteworthy | **`plan validate --complete` is load-bearing for the criteria dimension.** `orphan-claim` is emitted under `complete: true` only; the verb hard-codes it rather than exposing a flag. | Documented at the call site. A `--complete`-less read would report every plan as having no unclaimed criteria — a second vacuity bug in a different costume. |
| D5 | Deferred | **Open Question 1 is still open.** `--strict` opt-in was resolved *by design*, not by a human ruling (the plan records the user replied "build the plan now" without deciding). If the answer is "not-ready must always exit non-zero", it is a one-line change to the mapping. | Carried, not closed. Surfaced here for the go-decision. |
| D6 | Noteworthy | **Pre-existing lint debt in `src/acts/plan/index.ts`.** Biome reports 3 unused imports + 2 unused variables (`validateWalk`, `resolveMapSeed`, `buildPlanIndex`, `loadPlanDocuments`, a `doc` binding). Verified against `HEAD`: the same 5 findings exist without my change. | **Left alone** — unrelated to this work, and fixing it here would put dead-code deletion in a feature diff. Worth a follow-up. |

---

## Phase complete — status against acceptance criteria

| AC | Verdict | Proof |
|----|---------|-------|
| AC-01 | ✅ | `ready.test.ts` "every criterion claimed, survey receipted for these bytes, reads ready"; CLI case `ready → status ok, exit 0` |
| AC-02 | ✅ | "a criterion no task accounts for is not-ready, named by address" — asserts the full `#acceptance_criteria/ac-0001` address |
| AC-03 | ✅ | The T005 fixture (RED first), plus CLI cases `unconfigured`/exit 2 and "`--strict` does NOT turn a refusal into a failure" |
| AC-04 | ✅ | "a decline is a legitimate ready: skipped, with a matching decision receipt" |
| AC-05 | ✅ | "skipped with no receipt is not satisfied" → `missing-receipt` |
| AC-06 | ✅ | "no flight plan beside the plan is cant-tell" (service) + CLI exit 2 |
| AC-07 | ✅ | `degraded`/0 by default; `error`/`E462`/1 under `--strict` |
| AC-08 | ✅ | Byte-comparison over plan + task file + flight plan, with a non-trivial before-state asserted first |
| AC-09 | ✅ | `dd-plan-semantics-frozen.test.ts`; guard proven to fire by mutation; `git diff` on `semantics.ts` empty |
| AC-10 | ✅ | "a receipt for different plan bytes is stale-basis"; also reproduced live against plan 071 |
| AC-11 | ✅ | `claims` read from `PlanIndex.items[].claim`; "claim rows + zero tasks" asserts `not-ready`, not `cant-tell` |

### Gates

| Gate | Result |
|------|--------|
| `npm run test` | **4430 passed / 309 files**, 0 failed |
| `harness checks` | All hard gates **ok**: tests, biome, typecheck, check:docs, check:flows, check:telemetry-fixtures, check:doctrine-parity, check:dd-docs, root-invocation-smoke, dd doctor, skills-check |
| warn trio | arch-check **2** (both pre-existing `services-ports-type-only` in `services/telemetry`) · markdown-lint **196** (194 lint, 1 links/anchors, 1 mermaid — none in the docs this phase touched) · windows-check **6** (`WIN004×1, WIN007×5` — none in this phase's files) |
| `npm run check:docs` | `check:docs OK — no drift` |

### Live smoke

Run against a real plan in this repo, not just fixtures:

```
$ harness plan ready docs/plans/archive/071-dd-native-builder --json
status: degraded  verdict: not-ready  reason: stale-basis  decided_by: survey
criteria: {satisfied: true, reason: all-claimed, claims: 21}
survey:   {satisfied: false, node: backpressure, status: done,
           basis: b4814527f632…, expected_basis: 7ba7a502c693…}
```

Twenty-one criteria, all claimed — and a backpressure receipt recorded against plan bytes that no
longer exist. AC-10 firing on real data on its first outing.

### Deviation from the brief's file fence

The brief scoped changes to the plan folder, `services/dd/plan/`, `services/flow/`,
`src/commands/`, `test/`, and `docs/how/`. Two files fall outside it:

1. **`docs/plans/065-deterministic-documents/tasks/phase-1-dd-core-foundations/dd-surface.md`** —
   the frozen `E4xx` manifest. Shipping `E462` without its row is not possible: the surface test
   fails on the count *by design*, and that ceremony is the repo's mechanism for making a new
   code deliberate. Not adding a code at all would have meant reusing a semantically wrong one.
2. **`harness/cli/src/acts/plan/index.ts`** — the brief named `harness/cli/src/commands/plan.ts`,
   which does not exist. This is the same file under its real path.

Both are reported rather than quietly absorbed.
