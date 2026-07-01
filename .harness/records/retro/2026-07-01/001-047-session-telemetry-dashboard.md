---
record_kind: "retro"
harness_version: "0.7.0"
branch: "feat/041-flow-conformance-eval"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-01T01:51:43.616Z"
agent: "agent"
plan_id: "047-session-telemetry-dashboard"
schema_version: "1.1"
retro_id: "2026-07-01T01:52:00Z-agent-047p1"
started_at: "2026-06-28T22:08:46.459Z"
ended_at: "2026-07-01T01:52:00Z"
summary: "Plan 047 Phase 1 (SessionExport combine + `telemetry session save`) post-coding drain — 2 entries: a cross-session harness-checks friction leftover, and the runtime-proof insight the principal surfaced."
entries:
  - id: DL-001
    kind: difficulty
    description: "packet said 'harness checks --quick' but installed dist has no --quick flag; full 'harness checks' runs vitest --coverage which times out 2 unrelated integration tests (app telemetry kill-switch, exec-git-write push) at 5000ms — both pass clean under plain 'npx vitest run' (1549/1549)"
    target: harness-itself
    severity: degrading
    workaround: "run plain `npx vitest run` for the affected integration tests; treat the coverage-run timeout as environmental, not a real failure"
    suggested_encoding: "either add the `--quick` flag the flow-pair skill references, or fix the SKILL.md to name a real flag; raise the two integration tests' timeout under --coverage (they pass at default runner speed)"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-28T22:08:46.459Z"
  - id: INS-001
    kind: insight
    description: "Phase-1 tasks dossier was authored TDD-heavy and left real-artifact proof implied inside the CLI-wiring task; principal caught that green fixtures don't prove the actual 'session save' command produces a sane export over real, messy spool data. Added an explicit live-smoke task (T008): run the real command against >=2 live sessions from .harness/temp/telemetry, schema-validate + eyeball counts/identity/degraded cells/no-leak, made it a hard phase done-when. Encoding candidate: tasks-stage should default to a live-smoke done-when for any verb that emits an artifact, so runtime proof isn't left to inference."
    target: harness-itself
    severity: annoying
    workaround: "added T008 by hand this phase"
    suggested_encoding: "the-flow tasks stage: default a live-smoke done-when (run the real verb against real data + inspect the artifact) for any task that ships a new artifact-emitting CLI verb, so runtime proof isn't left to inference"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-01T00:45:13.446Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — Plan 047 Phase 1 (Session Export Foundation)

Two entries drained at the Phase-1 post-coding seam:

- **DL-001** (cross-session leftover, first seen 2026-06-28) — a **harness-itself** friction: the `harness checks --quick` flag referenced by the flow-pair skill doesn't exist on the installed `dist`, and the full `harness checks` (`vitest --coverage`) times out two *unrelated* integration tests (app telemetry kill-switch, exec-git-write push) at 5000ms that pass clean under plain `npx vitest run`. This IS the harness repo → encodable as a local source fix (add/rename the flag + raise the two tests' coverage-run timeout).
- **INS-001** (this session) — the runtime-proof insight: TDD-only left real-artifact proof implied; the fix was a first-class **live-smoke done-when** (T008). Encoding candidate: make that the the-flow `tasks`-stage default for any artifact-emitting verb.

Both `target: harness-itself` and this **is** the harness repo, so the encoding route is a local source edit (not an upstream issue) — carried as follow-up candidates, not landed this session.
