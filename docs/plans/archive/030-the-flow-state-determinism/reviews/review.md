# Code Review: Phase 1 — Drop the state file onto nav/bag (Simple Mode)

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/030-the-flow-state-determinism/the-flow-state-determinism-plan.md
**Spec**: same file, § Business Specification (unified plan)
**Phase**: Simple Mode (single phase)
**Date**: 2026-06-19
**Reviewer**: Automated (the review verb)
**Testing Approach**: Deterministic — static grep gates (AC-01..06a) + an extended `flow-skill-eval` scorer/agent harness (AC-06b/08, behavioural run deferred)

> **Cross-repo scope.** This plan's *fix* (Group A) lives in the **tools repo** skill source `~/github/tools/skills/SDD/the-flow/`; the *verification harness* (Group B) lives here in harness-engineering. The diff was computed against each repo's `HEAD` and scoped to the seven files the execution log declares. `_computed.diff` carries both halves.

## A) Verdict

**APPROVE WITH NOTES**

The state-determinism migration is real, internally near-complete, and the deterministic gates pass against live source. One **HIGH** consistency defect (F001) sits on the plan's load-bearing scenario but is mitigated (explicit-slug resume — the literal AC — still works; adoption catches it; the fix is ~2 lines). No CRITICAL findings; `--strict` not set.

**Key failure areas**:
- **Implementation**: The cold-discovery predicate (`nav.bag.status == "active"`) contradicts §6's own active signal (`nav.now` is a real non-seed node). Every live in-flight flow lacks `bag.status`, so a bare `/the-flow` and the documented `/compact` handshake will **fail to auto-discover** 026/027 (both `status:active`) — the exact regression §6 was written to prevent.
- **Testing**: The headline behavioural proof (AC-06b — a real `minih run` against the migrated source confirming no file + cold resume) is **deferred** (T-B3b); the eval fixture exercises *fresh* flows (which seed `bag.status`), so it never covers the legacy shape that exposes F001.
- **Commit boundary**: The 4 Group A files commingle plan 030 with **uncommitted** plan 035 (`merge`→`ship`/`reconcile`) edits — a clean 030-only ship boundary isn't possible from this working tree.

## B) Summary

The migration faithfully eliminates the hand-written `.the-flow-state.json`: the writer patterns are gone (grep-empty), the § State contract is rewritten to the `nav`+`bag` model, the §6 no-clobber backfill is well-reasoned (nav authoritative; `current_stage`→node lift correctly dropped), and the coach rail is repointed to derived `harness flow rail` output (verified working). Group B is clean and correct: the scorer's new GATE 6/7 use the right `.data.nav.now` JSON path (confirmed against the real CLI), the schema change is valid and additive, the prompt's cold-resume beat is faithful, and `bash -n` is clean. The one material gap is a **predicate inconsistency** between the entry-discovery/`/compact` handshake (keys on `bag.status`) and §6 (keys on `nav.now`): for the precise population of live flows the plan targets — which carry a canonical `nav.now` but no `bag.status` — bare discovery silently misses them. There is no `docs/domains/` here, so domain-compliance/anti-reinvention lenses are largely N/A; the work correctly *reuses* (not reinvents) plan 027's harness and the existing `nav`/`rail` CLI.

## C) Checklist

**Testing Approach: Deterministic (static grep + eval-harness)**

Universal (all approaches):
- [x] Only in-scope files changed (7 declared files; 2 unrelated HE files — `docs-content.ts`, `code-review-companion.md` — are out-of-scope noise, see §E.1)
- [x] Scorer syntax clean (`bash -n`); schema valid JSON; CLI paths verified against `harness 0.4.0`
- [n/a] Domain compliance — no `docs/domains/` in this repo
- [x] AC-01..06a static gates verified grep-empty / present as specified
- [ ] AC-06b behavioural (full `minih` e2e) — **deferred** (T-B3b), deploy-gated
- [~] AC-08 idempotent backfill — contract written; behavioural confirm deferred; weakened by F001 on the bare-invocation path

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | HIGH | `~/github/tools/.../references/00-routing.md:13,17` + `coach.md:351` | correctness | Entry-discovery & `/compact` handshake key on `nav.bag.status=="active"`, contradicting §6's `nav.now`-is-real signal; live flows lack `bag.status` → bare `/the-flow` misses active 026/027 | Align the discovery predicate with §6: treat a flow as active when `bag.status=="active"` **OR** (`bag.status` absent **AND** `nav.now` is a real non-seed node **AND** terminal not done) |
| F002 | MEDIUM | tools WT: `SKILL.md`, `00-routing.md`, `coach.md`, `getting-started.md` | scope | The 4 Group A files commingle 030 (state) with **uncommitted** 035 (`merge`→`ship`/`reconcile`); tools `HEAD` still has `merge` + `.the-flow-state.json` | Decide commit sequencing (035 then 030, or one combined commit) before ship/8; the working tree cannot yield a clean 030-only diff |
| F003 | MEDIUM | `execution.log.md` T-B3b; AC-06b/AC-08 | testing | Headline behavioural proof (real `minih` run, no file + cold resume) deferred; eval fixture only exercises fresh flows (which seed `bag.status`), masking F001 | Add a legacy-shaped fixture (`nav.now` real, `bag.status` absent) to the eval so cold discovery is proven on the migration's actual target population |
| F004 | LOW | plan `…-plan.md` §3 | doc | Plan documents `nav show` as `{nav:{…}, predecessors[], successors[]}`, omitting the real `{…,"data":{…}}` envelope | Note the `.data` wrapper in §3 so future readers don't drop it (the Group B code already uses `.data.nav.now` correctly) |
| F005 | LOW | `00-routing.md:69,79` (§6) | correctness | "delete the legacy `.the-flow-state.json`" is the default — but coupled to F001, the delete never runs on a bare invocation, so the stale `status:active` files (confirmed present for 026/027) linger as resurrection hazards | Resolves automatically with the F001 fix; otherwise sweep them on first resume regardless of path |

## E) Detailed Findings

### E.1) Implementation Quality

**F001 (HIGH) — discovery predicate vs §6 active-signal inconsistency.** This is the central finding. The migrated entry path globs `the-flow.json` and reads `nav.bag.status == "active"` to find resumable flows (`00-routing.md:13`); the `/compact` re-discovery handshake does the same (`coach.md:351`). But §6 (`00-routing.md:57–79`) — written *after validation* — states the active/idempotency signal is **`nav.now` being a real non-seed node**, precisely *because* "some live flows lack a bag." Empirical confirmation against this repo's live flight plans:

| Flow | `nav.now` | `nav.bag.status` | legacy `.the-flow-state.json` | Bare-`/the-flow` discovery result |
|------|-----------|------------------|-------------------------------|-----------------------------------|
| 026 | `p1` | **absent** | present, `status:active` | **MISSED** (would route to adopt/ask, not resume) |
| 027 | `review` | **absent** | present, `status:active` | **MISSED** |
| 029 | `build` | absent | present, `status:closed` | correctly inactive (right answer, wrong reason) |
| 031 | `implement` | absent | present | MISSED if active |
| 030 (this plan) | `phase-1` | `active` | — | found (the only one seeded with `bag.status`) |

The old discovery (glob `.the-flow-state.json` where `status:active`) **would** have found 026/027; the new one will not, until a *first explicit-slug resume* runs the §6 backfill that finally sets `bag.status`. So the migration introduces a **discovery regression for exactly the in-flight flows it was meant to carry forward**, on the plan's headline "survives `/compact` from one source" scenario. It is mitigated — explicit `/the-flow <slug>` skips the scan and self-heals (this is what AC-06b/§1's literal test exercises), and the 0-active branch falls through to ADOPT (no data loss) — and the fix is ~2 lines (make the predicate fall back to the §6 signal when `bag.status` is absent). Note this is a *design* inconsistency the implementation faithfully inherited: AC-03 itself encodes the buggy predicate, so AC-03 and §6 cannot both be right.

**Out-of-scope working-tree noise (not a defect, flagged for hygiene).** Two modified HE files are **unrelated** to plan 030 and should not ride this change: `harness/cli/src/services/docs/docs-content.ts` (2 single-line edits to embedded doc strings) and `docs/retros/code-review-companion.md` (appended minih retro logs from plans 024/026/027). Neither appears in the 030 execution log. They were excluded from the reviewed diff.

### E.2) Domain Compliance

| Check | Status | Details |
|-------|--------|---------|
| File placement | N/A | No `docs/domains/` in this repo; the plan declares no Domain Manifest |
| Contract-only imports | N/A | Prose + bash + JSON; no module imports |
| Dependency direction | N/A | — |
| Domain.md updated | N/A | — |
| Registry current | N/A | — |
| No orphan files | ✅ | All 7 reviewed files map to declared Group A/B tasks |
| Map nodes current | N/A | — |
| Map edges current | N/A | — |
| No circular business deps | N/A | — |
| Concepts documented | N/A | — |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| State store (`nav`+`bag`) | Reuses `harness flow nav`/`rail` CLI (plan 024/026) | — | reuse ✅ — the entire thesis is *removing* a redundant store, not adding one |
| Eval gates 6/7 | Extends plan 027's `score-flow-eval.sh` + `flow-skill-eval` | — | extend ✅ — additive gates, additive schema fields |

No reinvention. The change is net-negative surface area (deletes the hand-written file; derives `pending_command`/milestones/status that were previously stored).

### E.4) Testing & Evidence

**Coverage confidence**: ~80% (deterministic/static gates strong; behavioural e2e deferred; one design inconsistency)

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-01 (no writer patterns) | 100% | `grep -rnE "Write .the-flow-state|Create .the-flow-state|atomic rename|ONLY writer.*the-flow-state"` → empty (re-run this review) |
| AC-02 (§State is nav/bag) | 100% | `00-routing.md:83–95` is the nav/bag contract; JSON block + temp-file/atomic-rename removed |
| AC-03 (entry globs the-flow.json; resume reads nav show) | 100% impl / ⚠ design | Implemented verbatim — but the predicate it encodes is the F001 defect |
| AC-04 (rail derived; /compact→nav show; adoption read-time) | 90% | `harness flow rail` verified emitting pips; `/compact` handshake repointed (but to the F001 predicate) |
| AC-05 (getting-started drops state file) | 100% | grep: zero `.the-flow-state` refs in `getting-started.md` |
| AC-06a (static — file never authored) | 100% | grep-empty (overlaps AC-01) |
| AC-06b (behavioural — no file + cold resume) | 50% | Scorer discrimination proven on a *synthetic* fixture (migrated PASS / planted-file FAIL); full `minih` run **deferred (T-B3b)** |
| AC-08 (idempotent no-clobber backfill) | 70% | §6 contract sound; behavioural confirm rides T-B3b; F001 means backfill may not trigger on a bare invocation |

**Group B correctness (verified):** schema is valid JSON; `stateFileAbsent`/`resumeDerivedPosition` added to both `properties` and `required` (additive under `additionalProperties:true`); scorer GATE 6 (`find "$EVAL_DIR" -name '.the-flow-state.json'`) and GATE 7 (`nav show … | jq -r '.data.nav.now // empty'`) are sound — the `.data` envelope was confirmed against the real CLI output, so the JSON path is **correct** (F004 is a plan-prose nit only). `bash -n` clean.

### E.5) Doctrine Compliance

Group A edits land in the *tools* repo (outside this repo's `docs/project-rules/` governance). Group B (the only HE-governed changes) is a bash scorer + minih prompt + JSON schema: it follows the existing `ok`/`fail` gate idiom in `score-flow-eval.sh`, adds no secrets, and leaks no private identifiers (AGENTS.md publication boundary respected). No `rules.md`/`idioms.md`/`architecture.md` violations observed. Compliant.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-01/06a | File never authored | grep-empty (deterministic) | 100% |
| AC-02 | §State = nav/bag | source read | 100% |
| AC-03 | Entry/resume read switch | source read (defect: F001) | impl 100% / design ⚠ |
| AC-04 | Rail derived; handshake; adoption | `flow rail` run; source read | 90% |
| AC-05 | getting-started outputs | grep-empty | 100% |
| AC-06b | Behavioural no-file + cold resume | synthetic scorer discrimination only | 50% |
| AC-08 | Idempotent backfill | §6 contract; F001 caveat | 70% |

**Overall coverage confidence**: ~80%

## G) Commands Executed

```bash
# Diffs (scoped to the 7 declared files, per repo, vs HEAD)
git -C ~/substrate/harness-engineering diff -- scripts/score-flow-eval.sh agents/flow-skill-eval/{prompt.md,output-schema.json}
git -C ~/github/tools diff -- skills/SDD/the-flow/{SKILL.md,references/00-routing.md,references/coach.md,references/getting-started.md}

# Deterministic AC gates (tools repo)
grep -rnE "Write .the-flow-state|Create .the-flow-state|atomic rename|ONLY writer.*the-flow-state" skills/SDD/the-flow/   # empty = PASS
grep -rn "the-flow-state|milestones_|current_stage" skills/SDD/the-flow/                                                  # back-compat-only audit

# Empirical grounding (harness 0.4.0, this working tree)
node harness/cli/bin/harness.js flow nav show  --path docs/plans/030-the-flow-state-determinism/the-flow.json   # confirms .data.nav.now envelope
node harness/cli/bin/harness.js flow rail       --path docs/plans/026-the-flow-cursor-meta-migration/the-flow.json # confirms rail derivation
for f in docs/plans/*/the-flow.json; do jq -c '{now:.nav.now,bag:.nav.bag}' "$f"; done                          # F001 population check
for d in 026 027 029; do jq -c '{status,current_stage}' docs/plans/$d*/.the-flow-state.json; done               # legacy status:active confirm

# Group B validity
jq -e . agents/flow-skill-eval/output-schema.json && bash -n scripts/score-flow-eval.sh
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review — only on the work done before it.

**Review result**: APPROVE WITH NOTES

**Plan**: /Users/jordanknight/substrate/harness-engineering/docs/plans/030-the-flow-state-determinism/the-flow-state-determinism-plan.md
**Spec**: same file, § Business Specification
**Phase**: Simple Mode (single phase)
**Tasks dossier**: inline in plan (§8 Tasks)
**Execution log**: /Users/jordanknight/substrate/harness-engineering/docs/plans/030-the-flow-state-determinism/execution.log.md
**Review file**: /Users/jordanknight/substrate/harness-engineering/docs/plans/030-the-flow-state-determinism/reviews/review.md
**Computed diff**: /Users/jordanknight/substrate/harness-engineering/docs/plans/030-the-flow-state-determinism/reviews/_computed.diff

### Files Reviewed

| File (absolute path) | Status | Group | Action Needed |
|---------------------|--------|-------|---------------|
| /Users/jordanknight/github/tools/skills/SDD/the-flow/references/00-routing.md | modified | A | F001 predicate fix (L13, L17); F005 |
| /Users/jordanknight/github/tools/skills/SDD/the-flow/references/coach.md | modified | A | F001 `/compact` handshake fix (L351) |
| /Users/jordanknight/github/tools/skills/SDD/the-flow/SKILL.md | modified | A | none (F002 sequencing only) |
| /Users/jordanknight/github/tools/skills/SDD/the-flow/references/getting-started.md | modified | A | none (F002 sequencing only) |
| /Users/jordanknight/substrate/harness-engineering/scripts/score-flow-eval.sh | modified | B | F003 (add legacy-shaped fixture) |
| /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/prompt.md | modified | B | none |
| /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/output-schema.json | modified | B | none |

### Recommended Fixes (not blocking; strongly advised before deploy)

| # | File (absolute path) | What To Fix | Why |
|---|---------------------|-------------|-----|
| 1 | …/tools/…/references/00-routing.md:13,17 | Discovery: treat a flow as active when `bag.status=="active"` **OR** (`bag.status` absent **AND** `nav.now` is a real non-seed node **AND** terminal not done) | F001 — bare `/the-flow` must find the live legacy flows (026/027) that lack `bag.status`; aligns the predicate with §6 |
| 2 | …/tools/…/references/coach.md:351 | Apply the same fallback in the `/compact` re-discovery handshake | F001 — the documented post-`/compact` path is the failing one |
| 3 | …/harness-engineering/scripts/score-flow-eval.sh + agents/flow-skill-eval | Add a fixture/beat where the flight plan has `nav.now` set but **no** `bag.status`, and assert cold discovery still finds it | F003 — the current fresh-flow fixture masks F001 |
| 4 | (process) | Resolve the 030-vs-035 commit boundary before ship | F002 — the 4 Group A files carry both efforts uncommitted |

### Out-of-scope (do not ship with 030)

- /Users/jordanknight/substrate/harness-engineering/harness/cli/src/services/docs/docs-content.ts — unrelated doc-string edits
- /Users/jordanknight/substrate/harness-engineering/docs/retros/code-review-companion.md — appended minih retro logs

### Handback

Verdict is APPROVE WITH NOTES — no fix-tasks file is emitted. The notes above (esp. F001) are advisory under the plan's best-effort posture. If you choose to address F001/F003 (recommended, since they sit on the thesis scenario), the fixes go back through the **implement** verb (`--plan` unchanged, Simple Mode), then re-run this **review**. Otherwise this is the final phase — consider resolving the F002 commit boundary, then proceeding to **ship**.
