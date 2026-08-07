# Research Dossier: Starter harness CLI core

**Generated**: 2026-06-08T06:55:00+10:00
**Research Query**: "Starter harness CLI core (`harness/cli/`) — agent-friendly Node CLI as the harness front door; mirror `~/substrate/minih` and `~/substrate/chainglass` for CLI architecture, biome, justfile fft, CI, release-please, npm audit, coverage. Extension system out of scope."
**Mode**: Pre-Plan (greenfield tooling — research is "what to mirror", not "how existing code works")
**Plan folder**: docs/plans/004-harness-core/
**FlowSpace**: Graph present for this repo, but reference repos (minih/chainglass) are not indexed — standard tools used.
**Method**: 4 parallel explore subagents — minih CLI architecture, minih engineering tooling, chainglass harness patterns, this-repo state & conventions.

---

## Executive Summary

### What we're building
A brand-new agent-friendly Node CLI under `harness/cli/` that is the **front door** to this repo's engineering harness. Starter command slots: `help`, `doctor`, `run`, `validate`, `build`, `lint`, `test`, `smoke`, `health`, `observe`. It speaks both human and JSON, treats unconfigured slots as honest gaps (never fake success), reports evidence paths, and has documented exit codes. A runtime **extension system** (later step, OUT OF SCOPE here) will replace `run`/`validate`/etc. with repo-local behaviour. This slice also stands up the repo's own engineering fundamentals (Biome, justfile `fft`, npm audit, GitHub Actions CI, release-please, coverage, branch protection).

### Key insights
1. **`minih` is a near-perfect skeleton to copy.** It is a TypeScript + ESM Node CLI (commander, vitest, biome) with the exact act/service/adapter layering, a canonical output envelope, a centralized error-code table, and fake-adapter tests. We should mirror its shape almost verbatim.
2. **`chainglass` is the gold standard for the harness *UX*** — a layered `doctor` that prescribes the exact fix per failure, human-on-stderr + JSON-envelope-on-stdout, a `--wait` cold-boot poll, and documented evidence paths. Its `DESIGN_PATTERNS.md` gives us quotable clean-architecture rules.
3. **The ask extends the proven envelope.** minih/chainglass use `{command, status, timestamp, data?, error?}`; the ask adds `evidence` and `next_action`. The chainglass agent independently recommended adding `next_action`. This is a small, safe superset.
4. **Two real gaps vs the reference repos** must be closed by this work: (a) **coverage reporting** — minih configures *no* coverage; the ask *requires* it (vitest v8 coverage); (b) **`unconfigured` → non-zero exit** — minih/chainglass exit `0` for `degraded`; the ask wants unconfigured required slots to exit non-zero. We need a distinct exit code for `unconfigured`.
5. **`fft` means something different here.** minih's `fft = lint format build typecheck test audit sdk-check`. The ask defines `fft = fix + format + test` (agent pre-commit). We follow the *ask's* definition, not minih's recipe name.

### Quick stats
- **Reference repos**: 2 (minih = architecture + tooling; chainglass = harness UX + clean-arch doctrine)
- **Greenfield in this repo**: no root `package.json`, no `biome.json`, no `.github/workflows/`, no `harness/` tree yet
- **Toolchain available**: `just` (/opt/homebrew/bin/just), Node `v24.7.0`, npm `11.10.0`, npx `11.10.0`
- **Prior learnings**: harness-foundations first-principles strongly pre-endorse every design choice (see Prior Learnings)
- **Domains**: no domain registry — N/A

---

## Reference Pattern 1 — `minih` CLI architecture (what to copy structurally)

**Package/runtime** (`minih/package.json`, `tsconfig.json`):
```json
"bin": { "minih": "./dist/cli/index.js" },
"type": "module",
"engines": { "node": ">=20.19.0" },
"dependencies": { "commander": "^13.1.0" },
"devDependencies": { "typescript": "^5.7.3", "vitest": "^3.2.4", "@biomejs/biome": "^2.4.10" }
```
- ESM + TypeScript, `tsc` build `src/ → dist/` (ES2022, module ESNext), `bin` points at the built `dist/cli/index.js`.

**Layering** (the shape to mirror):

| Our layer | minih location | Responsibility |
|-----------|----------------|----------------|
| CLI entrypoint | `src/cli/index.ts` | one composition root: register commands, global flags, parse, exit |
| Acts | `src/cli/commands/*.ts` (run, list, view…) | compose services + adapters for one command |
| Services | `src/runner/*` (runner, folder, permissions…) | business logic; adapters injected as params |
| Adapters | `src/adapter/interface.ts`, `fake.ts`, `sdk-copilot.ts` | side effects behind an interface |

- **DI = parameter injection**: `runAgent(adapter, def, config, …)`; tests pass `new FakeAgentAdapter(...)`.
- **Entrypoint stays thin** — wires commands and resolves global flags only; handlers call `exitWithEnvelope()`.

**Output envelope** (`src/cli/output.ts`):
```ts
export interface MinihEnvelope {
  command: string;
  status: 'ok' | 'error' | 'degraded';
  timestamp: string;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
}
export function exitWithEnvelope(envelope: MinihEnvelope): never {
  printEnvelope(envelope);
  process.exit(envelope.status === 'error' ? 1 : 0);
}
```

**Errors & exit codes**: centralized code table (`E100 UNKNOWN`, `E108 INVALID_ARGS`, `E121 AGENT_NOT_FOUND`…); actionable messages via `formatError()`; exit `1` only for `status: error`.

**Testing seam** (`vitest`, `test/**/*.test.ts`): fake adapters injected and asserted on call-history:
```ts
const fake = new FakeAgentAdapter({ output: validSystemOutput({ result: 'ok' }) });
await runAgent(fake, def, { slug: 'test-order' }, undefined, tmpDir);
expect(fake.getRunHistory()).toHaveLength(1);
```

**Config validation** (`.minih.json`, registries): shapes validated at load time before use.

**Files worth reading in full during implementation**: `src/cli/index.ts`, `src/cli/output.ts`, `src/cli/commands/run.ts`, `src/runner/runner.ts`, `src/adapter/interface.ts`, `src/adapter/fake.ts`.

---

## Reference Pattern 2 — `minih` engineering tooling (configs to adapt)

**Biome** (`biome.json`, pinned `@biomejs/biome ^2.4.10`): formatter on (2-space), recommended lint, `organizeImports`, single quotes, `useIgnoreFile`, excludes `dist`.

**justfile** (minih's): `fft: lint format build typecheck test audit sdk-check`; `lint: npx biome check .`; `format: npx biome format --write .`; `test: npm test`; `audit: npm audit --audit-level=high || true`.
> ⚠️ Adapt — the ask's `fft = fix + format + test` (agent pre-commit), and `fix` should apply safe autofixes (`biome check --write`). Don't copy minih's `fft` recipe verbatim.

**Test/coverage** (`package.json`, `vitest.config.ts`): `test: "vitest run"`. **No coverage configured in minih.**
> ⚠️ Gap to close — the ask requires coverage. Use vitest's built-in coverage (`vitest run --coverage`, `@vitest/coverage-v8`).

**release-please** (`release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release.yml`):
```json
{ "packages": { ".": { "release-type": "node", "bump-minor-pre-major": true, "bump-patch-for-minor-pre-major": true } } }
```
```json
{ ".": "0.1.6" }   // manifest
```
```yml
# release.yml — on push to main; uses googleapis/release-please-action@v4
```

**CI** (`.github/workflows/ci.yml`): `on: push [main] + pull_request [main]`; `quality-gate` job, node matrix `20, 22`, `cache: npm`; steps: `npm ci` → `npx biome check .` → `npm run build` → `npx tsc --noEmit` → `npm test` → `npm audit --audit-level=high || true` → dist verify. Plus a `doctor` job: `node dist/cli/index.js doctor | jq .`. **No coverage upload in minih CI** (another gap to close).

**npm vuln scanning**: `npm audit --audit-level=high || true` (justfile + CI). No `audit.mjs`, no Dependabot in minih.

**Node pinning**: `engines.node >=20.19.0`; no `.nvmrc`/`.npmrc`.

**Copy/adapt checklist**: `biome.json`, `package.json` (scripts/engines/devDeps), `justfile` (redefine `fix/format/test/fft`), `vitest.config.ts` (+coverage), `release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/ci.yml` (+coverage job), `.github/workflows/release.yml`.

---

## Reference Pattern 3 — `chainglass` harness UX & clean-arch doctrine

**Doctor** (`harness/src/cli/commands/doctor.ts`, `harness/src/doctor/diagnose.ts`): **layered cascade** (`Layer 0: Prerequisites … Layer 5: Ready`), each check carries a `fix` command + optional `detail`; `formatStderr()` prints `✓/✗/⏳` with `→ Run: …`; `--wait` polls every 3s; **human progress on stderr, final JSON envelope on stdout**. → This is the template for our `doctor`.

**Command surface / front door** (`harness/src/cli/index.ts`): root `harness` registers `build, dev, stop, health, test, screenshot, console-logs, results, ports, seed, doctor, agent, workflow…`. Extensions = docker boot, in-container app CLI, playwright debugging — exactly the "later extension" shape our core anticipates.

**Output/evidence contract** (`harness/src/cli/output.ts`): envelope `{command, status, timestamp, data?, error?}`, status `ok|error|degraded`, exit `0` for ok/degraded, `1` for error. Evidence paths documented (`harness/results/{name}-{viewport}.png`, `harness/results/test-results.json`). `audit.mjs` is a Playwright evidence capturer printing JSON findings + screenshot names.
> Recommendation (from the agent): **add `next_action` explicitly** to our core envelope (and `evidence` per the ask).

**Clean-architecture rules to pull into our constitution/spec** (from `DESIGN_PATTERNS.md` + doctor command):
- Thin entrypoints, thick services — command parsing delegates, never accumulates logic.
- Keep side effects behind adapters/ports; resolve dependencies via injection.
- Validate inputs at the boundary before work starts.
- Structured envelopes for every command result.
- Separate human-readable diagnostics (stderr) from machine-readable output (stdout JSON).
- Diagnostics prescribe the fix (explicit next action over implicit behaviour).
- Treat docs/prompts as a versioned API surface for agents.

**AGENTS.md framing**: "The loop: Edit → Run → Observe → Fix → Repeat"; agents are told which command to start with (`just harness dev`, then `doctor --wait`). Mirror this "tell the agent the safe first command and why" framing in our help/docs.

---

## Prior Learnings (this repo's own first-principles pre-endorse the design)

`harness-foundations/` already argues for exactly this CLI. These are load-bearing — cite them in the spec.

| ID | Source | Insight | Action |
|----|--------|---------|--------|
| PL-01 | `first-principles.md:19-21` | "A CLI often works well as the front door… wrap existing scripts rather than reimplement." | Core wraps; extensions map real commands. |
| PL-02 | `first-principles.md:67-69` | "A boot/doctor command validates readiness **and** reminds the agent how the project wants to be operated." | `doctor` = executable orientation. |
| PL-03 | `first-principles.md:101-107` | "CLIs are natural harness surfaces… The CLI is the API — return structured status/data/errors, don't force log scraping." | JSON envelope is mandatory, not optional. |
| PL-04 | `first-principles.md:109-111` | "Diagnostics should prescribe the fix." | Every failure → `next_action`. |
| PL-05 | `first-principles.md:131-141` | "Definition of Done separates checks from judgement… evidence needed to decide." | `validate` plans gates + evidence. |
| PL-06 | `patterns-that-work.md:131-167` | "Make the CLI explorable"; "a good doctor stops at the most useful failing layer and prescribes the next action." | Mirror chainglass's layered doctor. |
| PL-07 | `first-principles.md:177-183` | "The repo is the system of record." | Evidence + config live in-repo. |

**Compound activity**: no `docs/harness/_buffers/` and no prior `.retro.md` ledger — nothing to surface.

---

## Critical Discoveries (decisions the spec/clarify must lock)

🚨 **CD-01 — Envelope superset**: adopt `{command, status, data, error, evidence, next_action}` (+`timestamp`). Extends minih/chainglass; both already endorse `next_action`. **Low risk.**

🚨 **CD-02 — Exit-code semantics for `unconfigured`**: reference repos exit `0` for `degraded`. The ask requires unconfigured *required* slots to exit **non-zero**. Decision: define an exit-code map — `0` ok, `1` error, `2` unconfigured (configurable per command for documented degraded-but-ok). Must be documented per the AC "CLI commands have documented exit-code semantics."

🚨 **CD-03 — Coverage is a net-new requirement**: neither reference repo reports coverage. Add `@vitest/coverage-v8`, `vitest run --coverage`, and surface it in CI. Don't assume a threshold gate unless the spec sets one.

🚨 **CD-04 — Extension system is OUT OF SCOPE but must not be designed out**: `run`/`validate`/`build`/etc. return `unconfigured` now; the architecture must leave a clean seam (a command registry/map) so a later runtime loader can fill slots. Build the *shape*, not the loader.

🚨 **CD-05 — `fft` semantics**: follow the ask (`fft = fix → format → test` with coverage), not minih's broader recipe.

---

## Open Questions for the Spec (host-independent decisions)

1. **Language**: TypeScript+ESM+build (mirror minih, strong precedent, adds `tsc` build) vs plain JS (no build, simpler npx). *Recommendation: TypeScript+ESM to mirror minih.*
2. **justfile placement**: extend the root `justfile` (current repo convention; but it's skill-ops today) vs a scoped `harness/cli/justfile`. *Recommendation: engineering recipes in `harness/cli/justfile`, optionally re-exported from root.*
3. **package.json + npx**: the npm package lives at `harness/cli/`. What is the **package name/scope** for `npx <name>`? (e.g. `@ai-substrate/harness` or similar.) Does it npm-publish, or npx-from-git for now?
4. **CI location**: workflows must live at repo root `.github/workflows/`; scope them to `harness/cli/**` paths.
5. **Versioning**: does `harness/cli/` own its own release-please package, or piggyback repo-level? *Recommendation: single release-please package rooted at the CLI for now.*
6. **Arg parser**: commander (mirror minih) vs native. *Recommendation: commander.*
7. **Branch protection**: an AC, but it's a GitHub repo setting (gh/admin), not code — confirm it's applied via `gh` as a manual/scripted step, noted in the plan.

---

## Recommendations

**If building this CLI**:
1. Scaffold `harness/cli/` as a TypeScript+ESM npm package mirroring minih's `src/cli` / `src/<services>` / `src/adapter` split.
2. Implement the envelope + exit-code map first (it's the contract every command depends on), with `evidence` + `next_action`.
3. Make `help` and `doctor` the two *real* commands; every other slot returns `unconfigured` with a `next_action` and a non-zero exit (per CD-02).
4. Adapters for fs, process, git, http/server, telemetry, clock, env — each with a fake; services take them by injection.
5. Copy minih's biome/release-please/CI configs; **add** coverage and the `unconfigured` exit behaviour.
6. Keep the command registry explicit so the future extension loader has a seam (CD-04).

**Avoid**: putting any harness logic in command handlers; faking success for unconfigured slots; copying minih's `fft` recipe name semantics; building the extension loader now.

---

## External Research Opportunities

None blocking. Everything needed is in the two reference repos + this repo's first-principles. (Optional: confirm `release-please` node-package best practices for a CLI that lives in a subdirectory of a non-JS repo root — but minih's single-package config is a sufficient model.)

---

## Next Steps

- **Recommended**: `/plan-1b-v3-specify-and-clarify` to turn this into a spec — it will front-load the host-independent decisions in Open Questions (language, justfile placement, npx package name, CI scope, versioning).
- Optional before spec: a `/plan-2c` workshop on the **envelope + exit-code contract** (CD-01/CD-02) if you want it pinned before architecting.

---

**Research Complete**: 2026-06-08T06:55:00+10:00
**Report Location**: docs/plans/004-harness-core/research-dossier.md
