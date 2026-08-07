# Validation — tasks/phase-2-sensors-engine-headless/tasks.md

**Validated**: 2026-07-14 · **Validator**: independent Opus critic (read-only) + lead adjudication · **Revision**: post-fix

## Verdict

✅ **VALIDATED WITH FIXES** — 0 critical, 0 high, 2 medium; both verified at source, fixed in-target, re-verified.

- **Target**: `tasks/phase-2-sensors-engine-headless/tasks.md`
- **Proof**: critic verified plan-task mapping 2.1→2.8 ↔ T001–T011 complete (2.3→T003/T004, 2.4→T005/T006, 2.5→T007/T008); AC-06/08/09/10/11/13 attribution matches the plan's coverage matrix; no Phase-3/AC-12 work smuggled in; **every "verified by read" Pre-Implementation claim held against the real tree** — E210+ block genuinely free (E204 last update code, E300 first flow code; E149 also free), `RESERVED_NAMES` (registry.ts:56) = 10 names without `sensors`, `NormalizedSensor` (v2/types.ts:21), `API_VOCABULARY` with `sensors` in-vocabulary (contract.ts:253), validate.ts:150-153 / normalize.ts:106-109 branches, ScaffoldVariant (templates.ts:3), FsPort.rename atomicity, spawnDetached, FakeClock, app.ts:285 registration seam, corpus guard bytes-only append-only; all four claimed-new paths genuinely absent.
- **Consumers**: implement verb — T-rows testable; workshop verb — T001 scoped; Phase 3 boundary respected.

## Findings

| # | Severity | Finding | Fix applied |
|---|----------|---------|-------------|
| F1 | MEDIUM | TDD red lane (T002) omitted the phase's highest-risk behaviours: no failing tests scoped for the scheduler (a **named test-first focus area** in the plan's Testing Strategy), `WatcherPort`-driven semantics, or `ctx.registry.items` — test-first discipline was applied to the simplest tasks and skipped on the hardest | T002 extended: failing scheduler-semantics tests (quiescence, dedup, serialize, stale-queue-of-one, manual-trigger skip, via FakeWatcher/FakeClock shapes from T001) + custom-items test; test paths added; T004/T008 Done-When now cite "T002 … tests green"; T007 notes the scheduler red tests compile against its fake |
| F2 | MEDIUM | Architecture-map DAG contradicted the tasks' own Done-When: T005/T006 required "T002 tests green" but the graph wired them off T001 only — an implementer scheduling by the graph could build state-store/snapshot before the red lane exists | Added edges `T002 --> T005/T006/T007/T008`; graph and Done-When now agree |

## Note

Phase 1's validation caught a "verified free" claim that had never been read (E145/E146, retro DL-001). This dossier's Pre-Implementation table was built read-first and **survived the same independent check intact** — the critic explicitly re-opened `error-codes.ts` and every cited symbol. The loop closed.
