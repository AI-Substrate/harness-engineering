---
description: "Drive the-flow to mid-plan, then drive eng-harness-flow alongside it to inject its four fire-hook steps as CHORES into the-flow.json. Re-inject to prove idempotency; verify the chores are visible on the rail. FAITHFUL: run exactly what the skills prescribe. One-shot; not coordinated."
tags: [eval, eng-harness-flow, the-flow, coexist, dogfood]
model: gpt-5.5
reasoning: high
timeout: 1500
permissions:
  preset: read-only
  overrides:
    shell: allow
    write: allow
    network: allow
---

# flow-coexist-eval — prove the loop's chores ride the-flow's rail

You are a **single-shot eval probe**. You set up a throwaway `the-flow` flight plan
mid-journey, then drive `eng-harness-flow` **alongside** it so the engineering loop's
four fire hooks are injected as **chores** into `the-flow.json` (`run /eng-harness-flow
--hook <hook>`) — so the main flow tracks them and *they stop getting missed*. You
prove the injection is **idempotent** and the chores are **user-visible on the rail**,
then report. You do **not** grade yourself; `scripts/score-flow-coexist.sh` decides.

**FIRST**: run `cd "$MINIH_PROJECT_ROOT"`. The repo is harness-engineering (CLI at
`harness/cli/bin/harness.js`). Derive `$MINIH_PROJECT_ROOT`/`$MINIH_RUN_ID` from the
absolute paths minih shows you if the env vars are empty.

## Setup

```bash
cd "$MINIH_PROJECT_ROOT"
OUT=".harness/temp/coexist-eval/$MINIH_RUN_ID"
mkdir -p "$OUT"
H="node harness/cli/bin/harness.js"
```

All writes go under `$OUT` (gitignored). The throwaway the-flow plan is `$OUT/the-flow.json`.
**Never** write to `docs/plans/` or the real `.harness/`.

## Step 1 — build a throwaway the-flow flight plan, mid-plan

Create a the-flow flight plan and drive it to a mid-journey position (research done,
plan the current node), using **only** `harness flow` commands (the the-flow schema is
the `theFlowSchema` param):

```bash
$H flow create flight-plan --slug coexist --path "$OUT/the-flow.json" --schema "<theFlowSchema>" --agent the-flow --bare
# build a small spine LAST-node-first (forward --next refs are rejected): ship, then plan->ship, then research->plan
$H flow add-node --path "$OUT/the-flow.json" --id ship     --type ship     --label Ship     --status assumed
$H flow add-node --path "$OUT/the-flow.json" --id plan     --type plan     --label Plan     --status done --next ship
$H flow add-node --path "$OUT/the-flow.json" --id research --type research --label Research --status done --next plan
$H flow nav set  --path "$OUT/the-flow.json" --now plan
```

## Step 2 — drive eng-harness-flow to inject the four fire-hook chores

Load the `eng-harness-flow` skill and follow its `references/flight-plan-ops.md`
guidance for **"injecting the four fire hooks into an active the-flow"**. Because a
the-flow is active, the loop lives as **chores in `the-flow.json`** — it must **not**
author a separate `.harness/loop.flow.json`. Run the `harness flow` commands the skill
prescribes to place the four chores with the exact shape it specifies:

- one chore per hook `∈ {pre-flight, pre-coding, post-coding, post-flight}`,
- `chore.kind = command`, `command = run /eng-harness-flow --hook <hook>`, status `todo`,
- `importance = recommended` (pre-flight = `strongly-recommended`),
- **dedup key = the `--hook <X>` token** (exactly one chore per hook),
- placed so they ride the-flow's **rail** (inline spine nodes — `insert-node --after <anchor>`).

Follow the skill's commands **faithfully** (only `--path` may be redirected to `$OUT`).
If a prescribed command errors, STOP and record it (a finding).

## Step 3 — prove idempotency (re-inject)

Copy the result, then run the **same** injection a second time and save the snapshot:

```bash
cp "$OUT/the-flow.json" "$OUT/after-first.json"
# … re-run the exact same injection commands the skill prescribes …
cp "$OUT/the-flow.json" "$OUT/reinjected.json"
```

A correct (dedup-keyed) injection is idempotent: `after-first.json` and `reinjected.json`
must have a **byte-identical node set**. Report `reinjectedPath = $OUT/reinjected.json`.

## Step 4 — independent verification (parse `--json`, never trust claims)

```bash
$H --json flow chores  --path "$OUT/the-flow.json"                 # count >= 4; four --hook commands
$H --json flow rail    --path "$OUT/the-flow.json" --chores show   # rail shows chore square pips (□/▣)
$H --json flow nav show --path "$OUT/the-flow.json"               # .data.nav.now still resolves
ls "$OUT"/loop.flow.json 2>/dev/null && echo "LEAK: a loop.flow.json exists (must NOT while the-flow is active)"
```

## Report (observe — do not grade)

Emit `output-schema.json`: `theFlowPath` (= `$OUT/the-flow.json`), `reinjectedPath`,
`choreHooks` (the four `--hook` tokens you injected), `choreCount`, `idempotent`
(your byte-diff of after-first vs reinjected), `navNow`, `loopFileAbsent`,
`railShowsChores`, `summary`, and a dual-layer `retrospective` with `CX-NNN` difficulties.
