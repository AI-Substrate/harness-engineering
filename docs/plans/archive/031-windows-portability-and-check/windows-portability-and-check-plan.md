# Windows Portability for the Dogfood Verbs + a Deterministic `windows-check` Extension
**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-19
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

### Research Context
📚 Incorporates findings from [research-dossier.md](./research-dossier.md) (18 findings + 2 Perplexity deep-research reports). Headlines: the two dogfood verbs are POSIX-only and non-functional on Windows; the only capability the verb contract genuinely lacks is a **detached/background spawn** (`ctx.exec` blocks, no `detached`); blocking `ctx.exec('minih'|'git')` is *already* Windows-safe via the core `.cmd` adapter; and deep research resolved the design toward **Option B — fill the gap in the core contract** (fakeable ports) rather than a `node:*` sidecar.

### Summary
Make the `validate-harness-flow` and `validate-harnessability` dogfood verbs run cross-platform by adding the **missing portable primitives to the verb contract** (write/mkdir/copy, realpath, a fakeable sleep, and a detached background-spawn port) — keeping `node:*` confined to adapters — then porting both verbs onto them while preserving the CWE-59 confine guard, `--global`, and injection-safety. Separately, add a repo-local **`windows-check`** lint verb that catches the Windows-compat anti-pattern classes deterministically on ubuntu (warn-launch), so the harness proves Windows compatibility **by construction, with no Windows CI** — continuing plan 017's posture.

### Goals
- Both dogfood verbs run on Windows, macOS and Linux with **no `bash`/coreutil shell-outs** and **no `/tmp`** assumptions.
- The detached `minih` worker launch works cross-platform and survives the parent exit; the CWE-59 guard holds **on Windows too** (no POSIX `realpath`).
- New capabilities live in the **core contract as fakeable ports** (no sidecar, no P2 deviation) and ship to consumers' extensions too.
- A `windows-check` verb statically flags Windows-compat hazards (warn-launch), wired into `just fft` + CI.
- Proof is by construction: pure-logic unit tests + Windows-shaped-input sensors on the existing ubuntu legs; no Windows runner.

### Non-Goals
- A Windows CI executor (ruled out by plan 017 / user decision — on-Windows confirmation is the downstream `verify-port.ps1` re-port).
- Porting PR #26 (`harness.python`) upstream — out of scope (separate net-new capability).
- A refactor of the existing core `windows-command.ts` — [workshop 001](workshops/001-windows-cmd-launch-escaping.md) confirms its `cmd.exe /d /s /c` + `windowsVerbatimArguments:true` is the **documented-correct** `.cmd` route (a bare `.cmd` spawn with `shell:false` **EINVALs** on Node ≥20.12.2), so T010 is a **regression test + comment only**, not a rewrite. The new detached adapter **reuses the same `resolveSpawn`**. Residual is bounded: injection-safety rests on the unit-tested `quoteCmdArg` + literal-`"` rejection (see § Risks).
- Changing verb *behaviour* or envelopes beyond the portability swaps.

### Target Domains
_No `docs/domains/` registry in this repo — areas named by path (per plan 017 convention)._

| Domain (path area) | Status | Relationship | Role in This Feature |
|--------------------|--------|--------------|----------------------|
| `harness/cli/src` — verb contract + exec/fs adapters | existing | **modify** | Add `FileSystemWritePort`, `BackgroundProcessPort`, `ctx.fs.realpath`, `ctx.clock.sleep`; implement Node adapters reusing `fs-port.ts` + `resolveSpawn` + `shared/posix-path.ts` |
| `.harness/extensions/validate-harness-flow` + `…/validate-harnessability` | existing | **modify** | Port both verbs onto the new ports; preserve CWE-59 guard / `--global` / injection-safety |
| `.harness/extensions/windows-check` | **NEW** | **create** | The deterministic Windows-compat lint verb (folder, not a registry domain) |
| `harness/cli/test` (Windows-shaped sensors) | existing | **modify** | Unit sensors for the new ports/adapter + a no-`node:*`-in-verbs guard |
| `justfile` + `.github/workflows/ci.yml` | existing | **modify** | Run `windows-check` in `fft` + a CI `::warning` step |

_No NEW registry domain is created — `windows-check` is an extension folder; the harness has no `docs/domains/` system, so NEW-domain setup tasks are N/A._

### Testing Strategy
- **Approach**: Lightweight (Simple-mode default) **with targeted unit tests where determinism matters** — the pure `windows-check` rules, the new port **fakes**, and Windows-shaped-input sensors are unit-tested; the existing vitest suite is the regression net.
- **Rationale**: the logic is pure string/decision space + fakeable side-effect ports → deterministic on ubuntu; runtime Windows behaviour is proven by construction + the downstream re-port.
- **Focus areas**: `windows-check` rule matches (hostile + safe fixtures); the `BackgroundProcessPort`/`FileSystemWritePort` fakes (assert *intent*: command/args/cwd/env, ops log); Windows-shaped inputs (backslash cwd, `.cmd` resolution, confine containment); a guard test that verbs import no `node:*`.
- **Excluded**: real detached-process execution in CI (manual POSIX dogfood + downstream `verify-port.ps1` only).

### Mock Usage
Avoid mocks — use the repo's existing in-memory **fakes** (`FakeFs`/`FakeExec`/`FakeProcess`) and new InMemory port fakes; real fixtures otherwise.

### Documentation Strategy
- **Location**: lean Hybrid — `windows-check/instructions.md` (required agent briefing), a short `docs/how/` note on the cross-platform verb capability + `windows-check`, and a `CHANGELOG.md` entry.
- **Rationale**: matches existing extension conventions (every extension ships `instructions.md`; how-to guides live in `docs/how/`).

### Complexity
- **Score**: CS-5 (epic) — a new fakeable contract surface + a security-sensitive detached-spawn adapter + two verb ports + a new lint verb + CI/just wiring.
- **Breakdown**: S=2, I=2, D=1, N=2, F=2, T=2 (sum 11 → CS-5; validation re-scored up from an initial CS-4).
- **Confidence**: 0.70
- **Assumptions**: the work is genuinely CS-5 / multi-phase, but the user **deliberately elected Simple mode** (one inline ordered task list rather than phase expansion) — honoured here. ⚠️ A **Full phase-split** (contract primitives → verb ports → windows-check/wiring) is **recommended and remains cheap to escalate to**; it is declined at user request, not by oversight.
- **Dependencies**: patched Node 22.x baseline; `minih` on PATH for the dogfood verbs (unchanged).
- **Risks**: see § Risks & Assumptions.
- **Phases**: 1 (Simple).

### Acceptance Criteria
- **AC-01**: Neither dogfood verb contains `ctx.exec('bash'|'sh'|<coreutil>)` or a `/tmp` literal (the new `windows-check` verb passes on them).
- **AC-02**: A worker launched via `ctx.background.spawnDetached(...)` keeps running after the parent verb returns on POSIX (manual dogfood: `minih` run continues; run-id captured), with stdout/stderr in a log file. The existing **run-id-capture timeout** path is preserved: when the post-fire poll can't observe a new run id, the verb still returns `degraded` with a `next_action` (unit-tested — T008).
- **AC-03**: The CWE-59 confine guard still **refuses** an out-of-tree symlinked artifact, implemented **without** a POSIX `realpath` shell-out. The resolve→contain→copy runs as **one** `ctx.fsWrite.copy(src, destDir, { confineRoot })` adapter call (realpath + `isWithin` + copy together) so there is neither a skip-all degrade nor a check-then-copy **TOCTOU** window; the planted-symlink test proves the refusal.
- **AC-04**: `harness windows-check --json` returns a valid envelope: clean tree → `ok`/exit 0; planted hazard fixture → `degraded`/exit 0 with the finding (warn-launch); no git → `unconfigured`/exit 2.
- **AC-05**: The new ports have InMemory fakes; verb + adapter unit tests run deterministically on ubuntu (no real process/fs/network).
- **AC-06**: `git clone` passes `-c core.longpaths=true`; `repoName` yields a clean basename from a backslash Windows path (Windows-shaped unit input).
- **AC-07**: `engines.node` pins a **patched 22.x** baseline; the detached launch **reuses `resolveSpawn`** and passes `windowsVerbatimArguments` through (true on the cmd.exe route) — **no path spawns a bare `.cmd` with `shell:false`** (it EINVALs on Node ≥20.12.2; workshop 001).
- **AC-08**: `windows-check` is wired into `just fft` and a CI step; `windows-check/instructions.md` exists (doctor reports no `EXTENSION_INSTRUCTIONS_MISSING`).

### Risks & Assumptions
| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Detached-spawn primitive is novel (the riskiest piece) | Med | High | Reuse `resolveSpawn`; absolute paths; `unref`+log-fds; pin patched Node; manual POSIX dogfood + downstream re-port; unit-test the fake |
| CWE-59 guard regresses to "skip-all" **or** opens a check-then-copy **TOCTOU** race while being made portable | Med | High | AC-03 planted-symlink test; do realpath + `isWithin` + copy as **one** `ctx.fsWrite.copy(..., {confineRoot})` adapter call (no separate check/copy, no silent-skip) |
| No Windows CI → runtime Windows bugs invisible upstream | High | Med | By-construction (pure logic + Windows-shaped fakes) + `verify-port.ps1` re-port; `windows-check` as a standing lint |
| Widening the verb contract surface | Med | Med | Keep additions minimal + **optional capabilities** (`fsWrite?`, `background?`); document + version the contract additively |
| **Residual hand-rolled cmd escaping** — `windows-command.ts` owns the `cmd.exe /c` arg-quoting; the documented `.cmd` route *requires* `windowsVerbatimArguments:true` (workshop 001 confirms a bare `.cmd` spawn EINVALs, so this is correct, not a smell) | Low | Med | Bounded: the new adapter **reuses the same resolver**; safety rests on the unit-tested `quoteCmdArg` + literal-`"` rejection + inert-metachar quoting. T010 adds a regression test pinning *why* verbatim is retained |
| Tightening `engines.node` to patched 22.x is **consumer-breaking** (excludes 22.0–pre-patch) | Med | Med | Ship as a release with a **CHANGELOG/release note**; add a runtime `process.versions.node` guard that emits a clear `next_action` on unsupported Node (T003); document the floor in the docs/how note |

### Open Questions
- **F19 — RESOLVED** by [`workshops/001-windows-cmd-launch-escaping.md`](workshops/001-windows-cmd-launch-escaping.md): a bare `.cmd` spawn with `shell:false` **EINVALs** on the patched-Node baseline (Node docs + CVE-2024-27980), so DR-1's "default escaping" premise was invalid. The detached adapter **reuses `resolveSpawn`** (`cmd.exe /d /s /c` + `windowsVerbatimArguments:true` — the documented route); the `node`+JS-entry bypass (workshop 001 Option B — **distinct** from the Design Fork's Option B) is a **deferred** optimisation (minih is global on PATH, not module-resolvable). T010 is now a regression test, not a rewrite.

### Workshop Opportunities
| Topic | Type | Status | Why Workshop | Outcome |
|-------|------|--------|--------------|---------|
| F19 — `.cmd` launch & escaping | Integration Pattern | ✅ **Done** → [`workshops/001-windows-cmd-launch-escaping.md`](workshops/001-windows-cmd-launch-escaping.md) | Security-relevant; settled the spawn contract for T002/T010 | Reuse `resolveSpawn` + keep verbatim (bare `.cmd` EINVALs); `node`+JS bypass deferred; T010 → regression test |
| Detached-spawn port shape | API Contract | Covered by workshop 001 §C2–C3 + DR-2 | New contract surface that ships to consumers | `spawnDetached` raw (DR-2); the fake asserts logical `{command,args,cwd,env,logPath}` |

### Clarifications
#### Session 2026-06-19
- **Workflow Mode**: **Simple** (user-selected, overriding the CS-4 Full recommendation — single inline task list).
- **Testing Strategy**: Lightweight (Simple default) + targeted unit tests for pure rules, port fakes, and Windows-shaped sensors.
- **Mock Usage**: Avoid mocks — repo fakes only.
- **Documentation Strategy**: lean Hybrid — `instructions.md` + a `docs/how/` note + `CHANGELOG`.

## Planning Seam
_Refinement opportunities — recorded as evidence; the flow surfaces and offers these, none gate:_
- Workshop Opportunities: **F19 — ✅ resolved** by workshop 001 (folded into this plan); detached-spawn port shape — covered by workshop 001 §C2–C3.

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings, the Design Fork resolution (Option B), and the Node baseline / F19 findings (DR-1's spawn-`.cmd`-direct claim **superseded** by workshop 001) |
| workshops/*.md | y | `001-windows-cmd-launch-escaping.md` — **rewrites AC-07 / T002 / T010**, resolves Risk-03 + Open-Q F19 |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round 1 answered; no critical `[NEEDS CLARIFICATION]` remain |
| G2 | Constitution | PASS | Option B keeps `node:*` in adapters (P2); reuses `FsPort`/`resolveSpawn`/`posix-path` (P8 wrap-don't-rebuild); `unconfigured`/`next_action` honoured (P5/P7). No HIGH violation → no Deviation Ledger needed |
| G3 | Architecture | PASS | Adds ports + adapters per hexagonal layering; dependencies point inward |
| G4 | ADR Compliance | N/A | `docs/adr/` is empty (no Accepted ADRs); F19 was settled by workshop 001, not an ADR |
| G5 | Structure | PASS | All required sections present |
| G6 | Testing Alignment | PASS | Lightweight + ≥1 validation task; ACs measurable; mock intent matches (fakes) |
| G7 | Domain Completeness | PASS | No registry (areas by path); Domain Manifest covers every file; NEW extension folder is not a registry domain (setup tasks N/A) |

### Summary
Add four small, fakeable primitives to the verb contract — write FS ops, `realpath`, a `clock.sleep`, and a detached `BackgroundProcessPort` — implemented in Node adapters that reuse the existing `FsPort`, `resolveSpawn`, and `posix-path` helpers. Port both dogfood verbs onto them (removing every POSIX-only shell-out while preserving the CWE-59 guard, `--global`, and injection-safety), add the `windows-check` lint verb with warn-launch + `just`/CI wiring, and prove it all on ubuntu with unit tests + Windows-shaped sensors. The detached launch **reuses `resolveSpawn`** (absolute paths + the documented `cmd.exe /d /s /c` route, `windowsVerbatimArguments` passed through) on a pinned patched-22.x baseline — never a bare `.cmd` spawn, which EINVALs on that baseline (workshop 001).

### Domain Manifest

| File | Domain (path area) | Classification | Rationale |
|------|--------------------|----------------|-----------|
| `harness/cli/src/services/extensions/contract.ts` | harness/cli | contract | Add `fsWrite?`/`background?`/`fs.realpath`/`clock.sleep` to `VerbContext` |
| `harness/cli/src/services/extensions/verb-context.ts` + `acts/verb.ts` + `app.ts` | harness/cli | internal | Wire the new optional ports (`fsWrite`/`background`) into the built `ctx` + `defaultDeps` |
| `harness/cli/src/adapters/fs/fs-port.ts` + `node-fs.ts` + `fake-fs.ts` | harness/cli | internal | Reuse `mkdirp`/`writeText`/`rename`; add `copy`/`realpath`/`mkdtemp` |
| `harness/cli/src/adapters/exec/{background-port,node-background,fake-background}.ts` *(new)* | harness/cli | internal | `BackgroundProcessPort` (port + Node adapter reusing `resolveSpawn` + fake) — detached, log-fds, `unref` (port/node/fake convention; `node-exec.ts` is **unchanged**) |
| `harness/cli/src/adapters/exec/windows-command.ts` | harness/cli | internal | `resolveSpawn` reused by the new adapter; T010 adds a regression test + a one-line comment (no behaviour change — workshop 001) |
| `harness/cli/src/adapters/clock/*` | harness/cli | internal | `clock.sleep(ms)` (fakeable) |
| `harness/cli/src/adapters/process/{process-port,node-process,fake-process}.ts` | harness/cli | internal | `nodeVersion()` — backs the doctor `node-runtime` floor guard (T003) |
| `harness/cli/src/services/doctor/doctor-service.ts` | harness/cli | internal | `node-runtime` layer: degrades on Node `<22` with an upgrade `next_action` (T003) |
| `.harness/extensions/validate-harness-flow/extension.ts` + `lib/worker-io.ts` | extensions | internal | Port onto new ports |
| `.harness/extensions/validate-harnessability/extension.ts` | extensions | internal | Port onto new ports |
| `.harness/extensions/windows-check/{extension.ts,lib/rules.ts,lib/rules.test.ts,instructions.md,fixtures/}` *(new)* | windows-check | contract+internal | The lint verb + pure rules + tests + briefing |
| `harness/cli/test/services/windows-shape.test.ts` (+ new) | harness/cli/test | internal | Sensors for the new ports/adapter + no-`node:*`-in-verbs guard |
| `package.json` | repo root | internal | Tighten `engines.node` to patched 22.x |
| `justfile`, `.github/workflows/ci.yml` | wiring | cross-domain | Run `windows-check` in `fft` + CI |
| `docs/how/*.md`, `CHANGELOG.md` | docs | internal | Capability + verb docs |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | `ctx.exec` cannot detach (no `detached`, blocks to exit) — the one capability with no in-contract substitute (dossier F7) | Add `BackgroundProcessPort.spawnDetached` (T002) |
| 02 | High | CWE-59 confine guard uses POSIX `realpath` → silently skips every copy on Windows (dossier F8) | `ctx.fs.realpath` + POSIX `isWithin`; AC-03 planted-symlink test (T001/T004) |
| 03 | High | A bare `.cmd` spawn with `shell:false` **EINVALs** on patched Node (≥20.12.2); the injection-safe route is `cmd.exe /d /s /c` + `windowsVerbatimArguments` — workshop 001 (refutes DR-1 §4.4) | Detached adapter **reuses `resolveSpawn`** (that exact route); pin patched 22.x (T002/T003); T010 = regression test |
| 04 | High | Node baseline must be ≥ patched 22.x for safe `.cmd` spawn (DR-1 §6.1) | Tighten `engines` + runtime guard (T003) |
| 05 | Medium | Blocking `ctx.exec('minih'\|'git')` is already Windows-safe via `resolveSpawn` (dossier F8-OK) | Just swap the `bash`/coreutil calls, not the minih/git calls (T004/T005) |
| 06 | Medium | Reusable assets exist: `fs-port.ts` writes, `resolveSpawn`, `shared/posix-path.ts`, arch-check/markdown-lint scaffold (dossier F11–F15) | Reuse, don't rebuild (all tasks) |

### Implementation

**Objective**: Add the missing fakeable contract primitives, port both dogfood verbs cross-platform, and ship the `windows-check` lint verb — proven on ubuntu.
**Testing Approach**: Lightweight + targeted unit tests (pure rules, port fakes, Windows-shaped sensors); existing vitest suite as the regression net; `just fft` green throughout.

#### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|----|------|--------|---------|-----------|-------|
| [x] | T001 | Add `FileSystemWritePort` (`writeText`/`mkdirp`/`copy`/`rename`) + `fs.realpath` to the contract; expose `ctx.fsWrite?` + `ctx.fs.realpath`; Node adapter reuses `fs-port.ts`, adds `copy`/`realpath`; **`copy(src, destDir, { confineRoot? })` resolves realpath + `isWithin` + copies in one call** (no check-then-copy TOCTOU, no skip-all); InMemory fake records an ops log | harness/cli | `…/contract.ts`, `…/verb-context.ts`, `…/adapters/fs/fs-port.ts` | A verb writes/mkdir/copy/realpath via `ctx`; confined `copy` refuses an out-of-tree symlink in one op; fake asserts ops; unit tests green | Optional capability; least-privilege (DR-2) |
| [x] | T002 | Add `BackgroundProcessPort.spawnDetached({command,args,cwd,env,logPath}) → {pid}`; expose `ctx.background?`; Node adapter: `const spec = resolveSpawn(command,args,cwd)` then `spawn(spec.command, spec.args, {shell:false, detached:true, stdio:['ignore',logFd,logFd], windowsHide:true, windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false})`, `unref()`, return pid (throw if null); **never spawn a bare `.cmd`** (EINVAL ≥20.12.2 — workshop 001 I1/I2); `node`+JS-entry bypass is a **deferred** optimisation (workshop 001 Option B), not the contract; InMemory fake records `{command,args,cwd,env,logPath}`, returns synthetic pid | harness/cli | `…/adapters/exec/{background-port,node-background,fake-background}.ts` (new — **`node-exec.ts` unchanged**), `…/contract.ts`, `…/verb-context.ts`, `…/acts/verb.ts`, `…/app.ts` | Detached launch survives parent exit on POSIX (manual dogfood); an adapter **contract test** asserts the spawn spec (detached, stdio→log fds, `unref`, **verbatim passed through** from `resolveSpawn`, `cmd.exe`+absolute target for a `.cmd`) via the fake; unit tests green | Key Finding 01/03; the riskiest piece — workshop 001 §C2 |
| [x] | T003 | Add `ctx.clock.sleep(ms)` (fakeable); tighten `engines.node` to patched 22.x + a runtime `process.versions.node` guard surfaced via doctor/boot | harness/cli | `…/adapters/clock/*`, `…/adapters/process/*` (`nodeVersion()`), `…/services/doctor/doctor-service.ts` (`node-runtime` layer), `…/contract.ts`, `package.json`, `CHANGELOG.md` | Poll loops sleep via `ctx`; old-Node guard emits a clear `next_action`; the **consumer-breaking engines bump is called out in the CHANGELOG/release note**; tests green | Key Finding 04; DR-1 §6.1 |
| [x] | T004 | Port `validate-harness-flow`: minih precheck → `ctx.exec('minih',['--version'])`; tmp via `ctx.fsWrite` mkdtemp under `os.tmpdir()`; `git clone -c core.longpaths=true`; `repoName` split `/[/\\]/`; fire via `ctx.background.spawnDetached`; writes/mkdir/cp via `ctx.fsWrite`; sleeps via `ctx.clock.sleep`; CWE-59 guard via the **single** `ctx.fsWrite.copy(..., {confineRoot})` | extensions | `.harness/extensions/validate-harness-flow/extension.ts`, `lib/worker-io.ts` | Runs on macOS/Linux (real `minih` dogfood) with **no** bash/coreutil shell-outs; guard (single confine-copy) + `--global` + `--keep` + injection-safety + the **run-id-capture-timeout → `degraded`+`next_action`** path all preserved (AC-01/02/03/06) | dossier F1–F9 |
| [x] | T005 | Port `validate-harnessability` identically (same swaps; `--keep` preserved) | extensions | `.harness/extensions/validate-harnessability/extension.ts` | Same as T004 for the sibling verb | Near-identical breakage |
| [x] | T006 | Scaffold `windows-check` *(all new)*: thin `extension.ts` + pure `lib/rules.ts` (8 rules: shell-out/coreutil, `/tmp`, clone-longpaths, path-split, native `node:path`, extensionless-bin spawn, POSIX env, hygiene meta) + `lib/rules.test.ts` (hostile+safe fixtures) + `instructions.md`; enumerate via `git ls-files`, read via `ctx.fs`; warn-launch envelope (ok/degraded/unconfigured/error) like arch-check; `// win-ok:` suppression + allowlist | windows-check | `.harness/extensions/windows-check/**` *(new)* | `harness windows-check --json` returns a valid envelope; rules unit-tested green; deterministic on ubuntu (AC-04/05) | dossier § scaffold spec |
| [x] | T007 | Wire `windows-check` into `justfile` (recipe + `fft`) and `.github/workflows/ci.yml` (`::warning` step, mirror arch-check); invoke via `node harness/cli/bin/harness.js windows-check` (never `npx`, PL-1) | wiring | `justfile`, `.github/workflows/ci.yml` | `just fft` runs it; CI surfaces warnings at warn severity (AC-08) | PL-1/PL-2 |
| [x] | T008 | Windows-shaped sensors for the new ports/adapter (backslash cwd, `.cmd` resolution, confine containment) extending `windows-shape.test.ts`; the no-`node:*`-in-verbs guard; **assert both dogfood verb sources contain no `bash`/coreutil/`/tmp`** (direct AC-01 proof); **unit-test the run-id-capture-timeout → `degraded` branch** (AC-02) | harness/cli/test | `harness/cli/test/services/windows-shape.test.ts` (+ new) | Sensors catch a planted native-`join`/`node:*` regression; dogfood sources assert clean (AC-01); capture-timeout branch covered (AC-02); suite green on ubuntu (AC-05) | by-construction proof |
| [x] | T009 | Docs: `windows-check/instructions.md` (agent briefing), a `docs/how/` note on the cross-platform verb capability + `windows-check`, `CHANGELOG` entry | docs | `.harness/extensions/windows-check/instructions.md`, `docs/how/*.md`, `CHANGELOG.md` | `harness doctor` reports no `EXTENSION_INSTRUCTIONS_MISSING`; docs present (AC-08) | extension convention |
| [x] | T010 | **Regression test + comment** (workshop 001 withdrew the rewrite): add a `windows-command.test.ts` case asserting the `.cmd` route stays `cmd.exe` + `windowsVerbatimArguments:true` (dropping it corrupts `/s` quoting; a bare `.cmd` spawn EINVALs ≥20.12.2); add a one-line code comment pointing at workshop 001 | harness/cli | `harness/cli/test/adapters/exec/windows-command.test.ts`, `harness/cli/src/adapters/exec/windows-command.ts` (comment only) | New regression test green; exec suite green; **no behaviour change** | Was an optional simplification — now a documenting test (workshop 001 §C1) |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | T004, T005, T006, **T008** | `windows-check` passes on both verbs **and** a T008 source-assertion proves no `bash`/coreutil/`/tmp` directly |
| AC-02 | T002, T004, **T008** | manual POSIX dogfood (`minih` continues; run-id captured) + T008 unit test for the capture-timeout → `degraded` branch |
| AC-03 | T001, T004 | planted out-of-tree symlink test (single confine-copy refuses; no `realpath` shell-out, no TOCTOU) |
| AC-04 | T006 | `windows-check --json` unit/integration: clean/hazard/no-git envelopes |
| AC-05 | T001, T002, T008 | port fakes + adapter/verb unit tests deterministic on ubuntu |
| AC-06 | T004, T008 | Windows-shaped unit input (backslash path → basename; `core.longpaths` present) |
| AC-07 | T002, T003 | `engines` pinned; adapter reuses `resolveSpawn` + passes verbatim through; no bare `.cmd` spawn (contract test) |
| AC-08 | T007, T009 | `just fft` + CI step run `windows-check`; `instructions.md` present (doctor clean) |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Detached-spawn primitive novelty | Med | High | reuse `resolveSpawn`, absolute paths, log-fds + `unref`, patched-Node pin, manual dogfood + downstream re-port, fake unit test (T002) |
| CWE-59 guard regression (skip-all **or** check-then-copy TOCTOU) | Med | High | AC-03 planted-symlink test; **single** `ctx.fsWrite.copy(..., {confineRoot})` — resolve+contain+copy in one call (T001/T004) |
| No Windows CI | High | Med | by-construction sensors + `verify-port.ps1`; `windows-check` standing lint (T006/T008) |
| Contract-surface creep | Med | Med | minimal additions, optional capabilities, additive versioning (T001–T003) |
| Residual hand-rolled cmd escaping in `windows-command.ts` (F19 — resolved) | Low | Med | cmd.exe+verbatim is the documented route (bare `.cmd` EINVALs); new adapter reuses the same resolver; safety is the unit-tested `quoteCmdArg` + `"`-reject; T010 pins it with a regression test (workshop 001) |
| `engines.node` bump breaks consumers on pre-patch 22.x | Med | Med | CHANGELOG/release note + runtime Node guard with `next_action` (T003) |

---

## Validation Record (2026-06-19)

### Validation Thesis
**Raison d'être**: Re-add Windows portability to the two dogfood verbs (upstream handover request) while preserving the CWE-59 guard / `--global` / injection-safety, and decide+sequence the approach.
**Value claim**: dogfood self-tests run cross-platform; the harness gains fakeable cross-platform I/O primitives benefiting all consumers' extensions; a standing lint prevents Windows-compat regressions — proven with NO Windows CI.
**Artifact promise**: an implementer can build from the inline task table with minimal clarification, preserving the security/feature wins, landing `windows-check` wired into `fft`+CI.
**Intended beneficiaries**: the implement stage (next), the downstream fork re-port, consumers' extensions, future maintainers.
**Proof target**: Implementation.
**Evidence standard**: concrete files/paths, testable ACs, the design decision resolved (Option B), reuse of existing assets cited, AC↔task coverage.
**Thesis source**: `original-ask.md` + `research-dossier.md` (§ Deep Research) + the handover.
**Thesis verdict**: Advanced.
**Main thesis risk**: Low — the plan stays on Option B, preserves the security guard, and keeps `windows-check` as a supporting lint rather than the main deliverable.

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|----------------|-------------|--------|---------|
| Coherence/Completeness | System Behavior, Edge Cases, Domain Boundaries, Technical Constraints | Implementation Readiness | 1 HIGH, 2 MED, 2 LOW — fixed | ⚠️→✅ |
| Risk/Evidence/Security | Evidence Sufficiency, Proof-Level Fit, Security, Deployment/Ops, Hidden Assumptions | Safety to Change, Migration Safety | 2 HIGH, 2 MED — fixed | ⚠️→✅ |
| Thesis Alignment | Thesis Alignment | Value Preservation, Proof-Level Fit | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple | Downstream Usefulness, Contract Integrity | 0 | ✅ |

_Lens coverage: 11/15 (Thesis + Forward-Compatibility both engaged)._

### Forward-Compatibility Matrix
| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| IMPLEMENT stage | Unambiguous inline tasks with concrete paths + Done-Whens | Contract drift / encapsulation lockout | ✅ | T001–T010 with paths, signatures, Done-Whens; ACs mapped to tasks |
| New contract-port consumers (dogfood verbs + future extensions) | Port shapes specified well enough to code against | Shape mismatch / lifecycle ownership | ✅ | `FileSystemWritePort`, `BackgroundProcessPort.spawnDetached({command,args,cwd,env,logPath})→{pid}`, `ctx.fs.realpath`, `ctx.clock.sleep` all specified |
| Downstream fork re-port | Upstream-shaped core/contract change (Option B), no sidecar divergence | Encapsulation lockout / contract drift | ✅ | dossier resolves Option B; plan keeps `node:*` in adapters, ships ports in core |

**Thesis alignment**: Value claim advanced at the Implementation proof level with Strong evidence; main risk is Low (stays on Option B, preserves the guard).
**Outcome alignment**: "the dogfood self-test verbs must actually run on Windows, with Windows compatibility guarded going forward" — the plan as written advances it.
**Standalone?**: No — the implement stage and the downstream fork are concrete named consumers.

**Fixes applied this pass**: CS re-scored 4→5 (Simple mode honoured, Full split recommended); CWE-59 guard specified as a single `ctx.fsWrite.copy(...,{confineRoot})` closing the TOCTOU; BatBadBut residual in core `windows-command.ts` made an explicit tracked risk (not silently accepted); run-id-capture-timeout coverage added (T008/AC-02); detached-port contract test + node+JS-entry fallback specified (T002); consumer-breaking `engines` bump given a release-note + runtime guard (T003); Domain Manifest + NEW markers tidied.

Overall: ⚠️ VALIDATED WITH FIXES

---

## Post-Validation Amendment — F19 fold (2026-06-19)

After validation, **workshop [`001-windows-cmd-launch-escaping.md`](workshops/001-windows-cmd-launch-escaping.md)** resolved Open-Q **F19** and **corrected a factual error** the validation pass had carried forward from dossier DR-1.

**The correction (evidence: Node `child_process` docs + CVE-2024-27980; host Node v24.7.0):** DR-1's premise that `spawn('foo.cmd', args, {shell:false})` is "safe via default escaping" on patched Node is **false** — patched Node (≥20.12.2 / our `>=22` baseline) **throws `EINVAL`** for a bare `.cmd`/`.bat` with `shell:false`. The documented, injection-safe route is `cmd.exe /d /s /c "<line>"` + `windowsVerbatimArguments` — exactly what the existing, unit-tested `resolveSpawn` already does.

**Plan edits applied (surgical, per the workshop's Plan Impact table):**
- **AC-07 / T002**: detached adapter now **reuses `resolveSpawn`** and passes `windowsVerbatimArguments` through; **no path spawns a bare `.cmd`**. The prior "set no verbatim / bypass to node+JS" instruction (which would EINVAL) is removed; node+JS bypass is now a **deferred** optimisation.
- **T010**: the `windows-command.ts` rewrite is **withdrawn** → a regression test + one-line comment (no behaviour change).
- **Risk 03 / Residual** + **Key Finding 03**: re-scored Low/Med, reframed as bounded hand-rolled-escaping (tested `"`-reject), not an open BatBadBut surface.
- **G4, Summary, Domain Manifest, Planning Seam, Workshop Opportunities**: updated to cite workshop 001 as the resolution.

**Net effect**: correctness ↑ (removes a runtime-EINVAL trap before any code is written); no new risk introduced; the plan stays **Simple / READY**. No full re-validation run — the workshop is itself a grounded (Node-docs/CVE-verified) Contract-Ready artifact.

Overall after amendment: ⚠️ VALIDATED WITH FIXES (F19 corrected)
