# Code Review: Phase 6 — Copilot-VS-Code telemetry surface (+ Amendment A4: telemetry attribution)

**Plan**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/harness-telemetry-collection-plan.md`
**Spec**: same file § `## Business Specification` (unified plan)
**Phase**: Phase 6 — Copilot-VS-Code telemetry surface (Amendment A3 reworked), **plus** Amendment A4 (telemetry commits attributable) — both landed on branch `036-copilot-vscode-telemetry`
**Date**: 2026-06-25
**Reviewer**: Automated (the review verb — 5 parallel subagents)
**Testing Approach**: Full TDD (Fake* ports, no `vi.mock`, golden fixtures)
**Diff boundary**: `git diff 1af767a..HEAD` (branch base = `main`; saved to `reviews/_computed.diff`, 22 files, +1135/−176)

## A) Verdict

**REQUEST_CHANGES**

The *implementation is sound* (clean `tsc`, 52 relevant tests green, no injection vectors, fail-safe verified, no reinvention, a genuinely strong AC-23 privacy proof). What gates the ship is **out-of-code**: a breaking governance reversal (A4) shipped without the repo's own `rules §9` paper-trail, plus publication-boundary leaks (a live session id and a real person name) into **tracked files of a public repo** — and two named-but-uncovered AC clauses. All are fast, surgical fixes.

**Key failure areas**:
- **Doctrine/governance**: Amendment A4 reverses a documented attribution gate but skips the `rules §9` version-bump / Deviation-Ledger trail; the plan still flags an unresolved P12 open question (F001).
- **Publication boundary (P12)**: a live VS Code Copilot session id (`7fb3a97f`) is committed across 5 tracked files, and a real maintainer name appears in a tracked test (F002, F006).
- **Testing**: AC-13's generic-fallback branch and AC-22's `working_ratio` derivation have no assertion (F004, F005).
- **Architecture/correctness**: `capture-service` reaches into the concrete adapter and the session id is re-resolved 3× through a *mutable* query, a real (telemetry-only) cross-session miscount under concurrent same-repo windows (F003).
- **Implementation**: clean — only one LOW correctness note (folded into F003).
- **Reinvention**: clean — appropriately reuses `DbPort`, `event-builder`, and extends `FakeDb`.

## B) Summary

Phase 6 adds a `copilot-vscode` telemetry adapter modeled faithfully on the shipped Cursor adapter: it reads the VS Code Copilot Chat SQLite store through the read-only `DbPort`, emits a turn-anchored event stream, and holds `tokens`/`models` at `null` (the honest ceiling). The privacy posture is excellent — after the companion's F001 catch, word-count/presence are computed **at the SQL boundary**, so message text never enters the process; the planted-secret control proves it at both the SQL-projection and serialization boundaries. Amendment A4 cleanly reverses the former non-individual-author forcing so telemetry commits are attributable, with a correct "fallback only when git identity is unconfigured" guard; the git plumbing is injection-safe and preserves `PATH`/credentials. The blocking issues are not in the logic: A4 is a doctrine change that bypassed `rules §9` governance, several tracked files carry a live session id, a tracked test carries a real person name, and two acceptance clauses (A4 fallback, AC-22 working-ratio) lack tests. Domain-map/registry checks are N/A (no `docs/domains/`).

## C) Checklist

**Testing Approach: Full TDD**

- [x] Tests-first / Fake* ports, no `vi.mock` (verified across the new test files)
- [x] Core validation tests present for critical paths (detection, cwd-resolution, adapter, privacy)
- [x] RED-GREEN evidence in `execution.log.md` (companion F001/F002 → `7cf0b25`)
- [ ] Every acceptance clause has a non-circular test (AC-13 fallback + AC-22 working-ratio gaps — F004, F005)
- [x] Privacy control is real and strong (AC-23 planted secret + SQL-projection assertion)

Universal:
- [x] Only in-scope files changed (all map to plan-034 Phase 6 / A4)
- [x] Type checks clean (`tsc` exit 0); 52 relevant tests pass (verified by the impl reviewer)
- [~] Doctrine compliance (P12 publication-boundary breaches — F002/F006; `rules §9` trail — F001)

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `docs/project-rules/*` (constitution.md still v1.1.1); plan § Amendment A4 | governance | A4 is a breaking attribution reversal but skips the `rules §9` version-bump / Deviation-Ledger trail; plan flags an unresolved P12 open question | Add the governance trail (version-bump the 4 rule docs **or** a Deviation-Ledger/ratification entry) and resolve the open question before ship |
| F002 | MEDIUM | retro `…001-034-copilot-vscode-telemetry.md:64`; `…-plan.md:325`; `the-flow.json:1084,1093,1108,1113`; `the-flow.md:74,77,78` | publication-boundary | Live VS Code Copilot session id `7fb3a97f` in 5 tracked files (P12: no private identifiers in tracked files) | Redact to a neutral placeholder (e.g. `<session id>`); regenerate the flow artifacts from `the-flow.json` |
| F003 | MEDIUM | `…/telemetry/capture-service.ts` (imports + `captureUnsafe`); `…/adapters/copilot-vscode-adapter.ts:142-145` | architecture / correctness | `capture-service` imports concrete `copilot-vscode` symbols (bypasses the DI `HarnessAdapter` seam); session id re-resolved 3× via a *mutable* `ORDER BY updated_at` query → cross-session miscount under concurrent same-repo windows (telemetry-only, never host) | Resolve the id **once** in `captureUnsafe`, thread it via `HarnessSource`/`HarnessContext`; fixes both the coupling and the race |
| F004 | MEDIUM | `…/test/adapters/git/exec-git-write.int.test.ts` | testing | AC-13's generic-fallback branch (unconfigured repo → `TELEMETRY_FALLBACK_AUTHOR`) has no test; only the configured-identity branch is asserted | Add an integration case with no `user.name`/`user.email`, assert author+committer = fallback identity |
| F005 | MEDIUM | `…/test/services/telemetry/copilot-vscode-events.test.ts` | testing | AC-22 derived `working_ratio` not asserted for the copilot-vscode segment (only `tokens`/`rollup.tokens` null is checked) | Serialize the segment and assert `rollup.activity.working_ratio` is present/expected |
| F006 | LOW | `…/test/adapters/git/fake-git-write.test.ts:104` | publication-boundary | Real person name `Jordan Knight` in a tracked test (`rules §1`: no person names in tracked files) | Use a neutral fake, e.g. `Example Engineer` |
| F007 | LOW | `…/src/adapters/git/git-write-port.ts:70` | publication-boundary | Vendor domain `noreply@anthropic.com` hardcoded in shipped fallback identity (pre-existing; touched by A4's rename) | Prefer a neutral project-controlled / reserved fallback (e.g. `noreply@harness-telemetry.local`) |
| F008 | LOW | `…/test/services/telemetry/capture-service.test.ts` | testing | AC-20 both-env precedence (`COPILOT_AGENT_SESSION_ID` + `AI_AGENT` → `copilot-cli`) not explicitly tested (code is correct: env chain wins before the `AI_AGENT` check) | Add a both-envs case expecting `copilot-cli` |
| F009 | LOW | `…/tasks/phase-6-copilot-vscode/execution.log.md:26` | evidence | AC-revert claim marked ✅ without a concrete schema-freeze-test reference | Cite `segment-schema.test.ts` (`pins schema_version 2.0` / frozen field set) |

## E) Detailed Findings

### E.1) Implementation Quality

The impl reviewer verified, with `tsc` clean and 52 tests passing:
- **SQL injection** — clean: `cwd`/`sessionId` are parameterized (`[cwd]`, `[sessionId]`); `NodeDb` uses `prepare(sql).all(...params)`.
- **Command injection** — clean: `spawnSync('git', args)` with an arg array (no shell); the new `config user.name`/`user.email` probes are static args.
- **Env merge** in `run()` — clean: `{ ...process.env, ...extraEnv }` preserves `PATH`/credentials; only `GIT_*` identity vars are added, and only when unconfigured.
- **A4 fallback detection** — correct: requires *both* `user.name` and `user.email` (status 0 + non-empty) or it falls back; the `!` reversal is self-consistent across all three git files; no stale `TELEMETRY_AUTHOR` refs remain.
- **Detection ordering** — correct: copilot-vscode cwd-resolution runs **before** the cursor/branch/buffer paths consume `sessionId`.
- **Fail-safe (AC-09)** — `DbPort` swallows to `[]`; `captureTelemetry` wraps everything in try/catch.
- **Word-count SQL** — coarse (overcounts on consecutive spaces, undercounts tab/newline separators) but explicitly documented as an approximate space-delimited measure — design-acknowledged, not a defect.

The one genuine code finding (**F003**): the session id is resolved by a *non-deterministic* `SELECT … ORDER BY updated_at DESC LIMIT 1` at three independent points (in `captureUnsafe`, then again in both `currentPosition` and `extract` via `sessionIdFor`). The docstring frames this as "mirroring how the Cursor adapter re-reads its env id", but Cursor re-reads a **stable** env var, whereas this re-reads a **mutable** cwd→latest mapping. Two VS Code windows on the same repo (or an `updated_at` tie) can make the three reads disagree — the buffer keyed on session S can be watermarked from turn-count(S′) and carry events from S″. Confined to telemetry accuracy under concurrent same-repo sessions; never affects the host command.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | New adapter under `services/telemetry/adapters/`; `FakeDb` under `adapters/db/`; git plumbing under `adapters/git/` |
| Contract-only / ports-only imports | ✅ | Adapter imports only `DbPort`/`EnvPort` + telemetry contracts; no `node:*` (P2 satisfied) |
| Dependency direction | ⚠️ | **F003**: `capture-service` imports concrete `COPILOT_VSCODE_*` + `resolveCopilotVscodeSessionId` from the adapter rather than going through the injected `HarnessAdapter` seam |
| Domain.md updated | N/A | No `docs/domains/` — domain governance not initialized (plan §Target Domains: conceptual only) |
| Registry current | N/A | No `docs/domains/registry.md` |
| No orphan files | ✅ | Every changed file maps to a plan-declared conceptual domain (telemetry / git / cli-kernel / docs) |
| Map nodes/edges current | N/A | No `docs/domains/domain-map.md` |
| No circular business deps | ✅ | None introduced |
| Concepts documented | N/A | No domain Concepts tables in this repo |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Location | Status |
|--------------|----------------|----------|--------|
| `copilot-vscode-adapter.ts` | Intended pattern reuse | `cursor-adapter.ts`, `event-builder.ts`, `events.ts` | ✅ reuse (peer of Cursor, shared event builder) |
| `resolveCopilotVscodeSessionId` / cwd resolver | None (genuinely new — Cursor's id is env-given) | — | ✅ proceed |
| Query-aware `FakeDb` | Extends existing `FakeDb` | `adapters/db/fake-db.ts` | ✅ extend (array/back-compat mode preserved) |
| `fallbackIdentityEnv()` (A4) | None | — | ✅ proceed (appropriate new plumbing) |

No genuine duplication.

### E.4) Testing & Evidence

**Coverage confidence**: ~78%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-20 (detection) | 85% | `capture-service.test.ts` — AI_AGENT marker; `TERM_PROGRAM=vscode`-alone negative control; copilot-cli unaffected. Gap: no both-env precedence (F008) |
| AC-21 (cwd resolution) | 95% | `capture-service.test.ts` — resolves by cwd `ORDER BY updated_at DESC`; no-row → no-op; no-db → no-op |
| AC-22 (timeline; tokens null) | 75% | `copilot-vscode-events.test.ts` — anchored ordered stream; `tokens`/`models` null. Gap: `working_ratio` not asserted (F005) |
| AC-23 (privacy) | 90% | `copilot-vscode-events.test.ts` — planted-secret serialization control **and** SQL-projection assertion (`AS words`/`AS has_response`, rejects bare raw columns). Strong, non-circular |
| AC-revert (schema 2.0) | 90% | `segment-schema.test.ts` pins 2.0 + frozen field set excludes shutdown/scope/premium_requests/code_changes. Exec-log ref missing (F009) |
| AC-13 / A4 (attribution) | 70% | `exec-git-write.int.test.ts` (configured) + `fake-git-write.test.ts`. Gap: generic-fallback-only-when-unconfigured branch untested (F004) |

Approach is faithfully Full-TDD (Fake* ports, no `vi.mock`). The removed `no-per-individual-surface.test.ts` deletion is **correct and necessary** — A4 deliberately makes `exec-git-write` read git identity, which that sensor forbade; it is replaced by a positive attribution assertion.

### E.5) Doctrine Compliance

- **Constitution P12 (Publication boundary)** is the repo's headline principle: "No private identifiers … person names … in tracked files." **F002** (live session id ×5 files) and **F006** (real person name in a test) are direct, if low-sensitivity, breaches on a *public* repo.
- **`rules §9` (Change Governance)**: "MUST route doctrine changes … with a version bump, updating `constitution.md`, `rules.md`, `idioms.md`, `architecture.md` together" and "MUST … record a Deviation Ledger entry" on a knowing principle violation. Amendment A4 reverses a documented attribution gate and updates `harness-value-measures.md` doctrine, **but** the four core rule docs were not version-bumped and no ledger entry exists; the plan still records an *unresolved* open question to the user (**F001**).
  - *Nuance (in the work's favor)*: the reversed "non-individual" constraint was never a written **constitution principle** (P12 is publication-boundary); it lived in `harness-value-measures.md` doctrine, which **was** updated to reconcile attributable *storage* with a preserved team/repo-grain *usage* norm (lines 385–396). So the substance is documented and user-ratified — the gap is the formal `rules §9` trail, not an undocumented stance.
- **P2 ports-only / P3 fakes-over-mocks**: satisfied. **F007** notes a hardcoded vendor domain in shipped source (pre-existing, surfaced by A4's rename).

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-20 | `AI_AGENT` detection + negative control | `capture-service.test.ts` | 85% |
| AC-21 | cwd session resolution, no-match no-op | `capture-service.test.ts` | 95% |
| AC-22 | turn-anchored timeline, tokens/models null | `copilot-vscode-events.test.ts` | 75% |
| AC-23 | counts/timestamps only, planted-secret control | `copilot-vscode-events.test.ts` | 90% |
| AC-revert | schema back to 2.0, v1 fields gone | `segment-schema.test.ts` | 90% |
| AC-13 / A4 | attributable commit author+committer | `exec-git-write.int.test.ts`, `fake-git-write.test.ts` | 70% |

**Overall coverage confidence**: ~78% (two named-but-uncovered AC clauses lower it).

## G) Commands Executed

```bash
git --no-pager log --oneline -20
git merge-base HEAD main                       # → 1af767a (branch base)
git --no-pager diff --stat 1af767a..HEAD
git --no-pager diff 1af767a..HEAD > reviews/_computed.diff
git --no-pager diff 1af767a..HEAD -- <each changed file>
git --no-pager show 1af767a:harness/cli/test/architecture/no-per-individual-surface.test.ts
git --no-pager grep -n "7fb3a97f"              # publication-boundary scan (tracked files)
grep -n "individual|team-level|scoreboard" docs/how/harness-value-measures.md
grep -n "doctrine change|version bump" docs/project-rules/rules.md   # rules §9
# 5 review subagents (read-only): impl-quality, domain-compliance, anti-reinvention, testing-evidence, doctrine-rules
# (impl reviewer separately confirmed: tsc exit 0; 52 relevant tests pass)
```

## H) Handover Brief

> Copy to the implementing agent. It has no context on the review — only on the work done before it.

**Review result**: REQUEST_CHANGES

**Plan**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/harness-telemetry-collection-plan.md`
**Spec**: same file § `## Business Specification`
**Phase**: Phase 6 — Copilot-VS-Code telemetry surface (+ Amendment A4)
**Tasks dossier**: inline in plan § Phase 6 (no `tasks.md` was generated for this phase)
**Execution log**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/tasks/phase-6-copilot-vscode/execution.log.md`
**Review file**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/tasks/phase-6-copilot-vscode/reviews/review.phase-6-copilot-vscode.md`
**Fix tasks**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/034-harness-telemetry-collection/tasks/phase-6-copilot-vscode/reviews/fix-tasks.phase-6-copilot-vscode.md`

### Files Reviewed

| File (absolute path) | Status | Action Needed |
|---------------------|--------|---------------|
| `…/harness/cli/src/services/telemetry/adapters/copilot-vscode-adapter.ts` | created | F003 (thread resolved sessionId) |
| `…/harness/cli/src/services/telemetry/adapters/index.ts` | modified | — |
| `…/harness/cli/src/services/telemetry/capture-service.ts` | modified | F003 (DI seam) |
| `…/harness/cli/src/adapters/db/fake-db.ts` | modified | — |
| `…/harness/cli/src/adapters/git/git-write-port.ts` | modified | F007 (vendor domain) |
| `…/harness/cli/src/adapters/git/exec-git-write.ts` | modified | — |
| `…/harness/cli/src/adapters/git/fake-git-write.ts` | modified | — |
| `…/harness/cli/test/services/telemetry/copilot-vscode-events.test.ts` | created | F005 (working_ratio) |
| `…/harness/cli/test/services/telemetry/capture-service.test.ts` | modified | F008 (both-env) |
| `…/harness/cli/test/adapters/git/exec-git-write.int.test.ts` | modified | F004 (fallback branch) |
| `…/harness/cli/test/adapters/git/fake-git-write.test.ts` | modified | F006 (person name) |
| `…/harness/cli/test/architecture/no-per-individual-surface.test.ts` | **deleted** | ✅ intentional (A4) |
| `…/docs/how/telemetry.md` | modified | — |
| `…/docs/how/harness-value-measures.md` | modified | — (A4 reconciliation present) |
| `…/docs/project-rules/*` | unchanged | F001 (governance trail) |
| `…/docs/plans/034…/harness-telemetry-collection-plan.md` | modified | F002 (session id :325) |
| `…/docs/plans/034…/the-flow.json` / `the-flow.md` | modified | F002 (session id) |
| `…/.harness/records/retro/2026-06-25/001-034-copilot-vscode-telemetry.md` | created | F002 (session id :64) |

### Required Fixes (REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | `docs/project-rules/*` + plan § Amendment A4 | Add the `rules §9` trail (version-bump the 4 rule docs **or** a Deviation-Ledger / explicit ratification entry); resolve the open P12 question | `rules §9` MUST; A4 is a breaking governance reversal |
| 2 | 5 tracked files listed in F002 | Redact the live session id `7fb3a97f`; regenerate `the-flow.*` from source | P12 publication boundary |
| 3 | `…/capture-service.ts` + `…/copilot-vscode-adapter.ts` | Resolve sessionId once, thread via `HarnessSource`/`HarnessContext` | Fixes the DI coupling **and** the cross-session miscount (F003) |
| 4 | `…/exec-git-write.int.test.ts` | Add the unconfigured-repo → fallback-identity case | Closes AC-13's named-but-untested branch |
| 5 | `…/copilot-vscode-events.test.ts` | Assert `rollup.activity.working_ratio` | Closes AC-22's derivation gap |

### Domain Artifacts to Update

| File | What's Missing |
|------|----------------|
| — | N/A — no `docs/domains/` (domain governance not initialized) |

### Handback

Fixes travel back through the **implement** verb (same flags: `--plan "…/harness-telemetry-collection-plan.md" --phase "Phase 6: Copilot-VS-Code telemetry surface"`), then re-run **review**. F001 (governance trail) and F002/F006 (publication boundary) are the ship-blockers; F003–F005 are quality/coverage; F007–F009 are notes. The implementation logic itself is clean — no rework of the adapter or git plumbing behavior is required.
