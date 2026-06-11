# `harness validate-harness-flow` — agent briefing

You are the **operator** of a dogfood self-test. The verb brings the
determinism — cloning, fan-out, polling, collection, deterministic probes —
and you bring the inference: judging whether a goal-briefed worker **actually
onboarded** the harness in each target repo, or merely echoed the motions.

## What this verb computes (the deterministic part)

- **Fire mode** (default): clones the target repos (default: express/Node,
  click/Python, cobra/Go — override with `--repo <urls...>`) into a temp root,
  then fires one **detached minih worker** per clone. Each worker gets a
  **goal brief, not a runbook**: "this clone has no harness — starting from
  the product repo's README, using the product's own docs and installed
  skills, set up a working engineering harness, prove it works, and record
  your experience." The full eng-harness skill surface is mounted (7 skills,
  parity with `.minih.json`); how the worker finds its way is exactly what
  the test measures. The verb returns IMMEDIATELY with run IDs + a manifest;
  the workers keep running after it exits.
- **Collect mode** (`--collect`): waits for each worker to reach a terminal
  state, classifies it (DONE / TIMED_OUT / MISSING_REPORT / NOT_FIRED), copies
  each DONE worker's artifacts into `<runsDir>/<repo>/` (worker `report.json`,
  harnessability `latest.md`/`latest.json`, every in-repo retro), runs
  **deterministic probes against each DONE clone**, and writes
  `<runsDir>/ROLLUP.md` — runs table, probes table, probe-vs-self-report
  discrepancy flags, merged magic-wand wishes + difficulty clusters.

## The probes (deterministic grading of the clone)

Graded per DONE clone — PASS/FAIL verdicts get the full set; ABANDONED runs
are graded on the assessment probe only (stopping there is the point);
TIMED_OUT / MISSING_REPORT / NOT_FIRED render `—`:

- an assessment report exists in the clone,
- `doctor --json` parses and conventions are clean (incl. temp hygiene),
- a `boot` verb exists and its envelope is honest (status/exit pair legal,
  `next_action` on every non-ok),
- a retro record exists with parseable frontmatter,
- the observe buffer is drained (0 pending),
- `temp/.gitignore` intact; no `.harness/temp/` in `git status`,
- **skills installed project-local in the clone** — a `.agents/skills/` /
  `.claude/skills/`-style dir contains `eng-harness-*` entries from both the
  setup and loop groups. The minih mount does NOT satisfy this: the clone
  must stand alone for the next agent that opens it.

Observe usage is reported as **INFO, not graded** — we watch how workers
discover the capture verb before grading discovery. That asymmetry is
deliberate: the skills-install requirement is explicit product intent; observe
discovery is still being measured.

**Reading a Skills-local ✗ (mount-suppression caveat):** the worker may never
have *needed* a project-local install because minih mounted the skills into
its session — a test-design artifact, not necessarily a product failure. Read
the worker's retrospective to tell them apart: did it not know skills should
be installed (product doc gap), or did it know and skip because they were
already available (mount suppression)?

## Your role (the inference part)

The rollup is **evidence, not a verdict**. After `--collect`, do a real review
pass — per repo, in this order:

1. **Read the probes table first** — it is the deterministic floor. Any ✗ is a
   finding to chase, and any **discrepancy row** means the worker's claims and
   the clone disagree — treat the clone as the truth and the claim as the
   finding.
2. **Read the work, not just the reports.** Open the clone (use `--keep` to
   retain it): does the `boot` extension wrap a command that genuinely proves
   THIS repo runs, or is it template echo? Run it if in doubt.
3. **Check the target repo's harness loop left residue** — the workers must be
   *practising* the loop, not just completing tasks. Verify each clone's
   `.harness/records/retro/` contains real retros, and that those retros carry
   **magic wands and other valuable feedback** (difficulties with layers and
   categories, improvement suggestions, confusions). An empty or perfunctory
   in-repo retro is a finding — report it even when the verdict says PASS.
4. **Separately, read the minih worker retros.** Each worker's farewell
   retrospective (in its `report.json` under `retrospective`, and in the minih
   run dir) is the **onboarding journey**: where it started, which docs it
   found, where it got lost, what it never discovered. This is a DISTINCT
   artifact from the in-target-repo harness retros in step 3 — do not conflate
   them. For a goal-briefed worker, the doc gaps reported here are the test's
   primary product — curate them as findings.
5. **Judge echo-vs-real per repo** and reach a verdict: did the onboarding
   genuinely succeed here? Cross-check the worker's self-reported `verdict`
   against the probes and steps 2–4 — a worker PASS with failing probes or
   empty retros is NOT a pass.

Everything surfaced (magic wands, difficulties, suggestions, doc gaps) is
**for your review, never auto-implemented**. Curate what is worth filing as
follow-up work in THIS repo; discard the rest with a sentence of reasoning.

## Watch out for

- `runId: null` in fire output = run-id capture timed out; the worker may
  still be running — cross-check `minih history validate-harness-flow` and the
  per-repo `run.log` before declaring it lost.
- `TIMED_OUT` in collect output is not failure — re-run
  `harness validate-harness-flow --collect` later to pick up stragglers.
- Workers still self-grade `verdict`. The probes cross-check `bootRuns` and
  `retroRecorded` deterministically and flag discrepancies, but treat every
  other `report.json` claim as an assertion to verify, not a fact.
- Probes run against the clones on disk — collect before you clean the temp
  root, or the probes degrade to `—` (clone missing).
- Without `--keep`, clean up the temp root when done (the `next_action` names
  it). With `--keep`, the clones are your step-2 review material.
