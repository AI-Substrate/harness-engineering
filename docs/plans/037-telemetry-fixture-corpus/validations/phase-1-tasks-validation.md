# Validation — Phase 1 tasks dossier

**Target**: `tasks/phase-1-foundation-claude-proof/tasks.md`
**Validated**: 2026-06-25 · **Verdict**: ✅ VALIDATED WITH FIXES
**Topology**: lead + deterministic proof + 1 critic

## Proof (lead-read)
- Referenced existing files all present: `posix-path.ts`, `segment.ts`, `claude-adapter.ts`, `node-db.ts`.
- `arch-check/` template = `extension.ts` + `mapping.ts` + `mapping.test.ts` + `instructions.md` + `fixtures/` (the split-logic pattern T004 copies).
- `t_precision` is a real serialized-event field (`segment.ts:285`) but claude emits EXACT per-line timestamps (no `t_precision`); `anchored` is for approximated stamps. T008 invariant corrected accordingly (exact, not anchored).
- Reserved-verb mechanism confirmed (`registry.ts`) → T004 name check is real.

## Findings (all repaired)
| # | Sev | Finding | Fix |
|---|-----|---------|-----|
| 1 | HIGH | T007 byte-scans the `expected-segment.json` golden that T008 produces, but the graph wired `T006→T007` with no `T008→T007` edge → vacuous scan, defeating AC-02. | Re-ordered: `T006→T008→T007` in graph + table; T007/T008 Notes state the dependency. |
| 2 | MED | T004 verb name was a `<verb>` placeholder → "non-reserved" unverifiable. | Pinned to `capture-fixtures`; reserved-set listed in Done-When. |
| 3 | MED | T009 de-risk intent ("before Phase 2") not graph-enforced. | Marked T009 a Phase-1 **exit gate**. |

**Thesis**: advanced — faithful 1:1 expansion of the validated plan; the one material defect (golden-before-scan ordering) is fixed, so AC-02's anti-vacuity guarantee holds in execution order.
**Consumers**: the **implement** verb (next) — dossier is implementation-ready.
