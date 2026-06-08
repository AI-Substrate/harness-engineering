
## 2026-06-07T22:45:42.394Z — code-review-companion / 2026-06-08T08-17-59-139Z-9157

- runId: 2026-06-08T08-17-59-139Z-9157
- runDir: agents/code-review-companion/runs/2026-06-08T08-17-59-139Z-9157
- summary: Reviewed the Phase 1 harness CLI work across per-commit pings and the final range sweep. I sent two HIGH findings around output-contract fidelity, both were fixed in dac64fa and re-verified; the final range d9f6435 passed with no open findings.
- **magicWand** (target: minih): Expose one canonical merged report template in `minih check --template <slug>` so agents can write exactly the schema that will be validated without reconciling multiple prompt examples.
- difficulties:
  - [annoying] config: The run instructions included a schema-shaped example that differed from the installed output-schema.json required by minih validation. (workaround: Read agents/code-review-companion/output-schema.json and wrote a combined report containing the schema-required session/findings fields plus the broader retrospective fields.)
  - [annoying] coordination: Finding traceability drifted slightly when the outside execution log collapsed two distinct inbox findings (F001 and F002) into F001a/F001b. (workaround: Kept the exact original finding IDs and ackOf values in this farewell envelope.)

## 2026-06-08T09-12-29Z — code-review-companion / 2026-06-08T09-12-29-770Z-3f1f (Phase 2)

- runId: 2026-06-08T09-12-29-770Z-3f1f
- runDir: agents/code-review-companion/runs/2026-06-08T09-12-29-770Z-3f1f
- summary: Reviewed the Phase 2 harness CLI commit stream T001→final drain. Six code/contract findings raised + verified fixed inline (F001 detached-HEAD git smoke, F002 tri-state JSON injection, F003 run-dispatcher contract, F004 stale dry-run wording, F005 npm/npx symlink bin execution, F006 process.exit confinement); a seventh final-drain finding (F007) flagged tracked documentation drift (makeOutputPort → CliIo) and was resolved in docs.
- **workedWell**: Per-commit review pings gave small, reviewable scopes and let contract drift be caught while fixes were cheap.
- **magicWand** (target: coordination): Queued lifecycle controls should interrupt or visibly preempt final-drain reporting, so a companion does not emit new findings after the operator has already requested stop.
- **confusing**: The stop control was queued before the final-drain response was visible after compaction, creating an ordering ambiguity around F007.
- difficulties:
  - [coordination] Exact correlation metadata and cumulative finding state were harder to preserve across a long session plus compaction; generated plan docs also lagged behind contract-changing fixes.
- **improvementSuggestions**: Add a final-docs drift checklist to the outside closeout flow, and surface pending control messages prominently before companions send final-drain findings.

### Orchestrator retro (Phase 2)

- **OH-201 [gift]**: The companion caught two contract-defining issues a flat read would have missed — F003 (workshop 001's `run <slot>` dispatcher vs my flat-slot model) and F005 (the `isMain` guard silently breaking the npx bin symlink, the package's whole point). Both were cheap to fix at commit time, expensive later.
- **OH-202 [difficulty]**: Workshop skeletons that predate a kernel fix are a recurring drift trap — the dossier's `makeOutputPort` + `formatOk({status})` came straight from workshop 002 and both were superseded by Phase 1's F002 fix. Pre-surfacing the drift in the dossier helped, but the F002 redesign still removed `makeOutputPort` mid-build, leaving doc drift (F007).
- **OH-203 [improvement-suggestion]**: When a build deviates from the dossier (run-dispatcher split, CliIo), update the dossier's forward-looking lines in the same commit as the code change, not at phase end — would have pre-empted F007.

## 2026-06-08T01:23:02.255Z — code-review-companion / 2026-06-08T11-04-06-731Z-0c5a

- runId: 2026-06-08T11-04-06-731Z-0c5a
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-08T11-04-06-731Z-0c5a
- summary: Reviewed Phase 3 of plan 004-harness-core as a long-running companion: T001 through T006 plus the final drain sweep. Approved the CI workflow, coverage artifact upload, package-smoke npx/bin-symlink guard, release-please no-publish setup, live branch protection, and end-to-end PR validation. No review findings were sent; the final PR checks were green on run 27110754122 with coverage and lcov artifacts present.
- **magicWand** (target: coordination): Add a coordination summary endpoint that returns the run output path, project root, acked task count, findings sent, questions asked, and peer-update count as structured JSON, then validates the final envelope against the active schema in one command.
- difficulties:
  - [annoying] config: MINIH_PROJECT_ROOT was not available to the shell during the required orientation step, so the initial cd resolved to the run folder rather than the repository root. (workaround: Used the literal repository root from the provided environment context for all project reads and git commands.)
  - [annoying] debug: gh opened a pager for a branch-protection JSON response, leaving the shell session waiting for input. (workaround: Sent q to close the pager and used GH_PAGER=cat for later gh commands.)
  - [degrading] coordination: The T006 task described a successful CI run for the prior SHA while the evidence commit itself had just triggered a newer run that was still pending. (workaround: Checked the run list, waited for the final HEAD run, and verified its PR checks, coverage log, and lcov artifacts before approving.)
### Orchestrator retro (Phase 3)

- **summary**: Built Phase 3 (CI, release automation, branch protection) T001–T006 with the companion in Power-On-Mode. Six tasks, 6 commits + 1 live `gh api` action; companion APPROVE on every commit, **zero findings**. CI green end-to-end on PR #1 (final HEAD run 27110754122): build-test 20/22 + package-smoke + ci-required all pass; coverage 92.2% in log + lcov artifacts.
- **workedWell**: Proving each CI step locally *before* committing (biome/build/tsc/vitest, and the full pack→install→invoke smoke) meant the first real CI run was green — no red-CI debugging loop. The `ci-required` aggregation job (from validation) gave branch protection a stable, matrix-independent required check, which T006 confirmed with no drift.
- **difficulties**:
  - [OH-001] gotcha: PyYAML 1.1 parses bare `on:` as boolean `True`, throwing `KeyError:'on'` when introspecting workflow YAML locally. Cosmetic (GitHub parses correctly); read via `d.get('on', d.get(True))`.
  - [OH-002] insight: a per-task evidence commit (T006) re-triggers CI, so the "documented run" can lag HEAD. Always re-confirm `gh pr checks` against the final HEAD sha (the companion's MH-003 caught this; resolved).
- **magicWand**: A `harness ci-smoke` verb (future, post-extension-system) that runs the pack→install→invoke bin-symlink check locally, so the F005 class is catchable in `just fft` without waiting for CI.
- **magicWandTarget**: project

## 2026-06-08T07:31:54.286Z — code-review-companion / 2026-06-08T16-56-36-144Z-a9ad

- runId: 2026-06-08T16-56-36-144Z-a9ad
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-08T16-56-36-144Z-a9ad
- summary: Oriented on Plan 005 and reviewed nine commit pings for the harness extension system. I sent eight findings total: one HIGH around invalid runtime VerbResult statuses returning undefined, and seven MEDIUM issues covering exec never-reject behavior, default-export enforcement, discovery contract edges, registry conflict honesty, next_action enforcement, and variadic arg contract drift. I exited via idle_budget after the post-task still-needed check-in received no reply and a final unread drain found no unresolved outside requests.
- **magicWand** (target: coordination): Add a minih companion-report scaffold that derives tasksReceived, findingsSent, questionsAsked, and finding records from the inbox transcript before farewell, so counters and report JSON are generated rather than manually counted.
- difficulties:
  - [annoying] coordination: Manual counting in a long-running companion run was error-prone; I sent an initial farewell with 10 task reviews before noticing the actual count was 9. (workaround: Sent a corrected farewell message and wrote the validated report with the corrected counts.)
  - [annoying] coordination: The task protocol said to reply only if issues, but the companion prompt required a summary for every task. (workaround: Prioritized the companion prompt and sent summaries for each reviewed task.)
