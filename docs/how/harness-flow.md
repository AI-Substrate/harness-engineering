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
  `branch_of`, `zone`, `user_input`, `comments[]`, timestamps). `zone`
  (`preflight | flight | postflight`) places the node in a rail band; unset → a
  default by node type.
- **nav** — the position object `{ now, next, intent?, bag? }`. `now` is the
  validated current node id (the truth); `next` is an advisory node id or `null`
  (the LLM dispatches — the CLI never routes); `intent` is free text; `bag` is a
  free-form, shallow qualifier map (no schema). Replaces the old top-level
  `cursor`/`recommended_next` (a clean break — below).
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
| `create <type> --slug <s>` | Instantiate a flow from its type's template (root identity + provenance stamped). `--bare` for root-only; `--schema`/`--template` to override; `--agent <name>` + `--plan-id <id>` stamp provenance (the rail-title source); `--title <t>` sets an explicit rail label. |
| `new <type>` | Scaffold a custom flow-type **schema overlay** into `.harness/schemas/flows/<type>.schema.json`. |
| `show` | Read a flow and print its summary envelope. |
| `list` | Discover flows under `.harness/flows/` (or `--dir`). |
| `nav show` | Print the position: `{ nav: {now,next,intent,bag} \| null, predecessors, successors }` (neighbours trimmed to `{id,type,status,label,next}`; `nav` is `null` when the flow carries none). |
| `nav set [--now <id>] [--next <id> \| --clear-next] [--intent <t>]` | Move position (`--now`, validated → `E305`, fires `cursor-moved`), set/clear the advisory next (validated; `null`-able), and/or set the intent. |
| `nav meta set <k> <v>` / `nav meta get [k]` | Shallow-merge one key into the free-form `bag` / read one key (or the whole bag). |
| `rail [--path\|--slug]` | Emit the one-line rail: `[<title>] <pips>  <names>`, banded `pre ─ [ flight ] ─ post`. |
| `status --node <id> --to <status>` | Set a node status (stamps `ran_at` on `done`/`blocked`). |
| `add-node --id --type --label [--status --next --artifacts --zone]` | Append a node (`--zone preflight\|flight\|postflight`). |
| `set-node --node <id> [--label --note --user-input --artifacts]` | Merge fields into a node. |
| `insert-node --id --type --label (--after\|--before\|--branch-of) [--zone]` | Insert + splice edges deterministically (`--zone` optional); the DAG is re-checked before write. |
| `comment --node <id> --text <t> [--source --kind --refs]` | Append a timestamped comment. |
| `event <name> [--value --type \| --kind --description]` | Append a manual or duck-typed custom event. |
| `render [--path\|--slug] [--output --check --against]` | Render the flow to deterministic markdown (below). |

Outcomes are the standard envelope: `ok → 0`, `error → 1`, `unconfigured → 2`.

---

## Position, intent & the rail — `nav` + `rail`

Position lives in one **`nav`** object, not scattered fields. The agent moves it as
work progresses and reads it back to orient (e.g. after a context reset):

```bash
harness flow nav set --slug my-flow --now build --next review --intent "ship X"
harness flow nav meta set --slug my-flow replan_reason draft   # stash a qualifier
harness flow nav show  --slug my-flow                          # now/next/intent/bag + neighbours
harness flow rail      --slug my-flow                          # ◆─◆─[ ◐ ]─◇  Spec · Plan ─ [ Build ] ─ Review
```

- **`now` is truth, `next` is advice.** The CLI validates that `now`/`next`
  reference real nodes (`E305`) and persists them — it never decides the journey
  (routing stays with the driving skill).
- **`rail`** is the glanceable progress view, reusable by any flow type: it walks
  the main spine, fills one pip per node from **live** status (`done → ◆`,
  `in_progress → ◐`, `blocked → ✗`, else `◇`) with no stored counters (no drift),
  and groups nodes into zone bands. The `[<title>]` prefix is `provenance.agent`
  (so a flow created `--agent the-flow` rails as `[the-flow]`) → an explicit
  `--title` → the slug.
- **Zones** (`--zone` on `add-node`/`insert-node`) place each node in a band;
  unset, a node defaults by type (lead-up types → `preflight`, `phase` → `flight`,
  review/merge/retro → `postflight`, anything else → `flight`).

> **Clean break:** `nav` replaced the old top-level `cursor`/`recommended_next`,
> and the `cursor` verb was removed (no alias). A flow written in the old shape
> still *reads* (extra fields are tolerated); call `nav set` to adopt the new
> position model.

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
