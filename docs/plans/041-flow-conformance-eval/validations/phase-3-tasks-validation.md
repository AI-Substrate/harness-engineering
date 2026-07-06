# Validation Record — Phase 3 tasks dossier

**Validated**: 2026-06-29 · **By**: /the-flow (post-tasks validate) · **Verdict**: ✅ VALIDATED WITH FIXES

- **Target**: `docs/plans/041-flow-conformance-eval/tasks/phase-3-scenario-md-to-pdf-orchestration-docs/tasks.md`
- **Proof**: deterministic source checks (lead) + one independent critic (Explore).

## Critic finding → resolution
| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 1 | MED | T003 row omitted the explicit `plan --simple` requirement (present in Goals, not the task row) — an implementer could drop it | T003 now spells out the full choreography incl. `plan --simple` + a done-when that explicitly requires it (per original-ask "select simple") |

## Confirmed sound (critic-verified, no change)
- Phase-2 loader expects `live-testing/scenarios/<slug>/` ✓
- 13 assertion types match the workshop registry + Phase-2 `resolvers.ts` exactly ✓
- Original-ask choreography (worktree, md→PDF + mermaid, Simple flow, compact-before-implement, backpressure-as-judged) reflected in T001–T004 ✓
- T002 blind-packet anti-leakage = process control (forbidden-content checklist + reviewer pass) ✓
- Scope correctly excludes the live eval run (T005 fixture-only) + engine edits (Non-Goals) ✓
- Tasks 3.1–3.6 all covered by T001–T006 ✓

**Thesis**: advanced — a faithful, implementable decomposition of the scenario + orchestration + docs phase; the one gap (an under-pinned required flag) is closed before build.
