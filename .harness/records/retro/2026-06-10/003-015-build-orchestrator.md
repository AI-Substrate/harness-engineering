---
schema_version: "1.0"
retro_id: "2026-06-10T03:30:00Z-claude-code-21bdfcc"
agent: claude-code
plan_id: null
started_at: "2026-06-10T02:45:00Z"
ended_at: "2026-06-10T03:30:00Z"
summary: "Orchestrator retrospective — 015 observe-retro-merge Build (plan-6-companion, T000-T014, 7 commits). Mirrors plan-6a Step 8; legacy docs/harness/agents/ path absent so the committed-record path is canonical."
entries:
  - id: OH-001
    kind: difficulty
    description: "biome reformats multi-line signatures under its width budget — three of five RED/GREEN pairs needed a manual `npx biome check --write` pass between green suite and commit"
    target: engineering-harness
    severity: annoying
    workaround: "ran biome --write as a standing step in the per-pair loop"
    suggested_encoding: "a `just pre-commit` recipe bundling biome --write + vitest + check:docs as one verb"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T02:56:00Z"
  - id: OH-002
    kind: coordination
    description: "Companion silence is ambiguous mid-phase: outside inbox showed zero replies all phase, which reads as 'no findings' — but the farewell carried 3 findings (1 HIGH) and a REQUEST_CHANGES verdict only visible after control:stop. No ACK channel distinguishes 'reviewed, clean' from 'reviewed, findings pending in my report'"
    target: minih
    severity: degrading
    workaround: "read the farewell via last-run output/report.json and reconciled post-stop; fixes landed in 21bdfcc after the companion exited"
    suggested_encoding: "companion protocol: send findings as inbox messages at review time (not only in the farewell), or an ACK-per-review-request option"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:25:00Z"
  - id: OH-003
    kind: gift
    description: "D1-D10 pre-resolved decisions made the build mechanical — zero design re-derivation across 15 tasks; T012's mandatory AC-14 mapping table forced honest line-level verification of the prose rewrite; dogfooding the verb mid-build (capturing the user's note and the FakeFs gap with `npx harness observe` the moment T004 landed) closed the loop the plan was about"
    target: plan
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:20:00Z"
  - id: MW-001
    kind: magic-wand
    description: "A stop-guard for the companion debrief: compare the stop-cited sha against the companion's last reviewed sha and warn before control:stop completes (the companion's own magic wand, seconded — ff310da and 21bdfcc landed outside its reviewed range)"
    target: coordination
    suggested_encoding: "minih control:stop validates a reviewedThrough field"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T03:28:00Z"
---

# Orchestrator retro — 015 Build (claude-code)

Phase shipped in 7 commits, suite 317→374, both cwds green. The companion's two
open findings (F001 deviant-loss-on-clear, F003 self-heal overclaim) were both
genuine and fixed in `21bdfcc` — the F001 catch is exactly the kind of contract
drift a second pair of eyes exists for (the plan and skill had *documented* the
loss; the companion noticed the documentation contradicted D3's own promise).
