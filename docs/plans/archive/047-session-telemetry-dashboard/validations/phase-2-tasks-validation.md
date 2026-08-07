# Validation — Phase 2 tasks dossier (Reports, Rollups & Render)

**Target**: `docs/plans/047-session-telemetry-dashboard/tasks/phase-2-reports-rollups-render/tasks.md`
**Verdict**: ✅ **VALIDATED WITH FIXES** — 0 critical, 0 high, 2 medium (both repaired + re-verified)
**Mode**: adaptive (lead deterministic proof + 1 independent readiness critic)
**Date**: 2026-07-01

## Thesis
Purpose **met**: the dossier is a faithful, actionable expansion of plan Phase 2 (tasks 2.1–2.8) into T001–T010, grounded in workshops 002/003 and Phase 1's exported surface. Target proof = actual proof: every task an implementer can execute; test-before-impl encoded where the plan mandates it (T002→T003, T004→T005); non-vacuity (mutation-flip) required on the counts (T003) and attribution (T004) tests.

## Deterministic proof (all passed)
- Line refs resolve: `rollup.ts:135` (`computeRollup`), `segment.ts:432` (`command` field), `gen.py:635` (inline `<script type="application/json">`), `acts/telemetry.ts:174` (`session save` block), `app.ts` telemetry mount.
- "Create" claims correct: `report.ts` / `report.schema.json` / `render/` do **not** exist yet.
- Fixture corpus present: `test/services/telemetry/fixtures/real/{claude,copilot-cli,copilot-vscode,cursor}`.
- Faithful mapping vs plan AC×task matrix (plan lines 238–246): AC-03←T001/T003 · AC-04←T002/T003/T004/T005 · AC-05←T006 · AC-06←T007 · AC-07←T008. AC-10 correctly remains Phase 1's (task 1.6) — dossier *honors* degraded `'unknown'`/v1 (KF-08) without claiming the AC. No Phase-3 (git-ref/central-layout/docs) scope leak.

## Findings (both MEDIUM — repaired)
| # | Location | Finding | Fix applied | Re-verified |
|---|---|---|---|---|
| 1 | T005 | `flow_stage.tokens` was unassigned — T001 gives every dimension `tokens`, but T005 scoped attribution to skill/tool/bash/harness only, leaving flow_stage tokens unpopulated (implementer would guess). | Added a clause: a turn's tokens attribute to the active `flow_stage` window (workshop 002 §attribution) + a Done-When asserting `flow_stage` entries carry non-null tokens. Evidence-pinned to workshop 002 line 63 — not invented intent. | ✅ workshop 002 §attribution explicitly brackets turn tokens to the stage window |
| 2 | T010 | Live-smoke task exceeds the plan's 2.1–2.8 rows (net-new verification scope). Critic rated it "acceptable rigor, not fabrication." | Annotated T010 as **verification-only, beyond plan rows, principal-directed via retro INS-001** so it isn't mistaken for a plan deliverable. Not a defect — it encodes the principal's "actual exports and check them, not just TDD" bar. | ✅ traces to retro INS-001 + explicit principal instruction |

## Consumers
Immediate consumer = the **implement** verb for Phase 2 (then `review-2`). The dossier's contract (report shape, five dimensions, attribution block, inline-embed render, `--no-html` semantics) matches workshop 002/003 and consumes Phase 1's `SessionExport`/`signals.logs` + frozen transforms without invention. Forward-compatible: additive schema, stable dimension keys.

**Open decision**: none — ready to implement.
