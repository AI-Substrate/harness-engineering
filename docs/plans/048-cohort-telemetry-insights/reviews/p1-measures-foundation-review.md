# Review — 048 Phase 1: Measures foundation & month sweep (tasks 1.1, 1.2-fix, 1.4–1.7)

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 1 CRITICAL + 2 HIGH fixed → narrow re-review, reviewer independently re-verified → orchestrator sanity pass)
**Mode**: flow-pair cross-model (orchestrator Claude Fable 5 `pij-4s10mb`; coder Copilot claude-opus-4.8 xhigh `pij-1kwcc01`; reviewer Copilot gpt-5.5 xhigh `pij-xfl71a`)
**Reviewed**: 2026-07-02 · **Gates**: full CLI **1940 / 157 files** green (baseline 1905, +35) · scoped biome exit 0 (85 files) · tsc clean · orchestrator sanity pass at acts/telemetry.ts:148-170 + :974

## What landed

- **1.1 Token-fidelity verification: CONFIRMED** — turn tokens ride OTel `gen_ai.usage.input/output_tokens`; 572/670 turns across 37 real refs token-bearing; e2e git-ref export of a real session reproduced sent 898,653 / received 3,105,343 over 1,542 turns. **Task 1.7 closed not-needed** on that evidence. (Also surfaced honestly: July-2026 shards carry zero token-bearing turns — declared via `token_coverage`, lead for later.)
- **1.2-fix plan identity + FlowEvent starvation** (orchestrator root-caused: `resolvePlanId` fired only from env/cwd-in-plan-dir — 4/19,406 real segments had `plans_touched`, 3 had flow events): `plans_touched` = deduped union of env/cwd planId + `docs/plans/<id>` prefixes from touched files; flight-plan read gains a deterministic evidence fallback (single plan → read; multiple → prefer touched the-flow.json; ambiguous → NO flow event, list kept). +9 tests incl. regex hygiene.
- **1.4 FlowEvent-primary flow_stage lens**: FlowEvent (nav node id) → digit fallback → `unlabeled`; versioned semantic map `flow-stage-map/v1` (node-id → research/plan/implement/review/ship) emitting `semantic_stage`; provenance carries the map version + per-window `flow_stage_mechanism {flow, digit, unlabeled}` counts. report.ts:13-14 header finally true.
- **1.5 sent/received render**: HTML token columns collapse to sent/received (fresh-only, FX002); cache column removed from render, internals retained in JSON.
- **1.6 `harness telemetry sweep --month YYYY-MM [--out]`**: pure `sweep.ts` planner (ports-free) + acts wiring; per-session export cache fingerprinted over the planned refs; version-tolerant (v2.0 thin shards → time-only + declared `token_coverage`, never fabricated zeros). Live smoke from real refs: July → 6 sessions, `token_coverage {measured:0, unmeasured:6}`, re-sweep `exported:0 reused:6`.
- Schema: report.schema.json additions additive.

## Findings (fixed → narrow re-review with independent re-verification)

- **F1 · CRITICAL · cross-month leak**: the sweep's export path discarded the planned ref set and re-globbed ALL of a session's refs (`readSessionShards` filters by session suffix only) — a July sweep of a session with June refs folded June shards into the July report, breaking AC-01 comparability. **Fix**: new `combineSessionFromRefs` (acts/telemetry.ts:148-170) reads exactly the planned in-month blobs, wired at :974; same-session June+July fixtures prove July-only totals and a month-scoped export cache. Reviewer traced at source that `readSessionShards` is no longer reachable from the sweep.
- **F2 · HIGH · Dim-0 gap (test-only)**: the reviewer's `docs/plans/` → `docs/plans/?` mutation on the touched-file union survived 14/14. New test (plans-touched-union.test.ts:141-161) covers `docs/plansfoo`/`docs/plansfoobar` rel+abs; the reviewer **re-ran its own mutation** post-fix → RED exactly at :160; restore hash verified.
- **F3 · HIGH · false gate claim**: "biome clean" was untrue on two new test files (formatting). Reformatted; scoped biome re-run by BOTH parties → exit 0.

## Dim-0 (reviewer-run, all restored, hashes recorded)

FlowEvent priority inversion → RED flow-stage-lens.test.ts:103/:126 · semantic map review→implement → RED :128/:178 · **regex false-positive → GREEN = F2** · stale sweep cache → RED sweep.test.ts:130 · v2.0-thin-counted-measured → RED sweep-act.test.ts:138.

## Orchestrator-owned residue (open, tracked)

- Live confirm of 1.2-fix (fresh dist + one plan-touching harness command → segment carries plans_touched + flow event) — pending build.
- DL-002 digit confirm (AC-13) — needs one user-typed `/the-flow <digit>`.

## Disposition

APPROVE recorded. The measures layer is month-capable, month-*scoped* (post-F1), semantically labeled, and honest about coverage. Phase 2 (insights layer) unblocked.
