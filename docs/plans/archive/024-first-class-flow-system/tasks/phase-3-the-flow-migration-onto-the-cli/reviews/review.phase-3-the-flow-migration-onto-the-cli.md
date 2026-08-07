# Code Review: Phase 3 — `the-flow` migration onto the CLI

**Plan**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/024-first-class-flow-system/first-class-flow-system-plan.md`
**Spec**: same file, `## Business Specification` (unified plan)
**Phase**: Phase 3: the-flow migration onto the CLI (3 of 3)
**Date**: 2026-06-18
**Reviewer**: Automated (the review verb)
**Testing Approach**: Full TDD (per spec) — for this consumer-side phase: contract-snapshot re-run (vitest, in-repo) + reproducible `harness flow` smoke transcripts (the-flow is a prose skill with no test runner)

## A) Verdict

**APPROVE WITH NOTES**

Zero HIGH/CRITICAL findings. The migration is correct, complete, and verified against CLI ground truth — every documented `harness flow` command matches the real verb/flag surface, the new descriptor schema drives the full documented cadence end-to-end, the contract snapshots pass, and the deploy target is byte-identical to source. The notes below are one MEDIUM consistency item (a pre-existing invariant left unreconciled by the tighter new invariant) and a few LOW/informational polish items — none blocking.

**Key failure areas** (one sentence each):
- **Implementation**: clean — documented commands match the live CLI surface; the migrated cadence runs green against the shipped schema.
- **Domain compliance**: N/A — no `docs/domains/` registry (G7 N/A); the relevant boundary discipline (sub-skills stay flow-blind, no second schema copy, routing Graph untouched) is all satisfied.
- **Reinvention**: inverted — this phase *removes* reinvention (the-flow stops owning flow mechanics and consumes the CLI); no new duplication.
- **Testing**: strong — AC-08 snapshots green (independently re-run), every task carries a pasted transcript; the only structural gap (a prose skill has no unit suite) is inherent and mitigated by recorded smokes.
- **Doctrine**: clean — sub-skills remain harness-blind/flow-blind; the routing Graph stays prose; Envelope/`--path`-threading patterns followed.

## B) Summary

Phase 3 converts `the-flow` from the *owner* of flow mechanics (hand-cranked `the-flow.json` edits + 8 hand-written mermaid render rules) into a *consumer* of the `harness flow` CLI built in Phases 1–2. The substantive change is cross-repo: 4 files in the `the-flow` skill source (`~/github/tools/skills/SDD/the-flow/`) — `flight-plan.schema.json` re-authored into the CLI descriptor format, the `00-routing.md` § Flight-plan hand-crank cadence replaced with `harness flow` call sequences (incl. `insert-node` edge-algebra), the 8 render rules deleted in favour of a `harness flow render` pointer, and a capability/version-floor precheck + clean-break (`E308`) notes added to `SKILL.md`. In-repo, only the two AC-08 contract snapshots were re-run (no CLI edit) plus the plan dossier. I verified the core claims directly by building the CLI from HEAD and running the documented cadence against the new schema — all green. Overall quality is high; the work is reversible and honours the clean-break / mechanics-not-routing thesis.

## C) Checklist

**Testing Approach: Full TDD (consumer-side variant: snapshot gate + scripted smoke)**

Lightweight/Manual (the applicable mix for a prose skill):
- [x] Core validation tests present — AC-08 contract snapshots (`hooks-snapshot`, `flow-envelope-snapshot`) re-run green (5 tests)
- [x] Critical paths covered — full migrated cadence (create→add-node→status/set-node/comment/cursor→insert-node→render) reproduced live against the new schema
- [x] Key verification points documented — every task (T001–T007) carries a pasted argv + Envelope + exit-code transcript in the execution log

Universal:
- [x] Only in-scope files changed — 4 the-flow source files + 2 in-repo dossier files; no CLI source edited (verified)
- [x] Linters/type checks clean — `npm run build` green (gen:docs + gen:flows + tsc)
- [x] Domain/boundary checks pass — sub-skills flow-blind (0 refs), routing Graph untouched, no second schema copy in the CLI repo

## D) Findings Table

| ID | Severity | File:Lines | Category | Summary | Recommendation |
|----|----------|------------|----------|---------|----------------|
| F001 | MEDIUM | `~/github/tools/skills/SDD/the-flow/SKILL.md:86` | consistency | Invariant #7 (unchanged) instructs "record agents in `the-flow.json`", but the new invariant #6 forbids any non-`harness flow` mutation and **no `harness flow agent` verb exists** (agents[] deferred to v2). On a `--companion` flight-plan run there is no valid path to record agents. | Add a one-line carve-out to #7: agents[] recording awaits a future `harness flow agent` verb (plan 024 v2) and is not written until then. Non-blocking (narrow to companion runs; feature explicitly v2-deferred). |
| F002 | LOW | `~/github/tools/skills/SDD/the-flow/SKILL.md` § Prerequisite | docs | The "Clean break (`E308`)" bullet uses `<skill base>/references/flight-plan.schema.json` without locally defining `<skill base>` (it is defined in `00-routing.md` and `coach.md`, but not where it first appears in `SKILL.md`). | Add a parenthetical "(this skill's base dir, e.g. `~/.claude/skills/the-flow`)" on first use in `SKILL.md`. |
| F003 | LOW (informational) | `docs/plans/024-first-class-flow-system/the-flow.json` | accepted-debt | 024's own hand-cranked `the-flow.json` is now read as `E308` by the deployed CLI. | None — explicitly accepted clean-break casualty (AC-14) and documented in the T007 caveat. Noted for handover only. |
| F004 | LOW (informational) | `~/github/tools/skills/SDD/the-flow/references/flight-plan.template.md` | accepted-debt | The rendered worked example is left as static doc, not CLI-regenerated. | None — acknowledged deferred polish in the execution-log T005 note. Candidate future CLI-render-parity pass. |

## E) Detailed Findings

### E.1) Implementation Quality

**Verified correct against CLI ground truth (built from HEAD, run live):**

- **Every documented command matches the real verb/flag surface** (`harness/cli/src/acts/flow.ts`): `status --node/--to`, `set-node --node/--user-input/--note/--label`, `add-node --id/--type/--label/--status/--next`, `insert-node --id/--type/--label/--status/--after/--before/--branch-of/--rejoin`, `comment --node/--text/--source/--kind/--refs`, `cursor --to/--recommend`, `create --slug/--path/--schema/--template/--bare`, `render --path/--output/--check`. No drift, no invented flags.
- **The new descriptor schema matches the CLI exemplar exactly** — `{ kind, extends:"flow-core", schema_version, description, statuses[], nodeTypes[] }`, structurally identical to the bundled `harness-loop.schema.json`. The old JSON-Schema-draft form (which could not drive `create`) is fully replaced.
- **The full migrated cadence runs green** against the shipped schema: `create flight-plan --bare` → 3× `add-node` (spine) → `status --to done` / `set-node --user-input/--note` / `comment` / `cursor --to` → `insert-node --after` (phase-reveal) + `insert-node --branch-of --rejoin` (excursion) → `render --output`. All ok Envelopes; final flow had 5 nodes / 11 events.
- **Guards fire correctly**: out-of-repo `--path` → `E303` (write-containment); out-of-repo AND symlinked (`~/.claude/...`) `--schema` reads resolve (the actual runtime path works). The 17-node worked-example template still validates against the new descriptor.

No correctness, security, error-handling, or scope-creep issues. The one cross-cutting issue is the agents/invariant tension (F001), which is a doc-consistency gap, not a code defect.

### E.2) Domain Compliance

No `docs/domains/` registry exists in this repo → the formal domain checks are **N/A** (plan G7 N/A). The equivalent boundary discipline for this phase is verified:

| Check | Status | Details |
|-------|--------|---------|
| File placement | ✅ | All edits in the 4 declared the-flow source files; in-repo footprint is dossier + snapshot re-run only |
| Contract-only imports | N/A | No code imports — prose skill consuming the CLI via documented verb contract |
| Dependency direction | ✅ | the-flow → `harness flow` (consumer → engine); no reverse coupling; CLI unchanged |
| Domain.md updated | N/A | No domain registry |
| Registry current | N/A | No domain registry |
| No orphan files | ✅ | Every changed file maps to a Phase-3 task (T003–T007); deploy copies verified to match source |
| Map nodes current | N/A | No domain map |
| Map edges current | N/A | No domain map |
| No circular business deps | ✅ | the-flow consumes the CLI one-directionally |
| Sub-skills flow-blind (doctrine) | ✅ | `references/stages/*` carry **0** references to `harness flow` / `the-flow.json` — engine knowledge stays in `00-routing.md`/`coach.md`/`harness-seams.md` only |
| Routing Graph untouched (thesis) | ✅ | §Graph (~L101–117) absent from the diff; only § Fresh-start/Resume/Flight-plan edited |

### E.3) Anti-Reinvention

| New Component | Existing Match? | Domain | Status |
|--------------|----------------|--------|--------|
| Flight-plan descriptor schema | the-flow OWNS it; CLI shared-core (`flow-core`) supplies field shape | harness-cli·flow | ✅ proceed — no second copy in the CLI (verified via grep); single owner |
| Render delegation | `harness flow render` (Phase 2) | harness-cli·flow | ✅ reuse — 8 hand-written render rules *deleted* in favour of the CLI renderer |
| Mutation cadence | `harness flow` mutation verbs (Phase 1) | harness-cli·flow | ✅ reuse — hand-crank prose *replaced* with CLI calls |

This phase is the *opposite* of reinvention: its entire purpose is to retire the-flow's hand-rolled flow mechanics and consume the deterministic CLI engine. No new duplication introduced.

### E.4) Testing & Evidence

**Coverage confidence**: 92%

| AC | Confidence | Evidence |
|----|------------|----------|
| AC-08 | 95% | `hooks-snapshot.test.ts` + `flow-envelope-snapshot.test.ts` re-run **green (5 tests)** — independently reproduced this review. Seam mirror is a documented discipline check (T001 table), cosmetic-only delta. |
| AC-09 | 90% | Migrated cadence runs via `harness flow` only (reproduced); precheck documented in `SKILL.md` § Prerequisite + `00-routing.md`. Abort path is prose (no executable test possible in a prose skill). |
| AC-11 | 95% | Descriptor schema authored + `create --schema` returns ok (reproduced, incl. symlinked path); no schema copy in `harness-engineering` (grep-verified). |
| AC-13 | 95% | 8 render rules removed + render delegated (diff-confirmed); routing Graph untouched; `getting-started.md` swept clean. |
| AC-15 | 95% | `insert-node --after` (phase-reveal) and `--branch-of --rejoin` (excursion) both ok in live smoke; edge-algebra is engine-owned (Phase 1). |

Evidence quality is high — claims are backed by concrete pasted transcripts, and the load-bearing ones were independently reproduced here. The validate-v2 record's flagged residual (cross-repo edits unverifiable from the in-repo diff) is closed for this review: I read the the-flow source repo directly and ran the CLI against the shipped schema.

### E.5) Doctrine Compliance

Project rules (`docs/project-rules/`) bind the **CLI**, which this phase does not touch. The relevant doctrine here is the-flow's own architecture (flow-architecture pattern) + the plan's domain constraints:

- ✅ **Sub-skills stay harness-blind + flow-blind** — `references/stages/*` carry no `harness flow`/`the-flow.json` knowledge (verified, 0 refs). Engine knowledge confined to `00-routing.md`/`coach.md`/`SKILL.md`.
- ✅ **Mechanics-not-routing thesis held** — the routing Graph stays prose and untouched; only mutation/render mechanics moved to the CLI.
- ✅ **Envelope discipline + `data.path` threading** documented in the cadence; matches the Phase-1 consumer contract.
- ✅ **Clean break honoured** — `E308` legacy note added; no tolerant-load/migration prose; 024's own flow accepted as a casualty.

## F) Coverage Map

| AC | Description | Evidence | Confidence |
|----|-------------|----------|------------|
| AC-08 | Contract snapshots pass post-migration; seam mirror re-verified | 5 vitest tests green (reproduced); T001 mirror table | 95% |
| AC-09 | the-flow mutates+renders via `harness flow` only; capability abort | Cadence reproduced; precheck in SKILL.md/00-routing.md | 90% |
| AC-11 | the-flow ships+supplies flight-plan schema via `--schema`; no 2nd copy | `create --schema` ok; no copy in repo (grep) | 95% |
| AC-13 | render-rule + cadence prose deleted; render delegated; Graph untouched | Diff-confirmed; Graph absent from diff | 95% |
| AC-15 | insert-node modes map 1:1 to phase-reveal + excursions | `--after` + `--branch-of --rejoin` ok in smoke | 95% |

**Overall coverage confidence**: 92%

## G) Commands Executed

```bash
# Diff capture (cross-repo source of truth)
cd ~/github/tools && git diff -- skills/SDD/the-flow/ > <PHASE_DIR>/reviews/_computed.diff
git diff --stat -- skills/SDD/the-flow/

# Deploy parity (T007)
for f in SKILL.md references/{00-routing.md,coach.md,flight-plan.schema.json}; do
  diff -q ~/github/tools/skills/SDD/the-flow/"$f" ~/.agents/skills/the-flow/"$f"; done   # all MATCH

# Build + contract snapshots (AC-08 / T001)
cd /Users/jordanknight/substrate/harness-engineering && npm run build   # green
cd harness/cli && npx vitest run test/contract/hooks-snapshot.test.ts test/contract/flow-envelope-snapshot.test.ts   # 5 passed

# Live smoke of the migrated cadence against the shipped descriptor schema
node harness/cli/bin/harness.js flow create flight-plan --slug smoke-review --path <in-repo> --schema <the-flow>/flight-plan.schema.json --bare --json   # ok
# ... add-node x3 / status / set-node / comment / cursor / insert-node --after / insert-node --branch-of --rejoin / render  → all ok
node harness/cli/bin/harness.js flow create flight-plan ... --path /tmp/x.json ...   # E303 (write-containment, expected)
node harness/cli/bin/harness.js flow create flight-plan ... --template flight-plan.template.json --json   # ok, 17 nodes
node harness/cli/bin/harness.js flow create flight-plan ... --schema ~/.claude/skills/the-flow/.../flight-plan.schema.json --bare   # ok (symlinked path resolves)

# Completeness sweeps
grep -rnEi "hand-crank|you are the generator|Mutate the JSON" <the-flow source>   # only legit new reverse-skew prose
grep -rlE "harness flow|the-flow.json" references/stages/   # 0 files (sub-skills flow-blind)
ls docs/how/harness-flow.md   # exists (GitHub link target valid)
```

## H) Handover Brief

> Copy this section to the implementing agent. It has no context on the review — only on the work done before it.

**Review result**: APPROVE WITH NOTES (zero HIGH/CRITICAL; 1 MEDIUM + 3 LOW, none blocking)

**Plan**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/024-first-class-flow-system/first-class-flow-system-plan.md`
**Spec**: same file, `## Business Specification`
**Phase**: Phase 3: the-flow migration onto the CLI
**Tasks dossier**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/024-first-class-flow-system/tasks/phase-3-the-flow-migration-onto-the-cli/tasks.md`
**Execution log**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/024-first-class-flow-system/tasks/phase-3-the-flow-migration-onto-the-cli/execution.log.md`
**Review file**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/024-first-class-flow-system/tasks/phase-3-the-flow-migration-onto-the-cli/reviews/review.phase-3-the-flow-migration-onto-the-cli.md`
**Computed diff**: `/Users/jordanknight/substrate/harness-engineering/docs/plans/024-first-class-flow-system/tasks/phase-3-the-flow-migration-onto-the-cli/reviews/_computed.diff`

### Files Reviewed

| File (absolute path) | Status | Domain | Action Needed |
|---------------------|--------|--------|---------------|
| `~/github/tools/skills/SDD/the-flow/SKILL.md` | modified | the-flow | Optional: reconcile invariant #7 (F001) + define `<skill base>` on first use (F002) |
| `~/github/tools/skills/SDD/the-flow/references/00-routing.md` | modified | the-flow | None — cadence + render-pointer + legacy note all correct; Graph untouched |
| `~/github/tools/skills/SDD/the-flow/references/coach.md` | modified | the-flow | None — hand-crank residue removed; "regenerates both halves" lines correctly left (plan verb) |
| `~/github/tools/skills/SDD/the-flow/references/flight-plan.schema.json` | rewritten | the-flow | None — descriptor format validated against the live CLI |
| `~/.agents/skills/the-flow/{SKILL.md,references/*}` | deployed | the-flow (deploy target) | None — byte-identical to source (verified) |
| `docs/plans/024-first-class-flow-system/tasks/phase-3-.../tasks.md` | added | docs | None — dossier |
| `docs/plans/024-first-class-flow-system/tasks/phase-3-.../execution.log.md` | added | docs | None — evidence, transcripts present |

### Required Fixes (if REQUEST_CHANGES)

None — verdict is APPROVE WITH NOTES. The MEDIUM (F001) and LOW items are optional polish, safe to address in a follow-up touch to the the-flow source.

### Domain Artifacts to Update (if any)

None — no `docs/domains/` registry in this repo (G7 N/A).

### Handback

APPROVE WITH NOTES, final phase of plan 024. Implementation complete — Phases 1–3 all landed. Consider committing (the in-repo footprint is the dossier + the saved `_computed.diff` + the snapshot re-run; the substantive edits live and are deployed in the the-flow source repo). The optional F001/F002 polish can fold into a later the-flow source commit. The next flow stage would be merge.
