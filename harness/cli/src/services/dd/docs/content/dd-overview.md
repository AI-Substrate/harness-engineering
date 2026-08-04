# Deterministic documents (dd)

A **deterministic document** is a `.dd.json` file: structured data with a schema, addressable
parts, and per-assertion state. The `.dd.md` beside it is *generated* — humans read the markdown,
tools read the JSON, and neither has to trust prose.

## The envelope

```json
{
  "dd": { "schema": "builder/plan" },
  "sections": [
    { "name": "meta", "value": { "title": "Deterministic documents" } },
    { "name": "tasks", "value": [ { "id": "tk-9f2a", "state": "checked" } ] }
  ],
  "references": []
}
```

- **`dd.schema`** — the qualified `<pkg>/<schema>` name, resolved by convention (see below).
- **`dd.sweep_exclude`** — optional; asks the doctor's repo-wide sweep to skip this file. It is
  *never* honoured by a direct `dd validate <path>`: pointing the verb at a document always
  validates it.
- **`sections`** — a flat, ordered list of named slots. Each section's `value` is shaped by the
  schema; nothing is implicit.
- **`references`** — the basis ledger: `{ path, sha, mode }` per referenced document, where
  `mode` is `live` (recomputed) or `pinned` (moves only on an explicit re-verify).

## Ids and addresses

An element earns an **id** when it carries state or is a link target. Minted ids use a
registered prefix and four lowercase hex digits — `ph-`, `tk-`, `ac-`, `bp-`, `lg-`, `dw-`, e.g.
`tk-9f2a`. Ids are born once and are unique per file. An instance may instead carry an
*explicitly named* id where meaning demands it (a `done_when` assertion list named for the task
it belongs to); the same born-once and uniqueness rules apply.

Addresses are `file#name/id/name/id…` — one `#`, then alternating names and ids:

```
docs/plans/065/tasks/phase-2/tasks.dd.json#tasks/tk-9f2a
#done_when/tk-9f2a/dw-a9c4             ← bare "#": same document, survives a rename
```

## Completion states and the gate

The built-in completion enum, and what each state does to a gate:

| State | Gate | Who sets it |
|---|---|---|
| `unchecked` | holds | anyone (birth state) |
| `checked` | passes | whoever did the work, with evidence |
| `blocked` | holds | anyone, **note required** naming the blocker |
| `human-skipped` | passes | **a human only**, with a receipt carrying their verbatim words |
| `na` | passes | anyone, **note required** ("doesn't apply") |

Gate-terminal by default: `checked ∪ human-skipped ∪ na`. A schema may declare its own enums —
with their own `gate_terminal` sets — for any field, so "done" means what that schema says it
means, not what a hard-coded list says.

A task's completion **summary** is derived: it reads gate-terminal when every one of its
`done_when` assertions is. That summary is computed, never typed.

An explicit `state` field on the task itself is a **separate claim, and is not reconciled
against the assertions it points at** — a task may say `checked` while its `done_when` list says
`unchecked`, and `dd validate` will not object (`harness plan validate` does, as a contradiction). When the two disagree, trust the derived summary:
it is the one backed by rows. Prefer not to store both as competing authorities.

## Schema resolution

A qualified name resolves by deep scan through four roots, first hit wins:

1. the document's own folder
2. `<gitroot>/.dd`
3. `<gitroot>/.harness/.dd`
4. `~/.dd`

Every hit is recorded: a duplicate name **inside one root** is a hard error (nothing can
arbitrate it), while the same name in a lower-precedence root is a shadow — reported as a
warning, with its path, by `dd schema list` and `dd schema show`. Local override is the feature;
silently forking validation is not.

## The CLI

```bash
harness dd validate <path> [--depth <n>]   # default depth 3: this doc, its links, their health
harness dd schema list                     # every resolvable schema + shadowed duplicates
harness dd schema show <pkg>/<schema>      # one schema, its path, enums, gate-terminal set
harness dd docs list                       # this documentation, baked into the CLI
harness dd docs get <id>
```

`dd validate` exits `0` when clean, `0` with a `degraded` envelope when only WARN-class findings
exist, and `1` with an `error` envelope naming the first ERROR-class finding. Every finding
carries its class, severity, location, and the **owner** — the document that must change to fix
it, which is not always the one you ran the command on.

## Reading it with jq

```bash
jq -r '.sections[] | select(.name=="tasks") | .value[] | "\(.id) \(.state)"' plan.dd.json
harness dd validate plan.dd.json --json | jq '.data.issues[] | {code, location, owner}'
harness dd schema list --json | jq -r '.data.schemas[] | "\(.name)\t\(.path)"'
```

## Going deeper

This page is the tour. The full reference — the address grammar in detail, the schema-package
convention, the completion states and the `human-skipped` receipt convention, the basis ledger,
the sweep's exclusion contract, and a page of jq recipes — lives in the repository at
`docs/how/dd/` — a progressive reference, starting at `docs/how/dd/README.md`. A worked corpus
sits in `docs/how/dd/exemplar/`, including a fully self-contained one
with its own schema and adapters in `exemplar/custom-render/`.
