# Harness Extension System Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-08
**Spec**: [harness-extension-system-spec.md](./harness-extension-system-spec.md)
**Workshop (authoritative)**: [workshops/001-extension-contract-and-loader.md](./workshops/001-extension-contract-and-loader.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No `[NEEDS CLARIFICATION]` markers remain; all Open Questions RESOLVED in WS-A. Micro-decisions (cwd injection, `run`-dispatcher fate, contract specifier) are resolved in this plan's § Plan Decisions, not left open. |
| G2 | Constitution | PASS | Plan *fulfils* P10 (removes hardcoded verbs, jiti → `dependencies`). No HIGH-impact violation → no Deviation Ledger needed. Stale doctrine wording (rules §4 "seed set") is synced by T025, not a violation. |
| G3 | Architecture | PASS | Loader/discovery are services; jiti + exec are adapters; ctx built at the act/composition root — dependencies point inward. Node-floor + extension-seam wording in `architecture.md` §4/§5/§8 are synced by T025. |
| G4 | ADR Compliance | N/A | No `docs/adr/` directory exists. |
| G5 | Structure | PASS | All required sections present + populated; single Implementation phase with a 7-column test-first task table; cross-refs (KF-01..07) resolve. |
| G6 | Testing Alignment | PASS | Spec = **Full TDD, fakes-only**. Every **logic** unit's test task precedes its impl task (T001→T012, T013→T014, T015→T016, T018, T019→T020, T021→T022, T026); per `rules.md` §6.1 TDD MAY be skipped for trivial wrappers/config — so the deletion (T017), packaging/CI (T023/T024), doctrine (T025), and docs (T027) tasks are validated by build + integration (T026) + `just fft` (T028), not a unit red task. ACs measurable; no `vi.mock`. |
| G7 | Domain Completeness | PASS | No domain registry (`docs/domains/` absent — Constitution §5 "not yet initialized"); `harness-cli-core` + `extension-loader` are **logical** groupings, so no `domain.md`/registry setup tasks apply. Domain Manifest covers every file named in the task table. |

## Summary

Turn the harness core from a stub front-door into an extensible one. In a developer's *own* repo, a repo-local **`.harness/extensions/`** folder is **discovered and loaded at runtime** by the npx-installed core; each extension's default export declares one or more **`HarnessVerb`s** that become `harness <verb>` commands with their own `--help`, options, structured **Envelope** output, and exit codes. The loader sits behind a `ModuleLoaderPort` (jiti for `.ts`/`.tsx`, plain `import()` for `.js`); verb handlers receive a `VerbContext` of injected ports (including a new `ExecPort` to wrap real repo commands, P8) and return a `VerbResult` the kernel finalizes. `help`/`doctor` go dynamic, the temporary `BUILTIN_SLOTS` (and the `run`/slot scaffolding) are removed (P10), and the Envelope/exit kernel is reused unchanged. Delivered as a single ordered, test-first Implementation phase.

## Plan Decisions (folding deferred WS-B / WS-C micro-decisions)

WS-A is authoritative for the six big decisions (loader=jiti+`.js`; declarative `HarnessVerb` default export; `ctx` ports + `ExecPort`; one-level `.harness/extensions/` discovery sorted/first-wins; trust-the-repo + `--no-extensions`; async `main`). This plan additionally settles four micro-decisions WS-A left to sequencing (WS-B) or scaffolding (WS-C), so the build is mechanical:

- **D1 — cwd injection**: add `cwd(): string` to the existing **`ProcessPort`** (`NodeProcess` → `process.cwd()`, `FakeProcess` → seeded). Minimal; no new port. (WS-A permitted `ProcessPort.cwd` *or* a `CwdPort`.)
- **D2 — `run` dispatcher + top-level slot stubs are removed**: verbs are **top-level commands** (`harness <verb>`), matching WS-A's worked examples (`harness hello`, `harness build` — no `run` prefix). `acts/run.ts`, `acts/unconfigured-slot.ts`, and `services/slots/slot-registry.ts` (`BUILTIN_SLOTS`/`builtinSlots`/`slotEnvelope`/`runSlot`) are deleted. Bare `harness` keeps the orientation envelope. (Folds the deferred WS-B sequencing call.)
  > **Supersession note (resolves a spec/plan drift)**: the spec's earlier wording "*help, doctor, and `run` become dynamic*" (Goals/AC-1, written pre-WS-A) is **superseded** — the dynamic surface is the set of **top-level verbs**, not a `run <verb>` namespace. WS-A's worked examples already use top-level verbs and never re-introduce `run`, so a separate `run` dispatcher would be redundant scaffolding. The spec is annotated with this resolution. *(If a `run`/`exec`-style passthrough is later wanted, an extension can simply declare a `run` verb — it's no longer a core concern.)*
- **D3 — the open registry survives as the verb registry**: `services/extensions/registry.ts` builds `{name: string}` verb records (no closed union); `validateCommandMap` is repurposed as `validateVerbRegistry` (open key, dedup, required fields) so AC-7's "malformed entries still guarded" holds.
- **D4 — public contract specifier**: authors import types from **`harness-engineering/contract`** (the real package name), enabled by a new `exports["./contract"]` subpath in `package.json`. The WS-A example's `'harness/contract'` is illustrative; the shipped guide/example use the resolvable specifier. Because authors import **types only** (erased at runtime), even plain `.js` extensions reference them via JSDoc with no runtime dependency. (Folds a WS-C ergonomics detail.)

## Target Domains

> No domain registry exists (`docs/domains/` absent; Constitution §5 "Domain system not yet initialized"). The rows below are **logical** groupings inside the single `harness/cli/` package, expressed via the hexagonal **act → service → adapter** layering — not registry entries. No `domain.md`/registry/domain-map tasks apply.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli-core | existing (logical) | **modify** | Async `main` + composition root register one command per discovered verb; dynamic `help`/`doctor`; new `ExecPort`; `FsPort.readdir` + `ProcessPort.cwd`; new error codes; remove `BUILTIN_SLOTS`/`run`/slot scaffolding; Envelope/exit kernel unchanged. |
| extension-loader | **NEW** (logical) | **create** | Discovery service (scan `.harness/extensions/`), `ModuleLoaderPort` + jiti adapter, the public **verb contract**, the verb-context builder/finalizer, and the open registry the core dispatches from. |
| doctrine | existing | **modify** | Sync `rules.md` §4, `architecture.md` §4/§5/§8, and `idioms.md` (if it references slots) to match Constitution P10 v1.1.0 + the Node-22 floor. |

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/services/extensions/contract.ts` | extension-loader | **contract** | Public types authors import (`HarnessVerb`, `VerbContext`, `VerbResult`, `VerbOption`, `VerbArg`, `ExecResult`, `Evidence`, `ExtensionExport`, `ExtensionRecord`). |
| `harness/cli/src/services/extensions/discovery.ts` | extension-loader | internal | Scan `<cwd>/.harness/extensions/` one level; resolve files/subdir-index/manifest; sort; dedup by abs path. |
| `harness/cli/src/services/extensions/registry.ts` | extension-loader | internal | Build verb registry from load records; reserve core names; detect conflicts; `validateVerbRegistry`. |
| `harness/cli/src/services/extensions/verb-context.ts` | extension-loader | internal | Build `VerbContext` from ports + envelope helpers; finalize `VerbResult` → `Envelope`; isolate handler throws (E141). |
| `harness/cli/src/adapters/loader/module-loader-port.ts` | extension-loader | contract | `ModuleLoaderPort` interface (load by abs path → default export). |
| `harness/cli/src/adapters/loader/jiti-loader.ts` | extension-loader | internal | jiti adapter for `.ts`/`.tsx`; plain `import()` for `.js`/`.mjs`/`.cjs`. Only place `jiti` is touched. |
| `harness/cli/src/adapters/loader/fake-loader.ts` | extension-loader | internal | `FakeModuleLoader` (scripted exports/errors by path). |
| `harness/cli/src/adapters/exec/exec-port.ts` | harness-cli-core | contract | `ExecPort` interface (run a real command — the P8 capability). |
| `harness/cli/src/adapters/exec/node-exec.ts` | harness-cli-core | internal | `NodeExec` via `child_process.spawn` (no shell; args array). Only place a child is spawned for verbs. |
| `harness/cli/src/adapters/exec/fake-exec.ts` | harness-cli-core | internal | `FakeExec` (scripted `ExecResult` keyed by command). |
| `harness/cli/src/adapters/fs/{fs-port,node-fs,fake-fs}.ts` | harness-cli-core | internal | Add `readdir` to `FsPort` + both impls. |
| `harness/cli/src/adapters/process/{process-port,node-process,fake-process}.ts` | harness-cli-core | internal | Add `cwd()` to `ProcessPort` + both impls (D1). |
| `harness/cli/src/acts/verb.ts` | harness-cli-core | internal | `registerVerbAct` — one commander subcommand per verb; builds ctx; finalizes; exits via kernel. |
| `harness/cli/src/app.ts` | harness-cli-core | internal | Async `main`; discover+load before `parseAsync`; `--no-extensions`/`HARNESS_NO_EXTENSIONS`; register core + verbs; remove `builtinSlots` loop. |
| `harness/cli/src/index.ts` | harness-cli-core | internal | `main().catch(...)` so the async bin never floats an unhandled rejection. |
| `harness/cli/src/output/error-codes.ts` | harness-cli-core | internal | Add `E140`/`E141`/`E142`. |
| `harness/cli/src/services/help/help-service.ts` | harness-cli-core | internal | Extension-aware help; lists discovered verbs; honest empty state. |
| `harness/cli/src/services/doctor/doctor-service.ts` | harness-cli-core | internal | Enumerate extensions (loaded/failed/conflict + path + error + next_action) without invoking handlers. |
| `harness/cli/src/services/config/load-config.ts` | harness-cli-core | internal | Repurpose `validateCommandMap` → `validateVerbRegistry` (open key, dedup, required fields). |
| `harness/cli/src/acts/run.ts` · `acts/unconfigured-slot.ts` · `services/slots/slot-registry.ts` | harness-cli-core | internal (**removed**) | Scaffolding deleted (D2); consumers migrated to the verb registry. |
| `package.json` | harness-cli-core | cross-domain (packaging) | `engines.node >=22`; `jiti` → `dependencies`; add `exports["./contract"]`. |
| `.github/workflows/ci.yml` | harness-cli-core | cross-domain (packaging) | Matrix `['22']` (+ optional `'24'`); package-smoke on Node 22 + a fixture-extension assertion (AC-8). |
| `docs/project-rules/{rules.md,architecture.md,idioms.md}` | doctrine | docs | Sync to P10 v1.1.0 + Node-22 (T025). |
| `harness/cli/README.md` · `harness/cli/docs/authoring-verbs.md` · `harness/cli/examples/extensions/{hello,build}.ts` | harness-cli-core | docs | Quick-start + authoring guide + copyable example (AC-11). |
| `harness/cli/test/**` (adapters/exec, adapters/loader, services/extensions, acts/verb, integration/extensions + updated fs/help/doctor/app/cli-commands; fixtures under `test/integration/fixtures/extensions/`) | both | test | Fakes-first unit tests + on-disk fixture integration (AC-9). |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| KF-01 | Critical | **Doctrine drift.** `rules.md` §4 still says "the built-in slots are a **seed set**"; `architecture.md` §5 describes the extension seam as "future-facing, not built today" with `BUILTIN_SLOTS` present, and §4/§8 pin **Node ≥20**. Removing the slots + bumping to Node 22 contradicts these unless synced (Constitution governance: update rules/idioms/architecture together). | **T025** syncs all three to Constitution P10 v1.1.0 + the Node-22 floor. |
| KF-02 | High | **Public contract specifier won't resolve.** WS-A's example imports `'harness/contract'`, but the package is named `harness-engineering` and has **no `exports` map** — a consumer's `.ts` extension couldn't resolve it. | **T023** adds `exports["./contract"]`; guide/example (T027) use `harness-engineering/contract`; authors import **types only** (erased) so `.js` authors need no runtime dep (D4). |
| KF-03 | High | **Scaffolding removal ripples wider than the services.** Beyond `help-service`/`doctor-service`/`load-config`, the **composition root `app.ts`** imports `builtinSlots` + `validateCommandMap`, and **`acts/help.ts` + `acts/doctor.ts`** call `loadSlotRegistry(...)` directly — all break when `slot-registry.ts` is deleted. The integration test `test/integration/cli-commands.test.ts` also asserts the BUILTIN_SLOTS surface. | `app.ts` migration is **T016**; the two acts migrate in **T020/T022**; **T017** is sequenced **last** (delete only after all consumers migrated, verified by grep); **T026** rewrites the integration test. |
| KF-04 | High | **Async `main` correctness.** Verb handlers are async → `program.parse` becomes `await program.parseAsync`; discovery+load must complete *before* parse; commander's `exitOverride` error mapping must still wrap the awaited path; and `index.ts` must `await`/`.catch()` `main()` so the bin never floats an **unhandled promise rejection** (would bypass the exit kernel). | **T015/T016** restructure + test, including a bin rejection-safety assertion. |
| KF-05 | Medium | **jiti cold-start.** jiti transpiles per file per process (like pi's `moduleCache:false`); for a one-shot CLI that's a single pass — acceptable. No compiled cache in v1 (spec R3). | Note only; revisit if a hot path emerges. `.js` fast-path (plain `import()`) avoids transpile entirely. |
| KF-06 | Medium | **Adapter discipline for `exec`.** `NodeExec` spawns `child_process` — that's an **adapter** (allowed); no service may import `node:child_process`/`node:fs` directly. The existing `no-direct-exit` arch test only guards `process.exit`. | **T015** adds an optional arch test asserting services don't import node side-effect modules; keep `exec`/`fs`/loader I/O behind ports. |
| KF-07 | High | **Packaging smoke must prove discovery from the installed bin.** Today's `package-smoke` only runs `--version`/`doctor` generically. AC-8 requires a fixture `.harness/extensions/` in the temp project and a fixture verb invoked through the symlinked bin. | **T024** extends `package-smoke` to drop a fixture extension and assert the verb runs (+ correct exit code) via `node_modules/.bin/harness`. |

## Implementation

**Objective**: Ship the repo-local extension system — runtime discovery + jiti-backed loading of `.harness/extensions/`, a declarative verb contract with injected ports (incl. `ExecPort`), dynamic `help`/`doctor`, removal of `BUILTIN_SLOTS`/`run` scaffolding, the Node-22 + jiti packaging changes, doctrine sync, the installed-bin packaging smoke, and authoring docs — in one ordered, test-first phase.

**Testing Approach**: **Full TDD**, fakes-only (Constitution P3 / spec). For each unit the **test task (red)** precedes the **impl task (green)**; integration uses **on-disk fixture extensions** loaded by the real jiti adapter; **no `vi.mock`**. Acceptance closes with `just fft` green + a manual installed-bin smoke.

> **Mode decision**: scored CS-4, which normally implies Full. Kept **Simple** per the user's explicit choice ("keep ceremony lean") — mitigated by (a) tight v1 scope (see spec Non-Goals), (b) the ordered test-first groups A–F below acting as de-facto phase boundaries, and (c) a live `code-review-companion` during `/plan-6`. Escalation to Full remains cheap if the build surfaces real gate boundaries.

### Tasks

Groups (ordered): **A** ports/adapters → **B** contract → **C** loader core → **D** composition root + scaffolding removal → **E** dynamic help/doctor → **F** packaging/docs/doctrine/integration.

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T001 | **(red)** Tests for `FsPort.readdir`, `ProcessPort.cwd`, and `FakeExec` behaviours (recorded call history, scripted results). | harness-cli-core | `test/adapters/fs/fake-fs.test.ts`, `test/adapters/process/fake-process.test.ts`, `test/adapters/exec/fake-exec.test.ts` | Failing tests pin: `readdir` returns entry names / `[]` when absent; `cwd()` returns seeded value; `FakeExec.run` returns scripted `ExecResult` + records the command. | Test-first. Fakes record history (P3). |
| [ ] | T002 | **(green)** Add `readdir(path): string[]` to `FsPort` (+ `NodeFs` via `readdirSync`, `FakeFs` from seed map); add `cwd(): string` to `ProcessPort` (+ `NodeProcess` → `process.cwd()`, `FakeProcess` seeded). (D1) | harness-cli-core | `src/adapters/fs/{fs-port,node-fs,fake-fs}.ts`, `src/adapters/process/{process-port,node-process,fake-process}.ts` | T001 green; `NodeFs.readdir` never throws (returns `[]` on ENOENT). | Port-first, then impls + fakes. |
| [ ] | T003 | **(red)** Tests for `ExecPort` contract via `FakeExec` (success/failure/stderr; `ok` reflects `code===0`). | harness-cli-core | `test/adapters/exec/fake-exec.test.ts` | Failing tests assert `{code,stdout,stderr,ok}` mapping + cwd passthrough. | Test-first. |
| [ ] | T004 | **(green)** `ExecPort` interface + `NodeExec` (`child_process.spawn`, no shell, args array, capture code/stdout/stderr) + `FakeExec`. | harness-cli-core | `src/adapters/exec/{exec-port,node-exec,fake-exec}.ts` | T003 green; `NodeExec` is the only verb-path child spawn; no service imports `node:child_process`. | P8 capability (KF-06). |
| [ ] | T005 | **(green + smoke)** `ModuleLoaderPort` interface; `JitiLoader` adapter (jiti for `.ts/.tsx`; `import()` for `.js/.mjs/.cjs`); `FakeModuleLoader` (scripted). Test loader routing via fake **and** one real-jiti integration smoke loading a `.ts` fixture. | extension-loader | `src/adapters/loader/{module-loader-port,jiti-loader,fake-loader}.ts`, `test/adapters/loader/*.test.ts` | Fake-routed unit tests pass; real jiti loads a `.ts` fixture's default export (enum-using file confirms full transpile). | jiti `moduleCache:false` (pi-parity). Only place `jiti` is imported. |
| [ ] | T006 | **(red+green)** Public **verb contract** module: `HarnessVerb`, `VerbContext`, `VerbResult`, `VerbOption`, `VerbArg`, `ExecResult`, `Evidence`, `ExtensionExport`, `ExtensionRecord`. Type-level conformance test (an example object + the `ctx` helper signatures). | extension-loader | `src/services/extensions/contract.ts`, `test/services/extensions/contract.test.ts` | Types compile; an example `HarnessVerb` conforms; `tsc --noEmit` clean. | Mostly types (lightweight test). Re-exported via `exports` (T023). |
| [ ] | T007 | **(red)** Discovery tests with on-disk fixtures: present / absent / empty / direct files / subdir `index.ts` / `package.json` manifest entry / sorted "first wins" / dedup by resolved abs path / ignores non-extension files. | extension-loader | `test/services/extensions/discovery.test.ts`, `test/integration/fixtures/extensions/**` | Failing tests enumerate every discovery rule from WS-A Decision 4. | Fixtures, not mocks. |
| [ ] | T008 | **(green)** `discovery.ts` — scan `<cwd>/.harness/extensions/` one level via `FsPort.readdir` + `ProcessPort.cwd`; resolve entries; sort; dedup; return candidate abs paths. | extension-loader | `src/services/extensions/discovery.ts` | T007 green; absent/empty → `[]` (no throw). | Pure of Node I/O (ports only). |
| [ ] | T009 | **(red)** Registry tests (via `FakeModuleLoader`): valid verb(s) → `loaded`; load throw / invalid shape → `failed` (E140), isolated; duplicate verb name → `conflict` (E142, first-sorted wins); core names `help`/`doctor` reserved (can't be shadowed); open `name: string` preserved. | extension-loader | `test/services/extensions/registry.test.ts` | Failing tests pin per-extension isolation + conflict + reservation + open key. | One broken extension never breaks others. |
| [ ] | T010 | **(green)** `registry.ts` — load each candidate (isolated `try`), validate via `validateVerbRegistry`, reserve core names, flag conflicts, return `{verbs, records}`. Repurpose `validateCommandMap` → `validateVerbRegistry` in `load-config.ts` (open key, dedup, required fields). (D3) | extension-loader | `src/services/extensions/registry.ts`, `src/services/config/load-config.ts` | T009 green; AC-7 "malformed entries guarded" holds; no closed union. | |
| [ ] | T011 | **(red)** Verb-context tests: `ctx` exposes `cwd/args/options` + `exec/fs/env/git/clock` (backed by fakes) + `ok/degraded/unconfigured/error` helpers; `finalize(VerbResult, name, clock)` → `Envelope` (adds `command`+`timestamp`, enforces `next_action` on non-`ok`); handler throw → `E141` error Envelope (no raw stack). | extension-loader | `test/services/extensions/verb-context.test.ts` | Failing tests pin ctx surface + finalize mapping + throw isolation. | Kernel stays sole owner of `command`/`timestamp`/exit. |
| [ ] | T012 | **(green)** `verb-context.ts` — build `VerbContext` from injected ports + envelope-helper closures bound to the verb name; `finalizeVerbResult`; wrap `run` in `try/catch` → E141. | extension-loader | `src/services/extensions/verb-context.ts` | T011 green. | |
| [ ] | T013 | **(red)** Verb-act tests: `registerVerbAct` adds a commander subcommand from the verb's `name/summary/description/options/args`; `--help` reflects them; action parses opts/args → builds ctx → `await run` → finalize → exit via kernel; status→exit mapping intact (ok/degraded 0, unconfigured 2, error 1). | harness-cli-core | `test/acts/verb.test.ts` | Failing tests cover registration + invocation + exit codes for a fake verb. | Thin act; no business logic. |
| [ ] | T014 | **(green)** `acts/verb.ts` — `registerVerbAct(program, verb, deps, io)`. | harness-cli-core | `src/acts/verb.ts` | T013 green. | |
| [ ] | T015 | **(red)** Composition-root tests: discovery+load runs before `parseAsync`; `--no-extensions` **and** `HARNESS_NO_EXTENSIONS=1` skip discovery (core verbs only); core `help`/`doctor` always registered; bare `harness` → orientation; commander `exitOverride` errors still map (E108/E100, no stack); **bin** path rejection-safe (`main()` rejection routed through the kernel, not floated). Optional: arch test that services don't import `node:fs`/`node:child_process`. | harness-cli-core | `test/app.test.ts`, `test/index.test.ts`, `test/architecture/no-direct-node-io.test.ts` | Failing tests pin async sequence + safe mode + error mapping + rejection safety (KF-04, KF-06). | |
| [ ] | T016 | **(green)** Restructure `app.ts`: `main` async; build registry (discovery → `await load` each, isolated) unless safe mode; `buildProgram(version, io, deps, registry)` registers core acts + one `registerVerbAct` per verb; `await program.parseAsync`. `index.ts` → `main().catch(...)` through the kernel. | harness-cli-core | `src/app.ts`, `src/index.ts` | T015 green; Envelope/exit kernel untouched. | |
| [ ] | T017 | **(green — sequenced LAST, after T016/T020/T022/T026)** **Remove scaffolding** (D2): once every consumer is migrated, delete `acts/run.ts`, `acts/unconfigured-slot.ts`, `services/slots/slot-registry.ts` (+ their tests `test/acts/run.test.ts`, `test/acts/unconfigured-slot.test.ts`, `test/services/slots/slot-registry.test.ts`). | harness-cli-core | (deletions only — consumers already migrated: `app.ts`→T016, `acts/help.ts`→T020, `acts/doctor.ts`→T022, services→T020/T022, `load-config`→T010) | `grep -rE "BUILTIN_SLOTS|builtinSlots|runSlot|slotEnvelope|loadSlotRegistry" harness/cli/src` returns nothing; build + typecheck + full suite green. | KF-03. Deletion is safe only after migrations land — never strand a consumer. |
| [ ] | T018 | **(red+green)** Add `E140 EXTENSION_LOAD_FAILED`, `E141 EXTENSION_RUNTIME_ERROR`, `E142 EXTENSION_VERB_CONFLICT` to the error-code table (+ test asserting presence/uniqueness). | harness-cli-core | `src/output/error-codes.ts`, `test/output/error-codes.test.ts` | New codes present + unique; referenced by registry/verb-context. | |
| [ ] | T019 | **(red)** Help tests: with discovered verbs, `help` lists each verb (name + summary + status), **no `BUILTIN_SLOTS`**; empty registry → honest "no extensions installed yet" + `next_action`; `help --json` carries the machine-readable verb list. | harness-cli-core | `test/services/help/help-service.test.ts` | Failing tests pin dynamic + empty-state help. | AC-1, AC-6. |
| [ ] | T020 | **(green)** Make `help-service` extension-aware (build from the verb registry + records; honest empty state); **migrate `acts/help.ts` off `loadSlotRegistry` to the registry injected by the composition root** (KF-03). | harness-cli-core | `src/services/help/help-service.ts`, `src/acts/help.ts` | T019 green; `acts/help.ts` no longer imports `slot-registry`. | |
| [ ] | T021 | **(red)** Doctor tests: an `extensions` layer enumerates loaded/failed/conflict with path + verbs + error + `next_action`, **without invoking any handler**; a throwing/malformed fixture is reported (E140), not fatal; the rest still load. | harness-cli-core | `test/services/doctor/doctor-service.test.ts` | Failing tests pin enumeration + isolation (P7). | AC-5. Doctor stays core (not a verb). |
| [ ] | T022 | **(green)** Add the `extensions` layer to `doctor-service` (consumes registry records); **migrate `acts/doctor.ts` off `loadSlotRegistry` to the injected registry** (KF-03). | harness-cli-core | `src/services/doctor/doctor-service.ts`, `src/acts/doctor.ts` | T021 green; `acts/doctor.ts` no longer imports `slot-registry`. | |
| [ ] | T023 | **(green)** `package.json`: bump `engines.node` `>=20` → `>=22`; add `jiti` (v2, pinned) to **`dependencies`**; add an `exports` map: `"."` → the bin/dist entry, and `"./contract"` as a **conditional** export with **both** a `types` condition (`./harness/cli/dist/services/extensions/contract.d.ts` — emitted because tsconfig `declaration:true`) **and** an `import`/`default` condition (`…/contract.js`), so `import type … from 'harness-engineering/contract'` resolves for TS consumers (KF-02). Keep `examples/` **out** of the npm `files` array (reference only; `dist` already ships `contract.d.ts`). `tsconfig` `include:["src"]` already covers new dirs — no change needed. (AC-10) | harness-cli-core | `package.json` | `npm ls jiti` resolves under `dependencies`; `exports["./contract"]` has a `types` condition; a scratch TS file `import type { HarnessVerb } from 'harness-engineering/contract'` typechecks against the packed/linked package. | |
| [ ] | T024 | **(green)** `ci.yml`: matrix → `['22']` (optionally add `'24'`); `package-smoke` Node → `22`; **extend** the smoke to write a fixture **`.harness/extensions/hello.ts`** (a `.ts` file — forcing the **jiti** path, which proves jiti resolved as a *runtime* dep under the packaged `--omit=dev` install, AC-10) into the temp project and assert `node_modules/.bin/harness hello` runs + exits 0, and a deliberately-failing fixture exits 1. | harness-cli-core | `.github/workflows/ci.yml` | CI green on 22; package-smoke proves `.ts` discovery + jiti load + verb run via the installed symlinked bin under `--omit=dev` (KF-07, AC-8, AC-10). | AC-8, AC-10. |
| [ ] | T025 | **(green)** **Doctrine sync** (KF-01): `rules.md` §4 — drop "seed set", state verbs are dynamic/extension-owned (P10); `architecture.md` §4 (`engines.node >=22`), §5 (extension seam **built**; `BUILTIN_SLOTS` removed), §8 (Node ≥22); `idioms.md` — retune the **`const BUILTIN_SLOTS …` example (≈line 111)** so it no longer presents the slots as an open seed set (show the dynamic verb registry instead). | doctrine | `docs/project-rules/{rules.md,architecture.md,idioms.md}` | Wording matches Constitution P10 v1.1.0 + Node-22; no "seed set"/"future-facing seam"/"Node ≥20"/`BUILTIN_SLOTS` example left. | Constitution governance: update together. |
| [ ] | T026 | **(red+green)** Integration via on-disk fixtures loaded by **real jiti**: `hello` (ok), `build` (wraps `ctx.exec`, success+failure exit mapping), a broken extension (E140 isolation), a verb conflict (E142). Rewrite `test/integration/cli-commands.test.ts` to drop BUILTIN_SLOTS assumptions and assert the dynamic surface. | both | `test/integration/extensions.test.ts`, `test/integration/cli-commands.test.ts`, `test/integration/fixtures/extensions/**` | End-to-end: `help`/`doctor`/`<verb>` outputs + exit codes correct; one broken fixture never breaks the others. | AC-2..AC-6, AC-9. |
| [ ] | T027 | **(green)** Docs (AC-11): `harness/cli/README.md` quick-start ("install an extension"); `harness/cli/docs/authoring-verbs.md` ("write your first verb", using `harness-engineering/contract`); copyable `harness/cli/examples/extensions/{hello,build}.ts`. | harness-cli-core | `harness/cli/README.md`, `harness/cli/docs/authoring-verbs.md`, `harness/cli/examples/extensions/*` | A reader can copy `hello.ts` into `.harness/extensions/` and run it; guide uses the resolvable specifier (KF-02). | |
| [ ] | T028 | **(validate)** Run `just fft` (fix → format → test+coverage) to green; full suite passes; manual smoke: from a temp cwd with `.harness/extensions/hello.ts`, run `harness help`, `harness doctor`, `harness hello --name pi` and confirm outputs + exit codes; `harness --no-extensions help` shows core-only. | both | — | `just fft` green; manual smoke matches WS-A worked examples; coverage reported. | Closes acceptance. |

### Acceptance Criteria

- [ ] **AC-1 — Dynamic help**: with ≥1 extension in `./.harness/extensions/`, `harness help` lists each contributed verb (name + summary + status); no `BUILTIN_SLOTS`. *(T019/T020, T026)*
- [ ] **AC-2 — Verb `--help`**: `harness <verb> --help` prints the verb's own usage/options/description. *(T013/T014, T026)*
- [ ] **AC-3 — Envelope + exit contract**: invoking a verb runs its handler and emits a canonical Envelope (JSON/human), mapping `status → exit` (ok/degraded 0, unconfigured 2, error 1); the handler returns a `VerbResult` and never calls `process.exit`/`console.log`. *(T011/T012, T013/T014)*
- [ ] **AC-4 — Wrap a real command (P8)**: a verb runs a real repo command via `ctx.exec`, with success/failure reflected in the Envelope + exit code. *(T003/T004, T026 `build` fixture)*
- [ ] **AC-5 — `doctor` enumerates + validates (P7)**: `harness doctor` lists installed extensions (name, load status, path, `next_action` on failure) without invoking any verb; a malformed/throwing extension is reported, not fatal. *(T021/T022, T026)*
- [ ] **AC-6 — Discovery from cwd, honest empty**: discovery scans `<cwd>/.harness/extensions/` one level deterministically; absent/empty yields an honest "no extensions installed" state with a `next_action` (not a hard error). *(T007/T008, T019)*
- [ ] **AC-7 — Scaffolding retired, registry open**: `BUILTIN_SLOTS` removed; verb surface sourced entirely from discovered extensions; registry keyed by `name: string` (no closed union); `validateVerbRegistry` guards malformed entries. *(T010, T017)*
- [ ] **AC-8 — Packaging smoke (npx topology)**: a fixture extension is contributed end-to-end through the installed symlinked bin (pack → install → run `harness <fixture-verb>` from a temp project with a `.harness/extensions/` fixture). *(T024)*
- [ ] **AC-9 — Fakes-first TDD**: loader/discovery/contract logic covered by hand-written fakes (`FakeFs.readdir`, `FakeExec`, `FakeModuleLoader`) + on-disk fixtures; no `vi.mock`. *(T001–T012, T026)*
- [ ] **AC-10 — Runtime-dep discipline**: jiti (and any runtime-needed dep) in `dependencies`, not `devDependencies` (`--omit=dev` safe). *(T023; proven end-to-end by the `.ts`-fixture package-smoke in T024)*
- [ ] **AC-11 — Docs + example**: README quick-start + authoring guide exist, with a copyable example extension. *(T027)*

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| R1 — Async-`main` regression (unhandled rejection bypasses the exit kernel) | Med | High | `main().catch()` routes through the kernel; explicit bin rejection-safety test (KF-04/T015). |
| R2 — Trust/security (core executes arbitrary repo code) | High (by design) | Med | Trust-the-repo (industry norm); `doctor` provenance + isolated load errors; `--no-extensions`/`HARNESS_NO_EXTENSIONS` safe mode; documented plainly. |
| R3 — jiti cold-start latency | Low | Low | One-shot CLI = single transpile pass; `.js` fast-path skips transpile; no cache in v1 (KF-05). |
| R4 — Doctrine drift left unsynced | Med | Med | T025 syncs rules/architecture/idioms in the same change (KF-01). |
| R5 — Contract specifier unresolvable for authors | Med | High | `exports["./contract"]` + guide/example use `harness-engineering/contract`; types-only import (KF-02/D4). |
| R6 — Scaffolding-removal breakage (consumers/tests still assume slots) | Med | High | Migrate consumers + rewrite integration test atomically with deletion (KF-03/T017/T026). |
| R7 — Simple-mode size (CS-4 in one phase) | Med | Med | Ordered test-first groups A–F as de-facto boundaries; live companion review in `/plan-6`; escalate to Full if real gates emerge. |

---

## Validation Record (2026-06-08)

### Validation Thesis

**Raison d'être**: A lean, gate-checked, **test-first** plan that lets `/plan-6` build the harness extension system (runtime discovery + jiti loading of `.harness/extensions/`, a declarative `HarnessVerb` contract with injected ports incl. a new `ExecPort`, dynamic `help`/`doctor`, removal of the temporary `BUILTIN_SLOTS`/`run` scaffolding) with minimal further design discovery.

**Value claim**: Implementation becomes mechanical + safe — the build wires WS-A's already-decided contracts instead of re-deciding, and the doctrine / packaging / scaffolding-removal ripples are surfaced up front rather than discovered mid-build.

**Artifact promise**: A `/plan-6` implementer (human or agent) can execute the single ordered task table test-first and land all 11 ACs without re-architecting; the 7 gates already passed.

**Intended beneficiaries**: the `/plan-6` implementer + the live code-review companion + reviewers; and ultimately the extension **author** ("super easy to add a verb").

**Proof target**: Implementation.

**Evidence standard**: tasks map to the 11 ACs + WS-A's 6 decisions + real kernel files; explicit TDD ordering; gate matrix grounded in the body.

**Thesis source**: `harness-extension-system-spec.md` + `workshops/001-extension-contract-and-loader.md` + constitution P10.

**Thesis verdict**: Advanced.

**Main thesis risk**: Residual execution churn around the loader / docs / packaging-smoke — already gated by test-first tasks + file-level mapping.

---

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|---------------|-------------|--------|---------|
| Coherence + Completeness | Edge Cases, Hidden Assumptions, System Behavior, Proof-Level Fit, Concept Docs | Implementation Readiness, Evidence Sufficiency | 2 HIGH + 2 MED — all fixed | ⚠️→✅ |
| Source-Truth + Risk | Integration & Ripple, Deployment & Ops, Domain Boundaries, Technical Constraints, Hidden Assumptions | Evidence Sufficiency, Safety to Change | 1 HIGH + 1 MED + 1 LOW — all fixed | ⚠️→✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit | Thesis Alignment | 0 | ✅ |
| Forward-Compatibility | Forward-Compatibility, Integration & Ripple, Contract Integrity | Contract Integrity | 1 HIGH (run/dynamic drift) — fixed | ⚠️→✅ |

**Lens coverage**: 11/15 (Thesis Alignment ✓, Forward-Compatibility ✓ engaged — not STANDALONE).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| `/plan-6` build of this plan | Ordered test-first tasks, concrete files, falsifiable Done-When for all 11 ACs; no open design decision | contract drift | ✅ (after fix) | T001–T028 ordered/test-first w/ files + Done-When; run/dynamic ambiguity resolved in D2 + spec |
| WS-A contract (authoritative) | No contradiction with the 6 decisions | contract drift | ✅ | Matches jiti+`.js`, declarative default export, `ctx` ports + `ExecPort`, one-level first-wins discovery, trust-the-repo/`--no-extensions`, async `main` |
| Spec's 11 Acceptance Criteria | Each AC traceable to a task | test boundary | ✅ | AC-1..AC-11 → task map present |
| CI / packaging | Node-22 + jiti + `exports`(+types) + package-smoke concrete | encapsulation lockout | ✅ | T023/T024 specify all four; smoke uses a `.ts` fixture verb |
| Future extension AUTHOR | Resolvable import specifier + copyable example + guide | shape mismatch | ✅ | D4 + T023 (`exports` w/ `types`) + T027 (`harness-engineering/contract`, example, guide) |

**Thesis alignment**: Value claim **advanced** at the **Implementation** proof target with **Strong** evidence; main residual risk is execution churn, already gated by test-first tasks + file-level mapping.

**Outcome alignment**: "making the supported path discoverable and extensible so teams encode fixes (not memory) into a focal CLI" — the plan advances this; the `run`/dynamic-surface ambiguity that the validator flagged is now resolved (D2 + spec supersession) before `/plan-6`.

**Standalone?**: No — concrete downstream consumers exist (`/plan-6` build, WS-A contract, the 11 ACs, CI/packaging, the extension author).

Overall: VALIDATED WITH FIXES

---

## Validation Record — Code Changes (2026-06-08)

Validates the **shipped implementation** (28 tasks + 7 companion-finding fixes + 1 validate-fix), not the plan. Run via `/validate-v2`, 4 parallel agents.

### Validation Thesis

**Raison d'être**: Let a developer who `npx`-installed the harness core extend it by dropping an extension file into their repo's `.harness/extensions/` — the core discovers + loads it at runtime; each contributes a top-level `harness <verb>` (own `--help`/options/Envelope/exit codes). Retires `BUILTIN_SLOTS` (P10). North star: extending the harness is "super easy."

**Value claim**: Authoring an extension is trivial and safe — drop a `.ts`/`.js` file, return intent via `ctx` helpers; the kernel owns command/timestamp/exit/`process.exit`; one broken extension never breaks the CLI or others; `doctor` enumerates every extension (P7); verbs wrap real commands (P8).

**Artifact promise**: Authors import only `harness-engineering/contract` (types-only, runtime-erased — even a plain `.js` extension needs no runtime dep); the loader isolates failures; the verb-name key is an open `string` (no closed union).

**Intended beneficiaries**: extension authors; agents driving the CLI (machine-readable Envelopes + deterministic exit codes); the `doctor` diagnostic; future maintainers.

**Proof target**: Validated Evidence.

**Evidence standard**: 146 unit tests; real-jiti integration (incl. a plain-`.js` extension end-to-end); installed-bin `--omit=dev` smoke matching WS-A worked examples; source match to the WS-A contract.

**Thesis source**: `harness-extension-system-plan.md` + `workshops/001-extension-contract-and-loader.md` + spec.

**Thesis verdict**: Advanced.

**Main thesis risk**: The plain-`.js` authoring path was asserted-but-unproven (now closed by `greetjs.js` integration test, commit `dd850e7`).

---

| Agent | Lenses Covered | Thesis Axes | Issues | Verdict |
|-------|---------------|-------------|--------|---------|
| Correctness | Edge Cases, System Behavior, Hidden Assumptions, Technical Constraints | Implementation Readiness | 0 | ✅ |
| Regression + Domain | Integration & Ripple, Domain Boundaries, Concept Docs, Deployment & Ops, Test boundary | Safety to Change | 0 (grounded: F005/F008/F002 ripple + arch guards verified) | ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit, User/Product Value, Agent Readiness | Thesis Alignment | 1 MED — fixed (`dd850e7`) | ⚠️→✅ |
| Forward-Compatibility | Forward-Compatibility, Contract Integrity, Security & Privacy, Hidden Assumptions | Contract Integrity | 1 MED — accepted/deferred (F003 symlink) | ⚠️ |

**Lens coverage**: 12/15 (Thesis Alignment ✓, Forward-Compatibility ✓ engaged — not STANDALONE).

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| Extension AUTHORS | Types-only self-contained contract via `harness-engineering/contract` | encapsulation lockout, shape mismatch | ✅ | `contract.ts:17-21,44-112`; `package.json` `exports['./contract']`; examples import only the contract type |
| `doctor` command | Stable machine-readable `ExtensionRecord` (incl. `shadows: string[]`) | contract drift, shape mismatch | ✅ | `doctor-service.ts:35-37,109`; `contract.ts:102-112`; `registry.ts:67-76` |
| CI package-smoke | Built package resolves `./contract` + a `.ts` extension loads under `--omit=dev` | exports/`.d.ts` failure | ✅ | `package.json:9-15`; `tsconfig.json` `declaration:true`; `.github/workflows/ci.yml` package-smoke |
| NEXT PHASE (this branch) | Open `string` verb-name key; extensible registry/contract | closed-union drift | ✅ | `registry.ts` open key; `contract.ts` `HarnessVerb` |

**Thesis alignment**: Value claim **advanced** at the **Validated Evidence** proof target with **Strong** evidence; the one residual thesis risk (unproven plain-`.js` path) is now closed by an integration test.

**Outcome alignment**: The shipped code advances "developers can extend their installed harness super easily — drop a file in `.harness/extensions/` and get a first-class `harness <verb>`"; the only open item is the consciously-deferred symlink-realpath containment (F003), an accepted v1 non-goal for a developer-trusted local extension tree.

**Accepted/deferred**: F003 — discovery containment is lexical (`path.relative`), so a symlink **inside** `.harness/extensions/` can still point outside. Deferred for v1: the extension tree is the developer's own trusted local code (no privilege escalation beyond what they already have), and true realpath needs a new `FsPort.realpath` capability. Documented inline in `discovery.ts` and in the thesis non-goals.

**Standalone?**: No — concrete downstream consumers exist (authors, `doctor`, CI smoke, next phase).

Overall: VALIDATED WITH FIXES
