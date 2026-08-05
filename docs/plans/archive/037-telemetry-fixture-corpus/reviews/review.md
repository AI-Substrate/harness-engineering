# Code Review: Plan 037 Telemetry Fixture Corpus (Entire Plan)

**Plan**: `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md`  
**Spec**: `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md` (`## Business Specification`)  
**Phase**: Entire plan (Phase 1 + Phase 2 + Phase 3)  
**Date**: 2026-06-25  
**Reviewer**: Automated (the review verb)  
**Testing Approach**: Hybrid  

Paths in this tracked review use `$REPO_ROOT` rather than the local absolute checkout path so the review artifact does not add another publication-boundary leak.

## A) Verdict

**REQUEST_CHANGES**

The implementation has strong adapter/golden coverage, but it still has unmitigated HIGH findings in the publication-safety and capture-path controls.

**Key failure areas**:
- **Implementation**: `--instance` is interpolated into write paths without validation, so a path-like value can escape the intended scratch/corpus roots.
- **Domain compliance**: the extension imports telemetry internals directly; accepted by the plan as dogfood topology, but it should be formalized if kept.
- **Reinvention**: fixture projection helpers intentionally mirror adapter parsing/projection logic; current tests constrain this, but future drift remains a risk.
- **Testing**: AC-07 is behaviorally proven for current fixtures, but future fixture instances can be missed because the drift guard delegates to hardcoded suites.
- **Doctrine**: tracked tests/docs/log artifacts contain real local identity/path examples outside the fixture byte-scan boundary.

## B) Summary

Plan 037 substantially delivers the intended real telemetry fixture corpus: real fixtures exist for claude, copilot-cli, copilot-vscode, and cursor; goldens and invariants exercise adapter-to-segment paths; and the runbook/governance controls are present. The highest-risk raw fixture artifacts themselves are covered by a byte-scan and the existing real artifacts did not show banned fixture markers in this review pass.

The blockers are around the surrounding tracked artifacts and capture tooling: tests/docs/logs still publish real local identifiers outside the scan boundary, and the capture extension accepts an unvalidated instance id before writing unscrubbed raw captures. There are also medium-severity maintainability and coverage-contract gaps around copilot-cli process-log handling, AC-07 drift guard enumeration, and plan-vs-script mechanism drift.

## C) Checklist

**Testing Approach: Hybrid**

Hybrid-specific:
- [x] Pure scrub/projection logic has unit coverage.
- [x] Real fixture E2E goldens exist for the four surfaces.
- [x] Raw fixture byte-scan exists with liveness checks.
- [ ] Publication-safety checks cover all tracked artifacts introduced by the plan.
- [ ] Drift guard cannot silently ignore future fixture instances.

Universal:
- [ ] Only in-scope files changed.
- [x] Linters/type checks/test evidence recorded in execution logs.
- [ ] Domain/doctrine compliance checks pass.

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `$REPO_ROOT/.harness/extensions/telemetry-fixtures/extension.ts:128-157`; `$REPO_ROOT/.harness/extensions/telemetry-fixtures/capture-logic.ts:47-53` | security | `--instance` is accepted as raw path text and used in scratch/corpus write paths. | Validate instance ids as safe slugs/basenames before any write and assert target paths remain under their roots. |
| F002 | HIGH | `$REPO_ROOT/harness/cli/test/services/telemetry/fixture-scrub.test.ts:23-94`; `$REPO_ROOT/.harness/extensions/telemetry-fixtures/capture-logic.test.ts:136-139`; `$REPO_ROOT/docs/how/telemetry-fixtures.md:115-119`; `$REPO_ROOT/.harness/records/retro/2026-06-25/002-037-telemetry-fixture-corpus.md:34-39`; `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/tasks/**/execution.log.md` | security | Tracked test/docs/log artifacts include real local identity/path examples outside the fixture scan boundary. | Replace with synthetic examples/placeholders and keep any real traceability in gitignored scratch only. |
| F003 | HIGH | `$REPO_ROOT/docs/retros/code-review-companion.md:453-516` | security | The companion-retro update records absolute local run directories/workarounds containing the local home path. | Sanitize run paths to repo-relative paths or `$REPO_ROOT` placeholders before commit. |
| F004 | MEDIUM | `$REPO_ROOT/.harness/extensions/telemetry-fixtures/extension.ts:397-402` | correctness | copilot-cli capture can succeed without producing `raw.process.log`, silently missing AC-03 token correlation for future captures. | Return `unconfigured` when no matching `assistant_usage` records are found, unless an explicit documented opt-out is added. |
| F005 | MEDIUM | `$REPO_ROOT/scripts/telemetry-fixtures.mjs:47-51` | testing | `check:telemetry-fixtures` delegates to two hardcoded suites, so a future fixture instance can be committed without any drift check coverage. | Discover fixture instances and fail on uncovered instances, or make the suites enumerate all committed instances. |
| F006 | MEDIUM | `$REPO_ROOT/scripts/telemetry-fixtures.mjs:1-35`; `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md:63,218` | scope | AC-07/task 3.1 still say the guard imports built `dist/` modules and uses the flow-fixture drift contract; the implementation instead orchestrates Vitest suites over `src/`. | Either update the plan/AC text to bless suite orchestration, or refactor the script to match the original mechanism. |
| F007 | LOW | `$REPO_ROOT/.harness/extensions/telemetry-fixtures/extension.ts:6-20` | domain | The dogfood extension imports telemetry internals/adapter helpers directly across the informal `_tooling` -> telemetry boundary. | Reclassify this extension as telemetry support or expose a small public capture contract for these imports. |
| F008 | LOW | `$REPO_ROOT/harness/cli/src/services/telemetry/fixture-extract.ts:24-55,120-184` | reinvention | New fixture projection helpers mirror logic already embedded in runtime adapters. | Keep tests pinning equivalence now; consider extracting shared helpers if this surface grows. |

## E) Detailed Findings

### E.1) Implementation Quality

#### F001 - HIGH - unvalidated `--instance` can escape write roots

`extension.ts` computes `instance` from `ctx.options.instance` and concatenates it into both `stageDir` and `corpusDir` before calling `mkdirp`/`writeText`. `NodeFs.writeText` is a direct `writeFileSync` wrapper and does not confine paths, so an instance containing `/`, `\`, or `..` can cause unscrubbed raw captures to be written outside `scratch/telemetry-fixtures` and scrubbed captures to overwrite unexpected repo paths.

Fix by validating `--instance` before any write. A safe contract is a basename slug such as `^[A-Za-z0-9][A-Za-z0-9._-]*$`, rejecting dot segments, path separators, leading dots, and empty values. Add tests covering rejected traversal values and accepted generated/default values.

#### F004 - MEDIUM - copilot-cli can promote without the process-log fixture

`resolveCopilotCli` only appends `raw.process.log` if a matching process log exists and has matching `assistant_usage` records. It otherwise returns success with `raw.events.jsonl` only. That contradicts AC-03's fixture shape and the e2e token-correlation goal for future captures.

Fix by returning `ctx.unconfigured(...)` when the process-log source or matching usage records are absent, with a `next_action` to pass `--log` or choose a session with usage data. If a no-token fixture is ever intentionally supported, make that a new explicit option and document its weaker acceptance criteria.

#### F005 - MEDIUM - current drift guard can miss future instances

`scripts/telemetry-fixtures.mjs` runs two suite filenames. Those suites currently hardcode one fixture instance per surface. The plan describes a living corpus where instances are added alongside existing ones; under the current implementation, a new directory can be committed while `npm run check:telemetry-fixtures` still passes without touching it.

Fix by making the suites enumerate `fixtures/real/<surface>/<instance>/` or by having the script discover instances and fail if no corresponding test coverage exists.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | PASS | Files mostly match the plan's informal telemetry/_tooling/_governance manifest. The companion retro update is outside the manifest but tied to the repo's minih-retro rule. |
| Contract-only imports | WARN | The extension imports telemetry internals and core `NodeDb` directly. The plan/logs acknowledge this as DL-001, but it is not a formal contract. |
| Dependency direction | WARN | `_tooling` depends inward on telemetry/core internals; acceptable as dogfood only if explicitly classified as telemetry-support or contractualized. |
| Domain.md updated | N/A | `docs/domains/` is absent; the plan explicitly did not initialize a domain registry. |
| Registry current | N/A | No `docs/domains/registry.md` exists. |
| No orphan files | WARN | Most changed files map to the manifest; `docs/retros/code-review-companion.md` is review-companion bookkeeping and carries F003. |
| Map nodes current | N/A | No domain map exists. |
| Map edges current | N/A | No domain map exists. |
| No circular business deps | N/A | No formal domain graph exists. |
| Concepts documented | N/A | No formal domain docs/contracts exist for telemetry. |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `projectCopilotVscodeRows` | `copilot-vscode-adapter.ts` `TURNS_SQL`/`readTurns` projection | telemetry | LOW note: intentional mirror, but drift-prone. |
| `filterCopilotProcessLog` | `copilot-adapter.ts` `extractJsonObjects` plus `assistant_usage` filtering | telemetry | LOW note: intentional mirror, adequately tested. |
| `projectCursorBubbleRows` | `cursor-adapter.ts` `modelHistogram`/`readBubbleTimeline` parsing | telemetry | LOW note: intentional privacy projection, adequately tested. |

### E.4) Testing & Evidence

**Coverage confidence**: 86%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-01 | 100% | Claude real fixture, golden, invariants, exact timestamp assertions in `real-capture.e2e.test.ts`; Phase 1 log records green e2e evidence. |
| AC-02 | 82% | Byte-scan covers raw/golden/invariants/meta artifacts and liveness, but publication-safety gaps remain in surrounding tracked tests/docs/logs outside that scan. |
| AC-03 | 85% | Current copilot-cli fixture has events + filtered process log and e2e token correlation; future captures can silently omit the process log (F004). |
| AC-04 | 96% | copilot-vscode row fixture plus real `node:sqlite` round-trip test through `NodeDb` and adapter SQL. |
| AC-05 | 98% | Cursor transcript + projected bubble rows plus e2e model/timing join assertions. |
| AC-06 | 92% | Extension and instructions exist; pure scrub/extract logic has tests; `--instance` safety gap remains in the extension write path. |
| AC-07 | 70% | Clean check, drift failure, npm/just/CI wiring are evidenced; mechanism and future-instance coverage have gaps (F005/F006). |
| AC-08 | 85% | Runbook documents capture/scratch/promote/manual review, but it uses real identity examples that must be sanitized. |
| AC-09 | 90% | Deviation Ledger row exists and names the right controls; related logs/docs need sanitization. |
| AC-10 | 96% | Existing synthetic fixtures are not changed in the plan diff; real fixtures are additive. |

Violations:
- HIGH: publication-safety controls do not cover all tracked artifacts introduced/updated by the plan.
- HIGH: capture write paths are not confined for user-supplied instance ids.
- MEDIUM: AC-07 check coverage is not future-proof for the living corpus model.

### E.5) Doctrine Compliance

Doctrine failures:
- P12 / publication boundary: real local identity/path examples are present in tracked tests/docs/logs (F002, F003).
- P12 / scratch safety: unvalidated `--instance` can route unscrubbed raw captures outside the intended scratch staging area (F001).
- Rules §6.3 test-doc standard: new tests use useful narrative suite comments, but not every promoted test has the exact required Test Doc fields. This is not a blocker by itself because the existing test suite is already mixed, but it should be regularized or the rule should be amended.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-01 | Real claude fixture drives adapter to golden + invariants with exact timestamps | `real-capture.e2e.test.ts`; claude fixture/golden/invariants; Phase 1 execution log | 100% |
| AC-02 | Byte-scan raw/golden bytes for banned path/identity/secret markers | `fixture-privacy-scan.test.ts`; scan evidence in logs; no artifact marker hits in review | 82% |
| AC-03 | Real copilot-cli events + process log token correlation | `raw.events.jsonl`, `raw.process.log`, copilot-cli e2e block | 85% |
| AC-04 | copilot-vscode extracted rows + real sqlite round-trip | `fixture-extract.ts`, `copilot-vscode-sqlite.int.test.ts`, real row fixture | 96% |
| AC-05 | Real cursor transcript + bubble model/timing join | cursor fixture pair, cursor e2e block, invariants | 98% |
| AC-06 | `.harness` extension + pure scrub logic + instructions | extension files, scrub/extract tests, instructions doc | 92% |
| AC-07 | `--check` drift guard wired to npm/just/CI | `scripts/telemetry-fixtures.mjs`, `package.json`, `justfile`, CI, Phase 3 log | 70% |
| AC-08 | Runbook with non-skippable manual review | `docs/how/telemetry-fixtures.md` | 85% |
| AC-09 | Deviation Ledger row | `docs/project-rules/rules.md` | 90% |
| AC-10 | Synthetic fixtures retained unchanged | diff manifest excludes existing synthetic fixture files | 96% |

**Overall coverage confidence**: 86%

## G) Commands Executed

```bash
git --no-pager status --short
git --no-pager diff --stat
git --no-pager diff --staged --stat
git --no-pager log --oneline -10
git --no-pager diff f632e18^..HEAD --binary
git --no-pager diff -- docs/retros/code-review-companion.md
git --no-pager diff --name-status f632e18^..HEAD
git --no-pager diff --name-status -- docs/retros/code-review-companion.md
git --no-pager diff --name-status f632e18^..HEAD -- harness/cli/test/services/telemetry/fixtures/claude-transcript.jsonl harness/cli/test/services/telemetry/fixtures/copilot-events.jsonl harness/cli/test/services/telemetry/fixtures/copilot-process-log.txt harness/cli/test/services/telemetry/fixtures/cursor-transcript.jsonl
wc -l docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md
find harness/cli/test/services/telemetry/fixtures -maxdepth 3 -type f
find harness/cli/test/services/telemetry/fixtures/real -type f -maxdepth 4 -print0 | xargs -0 wc -c
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts,null,2))"
grep -n "telemetry-fixtures\|check:telemetry" justfile
grep -n "telemetry-fixtures\|check:telemetry" .github/workflows/ci.yml
grep -n "scratch" .gitignore
rg "<plan/test/privacy/domain/search patterns>"
```

No source-modifying commands were run. Runtime test/build revalidation was not rerun by this review; the review inspected the implementation evidence already captured in the execution logs.

## H) Handover Brief

**Review result**: REQUEST_CHANGES

**Plan**: `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md`  
**Spec**: `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md`  
**Phase**: Entire plan  
**Tasks dossier**: `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/tasks/phase-1-foundation-claude-proof/tasks.md`; `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/tasks/phase-2-fan-out-copilot-cli-copilot-vscode-cursor/tasks.md`; `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/tasks/phase-3-operability-regeneration/tasks.md`  
**Execution log**: all three phase `execution.log.md` files under `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/tasks/`  
**Review file**: `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/reviews/review.md`  
**Computed diff**: `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/reviews/_computed.diff` (ignored scratch artifact)

### Files Reviewed

| File | Status | Domain | Action Needed |
|------|--------|--------|---------------|
| `$REPO_ROOT/.harness/extensions/telemetry-fixtures/extension.ts` | REQUEST_CHANGES | _tooling/telemetry | Fix `--instance` validation; require copilot-cli process log records. |
| `$REPO_ROOT/.harness/extensions/telemetry-fixtures/capture-logic.ts` | REQUEST_CHANGES | _tooling | Add/reuse safe instance-id helper and tests. |
| `$REPO_ROOT/.harness/extensions/telemetry-fixtures/capture-logic.test.ts` | REQUEST_CHANGES | _tooling | Sanitize real local identity examples. |
| `$REPO_ROOT/harness/cli/src/services/telemetry/fixture-scrub.ts` | APPROVE_WITH_NOTES | telemetry | No source blocker found. |
| `$REPO_ROOT/harness/cli/src/services/telemetry/fixture-extract.ts` | APPROVE_WITH_NOTES | telemetry | Consider shared extraction helpers later. |
| `$REPO_ROOT/harness/cli/test/services/telemetry/fixture-scrub.test.ts` | REQUEST_CHANGES | telemetry | Replace real local identity examples with synthetic ones. |
| `$REPO_ROOT/harness/cli/test/services/telemetry/fixture-privacy-scan.test.ts` | APPROVE_WITH_NOTES | telemetry | Good artifact scan; does not cover surrounding docs/tests. |
| `$REPO_ROOT/harness/cli/test/services/telemetry/real-capture.e2e.test.ts` | APPROVE_WITH_NOTES | telemetry | Current fixtures covered; future enumeration gap remains in script/suites. |
| `$REPO_ROOT/harness/cli/test/services/telemetry/copilot-vscode-sqlite.int.test.ts` | APPROVE | telemetry | No blocker found. |
| `$REPO_ROOT/harness/cli/test/services/telemetry/fixtures/real/**` | APPROVE_WITH_NOTES | telemetry | Existing artifacts scanned clean in review; keep manual-review discipline. |
| `$REPO_ROOT/scripts/telemetry-fixtures.mjs` | REQUEST_CHANGES | _tooling | Discover/cover future fixture instances; resolve AC-07 mechanism drift. |
| `$REPO_ROOT/docs/how/telemetry-fixtures.md` | REQUEST_CHANGES | _tooling | Sanitize real identity examples. |
| `$REPO_ROOT/docs/project-rules/rules.md` | APPROVE_WITH_NOTES | _governance | Ledger present; surrounding logs/docs need sanitization. |
| `$REPO_ROOT/.harness/records/retro/2026-06-25/002-037-telemetry-fixture-corpus.md` | REQUEST_CHANGES | _tooling | Sanitize real identity examples. |
| `$REPO_ROOT/docs/retros/code-review-companion.md` | REQUEST_CHANGES | review bookkeeping | Sanitize absolute local run paths before commit. |

### Required Fixes

| # | File | What To Fix | Why |
|---|------|-------------|-----|
| 1 | `.harness/extensions/telemetry-fixtures/extension.ts`; `.harness/extensions/telemetry-fixtures/capture-logic.ts` | Validate `--instance` as a safe basename slug before any scratch/corpus write. | Prevent path traversal and keep unscrubbed raw captures inside gitignored scratch. |
| 2 | `harness/cli/test/services/telemetry/fixture-scrub.test.ts`; `.harness/extensions/telemetry-fixtures/capture-logic.test.ts`; `docs/how/telemetry-fixtures.md`; `.harness/records/retro/**`; `docs/plans/037-telemetry-fixture-corpus/tasks/**/execution.log.md` | Replace real local identity/path examples with synthetic placeholders. | P12 publication boundary applies to all tracked artifacts, not just fixture bytes. |
| 3 | `docs/retros/code-review-companion.md` | Replace absolute local `runDir`/workaround paths with repo-relative paths/placeholders. | Avoid committing local home paths in public-facing tracked docs. |
| 4 | `.harness/extensions/telemetry-fixtures/extension.ts` | Make missing copilot-cli `assistant_usage` records an `unconfigured` result. | Future captures should not silently miss AC-03 token correlation. |
| 5 | `scripts/telemetry-fixtures.mjs`; golden suites | Ensure every committed `fixtures/real/<surface>/<instance>` directory is discovered and checked. | The corpus is meant to grow by adding instances alongside existing ones. |
| 6 | `scripts/telemetry-fixtures.mjs`; plan text | Align AC-07/task 3.1 text with the implemented suite-orchestration mechanism, or refactor the script to the original `dist`-import mechanism. | The durable plan and implementation should not contradict each other. |

### Domain Artifacts to Update

| File | What's Missing |
|------|----------------|
| `$REPO_ROOT/docs/plans/037-telemetry-fixture-corpus/telemetry-fixture-corpus-plan.md` | If keeping suite orchestration for AC-07, update AC/task text to match. |
| `$REPO_ROOT/docs/how/telemetry-fixtures.md` | Sanitize identity examples and document safe `--instance` ids after the fix. |
| `$REPO_ROOT/.harness/extensions/telemetry-fixtures/instructions.md` | Document safe `--instance` syntax after validation lands. |

### Handback

Fixes go back through the implement verb for this same plan, then re-run this review. The first re-review should confirm zero HIGH findings before considering shipment.
