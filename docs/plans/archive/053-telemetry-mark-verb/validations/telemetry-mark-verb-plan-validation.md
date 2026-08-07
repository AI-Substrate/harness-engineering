# Validation — telemetry-mark-verb-plan

**Target**: `docs/plans/053-telemetry-mark-verb/telemetry-mark-verb-plan.md`
**Revision**: as of 2026-07-05 (post-repair)
**Verdict**: ✅ **VALIDATED WITH FIXES**
**Topology**: lead + deterministic proof + 1 independent critic (adaptive, nontrivial plan)

## Thesis

Purpose met. The plan builds `harness telemetry mark` entirely on live mechanisms (verified path:line), reuses the existing annotation-vs-work machinery rather than inventing one, and — after repair — its single consumer-proof task actually exercises the motivating case (a mark-only reviewer lane). Target proof level (Contract/Implementation plan) = actual proof.

## Deterministic proof (lead-read)

| Claim | Evidence | Result |
|-------|----------|--------|
| rollup exclusion filter | `rollup.ts:188` `e.kind !== 'flow_log' && e.kind !== 'artifact'` | ✓ |
| laneSemantics attribution channel + artifact-only + blind-guard | `fleet-evidence.ts:469-481` (`if (ev.kind === 'artifact')`, `:480` blind-guard) | ✓ (drove F1) |
| segment builder exported, fills defaults | `segment.ts:455` `export function serializeSegment` | ✓ |
| no exported segment-writer; `nextSeq` private | `capture-service.ts:215` | ✓ (drove F2) |
| segment write matches `^(\d+)\.json$` | `session-evidence.ts:185` | ✓ (.json alone suffices) |
| reusable slug regex | `record-service.ts:26` `/^[a-z][a-z0-9-]*$/` | ✓ |
| value-shape guard | `capture-service.ts:161-169` `isIdShapedValue`/`ENV_VALUE_MAX_LEN` | ✓ |
| subverb registration | `acts/telemetry.ts:493` `.command('telemetry')` + `:499/:638/:1080/:1191` siblings | ✓ |
| observe `unconfigured` surfacing | `observe-service.ts:106-115` | ✓ |
| SEGMENT_SCHEMA_VERSION current | `segment.ts` = `2.2` (plan bumps → 2.3) | ✓ |

## Findings (all repaired in-target)

| Severity | Finding | Evidence | Repair applied |
|----------|---------|----------|----------------|
| HIGH | `laneSemantics` is artifact-hardcoded + drops a mark-only lane as blind (`semantics_measured:false`) — breaks the headline Promise for the reviewer case | `fleet-evidence.ts:474`,`:480`,`:112` | T006 reframed as a **contract** change (mark dimension + amend blind-guard + mirror `fleet-export.schema.json`); `fleet-evidence.ts`→`contract`; added Key Finding 06; T007 fixture now a **mark-only** lane; AC-04 tightened |
| MEDIUM | No exported segment-writer; `nextSeq` private, write inline in `captureTelemetry` — manifest omitted `capture-service.ts` | `capture-service.ts:215`,`:663` | Added `capture-service.ts` to manifest (export `nextSeq`/`writeSegmentFile`); Key Finding 07 records `serializeSegment` gives `tokens:null` free + `.json`-only suffices |
| MEDIUM | `report.ts` `viewOf` strips only `flow_log`, so a mark rides the session timeline (cost math still safe via `computeRollup`); "excluded from every consumer" overstated | `report.ts:368` | T008 documents mark surfaces via `get-fleet` not `telemetry report`/OTLP; optional `kind !== 'mark'` in `viewOf` |

**De-risked**: the critic's check of the plan's scariest assumption (hand-build a full `Segment` against `SEGMENT_REQUIRED_KEYS`) came back **unfounded** — `serializeSegment` fills every default. D-2 is feasible.

## Consumers

STANDALONE-ish — the plan's only downstream consumer is the deferred seam-spine work (D-4 Non-Goal); the get-fleet output-schema change (F1) is the one exposed contract, now captured in the manifest + `fleet-export.schema.json` task.

## Reverification

Re-read the failed checks' cited sources directly (F1 blind-guard `:480`, F2 `nextSeq` `:215`, `serializeSegment` `:455`, `readSegments` `:185`) — all repairs are grounded in confirmed evidence. No open decision requiring human judgment; the four design decisions (D-1..D-4) are recorded with leans surfaced for veto.
