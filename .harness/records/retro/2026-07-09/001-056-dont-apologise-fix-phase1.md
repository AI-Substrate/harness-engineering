---
record_kind: "retro"
harness_version: "0.10.0"
branch: "056-dont-apologise-fix"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-09T02:32:55.393Z"
agent: flow-pair-orchestrator
plan_id: 056-dont-apologise-fix
schema_version: "1.2"
retro_id: "2026-07-09T02:30:00Z-flow-pair-orchestrator-056p1"
started_at: "2026-07-09T00:32:00Z"
ended_at: "2026-07-09T02:30:00Z"
summary: "Phase-1 drain for plan 056 (dont-apologise-fix), captured while dogfooding the builder flow + a pij coder/reviewer fleet on the very change this plan ships (recommendation-led drain with first-class dispositions). Eight observations across three buckets; dominant theme is token efficiency (routed to the next plan), plus two concrete fixable tooling bugs and one self-resolved build friction. Every presented observation carries a disposition — deferred ones written, not dropped."
entries:
  - id: SUGG-001
    kind: improvement-suggestion
    description: "Guided-mode boot reads ~100KB of references (00-routing + coach + flight-plan-ops + SKILL) before the first useful action — a fixed per-session token tax; much is doctrine restated in 2-3 places."
    target: token-efficiency
    severity: degrading
    suggested_encoding: "next efficiency plan: tiered/leaner references or a compiled quick-card the engine reads instead of full docs"
    disposition: deferred
    system:
      compound: { status: open, source: agent-self, first_seen_at: "2026-07-09T00:33:00Z" }
  - id: SUGG-002
    kind: improvement-suggestion
    description: "Each harness flow CLI verb echoes a full envelope with an identical data block; 4 sequential calls in a create block emit ~4x duplicate context into the transcript."
    target: token-efficiency
    severity: annoying
    suggested_encoding: "a --quiet flag or batched envelope for multi-call sequences"
    disposition: deferred
    system:
      compound: { status: open, source: agent-self, first_seen_at: "2026-07-09T00:55:00Z" }
  - id: SUGG-003
    kind: improvement-suggestion
    description: "The builder flow should defer work to cheaper capable agents where the stage allows — validation critics, research workers, mechanical sweeps are Opus-capable; the lead premium model should not burn tokens on delegable review."
    target: token-efficiency
    severity: degrading
    suggested_encoding: "next efficiency plan: model-tier hints in worker packets / skill guidance"
    disposition: deferred
    system:
      compound: { status: open, source: agent-self, first_seen_at: "2026-07-09T01:10:00Z" }
  - id: SUGG-004
    kind: improvement-suggestion
    description: "Delegation scope is broader than review: commit/push ceremonies, codebase searches, file sweeps, grep audits, artifact collection are all cheaper-agent work; builder stages should name which beats are delegable and to what tier."
    target: token-efficiency
    severity: degrading
    suggested_encoding: "next efficiency plan: per-stage delegable-work table (search/sweep/commit/push -> cheap tier; adjudication/design -> lead)"
    disposition: deferred
    system:
      compound: { status: open, source: agent-self, first_seen_at: "2026-07-09T01:12:00Z" }
  - id: COORD-001
    kind: coordination
    description: "Model-tier mapping for builder delegation (user guidance): Opus for analysis/review/critique; Sonnet for chores (commit/push, searches, sweeps); lead premium model reserved for judgement/design/adjudication only."
    target: token-efficiency
    suggested_encoding: "encode as a tier table in builder worker-spawn guidance: analysis->opus, chores->sonnet, judgement->lead"
    disposition: deferred
    system:
      compound: { status: open, source: user, first_seen_at: "2026-07-09T01:12:00Z" }
  - id: DL-001-orchestrator
    kind: difficulty
    description: "flow-pair observe runs git diff over the whole tree, so an orchestrator's legitimate the-flow.json edit (a hand-off node the coder is forbidden to touch) makes observe abort with 'forbidden path in diff' — the capture can't distinguish orchestrator flight-plan writes from worker writes."
    target: tooling
    severity: annoying
    workaround: "reviewed the diff directly with git diff main...branch, excluding the-flow.json"
    suggested_encoding: "flow-pair observe should scope its diff to the delegation's allowed-paths (or exclude the known flow-state files) rather than failing on any forbidden path in the working tree"
    disposition: task
    system:
      compound: { status: suggested, source: agent-self, first_seen_at: "2026-07-09T02:23:00Z" }
  - id: DL-001-rail
    kind: difficulty
    description: "Fresh D1 template seed: 'harness flow rail --chores show' renders no chore pips because baked chores are status=assumed and the rail pip glyphs only map todo/done/skipped — chore presence invisible exactly when it should first appear."
    target: tooling
    severity: annoying
    suggested_encoding: "map assumed to a box-glyph (or seed chores as todo) in the rail renderer; add a render test for a fresh template seed"
    disposition: task
    system:
      compound: { status: suggested, source: agent-self, first_seen_at: "2026-07-09T00:33:00Z" }
  - id: DL-001-coder-t005
    kind: difficulty
    description: "Plan 056 T005: insight generators observe_conversion + disposition_mix needed the friction-proxy report totals widened (additive ReportTotals change); hit and resolved in-flight during the build."
    target: plan
    severity: degrading
    workaround: "additive ReportTotals widening, committed as part of T005"
    disposition: fixed-now
    system:
      compound: { status: encoded, source: agent-self, first_seen_at: "2026-07-09T01:40:00Z" }
---

# Retro — plan 056 dont-apologise-fix, phase 1

Drained at the post-coding seam while dogfooding the builder flow + a pij coder/reviewer fleet on the very change (the recommendation-led drain with first-class dispositions) this plan ships.

**Disposition mix**: deferred 5 (all → the queued token-efficiency plan) · task 2 (concrete tooling bugs: `flow-pair observe` allowed-paths scoping; rail chore-pip glyph for `assumed`) · fixed-now 1 (T005 report-totals, resolved in build).

**Highest-value item**: the `flow-pair observe` forbidden-path abort (DL-001-orchestrator) — it bit us live and will hit any orchestrator that edits its flight plan mid-run; the fix (scope the diff to allowed-paths) is small and local.

**Meta**: this drain is itself the proof-of-concept — every presented observation carries a disposition, the deferred ones are written (not dropped), and the buffer clears only after the record lands. The dogfood loop closed on its own product.
