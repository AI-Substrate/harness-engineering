# Review — 048 Phase 2: The insights layer v1 (tasks 2.1–2.5)

**Verdict**: ✅ **APPROVE** (FIX_REQUIRED → 1 HIGH test-only fix → narrow re-review, reviewer independently re-verified → orchestrator sanity pass)
**Mode**: flow-pair cross-model (orchestrator Claude Fable 5 `pij-4s10mb`; coder Copilot claude-opus-4.8 xhigh `pij-1kwcc01`; reviewer Copilot gpt-5.5 xhigh `pij-xfl71a`)
**Reviewed**: 2026-07-02 · **Gates**: full CLI **1975 / 161 files** green (P1-end 1940, +35) · scoped biome 0 · tsc 0 · orchestrator sanity read of the strengthened smoke (insights-html.test.ts:109-141)

## What landed (AC-05..08)

- **2.1 Structural epistemics**: `makeRow` throws on missing `n`/empty `caveat`; `suppressLowN` folds n<5 into a visible "other" row + `section.suppressed` (silent truncation impossible); `N_THRESHOLD=5` documented + in provenance.
- **Q2 control-marker timeline** (mid-phase decisions D-Q1/Q2/BROADEN, orchestrator-locked): report.ts gains an additive, **single-session-only** `control_timeline` — `{kind,key,t}` over the CLOSED allowlist `[harness, checks, subagent, branch, bash(git push/commit signatures)]`; every field already captured + allowlisted (P12 unchanged); rider-1 mutation (smuggle `prompt` kind) pinned RED.
- **2.2 The seven sections** as named generators: stage economics (+ explore→ship in wall AND active clocks), skill breakdown (the-flow included, non-additive note), bash by count/by sent, subagents (counts from timeline, tokens **null-unmeasured never 0**), active/wall ratio, outlier sessions, per-work-unit table (branch-keyed, visible `unassigned`, exempt from suppression). **Grain-robust**: aggregate-only input → sections 5/6/7 + discipline render `available:false` with an honest caveat, never fabricated from totals.
- **2.3 Discipline panel**: observe→drain, backpressure-before-first-checks, checks-strictly-before-git-push, retro cadence — true ordering via the timeline; asymmetric fixtures make the order-flip mutation non-vacuous.
- **2.4 `telemetry insights` verb + insights.schema.json**: dedup by PATH (live smoke caught a name-stem collision bug — fixed + regression test); error contract tested both ways (partial → exit 1 naming the bad input AND partial insights.json with `provenance.skipped_inputs`; all-bad → nothing written); provenance carries inputs, keying rule, n-threshold, map-version passthrough, token_coverage, H-05 copilot tail-capture caveat, subagent-token gap.
- **2.5 Self-contained HTML** with inert reserved narrator slot (`data-narrator=reserved`) + data island; offline-clean.
- Live smoke on real July refs end-to-end (2 sessions → per-session reports → insights): branch keying grouped both under the real branch; discipline rendered honest zeros.

## Dim-0 (reviewer-run, restored, hashes recorded)

silent low-n drop → RED insights.test.ts:165 · unassigned-row suppressed → RED :298 · subagent-tokens-as-0 → RED :259 · aggregate-fabricates-sections → RED :276 + insights-act.test.ts:226 · timeline-on-aggregate → RED report-control-timeline.test.ts:176 · **HTML-minted percentage → GREEN = F1**.

## Finding (fixed → re-reviewed)

- **F1 · HIGH · Dim-0 gap (test-only)**: the "every number originates from insights.json" smoke checked only two static sentinels — blind to numbers the renderer's **inline script mints at browser time**. **Fix**: the smoke now executes the page (jsdom runScripts), guards its own vacuity (non-empty rendered root), strips both scripts, flattens tag boundaries (no phantom digit-fusion), and asserts every rendered digit-run traces to the embedded JSON + a one-entry static-prose allowlist. Reviewer re-applied its exact mutation → RED (`['50','67']` listed) with renderer blob hash verified unchanged.

## Decisions taken mid-phase (recorded)

Grain-robust N-single-session contract; branch keying (single provenance branch else `unassigned`); BROADEN timeline; n-semantics (command/skill/stage rows n=invocations/windows; unit/ratio/outlier n=sessions, documented per-row).

## Disposition

APPROVE recorded. The insights layer computes the WS001 v1 set with enforcement, honesty caveats, and a proven no-minting render. Phase 3 (LLM edge + docs + real-month dogfood) unblocked; dogfood pipeline: sweep → report each cached export → insights over the N.
