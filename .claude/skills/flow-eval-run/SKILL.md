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

## Two committed scenario variants — pick the question first

| Scenario | Packet | Measures | Base ref |
|---|---|---|---|
| `md-to-pdf` | fully blind (no method) | **ambient adoption** — does the subject reach for the flow unprompted? | old tag (capability-only; telemetry lane blind by design) |
| `md-to-pdf-flow` | `/the-flow` MANDATED, only that | **flow fidelity + stage economics** — is the flow driven honestly, what does each stage cost? | current-code sha (telemetry lane fully live; harness-loop conduct scored deterministically) |

The variant decides the drive style too: the mandated variant takes **no stage
nudges** (the subject's own cadence is scored) and the orchestrator answers flow
gates under the **fixed gate-conduct policy** in its `prompts/orchestrator.md`.

## The loop (≈6 beats)

1. **Pick or scaffold a scenario** under `live-testing/scenarios/<slug>/`
   (`harness flow-eval scaffold --slug <slug>`), then **hygiene**: remove stale
   eval worktrees/branches (`git worktree list` → remove + prune) — a fresh
   subject will correctly *resume* leftover plans it finds (F12).
2. **Cut the subject worktree at `scenario.json → base.ref` yourself**, then
   **spawn the subject peer from INSIDE it** — `(cd "$WORKTREE" && pij spawn …)`
   — so the shared main checkout is mechanically out of reach (a packet
   instruction alone failed 1-in-4 live). Canary-verify the model (footer +
   reply-over-pij), then deliver the stripped packet + worktree line + the
   standing comms contract (control-plane peers push nothing unless told:
   append "reply via `pij send <orch-id>`" to EVERY send — it does not survive
   the subject's compactions).
3. **Let it run** to completion in its worktree; capture its `pij` id. Answer
   task-scope questions and flow gates per the runbook's gate-conduct policy;
   never nudge toward scored behaviors.
4. **Score it**: `harness flow-eval score --scenario <slug> --session <pij-id> --worktree <path>`
   (add `--subject-harness/-model/-effort` + `--base-ref <ref>` when the real subject/base
   differs from `scenario.json`'s defaults; add `--resolve <id>=<command>` for each
   subject-specific placeholder `command-succeeds` assertion — resolve per-run, never edit
   the committed `assertions.json`; the placeholder ids are per-scenario — `A7`/`A8` in
   `md-to-pdf`, `A8`/`A9` in `md-to-pdf-flow` — read the scenario's own runbook).
5. **Read the report** at `.harness/live-testing/<slug>/<run-id>/report.{json,md}`;
   fill any `judged` fields, note the two-axis scores + any `mimicry` alarm. For
   fidelity-class judged fields, cross-check the flight plan + telemetry against
   the subject's raw session events (skill capture can gap on sparse-command
   copilot sessions — an A-skill fail is honest-per-evidence, not always
   subject fault) and separate new-since-base artifacts from inherited ones
   (`git status` in the worktree).
6. **Re-render after filling judged fields**:
   `harness flow-eval render --scenario <slug> --run <run-id>` regenerates `report.md`
   from the filled `report.json` (idempotent; no telemetry; the ledger is append-only).
   Then, before teardown: **sync telemetry FROM the worktree** (`harness telemetry
   sync` there — the buffer is per-clone and dies with the worktree), kill any
   process still holding the worktree (headless Chrome, vitest), `pij close` the
   subject, and `git worktree remove --force` + branch delete + prune.

## One worked invocation (md→PDF)

```
harness flow-eval score --scenario md-to-pdf --session pij-abc123 --worktree /path/to/subject/worktree --resolve A7='node harness/cli/dist/index.js <new-verb> --help' --resolve A8='<pdf-validator-cmd>'
# → .harness/live-testing/md-to-pdf/<run-id>/report.{json,md}
harness flow-eval render --scenario md-to-pdf --run <run-id>   # re-render report.md after filling judged fields
harness flow-eval supersede --scenario md-to-pdf --run <stale-run-id> --by <corrected-run-id>  # only if you re-scored the session
```

## Running the `harness` bin

- **In THIS repo** (the harness's own home), call the bin directly:
  `node harness/cli/bin/harness.js flow-eval …` (per `AGENTS.md` — don't `npx` the
  repo's own bin).
- **In a consumer repo** (harness installed as a dep): `npx --no-install harness flow-eval …`.

## Notes

- The subject stays blind to everything scored: assertions live in
  `live-testing/scenarios/<slug>/assertions.json`, never in the subject packet.
  (`md-to-pdf-flow` names `/the-flow` deliberately — that mandate is the variable
  under test, not a leak; everything else stays hidden.) `score` reads evidence +
  worktree; it does not produce them.
- **Reading the numbers** (axes, Wilson CIs, pass^k, McNemar, seed tuples, honest
  unknowns): [`docs/how/flow-conformance-eval.md`](../../../docs/how/flow-conformance-eval.md)
  § Reading the numbers, with a plain-language companion at
  [`docs/how/flow-conformance-eval-explainer.html`](../../../docs/how/flow-conformance-eval-explainer.html).
- A `FAIL` verdict is a **successful** evaluation that found non-conformance, not a tool error.
- **Analysis pages are generated, never hand-transcribed.** When writing a
  cross-run comparison (HTML or md), every number in a table flows from a
  single data block (tuples/JSON at the top of a generator script) into the
  markup — the LLM never hand-places `<td>` cells. A hand-authored batch-2
  table shipped with two swapped cells (cost↔tools) that the author had
  half-noticed and papered over with a caveat sentence instead of fixing;
  generation makes that failure class impossible. After generating, run one
  transposition spot-check: extract a row and eyeball the cells against the
  source tuple. Same rule the telemetry-insights pipeline enforces with its
  origination smoke test — eval reports get the discipline even without the
  test. And start every report file with `<meta charset="utf-8">` — copies
  opened via `file://` render em-dashes as `Â`-mojibake without it (bit both
  batch-2 and batch-3 reports).
- This skill is meant to be **iterated after each real run** — when a beat needs
  tribal knowledge, fix it here (a line) or in the extension's `instructions.md`.
