# Original ask — telemetry-flush-desync

**Captured**: 2026-07-06  ·  **By**: /the-flow

> new flow, simple, quick please to fix #53

## Context (issue #53)

`harness telemetry sync` silently no-ops after the session buffer dir is
cleared: `nextSeq` (capture-service.ts:214 — `max-existing-file + 1`) resets to
1, but the durable `.flushed` watermark (pinned to the ref manifest's `max_seq`
in sync-service.ts) stays high, so every new segment sorts *below* the watermark
and never flushes — no error. Preferred fix (from #53): seed
`nextSeq = max(readFlushed(), maxExistingFile) + 1` so a wiped buffer resumes
above the flushed high-water instead of colliding at 1.
