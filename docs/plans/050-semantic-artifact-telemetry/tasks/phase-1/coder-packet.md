# Implement packet — plan 050 phase-1 (whole phase, T001–T006)

You are the **coder** in a flow-pair fleet. Implement **every task** of the single phase in one run — no partial handbacks. Repo root: `/Users/jordanknight/substrate/harness-engineering`.

## Read first (in order)
1. `docs/plans/050-semantic-artifact-telemetry/semantic-artifact-telemetry-plan.md` — the plan: task table T001–T006, Domain Manifest, Key Findings 01–06, AC-01..07. It is validated READY; follow it.
2. `docs/plans/050-semantic-artifact-telemetry/workshops/001-semantic-telemetry-elements.md` — **authoritative design**: element inventory (rows 1–22), `ArtifactEvent` shape, extractor registry contract, privacy contract, capture mechanic. Do not contradict it.
3. The exemplar: `harness/cli/src/services/telemetry/flow-log.ts` — copy its posture (pure, defensive, privacy-scoped, offset/windowed thinking).

## Scope — allowed paths ONLY
- `harness/cli/src/services/telemetry/artifact-semantics.ts` (NEW)
- `harness/cli/src/services/telemetry/events.ts`, `segment.ts`, `rollup.ts`, `capture-service.ts`
- `harness/cli/src/services/telemetry/segment.schema.json`
- `harness/cli/src/services/telemetry/otlp/logs.ts`, `otlp/semconv.ts`, `otlp/harness-otlp.schema.json`
- `harness/cli/test/services/telemetry/artifact-semantics.test.ts` (NEW), `capture-service.test.ts`, and any existing telemetry test that must learn the new kind (e.g. reconstruction / frozen-schema tests' kind lists)
- `docs/how/telemetry.md` (one new section)
- `docs/plans/050-semantic-artifact-telemetry/semantic-artifact-telemetry-plan.md` — task-table Status column ONLY
- `docs/plans/050-semantic-artifact-telemetry/tasks/phase-1/execution.log.md` (NEW — your log)

## FORBIDDEN paths
`.the-flow-state.json`, `the-flow.json`, `the-flow.md` (any location), `workshops/*`, `validations/*`, anything outside the allowed list. Do **not** run `git commit` / `git push` — the orchestrator owns commits.

## Critical constraints (from validated findings — do not skip)
- **Finding 05 (CRITICAL)**: a new event kind must round-trip the whole pipeline: `serializeEvent` (segment.ts:327) case + OTLP `encodeEvent` AND `decodeEvent` (otlp/logs.ts) cases + semconv attr names + the frozen `harness-otlp.schema.json` allowlist. Counts/enums encode as kvlist attrs like `checks.gates`. `reconstruction.test.ts` "every kind round-trips" must be green WITH the new kind included.
- **Finding 06 (HIGH)**: add `artifact` to `EVENT_KINDS` (events.ts:51) and exclude it from the rollup timed-work filter (rollup.ts:186, beside `flow_log`).
- **AC-04**: guarded content read in capture-service (skip missing/binary/oversized files); extractors are pure `(content) → {counts, enums}` and NEVER throw.
- **AC-05 privacy**: counts + fixed-vocab enums only (extractor is the value allowlist gate, `other` fallback); no free text field can exist; repo-relative paths only, skip out-of-repo.
- 10 extractors per workshop inventory: review, plan, workshop, dossier, tasks, execution-log, backpressure, validation, ship-report, flight-plan rollup. Keep them thin regex counters — KISS is a user mandate.

## Done means
1. All T001–T006 implemented; task table statuses flipped to [x] in the plan.
2. `just build` then `harness checks` **exit 0** (rebuild first — dist/ runs live). Run from repo root.
3. `docs/plans/050-semantic-artifact-telemetry/tasks/phase-1/execution.log.md` written: per-task one-liner + any deviations/discoveries.
4. Report back to the orchestrator: `pij send pij-4s10mb "<summary: tasks done, checks verdict, files touched count, deviations>"`.

If genuinely blocked, report the blocker via pij send rather than improvising outside scope.
