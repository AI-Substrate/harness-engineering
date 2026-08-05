# Review — 046 Phase 2: The run ledger + comparison (tasks 2.1–2.5)

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 3 HIGH + 1 MED fixed → narrow re-review → orchestrator-verified)
**Mode**: flow-pair cross-model (orchestrator Claude Opus 4.8 `pij-4s10mb`; coder Copilot claude-opus-4.8 `pij-hs5op`; reviewer Copilot gpt-5.5 `pij-p943e7`)
**Reviewed**: 2026-07-02 · **Gates**: extension+telemetry 170 green · full CLI **1864** green · `just build` clean · `harness checks` degraded/exit-0 (pre-existing warn-launch only)

## What landed
- **2.1 RunRecord** (`ledger.ts`, new): seed tuple, per-lane outcomes w/ axis, `axis_scores` (null-on-no-evidence), verdict, `duration_s`, `session_export`, **`telemetry_summary`** (counts-only; honest null, never zero-filled); `validateRunRecord` required-set derived from the JSON Schema (can't drift); node-free contentHash.
- **2.2 Append-only ledger**: one line per score appended to `.harness/live-testing/<slug>/ledger.jsonl` (scenario-level parent); prior lines byte-stable (exact-prefix test + trailing-newline repair).
- **2.3 F13 duration (core)**: `fold` tracks min/max `ev.t` → `duration_s | null` (never 0 on <2 events); **both** `SessionEvidence` decls, compile-level lock-step test.
- **2.4 `ledger` verb**: runs-over-time + per-lane verdict history, ⚑ flips scoped to the **full seed_tuple** (incl. prompt_hash/model_version — F3).
- **2.5 `--compare`**: per-axis Wilson CIs; **`pass^1` (mean+CI) and `pass^k` (observed all-K) as separate labeled values** (F1); McNemar continuity-corrected, **paired by explicit trial key with 1:1 alignment, honestly omitted when unaligned** (F2); refuses mismatched `scenario_hash`/`base_ref`; cost columns avg active-time + non-cache in/out from `telemetry_summary` (cache shown, never ranked; null rows counted + excluded).
- **047-return wiring (F4, the payoff)**: `SessionEvidence.harness_session_id` (core, derived from matched segments) → score-time `harness telemetry session save <id> --json` (envelope **additively** gained `data.totals`) → run-dir `session-export.json` + real `telemetry_summary`. No id / failed save ⇒ honest nulls, no exec, never a crash. **"10 runs each: score × time × tokens per model" is now end-to-end.**

## Dim-0 (reviewer-run, RED→GREEN, restored)
Append-only truncate → `ledger.test.ts:183/:200/:209` · seedKey drop-model → `ledger-view.test.ts:102` · Wilson corrupt → `:60/:196` · refusal→fallback → `extension.test.ts:275`+`ledger-view.test.ts:114/:123` · **re-review**: all-k→mean → `:196` (0 vs 0.67) · index-pairing → `:217` (null vs computed) · drop-prompt_hash → `:112` · pij-id-guessing guard → `extension.test.ts:133/:245`.

## Findings (all fixed + re-reviewed)
- **F1 HIGH**: `pass^k` was rendered from a `pass^1` mean (WS003 D3: all-k reliability, never alone) → split into `pass_1`/`pass_k`/`pass_k_est`.
- **F2 HIGH**: McNemar paired by array index while claiming "shared seed set" → explicit trial key + 1:1 alignment, honest omission.
- **F3 MED**: flip key omitted prompt_hash/model_version → full seed_tuple.
- **F4 HIGH**: cost/export wiring absent; real blocker found (pij id ≠ harness session id; save envelope lacked totals) → solved per above. Orchestrator ruling (wiring in-scope) upheld with the reviewer's blocker analysis shaping the fix.

## Disposition
APPROVE recorded. AC-05..AC-08 met with mutation-proven tests; statistics formula-checked at source (Wilson correct; McNemar continuity-corrected with b+c=0 handling). Coder deviation `HARNESS_NO_TELEMETRY_AUTOSYNC=1` for worker gates judged legitimate.
