# Telemetry Buffer Summary Specification

## Purpose

Define the read-only CLI contract for summarizing events retained in the local telemetry buffer by event kind and UTC day.

## Requirements

### Requirement: Summarize buffered telemetry events
The system SHALL provide a read-only `harness telemetry summary` command that reads every parseable segment in the current repository's local telemetry buffer and counts events from those segments. The command MUST NOT sync, prune, rewrite, or otherwise mutate telemetry buffer contents.

#### Scenario: Buffered events are summarized
- **WHEN** the telemetry buffer contains parseable segments with telemetry events
- **THEN** the command succeeds and reports the total number of counted events and their counts grouped by event kind

#### Scenario: Empty buffer is a successful summary
- **WHEN** the telemetry buffer is absent or contains no parseable segments
- **THEN** the command succeeds with zero totals and empty day groupings

#### Scenario: Summary leaves the buffer unchanged
- **WHEN** the command reads a populated telemetry buffer
- **THEN** no telemetry file, cursor, watermark, or git ref is created, changed, or removed

### Requirement: Group events by UTC day
The system SHALL derive each event's calendar day from its parseable timestamp in UTC and SHALL report days in ascending `YYYY-MM-DD` order. Each day entry MUST include its total event count and counts grouped by event kind.

#### Scenario: Events span multiple UTC days
- **WHEN** buffered events have timestamps on more than one UTC calendar day
- **THEN** the command reports one entry per day in ascending order with the correct total and per-kind counts

#### Scenario: Timestamp offsets cross a UTC boundary
- **WHEN** an event timestamp contains an offset whose UTC instant belongs to a different calendar day
- **THEN** the event is grouped under the UTC calendar day of the represented instant

### Requirement: Use the closed event-kind vocabulary
The system SHALL group recognized events using the repository's `EVENT_KINDS` vocabulary and SHALL emit kind counts in that vocabulary's deterministic order.

#### Scenario: Multiple event kinds are present
- **WHEN** buffered segments contain events of several recognized kinds
- **THEN** the global and per-day groupings report each recognized kind's exact count in deterministic order

#### Scenario: A segment contains an unrecognized event kind
- **WHEN** a parseable segment contains an event whose kind is not in `EVENT_KINDS`
- **THEN** the event is excluded from kind and day totals and is included in the reported skipped-event count

### Requirement: Surface incomplete input honestly
The system SHALL continue past unreadable or malformed segment files and malformed events while reporting source diagnostics that distinguish scanned sessions, counted segments, skipped segments, counted events, skipped events, and recognized events that lack a parseable timestamp.

#### Scenario: A segment file is malformed
- **WHEN** one buffered segment file is invalid JSON and other segment files are valid
- **THEN** the valid events are summarized, the malformed segment is counted as skipped, and the command still succeeds

#### Scenario: A recognized event has no parseable timestamp
- **WHEN** an event has a recognized kind but its timestamp cannot be parsed
- **THEN** the event contributes to the global kind and event totals, does not contribute to a day entry, and increments the undated-event count

### Requirement: Support structured and human-readable output
The system SHALL expose the summary through the standard harness output mode selection. JSON mode MUST return the summary in a successful `telemetry` envelope, and human mode MUST print a deterministic, concise summary of totals, kind counts, day counts, and input diagnostics.

#### Scenario: JSON output is requested
- **WHEN** the user runs `harness telemetry summary --json` or otherwise selects JSON mode
- **THEN** stdout contains one valid successful harness envelope whose data contains the complete summary

#### Scenario: Human output is selected
- **WHEN** the user runs `harness telemetry summary` in human output mode
- **THEN** stdout contains deterministic sections for totals, counts by kind, counts by UTC day, and any non-zero skipped or undated diagnostics
