# Orchestrator runbook — md-to-pdf-flow

How the **orchestrator** drives one evaluation run of the `md-to-pdf-flow`
scenario: spawn a subject with the flow MANDATED, let it drive `/the-flow`
itself, then score the finished session with `harness flow-eval`. This is the
**flow-fidelity + stage-economics** variant of `md-to-pdf`: the subject is told
*to* use the flow (never *how*), so the process lane (A1–A5, A10, A11) is
genuinely scoreable — including the eng-harness loop's own conduct as
DETERMINISTIC rows (A14 `harness observe` ran; A11 retro drained verb+record;
A15 the retro record artifact), so suggested retro items and observations are
read from evidence by the report/insight layer, never from subject prose — and
stage semantics land in telemetry — time and tokens
become attributable to planning vs coding vs reviewing.

> **The evaluator never drives pij.** `harness flow-eval score` only *reads* a
> finished session's telemetry + worktree. The driving below is done by **you,
> the orchestrator**, in the shell.

## What differs from `md-to-pdf` (read that runbook for the shared mechanics)

- **The packet names `/the-flow`** — that is the variable under test, not a leak.
  Everything else (stages, sibling skills, backpressure, flight-plan mechanics)
  stays hidden; the reviewer-gate checklist in `prompts/subject.md` is adjusted
  accordingly.
- **The subject owns its own cadence.** Do NOT nudge stages — A2 (stage order)
  and A5 (compaction) score the subject's own conduct of the flow. Cadence
  nudges here would contaminate exactly what this scenario measures.
- **The base ref is CURRENT-code** (`scenario.json` → `base.ref`, a pinned sha on
  the 041 branch), not an old release tag: env-capture (`PIJ_SESSION_ID`), skill
  events, and the copilot skill-stream fix must all be in the worktree's harness
  or the telemetry lane goes blind (the `md-to-pdf` 2026-07-03 batch proved this
  the hard way). When re-pinning, verify the new ref carries
  `captured_env`/`PIJ_SESSION_ID` capture before running.

## Step-list

0. **Hygiene, then pre-create the subject worktree at the pinned base.** Clean any
   stale eval worktrees/branches first (F12 — stale plans contaminate a fresh
   subject, which will correctly *resume* them):

   ```
   REPO="$(git rev-parse --show-toplevel)"
   git worktree list        # remove + prune anything md-to-pdf-* left behind
   WORKTREE="$REPO/.worktrees/md-to-pdf-flow-<tag>-$(date +%Y%m%d-%H%M%S)"
   git worktree add "$WORKTREE" <base.ref from scenario.json>
   ```

1. **Spawn the subject** per the matrix knob (`pij spawn --harness <h> --model <m>
   --effort <e>`), capture `$SUBJECT`.

2. **Canary-verify the model** — a footer check plus a reply-over-pij ping. A
   wrong `--model` is accepted silently at spawn; the canary is load-bearing.

3. **Deliver the packet** — above-the-divider content of `prompts/subject.md`
   only, then the worktree assignment, and ALWAYS the comms contract (F18 — a
   control-plane peer's pane output does not reach you; only `pij send` does,
   and compaction wipes one-time instructions, so restate it on every send):

   ```
   pij send $SUBJECT "$(sed '/REVIEWER-ONLY/,$d' live-testing/scenarios/md-to-pdf-flow/prompts/subject.md | sed '/<!--/,/-->/d')

   NOTE ON THE WORKTREE: it has already been created for you at $WORKTREE (checked out at the pinned base ref). Do ALL of your work there.

   COMMS CONTRACT (standing): I am the orchestrator, pij id <your-pij-id>. I only receive what you explicitly push. At every gate reply with: pij send <your-pij-id> \"<message>\"."
   ```

4. **Let it run — and stand in as the human at flow gates.** No stage nudges
   (see above), but the guided flow is DESIGNED to pause for human input
   (print-then-offer, plan clarifiers, complexity classification, validate
   confirms), and in this scenario the orchestrator IS that human. Asking and
   getting input is officially part of the test. Fixed gate-conduct policy —
   pinned so run-to-run comparability never leaks through orchestrator behavior:

   - **Step offers** ("plan ready — proceed to X?"): always accept — reply
     "proceed" (or the gate's own affirmative). Never pick WHICH step comes next.
   - **Requirement clarifiers** (scope, what counts as done, target users):
     answer substantively, task-scope only, consistent with the scenario task
     paragraph. Same answers to every subject.
   - **Method options** (libraries, pipeline choices, validation design,
     Simple-vs-Full, option menus): "your call — proceed as you normally would."
     Never choose.
   - **Scored behaviors** (backpressure survey, retro drain, compaction, seam
     actions): never prompt toward them; if the subject's own flow surfaces one
     and asks, the neutral "your call" line above applies (keeps A3/A4/A5,
     A11–A13 honest).
   - Every reply restates the F18 comms contract line.

   Whether a subject surfaces gates at all is itself signal (a guided flow with
   zero human pauses is evidence toward A13 mimicry/hollowness — weigh it, don't
   assume it). Decline "how" questions outside the gate protocol as before. Let
   the daemon's pushes wake you — do not poll.

   > **Pending packet addition (apply AFTER the 2026-07-03 batch is scored —
   > `prompt_hash` is recorded at score time, so editing `subject.md` mid-batch
   > would misrecord what those subjects received):** add to the packet's pij
   > protocol list: *"5. **Route a pause** — if your flow pauses for human
   > input/confirmation, send that gate to the orchestrator and wait for the
   > reply."* Then delete this callout.

5. **On DONE, collect coordinates** (`$SUBJECT`, `$WORKTREE`) and **score**:

   ```
   harness flow-eval score --scenario md-to-pdf-flow --session $SUBJECT --worktree $WORKTREE \
     --subject-harness <h> --subject-model <m> --subject-effort <e> \
     --resolve A8='node harness/cli/bin/harness.js <new-verb> --help' \
     --resolve A9='<the real PDF-validator command the subject reported>'
   ```

   `placeholder_policy: unknown` means a forgotten `--resolve` scores `unknown`,
   never a raw exec — but pass both anyway; A8 is required.

6. **Fill the judged fields, cross-checked against telemetry, then re-render.**
   - `A12 backpressure_quality`: inspect the validator the subject actually built.
   - `A13 flow_fidelity`: diff the flight plan's story against the telemetry
     timeline — nav/status progression vs skill events and command timecodes.
     Hand-authored `the-flow.json`, narrated router envelopes, or artifacts
     back-filled after the code all score at most PARTIAL. This is the mimicry
     gate; be adversarial.

   ```
   harness flow-eval render --scenario md-to-pdf-flow --run <run-id>
   ```

7. **Stage economics (the payoff).** After scoring, pull the session's telemetry
   and attribute time/tokens to flow stages — skill events give the stage
   boundaries; segments give the per-window costs:

   ```
   harness telemetry get $SUBJECT --worktree $WORKTREE
   harness telemetry session save <harness-session-id> --source git-ref --out <dir>/<tag>.session.json
   harness telemetry report <dir> --out <reports>/<tag> --name <tag>
   harness telemetry insights <reports>/*.report.json --out <insights-dir>
   ```

   With a current-code base the insights `stage_economics` / `skill_breakdown`
   sections populate natively — that is this scenario's reason to exist.

8. **Preserve telemetry before teardown**: run `harness telemetry sync` FROM THE
   WORKTREE (its buffer is per-clone and dies with it).

9. **Tear down** (F12, both halves): kill any process still holding the worktree
   (headless-Chrome/vitest children — `pkill -f "$WORKTREE"`), `pij close
   $SUBJECT`, `git worktree remove --force "$WORKTREE"`, delete the run branch,
   `git worktree prune`.

## Judge scaffold

Use only verified artifacts (report.json/report.md, deterministic result rows,
session-export.json, and worktree artifacts). Do not feed subject prose,
transcript text, identity hints, or self-report into the judge.

Score each configured criterion after concise evidence notes, then choose
pass | fail | unknown. The canonical good-flow anchor slot is intentionally
present but deferred until the human-gold calibration set lands.
