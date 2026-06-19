
## 2026-06-18T11:38:09.230Z — flow-skill-eval / 2026-06-18T11-35-15-895Z-ff02

- runId: 2026-06-18T11-35-15-895Z-ff02
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/runs/2026-06-18T11-35-15-895Z-ff02
- summary: Drove the migrated the-flow guided surface for “add a foo widget” into a throwaway flight plan under the eval scratch path. The resulting rail starts with [the-flow], excludes the workshop excursion, has a research → plan → phase → merge spine, uses nav set for position, never called cursor, and renders successfully.
- **magicWand** (target: project): Edit the the-flow guided prompt to say: when an eval or caller supplies a scratch flight-plan path, derive the whole working root from that path for original-ask, state, research, plan, and workshop artifacts instead of continuing to mention or create `docs/plans/` files.
- difficulties:
  - [degrading] config: The expected MINIH_PROJECT_ROOT and MINIH_RUN_ID variables were empty in the shell, causing the mandated setup command to stay in the run directory and fail to find harness/cli/bin/harness.js. (workaround: Used the literal repo root and run id from the prompt paths, then cleaned the accidental scratch directory created under the run folder.)
  - [degrading] prompt: Guided the-flow documentation prescribes `docs/plans/` writes for original ask, durable state, and stage artifacts, but the eval requires every write to stay under `.harness/temp/flow-eval/<run-id>/`. (workaround: Kept flight-plan mutations on the prescribed CLI path substitution and placed minimal supporting artifacts under the eval scratch directory instead of `docs/plans/`.)

## 2026-06-18T11:45:25.801Z — flow-skill-eval / 2026-06-18T11-41-50-953Z-524e

- runId: 2026-06-18T11-41-50-953Z-524e
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/runs/2026-06-18T11-41-50-953Z-524e
- summary: Drove the-flow guided-mode behavior for the intent "add a foo widget" into the required throwaway in-repo path. The flight plan rendered with a [the-flow] rail, a clean research -> plan -> phase -> merge spine, and the workshop attached as a branch_of excursion; however the loaded routing reference still told the driver about the removed `harness flow cursor` verb even though the actual authored plan used `harness flow nav set`.
- **magicWand** (target: project): Edit the the-flow `00-routing.md` Flight plan cadence so every position example uses `harness flow nav set --now/--next/--intent` and the fresh-start create example includes `--agent the-flow`, with no remaining `harness flow cursor` text.
- difficulties:
  - [degrading] config: MINIH_PROJECT_ROOT, MINIH_RUN_ID, and MINIH_OUTPUT_PATH were not visible in the shell, so the prescribed setup expanded to the run directory with an empty run id on the first attempt. (workaround: Used the literal project root, run id, and output path supplied in the prompt, then kept all eval artifacts under the repo root's `.harness/temp/flow-eval/2026-06-18T11-41-50-953Z-524e/`.)
  - [degrading] prompt: The loaded the-flow routing reference still contains `harness flow cursor --to` / `--recommend` in the flight-plan mutation cadence, even though the CLI help exposes `nav set` and no cursor command. (workaround: Did not run the removed cursor verb; used `harness flow nav set` as required by the eval and reported cursorCalled=true because the skill text still told the driver about cursor.)

## 2026-06-18T11:52:28.485Z — flow-skill-eval / 2026-06-18T11-50-21-153Z-4aa2

- runId: 2026-06-18T11-50-21-153Z-4aa2
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/runs/2026-06-18T11-50-21-153Z-4aa2
- summary: Drove the-flow guided setup for intent "add a foo widget" into the in-repo scratch flight plan until the skill-prescribed advance command failed: `harness flow cursor --path "$OUT/the-flow.json" --to plan` returned unknown command `cursor`, so the run stopped before plan phases or workshop nodes were authored.
- **magicWand** (target: project): Edit the-flow prompt to replace every prescribed `harness flow cursor --to <id>` / `--recommend <id>` advance with the current `harness flow nav set --now <id>` / `--next <id>` command syntax.
- difficulties:
  - [blocking] config: The the-flow skill prescribed the removed `harness flow cursor` verb, while the installed CLI only exposes `harness flow nav set` for position changes.

## 2026-06-18T11:52:35.556Z — flow-skill-eval / 2026-06-18T11-50-21-153Z-0a1f

- runId: 2026-06-18T11-50-21-153Z-0a1f
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/runs/2026-06-18T11-50-21-153Z-0a1f
- summary: Drove the-flow guided-mode mechanics for "add a foo widget" into the scratch flight plan at /Users/jordanknight/substrate/harness-engineering/.harness/temp/flow-eval/2026-06-18T11-50-21-153Z-0a1f/the-flow.json; the authored flow contains spine node types research -> plan -> phase -> merge and 1 workshop/ADR excursion node(s).
- **magicWand** (target: project): Edit the-flow guided prompt to print a concrete, copyable flight-plan command block for each seam, including add-node ordering, --next wiring, and the exact insert-node --branch-of workshop command.
- difficulties:
  - [degrading] knowledge: The skill guidance required exact prescribed commands, but the fresh-start and seam docs did not render every concrete harness flow mutation with fully bound ids, labels, and ordering. (workaround: Used the skill's verb cheat-sheet and routing cadence to instantiate the required command shapes in the scratch path without changing verbs or flags.)

## 2026-06-19T03:53:25.192Z — flow-skill-eval / 2026-06-19T03-47-08-900Z-2ce1

- runId: 2026-06-19T03-47-08-900Z-2ce1
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/runs/2026-06-19T03-47-08-900Z-2ce1
- summary: Drove the-flow guided-mode behavior for intent "add a foo widget" into the required in-repo scratch flight plan. The authored rail is exactly the observed [the-flow] rail, the workshop was attached as an excursion via branch_of, nav set was used for position, no cursor command was called, render exited 0, and cold resume derives nav.now from the flight plan without a state file.
- **magicWand** (target: project): Edit the the-flow Fresh start prompt to print one concrete, ordered command block for scratch-safe creation: create with --path, add ship/plan/research last-to-first, nav set, meta set, and render, using a single FLOW_PATH placeholder.
- difficulties:
  - [degrading] workflow: The skill guidance hard-coded docs/plans for non-flight-plan artifacts while the eval required every write to stay under .harness/temp/flow-eval/$MINIH_RUN_ID. (workaround: Kept the flight plan at the required --path and authored original-ask, research, plan, and workshop artifacts under the eval scratch folder.)
  - [annoying] knowledge: Fresh-start routing said to seed the research, plan, and ship nodes but did not show a copyable ordered command block; the validator rejects forward --next references. (workaround: Used flight-plan-ops gotcha guidance to create the spine last-to-first before setting nav.)
