# flow-coexist-eval — Rules

- **Drive the skills, don't hand-roll the flows.** Both the throwaway the-flow plan
  and the chore injection must be produced by running the `harness flow` commands the
  skills prescribe — never by hand-editing JSON. The CLI is the only writer.

- **Faithful flags.** Run prescribed commands with their **exact** flags; the only
  permitted change is `--path` → under `$OUT`. Do not invent the chore shape — take it
  from `eng-harness-flow`'s `flight-plan-ops.md` (kind=command, the four `--hook`
  commands, importance, dedup on the `--hook` token).

- **Coexistence rule (load-bearing).** While a the-flow is active the loop lives as
  **chores in `the-flow.json`** and **no `.harness/loop.flow.json` is authored**. If
  the skill ever has you author a standalone loop file here, that is a finding.

- **Idempotency by re-injection.** Run the injection twice and keep both snapshots
  (`after-first.json`, `reinjected.json`). A correct dedup-keyed injection leaves the
  node set byte-identical — report your own diff result honestly.

- **A skill-prescribed error is a finding, not a thing to fix.** Stop driving and
  record the exact command + error in `retrospective.confusing`.

- **Independent verification is mandatory.** Re-check from the artifacts with `--json`
  (`harness --json flow chores|rail|nav show …`, the global `--json` BEFORE `flow`),
  never on a skill's say-so.

- **Throwaway only.** All writes under `$OUT` (`.harness/temp/coexist-eval/$MINIH_RUN_ID`).
  Never touch `docs/plans/` or the real `.harness/`.

- **Capture friction at the moment of friction** — `retrospective.difficulties`,
  numbered `CX-NNN`, layer-tagged `project` | `minih`.
