# Validation — tasks/phase-1-authoring-v2-substrate/tasks.md

**Validated**: 2026-07-14 · **Validator**: independent Opus critic (read-only) + lead adjudication · **Revision**: post-fix

## Verdict

✅ **VALIDATED WITH FIXES** — 1 HIGH finding, verified at source, fixed across all affected artifacts, re-verified.

- **Target**: `tasks/phase-1-authoring-v2-substrate/tasks.md`
- **Proof**: critic verified plan-task mapping 1.1→1.10 complete, paths accurate (modify-targets exist, create-targets absent), TDD/DAG ordering sound (T002 precedes impl; T008 precedes T010), validation fixes F1/F2 present, F3 correctly Phase-2; lead re-verified the one finding at `harness/cli/src/output/error-codes.ts`.
- **Consumers**: implement verb — T-rows testable; no vague Done-When found.

## Findings

| # | Severity | Finding | Fix applied |
|---|----------|---------|-------------|
| F1 | HIGH | Error-code collision: the workshop/plan/tasks assigned `E145`/`E146` to the new v2 failures, but both are live codes (`INSTRUCTIONS_UNREADABLE: 'E145'` at error-codes.ts:25, `OBSERVE_BUFFER_UNREADABLE: 'E146'` at :27, both referenced in shipping acts) — following the dossier would have duplicated or overwritten shipped error semantics, breaking P5/AC-04 and freezing wrong codes into the append-only corpus | Renumbered to **E147 (api-above-core)** and **E148 (unknown-section)** — free slots confirmed (E147–E149 unused; scaffold codes start at E150) — applied consistently across `typed-extensions-sensors-plan.md`, `workshops/001-extension-authoring-v2.md`, and `tasks.md` (22 references); re-verified 0 stale refs |

## Note

The Pre-Implementation Check row for `error-codes.ts` originally asserted the codes were free without opening the file — the exact class of eyeball-instead-of-check this plan exists to eliminate. Captured as a harness observation for the retro.
