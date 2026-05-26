# compound-0-setup

Scaffolds `docs/compound/`, the durable ledger for the harness Improve stage.

## When to use

Run this once per repo when:

- `boot-harness` reports the Improve loop is missing;
- `engineering-harness-setup` recommends creating the compound ledger;
- the repo wants to capture and harvest harness friction over time;
- `compound-1-track` cannot find `docs/compound/_buffers/`.

## What it does

- Creates `docs/compound/README.md`.
- Creates `docs/compound/_buffers/README.md`.
- Creates `docs/compound/_buffers/.gitignore`.
- Creates `docs/compound/agents/.gitkeep`.
- Respects `docs/compound/.disabled` as an opt-out sentinel.
- Leaves existing user content untouched.

## Where it fits

This creates the **place** where the Improve loop can land:

```text
compound-0-setup -> compound-1-track -> compound-2-bubble -> compound-3-harvest
```

Run it early if you want Known Difficulties and recurring friction to become visible at boot.

