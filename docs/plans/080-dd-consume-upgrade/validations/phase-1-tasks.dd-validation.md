# Validation — phase-1/tasks.dd.json

- **Validated**: 2026-08-09T02:31:28Z
- **Target**: `docs/plans/080-dd-consume-upgrade/assets/tasks/phase-1/tasks.dd.json` (`21a279f21e0490e1be573efe739925f4ab26dc5e`)
- **Contract sources**: phase-1 `context.md`; `plan.dd.md`; workshop 001 D-1..D-4; `backpressure.dd.md`; current `acts/plan/index.ts` and `pr-body.ts`
- **Checks**: `dd validate ... --depth 3` (0 errors/warnings); `dd build ... --check` (no drift); `plan validate` (0 errors/warnings); current-import grep; `npm prefix`; targeted git history
- **Verdict**: NEEDS ATTENTION
- **Thesis / proof**: partial — the intended mixed-source phase boundary and no-touch constraints are correct, but the dossier can direct work to the wrong manifest and falsely certify residual fork imports; Implementation target -> Contract-level guidance only
- **Consumers**: phase-1 implementer blocked by 2 HIGH and 3 MEDIUM readiness defects; phase-2 plan-import handoff itself matches current source

## Findings

| Severity | Finding | Evidence | Status |
|---|---|---|---|
| HIGH | `tk-0001` and `bp-0001` target nonexistent `harness/cli/package.json`; the dependency manifest is the repository-root `package.json`. | `tasks.dd.json:24`; `context.md:56`; `backpressure.dd.json:32`; `npm prefix` from `harness/cli` resolves to the repository root, and the only product manifest is root `package.json`. | Open — retarget the task, context row, and proof to root `package.json` plus root `package-lock.json`. |
| HIGH | `dw-0005` can pass while `acts/flow.ts` still imports the fork-owned `FsDocLoader`, because its grep pattern does not match `./dd/shared.js`. | `tasks.dd.json:106`; `acts/flow.ts:80`; the prescribed `services/dd\|acts/dd` grep reports lines 13-14 but omits line 80. | Open — make the phase-1 proof detect the relative `acts/dd` import or assert the expected package source for `FsDocLoader`. |
| MEDIUM | `dw-0007` links to `bp-0002`, but that row is a phase-2 full-zero proof and contradicts phase 1's deliberate `services/dd/plan` remainder. | `tasks.dd.json:120`; `backpressure.dd.json:33` is tagged `ph-1633` and requires zero matches across all four files; current `index.ts:30-37` and `pr-body.ts:1` are the exact imports that must remain through phase 1. | Open — add a phase-1 scoped pressure row or split the partial and final AC-0002 proofs. |
| MEDIUM | `tk-0004` under-enumerates the non-plan schema imports in `index.ts`, naming only schema model and omitting `ConventionSchemaResolver` from schema resolve. | `tasks.dd.json:52`; `index.ts:38-39`; the context verifies `ConventionSchemaResolver` has a public package home. | Open — name both schema imports in the task. |
| MEDIUM | `dw-0001` states `sha >= f712ded`, but Git SHAs have no ordered comparison and the assertion names no ancestry proof. | `tasks.dd.json:78`; the plan guardrails require ancestry claims to use `git merge-base --is-ancestor`. | Open — replace `>=` with an explicit ancestry check from `f712ded` to the selected full SHA. |

The cold-implementer exclusions are otherwise adequate: `context.md:65-67` explicitly forbids touching the byte-pinned `semantics.ts` and "fixing" the two D-4 guard tests.
