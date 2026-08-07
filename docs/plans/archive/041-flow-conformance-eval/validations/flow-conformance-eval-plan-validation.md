# Validation Record — flow-conformance-eval-plan

**Validated**: 2026-06-29 · **By**: /the-flow plan (auto validate-v2) · **Verdict**: ✅ VALIDATED WITH FIXES

- **Target**: `docs/plans/041-flow-conformance-eval/flow-conformance-eval-plan.md` (Full, CS-4, READY)
- **Proof**: deterministic lead checks (code-grounded) + one independent critic.

## Deterministic checks (lead) — all PASS
- `telemetry` is a CORE family with only `sync` today → `harness/cli/src/acts/telemetry.ts:34,40` (F-07 real; `get` is the right add).
- `event_stream` kinds skill/flow/flow_log/harness/checks/compaction present → `events.ts:38-46`.
- Real telemetry fixture corpus exists → `harness/cli/test/services/telemetry/fixtures/real/`.
- `ctx.fsWrite.writeText` exists + feature-detect → `contract.ts:77,83-84`.

## Critic findings → resolution (all mechanical, in-target)
| # | Sev | Finding | Fix applied |
|---|-----|---------|-------------|
| F1 | HIGH | `flow-eval run` verb ambiguous ("drive hooks") — risked contradicting the Non-Goal that pij-driving stays orchestrator-shell | Collapsed to a single action verb `score` (+ `scaffold`); extension **never drives pij** — task 2.6, AC-04, Phase-2 Delivers updated |
| F2 | MED | `session-evidence` described in prose though labelled a "contract" file | Added the explicit `SessionEvidence` TypeScript interface (§ Session-Evidence contract) |
| F3 | MED | Programmatic retrieval API + caching undefined for Phase 2 | Specified `getSessionEvidence(id): Promise<SessionEvidence\|null>`, no-cache (§ contract + AC-01) |

## Confirmed sound (no change)
- Purpose fit: all goals mapped to phases; no orphaned goals/phases.
- Contract consistency: scenario/assertion/report shapes match workshop 001 exactly.
- Phasing: 3 phases on clean dependency boundaries; ACs measurable; no over-scope (correctly does NOT build the md→PDF extension itself).
- Forward-compat: scenarios-as-data + three-valued verdicts handle telemetry gaps.

**Thesis**: advanced — the plan delivers the scenario-driven, telemetry-graded conformance harness its purpose promises; target proof = actual proof after the three specification gaps were closed.
