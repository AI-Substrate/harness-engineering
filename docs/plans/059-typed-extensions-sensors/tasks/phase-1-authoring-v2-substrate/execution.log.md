# Phase 1 execution log — Authoring v2 substrate

**Plan**: 059 · **Phase**: 1 · **Date**: 2026-07-14 · **Branch**: `feat/059-typed-extensions-sensors`

## Progress

| Task | State | Change | Proof |
|------|-------|--------|-------|
| T001 | complete | Built an isolated jiti 2.7 proof with a fixture package that has no resolvable `@ai-substrate/engineering-harness` entry. Chose the `alias` option (absolute file path); no resolve-hook fallback required. Spike remains gitignored under `scratch/poc/jiti-alias/` per the orchestrator addendum and is never imported by product code. | `node scratch/poc/jiti-alias/run.mjs` exited 0. Native resolution: `MODULE_NOT_FOUND`; aliased load: `{ kind: "extension", api: 2, marker: "proved" }`. |
| T002 | complete (red lane) | Added classifier-table, api-gate/unknown-field/reserved-section, and v1/v2 normalizer contract tests before production code. No mocks; fixtures are plain values. | `npx vitest run test/extensions/v2-classification.test.ts test/extensions/v2-api-gate.test.ts test/extensions/v2-normalize.test.ts` failed as intended: 3 suites, each `Cannot find module .../extensions/v2/{classify,api-gate,normalize}.js`; zero production v2 modules existed. |
| T003 | complete | Added the api-2 public types, `API_VOCABULARY`, `CORE_EXTENSION_API`, type-preserving `defineExtension()` runtime brand (without stamping api), and the production jiti alias to the running core's source/dist contract module. The v1 `VerbContext.args` type remains unchanged; v2 has its own widened context. | `npx tsc -p harness/cli/tsconfig.json --noEmit` exited 0; loader smoke `test/adapters/loader/loader.test.ts` passed 7/7, including a real factory import through the alias. |
| T004 | complete | Added per-entry classification, api gate, strict-section/tolerant-field validator, E147/E148, actionable failed records, loud sensor/custom info, and registry integration. Doctor renders `format:` plus every info/next-action line. | V2 classifier/gate/normalizer + v1 registry suites passed 41/41; `doctor-service.test.ts` + v2 registry pipeline passed 44/44. |
| T005 | complete | Added the versionless `NormalizedExtension`/verb/item shape; both authoring formats normalize before conflicts. Help exposes the subverb tree, doctor shows format/info, instructions resolves normalized provenance, validation distinguishes normalized v2 variadics, and app dispatch consumes normalized verbs. | Full `npx vitest run`: 195 files, 2,382 tests passed; TypeScript clean at this checkpoint. |
| T006 | complete | Added the sibling v2 register act with real nested commands, scoped args/options, parent-option sharing, v2-only array args, and kernel-owned bare/unknown envelopes. The original v1 act was not edited. | `verb-v2.test.ts` passed 5/5; config/help/context focused set passed 33/33; `git diff --exit-code -- harness/cli/src/acts/verb.ts` exited 0. |
| T007 | complete | Extended `ExecPort`/NodeExec/FakeExec with env overlays and hard timeouts (SIGKILL, code 124). Added optional `ctx.steps()` with fake-clock timing, per-step marks, `fail()` isolation, and actionable finish aggregation. | Exec + verb-context suites passed 20/20; Node adapter focused suite passed 8/8 including a real hung-child timeout; TypeScript clean. |
| T008 | complete | Added nine real api-2 modules (factory, bare literal, nested/variadic, mixed, E147, E148, unknown field, sensor, custom) and an in-test SHA-256 manifest that freezes existing bytes while allowing additions. | Corpus + append-only guard passed 12/12; guard tests explicitly prove edit-red and append-green; TypeScript clean. |
| T009 | complete | Replaced the minting surface with four v2 variants: factory TS, structural subverb TS, bounded wrapper TS, and bare-literal JS. Added `--sub`, retired `--record`/all v1 template variants, retained validation/overwrite safety, and kept instructions beside every entry. | Template/service/act/real temp-repo integration suites passed 55/55; each variant loaded through the real loader/registry; TypeScript clean. |
| T010 | complete | Wrote the v2 authoring guide, marked the v1 guide still-supported, built the worktree CLI, and ran telemetry-disabled doctor reads against both required repositories. | Final post-review-fix proof: worktree doctor at `2026-07-14T08:15:12.133Z` was `status:ok`, 10 loaded records, all `format:v1`; private-consumer doctor at `2026-07-14T08:15:12.571Z` was `status:ok`, 9 loaded records, all `format:v1`; private-consumer `git status --short` was identical before/after. Scoped markdownlint + link checks for both authored docs found 0 issues. |

## Discoveries

- **T001 — feasibility:** jiti 2.7 applies an exact alias before package resolution and accepts an absolute `.ts` target. This proves a consumer repository does not need the core package in its own `node_modules` for a TypeScript extension to import `defineExtension` at runtime.
- **T004 — mixed arrays:** normalizing each classified entry independently preserves declaration order and keeps all format compatibility inside the normalizers; the registry still emits one provenance record per discovered file.
- **T006 — nested dispatch:** Commander matches declared child commands before consuming a parent's optional positional. A parent-only catch therefore yields honest unknown-subverb envelopes while known children retain native scoped help and parsing.

## Review fix packet dlg-0002

- **HIGH-1 — declared API vs core API:** omitted `api` now means 2 permanently, independently of the running core. The parameterized gate computes each section's minimum core-known level, loads core-known/newer sections with a doctor bump advisory, and reserves E148 for truly unknown sections. Synthetic core-3/core-2 tests prove all three counterfactuals.
- **HIGH-2 — keyed record identity:** v2 records are reconstructed from `description`/`template` before the kernel stamps `kind:'record'` and the containing key as `type`; tolerated runtime `kind`/`type` fields cannot overwrite identity. Empty record keys are rejected. Custom identity remains safe because author data stays nested under `declaration`.
- **MEDIUM-3 — subverb-only parent args:** a parent without `run()` no longer registers positional consumers, so required and variadic declarations cannot swallow an unmatched child. Both `db destroy` regressions now produce kernel E108/exit 1.
- **MEDIUM-4 — folder derivation:** normalization derives the extension folder from the entry path's dirname, eliminating false `index`/`main` mismatch info; index and manifest-selected entry paths are covered.
- **Focused proof:** four fix suites passed 26/26; frozen corpus guard passed 3/3; TypeScript and `git diff --check` passed; `git diff --exit-code -- harness/cli/src/acts/verb.ts` remained clean.

## Load-proof evidence

- **This worktree (read-only doctor, final build):** at `2026-07-14T08:15:12.133Z`, `HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js doctor --json` → ok; 10 loaded records; every record reports `format: "v1"`.
- **private-consumer consumer checkout (strictly read-only, same final build):** at `2026-07-14T08:15:12.571Z`, from `<private-consumer>`, `HARNESS_NO_TELEMETRY=1 node <worktree>/harness/cli/bin/harness.js doctor --json` → ok; 9 loaded records; every record reports `format: "v1"`. The pre/post `git status --short` strings were identical (the checkout already had unrelated untracked paths; this proof added none).

## Gate history

- `npm run build` — passed (`gen:docs`, `gen:flows`, TypeScript).
- `npx biome check harness/cli` — passed, 355 files, no fixes pending.
- `npx vitest run` — passed, 197 files / 2,412 tests (final post-review-fix source state).
- `npx tsc -p harness/cli/tsconfig.json --noEmit` — passed.
- `node_modules/.bin/markdownlint-cli2 docs/how/authoring-extensions-v2.md harness/cli/docs/authoring-verbs.md` — 0 errors; remark link check on the same files passed.
- Authoritative worktree gate (`2026-07-14T08:15:35.134Z`): `HARNESS_NO_TELEMETRY=1 node harness/cli/bin/harness.js checks --json` — `degraded` only for the two handed-down warn-launch gates: `arch-check` (2 `services-ports-type-only` warnings) and `markdown-lint`; hard gates `tests`, `biome`, `typecheck`, docs/flows/telemetry/doctrine drift, skills, and windows all `ok`.
