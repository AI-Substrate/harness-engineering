# Review — 046 task 4.6: comparability round (T-A/T-B/T-C)

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 2 MED fixed → narrow re-review → orchestrator-verified)
**Mode**: flow-pair cross-model (orchestrator Claude Fable 5 `pij-4s10mb`; coder Copilot claude-opus-4.8 xhigh `pij-1t8xjkx`; reviewer Copilot gpt-5.5 `pij-p943e7`)
**Reviewed**: 2026-07-02 · **Gates**: extension 163 green (was 141) · full CLI **1905/1905** · standalone tsc clean · orchestrator sanity pass at resolvers.ts:398 + extension.ts:533-540

## What landed (task 4.6 — drain follow-ups SUGG-003 / SUGG-004 / INS-001)

- **T-A per-run assertion resolution** (SUGG-003): `score --resolve <id>=<cmd>` overrides a placeholder command by assertion id — the committed scenario file is never mutated at run time. Scenario-level `placeholder_policy: 'raw' | 'unknown'` (default `raw` preserves legacy byte-for-byte; md-to-pdf stays policy-less so the frozen e2e stands — **decision A**, orchestrator-locked); an unresolved screaming-snake token under `'unknown'` resolves honest-`unknown`, never raw-exec. `scaffold` emits `'unknown'` for new scenarios (rider 1). Resolved commands recorded in report.json + RunRecord provenance. Rider 2: instructions.md documents the forgotten-`--resolve` FALSE-FAIL mode on legacy raw scenarios.
- **T-B ledger supersede** (SUGG-004): new `flow-eval supersede --scenario <slug> --run <old> --by <new>` appends a `{kind:'supersede', run_id, superseded_by, ts}` annotation — existing ledger lines byte-stable; `validateAnnotation` separate from `validateRunRecord` (no schema bleed); `ledger` list marks ⊘; `--compare` excludes superseded runs **before** pass^k/Wilson/McNemar inputs (ledger-view.ts:441). `score` hints supersede on session-suffix match.
- **T-C worktree pre-creation** (INS-001): orchestrator.md step-0 pre-creates the subject worktree at `base.ref`; step-3 hands the subject its path (blindness preserved); step-7 → `--resolve`; steps 8–10 → score/render/supersede; honest note that A2/A5 may be unobservable with a fully autonomous subject.

## Dim-0 (reviewer-run, restored)

policy-guard inverted → RED ×4 · annotation passes validateRunRecord → RED ledger.test.ts:282 · annotation inflates run count → RED ×2 · scaffold emits 'raw' → RED extension.test.ts:530 · **first-match resolve → GREEN = F1**.

## Findings (fixed → narrow re-review, reviewer re-ran its own mutation)

- **F1 · MED · Dim-0 gap**: `--resolve` id isolation unproven — the reviewer's first-match mutation left all 161 tests green. **Fix (test-only)**: two-lane isolation test (extension.test.ts:721-761) asserting the un-resolved lane runs its OWN cmd and provenance carries exactly one resolution; the mutation now flips RED at :755 (verified independently by the reviewer).
- **F2 · MED**: self-supersede accepted — `--run X --by X` tombstoned a run with no corrected replacement. **Fix**: `oldRun === byRun` rejected with E_ARGS **before** any append (extension.ts:533-540); test proves the error and a byte-identical ledger (extension.test.ts:826-837).

## Disposition

APPROVE recorded. Comparability unblocked: scenario immutable per run, ledger trustworthy under re-scores, base refs pinnable. Orchestrator follow-up: run the real supersede retiring the mis-stamped run-1 line (`20260702-041431Z-asw2rn` → superseded by `20260702-044948Z-asw2rn`).
