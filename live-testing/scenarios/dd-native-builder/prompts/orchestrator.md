# Orchestrator runbook — dd-native-builder

How the **orchestrator** drives one evaluation run of the `dd-native-builder`
scenario: spawn a BLIND subject with the builder mandated, let it discover the
dd-native flow itself, then score the finished session with `harness flow-eval`.

Read the `md-to-pdf-flow` runbook first for the shared mechanics (worktree
pre-creation, `--subject-*` honesty flags, telemetry sync before teardown,
`--resolve` for per-run placeholders). Only the differences are recorded here.

> **The evaluator never drives pij.** `harness flow-eval score` only *reads* a
> finished session's telemetry + worktree. The driving below is done by **you,
> the orchestrator**, in the shell.

## What this scenario is actually measuring

Not "can an agent write a plan". Whether the dd-native builder **teaches itself**
to a subject that has never seen it, and whether its **gates do any work**.

Those are different questions and the assertions separate them. A2–A6 ask whether
the artifacts came out in the shape the design intends. A10 asks whether the
subject was ever *stopped* — and that is the assertion this scenario exists for.
A run that produces a beautiful corpus while never once hitting a refusal has
demonstrated that the subject stayed ahead of the gates, not that the gates work.

## What differs from the other scenarios

- **The packet names `/builder` and nothing else.** No mention of dd, of
  `plan.dd.json`, of `pressure`, of gates, of the writer verbs. Every one of those
  is what the run is measuring the discoverability of. A packet that named them
  would score the subject's reading comprehension instead.
- **The subject picks its own capability.** There is no fixed task, because the
  variable under test is the FLOW, and a fixed task invites us to score the
  feature. Scope guidance ("one phase, finish it") is in the packet; nothing else.
- **The base ref must include this plan's own code** (`scenario.json` →
  `base.ref`). The dd-native authoring path, the gate kinds, and — critically —
  tk-7169's `command_exit` error-code capture all have to be in the subject's
  worktree, or A10 cannot be answered even when a refusal really happened. When
  re-pinning the ref, verify it carries the refusal capture before running.
- **A11 carries a placeholder.** Its `cmd` is the bare token
  `SUBJECT_PLAN_VALIDATE_COMPLETE`, resolved per-run because only the subject
  knows where its plan landed. `placeholder_policy: "unknown"` then makes an
  unresolved placeholder score `unknown` rather than a silent pass.

  A placeholder must be the WHOLE `cmd` and a screaming-snake token — an embedded
  `${VAR}` inside a real command line is not recognised as a placeholder, so it is
  executed literally and scores a spurious FAIL. This scenario was authored with
  that mistake and a dry score caught it; if you add another placeholder, dry-score
  the bundle before running a subject against it.

## Reading the result honestly

Per Jordan's standing ruling this scenario is **run once and reported as it
came**. Do not iterate the subject, re-prompt it toward a better score, or re-run
until it looks good. A poor score here is a finding about the builder, which is
the thing being evaluated — the subject is the instrument, not the candidate.

Two results are worth more than a pass:

- **A10 fails** (no refusal). Either the subject never reached a gate, or a gate
  that should have fired did not. Both are findings; check the flight plan's
  `dd_link` nodes before concluding which.
- **A9 fails** (`dd doctor` dirty). Something was hand-edited, and the drift is
  the proof. Worth tracing to the exact document, because it tells you which
  surface failed to teach that it is the writer.

## Step-list

Identical to `md-to-pdf-flow` except:

0. Pin `base.ref` to a sha carrying this plan's phase-1 and phase-2 code, and
   confirm `command_exit` error-code capture is present in that worktree.
1. Spawn the subject with `prompts/subject.md` verbatim. Do NOT answer method
   questions — the packet's protocol allows task-scope questions only, and
   answering a method question destroys the measurement.
2. When the subject reports: **SCORE FIRST, then sync, then snapshot, then
   close.** This is a two-constraint order and each constraint was learned
   by losing the thing it protects (run 1, 2026-08-05): `telemetry sync`
   EMPTIES the worktree buffer the scorer reads — sync-before-score blinded
   the whole telemetry lane (A1/A7/A8/A10 unknown) even though every
   segment carried the join key; and `pij close` destroys the seat
   descriptor the cost/ledger join needs — close-before-snapshot forfeits
   the run's cost accounting. Also pin the SKILL SURFACE, not just the CLI
   ref: run 1's subject loaded the machine-deployed builder (weeks stale),
   because a base sha pins code, not skills — copy the branch's
   `skills/builder` into the worktree's `.claude/skills/` (project skills
   win) or deploy before the run, and record which you did.
3. Score:

   ```bash
   harness flow-eval score --scenario dd-native-builder \
     --session <pij-session-id> \
     --worktree <subject worktree> \
     --resolve SUBJECT_PLAN_VALIDATE_COMPLETE="node harness/cli/bin/harness.js plan validate <the subject's plan.dd.json> --complete"
   ```

4. Fill the judged lane (`explanation-matches-telemetry`), render, and ledger the
   run — including a poor one.
