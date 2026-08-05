# Code Review: Windows Portability for the Dogfood Verbs + a Deterministic `windows-check` Extension (Simple Mode)

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/031-windows-portability-and-check/windows-portability-and-check-plan.md
**Spec**: /Users/jordanknight/substrate/harness-engineering/docs/plans/031-windows-portability-and-check/windows-portability-and-check-plan.md § Business Specification (unified plan)
**Phase**: Simple Mode (inline tasks T001–T010)
**Date**: 2026-06-19
**Reviewer**: Automated (the review verb — 5 parallel subagents + reviewer-grounded verification)
**Testing Approach**: Lightweight + targeted unit tests (per spec § Testing Strategy)

> **Scope note (shared working tree).** This review was computed against a working tree shared with a concurrent agent editing the **flow** subsystem (`harness/cli/src/acts/flow.ts`, `harness/cli/src/services/flow/**`, `harness/cli/test/services/flow/**`, `skills/eng-harness-flow/**`, `docs/how/harness-flow.md`, `harness/cli/src/services/docs/docs-content.ts`, `agents/validate-harness-flow/**` [plan 032], `docs/retros/*-eval.md`, `scripts/score-*.sh`). All of those were **excluded**. Findings cover **only** the plan-031 manifest (29 modified + 14 new files). The scoped diff is saved at `reviews/_computed.diff`.

## A) Verdict

**APPROVE WITH NOTES**

**Zero HIGH/CRITICAL findings — not blocking.** The implementation is correct, the full vitest suite is green (952 passed), and every Acceptance Criterion (AC-01…AC-08) is functionally met. The notes below are **2 MEDIUM test-coverage gaps** (proof, not behaviour) and **6 LOW** items (dormant code-hygiene residuals + plan-document traceability drifts). None weaken a claimed safety property; the two security-critical mechanisms (the CWE-59 confine guard and the injection-safe detached spawn) are sound and adapter-tested.

**Key failure areas** (one sentence each):
- **Implementation**: Clean — injection-safety (positional argv), the detached spawn (reuses `resolveSpawn`, never a bare `.cmd`), and the CWE-59 one-op confine guard all hold; only dormant LOW residuals (a fail-closed containment over-rejection, an unclosed log fd, an un-forwarded `env`).
- **Domain compliance**: Clean — hexagonal layering, dependency direction, `adapters-stay-leaf`, and additive/optional contract surface all hold (no `docs/domains/` registry — areas by path, by design).
- **Reinvention**: Clean — `resolveSpawn`, the `Clock`/`Process`/`Fs` ports, and the arch-check scaffold are all reused, not rebuilt.
- **Testing**: AC-06 (backslash `repoName`) has no test, and the verbs' *use* of the CWE-59 guard is proven by inspection only because `FakeFs.copy` is a weaker oracle — the guard itself is well-proven at the `NodeFs` adapter level.
- **Doctrine**: Clean — P2/P3/P5/P7/P8 and PL-1 (no `npx`) all verified with file:line evidence.

## B) Summary

This Simple-mode plan adds four fakeable primitives to the verb contract (`ctx.fsWrite` write/mkdir/rename/copy/mkdtemp, `ctx.fs.realpath`, `ctx.clock.sleep`, `ctx.background.spawnDetached`), implemented in Node adapters that reuse the existing `FsPort`, `resolveSpawn`, and `Clock` abstractions; ports both dogfood verbs onto them; and ships a new repo-local `windows-check` lint verb wired into `just fft` + CI. Overall quality is high: the code keeps `node:*` strictly in adapters (zero in the verb sources), passes every user value as positional argv (no shell-injection surface), and implements the CWE-59 confine guard as a single TOCTOU-free `NodeFs.copy(src, destDir, {confineRoot})` that reads from the resolved real path. The detached spawn correctly reuses `resolveSpawn` and passes `windowsVerbatimArguments` through, so it never spawns a bare `.cmd` (which would EINVAL on patched Node). Reinvention check is clean (intended reuse confirmed). The gaps are entirely in *proof*: a missing backslash-`repoName` test against the explicit AC-06 wording, and the verbs' CWE-59 call-site wiring being unasserted because the fake doesn't model confine refusal. Three LOW code residuals (fail-closed containment over-rejection, parent log-fd leak, `env` not forwarded to the resolver on the override path) are dormant for current inputs.

## C) Checklist

**Testing Approach: Lightweight + targeted unit tests**

- [x] Core validation tests present (port fakes, Windows-shaped sensors, pure rule tests)
- [x] Critical paths covered (CWE-59 refusal at the adapter; detached spawn spec I1–I5; capture-timeout → degraded)
- [~] Key verification points documented — AC-06 backslash `repoName` and the verbs' CWE-59 call-site wiring are unasserted (MEDIUM F001/F002)
- [x] Only in-scope files changed (plan-031 manifest; flow/032 work cleanly separable)
- [~] Linters/type checks clean — `tsc --noEmit` reported clean by exec log; `biome` not installed in this review environment (could not re-verify locally; doctor `toolchain` degrades on missing biome — environmental, not plan-031)
- [x] Domain/architecture compliance checks pass (no `docs/domains/` registry → registry/map checks N/A by design)
- [x] Full vitest suite green: **952 passed (84 files)**, exit 0 (reviewer-run)
- [x] `harness windows-check --json` → `ok`, 12 scanned, 0 findings, exit 0 (reviewer-run)
- [x] `harness doctor` plan-031 layers healthy: `node-runtime`, `cli-build`, `extensions`, `instructions`, `record-types` all ok (no `EXTENSION_INSTRUCTIONS_MISSING`)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | MEDIUM | `.harness/extensions/validate-harnessability/extension.ts:42-49`, `.harness/extensions/validate-harness-flow/extension.ts:89-95` | testing | AC-06's "backslash Windows path → clean basename" is unproven — `repoName` splits on `/[/\\]/` (correct by inspection) but only a forward-slash URL is exercised in any test | Add a unit test feeding a backslash path (e.g. `C:\work\acme-repo.git` → `acme-repo`) for both verbs |
| F002 | MEDIUM | `harness/cli/src/adapters/fs/fake-fs.ts:91-108`; verb call sites | testing | The verbs' *use* of the CWE-59 guard is untested: `FakeFs.copy` never models confine refusal (weaker oracle) and no verb test asserts `copy` was called with `{confineRoot}`; a regression dropping `confineRoot` at a call site would pass every fake-driven test (the guard itself is well-proven at `NodeFs`) | Assert `fs.copies[].confineRoot` in a verb test that reaches the copy path, or give `FakeFs.copy` a seedable "resolves outside root" hook |
| F003 | LOW | `harness/cli/src/adapters/fs/node-fs.ts:73` | correctness | `rel.startsWith('..')` over-rejects an *in-tree* path whose first segment literally begins with `..` (e.g. `..foo`) — **fail-closed** (never permits an escape), dormant (no current artifact is so named) | Use `rel === '..' \|\| rel.startsWith('..' + sep) \|\| isAbsolute(rel)` (sep from `node:path`) |
| F004 | LOW | `harness/cli/src/adapters/exec/node-background.ts:34,45` | correctness | The `openSync(logPath,'a')` fd is never closed in the parent (the child keeps its own dup); leaks one fd per repo in the verbs' loop and on the throw-on-null-pid path — harmless for a one-shot CLI but a descriptor-hygiene leak | `closeSync(logFd)` in a `finally` (and before the null-pid throw) |
| F005 | LOW | `harness/cli/src/adapters/exec/node-background.ts:33` | correctness | `input.env` is not forwarded to `resolveSpawn` (5th param, defaults to `process.env`): on win32 the `.cmd`/PATH resolution would use the parent's env while the child runs with `input.env` — latent inconsistency on the override path (dormant; both callers inherit) | Pass `input.env` through: `resolveSpawn(input.command, input.args, input.cwd, this.platform, input.env)` |
| F006 | LOW | `.harness/extensions/validate-harness-flow/extension.ts` | testing | No whole-verb test for `validate-harness-flow` (only the pure `lib/worker-io.ts` helpers); its `--collect`/`--global` logic, `E_CORE_TOO_OLD` guard, and null→degraded envelope mapping are proven only by "identical swaps" parity with the sibling verb's test | Add `validate-harness-flow/extension.test.ts` mirroring the harnessability whole-verb test |
| F007 | LOW | plan § Domain Manifest / T002 / T003 | doc/traceability | Plan-document drift: `adapters/process/*` (the `nodeVersion()` port+adapter+fake) is omitted from T003's Path(s)/Manifest, and T002 names `background.ts` + "modify `node-exec.ts`" but the shipped files are the `background-port.ts`/`node-background.ts`/`fake-background.ts` triad with `node-exec.ts` untouched | Reconcile the Manifest/T002/T003 file lists with what shipped |
| F008 | LOW | `docs/plans/031-.../execution.log.md` (D2 / Companion-mode honesty) | evidence | Evidence-quality caveat: the `code-review-companion` was **blind to untracked new files** and surfaced 0 findings not because the code was reviewed clean — so evidence rests on the tests (verified green) + this review. AC-04 asserts envelope *status*, not the literal exit codes (0/0/2) | Treat the green suite + this review as the evidence; optionally assert exit codes in the AC-04 envelope test |

## E) Detailed Findings

### E.1) Implementation Quality

The security-critical mechanisms are sound (reviewer-verified by reading the sources, not just the diff):

- **Injection-safety (AC-01)** — both verbs and `lib/worker-io.ts` build every `minih`/`git` invocation as positional argv (`ctx.exec('git', [...])`, `ctx.background.spawnDetached({command:'minih', args:[...]})`). No `bash -c`, no shell-string interpolation of `url`/`dest`/`model`/slug anywhere. `repoName` sanitizes to a basename.
- **Detached spawn (AC-07)** — `NodeBackground.spawnDetached` (`node-background.ts:32-47`) reuses `resolveSpawn`, passes `windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false` (never hard-coded), opens a real append log fd (not a pipe → no EPIPE post-exit), sets `detached:true` + `unref()` + `windowsHide:true`, and throws on a null pid. It can never spawn a bare `.cmd` (workshop 001 I1–I5).
- **CWE-59 confine guard (AC-03)** — `NodeFs.copy` (`node-fs.ts:59-84`) realpaths both root and src, refuses on null (no silent skip-all), checks containment via `relative`+`startsWith('..')`+`isAbsolute`, and copies bytes **from the resolved real path** — resolve + contain + copy in one operation (no check-then-copy TOCTOU). A committed out-of-tree symlink is refused.

LOW residuals **F003** (fail-closed containment over-rejection of in-tree `..`-prefixed names), **F004** (parent log fd never closed), and **F005** (`input.env` not forwarded to `resolveSpawn` on the win32 override path) are dormant for current inputs and do not weaken any advertised safety property.

### E.2) Domain Compliance

This repo has **no `docs/domains/` registry** — domains are named by path (plan 017 convention, confirmed by the plan's G7 gate). Registry / domain-map / domain.md checks are therefore **N/A** (not failures). Architecture compliance was validated instead:

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New ports/adapters under `adapters/{exec,fs,clock,process}/`; `windows-check` under `.harness/extensions/` |
| Contract-only imports / `node:*` in adapters (P2) | ✅ | Zero `node:*` in the 5 verb production files; services use `import type` only; `node:*` confined to adapters |
| Dependency direction / `adapters-stay-leaf` | ✅ | No adapter imports `services/*`; `node-fs.ts` uses `node:path` directly (documented D1 exception) |
| Contract additions additive & optional | ✅ | `ctx.fsWrite?` (`contract.ts:83`), `ctx.background?` (`contract.ts:99`) optional; `verb-context.ts:51-52` spreads conditionally |
| Domain.md / Registry / Map current | N/A | No `docs/domains/` system in this repo (by design) |
| No orphan files | ⚠️ | All 43 files map to a task, but the plan's Manifest omits `adapters/process/*` and uses stale `background.ts`/`node-exec.ts` names (F007 — doc traceability only) |
| Concepts documented | N/A | No `docs/domains/` Concepts tables in this repo |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `NodeBackground.spawnDetached` | `resolveSpawn` (reused, not re-implemented) | `adapters/exec` | ✅ reuse |
| `NodeFs.copy`/`realpath`/`mkdtemp` | `NodeFs`/`FsPort` (extended) | `adapters/fs` | ✅ extend |
| `ctx.clock.sleep` | existing `Clock` port | `adapters/clock` | ✅ extend |
| `windows-check` extension | `arch-check`/`markdown-lint` scaffold (mirrored) | `.harness/extensions` | ✅ reuse |
| `ProcessPort.nodeVersion()` | existing `ProcessPort` | `adapters/process` | ✅ extend |

Subagent returned `[]` — no genuine duplication; the plan's "reuse, don't rebuild" thesis (Key Finding 06) is honoured.

### E.4) Testing & Evidence

**Coverage confidence**: ~80% (reviewer-run: all plan-031 test files pass; full suite 952 green).

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-01 (no shell-out/`/tmp` in verbs) | 88% | `windows-shape.test.ts:302-341` — `it.each` over the 3 real verb sources, comment-stripped, asserts no coreutil/`/tmp`/`nohup`/`node:*`; independent of the windows-check rule impl |
| AC-02 (detached survives + capture-timeout → degraded) | 76% | `validate-harnessability/extension.test.ts:44-73` (whole-verb degraded + next_action) + `worker-io.test.ts:33-47` (capture→null after 12× `ctx.clock.sleep`). Real detached survival is manual-only (documented, not silently missing). Gap: flow verb's degraded mapping untested (F006) |
| AC-03 (CWE-59 one-op confine, no realpath shell-out) | 88% | `fake-fs.test.ts:305-343` — **real `NodeFs`**, planted out-of-tree symlink → `copy(...,{confineRoot})` returns false **and nothing written**; control (no confineRoot) copies it, proving the guard refuses. Verb call-site usage by-inspection only (F002) |
| AC-04 (`windows-check --json` envelopes) | 86% | `windows-check/extension.test.ts:42-83` — clean→ok, hazard→degraded+next_action, non-repo→unconfigured. Asserts status, not literal exit codes (F008) |
| AC-05 (InMemory fakes, deterministic) | 80% | `FakeFs`/`FakeBackground`/`FakeClock.sleep` all pure; reviewer ran the suite deterministically. Deduction: `FakeFs.copy` is a weaker oracle than the real guard (F002) |
| AC-06 (`core.longpaths` + backslash `repoName`) | 56% | `core.longpaths`: asserted (`extension.test.ts:71-72`). Backslash `repoName`: **MISSING** as a test — only a `/` URL exercised (F001) |
| AC-07 (patched-22 baseline; reuse `resolveSpawn`+verbatim; no bare `.cmd`) | 92% | `engines.node >=22`; doctor `node-runtime` guard (`doctor-service.test.ts:201-225`); `node-background.test.ts` reuses real `resolveSpawn` (win32→cmd.exe+verbatim); `windows-command.test.ts` T010 regression (.cmd/.bat→cmd.exe, `windowsVerbatimArguments:true`, BatBadBut `"`-rejection) |
| AC-08 (`windows-check` in `fft`+CI; `instructions.md`) | 95% | `justfile` `fft` includes `windows-check` (via `node …/harness.js`, no npx); `ci.yml` `Windows-compat conformance` step emits `::warning`; `instructions.md` present (doctor `instructions` ok) |

### E.5) Doctrine Compliance

All cited principles verified with file:line evidence — **no violations**:
- **P2** (node:* in adapters only): holds — zero `node:*` in services/verbs.
- **P3** (platform seam): `node-background.ts:30` `constructor(platform = process.platform)` threaded to `resolveSpawn`; win32 path test-reachable on ubuntu; no `process.platform` patching.
- **P5/P7** (envelope honesty): windows-check no-git→unconfigured/exit 2, clean→ok, findings→degraded+next_action; verbs preserve capture-timeout→degraded; doctor `node-runtime` degrades (never blocks).
- **P8** (wrap-don't-rebuild): `resolveSpawn` reused; verbs reuse `ctx` ports; windows-check mirrors arch-check; one `NodeFs` backs both `fs`+`fsWrite`.
- **PL-1** (no npx): `justfile` + `ci.yml` invoke `node harness/cli/bin/harness.js windows-check`.
- **Injection idiom / extension conventions / port-node-fake naming**: all hold.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-01 | No POSIX shell-out / `/tmp` in dogfood verbs | `windows-shape.test.ts` source guard + `windows-check` ok | 88% |
| AC-02 | Detached worker survives + capture-timeout → degraded | whole-verb degraded test + `captureNewRun`→null; survival manual-only | 76% |
| AC-03 | CWE-59 confine, one op, no realpath shell-out | real-`NodeFs` planted-symlink refusal test | 88% |
| AC-04 | `windows-check --json` valid envelope | 4 envelope-state tests + 12 rule tests | 86% |
| AC-05 | InMemory fakes; deterministic on ubuntu | `FakeFs`/`FakeBackground`/`FakeClock`; suite green | 80% |
| AC-06 | `core.longpaths` + backslash `repoName` | clone flag asserted; backslash `repoName` untested | 56% |
| AC-07 | patched-22 baseline; reuse `resolveSpawn`+verbatim; no bare `.cmd` | engines + doctor guard + adapter/regression tests | 92% |
| AC-08 | `windows-check` in `fft`+CI; `instructions.md` present | justfile/ci wiring + doctor clean | 95% |

**Overall coverage confidence**: ~80% — every AC is functionally met and suite-green; the two soft spots are AC-06 (backslash test) and the verb-level CWE-59 wiring (AC-03/AC-05 cross-cut, F002).

## G) Commands Executed

```bash
# Scope resolution & diff (plan-031 files only; flow/032 excluded)
git --no-pager status; git --no-pager diff -- <plan-031 tracked manifest>
git --no-pager diff --no-index -- /dev/null <plan-031 untracked file>   # per new file → reviews/_computed.diff

# Reviewer-grounded verification
cd harness/cli && npx vitest run --reporter=dot          # 952 passed (84 files), exit 0
node harness/cli/bin/harness.js windows-check --json     # ok, scanned 12, 0 findings, exit 0
node harness/cli/bin/harness.js doctor --json            # plan-031 layers ok; toolchain degraded = missing biome (env-only)
# grep: no node:* import in the 3 dogfood verb production sources (only windows-check rule-data/tests/fixtures)
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review — only on the work done before it.

**Review result**: APPROVE WITH NOTES (zero HIGH/CRITICAL — not blocking)

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/031-windows-portability-and-check/windows-portability-and-check-plan.md
**Spec**: same file, § Business Specification (unified)
**Phase**: Simple Mode (T001–T010)
**Tasks dossier**: inline in the plan (§ Implementation › Tasks)
**Execution log**: /Users/jordanknight/substrate/harness-engineering/docs/plans/031-windows-portability-and-check/execution.log.md
**Review file**: /Users/jordanknight/substrate/harness-engineering/docs/plans/031-windows-portability-and-check/reviews/review.md
**Computed diff**: /Users/jordanknight/substrate/harness-engineering/docs/plans/031-windows-portability-and-check/reviews/_computed.diff

### Files Reviewed (plan-031 manifest)

| File (absolute path) | Status | Action Needed |
|---------------------|--------|---------------|
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/fs/fs-port.ts | modified | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/fs/node-fs.ts | modified | F003 (LOW, optional) — robust containment idiom |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/fs/fake-fs.ts | modified | F002 (MEDIUM, optional) — faithful confine oracle |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/exec/background-port.ts | new | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/exec/node-background.ts | new | F004, F005 (LOW, optional) |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/exec/fake-background.ts | new | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/exec/windows-command.ts | modified (comment only) | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/clock/{clock-port,system-clock,fake-clock}.ts | modified | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/adapters/process/{process-port,node-process,fake-process}.ts | modified | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/extensions/{contract,verb-context}.ts | modified | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/doctor/doctor-service.ts | modified | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/acts/verb.ts | modified | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/app.ts | modified | none |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/validate-harness-flow/extension.ts | modified | F006 (LOW, optional) — whole-verb test |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/validate-harness-flow/lib/worker-io.ts | modified | none |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/validate-harnessability/extension.ts | modified | F001 (MEDIUM, optional) — backslash repoName test |
| /Users/jordanknight/substrate/harness-engineering/.harness/extensions/windows-check/** (7 files) | new | none |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/test/** (8 plan-031 test files) | modified/new | none |
| /Users/jordanknight/substrate/harness-engineering/docs/how/cross-platform-verbs.md | new | none |
| /Users/jordanknight/substrate/harness-engineering/{justfile,.github/workflows/ci.yml,CHANGELOG.md} | modified | none |

### Recommended Follow-ups (all optional — none blocking)

| # | File (absolute path) | What To Do | Why |
|---|---------------------|------------|-----|
| 1 | `.harness/extensions/validate-harnessability/extension.ts` + `validate-harness-flow/extension.ts` | Add a backslash-path `repoName` unit test (`C:\work\acme-repo.git` → `acme-repo`) | Closes the AC-06 proof gap (F001) |
| 2 | `harness/cli/src/adapters/fs/fake-fs.ts` (+ a verb test) | Assert `fs.copies[].confineRoot` at a verb call site, or give `FakeFs.copy` a seedable "outside-root" refusal hook | Makes the verbs' CWE-59 wiring testable, not just by-inspection (F002) |
| 3 | `harness/cli/src/adapters/fs/node-fs.ts:73` | Switch to `rel === '..' \|\| rel.startsWith('..'+sep) \|\| isAbsolute(rel)` | Stops fail-closed over-rejection of in-tree `..`-prefixed names (F003) |
| 4 | `harness/cli/src/adapters/exec/node-background.ts` | `closeSync(logFd)` in a `finally` / before the null-pid throw | Descriptor hygiene (F004) |
| 5 | `harness/cli/src/adapters/exec/node-background.ts:33` | Forward `input.env` to `resolveSpawn` | Aligns win32 command resolution with the child's env on the override path (F005) |
| 6 | `docs/plans/031-.../windows-portability-and-check-plan.md` | Reconcile the Domain Manifest/T002/T003 file names (`process/*`, `node-background.ts` triad) | Plan-document traceability (F007) |

### Domain Artifacts to Update

None — this repo has no `docs/domains/` registry (areas named by path, by design).

### Handback

APPROVE WITH NOTES, final phase (Simple Mode, all 10 tasks complete) — **implementation is complete and suite-green**. The 2 MEDIUM items are test-coverage gaps (proof, not behaviour) and the 6 LOW items are dormant residuals / doc drift; all are optional follow-ups, none block. Consider applying follow-ups 1–2 (the AC-coverage gaps) before shipping if you want the explicit-AC proof tightened; otherwise the work is ready to commit. **Caveat**: per the exec log, the automated companion did not meaningfully review (it was blind to untracked files) — this review is the first genuine pass over the complete change set.
