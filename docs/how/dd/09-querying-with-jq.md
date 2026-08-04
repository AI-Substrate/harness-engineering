# Querying deterministic documents with jq

The generated markdown is for reading. The `.dd.json` is for questions. The
examples below run against:

```text
docs/how/dd/exemplar/
```

Set a shell variable to shorten the commands:

```bash
plan=docs/how/dd/exemplar/plan.dd.json
tasks=docs/how/dd/exemplar/tasks/phase-2/tasks.dd.json
```

## Acceptance criteria that still hold the built-in gate

```bash
jq -r '
  .sections[]
  | select(.name == "acceptance_criteria")
  | .value[]
  | select(.state as $state
      | ["checked", "human-skipped", "na"]
      | index($state)
      | not)
  | "\(.id)\t\(.state)\t\(.claim)"
' "$plan"
```

The exemplar returns `ac-0901` as `unchecked`. Filtering only
`state != "checked"` would incorrectly include valid `human-skipped` and `na`
rows.

## Every human waiver and its receipt

```bash
jq -r '
  ..
  | objects
  | select(.state == "human-skipped")
  | "\(.id)\t\(.receipt)"
' "$tasks"
```

The phase-2 exemplar returns the `dw-0294` waiver and its recorded words.

## Progress for one evidence list

```bash
jq -r '
  .sections[]
  | select(.name == "evidence")
  | .value["tk-0201"]
  | "\(map(
      select(.state as $state
        | ["checked", "human-skipped", "na"]
        | index($state))
    ) | length)/\(length)"
' "$tasks"
```

The result is `3/3`.

## Assertions missing a proof link

```bash
jq -r '
  .sections[]
  | select(.name == "evidence")
  | .value
  | to_entries[]
  | .key as $task
  | .value[]
  | select(has("proven_by") | not)
  | "\($task)\t\(.id)\t\(.assertion)"
' "$tasks"
```

This query distinguishes "passing state" from "has a proof link". dd does not
invent evidence from a state word.

## Unique execution-log entries cited by acceptance criteria

```bash
jq -r '
  .sections[]
  | select(.name == "acceptance_criteria")
  | .value[]
  | select(.proven_by)
  | .proven_by
' "$plan" | sort -u
```

## Count states across every nested object

```bash
jq -r '
  [.. | objects | .state? | select(. != null)]
  | group_by(.)
  | map({state: .[0], count: length})
  | .[]
  | "\(.state)\t\(.count)"
' "$tasks"
```

## Inspect a dynamic-key map

```bash
jq -r '
  .sections[]
  | select(.name == "evidence")
  | .value
  | keys[]
' "$tasks"
```

Each result is an addressable task id under `#evidence/<task-id>`.

## Query custom-type source values

```bash
release=docs/how/dd/exemplar/custom-render/release.dd.json

jq '
  .sections[]
  | select(.name == "meta")
  | {
      minutes: .value.window,
      bytes: .value.footprint,
      points: .value.burndown
    }
' "$release"
```

Adapters change only the markdown presentation. The query still receives the
original number and array values.

## Combine dd envelopes with jq

Every dd command supports JSON output:

```bash
harness dd validate "$plan" --depth 3 --json \
  | jq '{status, counts: .data.counts, issues: .data.issues}'
```

For schema provenance:

```bash
harness dd schema list --json \
  | jq -r '.data.schemas[] | "\(.name)\t\(.root)\t\(.path)"'
```

Query the envelope for automation. Query the document for domain state.
