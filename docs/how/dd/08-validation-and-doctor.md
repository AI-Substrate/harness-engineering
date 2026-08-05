# Validation and doctor

`dd validate` answers a focused question about one document and its outbound
neighborhood. `dd doctor` answers a repository question by sweeping a corpus at
unlimited radius.

## Validate one document

From the repository root:

```bash
harness dd validate \
  docs/how/dd/exemplar/plan.dd.json \
  --depth 3
```

The default depth is `3`.

| Depth | Documents validated |
| --- | --- |
| `0` | the named document only |
| `1` | the named document and direct outbound targets |
| `2` | one additional outbound hop |
| `3` | the default three-hop neighborhood |

Traversal is breadth-first and loop-safe. Every reached document is validated
at depth zero even when no further edges are followed.

Direct validation never honors sweep exclusions. If you name a known-bad
fixture or a document with `sweep_exclude: true`, the command validates it.

## Findings and status

Every finding carries:

- a stable code and class;
- `ERROR` or `WARN` severity;
- a document location;
- an `owner`, which is the document that must change;
- a message and next action in the CLI envelope.

Status behavior:

| Findings | Envelope | Exit |
| --- | --- | --- |
| none | `ok` | `0` |
| warnings only | `degraded` | `0` |
| any error | `error` | `1` |

Examples of warnings include stale bases, missing or untracked targets, path
style problems, and paths that appear to escape the repository boundary.
Malformed addresses, invalid shapes, unresolved schemas, bad enums, duplicate
ids, missing state notes or receipts, and link type mismatches are errors.

## Sweep the corpus

```bash
harness dd doctor
```

Scope the starting set:

```bash
harness dd doctor \
  --path docs/how/dd/exemplar
```

The exemplar sweep discovers and checks five documents cleanly. `--path`
controls which documents seed the sweep; links from those documents can still
reach targets outside the subtree because the validation radius remains
unlimited.

The doctor adds corpus-level checks:

- document enumeration failures;
- interiors that name a missing section, id, or part;
- adapter load and runtime problems;
- findings reached anywhere in connected outbound components.

Warnings are reported but do not fail the doctor gate. Any error produces an
error envelope.

## Sweep exclusions

The repository sweep excludes:

- documents beneath a `test/**/fixtures/**` path;
- documents whose header sets `"sweep_exclude": true`;
- `.harness/temp` when the scan encounters that positional scratch path from
  above.

The first two exclusions remain exclusions during a doctor sweep even when its
subtree includes them. Use direct `dd validate <path>` when you intend to inspect
one of those documents. The old single-page guide claimed an explicitly scoped
doctor would sweep them; that documentation defect is FU-6.

The `.harness/temp` rule is positional. Pointing `dd doctor --path` inside that
scratch directory permits enumeration there, after which document-level fixture
and `sweep_exclude` rules still apply.

## Build and drift checking

```bash
harness dd build path/to/document.dd.json
harness dd build path/to/document.dd.json --check
```

The first command writes the sibling `.dd.md`. The second renders in memory and
compares bytes without writing. A clean comparison reports `drift: false`.

Adapter warnings produce a degraded render rather than preventing output. See
[Custom types and adapters](06-custom-types-and-adapters.md).

## Known cwd defect

Today `dd build`, `dd validate`, and the link-consuming commands take the
repository root from the current working directory. The documented
`<repository-root>/.dd` discovery root and containment boundary therefore mean
`cwd/.dd` and `cwd`.

The same unchanged custom-render document produces three results:

| Current working directory | Result |
| --- | --- |
| repository root | `ok`, 0 errors, 0 warnings |
| the document's folder | `degraded`, 5 `address-path-escape` warnings |
| the document's parent | `error`, `E401` for linked `builder/*` schemas |

The document-local `release/gate` schema still resolves in all three cases.
What changes is the repository discovery root and containment boundary used for
cross-file links.

**Practical rule:** run dd build, validation, schema, link, graph, and doctor
commands from the repository root.

This is open defect FU-4 in
[`docs/plans/065-deterministic-documents/follow-ups.md`](../../plans/065-deterministic-documents/follow-ups.md).
FU-4a separately covers `schema list` lacking a document-folder root.

For the three enforcement tiers — how these mechanisms add up to an auditable claim — see
[The builder proof graph](11-the-builder-proof-graph.md).
