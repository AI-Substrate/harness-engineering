# Research Dossier: OOTB flight-plan starter — template-baked chores, `orient`, instructions, type-colour

**Generated**: 2026-06-29
**Query**: "Refine the OOTB flight-plan starter (D1–D6): template-baked chores + delete skill-side gate/§3b; `harness flow orient`; per-node `instructions[]`; colour-by-type + visual modifiers; orient-every-turn invariant; orient chore ticks."
**Effort**: Deep (3 independent workers)
**Tools**: Standard
**Evidence**: 8 current sources · 4 historical sources

## Answer

1. **D4 (instructions) is clean, mechanical plumbing** — `FlowNode` already round-trips unknown keys via an index signature, but D4 needs an explicit `instructions?: string[]` typed through five touch-points: `FlowNode`, `NodeSpec`/`specFrom`/`materialize`, the `nodeLabel` badge, `set-node` flags, and the schema. No architectural risk.
2. **D2 (`orient`) is a new read-only verb** composed from existing primitives — `renderRailLine` + the `nav.now` node + `listChores(doc, nav.now)`. **D6 falls out for free**: `orient` must call `listChores` (all statuses at the anchor, with pips) rather than `dueChores` (which already filters out done/skipped).
3. **D1's real work is "one source of truth", not deletion** — deleting the skill-side gate/§3b is easy; the catch is the **expander hardcodes** the per-phase chore shape, so the template must *become* the canonical shape and the expander must read it.
4. **D5 (type-colour) is a deliberate reversal of 039 AC-11** — it flips ~5 test assertions and forces golden-fixture regeneration; low architectural risk but a real, intentional regression surface.
5. **The one cross-cutting hazard is the doctrine-parity coupling + eng-harness-flow coexistence** — D1 changes the documented creation model, which is mirrored byte-identical across two repos and guarded by a parity check; and the "who owns the chore flag" question (the-flow vs eng-harness-flow) must be settled so baking chores into the template can't double-inject.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | `nodeClass` colours by chore **flag** first (`decision > chore > harness > status`) — the D5 reversal point | `harness/cli/src/services/flow/flow-renderer.ts:188-193` | D5: drop the `node.chore` branch → `decision > harness-type > status`; harness seams render `:::harness` again | High |
| F-02 | `FlowNode` has `[key: string]: unknown` (instructions round-trips) but no typed field | `harness/cli/src/services/flow/flow-events.ts:82-107` | D4: add `instructions?: string[]` for TS-enforced shape across reads | High |
| F-03 | `NodeSpec` / `specFrom` / `materialize` don't carry `instructions` (won't survive add/apply/set) | `harness/cli/src/services/flow/flow-mutations.ts:294-330, 935-951` | D4: add to `NodeSpec`, extract in `specFrom` (line ~948 pattern), spread in `materialize` (line ~328, mirror `artifacts`) | High |
| F-04 | `nodeLabel` already renders `💬N`/`📄N` badges — the `📝N` pattern slot | `harness/cli/src/services/flow/flow-renderer.ts:196-203` | D4: append `📝N` when `instructions` non-empty; **text stays out of the md** | High |
| F-05 | `set-node` verb has no instruction flags | `harness/cli/src/acts/flow.ts:507-553` | D4: add `--add-instruction` (append) · `--instructions "a\|\|b"` (replace) · `--clear-instructions`; merge like `--artifacts` | High |
| F-06 | No `orient` verb; `dueChores` excludes done/skipped, `listChores(doc, at)` keeps all at an anchor | `harness/cli/src/acts/flow.ts` (no `orient`) · `flow-mutations.ts` `listChores`/`dueChores`/`ChoreRow` | D2: new verb composing rail + node(label/command/instructions) + chores; **D6 uses `listChores`, not `dueChores`** (shows `■`/`▨`/`□`) | High |
| F-07 | The plan-complete **expander hardcodes** the per-phase chore shape (`boot-N`/`observe-N`/`retro-N`); it does **not** source it from the template | `…/the-flow/references/flight-plan-ops.md §3b:52-68` · `…/00-routing.md:50-53` | **D1 core:** make the template the canonical shape; rewire the expander to read it — else the §3b "hardcoded copy" drift just moves, not dies | High |
| F-08 | Schema declares `nodeTypes`/`statuses` only — no `instructions` field (node base fields live in CLI flow-core) | `…/the-flow/references/flight-plan.schema.json:1-24` | D4: declare `instructions` where per-node optional fields live (overlay or flow-core); confirm CLI validator side | Med |

## Historical Evidence

| ID | Prior decision | Source | Applicability now | Implication |
|----|---------------|--------|-------------------|-------------|
| H-01 | 039 **AC-11**: chore-**flag**-driven colour ("every harness touchpoint IS due upkeep" → teal) | `docs/plans/039-…/` plan + `flow-renderer.test.ts:446-538` · `flow-chore.test.ts` T011/T013 | **Direct** — D5 reverses it | Flips ~5 assertions + golden `.md` fixtures (`--check` will fail); regenerate intentionally, don't silently | 
| H-02 | 039 **R2 / AC-13**: bare-spine template + create-time conditional apply **gated** on router-installed AND repo-provisioned | `…/the-flow/references/harness-seams.md:20-21` (gate) · `flight-plan.template.json` `_comment` | **Direct** — D1 reverses it | Gate's reason = no-harness repos shouldn't point at uninstalled router; **we accept it** (chores skippable). Don't reintroduce a gate. |
| H-03 | eng-harness-flow injects fire-hooks as chores, **dedup on `--hook` token** — BUT Route A says the-flow is the **sole CLI writer** and eng-harness-flow is **stateless** | `skills/eng-harness-flow/references/flight-plan-ops.md:125-145` (dedup) **vs** `…/the-flow/references/harness-seams.md:119-127` (Route A stateless) | **Direct** — KEY coexistence question | Under Route A, baked-in template chores ⇒ no double-injection (eng-harness-flow writes nothing). Must **confirm** + keep exact `--hook` tokens so any R-1 back-compat dedup still matches. → workshop |
| H-04 | **doctrine-parity:039** marker binds `eng-harness-flow/SKILL.md` ↔ the-flow `harness-seams.md` byte-identical; a parity check (039 T017) enforces it | `skills/eng-harness-flow/SKILL.md:~40` · `…/harness-seams.md:~13` | **Direct** | D1 rewrites the "creation is three parts" doctrine → **update BOTH repos in one PR**; parity check fails if not |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| Doctrine-parity lockstep | H-04 | A one-sided edit fails the parity check + desyncs the doctrine across repos | Plan a single coordinated change touching both `SKILL.md` (here) + `harness-seams.md` (tools) |
| eng-harness-flow coexistence under D1 | H-03 | If both the template AND eng-harness-flow place chores, risk of double nodes / contract drift | Workshop: confirm Route-A "stateless" means template owns chores outright; decide if eng-harness-flow needs any change or doctrine-only |
| D5 fixture/test regen | H-01, F-01 | ~5 assertions + golden fixtures flip; a silent regen hides intent | Treat fixture regen as an explicit task; review the diff |
| No test pins the create shape | C-worker F5 | After D1 the template *is* the contract; nothing asserts "create yields the full deterministic spine" | Add a test: `create --template` → exact 9-node shape; document no-harness behaviour |

## Domain Impact

| Domain / boundary | Relationship | Contract or constraint | Evidence |
|-------------------|--------------|------------------------|----------|
| `harness flow` CLI (this repo) | Owns mutation/render/verbs | New `orient` verb, `instructions` field + flags, `nodeClass` change, `📝N` badge | F-01..F-06 |
| the-flow skill (tools repo) | Owns template/schema/routing/doctrine | Template becomes full seed; delete gate/§3b; expander reads template; new invariant; schema field | F-07, F-08, H-02, H-04 |
| eng-harness-flow skill (this repo) | Stateless router; doctrine-parity twin | Lockstep doctrine update; confirm no double-injection | H-03, H-04 |

## Planning Handoff

- **Preserve**: Route A "the-flow is the sole CLI writer; eng-harness-flow stateless" posture; the exact `run /eng-harness-flow --hook <x>` commands on chore nodes (dedup key); the positional invariant style (#9/#11); the byte-stable idempotent expander/reconcile contract.
- **Change carefully**: `nodeClass` (drags fixtures + tests — H-01); the **doctrine-parity block** (must stay byte-identical across two repos — H-04); the expander's chore-shape source (move into the template, F-07).
- **Likely files/symbols** — *CLI (this repo)*: `flow-renderer.ts` (`nodeClass`, `nodeLabel`), `flow-mutations.ts` (`NodeSpec`/`specFrom`/`materialize`, `listChores`), `flow-events.ts` (`FlowNode`), `acts/flow.ts` (`orient`, `set-node` flags), `test/services/flow/*` + golden fixtures. *the-flow skill (tools repo)*: `flight-plan.template.json`, `flight-plan-ops.md` §3b, `00-routing.md` (create + expander + reconcile), `harness-seams.md`, `SKILL.md`, `coach.md`, `flight-plan.schema.json`.
- **Decisions still required** (→ workshops): (a) the D5 **visual-modifier vocabulary**; (b) the **eng-harness-flow coexistence** contract under D1; (c) the **`orient` output format**.

## Workshop Opportunities

| # | Topic | Why it needs a workshop (not just a plan line) |
|---|-------|-----------------------------------------------|
| WS-1 | **D5 visual-modifier vocabulary** — how to express chore-ness / importance once colour is type-only | Open design space with real legibility tradeoffs: mermaid node shape (`([])`/`[[]]`/`{{}}`) vs `stroke-dasharray` vs a glyph badge vs importance→which lever. Authoritative decision shapes the renderer + every fixture. |
| WS-2 | **eng-harness-flow coexistence under D1** — who owns the chore flag once chores are template-baked | H-03's Route-A-stateless vs dedup-injection ambiguity + the doctrine-parity rewrite. A contract decision across two repos; getting it wrong double-injects or desyncs doctrine. (Could resolve as an ADR.) |
| WS-3 | **`orient` output format** (borderline) — exact lines/order, human vs `--json`, how instructions+chores+rail compose | It's the load-bearing UX for weak models (the whole point of D2/D6). Could be settled in-plan, but a focused contract avoids churn. |
