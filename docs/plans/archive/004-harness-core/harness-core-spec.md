# Starter Harness CLI Core

**Mode**: Full
**Plan folder**: docs/plans/004-harness-core/
**Status**: Specifying

📚 Specification incorporates findings from `research-dossier.md` (mirrors `~/substrate/minih` architecture/tooling and `~/substrate/chainglass` harness UX). Verbatim ask in `cli-core-ask.md`. This CLI is **Stage 1 / the core** of the 4-stage flow in `install-flow.md`.

---

## Research Context

- **`minih` is the structural template**: TypeScript + ESM Node CLI (commander, vitest, Biome), with `package.json` at the **repo root**, `bin → ./dist/...`, and a `"prepare": "npm run build"` script. This is precisely what makes `npx github:AI-Substrate/minih …` work with no npm-publish — npm clones, runs `prepare` (builds `dist/`), runs the `bin`. `release-please` manages version tags so installs can pin `#vX.Y.Z`.
- **`chainglass` is the UX template**: a layered `doctor` that prescribes the exact fix per failing layer, human-readable progress on **stderr** + a JSON envelope on **stdout**, and documented evidence paths. Its `DESIGN_PATTERNS.md` supplies the clean-architecture rules.
- **This repo's `harness-foundations/first-principles.md` pre-endorses the design**: "The CLI is the API", "diagnostics should prescribe the fix", "a boot/doctor command validates readiness and reminds the agent how the project wants to be operated."
- **Two deliberate extensions beyond the reference repos**: (1) coverage reporting (minih configures none); (2) a non-zero exit for unconfigured required slots (reference repos exit `0` for `degraded`).

---

## Summary

Build a small, well-structured, agent-friendly Node CLI — the **front door** to this repo's engineering harness — installable via `npx` straight from the repo URL. This first slice ships a clean **entrypoint → act → service → adapter** architecture with two genuinely working commands (`help`, `doctor`), a stable human+JSON output contract with documented exit codes, and honest `unconfigured` stubs for the remaining command slots. It also stands up the repo's own engineering fundamentals: Biome, vitest (+coverage), a `justfile` (`fix`/`format`/`test`/`fft`), GitHub Actions CI on PRs and `main`, `npm audit`, and semver via `release-please`, with `main` branch-protected.

The harness *loop* behaviour (real `run`/`validate`/`build`/`smoke`/`health`/`observe`, evidence capture, the runtime extension loader) is **explicitly deferred**. This slice builds the *shape* and the *backpressure*, not the harness behaviour.

## Goals

- An agent-friendly CLI under `harness/cli/` that is discoverable and safe to run at session start (`help`, `doctor`, `--help`).
- A clean, testable layered architecture where command handlers stay thin and side effects sit behind injected adapters.
- A stable output/evidence contract: human and JSON modes, a documented envelope, and documented exit-code semantics.
- Honest representation of unbuilt capability: unconfigured slots report `unconfigured` + a next action and exit non-zero — never fake success.
- One obvious local pre-commit path for agents (`just fft`) and a CI path that enforces the same expectations.
- Automated semver/changelog via `release-please`; `npx`-from-repo-URL install that mirrors minih.

## Non-Goals

- **No real harness-loop behaviour**: `run`, `validate`, `build`, `lint`, `test`, `smoke`, `health`, `observe` ship as `unconfigured` stubs (the CLI does **not** yet wrap repo commands or run the app). (`lint`/`test` as harness *slots* remain stubs even though the repo itself gains real lint/test tooling via Biome/vitest.)
- **No runtime extension system / loader** — only a clean registry *seam* so the later extension work can fill slots.
- **No `observe`/telemetry behaviour**, no docker/playwright/evidence capture (those are chainglass-style *extensions* for later).
- **No npm publishing** — install is `npx` from the repo URL; `release-please` provides version tags/changelog only.
- No domain-extraction refactor of the repo; no changes to existing skills.

## Target Domains

> No `docs/domains/registry.md` exists in this repo. This feature establishes the first **physical tooling** area; it is captured here as a new conceptual domain for traceability only (no registry is being created).

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli (tooling) | **NEW** | **create** | The CLI front door: entrypoint, acts, services, adapters, output contract. |
| repo engineering substrate | **NEW** | **create** | Biome, vitest+coverage, justfile, CI, release-please, branch protection. |
| harness-foundations (docs) | existing | **consume** | Honours first-principles (CLI-is-the-API, doctor-as-orientation, prescribe-the-fix). |

### New Domain Sketches

#### harness-cli [NEW]
- **Purpose**: The agent-and-human front door to the engineering harness — discovers how the repo wants to be worked with, reports readiness, and exposes command slots that later extensions fill.
- **Boundary Owns**: CLI entrypoint/arg-parsing, acts (per-command composition), services (command discovery, doctor checks, validation planning, unconfigured-slot handling, output/envelope rendering), adapters (fs, process, git, env, clock — and their fakes), exit-code policy.
- **Boundary Excludes**: the runtime extension loader and any concrete `run/validate/build/...` behaviour (deferred); harness-loop orchestration; agent-runtime concerns.

#### repo engineering substrate [NEW]
- **Purpose**: The repeatable local + CI quality path that makes the CLI codebase safe to change quickly.
- **Boundary Owns**: Biome config, vitest + coverage config, `justfile` recipes (`fix`/`format`/`test`/`fft`), GitHub Actions CI, `npm audit`, `release-please` config + manifest + workflow, branch-protection setup.
- **Boundary Excludes**: harness-loop checks (smoke/health/observe) and deterministic-backpressure extensions (later).

## Testing Strategy

- **Approach**: Hybrid. Unit-test services and acts thoroughly (they hold the logic); keep the thin entrypoint and adapters lightweight (smoke-level).
- **Rationale**: The clean architecture exists precisely so business logic is testable without touching the real fs/shell/git. Tests prove the envelope, exit-code mapping, doctor checks, and unconfigured-slot handling.
- **Focus Areas**: output envelope rendering (human + JSON); exit-code policy (`0`/`1`/`2`); `doctor` check aggregation + next-action prescription; `unconfigured` slot responses; config/command-map validation.
- **Excluded**: exhaustively testing commander's own parsing; the real adapters' thin pass-through to Node APIs (covered via fakes at the service layer).
- **Mock Usage**: **Avoid mocks.** Use injected **fake adapters** (the minih pattern — a `FakeFs`/`FakeProcess`/etc. implementing the adapter interface, asserted on call history) plus real fixtures. No `vi.mock` of internal modules.

## Documentation Strategy

- **Location**: README-led (Hybrid-lite). A `harness/cli/README.md` (and a top-level pointer) covering purpose, the `npx github:AI-Substrate/harness-engineering` install, the command surface, output modes, and exit codes — plus agent-friendly per-command `--help`.
- **Rationale**: The ask requires the CLI to be self-explanatory to agents without tribal knowledge; `--help` + a concise README is the lightest sufficient surface. Defer `docs/how/` depth until extensions exist.

## Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2 (many new files: root package.json/tsconfig/biome/vitest/justfile, CI + release workflows, full CLI source tree), I=1 (GitHub Actions + release-please + npx-from-git integration), D=1 (small config/command-map state), N=1 (npx-from-root quirk + exit-code/`unconfigured` policy are the only novel bits), F=1 (agent-friendly output, exit semantics, coverage), T=2 (unit tests + CI + coverage + branch protection + release). Total P=8 → CS-4.
- **Confidence**: 0.80 — patterns are proven in minih/chainglass; main unknowns are coverage thresholds and branch-protection automation.
- **Assumptions**: see Risks & Assumptions.
- **Dependencies**: Node ≥20 (repo has v24), `just`, `gh` CLI for branch protection; GitHub Actions enabled on the repo.
- **Risks**: see Risks & Assumptions.
- **Phases**: 3 (see Acceptance Criteria grouping).

## Acceptance Criteria

### Phase 1 — Package scaffold + engineering kernel
1. A **root `package.json`** exists with `"type": "module"`, `bin` mapping `harness → ./harness/cli/dist/index.js`, `"prepare": "npm run build"`, `files` limited to built output, and `engines.node >=20`. `npx`-from-repo-URL is wired via `prepare` (mirrors minih).
2. CLI source, tests, and config live under `harness/cli/`; `tsc` builds `harness/cli/src → harness/cli/dist`.
3. `biome.json` provides formatting + linting; `vitest` is configured with `@vitest/coverage-v8`; a `justfile` exposes `fix`, `format`, `test`, and `fft`, where **`fft` = fix → format → test (with coverage)**.
4. The **output kernel** is implemented with unit tests: the envelope `{command, status, data?, error?, evidence?, next_action?}` (+`timestamp`), a human renderer (stderr) and JSON renderer (stdout), and an exit-code policy: `0` ok, `1` error, `2` unconfigured (a command may document a degraded-but-`0` state explicitly).
5. `just fft` runs green locally (lint clean, format stable, tests pass, coverage reported).

### Phase 2 — CLI command surface + architecture
6. The CLI uses a thin entrypoint (commander) composition root that parses args, selects an **act**, renders human/JSON output, and translates results to exit codes — with no business logic in handlers.
7. **Acts** wire services + adapters per command; **services** hold harness logic and receive adapters by injection; **adapters** wrap fs, process, git, env, and clock, each with a **fake** for tests.
8. `help` and `--help` (global and per-command) explain harness purpose, the command slots, output modes, safe first actions, inputs, and next steps.
9. `doctor` reports configured vs unconfigured harness layers with a next action per item (chainglass-style: human progress on stderr, JSON envelope on stdout), and is safe to run at session start.
10. `run`, `validate`, `build`, `lint`, `test`, `smoke`, `health`, `observe` each return `status: unconfigured` with a `next_action` and exit `2` — never fake success. (`run`/`validate` accept a `--dry-run` that safely shows intended behaviour without executing.)
11. Failure outputs are actionable (what failed, why it matters, what to try next) — no raw stack traces.
12. Services/acts are covered by unit tests using fake adapters; config/command-map is validated before use.

### Phase 3 — CI, release automation, branch protection
13. A GitHub Actions CI workflow runs on pull requests and pushes to `main`, installing deps and running build + Biome check + tests + coverage + `npm audit`.
14. CI **reports test coverage** so reviewers can see the proof path's health.
15. `release-please` is configured (`release-please-config.json` + `.release-please-manifest.json` + a release workflow) for `release-type: node`, producing semver tags/changelog (no npm publish). **[Reversed in plan 018 — the CLI now publishes `@ai-substrate/engineering-harness` to GitHub Packages on each release-please release.]**
16. `main` is branch-protected so required CI must pass before merge — applied via a documented `gh`/admin step (it is a repo setting, not code), and the step is recorded in the plan.

## Risks & Assumptions

- **Assumption**: `npx github:AI-Substrate/harness-engineering` will build via `prepare` on a clean machine with Node ≥20 — same mechanism minih relies on. *Risk*: `prepare` build failures surface only at install time → mitigate with the CI build job.
- **Assumption**: a root `package.json` is acceptable in this docs/skills repo (it makes the whole repo the npx target). Confirmed via clarification (Option A).
- **Risk**: branch protection requires repo-admin rights and cannot be fully verified by code/CI — treat as a documented manual/scripted `gh api` step; mark its AC done when applied, note if deferred to the human.
- **Risk**: coverage *threshold* gating could block CI on a young codebase — start by **reporting** coverage; only gate on a threshold if explicitly chosen (Open Question).
- **Assumption**: command/bin name stays `harness` regardless of how the repo URL is referenced.
- **Publication boundary**: all tracked files stay sanitized/neutral per AGENTS.md; reference repos are studied, not copied wholesale; no private identifiers.

## Open Questions

- **Coverage gating**: report-only, or enforce a threshold (e.g. lines ≥ X%) in CI? *Default: report-only this slice.*
- **CI Node matrix**: single Node (22) or matrix (20, 22) like minih? *Default: matrix 20+22.*
- **`run --dry-run` content for unconfigured slots**: should `--dry-run` show "no command mapped yet" vs a placeholder plan? *Default: show the unconfigured status + next action.*
- **Root vs scoped justfile**: extend the existing root `justfile` (skill-ops today) with engineering recipes, or add `harness/cli/justfile` and re-export? *Default: add engineering recipes to the root `justfile` so `just fft` works repo-wide.*

## Workshop Opportunities

| Topic | Type | Status | Why Workshop | Key Questions |
|-------|------|--------|--------------|---------------|
| Output envelope + exit-code contract | API Contract | ✅ Complete → [workshops/001](./workshops/001-output-envelope-and-exit-codes.md) | It's the contract every command and every future extension depends on; getting `unconfigured`/`degraded`/exit-code semantics right now avoids churn later. | Exact field set + when each is present? `evidence`/`next_action` shape? Exit `2` for all unconfigured, or per-command override? How does `--json` vs human get selected (flag vs env vs TTY)? |
| Adapter set + fake strategy (CLI composition pattern) | Integration Pattern | ✅ Complete → [workshops/002](./workshops/002-cli-composition-pattern.md) | Defines the testing seam for the whole CLI and all future extensions; captures the minih composition pattern as local knowledge so the build doesn't assume minih is on disk. | Which adapters ship now (fs/process/git/env/clock) vs later (http/server/telemetry)? One fake per adapter? Shared fake factory? |
| Command registry / extension seam | State Machine | ✅ Covered within [workshops/002](./workshops/002-cli-composition-pattern.md) (slot registry section) | The later extension loader must slot in without reshaping the core. | What does a "command slot" descriptor look like (name, status, next_action, handler)? How does an extension later register/override a slot? |

## Clarifications

### Session 2026-06-08

- **Q: Workflow mode?** → **Full, 3 phases.** User initially picked Simple, then chose Full and requested a phase discussion. Agreed phases: (1) scaffold + engineering kernel, (2) command surface + architecture, (3) CI + release + branch protection. Envelope kernel placed in Phase 1 (so Phase-1 tests exercise real code).
- **Q: Testing strategy?** → **Hybrid** — unit-test services/acts; lightweight entrypoint/adapters.
- **Q: Mock usage?** → **Avoid mocks**; use injected fake adapters + real fixtures (minih pattern).
- **Q: Documentation?** → **README-led + agent-friendly `--help`.**
- **Q: npm package name / publish?** → **No npm publish.** Install via `npx` straight from the repo URL; `release-please` provides semver tags/changelog only.
- **Q: Where does the npm manifest live (given npx-from-repo-URL)?** → **Option A — root `package.json`** with `bin → ./harness/cli/dist/index.js` and `"prepare": "npm run build"`, faithfully mirroring how minih makes `npx github:org/repo` work. All CLI source/tests/Biome/vitest config remain scoped under `harness/cli/`; the typed command stays `harness`.
- **Scope steer**: "no need for observe just yet, or to do too much with the harness loop itself… well structured cli, unit tests with vitest, linting, biome, a build in ci, semver + release please." → real harness-loop behaviour and the extension loader are **out of scope**; remaining slots are honest `unconfigured` stubs.
