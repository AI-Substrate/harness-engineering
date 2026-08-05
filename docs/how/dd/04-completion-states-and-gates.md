# Completion states and gates

A state value is useful when a schema says which values hold a gate and which
values pass it. The built-in completion vocabulary is:

| State | Gate effect | Required context |
| --- | --- | --- |
| `unchecked` | holds | none |
| `checked` | passes | evidence is an authoring convention |
| `blocked` | holds | non-empty `note` |
| `human-skipped` | passes | non-empty human receipt |
| `na` | passes | non-empty `note` explaining why it does not apply |

The built-in **gate-terminal set** (the states that count as passing) is:

```text
checked, human-skipped, na
```

Validation rejects `blocked` or `na` without a note. It rejects
`human-skipped` without either a non-empty receipt string or a receipt object
whose `verbatim_words` field is non-empty.

## What the receipt rule can and cannot prove

The phase-2 exemplar records a waiver:

```json
{
  "id": "dw-0294",
  "assertion": "The repository-root invocation is exercised by the quality gate.",
  "state": "human-skipped",
  "note": "The gap is real and remains visible.",
  "receipt": "Recorded in the phase-2 log: \"left to the retro / P5 checks conversation\"."
}
```

The intended rule is that only a human chooses `human-skipped`, and the receipt
preserves that person's words. The validator can enforce that receipt text is
present. It cannot authenticate who wrote the file or determine whether the
text is genuinely verbatim. Treat human authorship as a governance rule backed
by an auditable field, not an identity check.

## Custom completion vocabularies

The release corpus does not use the built-in words:

```json
{
  "signoff": {
    "values": ["pending", "in-review", "approved", "waived", "rejected"],
    "gate_terminal": ["approved", "waived"]
  }
}
```

This makes `approved` and `waived` pass. `pending`, `in-review`, and `rejected`
hold. A decided rejection is not treated as completion unless the schema says
it is terminal.

The same schema declares a `surface` enum without `gate_terminal`. It is a
vocabulary rather than a gate, so values such as `cli` and `docs` have no
completion mark.

## Derived state is a projection over a section

The derivation engine recursively collects every object with a string `state`
inside a section. It then counts values in the active gate-terminal set:

```text
terminal = entries whose state is gate-terminal
total    = every collected state entry
complete = terminal equals total
```

For the evidence list under `tk-0201`, the renderer computes `3/3` from three
checked assertions:

```text
[x] 3/3
```

Partial progress uses `[~]`, no passing entries uses `[ ]`, and complete uses
`[x]`.

## Derived summaries do not reconcile explicit state fields

Derived state and an authored `state` field are currently separate facts. If a
task row says `checked` but its linked evidence contains an `unchecked`
assertion, validation does not compare them.

A verified probe renders both answers:

```text
| state       | done                         |
| ----------- | ---------------------------- |
| [x] checked | [ ] 0/1 [tk-0a01](#tk-0a01) |
```

This means a derived link summary is trustworthy as a computation over its
target section, but it does not automatically rewrite or invalidate another
state field beside it. Avoid storing a second completion claim when the derived
summary is the intended authority, or add a project-specific check that proves
the two agree. This open consistency gap is FU-5.

## Query a gate without reading prose

For the built-in vocabulary:

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
' plan.dd.json
```

For a custom vocabulary, use the terminal values declared by that schema. JSON
remains the query surface; the generated marks are the human view of the same
rule.

For what the gate is FOR — how these mechanisms add up to an auditable claim — see
[The builder proof graph](11-the-builder-proof-graph.md).
