# Harnessability Assessment — sample-service

Run metadata
- Timestamp: 20260604T224407Z
- Repo root: .
- Branch / commit: main / unknown
- Mode: static
- Commands executed: none
- Commands skipped: service boot, dependency install, external calls
- Safety notes: no secret values read; no dependency install; no service boot; no product-code changes applied

## Verdict

- Operate-Today: C (62%)
- Adaptability: C (55%)
- Harnessability Index: 58.5% (C)
- Readiness: H2
- Highest proof level detected: L2 Static/build/test
- Target next proof level: L3 Runtime interaction
- Confidence: medium

## Plain-English assessment

The harness front door is present and command candidates are mapped, but no product-behavior scenario has been verified. A fresh agent can read the harness, run candidate static checks, and discover env var names, but cannot yet prove runtime behavior locally because there is no smoke path and no local substitute for the database.

## Top blockers

1. No meaningful smoke scenario (G001) — a server starting is not enough; one product-behavior proof is missing.
2. No local substitute for the database (G002) — remote/shared state blocks L4 consequence proof locally.

## Highest-leverage improvements

- Inspect the integration/migration test setup for an existing seed/reset or restore path that can be wrapped as a harness `proof` command (reuse before building).
- Add one fixture-backed smoke test hitting a single route (unblocks L3).
- Add a containerized local database plus idempotent seed/reset (unblocks L4).
- Add a local email sink so external-effect payloads are observable.
- Populate candidate command tiers in `harness/cli/commands.json`.

## First safe agent session plan

1. Read `docs/project-rules/engineering-harness.md`.
2. Inspect `harness/cli/commands.json`.
3. Confirm prerequisites and env var names without reading secret values.
4. Read the test suite to see how it mocks, injects, seeds, and resets state — those mechanisms are candidate harness affordances.
5. Run the candidate fast check only if safe and permitted.
6. Ask the human for the smallest meaningful smoke path before claiming runtime proof.

## Harness surfaces

| Surface | Path | Kind | Status | Notes |
|---------|------|------|--------|-------|
| Governance file | `docs/project-rules/engineering-harness.md` | canonical | present | Canonical governance file |
| Agent route | `AGENTS.md` | canonical | present | Routes agents to the harness |
| Command map | `harness/cli/commands.json` | canonical | present | Sensor inventory |

## Repository topology

Single-package TypeScript HTTP service on Node. Package root `.`; service type `api`; CI workflow at `.github/workflows/ci.yml`. Not a monorepo.

## Axis A — Operate-Today scorecard

| Dimension | Band | Points | Evidence | Notes |
|-----------|------|-------:|----------|-------|
| A1 Cold-start orientation | Partial | 2 | README, AGENTS.md | No explicit first-session steps |
| A2 Setup/environment contract | Partial | 2 | .env.example, lockfile | No doctor/preflight |
| A3 Locality / dependency exposure | Weak | 1 | DATABASE_URL, no compose | No local DB substitute |
| A4 Harness front door | Strong | 3 | harness/cli/commands.json | Wraps existing scripts |
| A5 Boot and health path | Weak | 1 | start script only | Readiness not provable |
| A6 Seed/fixture/reset/cleanup | Absent | 0 | none detected | No repeatable state |
| A7 Supported interaction surfaces | Partial | 2 | route handlers | No OpenAPI spec |
| A8 Deterministic back-pressure sensors | Partial | 2 | test+lint, CI | Unit lane only |
| A9 Observability and evidence | Weak | 1 | console logging | No run artifacts |
| A10 Compounding harness loop | Weak | 1 | empty docs/harness/ | No friction ledger |

## Axis B — Adaptability scorecard

| Dimension | Band | Points | Evidence | Notes |
|-----------|------|-------:|----------|-------|
| B1 Structural coupling / blast radius | Partial | 2 | feature modules | One broad util module |
| B2 Temporal/change coupling | Unknown | 0 | — | Not computed in static mode |
| B3 Cohesion / locality | Partial | 2 | tests near code | Some catch-all helpers |
| B4 Seams / substitution | Weak | 1 | direct SDK clients | Few injection seams |
| B5 Hermetic testability | Partial | 2 | offline unit tests | Integration not isolated |
| B6 Side-effect isolation / sinks | Weak | 1 | direct email send | No local sink |
| B7 State evolution / consequence | Weak | 1 | migration tool | No consequence checks |
| B8 Architecture boundary enforceability | Absent | 0 | no boundary linter | Prose rules only |
| B9 Complexity / navigability | Partial | 2 | eslint | No complexity rules |
| B10 Inner-loop speed | Partial | 2 | fast unit lane | No watch mode |

## Back-pressure surface inventory

- Static: `npm test` (L2, candidate), `npm run lint` (L2, candidate).
- Runtime: smoke path unknown (no command detected).
- Consequence, external-effect, observability, production/customer: not yet proven locally.

## Scenario probes

- API behavior loop (applicable): highest plausible proof today L3; missing a fixture-backed smoke test on one route.
- State/storage loop (applicable): highest plausible proof today L2; missing a containerized local database plus seed/reset.

## Command tiers

| Tier | Command or check | Status | Proof | Notes |
|------|------------------|--------|-------|-------|
| bootstrap | `npm install` | candidate_unverified | L1 | Not executed in static mode |
| fast | `npm test` | candidate_unverified | L2 | Not executed in static mode |
| boot | `npm start` | candidate_unverified | L3 | Requires services and secrets |

## Services, environment, and remote dependency exposure

Env var names only: `DATABASE_URL` (required, secret-like, no safe default), `LOG_LEVEL` (optional, safe default). External dependencies: primary database (remote required, shared-state risk, blocks proof partially); transactional email (remote required, production-risk side effect). No secret values were read.

## State, fixtures, reset, and cleanup

No seed, reset, or fixture command detected. State repeatability is currently unknown.

## Observability and evidence

Console logging only; no structured run artifacts, traces, or JSON report modes detected.

## Codebase affordance recommendations

| ID | Risk | Status | Recommendation |
|----|------|--------|----------------|
| CBA001 | medium | proposed | Add a local/test-only email sink that captures payloads; must not apply in production. |

## Harness-only recommendations

- P001: Populate candidate command tiers in `harness/cli/commands.json` from detected scripts (low risk, requires human review).

## Onboarding consolidation notes

- Run-and-test steps currently in `README.md` should be folded into the harness front door and assessment report.

## Human questions

| ID | Question | Reason |
|----|----------|--------|
| Q001 | What is the smallest meaningful smoke path for this repo? | Repository evidence did not identify a verified product-behavior scenario. |

## Evidence and inference log

| Source | Provenance | Claim |
|--------|------------|-------|
| `package.json` | inference | Candidate fast command may be `npm test`. |
| `harness/cli/commands.json` | evidence | A harness front door exists. |
