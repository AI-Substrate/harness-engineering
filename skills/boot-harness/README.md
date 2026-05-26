# boot-harness

Boots the repo-local engineering harness at the start of an engineering session.

## When to use

Run this when the user says:

- "boot the harness";
- "start the harness";
- "get ready to work";
- "start an engineering session";
- "use the harness before we begin".

If no harness exists, this skill fails fast and recommends `engineering-harness-setup`.

## What it does

- Finds the harness contract.
- Reads the `AGENTS.md` harness signpost.
- Locates the Improve loop (`docs/compound/`, friction logs, magic-wand prompts).
- Extracts boot, health, interaction, observation, and validation guidance.
- Runs safe doctor/health/dry-run checks where configured.
- Reviews Known Difficulties.
- Produces a harness boot report.

## Where it fits

This is the **clock-in** step:

```text
install skills -> engineering-harness-setup -> boot-harness -> work through the harness
```

The key rule is that boot is not only startup. Boot orients the agent to the loop it must improve. If `boot-harness` finds no Improve ledger, run `compound-0-setup`.

