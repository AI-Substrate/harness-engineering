# Worker packet — 052 Phase 1: Lane sources + capture fixes (d-001)

**Run**: 2026-07-04-052-lane-sources · **Delegation**: d-001 · **Role**: coder
**Orchestrator**: pij-4s10mb (reply via `pij send pij-4s10mb "<report>"` — you are a pij peer; keep reports concise)

## Mission

Implement **ALL of Phase 1 (T001–T008) in this one run** — do not hand back after a couple of tasks; fragmenting wastes round-trips and your warm context. Work from:

- Task table + context brief (numbers, locations, fixture rules): `docs/plans/052-fleet-telemetry-lane-sources/tasks/phase-1/tasks.md`
- Plan (ACs, honesty invariants, non-goals): `docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md`
- Research dossier (F-01..F-10 — the exact vendor ledger shapes, verified live): `docs/plans/052-fleet-telemetry-lane-sources/research-dossier.md`

Read all three FIRST. Order within the phase: **T001 (investigate) before its fix**; T002 independent; T003–T006 are parallel-safe readers; T007 wires and carries the golden test; T008 last.

## Hard requirements

1. **Golden test is the phase gate**: `get-fleet` over the real 051 run resolves 4/4 lanes at EXACTLY coder 1,742.9 AIC · reviewer 298.5 AIC · validator 1,368,083 tokens · orchestrator live. Use scrubbed real fixtures (the actual `~/.copilot/session-state/34524328*` + `6daaffe6*` shutdown events, the `~/.codex/sessions/2026/07/04/rollout-*6fbb*` rollout tail, real `~/.pij/*.json` descriptors) — scrub to counts/ids/enums before committing; extend the privacy-scan test to cover them.
2. **Honesty invariants**: unmeasured ≠ zero; `source` + `cost_measured` per lane; shape mismatch → degrade to unmeasured (negative fixtures prove it); never crash on absent `~/.copilot` / `~/.codex` / `~/.pij`.
3. **Closed schemas**: extend `fleet-export.schema.json` with `additionalProperties:false` intact + a negative-key test that fails an un-enumerated field.
4. **Non-goals — do NOT touch**: pij-side code, flow-pair skill sources, USD conversion in the CLI (billing units only), anything outside your allowed paths.
5. **Gate before reporting done**: `just fix` then FULL `harness checks` — all sensors green. Update the task table checkboxes + write `execution.log.md` (incl. the T001 root-cause note) as you go.
6. Commit your work on the current branch (`feat/041-flow-conformance-eval`) with explicit pathspecs limited to your allowed paths, `--no-verify`, message prefix `feat(telemetry-052):`. NEVER `git add -A` — the tree carries other sessions' uncommitted files.

## Allowed paths

- `harness/cli/src/services/telemetry/**`
- `harness/cli/src/acts/**` (get-fleet wiring only)
- `harness/cli/test/services/telemetry/**`
- `docs/how/telemetry.md`
- `docs/plans/052-fleet-telemetry-lane-sources/tasks/phase-1/**` (task table, execution log)
- `docs/plans/052-fleet-telemetry-lane-sources/evidence/**`

Read-only everywhere else (incl. `~/.copilot`, `~/.codex`, `~/.pij` — read to build fixtures, never modify).

## Forbidden paths

- `.the-flow-state.json`, `the-flow.json`, `the-flow.md` (any plan dir)
- `docs/plans/034-*/**`, `docs/plans/037-*/**`, `docs/plans/041-*/experience-logs/**`, `scratch/**` (other sessions' work)
- `.flow-pair/**`, `prompt-lab/**`

## Report format (when done)

`pij send pij-4s10mb` with: tasks completed (ids), golden test result (the 4 numbers as measured), `harness checks` exit status, T001 root cause in one sentence, files touched count, commit SHA(s), anything deferred + why.
