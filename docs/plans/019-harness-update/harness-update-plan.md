# Harness Self-Update Implementation Plan

**Mode**: Simple
**Plan Version**: 1.0.0
**Created**: 2026-06-15
**Spec**: [harness-update-spec.md](./harness-update-spec.md)
**Status**: READY

## Gate Matrix

| Gate | Check | Status | Notes |
|------|-------|--------|-------|
| G1 | Clarify | PASS | No critical `[NEEDS CLARIFICATION]` markers; the spec's Open Questions are non-blocking (auth-UX workshop, wording-scope, banner-polish). |
| G2 | Constitution | PASS | P2 (ports & adapters), P3 (interface-first + fakes), P4 (stable additive envelope), P6 (exit codes), P9 (evidence) all honoured — every side effect behind an injected port. No Deviation Ledger entry needed. |
| G3 | Architecture | PASS | Layers respected (act → service → port ← adapter); registry lookup satisfied via a `npm view`/exec adapter, **not** the deferred HTTP adapter (architecture §2.1); `process.exit` stays in `output/exit.ts`. |
| G4 | ADR Compliance | N/A | No `docs/adr/` in this repo. |
| G5 | Structure | PASS | All required sections present (Simple-mode form). |
| G6 | Testing Alignment | PASS | Hybrid (spec): TDD-ordered for the deterministic core; lightweight for thin exec pass-throughs; ACs are measurable. |
| G7 | Domain Completeness | PASS | All 4 conceptual domains present in Target Domains; **no `docs/domains/` registry exists** (constitution §5 — domain system not initialized), so no domain-setup artifacts are required; Domain Manifest covers every file in the task table. |

## Summary

Make the globally-installed `harness` CLI keep itself current and make staleness impossible to miss. This adds a first-class **`harness update`** command family (`update` / `--check` / `--pin`) plus a **`self-install`** convenience that install/upgrade from the **GitHub Packages release** (`@ai-substrate/engineering-harness`, plan 018 — already shipped at `v0.2.0`); a **once-per-24h** update check that is non-blocking and failure-silent; an additive **`update_available`** notice injected at the single output chokepoint so **every** command surfaces a known update (a top-level JSON field, one human stderr line); and a **skills reconcile** that, on update, brings the harness *skills* current by orchestrating the existing **`harness skills update`** path (refresh + prune). The binary (registry) and the skills (`npx skills`) are two channels; `harness update` is the one command that reconciles both. Built single-phase (Simple mode, user-directed) as four ordered task groups behind injected ports, with the MCP-stable envelope seam kept strictly additive.

## Target Domains

> This repo has **no `docs/domains/` registry** (constitution §5 — domain system not yet initialized). The "domains" below are the CLI's *conceptual* modules; the enforced boundaries are `architecture.md`'s hexagonal layers.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| `cli-update` | **NEW** | **create** | the `update`/`self-install` acts + update-check/cache/semver service + two new injected ports (env-home, version-lookup) |
| `cli-output` | existing | **modify** | `Envelope` gains an additive optional `update_available`; the render seam emits the JSON field / human stderr line |
| `cli-version` | existing | **consume** | reuse `readVersion()` as the installed version (no change) |
| `cli-skills` | existing | **consume** | orchestrate the existing `harness skills update` (refresh + prune) from `harness update`; no change to the skills service itself |

### New Domain Sketch — `cli-update`
- **Purpose**: own the CLI's ability to check for, report, and apply updates to itself from the GitHub Packages release, plus the convenience global install.
- **Boundary Owns**: the `update` verb (`update` / `--check` / `--pin`), `self-install`, the registry latest-version lookup (port), the 24h-throttled check, the user-global update-check cache, the semver compare.
- **Boundary Excludes**: the installed-version read (`cli-version`); how the notice is *rendered* (`cli-output`); subprocess mechanics (injected `exec`); the publish/release pipeline (plan 018).

## Domain Manifest

| File | Domain | Classification | Rationale |
|------|--------|---------------|-----------|
| `harness/cli/src/adapters/env/env-port.ts` | cli-update | contract | extend `EnvPort` with `home()` (nothing resolves `$HOME`/`USERPROFILE` today) |
| `harness/cli/src/adapters/env/node-env.ts` | cli-update | internal | `NodeEnv.home()` via `process.env`/`os.homedir` (adapter layer — `node:*` allowed) |
| `harness/cli/src/adapters/env/fake-env.ts` | cli-update | internal | `FakeEnv.home()` returns injected value, records calls |
| `harness/cli/src/adapters/version-lookup/version-lookup-port.ts` | cli-update | contract | NEW port: latest published version (registry dist-tag) |
| `harness/cli/src/adapters/version-lookup/node-version-lookup.ts` | cli-update | internal | shells `npm view @ai-substrate/engineering-harness version --json` (adapter — not a service) |
| `harness/cli/src/adapters/version-lookup/fake-version-lookup.ts` | cli-update | internal | scripted latest / throw; records calls |
| `harness/cli/src/services/update/semver.ts` | cli-update | internal | pure "is-newer" compare (pre-release/canary aware) |
| `harness/cli/src/services/update/cache.ts` | cli-update | internal | cache model + read/write via `FsPort`+`EnvPort.home()`+`Clock` |
| `harness/cli/src/services/update/update-service.ts` | cli-update | contract | throttle decision + check orchestration + install/pin/self-install/auth-failure mapping + skills-reconcile orchestration |
| `harness/cli/src/acts/update.ts` | cli-update | internal | composition root for `update`/`--check`/`--pin`/`self-install`; mirrors `registerSkillsAct` |
| `harness/cli/src/output/envelope.ts` | cli-output | contract | add optional `update_available?: { installed, latest, command }` (additive) |
| `harness/cli/src/output/exit.ts` | cli-output | contract | **true universal exit chokepoint** (43 sites) — set `update_available` + emit the human banner line here (KF-09); new signature `exitWithEnvelope(env, io, banner?)` |
| `harness/cli/src/output/output-port.ts` | cli-output | internal | `renderJson` serializes the field; human banner line sourced from `update_available.command`; `selectMode` honoured |
| `harness/cli/src/version.ts` | cli-version | consume | reuse `readVersion()` as the installed version (no change) |
| `harness/cli/src/services/docs/contract.ts` | cli-output | internal | document the additive field on the MCP-stable seam |
| `harness/cli/src/app.ts` | cli-update | internal | composition root: build new ports + sync banner provider; register `update` act |
| `harness/cli/src/acts/verb.ts` | cli-update | internal | add new ports to `VerbActDeps` bundle |
| `harness/cli/src/services/skills/*` | cli-skills | cross-domain | consume the **already-exported** skills-update helpers (`buildInstallArgv`/`buildRemoveArgv`/`LEGACY_SKILL_SLUGS`/`KNOWN_SKILL_TARGETS`) — no new exports needed |
| `harness/cli/test/architecture/*`, `harness/cli/test/output/*` | cli-output | internal | update the 4 `toEqual` sites + human stderr assertions for the conditional line; arch boundary still green |
| `harness/cli/README.md` | docs | internal | install/update/run model (registry + `.npmrc`/token per 018) |
| `docs/how/keeping-the-harness-up-to-date.md` | docs | internal | NEW short guide; coordinate with 018's install docs |

## Key Findings

| # | Impact | Finding | Action |
|---|--------|---------|--------|
| 01 | Critical | Banner must **not** be added inside the `format*` constructors — four tests assert envelopes with `toEqual` (`envelope.test.ts:26,70,97`; `output-port.test.ts:61`). | Add an *optional* field to the `Envelope` interface; leave the pure `format*` constructors untouched and apply the field at the **exit chokepoint** (see KF-09), not in the constructors. |
| 02 | Critical | The render+exit path is **fully synchronous** — `exitWithEnvelope` calls `process.exit` immediately (`exit.ts:17-20`); `ExecPort.run` is async. An every-command check cannot be awaited on the hot path. | Split the reads: a **cheap sync `FsPort` cache read** produces the banner at render time; the **async registry refresh** runs only inside the `update`/`--check` act (or fire-and-forget writing the cache for the *next* invocation) — never on the exit path. |
| 03 | Critical | Services may not import `node:fs`/`node:child_process` (arch test `no-direct-node-io.test.ts:23`, allowlist = `docs-content.ts`); `process.exit` only in `output/exit.ts` (`no-direct-exit.test.ts`). | Cache I/O via existing `FsPort`; registry lookup via a **new port** whose Node adapter shells `npm view` in `adapters/`; route every exit through `exitWithEnvelope`. |
| 04 | Critical | **Nothing** in the CLI resolves `$HOME`/`USERPROFILE` and there is **no** registry/network access today → **two new ports needed**; architecture §2.1 explicitly **defers HTTP**. | Extend `EnvPort` with `home()`; add a `VersionLookupPort` (Fake + Node adapter via `npm view`, **not** an HTTP adapter). Each ships interface-first with a Fake (P3). |
| 05 | Critical | The existing `harness skills update` path (`acts/skills.ts:247-403`; `buildInstallArgv`/`buildRemoveArgv`/`LEGACY_SKILL_SLUGS` in `services/skills/contract.ts:44-57`; degraded contract) is exactly what the reconcile needs. | **Reuse** that service path (refresh-then-prune, degraded-on-prune-fail); do not re-implement skill install. |
| 06 | High | `harness skills update` **hard-requires `--target`** (`E108`, exit 1) and there is **no auto-detection** of which agent CLI(s) skills were installed into. | No `--target` (or `--check`) → **report-only** envelope + `next_action` enumerating `KNOWN_SKILL_TARGETS`; never invoke `skills update` with no target. With a target → **propagate** refresh-fail (error/1) vs prune-fail (degraded/0), don't flatten. |
| 07 | High | **Plan 018 is shipped**: pkg `@ai-substrate/engineering-harness@0.2.0`, `publishConfig.registry` → GH Packages, tag `v0.2.0`, dist-tags `latest`/`canary`; the **manifest is the repo-root `package.json`** (no `harness/cli/package.json`). | Channel `npm i -g @ai-substrate/engineering-harness@latest` (pin → `@X.Y.Z`, a concrete version — **not** a dist-tag). Read installed version from the root manifest via `readVersion()`. Confirm `latest` is live on the registry before relying on it for `--check`. |
| 08 | High | The act/exec **announce-then-run** pattern (`skills.ts:179-191`) is the model: print exact command (human→stderr / JSON→`data.command`), then `deps.exec.run`; never spawn directly. New act registers like `registerSkillsAct` (`app.ts:177-185`); `update` is a non-colliding top-level name (only `skills update` exists). | Mirror it for every subprocess (`npm i -g …`, `npx skills …`). |
| 09 | Critical | **(validation-discovered)** The single universal emit path is **`exitWithEnvelope` — 43 call sites** (`exit.ts:17`), **not** `createOutputPort`. JSON branches route through `createOutputPort('json', …)`, but **human branches build bespoke inline `{ emit }` closures** (`skills.ts:69,238,330,393`; `doctor.ts:53`; `new.ts:78`; `init.ts:71`; `observe.ts:185`; `record.ts:90`; `docs.ts:70`; `instructions.ts:61`; `help.ts:40`) that bypass `renderHuman`. Decorating only `createOutputPort` would land the JSON field but **miss the human stderr line on nearly every command** → breaks AC8. | Decorate at **`exitWithEnvelope`**: set `env.update_available` *before* `io.emit(env)` (JSON: `renderJson` serializes it — universal; `renderHuman` + bespoke human ports ignore the extra field — harmless), and emit the single human stderr line from `exitWithEnvelope` via a threaded banner context (`{ mode, writers, provider }`). **Audit all 43 exit sites + bespoke ports (T006B).** |

## Implementation

**Objective**: Ship `harness update` (+ `--check`/`--pin`), `self-install`, the 24h-throttled check with a user-global cache, the additive `update_available` banner at the output chokepoint, and the skills reconcile — all behind injected ports with fakes.

**Testing Approach**: **Hybrid** (spec). Full-TDD for the deterministic core (semver compare, throttle decision, cache read/write, banner enrichment + render); lightweight for the thin `update`/`self-install` exec pass-throughs (assert argv built + envelope shape via `FakeExec`). **Fakes only — no `vi.mock`/`vi.spyOn`** (P3).

### Tasks

| Status | ID | Task | Domain | Path(s) | Done When | Notes |
|--------|-----|------|--------|---------|-----------|-------|
| [ ] | T000 | **Harness pre-flight** — `/eng-harness-flow --event pre-implement --phase "Implementation" --plan-dir docs/plans/019-harness-update --json` | — | — | Router envelope handled; verdict narrated verbatim before code | _Harness seam — advisory, router installed; never a gate_ |
| [x] | T001 | Extend `EnvPort` with `home()` (interface + `NodeEnv` via `os.homedir`/`USERPROFILE` + `FakeEnv`) | cli-update | `src/adapters/env/{env-port,node-env,fake-env}.ts` + test | Fake returns injected home & records calls; Node resolves `$HOME`/`USERPROFILE`; unit tests green | TDD. Per KF-04 |
| [x] | T002 | New `VersionLookupPort` — interface + `FakeVersionLookup` (scripted latest / throw) + Node adapter shelling `npm view @ai-substrate/engineering-harness version --json` | cli-update | `src/adapters/version-lookup/*` + test | Fake substitutable; adapter builds correct `npm view` argv against the GH Packages registry; **no `node:*` in services** | TDD (fake) + lightweight (adapter). Per KF-03/04 |
| [x] | T003 | Pure semver "is-newer" compare | cli-update | `src/services/update/semver.ts` + test | Correct for newer/equal/older, pre-release/`canary`, malformed→safe (treated as "no update") | TDD |
| [x] | T004 | Update-check cache model + read/write (`FsPort`+`EnvPort.home()`→`~/.harness/update-check.json`, `Clock` for ts) | cli-update | `src/services/update/cache.ts` + test | Missing→null; corrupt/unreadable→null (no throw); round-trips `{last_success_iso,latest}`; path under home, **never `cwd()/.harness`** | TDD. Per KF-02/03 — AC6 |
| [x] | T005 | Throttle decision + check orchestration (read cache → due if `now−last_success≥24h` → call lookup → on success write+advance ts; on failure keep ts → compute `update_available` from last-known) | cli-update | `src/services/update/update-service.ts` + test | `FakeClock`: just-under window ⇒ **zero** lookup calls; just-over ⇒ one; failure doesn't advance ts; clock-backwards ⇒ "fresh"; known update survives a failed refresh | TDD. AC2/AC5/AC6/AC9 |
| [x] | T006 | Envelope additive field + banner at the **true exit chokepoint**. Add optional `update_available?:{installed,latest,command}` to `Envelope` (`output/envelope.ts`). In **`exitWithEnvelope`** (`output/exit.ts`, the universal 43-site exit) set `env.update_available` from the sync banner provider **before** `io.emit(env)` (JSON: `renderJson` serializes it automatically; human/bespoke ports ignore the extra field); then in **human mode only** emit one **stderr** line `update available to <latest> from <installed> — run: harness update` via the threaded banner context. Pin `command: "harness update"`; the human line sources its command from the field. New signature `exitWithEnvelope(env, io, banner?)`. Document the field on `services/docs/contract.ts` | cli-output | `src/output/{envelope.ts,exit.ts,output-port.ts}`, `src/services/docs/contract.ts` + tests | Provider present ⇒ JSON field / one human stderr line; absent ⇒ output byte-identical (existing `toEqual` pass); field never in human, line never in JSON; banner follows `selectMode` (incl. `HARNESS_JSON=1`); `command=="harness update"` asserted | TDD. Per KF-01/02/09 — AC7/AC8/AC11 |
| [x] | T006B | **Banner reaches every emit path** — audit all 43 `exitWithEnvelope` call sites + the ~24 bespoke human `{ emit }` closures (`skills`/`doctor`/`new`/`init`/`observe`/`record`/`docs`/`instructions`/`help`); ensure none bypass the banner. Conformance test asserting the human stderr line appears for a **bespoke-port act** (`doctor` **and** `skills`), not just the shared `verb`/`createOutputPort` path | cli-output | `src/acts/{doctor,skills,new,init,observe,record,docs,instructions,help}.ts`, `harness/cli/test/output/*` | A representative bespoke-port act emits the banner in human mode; no exit path is missed | Per KF-09 — AC8 |
| [x] | T007 | Wire new ports + the sync banner provider into the composition root. `defaultDeps()` builds `NodeEnv`(home), `NodeVersionLookup`; `main()` builds a **sync** banner provider (cache read via `FsPort`+`EnvPort`, compare to `readVersion()`) and threads it so **`exitWithEnvelope`** applies it (per KF-09/T006); extend `VerbActDeps` | cli-update | `src/app.ts`, `src/acts/verb.ts` | Banner available to the exit chokepoint for every command; only a sync cache read on the hot path (no await) | Per KF-02 — AC9 |
| [ ] | T008 | `update` act — bare `update` (install `@latest`), `--check` (fresh lookup, **report-only**, exit 0), `--pin <vX.Y.Z>` (install that concrete version; not-in-registry→error+`next_action`). Mirror `registerSkillsAct`; announce-then-run via `ExecPort`; envelope `data:{installed_before,installed_after,command}`; already-latest ⇒ no-op (`before==after`) | cli-update | `src/acts/update.ts`, `src/app.ts` + test | All three subcommands return correct envelope + exit; argv asserted via `FakeExec`; `--check` with lookup empty/throw ⇒ graceful (`latest:null`/unknown, documented status + exit, no crash); `update`/`self-install` honour global `--json`/`--no-json`/`HARNESS_JSON`; registered & discoverable | Lightweight + branch tests. Per KF-07/08 — AC1/AC2/AC3 |
| [ ] | T009 | `self-install` convenience (global install from registry; missing `.npmrc`/`read:packages` token ⇒ `status:error` + `next_action` describing the one-time `.npmrc`+token setup per 018) | cli-update | `src/acts/update.ts` (or `self-install.ts`), `src/app.ts` + test | Installs from registry; afterwards `harness --version` resolves on PATH; auth-missing path returns actionable error | AC4 |
| [ ] | T010 | Update/auth failure mapping — failed `update`/`self-install` ⇒ `status:error` + actionable `next_action` for: registry auth missing/expired (401/403 → `@ai-substrate` `.npmrc` + `read:packages`), global-npm permission denied (→ node version manager / elevated), npm absent | cli-update | `src/services/update/update-service.ts` + test | Each failure class maps to the right `next_action`; verified with `FakeExec` exit codes | TDD. AC10 |
| [ ] | T011 | Skills reconcile orchestration — with `--target <cli> [--global]`: run existing skills-update path (refresh via `npx skills add`, prune `LEGACY_SKILL_SLUGS` via `npx skills remove`), fold into envelope `skills:{refreshed,pruned,...}`, propagate refresh-fail(error/1) vs prune-fail(degraded/0). No target / `--check`: **report-only** — report refresh-available + prune candidates + print exact `harness skills update --target <cli>` (`next_action` lists `KNOWN_SKILL_TARGETS`); never invoke with no target | cli-skills · cli-update | `src/acts/update.ts`, `src/services/update/*`, `src/services/skills/*` (already-exported helpers — no new exports) | Target path reconciles + propagates degraded/error; no-target path mutates nothing and suggests the command | TDD with `FakeExec`. Per KF-05/06 — AC13/AC14 |
| [ ] | T012 | Conformance + MCP-seam regression — run arch tests (`no-direct-node-io`, `no-direct-exit`) + envelope snapshot/round-trip; update the 4 `toEqual` sites + human stderr assertions for the conditional line; confirm no `node:*` in services, all new logic behind ports+fakes, no `vi.mock`/`vi.spyOn` | cli-output · cli-update | `harness/cli/test/{architecture,output}/*` | `just fft` green; arch boundary still passes; envelope contract additive-only | AC11/AC12 |
| [ ] | T013 | Docs — install/update/run model in `harness/cli/README.md` (registry install + `.npmrc`/`read:packages` token per 018, `update`/`--check`/`--pin`/`self-install`/skills reconcile) + NEW `docs/how/keeping-the-harness-up-to-date.md`; coordinate with 018's install docs (no contradiction) | docs | `harness/cli/README.md`, `docs/how/keeping-the-harness-up-to-date.md` | Both read correctly; consistent with 018's `.npmrc`/token instructions | — |
| [ ] | T0ZZ | **Harness phase-end** — `/eng-harness-flow --event phase-end --plan-dir docs/plans/019-harness-update --json` | — | — | Router envelope handled at phase end | _Harness seam — advisory, router installed; never a gate_ |

> **Highest-complexity task**: T006 + T006B (the cross-cutting `update_available` banner) is the plan's one high-N item — broad blast radius across the **43 `exitWithEnvelope` sites + ~24 bespoke human `{ emit }` ports** on the MCP-stable seam. It stays in scope (CS-4 overall) only because of the explicit audit (T006B) + the bespoke-port conformance test; treat it as the riskiest task, not a thin decoration.

### Acceptance Criteria

- [ ] **AC1** `harness update` prints then runs `npm i -g @ai-substrate/engineering-harness@latest` via `exec`; `status:ok`, `data:{installed_before,installed_after,command}`; already-latest ⇒ `before==after` (no-op, not error).
- [ ] **AC2** `harness update --check` does a fresh lookup (ignores throttle), updates cache, `status:ok`, `data:{installed,latest,update_available:boolean}`, exit 0, **no install**.
- [ ] **AC3** `harness update --pin vX.Y.Z` installs that exact version; one-time (no persisted pin); not-in-registry ⇒ `status:error` + clear `next_action`.
- [ ] **AC4** `harness self-install` installs globally from the registry; missing `.npmrc`/token ⇒ `status:error` + setup `next_action`; afterwards `harness --version` resolves on PATH.
- [ ] **AC5** Registry lookup at most once / 24h from the last-success ts; a command inside the window makes **zero** network calls; failure doesn't advance the ts.
- [ ] **AC6** Cache at a user-global path via the env-home port (never the repo's `.harness/`); first-run miss ⇒ lookup+write; corrupt cache ⇒ "no info", no crash.
- [ ] **AC7** JSON mode: an additive top-level `update_available:{installed,latest,command}` (with `command == "harness update"`) when known-available; absent otherwise (snapshots/consumers unaffected).
- [ ] **AC8** Human mode: exactly one stderr line `update available to <latest> from <installed> — run: harness update`; never stdout; field/line never cross modes.
- [ ] **AC9** A known-available update keeps showing through later lookup failure / missing token / offline; only a genuinely unknown state shows nothing; no added hot-path latency (single sync cache read).
- [ ] **AC10** Failed `update`/`self-install` ⇒ `status:error` + actionable `next_action` for auth-missing/expired, global-npm permission denied, npm absent.
- [ ] **AC11** New envelope field is optional/additive; `--json` contract, exit-code mapping, snapshot/round-trip tests still pass (human-mode tests updated for the conditional line).
- [ ] **AC12** All new logic behind injected ports (`fs`/`exec`/`clock`/env-home/version-lookup); **no `node:*` imports in services** (P2); fakes only, no mocks (P3).
- [ ] **AC13** `harness update` (and `--check`/no-target) **reports** the skills situation (refresh-available + which `LEGACY_SKILL_SLUGS` would prune) with no `npx skills` mutation.
- [ ] **AC14** Given `--target <cli> [--global]`, `harness update` runs the existing `harness skills update` path (refresh+prune), announces the commands, folds `skills:{refreshed,pruned,...}` into the envelope, and propagates refresh-fail(error)/prune-fail(degraded); no target ⇒ prints the `harness skills update --target <cli>` command instead.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Registry auth required (no anonymous) — lookup & install need `@ai-substrate` `.npmrc` + `read:packages` token | High | Med | Check degrades silently (AC9); `update`/`self-install` return actionable `next_action` (AC10); document the one-time setup (T013). |
| `latest` dist-tag not yet populated on the registry (018's publish job fires post-merge) | Med | Med | Confirm `latest` is live before relying on it; `--check` reports "unknown" gracefully if `npm view` returns nothing. |
| Global `npm -g` permissions (system Node may need sudo; nvm/Volta don't) | Med | Low | `next_action` guides toward a node version manager / elevated install. |
| Envelope is an MCP-stable seam — a non-additive change breaks consumers | Low | High | Field strictly optional + decoration at the exit chokepoint (not in `format*`); arch + snapshot/round-trip regression (T012); validation confirmed additive is snapshot-safe. |
| Banner must reach **all** emit paths — human branches use bespoke per-act `{ emit }` ports that bypass `createOutputPort`; only `exitWithEnvelope` is universal | High | High | Decorate at `exitWithEnvelope` (KF-09); audit all 43 exit sites + ~24 bespoke ports (T006B); conformance test on a bespoke-port act. |
| Hot-path latency from an every-command check | Low | High | Only a sync cache read on the hot path; async refresh off it (KF-02). |
| Cache corruption / clock skew | Med | Low | Treat as "no info", never crash; clock-backwards ⇒ "fresh" (T004/T005). |
| Skills target unresolvable (no auto-detect) | High | Low | Report-only + suggest the command when no `--target` (KF-06; offer-don't-force). |
| Coarse "updated" detection (`npx skills add` refreshes all to latest; no per-skill diff) | High | Low | Report "refresh available" + prune candidates rather than a per-skill changelog — honest limitation, not a gap. |

## Harness Seams

- **Entry point**: `/eng-harness-flow --event <seam> [--phase <id>] [--plan-dir <p>] --json` — the single door to the engineering harness; child skills are private and never named here. (Router **is** installed at `~/.agents/skills/eng-harness-flow`.)
- **Backpressure** (post-spec seam): not run for this plan (Simple mode; user went spec → architect). No `backpressure-coverage.md` — absence changes nothing.
- **Pre-implement** (`--event pre-implement`): fired at the start of the single phase (task T000); verdicts narrated verbatim (`healthy / SLOW / UNHEALTHY / UNAVAILABLE`); `UNAVAILABLE` falls back to standard testing.
- **Phase end** (`--event phase-end`): fired at the phase seam (task T0ZZ); `--event plan-complete` fires at merge.
- **Best-effort**: every seam is advisory and never blocks; the router decides what the harness does at each.

## Validation Notes

`/validate-v2` ran 4 parallel read-only validators (coherence/structure · completeness/testing/risk · thesis-alignment · forward-compatibility/source-truth) on 2026-06-15.

- **Source-truth**: all 8 Key-Finding anchors independently CONFIRMED against `harness/cli/` (synchronous `exitWithEnvelope`; the 4 `toEqual` sites; both arch tests; repo-root `readVersion()`; 018 shipped at `v0.2.0`; the already-exported skills helpers; no `$HOME`/registry access today; the composition root). Forward-compat: all 5 modes PASS.
- **Thesis-alignment**: READY justified; evidence quality **Strong**; the "staleness impossible to miss" raison d'être survives as concrete tasks.
- **CRITICAL applied** — the banner was re-targeted from `createOutputPort` to the **true universal chokepoint `exitWithEnvelope`**: human-mode acts build bespoke `{ emit }` ports that bypass `createOutputPort`/`renderHuman`, so the original approach would have missed AC8 on most commands. Added KF-09, rewrote T006, added the **T006B** audit + bespoke-port conformance task, and a Risks row. (CS-4 holds; T006/T006B is flagged as the one high-N task.)
- **MEDIUM/LOW applied** — pinned `update_available.command = "harness update"`; added `--check` empty/auth-fail + `HARNESS_JSON`×banner + `--json` parity coverage; added `version.ts`/`exit.ts` to the Domain Manifest; dropped the moot "export-only if needed" hedge (skills helpers are already exported).
- **Residual (external, not plan-quality)** — the channel presumes 018's GH Packages `latest` is actually published and token-auth works; the plan degrades gracefully and flags it (KF-07 + Risks).

**Outcome alignment** (verbatim, from the forward-compatibility validator): *"make the globally-installed harness CLI keep itself current and make staleness impossible to miss." — the plan as written advances it: every source anchor it relies on is CONFIRMED, all five forward-compatibility modes PASS, the additive `update_available` banner at the single sync chokepoint makes staleness visible on every command while the `update`/`self-install`/`--pin` family + skills reconcile keep the CLI current, with only two LOW cosmetic issues that do not block the North Star.*
