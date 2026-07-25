# Phase 3 Execution Log — Real Replay and CI Fixture Promotion

## Outcome

Private replay is GREEN and AC-06 is proven. Ten opaque cases across 15 authorized sources passed field-by-field, post-prune, source-conflict, unknown-join, and inventory-preservation scenarios at the frozen historical fence. The tracked regression substrate contains only minimized synthetic structure and invented counts.

**Testing approach**: Hybrid — real immutable replay first, then minimized structural fixtures with mutation controls.

## Private replay receipt

Only the tracked allowlist is recorded here:

- Verdict: `GREEN`
- Opaque cases: 5 Copilot + 5 standard-Claude
- Authorized source count: 15
- Historical fence: commit `25c686b`; cutoff `2026-07-19T00:41:43Z`
- Packet SHA-256: `1a4fa4706b0fa9eaf80bf31a2b508a9fb5facf6a7950274a10d98ba8b81d99bb`
- Runner SHA-256: `c05b2a6d54b6d72a5607409656c58abec157a7f0e6dac7e36ee62a8b7d4f072a`
- Private result SHA-256: `d551658ace636bf8dbce0ab8a4da31a12a1e056bbdd4eb5923dc9be412554d5a`
- Scenario verdicts: field-by-field `GREEN`; post-prune durable read `GREEN`; measured-vendor-over-empty-ref `GREEN`; unknown-join-unavailable `GREEN`; inventory-unchanged `GREEN`

No private values, source paths, identifiers, or corpus content are tracked.

## Promoted fixture inventory

| File | Purpose |
|---|---|
| `harness/cli/test/services/telemetry/fixtures/lane-sources/p063/token-recovery.json` | Minimal invented structural/numeric records for final-over-checkpoint, billing-only checkpoint, and post-prune honest partiality |
| `harness/cli/test/services/telemetry/token-recovery-fixture.test.ts` | Three observable contracts plus plausible mutation controls |

Fixture bytes contain neutral timestamps and identifiers plus small invented numbers only. They were hand-authored from the proven semantics; no private record or real total was copied.

## Mutation contracts

1. Remove final shutdown → older cumulative checkpoint becomes authoritative.
2. Remove the only checkpoint numeric field → parser emits no observation.
3. Remove the missing durable shard → aggregate ref coverage becomes measured, proving that partiality represents source availability while measured fields survive.

## Automated proof receipts

| Gate | Command | Result |
|---|---|---|
| Fixture unit | `npm test -- test/services/telemetry/token-recovery-fixture.test.ts` | GREEN: 1 file / 3 tests |
| Fixture drift | `npm run check:telemetry-fixtures` | GREEN: 2 frozen suites / 20 tests; 4 committed real instances covered (`artifact://952`) |
| Privacy + publication | `npm test -- test/services/telemetry/fixture-privacy-scan.test.ts test/services/telemetry/publication-boundary.test.ts test/services/telemetry/token-recovery-fixture.test.ts` | GREEN: 3 files / 56 tests. An initial concurrent coverage run hit only a shared `coverage/.tmp` race (`artifact://953`); serialized rerun passed. |
| Focused replay contract | `npm test -- test/services/telemetry/copilot-adapter.test.ts test/services/telemetry/copilot-ledger.test.ts test/services/telemetry/token-evidence.test.ts test/services/telemetry/ref-source.test.ts test/services/telemetry/session-evidence.test.ts test/services/telemetry/fleet-evidence.test.ts test/services/telemetry/report.test.ts test/services/telemetry/report-html.test.ts test/services/telemetry/token-recovery-fixture.test.ts` | GREEN: 9 files / 159 tests |
| Non-PTY full suite | `cd harness/cli && npx vitest run --coverage --exclude test/sensors/tui/pty-input.test.ts` | GREEN: 224 files / 3,115 tests; 88.57% statements, 78.95% branches, 91.15% functions, 91.18% lines |
| Composite | `HARNESS_NO_TELEMETRY=1 HARNESS_NO_TELEMETRY_AUTOSYNC=1 just checks` | Expected baseline-only RED: 224 non-PTY files plus one PTY case passed (3,116 tests); six unchanged PTY cases failed. Build, Biome, typecheck, docs, flows, telemetry fixtures, doctrine parity, skills, and Windows passed; architecture/Markdown remain warn-only (`artifact://957`). |

## Guides

- `docs/how/telemetry.md` now documents per-field merge, billing-only evidence, honest partiality, and no zero-fill.
- `docs/how/telemetry-reports.md` documents degraded coverage/reasons and rendering present fields.
- `docs/how/telemetry-fixtures.md` documents real-GREEN-before-minimized-fixture promotion and the non-skippable manual byte review.

## Independent review

Terra reviewer canary: PASS, model `github-copilot/gpt-5.6-terra` matched. The independent tracked-artifact-only five-axis review returned **APPROVE** with no actionable CRITICAL, HIGH, or MEDIUM finding. Implementation quality, domain compliance, anti-reinvention, testing/evidence, doctrine, and AC-06/07/08 coverage all passed. No fix cycle or gate rerun was required.

- Review report: ignored private review artifact; no private replay inputs were supplied.
- Review report SHA-256: `1c594f5faa89de486acbac2df272aa62214f521ae55d0741f26bcf238ae44d82`
- Verdict: `APPROVE`

## Remaining publication boundary

Automated byte scan and publication gates are GREEN. Prime manually reviewed every promoted fixture/regression byte and approved publication. Commit, push, PR, release, and deployment remain separately closed.
