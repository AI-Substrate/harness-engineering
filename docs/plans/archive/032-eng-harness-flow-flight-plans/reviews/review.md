# Code Review: Plan 032 — eng-harness-flow flight plans (Simple Mode, single phase / groups A–D)

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md
**Spec**: same file § `## Business Specification` (unified plan)
**Phase**: Simple Mode (one phase; task groups A CLI · B skill · C evals · D docs)
**Commit reviewed**: `3e57753` — "feat(032): eng-harness-flow flight plans — adopt + loop as first-class CLI flows" (42 files, +2255/−42)
**Date**: 2026-06-19
**Reviewer**: Automated (the review verb) + 5 parallel review subagents
**Testing Approach**: Lightweight (render --check + golden fixtures + CLI vitest + 3 eval scorers)

> **Diff scope note.** The phase landed as a single clean commit `3e57753`; the working tree is dirty with **other agents' unrelated WIP** (per execution.log D-03), so this review inspects **only** `git diff 3e57753^..3e57753` (saved to `reviews/_computed.diff`). Nothing in the working tree is attributed to this phase. The review is **read-only** — no source was modified and the suite was not re-run (the dirty `harness/cli/**` WIP means a fresh `just test` would not cleanly validate this commit anyway).

## A) Verdict

**REQUEST_CHANGES**

Two unmitigated HIGH findings. The first strikes the plan's raison d'être: the **chore-injection idempotency guarantee (AC-07/AC-11/AC-13) is not met on the R-1 set-node flagging path**, and the committed run-retro explicitly records `idempotent=false` — directly contradicting the execution log's "byte-identical re-injection / ALL 5 PASS" claim. The second is a **publication-boundary + portability leak**: a shipped agent schema hardcodes a personal home/agent-harness path (`/Users/jordanknight/.claude/...`).

**Key failure areas**:
- **Implementation**: `set-node` always restamps `modified_at` + emits `node-updated`, so re-flagging an already-correct chore is **not** byte-idempotent (the documented AC-07 guarantee) — and the coexist scorer never byte-diffs it (dedup-count *proxy* only).
- **Doctrine / publication boundary**: a tracked, shipped agent default and two new retro files commit the author's personal absolute paths (`/Users/jordanknight/...`, incl. the `.claude` agent-harness location) — the repo's most-emphasized rule.
- **Testing**: AC-09's adopt dogfood probe was **deferred** (only adapted), and the run-evidence for AC-07/AC-11 is contradictory (execution.log vs committed retro); new durable tests omit the mandated Test Doc blocks.

## B) Summary

The substrate work is strong and largely on-spec: the two CLI overlays (`harness-adopt` new, `harness-loop` modernized to a 7-node acyclic spine with `retro` split + `drain-gate` decision), explicit per-node zones, golden render fixtures, the `set-node` chore/zone flag extension, three deterministic bash scorers, two new eval agents, and the skill rewrite (state-contract supersession scoped to flow position, `flight-plan-ops.md`, two-flow Graph, capability precheck) are all present and coherent. The companion's earlier BACKWARD-rejoin HIGH and one-exit drain-gate MED are genuinely fixed in the committed template + fixture. Anti-reinvention is clean (no `flow inject-chores` convenience verb — Non-Goal honored; set-node surfaces a pre-existing generic mutation; scorers follow the established `score-*.sh` pattern). The R-1 cross-repo ownership note **is** present in the tools-repo `harness-seams.md`. **However**, the central idempotency promise is unproven/false on the seam-flagging path, the execution log overstates the eval result versus the committed retro, and three new tracked artifacts violate the repo's publication boundary. These are correctable without redesign.

## C) Checklist

**Testing Approach: Lightweight**
- [x] Core validation tests present (`harness-flows.test.ts` +209; golden fixtures for both flows; envelope snapshot delta benign 5→7)
- [x] Critical paths covered by golden `render --check` fixtures (adopt spine + bridge decision `next:[]`; loop 7-node acyclic + drain-gate two outcomes + `improve.next:[]`)
- [~] Key verification points documented — **but** AC-07/AC-11 idempotency evidence is **contradictory** (execution.log "PASS/byte-identical" vs committed retro `idempotent=false`), and the scorer's idempotency gate is a dedup-count proxy, not a byte-diff
- [x] Only in-scope files changed (42 files all map to the informal domains; 2 retro docs are off-manifest — F009)
- [~] Linters/type checks clean — claimed green in execution.log (biome clean, vitest 952/952); **not independently re-run** (read-only; dirty WIP)
- [x] Domain compliance — N/A (no `docs/domains/` registry; informal manifest honored)
- [ ] Doctrine clean — **3 publication-boundary leaks** + missing Test Doc blocks + Gate-Matrix inaccuracy

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | **HIGH** | harness/cli/src/services/flow/flow-mutations.ts:451-453; skills/eng-harness-flow/references/flight-plan-ops.md (R-1 reinjection); scripts/score-flow-coexist.sh:~68-71 | correctness / test-boundary | AC-07 "byte-identical node set" idempotency is **false** on the set-node flagging path — `setNode` unconditionally restamps `modified_at` + appends `node-updated`; committed retro records `idempotent=false`; scorer Gate 2 only proxies via dedup count, never byte-diffs | Make `set-node` a no-op when `chore.kind`/`importance`/`command` already match (skip restamp+event) **or** narrow AC-07 to "dedup-idempotent (no duplicate nodes; metadata may churn)" and update plan/docs/scorer to gate the chosen guarantee; reconcile execution.log with the retro |
| F002 | **HIGH** | agents/flow-coexist-eval/input-schema.json:15 | security / pattern (publication boundary + portability) | Shipped default leaks personal home + agent-harness path: `/Users/jordanknight/.claude/skills/the-flow/references/flight-plan.schema.json` — violates constitution P12 / AGENTS.md and breaks for any other user | Replace with a neutral/relative default or resolve at runtime (e.g. `git rev-parse`); never hardcode a personal `$HOME`/`.claude` path |
| F003 | MEDIUM | docs/retros/flow-coexist-eval.md:5; docs/retros/loop-flow-eval.md:5 | pattern (publication boundary) | New tracked retros commit personal absolute `runDir` paths `/Users/jordanknight/...` | Sanitize to repo-relative; (systemic — same pattern pre-exists in other tracked retros; a repo-wide sweep is warranted) |
| F004 | MEDIUM | docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md (Gate Matrix G2/G3) | scope / process | Gate Matrix marks G2 Constitution & G3 Architecture **N/A "file does not exist"**, but both `docs/project-rules/{constitution,architecture}.md` exist; skipping the constitution gate let F002/F003 through | Correct the matrix; run G2 (catches F002/F003) and record G3 architecture as PASS (no layer violation found) |
| F005 | MEDIUM | scripts/score-flow-coexist.sh (Gate 4) | test-boundary | Gate 4 does `find "$EVAL_DIR" . -maxdepth 4 -name loop.flow.json` — scanning **repo root**; will false-fail a correct coexist run once standalone mode's **tracked** `.harness/loop.flow.json` exists (T104/D-05) | Scope the search to the eval scratch/run output, or baseline before/after and fail only on a newly-created standalone file |
| F006 | MEDIUM | agents/validate-harness-flow/** (T201); execution.log.md | evidence (AC-09) | adopt eval only **adapted** (prompt+schema gained `adoptFlow`); the full clone-onboarding dogfood probe is **deferred** — AC-09's "emits verdict + dual-layer retro" is not delivered by a run | Run the adapted probe and commit/summarize verdict+retro, or explicitly de-scope AC-09's run requirement (adopt shape is otherwise covered by tests/fixtures/CLI dogfood) |
| F007 | MEDIUM | harness/cli/test/services/flow/harness-flows.test.ts | doctrine (rules.md §6.3 / :64) | 209-line durable suite has **0** per-test Test Doc blocks (Why/Contract/Usage Notes/Quality Contribution/Worked Example) required by a documented **MUST** (good file-level docblock present, but not the per-test format) | Add Test Doc blocks to each promoted test |
| F008 | MEDIUM | docs/plans/032-eng-harness-flow-flight-plans/research-dossier.md | pattern (publication boundary wording) | Tracked text uses "internal-substrate work" / internal-source labels rather than neutral public language (AGENTS.md) | Reword to neutral public language (e.g. "a local repository/source review") |
| F009 | LOW | docs/retros/flow-coexist-eval.md; docs/retros/loop-flow-eval.md | scope (manifest hygiene) | Both retro docs ship in the commit but are absent from the plan's Domain Manifest | Add them to the manifest or note retros as an expected eval byproduct |
| F010 | LOW | scripts/score-loop-eval.sh (Gate 2) | test-boundary | Gate 2 checks key nodes + `improve.next=[]` but does not strictly assert the exact 7-node spine / full acyclicity (covered elsewhere by fixtures/tests) | Optional: tighten to assert exact spine order + absence of cycles |

## E) Detailed Findings

### E.1) Implementation Quality

**F001 (HIGH) — the idempotency guarantee is the heart of the plan, and it is not met on one of its two placement paths.**
- `harness/cli/src/services/flow/flow-mutations.ts:451-453` — `setNode` **always** runs `node.modified_at = deps.clock.nowIso()` and pushes a `node-updated` event, regardless of whether any value actually changed. The new `badChore`/`badZone` guards only *validate*; they do not short-circuit an unchanged write.
- AC-07 promises: *"Injection is therefore idempotent (re-run → byte-identical node set)."* The **add-node dedup path** (skip when a `--hook <X>` token already exists) is genuinely idempotent. The **R-1 set-node flagging path** (flag an existing the-flow seam node) is **not** — re-running it churns `modified_at` and appends events.
- This is not theoretical: the committed run-retro `docs/retros/flow-coexist-eval.md` states *"Reinjection via the skill's found-hook set-node path preserved exactly four hook chores, but it changed chore node modified_at fields, so after-first.json and reinjected.json were not byte-identical… Reported idempotent=false honestly."* The eval agent's own magicWand asks for exactly the fix above. This **contradicts** `execution.log.md` ("byte-identical re-injection (idempotent)", "ALL 5 GATES PASS").
- Compounding: `scripts/score-flow-coexist.sh` Gate 2 says *"No second snapshot → the dedup invariant from GATE 1 is the idempotency proxy"* — i.e. it **never byte-diffs** by default, so "ALL 5 PASS" did not actually prove the AC-07 guarantee.
- The eval prompt's "exact same injection commands" wording also conflicts with `flight-plan-ops.md`'s scan-dependent missing-vs-found procedure (re-running the original `insert-node` would collide on node IDs rather than exercise the found-node path) — a doc/prompt coherence gap to resolve alongside the fix.

**Otherwise clean.** No correctness, null-handling, or injection issues found in the flag-wiring (`acts/flow.ts`), the `badChore`/`badZone` guards, the templates (no dangling `--next`/`--rejoin`; `bridge.next:[]`, `improve.next:[]` acyclic), or the bash scorers (`set -euo pipefail`, `jq -e`, no shell-injection). The envelope snapshot change is benign (`node_count` 5→7 only — no contract change). The companion's BACKWARD-rejoin HIGH (`scout→governance`, `inject→build-boot`) and one-exit drain-gate MED (now two outcomes) are correctly fixed in both template and golden fixture.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | All 42 files map to the informal domains (flow-cli / eng-harness-flow-skill / eval-harness / docs) + plan artifacts |
| Contract-only imports | N/A | no `docs/domains/` registry in repo |
| Dependency direction | ✅ | CLI (`harness/cli/`) introduces no backward import from `skills/`, `agents/`, or `scripts/` |
| Domain.md updated | N/A | no registry |
| Registry current | N/A | no registry |
| No orphan files | ⚠️ | `docs/retros/{flow-coexist-eval,loop-flow-eval}.md` shipped but not in the Domain Manifest (F009) |
| Map nodes current | N/A | no map |
| Map edges current | N/A | no map |
| No circular business deps | N/A | no map |
| Concepts documented | N/A | no registry |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| `harness-adopt` overlay + template | None | flow-cli | proceed (net-new overlay) |
| modernized `harness-loop` template | None | flow-cli | proceed |
| `set-node` chore/zone flag ext | Surfaces the **pre-existing** generic `setNode` mutation (not a reimplementation) | flow-cli | proceed (legitimate gap-fill per D-01) |
| `score-{loop-eval,flow-coexist}.sh` | Follows the established `score-*.sh` pattern | eval-harness | proceed (sanctioned pattern reuse) |
| `loop-flow-eval`, `flow-coexist-eval` agents | Distinct from `validate-harness-flow` | eval-harness | proceed |

No `flow inject-chores` convenience verb was added (Non-Goal honored); no core schema reshape.

### E.4) Testing & Evidence

**Coverage confidence**: 76%.

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-01 adopt overlay | 94 | `harness-flows.test.ts` + `fixtures/render/harness-adopt.{json,md}` (spine, scout/inject `branch_of`, bridge decision `next:[]`, rail `[adopt]`) |
| AC-02 loop modernized | 86 | `harness-flows.test.ts` + `harness-loop.{json,md}` (7 nodes, retro split, drain-gate 2 outcomes, `improve.next:[]`); D-04 nuance (template is `{cursor,nodes}`, create stamps nav/provenance) |
| AC-03 zones + render parity | 92 | explicit per-node zones in fixtures; `flow-fixtures --check` (5) per log |
| AC-04 real CLI drive | 78 | `flight-plan-ops.md` precheck + verbs; fixtures prove CLI shapes; **no committed command transcript** beyond narrative |
| AC-05 first-class skill artifacts | 90 | `flight-plan-ops.md` committed; SKILL.md/00-routing.md rewrite; hooks/envelope frozen (snapshot 5→7 only) |
| AC-06 flow selection | 84 | selection predicate in SKILL.md/00-routing.md — prose/spec-level, no executable test |
| AC-07 chore injection | **62** | shape/dedup/flag-vs-add specified; set-node flag tested; **idempotency contradicted** by committed retro (F001) |
| AC-08 standalone loop | 83 | `flight-plan-ops.md` standalone path; loop-flow-eval; run artifacts absent (narrative) |
| AC-09 adopt eval | **58** | prompt+schema gained `adoptFlow`; **full clone-onboarding probe DEFERRED** (F006) |
| AC-10 loop eval | 80 | `score-loop-eval.sh` 5 gates; retro records run `…ef68`; degraded minih result; gate-2 not exact-spine (F010) |
| AC-11 coexist eval | **60** | `score-flow-coexist.sh` 5 gates; **retro says reinjection not byte-identical** (F001) |
| AC-12 CLI + docs green | 82 | `docs/how/harness-flow.md` updated; fixtures committed; vitest/biome green **claimed**, not re-run (read-only) |
| AC-13 user-facing visibility | 75 | scorer Gate 5 checks `chores` count + rail pips; lifecycle todo→done less directly proven; weakened by F001 |

**Violations**: idempotency evidence contradiction (HIGH → F001); adopt eval deferred (MED → F006); both eval runs `degraded` on minih 0.2.2 with run artifacts absent (LOW — treating as non-blocking is defensible given deterministic scorers, but evidence rests on narrative + retros).

### E.5) Doctrine Compliance

`docs/project-rules/{constitution,architecture,idioms,rules}.md` **all exist** (the plan's Gate Matrix wrongly says constitution/architecture do not — F004).
- **constitution.md P12 / AGENTS.md publication boundary**: violated by F002 (shipped `/Users/jordanknight/.claude/...` default) and F003 (retro `runDir` personal paths); F008 (non-neutral "internal-substrate" wording). This repo is explicitly public-facing — these are first-class rule breaches.
- **architecture.md**: no layer-boundary violation in `acts/flow.ts` / `flow-mutations.ts` changes (acts→services respected). ✅
- **idioms.md**: relative `src` imports keep `.js` extensions; scorers use `#!/usr/bin/env bash`. ✅
- **rules.md §6.3 (:64)**: F007 — new durable tests omit the mandated per-test Test Doc blocks.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-01 | adopt overlay | test + golden fixture | 94% |
| AC-02 | loop modernized | test + golden fixture | 86% |
| AC-03 | zones + render parity | fixtures + `--check` | 92% |
| AC-04 | real CLI drive | flight-plan-ops + fixtures (narrative transcript) | 78% |
| AC-05 | first-class skill artifacts | committed skill docs | 90% |
| AC-06 | flow selection | spec-level predicate | 84% |
| AC-07 | chore injection (idempotent) | **contradicted (F001)** | 62% |
| AC-08 | standalone loop | flight-plan-ops + eval (narrative) | 83% |
| AC-09 | adopt eval | **deferred run (F006)** | 58% |
| AC-10 | loop eval | scorer 5 gates + retro | 80% |
| AC-11 | coexist eval | **retro: not byte-identical (F001)** | 60% |
| AC-12 | CLI + docs green | doc + fixtures + claimed suite | 82% |
| AC-13 | user-facing visibility | scorer Gate 5 (chores + rail pips) | 75% |

**Overall coverage confidence**: 76%.

## G) Commands Executed

```bash
# scope resolution + diff capture
git --no-pager show -s --format='%H %an <%ae> %s' 3e57753
git --no-pager show --stat 3e57753
git --no-pager diff 3e57753^..3e57753 > docs/plans/032-eng-harness-flow-flight-plans/reviews/_computed.diff
# crux verifications (read-only)
git --no-pager show 3e57753:harness/cli/src/services/flow/flow-mutations.ts   # setNode restamp (451-453)
git --no-pager show 3e57753:docs/retros/flow-coexist-eval.md                  # idempotent=false
git --no-pager grep -n -e "/Users/jordanknight" -e ".claude/skills" 3e57753 -- agents/ docs/retros/ ...
git --no-pager show 3e57753:scripts/score-flow-coexist.sh                     # Gate 2 proxy / Gate 4 repo-root scan
grep -n "Test Doc\|Worked Example" docs/project-rules/rules.md                # rules.md:64 MUST
ls ~/github/tools/skills/SDD/the-flow/references/harness-seams.md             # R-1 cross-repo note present
# NOTE: vitest / scorers NOT executed — review is read-only; dirty WIP would taint a fresh run
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review —
> only context on the work that was done before the review.

**Review result**: REQUEST_CHANGES

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md
**Spec**: same file § `## Business Specification`
**Phase**: Simple Mode (groups A–D)
**Tasks dossier**: inline in plan (§ Implementation → #### Tasks, T001–T301)
**Execution log**: /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/execution.log.md
**Review file**: /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/reviews/review.md
**Fix tasks**: /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/reviews/fix-tasks.md
**Computed diff**: /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/reviews/_computed.diff

### Files Reviewed (selected; full set = 42 files in `3e57753`)

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/flow/flow-mutations.ts | modified | flow-cli | **F001** — make set-node no-op on unchanged chore fields (or re-scope AC-07) |
| /Users/jordanknight/substrate/harness-engineering/skills/eng-harness-flow/references/flight-plan-ops.md | modified | skill | **F001** — align R-1 reinjection procedure with the idempotency guarantee |
| /Users/jordanknight/substrate/harness-engineering/scripts/score-flow-coexist.sh | new | eval-harness | **F001** byte-diff gate; **F005** Gate-4 repo-root scan |
| /Users/jordanknight/substrate/harness-engineering/agents/flow-coexist-eval/input-schema.json | new | eval-harness | **F002** — remove personal `/Users/.../.claude/...` default |
| /Users/jordanknight/substrate/harness-engineering/docs/retros/flow-coexist-eval.md | new | (off-manifest) | **F003** sanitize runDir; **F009** manifest |
| /Users/jordanknight/substrate/harness-engineering/docs/retros/loop-flow-eval.md | new | (off-manifest) | **F003** sanitize runDir; **F009** manifest |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md | new | plan | **F004** Gate Matrix G2/G3; reconcile AC-07 wording with F001 |
| /Users/jordanknight/substrate/harness-engineering/harness/cli/test/services/flow/harness-flows.test.ts | new | flow-cli | **F007** add Test Doc blocks |
| /Users/jordanknight/substrate/harness-engineering/agents/validate-harness-flow/prompt.md | modified | eval-harness | **F006** run the deferred adopt probe or de-scope AC-09 |
| /Users/jordanknight/substrate/harness-engineering/docs/plans/032-eng-harness-flow-flight-plans/research-dossier.md | new | plan | **F008** neutralize "internal-substrate" wording |
| /Users/jordanknight/substrate/harness-engineering/scripts/score-loop-eval.sh | new | eval-harness | **F010** (optional) tighten Gate 2 |

### Required Fixes (REQUEST_CHANGES)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | harness/cli/src/services/flow/flow-mutations.ts (+ flight-plan-ops.md, score-flow-coexist.sh) | Make `setNode` a no-op when `chore.kind`/`importance`/`command` already match (no restamp/event) **or** re-scope AC-07 to "dedup-idempotent (timestamps may churn)" and add a real byte-diff gate; reconcile execution.log with the `idempotent=false` retro | F001 — the plan's core guarantee is false-as-written and ungated |
| 2 | agents/flow-coexist-eval/input-schema.json:15 | Remove the `/Users/jordanknight/.claude/...` default; use a neutral/relative/runtime-resolved value | F002 — publication boundary + non-portable |
| 3 | docs/retros/{flow-coexist-eval,loop-flow-eval}.md | Sanitize `runDir` personal paths to repo-relative | F003 |
| 4 | docs/plans/032-.../eng-harness-flow-flight-plans-plan.md | Correct Gate Matrix G2/G3 (constitution/architecture DO exist); run the constitution gate | F004 |
| 5 | scripts/score-flow-coexist.sh (Gate 4) | Scope the `loop.flow.json` search to the eval run output (not repo root) | F005 |
| 6 | agents/validate-harness-flow/** | Run the adapted adopt probe + commit verdict/retro, or explicitly de-scope AC-09 | F006 |
| 7 | harness/cli/test/services/flow/harness-flows.test.ts | Add per-test Test Doc blocks (rules.md §6.3) | F007 |
| 8 | docs/plans/032-.../research-dossier.md | Neutralize "internal-substrate" wording | F008 |

### Domain Artifacts to Update (if any)

| File (absolute path) | What's Missing |
|---------------------|----------------|
| docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md (Domain Manifest) | Add `docs/retros/{flow-coexist-eval,loop-flow-eval}.md` (F009) |

### Handback

REQUEST_CHANGES: fixes go back through the implement verb (same flags: `--plan "docs/plans/032-eng-harness-flow-flight-plans/eng-harness-flow-flight-plans-plan.md"`), then re-run this review. Priority order: F001 (idempotency) and F002 (path leak) are blocking; F003–F008 should land in the same pass; F009/F010 are optional polish.
