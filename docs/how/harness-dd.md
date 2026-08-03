# Deterministic documents (`harness dd`)

A **deterministic document** is a file called `something.dd.json`. It holds structured data — rows,
fields, states, links — and beside it sits a generated `something.dd.md` that a person reads. The
JSON is the source of truth; the markdown is a *view* of it, rebuilt by a command and never edited by
hand.

The point of the split is that a question like *"is every acceptance criterion in this plan actually
proven?"* stops being something you answer by reading carefully, and becomes something you answer by
querying. Prose can say a task is done. A deterministic document can be *asked*.

This page is the deep reference. For a shorter tour that ships inside the CLI itself (no checkout, no
network), run `harness dd docs get dd-overview`.

## The envelope

Every document has the same three-part outer shape:

```json
{
  "dd": { "schema": "builder/plan" },
  "sections": [
    { "name": "meta", "value": { "title": "My plan", "status": "draft" } },
    { "name": "goals", "value": ["Ship the thing"] }
  ],
  "references": []
}
```

- **`dd`** — the header. `schema` names the schema package this document promises to obey. Two
  optional keys live here too: `spec` (a version marker) and `sweep_exclude` (see
  [Exclusions](#exclusions)).
- **`sections`** — an ordered list of named slots. A section's `value` can be anything the schema
  declares: a string, an array of rows, or an object.
- **`references`** — the *basis ledger*: which other documents this one depends on, and what they
  looked like when that dependency was last checked. See [Freshness](#freshness-the-basis-ledger).

Sections are a flat list rather than nested objects because every section needs a stable address, and
a flat list gives one without inventing a path syntax for it.

## Addresses: how one document points at part of another

An **address** names a place — a document, a section, or something inside a section:

```text
docs/plans/065/exemplar/plan.dd.json#acceptance_criteria/ac-0901
└────────────── file part ─────────┘ └──── interior part ────┘
```

The file part is a path **relative to the document doing the pointing**. The interior part starts at
`#` and then walks down, one segment at a time.

Inside its own file, a document omits the file part entirely:

```text
#evidence/tk-0201
```

That form survives a rename or a move of the file, which is why it is preferred for same-document
links.

Each interior segment is either a **section name**, a **field name**, or an **id**. Which one it is
comes from the schema, never from the segment's position — `#meta/owner` has a field where the
alternating pattern would suggest an id, and asking the shape is the only way to be right.

**Ids** are born once and never change. Minted ids look like `tk-3c4d`: a registered prefix, a hyphen,
and exactly four lowercase hex digits. The prefixes are `ph-` (phase), `tk-` (task), `ac-` (acceptance
criterion), `bp-` (backpressure row), `lg-` (log entry) and `dw-` (done-when assertion). Where a name
carries real meaning, a document may use an explicit id instead — an evidence list named for the task
that owns it, for example. Renaming an explicit id is a breaking change, exactly like renaming
anything else that other files point at.

Do not hand-write addresses. Generate them, then check them:

```bash
harness dd address generate "phases/ph-1a2b/tasks/tk-3c4d" --path docs/plan.dd.json
harness dd address validate "docs/plan.dd.json#phases/ph-1a2b" --resolve
harness dd link resolve "docs/plan.dd.json#phases/ph-1a2b"
```

## Schemas: a folder, not a header

A document names its schema; it never contains it. A **schema package** is a folder, and the
package's qualified name comes from the folder path:

```text
<gitroot>/.dd/schemas/builder/plan/schema.json     →  named "builder/plan"
```

Taking the name from the path rather than from a field inside the file means a copied package cannot
misreport its own identity.

Four locations are searched, in this order, and the first hit wins:

1. the folder holding the document itself,
2. `<gitroot>/.dd/schemas`,
3. `<gitroot>/.harness/.dd/schemas`,
4. `~/.dd/schemas`.

Every hit is recorded, not just the winner, so a package shadowed by a higher-precedence copy is
reported with its path rather than silently ignored. Two packages with the same qualified name in the
*same* root is a hard error — precedence answers the first case and nothing can answer the second.

```bash
harness dd schema list          # every resolved schema, its path, and anything it shadows
harness dd schema show builder/plan
```

A schema declares a **shape** per section. Shapes are built from `string`, `text`, `int`, `number`,
`bool`, `enum`, `state`, `link`, `array` and `object`. Two extras are worth knowing:

- **`valuesShape`** on an object declares the shape of values under keys the schema cannot know in
  advance — a map of evidence lists keyed by task id, for example. Without it, a map's interior is
  invisible to validation.
- Any other type name is a **custom type**, rendered by an adapter. See
  [Custom types](#custom-types-and-adapters).

## Completion states and the gate

A row that can be "done" carries a `state`, and the built-in vocabulary is fixed:

| State | Effect on a gate | Who may set it |
|---|---|---|
| `unchecked` | **holds** | anyone; this is the birth state |
| `checked` | passes | whoever did the work |
| `blocked` | **holds** | anyone, and it requires a `note` naming the blocker |
| `human-skipped` | passes, and stays queryable forever | **a human only**, with a receipt |
| `na` | passes, and stays queryable forever | anyone, with a `note` saying why it does not apply |

The set that lets a gate pass is `checked ∪ human-skipped ∪ na`. Validation enforces the note and
receipt rules, so a `blocked` row with no explanation is an error, not a style problem.

### The `human-skipped` receipt

`human-skipped` means a person decided this assertion would not be proven. It is the only state an
agent may never set on its own, and it is only meaningful with the person's own words recorded next
to it:

```json
{
  "id": "dw-0294",
  "assertion": "The repository-root invocation is exercised by the quality gate",
  "state": "human-skipped",
  "receipt": "left to the retro / P5 checks conversation, per the PM's ruling"
}
```

The receipt is a convention held up by validation rather than by machinery: the state is refused
without one. What it buys is that a waiver stays visible and answerable forever, instead of
dissolving into a suite that happens to pass.

A schema can also declare **its own** enums with their own passing values, because "done" is not the
only vocabulary a document might need — severity, certainty and mode are enums too.

### State is derived, never self-reported

A task does not declare that it is complete. It links to its list of done-when assertions, and its
state is computed from them: complete when every assertion has reached a passing state. That
composes across files — a task from its list, a phase from its tasks, a plan from its phases — so a
summary cannot drift from the thing it summarises. The rendered markdown shows the count it computed:

```text
| tk-0201 | Resolution fixture corpus | [x] checked | [x] 3/3 [tk-0201](#tk-0201) |
```

## Rendering

```bash
harness dd build docs/plan.dd.json           # write the .dd.md sibling
harness dd build docs/plan.dd.json --check   # report drift, write nothing
harness plan render docs/plans/065           # a whole plan: the overview AND its task files
```

The render is a pure function of the document, so the same input always produces the same bytes —
which is what makes `--check` a usable CI gate. A hand-edited `.dd.md` is caught as drift with its
own error code and regenerated by the next build.

Any dd command that *changes* a document regenerates that document's sibling for you. If the
regeneration fails, the command still succeeds and warns: the change already happened, and a stale
render is a smaller harm than a rolled-back edit.

## Freshness: the basis ledger

`references` records what a document depends on and what that dependency hashed to when it was last
verified:

```json
{
  "references": [
    { "path": "tasks/phase-2/tasks.dd.json", "sha": "a46fe6…", "mode": "live" },
    { "path": "execution-log.dd.json", "sha": "59be49…", "mode": "pinned" }
  ]
}
```

- **`live`** — "my *view* of this file must be current". Re-read at render, so cross-file summaries
  are always up to date.
- **`pinned`** — "I checked this file at this version". It moves only when someone explicitly
  re-verifies it.

Either way, a recorded sha that no longer matches is reported as a stale basis. To move one
deliberately:

```bash
harness dd link verify-basis "log.dd.json#entries" --sha <recorded> --update plan.dd.json
```

`--update` names the document whose ledger moves, because the ledger lives in the file doing the
citing, not in the file being cited.

**Keep the ledger acyclic.** If two documents each record a basis for the other, there is no set of
shas that satisfies both: pinning one changes its bytes, which invalidates the other's record of it,
and so on forever. This is rarely a real constraint, because a ledger entry means "I transclude
this", not "I mention this" — a log that cites a plan does not depend on it.

## Checking a document, and checking everything

```bash
harness dd validate docs/plan.dd.json            # this document, plus 3 hops of outbound links
harness dd validate docs/plan.dd.json --depth 0  # this document only
harness dd doctor                                # every document in the repo, at unlimited radius
harness dd doctor --path docs/plans/065          # scope the starting set to a subtree
```

`dd validate` and `dd doctor` are the same engine at different radii. Findings carry a severity:
`ERROR` fails, `WARN` is reported without failing. A missing link target is a `WARN` because "not
committed yet" is a real and recoverable state; a malformed address is an `ERROR` because nothing can
act on it.

`dd doctor` also reports what the whole corpus reveals and one document cannot: links that resolve to
a file but not to anything inside it, and adapter failures across the repository.

### Exclusions

Some documents are deliberately broken — a test corpus needs a bad example of every failure class.
Those must not redden a repository's quality gate, so the **sweep** skips three things:

- anything under a `test/**/fixtures/**` path,
- any document whose header sets `"sweep_exclude": true`,
- the harness's own gitignored scratch directory, `.harness/temp`.

Exclusions belong to the sweep and only to the sweep. Pointing `dd validate` straight at a known-bad
fixture still fails it, and pointing `dd doctor --path` *inside* an excluded directory sweeps it —
naming something explicitly means you meant it.

## Custom types and adapters

A schema may declare a type the renderer has never heard of. An **adapter** turns that value into
markdown, and it is registered by being in the right place — there is no manifest to update:

```text
<schema package>/adapters/<type-name>.ts
```

An adapter is a pure function, `(value, context) => string`. If one is missing, fails to load, throws,
or returns something that is not a string, the cell falls back to the raw value with a type tag and
the failure is reported — loudly, in the build envelope and again in `dd doctor`. A document always
renders; a degraded render never pretends to be a clean one.

The worked example, with a complete schema package and adapter, ships inside the CLI:

```bash
harness dd docs get how-to-add-a-schema
```

## Asking questions with `jq`

The reason the source of truth is JSON: every question below is answered with a stock tool and no dd
command at all.

Which acceptance criteria are not yet proven?

```bash
jq -r '.sections[] | select(.name=="acceptance_criteria").value[]
       | select(.state!="checked") | "\(.id)  \(.state)  \(.claim)"' plan.dd.json
```

Which done-when assertions have no evidence link?

```bash
jq -r '.sections[] | select(.name=="evidence").value | to_entries[]
       | .key as $task | .value[] | select(has("proven_by")|not)
       | "\($task)  \(.id)  \(.assertion)"' tasks.dd.json
```

Every waiver a human signed, with the words they used:

```bash
jq -r '.. | objects | select(.state=="human-skipped")
       | "\(.id)\t\(.receipt)"' tasks.dd.json
```

Progress for one task, computed rather than claimed:

```bash
jq -r '.sections[] | select(.name=="evidence").value["tk-0201"]
       | "\(map(select(.state as $s | ["checked","human-skipped","na"] | index($s))) | length)/\(length)"' \
  tasks.dd.json
```

Which log entries does a plan's coverage actually rest on?

```bash
jq -r '.sections[] | select(.name=="acceptance_criteria").value[]
       | select(.proven_by) | .proven_by' plan.dd.json | sort -u
```

## A worked corpus to read

`docs/plans/065-deterministic-documents/exemplar/` holds a real plan authored this way: an overview,
one task file with an evidence list per task, a coverage survey and a log — four documents that cite
each other by address. Read the generated `.dd.md` files first; they are what the design is for.

## Command reference

| Command | What it does |
|---|---|
| `harness dd validate <path> [--depth n]` | validate one document and its outbound neighbourhood |
| `harness dd build <path> [--check]` | render the `.dd.md` sibling, or report drift |
| `harness dd doctor [--path dir]` | sweep every document at unlimited radius |
| `harness dd schema list` / `show <name>` | resolved schemas, their paths, and what they shadow |
| `harness dd address generate` / `validate` | build and check an address |
| `harness dd link resolve <address>` | follow an address to what it names |
| `harness dd link verify-basis <address> --sha <sha> [--update <doc>]` | check, or move, a recorded basis |
| `harness dd links <target>` | inbound and outbound edges for a document or address |
| `harness dd graph [--path dir]` | a mermaid view of the corpus |
| `harness dd docs list` / `get <id>` | the guides baked into the CLI |
| `harness plan new <slug>` | scaffold a plan, one task file per phase |
| `harness plan validate <plan>` / `render <plan>` | the same checks across a whole plan |

Add `--json` to any of them for the machine-readable envelope.
