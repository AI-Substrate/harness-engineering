## Why

People can inspect a flight-plan file today, but they must manually scan or script its nodes to answer basic progress questions. A read-only summary command will make status and node-type distribution available through the same deterministic `harness flow` interface as other flow reads.

## What Changes

- Add a read-only `harness flow stats` command for a flow JSON file selected with the existing `--path` or `--slug` conventions.
- Report the total node count plus counts grouped by each node's `status` and `type`.
- Provide deterministic human-readable output and the standard structured JSON envelope.
- Reuse existing flow read errors for missing, invalid, forward-version, and legacy documents; the command never mutates the flow.
- Document the command and cover its pure aggregation and CLI behavior with tests.

## Capabilities

### New Capabilities

- `flow-stats`: Read a CLI-owned flow document, including a flight plan, and report deterministic node counts by status and by type.

### Modified Capabilities

None.

## Impact

- Flow CLI registration and output wiring in `harness/cli/src/acts/flow.ts`.
- A small pure aggregation/rendering service under `harness/cli/src/services/flow/`.
- Flow service/act tests under `harness/cli/test/` and the `docs/how/harness-flow.md` command reference (plus its generated docs bundle).
- No flow schema, persisted flight-plan format, dependency, or mutation behavior changes.
