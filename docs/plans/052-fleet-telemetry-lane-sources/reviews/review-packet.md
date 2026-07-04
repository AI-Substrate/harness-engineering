# Review packet — 052 Phase 1 (d-001, round 1)

**Role**: cross-model reviewer · **Report to**: orchestrator via `pij send pij-4s10mb "<verdict>"`
**Scope**: commit `6b2811ba` on `feat/041-flow-conformance-eval` (30 files: 4 readers, get-fleet wiring, adapter + classifier fixes, 5 test files, 11 scrubbed fixtures, docs matrix, evidence). Review THE DIFF (`git show 6b2811ba`), grounded in:

- Plan + ACs: `docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md` (AC-01..06, AC-08; § Honesty invariants)
- Task table: `docs/plans/052-fleet-telemetry-lane-sources/tasks/phase-1/tasks.md` (the golden numbers)
- Coder's log: `docs/plans/052-fleet-telemetry-lane-sources/tasks/phase-1/execution.log.md`
- Rubric: 10 dimensions per flow-pair review rubric; verdict = APPROVE | APPROVE_WITH_NOTES | FIX_REQUIRED with findings as F<N> (severity CRITICAL/MAJOR/MINOR, file:line, evidence)

## Mandatory checks (CODE packet)

1. **Dimension 0 — test quality (mutation gate, REQUIRED)**: the coder wrote its own tests; green ≠ good. Prove the golden test `fleet-golden-051.test.ts` is non-vacuous: either run a real mutation (`just flow-pair-mutate <file> '<sed-expr>'`) or make a reasoned mutation argument naming the exact assertion that flips (e.g. corrupt the fixture's `totalNanoAiu`, or make the copilot-ledger reader return 0 — which assertion fails?). Specifically check the golden numbers are DERIVED by the readers parsing fixtures, not hard-coded constants compared to themselves.
2. **Honesty invariants**: shape-mismatch fixtures must degrade lanes to `cost_measured:false` — verify negative fixtures exist and the assertions actually distinguish degraded from measured. Absent `~/.copilot`/`~/.codex`/`~/.pij` → unavailable, never throw.
3. **Privacy (counts-only)**: inspect the 11 new fixtures — no prose, no message bodies, no absolute machine paths, no secrets; privacy-scan test extended to cover them.
4. **Closed schema**: `fleet-export.schema.json` still `additionalProperties:false`; the negative-key test fails on an un-enumerated field (check it's not testing a key the schema never had).
5. **T001 adapter fix**: copilot adapter create→written / edit→edited mapping — check paths are repo-relativized consistently with the claude adapter and don't capture out-of-repo absolute paths into segments.
6. **T002 classifier**: packet fixtures classify NOT-review AND the real review fixture still yields FIX_REQUIRED `{critical:1}` — both directions asserted.
7. **Lane discipline**: diff touches ONLY allowed paths (telemetry src/tests, acts get-fleet wiring, docs/how/telemetry.md, 052 tasks/evidence). No the-flow files, no other plans, no scratch.
8. **Gates**: re-run `harness checks` yourself; confirm the coder's claimed EXIT 0. Judge the new arch-check degrade (ref-source.ts importing TELEMETRY_REF_GLOB) — accept or flag.

Report format: verdict, findings list (or "none"), Dim-0 evidence (the mutation + which assertion flips), checks exit code you observed.
