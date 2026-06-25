# Validation — Phase 3 tasks dossier

**Target**: `tasks/phase-3-operability-regeneration/tasks.md` · **Revision**: working tree @ 2026-06-25 · **Verdict**: ✅ VALIDATED

## Result

✅ **VALIDATED** — no material issues.

- **Target**: `docs/plans/037-telemetry-fixture-corpus/tasks/phase-3-operability-regeneration/tasks.md`
- **Proof**: every cited target file checked live — `scripts/flow-fixtures.mjs` (drift-contract pattern source) exists; `package.json` `gen:flow-fixtures`/`check:flows` at lines 37/39; `ci.yml` runs `check:flows` after `npm run build` (lines 78/84); `rules.md` § 9 Deviation Ledger present + hand-edited (no generator references it); `instructions.md` stub (1.7 KB) + sibling extensions carry one; `.gitignore` ignores `scratch/` (line 148); `dist/services/telemetry/{adapters/index.js,segment.js}` built. Task↔plan mapping **1:1** (T001→3.1 … T006→3.6). AC coverage matches the plan's Acceptance Coverage Map: AC-07→T001/T002, AC-08→T003, AC-09→T005, AC-06→T004.
- **Thesis**: purpose met — the dossier is actionable for the `implement` verb; every task has a verifiable Done-When; the one fork (T001 regen shape) is a recommended decision, not an unresolved gap.
- **Consumers**: 1/1 satisfied (`6 implement` — next phase).

## Adjudication (one independent Primary Critic — all proposals disproven)

The critic returned six speculative items then self-closed with `no_material_findings`. Lead disprove pass:

| Critic claim | Verdict | Disproof |
|---|---|---|
| F1 `telemetry-fixtures.mjs` read-as-existing | DROPPED | Pre-Impl Check marks it **create**; confused with the read-only ref `flow-fixtures.mjs` (which does exist) |
| F2/F3 package.json/CI targets claimed pre-existing | DROPPED | Marked **modify (add)** / mirror; dossier never claims the targets exist |
| F4 T001 fork ⇒ AC-07 Done-When unverifiable | DROPPED | Done-When (`--check` clean / non-zero on drift) is **shape-independent**; a recommended fork is correct tasks practice |
| F5 `--names` git-handle lesson absent from plan | DROPPED | Prior Phase Context is sourced from **execution logs by design**; the jakkaj-leak lesson is real (Phase 1 Discovery T006) |
| F6 T003 cursor dependency ungated | DROPPED | **Phase 2 done**; `fixtures/real/cursor/2026-06-25-checks-walkthrough/` committed — dependency satisfied |

**Lens applied**: Operations (scripts/CI/wiring) + Readiness. No security/data/migration trigger beyond the already-settled privacy guards (frozen from Phases 1–2).

**Note (not a finding)**: ⚠️ the dossier carries a path correction the plan prose lacks — fixtures live at `harness/cli/test/services/telemetry/fixtures/real/`, not repo-root `fixtures/real/`. This is the dossier *correcting* stale plan prose, which is the desired direction.
