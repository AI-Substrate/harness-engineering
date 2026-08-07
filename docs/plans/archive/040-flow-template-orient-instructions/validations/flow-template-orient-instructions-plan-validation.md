# Validation — flow-template-orient-instructions-plan

**Validated**: 2026-06-29 · **By**: /validate-v2 (lead + 1 critic) · **Target**: `flow-template-orient-instructions-plan.md`

## ✅ VALIDATED WITH FIXES — 0 critical · 1 high · 3 medium (all closed in-plan)

**Proof (deterministic):** every `file:line` claim resolves — `nodeClass` (flow-renderer.ts:188-193), `nodeLabel` badges (196+), legend (103), `set-node` (acts/flow.ts:507), `FlowNode` has no `instructions` today (field is new), `doctrine-parity:039` marker present (eng-harness-flow/SKILL.md:40-56). Constitution P3 (fakes over mocks) + P10 (dynamic verbs) consistent with the plan.

**Thesis:** advanced — the plan serves the OOTB "self-driving without inference" purpose; the one gap that blocked it (template carried no authored instructions) is now closed.

**Consumers:** the tasks/implement verbs (next phase) — handoff fields present (ACs testable, coverage map complete, phase deps sound).

## Findings + resolution

| # | Sev | Finding | Evidence | Resolution |
|---|-----|---------|----------|------------|
| 1 | HIGH | Template-authored `instructions[]` (D4 "static bone") had no task/AC — fresh `create`→`orient` would show no guidance, defeating the thesis | D4; plan Summary line "authored + runtime"; AC-06 structural only | **AC-13** added + task 4.1 now seeds authored instructions; verified by `create`→`orient` non-empty |
| 2 | MED | WS-1 requires `🧰`+importance marker in the **text rail** (weak-model surface); plan rendered it in mermaid only | WS-1 §"why glyph AND border", rail-parity example | **AC-03** extended + task 3.3 now touches `renderRailLine`; orient inherits |
| 3 | MED | AC-07 byte-stable idempotency (the Critical anti-drift property) proven by prose only, though CLI-testable | AC-07; task 4.3 "prose + example" | Task **1.1** now adds an apply-twice byte-identical CLI guard; AC-07 maps to it |
| 4 | MED | Tasks 1.5 (schema) + 4.5 (coach boundary) had no AC | Coverage map omitted them | **AC-14** (schema↔validator) + **AC-15** (coach boundary) added + mapped |

## Adjudication notes (honest)

- AC-11 (verify no live eng-harness-flow injection path) is handled honestly — demoted from open-question to verification task 5.3 **with a contingency** ("make inert/remove if present"), not asserted as already-true.
- Hybrid-TDD ordering holds: tests precede impl in P1-P3 (1.1→1.2-1.4, 2.1→2.2, 3.1→3.2-3.4).
- Doctrine-parity ordering is safe: P4 leaves both parity twins untouched (check stays green); P5 rewrites both byte-identical together.

All four fixes are grounded in authoritative upstream (D4 / WS-1 / F-07 / F-08) — strengthening, not invented intent. Re-checked: coverage map now maps AC-01..AC-15 with no orphan tasks.
