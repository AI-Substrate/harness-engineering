# Workshop: Building new flows on the flow system — implementation guide

**Type**: Integration Pattern / Onboarding
**Plan**: 026-the-flow-cursor-meta-migration
**Created**: 2026-06-18T07:42:51Z
**Status**: Draft
**Audience**: authors of a new flow or skill (the-flow, `eng-harness-flow`, or a brand-new skill) that wants a flight-plan + nav-driven journey.

**Value Thesis**: A fresh skill author stands up a new flow on the shared system (flight-plan DAG + `nav` + `rail` + `zone`) by following one recipe + one contract — without re-deriving the model or writing any workflow engine. This is the reuse payoff of putting `nav`/`rail`/`zone` in the CLI shared core.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Contract Ready (commands marked **[024]** exist today; **[P1]** land in this plan's Phase 1)

**Related**: `workshops/001-cursor-meta-migration.md` (migration map), `workshops/002-nav-first-class-position-db.md` (the `nav`/`rail`/`zone` contract this is the how-to for).

---

## The one rule (read first)

> **The LLM dispatches; the CLI persists.** The flow CLI is a typed, validated *notebook* for position + state — **not** a workflow engine. Routing ("what stage comes next") lives in **your skill's prose** (your own Registry/Graph), never in the CLI. The CLI validates node-refs + structural integrity and renders; it never decides the journey.

Everything below follows from that. If you find yourself wanting the CLI to "know" your stage order, stop — that knowledge belongs in your skill.

---

## What the system gives you (the shared primitives)

| Primitive | What it is | Verb(s) |
|---|---|---|
| **Flight plan** | a per-flow DAG: nodes (`id,type,label,status,next[],zone,artifacts[],comments[]`) + an event log + provenance | `create`/`new` **[024]** |
| **Position (`nav`)** | one object: `now` (node id, truth), `next` (node id\|null, advisory), `intent` (text), `bag` (free-form qualifiers) | `nav show`/`set`/`meta` **[P1]** |
| **Rail** | the one-line progress view: `pre ─ [ flight ] ─ post`, pips from live status | `rail` **[P1]** |
| **Zones** | per-node `preflight\|flight\|postflight` → which band a node renders in | `--zone` on `add-node`/`insert-node` **[P1]** |
| **Mutation** | append/splice nodes, set status/fields, comment, log events | `add-node`/`insert-node`/`status`/`set-node`/`comment`/`event` **[024]** |
| **Render** | deterministic markdown (mermaid + node log + rail line) | `render` **[024]** |

All operate on a flow file via `--path <file>` (or `--slug`). Nothing is the-flow-specific — point any verb at any flow.

---

## Build a new flow — step by step

```bash
# 0. (once per flow TYPE) define your overlay — your statuses + node types
harness flow new my-flow            # scaffolds .harness/schemas/flows/my-flow.json
#    edit it: list your nodeTypes (e.g. intake, build, sign-off) + statuses

# 1. create an instance (root identity + provenance stamped)
harness flow create my-flow --slug acme-onboarding \
  --path docs/.../the-flow.json --schema <your-overlay> --bare

# 2. seed the spine (add in dependency order, or insert-splice) — set zones
harness flow add-node    --path F --id intake  --type intake --label "Intake"   --status in_progress --zone preflight   # [P1 --zone]
harness flow add-node    --path F --id build    --type build  --label "Build"    --status known       --zone flight
harness flow add-node    --path F --id signoff  --type signoff --label "Sign-off" --status known       --zone postflight --next ""
harness flow insert-node --path F --id review   --type review --label "Review" --after build --zone postflight   # splice mid-spine

# 3. point the cursor + state your intent
harness flow nav set --path F --now intake --next build --intent "onboard ACME"   # [P1]

# 4. show position / rail / render
harness flow nav show  --path F     # [P1] → {now,next,intent,bag,predecessors,successors}
harness flow rail      --path F     # [P1] → ◐─[◇]─◇  Intake ─ [ Build ] ─ Review · Sign-off
harness flow render    --path F --output the-flow.md
```

---

## Driving a flow each turn (the cadence)

After your skill decides what happened (the LLM's job), record it:

```bash
harness flow status   --path F --node intake --to done            # a step finished
harness flow set-node --path F --node build --note "..." --artifacts "src/x.ts"
harness flow comment  --path F --node build --kind decision --text "chose X over Y"
harness flow nav set  --path F --now build --next review --intent "..."   # advance position
harness flow nav meta set --path F replan_reason draft            # stash a qualifier
harness flow render   --path F --output the-flow.md               # regenerate the view
```

Then your skill renders the rail (`harness flow rail`) and narrates — the CLI never narrates or routes.

---

## Pick a position model

| Model | `now` advances by | Used by | When |
|---|---|---|---|
| **Explicit cursor** | your skill calls `nav set --now` as stages complete | the-flow | linear journeys with one clear position |
| **Derived** | `nav` is rebuilt from substrate each call (artifacts/signals); often left absent | eng-harness-flow | cyclic/re-entrant loops where position is observable |

Declare which in your skill's prose. Both use the same `nav`/`rail` primitives; the difference is *who* sets `now`.

---

## The rail (usage)

`harness flow rail --path F` emits one line: it walks the **main spine** (topo order, `branch_of` excursions excluded), renders one pip per node from **live status** (`done`→`◆`, `in_progress`→`◐`, else `◇`), names from `label`, and groups by **`zone`** into `pre ─ [ flight ] ─ post`:

```
◆─◆─◆─[ ◐ ]─◇        Intake · Plan · Tasks ─ [ Build ] ─ Review · Sign-off
```

- No stored counters — fill is always live (no drift).
- `zone` unset ⇒ defaulted by node type (lead-up→preflight, phase/build→flight, review/merge/sign-off→postflight).
- Optional `--curated` reads an explicit `nav.rail = [ids]` sequence instead of the spine.
- Reusable verbatim by any flow type — this is *the* shared progress view.

---

## Resume & statelessness

- **Resume**: call `nav show` → you get `now` + neighbours + `intent` + `bag`. Recompute `next` from your Graph if you don't trust the cached one.
- **`nav` absent** (e.g. a direct/harness-less invocation wrote none): rebuild `now` from artifact existence — **artifacts stay the backstop**, `nav` is a convenience. This is what lets a direct-jump stay stateless by design and a guided resume catch up.

---

## Layering — what lives where (don't cross these)

| Layer | Owns | Example |
|---|---|---|
| **CLI shared core** | `nav`, `rail`, `zone`, events, render, node/edge integrity | `harness flow nav/rail/...` |
| **Flow-type overlay** | your `statuses[]` + `nodeTypes[]` (via `--schema`) | `intake`/`build`/`signoff` types |
| **Your skill** | routing (Graph/Registry), narration, stage execution | "what verb follows what", the voice |

If you're adding routing logic to the overlay or the CLI, it's in the wrong layer — push it up to the skill.

---

## Minimal new-flow skeleton (copy-paste checklist)

1. `harness flow new <type>` → edit overlay (nodeTypes + statuses).
2. `harness flow create <type> --slug ... --schema ... --bare`.
3. Seed spine: `add-node`/`insert-node` with `--zone`.
4. `nav set --now <first> --intent "..."`.
5. Each turn: `status`/`set-node`/`comment` → `nav set --now/--next` → `render` → print `rail`.
6. Keep **all** routing in your skill prose. Validate by dogfooding the flow on itself.

---

## Validation / Acceptance

Implementation Ready when a new author can, from this doc alone:
- stand up a flow instance + seed a zoned spine — ✅ (step-by-step + skeleton)
- drive it each turn with the right verbs — ✅ (cadence)
- choose a position model + render the rail — ✅
- keep the layering clean (no routing in the CLI) — ✅ (the one rule + layering table)

> Net-new commands (`nav`, `rail`, `--zone`) are **[P1]** — this guide is the target builder experience, re-validated once Phase 1 lands and this flow dogfoods it.
