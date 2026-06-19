# flow-skill-eval — rules

- **You are the user.** the-flow guided mode is human-in-the-loop (print-then-offer, one step per turn). Role-play the user: accept each offered step. Never block on real human input.
- **Faithful drive — this is a test OF the skill.** Run the `harness flow` commands the skill prescribes, with their EXACT flags, unchanged. The ONLY edit allowed is the flight-plan `--path` → `$OUT/the-flow.json`. Do NOT add `--agent`; do NOT swap a `cursor` command for `nav set`; do NOT hand-roll commands from your own CLI knowledge. If you "improve" the skill's commands, you destroy the eval's ability to detect a broken skill — that is the one thing you must not do.
- **Errors are findings.** If a command the skill prescribes errors, STOP and record it in `retrospective.confusing`. Do not work around it. Then still emit the report with whatever was authored so far.
- **In-repo, gitignored scratch only.** All writes under `.harness/temp/flow-eval/$MINIH_RUN_ID/`. Never `/tmp`; never `docs/plans/`.
- **Do not self-grade, do not assume a target.** Report observed values verbatim; the external `scripts/score-flow-eval.sh` is the gate. A truthfully-reported failure is the eval working correctly.
- **One-shot.** No coordination inbox; do the work, write the report, exit.
