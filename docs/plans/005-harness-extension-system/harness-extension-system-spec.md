# Harness Extension System

**Mode**: Simple
**Plan**: docs/plans/005-harness-extension-system
**Status**: Specifying
📚 Specification incorporates findings from `research-dossier.md`.

## Research Context

The core CLI (plan 004) ships as the npx-installed front door with **no real verbs** — only 8 temporary `unconfigured` stubs (`BUILTIN_SLOTS`) that demonstrate the output/exit contract. The research dossier confirms the kernel was **pre-shaped** for this feature: `CommandSlot.name` is an open `string` (no closed union), `loadSlotRegistry(_fs: FsPort)` already takes the filesystem port "so a future loader can read repo-local extension config," `handler?` is reserved as "the only field extensions add," and workshop 002 already maps every pi concept to a seam in our design and **reserves a `ModuleLoaderPort` adapter**. Authority: Constitution **P10** (verbs are dynamic + extension-owned), **P7** (`doctor` enumerates/validates extensions), **P8** (wrap, don't rebuild). The pivotal open decision is the **TS-loading mechanism** (jiti vs compiled `.js` vs native), which the dossier recommends resolving in a workshop before architecture.

## Summary

**WHAT**: Build the extension system that turns the harness core from a stub front-door into an extensible one. In a developer's *own* repo, a repo-local **`.harness/extensions/`** folder is **discovered and loaded at runtime** by the npx-installed core; each extension **contributes a CLI verb** (`harness <verb>`) with its own `--help`, options, structured (JSON + human) **Envelope** output, and exit codes. `help`/`doctor`/`run` become dynamic; the temporary `BUILTIN_SLOTS` are removed.

**WHY**: This is the focal point of the harness thesis — making the supported path *discoverable and extensible* so teams encode fixes (not memory) into a focal CLI. It's how `harness build`/`test`/`smoke`/`seed` go from aspiration to reality, each verb **wrapping a real repo command** (P8). The whole value rests on it being *super easy* for a developer to add a verb.

## Goals

- A repo-local **`.harness/extensions/`** in the developer's cwd is **discovered and loaded at runtime** by the npx-installed core CLI.
- Each extension **contributes a CLI verb** with its own name, description, `--help`, options/args, and **Envelope** output mapped to exit codes (0/1/2).
- Verb handlers receive injected **capabilities (ports)** — including the ability to **run a real repo command** (P8) — and **return an Envelope** (never call `process.exit`/`console.log`).
- `help`, `doctor`, and `run` become **dynamic**: `help` lists discovered verbs; **`doctor` enumerates + validates installed extensions** (loaded/failed/why) without invoking them (P7); the temporary `BUILTIN_SLOTS` are **removed** (P10).
- A **malformed or throwing extension is isolated** — it's reported by `doctor`, never crashes the CLI; the rest still load.
- **Authoring is trivially easy**: a typed verb contract, a copyable example extension, and an authoring guide.

## Non-Goals (v1)

- **Sandboxing/isolating untrusted extension code.** Like pi, we **trust the repo**; `doctor` surfaces provenance + load errors, and an optional `--no-extensions` safe mode may be included. (Hardening → future / WS-A spike.)
- **A full scaffold/codegen command** (`harness new extension`) — a copyable example + guide is in scope; a generator is deferred (WS-C / future).
- **Global (`~/.harness/`) extensions, a marketplace/registry, or remote install** — **repo-local only** for v1.
- **Extension lifecycle events / inter-extension messaging** (pi's event bus) — **verbs only**.
- **A sanctioned extension state/persistence convention** — out of scope v1 (verbs mostly wrap commands).
- **Hot reload** of extensions within a process.

## Target Domains

> This repo has **no domain registry** (`docs/domains/` absent); boundaries are expressed via the hexagonal **act → service → adapter** layering. The rows below are *logical* groupings within the single `harness/cli/` package, not registry entries.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| harness-cli-core | existing | **modify** | Make the composition root + `help`/`doctor`/`run` dynamic; remove `BUILTIN_SLOTS`; extend `FsPort` (add `readdir`) + add a cwd source; add load-failure error codes; keep the Envelope/exit kernel unchanged. |
| extension-loader | **NEW** (logical) | **create** | Discovery service (scan `.harness/extensions/`) + a `ModuleLoaderPort` adapter + the **verb contract** + populating the open registry the core dispatches from. |

### New Domain Sketches

#### extension-loader [NEW, logical]
- **Purpose**: Discover repo-local extensions in the developer's cwd, load them through a substitutable module-loader port, validate the verbs they declare, and hand the core an open registry of `{name, description, help, options, handler}` verbs plus inspectable diagnostics.
- **Boundary Owns**: discovery rules (where/what/how deep), the `ModuleLoaderPort` seam, the public **verb contract** an author implements, per-extension load isolation + provenance, and the registry the core consumes.
- **Boundary Excludes**: the Envelope/exit kernel (owned by harness-cli-core/output), commander wiring of verbs into the program (composition root), and the *behaviour* of any specific verb (owned by the extension author). Sandboxing/trust-enforcement is explicitly excluded from v1.

## Testing Strategy

- **Approach**: **Full TDD** (red→green→refactor), consistent with the kernel (96 existing tests, fakes-first).
- **Rationale**: the loader is the highest-risk code in the CLI (dynamic code execution + discovery edge cases); behaviour must be pinned by tests.
- **Focus Areas**: discovery (present/absent/empty/malformed/one-level), the `ModuleLoaderPort` load path, verb-contract validation, the dynamic `help`/`doctor`/`run` outputs, per-extension error isolation, exit-code mapping, and a **packaging smoke** that loads a fixture extension via the installed symlinked bin (PL-07/PL-08).
- **Excluded**: re-testing commander internals or the unchanged Envelope kernel.
- **Mock Usage**: **Avoid mocks entirely** — hand-written fakes (`FakeFs` with `readdir`, a fake `ModuleLoaderPort`) plus **on-disk fixture extensions**; no `vi.mock` (Constitution P3).

## Documentation Strategy

- **Location**: **Hybrid** — a README quick-start ("install an extension", in `harness/cli/README.md`) **plus** a focused authoring guide ("write your first harness verb", e.g. `docs/how/` or alongside the CLI README) with a **copyable example extension**.
- **Rationale**: the feature's value is authoring ergonomics; a quick-start orients, the guide + example make the first extension trivial to write.

## Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2 (loader, discovery, contract, FsPort, cwd, help/doctor/run, app.ts, error-codes, remove BUILTIN_SLOTS), I=2 (commander, npx/cwd topology, candidate jiti), D=1 (registry + discovery metadata), N=1 (dynamic code loading + trust model), F=1 (cold-start perf + security), T=1 (fakes + fixtures + packaging smoke). **P=8 → CS-4.**
- **Confidence**: 0.70
- **Assumptions**: kernel act/service/adapter seam is reused unchanged; loading mechanism resolved in WS-A; repo-local-only scope; trust-the-repo model.
- **Dependencies**: **`jiti` v2** as the runtime loader in `dependencies` (P10 / `--omit=dev` safe; full-TS, by-path API, pi-parity — decided in WS-A); **`engines.node` bumped `>=20` → `>=22`** (the `>=20` was an inherited kernel default, not a deliberate lock; Node 20 ~EOL Apr 2026); a new `ExecPort` (child_process); commander dynamic subcommand registration; `process.cwd()` via a port.
- **Risks**: see Risks & Assumptions.
- **Phases**: Simple mode → ideally a single focused phase. Realistically a few logical chunks (extend ports + discovery → loader + verb contract → dynamic help/doctor/run + remove BUILTIN_SLOTS → packaging smoke + docs). If `/plan-3` finds this needs real phase boundaries/gates, **escalate to Full** (cheap to do then).

> ⚠️ **Mode note**: this scored **CS-4**, which normally implies Full mode; the user chose **Simple** to keep ceremony lean. Mitigation: tight v1 scope (see Non-Goals) and an explicit escalate-at-`/plan-3` option.

## Acceptance Criteria

1. **AC-1 — Dynamic help**: with ≥1 extension present in `./.harness/extensions/`, `harness help` lists each extension-contributed verb (name + description + status); **no hardcoded `BUILTIN_SLOTS` appear**.
2. **AC-2 — Verb `--help`**: `harness <verb> --help` prints the verb's own usage, options, and description as declared by the extension.
3. **AC-3 — Envelope + exit contract**: invoking an extension verb runs its handler and emits a canonical **Envelope** (JSON or human per output mode), mapping `status → exit` (ok/degraded=0, unconfigured=2, error=1). The handler returns the Envelope and never calls `process.exit`/`console.log` directly.
4. **AC-4 — Wrap a real command (P8)**: an extension verb can run a real repo command via an injected capability, with the command's success/failure reflected in the Envelope + exit code.
5. **AC-5 — `doctor` enumerates + validates (P7)**: `harness doctor` lists installed extensions — for each: name, load status (loaded/failed), origin/path, and a `next_action` on failure — **without invoking any verb**. A malformed/throwing extension is reported, not fatal; the rest still load.
6. **AC-6 — Discovery from cwd, honest empty**: discovery scans the **current working directory's** `./.harness/extensions/` (the developer's repo), one level, with a deterministic resolution rule; an **absent/empty folder yields an honest "no extensions installed" state** with a `next_action` (status reflects honesty, **not** a hard error).
7. **AC-7 — Scaffolding retired, registry open**: the temporary `BUILTIN_SLOTS` are **removed**; the verb surface is sourced entirely from discovered extensions; the registry stays keyed by `name: string` (no closed union); `validateCommandMap` still guards malformed entries.
8. **AC-8 — Packaging smoke (npx topology)**: a fixture extension is contributed end-to-end through the **installed symlinked bin** (pack → install tarball → run `harness <fixture-verb>` from a temp project with a `.harness/extensions/` fixture), proving discovery works from the installed bin + developer cwd (PL-07/PL-08).
9. **AC-9 — Fakes-first TDD**: loader/discovery/contract logic is covered by hand-written fakes (`FakeFs` with `readdir`, a fake `ModuleLoaderPort`) plus on-disk fixture extensions; **no `vi.mock`**.
10. **AC-10 — Runtime-dep discipline**: any dependency needed at runtime inside a user's repo (loader/transpiler) is in `dependencies`, not `devDependencies` (P10, `--omit=dev` safe).
11. **AC-11 — Docs + example**: a README quick-start ("install an extension") **and** an authoring guide ("write your first verb") exist, with a **copyable example extension** an author can adapt.

## Risks & Assumptions

- **R1 — Loading mechanism is unresolved** (jiti `.ts` vs compiled `.js` vs native type-stripping). It drives a runtime dep, cold-start cost, Node floor, and the security surface. *Mitigation*: WS-A workshop + the dossier's `/deepresearch` prompt; acceptance criteria are written **loading-mechanism-agnostic** (observable outcomes).
- **R2 — Trust/security**: the core executes arbitrary repo code. *Mitigation*: trust-the-repo model (industry norm for dev tools), `doctor` provenance + isolated load errors, optional `--no-extensions` safe mode.
- **R3 — Cold-start cost**: transpiling on every invocation could add latency/tokens — the very thing the harness reduces. *Mitigation*: weigh compiled-`.js`-default with `.ts` opt-in, or a compiled cache (WS-A).
- **R4 — `main()` becomes async**: discovery + (awaited) async factories must run before `program.parse`. *Mitigation*: confirm the `app.ts` restructure in WS-A; keep the kernel exit/output unchanged.
- **R5 — Mode/complexity mismatch** (CS-4 in Simple mode). *Mitigation*: tight v1 scope; escalate at `/plan-3` if real phase gates emerge.
- **A1**: extensions are repo-local + trusted; **A2**: the kernel's Envelope/exit/act/service/adapter seam is reused unchanged; **A3**: `commander` remains the parser.

## Open Questions

1. **[RESOLVED in WS-A → jiti]** loading mechanism — **jiti v2** for `.ts`/`.tsx` (Node 20+22, zero-build full-TS authoring) + plain `import()` for `.js`; native Node type-stripping is a Node-24 future fast-path. Sourced via Perplexity (Node-TS/jiti/tsx comparison). jiti → `dependencies` (P10).
2. **[RESOLVED in WS-A]** Verb contract shape — **declarative default export** `HarnessVerb | HarnessVerb[]` (statically inspectable by `doctor` without invoking handlers).
3. **[RESOLVED in WS-A]** `ctx` capability set — `cwd/args/options` + ports (`fs` w/ readdir, `exec` via a **new `ExecPort`** for P8, `env`, `git`, `clock`) + envelope helpers; handler returns a `VerbResult` the core finalizes.
4. **[RESOLVED in WS-A]** Collision policy — core names (`help`/`doctor`) reserved; among extensions first-sorted wins; shadowed duplicate flagged by `doctor` (`E142`). Trust-the-repo model + per-extension isolation + `--no-extensions`/`HARNESS_NO_EXTENSIONS=1` safe mode (Perplexity-sourced norm).
5. **Agent harness** — **resolved (Round 2)**: no separate agent harness; validate via TDD + fixtures + packaging smoke. The harness is **dogfooded** once verbs exist (it becomes its own engineering harness) — plan a dogfooding follow-on, not a Phase 0 harness build.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| **WS-A — Extension contract & loader architecture** | Integration Pattern | **Pivotal.** Pins the loading mechanism, verb contract shape, `ctx`/ports set, discovery rules, collision policy, and the async-`main` restructure — these ripple through every later task. | jiti vs compiled vs native? declarative object vs factory? which ports in `ctx` (confirm exec)? discovery resolution + dedup + collisions? |
| WS-B — Retire `BUILTIN_SLOTS` + dynamic help/doctor/run | CLI Flow | Sequence the scaffolding removal without breaking the output/exit contract; define `doctor`'s extension enumeration. | How does an empty `.harness/` render? `run <verb>` dispatcher semantics when verbs are real? what does bare `harness` show? |
| WS-C — Authoring ergonomics | Other | Make the first extension trivial to write. | Typed contract module? copyable example? test fakes for `ctx`? scope for v1 (guide+example) vs future (scaffold command)? |

## Clarifications

### Session 2026-06-08

**Round 1 (front-loaded):**
- **Q (Workflow Mode)** → **Simple** (user choice; despite CS-4 — keep ceremony lean, escalate at `/plan-3` if needed).
- **Q (Testing Strategy)** → **Full TDD** (loader is high-risk; matches kernel convention).
- **Q (Mock Usage)** → **Avoid mocks entirely** — hand-written fakes + on-disk fixture extensions (Constitution P3).
- **Q (Documentation Strategy)** → **Hybrid** — README quick-start + a focused authoring guide with a copyable example.

**Round 2 (sketch-dependent):**
- **Q (Loading mechanism)** → **Workshop it (WS-A) before `/plan-3`** — resolve jiti `.ts` vs compiled `.js` vs native type-stripping in a `/plan-2c` workshop (and/or the dossier's `/deepresearch` prompt) rather than guessing now. Open Question 1 is **routed to WS-A** (not resolved here by design).
- **Q (Agent harness readiness)** → **Feature doesn't need a separate agent harness.** Validation for *building* this is TDD + on-disk fixture extensions + the installed-bin packaging smoke. **Strategic note (user)**: *"this is the harness — we will dogfood it as soon as it's ready to validate our work."* Once the extension system ships, the harness CLI **becomes its own engineering harness** for this repo (harness verbs wrapping this repo's build/test/lint/smoke), so the validation loop is the product itself. → recorded for `/plan-3` (no Phase 0 agent-harness build; plan a dogfooding follow-on once verbs exist).

**Post-WS-A (2026-06-08) — loader + Node floor:**
- **Q (Node floor)** → user challenged the assumed Node 20 floor. Confirmed: `engines.node ">=20"` + CI `['20','22']` was an **inherited plan-004 default**, *not* a deliberate lock. **Decision: bump `engines.node` → `>=22` LTS** (Node 20 ~EOL Apr 2026; the floor constrains *consumers* who npx-install, so keep it broad rather than forcing Node 24). CI matrix: drop `20`, keep `22` (optionally add `24`). A small package.json + ci.yml change for `/plan-3` to phase.
- **Q (loader: jiti vs native Node TS)** → **jiti** selected (user). Rationale: jiti runs on any Node 20/22+, gives zero-build **full-TS** authoring (enums/decorators — native strip-types can't), has a clean by-path API, and **is what pi itself uses** for extension loading. Native type-stripping's "leanness" (one fewer dep, marginally faster) doesn't pay for the reach + author-ergonomics cost; it stays a **future fast-path** behind `ModuleLoaderPort` if the floor ever rises to Node 24.
- **Q (dynamic surface: is `run` a core verb?)** → **No — superseded by top-level verbs (resolved at `/plan-3`).** The earlier phrasing "*help, doctor, and `run` become dynamic*" (Summary/Goals/AC-1) predates WS-A. WS-A's worked examples invoke verbs **top-level** (`harness hello`, `harness build`), never via a `run <verb>` namespace, so the dynamic surface **is the set of discovered top-level verbs**; the temporary `run <slot>` dispatcher (`acts/run.ts`) is deleted with the rest of the scaffolding. A `run`/passthrough verb, if ever wanted, is just another extension. *(See plan § Plan Decisions D2.)*
