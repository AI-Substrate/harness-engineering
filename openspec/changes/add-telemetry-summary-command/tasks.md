## 1. Summary Service

- [ ] 1.1 Add typed telemetry-buffer summary and diagnostic result shapes plus a pure service that resolves the current repository buffer through injected ports.
- [ ] 1.2 Reuse or extract the existing sorted segment traversal so the service scans dot-free session directories and numeric segment JSON files while preserving existing consumers.
- [ ] 1.3 Aggregate current `event_stream` records and legacy `normalizeV1ToEvents` output into total, `EVENT_KINDS`-ordered global counts, and ascending UTC-day totals with per-kind counts.
- [ ] 1.4 Track scanned sessions, counted/skipped segments, counted/skipped events, and recognized undated events without mutating buffer state.

## 2. Service Tests

- [ ] 2.1 Add focused summary-service tests for multiple sessions, multiple kinds, multiple UTC days, timestamp offsets, and deterministic ordering.
- [ ] 2.2 Cover empty/absent buffers, legacy flat segments, malformed JSON segments, unknown event kinds, and invalid event timestamps with honest diagnostics.
- [ ] 2.3 Prove the summary path performs no filesystem writes, renames, deletions, git reads, or git writes.

## 3. CLI Integration

- [ ] 3.1 Register `harness telemetry summary` in `registerTelemetryAct`, update the telemetry family description, and map the service result to a successful standard `telemetry` envelope.
- [ ] 3.2 Add deterministic human rendering for totals, kind counts, UTC-day counts, and non-zero skipped/undated diagnostics while preserving JSON mode as a single valid envelope.
- [ ] 3.3 Add act-level tests for JSON output, human output, empty-buffer success, exit codes, and injected-port wiring.

## 4. Documentation and Verification

- [ ] 4.1 Document `harness telemetry summary`, its local-buffer scope, UTC grouping, diagnostics, and read-only behavior in `docs/how/telemetry.md`.
- [ ] 4.2 Regenerate the embedded documentation bundle so `harness/cli/src/services/docs/docs-content.ts` matches the telemetry source document.
- [ ] 4.3 Run the targeted telemetry service and act tests, then run the repository's composite `harness checks` gate.
