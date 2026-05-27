# compound-3-harvest

Curates saved retros into a prioritized view of recurring harness improvements.

## When to use

Run this when the team wants to know what to improve next:

- before a harness-improvement phase;
- before planning large work if many entries exist;
- at merge/review/phase debrief;
- after several sessions have produced retros;
- whenever the user asks what recurring friction or missing signal should be fixed.

## What it does

- Scans `docs/compound/agents/**/*.retro.md`.
- Clusters open/suggested entries by kind and target.
- Prioritizes by recurrence, severity, and age.
- Surfaces stale or blocking friction.
- Distinguishes ease improvements from back-pressure improvements such as runtime sensors, smoke flows, architecture checks, static analysis, security scans, and evidence capture.
- Supports explicit lifecycle updates such as encoded, dismissed, and wontfix.
- Does not write derived index files.

## Where it fits

This is the **harvest** step:

```text
durable retros -> compound-3-harvest -> prioritized harness improvements -> encoded fixes
```

Harvest is how the repo turns individual agent friction and missing proof surfaces into a practical improvement backlog.
