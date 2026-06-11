# `harness validate-harnessability` — agent briefing

You are the **operator** of a narrower dogfood self-test than
`validate-harness-flow`: this one exercises ONLY the
harnessability-assessment skill, not the full setup flow. The verb brings the
determinism — cloning and worker fan-out — and you bring the inference:
verifying each worker's assessment is real, schema-valid evidence.

## What this verb computes (the deterministic part)

Clones the target repos (default: chalk/JS, byteorder/Rust, pflag/Go —
override with `--repo <urls...>`) into a temp root, then fires one **detached
minih worker** (`validate-harnessability-assessment-skill`) per clone. Each
worker runs the harnessability-assessment skill against its repo and
self-verifies the output, writing `output/report.json` in its run dir. The
verb returns IMMEDIATELY with run IDs and poll commands (`minih status`,
`minih tail`, `minih last-run`); the workers keep running after it exits.
There is no `--collect` here — you poll and read the run dirs yourself.

## Your role (the inference part)

When a run shows completed, validate its report — per repo:

1. **Verdict**: `report.json` says `verdict: PASS`? A worker's self-grade is
   an assertion to verify, not a fact.
2. **Artifacts in the clone**: the assessment must have written
   `.harness/reports/harnessability/latest.json` AND an `<ordinal>-<slug>/`
   run dir inside the clone. Missing artifacts with a PASS verdict = echo.
3. **Schema**: `report.json` validates against
   `skills/eng-harness-setup/eng-harness-0-harnessability-assessment/templates/assessment-report.schema.json`.
4. **Spot-check evidence**: pick 2–3 evidence claims from the assessment
   (e.g. "boot command is `npm test`", "CI config at …") and check them
   against the real cloned tree. Fabricated-but-plausible evidence is the
   main failure mode this self-test exists to catch.
5. **Harvest the minih worker retros separately**: each worker's farewell
   `retrospective` (magicWand, difficulties) is feedback about the SKILL and
   flow — fold what is genuinely useful into this repo's backlog; it is
   surfaced for review, never auto-implemented.

## Watch out for

- `runId: null` = run-id capture timed out; the worker may still be running —
  cross-check `minih history validate-harnessability-assessment-skill` and
  the per-repo `run.log`.
- Workers run against **shallow clones of small repos** — a low
  harnessability grade for a tiny library can be correct, not a failure;
  judge the grade's reasoning, not its letter.
- Without `--keep`, clean up the temp root when done (the `next_action`
  names it).
