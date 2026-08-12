# Code Review: Phase 1 — Windows named-pipe honesty

**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s075-windows-nudge-honesty/docs/plans/075-windows-nudge-honesty/plan.dd.json`  
**Phase**: Phase 1: Implementation  
**Date**: 2026-08-07  
**Reviewer**: `pij-uncomfortable-mosquito`  
**Base / reviewed commit**: `ab1e7e75` / `e4b2782d`

## A) Verdict

**APPROVE**

The pipe classifier precedes the absolute-path classifier, preserves real UNC
file targets, and both caller paths treat the pipe as an unverified ingress
rather than a file buffer.

## B) Summary

`TRACE2_TARGET_POLICY` makes the target-kind decision exhaustive in production
source, and commit, nudge, and at-risk consumers use it consistently. The
commit path neither overrides trace2 nor writes a sidecar or target record for
a named pipe. The nudge path is inert for pipes and for win32, while the POSIX
`af_unix` behavior remains covered. No new dependency or real external
resource is introduced; the new tests use fakes.

## C) Checklist

- [x] Named-pipe classification occurs before `ABSOLUTE_TARGET`.
- [x] Both UNC directions are covered in classifier and commit-service tests.
- [x] Known-bad pipe-like and refused inputs assert the intended rejection.
- [x] Pipe nudge asserts zero renames, zero deletes, and zero sends.
- [x] Policy exhaustiveness is enforced from `src`.
- [x] No real pipe, socket, daemon, sandbox, or network is used by new tests.
- [x] No package manifest or lockfile change.
- [x] Domain compliance: N/A (no domain mode artifacts).

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|---|---|---|---|---|---|
| — | — | — | — | No actionable findings. | — |

The managed `AGENTS.md` block's separate two-outcome wording remains the
packet's known, prime-owned convergence deferral; it is not a finding against
this diff.

## E) Detailed Findings

### E.1) Implementation Quality

No defects found. `resolveTrace2Target()` recognizes both `\\.\pipe\...` and
`\\?\pipe\...` before the absolute-path branch. `harnessCommit()` selects the
pipe's `ingress-unverified` branch with `buffer: null`, no trace2 override, no
sidecar, and no target ledger record. `telemetryNudge()` rejects the pipe before
any buffer mutation and rejects win32 before replay.

### E.2) Domain Compliance

N/A — this plan is not in domain mode and changes remain in existing collector,
commit, act, instruction, test, and documentation surfaces.

### E.3) Anti-Reinvention

No new independent transport classifier or path-policy implementation was
introduced. The shared `TRACE2_TARGET_POLICY` is consumed by the existing
services rather than duplicating target-kind logic.

### E.4) Testing & Evidence

**Coverage confidence**: 100%

| AC | Confidence | Evidence |
|---|---:|---|
| ac-0001 | 100% | Resolver table covers both pipe prefixes, case, slash style, nesting, and namespace root. |
| ac-0002 | 100% | Classifier and commit-service tests retain UNC file branch behavior. |
| ac-0003 | 100% | Six near-misses reject `named_pipe`; four values assert `unconfigured`. |
| ac-0004 | 100% | Nudge pipe suite checks named transport/platform plus zero renames/deletes/sends. |
| ac-0005 | 100% | Commit suite checks no override, no sidecar/ledger, null buffer, unverified envelope, and UNC file behavior. |
| ac-0006 | 100% | Production `satisfies Record<...>` policy and independent compiler mutation refusal. |
| ac-0007 | 100% | Documentation update, package-scope review, and fake-only tests. |

### E.5) Doctrine Compliance

The implementation stays honest about unmeasured Windows delivery: it does not
attempt a replay it cannot support or describe missing attribution as proven.

## F) Coverage Map

| Requirement | Evidence | Result |
|---|---|---|
| Classifier ordering | Mutated `WINDOWS_NAMED_PIPE` guard to `false`; targeted ingress suite failed 9 assertions, reporting `file` instead of `named_pipe`; restored. | Proven |
| Nudge inertness | Temporarily inserted `deps.fs.rename(buffer, buffer)` in the pipe branch; targeted nudge suite failed its zero-renames assertions; restored. | Proven |
| Future-kind exhaustiveness | Temporarily added `tcp_probe_only` to `Trace2Target`; `tsc` failed with TS1360 and TS7053; restored. | Proven |
| POSIX non-regression | Collector suites include the existing POSIX `af_unix` behavior and passed unchanged. | Proven |

**Overall coverage confidence**: 100%

## G) Commands Executed

```bash
# Green targeted validation after restoring every mutation
npm exec -- vitest run \
  harness/cli/test/services/doctor/collector/ingress.test.ts \
  harness/cli/test/services/doctor/collector/nudge.test.ts \
  harness/cli/test/services/commit/commit-service.test.ts --reporter=dot
npx tsc --noEmit -p harness/cli/tsconfig.json
node harness/cli/bin/harness.js windows-check --json
node harness/cli/bin/harness.js arch-check --json
harness plan validate docs/plans/075-windows-nudge-honesty/plan.dd.json --complete
node harness/cli/bin/harness.js markdown-lint --json

# Red mutation proof, each reverted before final validation
# 1. Disable named-pipe classification, then run ingress test selection.
# 2. Insert a pipe-branch rename, then run nudge test selection.
# 3. Add tcp_probe_only to Trace2Target, then run tsc.
```

The completion gate is clean. Targeted tests passed 169/169, typecheck passed,
and `windows-check`/`arch-check` remain at their pre-existing degraded counts
of 6 and 2.

### Markdown-lint baseline

The independent base-tree reconstruction for `ab1e7e75` found 131 in-scope
files and 194 markdownlint findings. The current command independently reports
194 markdownlint + 15 links + 1 mermaid = **210**. The only in-scope Markdown
file changed by this commit, `docs/how/gitai-collector.md`, has zero direct
markdownlint and remark findings. Therefore **210 is the pre-existing baseline
for this base and this diff adds zero findings**; the packet's 196 figure is
stale.

## H) Handover Brief

**Review result**: APPROVE  
**Plan**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s075-windows-nudge-honesty/docs/plans/075-windows-nudge-honesty/plan.dd.json`  
**Phase**: Phase 1: Implementation  
**Tasks dossier**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s075-windows-nudge-honesty/docs/plans/075-windows-nudge-honesty/assets/tasks/phase-1/tasks.dd.json`  
**Review file**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s075-windows-nudge-honesty/docs/plans/075-windows-nudge-honesty/assets/reviews/phase-1-review.md`

### Files Reviewed

| File | Status | Action Needed |
|---|---|---|
| `harness/cli/src/services/doctor/collector/ingress.ts` | Approved | None |
| `harness/cli/src/services/doctor/collector/nudge.ts` | Approved | None |
| `harness/cli/src/services/commit/commit-service.ts` | Approved | None |
| `harness/cli/test/services/doctor/collector/ingress.test.ts` | Approved | None |
| `harness/cli/test/services/doctor/collector/nudge.test.ts` | Approved | None |
| `harness/cli/test/services/commit/commit-service.test.ts` | Approved | None |

### Handback

Implementation is approved. No fixes are required.
