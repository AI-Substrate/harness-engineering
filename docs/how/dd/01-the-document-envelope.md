# The document envelope

Every deterministic document is a `.dd.json` object with three concepts:

```json
{
  "dd": {
    "schema": "builder/plan",
    "spec": "1",
    "sweep_exclude": false
  },
  "sections": [
    {
      "name": "meta",
      "title": "Plan details",
      "value": {
        "title": "Release plan",
        "status": "draft"
      }
    }
  ],
  "references": [
    {
      "path": "tasks.dd.json",
      "sha": "0123456789abcdef",
      "mode": "pinned"
    }
  ]
}
```

- `dd` identifies the schema and carries document-level options.
- `sections` is an ordered list of schema-named, addressable values.
- `references` is the basis ledger for target documents this document depends
  on.

The parser accepts an omitted `references` field as an empty ledger. Writing
`"references": []` makes the full envelope visible to readers and generators.

## The `dd` header

`dd.schema` is required and must be a non-empty string. It names a qualified
schema package such as `builder/plan` or `release/gate`.

Two optional fields are recognized:

| Field | Type | Meaning |
| --- | --- | --- |
| `spec` | string | a document-carried specification marker |
| `sweep_exclude` | boolean | exclude this document from repository doctor sweeps |

The current core parser type-checks `spec` but does not interpret its value.

`sweep_exclude` affects sweep mode only. Direct validation still inspects the
document:

```bash
harness dd validate path/to/excluded.dd.json --depth 0
```

See [Validation and doctor](08-validation-and-doctor.md#sweep-exclusions).

## Sections are ordered slots

Each section must be an object with:

- a non-empty `name`;
- an optional non-empty `title`;
- a `value`, whose shape comes from the schema.

Section names must be unique within the document. The order in the JSON is the
order in the generated markdown.

The value may be an object, array, scalar, or dynamic-key map when the schema
permits it:

```json
{
  "name": "goals",
  "value": [
    "Make every criterion addressable.",
    "Keep the human view generated."
  ]
}
```

Validation rejects a required schema section that is missing. It also rejects
a document section the schema does not declare.

## `name` is identity; `title` is display

The `name` field is the stable machine identity:

```json
{
  "name": "non_goals",
  "title": "What we are deliberately not doing",
  "value": []
}
```

Addresses use `non_goals`, and the generated anchor remains
`#non-goals`. Retitling the section does not move its address.

There is no separate `section_id` field. `name` already performs that role.
`title` was added so the machine identity no longer has to perform the display
role too.

Generated headings use three-level precedence:

1. `sections[].title` from the document;
2. `sections.<name>.title` from the schema;
3. a conservative derivation from `name`.

For the derived tier, `_` and `-` become spaces and the first letter is
capitalized:

```text
acceptance_criteria -> Acceptance criteria
```

A schema can choose punctuation or capitalization once for every document of
that kind:

```json
{
  "sections": {
    "non_goals": {
      "title": "Non-goals",
      "shape": {
        "type": "array",
        "items": { "type": "text" }
      }
    }
  }
}
```

A document-level title overrides both schema and derived titles for that one
section.

## The basis ledger

Each reference contains:

| Field | Meaning |
| --- | --- |
| `path` | target `.dd.json`, relative to this document |
| `sha` | recorded SHA-256 of the entire target document |
| `mode` | `live` or `pinned` |

The ledger records freshness; it does not replace schema-declared link fields.
See [Freshness and the basis ledger](07-freshness-and-the-basis-ledger.md).

## Source and generated sibling

Given:

```text
release.dd.json
```

the generated sibling is:

```text
release.dd.md
```

The JSON is authored and reviewed. The markdown begins with a generated-file
banner and is overwritten by `harness dd build`. Never hand-edit the sibling.

The renderer uses only the source basename in its header, so canonical output
does not embed machine-specific absolute paths.
