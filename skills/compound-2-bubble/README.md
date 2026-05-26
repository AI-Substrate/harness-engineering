# compound-2-bubble

Presents the one normal user-facing prompt for captured compound entries.

## When to use

Run this at a natural pause:

- end of an engineering session;
- end of a phase or implementation checkpoint;
- before handoff;
- before merge/review close-out;
- start of a new session if the prior buffer is non-empty;
- when the user asks to review captured friction.

If the buffer is empty, it should be silent.

## What it does

- Reads `docs/compound/_buffers/<agent>.session-buffer.md`.
- Presents one soft triage prompt if entries exist.
- Lets the user save, task, plan, stage an encoding, dismiss, or all-save.
- Writes selected entries to `docs/compound/agents/<agent>/<date>/*.retro.md`.
- Clears the session buffer after handling it.

## Where it fits

This is the **bubble** step:

```text
compound-1-track -> compound-2-bubble -> durable retros -> compound-3-harvest
```

It preserves user control. Captured entries do not become work until the user saves, tasks, plans, or encodes them.

