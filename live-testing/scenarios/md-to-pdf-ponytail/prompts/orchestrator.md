# Orchestrator runbook — md-to-pdf-ponytail

How the **orchestrator** drives one evaluation run of the `md-to-pdf-ponytail`
scenario: spawn a subject with **`/ponytail full` MANDATED**, let it work under
the doctrine itself, then score the finished session with `harness flow-eval`.
This is the **disciplined-minimalism** variant of the md→PDF family — the third
cohort alongside `md-to-pdf` (blind / ambient adoption) and `md-to-pdf-flow`
(full SDD process). Same task, same pinned base, one swapped mandate: the three
cohorts triangulate what process buys and what minimalism costs (or saves).

> **The evaluator never drives pij.** `harness flow-eval score` only *reads* a
> finished session's telemetry + worktree. The driving below is done by **you,
> the orchestrator**, in the shell.

## What differs from the sibling runbooks (read `md-to-pdf-flow` for shared mechanics)

- **The packet names `/ponytail` + `full`** — that is the variable under test,
  not a leak. Everything else (ladder rungs, `ponytail:` markers, the
  one-runnable-check rule, sibling skills, backpressure design) stays hidden;
  the reviewer-gate checklist in `prompts/subject.md` is adjusted accordingly.
- **No process nudges of ANY kind.** Whether the subject also reaches for
  the-flow, the harness loop, observes, retros, or compacts is observational
  (A2–A5, A9–A12) — the interesting question is what a minimalism mandate does
  to ambient process adoption.
- **Resolve ids here are A7/A8** (extension help / PDF validator) — NOT A8/A9 as
  in `md-to-pdf-flow`. Per-scenario ids differ; read this runbook, not memory.
- **The base ref is CURRENT-code** (`scenario.json` → `base.ref`, same pinned
  sha as `md-to-pdf-flow`) so telemetry, skill events, and env-capture are live
  and the cohort is same-base comparable with batch 2.
- **Judged fidelity is diff-forensic, not flow-forensic.** A13 is judged from
  the diff, dependency delta (`git diff <base> -- package.json` etc.), and file
  count against what the task strictly needed — pull `git diff --stat`, the dep
  delta, and grep for `ponytail:` markers as evidence before filling it.

## Step-list

0. **Hygiene, then pre-create the subject worktree at the pinned base.** Clean
   any stale eval worktrees/branches first (F12):

   ```
   REPO="$(git rev-parse --show-toplevel)"
   git worktree list        # remove + prune anything md-to-pdf-* left behind
   WORKTREE="$REPO/.worktrees/md-to-pdf-ponytail-<tag>-$(date +%Y%m%d-%H%M%S)"
   git worktree add "$WORKTREE" <base.ref from scenario.json>
   ```

1. **Spawn the subject FROM INSIDE ITS WORKTREE** per the matrix knob:

   ```
   (cd "$WORKTREE" && pij spawn --harness <h> --model <m> --effort <e>)
   ```

   The cwd boundary must be **mechanical, not textual** (observed live
   2026-07-03: one of four subjects worked in main despite the packet naming its
   worktree twice).

2. **Canary-verify the model** — footer check plus a reply-over-pij ping. A wrong
   `--model` is accepted silently at spawn; the canary is load-bearing.

3. **Deliver the packet** — above-the-divider content of `prompts/subject.md`
   only, then the worktree assignment, and ALWAYS the comms contract (F18 —
   restate "reply via `pij send <orch-id>`" on EVERY send; compaction wipes
   one-time instructions).

4. **Let it run.** The fixed gate-conduct policy applies unchanged (step offers →
   "proceed"; requirement clarifiers → substantive, task-scope, identical across
   subjects; method options → "your call"; never prompt toward scored behaviors).
   Ponytail's doctrine tells the subject to default rather than stall, so expect
   few or zero gates — zero gates is normal here, not a mimicry signal (unlike
   the flow variant). Let the daemon's pushes wake you — do not poll.

5. **On DONE, collect coordinates and score:**

   ```
   harness flow-eval score --scenario md-to-pdf-ponytail --session $SUBJECT --worktree $WORKTREE \
     --subject-harness <h> --subject-model <m> --subject-effort <e> \
     --resolve A7='node harness/cli/bin/harness.js <new-verb> --help' \
     --resolve A8='<the real PDF-validator command the subject reported>'
   ```

   `placeholder_policy: unknown` — a forgotten `--resolve` scores `unknown`,
   never a raw exec; pass both anyway, A7 is required.

6. **Fill the judged fields (A13 `ponytail_fidelity`, A14 `backpressure_quality`),
   evidence-first, then re-render.** For A13 gather BEFORE judging:
   `git -C "$WORKTREE" diff --stat <base.ref>..HEAD`, the dependency delta, new
   file count, `grep -rn "ponytail:" <new files>`, and whether one runnable check
   exists. Judged rows are `(assertion × judge.criteria)` — e.g.
   `A13.ladder-adherence` — fill per-criterion ids, not the params.field name
   (SUGG-005). Cross-check A1 skill capture against raw session events on
   copilot-claude subjects before trusting a fail (DL-003).

   ```
   harness flow-eval render --scenario md-to-pdf-ponytail --run <run-id>
   ```

7. **Cost economics (the payoff).** Pull telemetry per subject and compare
   against the batch-1 (blind) and batch-2 (flow) cohorts on the same base:
   AIC/tokens/wall, dep delta, diff size, validator quality. There are no flow
   stage boundaries here — the comparison axis is total-cost + capability +
   verification quality, with the flow cohort's stage economics as the contrast.

   ```
   harness telemetry get $SUBJECT --worktree $WORKTREE
   harness telemetry session save <harness-session-id> --source git-ref --out <dir>/<tag>.session.json
   harness telemetry report <dir> --out <reports>/<tag> --name <tag>
   ```

8. **Preserve telemetry before teardown**: `harness telemetry sync` FROM THE
   WORKTREE (its buffer is per-clone and dies with it).

9. **Tear down** (F12, both halves): `pkill -f "$WORKTREE"` for lingering
   children, `pij close $SUBJECT`, `git worktree remove --force "$WORKTREE"`,
   delete the run branch, `git worktree prune`.

## Judge scaffold

Use only verified artifacts (report.json/report.md, deterministic result rows,
diff/dependency evidence, worktree artifacts). Do not feed subject prose,
transcript text, identity hints, or self-report into the judge. Minimalism
claims need diff evidence — prose about simplicity is exactly what A13's FAIL
band (vocabulary decoration) exists to catch.
