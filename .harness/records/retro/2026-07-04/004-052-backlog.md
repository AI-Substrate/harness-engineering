---
schema_version: '1.0'
retro_id: 2026-07-04T05:34:00Z-agent-052backlog
agent: agent
plan_id: 052-fleet-telemetry-lane-sources
started_at: '2026-07-04T04:54:54.854Z'
ended_at: '2026-07-04T05:34:11Z'
summary: retro --drain at 052 plan lock (10 entries) — the fleet-telemetry gap backlog; every entry mapped
  to a 052 task or explicitly routed (DL-003 → pij lane)
entries:
- id: DL-001
  kind: difficulty
  description: 'Fleet lanes are volatile: post-commit flush synced+pruned the coder''s temp telemetry
    mid-run; live get-fleet lost the lane minutes after T005 captured it. Committed evidence file was
    the accidental mitigation'
  target: project-sensor
  severity: degrading
  suggested_encoding: run-end fleet snapshot step (get-fleet --json > evidence/) in flow-pair teardown
  first_seen_at: '2026-07-04T04:54:54.854Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: SUGG-001
  kind: improvement-suggestion
  description: get-fleet reads only the temp buffer — after fetching all 48 refs/harness-telemetry refs
    locally it still misses ref-resident lanes (051 peers show as orphans, segments:0)
  target: project-sensor
  suggested_encoding: fleet-evidence candidateRoots gains a refs/harness-telemetry reader (phase-2)
  first_seen_at: '2026-07-04T04:54:55.705Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: DL-002
  kind: difficulty
  description: 'Read-only peers (reviewer/validator) leave no synced telemetry: they never commit so the
    flush hook never fires; their lanes are unrecoverable after pane close'
  target: project-sensor
  severity: degrading
  suggested_encoding: flow-pair teardown runs harness telemetry sync before pij close
  first_seen_at: '2026-07-04T04:54:56.497Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: DL-003
  kind: difficulty
  description: pij adopt sets no env vars in the orchestrator's own process, so orchestrator segments
    carry no PIJ_SESSION_ID — its lane joins only as parent-of-children, reconstructed by session-dir
    identity
  target: project-sensor
  severity: annoying
  suggested_encoding: pij adopt prints an export line (or writes a pane env) so self-adopted sessions
    self-identify in captured_env
  first_seen_at: '2026-07-04T04:54:57.299Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: SUGG-002
  kind: improvement-suggestion
  description: 'Copilot lanes are NOT token-blind: full tokenDetails live in ~/.copilot/session-state/<id>/events.jsonl
    session.shutdown (+premium request counts) — our per-command tail-capture reads mid-session when it''s
    always null. A post-session shutdown sweep (roster carries the copilot session id) recovers everything'
  target: project-sensor
  suggested_encoding: 'get-fleet copilot lane enrichment: read session.shutdown tokenDetails from ~/.copilot/session-state
    keyed by the captured/rostered copilot session id'
  first_seen_at: '2026-07-04T05:04:00.753Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: SUGG-003
  kind: improvement-suggestion
  description: 'codex lanes recoverable too: ~/.codex/sessions/<date>/rollout-*.jsonl carries per-turn
    token_count events (total_token_usage incl reasoning tokens) — validator lane reconstructed at 1,368,083
    tokens from it'
  target: project-sensor
  suggested_encoding: codex rollout reader as a third lane source in fleet-evidence
  first_seen_at: '2026-07-04T05:04:01.629Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: INS-001
  kind: insight
  description: F-07 'copilot tokens:null' was canonised in the 051 dossier/design as fundamental when
    it's a capture-TIMING artifact (shutdown-only ledger); the correcting knowledge existed only in one
    agent's session memory from the 036 era — tribal, not substrate, so the blind spot survived research,
    plan validation AND code review
  target: project-sensor
  suggested_encoding: 'docs/how/telemetry.md lane-source matrix (per-harness: where tokens live, when
    they materialize) so no future plan re-derives the blind spot'
  first_seen_at: '2026-07-04T05:05:40.171Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: SUGG-004
  kind: improvement-suggestion
  description: Fleet run report needed a semantic-dimensions section (review findings count, fix cycles,
    plan CS/size, chore completion, scenario intents) — all hand-assembled from plan/flow-json/review/execution-log
    because get-fleet reports only cost/time; the semantic layer per-lane is the flow-eval fleet-mode
    gap
  target: project-sensor
  suggested_encoding: 'fleet-mode semantic rollup: get-fleet (or flow-eval) emits per-run semantic dims
    from the-flow.json + reviews/ + execution log'
  first_seen_at: '2026-07-04T05:15:36.430Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: DL-004
  kind: difficulty
  description: Coder lane (copilot) emitted 0 artifact events in its synced ref despite running harness
    checks AFTER writing execution log + evidence — the 050 artifact layer works in the claude orchestrator
    lane (6 events, counts+enums correct) but not in the copilot worker lane; adapter or plan-cursor gap,
    needs investigation
  target: project-sensor
  severity: degrading
  suggested_encoding: test artifact emission per adapter; fixture a copilot-lane artifact write
  first_seen_at: '2026-07-04T05:24:46.407Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
- id: DL-005
  kind: difficulty
  description: 'Artifact classifier false positive: review-PACKET files (instruction templates listing
    ''APPROVE | APPROVE_WITH_NOTES | FIX_REQUIRED'' in the rubric) are classified as reviews with enums.verdict=APPROVE
    — a telemetry-only report would show APPROVE for a round that was actually FIX_REQUIRED; real example
    segment event on reviews/review-packet.md 2026-07-04T04:03:57Z'
  target: schema
  severity: degrading
  suggested_encoding: exclude *-packet.md from review classification (or require the Findings section
    shape before verdict extraction)
  first_seen_at: '2026-07-04T05:24:47.247Z'
  system:
    compound:
      status: suggested
      resolved_by: docs/plans/052-fleet-telemetry-lane-sources/fleet-telemetry-lane-sources-plan.md
system:
  compound:
    bubble_action: all-save
---
