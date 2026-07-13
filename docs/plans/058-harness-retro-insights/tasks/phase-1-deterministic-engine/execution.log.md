# Phase 1 Execution Log

## T001 — Fixture corpus

**Status**: Complete

Authoring the shared FakeFs corpus with canonical and legacy records, version skew, malformed input, deduplication precedence, deferred dispositions, proof-gap targets, and non-standard kinds.

**Evidence**: `harness/cli/test/services/retro/fixtures.ts` seeds 10 scanned records plus one ignored `*.legacy.md` backup. The corpus spans four plans and schema 1.0/1.1/1.2/1.9, with malformed and unknown-major cases kept separate from valid inputs.

## T002 — Record reader tests

**Status**: Complete

Writing the reader contract tests before the service implementation.

**RED evidence**: `cd harness/cli && npx vitest run test/services/retro/record-reader.test.ts` failed because `services/retro/record-reader.js` did not exist.

## T003 — Record reader implementation

**Status**: Complete

Implementing the injected-FsPort recursive scan, frontmatter/entry parser, version accounting, precedence deduplication, and composable filters.

**GREEN evidence**: targeted reader suite passed 6/6 tests. The service imports only the FsPort and shared logical-path helpers; it contains no direct `node:*` import.

## T004 — Insights engine tests

**Status**: Complete

Writing the clustering, ranking, epistemics, provenance, stale/deferred, low-n, and determinism tests before the engine.

**RED evidence**: `cd harness/cli && npx vitest run test/services/retro/insights.test.ts` failed because `services/retro/insights.js` did not exist.

## T005 — Insights engine implementation

**Status**: Complete

Implementing the pure report engine with injected generation time, structural row epistemics, top-10 ranking, provenance, stale/deferred flags, exact headline totals, and visible low-n folding.

**GREEN evidence**: targeted engine suite passed 8/8 tests, including deterministic ordering under reversed input and complete `members[]` provenance.

## T006 — Retro act tests

**Status**: Complete

Writing act-level tests for the command surface, envelope, source/filter scope, buffer advisory, read-only behaviour, and human rendering.

**RED evidence**: `cd harness/cli && npx vitest run test/acts/retro.test.ts` failed because `acts/retro.js` did not exist.

## T007 — Retro act implementation and wiring

**Status**: Complete

Implementing the Commander surface, reader/engine/buffer composition, JSON and human output ports, and app registration.

**Implementation evidence**: the three retro suites pass 21/21 tests. Full `just test` reached 2303/2306 passing; the only failures are exact command-list expectations in `harness/cli/test/app.test.ts` (2) and `harness/cli/test/index.test.ts` (1). The required `retro` registration is correct, but those existing tests are outside the packet's allowed paths. Scope expansion was requested from the orchestrator.

**Unblocked**: the orchestrator granted a narrow expansion for those two test files. Only the expected command-name arrays changed; the targeted wiring/docs run passed 60/60 tests.

**GREEN evidence**: full `just test` passed 2307/2307 tests across 183 files.

## T008 — Docs and discoverability

**Status**: Complete

Adding the user guide, docs manifest entry, core agent briefing, generated docs content, and help/discovery proof.

**Evidence**: `npm run check:docs` passed; `harness retro insights --help` lists `--plan`, `--since`, `--kind`, and `--agent`; `harness docs --json` lists `harness-retro-insights`; bare `harness instructions` contains the new verb.

## T009 — Live-corpus proof

**Status**: Complete

Running the built human and JSON surfaces over the repository's live canonical and legacy corpus, then checking scan accounting, status-count consistency, and one hand-counted record.

**Built command results**:

- Human and JSON modes both exited 0 with zero crashes.
- Included records: 33; entries: 182; plans: 21; agents: 9.
- Lifecycle counts: open 133, suggested 26, encoded 23, wontfix 0, stale 0, other 0. Sum: 182, exactly equal to total entries.
- Sources: canonical 33 included / 33 parsed / 35 scanned; agents 0 / 0 / 0; `docs/retros` 0 included / 0 parsed / 13 scanned.
- Skip accounting: 15 malformed, 0 unsupported major versions, 0 deduplicated. `33 included + 15 malformed = 48 scanned`.
- The 15 malformed inputs are explained: two canonical non-retro legacy documents omit `retro_id` (`2026-06-09-validate-harness-flow-worker-harvest.md`, `2026-06-10/001-init-ask-signal-correction.md`), and all 13 `docs/retros/*.md` files are prose-era documents without `schema_version`.
- Buffer advisory: 3 pending transient entries, excluded from every committed-record number.
- Structural checks: every top cluster had `members.length === n`; every rendered insight row carried a numeric `n` and non-empty `caveat`.

**Hand-count cross-check**: `.harness/records/retro/2026-07-09/001-056-dont-apologise-fix-phase1.md` parsed as 8 entries: statuses `{open:5, suggested:2, encoded:1}` and dispositions `{deferred:5, task:2, fixed-now:1}`, matching the source record's disposition summary.

## Independent validation

The read-only validator found one material tolerance gap: an unterminated quoted scalar could absorb later fields or the `entries:` boundary without being counted malformed. A RED regression reproduced both top-level and entry-level cases; `record-reader.ts` now rejects the whole record on an unclosed quote. The retro feature suites passed 22/22 after the fix, and the live corpus remained 33 records / 182 entries / 15 explained malformed files.

The validator also questioned target-less `(kind,(none))` clusters. No change was made: the frozen doctrine explicitly clusters the exact `(kind,target)` pair, the schema permits an absent target, and the row caveat/provenance keeps that aggregation honest for the Phase 2 narrator.

## Review fixes

The reviewer identified three contract defects, each reproduced with a negative test before the implementation changed:

- `prefers system.compound lifecycle fields over other system namespaces` — lifecycle fields now come from the exact `system.compound` nesting path, with legacy entry-level fields used only as fallback.
- `ranks target proof gaps ahead of older keyword proof gaps` — cluster ordering now ranks proof signals explicitly as `target > keyword > none` before age.
- `parses quoted and unquoted scalars with trailing YAML comments` — scalar parsing now removes comments only when the `#` is outside quoted text.

**RED evidence**: the focused reader/engine run failed exactly 3 tests, with 15 existing tests passing.

**GREEN evidence**: all three retro suites passed 25/25 tests; the full suite passed 2311/2311 tests across 183 files. `just fix` made no changes. `harness checks` exited 0 with every hard gate green and only the existing warn-launch architecture and Markdown findings.

## Phase-complete summary

- T001–T009 are complete.
- Final full suite: 2311/2311 tests across 183 files.
- Focused retro suites: 25/25 tests, including the three review regressions.
- `just fix`: clean after the review fixes.
- Build, typecheck, Biome, docs/flows/telemetry/doctrine drift guards, skills-check, and windows-check: green.
- `harness checks`: exit 0 / `degraded` only for the repository's existing warn-launch backlog (2 architecture warnings and 199 Markdown findings); every hard gate passed.
- Live-corpus proof after the final rebuild: 48 scanned = 33 included + 15 malformed; 182 lifecycle statuses = 182 entries.
- Post-coding drain surfaced three shared pre-existing observations. They were not materialized or cleared because this delegation forbids `.harness/records/` writes and does not own the shared buffer.
