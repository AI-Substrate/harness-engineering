# The exemplar corpus moved

It now lives at **[`docs/how/dd/exemplar/`](../../../how/dd/exemplar/)**, beside
the reference that explains it.

```
docs/how/dd/
├── README.md            start here
├── 01-…10-…             the progressive reference
├── justfile             runnable examples — cd here and run `just`
└── exemplar/            ← the corpus that used to be here
    ├── plan.dd.json / .md
    ├── backpressure.dd.json / .md
    ├── execution-log.dd.json / .md
    ├── tasks/phase-2/tasks.dd.json / .md
    └── custom-render/   a self-contained corpus with its own schema + adapters
```

## Why it moved

The chapters under `docs/how/dd/` kept pointing *out* of their own folder at a
plan directory a reader has no reason to open. A worked corpus is documentation;
it belongs with the documentation.

## Why this stub is here rather than the links being rewritten

Several documents in this plan still reference the old path **on purpose**:
`tasks/phase-5-…/execution.log.md`, `tasks/phase-5-…/tasks.md`, and
`ship/2026-08-04/ship-report.md`.

Those are **historical records**. They describe where the corpus was when they
were written, and repointing them at a path that did not exist at the time would
make the record say something that was never true. Frozen provenance gets a
signpost, not a retro-edit — so those links land here, and this page sends you
on.

Everything still *living* — the reference chapters, the baked `dd docs` content,
the tests, `follow-ups.md`, the plan's own phase table — was updated to the new
path.
