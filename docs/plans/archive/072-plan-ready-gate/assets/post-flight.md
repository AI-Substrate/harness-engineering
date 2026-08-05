# Post-flight — 072-plan-ready-gate

**Closed out**: 2026-08-06T07:35:00Z
**Archived to**: docs/plans/archive/072-plan-ready-gate/
**Shipped**: yes — merged to `main` as `1aef9d9c` (PR #98) **before** this close-out ran.
Close-out ordering was wrong and is recorded as such rather than tidied: it belongs before the
PR, and Jordan called it.

## Completion

| Check | Result |
|-------|--------|
| Phases / tasks | all complete — 25 checked, 0 open (Simple mode, one phase, T001–T010) |
| Acceptance criteria | AC-01…AC-11 met; AC-09/AC-10/AC-11 added mid-flight from review findings |
| Latest review | **APPROVE** (`assets/reviews/review.md`, cross-model reviewer, round 4) |
| Full suite | 4587 passed / 0 failed against the merge base |

## Open / deferred items

_Carried into the archive deliberately — none block the shipped work._

| Kind | Item | Where | Note |
|------|------|-------|------|
| Decision | **F005 — what `can't-tell` should exit** | Jordan | Shipped as `unconfigured`/exit 2. My R2 rationale was **false on the numbers**: the default path went 0 → 2, so the change added a block rather than removing one. Recommendation on record: make `--strict` the single place teeth live and document `plan ready` as an explicit exception to `unconfigured → 2`. One-line mapping change. |
| Decision | **Open Question 1 — `--strict` opt-in vs always-teeth** | Jordan | Resolved *by design*, never by ruling. Untouched in code across five rounds (`acts/plan/index.ts` diff verified zero each round). |
| Upstream | **FX009 — receipt-form conflict** | prime | Three sources disagree on how an unavailable-attempt receipt is recorded; `00-routing.md:226` states both forms as alternatives. `plan ready` **tolerates both and does not adjudicate**, citing all three. Prime's direction: a stable `decision:unavailable reason:<verbatim envelope>` prefix. |
| Harness | **DL-007 — no detector for deployed-vs-source skill drift** | retro `2026-08-05/001` | The finding that cost this plan its format: a Jul-15 builder authored an Aug-5 plan in markdown while in-repo source authored `plan.dd.json`, and eleven `harness checks` runs read green. Fix landed (`just local-deploy` + `verify-global-link`); the **detector** is unbuilt. |
| Known limit | `plan ready` reads dd-native plans only | `docs/how/dd/plan-ready.md` | This plan's own artifacts are markdown — authored by the stale skill — so the gate **cannot judge its own plan** (`E400`). Not a defect in the gate. |

## Harness close-out

Observations drained to `.harness/records/retro/2026-08-05/001-072-plan-ready-gate.md`
(8 entries: 5 from this plan, 2 inherited undrained from the 2026-08-04 eval stream in the same
worktree, 1 — DL-007 — captured at close-out because it had never been observed).

Highest-leverage improvement named: **DL-007**, a deployed-vs-source drift detector. It is the
only entry that caused work to be built wrong rather than merely costing time, and the
skill-deployment doctor already knows both paths.

## What this flight is worth remembering for

The code was right early. **Four of the six coder rounds corrected a claim, not a mechanism** —
twice in a sentence written to fix the previous sentence. The unavailable-receipt boundary was
set five times before anyone asked whether the shapes being parsed were ever emitted; they were
not. That is this plan's own thesis — an instrument whose claim is broader than its coverage —
landing on the plan itself.

## Archive note

`harness flow list` reports **0 registered flows**, so the dd-native `flow relocate` step does
not apply here: this plan's flight plan lives inside the plan folder (`the-flow.json`), moves
with it, and carries no repo-root-anchored `dd_link` gate addresses to strand.
