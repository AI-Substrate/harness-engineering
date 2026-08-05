# Fix Tasks: Plan Readiness Gate

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Read doctrine-minted re-basis survey nodes
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts, /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/test/services/dd/plan/ready.test.ts
- **Issue**: The reader sees only `type: backpressure`, but a re-basis node is permitted as `type: chore` with id `backpressure-<hash>`.
- **Fix**: Match the stable backpressure id in addition to the legacy type, and add a fixture in the `type: chore` form with a current-basis receipt.
- **Patch hint**:
  ```diff
  - return nodes.filter((node) => node.type === BACKPRESSURE_NODE_TYPE);
  + return nodes.filter((node) =>
  +   node.type === BACKPRESSURE_NODE_TYPE ||
  +   /^backpressure(?:-[0-9a-f]{12})?$/.test(node.id),
  + );
  ```

### FT-002: Prefer a current receipt over an older stale receipt
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts, /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/test/services/dd/plan/ready.test.ts
- **Issue**: The first append-only receipt wins even if a later receipt matches the current plan.
- **Fix**: Scan comments newest-first or collect all receipt bases and prefer a current-basis match; add an amended-receipt test.
- **Patch hint**:
  ```diff
  - for (const comment of node.comments ?? []) {
  + for (const comment of [...(node.comments ?? [])].reverse()) {
  ```

### FT-003: Make a documented decline a satisfiable receipt
- **Severity**: HIGH
- **File(s)**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts, /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/test/services/dd/plan/ready.test.ts
- **Issue**: The protocol's `--kind decision --text "<verbatim words>"` decline has no basis hash, so AC-04 cannot happen in normal use.
- **Fix**: Either treat a terminal decision receipt as a valid declined survey without a basis, or update the flow template and skill so every decline instruction writes and tests the required basis.
- **Patch hint**:
  ```diff
  - if (basis === null) continue;
  + if (basis === null && node.status === 'skipped' && hasDecisionReceipt(node)) {
  +   return reading(true, 'declined-with-receipt', expected, node);
  + }
  + if (basis === null) continue;
  ```

## Medium / Low Fixes

### FT-004: Require explicit receipt kinds
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/services/flow/chores-read.ts, /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/test/services/dd/plan/ready.test.ts
- **Issue**: The default kind-less comment can satisfy the survey.
- **Fix**: Reject missing kinds and add both kind-less and `note` fixtures.
- **Patch hint**:
  ```diff
  - if (comment.kind !== undefined && !RECEIPT_KINDS.has(comment.kind)) continue;
  + if (comment.kind === undefined || !RECEIPT_KINDS.has(comment.kind)) continue;
  ```

### FT-005: Correct the agent-facing examples
- **Severity**: MEDIUM
- **File(s)**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/how/dd/plan-ready.md
- **Issue**: Examples point to a markdown plan without `plan.dd.json`.
- **Fix**: Use a dd-native target and state the target must be `plan.dd.json` or its containing directory.

### FT-006: Repair evidence and explicit-flow diagnostics
- **Severity**: LOW
- **File(s)**: /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/docs/plans/072-plan-ready-gate/execution.log.md, /Users/jordanknight/substrate/harness-engineering-worktrees/s065-deterministic-documents/harness/cli/src/acts/plan/index.ts
- **Issue**: T005 line references are stale, and an invalid explicit `--flow` path is described as an absent sibling flow.
- **Fix**: Update the log pointer and surface an explicit-path error that names the supplied path.

## Re-Review Checklist

- [ ] Re-basis `type: chore` fixture passes.
- [ ] Later matching receipt overrides earlier stale receipt.
- [ ] A real documented decline produces the intended result.
- [ ] Kind-less and note comments cannot satisfy a receipt.
- [ ] Documentation examples execute against their stated target.
- [ ] Re-run this review verb and achieve zero HIGH/CRITICAL.
