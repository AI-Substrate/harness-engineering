# Code Review: Simple Mode

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md  
**Spec**: /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md  
**Phase**: Simple Mode  
**Date**: 2026-06-25  
**Reviewer**: Automated (the review verb)  
**Testing Approach**: Lightweight unit tests (vitest + telemetry fakes)

## A) Verdict

**REQUEST_CHANGES**

The implementation emits `flow_log` events with fields that the public segment schema rejects.

**Key failure areas**:
- **Implementation**: `flow_log` events can serialize `node` and `type`, but `segment.schema.json` does not allow those keys under `event_stream[]`.
- **Testing**: AC-04 and AC-07 evidence is partial, and the new promoted tests do not carry the required Test Doc blocks.
- **Doctrine**: the plan's Constitution gate is marked N/A even though `docs/project-rules/constitution.md` exists.
- **Scope**: the current working tree includes an unrelated untracked system-overview doc outside plan 035's docs strategy.

## B) Summary

The core flow-log projector and capture wiring mostly follow the plan's shape: offset windowing is used, `flow` snapshot events are preserved, and `flow_log` markers are rollup-isolated. The load-bearing defect is contract drift between the serializer/type layer and the JSON schema: downstream consumers validating segments can reject valid `flow_log` entries containing `node` or `type`. Domain governance files are not initialized, so domain compliance is judged against the plan manifest plus project architecture rules; no domain-boundary violation was found. Evidence is directionally strong but incomplete for two-plan cursor independence and full rollup invariance.

## C) Checklist

**Testing Approach: Lightweight**

- [x] Core validation tests present
- [ ] Critical paths covered
- [ ] Key verification points documented

Universal:
- [ ] Only in-scope files changed
- [ ] Linters/type checks clean (evidence present in execution log, not rerun by review)
- [ ] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/segment.schema.json:146-187 | correctness | Schema allowlist omits `node` and `type` even though serialized `flow_log` events can contain both. | Add `node` and `type` to the event item schema and pin with a regression covering a serialized `flow_log` with all allowlisted fields. |
| F002 | MEDIUM | /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts:205-239 | testing | AC-04 and AC-07 evidence is incomplete. | Add a same-session two-plan cursor test and compare the full rollup against a no-`flow_log` baseline. |
| F003 | MEDIUM | /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md:116-123 | doctrine | G2 says Constitution is N/A because no constitution exists, but the repository has one. | Replace G2 with an actual Constitution result or a deviation ledger entry. |
| F004 | MEDIUM | /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts:55-257 | testing | New promoted tests lack the required per-test Test Doc block fields. | Add Why, Contract, Usage Notes, Quality Contribution, and Worked Example/explicit example coverage to each promoted test. |
| F005 | MEDIUM | /Users/jordanknight/substrate/harness-engineering/docs/how/detailed-system-overview.md:1 | scope | The current review diff includes a new untracked docs file outside plan 035's stated "existing docs only" documentation strategy. | Remove it from this change set or move it to a separate scoped plan; if intended here, update plan/docs manifest deliberately. |
| F006 | LOW | /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/cursor.ts:73-88 | pattern | `readFlowCursor`/`writeFlowCursor` duplicate the existing numeric cursor read/write pattern. | Consider extracting a shared numeric cursor helper when touching this code for the required fixes. |
| F007 | LOW | /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/execution.log.md:20 | evidence | Execution evidence is summarized, and the plan task table remains unchecked. | Record exact command outputs/exit statuses and update task status markers for traceability. |

## E) Detailed Findings

### E.1) Implementation Quality

#### F001 - HIGH - Schema rejects valid produced `flow_log` events

**File**: /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/segment.schema.json:146-187  
**Related producer**: /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/segment.ts:337-347 and /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/events.ts:124-137

`FlowLogEvent` includes optional `node` and `type`, and `serializeEvent` emits both when present. `flowLogEvents` also projects those fields for `status-changed`, `node-created`, and `node-updated`. The event schema's `event_stream.items.properties` adds `flow_log`, `op`, and `edge_op`, but omits `node` and `type` while `additionalProperties` is `false`. A valid segment containing `{kind:"flow_log", op:"node-created", node:"phase-1", type:"phase"}` therefore violates the public schema.

**Fix**: add `node` and `type` to `segment.schema.json`'s event item properties and add a test that serializes a representative `flow_log` event containing `op`, `node`, `from`, `to`, `type`, and `edge_op`, then asserts every serialized key is schema-allowlisted.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | PASS | Telemetry code stays under `harness/cli/src/services/telemetry/`; docs changes are in `docs/how/` and plan dirs. |
| Contract-only imports | PASS | No cross-domain internal import violation found. |
| Dependency direction | PASS | Services remain ports-based; no new direct `node:*` import in service code. |
| Domain.md updated | N/A | No formal `docs/domains/**` registry is initialized. |
| Registry current | N/A | No `docs/domains/registry.md` exists. |
| No orphan files | WARN | `docs/how/detailed-system-overview.md` is untracked and outside the plan manifest/docs strategy. |
| Map nodes current | N/A | No `docs/domains/domain-map.md` exists. |
| Map edges current | N/A | No `docs/domains/domain-map.md` exists. |
| No circular business deps | N/A | Formal domain graph not initialized. |
| Concepts documented | N/A | Formal domain concept docs not initialized. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|-----------------|--------|--------|
| `flowLogEvents` projector | No direct existing projector | telemetry | Proceed |
| flow cursor offset helpers | Existing numeric cursor pattern in `readCursor`/`writeCursor` | telemetry cursor/watermark utilities | LOW: consider reuse/extraction |
| detailed system overview doc | Existing architecture/project-rules/how-to docs overlap conceptually | repo documentation | Scope issue, not reinvention of code |

### E.4) Testing & Evidence

**Coverage confidence**: 84%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-01 | 98% | `flow-log.test.ts` projects `cursor-moved` with `kind:"flow_log"`, `op`, `from`, `to`, and `t` from `fired_at`. |
| AC-02 | 92% | `flow-log.test.ts` covers `created`, `status-changed`, `node-created`, and `node-updated` projection. |
| AC-03 | 88% | Planted-secret tests confirm manual/custom free-form and non-allowlisted `details` keys are not serialized. |
| AC-04 | 76% | Offset slicing, same-`fired_at` siblings, persisted offset, and second-capture dedup are covered; same-session two-plan independence is not directly covered. |
| AC-05 | 95% | Capture-service test asserts a `flow` snapshot remains present with `flow_log` events. |
| AC-06 | 84% | Projector handles null/non-array/malformed entries; capture test covers no flight plan with no `flow_log`. Unparseable JSON is not directly asserted. |
| AC-07 | 78% | Test asserts backfilled `flow_log` does not inflate `wall_s`, but does not compare all activity fields and `flow_stage_time_s` against a no-`flow_log` baseline. |

### E.5) Doctrine Compliance

#### F003 - MEDIUM - Constitution gate incorrectly marked N/A

**File**: /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md:116-123

The plan's G2 row says the Constitution gate is N/A because `docs/project-rules/constitution.md` does not exist. It does exist at /Users/jordanknight/substrate/harness-engineering/docs/project-rules/constitution.md, and rules.md requires Constitution gate handling during planning. The row should be corrected to PASS/FAIL with notes or an explicit deviation ledger if needed.

#### F004 - MEDIUM - New tests miss required Test Doc blocks

**File**: /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts:55-257

`docs/project-rules/rules.md` requires every promoted test to carry Test Doc fields: Why, Contract, Usage Notes, Quality Contribution, and a worked example where appropriate. The new `flow-log.test.ts` cases are behaviorally named, but the per-test Test Doc blocks are absent.

#### F005 - MEDIUM - Out-of-scope untracked docs file included in reviewed diff

**File**: /Users/jordanknight/substrate/harness-engineering/docs/how/detailed-system-overview.md:1

Plan 035's documentation strategy explicitly says to update existing docs only (`docs/how/telemetry.md` and the v2 schema docs) and create no new doc files. The current review diff includes a new untracked detailed overview page and a generated docs-content edit. If this doc is intended, it should be scoped deliberately and surfaced via `docs-manifest.json`; otherwise keep it out of the plan 035 change set.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-01 | Cursor movement surfaces as `flow_log` with `from`/`to` and real `fired_at`. | `flowLogEvents` projection test. | 98% |
| AC-02 | Built-in log entries surface with allowlisted fields and real `fired_at`. | Projection tests cover all listed built-in op classes. | 92% |
| AC-03 | Free-form manual/custom/comment content never appears. | Planted-secret projection tests plus allowlist serializer. | 88% |
| AC-04 | Offset windowing is collision-proof and per-(session, plan). | Offset/same-timestamp tests and second-capture dedup; missing two-plan independence test. | 76% |
| AC-05 | Existing `flow` snapshot remains emitted. | Capture-service assertion that a `flow` event exists with `flow_log`. | 95% |
| AC-06 | Missing/empty/unparseable plan yields zero `flow_log`, no throw. | Projector defensive tests and no-plan capture test; unparseable capture path not directly asserted. | 84% |
| AC-07 | `flow_log` does not affect rollup activity or stage time. | Wall regression exists; full activity and `flow_stage_time_s` baseline comparison missing. | 78% |

**Overall coverage confidence**: 84%

## G) Commands Executed

```bash
git --no-pager status --short && git --no-pager diff --stat && git --no-pager diff --cached --stat
mkdir -p docs/plans/035-flow-replay-telemetry/reviews
git --no-pager diff --binary fe1571ff90b830677e62d17670e6cbc88088fbe2 -- .
git ls-files --others --exclude-standard
git --no-pager log --oneline -12 --decorate --stat -- docs/plans/035-flow-replay-telemetry harness/cli/src/services/telemetry docs/how/telemetry.md docs/plans/034-flow-event-schema-v2 docs/how/detailed-system-overview.md harness/cli/src/services/docs/docs-content.ts
rg "flow_log|flowLogEvents|flowCursor|kind === 'flow_log'" harness/cli/src
rg "flow_log" docs/how/telemetry.md docs/plans/034-flow-event-schema-v2
rg "segment.schema|additionalProperties|event_stream|EVENT_KINDS" harness/cli/test
git --no-pager diff HEAD --name-status -- .
git ls-files --others --exclude-standard
```

Computed diff saved to:

```text
/Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/reviews/_computed.diff
```

## H) Handover Brief

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md  
**Spec**: /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md  
**Phase**: Simple Mode  
**Tasks dossier**: inline in plan  
**Execution log**: /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/execution.log.md  
**Review file**: /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/reviews/review.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/harness-engineering/docs/how/telemetry.md | Reviewed | telemetry docs | None from review. |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/event-schema-v2-detail.md | Reviewed | telemetry docs | None from review. |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/event-schema-v2.md | Reviewed | telemetry docs | None from review. |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/execution.log.md | Reviewed | plan artifact | Strengthen raw evidence if desired. |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md | Reviewed | plan artifact | Fix G2 Constitution row. |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/original-ask.md | Reviewed | plan artifact | None. |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/the-flow.json | Reviewed | flow artifact | None. |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/the-flow.md | Reviewed | flow artifact | None. |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/validations/flow-replay-telemetry-plan-validation.md | Reviewed | plan artifact | None. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/docs/docs-content.ts | Reviewed | docs service | Decide whether current generated change belongs with this plan. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/capture-service.ts | Reviewed | telemetry | Add missing test coverage for per-plan cursor independence. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/cursor.ts | Reviewed | telemetry | Optional helper extraction. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/events.ts | Reviewed | telemetry contract | Ensure schema matches `FlowLogEvent`. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/flow-log.ts | Reviewed | telemetry | None from review. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/rollup.ts | Reviewed | telemetry | Strengthen AC-07 regression. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/segment.schema.json | Reviewed | telemetry contract | Add `node` and `type` event fields. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/segment.ts | Reviewed | telemetry contract | Schema must match serializer output. |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts | Reviewed | telemetry tests | Add missing coverage and Test Doc blocks. |
| /Users/jordanknight/substrate/harness-engineering/docs/how/detailed-system-overview.md | Reviewed | docs | Remove from this change set or scope separately. |

### Required Fixes (if REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| F001 | /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/telemetry/segment.schema.json | Add `node` and `type` to `event_stream.items.properties` and cover with schema/serializer regression. | Valid produced `flow_log` events can fail schema validation. |
| F002 | /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts | Add per-(session, plan) independence and full rollup baseline tests. | AC-04 and AC-07 are not fully evidenced. |
| F003 | /Users/jordanknight/substrate/harness-engineering/docs/plans/035-flow-replay-telemetry/flow-replay-telemetry-plan.md | Correct G2 Constitution status. | The repository constitution exists. |
| F004 | /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/telemetry/flow-log.test.ts | Add required Test Doc blocks. | Repository rules require them for promoted tests. |
| F005 | /Users/jordanknight/substrate/harness-engineering/docs/how/detailed-system-overview.md | Exclude from this plan or scope/surface it deliberately. | Plan 035 says existing docs only. |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| N/A | Formal `docs/domains/**` artifacts are not initialized in this repository. |

### Handback

Fixes go back through the implement verb (same flags), then re-run this review.
