# validate-harness-flow — Run Rollup

**Collected**: 2026-06-15T00:01:12.686Z  ·  **Fired**: 2026-06-14T23:52:27.387Z
**Agent**: validate-harness-flow  ·  **Temp root**: /tmp/harness-flow-selftest-2026-06-14T23-52-23-096Z

**Totals**: DONE 1 · TIMED_OUT 0 · MISSING_REPORT 0 · NOT_FIRED 0

> Retros + magic-wands below are **surfaced for review, never auto-implemented**. The only corrective change a dogfood run is *permitted* to make is repairing a broken record-write path (none was needed here unless noted).

## Runs

| Repo | State | Verdict | Grade | Operate/Adapt | Abandoned | Boot | Retro | Copied |
|------|-------|---------|-------|---------------|-----------|------|-------|--------|
| chalk | DONE | PASS | B | B/B | no | ✓ | ✓ | 4 files |

## Probes (deterministic, per clone)

> Probes grade the **clone**, not the worker's claims. **Skills local** is graded because the clone must stand alone — the next agent that opens it gets the `eng-harness-*` skills project-local (the minih mount does not count). **Observe** is INFO, not graded — we watch how workers discover the capture verb before grading discovery. A Skills-local ✗ can be **mount-suppression** (the worker never *needed* a project-local install because minih mounted the skills) rather than a product failure — read the worker retrospective to tell them apart. Applicability: PASS/FAIL runs get full probes; ABANDONED runs are graded on Assessed only; TIMED_OUT / MISSING_REPORT / NOT_FIRED render `—`.

| Repo | Assessed | Doctor | Boot env | Retro rec | Drained | Temp ignore | Temp clean | Skills local | Observe (INFO) |
|------|----------|--------|----------|-----------|---------|-------------|------------|--------------|----------------|
| chalk | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | 0 pending / 4 recorded |

### ⚠️ Probe vs self-report discrepancies

_None — self-reports and probes agree._

## Magic-wand wishes (surfaced)

- **chalk** (project): Make the harnessability assessment skill expose one deterministic command that writes and schema-validates the assessment report skeleton from gathered evidence, so adoption can consume `latest.json` without the agent hand-assembling optional v0.2 arrays.

## Difficulties (surfaced)

### minih

- **chalk** `VF-004` [config]: The run input allowed `harnessSource: global`, but the worker output schema's `harnessSource` enum only listed `local` and `github`.

### project

- **chalk** `VF-001` [knowledge]: The assessment skill is a long authoring contract rather than a runnable assessment command, so producing its artifact required manually assembling JSON/Markdown and fixing schema-specific optional survey fields.
- **chalk** `VF-002` [knowledge]: The adoption skill says to propose and ask before edits, but this validator is a single-shot onboarding probe with prior throwaway-clone permission and no human approval turn.
- **chalk** `VF-003` [config]: `harness doctor --json` reported `degraded` because the global toolchain layer wanted `biome`, even though this consumer repo's extension layer loaded and `harness boot --json` returned `ok`.


## Per-run artifacts

- **chalk/** — report.json, harnessability/latest.md, harnessability/latest.json, retro/2026-06-14/001-validate-harness-flow.md
