# Phase 2 Execution Log

**Started**: 2026-07-10
**Scope**: T001-T006 and T008; T007 remains orchestrator-owned.

## T001 — Template guard

- Added `flight-plan-template.test.ts` against the real builder template and real `applyBatch`.
- Named mutations cover missing guidance, byte-cap drift, mandate wording, and lost expander instructions.
- RED: targeted run failed 1/3 on missing `phase-1` token discipline before T002; length/posture and expander assertions were already green.
- GREEN: targeted run passed 3/3 after T002.

## T002 — Template instructions

- Added the same two exact instruction lines to `phase-1`, `boot-1`, and `observe-1`.
- UTF-8 lengths are pinned at ≤150 bytes; the guard rejects mandate wording and verifies phase-2 clone preservation.

## T003/T004 — Model fit and spawn packets

- Added the shared tier table, delegate/keep test, escalation posture, worker return contract, context override, and Rules 5–6 rationale cite.
- Exactly six stage modules cite § Model-to-task fit; every explicit worker packet now carries `tier:`.
- Tier placement: bounded discovery/file chores use cheap/Sonnet-class; analysis/review uses Opus-class; merge-order synthesis uses lead.

## T005 — eng-harness-flow cite

- Added one line outside `doctrine-parity:039` linking token/model posture to the builder convention and Rules 5–6.
- `npm run check:doctrine-parity --silent`: green; mirrored block unchanged.

## T006 — Wild-telemetry tripwire

- Added `tripwire-runbook.md` with ref fetch, sweep, per-session report, insights, and jq extraction commands.
- Separates deterministic capture health from non-normalized directional outcome and verdicts each class independently.
- Records native Agent-tool and pij-fleet delegation side channels as unmeasured/low-confidence without a join.

## T008 — Posture sweep and composite checks

- Added guidance-line diff grep for `must|required|gate|block|score`: no hits.
- Template guidance byte lengths: 89 and 140 bytes on each of `phase-1`, `boot-1`, and `observe-1`.
- `just test`: 179 files / 2,277 tests green.
- Targeted guard: 3/3 green after the recorded RED.
- Typecheck, Biome, template JSON parse, six-site cite/tier grep, diff whitespace, and doctrine parity: green.
- `just checks`: exit 0, `degraded` only for the pre-existing warn-tier `arch-check` (2) and `markdown-lint` (199); every hard check green.
- The packet's named `just flow-pair-test`, `just typecheck`, and `just lint` recipes do not exist in this repo; recipe discovery selected `just test`, direct tsc/Biome, and the authoritative `just checks`. Captured as `CONF-002`.

## Phase status

- COMPLETE for delegated scope: T001-T006 and T008.
- T007 remains `[ ]` and orchestrator-owned as instructed.

## T007 — self-measure (orchestrator-owned) ✅

- `harness telemetry sweep --month 2026-07` mid-P2: 39 sessions exported; `flow_stage` rollup renders **3 stage buckets** (phase-1 · unlabeled · **phase-2**), `stage_labels_unavailable` absent.
- `provenance.flow_stage_mechanism` = `{flow: 2, digit: 0, unlabeled: 1, flow_log: 2}` — flow_log **1 → 2**: this session's own `nav set` moves produced the new window ambient-free (AC-01 observed half).
- Appended as the dated "first after" sample in `baseline/baseline.md`, with the open-session caveat (phase-2 token columns fill when the session log closes — windows + time attribution are the deterministic evidence now) and the MIXED/SEPARATE delegation note (coder/reviewer are pij copilot peers, not in this rollup).
