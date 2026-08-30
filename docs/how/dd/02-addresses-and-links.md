# Addresses and links

A deterministic document becomes useful when another row, document, or tool can
name one of its parts without copying the prose. A dd **address** has one file
part, one `#` boundary, and an interior:

```text
docs/how/dd/exemplar/plan.dd.json#phases/ph-0002/tasks
└──────────────────────── file ────────────────────────────┘ └── interior ──┘
```

The file is a `.dd.json` path. The interior walks through schema-shaped data.
The example above resolves as:

| Segment | Resolved kind | Meaning |
| --- | --- | --- |
| `phases` | section | the document's `phases` section |
| `ph-0002` | instance | the array row whose `id` is `ph-0002` |
| `tasks` | part | the `tasks` field on that row |

Run the resolver when the classification matters:

```bash
node_modules/.bin/ddocs address validate \
  "docs/how/dd/exemplar/plan.dd.json#phases/ph-0002/tasks" \
  --resolve
```

`--resolve` checks the target exists, loads its schema, classifies each segment,
and returns the addressed value's document, schema, kind, SHA, and tracking
state. Syntax-only validation cannot classify segments because it has no shape
to consult.

## Relative paths and the bare form

An address written inside a document resolves its file part relative to the
document containing the address:

```json
{
  "plan": "../plan.dd.json#phases/ph-0005"
}
```

For a same-document link, omit the file part:

```json
{
  "done": "#done_when/tk-0201"
}
```

The bare form survives a file rename or move because it has no filename to
update. It only has meaning in a containing document. The CLI can validate its
syntax:

```bash
node_modules/.bin/ddocs address validate "#done_when/tk-0201"
```

The CLI cannot resolve that bare address by itself because no containing file
was supplied. Use a qualified address at the command line:

```bash
node_modules/.bin/ddocs link resolve \
  "docs/how/dd/exemplar/tasks/phase-2/tasks.dd.json#done_when/tk-0201"
```

Qualified paths entered on the command line are anchored at the repository
root. See [Validation and doctor](08-validation-and-doctor.md#known-cwd-defect)
for the current repository-root limitation.

## The grammar

An address must:

- contain exactly one `#`;
- have a non-empty interior;
- have no empty `/` segments;
- use segments that start with a letter and contain only letters, digits, `.`,
  `_`, and `-`;
- not contain `@`, which is reserved outside the v1 grammar.

Generate addresses rather than assembling them:

```bash
node_modules/.bin/ddocs address generate \
  "phases/ph-0002/tasks" \
  --path docs/how/dd/exemplar/plan.dd.json
```

Generation normalizes separators and dot segments, then sends the result
through the same parser used by validation.

## Resolution follows the schema, not position

The parser can only treat alternating segments as hints. The resolver asks the
schema what each value is:

```text
#meta/owner
```

Here `owner` is an object field, even though it occupies a position that is
often an instance id. In a dynamic-key map, a key such as `tk-0201` is an
instance because the schema's `valuesShape` describes values under unknown
keys. See [Schema packages and resolution](03-schema-packages-and-resolution.md).

## Id rules

Ids are unique within one file. Validation reports a duplicate wherever it
appears, including nested maps.

The built-in minted prefixes are:

| Prefix | Intended use |
| --- | --- |
| `ph-` | phase |
| `tk-` | task |
| `ac-` | acceptance criterion |
| `bp-` | backpressure row |
| `lg-` | log entry |
| `dw-` | done-when assertion |

An id that starts with one of those prefixes must end in exactly four lowercase
hex digits, such as `tk-3c4d`. Other explicit ids are allowed. The custom
release corpus uses `gt-0101` and `so-0111`; their prefixes carry
domain-specific meaning rather than claiming to be built-in minted ids.

Treat every id as born once. The CLI enforces format and per-file uniqueness,
but it cannot prove that an author did not rename a previously published id.
Renaming an addressed id is a breaking change.

## Markdown targets use stable section names

The section `name` is the addressing identity. There is no separate
`section_id` field. A human-facing section title may change without moving the
address. Generated markdown emits an explicit anchor derived from `name`, not
from its display title:

```markdown
<a id="acceptance-criteria"></a>

## Acceptance criteria
```

Array instances link to the nearest section heading. Dynamic-key map entries
receive their own heading, so `#done_when/tk-0201` can land on the `tk-0201`
subsection.

## Inspecting a document's edges

`dd links` scans the current corpus and reports both directions:

```bash
node_modules/.bin/ddocs links \
  docs/how/dd/exemplar/plan.dd.json
```

The result is computed from current documents; no stored link index can drift.
The report is document-granular even when the argument includes an interior,
because each edge already carries its full address and source location.

For a repository or subtree view:

```bash
node_modules/.bin/ddocs graph \
  --path docs/how/dd/exemplar
```

The graph command returns Mermaid beginning with `flowchart LR`, plus structured
nodes and edges in JSON mode. Both commands use the same traversal engine as
the doctor sweep.
