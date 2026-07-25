# Phase 2 Execution Log — Durable Evidence and Truthful Readers

## Outcome

Phase 2 is complete. Token evidence is additive, per-field, teardown-safe, quality-merged across all rostered lanes, and publicly honest.

**Testing approach**: Hybrid — regression REDs exposed compatibility gaps during implementation; dedicated contract tests and repository-wide proof close the final behavior.

## TDD and compatibility transitions

| Transition | Exact command / evidence | Result |
|---|---|---|
| Initial focused compatibility | Phase 2 session/ref/fleet/report/act suite | RED: measured Codex total and measured-ref scalar precedence exposed overlap/source projection defects; expanded report coverage changed the expected shape (`artifact://667`). |
| Sweep propagation | `npx vitest run --coverage --exclude test/sensors/tui/pty-input.test.ts` | RED: sweep expected binary coverage before `partial`/`unavailable` propagation (`artifact://683`). |
| Contract unit | `npm test -- test/services/telemetry/token-evidence.test.ts test/services/telemetry/session-export.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/fleet-evidence.test.ts test/acts/telemetry.test.ts` | GREEN: 5 files / 100 tests. |
| Focused Phase 2 | `npm test -- test/services/telemetry/token-evidence.test.ts test/services/telemetry/session-evidence.test.ts test/services/telemetry/session-export.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/fleet-evidence.test.ts test/services/telemetry/fleet-golden-051.test.ts test/services/telemetry/fleet-semantics.test.ts test/services/telemetry/fleet-semantics-golden-051.test.ts test/services/telemetry/copilot-ledger.test.ts test/services/telemetry/report.test.ts test/services/telemetry/report-html.test.ts test/services/telemetry/central-layout.test.ts test/services/telemetry/sweep-act.test.ts test/services/telemetry/git-read.test.ts test/services/telemetry/publication-boundary.test.ts test/services/telemetry/remote-telemetry-service.test.ts test/services/telemetry/telemetry-bundle-reader.test.ts test/acts/telemetry.test.ts` | GREEN: 18 files / 340 tests. |
| Build | `npm run build` | GREEN: docs/flows regenerated; TypeScript passed (`artifact://885`). |
| Biome | `npm run fix` | GREEN: 413 files checked; no fixes remained (`artifact://880`). |
| Non-PTY full suite | `cd harness/cli && npx vitest run --coverage --exclude test/sensors/tui/pty-input.test.ts` | GREEN: 223 files / 3,111 tests; 88.52% statements, 78.86% branches, 91.15% functions, 91.16% lines. |
| Composite | `HARNESS_NO_TELEMETRY=1 HARNESS_NO_TELEMETRY_AUTOSYNC=1 just checks` | Expected baseline-only RED: all 223 non-PTY files plus one PTY case passed (3,112 tests); six unchanged PTY cases failed. Biome, typecheck, docs, flows, telemetry fixtures, doctrine parity, skills, and Windows passed; architecture/Markdown remain warn-only baselines (`artifact://888`). |

## Delivered contracts

- `TokenEvidence` carries aggregate `measured | partial | unavailable`, closed reason, `cause: unknown`, compatibility source, and per-field value/source/observation-kind/coverage/reason.
- Session evidence/export and ref reconstruction preserve typed evidence after local prune; incomplete typed evidence never falls back to stale scalars.
- Fleet enrichment evaluates live/ref/ledger evidence for every rostered lane, merges complementary measured fields, and retains deterministic scalar source/totals.
- Session/fleet/report schemas carry additive evidence; reports count measured/partial/unavailable while retaining `unmeasured` compatibility.
- Session-save returns a degraded envelope plus `next_action` for partial/unavailable token coverage; measured sessions retain the existing ok envelope.
- Sweep and report reuse the same expanded coverage object; P060 remote `ls`/`pull` grammar and envelopes remain unchanged.
- Existing telemetry, report, and fixture guides document post-sync reads, evidence semantics, degraded states, and real-before-sanitized proof.
- Review fixes add durable `telemetry get`, exact legacy bucket projection, compaction-partial classification, optional v1 schema evidence, all-public degraded dispatch, reason/cause histograms, and visible HTML coverage.
- Final review repairs preserve present partial values, recover post-prune `telemetry get`, downgrade mixed legacy windows, preserve billing-only headlines, expose every public degraded branch, render coverage/reasons, and keep predecessor schemas additive.

## Compatibility and privacy

- Existing scalar totals and source remain compatibility projections.
- Measured refs retain precedence over measured ledgers; measured vendor fields outrank empty ref fields.
- Codex cached/reasoning sub-buckets remain billing detail and are not double-added into the compatibility total.
- Fields absent from typed evidence remain `null`/unavailable; no absent field becomes a measured zero.
- All new public shapes are counts, enums, closed reasons, and safe identifiers only.

## Review

Initial five-axis review returned implementation, doctrine, domain, evidence, and duplication findings. Review fixes added durable ref-backed get, exact legacy buckets, partial-value preservation, billing-only handling, optional predecessor schemas, all-public degraded dispatch, reason/cause histograms, visible HTML coverage, contract ownership, and focused behavior tests.

Final narrow rechecks: implementation CLEAN; doctrine CLEAN; domain CLEAN; evidence CLEAN; anti-reinvention CLEAN. Final review: `reviews/review.phase-2-durable-evidence-and-truthful-readers.final.md` — **APPROVE**.

## Discoveries

- Source quality must be evaluated after field availability: a nominally higher source with no measured field cannot mask a lower measured source.
- Vendor billing sub-buckets can overlap headline token totals; compatibility totals must preserve the vendor total rather than summing overlapping detail.
- Coverage expansion is additive but exact-object tests must intentionally adopt the new `partial` and `unavailable` counters.

Phase 3 private GREEN replay and sanitized fixture promotion remain separately gated.
