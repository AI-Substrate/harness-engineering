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

## U3 — command and lifecycle wiring

Status: complete

- Scope: `harness convo sync`, app registration, commit and boot seams, plus the tracked root gitignore protection for local settings.
- Frozen U2 boundary: `FlowspacePort.detect/ping/ingest`, `IngestArgs`, and four `SyncOutcome` variants; U3 builds the command-line adapter and envelope mapping.
- Gitignore RED/GREEN: before the line, `git check-ignore -q .harness/settings.local.json` exited 1; after adding the single root rule, `git check-ignore -v .harness/settings.local.json` reported `.gitignore:172:.harness/settings.local.json`.
- U3 module RED: `cd harness/cli && npx vitest run test/acts/convo.test.ts` exited 1 with the act module absent; 1 suite failed, 0 tests executed. Wiring evidence only.
- U3 assertion RED: production-path stubs ran the same command; 7 tests executed and all 7 failed on assertions. The failures covered origin-specific consent text, undetected/unreachable/fired claims, detect/ping delegation, detached argv mapping, and a deliberately unsafe caught-error path that echoed the sentinel transcript path.
- Independent GREEN: `npx vitest run test/acts/convo.test.ts` exited 0; 1 file passed, 7 tests passed.
- Mutation — consent origin: made default-origin wording equal kill-switch wording. Focused consent test exited 1 because default no longer said “not configured.” Restored.
- Mutation — PII error guard: echoed the caught `Error.message`. Focused transcript-path test exited 1 and showed the sentinel path in `error.message`. Restored.
- Mutation — detect delegation: replaced the injected detect call with constant `false`. Focused cheap-gate test exited 1 (`false`, expected `true`). Restored.
- Post-mutation run: 1 file passed, 7 tests passed.
- Identity assertion RED: permissive act stubs ran 4 identity tests; all 4 failed on explicit identity, pij-id lookup, reverse native-session lookup, and the required identity-unresolvable envelope/fix. GREEN: 4 passed, 7 skipped in the act suite.
- Ping probe module RED: missing adapter produced 1 failed suite, 0 tests. Assertion RED: constant-false production stub ran 3 tests; the positive-marker test failed (`false`, expected `true`) while two negative regression guards passed. GREEN: 1 file passed, 3 tests passed.
- Command assertion RED: the compiling registration stub ran 3 tests; all 3 failed on explicit dispatch, enabled identity failure, and default-disabled behavior. GREEN after U2 integration: the command, renderer, identity, adapter, and seam slices passed.
- Seam assertion RED: no-op production stubs ran 3 tests; commit and boot invocation assertions failed while the no-throw regression test passed. GREEN: all 3 passed.
- Mutation — identity refusal: disabled the missing-harness/session guard. `npx vitest run test/acts/convo-command.test.ts -t 'reports enabled identity failure'` exited 1; the command returned `ok` instead of `degraded`. Restored.
- Mutation — commit seam: disabled the unsuccessful/no-op commit guard. `npx vitest run test/acts/convo-seams.test.ts -t 'actual successful commit'` exited 1; callback count was 3, expected 1. Restored.
- Mutation — boot seam: inverted the boot command guard. `npx vitest run test/acts/convo-seams.test.ts -t 'runs once after boot'` exited 1; callback count was 0, expected 1. Restored.
- Mutation — ping evidence: accepted exit 0 without checking stdout. `npx vitest run test/adapters/exec/spawn-flowspace-probe.test.ts -t 'refuses exit 0'` exited 1 (`true`, expected `false`). Restored.
- Mutation — dispatch claim: changed “dispatched” to “ingested.” `npx vitest run test/acts/convo.test.ts -t 'claims dispatch only'` exited 1 because the dispatch assertion failed and the forbidden delivery claim appeared. Restored.

### U3 verification

- First integrated U1/U2/U3 run: `cd harness/cli && npx vitest run test/services/convo test/services/settings test/acts/convo.test.ts` exited 0; 4 files passed, 30 tests passed.
- Full U3 focused run after formatting: `cd harness/cli && npx vitest run test/services/convo test/services/settings test/acts/convo.test.ts test/acts/convo-command.test.ts test/acts/convo-seams.test.ts test/adapters/exec/spawn-flowspace-probe.test.ts` exited 0; 7 files passed, 39 tests passed.
- Full CLI suite: `cd harness/cli && npx vitest run` exited 0 after updating the second ordered command-list fixture. Tail: `Test Files 341 passed (341)`; `Tests 5248 passed (5248)`; duration 26.13s. The preceding run exposed `test/index.test.ts`: 340 passed, 1 failed because its expected core list omitted `convo`.
- Ordered registration fixtures: `HARNESS_TEST_SCOPE=all npx vitest run test/app.test.ts test/index.test.ts -t 'registers core commands|registers help, doctor'` exited 0; 2 files passed, 2 tests passed, 40 skipped.
- Formatter/linter: `just fix` exited 0; confirmation tail: `Checked 641 files`; `No fixes applied`; the same 3 pre-existing unsafe unused-import suggestions remained out of scope.
- Compile/build: `npm run build` exited 0; docs and flows regenerated, then `tsc -p harness/cli/tsconfig.json` completed without diagnostics.
- Actual CLI smoke: `node harness/cli/bin/harness.js convo sync --json` exited 0 and returned `status:ok`, `data.status:disabled`, `origin:default`, with message `Conversation ingest is off because it was not configured.`
- Privacy audit: changed production files contain no `transcript_path`/`transcriptPath`, import no hook journal, and pass no journal input. The only occurrences in the U3 diff are the sentinel test fixture/assertions. Generic caught errors discard the caught value before rendering.
- U3 done-bar satisfied; no deferred code or unmet acceptance criterion.

### U3 Discoveries & Learnings

| Tag | Discovery | Decision |
|---|---|---|
| Noteworthy | Flowspace3 semantic seam search again ranked unrelated background-process source; a scoped `ask` for transcript identity timed out after 120 seconds. | Treat both as misses and ground decisions in live source. |
| Noteworthy | The frozen service contract did not define the explicit command's transcript input or how commit/boot seams obtain it; existing `parseHookPayload` deliberately omits `transcript_path`. | Stop before tests/code and request a PM ruling rather than inventing a flag, stdin, env, or registry protocol. |
| Noteworthy | `transcript_path` formats are documented separately for Claude, Copilot, and Codex, but no shared live parser exists. | Await the input-surface ruling; any parser must return only derived harness/session/folder and never expose its source path. |
| Noteworthy | Looking only at generic `ExecPort` made synchronous probing appear absent; three sibling spawn-based adapters already establish the convention. | Add a sibling `spawn-flowspace-probe` adapter; keep `node:child_process` out of the act and keep the U2 port synchronous. |
| Noteworthy | Live `flowspace3 ping --json` returned the human marker `healthy - fs3 daemon …`, not a JSON envelope. | Treat that measured marker plus exit 0 as positive evidence; exit 0 without the marker remains false. Probe timeout is 1 second against the measured 0–10ms healthy path. |
| Noteworthy | The first 30-test U1/U2/U3 join was green while the full suite was red because a second ordered command-list fixture lived in `test/index.test.ts`. | Update both existing fixtures only; do not unify them in this packet. Focused green was narrower than the delivery claim. |
| Noteworthy | Both command-list fixtures use array `toEqual`, so registration order—not only membership—is enforced. | Report the accidental-or-intended order contract to the PM backlog; do not refactor during W2 close. |
| Noteworthy | The initial command action caught the test harness's `process.exit` sentinel and emitted a second envelope, producing concatenated JSON. | Narrow the catch to result construction; call `exitWithEnvelope` exactly once outside it. |

## Plan 091 U2 — conversation sync service

### Task: Flowspace port, fake, and gated sync

Status: complete

- Scope: `services/convo/` only — a typed `FlowspacePort`, zero-daemon fake, and synchronous gate consuming `ResolvedValue<boolean>`.
- Module-absent RED: `cd harness/cli && npx vitest run test/services/convo/sync-service.test.ts` exited 1; 1 suite failed to import `fake-flowspace.js`, 0 tests executed. This is wiring evidence only.
- Assertion RED: after adding compiling no-op production stubs, the same command executed 6 tests: 4 failed on assertions and 2 passed. The biting failures covered undetected, unreachable, fired/order/exact arguments, and fake copy semantics. The disabled/default and disabled/kill-switch tests passed because the chosen stub returned `{ status: 'disabled', origin: consent.origin }`; they were excluded from this RED proof until the consent mutation below made both fail.
- Focused GREEN: `cd harness/cli && npx vitest run test/services/convo/sync-service.test.ts` exited 0; 1 file passed, 6 tests passed.
- Mutation — consent gate: inverted `!consent.value`, then ran `npx vitest run test/services/convo/sync-service.test.ts -t 'consent is disabled'`. Exit 1; both `does no Flowspace work when consent is disabled by default` and `preserves kill-switch origin when consent is disabled` failed with `fired` instead of `disabled`. Restored.
- Mutation — detection gate: deleted the detect guard, then ran the focused `stops after detection when flowspace3 is absent` test. Exit 1; it received `fired` instead of `undetected`. Restored.
- Mutation — reachability gate: deleted the ping guard, then ran the focused `reports enabled but unreachable once without ingesting` test. Exit 1; it received `fired` instead of `unreachable`. Restored.
- Mutation — dispatch: deleted `flowspace.ingest(args)`, then ran the focused `detects, pings, then fires one ingest with the exact identity` test. Exit 1; recorded calls lacked `ingest`. Restored.
- Mutation — fake copy boundary: changed the fake to retain the caller's object, then ran the focused `copies recorded ingest arguments instead of retaining caller-owned state` test. Exit 1; the recorded session changed to `mutated`. Restored.

### U2 verification

- Full CLI suite: `cd harness/cli && npx vitest run` exited 0. Tail: `Test Files 337 passed (337)`; `Tests 5228 passed (5228)`; duration 17.78s. The declared FAST scope skipped 12 slow files.
- Formatter/linter: `just fix` exited 0. Tail: `Checked 635 files`; `No fixes applied`; 3 known unsafe unused-import suggestions in `acts/plan/index.ts` and `services/hooks/hooks-verbs.ts` were skipped.
- LSP diagnostics: no issues in `src/services/convo/*.ts` or `test/services/convo/*.ts`.
- U2 done-bar satisfied; no live daemon used, no deferred code, and no unmet U2 acceptance criterion.

### U2 discoveries & learnings

| Tag | Discovery | Decision |
|---|---|---|
| Noteworthy | The binding guide froze `ingest(args)` and an outcome without freezing either shape; two concurrent units would otherwise invent incompatible contracts. | PM froze typed `IngestArgs` and the four-variant `SyncOutcome`; U2 implemented that addendum and U3 received the same ruling. |
| Noteworthy | Plan §2c bundles act wiring and the live incremental smoke into the service deliverable, while the implementation guide assigns those to U3/PM. | Treat the implementation guide and explicit unit fence as binding; U2 touches only `services/convo/` plus its parallel tests and this log. |
| Noteworthy | Flowspace3 semantic search weakly ranked unrelated files for the resolved-input precedent. | Treat the envelope as a miss; exact search plus source-read verified `CommitDeps.ingress` before adopting the pattern. |
| Noteworthy | A test passing against one chosen stub is not inherently unable to fail; it is merely unproven until a relevant mutation flips it. | Exclude the two stub-green consent tests from assertion-RED evidence, then promote them to proof only after the inverted consent guard made both fail for the intended reason. |
