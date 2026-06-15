# Fix FX002: stamp the running harness version to `.harness/state/version.txt` (fleet-scannable)

**Created**: 2026-06-15
**Status**: ⬛ **Closed — won't do** (2026-06-15) — decision: not pursuing the version fleet-stamp. No code was written. This doc is retained as a record of the design and the decision to drop it. The `.harness/state/version.txt` path proposed below was a **proposal only** and is **not** a shipped contract.
**Plan**: [019-harness-update](../harness-update-plan.md)
**Source**: User requirement — *"when the harness runs, it should save the current version of itself to `.harness` somewhere … `.harness/<some_general_harness_folder>/version.txt` … so I can scan them from the GitHub side — imagine I have big product teams, I can scan what version of harness they are using."* The companion to FX001's `--version` work: `--version` answers *"what version am I?"* interactively; this answers *"what version is each repo on?"* **at fleet scale, without running anything** — by leaving a committed breadcrumb every run.
**Domain(s)**: harness-cli (one new pure service + one `main()` call site — **no Envelope/port/act contract change**)

---

## ⚠️ One decision to confirm before building (it's a committed contract)

The stamp path is what a fleet operator **greps across every repo on GitHub** — once published it's a contract, and moving it later is a migration. Proposed:

```
.harness/state/version.txt
```

**Why `state/`**: `.harness/` already carries `engineering-harness.md` (governance), `extensions/`, `history.md`, `records/` (tracked), `temp/` (gitignored). A new `state/` folder reads as *"tracked runtime state the harness records about itself"* — distinct from `records/` (retros) and `temp/` (scratch). It is **not** in `.gitignore`, so it commits and is greppable on GitHub. Alternatives considered: `.harness/version.txt` (root — rejected: user asked for "some general harness folder", i.e. a subfolder) and `.harness/meta/version.txt` (`state` reads better for "current installed version"). **Confirm or veto `.harness/state/` before the implement step.**

---

## Problem

A platform owner with many product teams has no zero-touch way to answer *"what harness version is each repo running?"* Today you'd have to clone each repo and run `harness --version`. There's no committed artifact a GitHub code-search / org-wide grep can read.

The harness already knows its own version at runtime (`readVersion()`, surfaced via `--version` after FX001). It just never **persists** it anywhere a scanner can see.

## Proposed Fix

On **every** CLI invocation, idempotently write the running semver to `.harness/state/version.txt` — but **only in repos that have already adopted a harness** (a `.harness/` dir exists), and **never fatally** (a read-only FS must not break the CLI).

Design mirrors the existing `ensureTemp()` precedent (`services/shared/temp.ts`) — "idempotently ensure a file under `.harness/<sub>/` via injected `FsPort`", so no `node:fs` enters a service (Constitution P2):

1. **Guard** — compute `harnessDir = <cwd>/.harness`; if `fs.exists(harnessDir)` is false → **skip** (`reason: "no-harness"`). We never *create* `.harness/` just to stamp; that would litter non-adopted repos.
2. **Idempotent** — desired content is exactly `` `${version}\n` `` (the bare semver + trailing newline). Read the current file; if it already equals desired → **skip** (`reason: "unchanged"`). This is what makes git **diff only on an actual upgrade**, not on every run.
3. **Write** — `mkdirp(stateDir)` then `writeText(file, desired)` → `reason: "written"`.

The call sits in `app.ts main()` right after the version is resolved (so it fires on **every** path — `--help`, `--version`, real verbs, even pre-build error envelopes), wrapped in `try/catch` so any FS failure is swallowed (non-fatal).

**Content shape**: a single line, just the semver (`0.3.0\n`) — deliberately minimal so the file is trivial to scan and only changes on upgrade. (Not JSON, not a timestamp — a timestamp would diff every run and defeat the "diff = upgrade" property.)

### Human / external actions

**None.** Pure repo work — no npm, no publisher, no secrets. The stamp begins appearing the next time any consumer runs the (next-published) harness in a `.harness/` repo. This repo itself will start emitting `.harness/state/version.txt` when the harness runs here (the worked example / dogfood).

## Domain Impact

| Domain | Relationship | What Changes |
|--------|-------------|-------------|
| harness-cli | owner | New pure service `services/runstamp/run-stamp.ts` (`writeRunStamp(deps, version)`, mirrors `ensureTemp`); one guarded call in `app.ts main()` after version resolution. **No** Envelope/port/act change, no new error code, no new dependency. `.gitignore` unchanged (`.harness/state/` must stay tracked). Consumer docs gain a short "fleet version scanning" note + regenerated `docs-content.ts`. |

## Tasks

| Status | ID | Task | Path(s) | Done When |
|--------|-----|------|---------|-----------|
| [ ] | FX002-1 | **Pure runstamp service** — add `STATE_DIR = 'state'` + `STAMP_FILE = 'version.txt'`; export `writeRunStamp(deps: {fs: FsPort; proc: ProcessPort}, version: string): RunStampResult` where `RunStampResult = { written: boolean; reason: 'no-harness' \| 'unchanged' \| 'written'; path?: string }`. Compute paths with `posixJoin`/`toPosix` + `HARNESS_DIR` (reuse from `services/shared`). Guard on `.harness/` existence; idempotent compare; `mkdirp` + `writeText`. **No `node:fs` import.** | `harness/cli/src/services/runstamp/run-stamp.ts` | Service returns the right `reason` for no-harness / unchanged / written, all via `FsPort`. |
| [ ] | FX002-2 | **Wire into `main()`** — after `const version = … readVersion()` (`app.ts:252`), call `try { writeRunStamp({ fs: deps.fs, proc: deps.proc }, version); } catch { /* fleet stamp is best-effort — never break the CLI */ }`. Fires on every invocation; runs before commander parses so `--help`/`--version` also stamp. | `harness/cli/src/app.ts` | Any invocation in a `.harness/` repo writes/refreshes the stamp; the call cannot throw out of `main()`. |
| [ ] | FX002-3 | **Tests** — unit-test the service against `FakeFs`: (a) no `.harness/` → `no-harness`, nothing written; (b) first run → `written`, file === `` `${version}\n` ``; (c) same version again → `unchanged`, no rewrite; (d) different version → `written`, content replaced; (e) a throwing `writeText` is swallowed at the `main()` call site (app-level). Then full `vitest run` green (confirm existing app tests unaffected — the guard skips fakes with no `.harness/`). | `harness/cli/test/services/runstamp/run-stamp.test.ts` · `harness/cli/test/app.test.ts` | New tests pass; full suite green; biome clean. |
| [ ] | FX002-4 | **Docs** — short "Fleet version scanning" note (where it writes, that it's committed + greppable, diff = upgrade) in `harness/cli/README.md` and `docs/how/keeping-the-harness-up-to-date.md`; `npm run gen:docs`; `npm run check:docs` green. Confirm `.harness/state/` is **not** added to `.gitignore`. | `harness/cli/README.md` · `docs/how/keeping-the-harness-up-to-date.md` · `harness/cli/src/services/docs/docs-content.ts` (regen) | Docs describe the contract path + scanning; drift-guard green; stamp stays tracked. |
| [ ] | FX002-5 | **Build green** — `npm run build` exit 0; biome clean. | repo root | `npm run build` clean; `npx biome check` clean. |

## Acceptance

- [ ] Running **any** `harness` command in a repo that has `.harness/` writes/refreshes `.harness/state/version.txt` whose entire content is the running semver + a trailing newline.
- [ ] **Idempotent**: a second run on the same version produces **no git diff**; bumping the version is the **only** thing that changes the file.
- [ ] A repo with **no** `.harness/` is left untouched — the command never creates `.harness/` just to stamp.
- [ ] The write is **non-fatal**: a read-only / unwritable FS does not change the command's exit code or envelope.
- [ ] `.harness/state/version.txt` is **tracked** (not gitignored) — visible to a GitHub org-wide grep / code search.
- [ ] No `node:fs` in the new service (Constitution P2); no Envelope/port/act contract change; full vitest suite green; `npm run build` + biome clean; `check:docs` passes.

## Discoveries & Learnings

_Populated during implementation._

| Date | Task | Type | Discovery | Resolution |
|------|------|------|-----------|------------|
