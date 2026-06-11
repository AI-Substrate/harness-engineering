# eng-harness-0-add-extension skill

Scaffold and validate a new `harness <verb>` extension for the current repo.

This skill is the **authoring companion** to the `harness new` core CLI command:
the CLI deterministically writes a loadable extension skeleton; the skill figures
out *what* extension you want (reusing any intent already gathered by a
spec-driven flow), fills the handler, and proves it loaded with
`harness doctor` / `harness help`.

## When to use

- You decided to extend the harness with a new command and want it set up
  correctly in one pass.
- A spec/plan/workshop already describes a verb to add — the skill reuses that
  context instead of re-interviewing you.

## What it does

1. Determines the verb's name + behaviour (obvious-from-context → use it;
   ambiguous → asks).
2. Runs `harness new <name> [--wrap "<cmd>"] [--js]` to scaffold a loadable stub
   in `.harness/extensions/`.
3. Fills the `run(ctx)` handler from the intent.
4. Verifies and shows the proof (`doctor` loaded, `help` lists it, invocation).

## See also

- `harness/cli/docs/authoring-verbs.md` — the full verb contract.
- `docs/how/extend-the-harness.md` — the end-to-end user guide.
- `AUTHORING.md` — notes for maintaining this skill.
