# Engineering Harness - chalk

This document is the current Boot / Interact / Observe contract for this throwaway harness-flow validation clone of Chalk.

## Boot command

`npm test`

This is the exact local command that brings the library to a healthy, observable validation state after dependencies are installed. In this repo it runs `xo && c8 ava && tsd`: lint, coverage-backed AVA tests, and TypeScript declaration tests.

## Health check

`npm test` exits `0`.

A healthy run includes XO warnings only, 32 AVA tests passing, tsd completing, and c8 coverage output. The command was verified during setup on this clone.

## Interact method

Agents interact with the system by importing the public ESM API from `source/index.js`, adding or changing AVA tests under `test/`, and adding or changing declaration assertions in `source/index.test-d.ts`. The supported public behavior is the string-styling API documented in `readme.md`.

## Observe method

Observe behavior through command exit codes, `npm test` stdout/stderr, exact string assertions in AVA output, tsd type-check results, and c8 coverage artifacts.

## Deterministic signal inventory

- `npm test` - canonical local validation lane.
- `xo` - lint and complexity/static checks.
- `c8 ava` - unit tests plus coverage for runtime behavior.
- `tsd` - public TypeScript declaration contract tests.
- `.github/workflows/main.yml` - CI runs `npm install` and `npm test` across a Node version matrix.
- `test/chalk.js`, `test/level.js`, `test/instance.js`, `test/visible.js`, `test/no-color-support.js` - deterministic behavior tests for the public API and color-level behavior.

## Evidence paths

- Terminal output from `npm test`.
- `coverage/lcov.info`.
- `coverage/lcov-report/`.
- `.harness/reports/harnessability/latest.json`.
- `.harness/reports/harnessability/latest.md`.

## Back-pressure gaps

- Before this setup flow, the repo had no canonical `.harness/engineering-harness.md` or `boot` extension; agents had to infer `npm test` from `package.json`.
- The test lane emits useful text and coverage artifacts, but no first-class JSON/JUnit verdict artifact was found.
- No compounding retro/difficulty record loop existed before this flow.
- Terminal color support testing still has an ESM loader-hook TODO for fuller spoofing of unsupported-color behavior.
- No `harness init` writer exists yet, so this governance document had to be created by hand from the BIO template.

## Current maturity snapshot

L2 - deterministic local proof is identified and verified through `npm test`, with evidence paths named here. At inception time the repo still needed the `boot` harness extension and retro record to become a fully encoded harness loop.
