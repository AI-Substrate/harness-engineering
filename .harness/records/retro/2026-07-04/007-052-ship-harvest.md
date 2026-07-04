---
schema_version: "1.1"
retro_id: "2026-07-04T08:05:00Z-claude-fable-052ship"
agent: "claude-fable"
plan_id: "052-fleet-telemetry-lane-sources"
started_at: "2026-07-04T07:55:00Z"
ended_at: "2026-07-04T08:05:00Z"
summary: "052 ship + terminal harvest: pushed to PR 49 (CI green 2m47s), fleet torn down, then a live get-fleet dogfood on our own run surfaced the teardown-order trap — pij close deletes ~/.pij descriptors, so the ledger join must be snapshotted BEFORE close. Honesty invariants held (lanes visible, cost_measured:false, no fake zeros)."
entries:
  - id: DL-001
    kind: difficulty
    description: "LIVE dogfood after ship: get-fleet on our own run degraded both copilot lanes to cost_measured:false because pij close DELETES ~/.pij descriptors and parseRoster carries only pijId — orchestrator violated the freshly-documented sweep order (snapshot BEFORE teardown). Shutdown ledgers persist (cf839f14 coder, 2d044be2 reviewer) for manual recovery"
    target: tooling
    severity: degrading
    workaround: "run.json roster carries harnessSessionId (P9), so the mapping survives; manual join possible"
    suggested_encoding: "flow-pair teardown step: get-fleet snapshot before pij close"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-04T08:00:00Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "parseRoster should accept roster.<role>.harnessSessionId as an explicit ledger-join fallback — run.json already persists it before use, so post-teardown recovery needs no pij changes and no descriptor resurrection"
    target: project
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-04T08:00:30Z"
---

# Retro — 052 ship + terminal harvest

Fleet run totals: 2 phases, 2 delegations, 2 FIX_REQUIRED→APPROVE cycles (fleet-wiring orphan-vs-degraded split; fleet-level plan_cs), 4 reviewer self-run mutations all non-vacuous. Coder pij-5r4ckl (opus-4.8 max), reviewer pij-1wxl9o0 (gpt-5.5 xhigh). Feature commits 6b2811ba · 533ea8f9 · 46a3ec9c · dd415226. Pushed c3746b2c..232fcbc2 to PR 49; CI success.
