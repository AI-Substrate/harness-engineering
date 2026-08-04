# Command reference

Run dd commands from the repository root because of
[known cwd defect FU-4](08-validation-and-doctor.md#known-cwd-defect).

Add `--json` for a machine-readable envelope. On a human terminal, commands
with dedicated human renderers print readable text or markdown.

## Validate and render

| Command | Effect |
| --- | --- |
| `harness dd validate <path>` | validate a document and three outbound hops |
| `harness dd validate <path> --depth 0` | validate only the named document |
| `harness dd validate <path> --depth <n>` | validate the named outbound radius |
| `harness dd build <path>` | write the canonical `.dd.md` sibling |
| `harness dd build <path> --check` | compare the canonical render without writing |
| `harness dd doctor` | sweep the repository at unlimited radius |
| `harness dd doctor --path <dir>` | scope the sweep's starting set |

`validate` returns `ok`, `degraded` for warnings only, or `error` when any
ERROR-class finding exists. `doctor` follows the same severity posture.

`build` can return `degraded` while still writing output when an adapter fails.
The affected values use an explicit raw fallback.

## Inspect schemas

| Command | Effect |
| --- | --- |
| `harness dd schema list` | list winning repository, harness, and home schemas |
| `harness dd schema show <package>/<schema>` | show one resolved package in detail |

`schema list` cannot include a document-folder root because it accepts no
document path. Validate a document to prove its local package resolves.

## Generate and validate addresses

| Command | Effect |
| --- | --- |
| `harness dd address generate <interior>` | generate a bare same-document address |
| `harness dd address generate <interior> --path <file>` | generate a qualified address |
| `harness dd address validate <address>` | check syntax and normalization |
| `harness dd address validate <address> --resolve` | resolve and classify every segment |

Example:

```bash
harness dd address generate \
  "phases/ph-0002/tasks" \
  --path docs/how/dd/exemplar/plan.dd.json
```

Bare addresses cannot resolve at the command line without a containing
document. Use `<path>#<interior>` with `--resolve`.

## Resolve links and bases

| Command | Effect |
| --- | --- |
| `harness dd link resolve <address>` | return the addressed value and target metadata |
| `harness dd link verify-basis <address> --sha <sha>` | compare a recorded SHA with the target |
| `harness dd link verify-basis <address> --sha <sha> --update <doc>` | move an existing ledger entry and regenerate its sibling |

`verify-basis` returns `fresh` or `stale`. Stale is a degraded result rather
than a failing result.

`--update` mutates the document named by the option. It never creates a missing
ledger entry.

## Inspect the corpus graph

| Command | Effect |
| --- | --- |
| `harness dd links <target>` | report inbound and outbound edges for one document |
| `harness dd graph` | return the repository graph as Mermaid and structured data |
| `harness dd graph --path <dir>` | seed the graph from a subtree |

`dd links` accepts a document path or a qualified address, but reports edges at
document granularity.

## Read baked guidance

| Command | Effect |
| --- | --- |
| `harness dd docs list` | list documentation compiled into the CLI |
| `harness dd docs get dd-overview` | print the built-in overview |
| `harness dd docs get how-to-add-a-schema` | print the schema and adapter guide |

In human mode, `docs get` prints markdown directly. In JSON mode, the markdown
is returned in `data.content`.

## JSON envelope examples

Validation counts:

```bash
harness dd validate path/to/document.dd.json --json \
  | jq '{status, counts: .data.counts}'
```

Resolved schema paths:

```bash
harness dd schema list --json \
  | jq -r '.data.schemas[] | "\(.name)\t\(.path)"'
```

Graph size:

```bash
harness dd graph --path path/to/corpus --json \
  | jq '.data.counts'
```
