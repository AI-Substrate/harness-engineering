# Research Dossier: Extension system internals for the typed-extensions + sensors build

**Generated**: 2026-07-14T05:30:00Z
**Query**: "How the harness CLI's extension loading, command mounting, validation, scaffolding, packaging, and state-dir infrastructure work — to bound the typed-extensions factory refactor + harness sensors plan"
**Effort**: Standard
**Tools**: Standard
**Evidence**: 13 current sources · 4 historical sources

## Answer

1. The v2 discrimination seam already exists and is one function: `registry.ts` coerces the default export to a list and routes each entry by `kind` (`'record'` vs verb-default); adding the `'extension'` arm + a normalize-after-load step touches `buildExtensionRegistry` and nothing downstream **if** downstream consumers are repointed at a `NormalizedExtension` shape.
2. Commander mounting is one thin act (`registerVerbAct`) — one flat `program.command()` per verb, grouped under `helpGroup('Extensions:')`. Subverbs are a new v2-aware register path using commander's nested `command.command()`; the v1 path stays byte-identical.
3. `./contract` in the exports map **already resolves to a runtime `.js`** (`dist/services/extensions/contract.js`) — `defineExtension` is an additive runtime export with zero packaging change. The jiti loader (`createJiti(import.meta.url, { moduleCache: false })`) can alias the specifier for `.ts` extensions; `.js` extensions load via native `import()` (no alias hook), confirming the workshop's bare-literal escape hatch as a hard requirement, not a nicety.
4. Validation is single-sourced in `verbShapeIssues` (`load-config.ts`) — including the v1 variadic rejection, which is therefore liftable on a v2-only path without touching v1 behaviour.
5. The capability-injection pattern for `ctx` growth is established (optional `fsWrite`/`background` spread by presence); `ctx.steps()` / `ctx.registry` / exec `timeoutMs` follow it. `ctx.exec` today passes only `cwd` to `ExecPort.run` — the timeout/env gap the private consumer's `boot` worked around is confirmed at the port signature.
6. Runtime dependencies are exactly `commander@^15` + `jiti@2.7.0`. Adding Ink+React is a material policy decision — it must be lazy-imported on the TTY path and probably optional at install.
7. Sensors state has a precedent home: `.harness/temp/` is the established gitignored scratch (observe service), so `.harness/temp/sensors/` needs no new gitignore/doctrine.

## Evidence

| ID | Finding | Evidence | Planning implication | Confidence |
|----|---------|----------|----------------------|------------|
| F-01 | Exports route per-entry by `kind`; `'record'` is the proven second arm | `harness/cli/src/services/extensions/registry.ts:108-117`, `contract.ts:154-157` | `kind:'extension'` is arm #3 of an existing switch, not new machinery | High |
| F-02 | Default export coerced to a list; each entry routed independently | `registry.ts:199-208` (`coerceExports`) | Mixed v1+v2 arrays work with zero special-casing | High |
| F-03 | Shape validation single-sourced; v1 variadic rejection localized there | `harness/cli/src/services/config/load-config.ts:31-33,73-91` | v2 validator sits beside it; variadics unlock on the v2 path only | High |
| F-04 | One flat commander command per verb; extension help grouped | `harness/cli/src/acts/verb.ts:45-62` | Subverb mounting = new register path via nested `command.command()`; v1 act untouched | High |
| F-05 | `ctx` capability growth by optional presence-spread (`fsWrite`, `background`) | `harness/cli/src/services/extensions/verb-context.ts:51-52` | `ctx.steps()` / `ctx.registry` follow the proven pattern; feature-detect stays the doctrine | High |
| F-06 | `ctx.exec` forwards only `cwd`; no timeout/env at the port | `verb-context.ts:48-49` | Confirms spine A4: `timeoutMs`+env land in `ExecPort.run` options; deletes private-consumer boot's spawn wrapper | High |
| F-07 | `./contract` export already serves runtime `.js` + `.d.ts` | `package.json:16-20` | `defineExtension` is additive — no packaging or consumer break | High |
| F-08 | jiti loads `.ts` (`moduleCache:false`); `.js` via native `import()`, no alias hook | `harness/cli/src/adapters/loader/` (JitiLoader) | Alias the contract specifier for `.ts`; `.js` authors need the bare-literal form (workshop D5-a is load-bearing) | High |
| F-09 | Runtime deps are exactly `commander` + `jiti` | `package.json:52-55` | Ink+React is a dependency-policy decision the plan must settle (lazy import, likely optionalDependency) | High |
| F-10 | Scaffolder is variant-based with name/wrap safety patterns; `record` variant precedent | `harness/cli/src/services/scaffold/scaffold-service.ts` | v2 + `--sensor` + `--sub` = new variants in `templates.ts`; validation reused | High |
| F-11 | Record contract shows the reserved-deferred-fields growth idiom | `harness/cli/src/services/record/contract.ts:34-37` | Same idiom for SensorDecl growth (threshold/trigger reserved fields) | Medium |
| F-12 | `.harness/temp/` is the established gitignored scratch dir | `harness/cli/src/services/observe/observe-service.ts:304` | Sensors state → `.harness/temp/sensors/` (heartbeat, per-sensor readings, snapshot) | High |
| F-13 | `RESERVED_NAMES` gates core-command shadowing | `registry.ts:47-58` | Add `sensors` before any extension claims it | High |

## Historical Evidence

| ID | Prior friction / decision | Source | Applicability now | Implication |
|----|---------------------------|--------|-------------------|-------------|
| H-01 | Hand-rolled subverb dispatch (`switch (ctx.args.verb)`, `""`→unconfigured, `E_UNKNOWN_VERB`) duplicated per extension | `<private-consumer>/.harness/extensions/db/extension.ts:86-100`, `shopify/extension.ts:261-296` (15 cases, 3,744 lines) | Direct | Kernel-owned subverb dispatch is the highest-leverage deletion; port targets for the conformance proof |
| H-02 | `ctx.exec`'s missing timeout/env forced a 60-line bounded-spawn wrapper | `<private-consumer>/.../boot/extension.ts:33-113` | Direct | A4 fix deletes it; boot is the second port target |
| H-03 | A sensor registry hand-rolled in userland (`SENSORS: SensorSpec[]`, run-all, skip-safe, secret-hygiene) | `<private-consumer>/.../checks/extension.ts:63-120` | Direct | `harness sensors` + a fold-over-sensors `checks` is promotion of proven userland design, not invention |
| H-04 | Step-runner (timing, ✅/❌ rollup, `fail()` aggregation) private to one extension | `<private-consumer>/.../db/extension.ts:58-63,147-231,304-312` | Direct | `ctx.steps()` API should match this proven shape |

## Risks and Unknowns

| Item | Evidence | Why it matters | Resolution / next evidence |
|------|----------|----------------|----------------------------|
| jiti `alias` for the contract specifier unverified against jiti 2.7 | F-08; jiti docs claim `alias` option | If alias fails, `.ts` factory imports break in repos without the package installed | Phase-0-grade spike: one throwaway extension importing the aliased specifier through JitiLoader |
| Ink+React dependency weight vs 2-dep discipline | F-09 | TUI choice could double install size for non-TUI users | Plan decision: lazy dynamic import + `optionalDependencies` (or a sibling package); settle at plan, verify at implement |
| Windows watcher semantics for sensors | repo has a `windows-check` extension (`.harness/extensions/windows-check`) | `fs.watch` recursive + atomic-rename patterns differ on win32 | Keep watcher behind a port (like ExecPort); windows-check covers it in CI |
| Two-writer hazard on this plan folder (governance, not code) | pij seat conflict, this session | Concurrent plan writes would corrupt the flow | Resolved procedurally: this seat is the sole writer per Jordan's direct ruling; jay holds |

## Planning Handoff

- **Preserve**: v1 load path byte-identical (contract.ts shapes, `verbShapeIssues` v1 semantics, discovery folder rules, `RESERVED_NAMES` behaviour, Envelope/exit mapping, `helpGroup('Extensions:')` UX).
- **Change carefully**: `buildExtensionRegistry` (add arm + normalize step — every downstream consumer repoints to `NormalizedExtension`); `acts/verb.ts` (new nested-register path beside, not inside, the v1 act); `ExecPort.run` options (additive `timeoutMs`/`env`); package `exports` (additive runtime export only).
- **Likely files/symbols**: `services/extensions/{contract,registry,verb-context}.ts`, new `services/extensions/v2/` (types, validator, normalizer), `acts/verb.ts` + new `acts/sensors.ts`, `services/scaffold/templates.ts`, new `services/sensors/` (scheduler, state-store, snapshot), `adapters/loader/` (alias), `adapters/exec/exec-port.ts`, `package.json` exports/deps, `test/conformance/extensions/api-2/` (frozen corpus).
- **Decisions still required**: Ink packaging (lazy + optional vs sibling package); watcher library posture (native `fs.watch` first, port-wrapped); sensors state-file schema (spine E1); `checks`-style aggregation as core verb vs scaffolded extension (spine E4); snapshot location relative to git (spine E5).
