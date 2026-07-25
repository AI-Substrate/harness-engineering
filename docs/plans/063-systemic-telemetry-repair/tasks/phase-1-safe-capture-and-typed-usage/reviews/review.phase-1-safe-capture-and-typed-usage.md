# Code Review: Phase 1 — Safe Capture and Typed Usage

**Plan**: `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md`
**Spec**: unified plan, `## Business Specification`
**Phase**: Phase 1 — Safe Capture and Typed Usage
**Date**: 2026-07-23
**Reviewer**: Automated five-axis review fleet
**Testing Approach**: Full TDD

## A) Verdict

**REQUEST_CHANGES**

Three unmitigated HIGH findings remain.

**Key failure areas**:
- **Filesystem safety**: the no-follow reader can escape through symlinked ancestors and does not fail closed where `O_NOFOLLOW` is unavailable.
- **Durable token truth**: typed usage is emitted on `usage` events, but durable readers still inspect only `turn`; cumulative snapshots are also projected into additive segment totals.
- **Testing**: no cross-segment regression protects the durable session/fleet totals that currently double-count cumulative checkpoints and final shutdown.

## B) Summary

The phase establishes a strong typed observation model, bounded Git candidate discovery, defensive schemas, and substantial RED→GREEN evidence. Anti-reinvention found no duplicate capability. The public contract remains unsafe at two critical boundaries: confined transcript reads and session-wide usage reduction. Five medium findings cover OTLP closure/version pairing, contract placement, plan manifest currency, and proof receipts. Fixes must return through the Phase 1 implement verb, followed by this review again.

## C) Checklist

**Testing Approach: Full TDD**

- [x] RED evidence precedes implementation
- [x] Real historical RED evidence recorded without private values
- [x] Focused product and compatibility tests present
- [ ] Multi-segment durable token summary is tested and correct
- [ ] No-follow confinement holds across ancestor symlinks and unsupported platforms
- [ ] Exact proof commands, exits, and artifact pointers are recorded
- [x] Only Phase 1 product domains are intentionally changed
- [x] TypeScript build evidence recorded
- [x] Existing architecture checks represented in the full proof

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|---|---|---|---|---|---|
| F001 | HIGH | `/repo/harness/cli/src/adapters/fs/node-fs.ts:65` | security | Final-component `O_NOFOLLOW` does not confine ancestor symlinks, is unavailable on Windows, and can block on a swapped FIFO. | Make reads root-aware and fail closed when atomic no-follow cannot be guaranteed; add symlink-ancestor/final-symlink/FIFO tests. |
| F002 | HIGH | `/repo/harness/cli/src/services/telemetry/adapters/copilot-adapter.ts:740,766` | correctness | Typed-only tokens move to `usage` events while durable ref/report consumers still handle token evidence only on `turn`, losing measured tokens after sync/prune. | Reduce `usage` observations session-wide in every durable reader, with legacy turn tokens only as fallback. |
| F003 | HIGH | `/repo/harness/cli/src/services/telemetry/adapters/copilot-adapter.ts:711-712` | correctness | Cumulative checkpoints/final shutdown are projected into additive `Segment.tokens`; session/fleet readers sum them and double-count. | Stop treating snapshots as per-window deltas; derive compatibility totals only after kind-aware session reduction. |
| F004 | MEDIUM | `/repo/harness/cli/src/services/telemetry/otlp/logs.ts:254-261` | correctness | OTLP accepts a usage record with no numeric bucket although Segment 2.6 rejects it. | Require at least one bucket and decode through the shared normalizer. |
| F005 | MEDIUM | `/repo/harness/cli/src/services/telemetry/otlp/logs.ts:961-975` | compatibility | Direct reconstruction accepts `usage` under Segment 2.4/2.5 identities. | Reject usage unless the resolved resource schema is exactly 2.6. |
| F006 | MEDIUM | `/repo/harness/cli/src/services/telemetry/events.ts` | domain | Exported `UsageEvent` leaks `UsageObservationKind` from an internal reducer module. | Move the vocabulary to a contract module; keep normalization/reduction internal. |
| F007 | MEDIUM | `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md` | domain | Domain Manifest omits touched production nodes `rollup.ts`, `published-telemetry.ts`, `otlp/types.ts`, and `otlp/resource.ts`. | Add explicit classifications and relationships for the four files. |
| F008 | MEDIUM | `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/execution.log.md:25-33` | evidence | Aggregate green claims omit exact commands, exit statuses, and artifact pointers required by T012. | Record privacy-safe command/exit/evidence receipts for every focused/full/composite gate. |

## E) Detailed Findings

### E.1) Implementation Quality

- **F001**: `lstat` and `O_NOFOLLOW` protect only the final path component; a symlinked `projects/<key>` ancestor can escape the selected root. On platforms without `O_NOFOLLOW`, bitwise coercion produces an ordinary open. `O_NONBLOCK` is also needed before classifying non-regular handles.
- **F002**: current ref/report folds dispatch usage only from `turn`, while the new adapter emits typed evidence on `usage`.
- **F003**: cumulative and final snapshots are state, not deltas. Summing their compatibility projection violates the plan’s unlike-kinds-never-add rule.
- **F004/F005**: strict Segment JSON, OTLP reconstruction, and predecessor-version compatibility enforce different closed sets.

### E.2) Domain Compliance

| Check | Status | Details |
|---|---|---|
| File placement | ✅ | New adapter/service files are under existing harness-cli trees. |
| Contract-only imports | ❌ | F006 exposes an internal usage-kind type through `events.ts`. |
| Dependency direction | ✅ | No infrastructure-to-business reversal found. |
| Domain.md updated | N/A | This repository does not maintain `docs/domains/*` artifacts. |
| Registry current | N/A | No domain registry exists. |
| No orphan files | ✅ | Complete diff includes all new source/test/evidence files. |
| Map nodes current | ❌ | F007: plan Domain Manifest omits four touched production nodes. |
| Map edges current | N/A | No domain map exists. |
| No circular business deps | ✅ | No new cycle found. |
| Concepts documented | N/A | No domain concept registry convention is in use. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|---|---|---|---|
| Bounded no-follow filesystem operations | Existing `FsPort` extended | harness-cli | proceed |
| Bounded worktree discovery | Existing `GitPort` extended | harness-cli | proceed |
| Typed usage normalization/reduction | None | harness-cli telemetry | proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 73%

| AC | Confidence | Evidence |
|---|---:|---|
| AC-01 — Bounded Claude lookup | 92% | Real adapter tests cover final symlink, non-file, UTF-8 byte ceiling, sparse oversize, bounds, malformed worktree records, and exact-one selection; ancestor confinement/Windows/FIFO remain unproved. |
| AC-02 — Typed Copilot observations | 55% | One-segment reducer/schema/OTLP tests are broad; no multi-segment durable reader test covers cumulative/final precedence. |
| AC-06 — Real historical RED slice | 80% | Execution log records approved packet/result hashes, 15 sources, opaque prefixes, and `RED_EXPECTED`; Phase 3 GREEN remains intentionally unrun. |
| AC-08 — Compatibility/privacy | 84% | Closed schemas and mutation tests are strong; bucketless OTLP and predecessor-version usage remain accepted. |

### E.5) Doctrine Compliance

- **F001 (HIGH)** violates Constitution P2/P5 and AC-01’s fail-closed no-follow boundary.
- **F004/F005 (MEDIUM)** violate Constitution P4/P5/P12’s closed telemetry identity contract.
- Public/private evidence hygiene passed: no private corpus values were found in the tracked review substrate.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|---|---|---|---:|
| AC-01 | Safe bounded transcript location | Locator/port tests and RED→GREEN counts; F001 remains | 92% |
| AC-02 | Typed usage without double counting | Typed reducer and transport tests; F002/F003 remain | 55% |
| AC-06 | Real historical replay discipline | Opaque packet/result hashes and RED verdict | 80% |
| AC-08 | Compatibility and privacy | Strict schemas/publication tests; F004/F005 remain | 84% |

**Overall coverage confidence**: 73%

## G) Commands Executed

```bash
git status --short
git diff --stat
git diff --staged --stat
git diff --no-ext-diff
# Five read-only review agents inspected the complete saved diff; no tests/build/formatters were run by review.
```

## H) Handover Brief

**Review result**: REQUEST_CHANGES

**Plan**: `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md`
**Spec**: unified plan
**Phase**: Phase 1 — Safe Capture and Typed Usage
**Tasks dossier**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/tasks.md`
**Execution log**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/execution.log.md`
**Review file**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/reviews/review.phase-1-safe-capture-and-typed-usage.md`

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---|---|---|---|
| `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/reviews/_computed.diff` | complete 53-file manifest | cross-domain | Apply F001–F008 |
| `/repo/harness/cli/src/adapters/fs/node-fs.ts` | HIGH | harness-cli adapters | F001 |
| `/repo/harness/cli/src/services/telemetry/adapters/copilot-adapter.ts` | HIGH | harness-cli telemetry | F002/F003 |
| `/repo/harness/cli/src/services/telemetry/otlp/logs.ts` | MEDIUM | harness-cli telemetry | F004/F005 |
| `/repo/harness/cli/src/services/telemetry/events.ts` | MEDIUM | harness-cli contract | F006 |
| `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md` | MEDIUM | plan manifest | F007 |
| `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/execution.log.md` | MEDIUM | evidence | F008 |

### Required Fixes

| # | File (absolute path) | What To Fix | Why |
|---|---|---|---|
| 1 | `.../node-fs.ts` | Root-aware no-follow confinement and platform/FIFO safety | Prevent out-of-root transcript reads |
| 2 | `.../copilot-adapter.ts` plus durable consumers | Session-wide usage reduction and compatibility projection | Preserve tokens after sync/prune without double counting |
| 3 | `.../otlp/logs.ts` | Bucket closure and schema-version pairing | Keep all readers on one closed contract |
| 4 | `.../events.ts` / `usage-observation.ts` | Separate contract vocabulary from reducer implementation | Restore declared domain boundary |
| 5 | Plan and execution log | Manifest currency and exact gate receipts | Make evidence independently reproducible |

### Domain Artifacts to Update

| File (absolute path) | What's Missing |
|---|---|
| `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md` | Classifications for rollup, published reader, OTLP types, and resource projection |

### Handback

Fixes go back through the implement verb with the same Phase 1 flags, then this review must re-run.
