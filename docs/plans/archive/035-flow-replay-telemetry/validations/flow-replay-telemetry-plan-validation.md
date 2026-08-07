# Validation — flow-replay-telemetry-plan.md

**Verdict**: NEEDS ATTENTION → corrections folded into the plan (revalidate on implement).
**Date**: 2026-06-25 · **Scope**: narrow (lead + 1 critic) · **Proof**: source-grounded.

## Proof (deterministic, against source)
- Flight-plan event shape `{kind, origin, fired_at, details}` + built-in ops (cursor-moved/status-changed/node-created/node-updated) — `flow/flow-events.ts:40-48`, `flow/flow-mutations.ts:62,271,420,479`. ✓
- Privacy linchpin — comment text on the NODE, not the event — `flow/flow-mutations.ts:490`. ✓
- `.branch` watermark pattern (the `.flowcursor` template) — confirmed. ✓

## Findings (all verified)
| # | Sev | Finding | Evidence | Fix folded in |
|---|---|---|---|---|
| 1 | HIGH | `fired_at >` is an unsafe dedup key (ms-resolution collisions) | `system-clock.ts:6`; multi-event `insertNode` | window by append-only array offset |
| 2 | HIGH | `flow_log` real `fired_at` corrupts the rollup (re-sort + gap/wall billing) | `rollup.ts:136,146,153,161` | exclude `flow_log` from rollup gap/wall/stage |
| 3 | MED | cursor per-session, log per-plan | `.flowcursor`=`<session>`; `flightPlanPath` per-plan | key per (session, plan) |
| 4 | MED | replay blind spot (initial stage / advisory-nav) | `flow-mutations.ts:61` | acknowledge + bound in docs |

Thesis: advanced (rough replay + timings delivered); HIGH items are mechanism fixes, not a rethink.
