# Deterministic documents

It renders like a regular markdown doc — headings, tables, links, progress
marks — and that's what your teammates (and GitHub) see. Under the hood it's
a **typed, addressable graph**. Every list is data. Every row has a
permanent id you can link to from any other doc. Every link is a typed edge
a tool can walk. Ask "which acceptance criteria still hold the gate?" and
you get rows back, with ids. Markdown on the surface, a queryable proof
graph underneath.

A deterministic document is structured JSON (`note.dd.json`) with a declared
schema. Beside it lives a generated `.dd.md` sibling:

```text
note.dd.json  source of truth for tools
note.dd.md    generated view for people
```

Edit through the CLI (`dd set/add/rm`) and the sibling regenerates in the
same operation — you never think about it. `node_modules/.bin/ddocs build` exists for the
other cases: you hand-edited the JSON, you just created a new file, or CI is
running `dd build --check` as the drift gate.

## Why this is different

### Lists are data

A task table's rows each carry a born-once id, a completion state from a
declared vocabulary, and schema-validated fields.

From [`exemplar/tasks/phase-2/tasks.dd.json`](exemplar/tasks/phase-2/tasks.dd.json):

```json
{
  "id": "tk-0201",
  "title": "Resolution fixture corpus covering every schema-layer failure class",
  "phase": "ph-0002",
  "state": "checked",
  "done": "#done_when/tk-0201"
}
```

That `state` came from a vocabulary the schema declares, and `done` is a
link to this task's own `done_when` list — not a checkbox someone typed.

And the generated sibling is a markdown document, after all — that same row
renders like this (columns trimmed):

| id | title | state | done |
| --- | --- | --- | --- |
| tk-0201 | Resolution fixture corpus ... | [x] checked | [x] 3/3 [tk-0201](exemplar/tasks/phase-2/tasks.dd.md#tk-0201) |

The `done` cell is derived — three of three assertions in the evidence list
it points at are checked, counted at render time, and the cell links to
them. Nobody maintains that number.

### Everything has an address

`plan.dd.json#acceptance_criteria/ac-0201/state` names one field of one row,
forever. Docs cite each other's rows by address; renames and reorders don't
break it.

```bash
node_modules/.bin/ddocs get docs/how/dd/exemplar/plan.dd.json#acceptance_criteria/ac-0201/state
# → "checked"
```

And because an address is just a value, any field can reference any row in
any document. A task in one file citing the acceptance criterion it serves
in another:

```json
{
  "id": "tk-7142",
  "title": "5 tasks authors task file + phase-row link in one stroke",
  "satisfies": ["../../../plan.dd.json#acceptance_criteria/ac-7111"]
}
```

That's a relative path to a different document, then `#` into one row of one
section. The validator resolves it, the graph walks it, and the rendered
sibling turns it into a clickable link.

Stable addresses are what everything else builds on: a UI can deep-link a
dashboard straight to one failing row, a workflow gate can watch
`#tasks/tk-7142/state` and refuse to advance until it flips, a bot can
comment on a PR with the exact rows that block it. Anything that can hold a
string can point at one precise piece of one document — and be pointed at.

### Links are typed edges

A task `satisfies` an acceptance criterion; an assertion's `pressure` names
the instrument that measures it; `proven_by` points at the log entry that
demonstrates it. "What proves this claim?" is one `node_modules/.bin/ddocs graph` walk.

A real acceptance criterion from [`exemplar/plan.dd.json`](exemplar/plan.dd.json):

```json
{
  "id": "ac-0201",
  "claim": "A schema named `builder/plan` resolves doc-folder -> <gitroot>/.dd -> ...",
  "state": "checked",
  "pressure": "backpressure.dd.json#rows/bp-0201",
  "proven_by": "execution-log.dd.json#entries/lg-0201"
}
```

And rendered, those links are just links — the same row in the generated
sibling (columns trimmed):

| id | claim | state | pressure | proven_by |
| --- | --- | --- | --- | --- |
| ac-0201 | A schema named `builder/plan` resolves doc-folder -> ... | [x] checked | [bp-0201](exemplar/backpressure.dd.md#rows) | [lg-0201](exemplar/execution-log.dd.md#entries) |

The claim, how it's measured, and where it was demonstrated — three
documents, one traversal (`just graph-ac` runs it), and a human just clicks
through.

### Gates you can't sweet-talk

State is data, so gates refuse mechanically: `harness plan validate
--complete` goes green at exactly zero open items and nothing else. A
refusal names every unfinished row by id. Forcing past one is an explicit,
recorded override.

Mid-flight output from this repo's own plan:

```text
35 of 88 completable item(s) are still open — run with --complete for the
per-row list, or --address <address> to scope the read.
```

### Validation pushes back

Schemas are data, ids follow a grammar, required sections are enforced, and
contradictions surface as findings. `node_modules/.bin/ddocs doctor` sweeps the whole
repo and answers 0/0 or a named list.

A real contradiction warning, caught the day this feature shipped — a task
ticked over a criterion that wasn't:

```text
tk-7027 (Synthetic corpus factory + lifecycle-mutation suites) is "checked"
but satisfies ac-7009 (Check-kind gate: ...), which is still "unchecked"
```

### The rendered view can't drift

The `.dd.md` sibling regenerates on every CLI write; hand-edits owe a
`dd build`, and drift between source and view fails CI:

```bash
node_modules/.bin/ddocs build note.dd.json --check
# stale sibling → E422 DD_RENDER_DRIFT, exit 1
```

### Citations know when they're stale

The basis ledger records the SHA-256 of whatever a conclusion was checked
against. Target moves, the citation goes visibly stale (E434) until someone
re-reads and re-records it.

From [`exemplar/plan.dd.json`](exemplar/plan.dd.json)'s ledger:

```json
{
  "path": "tasks/phase-2/tasks.dd.json",
  "sha": "826906f58e22f12668695cb8321aff96dda51df40d9e67badebd2b6bb0b9d34c",
  "mode": "live"
}
```

### The CLI does the writing

`node_modules/.bin/ddocs get/set/add/rm` validate before the write, rebuild the sibling
in the same op, and mint collision-free ids (`add --mint`). A refusal writes
nothing.

```bash
node_modules/.bin/ddocs set "backpressure.dd.json#rows/bp-7106/probe" "npx vitest run ..."
# validates the result against the schema, writes source + sibling together
```

Feed it something the schema refuses and you get a named error and an
untouched file:

```text
E451: the change would make tasks.dd.json invalid: value must be an array
```

You can still lie to it — but lying means fabricating rows in a diffable
file with your evidence one click away at review time.

## Where this goes next

Once state, addresses, and typed edges are substrate, more of engineering
stops being prose. Two that are already on the roadmap (plan 071, phase 3):

- **Fences as data.** An agent's dispatch fence — which paths it may touch,
  who owns the grant, why it exists, when it expires — as rows in a fence
  document, with a mechanical check that refuses an out-of-fence change by
  naming the offending path and the fence row. Fence violations stop being
  something a reviewer has to notice.
- **Reviews as documents.** Findings as rows with severity and a repo
  address, the verdict linking every finding confirmed / refuted / fixed,
  and each planted-bad control carrying a `pressure` link to the fixture
  that fired. Review history becomes something you can query across
  reviews — and across models.

Same trick both times: take a thing agents and humans currently keep honest
by discipline, and give it rows.

## Smallest self-contained example

A document needs a schema package. Put both under one directory:

```text
example/
├── note.dd.json
└── schemas/
    └── example/
        └── note/
            └── schema.json
```

`example/schemas/example/note/schema.json`:

```json
{
  "dd_schema": 1,
  "description": "A small deterministic note.",
  "sections": {
    "meta": {
      "required": true,
      "shape": {
        "type": "object",
        "required": ["title"],
        "fields": {
          "title": { "type": "string" }
        }
      }
    }
  }
}
```

`example/note.dd.json`:

```json
{
  "dd": {
    "schema": "example/note"
  },
  "sections": [
    {
      "name": "meta",
      "value": {
        "title": "Release note"
      }
    }
  ],
  "references": []
}
```

From the repository root:

```bash
node_modules/.bin/ddocs validate example/note.dd.json --depth 0
node_modules/.bin/ddocs build example/note.dd.json
node_modules/.bin/ddocs build example/note.dd.json --check
```

The generated view is:

```markdown
<!-- GENERATED by `node_modules/.bin/ddocs build` — do not hand-edit; regenerate from the .dd.json. -->
# Release note

**Schema**: example/note · **Source**: note.dd.json · **Sections**: 1

<a id="meta"></a>

## Meta

| Field | Value |
| --- | --- |
| title | Release note |
```

This example was validated and rendered with the shipped CLI. The schema
resolves from the document's own folder; no registry entry is required.

## Read progressively

| Chapter | Purpose |
| --- | --- |
| [01 - The document envelope](01-the-document-envelope.md) | the fields every `.dd.json` carries |
| [02 - Addresses and links](02-addresses-and-links.md) | stable names for documents, sections, parts, and instances |
| [03 - Schema packages and resolution](03-schema-packages-and-resolution.md) | folder convention, precedence, shapes, and dynamic maps |
| [04 - Completion states and gates](04-completion-states-and-gates.md) | built-in and custom state vocabularies, derived summaries, and FU-5 |
| [05 - Generated markdown](05-generated-markdown.md) | canonical rendering, titles, anchors, tables, marks, and drift |
| [06 - Custom types and adapters](06-custom-types-and-adapters.md) | presentation extensions and loud fallback behavior |
| [07 - Freshness and the basis ledger](07-freshness-and-the-basis-ledger.md) | live and pinned dependencies, SHA checks, and re-verification |
| [08 - Validation and doctor](08-validation-and-doctor.md) | focused validation, repository sweeps, exclusions, and cwd defects |
| [09 - Querying with jq](09-querying-with-jq.md) | copyable questions over real documents |
| [10 - Command reference](10-command-reference.md) | the complete `dd` command family |
| [11 - The builder proof graph](11-the-builder-proof-graph.md) | what the mechanisms add up to: the work/knowledge graph join |
| [Is this plan ready to start work on?](plan-ready.md) | the three-valued readiness verdict, and why it refuses to judge an empty plan |

## Run the examples

A worked corpus sits in [`exemplar/`](exemplar/), and a `justfile` beside it
turns every example in these pages into something you can run:

```bash
cd docs/how/dd
just                 # list every example
just graph-ac        # what flows in and out of one acceptance-criteria row
just graph-truncated # the same row, bounded, showing the truncation warning
just mermaid         # the whole corpus as a diagram (stdout is only the diagram)
just validate        # validate a document and everything it links to
just doctor          # sweep every dd document in the repository
just q-open          # jq: which acceptance criteria still hold the gate?
just fu4             # the open cwd defect, demonstrated in three commands
```

Every recipe changes to the repository root before running, so they work from
this folder despite the defect described below. You never have to remember it.

The corpus itself:

| | |
| --- | --- |
| [`exemplar/plan.dd.json`](exemplar/plan.dd.json) | a real plan, with acceptance criteria linked to their pressure and proof |
| [`exemplar/backpressure.dd.json`](exemplar/backpressure.dd.json) | the coverage survey those criteria point at |
| [`exemplar/execution-log.dd.json`](exemplar/execution-log.dd.json) | the log entries that prove them |
| [`exemplar/tasks/phase-2/`](exemplar/tasks/phase-2/) | one phase's tasks, each with its own evidence list |
| [`exemplar/custom-render/`](exemplar/custom-render/) | a **fully self-contained** corpus — its own schema, its own adapters, its own completion vocabulary |

## Current operating rule

Run dd commands from the repository root. Open defect FU-4 currently derives
the repository root from the process working directory, which can change schema
resolution and path-containment verdicts. The exact reproduction is in
[Validation and doctor](08-validation-and-doctor.md#known-cwd-defect).

For guidance compiled into the CLI:

```bash
node_modules/.bin/ddocs docs list
node_modules/.bin/ddocs docs get dd-overview
node_modules/.bin/ddocs docs get how-to-add-a-schema
```
