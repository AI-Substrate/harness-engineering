---
schema_version: "1.0"
retro_id: "2026-06-09T12:40:00Z-github-copilot-vhf01"
agent: "github-copilot"
plan_id: "013-dogfood-harness-flow"
started_at: "2026-06-09T12:19:00Z"
ended_at: "2026-06-09T12:40:00Z"
summary: "Built the validate-harness-flow dogfood extension + its minih worker by forking validate-harnessability.ts and install-and-validate-test-extension, under a live code-review-companion. Dogfooded our own harness loop while building it: scaffolded this retro via `harness record retro` (the write path worked first try — no carve-out needed). Captured real friction below; retros are surfaced here, not auto-implemented."
entries:
  - id: DL-001
    kind: difficulty
    description: "minih only registers an agent in `minih list`/`check`/`inspect` once prompt.md exists — agent.json + schemas alone are invisible, so the T001/T002 Done-Whens (list/check) could not be verified until T003 landed."
    target: minih
    severity: annoying
    workaround: "Validated the schemas directly with python jsonschema (positive + negative cases) at T002, then re-confirmed with `minih check` after prompt.md existed."
    suggested_encoding: "minih list/inspect could surface a partially-scaffolded agent with a 'missing prompt.md' diagnostic instead of omitting it entirely."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:21:00Z"
  - id: DL-002
    kind: difficulty
    description: "`setsid` is not available on macOS. The companion-boot doc shows plain `minih run <slug> &` backgrounding; I reached for a `setsid nohup minih run ...` detach instead, which silently failed (the run never started; `minih status` showed a stale earlier run as 'completed')."
    target: minih
    severity: degrading
    workaround: "Booted the companion via the agent runtime's own detached/async background mode instead of setsid; confirmed `verdict: active` before briefing."
    suggested_encoding: "Companion-boot docs should give a macOS-safe detach recipe (e.g. plain `nohup ... &` / `disown`, or note setsid is Linux-only)."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:19:30Z"
  - id: INS-001
    kind: insight
    description: "The two fork templates carried `minihVersion: >=0.3.0` while the installed minih is 0.1.7, yet both load + dry-run fine — the version range is advisory, not enforced at this version. Kept >=0.3.0 for sibling consistency."
    target: minih
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:20:30Z"
  - id: GFT-001
    kind: gift
    description: "Forking validate-harnessability.ts gave a battle-tested injection-safe detached-fire pattern (only `\"$@\"` literal argv is read), the lastRunId/captureNewRun poller, and the clone de-dup loop — ~80% of the orchestrator was adapt-not-author."
    target: project
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:28:00Z"
  - id: MW-001
    kind: magic-wand
    description: "Ship `harness init` (the deferred governance writer) so the worker doesn't have to hand-write .harness/engineering-harness.md from the BIO template — the single biggest manual step in the recipe."
    target: project
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:26:00Z"
  - id: CONF-001
    kind: confusion
    description: "The spec's abandonment gate read `final_grade in {D, F}` which skips grade E (25-39%, 'hostile to agent operation') — strictly worse than D. Abandoning D but not E is incoherent."
    target: plan
    workaround: "Encoded the gate as D/E/F (below C) in the worker prompt and logged the reconciliation for the companion to review."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-09T12:26:30Z"
---

# Retro — build of validate-harness-flow (plan 013)

Continuous self-dogfood while building the dogfood extension. The harness
`record retro` write path worked first try, so no record-path repair was needed
(the one corrective change the no-auto-implement rule would have allowed). All
entries above are **surfaced for review, not auto-applied**.
