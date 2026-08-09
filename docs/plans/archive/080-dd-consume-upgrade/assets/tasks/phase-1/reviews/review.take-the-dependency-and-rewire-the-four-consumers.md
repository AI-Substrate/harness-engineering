# Code Review: Take the dependency and rewire the four consumers

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/plan.dd.json`  
**Spec**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/plan.dd.md`  
**Phase**: Phase 1: Take the dependency and rewire the four consumers  
**Date**: 2026-08-09  
**Reviewer**: pij-modern-caribou (GPT-5.6 Terra)  
**Testing Approach**: Hybrid

## A) Verdict

**APPROVE**

The pin is a full 40-character git SHA at the required ancestry floor; the four consumer rewires use only public package homes, retaining only the ratified `services/dd/plan` phase-2 remainder. The A-2 drain preserves `null` and tests the only conditional reader with `=== false`; no remaining truthiness read of this value was found. The installed-package spec proves pack shape, closed exports, typed foreign-port composition, `tracked === null`, and drive-rooted resolution.

**Dogfood adjudication**: accept `dw-0009` as checked for this phase. `flow orient` and `flow rail` are `ok`; `plan validate` is deliberately `degraded` but exits 0 with zero errors. Its contradictions are an independently confirmed plan-model limitation, not a rewire failure, and are already routed in ledger entry 4. This acceptance is on the "pair ran with zero errors" reading, not a claim that all three envelopes have `status: ok`.

## B) Summary

The five scoped commits cleanly consume `@ai-substrate/dd` from the root runtime dependencies at `a37a20ecf12342275a9d81b4cf8835302de8e9e0`; `f712ded` is an ancestor of that pin. The phase diff is confined to the planned dependency, integration probe, four consumer files, A-2 fork-drain files, and plan evidence. `just build` and the full 348-file/5,148-test suite passed independently. Domain governance is off, and no new production component duplicates an existing capability.

One evidence-detail discrepancy remains: the current validator reports seven structural contradictions, while the ledger describes five. The two additional warnings are the same binary-`satisfies` class (`tk-0005` against still-open multi-phase AC-000b and AC-000c), so this does not invalidate the phase proof or require a source-code change.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Installed-package integration coverage added for the SDK boundary.
- [x] Build and full test suite passed independently.
- [x] Scoped import greps match the phase boundary.
- [x] Required dogfood commands completed with zero errors.
- [x] Only scoped files changed in `cf2cf589^..df452f32`.
- [x] Runtime dependency is in root `dependencies`.
- [x] Domain compliance is N/A (domains are off).

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|---|---|---|---|---|---|
| F001 | LOW | `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/assets/dogfood-ledger.md:34` | evidence | Ledger entry 4 inventories five contradictions, but the independent current run reports seven. | When the partial-`satisfies` design ruling is advanced, include `tk-0005 -> ac-000b/ac-000c` with the existing five edges. |

## E) Detailed Findings

### E.1) Implementation Quality

No correctness, security, error-handling, performance, scope, or architecture finding.

- The package import homes agree with the installed exports map, including the host-bound `@ai-substrate/dd/node` tier.
- `SchemaFs` is annotated at the fixture declaration; no casts, shim, or local replacement was introduced.
- The A-2 drain widens the fork's tracked fields to `boolean | null`, propagates the value through resolver/traversal records, and branches only on `loaded.tracked === false`.
- Searches found no surviving `!loaded.tracked` branch or other truthiness branch over this tri-state value.

### E.2) Domain Compliance

Domain mode is off (`docs/domains/registry.md` is absent; the plan records G7 as N/A).

| Check | Status | Details |
|---|---|---|
| File placement | N/A | Domains off. |
| Contract-only imports | N/A | Domains off. |
| Dependency direction | N/A | Domains off. |
| Domain.md updated | N/A | Domains off. |
| Registry current | N/A | Domains off. |
| No orphan files | N/A | Domains off. |
| Map nodes current | N/A | Domains off. |
| Map edges current | N/A | Domains off. |
| No circular business deps | N/A | Domains off. |
| Concepts documented | N/A | Domains off. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|---|---|---|---|
| `dd-package-boundary.int.test.ts` | None; it promotes the prior package-consumer POC into durable boundary proof. | N/A | Proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 95%

The negative control is meaningful: it uses Node's resolver to require an `ERR_PACKAGE_PATH_NOT_EXPORTED` error for an unexported deep path, and the adjacent positive export sweep checks every symbol consumed by the rewired files. The test's typed fixture drives the public resolver, loader, hash, and walk constructors rather than a local dd copy.

The only qualification is F001's seven-versus-five warning inventory. The live proof had zero errors and all requested commands exited 0; it did not have an `ok` envelope from `plan validate`.

### E.5) Doctrine Compliance

The changes respect the root-manifest/runtime-dependency rule, retain acts as composition roots, use consumer-owned fakes rather than module mocks, and do not add a package-aware boundary guard contrary to ratified D-4.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|---|---|---|---|
| AC-0001 | Full-SHA git dependency pin | Root manifest and lockfile agree; `npm ls` resolves the git SHA; `merge-base --is-ancestor f712ded <pin>` exited 0. | 100% |
| AC-0002 (phase-1 scope) | Public-home non-plan consumer imports | `dw-0005` grep returned no matches; `dw-0007` returned only the ratified `services/dd/plan` remainder. | 100% |
| AC-0003 (phase-1 boundary) | Build and suite stay green | Independent `just build` and `just test`: 348 files, 5,148 tests passed. | 100% |
| AC-000b (phase-1 boundary) | Dogfood the rewired build | `flow orient` and `flow rail` were `ok`; `plan validate` had 0 errors and 7 ledgered structural WARNs. | 90% |
| AC-000c (phase-1 scope) | No silent dogfood workaround | Entry 3 is closed by the A-2 drain; entry 4 is explicit and open for its design ruling. | 100% |

**Overall coverage confidence**: 95%

## G) Commands Executed

```bash
git diff --binary cf2cf589^..df452f32
git -C /Users/jordanknight/substrate/dd merge-base --is-ancestor f712ded a37a20ecf12342275a9d81b4cf8835302de8e9e0
npm ls @ai-substrate/dd --depth=0
just build
just test
git grep -nE 'services/dd|acts/dd|\./dd/' -- harness/cli/src/acts/flow.ts harness/cli/src/acts/plan/fence.ts
git grep -nE 'services/dd|acts/dd|\./dd/' -- harness/cli/src/acts/plan/index.ts harness/cli/src/acts/plan/pr-body.ts
node harness/cli/bin/harness.js flow orient --path docs/plans/080-dd-consume-upgrade/the-flow.json
node harness/cli/bin/harness.js flow rail --path docs/plans/080-dd-consume-upgrade/the-flow.json
node harness/cli/bin/harness.js plan validate docs/plans/080-dd-consume-upgrade/plan.dd.json
```

The reproducible phase diff is `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/assets/tasks/phase-1/reviews/_computed.diff`.

## H) Handover Brief

**Review result**: APPROVE

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/plan.dd.json`  
**Spec**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/plan.dd.md`  
**Phase**: Phase 1: Take the dependency and rewire the four consumers  
**Tasks dossier**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/assets/tasks/phase-1/tasks.dd.md`  
**Execution log**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/assets/tasks/phase-1/execution.log.md`  
**Review file**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/docs/plans/080-dd-consume-upgrade/assets/tasks/phase-1/reviews/review.take-the-dependency-and-rewire-the-four-consumers.md`

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---|---|---|---|
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/package.json` | Approved | N/A | None |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/package-lock.json` | Approved | N/A | None |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/harness/cli/test/integration/dd-package-boundary.int.test.ts` | Approved | N/A | None |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/harness/cli/src/acts/flow.ts` | Approved | N/A | None |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/harness/cli/src/acts/plan/fence.ts` | Approved | N/A | None |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/harness/cli/src/acts/plan/index.ts` | Approved with phase-2 remainder | N/A | Retain only `services/dd/plan` until the phase-2 trial. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/harness/cli/src/acts/plan/pr-body.ts` | Approved with phase-2 remainder | N/A | Retain only `PlanEdge`, `PlanIndex`, and `PlanItem` imports until the phase-2 trial. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/harness/cli/src/acts/dd/shared.ts` | Approved | N/A | Delete with the fork in phase 3. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/harness/cli/src/services/dd/core/walk.ts` | Approved | N/A | Delete with the fork in phase 3. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s080-dd-consume-upgrade/harness/cli/src/services/dd/links/model.ts` | Approved | N/A | Delete with the fork in phase 3. |

### Required Fixes

None.

### Domain Artifacts to Update

None; domain governance is off.

### Handback

Phase 1 is approved. The next phase's task expansion comes next; preserve the qualified dogfood receipt and carry F001 with the partial-`satisfies` design ruling.
