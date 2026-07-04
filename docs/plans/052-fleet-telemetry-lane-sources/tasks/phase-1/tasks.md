# Phase 1: Lane sources + capture fixes — tasks

**Plan**: [../../fleet-telemetry-lane-sources-plan.md](../../fleet-telemetry-lane-sources-plan.md) · **Dossier**: [../../research-dossier.md](../../research-dossier.md)
**Owner**: flow-pair coder (delegated) · **Gate**: `harness checks` green + golden 4/4-lane test

## Context brief

The 051 fleet debrief recovered 3 of 4 cost lanes by hand from vendor side-channels. This phase turns that archaeology into deterministic readers inside `telemetry get-fleet`, and fixes the two capture defects it exposed. Honesty invariants (plan § Honesty invariants): unmeasured is never zero; every lane carries `source` + `cost_measured` flags; readers degrade to unmeasured on shape mismatch; counts/ids/enums only — never prose or event bodies.

**Ground-truth numbers for the golden test (from the real 051 run, 2026-07-04):**

| lane | source | join | billing |
|---|---|---|---|
| coder (copilot, pij-g7t974) | `~/.copilot/session-state/34524328*/events.jsonl` `session.shutdown` | pij registry `harnessSessionId` | **1,742.9 AIC** (`totalNanoAiu`/1e9) |
| reviewer (copilot, pij-106t2i1) | `~/.copilot/session-state/6daaffe6*/events.jsonl` | pij registry | **298.5 AIC** |
| validator (codex, pij-wolk0r) | `~/.codex/sessions/2026/07/04/rollout-*6fbb*.jsonl` last `token_count` | pij `transcriptPath` | **1,368,083 total tokens** |
| orchestrator (claude, pij-4s10mb) | live temp segments / telemetry refs, session `15eaa924` | env (existing path) | live |

`totalPremiumRequests` is legacy (pre-2026-06), NOT cost — never surface it as billing.

**Key code locations**: `harness/cli/src/services/telemetry/` (`fleet-evidence.ts`, `artifact-semantics.ts` — verdict regex ~line 149, adapters), schemas `harness/cli/src/services/telemetry/*.schema.json` (closed, `additionalProperties:false`), tests `harness/cli/test/services/telemetry/` (fixture corpus + `fixture-privacy-scan.test.ts` pattern). Get-fleet act wiring in `harness/cli/src/acts/`.

**Fixtures**: scrub REAL side-channel files into the corpus (counts/ids/enums only — strip message bodies, file paths beyond basenames, any prose). Run the privacy-scan test over new fixtures. No mocks of vendor formats — fixtures ARE the captured shapes.

## Task table

| ✓ | id | task | proves |
|---|----|------|--------|
| [x] | T001 | Investigate F-07: copilot worker lane emitted 0 artifact events despite running harness commands. Diagnose at source (adapter vs plan-cursor init) using ref `34524328` + a probe; fix if small, else document + name a follow-on. Root cause in execution log | AC-05 |
| [x] | T002 | Fix F-08 packet false positive: `*-packet.md` / rubric-line verdict lists must NOT classify as review (require Findings/Verdict report shape). Fixtures from real 050+051 packets (scrubbed) + real review.phase-1.md still → FIX_REQUIRED `{critical:1}` | AC-04 |
| [x] | T003 | Copilot shutdown reader `copilot-ledger.ts`: pure extractor over `session-state/<id>/events.jsonl` → `{aic, token_buckets, api_duration_ms, code_changes_counts}` from `session.shutdown`; ports-only I/O; malformed → unmeasured. Scrubbed real fixture | AC-01..03 |
| [x] | T004 | codex rollout reader `codex-ledger.ts`: last `token_count` per rollout under `~/.codex/sessions/<date>/`; join via pij `transcriptPath` when present, explicit roster mapping else | AC-01..03 |
| [x] | T005 | Refs reader: enumerate `refs/harness-telemetry/*` rollups as a fleet source so flushed lanes stay visible; live-vs-ref dedupe by session id | AC-06 |
| [x] | T006 | pij registry join port `pij-registry.ts`: read `~/.pij/*.json` → `pijId ↔ harnessSessionId/harness/model/spawnedBy`; absent dir → source unavailable, never error | AC-01 |
| [x] | T007 | Wire into get-fleet: precedence live→ref→ledger; `FleetLane` gains `source` + `billing {aic?, token_buckets?}`; closed schema extended + negative-key test; **golden test: real 051 run resolves 4/4 lanes at the exact numbers above**; regenerate 051 evidence as proof | AC-01..03, 06 |
| [x] | T008 | Lane-source matrix in `docs/how/telemetry.md`: per harness — cost/semantic sources, materialization timing (shutdown-only!), join keys, never-available; run-end sweep procedure (sync → snapshot before teardown); F-10 billing conventions | AC-08 |

Keep this table and `execution.log.md` live as you go.
