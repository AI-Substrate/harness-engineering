# Execution Log — 038 telemetry-otel-standard

**Plan**: `telemetry-otel-standard-plan.md` (Simple mode, single phase, 16 tasks)
**Branch**: `feat/038-telemetry-otel-standard` (base `a5f9e73`)
**Testing approach**: Full TDD, sensor-first — T001–T005 land deterministic sensors (RED) on the plan-037 real corpus before any serializer/storage change.
**Companion**: `code-review-companion` (minih, Power-On-Mode) — pinged per commit.

## Task status (mirror of the plan's inline table)

| ID | Task | Status |
|----|------|--------|
| T001 | 3-way conformance harness + devDep choice | [x] |
| T002 | Reconstruction round-trip sensor | [x] |
| T003 | OTLP conformance sensor (severity + no-drop + known-key) | [x] |
| T004 | Privacy byte-scan over OTLP bytes | [x] |
| T005 | Golden drift sensor + minting | [ ] |
| T006 | harness.* OTLP schema + schema_url + version assertion | [x] |
| T007 | event_stream → OTLP Logs | [x] |
| T008 | rollup → OTLP Metrics | [x] |
| T009 | gen_ai.* mapping module | [x] |
| T010 | Wire OTLP write at capture seam (spool) | [ ] |
| T011 | Publish OTLP .jsonl over git-refs | [ ] |
| T012 | Harden keep (H4/H5) | [ ] |
| T013 | Update eng-thrive scraper (lockstep) | [ ] |
| T014 | Retarget rewritten tests | [ ] |
| T015 | Touched-storage tests hold .jsonl | [ ] |
| T016 | Operator doc (docs/how/) | [ ] |

Legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked

## Discoveries & Learnings

| # | Task | Tag | Note |
|---|------|-----|------|
| D1 | T001 | Noteworthy | **Q-A2 resolved**: devDep = `protobufjs@^8.6.5` + vendored OTLP v1 protos (`test/conformance/proto/`) + committed official examples (`test/conformance/examples/`). Research-blessed path; P10-clean (devDep, never shipped). |
| D2 | T001 | Noteworthy | protobufjs `Type.verify` is the WRONG oracle — it predates proto3-JSON and rejects OTLP's string-encoded int64 (`timeUnixNano:"..."`), failing the official metrics example. Correct oracle = `fromObject → encode → decode` (what `otlpjsonfilereceiver` does). Caught by running the harness against the real example before trusting it. |
| D3 | T001 | Deferred | `fromObject` is lenient on a non-object singular-message field (coerces to empty) + ignores unknown keys → a garbage scalar can slip the round-trip. T003 hardens with explicit known-key + lines-read==objects-emitted assertions. |
| D4 | T001 | Noteworthy | collector-as-checker (leg 3) logged-skips — `otelcol-contrib` absent on this machine; never gates. Live wiring deferred to T003. |
| D5 | T007 | Noteworthy | OTLP 1.3.2 `LogRecord` has **no `event_name`** field (added in a later OTLP) → reconstruct `kind` from the `harness.event.kind` attribute, not `eventName`. Keeps us inside the schema we actually validate against. |
| D6 | T002 | Noteworthy | `t → timeUnixNano (ns) → t` loses the exact source ISO string (format/precision). Carry the verbatim `t` under `harness.event.t` (reconstruction) + set `timeUnixNano` for OTLP interop (gaps/honesty). Two-layer rule in action. |
| D7 | T002/T007 | Noteworthy | Landed T002+T006+T007+T009 as ONE green slice (test authored first, serializer made it pass) rather than a separate RED commit — keeps the branch suite green for CI. Sensors-first discipline preserved in authoring order. |
| D8 | T006 | Noteworthy | `schema_url` pinned → `…/schemas/telemetry/v0.1.0`; `OTLP_SCOPE_VERSION` asserted in lockstep with `SEGMENT_SCHEMA_VERSION` (2.0). The `segment.schema.json` reshape + freeze test fold into T014. |

Tags: `Deferred` (consciously punted) · `Noteworthy` (a call a human might make differently).

## Companion findings reconciliation

| ackOf (review-request) | severity | finding | disposition |
|---|---|---|---|
| _(none yet)_ | | | |

**Companion deviation (FINAL)**: two boot attempts (`…4ac5`, `…ab81`) both went `active` then reached `completed` early — `minih` 0.2.3's companion does NOT hold Power-On-Mode in this environment, so per-commit pings (T001 → T008) went unacknowledged; **no findings received from any run**. Per the implement verb's "boot fails twice → no-companion fallback", we proceed companion-less. **Recovery: a post-hoc `7 review` pass at phase end is REQUIRED and non-redundant** (no live review occurred). Self-review rigor applied inline meanwhile.

---

## Per-task entries

### T001 — 3-way conformance harness + devDep choice ✅

**What**: stood up WS-A's 3-way OTLP conformance oracle (test-only).
- Added `protobufjs@^8.6.5` (devDependency) — resolves Q-A2.
- Vendored the OTLP v1 proto import tree → `harness/cli/test/conformance/proto/opentelemetry/proto/{common,resource,logs,metrics}/v1/*.proto` (from `opentelemetry-proto` v1.3.2).
- Committed the official OTLP example payloads → `harness/cli/test/conformance/examples/{logs,metrics}.json` (leg-1 golden reference).
- `harness/cli/test/conformance/otlp-conformance.ts`: `conformLogs` / `conformMetrics` (legs 1+2 — fromObject→encode→decode round-trip) + `collectorCheck` (leg 3 — optional, logged-skip).
- `harness/cli/test/conformance/otlp-conformance.test.ts`: 6 assertions — official examples PASS, shape violations FAIL (teeth), collector leg skips cleanly.

**Evidence**: `npx vitest run test/conformance/otlp-conformance.test.ts` → **6 passed**. The official metrics example initially FAILED under `verify` (string int64) — corrected the oracle to `fromObject`-based round-trip (D2).

**Acceptance**: AC-02 (the oracle the conformance sensor uses) — harness invocable, all 3 legs present, devDep recorded.

### T002 + T006 + T007 + T009 — OTLP Logs serializer + reconstruction invariant ✅

**What** (one coherent slice — `harness/cli/src/services/telemetry/otlp/`):
- `semconv.ts` (T009): the single attribute-mapping module. Adopts stable `gen_ai.usage.input_tokens`/`output_tokens` + `gen_ai.request.model`; everything reconstruction-critical (incl. cache buckets) under `harness.*`. Swapping a semconv name touches only this file.
- `types.ts` (T006): hand-rolled OTLP logs+metrics envelope types + AnyValue helpers; pins `HARNESS_SCHEMA_URL` (`…/telemetry/v0.1.0`) + `OTLP_SCOPE_VERSION`.
- `logs.ts` (T007): `segmentToOtlpLogs` (one ResourceLogs/session, one logRecord/event, from the serialized segment only — privacy inherited) + `otlpLogsToEvents` (the exact inverse). Per-kind severity (checks→WARN/ERROR, command_exit non-zero→ERROR, api_error→ERROR).
- `test/services/telemetry/otlp/reconstruction.test.ts` (T002): drives all 4 golden `expected-segment.json` → OTLP → reconstruct → deep-equal `event_stream`; `computeRollup(recon)` deep-equal `rollup`; emitted logs pass conformance. + schema_url/version-lockstep assertions (T006).

**Evidence**: `vitest run reconstruction.test.ts otlp-conformance.test.ts` → **20 passed**; `tsc --noEmit` clean.

**Acceptance**: AC-01 (reconstruction deep-equal), AC-03 (gaps/durations/token buckets recovered via rollup), AC-08 (semconv quarantine), AC-05 partial (schema_url pin; freeze test → T014).

**Key insight**: `rollup = computeRollup(event_stream)`, so a lossless logs round-trip recovers the rollup for free — reconstruction rides entirely on the event stream; metrics (T008) become an honest cross-check, not the substrate.

### T008 — rollup → OTLP Metrics ✅

**What**: `otlp/metrics.ts` (`rollupToOtlpMetrics`) + `otlp/resource.ts` (shared resource attrs, DRY with logs). Cumulative-per-session: one datapoint per measure, `startTimeUnixNano`=session start, `timeUnixNano`=session end. Activity → `harness.session.{wall,agent_working,human,idle}_seconds` (sum) + `working_ratio` (gauge); flow stages → `harness.flow.stage_seconds`; tokens → `gen_ai.client.token.usage` (cache buckets `gen_ai.token.type=input` + `harness.token.type` discriminator); tools → `harness.tool.calls`; skills → `harness.skill.runs` (status-tagged); exits → `harness.command.exit_code` (gauge — a code, not a running count).

**Evidence**: `vitest run test/services/telemetry/otlp/` → **25 passed** (conformance + value cross-check vs rollup + `rollup:null`⇒no-datapoints). tsc clean.

**Acceptance**: AC-06 (metrics signal), AC-10 (cumulative temporality, null⇒none).

| # | Task | Tag | Note |
|---|------|-----|------|
| D9 | T008 | Noteworthy | `outcomes.checks` is a categorical status (ok/degraded/error), NOT a count — it stays in the logs (a `checks` event) and is intentionally NOT emitted as a numeric metric. Command exits become a **gauge** `exit_code` (last-seen code), not a monotonic sum. Slight, honest refinement of WS-A's "outcomes → harness.command.exits" row. |

### T003 + T004 — sensor hardening (conformance + privacy) ✅

- **T003** (`otlp/conformance-sensor.test.ts`): closes D3 — every emitted top-level attribute key ∈ the known `harness.*`/`gen_ai.*` allowlist (catches the typo that `fromObject` would silently drop); logRecords count == event_stream length (no silent drop); per-kind `severityNumber` asserted for checks(ok/degraded/error)/command_exit(0/≠0)/api_error — the path AC-01's deep-equal can't see. 9 green.
- **T004** (extended `fixture-privacy-scan.test.ts`): scans the OTLP logs+metrics serialized bytes of all 4 real fixtures (reusing the existing banned-pattern + `SECRET_DETECTORS` machinery) → no leak; scanner proven LIVE on a planted `/Users/` attribute. AC-04.

**Evidence**: 36 passed across both files.
