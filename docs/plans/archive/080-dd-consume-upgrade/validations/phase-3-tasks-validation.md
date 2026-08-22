# Validation — phase-3/tasks.dd.json

- **Validated**: 2026-08-09T05:39:01Z
- **Target**: `docs/plans/080-dd-consume-upgrade/assets/tasks/phase-3/tasks.dd.json` (`sha256:5459e137ad05e49dd32ac4f06e496c6491ae75334f25467c60c93c9fdccf3c95`, commit `7723d53c`)
- **Contract sources**: prior F1-F4 record; phase-3 `context.md` hard rules; `plan.dd.json#ac-0003/ac-0006..ac-000c`; `assets/backpressure.dd.json#bp-0006..bp-0008`; fix commit `7723d53c`
- **Checks**: in-tree `dd validate` (0 errors/warnings); in-tree `plan validate` (0 errors/warnings, 0 contradictions/orphans); in-tree `dd build --check` (no drift); scoped source and task-id checks for F1-F4
- **Verdict**: VALIDATED
- **Thesis / proof**: phase-3 now gives the implementer an explicit, ordered conversion and retirement contract for every surface identified by F1-F4; Implementation target -> supported Implementation evidence
- **Consumers**: 4/4 satisfied — phase-3 implementer, final fork-less build, builder skill, and dd-native dogfood scenario

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | F1: production and test consumers lacked a conversion contract. | `tk-000c` inventories the six named production files and test adjudication; `tk-000d/dw-0022` requires their conversion or justified retirement. | Resolved |
| HIGH | F2: build, check, sensor, test, and architecture surfaces lacked retirement or re-aiming work. | `dw-0023` names `gen:dd-docs`, `check:dd-docs`, `test/acts/dd.test.ts`, the `dd-doctor` sensor, and every dependency-cruiser fork rule, and asserts tree absence after a full `just build`. | Resolved |
| HIGH | F3: prescriptive command surfaces lacked corpus-wide migration and absence proof. | `tk-0013/dw-0024` requires migration or retirement across docs, builder references, and the eval scenario, with a non-historical zero-reference proof and named frozen-provenance exemptions. | Resolved |
| MEDIUM | F4: the verb-removal control lacked temporal binding. | `dw-0018` requires the named in-tree command to succeed before deletion and fail as unknown after deletion, with both outputs and commit order logged. | Resolved |
