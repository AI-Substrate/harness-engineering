# Code Review: Plan Readiness Gate

**Plan**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/plan-ready-gate-plan.md
**Spec**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/plan-ready-gate-plan.md
**Phase**: Simple Mode
**Date**: 2026-08-05
**Reviewer**: Automated (the review verb)
**Testing Approach**: Lightweight

## A) Verdict

**REQUEST_CHANGES**

The survey reader can reject a correctly re-based survey, accepts only a decline receipt shape that the documented decline workflow never writes, and uses the oldest receipt on a node rather than a later matching receipt.

**Key failure areas**:
- **Implementation**: Re-basis survey nodes and amended receipts are not read correctly.
- **Testing**: Fixtures pin only the `type: backpressure` shape and an invented decline receipt format.
- **Doctrine**: The documented decline protocol cannot produce a green decline.
- **Documentation**: All runnable examples target a markdown plan where the command requires `plan.dd.json`.

## B) Summary

The criteria composition, vacuity precedence, strict exit mapping, E462 registration, and frozen-surface renegotiation are sound. `semantics.ts` remains byte-unchanged; the digest guard is real, its documented mutation fails, and dependency-cruiser remains at the two pre-existing telemetry warnings without a relaxed rule. The real stale-basis smoke does establish that the command sees a stale receipt, but it also exposed that the reader ignores the newer re-basis node in that same flight plan. The working tree includes the declared pre-existing live-testing entries and an uncommitted correction of two plan paths from `src/commands/plan.ts` to `src/acts/plan/index.ts`.

## C) Checklist

**Testing Approach: Lightweight**

- [x] Core validation tests present
- [ ] Critical re-basis and amended-receipt paths covered
- [x] Key verification points documented
- [ ] Only executable documentation examples present
- [x] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts:50 | correctness | Doctrine-minted `backpressure-<hash>` nodes with `type: chore` are invisible. | Select by the stable backpressure id as well as the legacy type and test both forms. |
| F002 | HIGH | /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts:62 | correctness | The first receipt shadows a newer matching receipt on the same append-only node. | Inspect comments newest-first or prefer any matching receipt. |
| F003 | HIGH | /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts:62 | doctrine correctness | A documented decline lacks `basis_sha256`, so it can never satisfy AC-04. | Accept the documented decision receipt or update the protocol and all instructions to require and produce a basis. |
| F004 | MEDIUM | /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts:63 | correctness | A kind-less comment is accepted as a receipt despite the stated allow-list. | Require an explicit `validation` or `decision` kind and test it. |
| F005 | MEDIUM | /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/how/dd/plan-ready.md:7 | documentation | Every copied example targets a directory with no `plan.dd.json`. | Use a dd-native fixture directory and state the target requirement. |
| F006 | LOW | /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/execution.log.md:150 | evidence | The claimed T005 RED line numbers no longer resolve after later comment additions. | Update the pointer to controls 186-189 and verdict assertion 192. |
| F007 | LOW | /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/acts/plan/index.ts:617 | diagnostics | An explicit missing `--flow` path is presented as no sibling flight plan. | Distinguish explicit-path errors from the default sibling lookup. |

## E) Detailed Findings

### E.1) Implementation Quality

**F001 -- re-basis node selection.** `/Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts:50` selects only `node.type === 'backpressure'`. The flow doctrine mints re-basis surveys with id `backpressure-<first 12 hex>` and calls them a chore. `/Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/archive/071-dd-native-builder/the-flow.json` has such a node with `type: "chore"`. Giving that node a receipt matching the current `plan.dd.json` still returns the older node's stale basis. This makes a correctly re-surveyed plan fail under `--strict`.

**F002 -- receipt recency.** `/Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts:62-67` returns the first matching-shaped comment, but comments are append-only and newer comments are last. Appending a later `validation` receipt with the expected basis after the existing stale receipt still yields `stale-basis`. The stated resolution order must operate within a node as well as across nodes.

**F003 -- decline receipt contract.** AC-04 requires a skipped decision receipt whose basis matches. The actual decline procedure in `/Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/skills/builder/references/flight-plan.template.json` and the shipped harness skill writes the human's verbatim decision with `--kind decision`, but no `basis_sha256`. Consequently the fixture's synthetic basis-bearing decision is not generated by the documented toolchain; a genuine decline returns `missing-receipt` and then `not-ready`.

**F004 -- receipt kind allow-list.** The `comment.kind !== undefined` condition accepts the default kind-less output of `harness flow comment`. A terminal comment containing `basis_sha256:<current plan sha>` but no `--kind` turns the survey green, while the same comment marked `note` does not. That is the reverse of the documented restriction.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | PASS | Changed source files match the logical domains in the manifest. |
| Contract-only imports | PASS | Flow imports verdict types through the dd/plan barrel; dd/plan does not import flow. |
| Dependency direction | PASS | Dependency-cruiser reports 0 errors and only the two untouched telemetry warnings. |
| Domain.md updated | N/A | `docs/domains/` is not initialized. |
| Registry current | N/A | `docs/domains/registry.md` does not exist. |
| No orphan files | PASS | Each shipped source file appears in the corrected manifest. |
| Map nodes current | N/A | Domain map is not initialized. |
| Map edges current | N/A | Domain map is not initialized. |
| No circular business deps | PASS | No circular dependency was reported. |
| Concepts documented | N/A | Domain documentation is not initialized. |

E462 is correctly allocated in the E460-E469 range. The frozen dd-surface manifest's exact count was raised from 62 to 63 with a dated E457-rejection rationale; its rule was not weakened.

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| Readiness composition | No | dd/plan | Proceed; it composes the existing orphan-claim read. |
| Flight-plan receipt reader | No reusable equivalent | flow | Proceed after F001-F004. |

### E.4) Testing & Evidence

**Coverage confidence**: 75%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-01 | High | Ready fixture passes. |
| AC-02 | High | Unclaimed-criteria fixture passes. |
| AC-03 | High | T005 controls establish the pre-guard path would be ready; pointer needs F006 correction. |
| AC-04 | Low | Test passes only with a receipt shape absent from the decline protocol (F003). |
| AC-05 | High | Skipped-without-receipt fixture passes. |
| AC-06 | High | Missing flight-plan fixture passes. |
| AC-07 | High | Strict and non-strict envelope tests pass. |
| AC-08 | Medium | Byte-comparison fixture has positive controls. |
| AC-09 | High | Digest guard passes; documented `pressure` mutation changes the digest and clean bytes match the pin. |
| AC-10 | Low | Stale smoke is real, but re-basis node selection and receipt recency are incorrect (F001-F002). |
| AC-11 | High | Claim-row and zero-task fixtures pass. |

### E.5) Doctrine Compliance

F003 contradicts the receipt-first decline protocol. F005 prevents agents from using the new documented command. Vacuity precedence is correct: a zero-claim plan is not otherwise judgeable, so `cant-tell` does not swallow an actionable criteria finding. Keeping `cant-tell` at exit 2 under `--strict` is also correct: it remains non-zero for CI without reclassifying uncertainty as known not-ready.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-01 | Green plan and survey | `ready.test.ts` happy path | High |
| AC-02 | Unclaimed criteria | `ready.test.ts` orphan path | High |
| AC-03 | Vacuity refusal | T005 RED transcript and guard test | High |
| AC-04 | Declined survey | Synthetic fixture only; protocol mismatch F003 | Low |
| AC-05 | Missing decline receipt | `ready.test.ts` | High |
| AC-06 | No flight plan | `ready.test.ts` | High |
| AC-07 | Strict exit mapping | `ready.test.ts` | High |
| AC-08 | Read-only run | byte-comparison fixture | Medium |
| AC-09 | Frozen semantics | digest guard plus mutation evidence | High |
| AC-10 | Stale basis | real smoke, undermined by F001-F002 | Low |
| AC-11 | Claim-row non-vacuity | `ready.test.ts` | High |

**Overall coverage confidence**: 75%

## G) Commands Executed

```bash
git status --short
git diff HEAD~1 HEAD -- harness/cli/src/services/dd/plan/semantics.ts
git diff HEAD~1 HEAD
npx depcruise --config .dependency-cruiser.cjs harness/cli/src
npx vitest run test/services/dd/plan/ready.test.ts test/architecture/dd-plan-semantics-frozen.test.ts test/acts/dd-surface.test.ts test/output/error-codes.test.ts
node harness/cli/dist/index.js plan ready docs/plans/archive/071-dd-native-builder --json
node harness/cli/dist/index.js plan ready docs/plans/072-plan-ready-gate --json
```

## H) Handover Brief

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/plan-ready-gate-plan.md
**Spec**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/plan-ready-gate-plan.md
**Phase**: Simple Mode
**Tasks dossier**: inline in plan
**Execution log**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/execution.log.md
**Review file**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/reviews/review.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts | Changes requested | flow | Fix F001-F004. |
| /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/test/services/dd/plan/ready.test.ts | Changes requested | dd/plan | Cover actual re-basis, receipt ordering, receipt kind, and decline protocol. |
| /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/how/dd/plan-ready.md | Changes requested | docs | Correct executable examples and target contract. |

### Required Fixes

See `/Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/reviews/fix-tasks.md`.

### Domain Artifacts to Update

| File (absolute path) | What's Missing |
|---------------------|----------------|
| /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/skills/builder/references/flight-plan.template.json | Update only if basis becomes a required part of the decline receipt contract. |

### Handback

Fixes go back through the implement verb with the same plan, then re-run this review.
