# Harnessability Assessment - express

Run metadata
- Timestamp: 20260609T125200Z
- Repo root: `/tmp/harness-flow-selftest-2026-06-09T12-48-22-100Z/express`
- Branch / commit: `master` / `dae209ae6559c29cfca2a1f4414c51d89ea643d5`
- Mode: static
- Commands executed: `minih skills doctor`; `npm install ~/substrate/harness-engineering --no-audit --no-fund`; `npx harness doctor --json`; static inspection of README, package scripts, CI, tests, examples, and env references.
- Commands skipped: service boot, real example server startup, migrations/seeds/reset, queue/cron workers, external services, deep history mining.
- Safety notes: no secret values were read; Redis references are optional examples only.

## Verdict
- Operate-Today: B (76.7%)
- Adaptability: B (73.3%)
- Harnessability Index: 75.0% (B)
- Readiness: H3
- Highest proof level detected: L4
- Target next proof level: L5
- Confidence: high

## Plain-English assessment

Express is workable for a fresh agent today. The repo has a clear README, a single Node package root, simple npm scripts, broad Mocha/Supertest tests, fixture-backed consequence checks, linting, coverage, and CI matrix coverage. Core proof is local and does not require remote services or secrets.

The main gaps are not product blockers; they are harness gaps. Before this setup run there was no canonical `.harness` front door, no governance document, no boot verb, no stable JSON evidence artifact for tests, and no compounding retro loop. Optional Redis examples are manual and not a core proof blocker.

## Top blockers

1. No canonical engineering harness front door before setup. Recommended next action: add a `boot` extension wrapping `npm test`.
2. No structured local test evidence report by default. Recommended next action: expose TAP or coverage output through a stable harness observe/proof artifact.
3. No compounding retrospective loop before setup. Recommended next action: record retros under `.harness/records/retro/`.
4. Optional Redis examples lack a deterministic local proof lane. Recommended next action: add a fake/containerized lane only if those examples are maintained as regression surfaces.

## Highest-leverage improvements

1. Encode `npx harness boot` around `npm test` with honest Envelope output.
2. Add a harness evidence command that captures `npm run test-tap` or coverage output into a stable artifact path.
3. Keep using `npm run lint` as the fast static lane and consider a wrapper for discoverability.
4. Record retros after proof runs so repeated friction becomes encoded improvement work.

## First safe agent session plan

Run `npx harness doctor --json`, then run the boot/proof lane (`npm test` through the harness once the extension exists). For narrower changes, run a targeted Mocha file under `test/` or `test/acceptance/` before the full suite, then run `npm run lint`, and record ambiguity or friction in a retro.

## Harness surfaces

- `package.json` scripts are the existing generic command map.
- `node_modules/.bin/harness` is available after setup installation; `npx harness doctor --json` returned an Envelope but reported a degraded CLI-build layer.
- No pre-existing `.harness/engineering-harness.md` or extension front door was present.

## Repository topology

Single-package JavaScript Node library/framework. Core code lives under `lib/`, examples under `examples/`, tests under `test/` and `test/acceptance/`. CI uses GitHub Actions for lint, coverage-backed tests across Node/OS matrices, CodeQL, and OpenSSF Scorecard.

## Axis A - Operate-Today scorecard

| ID | Band | Points | Evidence |
| --- | --- | ---: | --- |
| A1 | Strong | 3 | README explains project, install, examples, tests. |
| A2 | Partial | 2 | `package.json` declares Node >=18; `.npmrc` disables lockfile and scripts. |
| A3 | Strong | 3 | Core tests are local; Redis is optional examples only. |
| A4 | Partial | 2 | npm scripts are discoverable but no pre-existing harness front door. |
| A5 | Partial | 2 | `npm test` is the library health signal; no dedicated boot/doctor before setup. |
| A6 | Partial | 2 | Test fixtures and env preload exist; no seed/reset command. |
| A7 | Strong | 3 | Supertest acceptance tests exercise real HTTP behavior in process. |
| A8 | Strong | 3 | ESLint, Mocha, nyc coverage, and CI matrix exist. |
| A9 | Partial | 2 | Mocha/TAP/coverage output exists; no canonical JSON report. |
| A10 | Weak | 1 | No pre-existing retro or difficulty loop. |

## Axis B - Adaptability scorecard

| ID | Band | Points | Evidence |
| --- | --- | ---: | --- |
| B1 | Partial | 2 | `lib/` is modular, but central request/response/application modules have broad semantic blast radius. |
| B2 | Weak | 1 | Deep co-change mining skipped; temporal coupling is not encoded as a local sensor. |
| B3 | Strong | 3 | Tests are organized by behavior and examples. |
| B4 | Partial | 2 | Supertest in-process app seam is strong; formal ports/adapters are limited. |
| B5 | Strong | 3 | Useful tests run offline after install. |
| B6 | Partial | 2 | Core side effects are low; Redis examples lack fake/sink proof. |
| B7 | Partial | 2 | Response/file consequences are verified; durable state evolution is not central. |
| B8 | Partial | 2 | ESLint and CodeQL exist; explicit boundary rules were not found. |
| B9 | Partial | 2 | Linting exists; complexity/duplication thresholds were not found. |
| B10 | Strong | 3 | `npm test` and `npm run lint` are simple repeatable local commands. |

## Back-pressure surface inventory

Static sensors: `npm run lint`, `npm run test-ci`. Runtime/consequence sensors: `npm test` with Mocha/Supertest, response status/header/body assertions, file fixtures. Observability: Mocha spec/TAP output and nyc coverage artifacts. Human/inferential: README instructions.

## Scenario probes

Representative probes: core HTTP behavior, example API app behavior, static file behavior, and optional Redis example behavior. Core/API/static probes can reach L4 locally through Supertest; Redis examples are manual and only L1 unless a local fake/container proof lane is added.

## Command tiers

`npm install` is bootstrap; `npx harness doctor --json` is doctor; `npm run lint` is fast static; `npm test` is proof/boot for this library; `npm run test-ci` is CI-equivalent coverage; `npm run test-tap` is an observation/reporting surface.

## Services, environment, and remote dependency exposure

Environment variables detected: `NODE_ENV`, `NO_DEPRECATION`, and optional CI `SCORECARD_TOKEN` mention. Redis appears in optional examples and does not block core proof. Coveralls/GitHub artifact upload is CI-only and does not block local proof.

## State, fixtures, reset, and cleanup

The core library mostly proves behavior through in-process HTTP interactions, response assertions, and committed test fixtures. There is no database seed/reset loop because the core package does not require one. Redis examples lack documented reset/cleanup.

## Observability and evidence

Mocha spec output, TAP output (`npm run test-tap`), and nyc coverage (`npm run test-ci`/`npm run test-cov`) are available. The missing piece is a canonical harness-managed artifact path and JSON Envelope around proof results.

## Codebase affordance recommendations

If Redis examples are intended to be regression-proofed, add a test-only fake or containerized Redis lane. This should be scoped to local/test environments and must not change default example behavior in production-like usage.

## Harness-only recommendations

Create `.harness/extensions/boot.*` wrapping `npm test`; add a future observe/proof artifact wrapper for TAP or coverage; record retros under `.harness/records/retro/`.

## Onboarding consolidation notes

Fold README install/test instructions and CI command mapping into the governance doc and boot extension. Keep `examples/README.md` as useful orientation.

## Human questions

Should the canonical boot command include lint (`npm run lint && npm test`) or stay aligned to the README's `npm test`?

## Evidence and inference log

Evidence came from `Readme.md`, `package.json`, `.npmrc`, `.eslintrc.yml`, `.github/workflows/ci.yml`, `.github/workflows/legacy.yml`, `test/support/env.js`, `test/support/utils.js`, `test/acceptance/*.js`, `test/fixtures`, `examples/README.md`, and `npx harness doctor --json`.
