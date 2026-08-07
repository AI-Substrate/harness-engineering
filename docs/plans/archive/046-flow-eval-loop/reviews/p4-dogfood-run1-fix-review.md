# Review — 046 task 4.5: dogfood run-1 fix round (F-A/F-B/F-C)

**Verdict**: ✅ **APPROVE** (clean first pass — no findings)
**Mode**: flow-pair cross-model (orchestrator Claude Fable 5 `pij-4s10mb`; coder Copilot claude-opus-4.8 xhigh `pij-1t8xjkx`; reviewer Copilot gpt-5.5 `pij-p943e7`)
**Reviewed**: 2026-07-02 · **Gates**: extension 141 green (was 132) · full CLI 1881 pass / 2 fail (both proven pre-existing, see below) · orchestrator sanity pass at ledger.ts:301-310 + extension.ts:178-196

## What landed (task 4.5 — fixes from dogfood run `20260702-041431Z-asw2rn`)

- **F-A subject/base-ref fidelity**: `score` gained `--subject-harness/--subject-model/--subject-effort/--base-ref` (extension.ts:178-196; scenario.json stays the default). Effective values flow **lock-step** into report header, RunRecord.subject/base_ref AND seed_tuple (buildRunRecord derives seed from the same input — ledger.ts:301-310). `detectWorktreeHead()` (extension.ts:87) surfaces a visible, never-fatal warning when worktree HEAD ≠ effective base_ref; the warning is persisted in report.json so `render` reproduces it (report.ts:96-98/167-170/260-270).
- **F-B null-axis render honesty**: report.md renders an axis with no scorable lane as `unmeasured`, never `0.00`; a measured zero still renders `0.00` (report.ts:154-162).
- **F-C judged re-render**: new `flow-eval render --scenario <slug> --run <id>` (extension.ts:335/614) regenerates report.md from the current report.json — filled judged verdicts included; no telemetry fetch, no ledger write (append-only boundary documented), write-set exactly `[report.md]`. `score`'s next_action now points at `render`.
- Deviations (all accepted): effective subject feeds the same-family judge warning; judged rationale line in report.md; `JudgedField.rationale/by` widened to `string|null`; base_ref_warning persisted for render idempotency.

## Dim-0 (reviewer-run, all restored)

seed_tuple lock-step broken → RED extension.test.ts:357 · HEAD≠base_ref warning suppressed → RED extension.test.ts:382 · render writes report.json too → RED extension.test.ts:469 · measured-zero rendered as unmeasured → RED report.test.ts:175.

## The 2 full-suite failures — pre-existing, orchestrator-caused

`e2e-md-to-pdf.test.ts:160-175` expects the A7/A8 placeholder tokens (`SUBJECT_EXTENSION_HELP`/`SUBJECT_PDF_VALIDATOR`) that dogfood run-1's runbook step 7 replaced **in the committed scenario file**. Not the coder's delta (git diff confirms). The real defect is the runbook's mutate-in-place step — captured as observation SUGG-003; follow-up: per-run assertion resolution in the run dir, never in `live-testing/scenarios/`.

## Disposition

APPROVE recorded. Next: re-score run-1 with the truthful `--subject-* codex/gpt-5.5` + `--base-ref e27e4c69`, fill judged, `render`.
