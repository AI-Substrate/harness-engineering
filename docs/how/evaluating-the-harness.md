# Evaluating the harness

We evaluate the harness by running a peer agent through real work, watching it
two ways at once, turning the evidence into a verdict, and feeding the findings
back into the harness. Then we do it again.

This page is a map, not a manual. The operating details live in the
[`flow-eval` briefing](../../.harness/extensions/flow-eval/instructions.md),
the [`flow-eval-run` skill](../../.claude/skills/flow-eval-run/SKILL.md), the
[scenario authoring guide](./flow-conformance-eval.md), and the design
workshops linked below.

## Why

The harness is useful only if its real behaviour can be proved. A green-looking
agent run is not enough: the question is whether the agent actually used the
flow, hit the harness seams, produced the requested artifact, left a readable
trail, and exposed the gaps that should become better harness backpressure.

That makes evaluation part of the harness loop itself. It is not a CI gate and
not a model leaderboard; it is the harness dogfooding its own ability to make
work observable, repeatable, and improvable. The principle is the same one used
throughout this repo: encode proof and learning in the project, not in chat
memory. See the underlying
[first principles](../../harness-foundations/first-principles.md).

## Run a peer

The subject is a blind peer agent. It gets the task and a reporting contract,
but not the assertions, scoring rules, or hidden method. The orchestrator drives
the cadence over pij or `/flow-pair`; the scorer does not drive anything.

In one line:

| Actor | Job |
|---|---|
| Subject | Does the real task in its own worktree. |
| Orchestrator | Spawns the peer, canary-checks it, drives cadence, and later scores. |
| `harness flow-eval` | Reads finished evidence and writes `report.json`, `report.md`, and the ledger line. |

Use the [`flow-eval-run` skill](../../.claude/skills/flow-eval-run/SKILL.md) as
the front door. It routes peer orchestration to `/flow-pair` and scoring details
to the extension briefing; it deliberately does not become another manual. For
the fuller runtime picture, read the
[end-to-end workshop](../plans/041-flow-conformance-eval/workshops/002-eval-system-end-to-end.md).

## Watch it two ways

Every run is watched by the data and by a judge, with the data as the backbone.

```text
peer agent doing real work
        |
        +-- the data watching
        |     telemetry, harness records, filesystem, command results
        |
        +-- the LLM watching
              artifact-only judged prompts for subjective quality checks
```

The data stream proves what happened: skills called, flow seams fired, harness
verbs run, checks executed, files created, forbidden states avoided, and commands
that succeeded or failed. Telemetry can also tell us what it cannot prove; those
lanes become `unknown`, not fake failures.

The LLM stream is subordinate. Hardened judged fields are decomposed into named
criteria, use artifact-only prompts, strip identity hints, and are recorded with
judge provenance. They can help assess quality, but they do not cap the run
verdict and they must not rely on subject prose, chat transcript, or self-report.

The mechanics are in the
[`flow-eval` briefing](../../.harness/extensions/flow-eval/instructions.md) and
the [hardening decisions](../plans/041-flow-conformance-eval/workshops/003-eval-hardening-applied-decisions.md).

## Evaluate

The scorer turns those streams into a report. Deterministic assertions resolve
to `pass`, `fail`, or `unknown`; judged fields are left for the operator to fill
against artifacts.

The important shape is:

| Signal | What it tells us |
|---|---|
| Capability axis | Did the artifact actually work? Required capability and safety failures can cap the verdict. |
| Process axis | Did the subject follow the intended harness/flow ritual? Process failures inform, but do not cap. |
| Mimicry alarm | High process score with low capability score: the agent performed the ritual but did not deliver. |
| Match modes | Sequence checks can be strict, superset, subset, or unordered, with arg overrides for volatile paths. |
| Forbidden state | Safety assertions prove the subject did not leave banned files or skip required state. |

Each completed score also appends one run record to the scenario ledger. The
ledger is what makes this more than a one-off verdict: `harness flow-eval ledger`
can list runs, show lane flips, compare subjects, and report `pass^1`,
`pass^k`, Wilson intervals, McNemar pairing, and cost columns from telemetry
session-save totals. The detailed storage and comparison model lives in
[workshop 004](../plans/041-flow-conformance-eval/workshops/004-run-storage-and-comparison.md).

## Feed it back

The eval is useful only when it improves the harness or the eval process. Both
actors observe:

| Stream | Feeds back into |
|---|---|
| Subject observations and retro | Missing docs, unclear commands, weak harness affordances. |
| Orchestrator findings | Runbook, skill, prompt, or control-plane improvements. |
| Deterministic report and ledger | Regression signals, model comparisons, and weak sensors. |

The rule is the normal harness rule: a repeated finding should become a command,
check, fixture, diagnostic, prompt contract, clearer error, or stronger sensor.
Do not leave it as "remember to". The full loop is captured in
[workshop 005](../plans/041-flow-conformance-eval/workshops/005-the-eval-improve-loop.md).

## See it run

Run 003 is the worked example. A blind Claude subject on the md-to-PDF scenario
went through explore, plan, validate, compact, implement, and review; the run
also exposed real harness-eval findings. One of them, F18, showed that a
control-plane peer does not automatically push message content back to the
orchestrator, so every orchestrator message needs an explicit `pij send` report
contract. That finding became eval-process guidance instead of disappearing into
the chat.

Read the
[run-003 experience log](../plans/041-flow-conformance-eval/experience-logs/003-md-to-pdf-claude-sonnet46.md)
alongside the
[md-to-PDF scenario](../../live-testing/scenarios/md-to-pdf/scenario.json). The
run artifacts land under `.harness/live-testing/<scenario>/<run-id>/`; the
scenario ledger sits at `.harness/live-testing/<scenario>/ledger.jsonl`.
