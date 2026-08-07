# Semantic Artifact Telemetry — extractor registry + `artifact` event kind
**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-07-04
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

### Summary
The flow's own artifacts (reviews, plans, workshops, dossiers, the-flow.json, tasks, logs) carry rich process semantics that telemetry currently ignores. This feature adds a **counts-only artifact-semantics pass** to the existing per-command telemetry capture window: when a changed file matches a registered extractor, parse it and emit an `artifact` event (fixes per review, phases per plan, workshop length, …). Files change over time; each change re-emits an updated snapshot, giving a semantic time series per artifact with zero added agent burden.

Design is settled — `workshops/001-semantic-telemetry-elements.md` is **authoritative** (22-element inventory, event shape, extractor contract, privacy contract, capture mechanic). This plan is the build recipe for it.

### Goals
- Emit the workshop's element inventory as `artifact` events from the existing capture window (change-triggered, "save time").
- Counts + fixed-vocabulary enums only — privacy posture unchanged.
- Zero new triggers, watchers, or agent rituals; extraction rides capture.

### Non-Goals
- No sweep/backfill mode (workshop Decision B rejected; could be a later backstop).
- No insights-layer generators over the new rows (follow-up plan; WS001 owns that layer).
- No retro/observe-record extractor (workshop Q2: already structured records — would double-count).
- No changes to the flow verbs' output grammar.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry (`harness/cli/src/services/telemetry/`) | existing | **modify** | New pure extractor module + capture-service wiring + segment schema extension |

(No `docs/domains/` registry in this repo — logical domain per the service directory.)

### Testing Strategy
- **Approach**: Lightweight/Hybrid — vitest unit tests per extractor (pure functions, inline string fixtures), one capture-service integration test, one privacy-shape test. The repo `checks` gate (vitest + coverage) is mandatory anyway.
- **Mock Usage**: none — extractors are pure `(content) → counts/enums`; tests feed real artifact snippets lifted from this repo's own plans/reviews.
- **Focus**: extraction correctness per artifact type; defensive parse (garbage in → thin event, no throw); privacy (no free-text field can exist).

### Documentation Strategy
- One section in `docs/how/telemetry.md` (the `artifact` event kind + extractor registry, ~half a page). No new doc file.

### Complexity
- **Score**: CS-2 (small) — S=1, I=1, D=0, N=0, F=0, T=0
- **Confidence**: 0.9
- **Assumptions**: flow verbs' output grammar is stable (workshop Q3); capture window's `files.written/edited` is reliable (proven in plan 034/035).
- **Dependencies**: none new — pure stdlib parsing, existing capture plumbing.
- **Risks**: grammar drift silently zeroing counts (mitigated: fixture tests per extractor).

### Acceptance Criteria
1. **AC-01**: A review file present in a capture window's changed set emits one `artifact` event with `artifact_type:'review'`, `counts.fixes`, severity counts, and a `verdict` enum.
2. **AC-02**: A plan / workshop / dossier / the-flow.json change emits its type's event with the workshop-inventory counts (phases, lengths, proof levels, node rollup respectively).
3. **AC-03**: Editing the same artifact across two capture windows produces two snapshots (append-only time series), each stamped with its capture time.
4. **AC-04**: An unparseable/malformed artifact yields an event with empty counts — capture never fails or throws because of the semantics pass.
5. **AC-05**: The segment schema validates the new event kind with `additionalProperties:false` on its keys; enum **values** are gated by the extractors themselves (a fixed vocabulary with `other` fallback, enforced by construction — same gate style as `checks.gates`), and the privacy test proves finding/fix text never appears in the payload.
6. **AC-06**: `harness checks` green (typecheck, vitest+coverage, biome, telemetry-fixtures drift guard).
7. **AC-07**: The event survives the full pipeline — `serializeEvent` preserves counts/enums, the OTLP encoder emits them as kvlist attrs within the frozen schema allowlist, and `reconstruction.test.ts`'s "every kind round-trips" case passes with the new kind.

### Risks & Assumptions
- Out-of-band edits (no subsequent harness command) are missed — accepted, same tail-capture posture as the rest of telemetry.
- Extractors keyed to markdown markers the stage modules author; a skill rewrite can drift them (fixture tests catch total breakage; partial drift monitored via insights n-drop later).

### Open Questions
None — workshop Q1/Q2 resolved there; Q3 resolved here: **fixture-backed unit tests per extractor** (inline sample strings asserting known counts).

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| — (001 already held) | — | design settled | — |

### Clarifications
#### Session 2026-07-04
- Q: Mode/ceremony? → A (user directive): "KISS the plan — let's not overbake, just get it done" → **Simple**, one phase.
- Q: Testing/mocks/docs? → Derived from directive + repo norms: lightweight vitest with inline fixtures, no mocks, one section in the existing `docs/how/telemetry.md`.
- Q: Validation? → A (user directive): validate via a **Copilot Opus peer over pij** (control-plane mode), not a local validate-v2 swarm.

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved (001 held pre-plan and is authoritative).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | n | inline code-seam scan performed instead (Key Findings) |
| workshops/*.md | y (001) | authoritative: element inventory, event shape, extractor contract, capture mechanic |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | no markers; directives recorded in Clarifications |
| G2 | Constitution | PASS | additive sensor work inside the telemetry service; no principle touched |
| G3 | Architecture | PASS | pure lib + service wiring, same hex placement as flow-log.ts (P2 respected) |
| G4 | ADR Compliance | N/A | no Accepted ADRs constrain telemetry event kinds |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | validation tasks precede "done"; criteria measurable |
| G7 | Domain Completeness | PASS | single existing logical domain; manifest covers all files |

### Summary
Add a pure extractor module (`artifact-semantics.ts`) implementing the workshop's registry contract, wire it into `capture-service.ts` immediately after the window's `files` are extracted (beside the existing flow-log pass), add the `artifact` event kind to `events.ts` + `segment.schema.json`, and prove it with fixture unit tests + one integration test. Small, additive, no new dependencies.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/artifact-semantics.ts` | telemetry | internal | NEW — registry + 10 extractors (pure) |
| `harness/cli/src/services/telemetry/events.ts` | telemetry | contract | add `ArtifactEvent` kind + `EVENT_KINDS` const entry (:51) |
| `harness/cli/src/services/telemetry/segment.ts` | telemetry | internal | `serializeEvent` (:327) `artifact` case — closed switch would otherwise degrade to `{t,kind}`, dropping counts/enums |
| `harness/cli/src/services/telemetry/rollup.ts` | telemetry | internal | exclude `artifact` from the timed-work filter (:186, beside `flow_log`) — capture-time `t` must not skew wall/gap math |
| `harness/cli/src/services/telemetry/otlp/logs.ts` | telemetry | internal | `encodeEvent` `artifact` case — committed shards ARE the OTLP logs; no case = payload lost on publish |
| `harness/cli/src/services/telemetry/otlp/semconv.ts` | telemetry | internal | attr names for artifact counts/enums (kvlist maps, like `checks.gates`) |
| `harness/cli/src/services/telemetry/otlp/harness-otlp.schema.json` | telemetry | contract | extend the frozen attr allowlist for the new kind |
| `harness/cli/src/services/telemetry/capture-service.ts` | telemetry | internal | wire the pass after `caps.files` extraction (~line 586); guarded content read (skip missing/binary/oversized) |
| `harness/cli/src/services/telemetry/segment.schema.json` | telemetry | contract | event_stream `artifact` kind, `additionalProperties:false` on keys; enum VALUES are gated by the extractor (construction gate), not the schema |
| `harness/cli/test/services/telemetry/artifact-semantics.test.ts` | telemetry | internal | NEW — per-extractor fixture tests + privacy shape |
| `harness/cli/test/services/telemetry/capture-service.test.ts` | telemetry | internal | extend — changed-file → event integration case |
| `docs/how/telemetry.md` | docs | internal | one new section |

### Key Findings
(inline code-seam scan, 2026-07-04 — no dossier)

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `flow-log.ts` is the exact exemplar: pure, defensive, privacy-scoped projection already invoked from capture-service — copy its posture wholesale | Model `artifact-semantics.ts` on it |
| 02 | High | capture-service already computes `caps.files` and derives `plans_touched` from it (`plansFromTouchedFiles`, :255) — the emission seam and the plan-id lift both exist | Wire at the same spot; reuse the path→plan-id logic |
| 03 | High | `event_stream` kinds are a closed union in `events.ts` + schema — forgetting the schema half fails `check:telemetry-fixtures`/validation | T003 pairs both edits |
| 04 | Medium | Reviews in this repo already use a liftable grammar (`**Verdict**:`, `F\d+ · SEV`, `**Fix**:` — verified against plan 046 reviews) | Regex constants per workshop §Extractor rules |
| 05 | Critical | (validator, verified) A new event kind must round-trip the WHOLE pipeline: `serializeEvent` (segment.ts:327) and `encodeEvent` (otlp/logs.ts) are closed switches — no case means counts silently dropped locally AND lost on publish; `reconstruction.test.ts` "every kind round-trips" + the frozen OTLP schema test go RED | T001/T003 cover serializer + OTLP + semconv + frozen schema; counts/enums encode as kvlist attrs like `checks.gates` |
| 06 | High | (validator, verified) rollup wall/gap math filters only `flow_log` (rollup.ts:186); artifact events carry capture-time `t` | T001 adds `artifact` to that filter + `EVENT_KINDS` const |

### Implementation

**Objective**: Ship the workshop's artifact-semantics contract as working capture code in one pass.
**Testing Approach**: Lightweight — fixture unit tests + one integration test; `harness checks` as the gate.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | `ArtifactEvent` type + `EVENT_KINDS` entry + serializer case + rollup exclusion | telemetry | `events.ts`, `segment.ts` (:327), `rollup.ts` (:186) | type compiles; `serializeEvent` round-trips counts/enums; rollup filter excludes `artifact` beside `flow_log` | Findings 05/06 |
| [x] | T002 | Extractor registry + 10 extractors (review, plan, workshop, dossier, tasks, execution-log, backpressure, validation, ship-report, flight-plan rollup), pure + defensive | telemetry | `artifact-semantics.ts` (NEW) | each `extract()` returns known counts on a sample string; garbage → empty counts, no throw; extractor output is the enum-VALUE allowlist gate (`other` fallback enforced here, by construction) | thin regex counters; workshop § Element inventory rows 1–22 |
| [x] | T003 | Contracts: segment schema + OTLP round-trip (`encodeEvent` + `decodeEvent` cases (otlp/logs.ts:164), semconv attrs, frozen-schema allowlist) | telemetry | `segment.schema.json`, `otlp/logs.ts`, `otlp/semconv.ts`, `otlp/harness-otlp.schema.json` | schema validates a sample event (`additionalProperties:false` on keys); `reconstruction.test.ts` "every kind round-trips" stays green; counts/enums encode as kvlist attrs like `checks.gates` | Finding 05; pairs with T001 (Finding 03) |
| [x] | T004 | Wire pass into capture: changed-set ∪ → registry match → guarded `deps.fs` content read (skip missing/binary/oversized) → emit events | telemetry | `capture-service.ts` | integration test: window with an edited review → one `artifact` event with counts; missing/huge file → no event, no throw (AC-04) | seam at Finding 02; skip out-of-repo paths |
| [x] | T005 | Tests: per-extractor fixtures, defensive-parse, privacy shape, integration | telemetry | `artifact-semantics.test.ts` (NEW), `capture-service.test.ts` | AC-01..AC-05 each asserted; vitest green | inline fixtures lifted from real repo artifacts |
| [x] | T006 | Docs section + rebuild + gate | telemetry/docs | `docs/how/telemetry.md` | `just build` then `harness checks` green (AC-06) | rebuild before checks (dist/ runs live) |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T002, T004 | T005 integration case |
| AC-02 | T002 | T005 per-extractor fixtures |
| AC-03 | T004 | T005 two-window case |
| AC-04 | T002 | T005 defensive-parse case |
| AC-05 | T002, T003 | T005 privacy-shape case + schema validation |
| AC-06 | T006 | `harness checks` exit 0 |
| AC-07 | T001, T003 | `reconstruction.test.ts` round-trip + frozen-schema test green |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Stage-module grammar drift zeroes a count | Medium | Low (data gap, not breakage) | fixture tests catch total breaks; insights n-drop monitors partial drift |
| Capture cost on large changed sets | Low | Low | bounded to changed files only; extractors are single-pass regex |
| Schema/type drift between events.ts and segment.schema.json | Medium | Medium | T001+T003 land together; `check:telemetry-fixtures` guards |
