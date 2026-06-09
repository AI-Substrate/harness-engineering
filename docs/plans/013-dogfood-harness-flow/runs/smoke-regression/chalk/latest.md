# Harnessability Assessment — chalk

Run metadata
- Timestamp: 20260609T131600Z
- Repo root: /private/tmp/harness-flow-selftest-2026-06-09T13-13-49-111Z/chalk
- Branch / commit: main / aa06bb5ac3f14df9fda8cfb54274dfc165ddfdef
- Mode: static
- Commands executed: minih skills doctor; npm install local harness with --prefix; npx harness doctor --json; read package, CI, source, and test files.
- Commands skipped: service boot, migrations, seeds, auth, remote calls, and destructive cleanup during assessment.
- Safety notes: writes limited to .harness/reports/harnessability in the target clone; no secret values read.

## Verdict
- Operate-Today: B (77.8%)
- Adaptability: B (77.8%)
- Harnessability Index: 77.8% (B)
- Readiness: H2
- Highest proof level detected: L2 (with L4-style exact string consequences inside tests)
- Target next proof level: L3
- Confidence: high

## Plain-English assessment
Chalk is a small, local-only Node ESM library with a clear npm proof lane: `npm test` runs XO lint, c8-wrapped AVA tests, and tsd type assertions, and CI runs the same command across Node versions. A fresh agent can understand the public API from the README and can infer the local validation command from package.json and CI. The main gaps are not product complexity; they are missing project-side harness affordances: no pre-existing governance doc, boot verb, structured harness evidence, quick lane, or retro loop before this setup run.

## Top blockers
1. No pre-existing engineering harness governance/front door: add .harness/engineering-harness.md and a boot verb wrapping npm test.
2. Structured evidence artifacts are limited: coverage and exit codes exist, but there is no canonical JSON run envelope before harness setup.
3. No named quick lane separate from full lint+coverage+type proof.

## Highest-leverage improvements
- Encode `harness boot` around `npm test` and return an honest JSON Envelope.
- Optionally add quick/type harness verbs around `npx ava` and `npx tsd` if faster targeted loops matter.
- Keep retro records under .harness/records/retro so future agents see setup friction.

## First safe agent session plan
Run `npx harness doctor --json`, then `npx harness boot` once authored. For code edits, use `npm test` as full proof and targeted AVA/tsd commands only when scoped evidence is enough. Record friction with `harness record retro`.

## Harness surfaces
- package.json npm scripts: project-canonical proof lane.
- .github/workflows/main.yml: CI runs npm install and npm test.
- .harness/reports/harnessability: created by this assessment.

## Repository topology
Node.js ESM library; JavaScript implementation plus TypeScript declarations; AVA/XO/c8/tsd test stack; GitHub Actions CI; no services or external infrastructure.

## Axis A — Operate-Today scorecard
- A1 Cold-start orientation and repo map: Partial (2) — Fresh agents can understand the library quickly, but developer-operation guidance is mostly inferred from package.json.
- A2 Setup and environment contract: Partial (2) — Runtime/tooling is discoverable, but install reproducibility is weaker without a lockfile and setup notes.
- A3 Locality of infrastructure and external dependency exposure: Strong (3) — Local proof is not blocked by remote infrastructure or secrets.
- A4 Harness front door and command discoverability: Strong (3) — The npm script surface is the canonical front door for this small library, though no project-specific harness existed before this run.
- A5 Boot and health/readiness path: Strong (3) — For a library, a green test lane is the practical health signal.
- A6 Seed, fixture, reset, and cleanup state: Not applicable (n/a) — No datastore, queue, object store, or generated state lifecycle applies.
- A7 Supported interaction surfaces: Strong (3) — Agents can interact through the documented library API and the AVA/tsd test harness.
- A8 Existing deterministic back-pressure sensors: Strong (3) — The core behavior has strong static and unit/type backpressure.
- A9 Observability and evidence artifacts: Partial (2) — Evidence exists, but there is no structured JSON test report or canonical artifact directory in the repo.
- A10 Compounding harness loop: Absent (0) — Friction capture starts with this dogfood run rather than being an existing project surface.

## Axis B — Adaptability scorecard
- B1 Structural coupling and blast radius: Strong (3) — Blast radius is limited for most library changes.
- B2 Temporal/change coupling: Unknown (0) — Temporal coupling should not be inferred from the current file layout alone.
- B3 Cohesion and locality of change: Strong (3) — Related behavior and proof surfaces are easy to locate.
- B4 Seams, substitution, and dependency inversion: Strong (3) — The main behavior is parameterized and easy to exercise without external services.
- B5 Hermetic, offline, and isolated testability: Strong (3) — Useful proof runs offline after dependencies are installed.
- B6 Side-effect isolation and external-effect sinks: Not applicable (n/a) — The package transforms strings and writes only normal test process output.
- B7 State evolution and consequence verification: Strong (3) — State evolution is not a concern, but behavior consequences are directly verified.
- B8 Architecture boundary enforceability: Weak (1) — This is low-risk for the current size, but boundary rules are not encoded beyond lint/import checks.
- B9 Complexity, size, and navigability thresholds: Strong (3) — The codebase fits comfortably in an agent context window.
- B10 Inner-loop speed and repeatability: Partial (2) — The loop is repeatable but lacks a named fast lane distinct from full lint+coverage+type proof.

## Back-pressure surface inventory
Static sensors: XO, AVA under c8, tsd, GitHub Actions matrix. Consequence sensors: exact string and ANSI escape-code assertions. Observability: text/lcov coverage and command exit codes. No runtime services, external-effect sinks, or production/customer sensors were detected.

## Scenario probes
- Library API behavior loop: edit source/index.js, interact through the public API, assert exact returned strings with AVA; ceiling L4.
- Type declaration compatibility loop: edit source/index.d.ts, interact through tsd assertions; ceiling L2.
- Color support fixture loop: run the child-process fixture through AVA and assert captured stdout; ceiling L4.

## Command tiers
`npm install` is bootstrap; `npm test` is proof and CI-equivalent; `npm run bench` is an optional observe/benchmark command; `npx harness doctor --json` is the harness doctor.

## Services, environment, and remote dependency exposure
No external services or secret-gated dependencies were detected. `FORCE_COLOR` is an optional non-secret behavior override documented in the README.

## State, fixtures, reset, and cleanup
The package is stateless. The only fixture found is a local child process used to observe color-support behavior.

## Observability and evidence
Evidence comes from command exit codes, AVA assertion output, c8 text/lcov coverage, and CI status. A harness boot envelope is the next structured evidence improvement.

## Codebase affordance recommendations
No product-code affordances are required before useful local proof. Harness-only recommendations are sufficient for the setup flow.

## Harness-only recommendations
Create .harness/engineering-harness.md and add a boot extension wrapping `npm test`.

## Onboarding consolidation notes
Fold README API/behavior notes and CI `npm test` equivalence into the governance doc. The contributing guide adds only code-of-conduct context.

## Human questions
Do maintainers want a separate quick lane, or is full `npm test` fast enough for normal edits?

## Evidence and inference log
- evidence: package.json — The project is a Node ESM library with package scripts: test = "xo && c8 ava && tsd" and bench = "matcha benchmark.js".
- evidence: .github/workflows/main.yml — CI runs npm install and npm test on Node 18, 16, and 14, then uploads coverage on Node 16.
- evidence: readme.md — README explains the package purpose, install command, API usage, style catalogue, color support controls, and FORCE_COLOR/--color behavior.
- evidence: test/*.js and source/index.test-d.ts — AVA tests and tsd type assertions exercise Chalk behavior, color-level controls, string output consequences, and a child-process fixture.
- evidence: source/index.js and source/utilities.js — Core implementation is compact and localized: public factory/API logic in source/index.js with two utility functions in source/utilities.js and vendored support modules.
- evidence: npx harness doctor --json — After local harness install, harness doctor executes but reports degraded cli-build because consumer clone lacks harness/cli/dist, while extensions and record-types load.
