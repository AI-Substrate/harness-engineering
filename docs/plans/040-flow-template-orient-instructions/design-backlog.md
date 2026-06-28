# the-flow template / orient / instructions — redesign backlog

> Accumulated during a design grilling session (pre-amble). **Nothing here is implemented yet** —
> when the pre-amble is done we kick off a real `/the-flow` to land all of it.
> Visual testbed: `sample-1/` (this folder — a from-scratch flow we keep re-rendering to eyeball).
> Cross-repo, like plan 039 was — see the file map at the bottom.

## Decisions locked

### D1 — Chores live in the TEMPLATE, deterministically (reverse the 039 split)
- The shipped seed is the **full template** (the 9-node starter: research → plan → [phase-1] → ship + the
  5 chores: backpressure, boot-1, observe-1, retro-1, retro-ship), **created in one `create --template` call**.
- **Delete** the bare-spine + create-time conditional `apply` + the router/provisioned **gate** + the §3b
  canonical batch that currently lives **in the the-flow skill** (`flight-plan-ops.md`). The the-flow skill must
  carry **zero weight for basic setup** — it just points `create` at the template.
- **No-harness case**: one template, **always 9 nodes**. Chores are optional/recommended + skippable, so an
  un-harnessed repo simply never runs them (harmless; reads as "here's how to adopt"). [user chose this]
- **Multi-phase expander stays** (splices phase-2..N + their per-phase trio at plan-complete) BUT must source
  the chore shape from the **template**, not a hardcoded skill copy → one source of chore truth (kills §3b-style drift).

### D2 — `harness flow orient` (new first-class CLI verb)
- One dead-simple command a (weak) model parrots every turn. Prints, for `nav.now`:
  rail + current node (label / `command` / **instructions**) + **due chores** ("things").
- Purpose: make "what do I do next" a **read, not an inference** — works on cheap models.

### D3 — "Orient every turn" becomes a hard invariant
- Promote *read-nav-and-orient-at-the-start-of-every-turn* to a numbered **SKILL.md invariant** (worded
  positionally like #9 — survives `/compact`), not diffuse `coach.md` prose.
- Honest caveat: guaranteed enforcement on an adversarially-weak model needs a **harness-side per-turn hook**
  (the skill can only instruct). That's a separate, bigger ask — note it, don't block on it.

### D4 — Per-node `instructions` field (`string[]`)
- A `string[]` on each node (mirrors `artifacts`); plain text for the **LLM to read** (entries may contain `\n`).
- **Authored in the template** (the static "bone") AND **authorable at runtime** via first-class `harness flow`:
  `set-node --add-instruction "<text>"` (append — the common path) + `--instructions "<a||b>"` (replace) +
  `--clear-instructions`. Agent can enrich an existing node **and** create new nodes that carry instructions.
- **Not rendered verbatim in the md** — instead an **icon badge** (e.g. `📝N`, like `💬N`/`📄N`) indicates presence.
- `orient` prints the `nav.now` instructions in full.
- Boundary: distinct from `comment` (historical timestamped log) and `note`. coach.md may *elaborate* but
  never *contradict* a node's instructions (spine owns the floor, coach.md owns the depth).

### D5 — Colour by TYPE always; importance/chore = icons / visual modifiers (reverse 039 AC-11)
- `flow-renderer.ts` `nodeClass` currently does `decision > chore > harness > status` (chore FLAG beats type).
  **Change to colour strictly by type** — a harness-seam node renders `:::harness` (purple) again regardless of
  the chore flag.
- Express **chore-ness / importance** through **icons or mermaid first-class visual concepts** instead:
  node shape (`([rounded])` / `[[subroutine]]` / `{{hex}}`), `stroke-dasharray`, a badge glyph, etc.
- (This is why `sample-1`'s chores render teal but the old `039-starter-template/the-flow.md` shows purple —
  the prototype md is a *stale* pre-AC-11 render. We're going back to the type-colour behaviour.)

## Decisions locked (cont.)

### D6 — orient chore display: show with a tick (not vanish)
- `orient` shows the **current node's chores with their status pip** — `■` done (tick) / `▨` skipped / `□` todo —
  so a (weak) model sees the checklist **completing**, not items silently disappearing.
- This is an **orient-render choice only** — it does NOT change `due_chores` (that read stays
  outstanding-only for "what's left"). orient additionally surfaces the done/skipped ones at `nav.now` as ticked.
- Net: while `nav.now` sits on a node, you see all its chores with state; they fall away naturally when the
  cursor moves on.

## Constraints (must hold)

### C1 — eng-harness-flow MUST stay standalone-capable (the-flow is optional)
- the-flow is **highly cohesive** with eng-harness-flow, but eng-harness-flow **runs standalone** — other teams may
  call eng-harness-flow stages **without the-flow at all** (its own `.harness/loop.flow.json`).
- So D1's "chores in the template" must NOT make the the-flow **template** the canonical home of the chore **shape**.
  The shared source of truth is the **seam/chore-shape doctrine** (the `doctrine-parity:039` block — the contract),
  with **two independent consumers**:
  - the-flow present → the-flow bakes the shape into its template (Route A, the-flow = sole writer; eng-harness-flow stateless).
  - the-flow absent → eng-harness-flow materializes the **same** shape into its own standalone loop flow.
- **Refines F-07**: the expander reads the **shape doctrine**, not "the template file"; coupling eng-harness-flow's
  standalone path to a the-flow artifact it may never have is the failure WS-2 exists to prevent.

## How chores express today (reference — confirmed live on sample-1)
- **Two reads**: `harness flow chores` = ALL chores (every anchor); `harness flow chores --at <node>` /
  `nav show.due_chores` = only chores **anchored** at that node (`branch_of`). orient uses the position-scoped read.
- A chore is "due" only while `nav.now` sits on its **anchor**; `due_chores` excludes `done`/`skipped`.
- Pips: `□` todo · `■` done · `▨` skipped · `▣` strongly-recommended-todo.

## Cross-repo file map (for the eventual /the-flow)
**tools repo — `/Users/jordanknight/github/tools/skills/SDD/the-flow/`** (the-flow skill SOURCE; never edit the `~/.claude` mirror):
- `references/flight-plan.template.json` — become the full 9-node deterministic seed (D1)
- `references/flight-plan-ops.md` — delete the §3b conditional-apply batch + gate prose (D1)
- `references/00-routing.md` — drop the gated create-time apply; expander sources chores from template (D1)
- `references/harness-seams.md` — reconcile the gate removal
- `SKILL.md` — new orient-every-turn invariant (D3); register `instructions` (D4)
- `references/coach.md` — orient ritual; instructions-vs-coach boundary (D3/D4)
- `references/flight-plan.schema.json` — declare `instructions` (D4)

**harness-engineering — `harness/cli/`** (CLI):
- `src/acts/flow.ts` — new `orient` verb (D2); `set-node --add-instruction/--instructions/--clear-instructions` (D4)
- `src/services/flow/flow-mutations.ts` — `instructions` in NodeSpec + preserve through mutations (D4)
- `src/services/flow/flow-events.ts` — type the `instructions` field (D4)
- `src/services/flow/flow-renderer.ts` — colour by type (D5); `📝N` badge (D4); importance→visual modifier (D5)
- tests for all of the above; `harness checks` green before ship
