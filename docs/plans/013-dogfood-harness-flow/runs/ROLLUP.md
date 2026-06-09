# validate-harness-flow — Run Rollup

**Collected**: 2026-06-09T13:12:49.227Z  ·  **Fired**: 2026-06-09T12:48:32.854Z
**Agent**: validate-harness-flow  ·  **Temp root**: /tmp/harness-flow-selftest-2026-06-09T12-48-22-100Z

**Totals**: DONE 3 · TIMED_OUT 0 · MISSING_REPORT 0 · NOT_FIRED 0

> Retros + magic-wands below are **surfaced for review, never auto-implemented**. The only corrective change a dogfood run is *permitted* to make is repairing a broken record-write path (none was needed here unless noted).

## Runs

| Repo | State | Verdict | Grade | Operate/Adapt | Abandoned | Gov | Boot | Retro | Copied |
|------|-------|---------|-------|---------------|-----------|-----|------|-------|--------|
| express | DONE | PASS | B | B/B | no | ✓ | ✓ | ✓ | 5 files |
| click | DONE | PASS | B | B/B | no | ✓ | ✓ | ✓ | 5 files |
| cobra | DONE | PASS | B | B/B | no | ✓ | ✓ | ✓ | 5 files |

## Magic-wand wishes (surfaced)

- **express** (project): Ship a non-interactive `harness setup --json --repo <path>` orchestrator that delegates to the same child setup skills, emits step Envelopes, and includes a real `harness init` writer for the BIO governance doc.
- **click** (project): Ship npx harness init --from-assessment .harness/reports/harnessability/latest.json so governance is generated from the assessment and the setup flow no longer requires hand-writing the BIO contract.
- **cobra** (project): Ship a headless `harness setup --repo <path> --boot "go test ./..." --json` command that handles repo-local npm prefixing, writes the harnessability reports, generates `.harness/engineering-harness.md`, scaffolds/fills/verifies `boot`, and returns all authored paths in one Envelope.

## Difficulties (surfaced)

### minih

- **express** `VF-001` [config]: The shell did not expose MINIH_PROJECT_ROOT even though the run instructions required starting from it.
- **click** `VF-006` [config]: The generic output instructions used MH-001 examples, but the Validate Harness Flow rules required VF-001 numbering, creating a small reporting convention conflict.
- **cobra** `VF-006` [knowledge]: The required output instructions say difficulty IDs should be VF-NNN, while the generic schema example says MH-NNN, creating conflicting numbering guidance.

### project

- **express** `VF-002` [knowledge]: There is no shipped harness init writer, so the governance doc had to be hand-written from the BIO template.
- **express** `VF-003` [debug]: npx harness doctor --json worked but reported cli-build degraded because it looked for harness/cli/dist inside the target clone.
- **express** `VF-004` [test]: The first plain `npx harness boot` invocation returned error even though `npx harness boot --json` and direct `npm test` passed immediately afterward.
- **express** `VF-005` [test]: A duplicate final `npx harness boot --json` verification hung in Mocha after earlier successful boot verification.
- **click** `VF-001` [build]: The local file install made npx harness callable, but harness doctor reported cli-build degraded because harness/cli/dist/index.js was not present in the consumer clone.
- **click** `VF-002` [knowledge]: The harnessability assessment skill is a prose skill with a rich schema but no deterministic command, so producing the report required manual report assembly while still following the skill contract.
- **click** `VF-003` [config]: There is no harness init writer, so the governance contract had to be hand-written from the BIO template.
- **click** `VF-004` [knowledge]: harness new --wrap generated a loadable boot extension with a TODO summary, requiring a manual metadata edit before the verb looked production-ready in help.
- **click** `VF-005` [debug]: The successful wrapped boot envelope only reported the command, not stdout, duration, test count, or artifact paths, so independent proof required checking pytest cache side effects.
- **click** `VF-007` [debug]: While filling the retro record, a delete-only patch briefly removed the scaffolded file before it was immediately restored at the same returned harness record path.
- **cobra** `VF-001` [config]: The documented local install command `npm install $MINIH_PROJECT_ROOT` is unsafe in a Go repo with no package.json because npm chose /tmp as the prefix and tried to write /private/tmp/node_modules instead of the target clone.
- **cobra** `VF-002` [build]: `harness doctor --json` stayed degraded after installation because the local file install pointed at a harness source tree whose `harness/cli/dist/index.js` was not built, even though the npx harness command itself worked.
- **cobra** `VF-003` [knowledge]: The harnessability assessment skill is guidance-only in this CLI context; it does not expose a single command that writes the required report, so the agent had to manually produce the skill's report artifacts while following the skill contract.
- **cobra** `VF-004` [knowledge]: The flow requires governance to be hand-written because no `harness init` writer is shipped yet, which forces agents to copy the BIO contract manually.
- **cobra** `VF-005` [test]: `harness new boot --wrap` produced a loadable stub with a placeholder summary and hard error behavior on wrapped command failure, so it was not yet an honest boot Envelope for degraded test failures.


## Per-run artifacts

- **express/** — report.json, harnessability/latest.md, harnessability/latest.json, engineering-harness.md, retro/2026-06-09-express-flow.md
- **click/** — report.json, harnessability/latest.md, harnessability/latest.json, engineering-harness.md, retro/2026-06-09-click-flow.md
- **cobra/** — report.json, harnessability/latest.md, harnessability/latest.json, engineering-harness.md, retro/2026-06-09-cobra-flow.md
