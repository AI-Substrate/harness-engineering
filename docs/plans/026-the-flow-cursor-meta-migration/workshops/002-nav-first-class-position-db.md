# Workshop: `nav` — a first-class LLM-driven position/state object (not a workflow engine)

**Type**: Data Model + CLI Flow
**Plan**: 026-the-flow-cursor-meta-migration
**Created**: 2026-06-18T07:20:03Z
**Status**: Draft
**Supersedes**: workshop 001 §Contract 1 + decisions D1/D3/D5 (the loose "cursor + recommended_next + meta" framing → one `nav` object)

**Value Thesis**: The single reframe that settles the whole migration: **`harness flow` is a small, validated, LLM-driven position/state *database* — not a workflow engine.** The CLI persists + validates; the *LLM* dispatches. Consolidate position + route + intent + soft state into one **optional first-class `nav` object** (`now` / `next` / `intent` / `bag`), validating only the node-refs. This is what the-flow migrates onto and what `eng-harness-flow` reuses verbatim.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Knowability**: one cohesive home for "where am I / what's next / why" beats scattered top-level fields + a generic bag.
- **Contract Integrity**: node-refs stay typed + validated; only soft qualifiers are free-form.
- **Agent Readiness**: the LLM reads `nav` + the node it points at and intuits the rest — no engine to encode.
- **Migration Safety**: optionality preserves the "direct-jump is stateless" contract and keeps artifacts as the resume backstop.
- **Learning Compounding / reuse**: `nav` in the CLI shared core → `eng-harness-flow` inherits it.

**Related Documents**:
- `workshops/001-cursor-meta-migration.md` (the migration map this refines)
- `~/.claude/skills/the-flow/references/00-routing.md` (State contract, Graph)
- plan 024 flight-plan CLI (`harness/cli/`)

---

## Purpose

Lock the data shape + CLI surface for navigation/position state so the Simple plan and Phase-1 build need no further design. The grilling session resolved ten decisions (N1–N10); this records them at Contract level.

## Key Questions Addressed

1. What is `nav`'s shape and field typing?
2. Are `now`/`next` node-ids, names, or both — and is `next` nullable?
3. What does the CLI validate — and, crucially, what does it deliberately *not*?
4. How does making `nav` optional preserve direct-jump statelessness + correct resume?
5. What of workshop 001 does this supersede?

---

## The reframe — database, not workflow (the thesis in one table)

| Concern | Owner |
|---|---|
| Where am I / what's next / why (position, route, intent, qualifiers) | **CLI** persists it in `nav` |
| Is `now`/`next` a real node? (node-exists validation, E305) | **CLI** validates |
| Structural integrity (DAG, edges, no cycles on insert) | **CLI** validates |
| **Which** node is next, **why**, what the route *means* | **LLM** decides (from the Graph it already knows) |
| Routing rules / stage order / "what verb follows what" | **LLM** (Registry/Graph in prose) — **never** the CLI |

> The CLI is a typed notebook the LLM writes its position into; it never decides the journey. No `workflow.json`, no `harness flow next`, no routing logic in code (N8).

---

## Decision Space (resolved in the grill)

| # | Decision | **Selected** | Rationale |
|---|---|---|---|
| N1 | Shape of nav state | **one first-class `nav` object** | cohesive + addressable; not loose top-level fields, not buried in a generic bag |
| N2 | `now` typing | **node-id, typed, validated (E305), durable truth** | it's the DAG position — renderer + resume dereference it; a free string severs the link |
| N3 | `next` typing | **node-id, typed, validated, OPTIONAL/nullable, advisory** | the LLM recomputes it from `now` + Graph; storing it is a cache, never authority |
| N4 | A parallel `name` beside the id? | **No** | the node already carries `label` (name) + `type` (→verb); a second name = guaranteed drift |
| N5 | A `next` with no node yet | **materialise an `assumed` node**, point `next` at it | reuses the existing status vocab; node-less affordances (deep-research, seams) live in `intent`/narration |
| N6 | Soft state | **per-nav `bag` — free-form, shallow-merge, no schema** | LLM is sole producer/consumer; holds qualifiers (mode, replan_reason, refinement, milestones, status) |
| N7 | Is `nav` required? | **Optional** — absent ⇒ rebuild from artifacts | direct-jump writes none (stays stateless by design); guided rebuilds on resume |
| N8 | What the CLI validates | **node-refs + structural integrity ONLY — never routing** | the reframe: database, not workflow |
| N9 | Existing `cursor`/`recommended_next` | **move them into `nav.now`/`nav.next`** (clean break) | one home for navigation; accept the renderer/fixture churn |
| N10 | Where `nav` lives | **CLI shared core (`FlowDoc`)** | reusable by `eng-harness-flow` |
| N11 | Progress rail | **derive via `harness flow rail`** (reads spine + live statuses); optional `nav.rail` curation override | rail is computed, never hand-stored — no drift; coach calls the command instead of tracking `milestones_*` |
| N12 | Rail bands | each spine node carries a **`zone` enum** (`preflight` \| `flight` \| `postflight`); rail renders `pre ─ [ flight ] ─ post` | deterministic bracket placement (the `[…]` = the flight zone, = today's `[build]` group); default-by-type when unset, `--zone` to override; named `zone` not `phase` to avoid colliding with the `phase` node *type* |
| N13 | Rail title (the `[the-flow]` prefix) | from the flow identity — **`provenance.agent`**, set via a new **`create --agent`** flag (Phase 1; **today it stamps `null`** — dogfood D-06); slug fallback until set; optional `title` override; **never** the filename/slug | new flows self-identify (`eng-harness-flow` → `[eng-harness-flow]`); the slug names the *instance* (wrong identity) |

---

## Contract 1 — the `nav` object (data shape)

```typescript
interface FlowDoc {
  // …existing typed core: schema_version, kind, slug, provenance, events[], nodes[]…
  nav?: Nav;                       // OPTIONAL — absent ⇒ rebuild from artifacts (N7)
}

interface Nav {
  now:   string;                   // node id — typed, validated (E305), the durable truth (N2)
  next:  string | null;            // node id or null — validated when set, advisory only (N3)
  intent: string | null;           // free-text "why now / what next in words"
  bag:   Record<string, unknown>;  // free-form qualifiers, shallow-merge, no schema (N6)
}
```

```jsonc
// example
"nav": {
  "now":  "ws-nav",
  "next": "plan",                  // null is valid — the LLM may recompute instead
  "intent": "two design workshops done; fold both into the Simple plan",
  "bag": { "mode": "Simple", "status": "active", "refinement": "nav-object" }
}
```

**Validated**: `now` (must be an existing node), `next` (must exist *when non-null*). **Not validated**: `intent`, every `bag` key — pure pass-through.

---

## Contract 2 — CLI surface

All verbs sit **under the `flow` act** — `harness flow nav …` (a flow mechanic operating on a flow file via `--path`/`--slug`), **not** a top-level `harness nav`. `nav` joins `cursor`/`status`/`insert-node` and **replaces** `cursor`. The `harness` top-level stays for ambient ops (`--version`, `doctor`, `update`).

| Verb (under `harness flow`) | Behaviour | Envelope `data` |
|---|---|---|
| `nav --show` | orientation read: nav + dereferenced now/next nodes + neighbours | `{now:{node}, next:{node}|null, intent, bag, predecessors[], successors[]}` |
| `nav set --now <id>` | set position (E305 if missing) | `{nav}` |
| `nav set --next <id>` / `--clear-next` | set/clear advisory next (validated when set) | `{nav}` |
| `nav set --intent "<text>"` | set intent (free-text) | `{nav}` |
| `nav meta set <key> <value>` | shallow-merge one key into `bag` | `{nav.bag}` |
| `nav meta unset <key>` | delete one bag key | `{nav.bag}` |

Neighbour objects in `nav --show` are **trimmed** (`{id,type,status,label,next}`), computed by a shared `predecessorsOf`/`successorsOf` util (reuse insert-node's reverse-edge scan). `meta get` is covered by `nav --show`; a standalone `nav meta get [key]` is optional.

**Migration of existing verbs (N9)**: `cursor --to <id>` → `nav set --now <id>`; `cursor --recommend <id>` → `nav set --next <id>`. The old `cursor` verb is **dropped** (clean break, per Q2) — `nav` is the only position verb.

**Rail (sibling verb, not under `nav`)**: `harness flow rail` emits the one-line rail — it walks the main spine (topo order, `branch_of` excursions excluded), one pip per node (`done`→`◆`, `in_progress`→`◐`, else `◇`) with names from node `label`, reading statuses **live** (no stored counters); the line is prefixed with the flow's **title** — `provenance.agent` (set via `create --agent`, **Phase 1**; `null` today per D-06, so it falls back to the slug until then), **never** the filename/slug, so a new flow shows its own (`[eng-harness-flow]`). Optional `--curated` reads `nav.rail` ids instead. This is what the coach calls in place of hand-tracking `milestones_*`. (The CLI render already emits this exact line — `rail` exposes just it.)

**Node `zone` field (new — drives the brackets, N12)**: each spine node carries `zone: "preflight" | "flight" | "postflight"`. `rail` renders three bands — `pre ─ [ flight ] ─ post` — where `[…]` wraps the flight zone (the core build; exactly today's `[build 2/3]` bracket, now deterministic and stable as the cursor moves). Unset ⇒ defaulted by node type (research/plan/workshop/tasks/adr → preflight; phase → flight; review/merge/retro → postflight); `add-node`/`insert-node` accept `--zone` to override. Example (026): `◆─◆─◆─[ ◇ ]─◇` = `Migration · WS Nav · Plan ─ [ P1 ] ─ Merge`.

---

## Contract 3 — routing fidelity (the four scenarios, mapped to `nav`)

| Scenario | How `nav` carries it |
|---|---|
| DRAFT vs READY re-plan | `now:plan`, `next:plan`, `bag.replan_reason:"draft"` — route + qualifier, no extra node |
| Refinement excursion (backpressure/workshop) | `now:<excursion>`, `next:plan` (the rejoin), `intent` says why |
| Resume after `/compact`, artifact missing | `nav` is convenience; artifacts remain the backstop — `now`=`known` node + no artifact ⇒ re-print, don't advance |
| Catch-up of a hand-run direct-jump | `nav` absent (direct-jump wrote none) ⇒ guided **rebuilds** `now` from artifact existence — statelessness preserved |

---

## Contract 4 — migration (supersedes 001 §Contract 4)

`.the-flow-state.json` → `nav`, one-shot on guided resume:

| Old state field | New home |
|---|---|
| `current_stage` (`awaiting-<id>`) | `nav.now` (node id via the Graph state→node map) |
| `pending_command` | dropped — re-derived from `nav.next` + Command grammar |
| `intent` | `nav.intent` |
| `mode`, `status`, `milestones_*` | `nav.bag.*` (milestones may instead be derived from node statuses — open) |

`nav.bag.status == "active"` present ⇒ already migrated (idempotent). Guided-resume owns the one-shot write; direct-jump never writes `nav`.

---

## Supersedes workshop 001

| 001 said | 002 says |
|---|---|
| D1 `cursor --show` read | folded into `nav --show` |
| D3 generic top-level `meta` bag | `bag` is **inside** `nav` (navigation-scoped); a separate flow-level `meta` only if non-nav soft state appears |
| `recommended_next` stays a separate top-level field | moved to `nav.next` (N9) |
| Contract 1 CLI surface | replaced by Contract 2 here |

001's Contract 2 (skill-edit map) + Contract 2b (CLI-site map) + Contract 3 (vibe change) still stand — they reference the same fields, now grouped under `nav`.

---

## Open Questions

### Q1: How does the progress rail get its fill? — RESOLVED
**RESOLVED (2026-06-18) — derive, via a new `harness flow rail` command.** The rail reads the existing DAG spine (nodes + `next` edges, topo order, `branch_of` excursions excluded), emitting one pip per spine node — `done`→`◆`, `in_progress`→`◐`, else `◇` — with names from each node's `label`. No stored milestone counters → no drift (the CLI render's `**Rail**:` line already does exactly this). The coach drops `milestones_*` and just calls `harness flow rail`. Pips are **per-node** (both workshops show as their own pip), so the old "collapse workshops into one pip" coach rule is retired. Optional `nav.rail = [ids]` curation override; default is derive-from-spine.

### Q2: Keep `cursor` as an alias, or hard clean-break?
**RESOLVED (2026-06-18) — clean break.** Drop `cursor` entirely; `nav` is the only position verb. No alias (flows are short-lived; 024's E308 set the clean-break precedent).

---

## Validation / Acceptance

Contract Ready when:
- `nav` shape + per-field typing/validation rules are explicit — ✅ (Contract 1)
- CLI surface names every verb + envelope — ✅ (Contract 2)
- All four routing-fidelity scenarios map onto `nav` — ✅ (Contract 3)
- The CLI-validates-vs-LLM-decides boundary is unambiguous — ✅ (the reframe table; N8)
- What it supersedes in 001 is explicit — ✅
