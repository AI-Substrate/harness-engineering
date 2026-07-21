# Validation — systemic-telemetry-repair-plan.md

- **Validated**: 2026-07-21
- **Target**: `docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md` @ `c6ebfedd678b3e0686e367db1bf8924eed05ed4ebe14e9b195314f665bd38a41`
- **Contract sources**: `original-ask.md`; `research-dossier.md`; `research/official-claude-session-storage.md`; `docs/project-rules/{constitution,architecture,rules}.md`; landed source tree `562a2255fc8c470aabd068ee6198d41e2d45ead8`
- **Checks**: current-source symbol inspection for Claude/Copilot/session/ref/fleet/report/act paths; required heading/order check; G1–G7 consumption; AC definition/coverage equality; phase/TDD ordering; 55-file manifest resolution with three declared-new files; tracked-artifact privacy scan
- **Verdict**: VALIDATED WITH FIXES
- **Thesis / proof**: The narrowed token-recovery Plan is implementation-ready at the planning proof level; fresh source checks and deterministic structure/privacy checks support all six owned seams, while runtime behavior remains reserved for the mandated real RED→GREEN replay.
- **Consumers**: 3/3 phase contracts and 8/8 acceptance criteria mapped; downstream task expansion remains blocked on the separately required main562 convergence revalidation.

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | The first draft required strict symlink refusal and a pre-read byte cap but omitted the filesystem port, production adapter, fakes, and direct tests needed to enforce that contract. | Current `FsPort` has no bounded pre-allocation transcript read; initial Domain Manifest covered Git/capture only. | Fixed: added filesystem contract/adapter/fake and direct Git/filesystem TDD surfaces; deterministic validation reran clean. |

## Repairs

Added `FsPort`/`NodeFs`/`FakeFs`, direct Git/filesystem test surfaces, and explicit pre-allocation candidate/byte-cap success criteria to Phase 1; revalidation passed every structural, source-path, AC, TDD-order, and privacy check.
