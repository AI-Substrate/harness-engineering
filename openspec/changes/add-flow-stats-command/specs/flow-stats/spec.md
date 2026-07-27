## ADDED Requirements

### Requirement: Select and read a flow document
The system SHALL provide a read-only `harness flow stats` command that selects a CLI-owned flow document through `--path <file>` or the existing `--slug <slug>` resolution convention and loads it through the standard flow read boundary.

#### Scenario: Select a flight plan by path
- **WHEN** a user runs `harness flow stats --path docs/plans/example/the-flow.json` for a readable CLI-owned flight plan
- **THEN** the command computes statistics for that file and exits successfully

#### Scenario: Select a flow by slug
- **WHEN** a user runs `harness flow stats --slug example` and `.harness/flows/example.json` is readable
- **THEN** the command computes statistics for the resolved flow and exits successfully

#### Scenario: No target is supplied
- **WHEN** a user runs `harness flow stats` without `--path` or `--slug`
- **THEN** the command returns the standard missing-flow error and a non-zero exit code

#### Scenario: The target cannot be read
- **WHEN** the selected file is missing, invalid JSON, forward-versioned, or a legacy flow without CLI provenance
- **THEN** the command returns the corresponding existing flow read error and a non-zero exit code

#### Scenario: Statistics are read-only
- **WHEN** the command successfully reports statistics
- **THEN** it MUST NOT modify the flow file, append an event, update a timestamp, or regenerate a sibling render

### Requirement: Count nodes by status and type
The system SHALL report the total number of nodes and SHALL group every node exactly once by its exact `status` value and exactly once by its exact `type` value. The grouping SHALL support overlay-defined values without a hard-coded flight-plan vocabulary.

#### Scenario: Mixed flight-plan nodes are counted
- **WHEN** a flow contains four nodes with statuses `done`, `done`, `in_progress`, and `known`, and types `research`, `phase`, `phase`, and `review`
- **THEN** the result has `node_count` 4, status counts `{done: 2, in_progress: 1, known: 1}`, and type counts `{phase: 2, research: 1, review: 1}`

#### Scenario: Custom overlay values are preserved
- **WHEN** a valid flow contains a node whose status or type is defined by a custom overlay
- **THEN** the result includes that exact status or type key with its count

#### Scenario: The flow has no nodes
- **WHEN** a valid flow has an empty `nodes` array
- **THEN** the result has `node_count` 0 and empty status and type groupings

#### Scenario: Group order is deterministic
- **WHEN** nodes appear in any document order
- **THEN** status keys and type keys are emitted in ascending lexical order

### Requirement: Render human-readable statistics
In human output mode, the system SHALL print a raw statistics summary containing the resolved path, total node count, a `By status` section, and a `By type` section.

#### Scenario: Human output contains both groupings
- **WHEN** a user runs the command in human output mode for a non-empty flight plan
- **THEN** stdout lists the total and every status and type count in deterministic order

#### Scenario: Human output for an empty flow
- **WHEN** a user runs the command in human output mode for a zero-node flow
- **THEN** stdout reports zero nodes and explicitly renders both groupings as `none`

### Requirement: Emit structured statistics
In JSON output mode, the system SHALL emit the standard successful `flow` envelope with `data.path`, `data.node_count`, `data.by_status`, and `data.by_type`.

#### Scenario: JSON output is machine-readable
- **WHEN** a user runs `harness --json flow stats --path <file>` for a readable flow
- **THEN** the command exits successfully and the envelope data contains the resolved path, total node count, complete status counts, and complete type counts

#### Scenario: JSON output contains empty maps
- **WHEN** JSON output is requested for a zero-node flow
- **THEN** `data.node_count` is 0 and both `data.by_status` and `data.by_type` are empty objects
