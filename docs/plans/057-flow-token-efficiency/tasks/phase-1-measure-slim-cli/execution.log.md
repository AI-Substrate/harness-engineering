# Execution Log — Phase 1: Measure + slim the CLI

**Plan**: flow-token-efficiency-plan.md v1.1.0 · **Started**: 2026-07-10T02:25+10:00 · **Approach**: Hybrid (TDD for CLI code)

## T001 — Design-proof: stage-window mechanism ✅

**Decision: READ-SIDE (primary candidate confirmed).** Attribution-by-last-transition-lookup over `cursor-moved` `flow_log` markers; write-side emitter NOT needed.

Evidence (decoded real 056 ref `refs/harness-telemetry/2026/07/09/22583d3b…` → `session.logs.jsonl`, 677 events):
- 19 `flow_log` markers with real absolute `fired_at`: `cursor-moved research→plan` @1783558699, `cursor-moved plan→phase-1` @1783560353 — the full stage timeline exists and is trustworthy.
- Session turn window 1783560369→1783564243 starts AFTER the last cursor-move — markers outside the window are normal (they're the flight plan's history), which kills naive window-clipping but validates the better rule: **stage(turn) = latest cursor-moved ≤ turn.t** (a point lookup; matches the 2 existing FlowEvent anchors, both phase-1 ✓).
- The exclusion at `events.ts:268–276`/`rollup.ts` guards *gap/wall math re-sorting* — attribution-by-lookup never re-sorts, so the policy is preserved, not violated.
- Single-flow-per-session by construction: `flow_log` is projected only from the HARNESS_PLAN_ID-linked plan (`capture-service.ts` `withFlowLogEvents`), so node-id collisions across flows can't occur within a session.
- Monotonicity: source is the flight plan's append-only `events[]` with real stamps; a defensive sort-by-t in the implementation makes ordering explicit.
- Retroactive: works on ALL existing refs (056 included) — no redeploy-then-wait needed for a per-stage baseline.

Contract for T002/T003: derive stage brackets in the report/rollup layer from `cursor-moved` markers (fallback chain stays: FlowEvent anchor → `/the-flow <digit>` → flow_log lookup → `unlabeled`); surface as additive `flow_stage_mechanism` value `flow_log`; cache tokens stay session-level (plan KF-06).

## T002 — Tests first ✅

`test/services/telemetry/flow-log-stage-lens.test.ts` — 7 tests, RED 7/7 before impl (named mutations: lookup-ignores-marks, mechanism-misattributed, pre-mark-events-dropped). Covers: marks-only attribution, 056-shape retroactivity (marks before turn window), anchor+mark merge with per-window mechanism, honest `unlabeled` for pre-mark events, non-cursor-moved ops label nothing, and both no-marks regressions (digit fallback, anchor-primary) unchanged. Pre-check: segment + OTLP lanes both pick `op/from/to` explicitly (segment.ts:365–376, otlp/logs.ts:107–114/256–264) — round-trip safe.

## T003 — Implement read-side lookup ✅

`report.ts`: `FlowStageMechanism` + `flow_log`; `viewOf` extracts `cursorMarks` pre-filter; `foldSession` flow_stage lens gains the merged last-transition-lookup path (contiguous same-stage runs → windows; window mechanism = source of its starting mark; pre-mark events → `unlabeled`); no-marks sessions byte-identical to T1.4. `report.schema.json` mechanism gains `flow_log` (additive; `additionalProperties: true` made it compatible either way). 3 deliberate assertion updates in `flow-stage-lens.test.ts` (mechanism object gained a key). **Suite 2266/2266 green; `tsc --noEmit` clean. Commit `6615e488`.**

Discovery (gotcha, Noteworthy): the old PRIMARY path silently dropped events before the first `flow` anchor from the lens — the lookup path now surfaces them as `unlabeled` (more honest coverage; affects reports only when marks exist).
Discovery (gotcha): root `package.json` has no `typecheck` script — `npm run build` wraps tsc; `npx tsc --noEmit -p harness/cli` is the direct probe. (Stale-doc friction already ledgered in 056 — not re-captured.)

## T004/T005 — flow-local `--quiet` ✅

Tests first (`test/acts/flow-quiet.test.ts`, 6 tests; named mutations quiet-leaks-summary, quiet-contaminates-default): quiet io slims a mutation's `data` to `{path}`; default byte-identical (full frozen 7-key shape asserted); `flow show` untouched under quiet io; bare `--quiet` on argv tolerated by commander without act-side re-derivation; `harness instructions` envelope untouched (AC-03). Impl: `quietFlag()` tri-state in `app.ts` (mirrors `jsonFlag`), global `--quiet` option, `CliIo.quiet` (additive), gate in `runMutation` only. Test-helper fix along the way: create the built-in `harness-loop` type (flight-plan needs `--schema`). **Canonical gate 2272/2272 green. Commit `0fdf083f` (T004-05).**

Discovery (gotcha, Noteworthy): running `npx vitest run` from repo ROOT sweeps `scratch/evals/**` artifact tests (11 files needing Chromium) — the canonical gate is `just test` (harness/cli-scoped). Root-run failures are environmental, not product.

## T006 — docs + manifest ✅

`docs/how/harness-flow.md`: new "Lean output — `--quiet`" + "Telemetry: mutations become per-stage attribution for free" sections; guide added to `docs-manifest.json` (10th entry, P12-reviewed) so `check:docs` genuinely guards it (V-02 closed). Post-commit `check:docs` GREEN; suite 2273 (+1 per-doc test). Commits `c6e2e02f` (T006) + `9eb6855e` (carried doctrine/plan artifacts).

## T007 — subagent-adapter answer (AC-11) ✅ — verdict: MIXED / SEPARATE

Sonnet worker, all claims path:line-cited (adapter `claude-adapter.ts:75-84, 302-309, 370-396, 419-431`; `events.ts:328-333`; `rollup.ts:227-241`; `pij-registry.ts:22-39`; `fleet-evidence.ts:182, 280-342`):
- **Native `Agent`-tool subagents**: tokens parsed from the inline `<usage>subagent_tokens</usage>` block into a SEPARATE `subagent_tokens`/`grand_total` field — **excluded from `tokens.total`, the turn stream, and `Rollup.tokens`**. `SubagentEvent` carries name/status/duration only.
- **pij fleet peers**: architecturally separate sessions (own `harness_session_id` + transcript), joined ONLY at fleet-evidence (`get-fleet`); the orchestrator's turn totals contain zero delegated cost — explains 056's 0-subagent-events/298-turns exactly. The `subagent` emitter is live (fires on in-transcript Agent tool_use), so zero events is a real signal, not a capture gap.
- **Tripwire interpretation rule (feeds T2.6)**: a per-session `Rollup.tokens` UNDERCOUNTS delegation-heavy work — read delegation eras via `grand_total` (native) or `telemetry get-fleet` (pij); never compare a delegation-heavy session's turn totals against a flat one's as if commensurate.

## T009 — baseline record (AC-05) ✅

`baseline/baseline.md` + `baseline/sweep-2026-07/2026-07.report.json` (38 sessions, 4 measured). **Retroactivity proven live**: the 056 session's 59,049/182,379 tokens attribute to `phase-1`/implement via its pre-window cursor-moved history; mechanism mix `{flow: 2, digit: 0, unlabeled: 1, flow_log: 1}` exercises every path on real data. Cache dwarfs fresh ~365:1 month-wide (context re-reads are the raw dominant cost — session-level only per KF-06).
