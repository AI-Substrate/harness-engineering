# flight-plan-ops — driving the two harness flows with real `harness flow` commands

> **Load on demand, before the first flight-plan mutation of a session** — not up
> front. This is the nav-mechanics contract for the dogfood: how `eng-harness-flow`
> drives its **two first-class, CLI-driven flows** (🧰 adopt + ⚙️ loop) through the
> **real `harness flow` verb family**, never by hand-editing JSON. It is the
> harness-loop analogue of the-flow's `flight-plan-ops.md` (plan 024). Verb modules
> under `references/stages/` never read this file — they stay harness-blind; driving
> a flight plan is the router's job, here.

---

## What this supersedes (scope it precisely — R-2)

The router's detection is still **signal-derived and stateless**: *which* flow is
live (adopt vs loop) is re-derived every call from the adoption gate (`00-routing.md`),
never remembered. What this adds is that **once a flow is live, the router persists
its POSITION as a real flight plan** driven by `harness flow nav` — the dogfood and
the exemplar. The supersession is therefore **scoped to flow position only**:

- ✅ Position is persisted in a flight plan (CLI-owned `.json` → rendered `.md`).
- ✅ Driven **exclusively** through `harness flow` calls — **never** hand-edited JSON
  (the CLI is the only writer; mirrors the-flow plan 024).
- ❌ Detection / routing / verdicts stay signal-derived (no remembered routing state).
- ❌ Verb modules stay harness-blind; the five lifecycle hooks + the `--json`/`--hooks`
  envelope contract are **frozen** (see `00-routing.md` § Lifecycle hooks).

> The two flows are **mutually exclusive** — exactly one is ever live (the gate
> picks it). They never co-run. See `00-routing.md` § The two first-class flows.

---

## Prerequisite — a capable `harness flow` CLI (run once per session)

Before the first flight-plan mutation, probe `harness flow --help` (and `harness
--version` for a floor). If `harness` is missing, or the `flow` verb family lacks
`create`/`add-node`/`insert-node`/`set-node`/`nav`/`rail`/`render`/`chores`, **stop**
honestly: *"eng-harness-flow drives its flows through a capable `harness flow` CLI
(plan 032). Run `harness update`, then retry."* Do **not** hand-crank the JSON.

A pre-CLI hand-written flow (no `provenance` block) is read as **`E308`** (legacy) —
a clean stop, not a migration. Re-create with `harness flow create`.

---

## The nav model (position lives in the flight plan, not here)

`nav` is the position object the CLI owns: `{ now, next, intent, bag }`.

| Field | Meaning | Set via |
|---|---|---|
| `now` | the live node (the cursor) | `harness flow nav set --now <id>` (fires `cursor-moved`; `--now` target must exist → else `E305`) |
| `next` | advisory next node | `--next <id>` / `--clear-next` |
| `intent` | this leg's one-line intent | `--intent "<text>"` |
| `bag` | free-form qualifier map (e.g. `flow: adopt\|loop`, `status`) | `harness flow nav meta set <key> <value>` (shallow-merge; read with `nav meta get [key]`) |

Node lifecycle status is **separate** from nav and set via `harness flow status
--node <id> --to <status>` (fires `status-changed`; stamps `ran_at` on `done`/`blocked`).
The cycle of the ⚙️ loop is modeled as a **nav reset** (move `nav.now` back to
`observe`/`boot`) — the graph stays **acyclic** (`improve.next:[]`), never a stored
back-edge.

---

## Spine vs excursion (the rail's two lanes)

- **Spine** nodes form the main line (solid `-->` edges) and appear on the rail in
  zone bands `preflight ─ [ flight ] ─ postflight`.
- **Excursion** nodes carry `branch_of: <anchor>` (dotted `-.->` edges), sit **off**
  the rail, and rejoin at their anchor (or `--rejoin <id>`). Adopt's `scout`
  (branch_of `install`) and `inject` (branch_of `governance`) are excursions.

Zones: the renderer's `ZONE_BY_TYPE` has **no** adopt/loop node types, so **every
node sets an explicit `--zone`** (preflight | flight | postflight). The bundled
templates already do; honour it on any node you add.

---

## The verb surface (and its gotchas)

| Verb | Use | Gotchas |
|---|---|---|
| `flow create <kind> --slug <s> --path <p> [--title <t>]` | instantiate adopt/loop from the bundled overlay+template | `--path` must be in-repo; rail title = `provenance.agent` › `title` › `slug` — pass `--title adopt` / `--title harness-loop` (don't pass `--agent`, which would win) |
| `flow nav set` | move `now`/`next`/`intent` | `--now`/`--next` target must already exist (`E305`) |
| `flow status --node --to` | node lifecycle status | the only thing that stamps `ran_at` |
| `flow add-node` | append a node | a `--next` target must already exist → **build last-to-first** (forward refs rejected) |
| `flow insert-node --after\|--before\|--branch-of [--rejoin]` | splice a node + rewire edges | exactly one placement flag; DAG re-checked → `E309` on a cycle/orphan |
| `flow set-node --node <id> [--command] [--zone] [--chore-kind --importance]` | edit an existing node's fields | **cannot re-parent** (no `--next`); `--chore-kind`/`--importance`/`--zone` were added in plan 032 — the R-1 path to flag an existing the-flow seam node as a chore |
| `flow add-node\|insert-node … --chore-kind <k> --importance <i> --command "<cmd>"` | create a chore node | `kind ∈ {skill,command,builtin,manual}`; `importance ∈ {strongly-recommended,recommended,optional,informational}` — there is **no `required`** (chores never gate); a half-specified chore → `E108` |
| `flow chores [--json]` | list chore nodes (status·importance·kind·anchor·command·runnable) | a READ |
| `flow rail [--chores show\|collapse\|hide]` | the one-line rail | chore pips (□ todo · ■ done · ▨ skipped · ▣ strongly-rec todo) always render; mode only collapses chore *names* |
| `flow render [--output\|--check]` | deterministic `.md` (mermaid + node log) | `--check` drift-guards a committed golden; golden `.md` are CLI-generated, **never hand-edited** |

**Build order rule:** because `--next` targets must pre-exist, author a flow
**last node first** (or use `insert-node --before/--after` to splice into a built
spine). The bundled templates already encode the right order — prefer `create` over
hand-building.

---

## The AC-07 chore shape (injecting the four fire hooks into an active the-flow)

When the ⚙️ loop runs **alongside an active `the-flow.json`**, the router places the
four fire-hook steps as **chores** on that flight plan (so the-flow's rail tracks
them and they stop getting missed). Standalone, it authors its own loop instead
(§ below). The exact, deterministic chore shape:

| Field | Value |
|---|---|
| `chore.kind` | `command` |
| `chore.importance` | `recommended` — **except** `pre-flight`/boot = `strongly-recommended` |
| `command` | `run /eng-harness-flow --hook <hook>` for `<hook> ∈ {pre-flight, pre-coding, post-coding, post-flight}` |
| `status` | `todo` → `done`\|`skipped` over its lifecycle |

**Dedup key = the `--hook <X>` token inside `command`.** Exactly one chore per hook
per the-flow plan. Injection is therefore **idempotent** — re-running it produces a
**byte-identical** node set: `insert-node`/`add-node` de-dup on the hook token (no new
node), and `set-node` (the found-node re-flag path below) is a **no-op when every
requested field already matches** — it does not restamp `modified_at` or emit an event
(plan 032 FT-001). Re-flagging an already-correct chore changes nothing on disk.

**Reconciliation with the-flow's seam emission (R-1).** the-flow may already emit a
seam node (`harness-boot` / `backpressure` / `harness-retro`) carrying that hook's
`/eng-harness-flow --hook <X>` command. `eng-harness-flow` is the **single owner** of
the chore flag:

1. Scan the-flow's nodes for one whose `command` contains `--hook <X>`.
2. **Found** → flag it in place: `harness flow set-node --node <that-node> --chore-kind
   command --importance <i> --command "run /eng-harness-flow --hook <X>"` (does **not**
   duplicate; the seam node keeps its type + violet render, gains a chore pip).
3. **Not found** → add one: `harness flow add-node --id ehf-<hook> --type chore
   --label "<Hook> hook" --chore-kind command --importance <i> --command "run
   /eng-harness-flow --hook <X>" --zone <band>` (or `insert-node --after <anchor>`).

`coding`/observe stays **silent** (no chore); `improve` follows a retro (no chore) —
only the **four fire hooks** become chores.

> A note in the-flow's `references/harness-seams.md` records that `eng-harness-flow`
> owns the chore flag, so seam emission and chore injection never double-fire.

---

## Standalone loop (no the-flow active)

With no active `the-flow.json`, the router drives its **own** loop:

```
harness flow create harness-loop --slug loop --path .harness/loop.flow.json --title harness-loop
harness flow nav set --path .harness/loop.flow.json --now boot --intent "<this session's work>"
# … drive boot → backpressure → observe → drain-gate → retro-drain → retro-harvest → improve
# the cycle = nav reset back to observe/boot (DAG stays acyclic)
```

`.harness/loop.flow.json` is **tracked** (committed like the-flow's flight plans —
it is the dogfood record), not gitignored. The observe *scratch* (`.harness/temp/`)
stays gitignored as before; only the flow file is tracked.

> **Never both at once.** While a the-flow is active the loop lives as **chores in
> `the-flow.json`** and **no `.harness/loop.flow.json` is authored**. The two flows
> are mutually exclusive by construction.
