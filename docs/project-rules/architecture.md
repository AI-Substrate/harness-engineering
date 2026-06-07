# Harness Engineering Architecture

**Version**: 1.0.0
**Last Updated**: 2026-06-08
**Constitution Reference**: [constitution.md](./constitution.md)

This document captures the system's high-level structure, boundaries, and interaction contracts. It is the enforced expression of Constitution Principles 2–10.

---

## 1. System Overview

The **Harness CLI Core** is an agent-friendly Node CLI that is the **front door** to a repo's engineering harness. It is installed via `npx` (from the repo URL) onto a developer's or agent's machine; repo-local **extensions** (a later effort) supply the customisable behaviour at runtime.

```
┌──────────────────────────────────────────────────────────────┐
│                         OPERATORS                            │
│   Humans (terminal)        │        AI Agents (JSON mode)    │
└───────────────┬──────────────────────────┬───────────────────┘
                │                          │
                ▼                          ▼
        ┌───────────────────────────────────────────┐
        │              harness (bin)                 │
        │   Entrypoint → Acts → Services → Ports     │
        │                                   ▲        │
        │                              Adapters      │
        └───────────────────────────────────────────┘
                │ wraps / observes (via adapters)
                ▼
   ┌──────────────────────────────────────────────────┐
   │   Target repo: real commands, fixtures, git,     │
   │   build/test/run, evidence — reached via ports   │
   └──────────────────────────────────────────────────┘
                ▲
                │ (future) loaded at runtime
        ┌───────────────────────┐
        │   Repo-local          │
        │   extensions          │  ← out of scope today; seam preserved
        └───────────────────────┘
```

---

## 2. Architectural Style: Ports & Adapters (Hexagonal)

The CLI is **Hexagonal / Ports & Adapters**, with a Clean-Architecture-style use-case layer (the *acts*). Control flows inward; dependencies point inward toward the core.

| Layer | Responsibility | MUST NOT |
|-------|----------------|----------|
| **Entrypoint** (`harness/cli/src/index.ts`) | Parse args (commander), resolve global flags once, select an act, render via the output port, translate result → exit code. | Contain business logic; import `node:fs`/`node:child_process`/git directly. |
| **Acts** (`harness/cli/src/acts/*`) | Composition root per command: construct concrete adapters, inject them into a service, turn the service's result into an `Envelope`, exit. | Implement harness logic; emit raw strings instead of envelopes. |
| **Services** (`harness/cli/src/services/*`) | All harness business rules (doctor checks, slot lookup, config validation, help content, unconfigured handling). Receive adapters as parameters. | Import Node side-effect modules directly; call `process.exit`. |
| **Adapters** (`harness/cli/src/adapters/*`) | Wrap exactly one external resource behind a **port** interface; provide a Node impl + a fake. | Contain business rules. |
| **Output kernel** (`harness/cli/src/output/*`) | Envelope type + constructors, exit-code mapping, error-code table, human/JSON renderer + mode selection. Owns the single `process.exit` site. | Be bypassed by ad-hoc `console.log`/`process.exit` in commands. |

**Dependency rule**: Entrypoint → Acts → Services → Ports. Services depend on **ports**, never on concrete adapters. Adapters depend on ports (implement them). Nothing in services/acts imports another command's internals.

### 2.1 Adapter set

| Adapter | Port | Production impl | Ships in |
|---------|------|-----------------|----------|
| Clock | `Clock` | `SystemClock` | Phase 1 (envelope timestamps depend on it; `FakeClock` for determinism) |
| Filesystem | `FsPort` | `NodeFs` | Phase 2 |
| Process | `ProcessPort` | `NodeProcess` | Phase 2 |
| Git | `GitPort` | `ExecGit` | Phase 2 |
| Env | `EnvPort` | `NodeEnv` | Phase 2 |
| HTTP/server, Telemetry | — | — | **Deferred** (harness-loop / observe work — out of scope) |

Every shipped adapter has **one fake** that records call history. Tests inject fakes; no internal-module mocking.

---

## 3. The Output Contract (the CLI's public API)

Authoritative definition: [`docs/plans/004-harness-core/workshops/001-output-envelope-and-exit-codes.md`](../../docs/plans/004-harness-core/workshops/001-output-envelope-and-exit-codes.md).

```ts
type Status = 'ok' | 'error' | 'degraded' | 'unconfigured';

interface Envelope {
  command: string;
  status: Status;
  timestamp: string;           // ISO-8601, from the Clock port
  data?: unknown;              // present on ok/degraded
  error?: { code: string; message: string; details?: unknown };  // present on error
  evidence?: { label: string; path?: string; none?: boolean }[];
  next_action?: string;        // REQUIRED whenever status !== 'ok'
}
```

- **Exit-code mapping** (documented, enforced in the kernel): `ok → 0`, `degraded → 0` (a command may document a non-zero degraded explicitly), `unconfigured → 2`, `error → 1`.
- **Mode selection precedence**: `--json`/`--no-json` flag → `HARNESS_JSON=1` env → TTY detection (piped ⇒ JSON, interactive ⇒ human).
- **Stream split**: JSON renderer writes one `JSON.stringify(env)` line to **stdout**; human renderer writes progress/diagnostics to **stderr** and the final summary line to **stdout**.

---

## 4. Packaging & Install Topology

- The **npm manifest is the repo-root `package.json`** (`bin.harness → ./harness/cli/dist/index.js`, `"prepare": "npm run build"`, `files` limited to built output, `engines.node >=20`). This is what makes `npx github:<repo>` build-and-run with no npm publish (the `prepare` script runs `tsc`).
- **All CLI source/tests/config live under `harness/cli/`**; only the manifest and shared tool configs (`biome.json`, root `justfile`, CI) sit at the repo root.
- **Runtime vs dev dependency discipline** (Constitution P10): anything needed at runtime inside a *user's* repo (a future extension loader, `jiti`) goes in `dependencies`; build/test-only tooling goes in `devDependencies`. Distributed/`npx` installs run `--omit=dev`.

---

## 5. Extension Seam (future-facing, not built today)

Authoritative design: [`workshops/002-cli-composition-pattern.md`](../../docs/plans/004-harness-core/workshops/002-cli-composition-pattern.md) (§ extension seam + Q4).

- Command slots live in a **slot registry** (`services/slots/slot-registry.ts`). Today every slot is `unconfigured`; a `CommandSlot` carries `{ name, status, next_action }` with a reserved future `handler?`.
- The registry is **open-capable**: slots are keyed by `name: string`; the 8 built-ins are a **seed set**, not a closed universe. A future loader can flip a known slot's status *or* append a new command without a schema change.
- A surveyed **pi-style microkernel** model (discovery → collect → bind → dispatch; capability injection via ports; module substitution) is confirmed compatible with this design — the ports *are* the capability surface a plugin `ctx` would expose.

---

## 6. Repo Engineering Substrate

| Concern | Where | Notes |
|---------|-------|-------|
| Format + lint | `biome.json` (root) | `just fix` / `just format` |
| Tests + coverage | `harness/cli/vitest.config.ts` | `@vitest/coverage-v8`; `just test` |
| Local pre-commit | root `justfile` | `just fft` = fix → format → test (with coverage) |
| CI | `.github/workflows/ci.yml` | build + biome + test + coverage + audit, on PR + `main` |
| Release | `release-please-config.json` + `.github/workflows/release.yml` | semver, `release-type: node` |
| Branch protection | repo setting (`gh api`) | required CI must pass before merge |

---

## 7. Anti-Patterns (reviewer checklist)

Reject changes that:

- Put business logic in the entrypoint or acts (logic belongs in services). ❌
- Import `node:fs`/`node:child_process`/git/network/clock directly inside a service (use a port). ❌
- Call `process.exit` or `console.log` outside the output kernel. ❌
- Return success (or exit `0`) for an unconfigured/unbuilt slot. ❌
- Emit unstructured text from a status/reporting command in JSON mode, or omit `next_action` on a non-`ok` status. ❌
- Mock internal modules (`vi.mock`) instead of injecting a fake adapter. ❌
- Introduce a closed `SlotName` union as the registry's only key, foreclosing the extension future. ❌
- Place a runtime-needed dependency in `devDependencies`. ❌
- Re-implement a command the target repo already provides instead of wrapping it. ❌
- Add private/sensitive content to tracked files (publication boundary). ❌

---

## 8. Technology Notes

- **Language/runtime**: TypeScript + ESM, built with `tsc` to `dist/`; Node ≥20 (repo runs v24). Arg parsing via commander.
- **Reference repos** (studied for pattern, never assumed present at build time): a sibling Node CLI (architecture + tooling) and a reference harness repo (doctor UX, evidence, clean-architecture doctrine). All patterns are captured locally in the plan workshops so the build is self-contained.

<!-- USER CONTENT START -->
<!-- Add project-specific architecture decisions, diagrams, or boundaries here; preserved across regenerations. -->
<!-- USER CONTENT END -->
