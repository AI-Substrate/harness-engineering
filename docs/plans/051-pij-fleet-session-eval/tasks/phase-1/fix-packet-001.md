# Fix packet 001 — plan 051 phase 1 (review verdict: FIX_REQUIRED)

You are the flow-pair CODER (orchestrator: pij-4s10mb). One CRITICAL finding from review. Fix it, re-run the gates, report via `pij send pij-4s10mb "<report>"`. No commits. Repo root: `/Users/jordanknight/substrate/harness-engineering`.

## The finding (F1 · CRITICAL) — full text in `docs/plans/051-pij-fleet-session-eval/reviews/review.phase-1.md`

Roster scope is only **labelled**, not applied. `buildFleetEvidence` (`harness/cli/src/services/telemetry/fleet-evidence.ts:284-323`) builds `sessions` from every env-tree child, then attaches roles — totals iterate the unfiltered list. Result: `evidence/fleet-050-roster-scoped.json` says `scope:"roster"` but still totals the 13 unrostered 050-era lanes (78,814,658), contaminating the labelled run's cost/time. Violates AC-04 + workshop D1 ("env tree = superset, roster = run scope").

## Required fix (reviewer's smallest-fix, adopted as-is)

1. In `buildFleetEvidence`, when `roster` is present: build `sessions` and ALL totals (cost + time) from the orchestrator lane + only child ids present in `roleOf`. Keep `envTreeIds`/`childIds` for the diffs.
2. Diffs unchanged in meaning: roster members absent from the env tree → `orphans`; env-tree children absent from the roster → `unrostered` (ids only — NOT in `sessions`, NOT in totals).
3. Tests: add a regression where a **measured** unrostered child would contaminate cost/time if included (must fail on the old behaviour); update the existing roster tests (`fleet-evidence.test.ts:255-266`, `:316-321`) to assert the unrostered child is NOT in `sessions`.
4. Regenerate `docs/plans/051-pij-fleet-session-eval/evidence/fleet-050-roster-scoped.json` via the live `get-fleet --roster` run and update the reconcile note (the roster-scoped file should now show only rostered lanes; the env-tree file keeps the 78,814,658 superset). Both must still validate against the closed schema.
5. Append a fix entry to `tasks/phase-1/execution.log.md`.

## Gates

`cd harness/cli && npx vitest run test/services/telemetry/` green · `just build` · `harness checks` exit 0 (pre-existing warn-launch degradeds tolerated).

## Allowed paths

Same as the original coder packet (`tasks/phase-1/coder-packet.md`) — fleet-evidence source/tests, evidence dir, execution log.

## Forbidden

Flow files (`the-flow.json`/`the-flow.md`/`.the-flow-state.json`), plan/workshop/review docs, doctor files, `docs/plans/041-*`/`048-*` dirty files. No commits.
