# Fix Tasks: Phase 1 — Safe Capture and Typed Usage

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Make transcript reads confined and fail-closed
- **Severity**: HIGH
- **File(s)**: `/repo/harness/cli/src/adapters/fs/node-fs.ts`, filesystem port and tests
- **Issue**: Final-component `O_NOFOLLOW` does not stop ancestor symlink escape, silently degrades where the flag is absent, and may block on a swapped FIFO.
- **Fix**: Bind the operation to an explicit confinement root; prove the resolved target stays inside it; use final no-follow plus nonblocking classification; return a typed closed result when the platform cannot guarantee the invariant. Cover ancestor symlink, final symlink, unsupported no-follow, race, and FIFO paths.
- **Patch hint**: extend the port operation with the confinement root rather than attempting an unscoped string check in the adapter.

### FT-002: Reduce typed usage at the durable session boundary
- **Severity**: HIGH
- **File(s)**: `copilot-adapter.ts`, `usage-observation.ts`, `ref-source.ts`, `report.ts`, `session-export.ts`, `fleet-evidence.ts`, and focused tests
- **Issue**: Typed tokens live on `usage` events, but durable readers still fold only `turn`; cumulative/final snapshots are also summed as segment deltas.
- **Fix**: Collect typed observations across the whole session and apply kind-aware precedence once. Use the result for session/ref/report/fleet compatibility views; retain legacy turn tokens only when no typed evidence exists. Never add unlike kinds or cumulative snapshots.
- **Patch hint**: make the event stream authoritative and project scalar compatibility totals only after session-wide reduction.

## Medium / Low Fixes

### FT-003: Close OTLP usage validation and version pairing
- **Severity**: MEDIUM
- **File(s)**: `harness/cli/src/services/telemetry/otlp/logs.ts` and reconstruction/session-export tests
- **Issue**: Bucketless usage records and usage under predecessor identities are accepted.
- **Fix**: Require at least one numeric bucket; normalize through the shared contract; reject `usage` unless resource schema is exactly 2.6. Add negative tests for both shapes.

### FT-004: Separate usage vocabulary from reducer implementation
- **Severity**: MEDIUM
- **File(s)**: `harness/cli/src/services/telemetry/events.ts`, `usage-observation.ts`, importers
- **Issue**: An exported event contract imports its kind type from a module classified as internal.
- **Fix**: Move the closed usage-kind/bucket vocabulary into a contract module and have normalization/reduction import it.

### FT-005: Update the Domain Manifest
- **Severity**: MEDIUM
- **File(s)**: `/repo/docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md`
- **Issue**: Four touched production nodes are absent.
- **Fix**: Classify `rollup.ts`, `published-telemetry.ts`, `otlp/types.ts`, and `otlp/resource.ts`, including their compatibility relationships.

### FT-006: Make proof receipts independently reproducible
- **Severity**: MEDIUM
- **File(s)**: `/repo/docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/execution.log.md`
- **Issue**: Aggregate verdicts omit exact commands, exit statuses, and output pointers.
- **Fix**: Record privacy-safe receipts for focused, review-fix, non-PTY full-suite, root PTY comparison, composite checks, Biome, and TypeScript runs.

## Re-Review Checklist

- [x] FT-001 and FT-002 applied with failing-then-passing regressions
- [x] FT-003 through FT-006 applied
- [x] Focused Phase 1 suites pass
- [x] Full/composite proof receipts updated
- [x] Re-run this review verb and achieve zero HIGH/CRITICAL
