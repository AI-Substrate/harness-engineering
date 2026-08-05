# Review — 046 Phase 1: Hardened scoring + the eval-runner skill (tasks 1.0–1.5)

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 1 HIGH + 1 MED fixed → narrow re-review → orchestrator-verified)
**Mode**: flow-pair cross-model review (orchestrator = Claude Opus 4.8 `pij-4s10mb`; **coder** = Copilot **claude-opus-4.8 xhigh** `pij-hs5op`; **reviewer** = Copilot **gpt-5.5 xhigh** `pij-p943e7`, ≠ coder)
**Reviewed**: 2026-07-02 · **Target**: uncommitted diff under `.harness/extensions/flow-eval/**` + new `.claude/skills/flow-eval-run/` · **Gate**: `cd harness/cli && npx vitest run ../../.harness/extensions/flow-eval` — 51 (baseline) → **83 green** (orchestrator re-ran independently)

## What landed
- **1.0 eval-runner skill** — `.claude/skills/flow-eval-run/SKILL.md` (62 lines): thin router → `/flow-pair` (peer orchestration) + `harness flow-eval score|scaffold` + links `.harness/extensions/flow-eval/instructions.md` as authoritative; 5-beat loop sketch; one worked md-to-pdf invocation. Already discoverable in-session.
- **1.1 axis** — `ASSERTION_AXES` map (scenario.ts:128, orthogonal to proof-source lane), `axisFor()`, `Assertion.axis` stamped at load; lock-step test covers type↔axis↔resolver.
- **1.2 two-axis scorer** — `axis_scores {process, capability}` (unknown-excluded per axis); **cap consults ONLY capability+safety** (scorer.ts:151); `required_failed` = capping-axis required fails (invariant `>0 ⟺ FAIL` preserved; required process fails stay visible in rows). Back-compat single `score` kept.
- **1.3 mimicry alarm** — `process ≥ .8 && capability ≤ .4` → `alarms:['mimicry']`, gated on both axes having evidence (no false alarm on capability-free scenarios).
- **1.4 match_mode** — strict (ordered subsequence) / **superset (default)** / subset (scope-creep) / unordered (name-set equality); legacy `ordered:true → strict` honored (resolvers.ts:124); `arg_overrides` = volatile-arg tolerance (`'ignore' | regex`; bare-name back-compat) per WS003 D2 — orchestrator steered mid-build away from an optional-membership misread.
- **1.5 forbidden-state** — safety axis, fs lane, required-capable; `forbidden_glob` / `require_path|require_glob` AND-composed, fail dominates, no-params ⇒ `unknown` (never a false pass). A required trip CAPS the run.
- Report threading: `deterministic.axis_scores`, per-row axis, `alarms[]`; MD Axis column appended at line-END so old `| ✓ | A1 |` substrings still match.

## Dimension 0 — reviewer-run mutations (all named, RED→GREEN)
1. Cap consults process → RED scorer.test.ts:131 + :152. 2. Default→strict → RED resolvers.test.ts:301. 3. forbidden-present inverted → RED resolvers.test.ts:393 + scorer.test.ts:144. 4. Mimicry both-axes gate removed → RED scorer.test.ts:199. 5. **Legacy `ordered:true`→superset → survived 81 green = the HIGH** (below). 6. arg_overrides `ignore`→false → RED resolvers.test.ts:364.

## Findings (fixed → re-reviewed → orchestrator-verified)
- **F1 · HIGH · Dim-0 gap**: legacy `ordered:true → strict` (resolvers.ts:124) untested — mutation #5 survived the full gate; the live `md-to-pdf` scenario (assertions.json:16) rides that path. **Fix**: LEGACY block resolvers.test.ts:313–328 (out-of-order fails under `ordered:true`; equivalence to `match_mode:'strict'`). Re-review re-ran the mutation → **flips RED at :318 + :326**; restored. Orchestrator re-read both hunks at source — the out-of-order case genuinely discriminates strict vs superset.
- **F2 · MED · docs lied about narrowed semantics**: instructions.md:65, extension.ts:279, report.ts:114 said bare "required fail → FAIL". **Fix**: all three qualified to required **capability/safety** fails; invariant stated. Re-review confirmed.
- Scope note (adjudicated, not a finding): dirty `041/*` files predate this fleet by ~26h (mtime evidence) — concurrent-session work, not the coder's.

## Deviations accepted
- `required_failed` narrowed to capping-axis count (coder-proposed, reviewer-checked docs, orchestrator accepted — invariant preserved).
- Packet's `harness checks --quick` doesn't exist → coder ran full `harness checks` (stronger). Captured as CONF-001; plus SUGG-001: `.harness/extensions/**` has no tsconfig/biome coverage (coder hand-typechecked; follow-up candidate).

## Disposition
APPROVE recorded. Phase 1 complete: AC-01..AC-04 met with mutation-proven tests (83 green), the eval-runner skill live. Loop-layer validation (a real peer run through the new scorer) rides with Phase 2+ per the plan's Validation Strategy.
