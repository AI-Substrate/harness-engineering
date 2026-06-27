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
| T010 | Wire OTLP write at capture seam (spool) | [x] |
| T011 | Publish OTLP .jsonl over git-refs | [x] |
| T012 | Harden keep (H4/H5) | [x] |
| T013 | Update eng-thrive scraper (lockstep) | [—] deferred → eng-thrive repo; contract folded into T016 |
| T014 | Retarget rewritten tests | [x] |
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
| D14 | T014 | Noteworthy | **`segment.schema.json` is NOT reshaped/dropped** — the WS-A decision keeps the typed internal event/rollup model (row 140: ~18 green-by-design tests), so the segment record + its freeze test stay valid as the *internal-model* contract. T014's "successor to segment.schema.json" is the NEW `otlp/harness-otlp.schema.json` — the frozen `harness.*` attribute vocabulary that is the *on-disk consumer* contract (what the eng-thrive scraper reads). Two contracts now: internal Segment shape (`segment.schema.json`) + OTLP attribute vocabulary (`harness-otlp.schema.json`). |
| D15 | T014 | Noteworthy | **`segment-record.test.ts` is orthogonal to OTLP** — it pins the record-framework `segment` TYPE (template / provenance splice / registry membership), not the telemetry serializer. The WS-A "Rewritten" row over-scoped it; forcing an OTLP assertion in would be fabrication. Left it as-is (verified green); the OTLP retarget landed in `segment.test.ts` + `events-rollup.test.ts` + the new freeze test instead. |

Tags: `Deferred` (consciously punted) · `Noteworthy` (a call a human might make differently).

## Companion findings reconciliation

| ackOf (review-request) | severity | finding | disposition |
|---|---|---|---|
| T001 (run …4ac5) | MEDIUM | `collectorCheck()` skips even when `otelcol-contrib` present → "3 legs invocable" overstated | ACCEPT — known/documented; collector leg is a deferred placeholder. Soften the T001 claim wording. |
| T001-T009 (run …ab81) | MEDIUM | **metrics `bounds()` includes `flow_log` markers the rollup excludes** → session start/end can be skewed by a backfilled marker | **FIXED** — exclude `flow_log` in `bounds()` to mirror `computeRollup`. Real bug. |
| T001-T009 (run …ab81) | MEDIUM | reconstruction tests don't exercise all 14 event kinds (only those in fixtures) | **FIXED** — add an all-14-kinds synthetic round-trip test. Real coverage gap. |
| T011 (run …c7ce) | MEDIUM | **partial spool published-and-consumed**: a crash between T010's two atomic writes leaves logs-without-metrics; T011 published the half-signal and advanced the watermark → the missing signal is lost forever | **FIXED** (commit below) — publish the `.jsonl` pair only when BOTH present; a partial OR absent spool falls back to the full segment `.json` (the reconstruction oracle), so nothing is dropped. Regression test added. Real data-loss-on-crash bug. |

**Run c7ce (T011 review)**: companion reviewed T011 commit `ab03aa0`, sent the MEDIUM above, confirmed the no-fetch-to-write shard model + push-failure rollback preserved, no HIGH/CRITICAL. Ended `result: degraded` / `validated:false` on the SAME known minih schema bug (`/findings/0: must have required property 'id' — did you mean 'file'`) — the `scratchpad/minih-issue-companion.md` repro stands; this is a fresh occurrence (idle stand-down after 840s, T012 ping never reviewed). magicWand: a `minih companion draft-report --run <id>` that emits a schema-valid report skeleton (same coordination root cause).

**Companion deviation (CORRECTED)**: the companion DID work — it reviewed T001 (run `…4ac5`) and the T001–T009 diff (run `…ab81`), sending **3 MEDIUM findings** (above). It was NOT a crash. Two compounding reasons I initially logged "no findings": (1) **`idle_budget` exit by design** — the companion stands down after ~8–18 min idle; my commit cadence outran it, so each run farewelled before the next ping; (2) **my polling timing** — I skimmed the inbox immediately after fire-and-forget pings, before the async review landed minutes later, and never re-skimmed. Separately, BOTH runs ended `result: degraded` / `validated:false` on a **minih schema bug** (`report.json` `findings[]` need `id`, guided format emits `file`) — drafted as a minih GitHub issue (`scratchpad/minih-issue-companion.md`). The 2 code findings are now in the table above and will be fixed; the collector-claim note is accepted/documented.

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

### T011 — Publish OTLP `.jsonl` over keep-and-harden git-refs ✅

**What** (`sync-service.ts`): the per-(date,session) shard's commit tree now holds the T010 OTLP spool — `<seq>.logs.jsonl` + `<seq>.metrics.jsonl` — instead of the segment buffer `<seq>.json`. The buffer `.json` stays purely LOCAL: still the watermark key, still the `datePath` + `plans_touched` source for the commit message, still the reconstruction oracle. The shard/watermark/offline-safety machinery (single-writer-per-ref, ff-retry, rollback-on-push-fail) is **untouched** — only the tree's blob set changed, so **no fetch-to-write** was introduced.

- RED first: extended `sync-service.test.ts` — a buffer with `.logs.jsonl`/`.metrics.jsonl` companions must publish *those* blob names (not `1.json`) and the spool's bytes; plus an offline-safety fallback case.
- The published blobs are the spool bytes; `r.segments` still counts seqs (one segment = two signal blobs), so reporting/watermark semantics are unchanged.

**Evidence**: `vitest run sync-service.test.ts` → **10 passed** (2 new); full telemetry+conformance suite **371 passed**; `tsc --noEmit` clean.

**Acceptance**: AC-06 (one `.jsonl` per signal reaches the durable store), AC-07 (single-writer-per-ref preserved; no fetch-to-write).

### T012 — Harden the keep (H4 session-id entropy · H5 idempotent re-push) ✅

**What**:
- **H4** (`cursor.ts`): `sanitizeSessionId` now appends a stable FNV-1a hash of the raw id whenever cleaning was lossy, so distinct raw ids can never collapse to the same ref segment (fixed a real bug — see D11). Clean alnum/`_`/`-` ids (UUID-like norm) are unchanged.
- **H5** (`sync-service.ts` + `git-write-port.ts` + `exec-git-write.ts` + `fake-git-write.ts`): added `GitWritePort.refTree(ref)` — a LOCAL `rev-parse <ref>^{tree}` (never a remote fetch). `flushShard` builds the content-addressed tree once and, when the ref already holds that exact tree, returns an idempotent no-op (no commit, no push) — a re-flush after a lost watermark consumes the buffer without a duplicate commit or an NFF. `ShardOutcome.pushed` distinguishes a real push from the no-op so a re-run double-counts nothing.

**Evidence**: RED first (re-push duplicated the commit; two H4 collisions). GREEN: `sync-service.test.ts` 11 + `cursor.test.ts` 9 + `fake-git-write.test.ts` 8 → all pass; telemetry+conformance+git+acts suite **515 passed**; `tsc` clean.

**Acceptance**: AC-07 (single-writer-per-ref + entropy + idempotent retry; H1 staged per Non-Goal). No fetch-to-write introduced (the `refTree` peel is local).

| # | Task | Tag | Note |
|---|------|-----|------|
| D13 | T013 | Deferred | **eng-thrive scraper is out-of-repo** — no scraper source exists in harness-engineering (only conceptual docs + a paper). T013 can't be coded here. User decision: defer to eng-thrive's own repo/plan; fold the OTLP ref-tree READ contract into T016 so the downstream change has an authoritative spec. AC-05's scraper leg is satisfied by the documented contract, not in-repo code. |
| D11 | T012 | Noteworthy | **H4 found a live collision bug**: `sanitizeSessionId` mapped *every* degenerate/all-symbol id to the same `'unknown'` segment → distinct writers would collide on one ref → NFF → lost telemetry (the exact H4 risk). Hardened: a lossy sanitize now appends a stable FNV-1a hash of the raw id; clean UUID-like ids (the norm) pass through untouched, so no existing test moved. |
| D12 | T012 | Noteworthy | **H5 needed a content-addressed fake**: real `git mktree` is content-addressed (same blobs → same tree sha), but `FakeGitWrite` returned a fresh counter sha per call, so it couldn't model the idempotency probe. Made the fake's `hashObject`/`mktree` content-addressed (FNV-1a) + added `refTree` (commit→tree map). No test asserted the old `blob<N>`/`tree<N>` sha strings, so the change was invisible to the suite. |
| D10 | T011 | Noteworthy | **Spool-absent fallback**: if a `<seq>.json` buffer entry has no `.jsonl` companions (a pre-T010 entry, or a capture that crashed between the buffer write and the spool write), the shard falls back to publishing the segment `.json` rather than dropping the segment. Preserves AC-14 (never lose a buffered segment) at the cost of a non-OTLP blob in that degenerate case. Lets the existing shard/offline-safety tests stay green unchanged; T015 adds `.jsonl` companions to the touched-storage tests. |

### T014 — Retarget the freeze test + the OTLP output assertions ✅

**What** (the T006-deferred consumer-schema successor + the "Rewritten" row):
- **New frozen contract** `otlp/harness-otlp.schema.json` — the `harness.*` OTLP attribute vocabulary (resource + harness.* + adopted `gen_ai.*`), the on-disk *consumer* contract successor to `segment.schema.json` (which stays as the *internal-model* contract — D14).
- **New freeze test** `otlp/harness-otlp-schema.test.ts` — pins the contract file key-set-EQUAL to `semconv.ts` (`A` / `RES_*` / `GENAI_*`) + `schema_url` + scope-version lockstep. A semconv rename without a contract bump now trips a test (the "swap a name touches one file" guard, enforced).
- **`segment.test.ts`** — new block: the segment→OTLP **resource** mapping emits exactly the six frozen resource attributes (and omits `harness.branch` when branchless).
- **`events-rollup.test.ts`** — new block: every rollup→OTLP **metric datapoint attribute** key is a frozen `harness.*`/`gen_ai.*` name (no smuggled discriminator).
- **`segment-record.test.ts`** — left as-is (D15: record-framework, orthogonal to OTLP; verified green).

**Evidence**: the 5 files (incl. the new freeze test) → **48 passed**; full telemetry+conformance+git+record run **448 passed**; `tsc` clean; biome clean.

**Acceptance**: AC-05 (freeze pins `harness.*` + `schema_url`; the OTLP output is asserted against the frozen contract), AC-08 (only the frozen vocabulary leaves the serializer).
