# Execution log — 056-dont-apologise-fix (single phase)

**Built by**: flow-pair coder (pij-1sgikx6) · **Branch**: `056-dont-apologise-fix` · **Date**: 2026-07-09

All 17 tasks (T001–T017) implemented in one dependency-ordered pass: CLI contracts
(TDD) → skill prose → proof layer. One commit per logical task; every CLI change
test-first.

## Verification sweep (T017)

- **`just fft`**: 176 test files, **2257 tests pass**; biome ✓, format ✓, windows-check ✓.
- **`just checks`** (full CI gate): hard gates all **ok** — tests · biome · typecheck ·
  check:docs · check:flows · **check:telemetry-fixtures** · **check:doctrine-parity** ·
  **skills-check** · windows-check. Two warn-launch gates degraded (non-blocking,
  **pre-existing, not from this plan**): arch-check (2 `services-ports-type-only`
  violations in `ref-source.ts`/`sync-service.ts`) and markdown-lint (incl. a
  pre-existing example mermaid at `50-phase-tasks.md:182`).

## AC checklist

| AC | Status | Evidence |
|----|--------|----------|
| AC-01 directive in all four layers | ✅ | SKILL.md invariant #14 (T006); template phase/observe lines (T008); 60-implement + 50-phase-tasks (T009); harness-seams § Why (T010) — each cites the invariant |
| AC-02 mechanical re-read | ✅ | fresh flow from the updated template → `harness flow orient --json` at `phase-1` carries "…friction is work…"; `observe-1` (the expander clone-source for observe-2..N) carries it too |
| AC-03 narrowed rule, four sites | ✅ | grep: `orchestration-blind` + `harness observe` present in SKILL.md #9, 00-routing router posture, harness-seams inversion ¶, eng-harness-flow progressive-disclosure; parity guard green |
| AC-04 dispositions first-class | ✅ | schema 1.2 (T001); drain rewrite records a disposition for every entry incl. declined/deferred (T012); flow-eval asserts declined+deferred in the record (T014) |
| AC-05 telemetry additive + private | ✅ | observe_kind + retro + disp_*/kind_* (T003); retro extractor counts-only (T004); negative snapshot proves fp/prose stay off the wire; additionalProperties:false retained |
| AC-06 insight generators | ✅ | observe_conversion + disposition_mix emit over the 2026-07 cohort, zero LLM (T005) |
| AC-07 letter codes purged | ✅ | `grep -rn "s/t/p/e/d/a" skills/builder/` empty (T011) |
| AC-08 drain rewrite | ✅ | retro.md Step 2 recommendation-led (numbered, highest-value-first, default+escape), do-it-now excursion, route→disposition map (T012); coach + harness-seams narration (T013) |
| AC-09 planted-friction eval | ✅ | scenario loads + resolvers green; friction→observe (required) + declined/deferred content assertions (T014) |
| AC-10 T+3wk re-entry | ✅ | tripwire-review.md, TW-1/2/3 + thresholds; every query executed today — TW-1 rate 18, TW-3 skip-rate 0.21 (real), TW-2 execute-only/zero at T0 (T015) |
| AC-11 token profile | ✅ | net-new skill **prose** ≈ 12 lines (channel one-liners + the one invariant); the drain-format block and the schema contract are separately accounted (both carved out by AC-11) |

## Orchestrator hand-offs

- **Flight-plan node**: the persistent `tripwire-review` excursion off `ship` is
  documented in `tripwire-review.md` with the exact `insert-node` command but NOT
  applied — `the-flow.json` is orchestrator-owned (forbidden path for this worker).

## Observations captured (dogfood)

- `DL-001` (difficulty, target plan): T005's generators needed friction-proxy +
  retro-disposition data the `TelemetryReport` didn't surface — resolved by an
  additive `ReportTotals` widening (additionalProperties:true, no version bump).
