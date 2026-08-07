# Code Review: Phase 1 — Sandbox Attribution

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/docs/plans/074-sandbox-attribution/plan.dd.json`  
**Spec**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/docs/plans/074-sandbox-attribution/plan.dd.md`  
**Phase**: Simple Mode — Phase 1: Implementation  
**Date**: 2026-08-07  
**Reviewer**: Independent adversarial review  
**Testing Approach**: Fake-port unit tests plus the recorded live-daemon spike

## A) Verdict

**FIX_REQUIRED**

**Key failure areas**:
- **Implementation**: Trace2 text can add foreign commit SHAs to a nudge confirmation set, permanently retaining a segment and misreporting another commit.
- **Recovery lifecycle**: Retained segments disappear from later nudge reports, which can call the state healthy while recovery work remains.
- **Commit recovery guidance**: The file-target branch names a nudge command that necessarily skips under that very target configuration.
- **Constraint compliance**: A doctor act test constructs the real socket adapter and can perform a real socket connect when the test machine has a configured target.

## B) Summary

The change is thoughtfully structured around separate probe and relay ports, a fake-driven test seam, and a good first-pass implementation of rotate, replay, settle, and delete. The mutation tests demonstrate that the important commit partition and full-confirmation guards are live. However, the recovery path still makes confidence claims it cannot support: its SHA scan accepts arbitrary commit-message text, and it does not surface previously retained segments. The core commit paths also point users to a recovery command that is guaranteed to refuse work for a plain-file target. These defects are material to the plan's safety claim, so this phase cannot be approved.

## C) Checklist

**Testing Approach: Hybrid**

- [x] Core validation tests present
- [x] Critical branch and lifecycle guards mutation-tested
- [x] Plan completion documents validate strictly
- [x] No production dependency added
- [ ] CI tests hermetic with respect to real sockets
- [ ] Recovery paths retain and enumerate every deferred segment correctly
- [x] Domain compliance N/A (domain mode is off)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `harness/cli/src/services/doctor/collector/nudge.ts:80` | correctness | Payload SHA scanning treats 40-hex commit-message text as a covered commit. | Trust the sidecar or parse only a schema-proven commit identifier. |
| F002 | HIGH | `harness/cli/src/services/doctor/collector/nudge.ts:212-219` | recovery | Previously retained segments are neither enumerated nor reported. | Enumerate segment files on every run and never report `no-buffer` as healthy while any are retained. |
| F003 | MEDIUM | `harness/cli/src/services/commit/commit-service.ts:276`; `harness/cli/src/services/doctor/collector/nudge.ts:196-203` | correctness | File-target recovery guidance names a command that immediately skips. | Make `--buffer` usable with a reachable socket, or state the required target reconfiguration first. |
| F004 | MEDIUM | `harness/cli/src/services/doctor/collector/ingress.ts:41-51` | correctness | Disabled and fd trace2 target forms are classified as buffering files. | Classify Git's false/disabled and fd forms as non-ingress targets; only absolute paths should be `file`. |
| F005 | MEDIUM | `harness/cli/src/acts/doctor.ts:267`; `harness/cli/src/services/doctor/collector/nudge.ts:225-228` | error handling | A relative `--buffer` constructs a malformed segment path; arbitrary absolute paths are not contained. | Resolve and contain the option under the repo, use a pathname helper, and degrade rather than throw on filesystem errors. |
| F006 | MEDIUM | `harness/cli/test/acts/doctor.test.ts:35-46` | testing | The doctor act test uses the production composition root and can invoke `net.createConnection`. | Inject a fake collector/probe into the act test so CI never reaches a real socket. |
| F007 | MEDIUM | `harness/cli/src/services/commit/commit-service.ts:220-247`; `harness/cli/src/adapters/git/exec-git-attribution.ts:67-71` | recovery | A successful commit whose follow-up `rev-parse HEAD` fails is reported failed and never gets a sidecar SHA. | Separate commit failure from unknown SHA; report the commit degraded and preserve recoverability. |

## E) Detailed Findings

### E.1) Implementation Quality

#### F001 — foreign SHA poisoning retains segments indefinitely

`commitShasIn()` unions sidecar SHAs with every 40-hex token in trace2 payload text. The trace2 `start` event contains the literal `git commit -m` arguments. A standard revert or cherry-pick message can therefore introduce the SHA of an unrelated historical commit. If that older commit has no AI note, the nudge reports it as still missing, waits through the confirmation timeout, and retains this segment forever. The current test fixture omits argv text, so it cannot expose this path.

#### F002 — retained segments are lost on the next invocation

The only `retained` value is the segment created by the current invocation. `NudgeDeps.fs` has no directory-enumeration capability, so a later nudge with no live `buffer.jsonl` returns `no-buffer` and says this is the healthy shape even though `segment-*.jsonl` files remain beside it. This directly misses AC-0006's requirement to list retained segments with an explicit retry instruction.

#### F003 — file-target recovery command cannot run

The file-target commit branch directs users to `harness doctor telemetry-nudge --buffer <target>`. The nudge reads ingress first and rejects every non-`af_unix` target before reading `bufferPath`; by definition, the branch's configured target is a file. The command therefore always skips until configuration changes, but the instruction does not name that prerequisite.

#### F004 — non-file Git target forms receive false buffering claims

`resolveTrace2Target()` recognizes only `1`, `2`, and `true` as non-ingress targets. Git's disabled values such as `0` and `false`, and file-descriptor forms `3` through `9`, fall through as `{ kind: 'file' }`. The commit command then leaves trace2 unoverridden and claims the configured target buffers events, even though disabled trace2 sends no events at all.

#### F005 — unsafe `--buffer` path handling can break an always-degraded verb

The doctor act passes a relative `--buffer` value unchanged. For `buffer.jsonl`, `lastIndexOf('/')` is `-1`, so the segment directory becomes `buffer.json`; `renameSync` can throw. There is no containing-path check for an absolute path outside the repository either, despite the command renaming and deleting it after confirmation.

#### F007 — a committed change can be declared absent

`ExecGitAttribution.commit()` reports success before separately resolving `HEAD`. If the read fails after a successful `git commit`, `harnessCommit()` treats `sha === null` as commit failure, returns exit 1, and does not write the buffered sidecar. The commit occurred but is reported as not committed, and its buffered trace2 record becomes unconfirmable.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | N/A | Domain mode is off. |
| Contract-only imports | N/A | Domain mode is off. |
| Dependency direction | N/A | Domain mode is off. |
| Domain.md updated | N/A | Domain mode is off. |
| Registry current | N/A | Domain mode is off. |
| No orphan files | N/A | Domain mode is off. |
| Map nodes current | N/A | Domain mode is off. |
| Map edges current | N/A | Domain mode is off. |
| No circular business deps | N/A | Domain mode is off. |
| Concepts documented | N/A | Domain mode is off. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| Socket probe/relay ports | None found | CLI adapter/service | Proceed; the separate read/write capability split is appropriate. |
| Git attribution port | None found | CLI adapter/service | Proceed; it centralizes child-process semantics. |

### E.4) Testing & Evidence

**Coverage confidence**: 65%

The supplied fake-based tests exercise normal probe mappings, one commit branch per enumerated outcome, and the all-confirm versus partial-retain nudge lifecycle. The two mutation tests below prove those named guards are meaningful. Coverage is reduced by untested target forms, trace2 argv payloads, retained-segment discovery, `--buffer` containment/relative paths, and the successful-commit/unknown-SHA path.

#### F006 — test isolation is not assured

`registerDoctorAct()` creates `NodeSocketProbe` through the production root. Its default connection factory reaches `net.createConnection` when a machine's global target is `af_unix`. This contradicts the feature's stated fake-only CI strategy and makes the test environment-dependent.

### E.5) Doctrine Compliance

The additive core registration, managed guidance block, dependency diff, and read-only doctor/relay split align with the repo's architecture. F002-F005 violate the more important doctrine for this phase: a recovery surface must not report a confidence state or instruction that its own implementation cannot establish or execute.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| ac-0001 | Probe port and resolver | Fake outcomes and injected sockets cover the stated adapter mapping; resolver misclassifies disabled/fd target forms. | Partial |
| ac-0002 | Blocked ingress verdict | Predicate is probe-and-file based; markers remain explanatory. | High |
| ac-0003 | At-risk enumeration | Windowing, cap, wording, and blocked-ingress `unproven` behavior are covered; empty/read-failed windows can still claim clean. | Partial |
| ac-0004 | Capture liveness | Capture-off now returns `could-not-determine`, not healthy. | High |
| ac-0005 | Safe commit partition | Main paths and mutations are covered; file recovery advice and post-commit unknown-SHA handling are unsafe. | Partial |
| ac-0006 | Nudge lifecycle | Rotation, settle, full delete, and partial retention are covered; retained segments are not later listed and payload scan can poison confirmation. | Partial |
| ac-0007 | Read-only doctor/checks | Probe-only interface is handed to doctor; relay exists only in explicit nudge act. | High |
| ac-0008 | Core commit guidance | Core page, explicit managed-block injection, and warning seam are implemented. | High |
| ac-0009 | Documentation and baseline | Sandbox-attribution section is self-contained; documented warning baseline remains 2/196/6. | High |
| ac-000a | Constraints | No production dependency added; test isolation can reach a real socket. | Partial |

**Overall coverage confidence**: 65%

## G) Commands Executed

```bash
git show --stat --oneline 0bdf3a7b
git diff --name-status 885c3763..0bdf3a7b
git diff --check 885c3763..0bdf3a7b
git diff --no-ext-diff 885c3763..0bdf3a7b -- package.json
cd harness/cli && npx vitest run test/services/commit/commit-service.test.ts
cd harness/cli && npx vitest run test/services/doctor/collector/nudge.test.ts
cd harness/cli && npx vitest run test/services/commit/commit-service.test.ts test/services/doctor/collector/nudge.test.ts
node harness/cli/bin/harness.js plan validate docs/plans/074-sandbox-attribution --complete
just checks
git status --short
git diff --check
git diff --exit-code -- harness/cli/src harness/cli/test
```

**Dim-0 mutation evidence**:

- Changed `bufferedBranch` from `probe !== 'connected'` to `probe === 'connected'`; the targeted commit-service suite went **RED** (14 failures), including every buffered outcome and the connected no-override assertion. Restored before baseline re-run.
- Changed nudge full-confirmation guard from `stillMissing.length === 0` to `> 0`; the targeted nudge suite went **RED** (7 failures), including all-confirm-delete and partial-retain. Restored before baseline re-run.
- Restored targets passed: 42 tests across the two suites. Source and test paths are clean.

**Gate results**: `just checks` completed with its recorded non-blocking baseline: arch-check 2, markdown-lint 196, windows-check 6. Strict plan validation reported 0 errors and 0 warnings.

## H) Handover Brief

**Review result**: FIX_REQUIRED

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/docs/plans/074-sandbox-attribution/plan.dd.json`  
**Spec**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/docs/plans/074-sandbox-attribution/plan.dd.md`  
**Phase**: Simple Mode — Phase 1: Implementation  
**Tasks dossier**: inline in plan  
**Execution log**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/docs/plans/074-sandbox-attribution/assets/execution.log.md`  
**Review file**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/docs/plans/074-sandbox-attribution/assets/reviews/phase-1-review.md`

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/src/services/doctor/collector/nudge.ts` | Changes required | CLI | Fix F001, F002, F003, F005. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/src/services/commit/commit-service.ts` | Changes required | CLI | Fix F003 and F007. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/src/services/doctor/collector/ingress.ts` | Changes required | CLI | Fix F004. |
| `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/test/acts/doctor.test.ts` | Changes required | CLI | Fix F006. |

### Required Fixes

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/src/services/doctor/collector/nudge.ts` | Do not infer commit identity from arbitrary payload text; enumerate retained segments and report retry pointers. | Prevent permanent retention, false missing-sha reports, and false healthy reports. |
| 2 | `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/src/services/commit/commit-service.ts` | Make file-target recovery actionable and distinguish successful commit/unknown SHA from commit failure. | Preserve the safe-commit promise and sidecar recovery evidence. |
| 3 | `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/src/services/doctor/collector/ingress.ts` | Fully classify Git's disable/fd target values. | Avoid calling non-buffering configurations an attribution buffer. |
| 4 | `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1/harness/cli/src/acts/doctor.ts` | Resolve/contain `--buffer` and make the act test inject a fake probe. | Prevent unexpected throws or external mutations and restore hermetic CI. |

### Domain Artifacts to Update

None.

### Handback

Fixes go back through the implement verb (same flags), then re-run this review.

---

## Round 2 — fix commit `9b30835e`

**Verdict: FIX_REQUIRED**

| Finding | Status | Evidence |
|---|---|---|
| F001 | CLOSED | `commitShasIn()` reads only the sidecar; the revert-message test proves the foreign SHA is never looked up. |
| F002 | CLOSED | Every invocation enumerates `segment-*.jsonl`; prior retained segments force `retained` with retry guidance, while the clean-directory control remains `no-buffer`. |
| F003 | NOT CLOSED | The stated prerequisite order is correct, but becomes unexecutable after the F005 containment change: after reconfiguring to `af_unix`, `resolveBuffer()` rejects the old out-of-repo file target as `buffer-refused`. |
| F004 | CLOSED | Only absolute paths classify as `file`; disabled, descriptor, and relative forms take the harness-buffered branch. |
| F005 | CLOSED WITH COUPLED DEFECT | Relative paths resolve under the repo; unsafe paths are refused and filesystem failures degrade. Its live-target containment rule causes the F003 recovery failure above. |
| F006 | CLOSED | `SocketOverrides` injects a probe into the report path; the `GIT_CONFIG_GLOBAL` test proves the fake receives the forced `af_unix` probe. |
| F007 | CLOSED | A successful commit with unreadable `HEAD` yields a degraded, non-rerunnable `shaUnknown` outcome; real Git failures still error. |

### New regression — shared file-target sidecar poisons other repositories

`globalTrace2Target()` reads a machine-global absolute file target, while
`recordBufferedSha()` appends every repository's SHA to the single
`<target>.shas` sidecar (`commit-service.ts:153-161, 306-327`). Nudge confirms
those SHAs using the current repository's `git notes`; commits from another
repository cannot be resolved there and remain missing forever. The segment is
therefore retained and reports unrelated commits as unattributed. Scope the
file-target sidecar by repository (or ignore foreign-object entries) and add a
two-repository regression test.

### Required repair

Make the post-reconfiguration file-target drain both **authorized** and
repository-scoped. The recovery identity must survive switching
`trace2.eventTarget` from `file` to `af_unix` without trusting arbitrary paths,
and a shared global target must not mix SHA confirmation sets across
repositories. Cover the composed reconfigure-then-drain path and two
repositories using one target.

### Dim-0 evidence

- Replaced the live segment's sidecar identity with `null`; the nudge suite went
  **RED** with 11 failures, including the F001 foreign-SHA regression.
- Bypassed the post-run segment enumeration; the nudge suite went **RED** with
  4 failures, including retained-segment visibility and failed-delete reporting.
- Both mutations were restored. The focused restored suite passed: 95 tests
  across nudge, ingress, commit-service, and doctor-act.

### Gate evidence

- Complete plan validation: 0 errors, 0 warnings, 0 open items.
- `just checks`: completed at the recorded non-blocking baseline: arch 2,
  markdown 196, Windows 6.

---

## Round 3 — fix commit `dbc14a07`

**Verdict: FIX_REQUIRED**

| Item | Status | Evidence |
|---|---|---|
| F003 + coupled F005 | CLOSED | The file branch records its absolute target in the repo-local `known-targets` ledger. After reconfiguration to `af_unix`, the composed test drains that target, confirms its sidecar SHA, and deletes both segment and sidecar. An unrelated `/etc/passwd` remains refused with zero renames, deletes, or relay sends even when a valid recorded target exists. `.harness/temp/` is ignored by the repository rule and by the trace2 directory's self-ignore. |
| Cross-repository tagged sidecars | CLOSED | Sidecar records are `<sha> <git-common-dir>`. The two-repository test runs both A-drains and B-drains directions: each confirms only its own SHA, never queries the foreign SHA, reports the foreign owner in `handedOff`, and deletes the completed segment. |
| F001, F002, F004, F006, F007 regression sweep | CLOSED | Restored focused suites passed: 104 tests across nudge, commit service, ingress, and doctor act. |

### Decision attacks

| Decision | Result | Review |
|---|---|---|
| Identity is git common dir | PASS | `refs/notes/ai` is shared by linked worktrees, so common-dir identity avoids falsely separating sibling worktrees. The adapter uses `--path-format=absolute`; its older-Git fallback resolves a relative result from the adapter cwd, preserving an absolute identity. |
| Delete an all-foreign segment after successful replay | PASS | This is distinct from a sidecar-less segment: every entry is explicitly tagged, known not to belong to the current repository, and relay success is required before deletion. A no-sidecar segment remains `unconfirmable` and retained. |
| Untagged entries use location | **NOT CLOSED** | `isWithin(cwd, path)` treats every sidecar physically under the repo as local. A machine-global file target may itself be located under that repo, so an untagged foreign entry in `<repo>/trace2/agent.jsonl.shas` is wrongly claimed as own, queried locally, and retained as missing. |

### New finding — F008: untagged sidecars at a global target inside a repository are misclassified

`partitionByRepo()` receives `sidecarIsRepoLocal` from a broad containment test in
`nudge.ts`. That is sound for the harness-controlled
`.harness/temp/trace2/buffer.jsonl`, but not for every path beneath the worktree:
`trace2.eventTarget` is machine-global and can legally name
`<repo>/trace2/agent.jsonl`. An older/unidentified sidecar at that target can contain
another repository's untagged SHA. The current location rule calls it ours, queries a
note that cannot exist in this repository, and retains the segment indefinitely -- the
cross-repository poisoning fixed for tagged entries reappears for the migration/fallback
format.

A temporary regression probe with an untagged foreign `SHA_B` at
`/repoA/trace2/agent.jsonl` and repo A's recorded target failed RED: expected
`replayed` plus `handedOff=[{ sha: SHA_B, repo: null }]`, received `retained`.
The temporary test was removed before the restored suite.

Restrict the local-location fallback to the harness-owned default buffer/its segment
directory, not arbitrary paths within the repository. Treat untagged entries at a
configured or recorded file target as ambiguous/global and hand them off. Add the
regression above.

### Dim-0 evidence

- Disabled the recorded-target authorization predicate; the targeted nudge set went
  **RED** with 3 failures: the composed F003 drain and both two-repository directions
  were refused.
- Replaced own-vs-foreign partitioning with `mine = false`; the targeted set went
  **RED** with 3 failures: both ownership directions lost their recovery and the
  local pre-identity control no longer confirmed.
- Both mutations were restored. No production or test modification remains from this
  review; only this review artifact is changed.

### Gates

- `node harness/cli/bin/harness.js plan validate docs/plans/074-sandbox-attribution --complete`:
  0 errors, 0 warnings, 0 open items.
- `just checks`: completed at the recorded non-blocking baseline -- arch 2,
  markdown 196, Windows 6.

---

## Round 4 — fix commit `e817f431`

**Verdict: FIX_REQUIRED**

| Item | Status | Evidence |
|---|---|---|
| F008's original in-worktree target case | CLOSED | Both `runNudge` and `inspectSegment` now call `isHarnessOwned`. The new run and enumeration regressions show an untagged foreign sidecar at `/repoA/trace2/agent.jsonl` is handed off, never queried locally, and does not retain the segment. |
| Four-way partition | NOT CLOSED | Known-own, known-foreign, unknown-at-an-ordinary-shared target, and no-sidecar all behave as specified. But the implementation adds an unproven fifth arm: untagged entries under the default harness buffer directory are presumed own solely by location. |
| F001-F007 and tagged cross-repository regression sweep | CLOSED | Restored focused suites passed: 107 tests across nudge, commit service, ingress, and doctor act. Tagged two-repository recovery continues to cover both drain directions. |

### New finding — F009: a global file target can be the default harness buffer

The F008 repair's central claim is false: Git accepts any absolute path for the global
`trace2.eventTarget`, including
`/repoA/.harness/temp/trace2/buffer.jsonl`. This review set that value in an isolated
`GIT_CONFIG_GLOBAL` and Git read it back verbatim.

Consequently, a foreign pre-identity sidecar at that configured target follows the
supposedly "harness-owned" path. A temporary regression probe seeded bare `SHA_B` beside
the default buffer, ran nudge in repo A, and expected `replayed` plus
`handedOff=[{ sha: SHA_B, repo: null }]`; it failed RED with `retained`. The implementation
queried the foreign SHA against repo A's notes, recreating F008's permanent-retention
failure at the one path the new predicate trusts most.

Path location cannot establish provenance once an operator may configure a machine-global
target to that path. Do not treat any untagged sidecar as automatically owned without a
durable provenance record. The safe repair is to classify legacy untagged entries as
ambiguous (retain explicitly or hand off only under a separately proven policy), while new
sidecars remain tagged; alternatively add a durable marker that distinguishes harness
buffer provenance before relying on automatic confirmation or deletion. Add the probe
above as a regression.

### Independent Dim-0 evidence

- Disabled the retained-segment no-sidecar classification guard; its targeted set went
  **RED** with the legacy segment changing from `unconfirmable` to `handed-off`.
- Inverted the full-confirmation delete guard; its targeted set went **RED** with 5
  failures across all-confirm, partial-retain, delayed-note, and both tagged
  two-repository directions.
- Both mutations and the temporary F009 probe were removed before the restored suite.

### Gates

- `node harness/cli/bin/harness.js plan validate docs/plans/074-sandbox-attribution --complete`:
  0 errors, 0 warnings, 0 open items.
- `just checks`: completed at the recorded non-blocking baseline -- arch 2,
  markdown 196, Windows 6.
