---
description: "Drive the eng-harness-flow skill (standalone harness loop) for a small intent and report what flight plan it authors — rail string, loop spine shape, the position verb used, and the four fire-hook commands. FAITHFUL: run exactly what the skill prescribes; leak no target. One-shot; not coordinated."
tags: [eval, eng-harness-flow, loop, dogfood]
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

# loop-flow-eval — drive the standalone harness loop and report what it authors

You are a **single-shot eval probe**. You drive the `eng-harness-flow` skill exactly as a caller would when **no `the-flow` is active**, let it author + advance a small throwaway **harness-loop** flight plan **by following its own guidance** (`references/flight-plan-ops.md`), then report — faithfully — what it produced. You do **not** grade yourself; an external deterministic scorer (`scripts/score-loop-eval.sh`) reads the artifacts and decides.

**FIRST**: run `cd "$MINIH_PROJECT_ROOT"`. Your SDK session starts in this run's folder, not the project root; every repo path below is relative to `$MINIH_PROJECT_ROOT` (the harness-engineering repo, which carries the `harness` CLI at `harness/cli/bin/harness.js`). If `$MINIH_PROJECT_ROOT` / `$MINIH_RUN_ID` are empty in your shell, derive them from the absolute paths minih shows you.

## Setup

```bash
cd "$MINIH_PROJECT_ROOT"
OUT=".harness/temp/loop-eval/$MINIH_RUN_ID"
mkdir -p "$OUT"
```

`$OUT/loop.flow.json` is where the throwaway loop plan must live — in-repo (the CLI rejects out-of-repo paths with `FLOW_PATH_ESCAPE`) and under the gitignored `.harness/temp/`. **Never** let it land in `docs/plans/` or at the real `.harness/loop.flow.json`.

## Your mission — drive the skill FAITHFULLY

Load the `eng-harness-flow` skill (its `SKILL.md` → `references/flight-plan-ops.md` carries the loop-driving guidance). There is **no `the-flow` active**, so the live flow is the **standalone ⚙️ loop**: it authors its **own** `.harness/loop.flow.json` and drives position with `harness flow nav`.

Role-play the caller and **follow the skill's guidance to**:

1. **Create** the standalone loop flight plan with the exact `harness flow create harness-loop …` command the skill prescribes — the **only** change you may make is the `--path` → `$OUT/loop.flow.json`.
2. **Advance** it along the spine with the position verb the skill prescribes (`harness flow nav set --now <node>` …) for the `intent` parameter — far enough to move off `boot` (e.g. to `observe`), and mark a node or two `done` with `harness flow status`.
3. Optionally demonstrate the **cycle is a nav reset** (move `nav.now` back toward `observe`/`boot`) — never expect a stored back-edge.

- Run **exactly** the `harness flow` commands the skill's guidance prescribes, with their **exact flags**. Do **not** add, drop, reorder, or "correct" any flag (in particular, honour the `--title harness-loop` the skill uses; do not add `--agent`).
- **Never hand-edit the JSON** — the CLI is the only writer. If you ever feel the urge to edit the file directly, that is a finding.
- **If a command the skill prescribes ERRORS**, **STOP driving** and record the exact command + error in `retrospective.confusing`. Do **not** work around it.

## Independent verification (do not trust the skill's claims)

After driving, verify from the artifact yourself (pass the global `--json` **before** `flow`):

```bash
node harness/cli/bin/harness.js --json flow rail --path "$OUT/loop.flow.json"      # railTitle starts [harness-loop]?
node harness/cli/bin/harness.js --json flow nav show --path "$OUT/loop.flow.json"  # .data.nav.now resolves?
node harness/cli/bin/harness.js flow render --path "$OUT/loop.flow.json" >/dev/null # exit 0?
```

## Autonomy contract

- **Never wait for real human input.** You are the caller; make minimal sensible choices.
- **A stall or an error is a finding — not a hang, and not a thing to fix.** Record it and stop; still emit your report with whatever was authored.

## Report (observe — do not grade)

Emit the `output-schema.json` shape: `railTitle`, `spineShape` (the spine node ids in order), `navUsed` (the position verb you ran, e.g. `nav set`), `hookCommandsPresent` (the four `--hook` tokens you saw on node `command`s), `validates`, `flowPath` (= `$OUT/loop.flow.json`), `summary`, and a dual-layer (`project`|`minih`) `retrospective` with numbered `LF-NNN` difficulties.
