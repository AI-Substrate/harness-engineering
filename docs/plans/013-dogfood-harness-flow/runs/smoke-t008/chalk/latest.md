# Harnessability Assessment - chalk

Run metadata
- Timestamp: 2026-06-09T12:40:00Z
- Repo root: /tmp/harness-flow-selftest-2026-06-09T12-35-28-091Z/chalk
- Branch / commit: main / aa06bb5ac3f14df9fda8cfb54274dfc165ddfdef
- Mode: safe-probe
- Commands executed: minih skills doctor; npm install harness core; npx harness doctor --json; npm test; static file inspection
- Commands skipped: deep git-history mining; external service calls; service boot, migrations, seeds, destructive cleanup
- Safety notes: local proof only; npm test writes coverage/; harness install modified only the throwaway clone

## Verdict

- Operate-Today: B (74.1%)
- Adaptability: B (76.7%)
- Harnessability Index: 75.4% (B)
- Final grade: B
- Readiness: H4
- Highest proof level detected: L2
- Target next proof level: L3
- Confidence: high

The headline grade is healthy, and both axes are above the abandonment threshold. The weaker surfaces are not product operability but missing harness governance, missing boot verb, sparse development onboarding, and no compounding feedback loop.

## Assessment matrix

| Area | Grade | Score | Rationale |
|------|-------|------:|-----------|
| Operate-Today | B | 74.1% | Verified npm test and local-only topology make the repo usable today; canonical harness surfaces are absent before setup. |
| Adaptability | B | 76.7% | Small cohesive source and hermetic tests make change safe; temporal coupling is unknown and architecture boundaries are weakly encoded. |
| External dependency exposure | A | 95% | No remote services or secrets are needed for local proof. |
| Compounding harness loop | F | 0% | No retro/difficulty loop existed before setup. |

## Plain-English assessment

Chalk is a strong candidate for the full harness setup flow. It is a small Node ESM library with a clear local validation command (`npm test`) that runs lint, coverage-backed AVA tests, and declaration tests. CI runs the same command across a Node matrix. The main gap is not product proof but harness encoding: a fresh agent has to infer from package.json that `npm test` is the front door, and there is no governance document, boot verb, observe verb, or retro loop yet.

## Top blockers

1. No canonical engineering harness front door before setup. Add `.harness/engineering-harness.md` and a boot extension wrapping `npm test`.
2. Development onboarding is sparse. The README is strong for product users but does not state the contributor boot/health/evidence loop.
3. No compounding harness loop exists. Add retro records after setup runs.
4. Test evidence is mostly terminal text plus coverage files. Surface the result through a structured boot envelope.

## Highest-leverage improvements

1. Encode `npm test` as `harness boot`, returning status, exit code, and coverage paths.
2. Write the BIO governance document with boot, health, interact, observe, sensors, evidence, gaps, and maturity.
3. Record a retro after the flow so friction becomes durable signal.
4. If future changes expand the codebase, add an architecture-boundary check; today this is low priority because the repo is small.

## First safe agent session plan

1. Run `npm test` to establish a clean local proof baseline.
2. Make one scoped source or test change.
3. Rerun `npm test` and inspect `coverage/lcov.info` if behavior changed.
4. Record any missing proof or friction with `harness record retro` once the harness is installed.

## Harness surfaces

| Surface | Path | Kind | Status | Notes |
|---------|------|------|--------|-------|
| npm scripts | package.json | generic | present | `npm test` is the practical front door today. |
| GitHub Actions CI | .github/workflows/main.yml | prior | present | CI installs dependencies and runs `npm test`. |
| Engineering harness governance | .harness/engineering-harness.md | none | absent before setup | No canonical harness governance document existed at assessment time. |

## Repository topology

Single-package JavaScript/TypeScript-declaration library for Node.js. Source lives in `source/`; tests live in `test/`; CI is GitHub Actions. The local proof stack is npm, XO, c8, AVA, and tsd. There are no detected databases, queues, caches, auth providers, payment/email/SMS/webhook services, object stores, analytics, or model providers.

## Existing engineering environment survey

### Engineering flows

| Flow | Kind | Commands | Canonical | Where detected |
|------|------|----------|-----------|----------------|
| Local validation | test | `npm test` | yes | package.json |
| CI validation | ci | `npm install`; `npm test` | yes | .github/workflows/main.yml |
| Benchmark | custom | `npm run bench` | unknown | package.json |

### Pre-commit and local gates

No pre-commit hook config was found. The effective local/CI gate is `npm test`.

### CI / local equivalence

`npm test` is identical locally and in CI; CI adds a Node version matrix and Codecov upload.

### Existing harness concepts

The repo has a generic npm-script front door but no canonical engineering harness before setup.

### Test mechanisms

AVA unit tests assert exact string consequences, tsd provides type contract tests, and a subprocess fixture exercises color-support behavior. These mechanisms are deterministic and reusable as harness proof.

### External-dependency pressure

Remote-service pressure is none. Local proof is not blocked by secrets or shared infrastructure.

### Code composition and seams

`source/index.js` is the central public API module and is directly tested. `source/vendor/supports-color/index.js` is environment-dependent; the tests cover some behavior, but a TODO notes incomplete no-color spoofing under ESM loader hooks. `source/index.d.ts` is covered by tsd contract assertions.

### Deterministic-encoding opportunities

Encode `npm test` as `harness boot` and surface coverage paths from the boot envelope. The command already proves behavior; the harness should remove the need to infer that it is canonical.

### Manual / IDE-only signals

None found.

### Candidate first harness surfaces

| Surface | Rationale | Proof level | Already exists | Priority |
|---------|-----------|-------------|----------------|----------|
| boot | Wrap the verified `npm test` lane. | L2 | no | high |
| observe | Name coverage artifacts and test output. | L2 | partial | medium |
| retro | Add compounding feedback. | L1 | no | medium |

## Axis A - Operate-Today scorecard

| Dimension | Band | Points | Evidence | Notes |
|-----------|------|-------:|----------|-------|
| A1 Cold-start orientation | Partial | 2 | README product docs; sparse contributing.md | Dev loop inferred from package.json. |
| A2 Setup/environment | Partial | 2 | engines/devDependencies/.npmrc | No tool pin or setup doc found. |
| A3 Locality/dependencies | Strong | 3 | No runtime deps; local tests | No remote proof blockers. |
| A4 Front door | Partial | 2 | npm scripts | No harness governance or boot yet. |
| A5 Boot/health | Strong | 3 | `npm test` passed | Adequate health path for a library. |
| A6 Seed/reset | Not applicable | - | Pure library | No persisted state. |
| A7 Interaction surfaces | Strong | 3 | imports and tests | Public API is directly exercised. |
| A8 Sensors | Strong | 3 | XO, c8/AVA, tsd, CI | Deterministic local/CI gate. |
| A9 Observability | Partial | 2 | coverage/lcov.info, text output | No structured test report. |
| A10 Compounding loop | Absent | 0 | no retro records | Needs harness retro loop. |

## Axis B - Adaptability scorecard

| Dimension | Band | Points | Evidence | Notes |
|-----------|------|-------:|----------|-------|
| B1 Structural coupling | Strong | 3 | compact modules | Low blast radius. |
| B2 Temporal coupling | Unknown | 0 | deep history skipped | Co-change not assessed. |
| B3 Cohesion/locality | Strong | 3 | focused source/tests | Changes are local. |
| B4 Seams/substitution | Partial | 2 | Chalk instances; ESM spoofing TODO | Environment seam can improve. |
| B5 Hermetic tests | Strong | 3 | tests passed locally | No services/secrets. |
| B6 Side-effect isolation | Strong | 3 | no external side effects | Low risk. |
| B7 Consequence verification | Strong | 3 | exact string/type assertions | Behavior is directly asserted. |
| B8 Boundary enforceability | Weak | 1 | XO only | No explicit architecture rule. |
| B9 Complexity/navigability | Partial | 2 | XO complexity warning | Small repo but one hotspot. |
| B10 Inner-loop speed | Strong | 3 | repeatable npm test | Fast enough for setup flow. |

## Back-pressure surface inventory

- Static/build sensors: `npm test` runs XO, c8/AVA, and tsd; verified locally and present in CI.
- Consequence sensors: tests assert exact ANSI string outputs and type-level acceptance/rejection.
- Observability sensors: c8 emits text coverage, `coverage/lcov.info`, and HTML coverage.
- Human/inferential sensors: README examples orient product use but are not proof.

## Scenario probes

1. Library API behavior loop: edit `source/index.js`, exercise via AVA imports, assert exact string output, verdict `npm test`, proof ceiling L2 today.
2. Terminal color support loop: edit vendored support-color detection, exercise env/argv-sensitive tests, verdict `npm test`, proof ceiling L2, missing fuller ESM spoof seam.
3. Type contract loop: edit `source/index.d.ts`, exercise tsd assertions, verdict `npm test`, proof ceiling L2.

## Command tiers

| Tier | Command or check | Status | Proof | Notes |
|------|------------------|--------|-------|-------|
| bootstrap | `npm install` | verified | L1 | Required dependencies; mutates node_modules. |
| boot | `npm test` | verified | L2 | Passed in this run. |
| ci_equivalent | `npm test` | verified | L2 | Same command as CI. |
| observe | `coverage/lcov.info` | verified | L2 | Created by c8. |
| proof | `npm run bench` | configured_unverified | L1 | Benchmark not executed. |

## Services, environment, and remote dependency exposure

No external services or secrets are required. Optional non-secret environment inputs include `FORCE_COLOR`, `TERM`, `CI`, `GITHUB_ACTIONS`, `TEAMCITY_VERSION`, `TERM_PROGRAM`, and `COLORTERM`.

## State, fixtures, reset, and cleanup

No persistent product state exists. The test fixture surface is file/process-level and can be rerun by invoking `npm test`; coverage output can be regenerated.

## Observability and evidence

Evidence paths are terminal output from `npm test`, `coverage/lcov.info`, and `coverage/lcov-report/`. The missing harness affordance is a boot envelope that names these evidence paths explicitly.

## Codebase affordance recommendations

No product-code changes are recommended for setup. A future low-risk test-code improvement could extract a cleaner terminal capability seam if color-support behavior expands.

## Harness-only recommendations

Add `.harness/engineering-harness.md`, add a `boot` extension wrapping `npm test`, and record retro output after the setup flow.

## Onboarding consolidation notes

Keep README as product API documentation. Fold package.json/CI validation commands into harness governance. The existing contributing guide is too sparse to serve as the engineering harness contract.

## Human questions

- Is `npm test` intended to be the only required local health gate for contributors?

## Evidence and inference log

| Source | Provenance | Claim |
|--------|------------|-------|
| package.json | evidence | `npm test` is `xo && c8 ava && tsd`. |
| npm test | evidence | Local validation exited 0 with 32 AVA tests passed and c8 coverage output. |
| .github/workflows/main.yml | evidence | CI runs `npm install` and `npm test` on a Node matrix. |
| readme.md | evidence | Product API examples and FORCE_COLOR behavior are documented. |
| test/chalk.js | evidence | Tests assert exact ANSI string consequences. |
| test/no-color-support.js | evidence | A TODO notes incomplete supports-color spoofing under ESM loader hooks. |
