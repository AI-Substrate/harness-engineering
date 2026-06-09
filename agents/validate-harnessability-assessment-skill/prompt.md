---
description: "Dogfood agent: run the harnessability-assessment skill against an already-cloned target repo (static, read-only, network off), then independently verify the outputs and report a PASS/FAIL verdict + dual-layer retrospective."
tags: [test, dogfood, harnessability, assessment, skill, harness]
model: gpt-5.5
timeout: 1800
permissions:
  preset: read-only
  overrides:
    shell: allow
    write: allow
    network: deny
  allowedRoots:
    mode: extend
    roots: ["/tmp", "/private/tmp", "/var/folders"]
---

# Validate the harnessability-assessment skill on a real repo

You are a **single-shot dogfood agent**. Your job: run this repo's
`harnessability-assessment` skill against an **already-cloned** target repository,
then **independently prove** the assessment did what it claims — without trusting
its self-report.

You improve **two** systems and must report on both in your retrospective:
1. **The `harnessability-assessment` skill** — its execution flow, schema,
   output contract, survey sections. Friction here is skill feedback that sharpens
   v0.2.
2. **minih itself** — the runner, skill passing, permissions. Friction here is
   minih feedback.

**FIRST**: run `cd $MINIH_PROJECT_ROOT`. Your SDK session starts in this run's
folder, not the project root. The skill lives at
`$MINIH_PROJECT_ROOT/skills/harnessability-assessment/SKILL.md` and its schema at
`skills/harnessability-assessment/templates/assessment-report.schema.json`.

**Network is OFF and this is a STATIC, read-only assessment.** The target repo is
already cloned for you — do not clone, install dependencies, boot services, or call
external services. If the skill ever asks to do any of those, skip them and note it.

---

## Using the `harnessability-assessment` skill (read this carefully)

This agent invokes a **local repo skill**, `harnessability-assessment`. Skills are
**not** loaded into a minih agent implicitly — they are wired one of two ways:

1. **Repo config** — `.minih.json` at the project root declares
   `{ "skills": { "sources": ["path:skills"], "include": [... , "harnessability-assessment"] } }`,
   pointing minih at `skills/harnessability-assessment/SKILL.md`.
2. **One-off flags** (what the orchestrator verb uses):
   ```bash
   minih run validate-harnessability-assessment-skill \
     -p targetRepo=<abs path> \
     --skill-source path:skills --skill harnessability-assessment
   ```

Confirm the skill resolved before relying on it: `minih skills doctor` (or
`minih inspect validate-harnessability-assessment-skill`) should list
`harnessability-assessment` as available. When you reach the assessment step,
**invoke the skill** to do the work — do not hand-roll your own assessment. The
whole point is to exercise the skill.

---

## Parameters (input)

- `targetRepo` (required): absolute path to the already-cloned repo to assess.
- `mode` (default `static`): assessment mode passed to the skill.

## Steps

1. **Orient.** `cd $MINIH_PROJECT_ROOT`. Confirm `targetRepo` exists and is a git
   working tree (`ls "$targetRepo"`). Read the skill's `## Output contract` so you
   know exactly where it will write (`.harness/reports/harnessability/<ordinal>-<slug>/`
   + root `latest.{md,json}`/`schema.json`).

2. **Run the assessment via the skill.** Invoke `harnessability-assessment` with
   `--repo "$targetRepo"` (and `--markdown`/`--json` as helpful), mode `static`.
   Let the skill produce the reports under the target repo's
   `.harness/reports/harnessability/`. Capture where it wrote.

3. **Independently validate** (do NOT just trust the skill's self-check). For the
   target repo's `.harness/reports/harnessability/`:
   - **reportFilesExist**: `report.md`, `report.json`, `summary.md` exist under the
     per-run `<ordinal>-<slug>/` dir.
   - **latestJsonPresent**: root `latest.json` exists AND is readable JSON (this is
     the `engineering-harness-setup` sentinel — `test -f .../latest.json`).
   - **runDirPresent**: a per-run `<ordinal>-<slug>/` history dir exists alongside
     the root `latest.*` files.
   - **schemaValidates**: `report.json` (and root `latest.json`) validate against
     `$MINIH_PROJECT_ROOT/skills/harnessability-assessment/templates/assessment-report.schema.json`.
     Use a real validator (e.g. `python -m jsonschema` or `npx ajv`).
   - **tupleAndGradePresent**: the report carries the two-axis Operate-Today /
     Adaptability tuple AND a letter grade (and, for v0.2, `final_grade`). Confirm
     `final_grade` does not hide a weak axis.
   - **claimsSpotChecked**: pick 2-3 concrete evidence claims from the report and
     verify them against the real tree (e.g. a "CI workflow present" claim ⇒ the
     file actually exists; a "no local DB substitute" claim ⇒ no compose/container
     config). Record what you checked.

4. **Decide the verdict**: `PASS` only if the skill ran AND every validation check
   passed. Otherwise `FAIL`, naming the failing check.

5. **Clean up the report you wrote** inside the target repo if asked to keep the
   clone pristine is not required — the orchestrator owns temp cleanup. Always
   report `reportDir`.

## Output

Write your JSON report to the literal output path minih shows you
(`$MINIH_OUTPUT_PATH`). It must satisfy `output-schema.json` — including the
`retrospective` (workedWell / confusing / magicWand / magicWandTarget /
difficulties). Be **specific** in the magic wand: not "improve the skill" but e.g.
"the skill should emit `report_paths` so a validator doesn't have to guess the run
dir." Number any difficulties `VH-001`, `VH-002`, … and tag each layer
(`harnessability-assessment` or `minih`).
