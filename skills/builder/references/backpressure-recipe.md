# Canonical backpressure and proof recipe

One source: `${PLAN_DIR}/assets/backpressure.dd.json`, schema `builder/backpressure`. Its `.dd.md` is generated, not a second survey. Both Builder and eng-harness-flow use this recipe. Historical coverage Markdown is read-only context; new surveys never overwrite it or use it as canonical truth.

## Select before running

Read the actual tooling across all workspace roots, then select the proof of each AC/failure mode. A filename or a green unrelated suite is not evidence of coverage.

| Selected approach | Stored `mode` | `proof` | Meaning |
|---|---|---|---|
| RUN | EXISTS | `RUN: <paved command>` | existing sensor covers the claim |
| EXTEND | EXTEND | `EXTEND→RUN: <specific extension>; then <same command>` | extend an existing sensor first |
| BUILD | BUILD | `BUILD→RUN: <specific check/affordance>; then <proposed command>` | proposed command, not runnable proof yet |
| ABSENT | ABSENT | named judgement and reason, no fake command | record searched roots/signatures in `probe` |

`tier` is `computational|human-judgement` in the actual schema. AI review is judgement, not another schema enum. `meta.certainty` is `Partial|Confident|Proven`: Partial means material gaps remain; Confident means a credible selected approach exists but its current result is not proven; Proven requires observed applicable receipts, with any remaining human judgement named. Counts are descriptive; no scalar score or threshold.

## Author through the local writer

Use `node_modules/.bin/ddocs`; capability-check it first. Missing local installation is a named prerequisite, never a registry fetch. Initial documents use the supplied `templates/backpressure.template.json` and `templates/execution-log.template.json` seeds (copy only when absent); after creation all mutation is through the DD CLI. Do not overwrite existing surveys/logs or their IDs.

```bash
BP="${PLAN_DIR}/assets/backpressure.dd.json"
LOG="${PLAN_DIR}/assets/execution-log.dd.json"
PLAN="${PLAN_DIR}/plan.dd.json"
TASKS="${PLAN_DIR}/assets/tasks/phase-1/tasks.dd.json"
node_modules/.bin/ddocs set "${BP}#meta/plan" "../plan.dd.json#meta"
node_modules/.bin/ddocs set "${BP}#meta/certainty" Confident
node_modules/.bin/ddocs add "${BP}#rows" '{"criterion":"<AC and experienced failure mode>","phase":"ph-XXXX","mode":"EXISTS","tier":"computational","proof":"RUN: <actual paved command>","state":"unchecked","probe":"<where the sensor was found>"}' --mint bp
node_modules/.bin/ddocs set "${PLAN}#meta/backpressure" "assets/backpressure.dd.json#rows"
node_modules/.bin/ddocs set "${PLAN}#acceptance_criteria/ac-XXXX/pressure" "assets/backpressure.dd.json#rows/bp-XXXX"
# For a NEW task only: initialize its absent assertion list; never reset an existing list.
node_modules/.bin/ddocs set "${TASKS}#done_when/tk-XXXX" '[]' --value-json
node_modules/.bin/ddocs add "${TASKS}#done_when/tk-XXXX" '{"assertion":"<observable task outcome>","state":"unchecked","pressure":"../../backpressure.dd.json#rows/bp-XXXX"}' --mint dw
```

Use the IDs returned by `add`. From `assets/tasks/phase-1/`, the survey is **`../../backpressure.dd.json`**, while the plan is **`../../../plan.dd.json`**. Link `tasks[].done` to its `done_when` list and `tasks[].satisfies` (or incremental `satisfies_toward`) to the ACs. Every assertion names pressure; the schema's `not-applicable` escape needs the actual alternative instrument explained, never a way to hide missing proof.

Record the surveyed plan's full SHA-256 in `meta.basis_sha` **after** these product/pressure links are written. Re-entry compares that basis to current intent; changes require a fresh survey, not an old receipt pasted over a new plan. Do not create circular pinned transclusions for live progress links.

Re-surveys update existing rows in place with `node_modules/.bin/ddocs set "${BP}#rows/bp-XXXX/<field>" <value>`; use `add --mint bp` only for a NEW criterion, never re-seed the document or re-mint IDs for existing criteria.
For a removed criterion, use `node_modules/.bin/ddocs links` to locate every AC/assertion caller, update or remove those links through the DD CLI, then remove the obsolete row with `node_modules/.bin/ddocs rm`; stable row IDs keep existing pressure links attached to the same criterion.

## Observe, then link proof back

Actually execute the selected command after any extension/build. Preserve command, cwd, exit status, output and subject SHA in an evidence file. Record a timestamp from the clock, not an example date. Only then append an execution entry and link the AC back to it:

```bash
node_modules/.bin/ddocs add "${LOG}#entries" '{"at":"<observed ISO timestamp>","text":"<command, cwd, exit, artifact SHA and evidence pointer>","links":["../plan.dd.json#acceptance_criteria/ac-XXXX","backpressure.dd.json#rows/bp-XXXX"]}' --mint lg
node_modules/.bin/ddocs set "${PLAN}#acceptance_criteria/ac-XXXX/proven_by" "assets/execution-log.dd.json#entries/lg-XXXX"
node_modules/.bin/ddocs set "${BP}#rows/bp-XXXX/receipt" "execution-log.dd.json#entries/lg-XXXX"
node_modules/.bin/ddocs set "${BP}#rows/bp-XXXX/state" checked
node_modules/.bin/ddocs set "${TASKS}#done_when/tk-XXXX/dw-XXXX/state" checked
node_modules/.bin/ddocs set "${PLAN}#acceptance_criteria/ac-XXXX/state" checked
node_modules/.bin/ddocs validate "${PLAN}"
node_modules/.bin/ddocs validate "${BP}"
node_modules/.bin/ddocs build "${BP}" --check
```

A failed run remains an observed failure: leave the claim unchecked/blocked, preserve the output and name the repair. A copied template, selected command, unexecuted test or missing runtime cannot be recorded as successful proof. Review assesses receipt relevance; it does not change what ran.

## Executable worked recipe

`node skills/builder/examples/proof-recipe.mjs <new-output-directory>` creates a private example corpus, executes the real local DD writer and the injected-service example, verifies the pressure/proven_by targets and validates the resulting documents. It refuses an existing destination and returns actual command receipts. The example is independent of any live plan; its evidence proves the recipe, not your feature.
