# Schema packages and resolution

A `.dd.json` file names a schema but does not embed one:

```json
{
  "dd": {
    "schema": "release/gate"
  }
}
```

`release/gate` is a **qualified schema name** with exactly two path-safe
segments: `<package>/<schema>`.

The schema is a folder convention:

```text
schemas/
└── release/
    └── gate/
        ├── schema.json
        └── adapters/
            ├── bytes.ts
            ├── duration.ts
            └── sparkline.ts
```

The qualified name comes from the two directories above `schema.json`, never
from a field inside the file. A copied package therefore cannot claim the
identity of its old location.

## Discovery roots

For a document, resolution searches four roots in order:

1. the directory containing the document;
2. `<repository-root>/.dd`;
3. `<repository-root>/.harness/.dd`;
4. `~/.dd`.

Each root is deep-scanned until a `schemas/<package>/<schema>/schema.json`
package is found. The hierarchy above `schemas/` is organizational and has no
depth limit.

The custom release corpus is self-contained:

```text
docs/plans/065-deterministic-documents/exemplar/custom-render/
├── release.dd.json
└── schemas/release/gate/schema.json
```

No repository registration points at it. `release.dd.json` resolves
`release/gate` because its own directory is the highest-precedence discovery
root.

## First hit wins, but every duplicate is visible

The first root containing a qualified name wins. Lower-precedence copies are
reported as shadows with their paths:

```bash
harness dd schema show builder/plan
```

A duplicate name within one root is different: precedence cannot choose
between two packages at the same level, so resolution returns an error.

This distinction permits deliberate local override while preventing silent
forks inside one discovery root.

## What `schema.json` declares

The release schema starts with:

```json
{
  "dd_schema": 1,
  "description": "A release gate with its own vocabulary and render types.",
  "enums": {
    "signoff": {
      "values": ["pending", "in-review", "approved", "waived", "rejected"],
      "gate_terminal": ["approved", "waived"]
    },
    "surface": {
      "values": ["cli", "api", "docs", "telemetry"]
    }
  },
  "sections": {
    "gates": {
      "shape": {
        "type": "array",
        "items": {
          "type": "object",
          "required": ["id", "state"],
          "fields": {
            "id": { "type": "string" },
            "state": { "type": "state", "enum": "signoff" },
            "surface": { "type": "enum", "enum": "surface" }
          }
        }
      }
    }
  }
}
```

The built-in shape types are:

```text
string  text  int  number  bool  enum  state  link  array  object
```

An unknown type name is a custom render type. Core validation has no structural
rule for it; the renderer looks for an adapter. See
[Custom types and adapters](06-custom-types-and-adapters.md).

Object shapes can declare:

- `required`: fields that must exist;
- `fields`: known keys and their shapes;
- `allowAdditional: false`: reject undeclared keys when no map shape exists;
- `valuesShape`: shape every otherwise-unknown key's value.

A section declaration can also carry an optional human `title`. It changes the
generated heading for every document using that schema but does not change the
section `name` or anchor. A document can override the title for one section.

## Dynamic-key maps with `valuesShape`

The exemplar task document stores one evidence list per task:

```json
{
  "name": "evidence",
  "value": {
    "tk-0201": [
      {
        "id": "dw-0211",
        "assertion": "Every failure has a good twin.",
        "state": "checked"
      }
    ]
  }
}
```

The schema cannot enumerate task ids in advance. It describes each map value:

```json
{
  "type": "object",
  "valuesShape": {
    "type": "array",
    "items": {
      "type": "object",
      "required": ["id", "assertion", "state"],
      "fields": {
        "id": { "type": "string" },
        "assertion": { "type": "text" },
        "state": { "type": "state" }
      }
    }
  }
}
```

Without `valuesShape`, those interiors remain visible in JSON and rendering,
but their nested values are not schema-validated. With it, state values,
receipts, links, and ids under every dynamic key participate in validation and
address resolution.

## Inspecting schemas

From the repository root:

```bash
harness dd schema list
harness dd schema show builder/plan
```

`list` returns the roots it searched, every winning schema path, descriptions,
shadow chains, and load issues. `show` adds section summaries, declared enums,
the schema's gate-terminal set, and the built-in completion enum.

### `schema list` has no document-folder root

`schema list` has no document argument, so it cannot know which document folder
to search. Its roots are repository `.dd`, repository `.harness/.dd`, and home
`.dd`.

Consequently, running it from the custom-render folder reports zero schemas
even though `release.dd.json` in that folder resolves `release/gate`. This is
known issue FU-4a. Use document validation as the authoritative resolution
probe for a document-local package:

```bash
harness dd validate \
  docs/plans/065-deterministic-documents/exemplar/custom-render/release.dd.json \
  --depth 0
```

Run schema and validation commands from the repository root until FU-4 is
resolved.
