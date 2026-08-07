# Research dossier — flow-render-td-columns

**Created**: 2026-06-30 · **By**: /the-flow 1a explore · **Mode target**: Simple

## Intent

Replace the per-node **sections** layout in `flow-renderer.ts` (shipped `a37a601a`) with the
**TD two-column** format chosen after prototyping: one `flowchart TD`, straight spine in the left
column, each node's chores **combined into one box** in a right gutter (held in a column by
invisible `~~~` links, pulled beside the node by dotted `-.-` links). Golden target:
`reference-td-columns-format.md` (rendered from `reference-flow-skew.json`).

## The core decision the plan must resolve

The prototype only handled **chores**. The real renderer also emits **other side-content** that
was *also* part of the original skew — and the plan must decide how each maps into the single
TD-columns mermaid without re-introducing it:

- **comments / instructions / notes** → already counts as **badges on the spine label**
  (`nodeLabel`, `flow-renderer.ts:277-305`: `💬N 📄N 📝N`). **Recommendation: keep as badges** —
  text stays in `orient`/JSON, never in the diagram. No new boxes.
- **chores + workshops (`branch_of` excursions)** → **one combined gutter box per parent**
  (the chosen format). NEW grouping logic.
- **agents (companion/worker) + `user_input` 🗣 bubble** → present in other fixtures
  (`kitchen-sink`), absent in `flow-skew.json`. **Decision needed**: fold to the gutter / a single
  side-node / a badge — must not re-skew. Recommendation: a small dedicated gutter box (agents) +
  drop the per-node 🗣 bubble (keep `user_input` as a badge or omit).

## Key findings (grounded)

| # | Impact | Finding | Evidence |
|---|--------|---------|----------|
| 01 | Critical | Current layout = **sections** (one mini `flowchart LR` per spine node, joined by `↓`); this is what gets replaced. `renderFlow` is the entry. | `flow-renderer.ts:18,337,369-379` |
| 02 | High | The TD-columns box-combining + invisible-chain + dotted-link emission is **new**; chores must be grouped by `branch_of` parent and newline-joined with pip + importance marker. | prototype `reference-td-columns-format.md`; `isExcursion` :328 |
| 03 | High | Text extras are **already badges** (`💬📄📝🧰`) — so "text→badges, not boxes" is mostly a *keep*, not new work. | `nodeLabel` :277-305 |
| 04 | High | All visual rules to **preserve**: status classDefs, `current` highlight, `decision` rhombus, importance modifiers, legend, rail. | classDefs :148-181, legend :181, `renderRailBody` |
| 05 | High | **dagre alignment is a BIAS, not a guarantee** — the gutter row-alignment may drift; accept as best-effort (held on the prototype's flow-skew, not proven for every shape). | prototype caveat |
| 06 | Medium | Big regen surface: **842-line** `flow-renderer.test.ts` + `flow-render.test.ts` + **5 golden fixtures** (`chore-nodes`/`flight-plan-024`/`harness-adopt`/`harness-loop`/`kitchen-sink`), gated by `check:flows` (**hard gate**) via `scripts/flow-fixtures.mjs`. | `package.json:40`, fixtures dir |

## Risk surface / bounding constraints

- **Re-skew risk** (H): the change only beats the skew if *all* side-content (chores, agents,
  user_input, comment-bodies) collapses to gutter-boxes/badges — a stray per-node sub-node brings
  the diagonal back. The plan must enumerate every side-content kind and its target.
- **Hard gate** (H): `check:flows` fails on any unreviewed golden drift — regenerate the 5 fixtures
  **intentionally** (reviewed diff), exactly as the sections change did.
- **Alignment best-effort** (M): row-alignment is a dagre bias; "dead-straight spine" is the goal,
  not a guarantee — verify on the real fixtures, accept minor drift.

## Exact targets for the plan

1. `harness/cli/src/services/flow/flow-renderer.ts` — replace the sections emission in `renderFlow`
   with the single TD-columns block (spine chain + per-parent combined gutter boxes + `~~~` chain +
   `-.-` links); keep badges/classDefs/legend/rail; decide agents/user_input mapping.
2. `harness/cli/test/services/flow/flow-renderer.test.ts` (+ `test/acts/flow-render.test.ts`) —
   rewrite the sections assertions to the TD-columns shape.
3. `harness/cli/test/services/flow/fixtures/render/*` — regenerate 5 goldens (`npm run gen:flow-fixtures`), review the diff.

**Core decision named**: how non-chore side-content (agents, user_input, comment-bodies) maps into
the single mermaid — recommendation above (badges for text, a gutter box for agents, drop the 🗣
bubble). Otherwise the path is clear; this is a layout swap of a well-understood renderer. Ready to plan (Simple).
