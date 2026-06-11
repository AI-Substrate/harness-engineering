# Harnessability Assessment - chalk

Run metadata
- Timestamp: 20260610T050750Z
- Repo root: `/tmp/harness-flow-selftest-2026-06-10T05-03-54-224Z/chalk`
- Branch / commit: `main` / `aa06bb5`
- Mode: safe-probe
- Commands executed: `git branch --show-current`, `git rev-parse --short HEAD`, `git status --short`, `npm pkg get scripts`, `npx --no-install harness help --json`, `npx --no-install harness init`, `npx --no-install harness doctor --json`
- Commands skipped: `npm test` during assessment (reserved for boot proof), `npm run bench`, service/migration/seed/reset/external calls
- Safety notes: no secrets read; static file inspection plus safe command discovery; writes stayed inside the throwaway target repository.

## Verdict

- Operate-Today: C (67%)
- Adaptability: B (81%)
- Harnessability Index: 74% (B)
- Readiness: H2
- Highest proof level detected: L2
- Target next proof level: L4
- Confidence: medium

## Plain-English assessment

Chalk is a small, stateless ESM library with a strong existing validation lane: `npm test` runs lint, coverage-backed AVA tests, and `tsd` declaration checks, and CI runs the same command across a Node matrix. It is worth harnessing. The main gap is not product complexity but the absence of a repo-specific harness boot verb; a fresh agent has to infer from `package.json` and CI that `npm test` is the readiness proof. Local proof is possible without services or secrets after dependencies are installed.

## Top blockers

1. No repo-specific `harness boot` exists. Recommended next action: scaffold a boot extension wrapping `npm test`.
2. Proof artifacts are mostly terminal output and `coverage/lcov.info`, not a harness-native evidence bundle. Recommended next action: have boot report the wrapped command and coverage artifact path.
3. Clean-room dependency setup is not pinned by a lockfile because `.npmrc` sets `package-lock=false`. Recommended next action: document or encode that policy if reproducibility matters.

## Highest-leverage improvements

1. Add `harness boot` with `eng-harness-0-add-extension`, wrapping `npm test`.
2. Include `coverage/lcov.info` as an evidence path in the boot envelope when present.
3. Use `harness observe` and `harness record retro` to make setup friction durable.

## First safe agent session plan

Run `npx --no-install harness doctor --json`, then run `npx --no-install harness boot --json` once the boot extension exists. For product changes, edit the small source/test area and rerun boot. Capture missing proof or confusing command behavior with `npx --no-install harness observe ... --json`.

## Harness surfaces

The core harness CLI is installed and healthy, but had no repo-specific verbs during assessment. The pre-existing command surface is diffuse npm scripts: `npm test` and `npm run bench`.

## Repository topology

Chalk is a single-package JavaScript library using ESM, AVA, XO, c8, and tsd. It has no service runtime, database, queue, auth provider, or local compose topology.

## Axis A - Operate-Today scorecard

| ID | Band | Points | Evidence |
| --- | --- | ---: | --- |
| A1 | Partial | 2 | README explains product/API; contributing docs are minimal. |
| A2 | Partial | 2 | package.json engines/devDeps and CI install/test are clear; no lockfile. |
| A3 | Strong | 3 | No remote infrastructure needed after dependency install. |
| A4 | Partial | 2 | Harness core installed; npm scripts exist; no repo verb yet. |
| A5 | Weak | 1 | No boot/health/smoke command exists yet. |
| A6 | Not applicable | - | Stateless library. |
| A7 | Partial | 2 | Library API, examples, and tests are present. |
| A8 | Strong | 3 | `npm test` combines XO, c8/AVA, and tsd; CI runs it. |
| A9 | Partial | 2 | c8 text/lcov and test output exist; no JSON proof bundle. |
| A10 | Weak | 1 | No pre-existing harness records or difficulty ledger. |

## Axis B - Adaptability scorecard

| ID | Band | Points | Evidence |
| --- | --- | ---: | --- |
| B1 | Strong | 3 | Small module graph and single public entrypoint. |
| B2 | Unknown | 0 | Deep git-history mining was not run. |
| B3 | Strong | 3 | Styling logic and tests are cohesive. |
| B4 | Partial | 2 | Chalk level and subprocess seams exist; env detection has limited direct injection. |
| B5 | Strong | 3 | Tests are local and service-free after install. |
| B6 | Not applicable | - | No external side effects detected. |
| B7 | Strong | 3 | Tests verify returned strings and type contracts. |
| B8 | Partial | 2 | XO exists; no explicit architecture-boundary rules. |
| B9 | Strong | 3 | Small files and generic static checks. |
| B10 | Strong | 3 | Single no-service proof command; CI/local command match. |

## Back-pressure surface inventory

`npm test` is the main static proof lane and combines `xo`, `c8 ava`, and `tsd`. AVA tests also exercise runtime library calls and verify observable string/stdout consequences, which can reach L4 when run. c8 produces text and lcov coverage output.

## Scenario probes

Library API behavior changes can be proven by running `npm test`, which imports Chalk and asserts returned ANSI/plain strings. Type contract changes are covered by `tsd` through `source/index.test-d.ts`. Terminal capability behavior is covered through level manipulation and a subprocess fixture, though the full terminal matrix remains broader than local tests.

## Command tiers

`npm install` is the bootstrap path. `npm test` is both proof and CI-equivalent. `npm run bench` is an optional benchmark lane. `npx --no-install harness doctor --json` and `harness observe` are verified harness-support commands.

## Services, environment, and remote dependency exposure

No app services are required. The npm registry is the only meaningful setup dependency. Codecov is CI-only and does not block local proof. Environment variables such as `FORCE_COLOR`, `TERM`, `CI`, `GITHUB_ACTIONS`, and `TERM_PROGRAM` are optional color-detection inputs, not secrets.

## State, fixtures, reset, and cleanup

No persistent state exists. The relevant consequence model is returned strings, subprocess stdout, and type-shape validation. Reset is simply rerunning tests.

## Observability and evidence

Evidence is currently command output plus c8 coverage artifacts. The boot extension should report the command and coverage artifact path to make evidence portable.

## Codebase affordance recommendations

No product-code affordance is required for the first harness. Existing tests already provide enough proof surface for a basic boot.

## Harness-only recommendations

Create `.harness/extensions/boot/` via `harness new boot` and fill it to wrap `npm test`, returning a clear ok/error envelope and short orientation. Use core `harness observe` and `harness record retro` for setup friction.

## Onboarding consolidation notes

Keep README API orientation as-is. Fold `package.json` and CI validation details into the harness assessment and boot briefing so agents do not infer the first proof path.

## Human questions

Is the no-lockfile policy intentional, and should the harness avoid creating one?

## Evidence and inference log

- Evidence: `package.json` defines `npm test` as `xo && c8 ava && tsd`.
- Evidence: `.github/workflows/main.yml` runs `npm install` and `npm test` on Node 14, 16, and 18.
- Evidence: tests verify returned ANSI/plain strings and subprocess stdout.
- Evidence: `harness doctor --json` reported the core CLI healthy and no repo-specific extensions.
