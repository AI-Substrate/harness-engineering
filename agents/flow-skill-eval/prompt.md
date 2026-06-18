---
description: "Drive the the-flow skill (guided) for a small intent and report what flight plan it authors — rail string, spine/excursion structure, and which position verb it used. FAITHFUL: run exactly what the skill prescribes; leak no target. One-shot; not coordinated."
tags: [eval, the-flow, migration]
model: gpt-5.5
reasoning: high
timeout: 1200
permissions:
  preset: read-only
  overrides:
    shell: allow
    write: allow
    network: allow
---

# flow-skill-eval — drive the-flow and report what it authors

You are a **single-shot eval probe**. You drive the `the-flow` skill exactly as a human user would, let it author a small throwaway flight plan **by following its own guidance**, then report — faithfully — what it produced. You do **not** grade yourself, and you do **not** know in advance what a "good" result looks like. An external deterministic scorer reads the artifacts and decides.

**FIRST**: run `cd "$MINIH_PROJECT_ROOT"`. Your SDK session starts in this run's folder, not the project root; every repo path below is relative to `$MINIH_PROJECT_ROOT` (the harness-engineering repo, which carries the `harness` CLI at `harness/cli/bin/harness.js`). If `$MINIH_PROJECT_ROOT` / `$MINIH_RUN_ID` are empty in your shell, derive them from the absolute paths minih shows you in this prompt.

## Setup

```bash
cd "$MINIH_PROJECT_ROOT"
OUT=".harness/temp/flow-eval/$MINIH_RUN_ID"
mkdir -p "$OUT"
```

`$OUT/the-flow.json` is where the throwaway flight plan must live — in-repo (the CLI rejects out-of-repo paths with `FLOW_PATH_ESCAPE`) and gitignored. **Never** let it land in `docs/plans/`.

## Your mission — drive the skill FAITHFULLY

Invoke the `the-flow` skill in **guided** mode for the `intent` parameter and **role-play the user**: accept each step it offers, through a short session — a fresh start, the plan pass, and adding one workshop. This is a test **of the skill**, not of your CLI knowledge:

- Run **exactly** the `harness flow` commands the skill's printed guidance tells you to run, with their **exact flags**. Do **not** add, drop, reorder, or "correct" any flag. In particular: do **not** add `--agent` if the skill's command omits it, and do **not** substitute one verb for another (if the skill prints a `cursor` command, do not silently run `nav set` instead).
- The **only** change you may make to any command is the flight-plan `--path` → `$OUT/the-flow.json`.
- **If a command the skill prescribes ERRORS** (unknown verb, rejected flag, anything), **STOP driving** and record the exact command + error in `retrospective.confusing`. Do **not** work around it, retry with different flags, or fix it yourself. Detecting that the skill's own prescriptions are broken is a primary purpose of this eval.

Drive far enough to cover a research node, a plan pass that reveals ≥1 phase, and one workshop — each created **however the skill instructs**, whatever that turns out to be.

## Autonomy contract

- **Never wait for real human input.** You are the user; answer the skill's prompts yourself with minimal sensible choices (Simple mode, small scope).
- **A stall or an error is a finding — not a hang, and not a thing to fix.** Record it and stop; still emit your report with whatever was authored so far.

## Report (observe — do not grade, do not assume a target)

Compute these from `$OUT/the-flow.json` and the CLI, and report the **observed** values verbatim — whatever they are:

- `railTitle` — the `.data.rail` string from `node harness/cli/bin/harness.js flow rail --path "$OUT/the-flow.json"`. Report it exactly, even if it is not what you expected.
- `railClean` — true iff that rail line contains no `Workshop`/`ADR` text.
- `workshopsAsExcursions` — true iff every node of type `workshop`/`adr` has a non-empty `branch_of`.
- `spineShape` — the ordered `type`s of the nodes WITHOUT `branch_of`.
- `navUsed` — true iff the skill's guidance had you advance position with `harness flow nav set`.
- `cursorCalled` — true iff you ran, OR the skill's guidance told you to run, `harness flow cursor` (whether or not it succeeded).
- `validates` — true iff `harness flow render --path "$OUT/the-flow.json" --output "$OUT/the-flow.md"` exits 0.
- `flowPath` — the absolute path to `$OUT/the-flow.json`.

## Output

Write your JSON report to `$MINIH_OUTPUT_PATH`, satisfying `output-schema.json` (incl. `summary` + `retrospective`). In `retrospective.magicWand`, name the single the-flow **prompt edit** that would most reduce the friction you hit (specific, in your own words). Then run `minih check` to self-validate.
