# engineering-harness-setup

Creates or validates the repo-local engineering harness nucleus.

## When to use

Run this when a target repo does not yet have a clear engineering-harness entry point, or when you need to refresh/validate the existing harness contract.

Use it before feature work if the repo is missing:

- `docs/project-rules/engineering-harness.md`;
- a starter command surface under `harness/cli/`;
- a clear boot command;
- a health check;
- an interaction/observe path;
- an `AGENTS.md` signpost that tells future agents where the harness lives.

## What it does

- Detects the project type and likely boot/health surfaces.
- Creates or validates `docs/project-rules/engineering-harness.md`.
- Asks whether the starter CLI should use Python stdlib, Node stdlib, or an existing/other tool.
- Creates `harness/cli/` with a starter command map and either a tiny Python/Node CLI or instructions for the chosen existing tool.
- Requires the starter CLI to have agent-friendly `--help` and actionable errors with clear next actions.
- Records Boot, Interact, Observe, Validate, and Improve guidance.
- Seeds Known Difficulties from `docs/compound/` if compound retros exist.
- Patches `AGENTS.md` with a pointer to the engineering harness.
- Recommends `compound-0-setup` when the Improve ledger is missing.

## Where it fits

This is the **setup** step in the broader loop:

```text
engineering-harness-setup -> boot-harness -> work -> compound-1-track -> compound-2-bubble -> compound-3-harvest -> encode fixes
```

Use it to establish the harness nucleus. Use `boot-harness` to start day-to-day sessions through that harness.
