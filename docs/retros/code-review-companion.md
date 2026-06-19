
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
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-08T11-04-06-731Z-0c5a
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
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-08T16-56-36-144Z-a9ad
- summary: Oriented on Plan 005 and reviewed nine commit pings for the harness extension system. I sent eight findings total: one HIGH around invalid runtime VerbResult statuses returning undefined, and seven MEDIUM issues covering exec never-reject behavior, default-export enforcement, discovery contract edges, registry conflict honesty, next_action enforcement, and variadic arg contract drift. I exited via idle_budget after the post-task still-needed check-in received no reply and a final unread drain found no unresolved outside requests.
- **magicWand** (target: coordination): Add a minih companion-report scaffold that derives tasksReceived, findingsSent, questionsAsked, and finding records from the inbox transcript before farewell, so counters and report JSON are generated rather than manually counted.
- difficulties:
  - [annoying] coordination: Manual counting in a long-running companion run was error-prone; I sent an initial farewell with 10 task reviews before noticing the actual count was 9. (workaround: Sent a corrected farewell message and wrote the validated report with the corrected counts.)
  - [annoying] coordination: The task protocol said to reply only if issues, but the companion prompt required a summary for every task. (workaround: Prioritized the companion prompt and sent summaries for each reviewed task.)

## 2026-06-08T10:33:16.628Z — code-review-companion / 2026-06-08T19-55-47-799Z-3769

- runId: 2026-06-08T19-55-47-799Z-3769
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-08T19-55-47-799Z-3769
- summary: Reviewed eight plan 006 review requests, including the final drain across all 23 landed tasks. I found three real medium implementation/test issues early in the FsPort/template work, all resolved by follow-up commits, withdrew one false-positive follow-up after empirical verification, and found two final medium completion-hygiene issues: stale plan bookkeeping and an untracked unsanitized e2e retro artifact. No HIGH or CRITICAL issues were found.
- **magicWand** (target: minih): Provide a minih env/status helper that exposes the canonical project root and output path to the agent shell, and have the boot prompt fail fast if MINIH_PROJECT_ROOT does not match the repository root.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run directory and MINIH_OUTPUT_PATH was unavailable in the shell, despite the prompt saying to use them. (workaround: Used git rev-parse --show-toplevel for project-root commands and wrote to the literal output path from the prompt.)
  - [annoying] tooling: Broad drift greps over optional paths produced missing-path errors or very noisy output. (workaround: Repeated the searches with existing paths and narrower patterns.)
  - [degrading] debug: I issued F004 from an incorrect mental model of JavaScript array join behavior on absolute paths. (workaround: Verified the path behavior empirically when challenged, accepted the correction, and withdrew the finding.)

## 2026-06-08T12:53:34.017Z — code-review-companion / 2026-06-08T22-08-20-158Z-d7d0

- runId: 2026-06-08T22-08-20-158Z-d7d0
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-08T22-08-20-158Z-d7d0
- summary: Reviewed plan 007's first-class documentation implementation across 17 task commits, covering the docs contract, generator, bundled corpus, DocsService, CLI act, help/README/docs surfaces, drift guards, CI wiring, and final fixes. I sent five findings (one HIGH, four MEDIUM); the follow-up fix commit a08fbe7 addressed all five and the focused regression tests I ran for docs act/output exit/integration/purity/curation passed.
- **magicWand** (target: coordination): Add a `minih outside finish` workflow that sends the final drain ping, immediately follows with control:stop after the companion replies, waits for the farewell, and runs validation automatically so companion sessions do not drift into the idle check-in window at the end.
- difficulties:
  - [annoying] debug: Searches and git-show commands that included the generated docs-content.ts produced very large or truncated output, and one scan over the generated bundle had to be stopped. (workaround: Narrowed subsequent reads to authored source files, excluded generated/runs paths in rg globs, and used targeted view ranges for the generated module only when needed.)
  - [annoying] coordination: The final stop arrived after the post-task idle threshold, causing a still-needed question even though the orchestrator was preparing to stop. (workaround: Followed the companion protocol: sent one ack-linked still-needed question, reset on the subsequent fix task, then exited on the later stop control.)

## 2026-06-08T23:05:49.835Z — code-review-companion / 2026-06-09T08-41-51-347Z-f8e3

- runId: 2026-06-09T08-41-51-347Z-f8e3
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-09T08-41-51-347Z-f8e3
- summary: Reviewed plan 008 across 9 task messages from T001 through the final F003/F004 fix. I sent 5 medium-severity findings covering assessment-report fallback drift, `npx harness` command drift, README contract drift, and verification overclaims. The final fix resolved the open issues, the e2e report validated successfully through minih surfaces, and the run stopped on outside request.
- **magicWand** (target: minih): minih should guarantee `MINIH_PROJECT_ROOT` points to the project git root in every agent run and expose a separate `MINIH_RUN_DIR` for the run folder; if the project-root env cannot be set, the runner should fail fast with a clear coordination error.
- difficulties:
  - [degrading] config: `MINIH_PROJECT_ROOT` resolved to the run directory, not the repository root, even though the prompt requires starting with `cd $MINIH_PROJECT_ROOT`. (workaround: Used `~/substrate/harness-engineering` from git/repository context for all project file reads and recorded the mismatch in the retrospective.)
  - [annoying] tooling: The prompt's suggested `minih validate --file` command is not supported by this minih CLI version. (workaround: Ran `minih check <slug> --file <path>` after checking the command help.)
  - [annoying] tooling: `git grep` entered a pager during review, producing stuck `(END)` output in the tool session. (workaround: Stopped the shell session and reran targeted checks with `GIT_PAGER=cat git --no-pager grep`.)
  - [annoying] coordination: The stop control body began with `^stop`, which does not satisfy the prompt's literal `/^stop\b/` stop-body match despite the control subject clearly requesting stop. (workaround: Treated the message as stop based on `type=control` and the stop subject, then acknowledged and wrote the farewell envelope.)

## 2026-06-09T02:36:19.445Z — code-review-companion / 2026-06-09T12-00-15-857Z-e2a9

- runId: 2026-06-09T12-00-15-857Z-e2a9
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-09T12-00-15-857Z-e2a9
- summary: Reviewed 10 commit-boundary tasks across plan 009, from the harnessability-assessment v0.2 schema/path/survey/matrix/template work through the G5 validate-harnessability dogfood verb and worker agent. I sent four findings: F003 was resolved by the AUTHORING.md v0.2 update, while F001 and F002 remain MEDIUM contract/validation drift and F004 remains a HIGH implementation issue in the dogfood verb's bash launch path. The final T018 wiring and skill discovery looked correct, but my phase verdict remains REQUEST_CHANGES until F004 is fixed.
- **magicWand** (target: coordination): Add a first-class finding disposition channel to companion mode: the outside actor should be able to mark finding IDs fixed, deferred, or accepted, and the final farewell should automatically include open/resolved status by ackOf.
- difficulties:
  - [degrading] coordination: Finding status was not represented as structured coordination state, so final open/resolved status had to be inferred manually from later commits and greps. (workaround: Tracked finding IDs in-session and re-ran focused greps on final state before the stop report.)
  - [annoying] debug: A literal brace search pattern for rg failed until the braces were escaped. (workaround: Reran the search with escaped braces.)
  - [annoying] debug: One focused diff shell command had an unmatched quote and waited for more input. (workaround: Stopped the shell session with stop_bash and reran the corrected command.)

## 2026-06-09T04:17:18.172Z — code-review-companion / 2026-06-09T13-48-38-077Z-bc4a

- runId: 2026-06-09T13-48-38-077Z-bc4a
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-09T13-48-38-077Z-bc4a
- summary: Reviewed plan 010 per-commit pings from T001 through the final drain sweep. T001, T002, T007, and T010 were approved, but the final range ended at REQUEST_CHANGES because seven findings remained outstanding on 5dc0d46: schema-version drift, broken minih skill discovery for the new two-level skills layout, stale old-slug/core-command docs, an argv builder/test path that can omit -y, and an execution log that still records no companion findings.
- **magicWand** (target: coordination): Add a companion-mode findings ledger command that renders all inside finding messages, their ackOf task, current disposition, and whether they were mentioned in the plan execution log; this would prevent final logs from saying 'none yet' while findings are still open.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run directory instead of the repository root, which made the required orient-default plan lookup initially appear empty. (workaround: Used git rev-parse --show-toplevel and absolute repository paths for the rest of the review.)
  - [annoying] test: minih skills doctor returned process exit 0 even while reporting status degraded and E211 errors for every requested skill. (workaround: Read the human output and JSON envelope status/diagnostics rather than relying on the process exit code.)
  - [annoying] debug: Several git show and audit commands exceeded the tool output limit and were written to temporary tool-output files. (workaround: Split review into bounded rg/view checks focused on the exact contract surfaces under review.)

## 2026-06-09T08:50:27.020Z — code-review-companion / 2026-06-09T18-22-26-936Z-7ddf

- runId: 2026-06-09T18-22-26-936Z-7ddf
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-09T18-22-26-936Z-7ddf
- summary: Reviewed the full Plan 011 implementation phase as a long-running companion across 9 task pings. I sent 5 MEDIUM findings, all centered on deferred-writer wording drift around governance being owed rather than provisioned until harness init exists. Follow-up commits c67d8b1 and f9f82cf resolved the outstanding F001-F005 theme; final checks found no remaining issues in router statelessness, canonical-first governance read order, the L0-L4 single-source rule, backpressure's corroboration-only stance, or retro harness-field null semantics.
- **magicWand** (target: minih): Ensure MINIH_PROJECT_ROOT always points to the repository root for coordinated agents, or expose a separate verified projectRoot field in the coordination context so agents do not have to recover it manually.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run directory even though the companion prompt required using it as the project root. (workaround: Used git rev-parse --show-toplevel and absolute paths under the repository root for orientation and reviews.)
  - [annoying] debug: Large git show outputs were truncated into temporary files, which made full-diff review noisy for markdown-heavy commits. (workaround: Switched to targeted rg searches and view ranges around the contractual lines under review.)

## 2026-06-09T13:02:55.385Z — code-review-companion / 2026-06-09T22-19-16-664Z-ef6f

- runId: 2026-06-09T22-19-16-664Z-ef6f
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-09T22-19-16-664Z-ef6f
- summary: Reviewed eight coordinated commit-boundary tasks for plan 013 as a long-running companion. I found eight issues total: one HIGH default-path execution risk around MINIH_PROJECT_ROOT, five MEDIUM contract/schema/artifact issues, and two LOW evidence claim issues. Clean reviews were sent for the T006 fire path and T011 guide; the run ended cleanly after a post-task still-needed check-in received no reply within the configured idle window.
- **magicWand** (target: minih): Guarantee MINIH_PROJECT_ROOT points to the repository root in every minih agent shell and expose a separate MINIH_RUN_DIR for the run folder; fail fast with a clear runner error if the project root cannot be exported.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT was empty in the shell, so the required initial cd did not reach the repository root and the first orientation lookup would have treated the run folder as the project. (workaround: Used git rev-parse --show-toplevel and absolute repository paths for project reads, then recorded the mismatch in findings and this retrospective.)
  - [annoying] debug: A bash exact-commit check hung after JS backticks inside a double-quoted command were interpreted by the shell. (workaround: Stopped the shell session and reran the check with plain grep over git show output instead of embedding backticks in shell-evaluated JavaScript.)
  - [annoying] knowledge: Some reviews needed exact commit scope because the working tree already contained later commits, so current-file searches could surface future changes outside the requested task. (workaround: Used git show <sha> -- path and git show <sha>:path for scoped review, and treated current-tree searches only as drift checks.)

## 2026-06-09T22:12:58.615Z — code-review-companion / 2026-06-10T07-51-13-436Z-c845

- runId: 2026-06-10T07-51-13-436Z-c845
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-10T07-51-13-436Z-c845
- summary: Reviewed FX001 commit b0613e1 for the doctor consumer-mode cli-build fix, including the tsconfig file-marker gate, dev-repo parity, doctor act assertion change, targeted tests, and contract drift surfaces. The implementation path was sound and the final drain found no new code issues; one MEDIUM contract-drift finding was sent for stale shipped guidance/prompt text that still describes the old consumer cli-build degraded wart.
- **magicWand** (target: coordination): Add an outside-side stop preflight that summarizes unresolved inside findings by ackOf before sending control:stop, so the orchestrator cannot accidentally close a run as clean when the companion has already sent a finding.
- difficulties:
  - [annoying] debug: A broad drift search produced an oversized rg tool result and saved temporary output instead of immediately surfacing the relevant references. (workaround: Reran narrower searches against explicit subtrees and cleaned up the generated temporary output files before finishing.)
  - [degrading] debug: A shell rg pattern containing backticked text triggered shell command substitution and produced an invalid regex error. (workaround: Reran the search with a single-quoted, escaped pattern and avoided backticks in the shell regex.)
  - [degrading] coordination: The outside stop message described the review as clean/no findings even though the companion had sent F001 earlier. (workaround: Preserved F001 in the farewell envelope and noted the contradiction in the coordination retrospective.)

## 2026-06-09T22:30:06.316Z — code-review-companion / 2026-06-10T08-17-07-782Z-1e56

- runId: 2026-06-10T08-17-07-782Z-1e56
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-10T08-17-07-782Z-1e56
- summary: Reviewed the FX002 scaffold-template enrichment commit 0aad609 for wrapTs/wrapJs behavior, byte-exact fixture sync, workshop drift, preserved error branch behavior, and scope boundaries. I sent one APPROVE summary with zero findings; no finding messages were emitted and the outside peer confirmed the inbox was drained before stop.
- **magicWand** (target: coordination): Add a coordination-level farewell helper that auto-summarizes tasks, findings, summaries, and unresolved inbox messages for the current run so the companion does not manually reconstruct counts from memory at stop time.
- difficulties:
  - [annoying] test: The root npm test script runs `cd harness/cli && vitest run --coverage`; my first filter used `harness/cli/test/services/scaffold/templates.test.ts`, which matched no test files and still exited 0. (workaround: Reran the test with the path relative to the vitest root: `npm test -- --run test/services/scaffold/templates.test.ts`.)

## 2026-06-10T01:29:17.338Z — code-review-companion / 2026-06-10T10-44-33-424Z-8149

- runId: 2026-06-10T10-44-33-424Z-8149
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-10T10-44-33-424Z-8149
- summary: Reviewed the Plan 014 Build phase across 12 review tasks and one final range sweep. The core folder-only discovery, instructions, help, doctor, scaffold, fixture, and governance surfaces are mostly coherent and `contract.ts` remained untouched, but the session closed REQUEST_CHANGES because two high-severity issues remain: collect mode misses the current dated retro layout, and required CI package-smoke still exercises the retired flat extension layout. Six medium contract/quality drifts were also reported for path wording, scaffold naming, stale schema/governance/setup wording, and bundled docs that still teach flat examples.
- **magicWand** (target: coordination): The companion loop should expose a first-class transcript/query surface for sent findings and task IDs; reconstructing report ack mappings from inbox metadata is still too manual at shutdown.

## 2026-06-10T01:55:00.000Z — code-review-companion / 2026-06-10T10-44-33-424Z-8149

- runId: 2026-06-10T10-44-33-424Z-8149
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-10T10-44-33-424Z-8149
- summary: Reviewed the Plan 014 Build phase across 12 review tasks and one final range sweep. The core folder-only discovery, instructions, help, doctor, scaffold, fixture, and governance surfaces are mostly coherent and `contract.ts` remained untouched, but the session closed REQUEST_CHANGES because two high-severity issues remained at stop time: collect mode missed the current dated retro layout, and the required CI package-smoke still exercised the retired flat extension layout. Six medium contract/quality drifts were also reported for path wording, scaffold naming, stale schema/governance/setup wording, and bundled docs that still taught flat examples. **Orchestrator disposition: all 8 findings ADDRESSED INLINE in commit `1a6d5c9` post-farewell (see plan 014 execution log).**
- **magicWand** (target: coordination): The companion loop should expose a first-class transcript/query surface for sent findings and task IDs; reconstructing report ack mappings from inbox metadata is still too manual at shutdown.
- workedWell: Per-commit review pings made it easy to catch localized contract drift early, and the final range sweep caught a CI sensor mismatch that per-commit local tests did not expose.
- confusing: The public output schema did not mention the system-required `workedWell` and `confusing` retrospective fields, so the first report passed schema validation but failed system validation.
- notes: During this run, `wait_for_any` missed queued task messages that `inbox_list` later returned, and an idle-budget farewell was superseded by queued work. Future companion runs should prefer the documented `inbox_list` long-poll until the wait-for-any behavior is proven equivalent. (Net effect this run: zero live finding messages reached the orchestrator during the phase; everything arrived in the farewell after the final range sweep.)

## 2026-06-10T03:25:19.712Z — code-review-companion / 2026-06-10T12-44-41-380Z-6236

- runId: 2026-06-10T12-44-41-380Z-6236
- runDir: ~/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-10T12-44-41-380Z-6236
- summary: Reviewed the plan 015 build sequence as a long-running companion: T001-T011 plus a final range sweep. The strongest positive signals were broad CLI test coverage for capture/list/clear, exit mappings, FakeFs compaction simulation, reserved observe, doctor temp-hygiene, and old-slug retirement. Final verdict remained REQUEST_CHANGES because F001 (malformed observations can be deleted by clear after list skips them) and F003 (temp gitignore self-heal overclaim across briefing/docs/setup) were still open; F002 was addressed by the T003/T004 follow-up.
- **magicWand** (target: coordination): Add a coordination stop guard that compares outside lastReviewedSha with the stop commit and warns or requires an explicit reviewedThrough field before control:stop completes.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run folder instead of the repository root, contradicting the companion prompt's first instruction. (workaround: Used the repository root from the session context for all project-relative file and git operations.)
  - [annoying] coordination: The stop message cited commit ff310da after the final review request and final summary had covered b57d7b1, with no separate review request for ff310da before stop. (workaround: Recorded the reviewed-through boundary in this report and did not start new review work after control:stop, per stop-wins protocol.)
  - [annoying] debug: A broad grep for retired-skill references hit generated docs/run material and produced oversized output. (workaround: Narrowed subsequent searches to live surfaces and capped output with rg/view ranges.)

## 2026-06-10T08:22:50.383Z — code-review-companion / 2026-06-10T17-53-04-600Z-0c63

- runId: 2026-06-10T17-53-04-600Z-0c63
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-10T17-53-04-600Z-0c63
- summary: Reviewed the 016 arch-check phase as a long-running companion across 14 task requests, including per-commit reviews and a final full-range sweep. I sent 7 findings total (5 HIGH, 2 MEDIUM). The implementation largely builds the intended arch-check extension, rules, CI step, guide, briefing, governance update, and retro drain, but the final verdict remains REQUEST_CHANGES because unresolved blockers remain in the tree and the phase record falsely reports zero companion findings.
- **magicWand** (target: coordination): Auto-materialize companion findings into the execution log or provide a minih command that exports an ackOf-grouped findings ledger for the orchestrator before phase close.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run folder rather than the repository root, contrary to the companion prompt's boot instruction. (workaround: Used the known Git repository root from the environment context and git-root fallback for all project-relative orientation and review commands.)

## 2026-06-10T10:33:31.926Z — code-review-companion / 2026-06-10T19-47-11-847Z-ee10

- runId: 2026-06-10T19-47-11-847Z-ee10
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-10T19-47-11-847Z-ee10
- summary: Reviewed the plan 017 implementation stream from helper/test setup through the final CI repair, responding to 15 review tasks plus a final range sweep. The phase is broadly coherent and CI was reported green, with four medium findings sent: one UNC comparison edge case, two proof/documentation overclaims around the ubuntu Windows-shape sensor, and one self-repo invocation documentation drift after the npx workaround.
- **magicWand** (target: coordination): Make the companion farewell transition atomic: provide a single coordination command that checks for unread messages and conditionally transitions to stopping only when the inbox is still empty.
- difficulties:
  - [degrading] coordination: A late task arrived during the final pre-completion inbox check while I had already emitted the idle-budget farewell path in parallel. (workaround: Acknowledged the task, transitioned back from stopping to reading, sent a superseding progress note, completed the review, and waited for an explicit stop.)

## 2026-06-14T22:14:23.410Z — code-review-companion / 2026-06-15T07-57-06-414Z-c5c8

- runId: 2026-06-15T07-57-06-414Z-c5c8
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-15T07-57-06-414Z-c5c8
- summary: Reviewed FX001 harness-init commits b40d6c1, faa8e2a, and a505b04. I sent one MEDIUM contract-drift finding about canonical governance-doc section order, confirmed it was fixed by faa8e2a, and approved the final phase drain with no new findings; the implementation preserves L0-only skeleton honesty, empty injection map, never-clobber init service behavior, E190 write-failure mapping, injected fs/proc I/O, and reserved init command registration.
- **magicWand** (target: coordination): Add a minih companion helper command like `minih inside drain-before-stop --types task,control --settle-ms 5000` that atomically checks unread inbox messages before allowing a farewell/state=stopping transition.
- difficulties:
  - [annoying] test: I initially used the Jest-style `--runInBand` flag with Vitest during the final focused test slice; Vitest rejected it as an unknown option. (workaround: Reran the same focused test files without `--runInBand`, which passed.)
  - [degrading] coordination: A new review task arrived during the final inbox drain while shutdown state/farewell were being published in parallel. (workaround: Cancelled shutdown by transitioning back to reading, acknowledged the task, completed the review, and waited for explicit control:stop.)

## 2026-06-15T03:35:41.628Z — code-review-companion / 2026-06-15T12-33-03-542Z-8339

- runId: 2026-06-15T12-33-03-542Z-8339
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-15T12-33-03-542Z-8339
- summary: Reviewed the full plan 019 commit sequence plus final drain. The final tree still has seven outstanding findings, including three HIGH-severity contract/correctness issues around --pin validation, pinned 404 classification, and documentation that promises an unwired background update lookup. The companion is exiting after the outside stop request.
- **magicWand** (target: coordination): Add a lightweight contract-drift audit surface that maps documented user-facing claims to implementation call sites for critical contracts like update checks, pin validation, and exit-envelope decoration.

## 2026-06-16T04:29:36.680Z — code-review-companion / 2026-06-16T14-08-21-533Z-7cf0

- runId: 2026-06-16T14-08-21-533Z-7cf0
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-16T14-08-21-533Z-7cf0
- summary: Reviewed Plan 020 Phase 1 commit-boundary requests for T001-T002 (cebb4e1), T003-T004 (fe741f1, including a corrected-SHA follow-up), T005-T007 (c92d280), and the final drain. No code-review findings were sent; the reviewed changes aligned with the stated provenance, record-type, registry, list, and doctor contracts.
- **magicWand** (target: minih): Make minih set MINIH_PROJECT_ROOT to the repository root for inside agents, or expose a `minih context --json` command that returns projectRoot, runId, outputPath, and active plan paths from one canonical source.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run directory even though the companion prompt required starting from the project root. (workaround: Used the repository root from the environment context for all project-relative reads and commands.)
  - [annoying] test: The first targeted test and architecture-check commands used the wrong package/script layout: harness/cli has no package.json and the root package has no arch-check script. (workaround: Read the root package.json and reran targeted tests via `npm test -- <vitest paths>` from the repository root; manually grepped services/record for forbidden runtime node/process imports.)
  - [annoying] coordination: One review request named cebb4e1 for T003-T004 even though cebb4e1 only contained T001-T002; the provenance implementation was uncommitted at that moment. (workaround: Reviewed the matching working-tree diff, noted the mismatch in the summary, then re-reviewed the corrected fe741f1 commit when the outside peer sent it.)

## 2026-06-16T06:22:08.957Z — code-review-companion / 2026-06-16T15-59-40-923Z-d583

- runId: 2026-06-16T15-59-40-923Z-d583
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-16T15-59-40-923Z-d583
- summary: Oriented on plan 020, reviewed two Phase 2 commit requests for the `win` retro kind, and sent one MEDIUM contract-drift finding. Commit 271c731 had no findings. Commit eca4117 correctly widened the retro schema/template and left harness-bypass/change at 1.0, but exposed stale Kinds guidance in the retro skill and AGENTS_README; the outside peer accepted and deferred that drift to the owning later phases before merge.
- **magicWand** (target: coordination): Add an explicit companion-mode rule for task-local quiet-mode phrases like 'reply only if issues': whether they suppress zero-finding summaries, or whether the mandatory summary always wins.
- difficulties:
  - [annoying] coordination: Task-local instructions requested 'reply only if you find issues', but the agent prompt separately requires a summary message at the end of each task. (workaround: Sent the required summary messages and kept them concise, while reserving finding messages for actual issues.)
  - [annoying] tooling: The ripgrep wrapper rejected a negative lookahead used during the drift audit because the default regex engine does not support look-around. (workaround: Reran the audit with simpler patterns and inspected the matched context directly.)

## 2026-06-16T07:35:24.365Z — code-review-companion / 2026-06-16T07-18-47-309Z-3ebc

- runId: 2026-06-16T07-18-47-309Z-3ebc
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-16T07-18-47-309Z-3ebc
- summary: Reviewed Plan 020 Phase 3 commit requests for the history.md retirement work: T001 migration record, T002-T005 delete/guard/prose sweep, and the final drain. I found no issues; the record contract, migrate-before-delete ordering, guard implementation, phase boundaries, and commit hygiene all checked out.
- **magicWand** (target: minih): Make minih validate and expose the project root consistently for coordinated agents: set MINIH_PROJECT_ROOT to the repository root, or add a coordination-provided projectRoot field so the first cd cannot land in the run directory.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run directory rather than the repository root, contradicting the companion prompt and causing the initial project-orientation command to inspect the wrong location. (workaround: Used the known repository root path from the environment context for all subsequent git, file, and validation commands.)

## 2026-06-17T02:31:53.796Z — code-review-companion / 2026-06-17T02-18-28-773Z-e8b5

- runId: 2026-06-17T02-18-28-773Z-e8b5
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-17T02-18-28-773Z-e8b5
- summary: Reviewed the Plan 021 Phase 1 code-review-companion commit stream for T001-T004 plus the phase drain/T005 read-back. T001, T002, and T004 were clean; T003 correctly documented `--hook` as primary and `--event` as permanent, but the required drift audit found two MEDIUM stale-contract references that remained outstanding at stop time. No HIGH or CRITICAL issues were found.
- **magicWand** (target: minih): Have `minih run` export a reliable `MINIH_PROJECT_ROOT` and add a startup self-check that fails or warns when it points at the run folder instead of the project root.
- difficulties:
  - [degrading] config: The prompt's required `cd $MINIH_PROJECT_ROOT` did not enter the repository root; the shell reported the code-review-companion run directory instead. (workaround: Used the repository root provided by the execution environment context: /Users/jordanknight/substrate/harness-engineering.)

> ⚠️ ## 2026-06-17T03:30:26.226Z — code-review-companion / 2026-06-17T03-17-49-557Z-6252
>
> - runId: 2026-06-17T03-17-49-557Z-6252
> - runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-17T03-17-49-557Z-6252
> - result: failed
> - magicWand: (unavailable — run terminated as failed)
> - stderr (last line): Execution failed: CAPIError: 400 The requested model is not supported. (Request ID: DFA0:1A6931:10F73D9:12CAC61:6A3214D0)

## 2026-06-17T06:56:27.433Z — code-review-companion / 2026-06-17T06-15-38-151Z-f95d

- runId: 2026-06-17T06-15-38-151Z-f95d
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-17T06-15-38-151Z-f95d
- summary: Reviewed seven commit-boundary requests for plan 022: T002 through T008 of the eng-harness skill consolidation. I found two MEDIUM issues: T002's routing-engine extraction did not meet the stated verbatim public-contract proof despite preserving field/table shape, and T007's getting-started guide overstated that every router path loads a verb module despite the assess peer and coding CLI exceptions. The other reviewed commits preserved their requested contracts, including coach extraction, loop/setup module de-leaking, thin dispatch frontmatter/registry reachability, peer relocation, template count, and the final two-skill tree.
- **magicWand** (target: coordination): Add an explicit summaryPolicy field to the briefing protocol so an outside actor can choose findings-only or always-summary without conflicting with the companion prompt.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run folder, not the repository root, during orientation. (workaround: Used git rev-parse --show-toplevel and absolute paths for all project reads.)
  - [annoying] coordination: The outside brief repeatedly said 'reply only if issues', but the companion working contract required a summary response after every task. (workaround: Followed the companion contract and sent concise zero-finding summaries, while keeping findings as separate messages.)

## 2026-06-17T07:22:46.402Z — code-review-companion / 2026-06-17T07-05-43-674Z-528d

- runId: 2026-06-17T07-05-43-674Z-528d
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-17T07-05-43-674Z-528d
- summary: Reviewed the tail of plan 022 as the code-review companion. The initial d64f9ad T009 catalog sweep review found two MEDIUM catalog-contract drift issues: the CLI docs summary still named the retired eng-harness-0-add-extension skill, and the adoption checklist still said both setup and loop groups/all seven. The phase-end drain review of ddcd411 verified both were fixed, the docs bundle was regenerated, 00-routing.md remained byte-identical to its creation blob, the stage-module forbidden scan was clean for sibling-skill slug / SDD-flow / Next-routing leaks, and the remaining stale .minih.json / agents old-skill wiring is already documented as an out-of-scope follow-up rather than an in-scope phase-close finding.
- **magicWand** (target: minih): Expose a reliable projectRoot value to shell commands (or make MINIH_PROJECT_ROOT consistently point to the repo root) and show it in coordination status so companions do not have to rediscover it with git.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT was not usable as the repository root in the shell session even though the companion prompt required cd $MINIH_PROJECT_ROOT as the first action. (workaround: Used git rev-parse --show-toplevel from the run folder and ran all repository commands from that path.)

## 2026-06-18T00:47:14.426Z — code-review-companion / 2026-06-18T00-27-49-683Z-f765

- runId: 2026-06-18T00-27-49-683Z-f765
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-18T00-27-49-683Z-f765
- summary: Reviewed three plan 024 Phase 1 commit boundaries. T001 hook-contract snapshot and T003 gen:flows pipeline were approved with no findings. T002 additive flow error-code block was approved with notes after one MEDIUM contract-drift finding on the E307 comment overlapping the E108 mutual-exclusivity rule. Stood down after the post-task still-needed check-in went unanswered.
- **magicWand** (target: coordination): Add a `minih report draft --slug code-review-companion --run <id>` command that emits a schema-valid farewell JSON skeleton prefilled with session times, message counts, and coordination counters.
- difficulties:
  - [annoying] test: The first focused test invocation passed a path through the root npm test script in a way Vitest treated as no matching test files while still exiting 0, which could falsely look like validation. (workaround: Re-ran the test from harness/cli with `npx vitest run test/contract/hooks-snapshot.test.ts --coverage=false --reporter=dot`.)
  - [annoying] coordination: The prompt included two overlapping output schemas: the companion farewell envelope and the generic required JSON object, with different retrospective field names. (workaround: Wrote a superset JSON object containing session/findings plus the generic retrospective fields.)

## 2026-06-18T01:42:49.236Z — code-review-companion / 2026-06-18T01-05-49-449Z-93ae

- runId: 2026-06-18T01-05-49-449Z-93ae
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-18T01-05-49-449Z-93ae
- summary: Reviewed Plan 024 Phase 1 commits T007-T016 plus the companion fix commit. The final version gate change looked correct, F002 and the bundled-schema portion of F003 were fixed, but a residual HIGH issue remains for out-of-repo schema flows because post-mutation validation is skipped when the overlay cannot be re-resolved.
- **magicWand** (target: coordination): Add a coordination primitive or convention for bundled final-drain-plus-stop messages so a companion can explicitly complete the drain review before honoring stop without ambiguity.
- difficulties:
  - [degrading] coordination: A final verification task and control:stop arrived together, creating ambiguity between strict stop precedence and the peer's explicit request to verify then stand down. (workaround: Acknowledged both, performed the small verification requested by the earlier task, then proceeded directly to farewell without further polling.)
  - [annoying] config: MINIH_PROJECT_ROOT was not visible to the shell at boot, so the required initial cd command landed in the run folder instead of the repository root. (workaround: Used the repository root path provided in the environment context for all subsequent commands.)
  - [annoying] test: The npm test script changes into harness/cli, so root-relative test filters produced a no-test run with exit code 0. (workaround: Reran the same tests with harness/cli-relative paths.)

## 2026-06-18T02:20:31.753Z — code-review-companion / 2026-06-18T01-50-01-936Z-ea51

- runId: 2026-06-18T01-50-01-936Z-ea51
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-18T01-50-01-936Z-ea51
- summary: Reviewed the docs/guide authoring pass as a long-running companion: T001 through T016 plus a final full-guide drain. I sent three MEDIUM findings covering README nav-template drift, unqualified `harness boot` extension wording in the concept doc, and an over-strong resumability claim in the adoption guide; all other per-file reviews and the final sweep found no additional command, link, nav-continuity, terminology, or unmarked-aspirational issues.
- **magicWand** (target: coordination): Add a coordination-provided run context field or helper command that prints the authoritative project root, active plan path, output path, and task counters as JSON so companion agents do not have to reconcile prompt text, environment variables, and outside messages manually.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT resolved to the run folder even though the companion instructions require starting from the project root. (workaround: Used the repository root from the session environment context and absolute paths for all project reads.)
  - [annoying] debug: The first holistic sweep command produced too much output to inspect directly. (workaround: Re-ran narrower command, link, and nav checks with focused scripts.)

## 2026-06-18T09:21:53.304Z — code-review-companion / 2026-06-18T08-39-20-769Z-0c4e

- runId: 2026-06-18T08-39-20-769Z-0c4e
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-18T08-39-20-769Z-0c4e
- summary: Oriented on plan 026 and reviewed four commit-boundary tasks for Phase 1. I sent two findings: one HIGH contract issue in create provenance handling and one MEDIUM zone enum validation issue. C3 rail and C4 docs/dogfood added no new issues, but the two queued findings remained open at the final drain before the outside peer requested stop.
- **magicWand** (target: coordination): Add a companion inbox command or coordination ledger field for open finding status, so final drain can report unresolved findings without reconstructing them from prior messages.
- difficulties:
  - [annoying] coordination: Open findings had to be tracked manually across multiple commit-boundary tasks and re-summarized during final drain. (workaround: Kept the finding ids, severities, ackOf task ids, and open status in working context, then repeated them in the final drain summary and report.)

## 2026-06-18T11:37:48.160Z — code-review-companion / 2026-06-18T11-19-00-476Z-d552

- runId: 2026-06-18T11-19-00-476Z-d552
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-18T11-19-00-476Z-d552
- summary: Oriented on plan 027, acknowledged the group-A briefing, reviewed the supplied cursor-to-nav migration diff and new `flight-plan-ops.md`, sent two MEDIUM findings plus an APPROVE_WITH_NOTES summary, then stood down after the post-task still-needed check-in received no reply.
- **magicWand** (target: minih): Have minih set the SDK tool working directory to `$MINIH_PROJECT_ROOT` for non-shell file tools, or expose a visible `toolCwd` field in the prompt so agents know when `rg`/`glob` need absolute paths.
- difficulties:
  - [annoying] debug: Non-shell search tools resolved paths relative to the run directory even after the shell-oriented `cd $MINIH_PROJECT_ROOT` instruction, causing initial `rg` searches for project paths to fail. (workaround: Reran the searches with absolute paths under `/Users/jordanknight/substrate/harness-engineering`.)

## 2026-06-18T22:57:10.414Z — code-review-companion / 2026-06-18T22-07-07-751Z-4b93

- runId: 2026-06-18T22-07-07-751Z-4b93
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-18T22-07-07-751Z-4b93
- summary: Reviewed Plan 024 Phase 4 chore-node work across 14 task diffs plus the final cumulative sweep. The core shape is sound: chore remains an optional orthogonal node attribute, overlay-declared chore statuses stay out of the shared status validator, rail rendering preserves non-chore behavior, and importance remains advisory rather than gating. No HIGH or CRITICAL issues were found. Three MEDIUM contract/documentation drifts were reported and remain the cumulative open review notes.
- **magicWand** (target: coordination): The companion loop would be easier to audit if the final report helper could automatically materialize sent findings with ackOf IDs from the coordination ledger instead of requiring manual reconstruction.

## 2026-06-19T05:01:57.672Z — code-review-companion / 2026-06-19T04-33-18-697Z-8ae6

- runId: 2026-06-19T04-33-18-697Z-8ae6
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-19T04-33-18-697Z-8ae6
- summary: Reviewed three working-tree task boundaries for plan 031. T001 was APPROVE_WITH_NOTES with two medium issues around ctx wiring coverage and public contract documentation drift. T002 was REQUEST_CHANGES because NodeBackground's detached-spawn failure path lacks ChildProcess error handling and parent fd cleanup, plus a medium ctx.background/docs drift gap. A late T003 request was APPROVE_WITH_NOTES: clock.sleep and the advisory Node runtime guard looked sound, but ctx.clock.sleep extended the same authoring-doc and ctx wiring-test drift. The companion had previously exited via idle_budget after a post-task still-needed check-in, then processed the late task and refreshed this report.
- **magicWand** (target: coordination): Add a first-class 'snapshot diff for review-request' attachment or command output capture so the inside reviewer sees an immutable task-boundary diff even when the working tree keeps changing.
- difficulties:
  - [degrading] coordination: Working-tree diff review was not snapshot-stable; git diff showed transient typos that were fixed before the file could be viewed. (workaround: Refreshed the scoped diff and line views before reporting findings.)
  - [annoying] test: The initial focused Vitest command used an unsupported --runInBand flag. (workaround: Reran the focused test with the accepted 'npx vitest run <file>' invocation.)

## 2026-06-19T05:39:53.045Z — code-review-companion / 2026-06-19T05-38-35-220Z-7e96

- runId: 2026-06-19T05-38-35-220Z-7e96
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-19T05-38-35-220Z-7e96
- summary: Oriented on active plan 032-eng-harness-flow-flight-plans and published ready state, then received an outside stop request before any review task or briefing. No code review findings were produced.
- **magicWand** (target: minih): Expose MINIH_PROJECT_ROOT and MINIH_OUTPUT_PATH consistently to shell/tool executions, or include a first-class coordination field for the project root and output path so agents do not need literal-path fallback.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT was not available to the shell tool even though the prompt instructed using it as the first action, causing the initial orientation command to run from the run folder. (workaround: Used the literal repository root provided in the session context and reran orientation from there.)

## 2026-06-19T05:50:28.240Z — code-review-companion / 2026-06-19T05-48-11-751Z-63b0

- runId: 2026-06-19T05-48-11-751Z-63b0
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-19T05-48-11-751Z-63b0
- summary: Reviewed the uncommitted Group A plan 032 flow changes. Verdict: REQUEST_CHANGES due to one HIGH adopt-flow contract bug and one MEDIUM loop decision drift. The set-node --zone/--chore-kind/--importance extension and guard placement looked consistent with add-node behavior.
- **magicWand** (target: minih): Expose the project root and output path through a minih doctor/status field inside coordinated runs so agents do not have to recover from unset shell variables.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT was not visible to the shell even though the prompt instructed cd $MINIH_PROJECT_ROOT first. (workaround: Used the explicit repository root from the environment context for all git, view, and validation operations.)

## 2026-06-19T05:55:55.765Z — code-review-companion / 2026-06-19T05-54-21-174Z-1233

- runId: 2026-06-19T05-54-21-174Z-1233
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/code-review-companion/runs/2026-06-19T05-54-21-174Z-1233
- summary: Reviewed the requested uncommitted Group B skill changes for plan 032, including SKILL.md, 00-routing.md, coach.md section 1a, the new flight-plan-ops.md, the external the-flow harness-seams.md diff, and the plan AC language. The core changed files are coherent: state-contract supersession is scoped to flow position, S0/S2/S4 selects loop otherwise adopt, AC-07 chore shape and dedup match across 00-routing.md and flight-plan-ops.md, and R-1 single-owner aligns with the the-flow note. I found one medium doctrine-drift issue in existing getting-started.md guidance.
- **magicWand** (target: coordination): Expose a reliable coordination variable or command such as `minih project-root` that always returns the actual repository root for inside agents.
- difficulties:
  - [degrading] config: The prompt instructed `cd $MINIH_PROJECT_ROOT`, but in this run that variable pointed at the run folder, not the git repository root, causing the first file read to miss the requested skill paths. (workaround: Changed to the explicit repository root from the environment context and repeated the scoped reads.)
