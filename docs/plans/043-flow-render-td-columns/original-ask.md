# Original ask — flow-render-td-columns
**Captured**: 2026-06-30  ·  **By**: /the-flow

> simple plan, very simple, do research, then plan then validate. but really simple

**Context**: replace the per-node *sections* layout in `harness/cli/src/services/flow/flow-renderer.ts`
(shipped as a37a601a) with the **TD two-column** format chosen after prototyping — straight spine
(left column) + chores combined into one box per node in a right gutter (held by invisible `~~~`
links). Golden target: `reference-td-columns-format.md` (rendered from `reference-flow-skew.json`).
