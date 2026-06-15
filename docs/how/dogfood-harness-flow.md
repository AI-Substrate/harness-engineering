# Dogfood the harness flow

How to run the **onboarding-experience test** against real, unfamiliar
repositories — in parallel — and collect what the runs teach you. This is the
`harness validate-harness-flow` dogfood extension and its `minih` worker.

> **Where docs live (for now):** user guides live under `docs/how/`. Documentation
> is planned to become a first-class, CLI-surfaced concept later; this guide is
> written standalone so it can be promoted/indexed without moving.

---

## What it does in one minute

`validate-harness-flow` proves the **onboarding story** — can a fresh agent,
given nothing but a goal, take an unfamiliar repo from *no harness* to a
*working, observable engineering harness* using only the product's own
documentation and skills?

1. **Clone** a few small, public, cross-language repos (Node / Python / Go) to a
   temp dir.
2. **Fire one detached `minih` worker per clone**, in parallel, and return
   immediately. Each worker gets a **goal brief, not a runbook**: *"this
   freshly cloned repo has no harness — starting from the product repo's
   README, using the product's own documentation and installed skills, set up
   a working engineering harness, prove it works, and record your experience."*
   The full `eng-harness-*` skill surface is mounted (7 skills, parity with
   `.minih.json`); how the worker finds the path — README → skills loop →
   CLI self-briefing — is exactly what the test measures.
3. **`--collect`** waits for the workers to reach a terminal state, aggregates
   each one's records + reports into `docs/plans/013-dogfood-harness-flow/runs/`,
   and **grades each DONE clone with deterministic probes**.

It is the sibling of `validate-harnessability` (which dogfoods only the
*assessment* skill); this one dogfoods the **whole onboarding experience**.

> **The worker is told almost nothing.** Its brief carries test plumbing only
> (parameters, the throwaway rule, abandonment-is-valid, don't drive an
> interactive router headless, the report path). If a worker gets lost, the fix
> goes into the product's docs and skills — never into the brief. That is the
> point: the brief leaking product knowledge would blind the test to onboarding
> regressions.

---

## Run it

```bash
# Fire the default pool (express / click / cobra), 3 in parallel, return immediately:
harness validate-harness-flow

# Override the targets:
harness validate-harness-flow --repo https://github.com/chalk/chalk.git

# Install the harness from GitHub instead of the local checkout:
harness validate-harness-flow --github

# Skip the install step — use the harness already installed globally on this machine:
harness validate-harness-flow --global

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
| `--global` | skip the install step — workers use the globally-installed `harness` on PATH (sets `harnessSource=global`). Probes adapt: the CLI is probed via PATH and **Skills local** renders `—` (N/A), since the project-local install is skipped by design. Use when the product is already installed on the machine (e.g. validating the *flow* — adopt/init/boot — without re-testing install plumbing). |
| `--collect` | aggregate finished workers' records + reports, probe the clones |
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
| `DONE` | the worker wrote a `report.json` with a terminal verdict — records copied, clone probed |
| `TIMED_OUT` | still in flight when the `--wait` cap elapsed — re-run `--collect` later |
| `MISSING_REPORT` | the run terminated but left no report |
| `NOT_FIRED` | the clone never produced a run |

For every `DONE` run it copies, into `runs/<repo>/`:
- the worker's `report.json`,
- the harnessability `latest.{md,json}`,
- every `retro/*.md` the worker recorded,

and writes **`runs/ROLLUP.md`** — the runs table, the **probes table**, any
probe-vs-self-report discrepancy flags, and the merged magic-wand wishes and
difficulties.

`--collect` is **idempotent**: re-running refreshes the copies, probes, and the
rollup. It **reads** each child's clone dir and never mutates the child's
records. Probes run against the clones on disk, so collect **before** cleaning
the temp root.

### The probes (deterministic grading)

The extension grades each DONE clone itself — the worker's booleans are kept
only as an advisory cross-check:

| Probe | What it proves |
|-------|----------------|
| Assessed | an assessment report exists in the clone |
| Doctor | `doctor --json` parses; conventions clean (incl. temp hygiene) |
| Boot env | a `boot` verb exists; status/exit pair legal; `next_action` on non-ok |
| Retro rec | a retro record exists with parseable frontmatter |
| Drained | observe buffer has 0 pending entries |
| Temp ignore / Temp clean | `temp/.gitignore` intact; no `.harness/temp/` in `git status` |
| Skills local | `eng-harness-*` skills installed **project-local in the clone** (both groups; the minih mount does not count) |
| Observe (INFO) | pending/recorded observation counts — **informational, not graded** |

Applicability: PASS/FAIL verdicts get the full set; ABANDONED runs are graded
on Assessed only (stopping there is the point); TIMED_OUT / MISSING_REPORT /
NOT_FIRED render `—`.

Two asymmetries are deliberate: **Skills local is graded** because the clone
must stand alone for the next agent that opens it; **observe usage is INFO**
because we watch how workers discover the capture verb before grading
discovery. A Skills-local ✗ can be **mount-suppression** — the worker never
*needed* a project-local install because minih mounted the skills into its
session — rather than a product failure; the operator briefing
(`harness instructions validate-harness-flow`) covers how to tell them apart
from the worker's retrospective.

If a probe disagrees with the worker's `bootRuns` / `retroRecorded` claim, the
rollup flags it in a **⚠️ discrepancies** section — treat the clone as the
truth and the claim as the finding.

---

## The verdict your worker reports

Each worker writes a structured report (`output-schema.json`):

- `verdict`: `PASS` (the clone ends with a working, proven harness),
  `ABANDONED` (the worker's assessment judged the repo poorly harnessable — a
  *valid, useful* outcome, not a failure), or `FAIL` (a step broke).
- `harnessabilityGrade` + the two-axis `axisTuple` (Operate-Today / Adaptability).
- `bootAuthored`, `bootRuns`, `retroRecorded` + `retroRecordPaths[]` — advisory
  self-reports the probes cross-check.
- a dual-layer `retrospective` (what to fix in *the project* vs *minih*) — for
  a goal-briefed worker this doubles as the **onboarding journey**: where it
  started, which docs it found, where it got lost. The doc gaps it reports are
  the test's primary product.

**Abandonment** is the worker's call, grounded in the assessment's own report
(the grade and axis detail live there). The worker stops after the assessment
and reports the reason. The operator re-fires a held-back alternate via
`--repo`; the worker never self-substitutes.

---

## The one guarantee: surfaced, never auto-implemented

Retros, magic-wand wishes, and doc gaps collected here are **surfaced for your
review** — the rollup lists them, and that is *all* it does. Nothing is
auto-applied.

The **only** corrective change anyone makes during a dogfood run is **repairing a
broken record-write path** — e.g. if `harness record` itself errors, you fix that
so the record can be written. You never act on a retro's *content* mid-run. That
separation is what keeps the dogfood honest: it *observes* the flow, it does not
quietly *rewrite* it.

---

## See also

- The extension: [`.harness/extensions/validate-harness-flow/extension.ts`](../../.harness/extensions/validate-harness-flow/extension.ts)
- The worker agent: [`agents/validate-harness-flow/`](../../agents/validate-harness-flow/)
- The assessment-only sibling: [`.harness/extensions/validate-harnessability/`](../../.harness/extensions/validate-harnessability/)
- Records & record types: [`record-and-record-types.md`](./record-and-record-types.md)
- Extending the harness: [`extend-the-harness.md`](./extend-the-harness.md)
