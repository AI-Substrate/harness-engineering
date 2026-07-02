# Review — 046 Phase 3: Judge hardening (tasks 3.1–3.3)

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 1 MED fixed → narrow re-review → orchestrator-verified)
**Mode**: flow-pair cross-model (orchestrator Claude Opus 4.8 `pij-4s10mb`; coder Copilot claude-opus-4.8 `pij-hs5op`; reviewer Copilot gpt-5.5 `pij-p943e7`)
**Reviewed**: 2026-07-02 · **Gates**: extension 132 green · full CLI **1874** green · `just build` clean

## What landed (AC-09)
- **3.1** `judged` decomposed into independent `JudgedField`s — `plan-coherence`, `report-contract-coverage`, `explanation-matches-telemetry` (scorer.ts:109-139; report JSON+MD surface criterion/prompt/rubric/verdict); legacy single-field judged kept for scenarios without `scenario.json#judge` (still structurally uncappable).
- **3.2** Judge config provenance: model+version, **different-family-than-subject** check (same family ⇒ visible report warning, never a crash), artifact-only, identity-stripped, temp-0, version-pinned, anti-verbosity — recorded in report + RunRecord (additive, schema round-trip holds). `judged.required=true` rejected at load (scenario.ts:450).
- **3.3** CoT-before-score prompt scaffold + canonical good-flow **anchor slot** (content deferred, named `human-gold-calibration-set-deferred`); scaffold verb emits the hardened config.

## The invariant, proven structural
The reviewer's smuggling attempt failed: judged routes into `judged[]` **before** resolver/cap math (scorer.ts:167); `required_failed` increments only on deterministic capability/safety fails (scorer.ts:193). Direct mutation (judged→requiredFailed) flipped RED at scorer.test.ts:124.

## Dim-0 (reviewer-run, restored)
Cap-consults-judged → RED scorer.test.ts:124 · same-family-warning stripped → RED extension.test.ts:181 + report.test.ts:152 · criterion dropped from JSON → RED extension.test.ts:150 + report.test.ts:106 · **artifact-only prompt weakened → GREEN = the finding**.

## Finding (fixed → re-reviewed)
- **F1 · MED · Dim-0 gap**: the artifact-only prohibition (scorer.ts:115) had no non-vacuity test — a prompt rewritten to *allow* subject prose/transcript/identity/self-report passed all 131 tests. **Fix (test-only)**: extension.test.ts:168-188 scores the committed fixture, asserts all three decomposed prompts carry the artifact boundary + exact prohibited-source exclusion. Re-review re-ran the mutation → RED at :185; restored; 132/1874 green.

## Disposition
APPROVE recorded. The subjective lane is now decomposed, provenance-carrying, prompt-scaffolded, and **provably subordinate** — it can inform, never cap.
