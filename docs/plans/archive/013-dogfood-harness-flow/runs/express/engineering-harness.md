# Engineering Harness - express

This is the Boot / Interact / Observe contract for this throwaway harness-flow run.

## Boot command

```bash
npm test
```

For this Node library, the boot target is the documented local proof lane: Mocha loads the package and examples, exercises Express behavior through Supertest, and exits non-zero on failure. Dependencies are installed separately with `npm install` during setup.

## Health check

```bash
npm test
```

Health is the test command's exit status. Exit `0` means the package can be loaded and its core request/response, routing, static-file, rendering, and example-app behavior passed the deterministic test suite.

## Interact method

Agents interact through the supported test harness: Mocha test files construct Express apps or require examples, then Supertest sends in-process HTTP requests. For manual exploration, examples can be started with `node examples/<name>`, but the deterministic agent path is the test suite rather than manual browser/server interaction.

## Observe method

Capture command exit codes and stdout/stderr from `npm test`, `npm run lint`, `npm run test-tap`, or `npm run test-ci`. Mocha/Supertest assertions expose HTTP status, headers, bodies, and fixture-backed file behavior. Coverage artifacts are available when running `npm run test-ci` or `npm run test-cov`.

## Deterministic signal inventory

- `npm test` - Mocha plus Supertest runtime/consequence checks over `test/` and `test/acceptance/`.
- `npm run lint` - ESLint static gate configured in `.eslintrc.yml` and enforced in CI.
- `npm run test-ci` - nyc coverage wrapper around `npm test`, used by GitHub Actions.
- `npm run test-tap` - TAP-formatted test output for more parseable local observation.
- GitHub Actions CI - lint and test matrix across supported Node versions and operating systems.
- CodeQL and OpenSSF Scorecard workflows - CI-side security/advisory signals.

## Evidence paths

- Terminal output and exit code from `npm test`, `npm run lint`, and `npm run test-tap`.
- `coverage/lcov.info` and nyc text/HTML coverage output from `npm run test-ci` or `npm run test-cov`.
- Harnessability reports under `.harness/reports/harnessability/`.
- Harness records under `.harness/records/retro/` after retro recording.

## Back-pressure gaps

- No shipped `harness init` command exists yet, so this governance contract had to be hand-written from the BIO template.
- No pre-existing `boot` extension existed before this setup flow; npm scripts were the only command map.
- Local test output is not wrapped in a stable JSON evidence artifact by default.
- Optional Redis-backed examples remain manual unless Redis is installed and cleaned up separately.
- Architecture boundaries are enforced only through general lint/static analysis, not explicit module-boundary rules.

## Current maturity snapshot

L4 - Express already has a meaningful local interaction-plus-consequence proof loop through Mocha/Supertest tests that exercise HTTP behavior and assert observable responses. It is not yet L5 because clean rerun evidence and stable harness-managed proof artifacts are not encoded as a canonical harness command/report pair.
