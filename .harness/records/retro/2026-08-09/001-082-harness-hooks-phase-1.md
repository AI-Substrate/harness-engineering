---
schema_version: "1.2"
retro_id: "2026-08-09T14:35:59Z-agent-082p1"
agent: agent
plan_id: 082-harness-hooks
started_at: "2026-08-09T12:31:20.079Z"
ended_at: "2026-08-09T14:35:59Z"
summary: "retro --drain session-end save (2 entries) — plan 082 phase 1, the commit-attribution guard"
entries:
  - id: DL-001
    kind: difficulty
    target: harness-itself
    severity: degrading
    fp: bfd7a291aafe
    first_seen_at: "2026-08-09T12:31:20.079Z"
    disposition: task
    description: >-
      harness plan new scaffolds only 6 of the 20 schema-declared plan sections, and neither
      dd set nor dd add can create a seventh (E450 section-unknown) — so risks/key_findings/
      gate_matrix/execution_guardrails/testing_strategy have NO CLI route into an existing plan.
      Plan 081 has all 20, so the shape is legal; the writer just cannot reach it. Blocks writing
      a complete plan without hand-editing plan.dd.json, which the doctrine forbids.
    workaround: >-
      Hand-edit plan.dd.json to add the missing section object, then use dd add to append rows
      into it. The doctrine forbids the hand-edit, so the workaround is itself a violation —
      which is the strongest possible argument that the CLI route is missing rather than obscure.
    suggested_encoding: >-
      Either scaffold all 20 sections at `harness plan new` (empty arrays are cheap and make the
      shape discoverable), or let `harness dd add` create a schema-declared section on first write
      rather than rejecting it with E450. The second is smaller and fixes the general case.
    system:
      compound:
        status: open
  - id: DL-002
    kind: difficulty
    target: project-sensor
    severity: degrading
    fp: 10230faea671
    first_seen_at: "2026-08-09T13:30:47.510Z"
    disposition: plan
    description: >-
      The live Cursor hook on this machine points at scratch/attrib-probe/*.mjs in the MAIN
      checkout. scratch/ is untracked working space — if it is cleaned, every Cursor tool call
      silently runs a failing command against a missing file. This is the concrete argument for
      the installer writing an absolute, QUOTED path to a STABLE installed binary rather than a
      source path, and for hooks status to prove the target still resolves instead of assuming it.
    workaround: >-
      None available from inside the hook: hook failures exit 0 by design, so a broken hook and a
      working hook are indistinguishable from the agent's side. The only detection is to stat the
      configured target from outside.
    suggested_encoding: >-
      `harness hooks status` STATS its configured binary path and reports UNRESOLVABLE distinctly
      from ABSENT — already written into plan 082 phase 2 as a task, with the unresolvable case
      asserted explicitly rather than left as a happy-path check.
    system:
      compound:
        status: suggested
        resolved_by: "docs/plans/082-harness-hooks/assets/tasks/phase-2/tasks.dd.json — the status-must-stat-its-target task"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — plan 082 phase 1 (the commit-attribution guard)

Two entries, both proof-gaps rather than annoyances, and both already carried forward
into work rather than left as prose.

**DL-001 is friction with the harness product itself, and this IS the harness repo** — so
it routes to a local source fix, not an upstream issue. The shape of the defect is worth
keeping: the schema declares 20 plan sections, a real plan (081) carries all 20, and the
writer path can reach only 6. Nothing is *wrong* in the data model; the CLI surface just
does not cover it, and the only way through is the one edit the doctrine forbids. Filed as
a task rather than fixed in-flight because it is a CLI change with its own tests, not a
one-line convenience.

**DL-002 is the same silent-failure class this whole plan exists to close, arriving from the
other side.** The plan's own premise is that a hook which fails must never claim success —
and the live hook on this machine is currently a config entry pointing at untracked scratch
space, which is exactly a hook that would fail silently. It is already a phase 2 task with
the unresolvable case asserted, so its disposition is `plan`, not `kept`.

**The win beat.** The harness was effective here in a way worth recording: the observe buffer
survived a context compaction intact, so neither entry had to be re-derived from memory —
which is precisely the crash-resilience the capture design claims and the first time this plan
has actually leaned on it.
