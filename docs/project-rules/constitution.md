# Harness Engineering Project Constitution

<!--
Sync Impact Report:
- Mode: AMEND
- Version: 1.0.0 → 1.1.0 → 1.1.1
- Creation Date: 2026-06-08
- Amendment (2026-06-08, v1.1.1, PATCH): factual sync — the extension system
  (plan 005) LANDED. The temporary `BUILTIN_SLOTS` / `run` / slot scaffolding is
  removed; `.harness/extensions/` is discovered + loaded at runtime; verbs are
  top-level `harness <verb>`. Principle 10 itself is unchanged (verbs dynamic +
  extension-owned); only the "scaffolding exists today" factual notes are updated
  to past tense and the dead `services/slots/slot-registry.ts` reference retired.
- Amendment (2026-06-08, v1.1.0): Principle 10 reframed — verbs are DYNAMIC and
  extension-owned; the core hardcodes NO verb list. The built-in `unconfigured`
  command stubs are temporary scaffolding slated for removal when the extension
  system lands (were previously framed as an open "seed set"). P5/P7/P8 and the
  intro updated to match; doctor reaffirmed as a core diagnostic that enumerates
  + validates installed extensions. Driver: user clarification 2026-06-08.
- Source Documents:
  * harness-foundations/{directives.md, first-principles.md, patterns-that-work.md}
  * docs/plans/004-harness-core/{harness-core-spec.md, harness-core-plan.md}
  * docs/plans/004-harness-core/workshops/{001-output-envelope-and-exit-codes.md, 002-cli-composition-pattern.md}
  * Architecture guidance pulled across from a sibling Node CLI's constitution + a reference harness repo (studied, not copied)
- Placeholder Status: ALL RESOLVED
- Outstanding TODOs: None
- Domain system: Not yet initialized (domain governance is additive; applies once domains are established via /plan-v2-extract-domain)
-->

**Version**: 1.1.1
**Ratification Date**: 2026-06-08
**Last Amended**: 2026-06-08

---

## 1. Project Overview

This repository is two things at once:

1. A **public-facing engineering-harness first-principles and tutorial project** — it distils how teams build fast, observable, repeatable development loops into shareable principles, patterns, and skills (`harness-foundations/`, `skills/`).
2. The home of the **Harness CLI Core** (`harness/cli/`) — the first *physical* piece of harness tooling: an agent-friendly Node CLI that acts as the **front door** to a repo's engineering harness.

**What the Harness CLI Core is** (the product this constitution governs):

- It is **installed onto a developer's or agent's machine from the public npm registry** (`@ai-substrate/engineering-harness`, zero-auth) to provide the *core* of the harness.
- The core is intentionally small. The **customisable behaviour comes from extensions** added in the *target* repo and loaded at runtime — the extension system (plan 005) has landed, and the core's verb surface is sourced entirely from it.
- Everything the core does is grounded in **`harness-foundations/`** — the first principles, directives, and patterns are the doctrine the tooling makes executable.
- This slice ships two core commands (`help`, `doctor`) plus the **runtime extension system**: a developer's own repo holds `.harness/extensions/`, which the core discovers + loads so each extension contributes `harness <verb>` commands — alongside a stable human+JSON output contract and the repo's own engineering fundamentals (Biome, vitest+coverage, `justfile`, CI, release-please).

**Harness layer boundary** (load-bearing — never collapse these, per `harness-foundations/directives.md` Directive 1):

- **Engineering harness** = the project/product development loop (boot, build, run, seed, interact, observe, test, validate, diagnose, improve). *This CLI is the front door to that loop.*
- **Agent harness** = the runtime/control plane around an AI model (tool dispatch, permissions, context, orchestration). The agent harness *drives* the engineering harness; it does not replace it. This project builds the engineering-harness surface, not an agent runtime.

---

## 2. Guiding Principles

### Principle 1: The harness is the product, not scaffolding

**MUST**: Treat the engineering harness (and the CLI that fronts it) as a first-class product surface with real UX, not as throwaway tooling.

**Rationale**: A harness that is harder than raw commands gets bypassed (Directive 3). Harness UX is adoption infrastructure.

### Principle 2: Clean Architecture — Ports & Adapters (Hexagonal)

**MUST**: Business logic depends only on **ports** (interfaces it defines); the outside world reaches in only through **adapters** that implement those ports. Dependencies point inward. The CLI layering is:

```
Entrypoint (parse args, render, exit)
   → Act (compose services + adapters for one command)
      → Service (harness business rules; adapters injected)
         → Port (interface) ← Adapter (NodeFs / FakeFs, …)
```

**MUST NOT**: import `node:fs`, `node:child_process`, `git`, the network, or the clock directly inside a service; call `process.exit` outside the output kernel; let command handlers (entrypoint/acts) accumulate business logic.

**Rationale**: The reason a service can be unit-tested with zero real I/O is that every side effect is a port a test fills with a fake. This is also the seam the future extension system plugs into.

### Principle 3: Interface-first, fakes over mocks

**MUST**: For each adapter, define the **port interface first**, provide a **fake** (a real test double that records call history), then the production implementation. Test services/acts by injecting fakes.

**MUST NOT**: use `vi.mock()` / `vi.spyOn()` / monkey-patching of internal modules. Prefer real fixtures + injected fakes.

**Rationale**: Behaviour-focused tests survive refactoring and drive good interface design. Matches the proven pattern in the reference repos.

### Principle 4: The CLI is the API

**MUST**: Status/reporting commands return a **stable envelope** (`command`, `status`, `data`, `error`, `evidence`, `next_action`, `timestamp`) in JSON mode, and a readable human form otherwise. Every command exposes agent-friendly `--help`.

**Rationale**: Agents must inspect status/evidence/next-action without scraping logs (`first-principles.md`: "The CLI is the API"). Output is a contract, not incidental text.

### Principle 5: Honesty over fake success (unconfigured, never pretend)

**MUST**: A command with no mapped behaviour (a scaffolding stub today, an installed-but-unconfigured extension tomorrow) returns `status: unconfigured` with a `next_action`, and exits non-zero (`2`). Missing capability is represented as a **gap to improve**, never as a passing check.

**Rationale**: A harness that pretends unbuilt things work destroys the trust agents place in it. Treat friction and gaps as product feedback (Directives 4, 5).

### Principle 6: Documented exit-code semantics

**MUST**: Exit codes are part of the contract and documented per command: `0` success (incl. an explicitly-documented degraded-but-ok), `1` error, `2` unconfigured.

**Rationale**: Scripts and CI must distinguish "broke" from "not built yet".

### Principle 7: Diagnostics prescribe the fix

**MUST**: Every failure and every `doctor` finding explains **what** failed, **why** it matters, and **what to do next** (`next_action`). `doctor` is executable orientation and a **core** capability (not a verb): it reports core readiness layers and, once the extension system exists, **enumerates and validates the installed extensions** so the operator can diagnose whether the harness is wired correctly.

**Rationale**: A boot/doctor command both validates readiness and reminds the operator how the project wants to be worked with (`first-principles.md`).

### Principle 8: Wrap, don't rebuild

**MUST**: The harness CLI wraps existing repo commands and tools; it implements original behaviour only where a real gap exists. Verbs (e.g. `run`, `build`, `test`) are provided **dynamically by extensions**, each of which maps its verb onto a real project command — the core does not own or hardcode that mapping.

**Rationale**: The harness is a façade over repo-local commands, fixtures, checks, and workflows (Directive 6) — not a re-implementation of the world.

### Principle 9: Evidence over assertion

**MUST**: Commands that produce proof report **where** evidence was written, or explicitly state that no durable evidence was produced. Claims of safety are backed by tests, command output, or artifacts.

**Rationale**: The repo is the system of record; return structured evidence, not logs to scrape (`patterns-that-work.md`).

### Principle 10: Dynamic, extension-owned verbs (the core hardcodes no command list)

**MUST**: Verbs are **dynamic and owned by extensions**, not by the core. Each extension supplies its own verb name, help text, and behaviour, registered at runtime in the *target* repo. The command registry the core exposes is a **discovery/registration surface** populated from installed extensions — it carries no built-in verb list.

**MUST**: Any dependency the harness needs **at runtime inside a user's repo** (a future loader, a transpiler such as `jiti`) is a runtime `dependency`, never a `devDependency` (distributed/`npx` installs run `--omit=dev`).

**MUST NOT**: hardcode a verb list, a closed `VerbName`/verb union, or otherwise assume the set of verbs is fixed. The earlier built-in `unconfigured` stubs (`run`, `validate`, `build`, `lint`, `test`, `smoke`, `health`, `observe`) were temporary scaffolding and **have been removed** now that the extension system provides the verb surface.

> **History note**: the verb surface is now built by `services/extensions/registry.ts` from extensions discovered under `<cwd>/.harness/extensions/`. The registry is keyed by `name: string` (no closed union) so any extension can register verbs freely. (The retired `services/slots/slot-registry.ts` `BUILTIN_SLOTS` scaffolding was deleted in plan 005.)

**Rationale**: Developers will add many verbs over time; bundling verb + help with the extension that provides it (a pi-style microkernel direction, surveyed and confirmed compatible) keeps the core small and avoids a later unpick. `doctor` (Principle 7) remains the core diagnostic that lists and validates whatever extensions are installed.

### Principle 11: Fast, repeatable local feedback

**SHOULD**: Maintain quick local loops. One obvious pre-commit path for agents — `just fft` (fix → format → test with coverage) — and the same expectations enforced in CI.

**Rationale**: Immediate, deterministic feedback is the backpressure that keeps the codebase safe to change quickly.

### Principle 12: Publication boundary (public-safe by default)

**MUST**: Tracked content stays sanitized and neutral. Raw/private source material lives only in gitignored `scratch/`. No private identifiers, customer details, person names, internal codewords, or unreleased platform details in tracked files. Run `git status --short` and confirm `scratch/` stays ignored before committing.

**Rationale**: This is a public-facing project distilling private experience into shareable doctrine.

---

## 3. Quality & Verification Strategy

- **Unit tests (vitest)** are the primary proof for services and acts, exercised through **injected fakes** (no real fs/process/git/clock). The output kernel (envelope, exit-code mapping, mode selection) is fully unit-tested.
- **Testing approach is Hybrid**: test-first for logic with real branching (output kernel, doctor checks, slot handling); lightweight for thin entrypoints and adapters.
- **Coverage** is reported by the local `test` path and surfaced in CI (this is a deliberate extension beyond the reference repos, which report none).
- **Static quality**: Biome provides formatting + linting on the CLI source; `npm audit` provides dependency vulnerability scanning.
- **Definition of Done separates checks from judgement**: automated gates prove the mechanical parts; the evidence needed for human judgement is reported, not hidden.

---

## 4. Delivery Practices

- **Planning** uses the `docs/plans/<ordinal>-<slug>/` convention (spec → workshops → plan → phase tasks). No time estimates — use **Complexity Score (CS 1–5)** only (see `rules.md`).
- **Backpressure before merge**: `just fft` locally; GitHub Actions CI (build + Biome + tests + coverage + audit) on PRs and `main`; `main` is branch-protected so required CI must pass before merge.
- **Versioning & distribution**: semver via `release-please` (`release-type: node`); on each release-please release the `publish` job pushes `@ai-substrate/engineering-harness` to the **public npm registry** (`publishConfig.registry = https://registry.npmjs.org`, `access: public`). Install needs **no auth** — `npm i -g @ai-substrate/engineering-harness`, `npx`, or `harness update` (no consumer `.npmrc` scope or `read:packages` token). *(Plan 019 — zero-auth public-npm distribution, superseding plan 018's GitHub Packages model; both reverse the original plan-004 "no npm publish / npx-from-repo-URL" model.)*
- **Documentation**: README-led, with agent-friendly per-command `--help`. Authoritative design decisions live in plan workshops and are not contradicted downstream.

---

## 5. Domain Governance

**Domain system not yet initialized.** No `docs/domains/registry.md` exists, and this project does not require one yet. Domain governance is **additive** and applies once domains are formalized via `/plan-v2-extract-domain`. When that happens, the following rules take effect:

- Every source file belongs to a domain (or is uncategorized legacy).
- Cross-domain imports use **contracts** (public interfaces) only — no reaching into another domain's internals.
- Business → infrastructure dependencies are allowed; infrastructure → business never; business → business only via contracts.
- The domain registry and `docs/domains/domain-map.md` are the authoritative indices and must stay current.

Until then, the **harness-cli** and **repo engineering substrate** are tracked as *conceptual* domains for traceability only (see `docs/plans/004-harness-core/`), and the architectural boundaries in `architecture.md` are the enforced rules.

---

## 6. Governance

- **Amendment procedure**: changes to this constitution are proposed via a normal plan/PR, reviewed, and version-bumped (MAJOR = breaking principle/governance change; MINOR = new principle or materially expanded guidance; PATCH = clarification). Update `rules.md`, `idioms.md`, and `architecture.md` in the same change to stay consistent.
- **Review cadence**: revisit whenever the harness's intent, the publication boundary, the architecture, or the extension model changes.
- **Compliance**: code review checks changes against these principles; plan generation (`/plan-3`) runs a Constitution gate against this file. Deviations require a documented Deviation Ledger entry (see `rules.md`).
- **Precedence**: on conflict, the order is Constitution → Architecture → Rules → Idioms. `harness-foundations/` is the source doctrine these files operationalize.

<!-- USER CONTENT START -->
<!-- Add project-specific amendments, exceptions, or principles here; this block is preserved across regenerations. -->
<!-- USER CONTENT END -->
