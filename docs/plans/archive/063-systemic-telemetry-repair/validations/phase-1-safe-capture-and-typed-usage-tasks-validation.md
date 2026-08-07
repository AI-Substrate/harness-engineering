# Validation — Phase 1 Safe Capture and Typed Usage tasks

- **Validated**: 2026-07-21
- **Target**: `docs/plans/063-systemic-telemetry-repair/tasks/phase-1-safe-capture-and-typed-usage/tasks.md` @ `2bab29b7cecf2bd055ea1ae4624b461894bd196e7f28378fb058b4159d9d12fa`
- **Contract sources**: `systemic-telemetry-repair-plan.md` @ `d8a6dcde37ad956466fee3dc8ffec2aa88015dc2ac194f6d406d686f361742bb`; `backpressure-coverage.md` @ `d1995091ec6285512d73505934985dc2828c19842ac6e98d319549898163da6f`; converged source `fc1803d07f3bf9114b47e47749453077d1142e11`
- **Checks**: canonical 7-column table; T001–T012 continuity; RED and TDD dependency order; 4/4 Phase 1 AC references; 34 logical absolute path resolutions; 4 declared-new outputs; plan/backpressure basis; private packet contract; selected proof commands; tracked-artifact privacy scan; `git diff --check`
- **Verdict**: VALIDATED WITH FIXES
- **Thesis / proof**: The dossier can drive Phase 1 with minimal inference: real RED is gated before product edits, tests precede each implementation slice, every touched file and proof command is explicit, and no private replay authority is implied.
- **Consumers**: Phase 1 implementer requirements are complete; implementation remains blocked on separate human GO and T001's born-closed packet approval.

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | The first backpressure draft proposed `just p063-real-replay`, but no such paved command exists and adding one was not in the Plan manifest or current authority. | Repository sensor inventory and Phase 1 Domain Manifest. | Fixed: survey and tasks require the separately approved packet to supply one exact private local command; no tracked command is guessed. |
| MEDIUM | Initial task Notes used shorthand such as `AC-01/02/08`, which did not resolve all exact acceptance IDs in deterministic validation. | Exact AC-token check over the canonical task table. | Fixed: every row now names complete IDs such as `AC-01, AC-02, AC-08`. |

## Repairs

Corrected the private replay proof boundary and normalized exact AC traceability. Revalidation passed task continuity, TDD ordering, path resolution, packet gate, proof-plan, and privacy checks.
