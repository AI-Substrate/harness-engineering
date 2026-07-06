# Review — 048 Phase 3: LLM edge, docs & real-month dogfood (tasks 3.1–3.4)

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 2 HIGH fixed — one against the CODER, one against the ORCHESTRATOR — → narrow re-review with independent re-verification)
**Mode**: flow-pair cross-model (orchestrator Claude Fable 5 `pij-4s10mb`; coder Copilot claude-opus-4.8 xhigh `pij-1kwcc01`; reviewer Copilot gpt-5.5 xhigh `pij-xfl71a`)
**Reviewed**: 2026-07-02 · **Gates**: full CLI **1978 / 161 files** green (P2-end 1975, +3) · scoped biome 0 · tsc 0 · docs gates non-regressed (markdown-lint pre-existing 11, zero added)

## What landed (AC-09/AC-10 + the dogfood fix round)

- **3.1 `telemetry-insights-narrate` skill**: narrator (prose over computed numbers, injection into the inert slot, **artifact-bound honesty check** — see F1) + insight-smith (proposes new deterministic generators as review-gated code, never conclusions); hard rules: no computed numbers, no people analytics, mandatory n+caveat, suppressed stays suppressed, narrate the CURRENT artifact.
- **3.2 `docs/how/cohort-telemetry-insights.md`**: the loop walkthrough (sweep → report each cached export → insights → open HTML → narrate → smith proposals back); command sequence verified against the shipped verb signatures; a map, not a manual.
- **3.3 Real-month dogfood (orchestrator-run)**: June 2026 — 21 sessions from committed refs alone → per-session reports → 7-section insights + discipline panel + HTML. First real readings: observe→drain **36/42**; backpressure-before-implement **1/6**; cohort active/wall **0.51** (post-fix). Two measure defects surfaced and were **fixed in-phase**:
  - **D-A**: active>wall sessions (a timestamp-precision artifact — **8/21** sessions!) were silently folding into the cohort aggregate → now excluded + declared (count + reason in the cohort caveat), per-session rows kept with `data_quality` flags; no clamping anywhere (named capture-side follow-up recorded instead).
  - **D-B**: honest-zero vs unmeasurable-era — evidence-based `coverageDeclaration` (push signatures unavailable **13/21** pre-FX001 sessions; stage labels unavailable **20/21** pre-1.2-fix) attached to discipline + stage economics; `checks-before-push 0/0` now reads UNMEASURABLE, not zero.
- **Narrator live exercise**: the orchestrator narrated the v2 board through the skill; verified artifact-bound (`minted: []`), reviewer-audited.

## Findings (both fixed → narrow re-review with the reviewer re-running the checks itself)

- **F1 · HIGH · skill honesty check not artifact-bound**: the skill pointed narrators at the renderer vitest, which builds fresh fixture HTML and never opens the edited page — a minted/stale number in the real artifact passed. **Fix**: the check is now a node one-liner over the EDITED page (body minus scripts/styles, digit-runs vs that page's own `#insights-data` island; raw island values, not k/M display); renderer test relabeled as separate generator coverage. Reviewer ran it (clean) + a negative control (injected `58231` → exit 1).
- **F2 · HIGH · the orchestrator's narration violated the skill**: the v1 page's prose restated pre-fix numbers (cohort 0.52/n=19 with the 8 impossible sessions folded in) and narrated around a suppressed section. **Fix (orchestrator)**: v2 re-narrated against the corrected rows (exclusions declared in prose; UNMEASURABLE-vs-zero spelled out; suppressed section unmentioned); v1 slot cleared with a supersession note. Reviewer audited every narrated figure to its v2 row.

## Dim-0 (reviewer-run on the code half, restored, hash recorded)

excluded-count-lies-as-0 → RED insights.test.ts:394 · data_quality-row-vanishes → RED :400 · inverted-push-coverage-predicate → RED :440.

## Notable

The review audited the **orchestrator** as a subject and found a real violation (F2) — the loop's honesty machinery applies to its most expensive participant. The mechanical fix pattern (artifact-bound digit-run verification) came from the orchestrator's own remediation and is now the skill's prescribed check for every future narrator.

## Disposition

APPROVE recorded. Phase 3 complete pending the 3.4 harvest drain. 048 remaining: harvest → review-4? (none — three phases) → ship. AC-13 (live digit) still awaits one user-typed `/the-flow <digit>`.
