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

**Read the failure line, not just the colour.** It failed on the **verdict assertion**
(`expect(reading.verdict).toBe('cant-tell')`) — which means the four positive-control
assertions above it (`survey.satisfied === true`, `survey.reason === 'survey-done'`,
`criteria.unclaimed === []`, `criteria.claims === 0`) all **passed**. The RED therefore says
precisely one thing:

> presented with a plan that was green on every readable dimension and contained nothing at all
> to judge, the gate answered **`ready`**.

That is dossier F-06 reproduced inside the new verb — the emptiest plan scoring readiest — and it
is the failure T003 exists to close. Had the test been written after the guard, it would have gone
green on the day it was written and proven none of this.

> The verbatim trace above cites `ready.test.ts:176` because that is where the assertion sat when
> the RED was observed. The file has grown since (R1 added cases above it), so the assertion is
> named here rather than located by line — a line number in a log is a pointer that rots.

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
| D3 | Noteworthy | **Re-basis survey nodes carry no `chore` marker.** Read off the live flight plan: `backpressure-752982794591` has `type: "backpressure"` and no `chore` block. A reader keyed on the chore marker would have missed the only node that surveyed the current bytes. | The reader keys on `node.type` **or the doctrine-pinned node id** (widened in R1/F001 — see below). Pinned by fixtures in both shapes. |
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
| AC-04 | ✅ | "a decline is a legitimate ready: skipped, with the doctrine's decision receipt" (**no basis** — corrected in R1/F003), plus "a decline does not go stale when the plan is edited afterwards" |
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

---

## R1 — review round 1 fixes (`REQUEST_CHANGES`: 3 HIGH, 2 MEDIUM)

Five findings ruled on and applied. The reviewer **approved** the vacuity precedence, `--strict`
semantics, the `E462` opening, the frozen-manifest renegotiation and the architecture direction —
none of those were reopened.

**Files**: `harness/cli/src/services/flow/chores-read.ts`,
`harness/cli/src/services/dd/plan/ready.ts`, `harness/cli/src/acts/plan/index.ts`,
`harness/cli/test/services/dd/plan/ready.test.ts`, `docs/how/dd/plan-ready.md`.

### F003 (HIGH) — a documented decline was unsatisfiable by the real protocol

The doctrine's decline is `harness flow comment --kind decision --source user --text "<the
human's verbatim words>"` — verified in `skills/eng-harness-flow/SKILL.md`. It carries **no
`basis_sha256` at all**. AC-04 as originally written required a decline receipt whose basis
matched, so the human's "no" could never satisfy the gate in normal use.

**Ruled and applied**: a `decision` receipt satisfies **without** a basis; a `validation` receipt
(a completed survey) still **requires** basis equality. The asymmetry is now stated in
`docs/how/dd/plan-ready.md` under *"Why a decline needs no basis, and a completed survey does"*
rather than left for a reader to infer: a completed survey is a claim about *specific plan bytes*,
so it expires when they change; a decline is a decision about *the work*, so nothing later
invalidates it. Two fixtures: the doctrine-shaped decline reads `declined-with-receipt`, and a
decline followed by an edit to the plan **stays** ready.

A third state fell out of the split and is now named rather than silently lumped in: a
`validation` receipt carrying **no** basis — the doctrine's `decision:unavailable` router-missing
detection receipt is exactly that shape — is a completed *attempt*, not a completed survey. New
reason **`missing-basis`**, with its own fixture and its own prose line. Its **verdict** was
corrected in R2 (below): can't-tell, not not-ready.

### F002 (HIGH) — newest receipt wins

Comments are append-only, so a re-surveyed node holds *both* receipts. The first-match scan let
the older one shadow the newer, reporting `stale-basis` about a survey already redone.
`newestReceipt` now scans newest-first.

The fixture is the finding: a node carrying **a stale receipt followed by a current one** must
read satisfied. Its control — the same two receipts in the **opposite** order — must still read
`stale-basis`, otherwise the first fixture would pass merely because the reader prefers a matching
basis found anywhere in the list.

### F004 (MEDIUM) — an allow-list that did not list

A comment with **no** `kind` was accepted despite the stated `validation | decision` rule: a
control that did not do what it said it did — this packet's own defect class. Now the kind must be
stated explicitly. Both the kind-less and the `note` cases are asserted.

### F001 (HIGH finding upheld; the reviewer's *reasoning* corrected)

> **R3/F007 correction (2026-08-05): demonstrated, not hypothetical.**
> `docs/plans/archive/071-dd-native-builder/the-flow.json` carries terminal node
> `backpressure-1f1d8db67e6c` with `type: "chore"` (including its `node-created`
> event). The earlier "not established" note below came from probing only plan 072,
> where both backpressure nodes use `type: "backpressure"`; that probe could not
> contain the counterexample. R1's id-based selection is therefore both the right
> contract and a regression fix for a demonstrated persisted shape.

The reviewer's stated mechanism was that doctrine-minted `backpressure-<hash>` nodes carry
`type: chore` and were therefore invisible.

**What was verified**: in this plan's live `the-flow.json`, both `backpressure` and
`backpressure-752982794591` carry `type: "backpressure"`, and both were already being seen. **What
was not verified**: any code path that mints such a node as `type: chore`. No such path was found,
so the claimed live defect is **not demonstrated here** — recorded as the reviewer's hypothesis,
not an established mechanism.

**The real finding, which stands**: the doctrine pins the re-basis node's **id**
(`backpressure-<first 12 hex>`) and says nothing about its `type`. Selecting on type alone
therefore relies on whoever mints the node choosing the same type by coincidence, not by contract.
Selection is now `type === 'backpressure' || /^backpressure(-[0-9a-f]{12})?$/i.test(id)`. Both id
shapes are tested against a **non-matching** type, and an "unrelated chore node is not mistaken
for the survey" fixture guards the other side of the widening.

### F005 (MEDIUM) — a docs example is a runnable surface

Every command in `docs/how/dd/plan-ready.md` pointed at `docs/plans/072-plan-ready-gate`, which
has no `plan.dd.json`, so every one of them errored. All examples now target
`docs/plans/archive/071-dd-native-builder`, and **each was executed before being written down**.
A new *"What `<target>` has to be"* section states the requirement (a `plan.dd.json` or its
containing directory) and shows the real `E400` a markdown-only folder gets.

### FT-006 (LOW, not in the ruling — applied anyway where it was a lie)

The T005 pointer no longer cites a line number (the file grew; the assertion is named instead).
The `no-flight-plan` and `flight-plan-unreadable` prose now name the **resolved flow path** rather
than asserting "beside this plan", which was false whenever `--flow` was passed explicitly.

### The R1 tests are controls, not decorations

Every new case was run against the **pre-fix** reader (`git stash push` on `chores-read.ts` alone)
before the fix was accepted. Seven of the nine went RED:

```
× AC-04 — a decline is a legitimate ready …          expected 'missing-receipt' to be 'declined-with-receipt'
× AC-04 — a decline does not go stale …              expected 'missing-receipt' to be 'declined-with-receipt'
× R1/F002 — a later matching receipt beats …         expected 'stale-basis' to be 'survey-done'
× R1/F002 — and the reverse order still reads stale  expected 'survey-done' to be 'stale-basis'
× R1/F004 — a comment with NO kind is not a receipt  expected true to be false
× a validation receipt with no basis …               expected 'missing-receipt' to be 'missing-basis'
× R1/F001 — the survey is found by its … ID          expected null to be 'backpressure-572b939e33c1'
```

Stated honestly: **two** of the new cases passed against the old code — the `note` case (already
rejected) and "an unrelated chore node is not mistaken for the survey" (nothing to widen yet).
They are kept as regression guards on behaviour the fix could plausibly have broken, and they are
not claimed as proof of a fixed defect.

### Gates after R1

| Gate | Result |
|------|--------|
| `npm run test` | see below |
| `harness checks` | see below |
| `npm run check:docs` | see below |

---

## R2 — `missing-basis` keeps its name and loses its verdict

One change, ruled after R1 raised the question rather than silently shipping the answer.

**The reason code stands.** `missing-receipt` was a lie about this state — there *is* a receipt —
and splitting the receipt kinds is what exposed it.

**Its verdict contribution was wrong.** R1 made it `satisfied: false` → **not-ready**. It is now
`satisfied: null` → **can't-tell**, `decided_by: survey`, envelope `unconfigured`, exit **2**.

### Why, from the doctrine's own words rather than from the shape

`skills/eng-harness-flow/SKILL.md` mints this receipt for a Layer-1 router miss and states its
purpose outright:

> `--kind validation --text "decision:unavailable reason:<…> time:<…>"` … **completed attempts,
> never skips** — a chore never sits outstanding forever blocking `nav` in an un-harnessed repo.

Reading it as not-ready **reinstates the exact block that receipt was written to remove**, and it
is a block with no exit: there is no action a user in a router-less repo can take to turn it
green. A verdict nobody can act on is a dead end, not a verdict.

The R1 defence was "the survey genuinely did not happen." That is true and it is not the point.
**"The work is not ready" and "I cannot determine whether the work is ready" are different
claims**, and this is the second one. Having three values is the only reason the distinction is
expressible — and the first time it came up for real, the two-valued answer was reached for.
`unconfigured` ("nothing is mapped here yet") is also the literally-true envelope.

Not-satisfied is unchanged for the genuinely broken cases: no receipt at all, wrong kind, stale
basis.

### Controls, and what they caught

The fixture uses the doctrine's **verbatim** receipt text, held in one named constant with the
SKILL.md quotation beside it, so it breaks if that protocol changes shape rather than quietly
testing a receipt nobody mints.

Three cases, all run against the pre-ruling reader (`git stash push` on `chores-read.ts`) first,
all RED:

```
× a validation receipt with no basis is CANT-TELL, not not-ready   expected false to be null
× a router-less repo gets exit 2, not a not-ready it cannot act on expected 'degraded' to be 'unconfigured'
× `--strict` does not give a router-less repo teeth either         expected 'error' to be 'unconfigured'
```

The third RED is the finding stated as a number: under the R1 verdict, **`--strict` in a
router-less repo exited 1** — a hard CI failure with nothing the repo's owner could do to clear
it. That is the block, made concrete.

A fourth case — "a stale receipt on another node still outranks an unreadable one" — **passed
against the pre-ruling code too** (`stale-basis` already led the dissent order). It is kept as a
regression guard on the precedence the verdict itself uses (a known failure outranks an unknown),
and is not claimed as proof of a fixed defect.

### Docs

`docs/how/dd/plan-ready.md`: the survey table row now reads *can't-tell*, and the basis section
says why in the same breath as the fact — a router-less repo gets "can't tell" because there is
nothing the reader could do about a not-ready there.

### Still open, and not ours

**Open Question 1** (`--strict` opt-in vs. not-ready always non-zero) remains open and is
Jordan's. Deliberately **not** resolved in code.

---

## R3 — re-review fixes (F001-F004, F006-F007; F005 held)

### RED-first controls

Five defect controls went RED against the pre-fix reader. The F006 doctrine-anchor assertion
passed on its first run; it is retained as a contract guard and is **not** counted as proof of a
fixed defect.

Failure output, verbatim:

```text
 ❯ test/services/dd/plan/ready.test.ts (34 tests | 5 failed) 261ms
     × R3/F001 — an agent-authored decision cannot decline a skipped survey 8ms
     × R3/F001 — even a user decision is not a decline on a done survey 5ms
     × R3/F003 — a malformed basis-less validation is not a router-unavailable attempt 5ms
     × R3/F004 — historical stale evidence cannot outrank the current unavailable node 5ms
     × R3/F002 — a current todo re-basis node outranks a historical decline 5ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/services/dd/plan/ready.test.ts > plan ready — the survey dimension > R3/F001 — an agent-authored decision cannot decline a skipped survey
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ test/services/dd/plan/ready.test.ts:338:38
    336|     const reading = readReady(corpus);
    337|
    338|     expect(reading.survey.satisfied).toBe(false);
       |                                      ^
    339|     expect(reading.survey.reason).toBe('missing-receipt');
    340|     expect(reading.verdict).toBe('not-ready');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯

 FAIL  test/services/dd/plan/ready.test.ts > plan ready — the survey dimension > R3/F001 — even a user decision is not a decline on a done survey
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ test/services/dd/plan/ready.test.ts:349:38
    347|     const reading = readReady(corpus);
    348|
    349|     expect(reading.survey.satisfied).toBe(false);
       |                                      ^
    350|     expect(reading.survey.reason).toBe('missing-receipt');
    351|     expect(reading.verdict).toBe('not-ready');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/5]⎯

 FAIL  test/services/dd/plan/ready.test.ts > plan ready — the survey dimension > R3/F003 — a malformed basis-less validation is not a router-unavailable attempt
AssertionError: expected null to be false // Object.is equality

- Expected:
false

+ Received:
null

 ❯ test/services/dd/plan/ready.test.ts:442:38
    440|     const reading = readReady(corpus);
    441|
    442|     expect(reading.survey.satisfied).toBe(false);
       |                                      ^
    443|     expect(reading.survey.reason).toBe('missing-receipt');
    444|     expect(reading.verdict).toBe('not-ready');

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/5]⎯

 FAIL  test/services/dd/plan/ready.test.ts > plan ready — the survey dimension > R3/F004 — historical stale evidence cannot outrank the current unavailable node
AssertionError: expected 'backpressure' to be 'backpressure-572b939e33c1' // Object.is equality

Expected: "backpressure-572b939e33c1"
Received: "backpressure"

 ❯ test/services/dd/plan/ready.test.ts:482:33
    480|     const reading = readReady(corpus);
    481|
    482|     expect(reading.survey.node).toBe(`backpressure-${basis.slice(0, 12…
       |                                 ^
    483|     expect(reading.survey.reason).toBe('missing-basis');
    484|     expect(reading.survey.satisfied).toBeNull();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/5]⎯

 FAIL  test/services/dd/plan/ready.test.ts > plan ready — the survey dimension > R3/F002 — a current todo re-basis node outranks a historical decline
AssertionError: expected 'backpressure' to be 'backpressure-572b939e33c1' // Object.is equality

Expected: "backpressure-572b939e33c1"
Received: "backpressure"

 ❯ test/services/dd/plan/ready.test.ts:525:33
    523|     const reading = readReady(corpus);
    524|
    525|     expect(reading.survey.node).toBe(`backpressure-${basis.slice(0, 12…
       |                                 ^
    526|     expect(reading.survey.reason).toBe('not-run');
    527|     expect(reading.survey.satisfied).toBe(false);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/5]⎯

 Test Files  1 failed (1)
      Tests  5 failed | 29 passed (34)
```

### T011 / F001 — only the human can decline

`decision` comments count only when the node is `skipped` and the comment source is `user`.
Invalid decisions are ignored while scanning newest-first, so an agent comment cannot self-clear
the chore or erase an earlier valid validation receipt. Controls cover both halves: agent source
on `skipped`, and user source on `done`.

### T012 + T014 / F002 + F004 — the current node owns the answer

The reader now selects `backpressure-<first 12 of current basis>` first, falling back to plain
`backpressure`. A current `todo` returns `not-run` even when an old node carries a decline, and a
current unavailable attempt returns `missing-basis` even when an old node carries stale evidence.
Historical dissent ordering remains only for documents with neither current node form.

### T013 / F003 — unavailable is detected, not inferred

Only an agent-authored validation matching `decision:unavailable reason:… time:…` may omit a
basis and read `missing-basis` / can't-tell. A merely malformed basis-less validation is
`missing-receipt` / not-ready.

### T016 / F006 — the protocol pin is real

The fixture test reads `skills/eng-harness-flow/SKILL.md` from the repository and asserts the
doctrine's `--kind validation --source agent --text "decision:unavailable reason:<…> time:<…>"`
shape, then asserts the fixture's kind, source, and text pattern. Production now reads the text
marker as part of its unavailable decision. This test was GREEN before the reader fix: it proves
the new cross-artifact contract, not a pre-existing runtime defect.

### T015 / F007 — evidence correction

Corrected in place under R1/F001 above. The original narrow plan-072 probe remains as history;
the correction cites plan 071's terminal `backpressure-1f1d8db67e6c`, whose persisted
`type: "chore"` demonstrates the shape.

### Focused GREEN

`npx vitest run test/services/dd/plan/ready.test.ts` → **34 passed / 1 file**, 0 failed.

### Held rulings — unchanged

- **F005**: `cant-tell` remains `unconfigured` / exit 2 in default and strict modes. No mapping,
  `--strict`, or rationale change was made pending Jordan's ruling.
- **Open Question 1**: default teeth remain untouched.

### R3 gates

`harness checks` went RED once: `biome:error` on import ordering in `ready.test.ts`; every other
hard gate was green in that run. After sorting the two imports, the whole composite gate was
rerun and exited 0.

| Gate | Result |
|------|--------|
| `npm run test` | **4446 passed / 309 files**, 0 failed; coverage 89.43% statements / 80.37% branches / 92.27% functions / 91.92% lines |
| `harness checks` (via `just checks`, after the recorded RED) | All hard gates **ok**: tests, biome, typecheck, check:docs, check:flows, check:telemetry-fixtures, check:doctrine-parity, check:dd-docs, root-invocation-smoke, dd doctor, skills-check |
| `npm run check:docs` | `check:docs OK — no drift` |
| `semantics.ts` guard | SHA-256 `3856153824f7fd3448aaf285197054a2f4a2524ed80c0fffe6dc9a3f8526f150`; byte diff empty |

Warn trio, verbatim JSON envelopes:

```json
{"command":"arch-check","status":"degraded","timestamp":"2026-08-05T10:20:10.242Z","data":{"modules":273,"dependencies":1223,"violations":[{"from":"harness/cli/src/services/telemetry/ref-source.ts","to":"harness/cli/src/adapters/git/git-write-port.ts","rule":"services-ports-type-only","severity":"warn","comment":"Port imports from services must be type-only (the kernel injects the implementation)."},{"from":"harness/cli/src/services/telemetry/sync-service.ts","to":"harness/cli/src/adapters/git/git-write-port.ts","rule":"services-ports-type-only","severity":"warn","comment":"Port imports from services must be type-only (the kernel injects the implementation)."}]},"next_action":"Review 2 warn-severity architecture violation(s) (rules: services-ports-type-only). Promote a rule's severity to 'error' in .dependency-cruiser.cjs once it should block — and never weaken a rule in the same PR that trips it."}
{"command":"markdown-lint","status":"degraded","timestamp":"2026-08-05T10:20:10.498Z","data":{"checks":[{"name":"markdownlint","outcome":"findings","findings":194,"examined":131,"summary":"harness-foundations/first-principles.md:7 error MD001/heading-increment Heading levels should only increment by one level at a time [Expected: h3; Actual: h4]"},{"name":"links","outcome":"findings","findings":1,"examined":131,"summary":"19:1-19:83 warning Cannot find file `../harness-presentations/missing-layer-101/intro-to-harness.md` missing-file remark-validate-links:missing-file"},{"name":"mermaid","outcome":"findings","findings":1,"examined":31,"summary":"invalid mermaid at skills/builder/references/stages/50-phase-tasks.md:215"}],"totals":{"findings":196,"filesLinted":131,"linksFilesChecked":131,"fencesParsed":31}},"next_action":"Review 196 markdown finding(s) (194 markdown lint, 1 in-repo links/anchors, 1 mermaid syntax) in `data.checks` — visible but non-blocking (warn-launch). Fix the authored docs, then promote the gate to error/exit 1 once they are clean (never widen the scope to dodge a finding)."}
{"command":"windows-check","status":"degraded","timestamp":"2026-08-05T10:20:09.430Z","data":{"scanned":27,"findingCount":6,"byRule":{"WIN004":1,"WIN007":5},"findings":[{"rule":"WIN004","title":"single-separator basename split","file":".harness/extensions/html-snap/extension.ts","line":121,"snippet":"const base = (abs.split('/').pop() ?? 'page').replace(/\\.html?$/i, '');","message":"Splitting a path on '/' only drops the basename of a Windows backslash path. Split on /[/\\\\]/ instead."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":18,"snippet":"'/usr/bin/google-chrome',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":19,"snippet":"'/usr/bin/google-chrome-stable',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":20,"snippet":"'/usr/bin/chromium',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":21,"snippet":"'/usr/bin/chromium-browser',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":22,"snippet":"'/usr/bin/microsoft-edge',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."}]},"next_action":"windows-check found 6 cross-platform hazard(s) in 2 rule class(es) [WIN004×1, WIN007×5] (warn-launch — non-blocking). First: .harness/extensions/html-snap/extension.ts:121 [WIN004] single-separator basename split. Fix per each finding's message, or add `// win-ok: <reason>` to intentionally allow a line. Rules: WIN001, WIN002, WIN003, WIN004, WIN005, WIN006, WIN007, WIN008. See `harness instructions windows-check`."}
```

---

## R4 — doctrine-complete unavailable detection and robust fallbacks

the unavailable-detection scope was set three times — too broad, too narrow, then to the doctrine's actual three shapes — and each earlier boundary was set without reading the doctrine's own enumeration.

### RED-first controls

All three doctrine shapes went RED against `6d8260dd`: an open-ended multiline
`decision:unavailable …` detection receipt, a parsed JSON envelope with `status: "noop"`, and a
parsed JSON envelope with `status: "UNAVAILABLE"`. The invalid-receipt diagnostics, two later
green fallback controls, genuinely id-less fixture, and CLI surface controls also went RED.

Failure summary, verbatim:

```text
 ❯ test/services/dd/plan/ready.test.ts (44 tests | 13 failed) 464ms
     × R3/F001 — an agent-authored decision cannot decline a skipped survey 11ms
     × R3/F001 — even a user decision is not a decline on a done survey 10ms
     × R3/F003 — a malformed basis-less validation is not a router-unavailable attempt 8ms
     × R4/F001 — router-missing detection receipt is a basis-less completed attempt 9ms
     × R4/F001 — router envelope status noop is a basis-less completed attempt 9ms
     × R4/F001 — boot envelope status UNAVAILABLE is a basis-less completed attempt 8ms
     × R4/F003 — later green matching validation outranks stale plain-node fallback 8ms
     × R4/F003 — later green human decline outranks stale plain-node fallback 8ms
     × R4/F004 — a genuinely id-less survey node degrades instead of throwing 11ms
     × R4/F005 — noop envelope is unconfigured at the CLI, exit 2 14ms
     × R4/F005 — UNAVAILABLE envelope is unconfigured at the CLI, exit 2 15ms
     × R4/F005 — agent decision is invalid-receipt at the CLI, advisory exit 0 13ms
     × R4/F005 — malformed basis-less validation is invalid-receipt at the CLI, advisory exit 0 14ms

 Test Files  1 failed (1)
      Tests  13 failed | 31 passed (44)
```

The discriminating failures were `false` vs `null` for all three unavailable attempts,
`backpressure` vs the later green node for both fallback cases, a thrown
`TypeError: Cannot read properties of undefined (reading 'toLowerCase')` for the id-less node,
`degraded` vs `unconfigured` for both envelope CLI cases, and `missing-receipt` vs
`invalid-receipt` for every receipt-present invalid case.

### T017 — the doctrine's three shapes

Detection receipts key on the protocol marker. Router/boot envelopes are parsed as JSON and only
their top-level `status` is inspected; prose is never searched. Exactly `noop` and `UNAVAILABLE`
join detection as completed basis-less attempts. Unparseable JSON, other statuses, and ordinary
basis-less validations remain not-ready.

### T018 — truthful invalid-receipt state

Receipt-shaped validation/decision comments that fail authority or basis rules now report
`invalid-receipt`. `missing-receipt` is reserved for a node that actually carries no valid or
invalid receipt-shaped comment.

### T019 + T020 — evidence-aware and id-safe fallback

The exact `backpressure-<current 12>` id remains authoritative. When it is absent, later green
validation/decline evidence is considered before the plain-node fallback. Runtime id reads are
guarded, so a genuinely id-less typed survey node returns a stated `missing-receipt` verdict with
`node: null` rather than escaping the envelope.

### T021 — CLI surface controls

Both real-envelope statuses assert `unconfigured` / exit 2 / `missing-basis`. Agent decisions and
malformed validations assert `degraded` / exit 0 / `invalid-receipt`, including the emitted
`next_action`. These tests observe the existing mapping; they do not alter it.

### Focused GREEN

`npx vitest run test/services/dd/plan/ready.test.ts` → **44 passed / 1 file**, 0 failed.
Typecheck also passed.

### Held rulings — unchanged

F005 exit semantics and Open Question 1 remain held. `harness/cli/src/acts/plan/index.ts`, the
mapping, and `--strict` are byte-untouched by R4.

### R4 gates

No R4 gate went RED after implementation.

| Gate | Result |
|------|--------|
| `npm run test` | **4456 passed / 309 files**, 0 failed; coverage 89.52% statements / 80.41% branches / 92.31% functions / 92% lines |
| `harness checks` (via `just checks`) | All hard gates **ok**: tests, biome, typecheck, check:docs, check:flows, check:telemetry-fixtures, check:doctrine-parity, check:dd-docs, root-invocation-smoke, dd doctor, skills-check |
| `npm run check:docs` | `check:docs OK — no drift` |
| frozen act guard | `harness/cli/src/acts/plan/index.ts` has no diff from HEAD |
| `semantics.ts` guard | SHA-256 `3856153824f7fd3448aaf285197054a2f4a2524ed80c0fffe6dc9a3f8526f150`; byte diff empty |

Warn trio, verbatim JSON envelopes:

```json
{"command":"arch-check","status":"degraded","timestamp":"2026-08-05T10:44:49.636Z","data":{"modules":273,"dependencies":1223,"violations":[{"from":"harness/cli/src/services/telemetry/ref-source.ts","to":"harness/cli/src/adapters/git/git-write-port.ts","rule":"services-ports-type-only","severity":"warn","comment":"Port imports from services must be type-only (the kernel injects the implementation)."},{"from":"harness/cli/src/services/telemetry/sync-service.ts","to":"harness/cli/src/adapters/git/git-write-port.ts","rule":"services-ports-type-only","severity":"warn","comment":"Port imports from services must be type-only (the kernel injects the implementation)."}]},"next_action":"Review 2 warn-severity architecture violation(s) (rules: services-ports-type-only). Promote a rule's severity to 'error' in .dependency-cruiser.cjs once it should block — and never weaken a rule in the same PR that trips it."}
{"command":"markdown-lint","status":"degraded","timestamp":"2026-08-05T10:44:49.926Z","data":{"checks":[{"name":"markdownlint","outcome":"findings","findings":194,"examined":131,"summary":"harness-foundations/first-principles.md:7 error MD001/heading-increment Heading levels should only increment by one level at a time [Expected: h3; Actual: h4]"},{"name":"links","outcome":"findings","findings":1,"examined":131,"summary":"19:1-19:83 warning Cannot find file `../harness-presentations/missing-layer-101/intro-to-harness.md` missing-file remark-validate-links:missing-file"},{"name":"mermaid","outcome":"findings","findings":1,"examined":31,"summary":"invalid mermaid at skills/builder/references/stages/50-phase-tasks.md:215"}],"totals":{"findings":196,"filesLinted":131,"linksFilesChecked":131,"fencesParsed":31}},"next_action":"Review 196 markdown finding(s) (194 markdown lint, 1 in-repo links/anchors, 1 mermaid syntax) in `data.checks` — visible but non-blocking (warn-launch). Fix the authored docs, then promote the gate to error/exit 1 once they are clean (never widen the scope to dodge a finding)."}
{"command":"windows-check","status":"degraded","timestamp":"2026-08-05T10:44:48.958Z","data":{"scanned":27,"findingCount":6,"byRule":{"WIN004":1,"WIN007":5},"findings":[{"rule":"WIN004","title":"single-separator basename split","file":".harness/extensions/html-snap/extension.ts","line":121,"snippet":"const base = (abs.split('/').pop() ?? 'page').replace(/\\.html?$/i, '');","message":"Splitting a path on '/' only drops the basename of a Windows backslash path. Split on /[/\\\\]/ instead."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":18,"snippet":"'/usr/bin/google-chrome',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":19,"snippet":"'/usr/bin/google-chrome-stable',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":20,"snippet":"'/usr/bin/chromium',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":21,"snippet":"'/usr/bin/chromium-browser',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."},{"rule":"WIN007","title":"POSIX absolute path or HOME env","file":".harness/extensions/html-snap/snap-core.ts","line":22,"snippet":"'/usr/bin/microsoft-edge',","message":"POSIX system paths (/usr, /bin, …) and $HOME do not exist on Windows. Read config via ctx.env.get (USERPROFILE/APPDATA on Windows) and avoid absolute system paths."}]},"next_action":"windows-check found 6 cross-platform hazard(s) in 2 rule class(es) [WIN004×1, WIN007×5] (warn-launch — non-blocking). First: .harness/extensions/html-snap/extension.ts:121 [WIN004] single-separator basename split. Fix per each finding's message, or add `// win-ok: <reason>` to intentionally allow a line. Rules: WIN001, WIN002, WIN003, WIN004, WIN005, WIN006, WIN007, WIN008. See `harness instructions windows-check`."}
```
