# Typed Extensions (Authoring v2) + `harness sensors`
**Mode**: Full
**Plan Version**: 1.0.0
**Created**: 2026-07-14
**Status**: READY
**Spec source**: unified (this file)

## Business Specification

### Research Context

📚 Incorporates findings from `research-dossier.md` (13 findings, 4 historical) and the authoritative workshop `workshops/001-extension-authoring-v2.md` (Contract Ready). Headline: the discrimination and packaging seams already exist (kind-routing in `registry.ts`, runtime `./contract` export); runtime deps are exactly `commander`+`jiti`; the private consumer repo's extensions are the wild evidence (hand-rolled dispatch, bounded-spawn, sensor registry) this work deletes.

### Summary

Give deterministic back-pressure a first-class home (rules-of-why Rule 7) in two moves. First, standardise extension authoring: a `defineExtension()` factory producing typed items (verbs with real subverbs, sensors, records, user-defined custom types), classified by shape, versioned by an `api` level with explicit evolution rules, normalized to one internal shape — while every v1 extension loads forever unchanged. Second, build `harness sensors` on that substrate: deterministic, repo-change-triggered sensor runs with stats, snapshot/trend, a state-file-decoupled daemon, an Ink TUI for humans, and the Envelope for agents.

### Goals

- One authoring contract agents fall into correctly by default (`harness new` scaffolds it; the factory is DX, the shape is the truth).
- Deterministic old/new detection and honest failure modes (`E147` needs-newer-core, `E148` unknown-section) — never silent capability loss.
- The new way itself is forward-extendable without breaking older new-way extensions (evolution rules E1–E5; append-only conformance corpus as the enforcement).
- Sensors as a core-typed item: cheap, deterministic (no LLM), continuously run, with trend-vs-snapshot so an agent can tell "I broke this" from "already broken".
- Two renderings, one truth: Ink TUI for supervising humans; the JSON Envelope (with `guidance`/`next_action`) as the agent surface.
- Delete the wild boilerplate classes: hand-rolled subverb dispatch, bounded-spawn wrappers, userland sensor registries, private step-runners.

### Non-Goals

- No LLM/inferential sensors (they stay skills/verbs).
- No gating: sensors inform and guide; the scheduler never blocks a commit or an agent (Rule 9). (A one-shot `sensors check` verb exits non-zero for CI *callers* to gate on — the harness itself never does.)
- No v1 deprecation, migration mandate, or doctor wail — v1 loads forever; the paved path is the only incentive.
- No framework sprawl: no lifecycle hooks, middleware, or plugin-of-plugins (workshop A7 anti-sprawl rule).
- No custom-type hooks into core runtimes (user types are data + discovery; core semantics require an api bump).

### Target Domains

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli | existing (conceptual — registry uninitialized, constitution §5) | **modify** | All work: contract, registry, acts, scaffold, sensors runtime, TUI, packaging |
| repo-engineering-substrate | existing (conceptual) | **consume** | CI/justfile/vitest run the proofs; `windows-check` covers watcher semantics |

### Testing Strategy

- **Approach**: Hybrid (constitution §3 house style).
- **Rationale**: The compat promise and the sensors engine are branching logic — test-first with the frozen conformance corpus as the centerpiece. Entry-thin surfaces (templates, TUI rendering, packaging) get lightweight verification.
- **Focus Areas**: classification/api-gate/normalizer, subverb mounting + scoped params, E147/E148 paths, scheduler (quiescence, hash dedup, serialize, stale-marking), state store atomicity + staleness, snapshot/trend math, TTY branch.
- **Excluded**: pixel-level TUI appearance; npm registry behaviour.
- **Mock Usage**: **Fakes only** (Principle 3) — every new seam is a port with a recording fake: `WatcherPort`, `SensorStatePort` (or reuse FsPort), TUI io boundary, exec timeout via existing `ExecPort` fake. No `vi.mock`.

### Documentation Strategy

- **Location**: Hybrid — `docs/how/authoring-extensions-v2.md` (supersedes-but-keeps `authoring-verbs.md` for v1), `docs/how/harness-sensors.md`, plus a short README "new way" section (npm-facing).
- **Rationale**: public contract change; README is the install-page pitch, docs/how is the depth.

### Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=1, D=1, N=1, F=1, T=2
- **Confidence**: 0.75
- **Assumptions**: jiti 2.7 `alias` resolves the contract specifier (spiked in Phase 1); Ink can be lazy-imported from `optionalDependencies` without breaking non-TUI paths (spiked in Phase 3).
- **Dependencies**: commander@15 (nested commands) + jiti; Node 22+ `fs.watch` recursive; **picomatch** (zero-dep) added in Phase 2 for watch globs (workshop 002 S8).
- **Risks**: see § Risks & Assumptions.
- **Phases**: 3.

### Acceptance Criteria

1. **AC-01 (v1 forever)**: This repo's 10 extensions and the private consumer repo's 9 load with unchanged behaviour under the new core (`harness doctor`: 0 failed, 0 conflict; existing extension tests green untouched).
2. **AC-02 (detection)**: A `kind:'extension'` export loads as v2; `harness doctor` reports `format: v1` / `format: v2 (api N)` per extension; a mixed v1+v2 array routes each entry independently.
3. **AC-03 (subverbs)**: A v2 verb with `sub:` mounts nested commander commands: `harness <verb> <sub> --help` shows sub-scoped options; bare `harness <verb>` with no `run` returns the kernel's "pick a subverb" `unconfigured` envelope; unknown sub → kernel error envelope. Parent options visible in `ctx.options` for subs. A declared variadic arg arrives as `string[]` (v2 only).
4. **AC-04 (honest evolution)**: an extension declaring `api` above the core's support → per-extension `failed` record `E147` with `next_action` naming `harness update`; an unknown top-level section → `E148`; unknown *fields* inside known structures tolerated with a doctor info line.
5. **AC-05 (compat corpus)**: `test/conformance/extensions/api-2/` fixtures (factory form, bare-literal JS form, subverbs, mixed array, each error case) all load green; a guard test fails if any existing fixture file's content changes (append-only).
6. **AC-06 (scaffold)**: `harness new <name>` emits a loadable v2 extension (default verb, `--sub a,b`, `--wrap "<cmd>"`, `--js` bare-literal, `--sensor`) + `instructions.md`; the scaffolded extension loads without edits.
7. **AC-07 (platform gaps)**: `ctx.exec` accepts `{ timeoutMs, env }` — a hung child is killed at the deadline (provable with the exec fake); `ctx.steps()` yields per-step timing + ✅/❌ rollup + fail aggregation matching the private-consumer `db` shape.
8. **AC-08 (sensor registration)**: a `sensors:` item in a v2 extension registers into the sensor registry (never the verb namespace); `sensors` joins `RESERVED_NAMES`; `harness sensors run <name>` executes it and atomically writes its reading + stats to `.harness/temp/sensors/`.
9. **AC-09 (agent surface)**: `harness sensors --json` returns an Envelope from state files: per-sensor reading, stats (last run, wallclock, rolling avg, streak), `age`, snapshot delta, and daemon liveness `{running, pid, heartbeat}`; daemon down → **`degraded`** with `next_action` to start it (never silently runs sensors; never `unconfigured`, which exits 2 by the core status contract — workshop 002 S13, the private-consumer dlg-0003-fix1 lesson).
10. **AC-10 (watch loop)**: `harness sensors watch` (headless) triggers sensors whose `watch` globs match changed files, after a quiescence window, with content-hash dedup, per-sensor serialization, and at most one queued stale-marked rerun; `trigger:'manual'` sensors are never watch-fired (only `sensors run`) — all provable with the watcher/clock fakes.
11. **AC-11 (snapshot/trend)**: `harness sensors snapshot` stores a baseline; subsequent readings carry delta-vs-snapshot; the TUI trend column and `--json` delta agree.
12. **AC-12 (TTY split)**: on a TTY, bare `harness sensors` launches the Ink TUI (lazy dynamic import — non-TUI invocations never load Ink/React); non-TTY emits exactly the `--json` behaviour.
13. **AC-13 (advisory posture)**: watch/status paths never exit non-zero on failing readings; only `sensors check` (one-shot run-all, CI-facing) maps failing readings to a non-zero exit.
14. **AC-14 (docs)**: authoring-v2 + sensors how-to guides exist; README carries the new-way section; `authoring-verbs.md` marked as the v1 (still supported) contract.

### Risks & Assumptions

| Risk / Assumption | Notes |
|---|---|
| jiti `alias` unverified | Phase 1 opens with a spike; fallback = a jiti `resolve` hook or documenting install-required for TS factory imports (bare literal always works) |
| Ink dependency weight vs "intentionally small core" (constitution P10) | lazy dynamic import + `optionalDependencies`; Phase 3 spike proves graceful absence |
| Windows watcher + atomic-rename semantics | watcher behind a port; `windows-check` extension + CI cover it |
| Normalizer repoint touches every registry consumer | Phase 1 is refactor-heavy; the conformance corpus + existing test suite are the net |
| Scope creep into framework machinery | Non-goal + workshop A7; review checks against it |

### Open Questions

- None blocking. Sensor contract detail (SensorDecl/SensorReading field-level schema, state-file schema) was deferred to the Phase 2 workshop — now settled: workshop **002 (Approved, Contract Ready)** decisions S1–S12 fix the decl/reading types (incl. `skip` state, private-consumer evidence), the `state/<name>.json` + `daemon.json` + `snapshot.json` schemas, snapshot **gitignored** under `.harness/temp/sensors/` (closes spine E5), **picomatch** as the glob matcher (closes spine E3's matcher half), and the **E210–E217** sensor error-code block.

### Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions | Status |
|-------|------|--------------|---------------|--------|
| Extension authoring v2 | Data Model / API Contract | settled | discrimination, api evolution, types, params | ✅ Complete (001) |
| Sensor contract & state schema | Data Model / Storage Design | Field-level SensorDecl/SensorReading + state-file/snapshot schema feed Phase 2's contract tasks | reading fields? stats layout? snapshot location vs git? heartbeat format? | ✅ Complete (002) |
| Sensors TUI flow | CLI Flow | Optional — keybindings/layout are cheap to iterate live | rows, keys, trend glyphs | Not started (optional) |

### Clarifications

#### Session 2026-07-14

- Q: Workflow Mode? → A: **Full** (CS-4, real dependency boundary: substrate before sensors).
- Q: Testing strategy? → A: **Hybrid** (TDD for branching logic + conformance corpus; lightweight for templates/TUI/packaging).
- Q: Mock usage? → A: **Fakes only** (Principle 3; every new seam is a port + recording fake).
- Q: Documentation strategy? → A: **Hybrid** (docs/how guides + README section).

## Planning Seam
_Refinement opportunities still open — recorded as evidence; the flow surfaces and offers these, none gate:_
- Open Workshop Opportunities: Sensors TUI flow (optional) — Sensor contract & state schema completed as 002

| Artifact | Present? | Effect on the plan |
|----------|----------|--------------------|
| research-dossier.md | y | informs Key Findings F-rows + phase file lists |
| workshops/001-extension-authoring-v2.md | y | **authoritative**: discrimination, api levels E1–E5, type model D6, params D7 |
| workshops/002-sensor-contract-state-schema.md | y | **authoritative**: SensorDecl/SensorReading S1–S3, state/heartbeat/snapshot schemas S4–S7, picomatch S8, error block E210–E217 S9, scheduler constants S10, secrets guard S12 |

## Implementation Plan

### Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | Round 1 answered 2026-07-14; no critical markers remain |
| G2 | Constitution | PASS | Ports/fakes (P2/P3), wrap-don't-rebuild (P8), honesty/unconfigured (P5), dynamic verbs (P10) all by design; Ink handled lazy+optional to honour "core intentionally small" |
| G3 | Architecture | PASS | New code follows Entrypoint→Act→Service→Port layering; watcher/state/TUI-io are new ports with fakes; single exit site preserved |
| G4 | ADR Compliance | N/A | no docs/adr/ |
| G5 | Structure | PASS | all contract sections present |
| G6 | Testing Alignment | PASS | Hybrid: test-first tasks precede impl in every logic area; lightweight verification tasks present in template/TUI/packaging groups |
| G7 | Domain Completeness | PASS | registry uninitialized (constitution §5) — conceptual domains mapped; manifest covers all phase files |

### Summary

Phase 1 lands the v2 authoring substrate as a pure refactor-plus-contract: types, factory, classification, api gate, normalizer (kernel repointed to one internal shape), subverb mounting, validation, error codes, scaffold templates, and the frozen conformance corpus — proven by both repos' v1 extensions loading unchanged. Phase 2 builds sensors headless on that substrate: the sensor item kind, registry, scheduler/watcher behind ports, atomic state store with stats and snapshot/trend, and the `sensors run/--json/watch/snapshot/check` verb family. Phase 3 adds the human surface: lazy-loaded Ink TUI with TTY detection, packaging posture, and the documentation set. Expected outcome: private-consumer-class boilerplate becomes deletable, sensors become a five-minute authoring job, and the compat promise is mechanically enforced.

### Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| harness/cli/src/services/extensions/contract.ts | harness-cli | contract | v2 types + defineExtension + API_VOCABULARY (additive) |
| harness/cli/src/services/extensions/v2/ (types, validate, normalize, api-gate) | harness-cli | internal | new-way pipeline |
| harness/cli/src/services/extensions/registry.ts | harness-cli | internal | third routing arm + normalize step; consumers repointed |
| harness/cli/src/services/config/load-config.ts | harness-cli | internal | v2 shape validation beside v1 (variadics lifted on v2 path) |
| harness/cli/src/acts/verb.ts | harness-cli | internal | nested-subverb register path beside the v1 act |
| harness/cli/src/services/extensions/verb-context.ts | harness-cli | contract | ctx.steps(), ctx.registry, exec timeoutMs/env |
| harness/cli/src/adapters/exec/exec-port.ts (+node/fake) | harness-cli | contract | additive timeoutMs/env options |
| harness/cli/src/adapters/loader/ | harness-cli | internal | jiti alias for the contract specifier |
| harness/cli/src/services/scaffold/{scaffold-service,templates}.ts | harness-cli | internal | v2 variants: default, --sub, --wrap, --js, --sensor |
| package.json (exports, optionalDependencies) | harness-cli | contract | runtime defineExtension export; Ink packaging |
| harness/cli/test/conformance/extensions/api-2/ | harness-cli | contract | frozen append-only corpus + guard test |
| harness/cli/src/services/sensors/ (registry, scheduler, state-store, snapshot, reading) | harness-cli | internal | sensors engine |
| harness/cli/src/adapters/watcher/ (port, node, fake) | harness-cli | contract | fs-watch behind a port |
| harness/cli/src/acts/sensors.ts | harness-cli | internal | sensors verb family act (reserved name) |
| harness/cli/src/services/sensors/tui/ | harness-cli | internal | Ink TUI (lazy-imported module boundary) |
| docs/how/{authoring-extensions-v2,harness-sensors}.md, README.md | harness-cli | internal | docs set |

### Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Kind-routing + runtime `./contract` export already exist (F-01, F-07) | v2 is additive at both seams; zero packaging break |
| 02 | Critical | Workshop E1–E5 pins evolution; corpus immutability is the enforcement (001 §evolution) | corpus + guard test are Phase 1 deliverables, not afterthoughts |
| 03 | High | `.js` loads via native import — no alias hook (F-08) | bare-literal authoring form is load-bearing; scaffold `--js` emits it |
| 04 | High | jiti `alias` unverified on 2.7 (dossier risk) | Phase 1 task 1.1 is the spike |
| 05 | High | Deps are exactly commander+jiti (F-09) | Ink = lazy import + optionalDependencies; Phase 3 spike proves absence-tolerance. Workshop 002 S8 adds **picomatch** (zero-dep) as the third runtime dep for watch globs |
| 06 | High | private-consumer `checks` is a hand-rolled sensor registry; `db`/`boot` hand-roll steps/spawn (H-01..H-04) | port targets prove AC-01/AC-07; `sensors check` supersedes the pattern |
| 07 | Medium | `.harness/temp/` is the gitignored scratch precedent (F-12) | sensors state lives at `.harness/temp/sensors/`; snapshot settled **gitignored** at `.harness/temp/sensors/snapshot.json` (workshop 002 S7; committed team baseline = explicit non-goal) |
| 08 | Medium | `RESERVED_NAMES` gates shadowing (F-13) | add `sensors` in Phase 2 before the act lands |

### Phases

#### Phase Index

| Phase | Title | Primary Domain | Objective (1 line) | Depends On |
|-------|-------|---------------|-------------------|------------|
| 1 | Authoring v2 substrate | harness-cli | Factory, classification, api gate, normalizer, subverbs, scaffold, conformance corpus — v1 untouched | None |
| 2 | Sensors engine (headless) | harness-cli | Sensor kind + registry + scheduler/state/snapshot + `sensors run/--json/watch/snapshot/check` | Phase 1 |
| 3 | TUI + packaging + docs | harness-cli | Ink TUI behind TTY detection, dependency posture, documentation set | Phase 2 |

#### Phase 1: Authoring v2 substrate

**Objective**: Land the new-way contract end-to-end (author → load → classify → gate → normalize → mount → doctor) with the compat promise mechanically enforced, changing zero v1 behaviour.
**Domain**: harness-cli
**Delivers**: v2 types + `defineExtension` runtime export; jiti alias; classification + `E147`/`E148`; `NormalizedExtension` + repointed consumers; nested subverbs with scoped params + variadics; `ctx.exec` timeout/env + `ctx.steps()`; v2 scaffold variants; api-2 conformance corpus + append-only guard; authoring-v2 doc.
**Depends on**: None
**Key risks**: normalizer repoint is wide (mitigated by existing suite + corpus); jiti alias spike may force the resolve-hook fallback.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 1.1 | Spike: prove jiti 2.7 `alias` (or `resolve` fallback) maps `@ai-substrate/engineering-harness/contract` → the core's module for a `.ts` extension in a repo with no node_modules entry; throwaway in scratch | harness-cli | go/no-go verdict + chosen mechanism recorded in execution log | Finding 04 |
| 1.2 | Write failing contract tests: classification table (v1 verb / v1 record / v2 / mixed array), api gate (E147 above-core, E148 unknown-section, unknown-field tolerance), normalizer output shape | harness-cli | tests exist and fail for the right reason | TDD lane |
| 1.3 | v2 types + `defineExtension` + `API_VOCABULARY` in contract.ts; runtime export wired through existing `./contract` map | harness-cli | tsc clean; bare-literal JS shape documented in types | Finding 01 |
| 1.4 | Classification + api gate + v2 validator (`extensions/v2/`); `E147`/`E148` in error-codes table; reserved-but-inert sections (`sensors:`/`custom:` until Phase 2) get an explicit doctor info line — never silently dropped | harness-cli | 1.2 tests green; per-extension failed records carry next_action; a sensors-bearing fixture yields the "declared, handler not yet active" info line | Workshop E1–E5 + E2/E4 no-silent-loss |
| 1.5 | `NormalizedExtension` + v1→current and v2→current normalizers; repoint registry consumers (help, doctor incl. `format:` column, dispatch, instructions) | harness-cli | full existing suite green; doctor shows format v1/v2 | Finding 02 |
| 1.6 | Nested subverb mounting in a v2-aware register act: scoped options/args, shared parent options, kernel empty/unknown-sub envelopes, variadic args as `string[]` — **via a v2-specific context arg typing** (`Record<string, string \| string[] \| undefined>` on the v2/subverb path only); the published v1 `VerbContext.args` union is never widened | harness-cli | AC-03 behaviours proven via fakes; v1 act + v1 `VerbContext` byte-untouched (v1 authors' typecheck unaffected) | Contract decision per validation F2 |
| 1.7 | `ctx.exec` `{timeoutMs, env}` through ExecPort (+fake); `ctx.steps()` step-runner (private-consumer `db` shape) | harness-cli | AC-07 tests green (hung-child kill via fake clock) | Finding 06 |
| 1.8 | Conformance corpus `test/conformance/extensions/api-2/` (factory, bare-literal, subverbs, mixed, error cases, **plus sensor-bearing and custom-bearing fixtures** — normalizer carries them; registration inert until Phase 2) + append-only guard test | harness-cli | AC-05 green; guard fails on fixture edit; reserved-section fixtures load with the info line, not silence | Finding 02 |
| 1.9 | Scaffold v2: default verb, `--sub a,b`, `--wrap`, `--js`; templates emit factory / bare-literal + instructions.md; v1 templates retired from `new` | harness-cli | AC-06 (minus --sensor); scaffolded output loads immediately in a temp fixture repo | |
| 1.10 | Load-proof pass: this repo's 10 extensions + the private consumer's extension suite under the new core; `docs/how/authoring-extensions-v2.md` | harness-cli | AC-01 evidence recorded; doc exists | lightweight lane |

#### Phase 2: Sensors engine (headless)

**Objective**: Sensors as a first-class typed item with a deterministic, fake-provable engine and the full agent-facing verb family — no TUI yet.
**Domain**: harness-cli
**Delivers**: settled sensor/state schema (workshop); SensorDecl/SensorReading; sensor registry; `sensors` reserved; watcher port + scheduler (quiescence, hash dedup, serialize, stale queue); atomic state store + stats + heartbeat; snapshot/trend; `harness sensors run|--json|watch|snapshot|check`; `--sensor` scaffold; `custom.*` registry + `ctx.registry.items()`.
**Depends on**: Phase 1
**Key risks**: watcher semantics on win32 (port + windows-check); state-file schema churn (workshop first).

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 2.1 | Workshop: sensor contract & state schema (SensorDecl/SensorReading fields **incl. `trigger: 'watch' \| 'manual'`**, state-file + stats + heartbeat + snapshot layout, snapshot-vs-git) | harness-cli | workshop doc Approved; Phase 2 tasks consume it | ✅ Done 2026-07-15 — workshop **002** Approved (decisions S1–S12; also settles glob matcher + E210–E217) |
| 2.2 | Write failing tests: sensor registration (registry not verb namespace), run-status vs reading-state separation, state-store atomic write + staleness/age, stats accumulation, snapshot delta | harness-cli | tests fail for the right reason | TDD lane |
| 2.3 | SensorDecl/SensorReading types (api-2 `sensors:` section live) + sensor registry + `sensors` into RESERVED_NAMES; `custom.*` items + `ctx.registry.items(type)` | harness-cli | 2.2 registration tests green; AC-08 partial; workshop D6 behaviour proven | Finding 08 |
| 2.4 | State store + stats + heartbeat at `.harness/temp/sensors/` (atomic rename via fsWrite); snapshot store + trend math | harness-cli | 2.2 state/snapshot tests green; AC-11 math proven | Finding 07 |
| 2.5 | WatcherPort (+node fs.watch recursive impl + recording fake); scheduler: glob match (**declare `picomatch` in package.json dependencies** — 002 S8) → quiescence window → content-hash dedup → per-sensor serialize → single stale-marked queued rerun; hard `timeoutMs` enforcement; **watch loop skips `trigger:'manual'` sensors — they run only via `sensors run <name>`** | harness-cli | AC-10 proven entirely with fakes (watcher+clock), including the manual-trigger skip | spine §B4; 002 S8/S10 |
| 2.6 | `acts/sensors.ts` verb family: `run <name>`, `--json` (state-read only, daemon liveness, honest daemon-down), `watch` (headless loop), `snapshot`, `check` (one-shot run-all; sole non-zero-exit path) | harness-cli | AC-08/09/13 green | AC-13 posture |
| 2.7 | `harness new <name> --sensor` template (wrap-a-command, exit-code reading, guidance field) | harness-cli | AC-06 complete; scaffolded sensor registers + runs | |
| 2.8 | `docs/how/harness-sensors.md` (engine + agent surface half) | harness-cli | doc exists, verified against behaviour | lightweight lane |

#### Phase 3: TUI + packaging + docs

**Objective**: The human surface and the public posture: Ink TUI attached to the daemon state, TTY detection, dependency packaging, docs complete.
**Domain**: harness-cli
**Delivers**: TTY branch (non-TTY bare `sensors` = `--json`); lazy-imported Ink TUI (status lights, trend vs snapshot, cadence, ages, wallclock/avg, guidance line; keys: re-run row, snapshot, quit); `optionalDependencies` posture proven; README section; docs finished.
**Depends on**: Phase 2
**Key risks**: Ink absence/packaging edge (spike first); TUI kept thin (state-render only) so fakes cover logic.

| # | Task | Domain | Success Criteria | Notes |
|---|------|--------|-----------------|-------|
| 3.1 | Spike: Ink lazy dynamic import from `optionalDependencies` — absent-Ink degrades to a clear envelope pointing at install; core commands never load React (measure import graph); throwaway | harness-cli | go/no-go + posture recorded | Finding 05 |
| 3.2 | TTY detection branch in the sensors act: `isTTY` → TUI, else `--json` behaviour; test both via io fakes | harness-cli | AC-12 branch proven | |
| 3.3 | Ink TUI over the state store (read-only renderer + key handlers dispatching to engine verbs); update loop from state-file mtime/heartbeat | harness-cli | manual TTY verification + fake-io unit tests of the view-model; AC-12 complete | lightweight lane for visuals |
| 3.4 | Packaging: `optionalDependencies` (or sibling-package fallback per spike), `files` map, `harness update` path sanity | harness-cli | fresh global install: sensors `--json` works Ink-less; TUI works with Ink present | |
| 3.5 | Docs: README new-way + sensors pitch; finish `harness-sensors.md` (TUI half); mark `authoring-verbs.md` as v1-still-supported | harness-cli | AC-14 complete | |

### Acceptance Coverage Map

| AC | Covered by | Verified in |
|----|-----------|-------------|
| AC-01 | 1.5, 1.10 | existing suites + load-proof evidence |
| AC-02 | 1.3–1.5 | classification tests; doctor format column |
| AC-03 | 1.6 | subverb act tests (fakes) |
| AC-04 | 1.4 | api-gate tests |
| AC-05 | 1.8 | corpus + guard test |
| AC-06 | 1.9, 2.7 | scaffold-loads-immediately fixture test |
| AC-07 | 1.7 | exec/steps tests (fake clock) |
| AC-08 | 2.3, 2.6 | registration + run tests |
| AC-09 | 2.6 | state-read envelope tests |
| AC-10 | 2.5 | scheduler tests (watcher+clock fakes) |
| AC-11 | 2.4 | snapshot math tests |
| AC-12 | 3.2, 3.3 | TTY-branch tests + manual TTY check |
| AC-13 | 2.6 | exit-code tests per verb |
| AC-14 | 1.10, 2.8, 3.5 | docs exist + reviewed |

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| jiti alias fails on 2.7 | Low | Medium | 1.1 spike first; `resolve`-hook fallback; bare literal always works |
| Normalizer repoint regressions | Medium | High | existing suite + corpus before repoint (1.2/1.8 precede 1.5 merge) |
| Ink packaging edge cases (global install, optional absent) | Medium | Medium | 3.1 spike; sibling-package fallback decision recorded |
| win32 watcher divergence | Medium | Medium | WatcherPort + fake for logic; windows-check/CI for the node impl |
| Sensor schema churn after build | Low | Medium | 2.1 workshop settles schema before code |
