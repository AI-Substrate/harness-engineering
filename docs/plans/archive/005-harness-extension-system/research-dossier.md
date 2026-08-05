# Research Report: Harness Extension System

**Generated**: 2026-06-08T02:01:21Z
**Research Query**: "Harness extension system: repo-local `.harness/extensions/` discovered + loaded at runtime by the npx-installed core CLI; each extension contributes CLI verbs (`harness <verb>`) with its own `--help`; retires the temporary `BUILTIN_SLOTS` (Constitution P10). Study pi's plugin/microkernel pattern but ADAPT: our contract is CLI verbs + --help, not agent tools."
**Mode**: Pre-Plan (feeds `/plan-1b`)
**Location**: docs/plans/005-harness-extension-system/research-dossier.md
**FlowSpace**: Available but markdown-only graph (does not index `harness/cli/` TS) → internal research done with standard tools
**Findings**: 4 parallel explore agents (pi internals PI-01..16, pi authoring EX-01..14, constraints CN-01..09, prior learnings PL-01..09, install model IM-01..10) + first-hand reading of our CLI kernel
**Research subagents**: `pi-internals`, `pi-authoring`, `constraints-priors` (explore) + orchestrator reading

---

## Executive Summary

### What we're building
The **second half of the harness product**. The core CLI (plan 004) ships as the npx-installed front door with no real verbs — only 8 temporary `unconfigured` stubs. This plan builds the **extension system**: in a developer's *own* repo, a `.harness/extensions/` folder (mirroring pi's `.pi/extensions/`) is **discovered and loaded at runtime**, and each extension **contributes a CLI verb** (`harness <verb>`) with its own `--help`, options, and structured output. When this lands, the temporary `BUILTIN_SLOTS` are removed and verbs become entirely extension-owned (Constitution **P10**).

### Why this is the focal point
The whole harness thesis is "productise the engineering environment" — make the supported path **discoverable** and **extensible** so teams encode fixes (not memory) into a focal CLI. The extension system *is* that extensibility surface: it's how a team turns `harness build`/`test`/`smoke`/`seed` from aspiration into reality, each verb wrapping a real repo command (Constitution **P8** "wrap, don't rebuild").

### Key Insights
1. **The seam was pre-built and pre-validated.** Plan 004 deliberately shaped the kernel for exactly this: `CommandSlot.name` is an open `string` (no closed union), `loadSlotRegistry(_fs: FsPort)` already takes the filesystem port "so a future loader can read repo-local extension config," `handler?` is reserved as "the only field extensions add," and workshop 002 §"Forward-compatibility" already maps every pi concept to a seam in our design and reserves a **`ModuleLoaderPort`** adapter. No unpick is required.
2. **pi's *command* surface is our model — its *agent-tool/event* surface is not.** pi extensions mostly register agent tools and lifecycle event handlers for an LLM. Our extensions register **CLI verbs**. pi's `registerCommand`/`registerFlag` is the closest analog, but it's thin (a command is just `{name, description?, handler(args: string, ctx)}` — `args` is a raw string, not parsed argv, and there's no per-command options schema or rich `--help`). We must **add** structured argv parsing, verb-scoped option schemas, real `--help`, and the JSON/human envelope + exit-code contract.
3. **Loading is the biggest open decision.** pi loads `.ts` with **jiti** (zero-build, `moduleCache:false` for hot reload) and injects host module singletons. We could do the same (jiti is already reserved in `dependencies`), or require **compiled `.js`**, or use native Node TS stripping. This choice drives ergonomics (author `.ts` with no build step) vs. runtime weight, cold-start cost, and the trust/security surface — and it forces `main()` to become **async** (load before commander parses).
4. **`doctor` stays core and becomes extension-aware.** Constitution P7 already says `doctor` "enumerates and validates the installed extensions." This is the diagnostic that makes a runtime-loaded, repo-owned plugin surface safe to operate: it lists what was found, what loaded, what failed, and why — without invoking anything.

### Quick Stats
- **Reuse**: HIGH — the kernel's act/service/adapter seam, envelope/exit contract, and slot registry were designed for this. New code is concentrated in a loader adapter + discovery service + a verb contract + making help/doctor dynamic.
- **External dependency in play**: `jiti` (candidate, already pre-approved for `dependencies`); otherwise zero new runtime deps beyond `commander`.
- **Prior learnings**: 9 directly relevant (npx/bin-symlink/ESM/open-registry/F005 smoke).
- **Domains**: No domain registry in this repo (`docs/domains/` absent) — boundaries are expressed via the hexagonal ports/acts/services layering instead.
- **Agent harness**: UNAVAILABLE — no `docs/project-rules/engineering-harness.md`; this is a CLI-library project whose "boot" equivalent is `harness doctor`. Standard testing (Vitest + fakes).

---

## How pi's Extension System Works (condensed, CLI-relevant lens)

pi is a **microkernel / plugin architecture**: small core, behaviour added by independently-loaded plugins via **inversion of control**, a **collect-then-dispatch** split, an **event bus**, **façade + late binding** for capability injection, and **module substitution** so plugins share host singletons.

| Concern | How pi does it | Citation |
|---|---|---|
| **Discovery** | Scan `cwd/.pi/extensions/`, then `~/.pi/agent/extensions/`, then configured paths. **One level only**; per dir: direct `*.ts\|*.js` → subdir `package.json` `pi.extensions[]` manifest → subdir `index.ts\|index.js`. Symlinks followed; dedup by resolved absolute path. | PI-1, PI-2 (`loader.ts:460-600`, `:440-489`) |
| **Loading** | `jiti` (zero-build TS), `moduleCache:false` (hot reload); Node/dev uses `alias` to real paths, Bun binary uses `virtualModules`. Default export is a **factory** `(pi: ExtensionAPI) => void \| Promise<void>`; async factories are awaited before startup proceeds. | PI-3, PI-5 (`loader.ts:331-343`, `:340-385`; `types.ts:1091-1151`) |
| **Module substitution** | Loader statically imports bundled copies of shared libs and exposes them to plugins so `instanceof`/singleton identity holds (schema libs especially). | PI-4 (`loader.ts:16-25,43-61,91-113`) |
| **Command contract** | `RegisteredCommand = { name, sourceInfo, description?, getArgumentCompletions?, handler(args: string, ctx: ExtensionCommandContext): Promise<void> }`. **`args` is a raw string**, no structured argv; `description` is the only built-in help text. | PI-7, PI-8 (`types.ts:1070-1078,1149-1152`) |
| **Flags** | `registerFlag(name, {description?, type:'boolean'\|'string', default?})` — simple **global** toggles, not verb-scoped option schemas. | PI-15 (`loader.ts:221-230`, `types.ts:1162-1173`) |
| **Two-phase init** | Runtime starts as **throwing stubs**; only registration is legal during load (actions throw "cannot be called during extension loading"); real impls bound later via `bindCore`, queued work flushed. | PI-6 (`loader.ts:120-167`, `runner.ts:269-339`) |
| **Capability injection** | `pi` façade (registration + actions) + per-call `ctx` with **lazy getters** + `assertActive()` **staleness guard** (captured `ctx` throws after reload, never silently corrupts). | PI-11, PI-12 (`runner.ts:578-681`, `:471-478`) |
| **Dispatch** | Parse `/name args`, look up extension command, `await command.handler(args, ctx)`; **errors caught per-handler**, emitted not fatal. | PI-10, PI-14 (`agent-session.ts:1142-1165`, `runner.ts:693-839`) |
| **Collisions** | All kept; duplicate names get invocation **suffixes** in load order (`name:1`, `name:2`). "First registration wins" enables builtin override. | PI-9 (`runner.ts:517-550`) |
| **Provenance** | Every registered command/tool carries `sourceInfo` (builtin vs sdk vs extension) — no name-parsing to tell origin. | PI-13 (`loader.ts:348-365`) |
| **Distribution** | Runtime deps in `dependencies` (installed extensions use `npm install --omit=dev`); peerDependencies for host-shared libs. | PI-16 (`docs/extensions.md:147-150`) |

**What real pi extensions look like** (authoring ergonomics — EX-01..14): a typical extension is a folder with `index.ts` (the factory + registration wiring), `store.ts` (pi-free persistence/logic, unit-tested), `AGENTS.md` (the authoring contract + guardrails), `smoke.ts` (deterministic scenario), and `*.test.ts` (Vitest with small fakes). `session-sql` is the **clearest CLI-verb analog** (EX-7): `pi.registerCommand("sql", …)` where empty args → status, `schema`/`reset` sub-verbs, else execute — backed by a `store.ts` that owns paths/schema. The verb's help is **hand-authored text** in the store (e.g. `peacockHelpText()`, EX-6) and the command **parses its own args string** (`parseTodoCommand`, EX-5). Persistence is repo/session-local (session SQLite under a root dir, or append-only entries). **Pain points to improve for us** (EX wishlist): no scaffold command, no typed verb contract, hand-rolled arg parsing + help per extension, hand-built fakes.

---

## Our Current Extension Seam (first-hand, `harness/cli/`)

The kernel is a clean hexagonal **entrypoint → act → service → adapter** CLI on `commander`, ESM, single root `package.json` (only runtime dep: `commander`).

**The verb-registration contract an extension verb must satisfy:**

1. **Registration = a commander subcommand.** `registerSlotAct` (`src/acts/unconfigured-slot.ts:14-23`) is the template: `program.command(name).description(desc)` + `.option(...)` + `.action(cb)`. An extension verb is exactly this shape, plus `--help` (commander generates it from description/options/args).
2. **A verb's action produces an `Envelope` and exits through the kernel.** `Envelope` (`src/output/envelope.ts:15-28`) = `{command, status, timestamp(from Clock), data?, error?, evidence?, next_action?}`. Status is one of `ok | error | degraded | unconfigured`. Constructors `formatOk/formatDegraded/formatUnconfigured/formatError` enforce that **every non-`ok` status carries `next_action`**.
3. **Status → exit code is fixed** (`src/output/exit.ts:5-20`): `ok/degraded → 0`, `unconfigured → 2`, `error → 1`. Only `exitWithEnvelope` calls `process.exit` — the single kernel exit point. A verb handler must **never** call `process.exit`/`console.log` itself.
4. **Output is dual-mode** (JSON vs human) resolved **once** in `main()` from `--json/--no-json/HARNESS_JSON/TTY` (`src/app.ts:99-101`) and injected as `io` — acts never re-derive it.
5. **`help` is registry-driven** (`src/services/help/help-service.ts:45-58`): `buildHelp(registry)` lists each slot's `{name,status,description,next_action}` for `help --json`, and `renderHelpText` for humans. **Today it reads `BUILTIN_SLOTS`; the loader must feed discovered verbs here.**
6. **`doctor` is registry-aware** (`src/services/doctor/doctor-service.ts:63-78`): `checkCommandSlots` reports configured/unconfigured counts as a layer. P7 wants this to **enumerate + validate installed extensions** (loaded/failed/why).
7. **The composition root** is `buildProgram(version, io)` + `main(argv)` (`src/app.ts:76-123`): registers help/doctor/run acts, then loops `builtinSlots()` registering a stub act per slot, then `program.parse(argv)`. **This is the single place the loader plugs in** — replace `builtinSlots()` with discovered verbs.
8. **The reserved seam, in code, today:**
   - `CommandSlot.name: string` is deliberately open (no closed union) with a `// FUTURE (extension system): handler?: (ctx) => Envelope;` (`src/services/slots/slot-registry.ts:16-27`).
   - `loadSlotRegistry(_fs: FsPort)` already takes the FS port (`:109-111`) — comment: "so a future loader can read repo-local extension config and merge handlers."
   - `validateCommandMap` (`src/services/config/load-config.ts:25`) validates the registry before use and explicitly notes "the FsPort-fed loader is deferred to the extension system."
   - `BUILTIN_SLOTS` is documented as "⚠️ TEMPORARY SCAFFOLDING — NOT the permanent design (Constitution P10) … SLATED FOR REMOVAL."
9. **ESM path realities (precedent set by the kernel):** `version.ts` resolves `package.json` via `new URL('../../../package.json', import.meta.url)` — a path that holds **both in-repo and when installed via npx**. The bin (`src/index.ts`) calls `main()` **unconditionally** (no `isMain` guard) because the npm/npx bin **symlink** breaks `argv[1] === import.meta.url` (F005). The loader must respect both: resolve the *developer's* `.harness/` from **`process.cwd()`**, not from the installed package location.

**Gaps the loader introduces (concrete):**
- `FsPort` is read-only with only `exists`/`readText` (`src/adapters/fs/fs-port.ts:7-12`) — discovery needs **directory listing** (`readdir`) and a **cwd** source (a `ProcessPort.cwd()` or similar).
- A new **`ModuleLoaderPort`** adapter (dynamic import / jiti) — already named in workshop 002:453.
- A **discovery service** + a richer **verb contract** (name, description, help/usage, options, args, handler).
- `main()` likely becomes **async** (await discovery+load before `program.parse`).
- New **error codes** for load failures (current table stops at `E130`; e.g. `E140 EXTENSION_LOAD_FAILED`).
- `help`/`doctor`/`run` must source verbs from the loaded registry, and `BUILTIN_SLOTS` is removed.

---

## The Adaptation Delta — CLI Verbs vs Agent Tools (the crux)

| Dimension | pi (agent tools/commands) | harness (CLI verbs) — what we need |
|---|---|---|
| **Invocation** | `/name args` inside an interactive agent loop | `harness <verb> [args] [--opts]` from a shell / agent shell call |
| **Arg parsing** | raw `args: string`, extension parses it (PI-7, EX-5) | **structured argv + verb-scoped options** via commander (or equivalent) |
| **Help** | one `description` line (PI-8) | real `--help`: usage, args, options, examples |
| **Output** | side-effects via `ctx.ui`/notifications | **`Envelope`** (JSON + human) — `formatOk/...` |
| **Exit semantics** | n/a (stays in agent loop) | **exit codes 0/1/2** (P6) via `exitWithEnvelope` |
| **Capability injection** | `pi`/`ctx` with ui/model/session/runtime | **our ports** (fs, process/**exec**, git, env, clock, cwd, output) — verbs *wrap real repo commands* (P8), so an exec capability is central |
| **Lifecycle/events** | rich event bus (tool_call/context/etc.) | **drop** — not needed for verbs (maybe a tiny `boot`/`doctor` contribution hook later) |
| **Collision policy** | keep all, auto-suffix | **decide**: reserve core names (`help`,`doctor`), then error / last-wins / suffix |

**Keep from pi**: shallow deterministic discovery; (optional) zero-build TS loading; per-handler error isolation; source provenance; the collect-vs-dispatch split (we already have it via commander register vs `.action`); async load awaited before dispatch.
**Drop**: the LLM tool/event surface, `ctx.ui`, session/model/runtime mutation, global flags-as-toggles, module-substitution for schema libs (no shared schema-lib identity concern for CLI verbs unless we hand extensions a typed contract module).
**Add**: structured argv + verb-scoped option schemas, real `--help`, the Envelope+exit contract, a `ctx` built from our ports (incl. an exec capability to wrap repo commands), and an extension-aware `help`/`doctor`.

---

## Constraints (must honour)

| ID | Constraint | Source | Implication |
|---|---|---|---|
| **CN-01** | **P10 — verbs are dynamic + extension-owned; core hardcodes no verb list; runtime deps in `dependencies`.** | `constitution.md:118-126` | No closed `SlotName` union; loader must run under `npx --omit=dev`; `BUILTIN_SLOTS` removed when loader lands. |
| **CN-02** | **P2 — hexagonal**: business logic depends only on ports; no direct `node:fs`/exec in services/acts. | `constitution.md`, `architecture.md:135` | Discovery/loading goes **behind an adapter+port** (`ModuleLoaderPort`, extended `FsPort`), never inline. |
| **CN-03** | **P3 — fakes over mocks**: ports first; tests use full fakes, no `vi.mock`. | `constitution.md` | Loader/discovery need fake-able FS + module-loader seams. |
| **CN-04** | **P4 — CLI is the API**: stable envelope + agent-friendly `--help`. | `constitution.md` | Verbs must surface `--help` and emit canonical envelopes. |
| **CN-05** | **P5 — honesty**: missing/disabled behaviour → `unconfigured` + `next_action` + exit 2. | `constitution.md` | Absent/failed extensions fail honestly, never as success. |
| **CN-06** | **P6 — exit codes** are contract: 0/1/2. | `constitution.md`, `exit.ts:5-10` | Loader/dispatcher preserve exit semantics for verbs. |
| **CN-07** | **P7 — `doctor` is core** and enumerates + validates installed extensions. | `constitution.md:100-104` | Discovery must yield **inspectable metadata** (name/help/status/origin/error) without invoking. |
| **CN-08** | **P8 — wrap, don't rebuild**: verbs map onto real repo commands; core doesn't own the mapping. | `constitution.md:106-110` | The verb `ctx` needs an **exec** capability; reuse over reinvention (harness memory). |
| **CN-09** | **Packaging**: root `package.json` + `bin` + `prepare`; all source under `harness/cli/`; runtime-vs-dev dep discipline. | `architecture.md:97-102` | Loader survives installed tarball layout + symlinked bin + `--omit=dev`. |
| **CN-10** | **No closed verb union / no permanent built-in list.** | `architecture.md:140-141` | Registry stays keyed by `name: string`. |

---

## Prior Learnings (institutional knowledge)

| ID | Learning | Source | Action for this work |
|---|---|---|---|
| **PL-01** | npx-from-repo-URL relies on root `package.json` (`bin`+`prepare`); source under `harness/cli/`. | plan `:72-75` | Keep loader compatible with root-package install topology. |
| **PL-02** | The envelope + exit-code contract is the dependency of every command/loader. | plan `:74-76` | Loader/verbs emit the **same** envelope/exit contract. |
| **PL-03** | Hexagonal layering + fakes are what make the core testable. | plan `:77-78` | Introduce loader via a port→adapter seam with fake coverage. |
| **PL-04** | Built-in slots are temporary; don't assert a fixed 8-slot list. | plan `:162-163` | Remove `BUILTIN_SLOTS`; design dynamic discovery. |
| **PL-05** | Workshop Q4: registry kept **open** (`name: string`, no closed union). | workshop 002 §Q4/Decision | Preserve append/override flexibility. |
| **PL-06** | Workshop Q3: repo-local config reads **deferred**, but `FsPort` kept in the seam. | workshop 002 §extension seam | Loader consumes `.harness/extensions/` via the injected FS. |
| **PL-07** | **F005**: ESM `isMain` broke under the npm/npx bin **symlink**; fix = thin `index.ts` calling `main()` unconditionally. | phase-2 exec log `:108-113` | Loader/bootstraps must **not** rely on `argv[1] === import.meta.url`. |
| **PL-08** | package-smoke proved the installed bin via the `node_modules/.bin/harness` symlink. | phase-3 exec log `:45-49` | Loader paths must work from the **symlinked installed bin**, not just local dev — add a packaging smoke that loads a fixture extension. |
| **PL-09** | doctor/help consume an **injected** registry; doctor reads dist presence + registry state with fakes. | phase-2 exec log `:73-78` | Extension discovery must be visible to doctor **without** real side effects. |

---

## Install & Discovery Model

- **IM-01 — Two parts, by design.** "Core — installed via NPX, upgradeable. Extensions — created per repo, gathered at runtime." (`docs/harness-basics/intro-to-harness.md:246-264`). The install skill is meant to run a harnessability survey and recommend first extensions (test/build/lint).
- **IM-02 — Core is minimal on install** and is the front door; extensions are repo-local behaviour. (`architecture.md:13-14,105-113`).
- **IM-03 — Discovery starts from the developer's `process.cwd()`**, locating that repo's **`.harness/extensions/`** — NOT the installed package dir. (Mirrors pi's `cwd/.pi/extensions/`.)
- **IM-04 — Loader lives in runtime `dependencies`** (`--omit=dev` safe). `jiti` is the pre-approved candidate transpiler if we load `.ts`.
- **IM-05 — Seam shape**: a `ModuleLoaderPort` + extended `FsPort` feed a discovery service that yields a verb registry. (workshop 002:453, `:448`).
- **IM-06 — Resolution mechanism is open**: load `.ts` via jiti (pi-style, best ergonomics) **or** require compiled `.js` **or** native Node TS stripping. Each has different cold-start/dep/security trade-offs. **Spec must decide.**
- **IM-07 — Trust/security**: the core executes **arbitrary code from the user's repo**. pi's posture is "trust the repo" (no sandbox). We likely match that, but should add: provenance in `doctor`, isolated per-extension load errors, and possibly a `--no-extensions` safe mode.
- **IM-08 — doctor-inspectable**: discovery yields metadata (verb, help, status, origin, load error) before any invocation (P7).
- **IM-09 — Symlinked-bin safe**: no `import.meta.url`-equality assumptions; resolve from cwd (F005/PL-07).
- **IM-10 — Open questions for the spec** (see next section).

---

## Design Decision Space & Open Questions (for `/plan-1b` and a likely workshop)

1. **Loading mechanism** — jiti `.ts` (zero-build, pi parity, hot reload, +1 runtime dep, transpile cost per cold invocation) **vs** compiled `.js` (simplest, no new dep, but authors need a build step) **vs** native Node `--experimental-strip-types` (no dep, but Node-version-gated). *Biggest decision; drives ergonomics + security + cold-start.*
2. **Verb contract shape** — declarative default-export object `{ name, description, usage, options[], args[], handler(ctx) }` (maps cleanly to commander; easy to validate + doctor) **vs** pi-style imperative factory `(harness) => harness.registerVerb({...})` (more flexible, can register multiple verbs / sub-verbs). *Affects authoring ergonomics + how help is generated.*
3. **`ctx` capability set** — which ports does a verb handler receive? Minimum: `fs`, `exec`/`process`, `git`, `env`, `clock`, `cwd`, plus an output/`evidence` helper. Handler **returns an `Envelope`** (no direct exit). Confirm the exec capability (verbs wrap real commands, P8).
4. **Discovery rules** — `.harness/extensions/*` one level; direct file vs `index.ts` vs `package.json` manifest? A global `~/.harness/extensions/`? An explicit allow-list/config file? Dedup + ordering + collision policy (reserve `help`/`doctor`; then error / last-wins / suffix?).
5. **Sync vs async kernel** — loading + (await) async factories means `main()` becomes async and discovery runs **before** `program.parse`. Confirm the restructure of `app.ts`.
6. **Failure isolation + honesty** — a malformed/throwing extension must not crash the CLI: skip it, surface it in `doctor` (and exit-2/`unconfigured` if the requested verb is the broken one). Decide the error taxonomy (`E140…`).
7. **Removing `BUILTIN_SLOTS`** — sequence the retirement: `help`/`doctor`/`run` source verbs from the loaded registry; `run <slot>` dispatcher semantics when verbs are real; what `harness` (bare) and an empty `.harness/` show (honest "no extensions installed yet" + `next_action`).
8. **Performance / caching** — transpiling on every invocation has a token/time cost (the very thing the harness exists to reduce). Consider a compiled cache, or compiled-`.js` default with `.ts` opt-in.
9. **Authoring ergonomics** — a `harness` scaffold for a new extension (index/store/test/smoke/AGENTS), a **typed verb contract** module handed to authors, and **test fakes** for the verb `ctx` (the EX wishlist). Possibly its own phase.
10. **State/persistence convention** — do harness extensions get a sanctioned repo-local state location (pi uses session SQLite / append-only entries)? Likely out-of-scope v1 (verbs mostly wrap commands), but worth a note.

---

## Workshop Opportunities

- **WS-A — The extension contract & loader architecture** (strongly recommended). Pin: loading mechanism (jiti vs compiled vs native), the verb contract shape, the `ctx`/ports set, discovery rules, collision policy, and the async-`main` restructure. This is the highest-leverage design decision in the plan; resolving it in a workshop de-risks `/plan-3`.
- **WS-B — Retiring `BUILTIN_SLOTS` + extension-aware help/doctor/run** (optional). The sequencing of removing scaffolding without breaking the output/exit contract, and how `doctor` enumerates/validates extensions.
- **WS-C — Authoring ergonomics** (optional). Scaffold command, typed contract, test fakes, a canonical example extension to copy.

---

## External Research Opportunities

### Research Opportunity 1: TS-loading mechanism for a distributed npx CLI in 2024+
**Why Needed**: The single biggest open decision (IM-06, Q1) is how the npx-installed core loads repo-local extensions. Options moved fast recently (jiti v2, native Node `--experimental-strip-types`/`--experimental-transform-types` on Node 22/23, `tsx`).
**Impact**: Drives a runtime dependency, cold-start cost, Node-version floor, and the security surface.
**Source Findings**: IM-04, IM-06, PI-3, CN-09.
**Ready-to-use prompt:**
```
/deepresearch "For a Node 20/22 ESM CLI distributed via `npx github:org/repo` (installed with --omit=dev), I need to load repo-local plugin files from the *consumer's* cwd (./.harness/extensions/*) at runtime, where plugins may be authored in TypeScript. Compare in 2024-2025 terms: (a) jiti v2, (b) tsx, (c) native Node --experimental-strip-types / type-stripping, (d) requiring authors to ship compiled .js. For each: cold-start/transpile cost per invocation, ESM interop + import.meta support, ability to resolve the plugin's OWN node_modules, Node version floor, maintenance/risk, and security implications of executing arbitrary repo code. Recommend a default with a migration path. Cite docs and benchmarks."
```
**Results location**: `docs/plans/005-harness-extension-system/external-research/ts-loading-mechanism.md`

### Research Opportunity 2: Secure/robust plugin loading patterns for Node CLIs
**Why Needed**: The core executes arbitrary code from the user's repo (IM-07). Need the industry norm (trust vs sandbox) and failure-isolation patterns.
**Impact**: Sets the trust model, `--no-extensions` safe mode, per-extension isolation, and `doctor` diagnostics.
**Source Findings**: IM-07, PI-14, CN-07.
**Ready-to-use prompt:**
```
/deepresearch "Survey how mature Node.js tools that load plugins from the user's project (ESLint, Prettier, Vite, Rollup, Babel, Jest) handle: trust model (do they sandbox plugin code or trust the repo?), per-plugin error isolation so one bad plugin doesn't crash the CLI, surfacing load errors/provenance to users, and any opt-out/safe-mode. Then recommend a pragmatic trust + isolation + diagnostics model for a CLI that dynamically registers subcommands from ./.harness/extensions/. Include whether worker_threads/vm sandboxing is worth it for a dev-tool. Cite sources."
```
**Results location**: `docs/plans/005-harness-extension-system/external-research/secure-plugin-loading.md`

---

## Recommendations

**If building this system:**
1. **Honor the pre-built seam** — extend `FsPort` (add `readdir`), add a `ModuleLoaderPort` + cwd source, replace `builtinSlots()` in `buildProgram` with a discovered registry, make `help`/`doctor`/`run` registry-driven, and **remove `BUILTIN_SLOTS`** (CN-01/PL-04). Don't reshape the act/service/output kernel (workshop 002 invariant).
2. **Adopt pi's *structure*, not its *surface*** — discovery → collect → (bind) → dispatch; per-extension error isolation; provenance; async load awaited before parse. But define a **CLI-verb contract** (structured argv, options, real `--help`, Envelope return, exit codes) rather than pi's raw-string `args` + one-line description.
3. **Decide loading + contract shape in a workshop (WS-A) before `/plan-3`** — these two choices ripple through every later phase.
4. **Make `doctor` the safety net** — enumerate/validate extensions (name, help, status, origin, load error) with no invocation (P7), and add a packaging smoke that loads a fixture extension via the installed symlinked bin (PL-08).
5. **Keep verbs as wrappers** — the `ctx` exec capability is what lets a verb map onto a real repo command (P8), which is the whole point of the harness.

**If extending later:** an authoring scaffold + typed contract + test fakes (EX wishlist) is a natural follow-on phase.

---

## Next Steps

This is a **read-only research dossier**. Recommended sequence:
1. *(Optional)* Run the two `/deepresearch` prompts above and save under `external-research/` — especially Opportunity 1 (loading mechanism), which is the pivotal decision.
2. Run **`/plan-1b`** to write the spec (the two open external questions will be flagged as soft warnings if unaddressed).
3. Given the loader/contract design weight, a **`/plan-2c` workshop (WS-A)** before `/plan-3` is strongly recommended.

---

**Research Complete**: 2026-06-08T02:01:21Z
**Report Location**: docs/plans/005-harness-extension-system/research-dossier.md
