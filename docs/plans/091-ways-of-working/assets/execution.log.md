# Plan 091 U1 execution log

## Task: settings contract and RED

Status: in progress

- Scope: pure settings resolution plus the two-file read-only loader.
- Test location follows the repository's parallel `test/services/` convention.
- RED receipt: `cd harness/cli && npx vitest run test/services/settings` exited 1 before production code existed. Both suites failed to load their missing production modules (`settings.ts` and `load-settings.ts`); 2 files failed, 0 tests ran.
- Assertion RED receipt: production-path modules exported deliberately empty stubs with no reads, parsing, merge, classification, kill switch, or refusals. `cd harness/cli && npx vitest run test/services/settings` exited 1 after executing 13 tests: 11 failed on assertions and 2 passed. Every required refusal case received `ok: true` where `ok: false` was required; tracked origin, machine override, kill switch, loader reads, and unreadable-file refusal also failed. The two baseline tests that passed were resolver defaults and loader absent-file defaults because the constant stub intentionally returned that baseline.
- Focused GREEN receipt: `cd harness/cli && npx vitest run test/services/settings` exited 0; 2 files passed, 13 tests passed. The two absent-file regression guards both assert `{ value: false, origin: 'default' }`; they guard the default contract but are not cited as resolver/refusal proof because the deliberate stub also satisfied them.
- Mutation — local governance guard: changed `source === LOCAL_SETTINGS_PATH` to `!==`, then ran `npx vitest run test/services/settings/settings.test.ts -t 'governance namespace'`. Exit 1; the named refusal test failed because `result.ok` was `true`, expected `false`. Restored.
- Mutation — malformed-file guard: changed the `JSON.parse` catch to continue with `{}`, then ran `npx vitest run test/services/settings/settings.test.ts -t 'refuses malformed'`. Exit 1; both repo and local malformed-JSON refusal tests failed because `result.ok` was `true`, expected `false`. Restored.
- Mutation — schema-major guard: inverted `major !== SETTINGS_SCHEMA_MAJOR` to `===`, then ran `npx vitest run test/services/settings/settings.test.ts -t 'unknown.*schema major'`. Exit 1; both repo and local unknown-major refusal tests failed because `result.ok` was `true`, expected `false`. Restored.
- Post-mutation focused run: `npx vitest run test/services/settings` exited 0; 2 files passed, 13 tests passed.

## Verification

- Full CLI suite: `cd harness/cli && npx vitest run` exited 0 after the error-code contract fixture was updated for E121/E122. Tail: `Test Files 336 passed (336)`; `Tests 5219 passed (5219)`; duration 16.25s. The first run caught that fixture omission: 335 passed, 1 failed.
- Formatter/linter: `just fix` exited 0. A confirmation run reported `Checked 631 files`; `No fixes applied`; 3 pre-existing unsafe unused-import suggestions in `acts/plan/index.ts` and `services/hooks/hooks-verbs.ts` were skipped. No out-of-scope file changed.
- Post-format focused check: `cd harness/cli && npx vitest run test/services/settings test/output/error-codes.test.ts` exited 0; 3 files passed, 15 tests passed.
- LSP diagnostics: no issues in `src/services/settings/*.ts`.
- Phase status: U1 done-bar satisfied; no deferred code or acceptance criterion.

## Discoveries & Learnings

| Tag | Discovery | Decision |
|---|---|---|
| Noteworthy | Flowspace3 semantic search returned a weak, unrelated archived-plan/mechanism hit above live source for the settings-pattern query. | Treated the result as a miss and verified conventions in live source. |
| Noteworthy | The binding plan text still mentions self-gitignore-on-first-write, while the PM ruling removes the write path from this phase. | Implement a read-only loader; no `.gitignore` or settings writer changes. |
| Noteworthy | The initial acknowledgment proposed thrown refusals and colocated tests; live source shows returned discriminated results and the suite uses a parallel test tree. | Return `{ ok: false, code, message, next_action }`; place tests under `test/services/settings/`. |
| Noteworthy | A module-resolution RED ran zero tests; only a second rung using production-path stubs demonstrated assertion failures. | Keep both receipts distinct: rung 1 proves wiring absent, while rung 2 proves the tests can fail for the intended behavior. |
| Noteworthy | `just fix` succeeds but reports three pre-existing unsafe unused-import suggestions outside U1. | Leave out-of-scope source unchanged; report the warnings with the clean formatter receipt. |
