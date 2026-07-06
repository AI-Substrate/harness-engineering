# Fix packet — 052 Phase 2 (d-002, FIX round 1)

**Role**: coder · **Report to**: `pij send pij-4s10mb` · **Base**: your commit `46a3ec9c`
**Source**: reviewer verdict FIX_REQUIRED — full review at `docs/plans/052-fleet-telemetry-lane-sources/reviews/review.phase-2.md`

## The one blocking finding

**F1 · MAJOR — fleet-level semantics omits `plan_cs` while T009/docs/evidence claim plan phases/CS.**
`FleetLaneSemantics` has `plan_cs`, but `FleetSemantics` only has `plan_phases` (`fleet-evidence.ts:210-234`); `fleetSemantics(...)` never aggregates it (`:497-564`); the schema's fleet block lacks it (`fleet-export.schema.json:216-238`); the golden test comment says "CS-3" but asserts only `plan_phases` (`fleet-semantics-golden-051.test.ts:220-223`); the evidence note claims `plan_cs:3` at fleet level, which is currently false.

## Required fix (reviewer's smallest-fix, adopted)

1. Add `plan_cs?: number | null` to `FleetSemantics`; aggregate from measured lanes consistently with `plan_phases` (first non-null / structural max — pick one and document it in the code + docs).
2. Add `plan_cs` to the fleet block in `fleet-export.schema.json` (closed schema stays closed).
3. Assert it in the semantic unit test AND the 051 golden (`expect(s.plan_cs).toBe(3)` — non-vacuous: it must come from the rollup, not a literal in the builder).
4. Regenerate `evidence/fleet-051-semantics.json` so the note's fleet-level `plan_cs:3` claim is true; touch the note only if wording needs it.

## Scope

ONLY the files above + `execution.log.md`. New commit, prefix `fix(telemetry-052):`, explicit pathspecs, `--no-verify`. Gate: `just fix` + full `harness checks` green; Phase 1 + Phase 2 tests all stay green.

Report: fix summary, the new assertion location, checks exit, commit SHA.
