## Why

Buffered telemetry already contains timestamped, privacy-safe events, but answering basic local questions requires exporting sessions or inspecting segment files manually. A read-only summary command will make event volume and its day-by-day distribution immediately visible through the existing `harness telemetry` interface.

## What Changes

- Add a read-only `harness telemetry summary` command that reads the local telemetry buffer without syncing, pruning, or mutating it.
- Report total event counts grouped by the closed telemetry event kind vocabulary.
- Report event counts grouped by UTC calendar day, with per-kind counts for each day.
- Provide deterministic human-readable output and the standard structured JSON envelope.
- Skip malformed or unreadable segment/event records consistently with existing telemetry buffer readers while reporting enough provenance to make omissions visible.
- Document the command and cover aggregation, buffer-shape compatibility, empty-buffer behavior, and CLI output with tests.

## Capabilities

### New Capabilities

- `telemetry-buffer-summary`: Read the local telemetry buffer and report deterministic event counts by kind and by UTC day without changing buffered data.

### Modified Capabilities

None.

## Impact

- Telemetry CLI registration and output wiring in `harness/cli/src/acts/telemetry.ts`.
- A pure summary service under `harness/cli/src/services/telemetry/` that reuses existing buffer paths, event types, and decoding conventions.
- Telemetry service/act tests under `harness/cli/test/` and the telemetry command documentation plus its generated docs bundle.
- No telemetry event schema, buffer format, sync behavior, external dependency, or persisted source data changes.
