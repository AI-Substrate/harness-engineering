# Validation — Phase 1 tasks dossier

**Verdict**: ✅ **VALIDATED** — no material issues (1 advisory line-pin note, non-blocking).
**Target**: `docs/plans/047-session-telemetry-dashboard/tasks/phase-1-session-export-foundation/tasks.md`
**Validated**: 2026-07-01
**Proof level reached**: Implementation Ready (tasks dossier — a phase is buildable from it)

## Thesis
The dossier is a faithful, buildable expansion of Phase 1 of the already-validated plan: all seven plan tasks (1.1–1.7) map 1:1 to T001–T007, every file placement was checked against disk, and every load-bearing `file:line` pin resolves against current source. It advances its purpose (a coder can implement Phase 1 from it without re-deriving the plan) and invents no product intent beyond the plan.

## Proof (fresh, this validation)
- **Task fidelity**: T001↔1.1, T002↔1.2, T003↔1.3, T004↔1.4, T005↔1.5, T006↔1.6, T007↔1.7 — no dropped or invented tasks; TDD ordering (T002/T004 before impl, T007 failing-assertion) preserved.
- **File placement checked on disk**: `session-export.ts` + `session-export.schema.json` confirmed **absent** (create); `acts/telemetry.ts` + all reference files (`otlp/logs.ts`, `otlp/metrics.ts`, `rollup.ts`, `segment.ts`, `sync-service.ts`, `session-evidence.ts`) confirmed **present**; real fixture corpus present (claude, copilot-cli, copilot-vscode, cursor).
- **Load-bearing pins resolve**: `segmentToOtlpLogs` `logs.ts:292`; `otlpLogsToEvents` inverse `:311`; `rollupToOtlpMetrics` `metrics.ts:52` (grep confirms **no inverse** — KF-02 holds); `computeRollup` `rollup.ts:135` + `IDLE_CAP_S=300` `:17`; `event_stream` required `Event[]` (`segment.ts:135`, required-list `:207`, v1-compat derivable view `:138`) — the T007 v1-crash seam is real; sync-service segment enumeration/filter `:189-210`; `PIJ_SESSION_ID` join in `session-evidence.ts`.
- **AC coverage inherited & intact**: AC-01→{T001,T003,T005}, AC-02→{T002,T003,T007}, AC-10→{T006} — matches the plan's coverage map.

## Findings
None material. One advisory note (does not change action):

| Severity | Note | Evidence | Disposition |
|----------|------|----------|-------------|
| ADVISORY | The dossier inherits the plan's `segment.ts:196-197` pin for "`event_stream` required"; the field decl is `:135` and the exact required-list entry is `:207`. The **semantic claim is correct** (`event_stream` is non-optional; v1 lacks it). | `segment.ts:135,207` | Left as-is — inherited verbatim from the validated plan; line drift is immaterial to the task. Optional tidy at implement time. |

## Constraints preserved
- **P2 (Ports & Adapters)**: dossier explicitly forbids `node:fs`/`child_process`/git imports in `session-export.ts`; spool I/O via the existing fs seam + `FakeFs`.
- **P3 (fakes over mocks)**: real corpus + 038 goldens; no `vi.mock`/`vi.spyOn`.
- **P4 (stable Envelope)** + **additive schema** (`schema_version` pinned, `additionalProperties:true`) — forward-compatible with P2 report + plan 046 `RunRecord.session_export`.

## Reverification
Direct proof settles the target (faithful expansion of an upstream plan that already carried an independent critic last turn); zero additional workers warranted per the adaptive topology. `VALIDATED`.
