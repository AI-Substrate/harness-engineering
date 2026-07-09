# Validation — dont-apologise-fix-plan.md

**Validated**: 2026-07-09 · **Mode**: adaptive, user-directed subagents (2 Opus critics + lead deterministic proof) · **Verdict**: VALIDATED WITH FIXES (plan v1.1.0)

## Contract

- **Purpose**: encode the environment-first posture into mechanically re-read channels; make drain outcomes (dispositions incl. declined/deferred) durable and measurable; T+3wk effectiveness re-entry.
- **Proof target**: Implementation (plan ready to build from).
- **Upstream**: original-ask.md decision record; workshop 001 (D1–D6, authoritative); research-dossier.md.
- **Consumers**: implement verb (Simple mode inline tasks); next efficiency plan (reads per-stage telemetry baseline).

## Deterministic proof (lead)

- All 10 cited target files exist; `observe_kind`/`'retro'` absent from events.ts (0 matches — planned work is real).
- segment.ts:383 harness case is an explicit per-field pick (`verb` only) — confirmed V-01.
- retro-template.test.ts: top-level-key superset + hard `1.1` lockstep only — confirmed V-03.
- retro.schema.json: entry fields optional-capable; 1.1 records remain valid under additive change.

## Findings (all verified by lead against source; all fixed in plan v1.1.0)

| ID | Sev | Finding | Fix applied |
|----|-----|---------|-------------|
| V-01 | CRITICAL | `observe_kind` dropped by serializer per-field pick; OTLP + construction sites missing from manifest (segment.ts:383, otlp/logs.ts:119/271) | T003 paths + Done-When (wire-path round-trip both lanes); manifest rows added |
| V-02 | HIGH | Phases 2..N posture instructions have no deterministic carrier (no CLI expander; doctrine block carries shape, not instructions[]); AC-02 checked phase-1 only | T008 resolves carrier explicitly; AC-02/T017 assert expander-created observe-2 |
| V-03 | HIGH | Pinning test blind to entry-level fields + hard 1.1 lockstep breaks on bump | T001 extends test to entry level + 1.2 lockstep, one commit; Key Finding 02 corrected |
| V-04 | HIGH | Declined/deferred trace (headline promise) verified only by documentation, never behaviourally | T014 scenario must produce + assert declined and deferred entries; AC-04 remapped |
| V-05 | MEDIUM | Workshop D5 "fp stays OUT of telemetry" had no negative guard | T003 negative snapshot test (key set excludes fp/reasons) |
| V-06 | MEDIUM | "Three tripwires with thresholds" never enumerated — AC-10 unfalsifiable | TW-1/TW-2/TW-3 enumerated with thresholds in AC-10 |
| V-07 | MEDIUM | T0 baseline vacuous for disposition queries (no 1.2 data exists yet) | Runbook validates execute-only for disposition queries; real baselines for TW-1/TW-3 |
| V-08 | MEDIUM | Parity-guard-green was AC-03's proof but guard covers only the shared block | AC-03 backed by four-site grep; narrowed wording stays outside guarded block |

## Clean results

All 11 decision-record items map to tasks; discrimination test present verbatim (T006); 17-task ordering holds (every consumer after its producer); no anti-goal contradictions (never-gate, metrics-never-agent-facing, user-still-delivers).

**Thesis**: advanced — target proof (Implementation) now matches actual proof after fixes.
**Consumers**: implement verb satisfied (tasks concrete, Done-When testable); efficiency plan satisfied (baseline documented).
