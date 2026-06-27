# Execution Log — 038 telemetry-otel-standard

**Plan**: `telemetry-otel-standard-plan.md` (Simple mode, single phase, 16 tasks)
**Branch**: `feat/038-telemetry-otel-standard` (base `a5f9e73`)
**Testing approach**: Full TDD, sensor-first — T001–T005 land deterministic sensors (RED) on the plan-037 real corpus before any serializer/storage change.
**Companion**: `code-review-companion` (minih, Power-On-Mode) — pinged per commit.

## Task status (mirror of the plan's inline table)

| ID | Task | Status |
|----|------|--------|
| T001 | 3-way conformance harness + devDep choice | [x] |
| T002 | Reconstruction round-trip sensor (RED) | [ ] |
| T003 | OTLP conformance sensor (RED, severity-asserting) | [ ] |
| T004 | Privacy byte-scan over OTLP bytes | [ ] |
| T005 | Golden drift sensor + minting | [ ] |
| T006 | harness.* OTLP schema + schema_url + version assertion | [ ] |
| T007 | event_stream → OTLP Logs | [ ] |
| T008 | rollup → OTLP Metrics | [ ] |
| T009 | gen_ai.* mapping module | [ ] |
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

Tags: `Deferred` (consciously punted) · `Noteworthy` (a call a human might make differently).

## Companion findings reconciliation

| ackOf (review-request) | severity | finding | disposition |
|---|---|---|---|
| _(none yet)_ | | | |

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
