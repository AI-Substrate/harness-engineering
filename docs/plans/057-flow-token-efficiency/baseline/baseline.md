# Token-efficiency baseline — plan 057 (AC-05)

**Generated**: 2026-07-10T02:40+10:00 · **Method**: `harness telemetry sweep --month 2026-07 --out baseline/sweep-2026-07 --no-html` run with the T003 binary (commit `6615e488`+) · **Data**: `sweep-2026-07/2026-07.report.json` (38 sessions, token_coverage 4 measured / 34 unmeasured — thin shards declared, never zero-faked)

## The starvation proof (the "before")

Pre-057 tooling, the 2026-07-09 baseline session (`refs/harness-telemetry/2026/07/09/22583d3b…`, the 056 build) could not be attributed per stage: 2 FlowEvents (both `phase-1`, a 7-min window near session end), 0 skill-digit brackets, 298 turns spanning 64 min → `flow_stage` collapsed to effectively one partial bucket; the stage timeline existed only in rollup-excluded `flow_log` markers (dossier F-10, validation V-01).

## The retroactive "after" (T003 mechanism, same old data)

Month sweep `flow_stage` with the flow_log lookup live:

| stage | semantic | windows | active time | fresh in | out |
|---|---|---|---|---|---|
| phase-1 | implement | 2 | 7,460s | 59,049 | 182,379 |
| unlabeled | — | 1 | 1,341s | 1,426 | 50,726 |
| phase-2 | implement | 1 | 1,586s | 0 (unmeasured session) | 0 |

`provenance.flow_stage_mechanism`: `{flow: 2, digit: 0, unlabeled: 1, flow_log: 1}` — all mechanisms exercised on real data; the flow_log window is the 056 session's turns attributed via its pre-window `cursor-moved` history (retroactivity confirmed live).

Session-level anchors (unchanged semantics): 056 session = 59,049 fresh-in / 182,379 out / ~64 min / claude-opus-4-8. Month cache totals (session-level only, never per-stage — KF-06): 88.6M cache-read / 1.08M cache-create — cache dwarfs fresh tokens ~365:1, confirming context re-reads as the dominant raw cost.

## What P2 adds (T2.7)

This 057 build's own sessions (orchestrator + workers), captured under the same mechanism, appended here as the first *multi-stage* self-measured sample — expected: >1 stage bucket, `stage_labels_unavailable` absent, flow_log the dominant mechanism.

### First "after" sample — 2026-07-10, the P2 build session itself (T007)

Month sweep re-run mid-P2 (39 sessions exported), `flow_stage` rollup:

| stage | semantic | windows | active time | fresh in | out |
|---|---|---|---|---|---|
| phase-1 | implement | 2 | 7,460s | 59,049 | 182,379 |
| unlabeled | — | 1 | 1,341s | 1,426 | 50,726 |
| **phase-2** | implement | 2 | 1,881s | 0\* | 0\* |

`provenance.flow_stage_mechanism`: `{flow: 2, digit: 0, unlabeled: 1, flow_log: 2}` — **flow_log 1 → 2**: this session's own `nav set` moves (review-1 → phase-2, driven with `--quiet`) produced the new window with zero extra effort — the capture is ambient, exactly the AC-01 claim. >1 stage bucket present; `stage_labels_unavailable` absent.

\* Token columns are 0 because this session was still open at sweep time (`token_coverage: 4 measured / 35 unmeasured` month-wide — usage lands when a session's log closes). The **stage windows and time attribution are the deterministic evidence here**; the filled token columns arrive free at the ship-time sweep and the T+3wk tripwire re-run (runbook § capture-health). Delegation note: P2's coder/reviewer are pij copilot peers — separate sessions, NOT in this claude-session rollup (P1 T007: MIXED/SEPARATE).

## Interpretation guards (V-04)

Cross-journey deltas are **non-normalized** (task size confounded; three interventions land together). Capture-health (mechanism counts, marker density, token_coverage) is the deterministic evidence class; stageEconomics deltas are directional only. Delegation impact: see T007's adapter answer in the execution log before reading any subagent-heavy session's totals.
