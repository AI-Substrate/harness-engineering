# Workshop: The `harness flow` CLI Surface

**Type**: CLI Flow
**Plan**: 024-first-class-flow-system
**Spec**: [first-class-flow-system-plan.md](../first-class-flow-system-plan.md) · § Business Specification
**Created**: 2026-06-17
**Status**: Approved

**Value Thesis**: Pin the *entire* `harness flow` verb/flag surface — every command, argument, flag, output shape, and error code — so Phase 1 builds to a fixed contract instead of inventing it task-by-task, and so the consumer skills (`the-flow`, `eng-harness-flow`) know exactly what they call. This is the build-prerequisite that removes verb-naming ambiguity from the foundation phase.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Implementation Readiness**: Phase 1 tasks 1.6/1.7/1.9 (the act + service wiring) can be built directly from this surface — verb names, flags, and envelope fields are no longer "proposed".
- **Agent Readiness**: `the-flow`'s migration (Phase 3) replaces each hand-crank prose step with a named command; the mapping is one-to-one and explicit here.
- **Safety to Change (contract stability)**: The surface is designed to be **additive-only** and to never reshape the byte-stable `--hook/--event/--hooks/--json` contract the consumers mirror (CD-02).
- **Review Compression**: A reviewer can check Phase 1/3 against one command table instead of reconstructing the intended CLI from scattered tasks.
- **Cost / Attention Reduction**: Settles the four open CLI questions from the plan (`Workshop Opportunities`) once, so they aren't re-litigated during implementation.

**Related Documents**:
- [research-dossier.md](../research-dossier.md) § *The harness CLI: how the `harness flow` verb family slots in* (CLI-01..CLI-12)
- Sibling workshop (next): **002 — event + comment taxonomy** (pins event *kinds* + duck-typing rules; this workshop pins only the verb *shape* of `flow event` / `flow comment`)

**Domain Context**:
- **Primary Domain**: harness-cli · flow (the new `acts/flow.ts` + `services/flow/*`)
- **Related Domains**: harness-cli · output (Envelope, error-codes), the-flow + eng-harness-flow (consumers)

---

## Purpose

Decide and document the complete `harness flow` command-line surface. Drives Phase 1 (the engine + verbs), Phase 3 (the-flow's hand-crank → CLI mapping), and the `E3xx` error block. After this workshop, the verb names and flag sets in the plan's Phase 1/2 task tables stop being "proposed" and become the contract — folded back into `### Clarifications` on the next `plan` pass.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Contract Ready** with no additional context. They should be able to:

- Enumerate every `harness flow` subcommand, its arguments, and its flags without reading the source.
- Know exactly which command replaces each hand-cranked mutation `the-flow` does today.
- Predict the Envelope `data` fields, exit code, and error code for each command's success and failure paths.
- Locate a flow file and resolve a schema using the documented precedence rules.

## Key Questions Addressed

1. **Single `flow` act + subcommands, or multiple top-level acts?** → Single core `flow` act with a Commander subcommand group.
2. **`create` vs `new` semantics?** → `new` authors a flow *type* (schema); `create` instantiates a flow *instance* — consistent with the existing `harness new`.
3. **Mutation granularity — fine-grained atomic verbs or a coarse `advance`?** → Fine-grained atomic primitives; the CLI provides primitives, the prose Graph keeps the "what's next" policy.
4. **Path / redirect flags — how is a flow file (and a schema) located?** → Documented `--path` › `--plan-dir` › discovery precedence, with `isWithin` containment.

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | Phase 1 needs a fixed verb/flag/envelope contract to build to; Implementation Ready is the *code's* job, not the workshop's |
| Primary Value Axis | Implementation Readiness | The surface directly seeds the Phase 1 act/service tasks |
| Supporting Value Axes | Agent Readiness · Safety to Change · Review Compression | Consumer migration mapping; additive-only contract; one-table review |
| Downstream Loop Improved | Implementation (Phase 1) + Migration (Phase 3) | Verb ambiguity removed before code; hand-crank→CLI mapping made explicit |

## Decision Space

### D1 — Single `flow` act + subcommands vs. multiple top-level acts

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A — single `flow` act, subcommand group** | `harness flow <sub> …` via one Commander command with children | Cohesive (one `services/flow/*` domain); `harness flow --help` lists the whole family; matches the plan's Domain Manifest (`acts/flow.ts` = one dispatcher); one reserved core name | Introduces the **first nested subcommand group** in this CLI (all existing acts are flat top-level commands) | **Selected** |
| B — many top-level acts | `harness flow-create`, `harness flow-render`, … | Stays "flat" like today's acts | Namespace pollution; 10+ reserved names; no single discovery point; fragments one domain across many acts | Rejected |

> **Why this format**: `flow` is a *family* of ~12 verbs over one data model — exactly the case Commander's nested commands exist for. This is a deliberate, contained extension of the act pattern: `flow` is the only act with children; everything below it is still `act → service → Envelope`, no business logic in the act (`acts/flow.ts` dispatches; `services/flow/*` does the work). All existing acts (`record`, `new`, `observe`, `doctor`, …) remain flat.

### D2 — `create` vs `new` semantics (grounded in existing precedent)

| Verb | Means | Existing precedent | Produces |
|------|-------|--------------------|----------|
| `harness flow new <type>` | Author a **new flow type** (a reusable schema template) | `harness new <name>` already = scaffold a reusable *extension* | `.harness/schemas/flows/<type>.schema.json` (a schema to fill in) |
| `harness flow create <type>` | Instantiate a **flow instance** of a type | `harness record <type>` = instantiate a record from a type | a flow JSON (e.g. `docs/plans/<slug>/the-flow.json`) |

> **Why this format**: the repo already overloads `new` to mean "scaffold a reusable type" (`harness new` makes an extension). Re-using that verb for "scaffold a flow type" keeps one mental model: **`new` = author a type · `create` = make an instance of a type**. An explicit `create` verb (vs. a bare `harness flow <type>`) is clearer inside a subcommand group with many siblings.

### D3 — Mutation granularity: fine-grained primitives vs. coarse `advance`

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A — fine-grained atomic primitives** | `cursor`, `status`, `add-node`, `set-node`, `comment`, `event` each do one thing | Composable; each maps to one hand-crank step; trivially testable (one mutation = one assertion); the CLI stays a **primitive provider**, not a decision engine | Common "advance + mark prior done" is 2 calls | **Selected** |
| B — coarse `advance --to <node>` | One verb moves cursor + marks prior `done` + fires events | One call for the common move | Bakes routing **policy** into the CLI; conflicts with the plan's **Non-Goal** ("the CLI provides mutation + render primitives, not the decision engine"); harder to evolve | Rejected (as a *replacement*) |

> **Why this format**: "what's next" lives in the prose Graph in `the-flow`'s `00-routing.md` (an explicit plan Non-Goal keeps it there). The CLI must therefore expose **primitives** the consumer composes, not a built-in advancement policy. A future convenience `advance` could be added additively later — but it is **not** in v1, and it never becomes the only way to move the cursor.

### D4 — Flow-file & schema location (path / redirect)

**Flow-file resolution precedence** (every command that targets an existing flow):
1. `--path <file>` — explicit path to the flow JSON (the redirect; must pass `isWithin` repo root).
2. `--plan-dir <dir>` — convenience; resolves `<dir>/the-flow.json`.
3. **Discovery** — exactly one flow under `docs/plans/*/the-flow.json` (or `.harness/`) → use it.
4. **Ambiguous / none** → `E307` (ambiguous; ask for `--path`) or `E301` (not found).

**Schema resolution precedence** (`create` / `new` / validation — plan task 1.2b):
1. `--schema <path>` — explicit schema file.
2. `.harness/schemas/flows/<type>.schema.json` — repo convention for user-authored flow types. The **`flows/` subdir** keeps flow-type schemas separate from other `.harness/schemas/` kinds (records, configs, etc.).
3. Bundled **harness-owned** built-in (shared-core + harness-loop) inlined via `gen:flows`.
4. **Not found** → `E304` (type unknown / no schema).

> **Errata (superseded by grill 6/7, folded into plan v1.1.0)**: the bundled set is **shared-core + harness-loop only** — **not** `flight-plan`/`adopt-flow`. `the-flow` **ships its own flight-plan schema** with the skill and supplies it via `--schema` (single owner, no drift); `adopt-flow` moved to a separate plan. `--schema` therefore resolves **absolute out-of-repo** paths (the skill home) and is **exempt from `isWithin`** (canonicalized + JSON-only + size-capped).

> **Why this split**: locating the *instance* (a flow file) and locating its *type* (a schema) are different lookups with different defaults — the file defaults to the plan folder; the schema defaults to a bundled built-in. Keeping them as two precedence chains avoids a single overloaded `--path` doing double duty.

---

## Overview

`harness flow` is a single **core, reserved** command (always present, runs under `--no-extensions`, like `help`/`doctor`/`new`/`record`). It owns the flow data model deterministically: create/author, read, mutate, annotate, and render. Every subcommand returns the standard `Envelope` and exits through the single `exitWithEnvelope` chokepoint (ok/degraded → 0, unconfigured → 2, error → 1). `--json` emits the envelope verbatim.

```
harness flow
├── new <type>                        author a new flow TYPE (schema template)        → .harness/schemas/flows/<type>.schema.json
├── create <type>                     instantiate a flow INSTANCE from a type         → docs/plans/<slug>/the-flow.json (default)
├── show                              read & print a flow's state                     (read-only)
├── list                              list discoverable flows in the repo             (read-only)
│
│   ── mutations (replace the hand-crank; each atomic, each fires built-in events) ──
├── cursor   --to <node-id>           move the cursor                                 (fires cursor-moved)
├── status   --node <id> --to <s>     change a node's status                          (fires status-changed; stamps ran_at)
├── add-node --id <id> --type <t> …   create a node                                   (fires node-created)
├── set-node --node <id> …            set/append node fields (artifact, user-input, meta, note)
│
│   ── annotation / telemetry (verb shape here; KIND taxonomy → workshop 002) ──
├── comment  --node <id> --text "…"   append a timestamped node comment
├── event    <name> --kind <k> …      append a custom / manually-fired event to the root log
│
└── render   [--check]                deterministic mermaid + markdown (pure function)
```

> **No `flow agent` verb in v1 (deferred).** The corpus review found 8/20 flows populate `agents[]` (`kind: companion`, `render: wrap`), but recording a companion run is pure narrative bookkeeping — the flow never *runs* the agent — so it doesn't earn a v1 verb. The `agents[]` field stays in the shared-core schema (tolerated + renderable); a thin `flow agent` sugar verb can be added additively later. See § *Real-corpus grounding*.

> **Errata — workshop 003 additions (folded into plan v1.2.0, additive; no decision here reversed)**: (1) **`create`** scaffolds the type's **template skeleton** by default (`--bare` opts out; template = a sibling of the schema, `--template` overrides) — see workshop 003 T1/T2. (2) A new **`insert-node`** verb joins the mutation set — it splices `next[]` deterministically (`--after`/`--before`/`--branch-of`), the one verb that mutates *existing* nodes' edges (`add-node` stays the side-effect-free primitive); adds **`E309 FLOW_EDGE_INVALID`** to the `E3xx` block — see workshop 003 I1–I4. (3) A **`decision`** node type is added to the schema (a labelled fork) — see workshop 003 DP1/DP2. The full subcommand tree below is otherwise unchanged.

## Command Summary

| Command | Purpose | Writes? | Key error codes |
|---------|---------|---------|-----------------|
| `flow new <type>` | Scaffold a new flow type (schema) | yes | E303, E302, E108 |
| `flow create <type>` | Instantiate a flow from a type | yes | E304, E303, E302, E306 |
| `flow show` | Print flow state | no | E301, E307, E300 |
| `flow list` | List flows in repo | no | — |
| `flow cursor --to <id>` | Move cursor (+ `--recommend`) | yes | E305, E301, E302 |
| `flow status --node <id> --to <s>` | Change node status | yes | E305, E301, E302 |
| `flow add-node …` | Create a node | yes | E301, E302, E108 |
| `flow set-node --node <id> …` | Set node fields / append artifact | yes | E305, E301, E303, E302 |
| `flow comment --node <id> --text …` | Append node comment | yes | E305, E301, E302 |
| `flow event <name> --kind <k>` | Append custom/manual event | yes | E301, E302, E108 |
| `flow render [--check]` | Render mermaid+markdown / drift-check | yes¹ | E301, E300 |

¹ `render` writes `the-flow.md` unless `--check` (read-only drift guard, non-zero exit on drift).

---

## `flow create` — instantiate a flow

```
$ harness flow create flight-plan --slug first-class-flow-system

┌─────────────────────────────────────────────────────────────┐
│ STEP 1: Resolve schema for type "flight-plan"               │
│   • --schema? → .harness/schemas/flows/? → bundled ✓        │
│ STEP 2: Resolve target path                                 │
│   • --path? → --plan-dir? → default docs/plans/<slug>/      │
│     → docs/plans/first-class-flow-system/the-flow.json      │
│ STEP 3: Stamp + write atomically (temp + rename)            │
│   • schema_version, kind, slug, cursor=null, created_at,    │
│     created_from_branch (from GitPort)                      │
│   • fire built-in event: created                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ OUTPUT                                                      │
│   Created docs/plans/first-class-flow-system/the-flow.json  │
│   flow: ok                                                  │
└─────────────────────────────────────────────────────────────┘
```

**Args/flags**: `<type>` (required) · `--slug <slug>` (drives default path) · `--path <file>` (redirect, `isWithin`) · `--plan-dir <dir>` · `--schema <path>` (override resolution) · `--json`.

### `flow create` (JSON output)

```
$ harness flow create flight-plan --slug demo --json

{
  "command": "flow create",
  "status": "ok",
  "timestamp": "2026-06-17T21:48:08.000Z",
  "data": {
    "type": "flight-plan",
    "path": "docs/plans/demo/the-flow.json",
    "schema_source": "bundled",
    "created_from_branch": "024-first-class-flows"
  },
  "evidence": [{ "label": "flight-plan flow", "path": "docs/plans/demo/the-flow.json" }],
  "next_action": "Add nodes with `harness flow add-node`, or render with `harness flow render`."
}
```

---

## `flow new` — author a new flow type

```
$ harness flow new incident-review

Created .harness/schemas/flows/incident-review.schema.json
new: ok
  → Edit the schema body, then `harness flow create incident-review`.
```

**Args/flags**: `<type>` (required, name-validated like `harness new`) · `--force` (overwrite) · `--json`. Reuses the **`new` = author a reusable type** mental model.

---

## `flow cursor` / `flow status` — the core mutations

```
$ harness flow cursor --to plan --recommend ws-cli
cursor: plan → (recommend ws-cli)
flow: ok

$ harness flow status --node p1 --to in_progress
status: p1  known → in_progress   (modified_at stamped)
flow: ok
```

- `flow cursor --to <node-id> [--recommend <node-id>] [--path]` — moves the single cursor; fires built-in `cursor-moved` (from→to). `--recommend` sets `recommended_next` without moving the cursor.
- `flow status --node <id> --to <status> [--path]` — `<status> ∈ {known, assumed, in_progress, done, blocked}`; fires `status-changed`; stamps `modified_at` always, and **`ran_at` on `in_progress → done|blocked`** (execution wall-clock, distinct from `modified_at`). Enforces the taxonomy's legal transitions (no backwards moves) → `E305` on illegal target / unknown node.

---

## `flow add-node` / `flow set-node` — node lifecycle

```
$ harness flow add-node --id p1 --type phase --label "Phase 1 · Flow engine" \
    --status known --next p2 --phase 1
add-node: p1 (phase) created
flow: ok

$ harness flow set-node --node p1 --artifact docs/plans/.../tasks/phase-1/tasks.md \
    --user-input "lets do the cli surface workshop" --meta owner=jordan
set-node: p1  +1 artifact, user_input set, +1 meta   (modified_at stamped)
flow: ok
```

- `add-node` flags: `--id` `--type` `--label` (required) · `--status` `--next <id>…` (repeatable) · `--branch-of <id>` · `--phase <n>` · `--command "<…>"`. Fires `node-created`.
- `set-node` flags: `--node <id>` (required) · `--label` · `--note` · `--command` · `--artifact <path>` (repeatable, append) · `--user-input "<…>"` (verbatim) · `--meta k=v` (repeatable, runtime custom-metadata). Append-style for arrays; bumps `modified_at`.

> **Why two verbs, not `flow node add|set`**: keeping node ops as **siblings of `flow`** caps depth at 3 levels (`harness flow add-node`) and matches the flat feel of the rest of the CLI. A 4-level `harness flow node add` group was rejected as unnecessary nesting (KISS).

---

## `flow comment` / `flow event` — annotation & telemetry (shape only)

```
$ harness flow comment --node p1 --text "F001 HIGH fixed d2b0504" --kind note --ref d2b0504
comment: p1  +1 (at 2026-06-17T21:48:08.000Z)
flow: ok

$ harness flow event deploy --kind custom --value true
event: CUSTOM-001 deploy (bool=true) @ 2026-06-17T21:48:08.000Z
flow: ok
```

- `flow comment --node <id> --text "<…>" [--kind <k>] [--source user|agent|system] [--ref <r>…]` — appends one append-only entry to that node's `comments[]`, each with its own ISO-8601 `at`; bumps node `modified_at`.
- `flow event <name> --kind <k> [--value <v>] [--detail k=v…]` — appends to the root `events[]`. For `--kind custom`, the value `type` is **duck-typed** from `--value` shape and stored explicitly.

> **Boundary**: this workshop pins the **verb shape** of `comment`/`event` only. *Which* built-in kinds exist, which are public-manual, and the exact duck-typing rules are decided in **workshop 002 — event + comment taxonomy**. The flags above are stable regardless of that taxonomy.

---

## `flow render` — deterministic output

```
$ harness flow render                      # writes the-flow.md beside the JSON
render: ok  (docs/plans/demo/the-flow.md, 1240 bytes)

$ harness flow render --check              # CI drift guard — no write
render: error  the-flow.md is stale — run `harness flow render`
                                           (exit 1)
```

**Flags**: `--input <path>` (the flow JSON; default = resolved flow file) · `--output <path>` (default = sibling `the-flow.md`) · `--check` (re-render in memory, compare to committed `.md`, non-zero exit on drift; **no write**). Mirrors the `gen:docs → git diff --exit-code` parity precedent; wired into CI as `check:flows`.

---

## Error Codes — the `E3xx` flow block

Extends the central `error-codes.ts` table (currently free above `E204`). The plan sketched `E300–E304`; this workshop refines to:

| Code | Constant | Message / Cause |
|------|----------|-----------------|
| E300 | `FLOW_SCHEMA_INVALID` | Flow instance fails schema validation |
| E301 | `FLOW_NOT_FOUND` | No flow file at the resolved path |
| E302 | `FLOW_WRITE_FAILED` | Atomic write (temp + rename) failed (permissions, etc.) |
| E303 | `FLOW_PATH_ESCAPE` | `--path`/`--output` resolves outside the repo root (`isWithin`) |
| E304 | `FLOW_TYPE_UNKNOWN` | Flow type has no resolvable schema (built-in or custom) |
| E305 | `FLOW_NODE_NOT_FOUND` | `--node` id doesn't exist, or an illegal status transition |
| E306 | `FLOW_SCHEMA_VERSION_UNSUPPORTED` | Instance `schema_version` major is unknown (version-gated validation) |
| E307 | `FLOW_AMBIGUOUS_TARGET` | >1 flow discoverable and no `--path`/`--plan-dir` given |

> Reuse existing generic codes where they already fit: `E108 INVALID_ARGS` for malformed flags, `E100 UNKNOWN` last-resort. (`E305`/`E306`/`E307` are additions beyond the plan's initial `E300–E304` sketch — the workshop's refinement.)

---

## Hand-crank → CLI mapping (seeds Phase 3)

The exact one-to-one mapping `the-flow`'s guided mode adopts when it stops hand-editing `the-flow.json`:

| Today (prose hand-crank in the skill) | Becomes |
|----------------------------------------|---------|
| "completed node → `status: done`, stamp `ran_at`" | `flow status --node <id> --to done` |
| "advance `cursor`/`recommended_next`" | `flow cursor --to <id> --recommend <id>` |
| "reveal phases: `assumed` → `known` nodes" | `flow add-node …` / `flow status --to known` |
| "capture verbatim `user_input`; append `artifacts[]`" | `flow set-node --node <id> --user-input … --artifact …` |
| "append a per-node comment (021 prose blobs / `note` history)" | `flow comment --node <id> --text …` |
| "record the companion run into `agents[]`" | *(deferred — no v1 verb; `agents[]` stays in schema, unpopulated by v1 the-flow)* |
| "regenerate `the-flow.md` from the JSON" | `flow render` |
| (new) flow creation, no adoption required | `flow create flight-plan --slug <slug>` |

> The routing **Graph** in `00-routing.md` stays prose and unchanged — only the *mutation invocation method* changes (plan task 3.3).

---

## Real-corpus grounding (20 prior flows reviewed)

This surface was cross-checked against **every `the-flow.json` that has actually run in this repo** (`docs/plans/003`…`023`, 20 flows) — not just the schema. What the corpus shows:

| Field / construct | Real usage | What it means for the CLI |
|-------------------|-----------|---------------------------|
| `ran_at` | 19/20 | The **one** timestamp humans actually stamp → the mutation verbs must keep it |
| `recommended_next`, `user_input`, `mode`, `kind` | 20/20 | Universal hot path — `cursor`, `set-node`, `create` must nail these |
| `branch_of` | 15/20 | Excursions are common → `add-node --branch-of` is load-bearing |
| `agents[]` (companion, `render: wrap`) | **8/20** (22 entries) | Considered a `flow agent` verb; **deferred to v2** (pure bookkeeping, the flow never runs the agent) — field stays in schema, unpopulated by v1 the-flow |
| `note` (free-text history) | nearly all | Append-style blobs (commits/findings/coverage) — the **same anti-pattern** as 021's state keys; reinforces structured `comments[]` (workshop 002) |
| ad-hoc node `type: "validation"` | 3/20 | Node `type` is extended freely in the wild → the **renderer must tolerate unknown types** (fallback class, never crash) — a Phase 2 render rule |
| `created_at`, `modified_at` | **0/20** | The datetime trio beyond `ran_at` is **aspirational** — the CLI auto-stamping it is pure value-add (hand-cranking never bothered), not a migration of existing behaviour |
| `comments[]`, `events[]`, `custom-metadata`, `created_from_branch`, `harness_record_link`, `iterations`, `tool` | **0/20** | 100% greenfield — net-new surface the CLI introduces (no existing shape to honour; lowest migration risk, highest design freedom) |
| `worker` agents / `render: side` | 0/20 | In the contract but never exercised — supported, not a v1 focus |

**Net effect on this workshop**: confirmed the fine-grained mutation set matches the real hot path (`ran_at`/`cursor`/`user_input`/`branch_of`); confirmed `comments[]`/`events[]` are genuinely greenfield (so workshop 002 designs freely); and deliberately **deferred** an `agents[]` verb (real but pure bookkeeping). One requirement handed to **Phase 2 render**: tolerate unknown node `type`s gracefully (the `validation` precedent).

---

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Full subcommand tree | § Overview | D1 (single act + subcommands) | Ready |
| `new` vs `create` precedent table | § D2 | `create`/`new` semantics; AC-01/AC-02 | Ready |
| Granularity decision + Non-Goal tie | § D3 | mutation atomicity; CLI-as-primitives boundary | Ready |
| Two precedence chains (file + schema) | § D4 | AC-01, AC-07 (containment), AC-11 (resolution); tasks 1.2a/1.2b | Ready |
| Terminal + JSON examples per command | command sections | Envelope shape per command | Ready |
| `E3xx` table (E300–E307) | § Error Codes | AC-07; task 1.11 | Ready |
| Hand-crank → CLI mapping | § mapping | Phase 3 migration (task 3.3); AC-09 | Ready |
| 20-flow corpus review | § Real-corpus grounding | every decision grounded in real usage, not just schema | Validated |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation (Phase 1) | Verb names "proposed"; granularity unsettled; flags TBD | Fixed verb/flag/envelope contract per command |
| Migration (Phase 3) | "replace the hand-crank" with no command names | Explicit one-to-one hand-crank → command map |
| Error handling | `E300–E304` rough sketch | `E300–E307` named with cause + reuse rules |
| Review | Reconstruct intended CLI from scattered tasks | One command-summary table + decision rationale |

## Validation / Acceptance

This workshop reaches **Contract Ready** when:
- Every subcommand has a name, argument/flag list, success Envelope shape, and error path. ✅
- The four Key Questions each have a recorded decision with rationale (D1–D4). ✅
- The verb surface is additive-only and does not reshape `--hook/--event/--hooks/--json` (CD-02). ✅ (no overlap; `flow` is a new namespace)
- A reader can map each of `the-flow`'s hand-crank steps to a command. ✅
- It is folded back into the plan's `### Clarifications` + Phase 1/2 task success criteria on the next `plan` pass. ⏳ (pending re-plan)

## Open Questions

### Q1: Does a convenience `flow advance` ship in v1?

**RESOLVED (deferred)**: No. v1 ships fine-grained primitives only (D3). A composite `advance` may be added **additively** later; it must never become the sole cursor-mover (routing policy stays in the prose Graph).

### Q2: Does `flow create` require a `--slug`, or can it derive one?

**RESOLVED**: `--slug` is required when relying on the default `docs/plans/<slug>/` path; `--path`/`--plan-dir` make it optional (the path is then explicit). No silent slug-from-cwd guessing.

### Q3: Should `flow list` discover `.harness/` flows as well as `docs/plans/*`?

**OPEN**: Lean yes — list both `docs/plans/*/the-flow.json` and `.harness/**/*.json` flows, tagged by location. Confirm during Phase 1 (low-stakes; additive).

### Q4: `flow event` for built-in kinds — exposed or engine-only?

**DEFERRED to workshop 002**: built-in kinds (`created`, `cursor-moved`, `status-changed`, `node-created`) fire automatically as side effects of mutations; whether `flow event` can *also* fire a "public-manual" kind (e.g. a build-run marker) is a taxonomy decision for workshop 002. The verb shape here supports it either way.
