# Dogfood the harness flow

How to run the **full harness setup flow** against real, unfamiliar repositories
— in parallel — and collect what the runs teach you. This is the
`harness validate-harness-flow` dogfood extension and its `minih` worker.

> **Where docs live (for now):** user guides live under `docs/how/`. Documentation
> is planned to become a first-class, CLI-surfaced concept later; this guide is
> written standalone so it can be promoted/indexed without moving.

---

## What it does in one minute

`validate-harness-flow` proves the **whole setup story** — not one skill, but the
entire chain — on code the harness has never seen:

1. **Clone** a few small, public, cross-language repos (Node / Python / Go) to a
   temp dir.
2. **Fire one detached `minih` worker per clone**, in parallel, and return
   immediately. Each worker drives the full setup flow against its clone:
   - install the harness core,
   - run the **harnessability assessment** (`eng-harness-0-harnessability-assessment`),
   - **gate on the grade** — a poorly-harnessable repo is *abandoned* (reported, not failed),
   - **hand-write** `.harness/engineering-harness.md` governance from the 8 BIO fields,
   - **author a `boot` extension** via `eng-harness-0-add-extension` and prove it boots,
   - **record a retro** via `eng-harness-4-retro` / `harness record retro`.
3. **`--collect`** waits for the workers to reach a terminal state and aggregates
   each one's records + reports into `docs/plans/013-dogfood-harness-flow/runs/`.

It is the sibling of `validate-harnessability.ts` (which dogfoods only the
*assessment* skill); this one dogfoods the **entire flow**.

> **The worker drives the child setup skills directly — it never runs the
> interactive `eng-harness-flow` router.** That router is a print-then-offer
> conversation for a human; it cannot run headless. The worker follows the same
> ordered recipe the router would walk you through, one step at a time.

---

## Run it

```bash
# Fire the default pool (express / click / cobra), 3 in parallel, return immediately:
harness validate-harness-flow

# Override the targets:
harness validate-harness-flow --repo https://github.com/chalk/chalk.git

# Install the harness from GitHub instead of the local checkout:
harness validate-harness-flow --github

# Keep the temp clones + run dirs for inspection:
harness validate-harness-flow --keep
```

The verb returns at once with the run IDs and a `next_action` describing how to
poll. The workers keep running after it exits.

### Options

| Flag | Meaning |
|------|---------|
| `--repo <urls...>` | override the default target repos |
| `--keep` | keep the temp clones + run dirs |
| `--model <model>` | pass-through model for `minih run -m` |
| `--github` | install the harness into each clone from GitHub (sets the worker's `harnessSource=github`) |
| `--collect` | aggregate finished workers' records + reports |
| `--wait <seconds>` | with `--collect`: max seconds to poll workers to terminal (default 120) |
| `--out <dir>` | collection sink dir (default `docs/plans/013-dogfood-harness-flow/runs`) |

---

## Collect the results

When the runs show completed (`minih status validate-harness-flow`), aggregate:

```bash
harness validate-harness-flow --collect
```

`--collect` reads the `.last-fire.json` manifest the fire path wrote, polls each
worker to a **terminal state**, classifies it, and copies the records out:

| State | Meaning |
|-------|---------|
| `DONE` | the worker wrote a `report.json` with a terminal verdict — records copied |
| `TIMED_OUT` | still in flight when the `--wait` cap elapsed — re-run `--collect` later |
| `MISSING_REPORT` | the run terminated but left no report |
| `NOT_FIRED` | the clone never produced a run |

For every `DONE` run it copies, into `runs/<repo>/`:
- the worker's `report.json`,
- the harnessability `latest.{md,json}`,
- the hand-written `engineering-harness.md`,
- every `retro/*.md` the worker recorded,

and writes **`runs/ROLLUP.md`** — a table of every run plus the merged
magic-wand wishes and difficulties.

`--collect` is **idempotent**: re-running refreshes the copies and the rollup.
It **reads** each child's clone dir and never mutates the child's records.

---

## The verdict your worker reports

Each worker writes a structured report (`output-schema.json`):

- `verdict`: `PASS` (the whole recipe succeeded), `ABANDONED` (poor
  harnessability — a *valid, useful* outcome, not a failure), or `FAIL` (a step
  broke).
- `harnessabilityGrade` + the two-axis `axisTuple` (Operate-Today / Adaptability).
- `governanceWritten`, `bootAuthored`, `bootRuns`, `retroRecorded` + `retroRecordPaths[]`.
- a dual-layer `retrospective` (what to fix in *the project* vs *minih*).

**Abandonment** trips when `harnessabilityGrade` is **D, E, or F** (below "C —
workable"), or when Operate-Today is in the lowest band. The worker stops after
the assessment and reports the reason. The operator re-fires a held-back
alternate via `--repo`; the worker never self-substitutes.

---

## The one guarantee: surfaced, never auto-implemented

Retros and magic-wand wishes collected here are **surfaced for your review** —
the rollup lists them, and that is *all* it does. Nothing is auto-applied.

The **only** corrective change anyone makes during a dogfood run is **repairing a
broken record-write path** — e.g. if `harness record` itself errors, you fix that
so the record can be written. You never act on a retro's *content* mid-run. That
separation is what keeps the dogfood honest: it *observes* the flow, it does not
quietly *rewrite* it.

---

## See also

- The extension: [`.harness/extensions/validate-harness-flow.ts`](../../.harness/extensions/validate-harness-flow.ts)
- The worker agent: [`agents/validate-harness-flow/`](../../agents/validate-harness-flow/)
- The assessment-only sibling: [`.harness/extensions/validate-harnessability.ts`](../../.harness/extensions/validate-harnessability.ts)
- Records & record types: [`record-and-record-types.md`](./record-and-record-types.md)
- Extending the harness: [`extend-the-harness.md`](./extend-the-harness.md)
