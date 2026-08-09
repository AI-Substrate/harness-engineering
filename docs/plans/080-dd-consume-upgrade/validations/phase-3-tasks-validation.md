# Validation — phase-3/tasks.dd.json

- **Validated**: 2026-08-09T05:34:00Z
- **Target**: `docs/plans/080-dd-consume-upgrade/assets/tasks/phase-3/tasks.dd.json` (`sha256:129a352c03585d312dc764debea70d6224ab3fbc7146dfda9b42b697dfbaacf2`, commit `c0df9b6a`)
- **Contract sources**: phase-3 `context.md` hard rules; `plan.dd.json#ac-0003/ac-0006..ac-000c`; `backpressure.dd.json`; `dogfood-ledger.md` entries 1/2 and mechanism-copy drift surface; phase-2 `trial-report.md`
- **Checks**: in-tree `dd validate` (0 errors/warnings); in-tree `plan validate` (0 errors/warnings, 0 contradictions/orphans); in-tree `dd build --check` (no drift); pre-deletion `dd validate` verb control (ok); task-to-AC edge extraction; source/test/build/check/sensor/architecture/docs/skill/live-scenario survivor sweeps
- **Verdict**: NEEDS ATTENTION
- **Thesis / proof**: blocked — commit-order gates and genuine `satisfies` edges are correct, but the deletion task omits live production, proof-infrastructure, test, and operational consumers of the fork; Implementation target -> incomplete Implementation evidence
- **Consumers**: phase-3 implementer, final fork-less build, builder skill, and dd-native dogfood scenario are blocked on an explicit conversion/retirement inventory

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | F1: deletion has no conversion row for surviving production imports or their test boundary. | Five `services/flow/*.ts` modules and `services/doctor/doctor-service.ts` still import `../dd/**`; 58 test files contain 225 fork-path matches. `dw-0018` names only tree/import absence plus a green suite, so the implementer must invent which APIs/tests migrate, retire, or preserve. | Open — enumerate each production consumer and adjudicate fork-owned versus retained consumer-contract tests before deletion. |
| HIGH | F2: the mandatory build and proof surfaces still target the tree being deleted. | Root `build` always runs `gen:dd-docs`; `scripts/gen-dd-docs.mjs` reads/writes `services/dd/docs/**`. `harness checks` still runs `check:dd-docs`, `test/acts/dd.test.ts`, and `dd doctor`; the `dd-doctor` sensor invokes the removed verb; `.dependency-cruiser.cjs` has 23 fork rules. | Open — explicitly retire or re-aim generator inputs/outputs, package scripts, checks, sensor, tests, and architecture rules; assert tree absence after the build, not only before it. |
| HIGH | F3: public operating surfaces still prescribe the removed `harness dd` command family. | `docs/how/dd/**`, eight `skills/builder/references/**` files, and `live-testing/scenarios/dd-native-builder/assertions.json:122` retain executable `harness dd`/`dd doctor` instructions; phase 3 only adds install/consumption docs. | Open — add a corpus-wide command migration/retirement row and a non-historical zero-reference proof for the removed verb surface. |
| MEDIUM | F4: the verb-removal control is not temporally bound in `done_when`. | `dw-0018` says only “control run captured”; unlike `dw-0017`, `dw-0019`, and `dw-001e`, it does not require a successful working-verb run before the deletion commit. This validation captured one, but the execution contract does not require preserving it. | Open — require named before/after commands and commit/log order: working verb before deletion, unknown-command after. |
