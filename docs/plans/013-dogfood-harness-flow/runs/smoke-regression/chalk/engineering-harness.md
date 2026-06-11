# Engineering Harness — chalk

This file is the current Boot / Interact / Observe contract for the throwaway
Chalk clone used in this harness-flow validation run.

## Boot command

```sh
npm test
```

For this Node.js library, `npm test` is the boot-to-healthy command: it runs the
same proof lane CI uses (`xo && c8 ava && tsd`) and should complete within the
<60s target after dependencies are installed.

## Health check

```sh
npm test
```

Exit code 0 proves the library is healthy: lint passes, AVA behavior tests pass
under c8, and TypeScript declaration assertions pass under `tsd`.

## Interact method

Agents interact with the product by importing the ESM API from `source/index.js`
or the package export, then calling Chalk's chainable style methods. The
supported test interaction surface is AVA (`test/*.js`) plus `tsd`
(`source/index.test-d.ts`).

## Observe method

Agents observe behavior through command exit codes and test output from
`npm test`. Product consequences are exact returned strings and ANSI escape-code
sequences asserted by AVA; type consequences are `tsd` assertion results.

## Deterministic signal inventory

- `xo` lint, configured in `package.json`.
- `c8 ava` unit/behavior tests over `test/*.js`.
- `tsd` type declaration contract tests in `source/index.test-d.ts`.
- GitHub Actions CI runs `npm install` and `npm test` on Node.js 18, 16, and 14.
- c8 coverage reporters emit text and lcov output.

## Evidence paths

- Terminal output and exit code from `npm test`.
- `coverage/lcov.info` and c8 text coverage output when `npm test` runs.
- `.harness/reports/harnessability/latest.json` and `latest.md` for the current
  harnessability assessment.
- `.harness/records/retro/` for setup-flow retro records after this run records
  one.

## Back-pressure gaps

- No pre-existing harness governance doc or boot verb existed before this run;
  `harness init` is not shipped yet, so this file was hand-written from the BIO
  template.
- No named quick lane separates focused AVA or `tsd` checks from the full
  lint-plus-coverage-plus-type `npm test` proof lane.
- Evidence is mostly command output and coverage files; there is no
  project-native structured test report before the harness boot Envelope wraps
  the command.

## Current maturity snapshot

L2 — deterministic local proof exists through `npm test` and CI-equivalent
checks, but this clone is only now gaining the canonical harness governance,
boot verb, and retro loop needed for a compounding engineering harness.
