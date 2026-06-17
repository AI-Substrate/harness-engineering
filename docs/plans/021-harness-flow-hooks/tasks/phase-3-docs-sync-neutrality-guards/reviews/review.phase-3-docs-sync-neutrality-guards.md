# Code Review: Phase 3: Docs sync + neutrality + guards

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/harness-flow-hooks-plan.md
**Spec**: /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/harness-flow-hooks-plan.md
**Phase**: Phase 3: Docs sync + neutrality + guards
**Date**: 2026-06-17
**Reviewer**: Automated (the review verb; parent-session synthesis — subagent fanout blocked by local user-extension parse error)
**Testing Approach**: Hybrid

## A) Verdict

**APPROVE WITH NOTES**

No HIGH/CRITICAL findings. Phase 3 is docs/state-only and correctly syncs the hook vocabulary into the reference docs while preserving neutrality. Two non-blocking notes remain: the full `validate-harness-flow` replay was intentionally skipped and documented as a proportionate docs-only deviation, and one execution-log file has a `git diff --check` trailing-blank-line warning.

**Key failure areas**:
- **Testing**: Full multi-repo `validate-harness-flow` replay was not run; execution log documents the deviation and substitutes proportionate load/doctor checks.
- **Doctrine**: `git diff --check` reports one blank line at EOF in the new execution log.

## B) Summary

Phase 3 matches its stated scope: it updates `getting-started.md` and `governance-doc.md` to lead with the five-hook vocabulary, keeps `--event` as a permanent alias, and updates plan state/task artifacts to show Phase 3 complete. The docs align with the key mapping requirements, including `pre-implement → pre-flight`, `task-pause → coding`, and `plan-complete → post-flight`. Neutrality holds for the phase diff: no `the-flow` source/skill files were modified. Evidence is adequate for a docs-only change, with a documented deviation from the heavier dogfood replay.

## C) Checklist

**Testing Approach: Hybrid**

For Hybrid / docs-only:
- [x] Core validation checks present for changed skill docs (`skills-check`, line guard, doctor/extension load)
- [x] Manual verification steps documented with observed outcomes
- [x] Evidence artifacts present (`execution.log.md`, computed diff, command outputs)

Universal:
- [x] Only in-scope files changed for this phase
- [ ] Linters/type checks clean (if applicable) — `git diff --check` reports one low-severity whitespace warning
- [x] Domain compliance checks pass

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | MEDIUM | /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/execution.log.md:47-54 | testing/evidence | Phase task asked for `validate-harness-flow` replay, but execution substituted proportionate docs-only checks. | Accept for this docs-only phase because the deviation is explicit and lower-level load/doctor checks passed; run full replay before merge only if the human wants literal T004 fulfillment. |
| F002 | LOW | /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/execution.log.md:80 | doctrine | `git diff --check 9fc5258..HEAD` reports a new blank line at EOF. | Remove the extra blank line before commit if convenient. |

## E) Detailed Findings

### E.1) Implementation Quality

No correctness, security, performance, or scope issues found in the docs changes.

The changed reference docs lead with `--hook` and preserve `--event` as an alias:
- /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-loop/eng-harness-flow/references/getting-started.md:197
- /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-loop/eng-harness-flow/references/getting-started.md:246-268
- /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md:33

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | Changed files are in the plan directory and `skills/eng-harness-loop/eng-harness-flow/references/`, matching the plan Domain Manifest. |
| Contract-only imports | N/A | Markdown/state-only phase; no imports. |
| Dependency direction | N/A | Markdown/state-only phase. |
| Domain.md updated | N/A | Repo has no initialized `docs/domains` registry/domain docs for this plan. |
| Registry current | N/A | `docs/domains/registry.md` absent per constitution/domain governance. |
| No orphan files | ✅ | All changed source/reference files map to the eng-harness-flow domain or plan artifacts. |
| Map nodes current | N/A | No domain map present. |
| Map edges current | N/A | No domain map present. |
| No circular business deps | N/A | No code dependencies changed. |
| Concepts documented | N/A | No new domain contracts/components introduced. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| None — docs/state-only phase | None | eng-harness-flow | Proceed |

### E.4) Testing & Evidence

**Coverage confidence**: 85%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-01 | 95% | `getting-started.md` quick reference and hook contract lead with `--hook` (`getting-started.md:197`, `:246-268`). |
| AC-03 | 75% | Line guard verified `478 <= 478`; `skills-check` ok; `doctor` degraded-benign. Full `validate-harness-flow` replay was not run but deviation is documented. |
| AC-06 | 95% | Six-seam to five-hook mapping documented in `getting-started.md:260-265` and `governance-doc.md:33`. |
| AC-07 | 95% | Phase diff from `9fc5258..HEAD` has no `the-flow` source/skill paths; only plan state and eng-harness-flow references changed. |
| AC-02 | 90% | Prior Phase 2 evidence; not modified in Phase 3. |
| AC-05 | 90% | Prior Phase 1 evidence; docs preserve all six aliases. |
| AC-08 | 90% | Prior Phase 2 evidence; Phase 3 did not change envelopes/manifests. |
| AC-09 | 90% | Prior Phase 1 evidence; Phase 3 did not change routing envelope. |
| AC-04 | N/A | Deferred to v2 by plan. |

### E.5) Doctrine Compliance

- Public-safe content: ✅ no private/raw source content introduced.
- Harness vs agent-harness distinction: ✅ docs continue to describe engineering-harness hooks and host-flow integration.
- One-door discipline: ✅ changed docs route through `/eng-harness-flow`; no host edits.
- Neutrality: ✅ no `the-flow` source/skill edits in the phase diff.
- Formatting: ⚠️ one low-severity `git diff --check` whitespace warning (F002).

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-01 | `--hook <name>` routes/docs correctly for all five hooks | `getting-started.md:197`, `:246-268`; execution log T001 | 95% |
| AC-02 | `--hooks` manifest fixed five-hook Shape A | Prior Phase 2; Phase 3 did not alter SKILL.md | 90% |
| AC-03 | `--help` print-and-stop and accepted line-count guard / validation | `execution.log.md:47-54`; `wc -l` = 478; `skills-check` ok; `doctor` degraded-benign | 75% |
| AC-04 | `--emit-injection` | Deferred to v2 | N/A |
| AC-05 | Six existing `--event` strings route unchanged | Prior Phase 1; Phase 3 docs preserve mapping | 90% |
| AC-06 | Documented mapping correct | `getting-started.md:260-265`; `governance-doc.md:33` | 95% |
| AC-07 | `the-flow` untouched | `git diff --name-only 9fc5258..HEAD` contains no `the-flow` source/skill path | 95% |
| AC-08 | One-door preserved | `/eng-harness-flow` remains the integration surface; no envelope change | 90% |
| AC-09 | JSON envelope snapshot-compatible | No Phase 3 SKILL.md/router change | 90% |

**Overall coverage confidence**: 88%

## G) Commands Executed

```bash
git status --short && git diff --stat && git diff --staged --stat
git log --oneline -10
git diff --stat 9fc5258..HEAD
git diff --name-status 9fc5258..HEAD
mkdir -p docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/reviews
git diff 9fc5258..HEAD > docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/reviews/_computed.diff
wc -l docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/reviews/_computed.diff
wc -l skills/eng-harness-loop/eng-harness-flow/SKILL.md
node harness/cli/bin/harness.js skills-check --dir skills
node harness/cli/bin/harness.js doctor --json
node harness/cli/bin/harness.js validate-harness-flow --help || true
git diff --check 9fc5258..HEAD
git diff --name-only 9fc5258..HEAD | grep -E '(^|/)the-flow(/|$)|\.pi/agent/skills/the-flow|skills/the-flow' || true
```

Subagent fanout note: the planned five review subagents could not start because the local user extension `/Users/jordanknight/.pi/agent/extensions/file-watch-notify/index.ts` has a parse error (`Unexpected token, expected ","` at line 238). This review was completed in the parent session with direct file/command inspection.

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: APPROVE WITH NOTES

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/harness-flow-hooks-plan.md
**Spec**: /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/harness-flow-hooks-plan.md
**Phase**: Phase 3: Docs sync + neutrality + guards
**Tasks dossier**: /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/tasks.md
**Execution log**: /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/execution.log.md
**Review file**: /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/reviews/review.phase-3-docs-sync-neutrality-guards.md

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-loop/eng-harness-flow/references/getting-started.md | OK | eng-harness-flow | None |
| /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md | OK | eng-harness-flow | None |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/tasks.md | OK | plan artifact | None |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/tasks/phase-3-docs-sync-neutrality-guards/execution.log.md | Note | plan artifact | Optional: remove trailing blank line at EOF |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/the-flow.json | OK | plan state | None |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/the-flow.md | OK | plan state | None |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/021-harness-flow-hooks/.the-flow-state.json | OK | plan state | None |

### Required Fixes (if REQUEST_CHANGES)

None.

### Domain Artifacts to Update (if any)

None.

### Handback

APPROVE WITH NOTES: no required fixes. Optional cleanup: remove the execution-log EOF whitespace and/or run the full `harness validate-harness-flow` replay if the human wants literal replay evidence before merge. Otherwise, this final phase can proceed to merge.
