# Research Dossier: pij fleet session-join eval (time / quality / cost)

**Generated**: 2026-07-04T03:25:00Z
**Query**: "eval pij fleets as one joined session — orchestrator builds flow artifacts, spawns pij coders/reviewer, join child sessions via captured parent-link env vars, score time/quality/cost per named scenario (each scenario carries its reason/vibe)"
**Effort**: Deep (3 workers + lead POC)
**Tools**: Standard
**Evidence**: 11 current sources · 3 historical sources

## Answer

1. **The join key already exists and is already captured.** pij spawn sets `PIJ_SESSION_ID`, `PIJ_PARENT_ID`, `PIJ_HARNESS` on every control-plane child; the telemetry allowlist (`PIJ_*`) captures all three into `captured_env`, and they survive OTLP sync into `refs/harness-telemetry`. Real data: this repo holds 13 distinct parent→child pairs (all under `pij-4s10mb` — the plan-050 fleet), SecondCrack 28 and osk-split-billing 42 PIJ-tagged session dirs.
2. **No fleet-join capability exists yet.** The only primitive is `getSessionEvidence(pijSessionId)` — a 1:1 lookup. `report`/`sweep`/`insights`/flow-eval all operate on one session or on calendar months; nothing merges N sessions into one fleet unit. A ~40-line POC join over local segments already computes fleet cost (78.8M grand-total tokens, 852k output across the 050 fleet), so the merge itself is cheap to build.
3. **Two real data gaps break the dimensions today**: (a) **copilot children capture `tokens: null`** — 45/99 fleet segments, so fleet *cost* is claude-only until the copilot token correlation lands; (b) the segment `window` is event-index based (`from`/`to`), not wall-clock — fleet *time* needs the OTLP metric timestamps or segment `timecode`s instead.
4. **`PIJ_PARENT_ID` is conditional** — spawn omits it when the parent can't be resolved (seen live: the 07/04 eval subject `5d852284…` has `PIJ_SESSION_ID` but no parent in any of its 9 synced segments). The flow-pair run ledger (`.flow-pair/runs/*/run.json` roster `role → pijId`) is an independent ground-truth mapping to reconcile against.
5. **Scenarios have no "reason/vibe" field.** `scenario.json` carries `slug/title/task/base/subject/flow/prompts/judge/assertions` but no purpose statement; the user wants every measured scenario to carry *why we measure it and what its vibe is* — a schema/register decision for the workshop.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | Control-plane spawn sets `PIJ_SESSION_ID` (child's own pij id), `PIJ_HARNESS`, and `PIJ_PARENT_ID` (spawner's pij id, **omitted when unresolvable**) | `~/pi-hacking/pij/.pi/extensions/pij/core/spawn.ts:290-302` | The parent link is env-borne and best-effort; joins must tolerate orphans | High |
| F-02 | Telemetry captures `PIJ_*` by allowlist glob with secret-name denylist | `harness/cli/src/services/telemetry/capture-service.ts:123` | No new capture work needed for the join keys | High |
| F-03 | All three keys present in real segments: 13 parent→child pairs under `pij-4s10mb` (52 claude + 47 copilot segments) | `.harness/temp/telemetry/*/​*.json` `captured_env` | The 050 flow-pair run is a ready-made fleet fixture | High |
| F-04 | `PIJ_PARENT_ID` survives OTLP sync into pushed refs | `refs/harness-telemetry/2026/07/04/08375079…:session.logs.jsonl` (4× all three keys) | Fleet joins work on synced telemetry, not just local temp | High |
| F-05 | Only join primitive is single-session: `getSessionEvidence` filters `captured_env.PIJ_SESSION_ID === id`; no parent/cohort concept in report/rollup/insights/flow-eval resolvers | `harness/cli/src/services/telemetry/session-evidence.ts:110,306`; grep negative across `report.ts`/`rollup.ts`/`insights.ts`/`.harness/extensions/flow-eval/resolvers.ts` | New capability needed: a fleet/cohort evidence merge (e.g. `telemetry get-fleet <parent-pij-id>`) | High |
| F-06 | POC join computes fleet cost from captured env alone: 13 children, 99 segments, 78,814,658 grand-total / 852,398 output tokens | lead scratch join over `.harness/temp/telemetry` | The merge is trivially buildable; the eval's cost dimension is real today (claude lanes) | High |
| F-07 | **Copilot children capture `tokens: null`** — all 9 copilot children, 45 segments, 0 tokens | e.g. `.harness/temp/telemetry/08375079…/1.json` (`"tokens": null`) | Fleet cost is claude-only until copilot token correlation is wired into live capture | High |
| F-08 | Segment `window` is event-index based (`{"since":"last-command","from":1169,"to":1349}`), not wall-clock | same segment | Fleet *time* needs OTLP metric timestamps / segment timecodes, or a new duration source | High |
| F-09 | pij id ≠ harness session id — derived FNV-1a hash of the underlying session id | `~/pi-hacking/pij/.pi/extensions/pij/core/discovery.ts:16-32` | Join via `captured_env` only; never assume `PIJ_SESSION_ID == CLAUDE_CODE_SESSION_ID` | High |
| F-10 | Pre-2026-06-24 segments have no `captured_env` at all (17,566 legacy blobs on the 06/23 ref) | `refs/harness-telemetry/2026/06/23/…` sample | Joinable corpus starts late June; date-gate any sweep | High |
| F-11 | `scenario.json` has no purpose/reason/vibe field | `live-testing/scenarios/md-to-pdf-ponytail-harness/scenario.json` (keys list) | Workshop: add a scenario-intent field or a scenario register in the plan | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | Env capture design (allowlist glob + secret denylist + value-shape guard) was deliberately built to carry pij correlation ids; it caught a `PIJ_SPAWN_TASK` prompt leak | plan 034 / segment v2.2 workshop; `capture-service.ts:127-159` doc comments | Direct | Keep `PIJ_SPAWN_TASK` out of any join payload — ids only |
| H-02 | DL-007 (open): `flow-eval score` telemetry lookup returned 0 segments while `harness telemetry get` returned 9 for the same session | `.harness/records/retro/2026-07-04/001-flow-eval-batches-and-050-drain.md` | Direct | The eval's evidence path has a known divergence — fix or route around before trusting fleet scores |
| H-03 | Copilot CLI token correlation requires process-log `assistant_usage` events or OTel redirect — shutdown events are not live | telemetry Copilot correlation work (plan 034 era) | Direct | The F-07 gap is understood, not mysterious; the fix path is known |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| Orphan children (no `PIJ_PARENT_ID`) | F-01, `5d852284…` refs | Fleet under-counts silently | Reconcile env tree against flow-pair run-ledger roster; surface orphans loudly |
| Copilot cost = 0 | F-07 | Cost dimension is half-blind in cross-model fleets | Wire copilot token capture, or score cost per-lane with an honest "unmeasured" marker |
| DL-007 lookup divergence | H-02 | Scoring may read 0 segments where data exists | Fix before fleet eval, or use `telemetry get` path exclusively |
| External repos never sync telemetry (0 refs; segments only in gitignored `.harness/temp/telemetry`) | worker C + lead verify | Real corpus can vanish on temp cleanup | Decide: sync those repos' refs, or snapshot the temp dirs into the eval corpus |
| **osk-split-billing runs an old harness — mostly bad/unjoinable data** (user flag, verified): 167/189 segments are schema v1.0 (no `captured_env`, no `event_stream`, no harness_version); only 22 are v2.2 and carry the PIJ keys. SecondCrack: 453/536 v2.x (260 v2.2) — usable | lead schema-version census of both repos' `.harness/temp/telemetry` | Fleet joins on osk cover only its newest ~22 segments; naive corpus counts overstate it ~9× | `harness update` in osk before generating more corpus; schema-version-gate every sweep (extends F-10) |
| Giant legacy refs (17k blobs) hang naive sweeps | worker B timeout | Tooling that walks all refs will stall | Date-gate sweeps (F-10) |

## Planning Handoff

- **Preserve**: counts-only privacy posture (ids in, prose never); closed segment/OTLP schemas (any new fleet field goes through the full round-trip: segment schema + serialize + OTLP encode/decode + semconv allowlist); flow-eval ledger append-only semantics.
- **Change carefully**: `session-evidence.ts` (the single-session contract has consumers: `telemetry get`, flow-eval resolvers); flow-eval scenario schema (existing scenarios must stay loadable).
- **Likely files/symbols**: `harness/cli/src/services/telemetry/session-evidence.ts` (fleet merge), a new `telemetry get-fleet`/cohort verb, `.harness/extensions/flow-eval/` (fleet-mode scoring), `live-testing/scenarios/*/scenario.json` (purpose/vibe field), flow-pair run ledger as roster ground truth.
- **Decisions still required** (workshop topics): ① join semantics — env-derived tree vs flow-pair ledger roster vs both-with-reconciliation; ② fleet metric definitions — time (wall-clock union vs sum of active windows), cost (sum of grand totals; how to mark unmeasured copilot lanes), quality (flow-eval judged lanes + artifact-semantics counts at fleet level); ③ the scenario register — where each scenario's *reason/vibe* lives (schema field vs plan-level register) and which scenarios the fleet eval measures first; ④ orphan/duplicate handling; ⑤ POC scope — the 050 fleet is a free fixture for a walking-skeleton join before any CLI verb is built.
