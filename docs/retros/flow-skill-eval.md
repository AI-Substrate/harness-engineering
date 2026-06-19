
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

## 2026-06-19T04:07:08.537Z — flow-skill-eval / 2026-06-19T04-00-37-853Z-b95f

- runId: 2026-06-19T04-00-37-853Z-b95f
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/runs/2026-06-19T04-00-37-853Z-b95f
- summary: Drove the-flow guided mode for “add a --json flag to harness doctor” through fresh start, research, a Simple plan pass with one revealed phase, and one workshop branch. The generated rail was clean of workshop/ADR text, the workshop was recorded as an excursion, nav state lived in the flight plan with no .the-flow-state.json, and the bag-less legacy copy still had a real nav.now for active-flow discovery.
- **magicWand** (target: project): Edit the the-flow eval prompt to say `node harness/cli/bin/harness.js --json flow nav show --path "$OUT/the-flow.json"` when it expects `.data.nav.now`.
- difficulties:
  - [degrading] config: The prescribed nav-show observation command produced human output in this CLI TTY even though the eval text asked for `.data.nav.now` from a JSON envelope. (workaround: Ran the exact prescribed command first, then made a separate `--json` observation and cross-checked the generated flight-plan JSON.)
  - [annoying] tooling: Relative apply_patch paths resolved under the minih run folder rather than the project root, creating duplicate artifacts outside the required in-repo eval output path. (workaround: Removed the accidental duplicate directory and recreated the artifacts with absolute in-repo paths under `.harness/temp/flow-eval/$MINIH_RUN_ID/`.)

## 2026-06-19T04:07:59.921Z — flow-skill-eval / 2026-06-19T04-00-39-168Z-c155

- runId: 2026-06-19T04-00-39-168Z-c155
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/runs/2026-06-19T04-00-39-168Z-c155
- summary: Drove the-flow guided mode as the eval user for "add a retry to the network fetch helper": initialized a fresh CLI-authored flight plan under the run scratch path, accepted the research-first edge, completed a Simple plan pass that revealed one phase, added one retry-policy workshop as a plan excursion, and confirmed cold-resume nav derives from the flight plan without a separate state file.
- **magicWand** (target: project): Edit the-flow's guided prompt to print an eval-safe PLAN_DIR/FLOW_PATH block and render workshop commands with the same argument shape in both the Registry and workshop sub-skill.
- difficulties:
  - [degrading] config: the-flow fresh-start and stage docs are written around docs/plans paths, while the eval requires all authored artifacts under .harness/temp/flow-eval/$MINIH_RUN_ID and only explicitly permits --path redirection for the flight plan. (workaround: Kept all artifacts under OUT and changed only harness flow --path values to $OUT/the-flow.json.)
  - [annoying] knowledge: The Registry says the workshop verb consumes only a topic, but the workshop sub-skill says it consumes a plan plus a topic, making the exact printed workshop command ambiguous after the plan seam. (workaround: Accepted the guided seam's topic-only workshop edge and kept the workshop artifact in the same OUT plan context.)
  - [annoying] tooling: apply_patch resolved a relative path from the SDK run folder rather than the project root, which briefly created an artifact outside the required OUT path. (workaround: Deleted the stray file immediately and used absolute paths for subsequent artifact writes.)

## 2026-06-19T04:09:15.130Z — flow-skill-eval / 2026-06-19T04-00-36-400Z-4fec

- runId: 2026-06-19T04-00-36-400Z-4fec
- runDir: /Users/jordanknight/substrate/harness-engineering/agents/flow-skill-eval/runs/2026-06-19T04-00-36-400Z-4fec
- summary: Drove the-flow through a scratch flight plan for adding a CLI status badge: initialized the plan under .harness/temp, completed research and planning, revealed one phase, added one workshop excursion, and rendered the flow successfully. The observed rail stayed clean of workshop text, the workshop node was branched off the plan node, nav state was written through harness flow nav, and cold resume derived the current position from the flight plan as workshop-cli-status-badge-vocabulary.
- **magicWand** (target: project): Edit the-flow guided prompt to define a scratch/eval plan root that redirects both the flight-plan path and all stage artifact/discovery paths, not only the flight-plan --path.
- difficulties:
  - [degrading] config: the-flow's guided routing and stage modules assume docs/plans for artifacts and bare discovery, but this eval mandates .harness/temp/flow-eval/$MINIH_RUN_ID only. (workaround: Kept the flight plan and authored stage artifacts under the eval output directory, then used harness flow --path for all flow mutations.)
  - [degrading] knowledge: The plan stage prescribes an automatic /validate-v2 --artifact run, but validate-v2 was not available in the loaded skill surface. (workaround: Recorded the friction and continued the flow drive so the eval could observe the authored flight plan and workshop branch.)
  - [degrading] test: The legacy bag-less active-flow check asks for bare /the-flow discovery, but the scratch flow is intentionally outside docs/plans and the routing doc's discovery glob only scans docs/plans/*/the-flow.json. (workaround: Created $OUT/legacy.json with nav.bag.status stripped and confirmed harness flow nav show still derived the same nav.now from the file.)
