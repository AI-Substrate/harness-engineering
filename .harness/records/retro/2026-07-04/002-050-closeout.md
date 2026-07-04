---
schema_version: "1.1"
retro_id: "2026-07-04T02:52:23Z-agent-050closeout"
agent: "agent"
plan_id: "050-semantic-artifact-telemetry"
started_at: "2026-07-04T02:52:23Z"
ended_at: "2026-07-04T02:52:23Z"
summary: "Ship-harvest closeout: 1 entry (DL-001 flight-plan chore-detection gap found by the showcase dogfood sweep)."
entries:
  - id: DL-001
    kind: difficulty
    description: "artifact-semantics flightPlanExtractor counts chores by type==='chore' but modern the-flow chore nodes carry a 'chore' OBJECT property with types harness-boot/observe/harness-retro/backpressure — 050's own 5 chores read as 0 (038's older vintage works). Detect by presence of node.chore instead"
    target: project-sensor
    severity: annoying
    suggested_encoding: "one-line predicate change in flightPlanExtractor + fixture with a modern chore node"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-04T02:52:23Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — 050 ship-harvest closeout
