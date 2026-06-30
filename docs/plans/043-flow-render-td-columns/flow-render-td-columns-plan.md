# Flow render — TD two-column layout

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-30
**Status**: READY
**Spec source**: unified (this file)

📚 Incorporates `research-dossier.md`. Golden target: `reference-td-columns-format.md` (from `reference-flow-skew.json`).

---

## Business Specification

### Research Context

The sections layout (`flow-renderer.ts`, shipped `a37a601a`) killed the diagonal skew by splitting
the flow into one mini-mermaid per node. Prototyping a re-joined single diagram with **chores
combined into one box per node** read cleaner still — chosen layout: **TD two-column** (straight
spine left, chore gutter right). This swaps the layout back to one mermaid without the skew, because
the side-box count drops ~4× (one combined box per node, not one per chore).

### Summary

Replace the sections emission in `renderFlow` with a single `flowchart TD`: the spine as a connected
left column; each node's `branch_of` excursions collapsed into **one newline-joined gutter box**,
held in a column by invisible `~~~` links and pulled beside the node by dotted `-.-` links. Text
extras stay as spine-label badges. Match `reference-td-columns-format.md`.

### Goals

- One `flowchart TD` per flow (no per-node sections / `↓` joiners).
- One combined chore/excursion box per spine node (pip + importance marker per line).
- Spine reads as a straight left column; chores in a right gutter.
- All existing visual rules preserved (status, current, decision, importance, legend, rail).

### Non-Goals

- No new node *data* — purely a render change (`the-flow.json` schema untouched).
- No CLI verb / flag changes; `harness flow render` signature unchanged.
- Not chasing pixel-perfect row-alignment — dagre alignment is a best-effort bias.

### Target Domains

> Informal areas; no NEW domains.

| Domain (area) | Status | Relationship | Role |
|---|---|---|---|
| cli-flow (`harness/cli/src/services/flow/flow-renderer.ts`) | existing | **modify** | the layout swap |
| cli-flow tests + render fixtures | existing | **modify** | TDD rewrite + golden regen |

### Testing Strategy

- **Approach**: **Full TDD** — renderer is pure (`FlowDoc → string`); write failing tests for the
  TD-columns shape first, then implement; golden fixtures are the integration proof.
- **Focus**: single `flowchart TD`; combined gutter box per node; `~~~` chain + `-.-` links; badges
  preserved; no `↓`/sections; classDefs/legend/rail intact.
- **Excluded**: visual pixel-alignment (dagre bias, unprovable in a string test).

### Mock Usage

Avoid mocks — real `FlowDoc` fixtures + real render output asserted (repo convention).

### Documentation Strategy

Code-level; the module doc-comment in `flow-renderer.ts` updates to describe the TD-columns layout (replacing the sections description). No new `docs/how` page.

### Complexity

- **Score**: CS-3 (medium)
- **Breakdown**: S=1, I=0, D=0, N=1 (new combine+chain emission), F=1 (layout/skew UX), T=2 (842-line test + 5 goldens, hard-gated)
- **Confidence**: 0.8
- **Assumptions**: TD-columns held on the prototype; text-extras stay badges; agents→gutter box; 🗣 bubble dropped.
- **Phases**: 1 (Simple).

### Acceptance Criteria

- **AC-01** — `renderFlow` emits **one** `flowchart TD` for the whole flow (no per-node sections, no `↓` joiners); the spine is a single connected chain `research → … → ship`.
- **AC-02** — Each spine node's `branch_of` excursions (chores + workshops) render as **one combined box** (newline-joined lines, each with its status pip + importance marker), not one box per excursion.
- **AC-03** — Gutter boxes are chained by invisible `~~~` (column order = spine order) and linked to their parent by dotted `-.-`.
- **AC-04** — Text extras (`comments`/`artifacts`/`instructions`) stay as **spine-label badges** (`💬N 📄N 📝N`); no per-node comment body-log block in the diagram.
- **AC-05** — Non-chore side-content decided & implemented: **agents** (companion/worker) → a dedicated gutter box (not per-node sub-nodes); the per-node **🗣 `user_input` bubble is dropped** (no spine-skewing sub-node) — nothing re-introduces the diagonal.
- **AC-06** — Preserved: status classDefs, `current` highlight, `decision` rhombus, importance modifiers (`impOptional`/`impStrong`), the legend, and `renderRailBody` (rail unchanged).
- **AC-07** — The 5 golden render fixtures are regenerated **intentionally** (reviewed diff, not silent); `check:flows` and full `harness checks` are green.

### Risks & Assumptions

- **Re-skew** (H): a stray per-node sub-node (agent/user_input/comment body) brings the diagonal back — AC-05 enumerates every side-content kind and folds it to a gutter box / badge.
- **Hard gate** (H): `check:flows` fails on unreviewed golden drift — T005 regenerates + reviews all 5.
- **Alignment** (M): row-alignment is a dagre bias, not guaranteed — verify on fixtures, accept minor drift.

### Open Questions

- None blocking. Side-content mapping locked above (badges for text, gutter box for agents, drop 🗣).

### Workshop Opportunities

| Topic | Type | Why | Status |
|---|---|---|---|
| — | — | none — single locked layout, CS-3 | n/a |

### Clarifications

#### Session 2026-06-30
- **Workflow Mode**: Simple.
- **Testing**: Full TDD (renderer is pure + golden fixtures).
- **Mock Usage**: avoid mocks.
- **Layout**: TD two-column, per the preallocated reference + prototype.
- **Side-content**: text→badges, agents→gutter box, 🗣 bubble dropped (locked).

---

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none.

| Artifact | Present? | Effect on the plan |
|---|---|---|
| research-dossier.md | y | findings, file:line targets, the locked side-content decision |
| reference-td-columns-format.md | y | the golden target layout |
| workshops/*.md | n | — |

---

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|---|---|---|---|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]`; side-content mapping locked |
| G2 | Constitution | N/A | none present |
| G3 | Architecture | PASS | stays in the cli-flow render layer; pure function, no new deps |
| G4 | ADR Compliance | N/A | none |
| G5 | Structure | PASS | required Simple sections present |
| G6 | Testing Alignment | PASS | Full TDD — tests precede impl in the task table |
| G7 | Domain Completeness | PASS | informal; no NEW domains; manifest covers touched files |

### Summary

Swap the renderer's sections layout for a single TD two-column diagram. Pure-function change in
`flow-renderer.ts`, proven by failing-tests-first + an intentional regen of the 5 golden fixtures.
The only design call (non-chore side-content) is locked: badges for text, a gutter box for agents,
drop the per-node user-input bubble.

### Domain Manifest

| File | Domain | Classification | Rationale |
|---|---|---|---|
| `harness/cli/src/services/flow/flow-renderer.ts` | cli-flow | internal | the layout swap in `renderFlow` + helpers (T002–T004) |
| `harness/cli/test/services/flow/flow-renderer.test.ts` | cli-flow | internal | TDD rewrite of sections assertions (T001) |
| `harness/cli/test/acts/flow-render.test.ts` | cli-flow | internal | act-level render assertions (T001) |
| `harness/cli/test/services/flow/fixtures/render/*` | cli-flow | internal | golden regen (T005) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Current = sections (`renderFlow`, renderer:337,369). | T002 replace with TD-columns |
| 02 | High | Text extras already badges (`nodeLabel`:277-305). | T004 keep as-is (no body boxes) |
| 03 | High | Agents/user_input/comment-bodies are the *other* skew source. | T003 fold to gutter box / drop bubble (AC-05) |
| 04 | High | 5 goldens + 842-line test, `check:flows` hard gate. | T001/T005 rewrite + intentional regen |

### Implementation

**Objective**: Replace the sections layout with a single TD two-column diagram in `flow-renderer.ts`.
**Testing Approach**: Full TDD — failing tests first; golden fixtures regenerated intentionally.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|---|---|---|---|---|---|---|
| [ ] | T001 | Rewrite failing tests to the TD-columns shape: one `flowchart TD`; combined gutter box per node (newline lines + pips); `~~~` chain + `-.-` links; badges preserved; assert NO `↓`/per-node sections. | cli-flow | `test/services/flow/flow-renderer.test.ts`, `test/acts/flow-render.test.ts` | tests red for the right reason | TDD |
| [ ] | T002 | Implement TD-columns in `renderFlow`: spine chain + per-`branch_of`-parent combined gutter box (group excursions by parent, newline-join label+pip+marker) + invisible `~~~` chain + dotted `-.-` links. | cli-flow | `flow-renderer.ts` | AC-01/02/03 green | replaces sections emission |
| [ ] | T003 | Map non-chore side-content (AC-05): agents → one gutter box; drop the per-node 🗣 `user_input` bubble; comment-bodies stay badge-only. | cli-flow | `flow-renderer.ts` | AC-05 green; no per-node sub-node | re-skew guard |
| [ ] | T004 | Preserve classDefs / `current` / `decision` rhombus / importance modifiers / legend / `renderRailBody`; update the module doc-comment to describe TD-columns. | cli-flow | `flow-renderer.ts` | AC-06 green | keep visuals |
| [ ] | T005 | Regenerate the 5 golden fixtures (`npm run gen:flow-fixtures`); **review the diff** as an explicit step. | cli-flow | `test/.../fixtures/render/*` | AC-07; diff intentional | not silent |
| [ ] | T006 | Full `harness checks` green (incl. `check:flows` hard gate). | cli-flow | — | AC-07 | gate |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T001, T002 | single-flowchart test |
| AC-02 | T001, T002 | combined-gutter-box test |
| AC-03 | T001, T002 | `~~~`/`-.-` assertion |
| AC-04 | T001, T004 | badge-preservation test |
| AC-05 | T001, T003 | agents-box + no-bubble test |
| AC-06 | T001, T004 | classDef/legend/rail assertions |
| AC-07 | T005, T006 | fixture diff reviewed; checks green |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| A stray side-node re-introduces the skew | Medium | High | AC-05 enumerates every side-content kind → gutter box / badge |
| Silent golden drift slips through | Medium | High | T005 makes the regen an explicit reviewed step |
| Row-alignment drifts on some flow shapes | Medium | Medium | accept as dagre best-effort; verify on the 5 fixtures + flow-skew |
