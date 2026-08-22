# Validation — phase-1/tasks.dd.json

- **Validated**: 2026-08-09T02:34:07Z
- **Target**: `docs/plans/080-dd-consume-upgrade/assets/tasks/phase-1/tasks.dd.json` (`4468948cdf405a3f5b7349e7eae0d3ae47a1368a`)
- **Contract sources**: phase-1 `context.md`; `plan.dd.md`; workshop 001 D-1..D-4; `backpressure.dd.md`; current `acts/plan/index.ts` and `pr-body.ts`
- **Checks**: targeted repair recheck; `dd validate ... --depth 3` (0 errors/warnings); task and backpressure `dd build ... --check` (no drift); widened import probe
- **Verdict**: VALIDATED WITH FIXES
- **Thesis / proof**: advanced — the repaired dossier is implementation-ready for the deliberate phase-1 mixed-source boundary; Implementation target -> Implementation evidence
- **Consumers**: phase-1 implementer and phase-2 handoff requirements satisfied

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | Dependency instructions targeted nonexistent `harness/cli/package.json`. | `tk-0001`, `dw-0001`, `bp-0001`, and `context.md` now name root `package.json`/`package-lock.json`; `npm prefix` from `harness/cli` confirms the repository root. | Resolved |
| HIGH | The phase-1 flow/fence grep could miss `./dd/shared.js`. | `dw-0005` now uses `git grep -nE "services/dd\|acts/dd\|\./dd/"`; the targeted probe catches the current `flow.ts:80` import. | Resolved |
| MEDIUM | Phase-1 `dw-0007` linked to the phase-2 full-zero proof. | `dw-0007` now links to new `bp-000f`, scoped to the deliberate phase-1 `services/dd/plan` remainder. | Resolved |
| MEDIUM | `tk-0004` omitted the schema resolver import. | `tk-0004` now names both `SchemaIssue` and `ConventionSchemaResolver`, matching `index.ts:38-39`. | Resolved |
| MEDIUM | The SHA floor used an unordered `>=` comparison. | `dw-0001` and `bp-0001` now require `git merge-base --is-ancestor f712ded <selected-sha>`. | Resolved |
