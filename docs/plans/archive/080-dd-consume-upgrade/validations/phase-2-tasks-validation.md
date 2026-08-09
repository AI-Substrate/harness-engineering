# Validation — phase-2/tasks.dd.json

- **Validated**: 2026-08-09T04:21:08Z
- **Target**: `docs/plans/080-dd-consume-upgrade/assets/tasks/phase-2/tasks.dd.json` (`e25d82b0f057dad43c4737d0d344f1a717f338f3`, commit `5d090cd4`)
- **Contract sources**: prior findings in this sidecar at `b2794645`; phase-2 `context.md` hard rules 1, 3, and 4; `backpressure.dd.json#rows/bp-000d`
- **Checks**: scoped source re-check of `dw-000c`, `dw-000f`, `dw-0012`, `dw-0013`, and `bp-000d`; in-tree `dd validate` for task and backpressure documents (0 errors/warnings); in-tree `plan validate` (0 errors/warnings); in-tree task/backpressure `dd build --check` (no drift); fix commit inspection
- **Verdict**: VALIDATED
- **Thesis / proof**: advanced — all three prior HIGH findings are resolved at contract level and the deterministic documents remain valid and drift-free; Implementation target -> supported Implementation evidence
- **Consumers**: phase-2 implementer and OQ-2 verdict consumer are unblocked on F1-F3

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | F1: RED-first falsifier evidence was prediction-biased and final sufficient verdicts accepted incomplete evidence. | `dw-000c` now binds all nine primitives regardless of predicted or final verdict; `dw-0012` requires test id, RED commit SHA, run command, and result for every SUFFICIENT verdict. | Resolved |
| HIGH | F2: the D-3 vocabulary guard was neither deterministic over the implementation closure nor outcome-neutral. | `dw-000f` now probes constant names and value tuples across the transitive local file closure on every outcome, permits only public-package imports, and blocks on any local copy; `dw-0013` requires its result in the verdict packet. | Resolved |
| HIGH | F3: `bp-000d` licensed a phase-2 update to the frozen digest. | `bp-000d` now requires the `FROZEN_DIGEST` pin to stay unchanged and green throughout phase 2 while commit order separately proves RED-to-GREEN chronology. | Resolved |
