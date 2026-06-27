# Research Dossier: Standardise harness telemetry to OTEL/OTLP

**Generated**: 2026-06-26T02:40:00Z
**Query**: "Standardise harness telemetry to OTEL/OTLP. Pin the OTLP-JSON contract for logs and metrics, the collector fileexporter on-disk format, and OTEL GenAI semantic conventions. Map our Segment v2.0 onto it (event_stream→logRecords, rollup→metric dataPoints, identity/window→resource+scope attributes, t/t_precision→timeUnixNano, kind→severity/event.name). Evaluate additive OTLP export vs reshaping the Segment OTEL-native (no back-compat — not shipped). Keep local storage. Preserve the counts-only privacy allowlist."
**Effort**: Deep (3 workers: live-pipeline trace · institutional memory · external OTEL standard)
**Tools**: Mixed (repo search + web/perplexity for the standard)
**Evidence**: 10 current sources · 7 historical sources

## Answer

1. **There is exactly one place to stand.** `serializeSegment` (segment.ts:406) is the sole serialization chokepoint; its output is written atomically to `.harness/temp/telemetry/<session>/<seq>.json` (capture-service.ts:415–419) and later published as git blobs to `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>` by sync-service. An OTLP view is a **new emit at that one seam** — not a rewrite scattered across the pipeline.

2. **Our two substrates map onto OTLP's two signals almost 1:1.** `event_stream` (14 enumerated event kinds, each with `t` + `t_precision`) → **OTLP Logs** (`resourceLogs → scopeLogs → logRecords`); the derived `rollup` (6 measure groups) → **OTLP Metrics** (`resourceMetrics → scopeMetrics → metrics[].dataPoints`); segment identity/window/branch → **resource + scope attributes**. The shape the user sketched in the ask is correct.

3. **The "store local like now" shape is literally the fileexporter format.** The collector fileexporter writes **JSON Lines** — one top-level `LogsData` / `MetricsData` object per `\n`-delimited line, optional size/age rotation and zstd. So an OTLP `.jsonl` sits naturally beside (or instead of) today's per-segment JSON, and the same bytes are collector-ingestible upstream with zero translation.

4. **Commit hard to the OTLP *envelope*; commit soft to the GenAI *vocabulary*.** OTLP/JSON logs+metrics, the 1–24 severity scale, `timeUnixNano` (ns-since-epoch decimal string), and attribute typing (`stringValue`/`intValue`/…) are **stable**. The `gen_ai.*` semantic conventions are **experimental/in-flux**: `gen_ai.usage.input_tokens`/`output_tokens` exist, but `gen_ai.agent.*` / `invoke_agent` aren't stable and there's no convention for cache-read/cache-create token granularity (which we capture). Treat `gen_ai.*` naming as a thin, swappable attribute-mapping layer, not a hard dependency.

5. **"No back-compat" holds — with three hard exceptions.** No external system is locked to the segment shape yet (the downstream eng-thrive scraper reads *our own* segment JSON from our git refs; nothing has shipped), and the schema only froze at v2.0 internally — so reshaping the Segment OTEL-native is on the table. But three invariants are **non-negotiable** and must survive any reshape: (a) **counts-only / allowlist-by-construction privacy** (never prompt/file content; serializer picks every field, never spreads); (b) **opaque `harness_session_id`**, never an individual identity; (c) **repo-relative paths**, never absolute `/Users/…`. All three are enforced at the serializer and guarded by byte-scan tests.

6. **The real planning fork is additive-view vs OTEL-native-store.** Either keep `Segment` as the internal substrate and emit an OTLP *view* at the serialize seam (cheap, reversible, dual-write), or make OTLP the stored format and derive internal needs from it (cleaner long-term, bigger blast radius). Whichever wins, the **rollup derivations** (wall/gap/working-ratio math, `flow_stage_time_s`, and the rule that `flow_log` events are rollup-isolated and never bill activity) must be preserved — they are real product logic, not incidental.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | `serializeSegment` is the single serialization site (allowlist-by-construction; input never spread); `serializeEvent` is the per-event twin. | `segment.ts:406`, `segment.ts:309` | OTLP emit is one new chokepoint at/after line 406 — privacy guarantee is inherited only if you emit *from the serialized segment*, never from raw adapter output. | High |
| F-02 | Serialized segment written atomically (temp+rename) to `.harness/temp/telemetry/<session>/<seq>.json`, 1-based seq; tree is self-ignoring (`temp/.gitignore=*`). | `capture-service.ts:48–52, 406, 415–419` | The OTLP `.jsonl` can be a sibling write here (additive) with the same atomic pattern; no daemon needed. | High |
| F-03 | `event_stream` = 14 kinds (prompt, turn, tools, skill, flow, flow_log, branch, harness, checks, command_exit, subagent, compaction, model, api_error); every event carries `t` (RFC3339 string) + optional `t_precision` (exact\|anchored\|interpolated\|interval). | `events.ts:34–66, 68–208`; `segment.ts:278–283` | These become `logRecords`. `t`→`timeUnixNano` (ns) is a deterministic conversion; `t_precision≠exact` should ride as an attribute so the precision loss is honest, not hidden. | High |
| F-04 | `computeRollup` derives 6 measure groups: activity (wall_s/agent_working_s/human_s/idle_s/working_ratio), `flow_stage_time_s` map, skills (runs/abandoned/superseded), tokens (in/out/cache_read/cache_create or null), tools (count per name), outcomes (checks status + exits per verb). `flow_log` events are **excluded** from rollup. | `rollup.ts:135–227`; `segment.ts` rollup wiring | These are the metric `dataPoints`. `flow_log`-exclusion must be mirrored in any metric export. Token group → `gen_ai.client.token.usage`-style metric (but cache_read/cache_create have no semconv home yet). | High |
| F-05 | Sync publishes per-(date,session) git trees of `<seq>.json` blobs to `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>`; the eng-thrive scraper fetches `refs/harness-telemetry/*` and deserializes segment JSON. | `sync-service.ts:19–31, 206–235, 281–308`; `git-write-port.ts:38–52` | The cross-tool contract is the segment JSON schema itself. If OTLP becomes the stored/published form, the scraper changes too — but it's *our* code, so reshaping is internal, not a public break. | High |
| F-06 | `segment.schema.json` `required` includes `event_stream` + `rollup`; `rollup` is `null` when the stream is empty; v1-compat fields (models/skills/tools/…) omitted when empty. `segment-schema.test.ts` pins key-set-equality + `additionalProperties:false`. | `segment.schema.json:8–19`; `segment.ts:183–195, 459–460` | Any reshape updates schema + the freeze test in lockstep. OTLP metrics emit must tolerate `rollup:null` (emit no dataPoints rather than zeros). | High |
| F-07 | OTLP/JSON logs: `resourceLogs[].resource.attributes[]` + `scopeLogs[].scope{name,version}` + `logRecords[]{timeUnixNano, observedTimeUnixNano, severityNumber(0–24), severityText, body(AnyValue), attributes[], traceId, spanId, eventName}`. | opentelemetry-proto `examples/logs.json`; Logs Data Model spec | `eventName` carries our event `kind`; segment identity → resource attrs; per-event fields → `attributes[]`. body can stay minimal (we have no free-form message — and must not invent one). | High |
| F-08 | OTLP/JSON metrics: `resourceMetrics[].scopeMetrics[].metrics[]{name,unit,sum\|gauge\|histogram}` with `dataPoints[]{timeUnixNano, startTimeUnixNano, asInt\|asDouble, attributes[], aggregationTemporality, isMonotonic}`. Attribute values typed via `stringValue/intValue/doubleValue/boolValue/arrayValue/kvlistValue`. | OTLP Metrics Data Model; `examples/metrics.json`; Attribute Type Mapping spec | rollup counts → `sum`/`gauge` dataPoints. Must choose temporality (DELTA per-session is the honest fit — each segment is a window, not a running cumulative). `asInt` for counts. | High |
| F-09 | fileexporter on-disk = JSON Lines: one `LogsData`/`MetricsData` top-level object per `\n` line, UTF-8, no ordering guarantee; size/age rotation (`max_megabytes` default 100, `max_days`, `max_backups`) + optional zstd. | collector-contrib `exporter/fileexporter/README.md`; OTel file-exporter spec | This is the local-storage target shape. One `.jsonl` per signal (logs, metrics) is collector-replayable as-is; ingest each line as atomic JSON. | High |
| F-10 | Severity scale is fixed 1–24 (TRACE 1–4, DEBUG 5–8, INFO 9–12, WARN 13–16, ERROR 17–20, FATAL 21–24; 0=unspecified); both `severityNumber` + `severityText` set. `timeUnixNano` = ns-since-epoch as a **decimal string**; `=0` should be rejected. | Logs Data Model spec; OTLP JSON Encoding spec | Map most events to INFO (9); `api_error` → ERROR (17/18); `checks` fail → WARN/ERROR. Our `t` (ms-ish RFC3339) ×1e6 → ns string. | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | Counts-only is a **locked constitutional invariant** (P12 / AC-04): never prompt/file/free-form content; nullable capability fields stay nullable; repo-relative paths only. | plan-034 §Segment Schema, AC-04; rules.md §9 ledger | **Direct** | Survives any OTLP reshape verbatim. OTLP `body`/`attributes` must carry only allowlisted counts+identifiers — no message text. | 
| H-02 | Segment is **team/repo-grain, never individual**; `harness_session_id` opaque; shard ref keyed by (date, session), never engineer identity (Amendment A1/A4). | plan-034 AC-07/A1/A4; value-measures.md §Team-level | **Direct** | OTLP resource attributes must not introduce a per-person identity; keep session id opaque as the correlation handle. |
| H-03 | Downstream consumer (eng-thrive scraper) reads **our own** segment JSON from our git refs — no third-party system is locked to the shape; nothing has shipped externally. | plan-034 AC-07; sync-service.ts | **Direct** | Confirms the user's "no back-compat" steer: reshaping is an internal migration (segment.ts + schema + scraper + tests), not a public-contract break. |
| H-04 | `flow_log` events (plan-035) are **rollup-isolated** (timeline-only; never bill wall/gap/stage time) and allowlisted by `op`; free-form fields never copied. | plan-035 §Design decisions, AC-07 | **Direct** | Metric export must replicate flow_log exclusion; log export may include them but only their structural fields. |
| H-05 | Privacy is **three-layer**: serializer allowlist + adapter planted-secret control + raw-fixture byte-scan & non-skippable manual review (plan-037). | plan-037 AC-02/08/23; fixture-privacy-scan | **Direct** | Any new OTLP output is a new serialization path → it must pass (or extend) the byte-scan, and the manual "anything bad" review applies before publishing OTLP bytes. |
| H-06 | Deliberate **non-goal: no OTel collector / background daemon / token estimation** at capture time (chosen to keep zero output/exit drift, AC-01). | plan-034 §Non-Goals | **Partial** | OTLP *format* is welcome; an always-on collector/daemon is not. Emit OTLP-shaped files at the existing synchronous seam; let collection be a downstream/optional concern. |
| H-07 | No prior OTEL/OTLP design exists; plan-034's original ask only *mentioned* Copilot's OTel export as motivation, then chose the custom-segment + orphan-ref model. | plan-034 original-ask.md; plans 034–037 | **Partial** | This is greenfield standardisation; no rejected OTEL design to honor — but the daemon-less, synchronous, out-of-tree-ref philosophy is the precedent to respect. |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| GenAI semconv is **experimental** | F-06 (worker-3); semantic-conventions-genai repo | Committing to `gen_ai.agent.*`/`invoke_agent` risks churn; cache_read/cache_create tokens have no semconv home | Adopt only stable `gen_ai.usage.*`; isolate naming behind one mapping module; pin the semconv version we target |
| `t → timeUnixNano` precision loss | F-03, F-10 | `t_precision` (anchored/interpolated/interval) means some timestamps are estimates; OTLP has no native precision flag | Carry `t_precision≠exact` as a logRecord attribute (e.g. `harness.t_precision`) so honesty isn't lost in conversion |
| Metric **temporality** choice | F-08 | Cumulative vs delta changes `startTimeUnixNano` semantics and downstream rate math | Per-segment window ⇒ DELTA is the honest default; decide + document in the plan |
| OTLP output bypassing privacy scan | H-05 | A second serialization path could leak if it skips the allowlist | Emit strictly *from* the serialized Segment; extend fixture-privacy-scan to cover OTLP bytes |
| `rollup: null` | F-06 | Empty stream ⇒ no metrics | Emit zero dataPoints (omit), not zero-valued — avoid fabricating measures |

## Domain Impact

| Domain / boundary | Relationship | Contract or constraint | Evidence |
|-------------------|--------------|------------------------|----------|
| telemetry (segment + sync) | Reshaped or extended | The cross-tool Segment JSON schema + `segment-schema.test.ts` freeze + 3-layer privacy | F-01, F-05, F-06, H-01, H-05 |
| eng-thrive scraper | Downstream consumer (internal) | Reads segment JSON from `refs/harness-telemetry/*` | F-05, H-03 |

## Planning Handoff

- **Preserve**: `serializeSegment` as the single allowlist chokepoint; counts-only / opaque-session / repo-relative privacy (H-01/H-02/H-05); the rollup derivations incl. `flow_log` rollup-isolation (F-04/H-04); the daemon-less, synchronous, out-of-tree-ref capture philosophy (H-06).
- **Change carefully**: `schema_version` + segment field shape (allowed — no back-compat — but update `segment.schema.json` + `segment-schema.test.ts` + the scraper in lockstep, F-06/H-03); the choice of `gen_ai.*` attribute names (experimental, isolate it).
- **Likely files/symbols**: `segment.ts` (`serializeSegment`/`serializeEvent`, field set), `capture-service.ts` (the write seam ~L406–419), `rollup.ts`, `sync-service.ts` + `segment.schema.json` + `segment-schema.test.ts`, `fixture-privacy-scan`, a new `otlp/` emitter module.
- **Decisions still required**:
  1. **Additive OTLP view vs OTEL-native segment store** (the central fork — F-01/H-03).
  2. **Logs+Metrics both, or Logs-only** (derive metrics downstream from the event stream).
  3. **`gen_ai.*` adoption depth** given experimental status — stable subset only?
  4. **On-disk layout**: one JSONL per signal under `.harness/`; and does `refs/harness-telemetry/*` store OTLP or stay segment-JSON?
  5. **Metric temporality** (DELTA per-window recommended) + **`t_precision` attribute policy**.

## External Research

_Standard is pinned; one residual tracking item only._

| Question | Why repo evidence is insufficient | Planning impact | Prompt |
|----------|-----------------------------------|-----------------|--------|
| Which OTEL GenAI semconv version to target, and is `gen_ai.invoke_agent`/agent spans stable yet? | Depends on the live spec release cadence, not the repo | Sets how much `gen_ai.*` we adopt now vs defer behind a mapping layer | "What is the latest OpenTelemetry semantic-conventions release and the stability status of gen_ai.* agent/invoke_agent attributes and gen_ai.client.token.usage metric as of mid-2026? Cite the semconv changelog." |
