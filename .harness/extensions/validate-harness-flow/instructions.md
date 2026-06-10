# `harness validate-harness-flow` — agent briefing

You are the **operator** of a dogfood self-test. The verb brings the
determinism — cloning, fan-out, polling, collection — and you bring the
inference: judging whether the harness setup flow **actually worked** in each
target repo, or merely echoed the motions.

## What this verb computes (the deterministic part)

- **Fire mode** (default): clones the target repos (default: express/Node,
  click/Python, cobra/Go — override with `--repo <urls...>`) into a temp root,
  then fires one **detached minih worker** per clone. Each worker drives the
  FULL harness setup flow against its repo: install → harnessability
  assessment → hand-written `engineering-harness.md` governance → author +
  validate a `boot` extension → record a retro — and writes a structured
  `report.json`. The verb returns IMMEDIATELY with run IDs + a manifest; the
  workers keep running after it exits.
- **Collect mode** (`--collect`): waits for each worker to reach a terminal
  state, classifies it (DONE / TIMED_OUT / MISSING_REPORT / NOT_FIRED), copies
  each DONE worker's artifacts into `<runsDir>/<repo>/` (worker `report.json`,
  harnessability `latest.md`/`latest.json`, the authored
  `engineering-harness.md`, every in-repo retro), and writes
  `<runsDir>/ROLLUP.md` with merged magic-wand wishes + difficulty clusters.

## Your role (the inference part)

The rollup is **evidence, not a verdict**. After `--collect`, do a real review
pass — per repo, in this order:

1. **Read the work, not just the reports.** Open the clone (use `--keep` to
   retain it): does the authored `engineering-harness.md` describe THIS repo's
   real boot/test commands, or is it template echo? Does the `boot` extension
   wrap a command that genuinely proves the repo runs? Run it if in doubt.
2. **Check the target repo's harness loop left residue** — the workers must be
   *practising* the loop, not just completing tasks. Verify each clone's
   `.harness/records/retro/` contains real retros, and that those retros carry
   **magic wands and other valuable feedback** (difficulties with layers and
   categories, improvement suggestions, confusions). An empty or perfunctory
   in-repo retro is a finding — report it even when the verdict says PASS.
3. **Separately, read the minih worker retros.** Each worker's farewell
   retrospective (in its `report.json` under `retrospective`, and in the minih
   run dir) carries its own `magicWand`, `difficulties[]`, and `workedWell` /
   `confusing` notes about the *flow and tooling itself*. This is a DISTINCT
   artifact from the in-target-repo harness retros in step 2 — do not conflate
   them: step 2 judges whether the harness loop works **inside the target
   repo**; this step harvests what the **worker** thought of the setup flow.
   Review both, report on both, keep them labelled separately.
4. **Judge echo-vs-real per repo** and reach a verdict: did the flow genuinely
   succeed here? Cross-check the worker's self-reported `verdict` against what
   you saw in steps 1–3 — a worker PASS with empty retros or a non-running
   boot extension is NOT a pass.

Everything surfaced (magic wands, difficulties, suggestions) is **for your
review, never auto-implemented**. Curate what is worth filing as follow-up
work in THIS repo; discard the rest with a sentence of reasoning.

## Watch out for

- `runId: null` in fire output = run-id capture timed out; the worker may
  still be running — cross-check `minih history validate-harness-flow` and the
  per-repo `run.log` before declaring it lost.
- `TIMED_OUT` in collect output is not failure — re-run
  `harness validate-harness-flow --collect` later to pick up stragglers.
- Workers self-grade. Treat `report.json` claims (`governanceWritten`,
  `bootRuns`, `retroRecorded`) as assertions to verify, not facts.
- Without `--keep`, clean up the temp root when done (the `next_action` names
  it). With `--keep`, the clones are your step-1 review material.
