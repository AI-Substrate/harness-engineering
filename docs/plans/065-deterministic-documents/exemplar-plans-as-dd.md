# Exemplar: composing a plan as a Deterministic Document

*(2026-08-03, from the Jordan ↔ silkworm session. Grounded in a real recent plan — 063 systemic-telemetry-repair — as the "before" shape. This is the first exemplar implementation target for the DD concept: plans, focusing on phases.)*

## What a plan phase looks like today (063 as specimen)

Each phase in `docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md` is two shapes glued together in markdown:

1. **A header block of named fields** — Objective, Domain, Delivers, Depends on, Key risks — that is really a record, but stored as bold-label prose.
2. **A task table** whose "Success Criteria" cell crams several distinct assertions into one prose string, and whose "Notes" cell carries AC references (`AC-06, AC-08`) as untyped text that nothing can verify or traverse.

There is also a hand-maintained **Phase Index** table that duplicates the phase headers and can silently drift from them.

## The same plan as a `.dd.json`

- A couple of **free-text sections** up front (context, objective) — id-less prose, per D13.
- An **AC section**: a completable-table whose rows carry born-once ids (`ac-4b1c`), a completion **state** (not a boolean, per D4), and the two signpost links per D2: `pressure` → backpressure DD section (prescriptive) and `proven_by` → execution-log DD entry (demonstrative).
- A **repeating phase group**, one per phase:
  - a **`record` section** for the header fields — with `depends_on` as a *typed link to the sibling phase's stable address*, not the string "Phase 1";
  - a **`completable-table` of tasks**, each row with a born-once id (`t-2.3` becomes something like `tk-9f2a`), a state from the D4 vocabulary, and typed link columns:
    - `implements` → an AC row in this plan's own AC table,
    - `pressure` → a section in the backpressure DD,
    - `proven_by` → entries in the execution-log DD (append-only, per D3).
- The **Phase Index stops being hand-maintained** — it is exactly the kind of view `dd build` derives from the phase sections, so it can never drift from them.

## Schema sketch (shape illustrative; grammar is W9's to lock)

Per **D14**, this schema does not live inside the plan document. It is a named package —
`builder/plan` — resolved from `.dd/schemas/builder/plan/`; the plan's `.dd.json` only
*names* it. What follows is the content of that schema file, not a block inside the plan.

```jsonc
{
  "schema": "builder/plan",
  "description": "A builder plan: context, acceptance criteria, and repeating phases.",
  "sections": [
    { "id": "context", "type": "free-text" },
    { "id": "acceptance-criteria", "type": "completable-table",
      "columns": {
        "criterion":  { "type": "text" },
        "state":      { "type": "state" },
        "pressure":   { "type": "link", "target": "section@backpressure.dd", "cardinality": "0..1" },
        "proven_by":  { "type": "link", "target": "row@execution-log.dd",   "cardinality": "0..n" }
      }
    },
    { "id-convention": "plan-phase", "repeat": true, "children": [
      { "type": "record",
        "fields": {
          "objective":  { "type": "text" },
          "domain":     { "type": "enum", "values": ["harness-cli", "repo-engineering-substrate"] },
          "depends_on": { "type": "link", "target": "section@self", "cardinality": "0..n" },
          "risks":      { "type": "text" }
        }
      },
      { "type": "completable-table", "id-suffix": "tasks",
        "columns": {
          "task":       { "type": "text" },
          "done_when":  { "type": "text" },            // ← W10: text vs nested completable-list
          "state":      { "type": "state" },
          "implements": { "type": "link", "target": "row@self#acceptance-criteria", "cardinality": "0..n" },
          "pressure":   { "type": "link", "target": "section@backpressure.dd", "cardinality": "0..1" },
          "proven_by":  { "type": "link", "target": "row@execution-log.dd", "cardinality": "0..n" }
        }
      }
    ]}
  ]
}
```

The plan document itself then carries only the reference and its data:

```jsonc
{ "dd": { "schema": "builder/plan", "spec": "dd@1" }, "sections": { /* … data … */ } }
```

The schema names each section's primitive, its convention-derived address stem (`plan-phase.phase-2.tasks`), and — for every link column — the **target shape and cardinality**. That is what lets `dd validate` check the graph mechanically, and what lets the flow spine gate a nav node on "all rows in `plan-phase.phase-2.tasks` reach a terminal state" without parsing any prose (D5, D12: the gate is *computed from* knowledge, never copied into the workflow).

## The design pressure this exemplar exposes

**W10** — 063's "Success Criteria" cells are really 3–8 distinct assertions per task. Is `done_when` one text field (cheap, matches today) or a nested completable-list per row (each assertion individually checkable, provable, linkable to its own evidence)? The answer decides how fine-grained backpressure evidence can attach. Not ruled; queued in `workshop-notes.md` § W10.
