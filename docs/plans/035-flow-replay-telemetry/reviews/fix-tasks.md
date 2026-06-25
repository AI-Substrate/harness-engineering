# Fix Tasks: Simple Mode

Apply in order. Re-run review after fixes.

## Critical / High Fixes

### FT-001: Keep `flow_log` serializer and schema in lockstep
- **Severity**: HIGH
- **File(s)**:
  - /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/segment.schema.json
  - /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/events-rollup.test.ts or /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts
- **Issue**: `serializeEvent` can emit `node` and `type` on `flow_log` events, but the schema's `event_stream.items.properties` does not allow those keys while `additionalProperties` is `false`.
- **Fix**: Add `node` and `type` to the event item schema and add a regression that serializes a representative `flow_log` event containing all allowlisted fields.
- **Patch hint**:
  ```diff
  --- a/harness/cli/src/services/telemetry/segment.schema.json
  +++ b/harness/cli/src/services/telemetry/segment.schema.json
  @@
             "stage": { "type": "string" },
             "op": { "type": "string" },
  +          "node": { "type": "string" },
  +          "type": { "type": "string" },
             "edge_op": { "type": "string" },
             "from": { "type": "string" },
             "to": { "type": "string" },
  ```

## Medium / Low Fixes

### FT-002: Complete AC-04 and AC-07 evidence
- **Severity**: MEDIUM
- **File(s)**:
  - /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts
- **Issue**: AC-04 claims per-(session, plan) cursor independence but no test captures two plans in the same session. AC-07 claims `flow_log` does not change `wall_s`, `agent_working_s`, `idle_s`, or `flow_stage_time_s`, but the regression currently checks only `wall_s`.
- **Fix**: Add one capture-service test that captures plan A and plan B with the same session id and asserts independent `.flowcursor` files/offsets. Add one rollup regression that compares the full `rollup.activity` and `flow_stage_time_s` with and without backfilled `flow_log` entries.

### FT-003: Correct the Constitution gate
- **Severity**: MEDIUM
- **File(s)**:
  - /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md
- **Issue**: G2 says Constitution is N/A because no `docs/project-rules/constitution.md` exists, but the file exists.
- **Fix**: Replace the G2 row with a real PASS/FAIL result and notes, or add a deviation ledger if the plan knowingly violates a principle.

### FT-004: Add required Test Doc blocks
- **Severity**: MEDIUM
- **File(s)**:
  - /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts
- **Issue**: The new promoted tests lack the repository-required Test Doc fields.
- **Fix**: Add Why, Contract, Usage Notes, Quality Contribution, and a worked/example description to each promoted test case or documented test group in the accepted house style.

### FT-005: Remove or rescope the untracked detailed overview doc
- **Severity**: MEDIUM
- **File(s)**:
  - /Users/jordanknight/substrate/harness-engineering/docs/how/detailed-system-overview.md
  - /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/docs/docs-content.ts
  - /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/docs/docs-manifest.json (only if intentionally surfacing this doc)
- **Issue**: Plan 035's docs strategy says to update existing docs only, but the current working tree includes a new untracked overview doc.
- **Fix**: Keep it out of the plan 035 change set, or scope it explicitly in a separate plan and add it to the docs manifest before regenerating docs content.

### FT-006: Consider extracting numeric cursor helpers
- **Severity**: LOW
- **File(s)**:
  - /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/cursor.ts
- **Issue**: `readFlowCursor`/`writeFlowCursor` duplicate the same numeric watermark parse/write pattern as `readCursor`/`writeCursor`.
- **Fix**: Optional: extract shared internal helpers for numeric cursor parsing and temp+rename writing if it clarifies the required fixes.

### FT-007: Strengthen execution evidence
- **Severity**: LOW
- **File(s)**:
  - /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/execution.log.md
  - /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md
- **Issue**: The execution log summarizes proof and the plan task table remains unchecked.
- **Fix**: Add exact command outputs/exit statuses or durable links to them, and update the task status markers for the work that landed.

## Re-Review Checklist

- [ ] All critical/high fixes applied
- [ ] Schema regression covers `flow_log` with `node` and `type`
- [ ] AC-04 two-plan cursor independence covered
- [ ] AC-07 full rollup baseline comparison covered
- [ ] Test Doc requirements satisfied
- [ ] Out-of-scope docs changes removed or explicitly scoped
- [ ] Re-run this review verb and achieve zero HIGH/CRITICAL
