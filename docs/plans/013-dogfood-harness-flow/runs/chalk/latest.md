# Harnessability Assessment — chalk

Run metadata
- Timestamp: 20260614T235559Z
- Repo root: /private/tmp/harness-flow-selftest-2026-06-14T23-52-23-096Z/chalk
- Branch / commit: main / aa06bb5ac3f14df9fda8cfb54274dfc165ddfdef
- Mode: safe-probe
- Commands executed: harness --version, harness help --json, git status --short --branch, git log -1 --format=%H %D, npm pkg get scripts --json
- Commands skipped: npm install and npm test skipped during assessment; dependency install and test execution are deferred to the adoption/proof stage. service boot, migrations, seeds, remote calls, and secret reads are not applicable to this static Node library assessment.
- Safety notes: Assessment inspected repository files and safe command metadata only. No secret values were read; no .env files are present. All report writes were under the throwaway target repository.

## Verdict
- Operate-Today: B (70%)
- Adaptability: B (77%)
- Harnessability Index: 73.5% (B)
- Readiness: H2
- Highest proof level detected: L2 configured, with an L4-capable subprocess consequence probe in tests
- Target next proof level: L3
- Confidence: high

## Plain-English assessment
Chalk is a small, cohesive Node ESM library with strong existing local proof surfaces: npm test wraps XO linting, AVA tests under c8 coverage, and tsd type assertions, and CI runs the same test command across a Node matrix. It is worth harnessing. The main gap is not product-code harnessability; it is that setup, proof, and improvement are diffuse across package.json, CI, and product docs instead of discoverable through a canonical engineering-harness front door.

## Top blockers
- GAP-001: No canonical engineering harness front door before adoption — Adopt a minimal .harness governance file and boot/proof extension that wraps npm install status and npm test.
- GAP-002: No harness-native proof artifact or JSON verdict for npm test — Wrap npm test in a harness verb that captures command, exit status, and coverage artifact path.
- GAP-003: Contributor setup guidance is implicit in CI rather than first-session instructions — Encode bootstrap instructions in harness help/instructions and governance instead of requiring agents to infer from CI.
- GAP-004: No compounding retro/improvement loop exists before harness adoption — Wire harness record/retro usage into the adopted harness guidance.

## Highest-leverage improvements
- REM-001: Adopt minimal harness nucleus — Create .harness/engineering-harness.md plus a boot extension that makes npm install/npm test discoverable.
- REM-002: Wrap npm test as the first proof surface — Expose a harness verb that runs npm test and records stdout/stderr plus coverage path.
- REM-003: Add a fast scoped lane if test cost becomes high — Expose separate lint/unit/type verbs or document npm test as the single lane if it remains fast.

## First safe agent session plan
- Run harness help/doctor after adoption to discover configured verbs.
- Run the boot/proof verb that wraps npm install status and npm test.
- For source changes, use the public API tests and tsd assertions as deterministic proof.
- Record friction with harness record/retro instead of adding ad-hoc notes.

## Harness surfaces
- npm scripts (present): `npm test` is the canonical validation lane and `npm run bench` is a benchmark lane; no harness front door exists before adoption.
- GitHub Actions CI (present): CI installs dependencies and runs npm test on Node 14, 16, and 18.
- engineering harness governance (absent before adoption): No repo-local harness nucleus exists yet.

## Repository topology
Node ESM library, single package root, JavaScript source plus TypeScript declarations, AVA/XO/c8/tsd validation, GitHub Actions CI.

## Axis A — Operate-Today scorecard
| ID | Dimension | Band | Points | Evidence | Notes |
|---|---|---:|---:|---|---|
| A1 | Cold-start orientation and repo map | Partial | 2 | readme.md documents package purpose, install, usage, API, supported color controls, and examples.; contributing.md only points to code of conduct and does not describe local development. | Product usage is excellent, but contributor boot/setup guidance is sparse. |
| A2 | Setup and environment contract | Partial | 2 | package.json declares Node engine range and devDependencies.; .github/workflows/main.yml shows npm install followed by npm test.; .npmrc sets package-lock=false. | The runtime and dependency manager are discoverable, but there is no explicit local setup/doctor contract or lockfile. |
| A3 | Locality of infrastructure and external dependency exposure | Strong | 3 | No database, cache, queue, service, or secret-backed runtime dependency was detected.; Tests import local source and use local Node subprocess fixtures. | Local proof is not blocked by remote infrastructure after npm dependencies are installed. |
| A4 | Harness front door and command discoverability | Partial | 2 | package.json scripts expose `test` and `bench`.; No Makefile, justfile, taskfile, or .harness front door exists before adoption. | Commands are discoverable through npm but not consolidated behind an engineering harness yet. |
| A5 | Boot and health/readiness path | Partial | 2 | Library topology has no service boot requirement.; `npm test` is the practical readiness lane for source, types, lint, and coverage. | There is no separate doctor/health command; boot should honestly map to dependency presence plus the validation lane. |
| A6 | Seed, fixture, reset, and cleanup state | Partial | 2 | test/_fixture.js provides a subprocess fixture for color support behavior.; Tests explicitly set and restore chalk.level in several cases. | Persistent state is not relevant, but terminal/color state and subprocess behavior have lightweight fixtures. |
| A7 | Supported interaction surfaces | Strong | 3 | readme.md documents the public import/API surface.; test/*.js exercise the public Chalk API and examples exercise package usage. | A fresh agent can exercise behavior through the exported library API. |
| A8 | Existing deterministic back-pressure sensors | Strong | 3 | `npm test` runs xo, c8 ava, and tsd.; .github/workflows/main.yml runs npm test across three Node versions. | Static lint, unit tests, coverage instrumentation, and type definition checks are already encoded. |
| A9 | Observability and evidence artifacts | Partial | 2 | c8 is configured with text and lcov reporters.; AVA output and npm exit status provide deterministic verdicts. | Evidence exists but is not exposed as a harness-native JSON proof bundle. |
| A10 | Compounding harness loop | Absent | 0 | No .harness governance, records, retro flow, or encoded improvement loop was present before adoption. | The repo has no harness feedback loop yet. |

## Axis B — Adaptability scorecard
| ID | Dimension | Band | Points | Evidence | Notes |
|---|---|---:|---:|---|---|
| B1 | Structural coupling and blast radius | Strong | 3 | Core source is split between source/index.js, source/utilities.js, and vendored support modules.; Public exports are centralized in source/index.js. | Small module count and clear package boundary keep blast radius tractable. |
| B2 | Temporal/change coupling | Unknown | 0 | The clone is shallow and deep git-history mining was not run. | Temporal coupling cannot be assessed confidently from the available shallow history. |
| B3 | Cohesion and locality of change | Strong | 3 | Terminal styling logic is localized in source/index.js and string helpers in source/utilities.js.; Tests are grouped by behavior in test/chalk.js, test/level.js, test/instance.js, test/visible.js, and type assertions in source/index.test-d.ts. | Related behavior is easy to find and modify. |
| B4 | Seams, substitution, and dependency inversion | Partial | 2 | `new Chalk({level})` creates isolated instances for tests and consumers.; Vendored supports-color is imported through package imports. | Useful seams exist for color level behavior, though there is no broad DI/port abstraction because the package is intentionally small. |
| B5 | Hermetic, offline, and isolated testability | Strong | 3 | AVA tests run against local source and subprocess fixtures.; No test evidence requires network services or secrets. | After dependency installation, the self-correction lane is local and hermetic. |
| B6 | Side-effect isolation and external-effect sinks | Partial | 2 | The meaningful side effect is terminal/stdout styling; tests assert strings directly and subprocess stdout for fixture behavior. | No external effects exist; stdout/stderr behavior is captured enough for this topology. |
| B7 | State evolution and consequence verification | Partial | 2 | Tests mutate chalk.level and restore it around assertions.; Consequences are verified as returned strings or subprocess stdout. | State is lightweight and local; no migration/reset lifecycle is needed. |
| B8 | Architecture boundary enforceability | Partial | 2 | XO is configured and CI enforces npm test.; No architecture-specific import boundary sensor was detected. | General linting exists, but architecture boundaries are mostly implicit. |
| B9 | Complexity, size, and navigability thresholds | Strong | 3 | The repo is small with a short source tree and XO enabled.; No large generated application surface or multi-service topology was detected. | Navigability is strong for an agent context window. |
| B10 | Inner-loop speed and repeatability | Strong | 3 | `npm test` provides one local validation command matching CI.; No services, ports, database resets, or remote state are needed. | The edit-to-feedback loop should be repeatable once dependencies are installed. |

## Back-pressure surface inventory
- static: XO lint (configured_unverified) — package.json script `test`: `xo && c8 ava && tsd`; CI runs npm test.
- static: AVA unit tests with coverage (configured_unverified) — package.json script and test files.
- static: Type definition assertions (configured_unverified) — package.json script and source/index.test-d.ts.
- observability: Coverage report (configured_unverified) — package.json c8 reporter config and CI Codecov step.
- runtime: Subprocess color-support fixture (configured_unverified) — test/level.js executes test/_fixture.js with execaNode.

## Scenario probes
- Library API behavior loop: ceiling L3; missing sensor: Harness quick/proof verbs that wrap the existing test lanes.
- Type contract loop: ceiling L2; missing sensor: Harness command exposing typecheck as a named verb or part of proof.
- Terminal support subprocess loop: ceiling L4; missing sensor: Harness proof verb that records npm test output and coverage artifact paths.

## Command tiers
- bootstrap: npm install (configured_unverified) — CI workflow runs npm install.
- ci_equivalent: npm test (configured_unverified) — package.json and CI workflow.
- proof: npm run bench (candidate_unverified) — package.json script.

## Services, environment, and remote dependency exposure
No runtime services, databases, queues, caches, auth providers, or secret-gated local proof paths were detected. Environment names observed: FORCE_COLOR and TERM; neither is secret-like.

## State, fixtures, reset, and cleanup
No persistent state is required. Tests use chalk.level mutation with restoration and a local subprocess fixture for terminal behavior.

## Observability and evidence
AVA output, npm exit status, c8 text output, and lcov artifacts are the existing evidence surfaces. The recommended harness proof verb should preserve those as records.

## Codebase affordance recommendations
No product-code affordance is required before harness adoption.

## Harness-only recommendations
- HR-001: Boot/proof extension for Node library checks — The existing npm test lane is already the strongest proof surface; the harness should wrap it rather than invent new scaffolding.

## Onboarding consolidation notes
Keep the product README as API orientation; fold setup/proof commands inferred from package.json and CI into the harness front door.

## Human questions
- HQ-001: Is npm test intended to be the only supported local proof lane, or should lint/unit/type be exposed separately for speed?

## Evidence and inference log
- evidence: The local validation command is npm test, which runs xo, c8 ava, and tsd. (package.json)
- evidence: CI runs npm install and npm test on Node 14, 16, and 18. (.github/workflows/main.yml)
- evidence: The repo is a Node ESM terminal styling library with documented public API and FORCE_COLOR behavior. (readme.md)
- evidence: Tests exercise public API behavior and a subprocess fixture without remote services. (test/*.js)
- evidence: No engineering harness governance file existed before adoption. (.harness/engineering-harness.md)
