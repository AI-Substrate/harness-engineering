# compound-1-track

Silently captures material friction or improvement ideas during work.

## When to use

Run this silently when the agent observes meaningful friction:

- a command/search/test/build step blocks for a long time;
- an expected search returns nothing and causes backtracking;
- the same operation is retried more than once;
- a boot/build/test failure is hard to interpret;
- a harness command, fixture, diagnostic, evidence path, or validation check is missing;
- the agent has a concrete "if only there were..." magic-wand idea.

Do not use it for trivial preferences or constant self-reflection.

## What it does

- Appends one YAML entry to `docs/compound/_buffers/<agent>.session-buffer.md`.
- Creates the per-agent buffer file if `_buffers/` exists.
- Does not prompt the user.
- Does not apply fixes.
- Does not drain or curate entries.

## Where it fits

This is the **quiet capture** step:

```text
work -> compound-1-track -> compound-2-bubble
```

The user should usually only see the captured entries later through `compound-2-bubble`.

