# the-flow cursor/meta migration — flow CLI primitives

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-18
**Status**: READY
**Spec source**: unified (this file)

> ℹ️ No research-dossier; design is fully workshopped — incorporates `workshops/001` (migration map), `002` (nav/rail/zone contract), `003` (builder guide), all VALIDATED/grill-hardened. Research folded from those + the validation pass + live dogfooding (D-06).

---

## Business Specification

### Summary
Build the **flow CLI primitives** the-flow needs to migrate off `.the-flow-state.json`: a first-class **`nav`** object (`now`/`next`/`intent`/`bag`), a **`harness flow rail`** command, a per-node **`zone`** enum, and the **`create --agent`** fix. The CLI becomes a typed, validated *position/state database* (it validates node-refs + structure; the LLM dispatches). All primitives ship in the shared `FlowDoc` core so any future flow (`eng-harness-flow`, new skills) reuses them.

### Goals
- A single `nav` object carrying position (`now`), advisory route (`next`, nullable), `intent`, and a free-form qualifier `bag`.
- `harness flow nav show|set|meta` verbs (replacing `cursor`); `now`/`next` validated node-refs (E305), `next` nullable.
- `harness flow rail` — derives the one-line rail from the spine + live node statuses + `zone` bands + flow title.
- Per-node `zone` (`preflight|flight|postflight`) → rail renders `pre ─ [ flight ] ─ post`; default-by-type, `--zone` override.
- `harness flow create --agent <name>` (+ `--plan-id`) stamps `provenance` (fixes D-06) → rail title source.
- All primitives in the CLI shared core, reusable by any flow type.

### Non-Goals
- **The the-flow *skill* edits** (00-routing.md / coach.md / SKILL.md rewrites, dropping `.the-flow-state.json`, the one-shot resume migration) — that's **tools-repo work the user owns**, guided by workshops 001–003. This plan delivers the CLI substrate those edits depend on.
- No `workflow.json`, no `harness flow next` engine, no schema on the `bag` (D7 — the CLI never routes).
- No migration *command* in the CLI (the one-shot `.the-flow-state.json`→nav lift is guided-resume/skill logic).

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| flow (`harness/cli/src/services/flow` + `acts/flow.ts`) | existing | **modify** | add `nav`/`rail`/`zone` primitives + `create --agent`; move `cursor`/`recommended_next` into `nav` |

> No `docs/domains/registry.md` in this repo — the "flow" domain is identified inline: the cursor-spine flow DAG mechanics built in plan 024.

### Testing Strategy
**Approach**: Full TDD. **Rationale**: nav/meta mutations + node-ref validation are pure logic; rail render is deterministic → golden-fixture-able; matches the existing flow CLI's vitest + golden-fixture rigor. **Focus**: nav mutations, node-ref validation (E305), `meta` shallow-merge, neighbour computation, rail render (bands/pips/title), `create --agent` provenance. **Excluded**: none material. **Mock usage**: avoid mocks — real fixtures only (`flow-fixtures.mjs` runs the built bin).

### Documentation Strategy
**Location**: `docs/how/` — update `docs/how/harness-flow.md` (verb reference) with `nav`/`rail`/`zone` + `create --agent`. **Rationale**: that file is the canonical flow verb reference; workshop 003 seeds the builder how-to.

### Complexity
- **Score**: CS-3 (medium)
- **Breakdown**: S=2, I=1, D=1, N=1, F=1, T=1 (sum 7)
- **Confidence**: 0.85
- **Assumptions**: the 024 flow CLI architecture (act→service→pure mutations/events/renderer) is stable and extended in place.
- **Dependencies**: plan 024 flow CLI (shipped, v0.4.0).
- **Risks**: moving `cursor`/`recommended_next` into `nav` ripples to the renderer + golden fixtures (mitigated by TDD + the CI drift-guard).
- **Phases**: 1 (Simple, per `--simple`; cohesive single subsystem). Dense but one repo + one subsystem, so a single phase holds.

### Acceptance Criteria
- **AC-1**: `harness flow nav set --now <id>` moves position (E305 on missing); `--next <id>` sets advisory next (**also E305 on missing**) / `--clear-next` clears it → `nav.next: null`; `--intent "<t>"` sets intent. `nav show` returns `{nav: {now, next, intent, bag} | null, predecessors, successors}` — `nav` is **null** when the doc carries none (graceful, no error); `bag` nests **inside** `nav`, never flattened to the envelope root.
- **AC-2**: `harness flow nav meta set <k> <v>` shallow-merges into `bag` (other keys preserved); `nav show` surfaces `bag`.
- **AC-3**: nodes carry `zone`; `add-node`/`insert-node` accept `--zone`; unset → defaulted by type — `research/plan/workshop/tasks/adr → preflight`; `phase → flight`; `review/merge/retro → postflight` (per N12). The listed types are the the-flow overlay; **any unlisted/unknown type defaults to `flight`** (graceful fallback, never an error) — the default map is total over every overlay's `nodeTypes[]`.
- **AC-4**: `harness flow rail` emits `[<title>] ◆/◐/◇ … pre ─ [ flight ] ─ post`, pips from live status, names from `label`, title from `provenance.agent`, **falling back to `doc.slug` when `agent` is null** (intended graceful path, not an error — N13).
- **AC-5**: `harness flow create --agent <name> [--plan-id <id>]` stamps `provenance.agent`/`plan_id` (D-06 fixed) — verified non-null **when `--agent` is passed**. `--agent` omitted leaves `agent: null` (no error); the rail then uses the `doc.slug` fallback (AC-4) — direct/harness-less `create` stays valid.
- **AC-6**: `cursor`/`recommended_next` moved into `nav`; old `cursor` verb removed (clean break); renderer + golden fixtures updated; `flow-fixtures --check` (CI drift-guard) green; full vitest suite green.
- **AC-7**: `docs/how/harness-flow.md` updated with the new surface; the primitives dogfooded on flow 026's own flight plan.

### Risks & Assumptions
- Moving `cursor`/`recommended_next` is a breaking JSON-shape change → every reader + fixture updates in one pass (TDD + drift-guard catch regressions).
- `provenance` is stamped-once at create → `--agent` must be passed at create (can't be back-filled cleanly); acceptable (the skill knows its identity at create).
- **N5 (a `next` with no node yet) needs no special support**: create the node via `add-node --status assumed`, then `nav set --next` to it — so `next` is always a validated ref; node-less affordances (deep-research, seams) live in `intent`/narration, never in `next`.

### Open Questions
None blocking — workshops 001–003 resolved the design; Q1/Q2 (002) and Q1 (001, dogfood) closed.

### Workshop Opportunities
None — the design is fully workshopped (001/002/003).

### Clarifications
#### Session 2026-06-18
- **Workflow Mode**: Simple (via `--simple`).
- **Testing**: Full TDD. **Mocks**: avoid (real fixtures). **Docs**: `docs/how/`.

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved (001/002/003).

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | n | — (design fully workshopped) |
| workshops/*.md | y | authoritative design decisions (001/002/003) — folded in |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round 1 answered; no NEEDS CLARIFICATION markers |
| G2 | Constitution | PASS | `docs/project-rules/constitution.md` exists; aligns — clean arch, interface-first, real fixtures, stable envelopes + E-code diagnostics |
| G3 | Architecture | PASS | `docs/project-rules/architecture.md` exists; changes stay within flow subsystem layering (act → service → pure mutations/events/renderer) |
| G4 | ADR Compliance | N/A | no Accepted ADR contradicted (extends 024 consistently) |
| G5 | Structure | PASS | all required sections present + populated |
| G6 | Testing Alignment | PASS | Full TDD — test tasks precede impl per area; ACs measurable |
| G7 | Domain Completeness | PASS | flow domain identified inline; manifest covers all referenced files |

### Summary
Extend the 024 flow CLI in place: add the `nav` object + verbs, the `rail` command, the `zone` node field, and the `create --agent` fix — all in the shared `FlowDoc` core. TDD throughout; the deterministic render is golden-fixtured. Delivered as one cohesive phase; the the-flow skill migration (tools repo) consumes these primitives afterward.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/flow/flow-events.ts` | flow | contract | `FlowDoc`/`FlowNode` shape: add `nav`, `zone`; move `cursor`/`recommended_next` into `nav` |
| `harness/cli/src/services/flow/flow-mutations.ts` | flow | internal | nav mutations (setNow/Next/Intent/Meta, getMeta), `predecessorsOf`/`successorsOf`, zone defaulting |
| `harness/cli/src/services/flow/flow-renderer.ts` | flow | internal | rail render (bands/pips/title); nav/zone in the `.md` render |
| `harness/cli/src/services/flow/flow-service.ts` | flow | internal | wire new ops into the service surface |
| `harness/cli/src/acts/flow.ts` | flow | contract | `nav` verb group, `rail` verb, `--zone` on add/insert, `--agent`/`--plan-id`/`--title` on create; remove `cursor` |
| `harness/cli/src/services/flow/schemas-content.ts`, `flow-schema.ts` | flow | contract | descriptor: `root.optional` += `nav` (drop `cursor`/`recommended_next` from root); `node.optional` += `zone` |
| `harness/cli/test/services/flow/*.test.ts` | flow | internal | TDD specs (events/mutations/renderer/service) |
| `harness/cli/test/services/flow/fixtures/render/*` | flow | internal | golden fixtures regenerated for nav/zone/rail |
| `docs/how/harness-flow.md` | flow | contract | verb reference updated |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `provenance.agent`/`plan_id` are `null` on real `create` (D-06, dogfood-confirmed); the fixture's values were hand-authored | add `create --agent`/`--plan-id`; rail title = `provenance.agent` → slug fallback (T011–T012) |
| 02 | High | `cursor`/`recommended_next` are top-level today (`flow-events.ts`, read in `acts/flow.ts:80-81`) | move into `nav`; update every reader + golden fixtures in one pass (T001–T002, T013) |
| 03 | High | `cursor --to` already validates node existence (E305, dogfood-confirmed) | `nav set --now/--next` reuses `nodeNotFound`; D2 is doc-only, no new validation logic (T004) |
| 04 | Medium | neighbour computation (`predecessorsOf`/`successorsOf`) has no shared util; insert-node does a reverse-edge scan | extract a shared util, reuse in `nav show` + `rail` (T004, T010) |
| 05 | Medium | rail line already emitted by `render`; `rail` should expose just that line + zone bands | factor the rail render so `render` and `rail` share it (T009–T010) |

### Implementation

**Objective**: Ship the `nav`/`rail`/`zone` primitives + `create --agent` in the flow CLI, TDD, with golden fixtures and docs.
**Testing Approach**: Full TDD — test tasks precede impl per area; real fixtures (no mocks); golden fixtures for render; `flow-fixtures --check` drift-guard.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [x] | T001 | Tests: `Nav` shape + `setNow/setNext(null)/setIntent`; **E305 on a missing ref for BOTH `now` and `next`**; `next` nullable | flow | `harness/cli/test/services/flow/flow-events.test.ts`, `flow-mutations.test.ts` | red tests assert nav shape + now/next validation + nullable next | TDD-first |
| [x] | T002 | Add `Nav` interface + `nav?` to `FlowDoc`; move `cursor`/`recommended_next` → `nav.now`/`nav.next` | flow | `harness/cli/src/services/flow/flow-events.ts` | T001 green; old top-level fields gone | Finding 02; breaking shape |
| [x] | T002a | Update schema descriptor + its test: `root.optional` += `nav` (drop `cursor`/`recommended_next` from root); `node.optional` += `zone` | flow | `harness/cli/src/services/flow/schemas-content.ts`, `test/services/flow/flow-schema.test.ts` | descriptor validates nav/zone docs; old top-level cursor/recommended_next no longer at root | schema-gap fix — validation must track the shape change |
| [x] | T003 | Tests: `setMeta` shallow-merge + `getMeta` + `predecessorsOf`/`successorsOf` | flow | `harness/cli/test/services/flow/flow-mutations.test.ts` | red tests assert merge keeps other keys + neighbour sets | TDD-first |
| [x] | T004 | Implement nav mutations + shared neighbour util (reuse insert-node scan) | flow | `harness/cli/src/services/flow/flow-mutations.ts` | T003 green | Findings 03, 04 |
| [x] | T005 | Tests: `nav show`/`set`/`meta` act behaviour + envelopes; **nav-absent → show/render don't crash** (rebuild-from-artifacts is skill-side, Non-Goal) | flow | `harness/cli/test/services/flow/flow-service.test.ts` | red tests assert envelope shape + graceful absent-nav | TDD-first |
| [x] | T006 | Implement `harness flow nav` group (show/set/meta); **remove** `cursor` verb; **audit every reader** of `doc.cursor`/`doc.recommended_next` → migrated to `nav.now`/`nav.next` (no silent stale reader survives the move) | flow | `harness/cli/src/acts/flow.ts`, `flow-renderer.ts`, `flow-mutations.ts` | T005 green; `cursor` gone; `nav` works; **no `doc.cursor`/`doc.recommended_next` access remains** (grep-clean) | clean break (Q2); Finding 02 |
| [x] | T007 | Tests: node `zone` + `--zone` on add/insert + default-by-type — cover **every** overlay `nodeType` + an unknown type → `flight` fallback | flow | `harness/cli/test/services/flow/flow-events.test.ts`, `flow-service.test.ts` | red tests assert zone + defaults for all types incl. unknown→flight | TDD-first |
| [x] | T008 | Add `zone` to node shape; `--zone` on `add-node`/`insert-node`; default-by-type with **unknown→`flight`** fallback (total map) | flow | `harness/cli/src/services/flow/flow-events.ts`, `acts/flow.ts` | T007 green | N12 |
| [ ] | T009 | Tests + golden fixture: `rail` render (`[title]` + pips + `pre ─ [flight] ─ post`) | flow | `harness/cli/test/services/flow/flow-renderer.test.ts`, `fixtures/render/*` | red tests + fixture assert bands/pips/title | TDD-first; Finding 05 |
| [ ] | T010 | Implement `harness flow rail` (spine walk, status pips, zone bands, title `provenance.agent`→slug) | flow | `harness/cli/src/services/flow/flow-renderer.ts`, `acts/flow.ts` | T009 green; `harness flow rail` emits the line | N11/N13 |
| [x] | T011 | Tests: `create --agent/--plan-id` stamps provenance | flow | `harness/cli/test/services/flow/flow-service.test.ts` | red test asserts non-null agent/plan_id | TDD-first; D-06 |
| [x] | T012 | Add `--agent`/`--plan-id`/`--title` to `create`; stamp provenance (`--agent` omitted → `agent: null`, no error — rail uses slug fallback) | flow | `harness/cli/src/acts/flow.ts`, `flow-service.ts` | T011 green | Finding 01 |
| [ ] | T013 | Regenerate golden fixtures; `flow-fixtures --check` + full vitest suite green | flow | `harness/cli/test/services/flow/fixtures/*`, `scripts/flow-fixtures.mjs` | drift-guard + suite green | AC-6 |
| [ ] | T014 | Update `docs/how/harness-flow.md`; dogfood the new verbs on flow 026 | flow | `docs/how/harness-flow.md` | doc reflects nav/rail/zone/create --agent; 026 driven via `nav`/`rail` | AC-7 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-1 | T001, T002, T005, T006 | nav set/show tests + E305 |
| AC-2 | T003, T004, T005, T006 | meta shallow-merge test |
| AC-3 | T007, T008 | zone + default-by-type tests |
| AC-4 | T009, T010 | rail render golden fixture |
| AC-5 | T011, T012 | create provenance test |
| AC-6 | T002, T002a, T006, T013 | drift-guard + full suite |
| AC-7 | T014 | doc diff + 026 dogfood |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Moving cursor/recommended_next breaks renderer/fixtures | High | Medium | TDD + `flow-fixtures --check` drift-guard catch every reader in one pass |
| `nav show` neighbour shape over-fetches | Low | Low | trimmed neighbour objects `{id,type,status,label,next}` (workshop 002) |
| Skill migration (tools repo) lags the CLI | Medium | Low | Non-Goal here; workshops 001–003 are the hand-off contract; clean-break E308 precedent. **Deploy order: ship the CLI before the migrated skill** — the old skill calling `cursor` against the new CLI is a known reverse-skew the skill migration resolves (not this plan); **no `cursor` alias / grace period** (an alias re-introduces the legacy cruft the clean break removes) |

---

## Validation Record (2026-06-18)

**Auto-run** `/validate-v2` (narrow, 3 agents — design already grill-hardened + workshop-validated).

| Agent | Lenses | Issues | Verdict |
|-------|--------|--------|---------|
| Coherence + Completeness | Coherence, Completeness, Contract Integrity, Testing Alignment | 1 (G2 N/A wrong), 1 (schema-descriptor task missing) → fixed; CS-3 noted borderline | ⚠️→✅ |
| Thesis Alignment | Thesis, Proof-Level Fit | next-validation wording, N5 defer, nav-absent, zone-map → clarified | ✅ (Implementation, advanced) |
| Forward-Compatibility | Forward-Compat (5 modes) | fixture-list/skill-compat doc gaps (minor) | ✅ all 4 consumers satisfied |

**Fixes applied**: G2→PASS + G3 note (project-rules exist); added **T002a** (schema descriptor); clarified `next` E305 validation (AC-1/T001); clarified **N5** = assumed-node + `nav set --next` (no special support); added nav-absent graceful test (T005); expanded AC-3 zone-default map.

**Thesis alignment**: design is **Contract-Ready**; it *targets* the **Implementation** proof level via 14 TDD tasks (the Phase-1 build) — the primitives are specified + source-verified, **not yet coded**. Main risk — full operational feel awaits the Phase-1 dogfood (Q1 already dogfood-resolved; D-06 folded in as Finding 01).

**Outcome alignment** (Forward-Compat agent, verbatim): *"The plan advances the VPO Outcome by delivering all CLI primitives the workshops require (nav/rail/zone/create --agent in the shared FlowDoc core) in a buildable, tested, 14-task phase with TDD discipline; minor documentation gaps in task specificity do not block Phase-1 implementation."*

**Standalone?**: No — consumers: Phase-1 build, the tools-repo skill migration, the future eng-harness-flow port.

**Overall: ⚠️ VALIDATED WITH FIXES** — Status remains READY.

---

## Validation Record — Pass 2 (2026-06-18, pre-build gate)

**Scope**: broad, 4 agents — re-validating the *as-fixed* plan against the **live CLI source** before the Phase-1 build (Pass 1 validated the pre-fix draft). Thesis + VPO as in Pass 1.

| Agent | Lenses | Issues | Verdict |
|-------|--------|--------|---------|
| Coherence + Source-Truth | Coherence, Integration & Ripple, Technical Constraints, Concept Docs | 0 — **100% source-truth verified** (all 5 Key Findings, Domain Manifest rows, test files, fixtures dir, `flow-fixtures --check`) | ✅ |
| Completeness + Risk + CS | Edge Cases, Hidden Assumptions, Evidence Sufficiency, Deployment & Ops | AC-1 shape, zone-map completeness, reader-audit; **CS-3 confirmed honest** | ✅ (fixes applied) |
| Thesis Alignment | Thesis, Proof-Level Fit, System Behavior | proof-level wording over-stated → corrected; **boundary intact (CLI never routes)** | ✅ (Contract-Ready → targets Implementation) |
| Forward-Compatibility | Forward-Compat (5 modes), Domain Boundaries, Contract Integrity | 3/4 consumers ✅; cursor clean-break deploy-order + AC-1/AC-5 shape | ✅ (fixes applied) |

**Fixes applied (6)**: AC-1 `nav show` shape (nested `nav`, null-when-absent, `--clear-next`→null); AC-3 + T007/T008 zone unknown→`flight` total-map fallback; T006 reader-audit (no silent stale `doc.cursor`/`recommended_next`); AC-4/AC-5/T012 slug-fallback when `--agent` omitted (intended); Risk row 3 deploy-order (CLI before skill); Pass-1 thesis-alignment line corrected to Contract-Ready/targets-Implementation.

**Rejected (2 — contradict the endorsed design)**: a `cursor`→`nav` alias / grace period (re-introduces the legacy cruft the clean break removes); making `--agent` required (breaks harness-less `create`; the slug fallback is the intended path per N13).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Phase 1 build (T001–T014) | buildable tasks, accurate refs, testable ACs | n/a | ✅ | task↔AC map complete; source-truth 100% |
| tools-repo skill migration | nav/rail/zone + create --agent exist + match workshops 001–003 | contract drift | ✅ (deploy-order noted) | surface delivered; clean break safe under CLI-before-skill deploy order |
| eng-harness-flow port | nav/rail/zone in shared `FlowDoc` core | encapsulation lockout | ✅ | T001–T002 add to `flow-events.ts` (shared); N10 |
| new-flow authors (workshop 003) | primitives behave as documented | shape mismatch / test boundary | ✅ | AC-1–AC-4 deliver verbs; AC-1 shape now explicit |

**Thesis alignment**: value claim advanced; proof Target=Implementation / Actual=Contract-Ready (code is the Phase-1 build); main risk — proof-level wording (now corrected) could otherwise mislead a builder into assuming the primitives are coded.

**Outcome alignment** (Forward-Compat agent, verbatim): *"The plan advances the VPO Outcome ('typed, validated position/state database…the LLM dispatches') by delivering all promised CLI primitives (nav/rail/zone/create --agent in the shared FlowDoc core) in a buildable, tested, 14-task phase with TDD discipline; however, the clean break of cursor verb removal is a forward-compat hazard that is safe only if the tools-repo skill migration is committed before Phase 1 ships in production."*

**Overall: ⚠️ VALIDATED WITH FIXES** — Status remains READY; build-ready.
