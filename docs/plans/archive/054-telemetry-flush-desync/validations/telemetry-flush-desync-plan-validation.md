# Validation — telemetry-flush-desync-plan

**Verdict**: ✅ VALIDATED — no material issues
**Target**: `docs/plans/054-telemetry-flush-desync/telemetry-flush-desync-plan.md` (Simple, CS-2, READY)
**Validated**: 2026-07-06 · adaptive (lead + deterministic proof; zero critics — tiny target settled by direct source proof)

## Proof (fresh, against merged `main` @ `cc7c3871`)

| Claim | Check | Result |
|---|---|---|
| `nextSeq` = `max-existing-file + 1` | `capture-service.ts:215` | ✓ confirmed |
| Watermark pinned to union max_seq | `sync-service.ts:493` `Math.max(refMaxSeq, bufferMat.maxSeq)` + `:516` `writeFlushed(…, material.maxSeq)` | ✓ confirmed (findings 01/02 accurate) |
| `readFlushed` is private in sync-service | `sync-service.ts:139` (no `export`) | ✓ — justifies the move to `cursor.ts` |
| `capture→sync` import would be circular | `sync-service.ts:12` imports `capture-service` (`KILL_SWITCH_ENV`); `capture` imports only `cursor` | ✓ — finding 02 sound |
| `cursor.ts` is the shared leaf | imported by both; has `FsPort` + `posixJoin` | ✓ — correct home for `readFlushed` |
| Watermark path `${sessionDir}.flushed` | `sessionDir = telemetryDir/<sanitized>`; watermark = `telemetryDir/<sanitized>.flushed` | ✓ — `nextSeq` signature unchanged |
| Both callers covered | `nextSeq` called at `:248` (mark) + `:697` (passive capture) | ✓ — single-chokepoint fix |
| Test files exist | `capture-service.test.ts`, `sync-service.test.ts`, `sync-migration.test.ts` | ✓ |
| Plan structure + cross-refs | Business Spec + Planning Seam + Impl Plan present; AC-01..04 / T001..04 resolve | ✓ |

## Thesis

**Advanced.** The plan's purpose — stop `sync` silently no-op'ing after a buffer wipe — is met by the smallest correct change (seed `nextSeq` from the durable watermark). Proven surgical: `max(readFlushed, maxFile)+1` equals today's `maxFile+1` in normal operation (`maxFile ≥ watermark` between syncs) and only diverges when `maxFile < watermark` — exactly the wipe case. Graceful under age-out too (deleted `.flushed` → `readFlushed=0` → `maxFile+1`).

## Consumers

`readFlushed` has one consumer (sync-service, internal); moving it to `cursor.ts` and exporting preserves it. `nextSeq` is private, signature unchanged. No external shape changes — internal-only.

## Notes

- Non-material: plan cites `capture-service.ts:214` (the doc-comment line); the `function nextSeq` declaration is `:215`. Same symbol — not corrected.
