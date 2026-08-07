# Flow template / orient / instructions — OOTB starter refinement

**Mode**: Full
**Plan Version**: 1.0.0
**Created**: 2026-06-29
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates findings from `research-dossier.md` and the two authoritative workshops (`workshops/001-chore-shape-ownership-coexistence.md`, `workshops/002-d5-visual-modifier-vocabulary.md`). Locked decisions: `design-backlog.md` (D1–D6, C1).

---

## Business Specification

### Research Context

The flight-plan starter must "just work" out of the box without inference — especially on cheaper models that don't follow multi-step prose cadences. Today (post-039) chores are NOT in the template; they're applied conditionally by a gate + a hardcoded `§3b` batch that lives **in the the-flow skill**, so the skill carries weight for basic setup, and an agent only "sees" the flow if it reliably re-reads `nav` each turn. The dossier grounded six changes to exact `file:line`; two workshops settled the cross-repo contract (chore-shape ownership) and the render vocabulary (visual modifiers once colour is type-only).

### Summary

Make the OOTB flight-plan deterministic and self-driving: bake chores into the template (delete the skill-side gate/§3b), add a one-command `harness flow orient` surface, a per-node `instructions[]` field, an "orient every turn" invariant, type-driven node colour with icon/visual-modifier importance, and orient chore-status ticks — without coupling the standalone `eng-harness-flow` to `the-flow`.

### Goals

- A `harness flow create --template` call yields a complete, deterministic starter (no gate, no skill-side apply).
- `harness flow orient` gives a weak model one command to read "where I am / what to do next" — a read, not an inference.
- Per-node `instructions[]` carry authored + runtime guidance; a `📝N` badge marks presence; `orient` prints the text.
- Node colour encodes **type**; chore-ness/importance encode via badge + marker + border; the legend teaches it.
- `eng-harness-flow` stays fully standalone; the chore **shape** is owned by the shared doctrine, not by either consumer.

### Non-Goals

- A harness-side per-turn enforcement hook (true model-independent enforcement) — noted as a future ask (D3 caveat), out of scope here.
- Changing the five frozen lifecycle hooks or the `--json`/`--hooks` envelope contract.
- Re-architecting eng-harness-flow's standalone loop authoring (only the shared doctrine text changes).
- Migrating existing flows; this is additive to the create/render/mutation surface.

### Target Domains

> No `docs/domains/registry.md` exists in this repo — domain mapping is **informal** (by code area). G7 treats these as existing areas; no NEW domains are created.

| Domain (area) | Status | Relationship | Role in This Feature |
|---------------|--------|-------------|----------------------|
| `harness flow` CLI (`harness/cli/src/services/flow`, `src/acts/flow.ts`) | existing | **modify** | the field, the `orient` verb, the renderer changes |
| the-flow skill (`~/github/tools/skills/SDD/the-flow`) | existing | **modify** | template, expander, routing, invariant, schema, coach |
| eng-harness-flow skill (`skills/eng-harness-flow`, this repo) | existing | **consume/modify** | doctrine-parity twin; coexistence verification (no code-path change expected) |
| docs (`docs/how/harness-flow.md`) | existing | **modify** | CLI reference for `orient` + the instruction flags |

### Testing Strategy

- **Approach**: **Hybrid**. **Full TDD** for the CLI code (P1–P3) — vitest, tests before implementation, real flow JSON, golden render fixtures. **Lightweight/manual** for the skill-markdown + doctrine changes (P4–P5) — render-and-eyeball + the parity check; markdown carries no meaningful unit test.
- **Rationale**: `harness/cli` is already TDD with golden fixtures; the-flow skill references are prose/spec.
- **Focus areas**: instructions round-trip through create/apply/set-node; `orient` output contract; `nodeClass` type-colour; badge rendering; chore-status pips; fixture regeneration (intentional, reviewed).
- **Excluded**: unit tests for `.md` skill edits (verified by render + parity diff).
- **Mock usage**: **Avoid mocks** — tests build real `the-flow.json`, run real `create`/`apply`/`render`/`orient`, assert real output (matches repo convention).

### Documentation Strategy

- **Location**: **Hybrid** — `docs/how/harness-flow.md` (the CLI verb reference: `orient`, `set-node` instruction flags) **and** the the-flow skill references (`flight-plan-ops.md`, `SKILL.md` invariant, `flight-plan.schema.json`, `harness-seams.md`, `coach.md`). For D1/D3 the skill references **are** the spec, so they change as part of the work.
- **Rationale**: half the deliverable is documentation/skill behaviour.

### Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2 (CLI + renderer + skill + doctrine), I=2 (two repos, doctrine-parity coupling), D=1 (one new node field), N=1 (reverses two 039 decisions), F=1 (weak-model UX, determinism), T=2 (golden fixtures + cross-repo + parity check)
- **Confidence**: 0.80
- **Assumptions**: Route A holds (the-flow sole writer of `the-flow.json`); eng-harness-flow has no live path writing chores into an active `the-flow.json` (AC-11 verifies); CLI 0.6.0 surface is the target.
- **Dependencies**: cross-repo (tools repo + this repo); golden-fixture regen tooling.
- **Risks**: see `### Risks & Assumptions` and the implementation `### Risks` table.
- **Phases**: 5 (see Phase Index).

### Acceptance Criteria

- **AC-01** — `harness flow set-node --add-instruction "<t>"` appends to a node's `instructions[]`; `--instructions "a||b"` replaces; `--clear-instructions` empties. The field survives a `create → apply → set-node → render` round-trip. (D4)
- **AC-02** — A node with non-empty `instructions` renders a `📝N` badge in the `.md`; the instruction **text never appears in the diagram**. Label assembly order is `<label> 💬N 📄N 📝N 🧰<importance>`. (D4/WS-1)
- **AC-03** — `harness flow orient` prints, for `nav.now`: the rail + the current node (label, `command`, full `instructions` text) + the chores anchored at `nav.now` **with status pips** (`■` done / `▨` skipped / `□` todo) **and each chore's `🧰` + importance marker** (`°`/plain/`‼`), so importance is legible in the no-CSS text surface. (D2/D6/WS-1 rail parity)
- **AC-04** — `nodeClass` colours strictly by **type**: a chore-flagged harness node renders `:::harness`, not `:::chore`. Chore-ness shows via `🧰` badge + dotted edge; importance via a marker (`°`/plain/`‼`) **and** a classDef border (dasharray / stroke-width). (D5/WS-1)
- **AC-05** — The always-rendered legend is rewritten into two channels: the colour row drops `🧰 chore`; a badges row adds `📝 instructions` + the importance markers. (D5/WS-1)
- **AC-06** — `harness flow create --template <full>` yields the complete deterministic starter (`research → plan → [phase-1] → ship` + the 5 chores) in **one** call. The the-flow skill no longer carries a create-time conditional apply, a gate, or the `§3b` batch. (D1)
- **AC-07** — The plan-complete expander materialises per-phase chores from the **shared shape doctrine** (not a hardcoded copy); a multi-phase splice is byte-stable idempotent. (D1/WS-2/F-07)
- **AC-08** — `SKILL.md` carries a numbered hard invariant: *read `nav` + orient at the start of every guided turn* (positional, survives `/compact`), wired as a Tier-1 mechanical cadence step (sibling to `render`/reconcile), not prose memory. (D3)
- **AC-09** — `eng-harness-flow` stays standalone: **no runtime read from any the-flow file**; on a the-flow-less machine it authors its own `.harness/loop.flow.json` unaffected; the doctrine-parity check **skips gracefully** when the-flow isn't checked out. (WS-2/C1)
- **AC-10** — The `doctrine-parity:039` block is rewritten **byte-identical** in both `skills/eng-harness-flow/SKILL.md` (this repo) and the-flow `harness-seams.md` (tools repo) to the baked-template model; the parity check passes. (WS-2/H-04)
- **AC-11** — Verified: **no live eng-harness-flow path writes chores into an active `the-flow.json`** under Route A (else it is made inert / removed). (WS-2 Q1)
- **AC-12** — `harness checks` is green; golden render fixtures are regenerated **intentionally** to the new vocabulary (reviewed diff, not silent). (H-01)
- **AC-13** — The shipped template's spine + chore nodes carry **pre-authored `instructions[]`** (the "static bone"), so a fresh `harness flow create --template` → `orient` at `nav.now` immediately prints non-empty guidance with **no manual authoring**. (D4 "authored in the template")
- **AC-14** — the-flow `flight-plan.schema.json` declares `instructions`, and the CLI validator **accepts** a node carrying it (schema ↔ validator agree — no silent divergence). (D4/F-08)
- **AC-15** — `coach.md` states the `instructions`↔coach boundary: coach may elaborate but **never contradicts** a node's authored instructions (the spine owns the floor). (D4)

### Risks & Assumptions

- **Assume Route A** (the-flow sole writer). AC-11 verifies the assumption against eng-harness-flow's code before relying on it.
- **Fixture churn** (H-01): D5 flips ~5 assertions + golden `.md`; the regen must be reviewed, not rubber-stamped.
- **Cross-repo lockstep** (H-04): the parity block must land in both repos in one coordinated change; the parity check fails otherwise.
- **the-flow-less machines** (C1): the design must never make eng-harness-flow depend on a the-flow artifact at runtime.

### Open Questions

- None blocking. WS-2 Q1 (verify no live injection path) is carried as **AC-11** (a task, not an open question). WS-1 Q1 (exact importance glyphs) is a low-stakes cosmetic finalised during P3 implementation.

### Workshop Opportunities

| Topic | Type | Why Workshop | Status |
|-------|------|--------------|--------|
| Chore-shape ownership & eng-harness-flow coexistence | Integration Pattern | cross-repo contract; double-injection / parity risk | ✅ Resolved — `workshops/001-…` |
| D5 visual-modifier vocabulary | Render / Visual Design | open design space; shapes renderer + every fixture | ✅ Resolved — `workshops/002-…` |

### Clarifications

#### Session 2026-06-29
- **Workflow Mode**: Full — two repos, CLI + renderer + skill + doctrine, ~5 phases with real dependency boundaries.
- **Testing Strategy**: Hybrid — Full TDD for CLI (P1–P3), lightweight/manual for skill-doc (P4–P5).
- **Mock Usage**: Avoid mocks — real flow JSON + real render/orient.
- **Documentation Strategy**: Hybrid — `docs/how/harness-flow.md` + the the-flow skill references.
- **Implementation method**: delegated via **flow-pair** orchestration (whole-phase packets to a coder peer + a cross-model reviewer), as in plan 039.

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: **none — both resolved** (chore-shape ownership; D5 visual vocabulary).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | Key Findings, risk surface, exact file:line targets |
| workshops/001-chore-shape-ownership-coexistence.md | y | authoritative — ownership model, no-double-injection, command-token contract, self-containment |
| workshops/002-d5-visual-modifier-vocabulary.md | y | authoritative — colour=type, badge/marker/border mapping, legend rewrite, fixture regen |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round 1 answered; no `[NEEDS CLARIFICATION]` remain |
| G2 | Constitution | PASS | Additive CLI surface + dogfooded; no principle violated (KISS — one field, one verb, type-colour simplification) |
| G3 | Architecture | PASS | Changes stay within the existing flow-CLI layer + skill references; no layer/dependency breach |
| G4 | ADR Compliance | N/A | No `docs/adr/*.md` present |
| G5 | Structure | PASS | All required sections present + populated |
| G6 | Testing Alignment | PASS | Hybrid: CLI phases list test tasks before impl; skill-doc phases use render/parity verification |
| G7 | Domain Completeness | PASS | No formal domain registry — informal area mapping; no NEW domains; Domain Manifest covers all referenced files |

### Summary

Five phases on a clean dependency chain. P1 adds the `instructions[]` field (foundational — orient + badges depend on it). P2 adds the `orient` verb; P3 reworks the renderer (type-colour, badges, legend, fixtures) — both consume P1. P4 does the the-flow skill mechanics (full template, delete gate/§3b, expander reads the shape doctrine, the orient-every-turn invariant) and the docs. P5 lands the cross-repo doctrine-parity rewrite + the coexistence verification. Each phase is sized as a self-contained **flow-pair** packet (whole-phase delegation).

### Domain Manifest

| File | Domain (area) | Classification | Rationale |
|------|---------------|----------------|-----------|
| `harness/cli/src/services/flow/flow-events.ts` | cli-flow | internal | `FlowNode.instructions?: string[]` (P1) |
| `harness/cli/src/services/flow/flow-mutations.ts` | cli-flow | internal | NodeSpec/specFrom/materialize instructions; orient compose read (P1/P2) |
| `harness/cli/src/acts/flow.ts` | cli-flow | contract | `set-node` instruction flags (P1); new `orient` verb (P2) |
| `harness/cli/src/services/flow/flow-renderer.ts` | cli-flow | internal | `nodeClass` type-colour, `nodeLabel` `📝N`, importance border, legend (P3) |
| `harness/cli/test/services/flow/*`, `test/acts/flow.test.ts`, golden fixtures | cli-flow | internal | TDD + fixture regen (P1–P3) |
| `~/github/tools/skills/SDD/the-flow/references/flight-plan.template.json` | skill-the-flow | contract | full deterministic seed (P4) |
| `~/github/tools/.../flight-plan-ops.md` | skill-the-flow | contract | delete §3b; expander reads shape doctrine (P4) |
| `~/github/tools/.../00-routing.md` | skill-the-flow | contract | delete create-time gate/apply; expander wording (P4) |
| `~/github/tools/.../SKILL.md` | skill-the-flow | contract | orient-every-turn invariant (P4) |
| `~/github/tools/.../coach.md` | skill-the-flow | contract | orient ritual; instructions↔coach boundary (P4) |
| `~/github/tools/.../flight-plan.schema.json` | skill-the-flow | contract | declare `instructions` (P1 schema side / P4) |
| `docs/how/harness-flow.md` | docs | contract | `orient` + instruction flags reference (P4) |
| `skills/eng-harness-flow/SKILL.md` | skill-eng-harness-flow | contract | doctrine-parity block rewrite (P5) |
| `~/github/tools/.../harness-seams.md` | skill-the-flow | contract | doctrine-parity twin (P5) |
| `skills/eng-harness-flow/references/flight-plan-ops.md` | skill-eng-harness-flow | internal | AC-11 verify injection path inert (P5) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | The plan-complete expander **hardcodes** the per-phase chore shape (F-07) — deleting §3b alone just moves the copy | P4: expander materialises from the shared shape doctrine; one source of truth |
| 02 | Critical | A `doctrine-parity:039` block binds eng-harness-flow `SKILL.md` ↔ the-flow `harness-seams.md` byte-identical, parity-checked (H-04) | P5: rewrite both in one coordinated change; ensure the check passes |
| 03 | High | D5 reverses 039 AC-11 — ~5 test assertions + golden fixtures flip (H-01) | P3: rewrite assertions to type-colour; regenerate fixtures as a reviewed task |
| 04 | High | H-03 ambiguity: eng-harness-flow "injects dedup-keyed chores" vs "stateless under Route A" | P5/AC-11: verify no live injection path into an active `the-flow.json`; rely on Route A |
| 05 | High | C1: some machines have **0 the-flow**; eng-harness-flow must stay self-contained | P5: no runtime read from the-flow; parity check skips gracefully when absent |
| 06 | Medium | `FlowNode` round-trips unknown keys, but `NodeSpec`/`specFrom`/`materialize` drop `instructions` without explicit plumbing (F-02/F-03) | P1: thread `instructions` through all five touch-points |

### Phases

#### Phase Index

| Phase | Title | Primary Area | Objective (1 line) | Depends On |
|-------|-------|--------------|--------------------|------------|
| 1 | instructions[] field + set-node flags | cli-flow | Per-node `instructions[]` round-trips + runtime authoring | None |
| 2 | `orient` verb | cli-flow | One-command position read (rail + node + instructions + chore pips) | Phase 1 |
| 3 | Renderer: type-colour, badges, legend, fixtures | cli-flow | D5 colour-by-type + `📝N` + importance modifiers + legend rewrite | Phase 1 |
| 4 | the-flow skill: template + expander + invariant + docs | skill-the-flow | Bake chores in template; delete gate/§3b; expander reads shape; orient-every-turn invariant | Phases 2, 3 |
| 5 | Doctrine-parity lockstep + coexistence verify | skill-eng-harness-flow + skill-the-flow | Rewrite parity block in both repos; verify standalone/self-containment | Phase 4 |

#### Phase 1: instructions[] field + set-node flags

**Objective**: Add a per-node `instructions: string[]` that round-trips through every mutation and is authorable at runtime.
**Domain**: cli-flow
**Delivers**: typed `FlowNode.instructions`; `NodeSpec`/`specFrom`/`materialize` plumbing; `set-node --add-instruction` / `--instructions "a||b"` / `--clear-instructions`; schema declaration.
**Depends on**: None
**Key risks**: Missing a touch-point so the field silently drops on apply/insert (F-03).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 1.1 | Write failing tests: `instructions` survives `create→apply→set-node→render`; the three set-node flags behave (append/replace/clear); **an `apply` upsert batch run twice → byte-identical JSON** (the AC-07 idempotency guard) | cli-flow | tests red for the right reason | TDD; real flow JSON, no mocks |
| 1.2 | Add `instructions?: string[]` to `FlowNode` (flow-events.ts) | cli-flow | type compiles; round-trips | F-02 |
| 1.3 | Thread `instructions` through `NodeSpec`, `specFrom`, `materialize` (flow-mutations.ts) | cli-flow | add/apply/insert preserve it | F-03 |
| 1.4 | Add `--add-instruction` (append) / `--instructions` (replace, `||`-split) / `--clear-instructions` to `set-node` (acts/flow.ts) | cli-flow | flags merge like `--artifacts`; AC-01 green | mirror artifacts pattern |
| 1.5 | Declare `instructions` in the-flow `flight-plan.schema.json` (tools repo) | skill-the-flow | schema validates a node carrying instructions | D4 schema side |
| 1.6 | `harness checks --quick` green for the touched CLI | cli-flow | AC-01 satisfied | |

#### Phase 2: `orient` verb

**Objective**: One deterministic command that prints the current position so a weak model reads next-step instead of inferring it.
**Domain**: cli-flow
**Delivers**: `harness flow orient` composing rail + `nav.now` node (label/command/instructions full text) + chores-at-`nav.now` with status pips; `--json` form.
**Depends on**: Phase 1 (prints instructions)
**Key risks**: Using `dueChores` (filters done/skipped) instead of a position-scoped all-status read would drop the D6 ticks.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 2.1 | Write failing tests for the `orient` output contract (human + `--json`): rail line, node block, instructions text, chores WITH pips (■/▨/□) | cli-flow | tests red | D2/D6; AC-03 |
| 2.2 | Implement `orient` in acts/flow.ts, composing `renderRailLine` + node fields + `listChores(doc, nav.now)` (all statuses, **not** `dueChores`) | cli-flow | AC-03 green | D6 uses listChores |
| 2.3 | Register the verb + `--help`; update `docs/how/harness-flow.md` orient entry | docs | help + reference present | doc surface |
| 2.4 | `harness checks --quick` green | cli-flow | | |

#### Phase 3: Renderer — type-colour, badges, legend, fixtures

**Objective**: Once colour means type, re-encode chore-ness/importance via badge + marker + border, add the `📝N` badge, and rewrite the legend.
**Domain**: cli-flow
**Delivers**: `nodeClass` drops the chore branch (type-driven); `nodeLabel` `📝N` + importance marker; additive importance classDefs (dasharray / stroke-width); two-channel legend; regenerated golden fixtures.
**Depends on**: Phase 1 (the `📝` badge needs the field)
**Key risks**: Silent fixture regen hiding intent (H-01).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 3.1 | Rewrite failing tests: chore-flagged harness node → `:::harness`; `📝N` badge present; badge order `💬 📄 📝 🧰`; importance marker/border; new legend string | cli-flow | tests red against new target | per WS-1 worked example |
| 3.2 | `nodeClass`: drop `node.chore` branch → `decision > harness-type > status > unknown` (flow-renderer.ts) | cli-flow | AC-04 colour | F-01 |
| 3.3 | `nodeLabel`: append `📝N` + importance marker (`°`/plain/`‼`); add importance classDefs. Also `renderRailLine` `⚑ due:` chores carry `🧰` + the importance marker (rail parity — so `orient` inherits it) | cli-flow | AC-02, AC-04, AC-03 rail | order locked |
| 3.4 | Rewrite the legend line to two channels (colour row drops 🧰; badges row adds 📝 + importance) | cli-flow | AC-05 | flow-renderer.ts:103 |
| 3.5 | Regenerate golden fixtures; **review the diff** as an explicit task | cli-flow | AC-12; diff intentional | H-01 — not silent |
| 3.6 | Full `harness checks` green | cli-flow | AC-12 | |

#### Phase 4: the-flow skill — template + expander + invariant + docs

**Objective**: Make the template the full deterministic seed, delete the skill-side gate/§3b, have the expander read the shared shape, and add the orient-every-turn invariant.
**Domain**: skill-the-flow (tools repo) + docs (this repo)
**Delivers**: full `flight-plan.template.json`; `flight-plan-ops.md` §3b removed; `00-routing.md` create-time gate/apply removed + expander reads the shape doctrine (F-07); `SKILL.md` new invariant (D3); `coach.md` orient ritual + instructions↔coach boundary; `docs/how/harness-flow.md` finalised.
**Depends on**: Phases 2 (orient exists for D3/coach), 3 (render vocabulary stable)
**Key risks**: Expander left hardcoding the shape (F-07); the new template breaking a fresh `create` round-trip.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 4.1 | Rewrite `flight-plan.template.json` as the full deterministic starter (research→plan→[phase-1]→ship + 5 chores), **each node carrying pre-authored `instructions[]`** (the static bone) | skill-the-flow | `create --template` → 9-node spine in one call; `orient` at `nav.now` prints non-empty authored guidance; round-trip-verified | AC-06, AC-13 |
| 4.2 | Delete the create-time conditional apply + gate from `00-routing.md`; delete the §3b batch from `flight-plan-ops.md` | skill-the-flow | skill carries no setup-time apply | AC-06; D1 |
| 4.3 | Rewire the plan-complete expander to materialise per-phase chores from the **shared shape doctrine**; assert byte-stable idempotency in prose + example | skill-the-flow | AC-07 | F-07 — one source of truth |
| 4.4 | Add the hard invariant to `SKILL.md` (read nav + orient every turn; positional; Tier-1 cadence sibling to render/reconcile) | skill-the-flow | AC-08 | D3 |
| 4.5 | `coach.md`: the orient ritual + the instructions↔coach boundary (coach elaborates, never contradicts) | skill-the-flow | boundary stated | D3/D4 |
| 4.6 | Verify a fresh `harness flow create --template` + `render` produces the expected starter `.md` (manual, real run) | skill-the-flow | render matches | lightweight verify |
| 4.7 | Finalise `docs/how/harness-flow.md` (orient + instruction flags + create/template) | docs | reference complete | |

#### Phase 5: Doctrine-parity lockstep + coexistence verify

**Objective**: Land the cross-repo doctrine rewrite byte-identical and prove eng-harness-flow stays standalone/self-contained.
**Domain**: skill-eng-harness-flow (this repo) + skill-the-flow (tools repo)
**Delivers**: rewritten `doctrine-parity:039` block in both `skills/eng-harness-flow/SKILL.md` and the-flow `harness-seams.md`; verification that no live eng-harness-flow path writes chores into an active `the-flow.json`; the parity check passes + skips gracefully when the-flow is absent.
**Depends on**: Phase 4 (the doctrine reflects the final D1 model)
**Key risks**: Parity desync; an undiscovered live injection path.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|------------------|-------|
| 5.1 | Rewrite the `doctrine-parity:039` block to the baked-template / shared-shape model | skill-the-flow | text reflects D1 + WS-2 | AC-10 |
| 5.2 | Mirror it byte-identical into `skills/eng-harness-flow/SKILL.md`; run the parity check | skill-eng-harness-flow | parity check passes | AC-10; H-04 |
| 5.3 | Verify eng-harness-flow has no live path writing chores into an active `the-flow.json` under Route A (inspect `references/flight-plan-ops.md` injection triggers); make inert/remove if present | skill-eng-harness-flow | AC-11 satisfied | WS-2 Q1 |
| 5.4 | Confirm/strengthen: parity check (and any the-flow reference) **skips gracefully** when the-flow isn't checked out; no runtime read from the-flow | skill-eng-harness-flow | AC-09 | C1 self-containment |
| 5.5 | Full `harness checks` green across both touched repos | cli-flow + skills | AC-12 | |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.1, 1.2, 1.3, 1.4 | round-trip test green |
| AC-02 | 3.1, 3.3 | renderer test: `📝N` + order |
| AC-03 | 2.1, 2.2, 3.3 | orient output-contract test (incl. `🧰`+importance marker in the rail) |
| AC-04 | 3.1, 3.2, 3.3 | renderer test: `:::harness` + modifiers |
| AC-05 | 3.4 | legend assertion |
| AC-06 | 4.1, 4.2 | fresh `create --template` round-trip |
| AC-07 | 1.1, 4.3 | apply-twice byte-identical CLI test + expander-from-shape example |
| AC-08 | 4.4 | SKILL.md invariant present |
| AC-09 | 5.4 | no-the-flow run; parity skip |
| AC-10 | 5.1, 5.2 | parity check passes |
| AC-11 | 5.3 | injection-path verification |
| AC-12 | 3.5, 3.6, 5.5 | `harness checks` green; fixture diff reviewed |
| AC-13 | 4.1 | `create --template` → `orient` prints non-empty authored instructions |
| AC-14 | 1.5 | schema declares `instructions`; CLI validator accepts a node carrying it |
| AC-15 | 4.5 | coach.md states the instructions↔coach non-contradiction boundary |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Silent golden-fixture regen hides an unintended render change (H-01) | Medium | High | 3.5 makes the diff an explicit reviewed task |
| Doctrine-parity desync across repos (H-04) | Medium | High | P5 lands both in one coordinated change; parity check gates |
| Expander still hardcodes the chore shape after §3b deletion (F-07) | Medium | High | 4.3 explicitly rewires to the shared shape doctrine |
| A live eng-harness-flow injection path collides with template chores (H-03) | Low | High | 5.3 verifies under Route A; make inert if found |
| Cross-repo ship coordination (tools→main, this repo→PR) | Medium | Medium | ship per-repo; tools merges to main, this repo raises a PR (as in 039) |
