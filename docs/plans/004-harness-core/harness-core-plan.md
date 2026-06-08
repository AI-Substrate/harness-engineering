# Starter Harness CLI Core — Implementation Plan

**Plan Version**: 1.0.0
**Created**: 2026-06-08
**Spec**: [harness-core-spec.md](./harness-core-spec.md)
**Mode**: Full
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers remain in spec; all decisions resolved in plan-1b clarifications. |
| G2 | Constitution | PASS | `docs/project-rules/constitution.md` now exists; the plan was derived from it and complies (Hexagonal P2, fakes-over-mocks P3, CLI-is-the-API P4, unconfigured-honesty P5, exit-codes P6, extension-ready P10). No deviations. |
| G3 | Architecture | PASS | `docs/project-rules/architecture.md` now exists; the plan's layering, adapter set, output contract, packaging topology, and extension seam match it exactly. |
| G4 | ADR Compliance | N/A | No `docs/adr/`. A lightweight ADR for the root-`package.json` identity decision is *optional* (see Risks R4) — not required. |
| G5 | Structure | PASS | All required sections present and populated. |
| G6 | Testing Alignment | PASS | Spec strategy = Hybrid; each phase has validation tasks; kernel/services have test tasks ordered with/before impl; acceptance criteria are measurable. |
| G7 | Domain Completeness | PASS | No domain registry exists; spec explicitly declines to create one (domains are conceptual labels for traceability). All spec domains appear in Target Domains; Domain Manifest covers every file in the task tables. |

## Summary

Build the **Starter Harness CLI Core** — a small, agent-friendly Node CLI (TypeScript + ESM) that is the front door to this repo's engineering harness, installable via `npx` straight from the repo URL. The CLI follows **Ports & Adapters (Hexagonal) architecture**: a thin commander entrypoint → per-command *acts* → adapter-agnostic *services* → injected *adapters* (fs/process/git/env/clock), each with a fake for testing. This slice ships two genuinely working commands (`help`, `doctor`), a stable human+JSON output envelope with documented exit codes (`0` ok / `1` error / `2` unconfigured), and honest `unconfigured` stubs for the remaining slots. It also stands up the repo's own engineering fundamentals — Biome, vitest+coverage, a `justfile` (`fix`/`format`/`test`/`fft`), GitHub Actions CI on PRs and `main`, `npm audit`, and semver via `release-please`, with `main` branch-protected. Real harness-loop behaviour and the runtime extension loader are explicitly out of scope.

## Target Domains

> No `docs/domains/registry.md` exists; per the spec this feature does **not** create one. Domains below are conceptual labels for traceability only.

| Domain | Status | Relationship | Role |
|--------|--------|-------------|------|
| harness-cli (tooling) | NEW (conceptual) | create | The CLI front door: entrypoint, acts, services, adapters, output kernel. |
| repo engineering substrate | NEW (conceptual) | create | Biome, vitest+coverage, justfile, CI, release-please, branch protection. |
| harness-foundations (docs) | existing | consume | Honours first-principles (CLI-is-the-API, doctor-as-orientation, prescribe-the-fix). No changes. |

## Domain Manifest

| File / Directory | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `package.json` (repo root) | repo engineering substrate | contract | Defines `bin` (`harness`), `prepare` build, `files`, `engines`, scripts — the npx-from-repo-URL identity. |
| `harness/cli/tsconfig.json` | repo engineering substrate | internal | Compiles `harness/cli/src` → `harness/cli/dist` (ES2022/ESNext). |
| `biome.json` (repo root) | repo engineering substrate | internal | Format + lint config for CLI source. |
| `harness/cli/vitest.config.ts` | repo engineering substrate | internal | Test runner + `@vitest/coverage-v8` config. |
| `justfile` (repo root) | repo engineering substrate | internal | Extend existing skill-ops justfile with `fix`/`format`/`test`/`fft`. |
| `harness/cli/src/output/envelope.ts` | harness-cli | contract | `Envelope` type + constructors (the output contract — workshop 001). |
| `harness/cli/src/output/error-codes.ts` | harness-cli | contract | Central `ErrorCodes` table. |
| `harness/cli/src/output/exit.ts` | harness-cli | internal | `exitCodeFor` + `exitWithEnvelope` (status→exit map). |
| `harness/cli/src/output/output-port.ts` | harness-cli | internal | `OutputPort`, `selectMode`, human/JSON renderers. |
| `harness/cli/src/adapters/clock/` | harness-cli | contract+internal | `Clock` port + `SystemClock` + `FakeClock` (kernel depends on it). |
| `harness/cli/src/index.ts` | harness-cli | internal | Commander composition root (minimal in P1, full in P2). |
| `harness/cli/src/adapters/fs/` | harness-cli | contract+internal | `FsPort` + `NodeFs` + `FakeFs`. |
| `harness/cli/src/adapters/process/` | harness-cli | contract+internal | `ProcessPort` + `NodeProcess` + `FakeProcess`. |
| `harness/cli/src/adapters/git/` | harness-cli | contract+internal | `GitPort` + `ExecGit` + `FakeGit`. |
| `harness/cli/src/adapters/env/` | harness-cli | contract+internal | `EnvPort` + `NodeEnv` + `FakeEnv`. |
| `harness/cli/src/acts/help.ts` | harness-cli | internal | `help` command act. |
| `harness/cli/src/acts/doctor.ts` | harness-cli | internal | `doctor` command act. |
| `harness/cli/src/acts/unconfigured-slot.ts` | harness-cli | internal | Factory act producing the 8 unconfigured slots. |
| `harness/cli/src/services/help/help-service.ts` | harness-cli | internal | Help content (purpose, slots, output modes, safe first actions). |
| `harness/cli/src/services/doctor/doctor-service.ts` | harness-cli | internal | Layered doctor checks. |
| `harness/cli/src/services/slots/slot-registry.ts` | harness-cli | contract | Command-slot descriptors + `loadSlotRegistry` (extension seam). |
| `harness/cli/src/services/config/load-config.ts` | harness-cli | internal | Config/command-map validation before use. |
| `harness/cli/test/**` | harness-cli | internal | vitest unit tests mirroring `src/` (fake-adapter based). |
| `harness/cli/README.md` | harness-cli | internal | Purpose, npx install, command surface, output modes, exit codes. |
| `.github/workflows/ci.yml` | repo engineering substrate | contract | CI on PR + main: build/lint/test/coverage/audit. |
| `.github/workflows/release.yml` | repo engineering substrate | contract | release-please on push to main. |
| `release-please-config.json` | repo engineering substrate | internal | `release-type: node`. |
| `.release-please-manifest.json` | repo engineering substrate | internal | Initial version anchor. |

## Key Findings

Synthesized from `research-dossier.md` and the two Implementation-Ready workshops (no new research subagents launched — the topics are fully workshopped).

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `npx`-from-repo-URL works **only** because `package.json` (with `bin` + `"prepare": "npm run build"`) sits at the **repo root** — proven by minih. Source still lives under `harness/cli/`. | Phase 1 task 1.1 puts the manifest at root; `prepare` runs `tsc` to build `harness/cli/dist`; `bin.harness → ./harness/cli/dist/index.js`. |
| 02 | Critical | The output envelope + exit-code contract (workshop 001) is the dependency of every command and the future extension loader. Extends minih with `evidence`/`next_action` + `unconfigured` status; `unconfigured → exit 2`. | Build the output kernel **first** (Phase 1) with unit tests, before any command. |
| 03 | High | Coverage is a **net-new** requirement — neither minih nor chainglass reports it. | Add `@vitest/coverage-v8`; `test` runs `vitest run --coverage`; CI surfaces the summary (Phase 1 + Phase 3). |
| 04 | High | Hexagonal/Ports-&-Adapters layering (workshop 002) is what makes services unit-testable with zero real I/O via fakes. Clock must ship in Phase 1 because the envelope timestamps depend on it (and tests need `FakeClock`). | Ship `Clock` port+impl+fake in Phase 1; fs/process/git/env in Phase 2; one fake per adapter. |
| 05 | High | Unconfigured slots must **never** fake success — `status: unconfigured`, a `next_action`, and exit `2`. minih/chainglass would have used `degraded`→0, which hides unbuilt slots. | The slot registry + factory act (workshop 002) produces all 8 stubs from data; `run`/`validate` also accept `--dry-run`. |
| 06 | Medium | Branch protection is a **repo setting**, not code — cannot be fully verified by CI. | Phase 3 applies it via a documented `gh api` step; mark applied or explicitly deferred to a human admin. |
| 07 | Medium | minih's `fft` recipe (`lint format build typecheck test audit sdk-check`) differs from our spec's `fft = fix → format → test`. | Follow the **spec** definition; do not copy minih's recipe verbatim. |

## Phases

### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Package scaffold + engineering kernel | repo engineering substrate / harness-cli | Stand up the npx-able TS+ESM package, the Biome/vitest/justfile toolchain, and the unit-tested output kernel (envelope/exit/output-port + Clock). | None |
| 2 | CLI command surface + architecture | harness-cli | Build the Hexagonal layering: entrypoint → acts → services → adapters; `help` + `doctor` real, 8 slots `unconfigured`; unit-tested via fakes. | Phase 1 |
| 3 | CI, release automation, branch protection | repo engineering substrate | GitHub Actions CI (build/lint/test/coverage/audit) on PR+main, release-please/semver, branch-protected `main`. | Phase 2 |

---

#### Phase 1: Package scaffold + engineering kernel

**Objective**: Stand up the npx-installable TypeScript+ESM package and the engineering toolchain, then build and unit-test the output kernel everything else depends on.
**Domain**: repo engineering substrate (toolchain) + harness-cli (output kernel)
**Delivers**:
- Root `package.json` (bin/prepare/files/engines/scripts), `harness/cli/tsconfig.json`, `biome.json`, `harness/cli/vitest.config.ts`.
- Extended root `justfile` with `fix`/`format`/`test`/`fft`.
- Output kernel: `envelope.ts`, `error-codes.ts`, `exit.ts`, `output-port.ts` + the `Clock` adapter (port/system/fake), all unit-tested.
- A minimal `index.ts` entrypoint proving `bin` + `prepare` build + `npx` wiring.
**Depends on**: None.
**Key risks**: `prepare`-build only fails at install time → mitigated by the local build smoke (1.8) and CI in Phase 3.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Create root `package.json`: `"type":"module"`, `bin.harness → ./harness/cli/dist/index.js`, `"prepare":"npm run build"`, `"build":"tsc -p harness/cli/tsconfig.json"`, `files:["harness/cli/dist","LICENSE"]`, `engines.node ">=20"`, scripts mapping `test`/`lint`/`format`/`fix`. Add `harness/cli/tsconfig.json` (rootDir `src`, outDir `dist`, ES2022/ESNext). | repo eng substrate | `npm install` succeeds; `npm run build` emits `harness/cli/dist/`. | Finding 01 |
| 1.2 | Add root `biome.json` (schema ~2.4.x, formatter on 2-space, linter recommended, single quotes, `organizeImports`, ignore `**/dist`). | repo eng substrate | `npx biome check harness/cli` runs and reports cleanly on scaffolded files. | Mirror minih MT-01 |
| 1.3 | Add `harness/cli/vitest.config.ts` with `@vitest/coverage-v8` (reporters: text-summary + lcov; include `harness/cli/test/**`). Install devDeps with starting pins (mirroring minih's proven set): `typescript ^5.7`, `vitest ^3.2`, `@vitest/coverage-v8 ^3.2`, `@biomejs/biome ^2.4.10`, `@types/node ^22`, `commander ^13.1`. | repo eng substrate | `npx vitest run --coverage` executes (zero tests OK initially) and prints a coverage summary. | Finding 03; versions from dossier MT-01/MN-01 |
| 1.4 | Extend root `justfile`: `fix` (`biome check --write harness/cli`), `format` (`biome format --write harness/cli`), `test` (`vitest run --coverage`), `fft` (runs `fix` → `format` → `test`). | repo eng substrate | `just fft` runs all three in order and exits 0. | Finding 07 — spec's fft semantics |
| 1.5 | **Test-first**: write `harness/cli/test/output/envelope.test.ts` + `exit.test.ts` asserting the 5 worked examples + field-presence + status→exit map from workshop 001. | harness-cli | Tests exist and fail (red) before impl. | Workshop 001; Hybrid/TDD for kernel logic |
| 1.6 | Implement `harness/cli/src/output/{envelope.ts,error-codes.ts,exit.ts}`: `Envelope` type, `Status`, `Evidence`, `formatOk/formatUnconfigured/formatError`, `ErrorCodes`, `exitCodeFor`, `exitWithEnvelope`. | harness-cli | Tests from 1.5 pass green; `next_action` present on every non-`ok` status; `unconfigured → 2`. | Workshop 001; Finding 02 |
| 1.7 | Implement `Clock` adapter (`harness/cli/src/adapters/clock/{clock-port.ts,system-clock.ts,fake-clock.ts}`) + `output-port.ts` (`OutputPort`, `selectMode` precedence flag→env→TTY, human/JSON renderers); unit-test `selectMode` + `FakeClock` determinism. | harness-cli | `selectMode` returns correct mode for each precedence case; envelope timestamps deterministic under `FakeClock`; **renderer contract honoured — JSON renderer writes one `JSON.stringify(env)` line to stdout; human renderer writes progress/diagnostics to stderr and the final summary line to stdout** (per workshop 001). | Finding 04; Workshop 001/002 |
| 1.8 | Add minimal `harness/cli/src/index.ts` (commander root, `--version`, prints a help/orientation envelope) to prove `bin`+`prepare`+npx. Smoke: `npm run build && node harness/cli/dist/index.js --version`, **plus a packaging smoke `npm pack --dry-run` confirming the tarball contains `harness/cli/dist` and the `harness` bin resolves** (de-risks the install-time `prepare` path of Finding 01 / R1). | harness-cli | Built `dist/index.js` runs and prints version; `npm pack --dry-run` lists `harness/cli/dist/index.js`; `just fft` green overall. | Finding 01; R1; real entrypoint lands in Phase 2 |

**Phase 1 acceptance**: AC-1..AC-5 (spec). `just fft` green; coverage reported; `node harness/cli/dist/index.js` runs.

---

#### Phase 2: CLI command surface + architecture

**Objective**: Implement the Hexagonal layering and the command surface — `help` + `doctor` real, the 8 remaining slots as honest `unconfigured` stubs — all unit-tested via fake adapters.
**Domain**: harness-cli
**Delivers**:
- Adapters fs/process/git/env (port + node impl + fake each).
- Full commander entrypoint registering all acts + global `--json`.
- `help` and `doctor` acts/services; `doctor` layered + prescriptive.
- Slot registry + `unconfigured-slot` factory act (8 slots; `run`/`validate` accept `--dry-run`).
- Config/command-map validation; actionable errors; `harness/cli/README.md`.
- Unit tests for services/acts via fakes.
**Depends on**: Phase 1 (output kernel + Clock).
**Key risks**: keeping handlers thin — enforced by putting all logic in services and testing services directly.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Implement adapters `fs`, `process`, `git`, `env` (each: port interface + Node impl + fake recording call history) under `harness/cli/src/adapters/`. | harness-cli | Each fake implements its port; a smoke test asserts a fake records calls. | Workshop 002; Finding 04 |
| 2.2 | Implement `harness/cli/src/index.ts` commander composition root: global `--json`/`--no-json`, `--version`, `preAction` flag resolution, register all acts. No business logic. | harness-cli | `node dist/index.js --help` lists commands; entrypoint contains no fs/process/git imports. | Workshop 002 (thin entrypoint) |
| 2.3 | Implement `help` service + act: explains harness purpose, command slots, output modes, safe first actions; per-command `--help`. **`help --json` emits a stable envelope** whose `data` lists each slot as `{name, status, next_action}` so the front door is machine-readable, not just human text. | harness-cli | `harness help` (human) lists slots + safe first actions; `harness help --json` returns `status:ok` with `data.slots[]` of `{name,status,next_action}`; exit `0`. | Spec AC-8; PL-02; addresses front-door agent-readability |
| 2.4 | **Test-first** slots: write `slot-registry.test.ts`, then implement `services/slots/slot-registry.ts` (8 BUILTIN_SLOTS) + `acts/unconfigured-slot.ts` factory; `run`/`validate` accept `--dry-run`. (Built **before** doctor so doctor can consume the registry.) **Forward-compat guardrail (workshop 002 Q4)**: model the 8 slots as a *seed set*, not a closed universe — `CommandSlot.name` stays `string`; do **not** introduce a fixed `SlotName` union used as the registry's only key, so a future pi-style loader can append new commands or flip known slots without a schema change. | harness-cli | Each of run/validate/build/lint/test/smoke/health/observe returns `status: unconfigured` + `next_action` and exits `2`; `--dry-run` executes nothing; registry keyed by `name: string` (no closed-set type). | Spec AC-10; Finding 05; Workshop 002 seam + Q4 |
| 2.5 | **Test-first** doctor: write `doctor-service.test.ts` (fakes) for the layered checks, then implement `doctor-service.ts` (toolchain via process, cli-build via fs, **slots via the injected registry from 2.4**) + `acts/doctor.ts` (human progress on stderr, JSON envelope on stdout). | harness-cli | Doctor reports configured vs unconfigured layers each with a `next_action`; service tested with zero real I/O (registry injected as a param/stub); exit `0` (reporting succeeded). | Spec AC-9; Workshop 002 sequence; chainglass CG-01 |
| 2.6 | Implement `services/config/load-config.ts` — validate the **built-in command-map** shape before use (return `E120 CONFIG_INVALID` on bad shape). *This slice validates the in-code slot map only; an external repo-local config file shape is deferred to the extension system.* Unit-test valid + invalid. | harness-cli | Invalid command-map yields an actionable `error` envelope, not a throw; no external config file is read this slice. | Spec AC-12; minih MN-07 |
| 2.7 | Ensure actionable errors across acts: missing/invalid args → `formatError` with `next_action`; no raw stack traces escape. Add tests for the error paths. | harness-cli | Bad invocation prints `{status:error, error.code, next_action}` and exits `1`. | Spec AC-11; Workshop 001 example |
| 2.8 | Write `harness/cli/README.md`: purpose, `npx github:AI-Substrate/harness-engineering` install, command surface table, output modes, exit-code semantics. | harness-cli | README documents install + all commands + exit codes `0/1/2`. | Spec Docs Strategy |
| 2.9 | Integration wiring + coverage pass: `harness help`, `harness doctor`, `harness run smoke`, `harness run validate --dry-run` all produce correct envelopes/exit codes; services/acts covered by unit tests. | harness-cli | All commands behave per workshop 001 examples; `just fft` green with coverage reported. | Spec AC-6,7,12 |

**Phase 2 acceptance**: AC-6..AC-12 (spec).

---

#### Phase 3: CI, release automation, branch protection

**Objective**: Enforce the same local expectations in CI on PRs and `main`, automate semver, and protect `main`.
**Domain**: repo engineering substrate
**Delivers**:
- `.github/workflows/ci.yml` (build + Biome check + test + coverage + `npm audit`) on PR + push to main, Node matrix.
- Coverage surfaced in CI output.
- `release-please` config + manifest + workflow.
- Branch protection on `main` via documented `gh` step.
**Depends on**: Phase 2 (there is a real CLI + tests to run).
**Key risks**: branch protection needs admin rights (Finding 06) → documented `gh api` step, mark applied or deferred.
**Forward note — verbs are dynamic (Constitution P10, v1.1.0)**: the 8 `BUILTIN_SLOTS` are *temporary scaffolding* to be removed when the extension system lands; verbs will be extension-owned (each bundles its verb + help text). Phase 3 must not encode a fixed slot set — CI/smoke checks should exercise `doctor`/`help` **generically** (e.g. "doctor exits 0 and reports the command-slots layer"), never assert the hardcoded 8-slot list, which would break once scaffolding is removed. Slot removal itself is out of scope for this plan.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | Add `.github/workflows/ci.yml`: triggers `pull_request` + `push` to `main`; Node matrix 20+22 (`cache: npm`); steps `npm ci` → `npx biome check harness/cli` → `npm run build` → `npx tsc --noEmit -p harness/cli/tsconfig.json` → `vitest run --coverage` → `npm audit --audit-level=high || true`. | repo eng substrate | Workflow YAML is valid; on a PR it runs and the steps execute. | minih MT-05 |
| 3.2 | Surface coverage in CI: vitest text-summary printed in the log + upload `coverage/lcov.info` as a workflow artifact (or a coverage-summary step). | repo eng substrate | CI run shows a coverage summary; lcov artifact downloadable. | Spec AC-14; Finding 03 |
| 3.3 | Add `release-please-config.json` (`release-type: node`, `bump-minor-pre-major`), `.release-please-manifest.json` (`"."` → `0.1.0`), and `.github/workflows/release.yml` (`on: push main`, `googleapis/release-please-action@v4`). | repo eng substrate | release-please workflow is valid; a conventional-commit push to main opens a release PR. | minih MT-04 |
| 3.4 | Apply branch protection on `main` via a documented `gh api` step (require the CI status check + PR before merge). Record the exact command in the README/plan; mark applied or explicitly deferred to a repo admin. | repo eng substrate | Either protection is applied (verified via `gh api`), or the step + command are documented with an explicit "deferred to admin" note. | Spec AC-16; Finding 06 |
| 3.5 | Validate the CI path end-to-end on the feature PR: confirm the named required checks run and coverage is reported. | repo eng substrate | The PR's Checks tab shows the CI workflow's jobs (build, biome check, test+coverage, audit) completing, and the coverage summary appears in the test job log / lcov artifact. | Spec AC-13,14 (manual verification step) |

**Phase 3 acceptance**: AC-13..AC-16 (spec).

## Acceptance Criteria

Derived from spec; grouped by phase. Each is checkable.

- [ ] **AC-1** Root `package.json` exists with `type:module`, `bin.harness → ./harness/cli/dist/index.js`, `prepare:npm run build`, `files`, `engines.node >=20`; `npx`-from-repo-URL wired via `prepare`. *(P1)*
- [ ] **AC-2** CLI source/tests/config live under `harness/cli/`; `tsc` builds `src → dist`. *(P1)*
- [ ] **AC-3** `biome.json`, vitest+`@vitest/coverage-v8`, and `justfile` `fix`/`format`/`test`/`fft` (= fix→format→test+coverage) exist. *(P1)*
- [ ] **AC-4** Output kernel implemented + unit-tested: envelope `{command,status,data?,error?,evidence?,next_action?}` (+timestamp), human(stderr)/JSON(stdout) renderers, exit map `0` ok / `1` error / `2` unconfigured. *(P1)*
- [ ] **AC-5** `just fft` runs green locally (lint clean, format stable, tests pass, coverage reported). *(P1)*
- [ ] **AC-6** Thin commander entrypoint selects an act, renders human/JSON, translates to exit codes — no business logic in handlers. *(P2)*
- [ ] **AC-7** Acts wire services+adapters; services receive adapters by injection; adapters (fs/process/git/env/clock) each have a fake. *(P2)*
- [ ] **AC-8** `help`/`--help` (global + per-command) explain purpose, slots, output modes, safe first actions, inputs, next steps. *(P2)*
- [ ] **AC-9** `doctor` reports configured vs unconfigured layers with a next action per item (human stderr + JSON stdout); safe at session start. *(P2)*
- [ ] **AC-10** `run/validate/build/lint/test/smoke/health/observe` return `status:unconfigured` + `next_action` and exit `2`; `run`/`validate` accept a safe `--dry-run`. *(P2)*
- [ ] **AC-11** Failures are actionable (what/why/next) — no raw stack traces. *(P2)*
- [ ] **AC-12** Services/acts unit-tested with fake adapters; config/command-map validated before use. *(P2)*
- [ ] **AC-13** GitHub Actions CI runs on PRs and `main`: build + Biome check + tests + coverage + `npm audit`. *(P3)*
- [ ] **AC-14** CI reports test coverage. *(P3)*
- [ ] **AC-15** `release-please` configured (config + manifest + workflow) for `release-type:node`; semver tags/changelog, no npm publish. *(P3)*
- [ ] **AC-16** `main` branch-protected so required CI must pass before merge (documented `gh` step; applied or explicitly deferred). *(P3)*

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| R1 — `prepare`-build fails only at `npx` install time | Medium | High | Local build smoke (1.8) + CI build job (3.1) catch it before users do. |
| R2 — Root `package.json` surprises contributors (repo becomes an npx target) | Low | Medium | Documented in README + plan; decision recorded in spec clarifications (Option A). |
| R3 — Branch protection needs admin rights | Medium | Medium | Documented `gh api` step; mark applied or deferred to a human admin (Finding 06). |
| R4 — Root-`package.json` identity decision is architecturally significant but uncaptured | Low | Low | Optional: run `/plan-3a-v2-adr` to record an ADR. Not required (no ADR system today). |
| R5 — Coverage threshold gating could block a young codebase | Low | Medium | Report-only this slice; only gate on a threshold if explicitly chosen (spec Open Question). |
| R6 — Thin-handler discipline erodes (logic creeps into acts) | Medium | Medium | All logic lives in services tested directly via fakes; acts have no fs/process imports (enforced in review). |
| R7 — A future pi-style extension system forces an unpick | Low | Medium | Survey reviewed (workshop 002 §Forward-compatibility); design is compatible. Guardrails: keep slot registry open-capable (`name: string`, Q4) and put any runtime-needed deps (loader/`jiti`) in `dependencies` not `devDependencies`. Both promoted to the constitution. |

## Agent Harness Strategy

**Not applicable (user override).** The user explicitly descoped harness-loop / `observe` behaviour for this slice (spec Non-Goals + clarifications: *"no need for observe just yet, or to do too much with the harness loop itself"*). This CLI **is** the engineering-harness front door, but it does not implement an agent-harness Boot→Interact→Observe loop here; the remaining slots are honest `unconfigured` stubs. An agent harness can be layered on later once extensions exist.

---

## Validation Record (2026-06-08)

### Validation Thesis

**Raison d'être**: Turn the spec + two Implementation-Ready workshops into an executable, correctly-ordered build for a Starter Harness CLI Core — a clean Hexagonal/Ports-&-Adapters Node CLI front door + repo engineering substrate — so an implementer/agent can build with minimal clarification, without assuming `minih` is on disk.

**Value claim**: Implementation becomes cheaper and safer — phases are ordered (output kernel first), tasks have measurable done-when, the output contract + Hexagonal layering are pre-pinned by the workshops, and the repo gains real lint/test/CI backpressure.

**Artifact promise**: `/plan-5` and `/plan-6` can consume each phase; the output contract + layering won't need redesign; the future extension system fills command slots via the slot-registry seam without reshaping the core.

**Intended beneficiaries**: implementation agents, reviewers, the future extension work.

**Proof target**: Implementation. **Actual**: Implementation.

**Evidence standard**: AC↔task coverage, sound phase ordering, Domain Manifest file coverage, Hybrid testing alignment, no workshop contradiction, self-containment.

**Thesis source**: harness-core-spec.md, workshops/001, workshops/002, cli-core-ask.md.

**Thesis verdict**: Advanced.

**Main thesis risk**: The agent-facing command contract was strongest for `doctor`/unconfigured slots; `help`'s JSON shape is now pinned (fix applied) so the front door is uniformly machine-readable.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Coherence & Completeness | Coherence, Completeness, Evidence Sufficiency, Proof-Level Fit, Hidden Assumptions, Edge Cases | Implementation Readiness | 1 HIGH, 3 MEDIUM, 3 LOW — all fixed | ⚠️→✅ |
| Source-Truth & Workshop Fidelity | Cross-reference accuracy, Technical Constraints, Integration & Ripple, Concept Documentation, Hidden Assumptions | Evidence Sufficiency | 0 | ✅ |
| Thesis Alignment | Thesis Alignment, Proof-Level Fit, Wrong Beneficiary, Non-goal creep, Assumption leakage | Thesis, Agent Readiness | 1 MEDIUM (help JSON) — fixed | ✅ |
| Forward-Compatibility | Forward-Compatibility, Deployment & Ops, Technical Constraints | Downstream Usefulness, Safety to Change | 0 | ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-5` (Phase 1 tasks) | Concrete file paths + measurable done-when to expand into a dossier | — | ✅ | Phase 1 tasks 1.1–1.8 have paths + success criteria |
| `/plan-6` (each phase) | Enough paths/acceptance/testing to implement with minimal clarification | — | ✅ | P1 kernel+fakes, P2 acts/services/adapters, P3 CI/release |
| Future extension system | Slot registry allows later `handler` attach without reshaping acts/services/output | — | ✅ | Task 2.4 + workshop 002 slot-registry seam (`handler?` future field) |
| CI (Phase 3) | build/lint/test/coverage/audit scripts invokable exactly as the workflow calls them | — | ✅ | Script names consistent across package.json (1.1), justfile (1.4), ci.yml (3.1) |

**Thesis alignment**: Value claim advanced at Implementation proof level; main residual risk (uniform agent-readability of `help`) closed by pinning `help --json`'s envelope shape.

**Outcome alignment**: "an agent-friendly CLI ... the front door to this repo's engineering harness" — the plan, as written (and with fixes applied), advances it.

**Standalone?**: No — downstream consumers (`/plan-5`, `/plan-6`, CI, future extensions) exist and were checked.

**Overall**: VALIDATED WITH FIXES — 1 HIGH (task 2.4/2.5 ordering) + MEDIUM/LOW items found and fixed inline; plan remains **Status: READY**.
