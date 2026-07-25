# Validation — systemic-telemetry-repair-plan.md

- **Validated**: 2026-07-21
- **Target**: `docs/plans/063-systemic-telemetry-repair/systemic-telemetry-repair-plan.md` @ `d8a6dcde37ad956466fee3dc8ffec2aa88015dc2ac194f6d406d686f361742bb`
- **Contract sources**: `original-ask.md`; `research-dossier.md`; `research/official-claude-session-storage.md`; `docs/project-rules/{constitution,architecture,rules}.md`; converged merge `c3ec0cef2dbd42b8c5058df8db176f143e2187bd` with parents `26f4eb094100471ad8feb806098c2c4b25e18230` + `562a2255fc8c470aabd068ee6198d41e2d45ead8`
- **Checks**: exact merge-parent and clean-worktree proof; converged product-tree equality to main562; current-source checks for all six Claude/Copilot/session/ref/fleet/report/act/doc seams; P060 remote act/Git/bundle compatibility review; G1–G7 consumption; heading/order and 8/8 AC map; phase/TDD ordering; 55-file manifest resolution (52 present + 3 declared new); tracked-artifact privacy scan
- **Verdict**: VALIDATED WITH FIXES
- **Thesis / proof**: The converged token-recovery Plan remains implementation-ready at the planning proof level; current merged source and deterministic structure/privacy checks support all six owned seams, while runtime proof remains correctly reserved for the mandatory private RED→GREEN replay.
- **Consumers**: 3/3 phase contracts and 8/8 acceptance criteria mapped; no convergence blocker remains, but downstream work still requires separate stage authority.

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | The first draft required strict symlink refusal and a pre-read byte cap but omitted the filesystem port, production adapter, fakes, and direct tests needed to enforce that contract. | Current `FsPort` has no bounded pre-allocation transcript read; initial Domain Manifest covered Git/capture only. | Fixed before convergence: added filesystem contract/adapter/fake and direct Git/filesystem TDD surfaces. |
| MEDIUM | After convergence, the Plan still described main562 merge/revalidation as future work and did not explicitly protect P060's landed remote telemetry grammar/envelopes on the shared act surface. | Merge `c3ec0cef…` exists with exact parents; converged product paths equal main562; `acts/telemetry.ts` now owns P060 remote ports and commands. | Fixed in Plan v1.0.1: recorded convergence, pinned the merge baseline, and made P060 remote behavior an explicit non-goal/regression contract. |

## Repairs

Plan v1.0.1 records the exact convergence provenance, replaces stale base-divergence wording, preserves P060 remote `ls`/`pull` contracts in Phase 2 tests, and retains the earlier filesystem proof surface. Revalidation passed every source/path, gate, AC, TDD-order, manifest, and privacy check.
