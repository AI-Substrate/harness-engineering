# tasks

> Sub-skill — owns the phase dossier, not lifecycle position.

**Verb**: tasks
**Purpose**: Turn one reviewed implementation-guide slice into actionable work and observable done assertions; stop before code.
**Consumes**: product `plan.dd.json`, reviewed `assets/impl-guide.dd.json`, `assets/backpressure.dd.json`, the selected phase and relevant prior execution evidence.
**Flags**: `--phase "<Phase N: Title>" --plan "<path>"`; bounded subtask `--subtask "<summary>" --parent "<task id>"`; fix `--fix "<summary>"` / `--from-review "<path>"` / `--fix --list`.
**Produces**: `assets/tasks/phase-N/tasks.dd.json` plus generated `.dd.md` and concise context brief; creates/wires the canonical phase task source in the same stroke as the plan phase's source link. Bare ordinal, never title-derived paths.

## Procedure

1. Resolve the canonical plan, phase ID and guide unit(s). Preserve historical Markdown dossiers under their original read path; completed history is not rewritten. Simple mode still has a real phase task file and guide; it does not hide implementation tasks in product intent.
2. Read relevant prior-phase exports, proof, gotchas and open findings, not every transcript. Load domain rules only when domain mode is enabled; preserve existing opted-in domain context.
3. Use the guide's responsibility, exact write/read paths, frozen interfaces, waves, AC coverage and composition ownership. Do not re-decompose by file count or silently move ownership. An unresolved interface returns to the guide owner before dispatch.
4. Each task has a stable minted ID, title, phase, success, notes, `done` link and `satisfies` array. Use `satisfies_toward` for incremental work that contributes but does not close a whole AC. Each `done_when` assertion names an observable behavior and its actual `pressure` instrument. Every AC must be accounted for; no empty catch-all task to silence orphan warnings.
5. Inherit the selected proof from `assets/backpressure.dd.json`: RUN now, extend then run, build then run, or explicit ABSENT judgement. Do not convert an intended command into a passed receipt. Follow `../backpressure-recipe.md` for AC pressure and eventual proven_by links.
6. Make feasibility spikes precede dependent work; preserve decisions and observed results, not throwaway experiment code. Choose the fewest task groups that respect real dependencies. Include PM wiring and assembled behavior, not only unit implementation.
7. Write a short context brief: purpose, source entrypoints/contracts, dependency constraints, test approach/fakes, relevant hazards and required proof. An architecture map is useful only if it adds relationships the rows do not show. The DD task list is the status truth, never an independently edited Markdown table.
8. Validate document structure and link reachability; do not request whole-plan `--complete` while future phases/closeout remain unchecked. Stop before implementation and report exactly what is ready.

## Writer sequence

**Create and wire in the same stroke.** A phase task file without its product-plan link is invisible to work-accounting and departure checks. For a new plan, `harness plan new <slug> --phase "<title>"` (repeat `--phase` for known checkpoints) creates each task source and its `plan.dd.json#phases/<id>/tasks` link together; reuse that paired scaffold, never allocate a second plan here. Resolve the actual phase ID and bare ordinal from the existing plan before authoring tasks.

For an existing scaffold, keep task authoring and the phase-link write in one uninterrupted operation: update `plan.dd.json#phases/<id>/tasks` through `ddocs set` immediately after writing the task source, before reporting the dossier created or proceeding to validation. The target is the canonical `tasks.dd.json#tasks` source address, never its generated Markdown sibling. The ordered commands below are separate validated writes, not a cross-file transaction: if the link write fails, retain the task source, report incomplete authoring and repair that source link before continuing; do not mint replacement tasks or claim success. If the task source itself is missing, report the missing scaffold prerequisite—`ddocs add` does not create a document and no guessed create flag is allowed.

```bash
TASKS="${PLAN_DIR}/assets/tasks/phase-N/tasks.dd.json"
node_modules/.bin/ddocs add "${TASKS}#tasks" '{"title":"<task>","phase":"ph-XXXX","state":"unchecked","satisfies":["../../../plan.dd.json#acceptance_criteria/ac-XXXX"]}' --mint tk &&
node_modules/.bin/ddocs set "${PLAN_DIR}/plan.dd.json#phases/ph-XXXX/tasks" "assets/tasks/phase-N/tasks.dd.json#tasks"
# New task only; preserve an existing assertion list on re-entry.
node_modules/.bin/ddocs set "${TASKS}#done_when/tk-XXXX" '[]' --value-json
node_modules/.bin/ddocs add "${TASKS}#done_when/tk-XXXX" '{"assertion":"<observable outcome>","state":"unchecked","pressure":"../../backpressure.dd.json#rows/bp-XXXX"}' --mint dw
node_modules/.bin/ddocs set "${TASKS}#tasks/tk-XXXX/done" "tasks.dd.json#done_when/tk-XXXX"
harness plan validate "${PLAN_DIR}/plan.dd.json"
```

Use real returned IDs. The phase scaffold already exists when `harness plan new` created that phase; add missing phases through supported plan authoring, not by inventing another task schema. Every source mutation validates before write and rebuilds the sibling. Never hand-edit generated Markdown. The schema's explicit `not-applicable` pressure escape must name the actual alternative instrument in the assertion note; it is not an excuse for unproven work.

## Subtasks and fixes

Attach subtasks to their stable parent task ID and retain the same scope/proof contract. A review fix cites the finding and a behavioral assertion that would fail on recurrence. Keep work-accounting links in the owning task corpus; a side note alone cannot close a parent. `--fix --list` is read-only. A fix outside the reviewed fence needs an explicit guide/scope change, not silent expansion.

## Exit

Report source/view paths, phase, task/assertion coverage, dependencies and remaining decisions. No source implementation or flow writes. Routing is the flow's job — run the parent flow bare to continue.
