---
name: flow-eval-run
description: |
  Start a peer-driven flow-conformance eval run with zero archaeology: pick or
  scaffold a scenario, spawn a BLIND subject peer to do the task, then score the
  finished session with `harness flow-eval`. A map, not a manual — it routes peer
  orchestration to /flow-pair and the scoring semantics to the flow-eval
  extension's own docs. Use when someone says "run an eval", "score a flow run",
  "eval the harness", or "compare two models on the md→PDF scenario".
---

# /flow-eval-run

A **thin router** for the eval loop. It owns nothing itself — it points at the two
systems that do the work, and links the authoritative docs instead of restating them.

## The two routes (don't reinvent either)

- **Peer orchestration → `/flow-pair`.** Spawning/steering the subject (and any
  reviewer) peer, delegating a bounded packet, harvesting learnings — that is
  `/flow-pair`'s job. Invoke it; do not hand-roll `pij` orchestration here.
- **Scoring → `harness flow-eval` + its briefing.** The evaluator is the
  `flow-eval` extension. Its authoritative doc is
  [`.harness/extensions/flow-eval/instructions.md`](../../../.harness/extensions/flow-eval/instructions.md)
  — read it for lane/axis/verdict semantics. Two actions:
  - `scaffold --slug <slug>` — writes a ready-to-edit scenario skeleton under
    `live-testing/scenarios/<slug>/`.
  - `score --scenario <slug> --session <pij-id> [--worktree <path>]` — grades a
    **finished** session and writes `report.{json,md}`. It never drives pij.

## The loop (≈5 beats)

1. **Pick or scaffold a scenario** under `live-testing/scenarios/<slug>/`
   (`harness flow-eval scaffold --slug <slug>`; the committed example is `md-to-pdf`).
2. **Spawn a BLIND subject peer** — via `/flow-pair` (preferred) or `pij spawn` —
   and hand it only the scenario task + report contract (never the assertions).
3. **Let it run** the task to completion in its own worktree; capture its `pij` id.
4. **Score it**: `harness flow-eval score --scenario <slug> --session <pij-id> --worktree <path>`.
5. **Read the report** at `.harness/live-testing/<slug>/<run-id>/report.{json,md}`;
   fill any `judged` fields, note the two-axis scores + any `mimicry` alarm.

## One worked invocation (md→PDF)

```
harness flow-eval score --scenario md-to-pdf --session pij-abc123 --worktree /path/to/subject/worktree
# → .harness/live-testing/md-to-pdf/<run-id>/report.{json,md}
```

## Running the `harness` bin

- **In THIS repo** (the harness's own home), call the bin directly:
  `node harness/cli/bin/harness.js flow-eval …` (per `AGENTS.md` — don't `npx` the
  repo's own bin).
- **In a consumer repo** (harness installed as a dep): `npx --no-install harness flow-eval …`.

## Notes

- The subject stays blind: assertions live in `live-testing/scenarios/<slug>/assertions.json`,
  never in the subject packet. `score` reads evidence + worktree; it does not produce them.
- A `FAIL` verdict is a **successful** evaluation that found non-conformance, not a tool error.
- This skill is meant to be **iterated after each real run** — when a beat needs
  tribal knowledge, fix it here (a line) or in the extension's `instructions.md`.
