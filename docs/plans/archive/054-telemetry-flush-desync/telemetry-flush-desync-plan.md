# Telemetry flush-desync fix — `nextSeq` resumes above the durable watermark

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-07-06
**Status**: READY
**Spec source**: unified (this file)

ℹ️ Research skipped — issue #53 was diagnosed end-to-end from a live session; root cause + preferred fix captured in `original-ask.md` and the issue.

## Business Specification

### Summary

`harness telemetry sync` silently stops flushing after a session's buffer directory is cleared out-of-band (temp cleanup, `just clean`, disk pressure, migration churn). The pending-detection compares two counters in the same session that decouple on a buffer wipe: `nextSeq` (the segment filename = `max-existing-file + 1`, which resets to `1` when the dir is emptied) and the **durable** `.flushed` watermark (pinned to the ref manifest's `max_seq`, which only climbs). After a wipe, every new segment sorts *below* the stale watermark, so `seq > flushed` is never true — sync reports `Nothing buffered to flush` with **no error**, and telemetry silently stops reaching a ref. Fix: seed `nextSeq` from `max(durable .flushed watermark, maxExistingFile) + 1` so a wiped buffer resumes **above** the flushed high-water instead of colliding at `1`.

### Goals

- A wiped buffer (empty dir) with a surviving high `.flushed` resumes segment numbering **above** the watermark, so sync flushes it again.
- New segments never collide with / overwrite historical `<n>.json` (≤ watermark) already committed to the ref.
- Fix lives at the single chokepoint (`nextSeq`) so both callers — passive capture and the `mark` verb — are covered.
- No new circular dependency (`arch-check` stays green).

### Non-Goals

- **Recovering this session's already-stranded 280-segment backlog** — that is a separate one-off op (renumber the buffer to `19432+`, per #53), not part of the shipped code fix.
- Changing the ref-rollup / watermark-advance semantics in `sync-service.ts` (the watermark itself is correct; only `nextSeq`'s blindness to it is the bug).
- Reworking the `.flushed` file format or the buffer layout.

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| telemetry (CLI service: `harness/cli/src/services/telemetry/`) | existing | **modify** | Fix `nextSeq` seeding; share `readFlushed` via the `cursor.ts` leaf |

No `docs/domains/` registry exists — the telemetry service is an internal CLI service module; domain is identified inline.

### Testing Strategy

- **Approach**: Lightweight + one focused regression test (the fix's whole point).
- **Rationale**: A pure-function change at a single chokepoint; the risk is behavioural (wipe-then-capture), which a targeted test pins exactly.
- **Focus Areas**: `nextSeq` seeding after a buffer wipe; sync flushes post-wipe segments without clobbering historical ref entries.
- **Excluded**: broad telemetry pipeline re-testing (existing suites cover it).
- **Mock Usage**: none — real in-memory `FsPort` fixtures, matching `capture-service.test.ts`.

### Documentation Strategy

- **Location**: none beyond code comments (D — internal bug fix; issue #53 + the code comment are the record).

### Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=1, D=1, N=0, F=0, T=1
- **Confidence**: 0.9
- **Assumptions**: `${sessionDir}.flushed` is the exact watermark path (verified: `sessionDir = telemetryDir/<sanitized-session>`, watermark = `telemetryDir/<sanitized-session>.flushed`).
- **Dependencies**: none.
- **Risks**: minimal — see Risks table.
- **Phases**: 1 (Simple).

### Acceptance Criteria

1. **AC-01** — Given an empty buffer dir and a surviving `.flushed = 19431`, the next captured segment is written as seq **19432** (not `1`).
2. **AC-02** — After AC-01, `harness telemetry sync` flushes the newly-captured segment(s) (non-zero `synced`) **without** overwriting any historical `<n>.json` (n ≤ 19431) in the rolled ref.
3. **AC-03** — A regression test covers the wipe-then-capture path, is RED before the fix and GREEN after (non-vacuous), and all existing `capture-service` / `sync-service` / `sync-migration` tests stay green.
4. **AC-04** — No new circular dependency: `readFlushed` is shared via `cursor.ts` (the leaf both services already import); `arch-check` stays green.

### Risks & Assumptions

- **Assumption**: reading `.flushed` in `nextSeq` adds one cheap `fs.readText` per segment write — negligible (already done once per sync).
- **Assumption**: `readFlushed` returning `0` on absent/unreadable watermark preserves today's behaviour for a fresh session (max(0, maxFile)+1 == maxFile+1).

### Open Questions

None — the fix is fully specified.

### Workshop Opportunities

None — no design ambiguity.

### Clarifications

#### Session 2026-07-06

- **Mode**: Simple (`--simple`).
- **Clarify**: `--skip-clarify` — #53 specifies the exact fix; no ambiguity to resolve.
- **Testing / Mocks / Docs**: defaulted (Lightweight + regression test / no mocks, real fs fixtures / no new docs) per an explicit "super simple, quick" request.

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: none — all resolved.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | n | explore skipped — #53 already diagnosed |
| workshops/*.md | n | none |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | `--skip-clarify`; no `[NEEDS CLARIFICATION]` markers |
| G2 | Constitution | PASS | `docs/project-rules/constitution.md` — no principle violated (single-chokepoint pure-fn fix) |
| G3 | Architecture | PASS | `docs/project-rules/architecture.md` — fix routes the shared reader through the `cursor.ts` leaf, avoiding a `capture→sync` circular dep |
| G4 | ADR Compliance | N/A | no `docs/adr/` |
| G5 | Structure | PASS | all required sections present |
| G6 | Testing Alignment | PASS | Lightweight + a measurable regression test (AC-01/AC-02); ACs are concrete |
| G7 | Domain Completeness | PASS | telemetry service mapped; no registry to reconcile; manifest covers every referenced file |

### Summary

Move the pure `readFlushed(fs, path)` reader from `sync-service.ts` into the shared `cursor.ts` leaf (no behaviour change), then teach `nextSeq` in `capture-service.ts` to seed from `max(readFlushed(fs, \`${sessionDir}.flushed\`), maxExistingFile) + 1`. A wiped buffer then resumes above the durable flushed high-water instead of restarting at `1` below it. One regression test pins the wipe-then-capture path.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/telemetry/cursor.ts` | telemetry | internal | New exported `readFlushed` (shared leaf) |
| `harness/cli/src/services/telemetry/sync-service.ts` | telemetry | internal | Import `readFlushed` from cursor.ts; drop private copy |
| `harness/cli/src/services/telemetry/capture-service.ts` | telemetry | internal | `nextSeq` seeds from the durable watermark |
| `harness/cli/test/services/telemetry/capture-service.test.ts` | telemetry | internal | Regression test (wipe-then-capture) |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `nextSeq` (`capture-service.ts:214`) = `max-existing-file + 1`; resets to 1 on a buffer-dir wipe while `.flushed` stays high → silent no-op flush | Seed from `max(watermark, maxFile)+1` |
| 02 | High | `readFlushed`/`flushedPathFor` are **private** in `sync-service.ts`, which already imports `capture-service.ts` — importing sync from capture would be circular | Move `readFlushed` to `cursor.ts` (leaf both import) |
| 03 | Medium | Watermark path derives cleanly as `${sessionDir}.flushed` (same sanitized session name) — `nextSeq` signature is unchanged | Read `${sessionDir}.flushed` inside `nextSeq` |
| 04 | Medium | `nextSeq` has two callers (passive capture `:697`, `writeSegmentFile`/mark `:248`) | Fixing the chokepoint covers both |

### Implementation

**Objective**: Seed `nextSeq` from the durable `.flushed` watermark so a wiped buffer resumes above the flushed high-water; share `readFlushed` via `cursor.ts`.
**Testing Approach**: Lightweight + one regression test (RED→GREEN), existing suites stay green.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | Move `readFlushed(fs, path): number` from `sync-service.ts` to `cursor.ts` as an exported fn; update `sync-service.ts` to import it and delete its private copy (no behaviour change) | telemetry | `cursor.ts`, `sync-service.ts` | `sync-service.test.ts` + `sync-migration.test.ts` green; `readFlushed` exported from `cursor.ts` | Per finding 02 |
| [ ] | T002 | In `capture-service.ts`, import `readFlushed` from `cursor.ts` and change `nextSeq` to `return Math.max(readFlushed(fs, \`${sessionDir}.flushed\`), max) + 1;` | telemetry | `capture-service.ts` | A wiped buffer with `.flushed=19431` yields next seq 19432; fresh session (no `.flushed`) still yields `maxFile+1` | Per findings 01, 03, 04 |
| [ ] | T003 | Add a regression test: `.flushed=19431` + empty buffer → `writeSegmentFile` produces `19432.json` (AC-01); and end-to-end `syncTelemetry` then flushes it (non-zero `synced`) without overwriting `<n≤19431>.json` in the ref (AC-02). Real in-memory `FsPort` fixtures | telemetry | `capture-service.test.ts` (+ `sync-service.test.ts` if the flush assertion fits better there) | Test RED before T002, GREEN after; assertion is non-vacuous (flips on revert) | AC-03 |
| [ ] | T004 | Run `harness checks` (full gate) | telemetry | — | tests + typecheck + biome green; `arch-check` green (no new circular dep) | AC-04 |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T002, T003 | `capture-service.test.ts` (seq 19432) |
| AC-02 | T003 | sync flush assertion (non-zero, no clobber) |
| AC-03 | T003, T001 | new test RED→GREEN; existing suites green |
| AC-04 | T001, T004 | `arch-check` green |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| `${sessionDir}.flushed` path mismatch (sanitization) | Low | Medium | Verified path equivalence; test asserts the exact `19432.json` filename |
| Moving `readFlushed` perturbs sync behaviour | Low | Medium | Pure fn, byte-identical move; `sync-service`/`sync-migration` suites gate it (T001) |
| Reading `.flushed` on every capture adds cost | Low | Low | One cheap `fs.readText` per segment write; negligible |
