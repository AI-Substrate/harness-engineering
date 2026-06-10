# validate-harness-flow — Run Rollup

**Collected**: 2026-06-10T05:16:50.492Z  ·  **Fired**: 2026-06-10T05:03:58.744Z
**Agent**: validate-harness-flow  ·  **Temp root**: /tmp/harness-flow-selftest-2026-06-10T05-03-54-224Z

**Totals**: DONE 1 · TIMED_OUT 0 · MISSING_REPORT 0 · NOT_FIRED 0

> Retros + magic-wands below are **surfaced for review, never auto-implemented**. The only corrective change a dogfood run is *permitted* to make is repairing a broken record-write path (none was needed here unless noted).

## Runs

| Repo | State | Verdict | Grade | Operate/Adapt | Abandoned | Boot | Retro | Copied |
|------|-------|---------|-------|---------------|-----------|------|-------|--------|
| chalk | DONE | PASS | B | C/B | no | ✓ | ✓ | 4 files |

## Probes (deterministic, per clone)

> Probes grade the **clone**, not the worker's claims. **Skills local** is graded because the clone must stand alone — the next agent that opens it gets the `eng-harness-*` skills project-local (the minih mount does not count). **Observe** is INFO, not graded — we watch how workers discover the capture verb before grading discovery. A Skills-local ✗ can be **mount-suppression** (the worker never *needed* a project-local install because minih mounted the skills) rather than a product failure — read the worker retrospective to tell them apart. Applicability: PASS/FAIL runs get full probes; ABANDONED runs are graded on Assessed only; TIMED_OUT / MISSING_REPORT / NOT_FIRED render `—`.

| Repo | Assessed | Doctor | Boot env | Retro rec | Drained | Temp ignore | Temp clean | Skills local | Observe (INFO) |
|------|----------|--------|----------|-----------|---------|-------------|------------|--------------|----------------|
| chalk | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 0 pending / 3 recorded |

- **chalk** skills-local ✗ — no project-local eng-harness-* skills (the minih mount does not count)

### ⚠️ Probe vs self-report discrepancies

_None — self-reports and probes agree._

## Magic-wand wishes (surfaced)

- **chalk** (project): Make local-source dogfood install a single deterministic command that builds the harness package outside the consumer repo and installs a packed artifact into the target, so the target repo's older dev toolchain cannot break harness setup.

## Difficulties (surfaced)

### project

- **chalk** `VF-001` [build]: Local-source CLI install first failed because npm ran the harness package prepare script against Chalk's older TypeScript toolchain.
- **chalk** `VF-002` [config]: `harness init --json` is documented as a graceful missing-command fallback, but this CLI returned a generic E108 root parser error instead of an init-specific unavailable envelope.
- **chalk** `VF-003` [knowledge]: Piping `harness instructions boot` for a short preview switched output to JSON because stdout was non-TTY, which made a quick human text preview less direct.
- **chalk** `VF-004` [debug]: A `harness observe` capture used backticks inside a double-quoted shell argument, so the shell executed the command before `harness observe` saw the text and bloated the observation buffer.


## Per-run artifacts

- **chalk/** — report.json, harnessability/latest.md, harnessability/latest.json, retro/2026-06-10/001-validate-harness-flow.md
