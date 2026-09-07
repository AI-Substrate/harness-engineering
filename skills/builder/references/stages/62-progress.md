# progress

> Sub-skill — records task evidence; never owns flow position.

**Verb**: progress
**Consumes**: plan, phase task source, changed task and actual evidence.
**Flags**: `--plan`, `--task`, `--status completed|in_progress|blocked`, `--changes "<paths>"`; optional `--domain`, `--phase`, `--subtask`, `--inline` for historical inline plans.
**Produces**: canonical task/assertion state and execution-log evidence, with domain-impact notes when opted in. No retro or team lifecycle state.

## Procedure

1. Resolve the task from `assets/tasks/phase-N/tasks.dd.json` and its guide unit. For completed historical Markdown plans, retain the old read path; do not migrate or reopen them.
2. Respect canonical writers: the PM writes plan/tasks/receipts; a worker returns the requested update and evidence to the PM instead. Advisory source maps do not transfer canonical lifecycle mutation or immutable-evidence authority.
3. Record actual outcome before state: command, cwd, exit/status, subject SHA, output/evidence pointer, changed files and relevant risks in `assets/execution-log.dd.json#entries` using local `node_modules/.bin/ddocs add --mint lg`. Preserve failed/unavailable results without relabelling them as success.
4. For completed work, link the observed entry via AC `proven_by` and assertion `proven_by` where appropriate. Every AC/assertion retains its `pressure` link to `assets/backpressure.dd.json`. Use `../backpressure-recipe.md`; a selected RUN command or authored test is not an observed receipt.
5. Set only exercised assertions checked; blocked assertions stay blocked with a reason. The task's `done` link derives from its assertion list. `in_progress` remains unchecked plus an execution entry/note, not an unsupported DD state. Human-skipped/na require the actual human decision or applicability reason.
6. Update domain-impact notes when enabled: contracts, concepts, composition/dependencies and required registry/map changes. Preserve `Deferred`/`Noteworthy` tags so phase review and ship surface unresolved work.
7. Report changed records and unresolved assertions. Do not move flow nav, overwrite guide/baseline intent, or claim a whole AC when this task only `satisfies_toward` it.

```bash
node_modules/.bin/ddocs set "<task file>#done_when/tk-XXXX/dw-XXXX/proven_by" "../../execution-log.dd.json#entries/lg-XXXX"
node_modules/.bin/ddocs set "<task file>#done_when/tk-XXXX/dw-XXXX/state" checked
node_modules/.bin/ddocs set "<task file>#tasks/tk-XXXX/receipt" "<actual evidence pointer>"
node_modules/.bin/ddocs set "<task file>#tasks/tk-XXXX/note" "<progress or blocker>"
node_modules/.bin/ddocs get "<task file>#tasks/tk-XXXX"
```

Writers validate before mutation and rebuild generated siblings. No hand-edited `.dd.md` tables. Narrative architecture maps are explanatory views, not a second status source.

## Exit

Return exact changed paths/record IDs and remaining gaps to the caller. Routing is the flow's job — run the parent flow bare to continue.
