# Coder packet — plan 051 phase 1 (whole phase, all 6 tasks)

You are the flow-pair CODER (orchestrator: pij-4s10mb). Implement **every task T001–T006 in one run** — do not hand back after a couple. Repo root: `/Users/jordanknight/substrate/harness-engineering`. Report via `pij send pij-4s10mb "<report>"` when the WHOLE phase is done. No commits — leave the working tree for review.

## Contract (read these first, they are authoritative)
1. `docs/plans/051-pij-fleet-session-eval/pij-fleet-session-eval-plan.md` — the task table (T001–T006), AC-01..07, Key Findings 01–05.
2. `docs/plans/051-pij-fleet-session-eval/workshops/001-fleet-join-and-eval-design.md` — D1 (env-tree superset + roster scoping + orphan/unrostered diffs), D2 (FleetEvidence/FleetLane contract), D3 (dimension semantics — unmeasured lanes NEVER zero-filled; time from OTLP metric timestamps, `window` is event-index and unusable), D4 (`intent` field shape), D5 (build order).
3. `docs/plans/051-pij-fleet-session-eval/research-dossier.md` — F-05 (reuse `getSessionEvidence`, don't reimplement), F-07 (copilot `tokens: null`), F-09 (pij id ≠ harness session id).

## Execution notes
- T001 spike FIRST (scratch only — use `scratch/`): prove the time source. Real data: `.harness/temp/telemetry/*/` (99 segments have `captured_env.PIJ_PARENT_ID == "pij-4s10mb"`), synced OTLP refs under `refs/harness-telemetry/2026/07/*` (`session.metrics.jsonl` carries timestamps), roster files under `.flow-pair/runs/*/run.json`. Record go/no-go + discovered constraints in the execution log; promote learnings, never spike code.
- T002: new `harness/cli/src/services/telemetry/fleet-evidence.ts` — PURE service (ports only, no direct node I/O; see how `session-evidence.ts` is built and REUSE its builder). Tests in `harness/cli/test/services/telemetry/fleet-evidence.test.ts` with real-shaped fixtures.
- T003: closed schema `fleet-export.schema.json` (`additionalProperties:false` everywhere; ids/counts/enums only — mirror the discipline of `session-export.schema.json` and plan 050's closed key unions) + wire `telemetry get-fleet <root-pij-id> [--roster <path>] [--worktree <p>]` into `harness/cli/src/acts/telemetry.ts` following the existing `get` action's envelope pattern. Negative test: payload with an un-enumerated key FAILS validation.
- T004: flow-eval scaffold emits `intent: {reason, vibe}`; loading treats it as optional (old scenarios unchanged — add a fixture test).
- T005: run the real thing — `node harness/cli/dist/index.js telemetry get-fleet pij-4s10mb --json` (after `just build`) + a roster run; write output to `docs/plans/051-pij-fleet-session-eval/evidence/fleet-050.json` + a short reconcile note vs the workshop spike (78,814,658 grand-total over measured claude lanes; copilot lanes unmeasured).
- T006: `docs/how/telemetry.md` § fleet (short), then `just build` && `harness checks` — exit 0 required (pre-existing warn-launch degradeds tolerated). If docs-content drift guard fires, run the repo's docs regen (see justfile) and include it.
- Maintain `docs/plans/051-pij-fleet-session-eval/tasks/phase-1/execution.log.md` — one entry per task (what/evidence/deviations).

## Allowed paths
- `harness/cli/src/services/telemetry/**`, `harness/cli/src/acts/telemetry.ts`, `harness/cli/test/services/telemetry/**`
- `.harness/extensions/flow-eval/**` (+ its fixtures)
- `docs/how/telemetry.md`, `harness/cli/src/services/docs/docs-content.ts` (regen only)
- `docs/plans/051-pij-fleet-session-eval/tasks/**`, `docs/plans/051-pij-fleet-session-eval/evidence/**`
- `scratch/**` (spike only)

## Forbidden
- `.the-flow-state.json`, `the-flow.json`, `the-flow.md` (any flow files, any plan)
- The plan/workshop/dossier/validation files (read-only contract)
- Everything else outside Allowed paths. Do NOT modify `docs/plans/041-*` / `docs/plans/048-*` dirty files (other sessions' work). No commits, no pushes.

## Done means
All 6 tasks done · vitest green for your new/changed tests · `just build` + `harness checks` exit 0 · execution log complete · evidence file written · then: `pij send pij-4s10mb "<per-task summary + checks verdict + deviations>"`.
