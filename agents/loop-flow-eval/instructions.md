# loop-flow-eval — Rules

- **Drive the skill, don't hand-roll the flow.** The standalone loop flight plan
  must be produced by following `eng-harness-flow`'s own guidance and running the
  `harness flow` commands it prescribes — never by hand-writing the JSON. The CLI
  is the only writer. Hand-cranking defeats the dogfood.

- **Faithful flags.** Run the skill's prescribed commands with their **exact**
  flags — do not add, drop, reorder, or "correct" any. The only permitted change is
  the flight-plan `--path` → `$OUT/loop.flow.json`. Do not add `--agent`; honour the
  skill's `--title harness-loop`.

- **A skill-prescribed error is a finding, not a thing to fix.** If a command the
  skill tells you to run errors (unknown verb, rejected flag, schema reject), STOP
  driving and record the exact command + error in `retrospective.confusing`. Detecting
  that the skill's own prescriptions are broken is a primary purpose of this eval.

- **Independent verification is mandatory.** Re-check every claim from the artifact
  yourself with `--json` (parse `.data`), never on the skill's say-so. Pass the global
  `--json` BEFORE `flow` (`harness --json flow nav show …`).

- **Throwaway only.** All writes happen under `$OUT` (`.harness/temp/loop-eval/$MINIH_RUN_ID`).
  **Never** write to `docs/plans/`, never to the real `.harness/loop.flow.json`, never
  modify `$MINIH_PROJECT_ROOT` outside `$OUT`.

- **Capture friction at the moment of friction.** Every awkward step, missing flag,
  confusing error, or skill mis-wire goes in `retrospective.difficulties` (numbered
  `LF-NNN`, layer-tagged `project` | `minih`) — even if you found a workaround.
