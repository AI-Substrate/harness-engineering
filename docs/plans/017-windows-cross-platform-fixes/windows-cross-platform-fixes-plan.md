# Windows Cross-Platform Fixes Implementation Plan

**Mode**: Simple
**Plan Version**: 1.1.0
**Created**: 2026-06-10
**Spec**: [windows-cross-platform-fixes-spec.md](./windows-cross-platform-fixes-spec.md)
**Backpressure**: [backpressure-coverage.md](./backpressure-coverage.md) — Certainty: **Partial**; its Recommended Phase 0 is folded in as the leading sensor tasks (T001–T003, T008) rather than a separate phase
**Status**: READY (validate-v2 pass 2026-06-10, 3 agents — fixes applied, see § Validation)

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers; the one open question (CI matrix shape) resolved by user decision 2026-06-10 (no Windows executor) |
| G2 | Constitution | PASS | No violations: helper is a pure `services/shared` module (P2); fakes only, no `vi.mock`/monkey-patching — platform handling via explicit parameter, not patched globals (P3); stdout-is-data discipline (P4); no private content (P12). No Deviation Ledger needed |
| G3 | Architecture | PASS | `services/shared/posix-path.ts` verified against all 7 dependency-cruiser rules (services→services allowed); `node:path` is not a banned side-effect import; no new ports/adapters; output kernel untouched |
| G4 | ADR Compliance | N/A | No `docs/adr/` directory |
| G5 | Structure | PASS | All required sections present; cross-references resolve |
| G6 | Testing Alignment | PASS | Hybrid per spec: helper tests (T001) precede helper implementation (T002); every touched area carries a validation task; ACs are measurable |
| G7 | Domain Completeness | PASS | No `docs/domains/` registry (constitution §5: domain governance not yet initialized — path-areas are the enforced boundaries); every spec area appears in Target Domains; Domain Manifest covers every file in the task table |

## Summary

The harness CLI runs correctly on Windows but 40 of 277 tests fail there — all path-separator or Unix-shell assumptions, none logic defects (per the external dossier, re-verified on this branch). This plan adopts the convention **"logical paths are POSIX on every OS"**: a shared pure helper (`toPosix` + POSIX-space join/within/dedupe) applied at the `cwd()`/`entryPath` boundaries of the five affected services, separator-tolerant test fakes, and a **Windows-shaped-input test set that runs on ubuntu** — the deterministic sensor that replaces the ruled-out Windows CI leg. It also repairs the `package-smoke` CI job (red on all recent runs: lifecycle stdout poisons the tarball capture, and the E143 greps are unsatisfiable because the flat fixture is never created) and adds `.gitattributes` checkout hygiene.

## Target Domains

*(No `docs/domains/` registry — areas named by path, mirroring the spec.)*

| Area | Status | Relationship | Role |
|------|--------|-------------|------|
| `harness/cli` (services + adapters + tests) | existing | **modify** | POSIX logical paths in discovery/record/scaffold/doctor/instructions; separator-tolerant FakeFs; path-safe assertions; shell-free EPIPE test; the Windows-shape sensor test set |
| `scripts/gen-docs.mjs` | existing | **modify** | stderr logging (load-bearing for package-smoke — see Finding 01); cross-platform biome invocation |
| `.github/workflows/ci.yml` | existing | **modify** | package-smoke repair only (deterministic TARBALL capture + flat fixture); **no new jobs** (no Windows executor, user decision) |
| `.gitattributes` | **NEW** | **create** | `eol=lf` checkout hygiene for the manual re-port flow (zero-churn verified) |

## Domain Manifest

| File | Area | Classification | Rationale |
|------|------|---------------|-----------|
| `harness/cli/src/services/shared/posix-path.ts` (NEW) | harness-cli | internal | The enforcement point: pure POSIX path helper (precedent: `services/shared/temp.ts`) |
| `harness/cli/src/services/extensions/discovery.ts` | harness-cli | internal | Cat A: joins, `isWithin` :121-124, `dedupeByAbsolutePath` :127-138 |
| `harness/cli/src/services/record/record-service.ts` | harness-cli | internal | Cat A: `relPath` in message :179 / envelope :184 |
| `harness/cli/src/services/scaffold/scaffold-service.ts` | harness-cli | internal | Cat A: `relPath`/`relInstructions` surfaced :124 |
| `harness/cli/src/services/doctor/doctor-service.ts` | harness-cli | internal | Cat A (validation-found): `entryPath` math :121-128, :291 |
| `harness/cli/src/services/instructions/instructions-service.ts` | harness-cli | internal | Cat A (validation-found): `join(dirname(entryPath))` :36 as `fs.exists` key |
| `harness/cli/src/adapters/fs/fake-fs.ts` | harness-cli | internal (test double) | Cat B: `mkdirp` :51-53 and `readdir` :41 split on `'/'` only |
| `harness/cli/test/services/shared/posix-path.test.ts` (NEW) | harness-cli | internal (test) | Phase-0 sensor: pure helper tests with Windows-shaped string inputs |
| `harness/cli/test/services/windows-shape.test.ts` (NEW) | harness-cli | internal (test) | Phase-0 sensor: the AC-8 Windows-shaped cwd fixture set (replaces the CI leg) |
| `harness/cli/test/integration/extensions.test.ts` | harness-cli | internal (test) | Cat C: `:91` two-segment re-split, `:235` `split('/').pop()` |
| `harness/cli/test/integration/docs.test.ts` | harness-cli | internal (test) | Cat D: bash+head EPIPE test :43-53; `execFileSync('npm', …)` guard :24 |
| `scripts/gen-docs.mjs` | repo-substrate | internal | Cat E + stdout pollution: biome invocation :69-71, `console.log` :76 |
| `.github/workflows/ci.yml` | repo-substrate | internal | package-smoke: TARBALL :125, fixtures :137-161, greps :166-178 |
| `.gitattributes` (NEW) | repo-substrate | internal | `eol=lf` normalization |
| `docs/project-rules/idioms.md` | repo-substrate | internal (docs) | "Logical paths are POSIX" idiom (Documentation Strategy) |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | **`npm pack --json` is NOT immune to lifecycle stdout** — empirically verified against this repo (npm 11.10.0): the gen-docs `console.log` line interleaves into the `--json` stream. The spec's AC-9 rationale ("structurally immune") is inverted: the **stderr move is the load-bearing fix**; `--json` + a mechanical `*.tgz` assert is the *loud deterministic guard* (a parse/assert failure instead of silent corruption) | T010 (stderr move) is a hard prerequisite of T011; T011 keeps `--json` + `jq` + `[[ "$TARBALL" == *.tgz ]]` so any future stdout leak fails loudly, never silently |
| 02 | Critical | **E143 fixture shape confirmed**: a flat code file directly under `.harness/extensions/` (matching `CODE_FILE` `/\.(ts\|tsx\|mjs\|cjs\|js)$/`, `discovery.ts:66-71`) yields rejection reason `unsupported flat layout — move to <name>/extension.ts`; the verb never registers, so `harness legacy` is genuinely unknown | T011 creates `.harness/extensions/legacy.ts` (flat file) in the smoke dir before the doctor greps (`ci.yml:166-178`) |
| 03 | High | **`posix.resolve()` hazard**: drive-letter paths (`C:/repo`) don't start with `/`, so `posix.resolve` would treat them as *relative* and prepend the host cwd — silently corrupting keys | The helper exposes `normalize`/`join`-based forms only; `isWithin` and `dedupeByAbsolutePath` switch from native `resolve()` to `posix.normalize(toPosix(p))`; helper docstring forbids `posix.resolve` on logical paths |
| 04 | High | **Platform seam without mocking**: `ProcessPort` has no `platform()`, and Constitution P3 bans monkey-patching globals in tests | Dedupe case-folding is an explicit parameter — `dedupeKey(p, caseInsensitive = IS_WIN32)` with `IS_WIN32` a module-level constant; tests pass the parameter explicitly (deterministic on any host, no patched `process.platform`) |
| 05 | High | **Cross-platform biome target is the package bin script**, `node_modules/@biomejs/biome/bin/biome` (Node shebang script) — NOT `node_modules/.bin/biome` (a sh shim on Windows). Invoking via `process.execPath` is portable; output is byte-identical, so `check:docs` is unaffected | T010: `execFileSync(process.execPath, [biomeBinJs, 'format', '--write', outPath])` with an `existsSync` guard (missing biome warns, never breaks the build) |
| 06 | High | **Implementation surface confirmed cheap**: `FakeProcess` already takes `cwdPath` as its 2nd constructor arg (`'/repo'` default) — the Windows-shape sensor is pure fixture work; vitest has no coverage thresholds; `.gitattributes` causes zero churn (`git ls-files --eol` → all `i/lf`); no existing path-normalization helper anywhere (no reinvention risk) | T008 seeds `new FakeProcess({}, 'C:\\repo')`; T012 ships the broad `* text=auto eol=lf` form safely |

## Implementation

**Objective**: Make all CLI-surfaced logical paths POSIX on every OS, prove it with ubuntu-runnable Windows-shaped-input sensors, and turn `package-smoke` green — in one phase.

**Testing Approach**: Hybrid (per spec) — test-first for the helper (real branching logic: T001 RED → T002 GREEN); the existing 380-test suite is the regression net and must stay green throughout; new fixture-set tests are the deterministic Windows sensor; CI proves the packaging path.

### Tasks

| Status | ID | Task | Area | Path(s) | Done When | Notes |
|--------|-----|------|------|---------|-----------|-------|
| [x] | T000 | **Harness boot** — `/harness-1-boot` pre-flight (`just test` + `npx --no-install harness doctor --json`) | — | — | Suite green (~380 tests); doctor `ok` with `extensions: 3 loaded` | Harness loop — advisory, auto-fired by `/plan-6` |
| [x] | T001 | **Helper unit tests (RED)** — write `posix-path.test.ts` first: `toPosix` (backslash→`/`, drive-letter case `c:`→`C:`, UNC `\\server\share`→`//server/share` **preserved through helper ops** (empirically verified: Node's `posix.normalize` collapses a leading `//` to `/` — normalize-based helpers must guard/reattach the UNC root; unit-pinned), mixed separators), `isWithin` (POSIX-space, literal `'../'` check, traversal escapes, drive-letter inputs), `dedupeKey` (explicit `caseInsensitive` param both ways) | harness-cli | `harness/cli/test/services/shared/posix-path.test.ts` | Tests written and failing against the not-yet-existing module | AC-3; Phase-0 sensor 1; per Findings 03/04 |
| [x] | T002 | **Helper implementation (GREEN)** — `services/shared/posix-path.ts`: `toPosix()`, POSIX-space `join`/`dirname`/`relative` wrappers, `isWithin()`, `dedupeKey(p, caseInsensitive = IS_WIN32)`; built on `posix.normalize`/`posix.join` ONLY (never `posix.resolve` — Finding 03); docstring encodes the "logical paths are POSIX" convention, lists the allowed surface explicitly (`normalize`/`join`/`relative`/`dirname` in POSIX space; `resolve` forbidden), and documents the UNC leading-`//` guard | harness-cli | `harness/cli/src/services/shared/posix-path.ts` | T001 green; `npx --no-install harness arch-check --json` still `ok` | AC-2/AC-3 enforcement point |
| [x] | T003 | **FakeFs separator tolerance** — `mkdirp` (`:51-53`) splits on `/[\\/]/`; `readdir` child-name extraction (`:41`) handles both separators; unit tests for each site with `\`, `/`, and UNC-shaped (`//server/share/...`) inputs asserting equivalence | harness-cli | `harness/cli/src/adapters/fs/fake-fs.ts`, fake-fs tests | Both sites unit-tested; suite green | AC-4; Cat B |
| [x] | T004 | **discovery.ts → POSIX** — `toPosix(proc.cwd())` at the boundary; all joins via helper; `isWithin` → helper form (`posix.relative` + literal `'../'`); `dedupeByAbsolutePath` keyed by `posix.normalize(toPosix(p))` via `dedupeKey` | harness-cli | `harness/cli/src/services/extensions/discovery.ts` | Suite green; **read-verified**: no native `join`/`relative`/`resolve`/`sep` on surfaced-or-compared paths remains in the file | AC-1/2/3; Cat A; Finding 03. Discovery is the **single POSIX origin** — it emits POSIX `entryPath`/`folder`, so doctor/instructions receive POSIX downstream (no per-site re-normalization drift) |
| [x] | T005 | **record-service + scaffold-service → POSIX** — same boundary pattern; `relPath` in messages (`record-service.ts:179`) and envelopes (`:184`, `scaffold-service.ts:124`) built in POSIX space | harness-cli | `harness/cli/src/services/record/record-service.ts`, `harness/cli/src/services/scaffold/scaffold-service.ts` | Suite green; read-verified as T004; envelope shapes `.harness/records/<type>/<date>/...` and `.harness/extensions/...` literal forward-slash | AC-1/2; Cat A |
| [x] | T006 | **doctor-service + instructions-service → POSIX** — `entryPath` math (`doctor-service.ts:121-128,:291`; `instructions-service.ts:36`) via helper `dirname`/`relative`/`join`; folder `===` comparison in normalized POSIX space | harness-cli | `harness/cli/src/services/doctor/doctor-service.ts`, `harness/cli/src/services/instructions/instructions-service.ts` | Suite green; read-verified as T004; doctor `next_action` folder hints forward-slash; **both sides** of the `dirname(entryPath) === c.folder` comparison (`:291`) computed in POSIX space (no partial-conversion mismatch) | AC-1/2; validation-found scope |
| [x] | T007 | **Path-safe test assertions** — `extensions.test.ts:91` → two-segment form via `posix.join(basename(dirname(p)), basename(p))` (NOT plain `basename`); `:235` → `basename(c.folder)`; sweep the suite for remaining raw `split('/')` on absolute paths | harness-cli | `harness/cli/test/integration/extensions.test.ts` (+ sweep hits) | `grep -rn "split('/')" harness/cli/test/` shows no absolute-path re-splits; suite green | AC-5; Cat C |
| [x] | T008 | **Windows-shape sensor (the CI-leg replacement)** — dedicated fixture set: `new FakeProcess({}, 'C:\\repo')` (+ a mixed-separator variant) through discovery, record, scaffold, doctor, instructions; FakeFs seeded with the **post-`toPosix` keys** (e.g. `new FakeFs({}, { 'C:/repo/.harness/extensions': ['hello'] })`); assert every surfaced envelope path/message is clean POSIX (no `\`), literal `.harness/...` shapes — covering discovery candidates/rejected paths, record `data.path` + message, scaffold `data.path`, doctor `next_action`, instructions resolution | harness-cli | `harness/cli/test/services/windows-shape.test.ts` | New tests pass on ubuntu; sensor proven once during development by temporarily reverting one `posix.join` to native `join` and confirming the tests fail (record the check in the execution log) | AC-1/2/8; Phase-0 sensor 2; Finding 06 |
| [x] | T009 | **Shell-free EPIPE test + Windows-safe npm guard** — rewrite `docs.test.ts:43-53` with Node primitives (spawn CLI, read first stdout line, `stdout.destroy()`, await close; assert first line delivered + stderr free of `EPIPE`/`Error:` — note the old test's `status === 0` asserted *head's* pipeline status, not the CLI's, so the rewrite asserts the CLI's actual documented behaviour under a destroyed pipe rather than a blanket exit-0); replace `:24` `execFileSync('npm', …)` with a Windows-safe form (`npm.cmd` + `shell:true` on win32, or `process.execPath` + npm-cli.js) — **not** skipped on any OS | harness-cli | `harness/cli/test/integration/docs.test.ts` | Rewritten test green on ubuntu; no `bash`/`head` anywhere in the file | AC-6; Cat D |
| [x] | T010 | **gen-docs hygiene** — `:76` `console.log` → `console.error` (stdout is data); biome invoked as `execFileSync(process.execPath, ['node_modules/@biomejs/biome/bin/biome', 'format', '--write', outPath])` with `existsSync` guard (missing/failing biome warns to stderr, never breaks the build) | repo-substrate | `scripts/gen-docs.mjs` | `npm run build` emits nothing on stdout; `npm run check:docs` green (docs-content.ts byte-identical) | AC-7; Cat E; Findings 01/05. **Prerequisite of T011** |
| [x] | T011 | **package-smoke repair** — `TARBALL="$(npm pack --json \| jq -r '.[0].filename')"`; mechanical guard `[[ "$TARBALL" == *.tgz ]] \|\| exit 1`; create the flat `.harness/extensions/legacy.ts` fixture **after the hello/boom fixtures and before the doctor invocation** (between `ci.yml:161` and `:167`) so `E143`/`unsupported flat layout` (`ci.yml:169-170`) and the `harness legacy` unknown-command check (`:172-178`) exercise what they claim | repo-substrate | `.github/workflows/ci.yml` | package-smoke job green on the PR | AC-9; Findings 01/02 |
| [ ] | T012 | **`.gitattributes`** — `* text=auto eol=lf` (zero-churn verified: all tracked files already `i/lf`) | repo-substrate | `.gitattributes` | File committed; `git status` clean immediately after (no renormalization diff) | Risk: autocrlf at re-port; Finding 06 |
| [ ] | T013 | **Encode the convention** — `idioms.md` gains a short "Logical paths are POSIX" idiom (logical vs physical paths; stdout is data, logs to stderr) cross-referencing the helper docstring | repo-substrate | `docs/project-rules/idioms.md` | Idiom present; matches helper docstring | Documentation Strategy |
| [ ] | T014 | **Full verification** — `just fft` green; `arch-check` `ok`; push branch; confirm CI: build-test (Node 22 + 24) green AND package-smoke green | both | — | All listed signals green on the PR run | AC-10 + AC-9 final evidence |
| [ ] | T015 | **Harness retro** — `/harness-4-retro --drain` the session buffer | — | — | Friction notes drained at the phase seam (`[s/t/p/e/d/a]`) | Harness loop — advisory |

> **Residual (not a task here)**: the one-off manual on-Windows re-verification of the dossier's 9-file inventory (`verify-port.ps1` flow: pull → `npm ci` → `npm test`) happens at the **next re-port** on the user's machine and is recorded in the execution log then — explicitly human-tier, explicitly accepted (spec AC-8, user decision 2026-06-10).

### Acceptance Criteria

- [ ] **AC-1 POSIX envelopes**: no `\` in any surfaced path on any OS; literal shapes `.harness/extensions/...` and `.harness/records/<type>/<date>/...` unit-asserted (T004–T006, T008)
- [ ] **AC-2 One construction pattern**: discovery, record, scaffold, doctor, instructions all build/derive logical paths via the shared helper; read-verified — no native `join`/`dirname`/`relative` on surfaced-or-compared paths in those five files (T002, T004–T006)
- [ ] **AC-3 Traversal guard + dedupe in POSIX space**: `isWithin` via `posix.relative` + literal `'../'`; `toPosix` drive-letter case normalization; dedupe keys POSIX-normalized, case-folded via explicit parameter — unit-tested with mixed-separator, mixed-case, UNC, and `../`-escape inputs (T001/T002)
- [ ] **AC-4 FakeFs separator-tolerant**: `mkdirp` and `readdir` child-name extraction handle `\` and `/` equivalently, each unit-tested (T003)
- [ ] **AC-5 Path-safe assertions**: two-segment form at `extensions.test.ts:91`, `basename` at `:235`; no raw `split('/')` on absolute paths in the suite (T007)
- [ ] **AC-6 Shell-free EPIPE test**: Node-primitive rewrite proves first-line delivery + no EPIPE stack trace; `npm` build guard Windows-safe, not skipped (T009)
- [ ] **AC-7 gen-docs hygiene**: progress output to stderr; cross-platform biome invocation, guarded (T010)
- [ ] **AC-8 Windows-shape proof on ubuntu**: the `FakeProcess.cwd() = 'C:\repo'` fixture set passes on ubuntu and deterministically catches native-join regressions; manual re-port residual explicitly accepted (T008)
- [ ] **AC-9 package-smoke green**: deterministic tarball capture (`--json` + `jq` + `*.tgz` assert, with the stderr move as the load-bearing decontamination) AND the flat `legacy.ts` fixture restored (T010, T011, T014)
- [ ] **AC-10 No Linux regression**: full suite green on Node 22/24; `arch-check` still `ok` (T014)

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Drive-letter case mismatch (`c:/` vs `C:/`) silently drops/duplicates dedupe entries | Medium | High | `toPosix` upper-cases the drive letter; `dedupeKey` case-fold via explicit param; mixed-case unit tests (T001) |
| **No Windows executor → a Windows-only regression can ship silently again** | Medium | Medium | Accepted by user decision. Narrowed by construction: POSIX convention is platform-invariant; T008 catches convention regressions on ubuntu; backstop = manual re-port |
| `posix.resolve` slips into the helper or a service and corrupts drive-letter paths | Low | High | Finding 03: helper exposes normalize/join forms only; docstring forbids it; T001 drive-letter tests would fail on host-cwd prepending |
| `npm pack` lifecycle stdout leaks from a future source | Medium (verified mechanism) | Medium | T011's `jq` parse + `*.tgz` assert fail **loudly**; stderr-only discipline encoded in idioms (T013) |
| `jiti` loading `.ts` from forward-slash drive-letter paths on real Windows | Low | High | Not CI-provable by decision — confirmed at manual re-port; fallback documented in spec (`pathToFileURL().href`) |
| Biome invocation change alters `docs-content.ts` bytes → `check:docs` red | Low | Medium | Same biome binary, same `format --write` — byte-identical (Finding 05); T010 done-when includes `check:docs` green |
| autocrlf poisons Windows checkouts at re-port | Medium | Low | T012 `.gitattributes eol=lf` (zero churn verified) |

## Agent Harness Strategy

- **Current Maturity**: L3 (improvement loop active)
- **Target Maturity**: L3 (unchanged — this plan adds sensors, not harness capability)
- **Boot Command**: `just test` (full suite, ~5s warm)
- **Health Check**: `npx --no-install harness doctor --json` (`status: ok`, `extensions: 3 loaded`)
- **Interaction Model**: Terminal — `npx --no-install harness <verb> --json` (stable envelope contract)
- **Evidence Capture**: JSON envelopes + `evidence[]`; vitest coverage output; CI logs
- **Pre-Phase Validation**: T000 (Boot → Interact → Observe); `/plan-6` auto-fires it

## Harness Loop

- **Backpressure Check** (`/harness-2-backpressure`, alias `/plan-2d`): ran before this plan — see [`backpressure-coverage.md`](./backpressure-coverage.md) (Certainty: **Partial**). Recommended Phase 0 folded in? **Yes** — as leading tasks T001–T003 + T008 (pure helper tests, Windows-shaped cwd fixtures, package-smoke repair T010/T011, `.gitattributes` T012), not a separate phase (Simple mode, single phase).
- **Boot** (`/harness-1-boot`): T000 pre-flight; `/plan-6` auto-fires it. `UNAVAILABLE` is not an error — falls back to standard testing.
- **Observe** (`harness-3-observe`): silent friction capture throughout; no action required.
- **Retro** (`/harness-4-retro --drain`): T015 at the phase seam; `--harvest` at plan completion.
- **Best-effort**: every item above is advisory and never blocks. Sentinel: if `docs/harness/.disabled` appears, this section is omitted and the flow uses the plan's standard testing approach.

## Validation

**validate-v2 pass, 2026-06-10 (3 agents: evidence-grounding / contract-testability / adversarial-risk): READY confirmed, fixes applied.**

- **Evidence-grounding**: all 22 factual claims (file:line refs, FakeProcess signature, vitest config, biome bin shebang, zero-churn `.gitattributes`, depcruise compatibility, `posix` behaviour on drive-letter paths) verified against the repo — no corrections. One empirical pin: **Node's `posix.normalize` collapses a leading `//`** (`//server/share` → `/server/share`), so the UNC expectation in T001/T002 was rewritten to require a guard/reattach of the UNC root in normalize-based helper ops.
- **Contract-testability**: AC→task trace complete (all 10 ACs map to tasks with measurable done-whens). Sharpened on findings: T008 now prescribes the exact FakeFs seeding form (post-`toPosix` keys) + an explicit revert-the-join sensor proof recorded in the execution log; T009 clarifies the exit-status nuance (the old test asserted *head's* status, not the CLI's); T011 pins the fixture-creation position in the CI script.
- **Adversarial-risk**: confirmed the npm-pack contamination mechanism live (`npm pack --json | jq` parse error today — T010 is a hard prerequisite of T011, and `jq` + the `*.tgz` assert fail loudly if the stderr discipline ever regresses); flagged the doctor `:291` partial-normalization hazard → T004/T006 now state discovery is the single POSIX origin and both comparison sides are computed in POSIX space; FakeFs UNC input added to T003.
- **No scope changes**: tasks, areas, and ACs unchanged — all fixes are precision tightening. Plan version 1.0.0 → 1.1.0.
