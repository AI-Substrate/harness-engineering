# Workshop: the-flow → cursor/meta flow-state migration

**Type**: CLI Flow + Migration (hybrid)
**Plan**: 026-the-flow-cursor-meta-migration
**Spec**: none yet (workshop-first; grounded in live skill files + CLI surface)
**Created**: 2026-06-18T06:39:21Z
**Status**: Draft

**Value Thesis**: Collapse the-flow's *two* state artifacts (`.the-flow-state.json` + `the-flow.json`) into **one** substrate the CLI owns, by making flow **position** (cursor) and **soft state** (a `meta` property bag) first-class `harness flow` primitives. The skill stops hand-authoring a state file and becomes a navigator that *reads position, reasons, marks position* — which is cheaper to maintain, survives `/compact` from one source, and gives `eng-harness-flow` the same primitives to reuse later.
**Target Proof Level**: Contract Ready (CLI surface + skill-edit map + migration path specified)
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Knowability**: one source of truth for "where am I" instead of a state file that can drift from the flight plan (resolves the CD-01 cursor-vs-substrate tension).
- **Implementation Readiness**: the CLI surface + skill-edit sites are enumerated concretely enough to build directly.
- **Migration Safety**: a clear path for the in-flight flows that still carry `.the-flow-state.json` (23 carry the file; 8 are `status:active`).
- **Learning Compounding / Agent Readiness**: the LLM does dispatch from knowledge it already holds (Registry/Graph) — no workflow engine to encode or drift.

**Related Documents**:
- `~/.claude/skills/the-flow/references/00-routing.md` (State contract, Graph, Flight-plan cadence — primary edit target)
- `~/.claude/skills/the-flow/references/coach.md` (rail, `/compact` resume handshake — secondary edit target)
- `~/.claude/skills/the-flow/SKILL.md` (Two load paths, § State, invariants)
- `docs/plans/024-first-class-flow-system/` (the flight-plan CLI this builds on)

---

## Purpose

Resolve **how** the-flow migrates off its dedicated rail-state file (`.the-flow-state.json`) onto cursor + a `meta` property bag carried by the flight plan, **where** every skill edit lands, and **how** the day-to-day operating "vibe" changes — so the follow-on Simple plan can be written and built without re-litigating the design.

## Fresh Entrant Outcome

A fresh agent should reach **Contract Ready** with no extra context — able to:
- Name the exact `harness flow` verbs to add/confirm and their envelopes.
- Point to the exact skill files + sections that change, and what each becomes.
- Execute the back-compat migration for an in-flight flow without data loss.

## Key Questions Addressed

1. What does the harness CLI gain (cursor get/set + `meta` bag), and what stays typed?
2. Where do the the-flow skill edits land, file by file?
3. How does the operating vibe change (before → after)?
4. What happens to existing `.the-flow-state.json` flows?

---

## Value Frame

| Field | Selection | Why It Matters |
|---|---|---|
| Target Proof Level | Contract Ready | Enough to write the Simple plan + build Phase 1 without re-deciding |
| Primary Value Axis | Knowability | One substrate for position kills drift between two state files |
| Supporting Axes | Implementation Readiness, Migration Safety, Agent Readiness | Build-ability + safe transition + no engine to encode |
| Downstream Loop Improved | Implementation + every future the-flow run | Skill drops dual-bookkeeping; resume reads one source |

---

## Decision Space

| # | Decision | Options | **Selected** | Rationale |
|---|---|---|---|---|
| D1 | Position read | (a) extend `show`; (b) **new read mode on `cursor`** | **`harness flow cursor --show`** (bare-read) | cursor-centric, returns a *focused* neighbour view, not the whole flow |
| D2 | Position write | keep `cursor --to <node>` | **keep, set-anywhere-that's-a-node** | already exists; only guard is node-exists (E305) — no graph/workflow rules |
| D3 | Soft state | (a) typed fields; (b) **open `meta` property bag** | **`meta` bag** | LLM is sole producer/consumer; a schema buys nothing (workshop'd already) |
| D4 | `meta` write semantics | replace-bag vs **shallow-merge** | **shallow-merge** (`meta set k=v` keeps other keys) | the one sharp edge; merge avoids clobber |
| D5 | Where `meta` lives | the-flow overlay vs **CLI shared core** | **CLI shared core (root shape)** | so `eng-harness-flow` flows inherit it later — the reuse payoff |
| D6 | `.the-flow-state.json` | clean break vs **read-time one-shot migration** | **one-shot migrate on resume** | gentler for ~8 in-flight flows; clean-break stays the fallback |
| D7 | Dispatch ("what's next") | engine vs **LLM intuits from Registry/Graph** | **LLM intuits** | no `workflow.json`, no `harness flow next` — non-goal confirmed |

---

## Contract 1 — CLI surface (what the harness gains)

Current `cursor` verb (probed live): `harness flow cursor --to <node>` (move) / `--recommend <node>` (advisory). It **sets** only — there is no neighbour-aware read. `meta` does not exist.

**Verified live (2026-06-18 dogfood):** `harness flow cursor --show` → `E108 unknown option`; `harness flow meta set …` → `E108 unknown command` (both net-new). `harness flow cursor --to <bogus>` → `E305 "no node with id …"` and the failed set writes nothing — so D2's node-exists guard **already holds** (doc-only, no code).

| Verb | Status | Behaviour | Example | Envelope `data` |
|---|---|---|---|---|
| `cursor --show` | **NEW (read)** | orientation read: cursor + current node + neighbours + recommended_next + meta | `harness flow cursor --show --path FLOW` | `{cursor, node, predecessors[], successors[], recommended_next, meta}` |
| `cursor --to <node>` | **keep** | move cursor to any **existing** node; `E305` if missing; no graph rules | `harness flow cursor --to plan` | `{cursor}` |
| `cursor --recommend <node>` | **keep** | advisory next; no event | `harness flow cursor --recommend plan` | `{recommended_next}` |
| `meta set <key> <value>` | **NEW** | **shallow-merge** one key into root `meta:{}` | `harness flow meta set intent "migrate to cursor/meta"` | `{meta}` |
| `meta get [key]` | **NEW** | read whole bag or one key (also surfaced in `cursor --show`) | `harness flow meta get mode` | `{meta}` or `{value}` |
| `meta unset <key>` | NEW (optional) | delete one key | `harness flow meta unset now` | `{meta}` |

**Stays typed (NOT in the bag)** — resume, the node-exists guard, and render depend on these: `cursor`, `recommended_next`, `provenance`, `slug`, `kind`, `schema_version`, `nodes[]`, `events[]`.

**`meta` bag** — a **named** root field `meta?: Record<string, unknown>` on `FlowDoc` (CLI shared core in `flow-events.ts`) — *not* the existing `[key: string]: unknown` pass-through, so it's a real, IDE-visible contract reusable by `eng-harness-flow` (D5). Free-form, no schema, default `{}`. Soft-convention keys (not enforced): `intent`, `mode`, `status`, `milestones_total`, `milestones_done`. (`now`/`next` are **derived** at render time from `cursor` + `recommended_next` — never stored, per 00-routing's "no derived rollup state".)

**`meta` semantics** — `meta set <key> <value>` is a shallow merge (`Object.assign`, no recursion); values duck-typed (string/number/bool/null; complex → string). `meta get <key>` on a missing key → `{value:null}` (not an error); `meta get` (no key) → the whole bag. `meta` initialises to `{}` on create; absent `meta` reads as `{}`.

### `cursor --show` (the orientation read) — JSON shape

```
$ harness flow cursor --show --path docs/plans/026-.../the-flow.json

{
  "command": "flow", "status": "ok",
  "data": {
    "cursor": "ws-migration",
    "node": { "id": "ws-migration", "type": "workshop", "status": "done", "label": "...", "next": ["plan"] },
    "predecessors": [],
    "successors": [ { "id": "plan", "type": "plan", "status": "known", "label": "Plan (Simple) ..." } ],
    "recommended_next": "plan",
    "meta": { "intent": "migrate to cursor/meta", "mode": "Simple", "status": "active" }
  }
}
```

> Neighbour objects are **trimmed** — `{id, type, status, label, next}` only, not full nodes. `predecessors`/`successors` come from a shared `predecessorsOf`/`successorsOf` util (reuse insert-node's reverse-edge scan in `flow-mutations.ts`), so the read and the renderer agree.

### Error codes

| Code | Cause | Status |
|---|---|---|
| `E305` | `cursor --to`/`meta` targets a node id that doesn't exist | exists today for node ops |
| (none) | `meta set` of a new key | success — merges into bag |

---

## Contract 2 — Where the skill edits land (the migration map)

| File · section | Today | Becomes |
|---|---|---|
| `SKILL.md` § Two load paths (Guided step 3) | "writes `.the-flow-state.json` directly, and drives the flight plan via `harness flow`" | "drives **position + soft state via `harness flow cursor`/`meta`**; the flight plan is the single state substrate" |
| `SKILL.md` § State | "Durable state lives at `.the-flow-state.json`, plus the flight plan" | "Durable state **is** the flight plan — `cursor` (position) + `meta` (intent/mode/status) + node statuses" |
| `SKILL.md` invariants (state-write) | implies a hand-written state file | "the CLI is the only state writer; no hand-authored state file" |
| `00-routing.md` § Entry paths | glob `.the-flow-state.json` where `status==active` | glob `the-flow.json`; read `meta.status==active` + `cursor` |
| `00-routing.md` § State contract | the `.the-flow-state.json` JSON block | **replace** with the cursor + `meta` contract (this workshop's Contract 1) |
| `00-routing.md` § State-write ownership | guided is sole writer of **3** files | guided drives **one** substrate via the CLI; direct-jump still writes nothing |
| `00-routing.md` § Routing markers | keys on `current_stage` + `pending_command` | keys on `cursor` + `recommended_next` (disk-artifact fallback unchanged) |
| `00-routing.md` § Flight-plan cadence | the `harness flow` call list | add `cursor --show` (resume/orient) + `meta set` (intent/mode/status); "advance = `cursor --to`" |
| `coach.md` § host rail | `milestones_done/total` from the state file | derive fill from node statuses **or** read `meta.milestones_*` |
| `coach.md` § `/compact` resume handshake | glob `.the-flow-state.json` | resume = `harness flow cursor --show` → re-derive from cursor + meta + artifacts |
| `coach.md` Summons / now·next | sourced from state file | sourced from `cursor` + `recommended_next` + `meta` |
| **DELETE** | `.the-flow-state.json` (file + all read/write prose) | gone — its fields move to cursor (`current_stage`), `recommended_next`/grammar (`pending_command`), and `meta` (`intent`/`mode`/`status`/`milestones`) |

---

## Contract 2b — CLI implementation sites (the Phase-1 build map)

Contract 2 maps the *skill* edits; the Phase-1 build is CLI work in **this** repo (`harness/cli/`). Those sites:

| File | Change |
|---|---|
| `services/flow/flow-events.ts` (`FlowDoc`) | add named root field `meta?: Record<string, unknown>` (the D5 "shared core" site) |
| `services/flow/flow-mutations.ts` | add pure `setMeta(doc,k,v)` (shallow-merge) + `getMeta`; add/export `predecessorsOf`/`successorsOf` (reuse the insert-node reverse-edge scan) |
| `acts/flow.ts` (cursor cmd, ~L199) | add `--show` flag + read handler → `{cursor, node, predecessors[], successors[], recommended_next, meta}` |
| `acts/flow.ts` | register a new `meta` subcommand group (`set` / `get` / `unset`) |
| `services/flow/flow-renderer.ts` | (optional) surface `meta.intent` in the render header |
| flight-plan schema + golden fixtures | regenerate fixtures (`scripts/flow-fixtures.mjs`); `meta` rides shared core — no the-flow overlay change |

---

## Contract 3 — How the operating vibe changes

| Aspect | Before (today) | After (cursor/meta) |
|---|---|---|
| State artifacts | **two** (`.the-flow-state.json` + `the-flow.json`) | **one** (`the-flow.json` with cursor + meta) |
| Who writes state | the **skill** (temp-file + atomic-rename prose) | the **CLI** (`cursor`/`meta`); skill only calls it |
| `pending_command` | **stored** in state, rendered at write time | **re-derived** each turn from `recommended_next` + Command grammar |
| Resume after `/compact` | glob + parse the state file | one call: `harness flow cursor --show` |
| Skill's role | bookkeeper (authors + syncs two files) | **navigator** (reads map → reasons → marks position) |
| Dispatch ("what's next") | from Graph prose → written into state | from Graph prose → cursor/meta (no engine, no `next` verb) |
| Guiding principle | remembered state | **substrate-authoritative** position (the harness ethos) |

> The "vibe" in one line: the LLM stops *transcribing* state and starts *reading a map and dropping a pin*. Same coaching voice, half the bookkeeping, one source of truth.

---

## Contract 4 — Migration of in-flight flows (D6)

One-shot, read-time, on the next guided resume (no separate migration tool):

```
on /the-flow resume:
  if the-flow.json has meta.status            → use cursor + meta (already migrated)
  elif .the-flow-state.json exists            → MIGRATE ONCE:
        cursor      ← (current_stage → node id via Graph)
        meta.intent ← state.intent
        meta.mode   ← state.mode
        meta.status ← state.status
        meta.milestones_total/done ← state.*
        harness flow cursor --to <node>; harness flow meta set ...
        leave .the-flow-state.json as a static record (or delete)
  else                                         → fresh/adopt per 00-routing.md
```

**Field map** (`.the-flow-state.json` → flight plan):

| Old state field | New home |
|---|---|
| `current_stage` (`awaiting-<id>`) | `cursor` → node id via the Graph state→node map (e.g. `awaiting-1b` → `plan`, `awaiting-6` → the phase node) |
| `pending_command` | dropped — re-derived from `recommended_next` + Command grammar |
| `intent` | `meta.intent` |
| `mode` | `meta.mode` |
| `status` | `meta.status` |
| `milestones_total` / `milestones_done` | `meta.milestones_*` (or derived from node statuses — Q2) |

**Who/when**: guided-resume (00-routing § Resume) owns the one-shot migration — it runs the `cursor --to` + `meta set` calls on the first resume that finds an un-migrated flow, then proceeds. `meta.status` present ⇒ already migrated (idempotent; never repeats).

Fallback: **clean break** (like 024's `E308`) — new flows use cursor/meta, old flows finish on the prior skill — is viable but rejected as default (gentler to migrate the in-flight flows: 23 carry the file, 8 active).

---

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|---|---|---|
| Implementation | "what state does the CLI need?" was open | CLI surface + envelopes enumerated (Contract 1) |
| The migration itself | "which files change?" was tribal | exact file·section map (Contract 2) |
| Every future the-flow run | dual-file bookkeeping each turn | one substrate; resume = one read |
| `eng-harness-flow` port | unclear if primitives reusable | `meta`/cursor in CLI core (D5) → reusable |

---

## Open Questions

### Q1: Does `cursor --to` already validate node existence?
**RESOLVED (dogfood 2026-06-18)** — `harness flow cursor --to no-such-node` → `E305 "no node with id …"` (emitted by `flow-mutations.ts` `nodeNotFound`); the failed set writes nothing (cursor unchanged). So **D2 is doc-only** — the set-anywhere-that's-a-node guard already holds; no code needed.

### Q2: Rail fill — derive from node statuses, or read `meta.milestones_*`?
**OPEN** — deriving from statuses is more substrate-honest (no stored rollup, matches 00-routing's "no derived rollup state"); `meta.milestones_*` is simpler for the coach. Lean: **derive**, fall back to meta if the coach needs an explicit total.

### Q3: `meta get`/`cursor --show` overlap?
**RESOLVED** — `cursor --show` includes `meta` in its envelope; `meta get` is the standalone bag read. Both exist; `cursor --show` is the one-call orient.

---

## Validation / Acceptance

This workshop reaches Contract Ready when:
- The CLI surface (Contract 1) names every verb, flag, envelope, and error path needed — ✅
- The skill-edit map (Contract 2) points to real files + sections that exist today — ✅ (grounded in the read files)
- The vibe change (Contract 3) is a concrete before/after, not a slogan — ✅
- The migration path (Contract 4) handles the in-flight flows without data loss — ✅
- Non-goals are explicit (no `workflow.json`, no `next` engine, no meta schema) — ✅ (D7)

---

## Validation Record (2026-06-18)

### Validation Thesis

**Raison d'être**: Resolve — before any plan/build — how the-flow migrates off `.the-flow-state.json` onto cursor + a `meta` property bag, where every skill edit lands, and how the operating vibe changes.
**Value claim**: The follow-on Simple plan + Phase-1 build proceed without re-litigating the design.
**Artifact promise**: The Simple plan folds D1–D7 in directly; the implementer builds Phase 1 from Contracts 1, 2b, 4.
**Intended beneficiaries**: the Simple `plan` stage, the Phase-1 implementer, future the-flow maintainers, the later `eng-harness-flow` port.
**Proof target**: Contract. **Evidence standard**: claims grounded in the real CLI surface + real skill files; migration handles in-flight flows.
**Thesis source**: `original-ask.md` — "workshop the migration of the-flow to new system (where skill edits are and how the vibe changes in how it operates)".
**Thesis verdict**: Advanced.
**Main thesis risk**: the operational impact of "read cursor → call CLI → read cursor" is only fully knowable after the Phase-1 dogfood (the workshop is honest about this — Q1 now resolved by dogfood; Q2 bounded).

| Agent | Lenses | Thesis axes | Issues | Verdict |
|---|---|---|---|---|
| Accuracy | Factual Accuracy, Concept Docs, Tech Constraints, Hidden Assumptions | Evidence Sufficiency | 1 (count) + nits → fixed | ⚠️→✅ |
| Decision + Evidence | Evidence Sufficiency, Proof-Level Fit, Contract Integrity, Impl Readiness | Contract Integrity, Impl Readiness | CLI-sites gap + meta edge-cases → fixed | ⚠️→✅ |
| Thesis Alignment | Thesis Alignment | all 9 failure modes | 3 LOW/MED → fixed | ✅ |
| Forward-Compatibility | Forward-Compatibility, Shape, Lifecycle, Contract Drift | Downstream Usefulness, Migration Safety | meta-field + sites + envelope shape → fixed | ⚠️→✅ |

### Forward-Compatibility Matrix (post-fix)

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|---|---|---|---|---|
| Simple `plan` stage (1b) | D1–D7 concrete + unambiguous | contract re-decision | ✅ | D1–D7 each have a Selected option + rationale |
| Phase-1 CLI build | CLI surface contract + build sites | encapsulation lockout | ✅ (post-fix) | Contract 1 + new **Contract 2b** map the verbs to real files/lines; "code not yet written" is Phase-1 scope by design |
| `harness/cli` source | where `cursor --show`/`meta`/root `meta:{}` land | shape mismatch | ✅ (post-fix) | Contract 2b names `flow-events.ts` FlowDoc field, `flow-mutations.ts` utils, `acts/flow.ts` verbs |
| the-flow skill files | edit-map sections exist | contract drift | ✅ | Contract 2 rows verified against live SKILL.md / 00-routing.md / coach.md sections; prose rewrite is the build's job |
| (future) eng-harness-flow port | `meta`/cursor reusable | encapsulation lockout | ✅ (post-fix) | D5 + Contract 2b specify `meta` as a **named** shared-core `FlowDoc` field, not the wildcard |

**Thesis alignment**: value claim advanced at the **Contract** proof level (target = actual); main risk — full operational feel awaits the Phase-1 dogfood, but Q1 is already dogfood-resolved.

**Outcome alignment** (Forward-Compat agent, verbatim): *"The workshop, as written, does not yet satisfy all downstream consumers — Consumer 2 (CLI build) and Consumer 3 (CLI source implementation sites) cannot start without resolving Issues #1–3."* — **Post-fix annotation (2026-06-18):** Issues #1–3 (named `meta` field, missing CLI-site map, neighbour-envelope shape) are now folded in via Contract 2b + the `meta`-field/semantics edits; the residual "verbs not yet coded" is Phase-1 scope by design, not a workshop defect.

**Standalone?**: No — downstream consumers exist (the `plan` node + Phase-1 build + `harness/cli` source).

**Overall: ⚠️ VALIDATED WITH FIXES**
