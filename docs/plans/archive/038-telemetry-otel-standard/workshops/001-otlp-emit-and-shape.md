# Workshop: OTLP emit & shape

**Type**: Storage Design / Integration Pattern
**Plan**: 038-telemetry-otel-standard
**Spec**: _(pre-plan — business source is [`../research-dossier.md`](../research-dossier.md) + [`../research-storage-and-transport.md`](../research-storage-and-transport.md))_
**Created**: 2026-06-27
**Status**: Approved

**Value Thesis**: Locks the OTEL-native shape, the field-naming governance, and the test/backpressure strategy *before* planning — so the migration is a mechanical, sensor-guarded transcription rather than an open design problem. Makes the next loop (plan → phases) cheaper and the reconstruction guarantee provable.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Implementation Readiness**: every event kind has a concrete OTLP target + attribute name; an agent can build the serializer from the tables below.
- **Safety to Change**: the two-layer field-naming rule + `schema_url` pinning insulate reconstruction-critical data from OTEL semconv churn.
- **Proof Quality**: the reconstruction round-trip + conformance sensors make "no fidelity lost" a deterministic test on real data, not a claim.
- **Migration Safety**: supplant is bounded — keeping the typed internal pipeline keeps ~18 adapter/event tests green.

**Related Documents**:
- [`../research-dossier.md`](../research-dossier.md) · [`../research-storage-and-transport.md`](../research-storage-and-transport.md)
- WS-B (next) — telemetry storage & transport (owns sync/refs)

**Domain Context**:
- **Primary Domain**: telemetry (segment serialization + capture)
- **Related Domains**: eng-thrive scraper (downstream consumer); the sync/refs transport (WS-B)

---

## Purpose

Resolve *what shape* harness telemetry takes once standardized to OTEL/OTLP, and *how we prove* the new shape loses nothing. Drives the plan's phase decomposition (Phase 0 sensors → serializer → schema → scraper).

## Fresh Entrant Outcome

A fresh agent should reach **Contract Ready** with no extra context — able to:
- Serialize an internal event stream + rollup into OTLP Logs + Metrics with correct attribute names.
- Know which names are conformed-to (envelope), adopted (stable semconv), or owned (`harness.*`).
- Stand up the reconstruction + conformance sensors on the plan-037 real fixtures.

## Key Questions Addressed

1. Does OTLP supplant the Segment, or sit alongside it? → **Supplant the stored shape; keep the internal pipeline.**
2. How do we keep full session-timeline reconstruction (time, tokens, gaps)? → **Logs are the lossless substrate; a round-trip test proves it.**
3. How do we handle OTLP's "field names not guaranteed stable" caveat? → **Two-layer rule: conform on the envelope, own reconstruction data under `harness.*` + our schema.**
4. Logs, metrics, or both? → **Both.**
5. Runtime OTEL libs or hand-roll? → **Hand-roll + 3-way conformance test.**
6. What tests/sensors must exist? → **The index + Phase-0 backpressure below.**

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | The event→OTLP map + sensor design is enough for the plan to decompose phases. |
| Primary Value Axis | Proof Quality | Reconstruction fidelity must be *provable* on real data. |
| Supporting Axes | Implementation Readiness, Safety to Change, Migration Safety | Buildable now; insulated from semconv churn; bounded blast radius. |
| Downstream Loop Improved | Planning + Implementation + Review | Phases derive directly; reviewers check against the round-trip sensor. |

## Decision Space

| # | Decision | Options | **Selected** | Rationale |
|---|----------|---------|--------------|-----------|
| Q1 | OTLP ↔ Segment | additive view · OTEL-native store · hybrid | **OTEL-native (supplant the stored shape)** | Not shipped → no back-compat; one shape, directly collector-ingestible. **Refinement: keep the typed internal event/rollup model + the single serialize chokepoint** — it now serializes to OTLP instead of Segment JSON. Preserves allowlist-by-construction privacy and keeps ~18 adapter/event tests green. |
| INV | Reconstruction | — | **Hard invariant** | The OTLP form MUST permit full session-timeline reconstruction — every event at exact `timeUnixNano` (+ precision), per-turn token buckets, durations — such that inter-event gaps + agent/human/idle time + token flow are recoverable. Enforced by a round-trip test. |
| FN | Field naming | rename freely · conform fully · two-layer | **Two-layer rule** (below) | Conform on the envelope (that's what makes it ingestible); own reconstruction-critical attributes under `harness.*` + our pinned schema, so semconv churn can't reach them. |
| Q2 | Signals | logs-only · **logs + metrics** | **Logs + Metrics** | Logs = mandatory reconstruction substrate; metrics = the rollup's honest gap math, so upstreams don't re-derive it + a cross-check. |
| Q3 | Runtime deps | runtime OTEL libs · **hand-roll + conformance** | **Hand-roll + 3-way conformance** | Lean deps; keeps the allowlist guarantee; validated against real OTEL tooling in CI (golden vs proto examples · protobuf-JSON round-trip · collector-as-checker). |

---

## The two-layer field-naming rule (FN)

| Layer | Examples | Who owns the name | Policy |
|-------|----------|-------------------|--------|
| **Envelope** | `resourceLogs`, `logRecords`, `timeUnixNano`, `severityNumber`, `resourceMetrics`, `dataPoints`, `asInt` | OTEL (stable; OTLP 1.0 GA, proto `v1`) | **Conform.** Pin OTLP/proto version + `schema_url`; never rename. |
| **Stable semconv attrs** | `service.name`, `gen_ai.usage.input_tokens`/`output_tokens`, `gen_ai.request.model` | OTEL (stable) | **Adopt as-is** — free upstream interop. |
| **Experimental semconv attrs** | `gen_ai.agent.*`, cache-token granularity | OTEL (in flux) | **Quarantine** behind one mapping module; adopt only when stable. |
| **Our custom attrs** | `harness.t_precision`, `harness.usage.cache_read`/`cache_create`, `harness.tool.*`, `harness.flow.*`, event kinds | **Us, fully** | **Choose by our needs**, namespace `harness.*`, pin in *our* schema. **All reconstruction-critical data lives here.** |

> Net principle: **conform on the envelope, adopt stable semconv for interop, own everything reconstruction depends on under `harness.*` + our pinned `schema_url`.**

---

## Contract — event_stream → OTLP Logs (`logs.jsonl`)

One `ResourceLogs` per session (resource attrs once); one `logRecord` per event; `eventName` = the event kind; `timeUnixNano` = `t`×1e6 (ns string); `severityNumber` per the table. `harness.t_precision` attribute set when `t_precision ≠ exact`.

| Event kind | Current fields | `logRecord` attributes | Severity |
|---|---|---|---|
| **prompt** | words | `harness.prompt.words` (int) | INFO 9 |
| **turn** | dur_s, in/out/cache_read/cache_create, model | `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `harness.usage.cache_read`, `harness.usage.cache_create`, `harness.turn.dur_s`, `gen_ai.request.model` | INFO 9 |
| **tools** | name, count, span_s | `harness.tool.name`/`count`/`span_s` | INFO 9 |
| **skill** | name, status, dur_s | `harness.skill.name`/`status`/`dur_s` | INFO 9 |
| **flow** | flow, stage, status, from | `harness.flow.name`/`stage`/`status`/`from` | INFO 9 |
| **flow_log** | op, node, from, to, type, edge_op | `harness.flow_log.*` (**rollup-isolation preserved** — see below) | INFO 9 |
| **branch** | to, from | `harness.branch.to`/`from` | INFO 9 |
| **harness** | verb | `harness.verb` | INFO 9 |
| **checks** | status, gates | `harness.checks.status` + `harness.checks.gate.<k>` | INFO 9 / WARN 13 / ERROR 17 on fail |
| **command_exit** | verb, exit, status | `harness.command.verb`/`exit`/`status` | INFO 9 / ERROR 17 on non-zero |
| **subagent** | name, status, dur_s | `harness.subagent.name`/`status`/`dur_s` | INFO 9 |
| **compaction** | — | _(eventName only)_ | INFO 9 |
| **model** | model, effort | `gen_ai.request.model`, `harness.effort` | INFO 9 |
| **api_error** | signature | `harness.api_error.signature` | ERROR 17 |

**Resource attributes** (once per session): `service.name=harness`, `harness.session_id` (opaque), `harness.harness` (claude-code/copilot-cli/cursor/…), `harness.command`, `harness.branch`, `harness.schema_version`, `schema_url` pinned.

## Contract — rollup → OTLP Metrics (`metrics.jsonl`)

One `ResourceMetrics` per session. **Cumulative temporality, one datapoint per measure**: `startTimeUnixNano`=session start, `timeUnixNano`=session end (each session is a fresh metric lifetime — partition by `harness.session_id`, never stitch).

| Rollup measure | OTLP metric | Type / value |
|---|---|---|
| activity.wall_s / agent_working_s / human_s / idle_s | `harness.session.{wall,agent_working,human,idle}_seconds` | sum, `asDouble` |
| activity.working_ratio | `harness.session.working_ratio` | gauge, `asDouble` |
| flow_stage_time_s[stage] | `harness.flow.stage_seconds` | sum, `asDouble`, attr `harness.flow.stage` |
| tokens.{in,out,cache_read,cache_create} | `gen_ai.client.token.usage` | sum, `asInt`, attr `gen_ai.token.type` (+`harness.token.type` for cache buckets) |
| tools[name] | `harness.tool.calls` | sum, `asInt`, attr `harness.tool.name` |
| skills[name].{runs,abandoned,superseded} | `harness.skill.runs` | sum, `asInt`, attrs `harness.skill.name`/`status` |
| outcomes.checks / exits[verb] | `harness.command.exits` | sum, `asInt`, attrs `harness.command.verb`/`status` |

> `flow_log` events are **excluded** from metrics (as today) — they appear only in `logs.jsonl`.

---

## Reconstruction invariant + round-trip sensor (the load-bearing proof)

**Claim**: `logs.jsonl` (+ `metrics.jsonl`) fully reconstructs the session timeline.
**Proof**: a deterministic round-trip test — `raw → OTLP → reconstruct(timeline + rollup) → deep-equal the original segment's event_stream + rollup`. Gaps reconstruct from inter-event `timeUnixNano` deltas; tokens/durations from `harness.*` attributes. Runs on the **plan-037 real fixtures** (real Claude/Copilot/Cursor sessions) — `expected-segment.json` is the reconstruction oracle.

## Test surface index (33 telemetry test files)

| Impact | Files | Action |
|---|---|---|
| **Rewritten** | `segment.test.ts`, `segment-schema.test.ts`, `events-rollup.test.ts`, `services/record/segment-record.test.ts` | retarget serializer + freeze-test to OTLP + `harness.*` schema |
| **Net-new** | — | reconstruction round-trip · OTLP conformance (collector-as-checker) · `schema_url`/version assertion |
| **Extended — goldens** (037 reuse) | `real-capture.e2e.test.ts`, `copilot-vscode-sqlite.int.test.ts`, `fixture-extract.test.ts`, `scripts/telemetry-fixtures.mjs` (+F005 guard) | mint `expected-otlp-{logs,metrics}.jsonl` from the same raw bytes |
| **Extended — privacy** | `fixture-privacy-scan.test.ts`, `fixture-scrub.test.ts` | byte-scan the OTLP output path |
| **Touched — storage** (→ WS-B) | `sync-service.test.ts`, `acts/telemetry.test.ts`, `capture-service.test.ts`, `pending-telemetry.test.ts`, `housekeeping.test.ts`, `gitignore.test.ts`, `capture-perf.test.ts`, `killswitch-failsafe.test.ts` | buffer/refs hold `.jsonl` |
| **Green by design** (~18) | all `*-adapter.test.ts`, `*-events.test.ts`, `adapter-registry`, `harness-adapter`, `flow-log`, `command-signature`, … | untouched — internal typed model stays |

## Phase 0 — backpressure (sensors before serializer)

Build the sensors first, on real fixtures, so every later phase builds against green deterministic checks. *"What realistic wrong implementation still passes?"*:

| Wrong impl that "looks green" | Sensor that catches it | Grade |
|---|---|---|
| Drops a cache-token bucket / an event kind | reconstruction round-trip (deep-equal fails) | deterministic |
| Rebases timestamps → gaps wrong | round-trip: gap deltas ≠ original | deterministic |
| Valid-JSON-but-invalid-OTLP (silent drop) | collector-as-checker (`otlpjsonfilereceiver`→debug; empty = fail) | deterministic |
| Leaks content in a new `harness.*` attr | privacy byte-scan extended to OTLP bytes | deterministic |
| Output drifts from spec on refactor | golden drift check (`telemetry-fixtures.mjs --check`) over the real corpus | deterministic |

---

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| event→logs map (14 kinds) | this doc | Contract / reconstruction | Ready |
| rollup→metrics map | this doc | Contract | Ready |
| round-trip on 037 fixtures | Phase 0 | reconstruction invariant | Designed |
| two-layer field-naming rule | this doc | semconv-churn safety | Ready |
| test surface index | this doc | migration scope | Ready |

## Open Questions

- **Q-A1 (→ WS-B)**: does `refs/harness-telemetry/*` publish OTLP `.jsonl` or stay segment JSON, and does the local buffer hold `.jsonl`? Owned by the storage/transport workshop.
- **Q-A2 (→ plan)**: exact `devDependency` for the conformance oracle (e.g. `@opentelemetry/otlp-transformer` vs a vendored proto-JSON validator) — a Phase-0 spike.
- **Q-A3 (defer)**: whether to retire `expected-segment.json` after migration or keep it as the permanent reconstruction oracle (recommend: keep).

## Validation / Acceptance

This workshop is at Contract Ready because:
- Every current event kind + rollup measure has a named OTLP target.
- The reconstruction invariant has a concrete, real-data sensor.
- The field-naming governance protects reconstruction data from semconv churn.
- The full test surface is enumerated and bounded.
