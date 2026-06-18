# The `harness flow` verb family

Deterministic **flow mechanics** on the command line: create a flow, mutate it with
small atomic verbs, append a timestamped event/comment log, and render it to
markdown — all so an agent (or a human) never hand-edits a flow's JSON or
re-computes its diagram by hand.

> **Where docs live (for now):** user guides live under `docs/how/`. Documentation
> is planned to become a first-class, CLI-surfaced concept later; this guide is
> written standalone so it can be promoted/indexed without moving.

> **Mechanics, not routing.** `harness flow` is the *deterministic substrate* —
> mutation, history, render. It does **not** decide what to do next; routing
> policy stays with the agent / the prose flow that drives these verbs (plan 024
> Non-Goal).

---

## The model in one minute

A **flow** is a cursor-spine DAG persisted as one JSON document (`the-flow.json`
shape):

- **nodes[]** — each a `{ id, type, label, status, next[] }` (+ optional
  `branch_of`, `user_input`, `comments[]`, timestamps). The `cursor` marks where
  the agent is; `recommended_next` is a non-binding hint.
- **events[]** — a flow-scoped, append-only audit log: engine-fired built-ins
  (`created`/`cursor-moved`/`status-changed`/`node-created`/`node-updated`),
  public-manual kinds (`build-run`/`test-run`/…), and duck-typed `custom`
  telemetry. Ids are `<PREFIX>-<NNN>`.
- **comments[]** — per-node, append-only narrative (`{ at, text, source?, kind?, refs? }`).
- **provenance** — a 7-key block stamped once at `create` (the signal that
  distinguishes a CLI-shaped flow from a legacy hand-written one).

Every timestamp is ISO-8601 UTC from the injected clock; durations are derived at
read time, never stored.

---

## The verbs

All live under the nested `harness flow` group. Each resolves its flow by
`--path <file>` **or** `--slug <name>` (→ `.harness/flows/<slug>.json`), mutates,
re-validates against the resolved schema, and writes atomically (temp + rename).

| Verb | What it does |
|------|--------------|
| `create <type> --slug <s>` | Instantiate a flow from its type's template (root identity + provenance stamped). `--bare` for root-only; `--schema`/`--template` to override. |
| `new <type>` | Scaffold a custom flow-type **schema overlay** into `.harness/schemas/flows/<type>.schema.json`. |
| `show` | Read a flow and print its summary envelope. |
| `list` | Discover flows under `.harness/flows/` (or `--dir`). |
| `cursor --to <node>` / `--recommend <node>` | Move the cursor / set `recommended_next`. |
| `status --node <id> --to <status>` | Set a node status (stamps `ran_at` on `done`/`blocked`). |
| `add-node --id --type --label [--status --next]` | Append a node. |
| `set-node --node <id> [--label --note --user-input]` | Merge fields into a node. |
| `insert-node --id --type --label (--after\|--before\|--branch-of)` | Insert + splice edges deterministically; the DAG is re-checked before write. |
| `comment --node <id> --text <t> [--source --kind --refs]` | Append a timestamped comment. |
| `event <name> [--value --type \| --kind --description]` | Append a manual or duck-typed custom event. |
| `render [--path\|--slug] [--output --check --against]` | Render the flow to deterministic markdown (below). |

Outcomes are the standard envelope: `ok → 0`, `error → 1`, `unconfigured → 2`.

---

## Rendering — `harness flow render`

`render` turns a flow into a deterministic markdown document: a `mermaid`
flowchart (spine + dotted excursions + 🗣 genesis bubbles + harness-seam nodes +
a `decision` fork + an agents subgraph) plus a per-node **body-log** of the
`comments[]`. Output is **byte-stable** across runs and OS — the same flow always
renders the same bytes.

```bash
# Print to stdout (human: raw markdown; --json: markdown rides in data.rendered):
harness flow render --slug my-flow

# Write it to a file (must be inside the repo):
harness flow render --slug my-flow --output docs/plans/…/the-flow.md

# CI drift guard — re-render and compare to the committed sibling .md; non-zero on drift:
harness flow render --slug my-flow --check
```

- **`--path`/`--input`** (aliases) and **`--slug`** select the flow; `--path`/`--input`
  win over `--slug`.
- **`--check`** re-renders and diffs the **committed sibling `.md`** — the input
  path with `.json`→`.md` in the same directory, or `--against <path>` to override.
  A drift (or a missing committed render) exits non-zero with `E310`. `--check`
  **never writes** — it is a read-only guard.
- The render is a **derived artifact**: treat the `.md` like generated code — never
  hand-edit it; regenerate from the JSON.
- The body-log is **render-only**: the markdown is never parsed back into state —
  `comments[]` JSON is the single source of truth.

---

## Authoring a custom flow type

The CLI ships two layers: a universal **shared core** (field shape) and a per-flow
**overlay** that declares the `kind` + its `statuses` + `nodeTypes`. To add your own:

```bash
harness flow new my-flow                    # scaffolds .harness/schemas/flows/my-flow.schema.json
# edit the statuses / nodeTypes, then:
harness flow create my-flow --slug demo     # instantiate it
```

**Schema resolution precedence** (AC-11): `--schema <path>` (absolute, out-of-repo
allowed) › `.harness/schemas/flows/<type>.schema.json` › the bundled built-in
(`harness-loop` — the shared core is not itself creatable) › `E304`.

A consumer that owns its own schema **passes `--schema`** pointing at its copy
rather than bundling a second one — single owner per schema, no drift. (In a later
phase `the-flow` does exactly this for its flight-plan schema; the harness-loop
schema is the CLI-bundled built-in.)

---

## Legacy flows — the clean break

Flows written **before** this CLI (hand-authored JSON with no `provenance` block)
are **not migrated**. Any verb that reads one fails with `E308 FLOW_LEGACY_FORMAT`
and an honest `next_action` — the file is either a genuine pre-CLI flow (re-create
it with `harness flow create`) or it's malformed. There is no tolerant load: a
clean break beats silently mis-reading an old shape.

---

## Regenerating the golden render fixtures (maintainers)

The render goldens under `harness/cli/test/services/flow/fixtures/render/` are
**derived** — each `<name>.json` has a committed `<name>.md` that is exactly what
`harness flow render` emits for it. They are regenerated, never hand-edited:

```bash
npm run build              # the generator drives the BUILT CLI (dist) — build first
npm run gen:flow-fixtures  # re-render every fixtures/render/*.json → sibling .md
```

`npm run check:flows` guards them in CI (alongside the bundled-schema drift check):
it runs `gen:flows`, asserts the bundle is unchanged, then `flow render --check`
over every committed fixture. **Rule:** the goldens come from the *built* CLI, so
run `npm run build` before regenerating them.

---

## See also

- The act: [`harness/cli/src/acts/flow.ts`](../../harness/cli/src/acts/flow.ts)
- The renderer: [`harness/cli/src/services/flow/flow-renderer.ts`](../../harness/cli/src/services/flow/flow-renderer.ts)
- Records & record types: [`record-and-record-types.md`](./record-and-record-types.md)
- Extending the harness: [`extend-the-harness.md`](./extend-the-harness.md)
