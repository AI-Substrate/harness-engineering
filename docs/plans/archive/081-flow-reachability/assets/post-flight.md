# Post-flight — 081-flow-reachability

**Closed out**: 2026-08-09T08:45:00Z
**Archived to**: `docs/plans/archive/081-flow-reachability/`
**Shipped**: yes — PR #146, squashed to main as `6a43fd4d` (merge preceded this close-out; see § The gap this close-out is itself evidence of)

## Completion

| Check | Result |
|-------|--------|
| Phases / tasks | 3/3 phases complete; phase-1 task graph 5/5 with `done_when` assertions closed |
| Acceptance criteria | 8/8 met, each linked to its backpressure row and rendered into the PR body by `harness plan pr-body` |
| Latest review | APPROVE — cross-model reviewer `gpt-5.6-sol`, after 8 rounds terminated by prime's standing rule |
| CI | green at `ea86c9c4` (build-test 22 + 24, ci-required, package-smoke, rename-guard) |

## Open / deferred items

_Carried into the archive deliberately — none block the shipped work._

| Kind | Item | Where | Note |
|------|------|-------|------|
| Open question | Final verb name (`harness flow check` is the working name) | plan `open_questions` | Ratifiable with ermine at handoff; the contract marks it as such |
| Open question | Whether the verb takes a sweep form or stays single-target | plan `open_questions` | Leaning single-target; sweep is additive later |
| Pending | CLI registration of `checkReachability` (~10-line lift) | `acts/flow.ts` | Fenced file, three claimants; awaits prime brokering a window or a ride on #137 |
| Filed | Non-atomic rollback on the flow write path | #142 | Correctness defect found by the review; not this plan's to fix |
| Filed | biome does not lint `.harness/extensions/**` | #147 | Measured (61 findings, 49 auto-fixable, 12/12 extensions affected); deferred with a number, not an adjective |
| Routed | dd sweep-exclusion gap (`shouldExcludeFromSweep` takes the parsed doc) | via prime → dd owners | Workaround + reason recorded in the fixtures README |
| Handed off | DELTA blocks into ermine's `stand-up.md` | pij `docs/fleet-live-findings` @ `124e289f` | Landed by ermine; the bare-create command held until this merge |

## Archive record

`git mv docs/plans/081-flow-reachability docs/plans/archive/081-flow-reachability`, then
`harness flow relocate --path <archived>/the-flow.json --to docs/plans/archive/081-flow-reachability`.

**The relocate was not optional and nearly was skipped.** This flow is not registered in
`.harness/flows/`, so `harness flow list` returns zero and 7b's own instruction ("empty → skip
the relocate and say so") would have applied by the letter. But the flight plan carries **two
repo-root-anchored `dd_link` gates** — `phase-1 → assets/tasks/phase-1/tasks.dd.json#tasks` and
`review-1 → plan.dd.json` (`check: plan-validate`) — and the move strands both. Nothing catches
it: `dd doctor` sweeps `*.dd.json` and never reads a flow, and an archived plan has no
departures left to refuse, so the breakage has no discovery moment at all. `relocate --path`
takes the flow file directly, which is the correct instrument here.

*Worth carrying: the skip clause is written for "no dd-native flow exists", but its **test** is
"the registry is empty" — and those differ for any flow that lives beside its plan rather than
in `.harness/flows/`. A condition standing in for the thing it means, which is this plan's own
subject.*

## The gap this close-out is itself evidence of

This note was written **after** the merge, not before it. Post-flight is meant to precede ship;
it did not, because nothing gates a step that runs once the PR is green and the reward has
landed. Prime measured the pattern rather than treating it as one seat's lapse: **four
consecutive merged plans — 073, 075, 076 and this one — sat unarchived in `docs/plans/`, none
archived by the seat that shipped them.** Sixty-eight older plans were archived in a single
sweep commit, which is what a step with no gate looks like when someone finally notices.

Filed as a systemic finding with the enumeration and the measurement; the gate is **proposed,
not built** — whether it belongs in `checks`, the merge path, or a chore is a design question
for whoever owns it, not for whoever noticed.
