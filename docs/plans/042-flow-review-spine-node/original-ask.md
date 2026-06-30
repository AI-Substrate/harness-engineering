# Original ask — flow-review-spine-node
**Captured**: 2026-06-29  ·  **By**: /the-flow

> want a quick explore + plan + validae please. simple plan, no need for ceremony

**Context (the work this flow plans)**: the code-review-phase remediation scoped this session —
the-flow's flight-plan template + plan-complete expander omit a `review` node entirely, so a flow
driven by `orient`/`nav` never surfaces code review (it runs `… → phase → ship`). Decision locked
this session: **per-phase review as a spine node** (Option A) — `phase-N → review-N → next`.
