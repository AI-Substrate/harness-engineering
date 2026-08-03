# Workshop: W2+W10 — Completion States, Evidence & the Gate

**Type**: Data Model / State Machine (state & evidence contract)
**Plan**: 065-deterministic-documents
**Spec**: pre-plan workshop — business source `../initial-brief.md` + `../workshop-notes.md` (D2, D4, D12); consumes `001-w9-addressing.md`
**Created**: 2026-08-03T16:40+10:00
**Status**: Approved (rulings by Jordan, this session)

**Value Thesis**: "Done" becomes a computed fact instead of a self-report: per-assertion states with per-assertion evidence, and a nav gate that refuses rather than warns — so an agent must *defend* an override instead of waving past a warning.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Proof Quality**: every done-when assertion carries its own state and its own evidence link — no five-claims-one-tick bundling.
- **Agent Readiness**: refusal + `--force` converts "agents treat warnings as optional" into an auditable, defended act.
- **Safety to Change**: derived task state (all assertions terminal) cannot drift from its assertions.
- **Onboarding / Accessibility**: plans are the dd exemplar — plain primitives arranged well, every structure has an obvious human rendering.

**Related Documents**:
- `001-w9-addressing.md` — the grammar this composes on; this session adds two addenda there (bare-`#` same-doc links, explicit id override).
- `../workshop-notes.md` — D4 finalized here; W2/W10 resolved here; gate-posture handoff from W9 closed here.

---

## Purpose

Lock the shipped completion-state enum and its gate semantics, the nav-gate posture (refuse vs warn), and the done-when/evidence structure for plan tasks (W10) — including where it all lives in single- vs multi-phase plans.

## Fresh Entrant Outcome

A fresh human or agent can: read any completion state and know its gate effect and who may set it; know exactly what happens when nav leaves a gated node with incomplete items (refusal, `--force` semantics); and author a task's done-when evidence in the right place in either plan shape.

## Key Questions Addressed

1. Refuse or warn when a gate's items are incomplete? (W9 handoff)
2. The exact shipped state enum, gate-terminal set, and skip authority (W2 / D4 finalization).
3. Done-when: one text field, nested per-row list, or linked evidence section? (W10)
4. Where do tables and evidence live in single- vs multi-phase plans?

---

## Ruling 1 — The gate REFUSES, with `--force` as the defended override

- `nav set --now` off a node whose dd gate is unsatisfied **fails hard**: honest diagnostic naming the incomplete items, nothing written — the `d5Refuse` shape (refuse + diagnostic + `--force` escape).
- **Jordan's rationale (captured)**: agents take a warning as optional — which it *sometimes* is — so the design makes an agent **defend the position by reaching for `--force`**: an explicit, auditable, answerable act instead of a silent wave-past.
- `--force` is the override lever of last resort; an agent may not pass it on its own judgment (the chore-decline doctrine translated into mechanism). `human-skipped`/`na` on the *items* are the legitimate ways a gate passes without work.
- This is the repo's **first mechanical gate** — a deliberate, ruled departure from "importance never gates" (ws004 C3), which governed *advisory* chores, not computed dd gates.
- **Plan sequencing directive (Jordan)**: all builder-flow / nav-spine integration lands in the **LAST phase** of the 065 plan — dd core ships first, flow gating last.

## Ruling 2 — The shipped completion enum (defaults, not a cage)

| State | Gate effect | Who sets it |
|---|---|---|
| `unchecked` | **holds** | anyone (birth state) |
| `checked` | passes | whoever did the work (evidence per D2) |
| `blocked` | **holds** | anyone, with a note naming the blocker |
| `human-skipped` | passes; queryable forever | **human only**, receipted with verbatim words — never an agent, and `--force` is not a substitute (force moves nav past a gate once; skip waives one item) |
| `na` | passes; queryable forever | anyone, with a note ("doesn't apply") |

Gate-terminal set: `checked ∪ human-skipped ∪ na`. `unchecked`/`blocked` hold.

**Framing (Jordan, captured)**: these are the **shipped defaults for the built-in completion-state type only**. Schemas may define their own enums for **any** field — enums are general-purpose (severity, certainty, mode, …), not completion-shaped; a custom schema declares its own values and which are gate-terminal, and its adapters (W1) render them. Plain `bool` columns survive for cases with no gate semantics (D4).

## Ruling 3 — W10: the evidence-section design (task → linked per-task list)

Rejected: (a) one prose `done_when` text cell (assertions share one tick + one evidence link); (b1) dw-items nested inside the task row (tables bloat — "multiple dw under a single task row will not work"); (b2) one pooled phase-level list (severs assertion↔task ownership).

**Selected — Jordan's design**: each task row carries **one link** (`done`) to **its own evidence list**; the lists live in a dedicated **evidence section**, one list per task, **keyed by the owning task's id** (explicit id override — no minted list ids); each dw entry has its own state (Ruling 2 enum) and its own outward links (`proven_by` → log entries, `pressure` → backpressure rows, files).

```
plan.dd.json
├─ #phases/ph-3f2a/tasks         tk-9f2a │ Wire capture │ state*: ◐ 3/5 │ done → #phase-2-evidence/tk-9f2a
└─ #phase-2-evidence
     └─ tk-9f2a:                 ← "task tk-9f2a's evidence list"
          [x] dw-11c2 capture fires on commit   → lg-3301
          [x] dw-4e01 window cumulative         → lg-3307
          [x] dw-77b3 PIJ_* env captured        → lg-3311
          [ ] dw-a9c4 no secrets in payload     → bp-2e88
          [na] dw-e210 council review            (na: none here)
```

- **Task state is derived**: all dw entries gate-terminal ⇒ task completable — nothing self-reported.
- **No new primitives**: an evidence list is a completable-table (assertion · state · proven_by · pressure); the section is a collection of them. Address: `#phase-2-evidence/tk-9f2a/dw-a9c4`.
- **Exemplar constraint (Jordan, standing)**: plans are the exemplar dd usage — primitives used cleverly, structure always cleanly renderable for humans (row shows `◐ 3/5`; lists render as checklists under headings).

## Ruling 4 — File split for multi-phase plans

- **Single-phase / simple**: everything (tasks + evidence section) in `plan.dd.json`.
- **Multi-phase**: the plan doc is the overview — phases, ACs, and **one general link per phase** to its task file; the task file holds the detail:

```
plan.dd.json                              tasks/phase-2/tasks.dd.json
├─ #preamble, #acs                        ├─ #tasks       (full task table)
└─ #phases/ph-3f2a                        └─ #evidence    (one list per task)
     ├─ brief: …
     └─ tasks → tasks/phase-2/tasks.dd.json#tasks
```

- Gates compose through links (D12): task ⇐ its list, phase ⇐ its tasks, plan rollup ⇐ file links; the references ledger (W9) covers cross-file staleness.

## Grammar addenda (recorded here; swept into `001-w9-addressing.md`)

1. **Bare-`#` same-doc addresses**: a link inside its own file omits the file part — `#phase-2-evidence/tk-9f2a`. Survives file rename/move.
2. **Explicit id override**: minted short-hash ids are the default; an instance may instead carry an explicitly-named id where meaning demands it (an evidence list named by its task's id; a named section). Uniqueness-per-file and born-once semantics apply unchanged — renaming an explicit id is breaking, same as any rename (no machinery; doctor + scripts). **Jordan flags this as a broader-than-this-workshop change — the plan pass must sweep it across schema design and validation rules.**

---

## Decision Space

| Option | Decision | Why |
|---|---|---|
| Warn-only gate | **Rejected** | agents read warnings as optional; the computed gate would be advisory to the party most likely to skip it |
| Refuse on spine-departure only | **Rejected** | partial posture; refusal is the point |
| **Refuse + `--force`** | **Selected** | defended, auditable override; d5Refuse shape exists |
| done_when as text (a) | **Rejected** | 3–8 claims share one tick + one link |
| dw nested in task row (b1) | **Rejected** | table bloat; "won't work" |
| pooled phase list (b2) | **Rejected** | severs assertion↔task ownership |
| **Evidence section, per-task lists keyed by task id** | **Selected** | lean tables + per-assertion proof + intact ownership |
| 4-state enum | **Amended** | `na` added — "doesn't apply" ≠ "human waived real work" |

## Attention Reduction

| Future Loop | Before | After |
|---|---|---|
| Gate integrity | agent waves past a warning silently | refusal; override = explicit `--force` on the record |
| Evidence attach | one link per task, claims bundled | one link per assertion, unproven ones visible |
| Review | "checked" = trust-me-times-five | derived states; reviewers check assertions, not vibes |
| Plan authoring | done-when prose invented per plan | one exemplar structure, both plan shapes specified |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|---|---|---|---|
| State table (enum, gate effects, authority) | § Ruling 2 | vocabulary lock | Ready |
| Evidence-section ASCII (both shapes) | §§ Ruling 3–4 | W10 structure | Ready |
| Decision space | § Decision Space | rejected options stay rejected | Ready |
| Grammar addenda | § addenda | W9 sweep | Ready |

## Validation / Acceptance

- Every ruling traces to a verbatim Jordan lock this session. ✓
- W2, W10, and the W9 gate-posture handoff are all closed; D4's vocabulary is final. ✓
- Handed to the plan pass: id-override sweep (schema design + validation rules); id-prefix registry; ledger field naming; builder-flow integration as the last phase.

## Open Questions

None. Remaining pre-plan workshops: W1 (adapter shape confirm) and W3 (log entry shape confirm) — both direction-ruled, small confirmations only.
