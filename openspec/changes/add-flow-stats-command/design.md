## Context

`harness flow` is a core nested command registered in `harness/cli/src/acts/flow.ts`. Existing read commands resolve `--path` or `--slug`, load the document through `readFlowDoc`, and either emit the standard JSON envelope or a purpose-built human rendering. Flow nodes have required string `type` and `status` fields, but their vocabularies belong to each overlay rather than to the shared core.

The telemetry domain already has a flight-plan artifact extractor, but it produces a fixed, partial set of telemetry counters and is deliberately path- and privacy-specific. The new command needs a complete, user-facing grouping without coupling flow mechanics to telemetry.

## Goals / Non-Goals

**Goals:**

- Add a read-only `harness flow stats --path <file>` command, with the existing `--slug` alternative.
- Count every node once by its exact status and once by its exact type.
- Produce stable human output and a stable structured envelope for agents.
- Preserve the flow family's current path resolution and error behavior.
- Keep aggregation pure, deterministic, and independently testable.

**Non-Goals:**

- Changing flow schemas, node status/type vocabularies, or persisted flight-plan files.
- Adding filters, percentages, cross-file aggregation, historical/event statistics, or telemetry emission.
- Restricting the helper to the external `flight-plan` overlay; other valid flow kinds can use the same generic mechanics.
- Changing `flow show` or any mutation command.

## Decisions

### Use a pure flow-domain statistics service

Add a small module under `harness/cli/src/services/flow/` that accepts a `FlowDoc` and returns:

- `node_count`: total nodes;
- `by_status`: exact status value to count;
- `by_type`: exact type value to count.

The service will tally both dimensions in one O(n) pass and materialize keys in ascending lexical order so JSON and human rendering are deterministic. A zero-node flow returns `node_count: 0` and empty maps.

**Alternative considered:** extend or import the telemetry `flightPlanExtractor`. Rejected because it recognizes only selected types/statuses, omits zero-valued counters, matches only `the-flow.json`, and would introduce the wrong dependency direction from flow mechanics into telemetry.

### Reuse the established flow read boundary

Register `stats` beside the other read subcommands in `flow.ts`, with `--path` and `--slug`. Resolve the target through the existing path helper and load it through `readFlowDoc`, preserving `E301` missing-file, `E300` invalid-JSON, `E306` forward-version, and `E308` legacy-format behavior. The command performs no writes, event appends, timestamp changes, or sibling render updates.

**Alternative considered:** accept a positional file path or parse JSON directly in the new command. Rejected because that would create a second path/error contract inside the same command family.

### Give humans a raw summary and agents an envelope

In JSON mode, emit the standard `flow` success envelope with `data.path`, `data.node_count`, `data.by_status`, and `data.by_type`. In human mode, use raw output, following the `rail` and `chores` precedents, with a path header, total, and alphabetically ordered `By status` and `By type` sections. Empty groupings render explicitly as `none` rather than disappearing.

**Alternative considered:** use the generic human envelope renderer. Rejected because it prints only `flow: ok` and would hide the counts the command exists to show.

### Test the pure contract and the command boundary separately

Service tests will cover mixed values, repeated values, custom overlay vocabulary, empty nodes, and deterministic ordering. Act-level tests will cover `--path`/`--slug`, exact human and JSON shapes, read-only behavior, and representative read failures. The flow command guide will document examples and output; the existing docs generation/check pipeline will refresh and guard its bundled copy.

## Risks / Trade-offs

- **[Object key order can drift if callers construct maps differently]** → Build both maps through one sorted materialization helper and pin order in service and act tests.
- **[A generic helper may be mistaken for flight-plan-only behavior]** → Name and type it in the flow domain while documenting flight plans as the primary use case.
- **[Human and JSON output could diverge]** → Render human text from the same `FlowStats` value placed in the JSON envelope.
- **[Future overlays introduce unfamiliar status/type strings]** → Count exact values from the document instead of maintaining a hard-coded vocabulary.

## Migration Plan

This is an additive read command with no persisted-data migration. Release it with the normal CLI build; rollback removes the command registration and pure helper without touching any flow file.

## Open Questions

None. The existing flow read and output conventions resolve the relevant interface choices.
