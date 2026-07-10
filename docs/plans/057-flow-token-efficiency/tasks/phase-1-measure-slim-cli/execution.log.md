# Execution Log — Phase 1: Measure + slim the CLI

**Plan**: flow-token-efficiency-plan.md v1.1.0 · **Started**: 2026-07-10T02:25+10:00 · **Approach**: Hybrid (TDD for CLI code)

## T001 — Design-proof: stage-window mechanism ✅

**Decision: READ-SIDE (primary candidate confirmed).** Attribution-by-last-transition-lookup over `cursor-moved` `flow_log` markers; write-side emitter NOT needed.

Evidence (decoded real 056 ref `refs/harness-telemetry/2026/07/09/22583d3b…` → `session.logs.jsonl`, 677 events):
- 19 `flow_log` markers with real absolute `fired_at`: `cursor-moved research→plan` @1783558699, `cursor-moved plan→phase-1` @1783560353 — the full stage timeline exists and is trustworthy.
- Session turn window 1783560369→1783564243 starts AFTER the last cursor-move — markers outside the window are normal (they're the flight plan's history), which kills naive window-clipping but validates the better rule: **stage(turn) = latest cursor-moved ≤ turn.t** (a point lookup; matches the 2 existing FlowEvent anchors, both phase-1 ✓).
- The exclusion at `events.ts:268–276`/`rollup.ts` guards *gap/wall math re-sorting* — attribution-by-lookup never re-sorts, so the policy is preserved, not violated.
- Single-flow-per-session by construction: `flow_log` is projected only from the HARNESS_PLAN_ID-linked plan (`capture-service.ts` `withFlowLogEvents`), so node-id collisions across flows can't occur within a session.
- Monotonicity: source is the flight plan's append-only `events[]` with real stamps; a defensive sort-by-t in the implementation makes ordering explicit.
- Retroactive: works on ALL existing refs (056 included) — no redeploy-then-wait needed for a per-stage baseline.

Contract for T002/T003: derive stage brackets in the report/rollup layer from `cursor-moved` markers (fallback chain stays: FlowEvent anchor → `/the-flow <digit>` → flow_log lookup → `unlabeled`); surface as additive `flow_stage_mechanism` value `flow_log`; cache tokens stay session-level (plan KF-06).
