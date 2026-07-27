## Context

Telemetry capture writes per-session segment JSON files under `.harness/temp/telemetry/<session>/<seq>.json`. Each current segment carries a privacy-safe `event_stream`; older segments may only carry the flat v1 view that `normalizeV1ToEvents` already converts into a minimal event stream. Existing telemetry readers establish the buffer path, session-directory filtering, sequence ordering, corrupt-file tolerance, and injected-port boundary, while `registerTelemetryAct` owns Commander registration and standard envelope/text output.

The new command is a local diagnostic over the buffer as it exists. It must not share the pending-only semantics of `pendingTelemetry`, trigger sync behavior, or depend on committed telemetry refs.

## Goals / Non-Goals

**Goals:**

- Count every recognized event in every parseable local buffer segment.
- Provide global counts by event kind and UTC-day entries containing totals and per-kind counts.
- Preserve deterministic ordering and standard JSON/text CLI behavior.
- Surface malformed segments, malformed events, and recognized events without usable dates without failing an otherwise useful summary.
- Reuse the telemetry event vocabulary, buffer location, legacy normalization, and injected filesystem conventions.

**Non-Goals:**

- Reading committed telemetry refs, external ledgers, saved session exports, reports, or insights.
- Distinguishing flushed from unflushed local segments.
- Filtering by session, date range, plan, harness, or event fields.
- Changing telemetry capture, event schemas, serialization, sync, retention, or privacy behavior.
- Persisting a summary artifact or adding an external dependency.

## Decisions

### Add a pure buffer-summary service

Create a telemetry summary service that accepts the minimal injected filesystem/process ports, resolves `telemetryDir(proc.cwd())`, scans dot-free session directories and numeric `*.json` segment files in sorted order, and returns a typed summary value. Keep aggregation and diagnostics out of the Commander action so they can be tested without process or output concerns.

The service should reuse or extract a diagnostics-capable variant of the existing `readSegments` traversal rather than establish a second incompatible buffer convention. Preserve the current `readSegments` API for existing consumers if extraction is needed.

**Alternative considered:** Build the summary by calling `combineSession` for every directory. That path is optimized for SessionExport identity and signals, supports sources beyond the local buffer, and would add unnecessary work and output coupling for a simple event aggregate.

### Count segment JSON as the local source of truth

Read numeric segment JSON files from the local buffer. For current segments, count `event_stream`; for legacy segments without it, call the existing `normalizeV1ToEvents` compatibility function. Do not read OTLP companions separately because capture writes them from the same segment event stream, which would risk double-counting, and mark segments deliberately have no companions.

**Alternative considered:** Decode `*.logs.jsonl` first as `combineSession` does. This is necessary for committed-shard reconstruction but not for the local buffer, where the segment JSON remains present and includes locally retained event kinds.

### Make day bucketing explicitly UTC

Parse each recognized event timestamp as an instant and derive the day with UTC semantics (`YYYY-MM-DD`). Sort day entries ascending. Build kind maps by iterating `EVENT_KINDS`, not by object insertion order from observed data, so global and per-day output remains stable as input file ordering changes.

Recognized events with invalid timestamps still count globally because their kind is usable, but they increment `undated_events` and are omitted from day entries. Events with unrecognized kinds do not contribute to totals and increment `skipped_events`.

**Alternative considered:** Bucket by the timestamp's written date prefix or local timezone. Either choice makes offset timestamps or machine location change the result and conflicts with telemetry's instant-based timestamps.

### Return one summary contract for both renderers

The service result should include the buffer source label, session/segment diagnostics, total counted events, skipped and undated counts, global kind counts, and ordered day entries with totals and kind counts. The act maps this value into `formatOk('telemetry', summary, ...)`; the text port renders the same value as concise totals plus kind/day tables.

An absent or empty buffer is an ordinary successful result with zero totals. Malformed individual inputs degrade diagnostics rather than fail the command, matching existing telemetry read behavior. Unexpected filesystem/service errors still follow the existing telemetry error-envelope path rather than being silently converted to a zero summary.

**Alternative considered:** Print directly from the scanner. That would duplicate business rules between JSON and text modes and make aggregation harder to test independently.

### Register the command without options

Add `summary` directly under the existing `telemetry` command family. Version one has no filtering or source-selection options: it always reads the current repository's local buffer. Update the telemetry family description and user documentation, then regenerate the embedded docs bundle.

**Alternative considered:** Add `--worktree`, `--source`, or date filters immediately. Those are useful extensions but broaden path/source semantics beyond the requested local summary and can be added compatibly later.

## Risks / Trade-offs

- [Retained flushed segments may appear in the summary] → Describe the command as a summary of the current local buffer, not pending telemetry; tests pin that all locally present numeric segments count.
- [Legacy flat segments have only coarse timestamps] → Reuse the existing honest v1 normalization, which anchors synthesized events to the segment timecode rather than inventing a timeline.
- [Malformed input can make totals incomplete] → Return explicit skipped-segment, skipped-event, and undated-event diagnostics in both output modes.
- [A future event kind could be omitted accidentally] → Drive aggregation order and recognition directly from `EVENT_KINDS` and add a vocabulary coverage test.
- [Large buffers require a full scan] → Aggregate in one pass without retaining all events; this command is explicitly an on-demand local diagnostic.

## Migration Plan

This is an additive command with no data migration. Implement the service and tests, register the CLI action, update telemetry documentation and generated docs, then run the existing repository checks. Rollback removes the command and service without touching buffered data.

## Open Questions

None for the initial command.
