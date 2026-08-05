# Execution Log — 031 Windows Portability + `windows-check`

**Mode**: Simple (10 inline tasks T001–T010) · **Started**: 2026-06-19
**Baseline**: `cd harness/cli && npx vitest run` → 78 files, 890 tests green (pre-change).
**Companion**: `code-review-companion` (active) — reviews working-tree diffs at each task boundary (no per-task commits this run; shared branch).

Authoritative for the `.cmd` launch contract: [`workshops/001-windows-cmd-launch-escaping.md`](./workshops/001-windows-cmd-launch-escaping.md). T002 reuses `resolveSpawn`, never spawns a bare `.cmd` (EINVAL on Node ≥20.12.2), passes `windowsVerbatimArguments` through.

---

## Discoveries & Learnings

| # | Task | Discovery |
|---|------|-----------|
| D1 | T001 | Arch rule `adapters-stay-leaf` (.dependency-cruiser.cjs) forbids `adapters/*` importing `services/*` — so the confine/containment check in the fs adapter uses `node:path` directly (adapters may use `node:*`), not `services/shared/posix-path`. |
| D2 | (all) | **Companion mode is incompatible with a no-per-task-commit run.** It reviews at commit boundaries (`git show <sha>`); adapted to `git diff -- <files>`, but **untracked/new files are invisible to `git diff`** — so the companion saw nothing for the biggest new code (BackgroundProcessPort T002, the whole windows-check extension T006, new test files). It surfaced 0 findings not because the code was clean but because it was mostly blind. Lesson: with no commits, point a reviewer at file **paths** (read directly) or stage first (`git add -N`) so the diff is visible — don't rely on `git diff` for untracked files. |

---

## Task Entries

### T001 — FileSystemWritePort + ctx.fs.realpath ✅
- **Added** `FileSystemWritePort {writeText,mkdirp,rename,copy}` + `realpath` to `FsPort` (`adapters/fs/fs-port.ts`); surfaced `ctx.fs.realpath` + optional `ctx.fsWrite?` in the public contract (`services/extensions/contract.ts`).
- **`NodeFs.copy(src, destDir, {confineRoot?})`** = realpath(root) + realpath(src) + `node:path` containment + `copyFileSync` in **one** call, copying from the **resolved** real path (closes the check-then-copy TOCTOU) and refusing on escape/missing (returns `false`). `node:path` (not `services/shared/posix-path`) because of D1 (`adapters-stay-leaf`).
- **Wiring**: `VerbContextDeps`/`VerbActDeps` gained **optional** `fsWrite` (so existing test deps compile untouched); `buildVerbContext` sets `ctx.fsWrite` only when provided; `defaultDeps` reuses **one** `NodeFs` for both `fs` + `fsWrite`.
- **Tests**: `fake-fs.test.ts` — fake ops-log + realpath; **real-adapter CWE-59 symlink-refusal** (planted out-of-tree symlink → `copy` returns false, nothing written; control proves the *guard* refuses) + allow-inside + missing-source. Evidence: full suite **898 green** (+8); `tsc --noEmit` clean.

### T002 — BackgroundProcessPort.spawnDetached ✅
- **New** `adapters/exec/background-port.ts` (`BackgroundProcessPort` + `SpawnDetachedInput`), `node-background.ts` (`NodeBackground`), `fake-background.ts` (`FakeBackground`). Used the repo's **port/node/fake** convention (vs the plan's single sketch name `background.ts`) for consistency with `node-exec`/`node-fs`.
- **`NodeBackground.spawnDetached`** reuses `resolveSpawn(command,args,cwd,platform)` → `spawn(spec.command, spec.args, {detached:true, stdio:['ignore',logFd,logFd], windowsHide:true, windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false})`, `unref()`, returns pid (throws if null). `logFd = openSync(logPath,'a')` (real fd, no EPIPE). **Never** a bare `.cmd` spawn (workshop 001 I1–I5). `platform` is a constructor seam (default `process.platform`) so the win32 path is unit-testable on ubuntu (P3).
- **Wiring**: `ctx.background?` added to the contract; optional `background` on `VerbContextDeps`/`VerbActDeps`; `defaultDeps` wires `new NodeBackground()`.
- **Tests**: `node-background.test.ts` mocks `spawn` + `openSync` → asserts the win32 `cmd.exe`+verbatim passthrough (I1/I2), `detached`/`stdio`/`windowsHide`/`unref`/pid (I3–I5), env inherit-vs-override, and throw-on-null-pid. Evidence: full suite **902 green** (+4); `tsc` clean.

### T003 — ctx.clock.sleep + Node runtime guard ✅
- **`ctx.clock.sleep(ms)`**: added `sleep` to the `Clock` port; `SystemClock` = `setTimeout`, `FakeClock` resolves immediately + records `sleeps[]` + advances itself (deterministic poll loops). Surfaced on `ctx.clock` in the contract (flows through `buildVerbContext`'s existing `clock: deps.clock`).
- **Runtime Node guard**: `ProcessPort.nodeVersion()` (NodeProcess→`process.versions.node`, FakeProcess→seeded, default `'22.0.0'`); doctor gains a **`node-runtime`** layer (`checkNodeRuntime`) that degrades with an upgrade `next_action` on Node `<22` (advisory, never blocks). Unparseable version ⇒ ok (no false alarm).
- **engines decision (honest call)**: `engines.node` was **already `>=22`** — the patched-22.x floor (all 22.x include the EINVAL/BatBadBut fix; 22.0.0 post-dates the April-2024 security release). So I did **not** churn the string; the genuine gap was that `engines` is *advisory* (npx won't enforce it), which the runtime guard now closes. CHANGELOG `## Unreleased` documents the runtime enforcement as the breaking change + the new portable I/O capabilities.
- **Tests**: `fake-clock.test.ts` (sleep records+advances+resolves; SystemClock real delay); `doctor-service.test.ts` (old Node → degraded + `>=22` next_action; ≥22 → ok). Updated the `doctor.test.ts` layer-name array (+`node-runtime`) — intended new layer. Patched 3 inline test literals (`ctx.fs.realpath`, `ctx.clock.sleep`, `proc.nodeVersion`) for runtime safety. Evidence: full suite **906 green** (+4); `tsc` clean.

### T004 — Port validate-harness-flow ✅
- **Port primitive added**: `ctx.fsWrite.mkdtemp(prefix)` (the plan's "mkdtemp under os.tmpdir()") — extended the T001 write port (port + NodeFs `mkdtempSync(join(tmpdir(),…))` + FakeFs deterministic + contract inline). Also refined `FakeFs.copy` to refuse a missing source (mirror NodeFs).
- **`lib/worker-io.ts`**: `ctx.exec('sleep')`→`ctx.clock.sleep(300)`; `bash printf >`→`ctx.fsWrite.writeText` (try/catch→bool); `bash realpath + mkdir + cp`→ single `ctx.fsWrite.copy(src,destDir,{confineRoot})` (the CWE-59 one-op guard). Kept `writeFile`/`copyInto` `async` so call-sites' `await` is untouched.
- **`extension.ts`**: capability guard (`!ctx.fsWrite||!ctx.background`→`E_CORE_TOO_OLD`); minih precheck `bash -c 'command -v'`→`ctx.exec('minih',['--version'])`; tmpRoot `/tmp/...`+`mkdir`→`ctx.fsWrite.mkdtemp` (removed dead `fsSafe`); `git clone` gains `-c core.longpaths=true`; the **detached fire** `bash nohup "$@" & echo $!`→`ctx.background.spawnDetached({command:'minih',args,cwd:ctx.cwd,logPath})` (literal argv, no shell, never a bare `.cmd`); two collect `mkdir -p`→`ctx.fsWrite.mkdirp`; `repoName` splits `/[/\\]/` (AC-06); `rm -rf` hint → neutral "delete".
- **Preserved**: `--global`/`--github`/`--keep`/`--model`, injection-safety (argv-only), and the **run-id-capture-timeout → degraded+next_action** path (captureNewRun untouched). Verified: **no** POSIX shell-out / `/tmp` literal remains (grep clean); verb still **loads** (`harness doctor` → `loaded`, verb registered); core suite **906 green**; `tsc` clean. Verb-behaviour unit tests (capture-timeout branch, source assertions, Windows-shaped) land in T008.

### T005 — Port validate-harnessability ✅
- **Identical swaps** to T004 on the sibling verb (no `--collect`/`--global`; inline `captureNewRun`): header doc; `repoName` `/[/\\]/`; dropped dead `fsSafe`; `ctx.exec('sleep')`→`ctx.clock.sleep(300)`; capability guard (`E_CORE_TOO_OLD`); minih precheck `bash -c 'command -v'`→`ctx.exec('minih',['--version'])`; tmpRoot `/tmp/...`→`ctx.fsWrite.mkdtemp`; `git clone -c core.longpaths=true`; detached fire `bash nohup`→`ctx.background.spawnDetached({command:'minih',args,cwd:ctx.cwd,logPath})`; `rm -rf` hint → "delete".
- **Preserved**: `--keep`/`--model`, injection-safety, run-id-capture-timeout → degraded. Verified: grep-clean (no POSIX shell-out/`/tmp`); verb **loads** (`doctor` → `loaded`); core suite **906 green**.

### T006 — Scaffold windows-check ✅
- **New extension** `.harness/extensions/windows-check/`: thin `extension.ts` (git ls-files → `inScope` → `ctx.fs.readText` → `scanText` → warn-launch envelope, mirrors arch-check/markdown-lint), pure `lib/rules.ts` (**8 rules** WIN001–WIN008: shell-out/coreutil, `/tmp`, clone-no-longpaths, basename-`split('/')`, `node:*` import, direct `child_process` spawn, POSIX abs-path/`$HOME`, `nohup`/`& echo $!`), `lib/rules.test.ts` (12 tests — hostile+safe per rule, `// win-ok:` suppression, `scanText`, `inScope`, fixture scan), `instructions.md`, and `fixtures/{hostile,clean}-sample.txt`.
- **Scope**: extension verbs only (`.harness/extensions/**`, minus self/tests/fixtures) — the **core owns `node:*`** and is out of scope (no false positives on adapters).
- **Self-caught FP fixed**: the verb initially flagged 4 of my own *descriptive comments* (mentioning `/tmp/` + `nohup`) — rules scan comments (so commented-out hazards are caught), so I reworded the prose. `harness windows-check --json` → **ok, 0 findings across 12 files** (the dogfood verbs are clean by construction). Full suite **918 green** (+12); loads with no convention complaint (instructions present).

### T007 — Wire windows-check into just + CI ✅
- **justfile**: new `windows-check` recipe (`node harness/cli/bin/harness.js windows-check`, never npx — PL-1) added to `fft` (`fix format test lint-md windows-check`).
- **CI** (`.github/workflows/ci.yml`): a `Windows-compat conformance` step mirroring arch-check — runs the verb `--json`, emits a `::warning title=windows-check` on `degraded`, `exit ${code:-0}` (warn-launch: ok/degraded both exit 0; only error/unconfigured fail). YAML validated.
- **Lint**: all 24 of my changed core files pass `biome check harness/cli` (the remaining repo biome errors are the **other agent's** flow files — `flow.ts`/`flow-renderer.ts`/`flow*.test.ts`, untouched by me). Fixed one import-sort nit in `fake-fs.test.ts`.

### T008 — Windows-shaped sensors + guards ✅
- **AC-01 source guard** (`windows-shape.test.ts`): a globbed `it.each` over the 3 dogfood verb sources asserts **no** `ctx.exec('bash'|coreutil)`, `/tmp`, `nohup`/`& echo $!`, or node-builtin import (comments stripped first — windows-check is the comment-aware net). Plus a backslash-shape sensor proving the new write port never leaks a `\` into a surfaced/registered path.
- **AC-02 capture-timeout** (two layers, deterministic on ubuntu):
  - `validate-harness-flow/lib/worker-io.test.ts` — `captureNewRun` returns **null** after the full 12-poll cap when no new run id appears, **sleeping via `ctx.clock.sleep`** (instant in the fake, ×12 @300ms); returns the run on first fresh id (0 sleeps); `writeFile` delegates to `ctx.fsWrite.writeText`.
  - `validate-harnessability/extension.test.ts` — the **whole verb** with fakes: fires via `ctx.background` (asserts `minih run <slug> -p targetRepo=…`, cwd=`/repo`), capture times out → **degraded** with a `run-id capture timed out` next_action; **not one** `ctx.exec` is a coreutil; the clone carries `core.longpaths`; and a core missing the ports → `E_CORE_TOO_OLD`. (Cross-boundary import of `buildVerbContext` + fakes works — repo root is the vitest workspace root.)
- **Caught**: a `*/` inside `node:*/fs` in a `/* */` Test Doc closed the comment early (parse error) — reworded. Evidence: full suite **928 green** (+10); `windows-shape.test.ts` biome-clean.

> **Companion note**: the `code-review-companion` run reached `completed` after T008 (no findings surfaced across T001–T008; fire-and-forget). T009 (docs) + T010 (regression test) proceed without live review; final debrief at phase end.

### T009 — Docs ✅
- **New** `docs/how/cross-platform-verbs.md` (standalone, indexable): the portable contract (a *use-this-not-that* table for `ctx.fsWrite`/`ctx.fs.realpath`/`ctx.clock.sleep`/`ctx.background`), the *why* (EINVAL, CWE-59 confine, `core.longpaths`, dual-sep split), the Node ≥22 floor, and the full `windows-check` reference (states, rules, `// win-ok:`, wiring, proof boundary). markdownlint + mermaid **clean** (the 1 link finding is a pre-existing broken link in another doc).
- **`instructions.md`** (T006) + **CHANGELOG `## Unreleased`** (T003) cover the rest of T009's doc list.
- **Discipline (shared tree)**: I drafted pointer/`ctx`-surface edits to `extend-the-harness.md` + `authoring-verbs.md`, but **both are manifest-bundled** → editing them drifts `docs-content.ts`, which the **other agent has concurrently modified** (an unbacked change in the very `extend-the-harness` block). Running `gen:docs` would clobber their work, so I **reverted** those two edits and kept only the unbundled standalone note — which is exactly what T009 requires ("a `docs/how/` note … for now"). Zero `docs-content.ts` touch from me.

### T010 — windows-command regression test + comment ✅ (no behaviour change)
- The workshop **withdrew** the original "drop verbatim" rewrite. Added a **documenting regression test** (`windows-command.test.ts`) — for both a `.cmd` and a `.bat` target on win32, `command === 'cmd.exe'` (never a bare `.cmd`, asserted via `.not.toMatch(/\.(cmd|bat)$/)`) **and** `windowsVerbatimArguments === true`, with a Test Doc pinning the EINVAL/`/s` rationale + workshop 001. Added a one-line code comment at the `cmd.exe`+verbatim return in `windows-command.ts` marking it load-bearing (pointing at workshop 001). **`windows-command.ts` logic is unchanged.**

---

## Phase complete — Windows portability + windows-check (Simple, T001–T010)

**All 10 tasks ✅.** Final: full suite **933 passed** (83 files; 890 baseline → **+43** new tests), `tsc --noEmit` clean, all changed files biome-clean, `harness windows-check` → **ok / 0 findings across 12 files** (dogfood verbs portable by construction).

**Acceptance criteria:**

| AC | Status | Evidence |
|----|--------|----------|
| AC-01 no shell-out/`/tmp` in the dogfood verbs | ✅ | `windows-check` ok (0 findings) + T008 source guard (`windows-shape.test.ts`) |
| AC-02 detached worker survives + capture-timeout → degraded | ✅ | T008: `captureNewRun`→null (×12 `ctx.clock.sleep`) + the whole-verb degraded test |
| AC-03 CWE-59 confine, one op, no `realpath` shell-out | ✅ | T001: `NodeFs.copy` + the planted out-of-tree-symlink refusal test |
| AC-04 `windows-check --json` valid envelope (ok/degraded/unconfigured) | ✅ | T006/T010: the 4 envelope-state tests + 12 rule tests |
| AC-05 InMemory fakes; deterministic on ubuntu | ✅ | `FakeFs`(copy/realpath/mkdtemp) + `FakeBackground` + `FakeClock.sleep`; all new tests pure |
| AC-06 `core.longpaths` + backslash `repoName` | ✅ | both verbs' clone flag + `repoName` `/[/\\]/`; asserted in the verb test |
| AC-07 patched-22 baseline; reuse `resolveSpawn` + verbatim; no bare `.cmd` | ✅ | engines `>=22` + doctor `node-runtime` guard; T002 adapter test (I1–I5); T010 regression |
| AC-08 `windows-check` in `fft` + CI; `instructions.md` present | ✅ | justfile `fft` + CI `::warning` step; doctor reports no convention complaint |

**Notable decisions:** kept `engines.node` at `>=22` (already the patched floor) and added **runtime enforcement** (doctor `node-runtime`) instead of a no-op string bump; used the repo's **port/node/fake** convention for `BackgroundProcessPort` (vs the plan's single sketch name); extended the T001 write port with `mkdtemp` (the plan's T004 temp primitive); reverted two manifest-bundled doc edits to avoid clobbering the concurrent agent's `docs-content.ts`.

**Not run (by design):** real detached-worker execution / actual `minih` dogfood (side effects) — covered by the fakes + the downstream on-Windows re-port; no per-task commits (shared branch — commit later).

---

## Post-review fixes (review = APPROVE WITH NOTES; 0 HIGH/CRITICAL)

User-run review (`reviews/review.md`, 952→**961** green after fixes). All **2 MEDIUM + 6 LOW** addressed (none blocking; none weakened a safety property):

| # | Sev | Fix |
|---|-----|-----|
| F001 | MED | AC-06 now **proven**: a verb test feeds a backslash URL (`C:\work\acme-repo.git`) and asserts `targetRepo=…/acme-repo` (clean basename) — `validate-harnessability/extension.test.ts`. |
| F002 | MED | `FakeFs.copy` gained a seedable `confineEscapes` refusal oracle; `worker-io.test.ts` proves `copyInto` **forwards `{confineRoot}`** (and omits it on the trusted path) and **refuses** a modeled escape — the CWE-59 call-site wiring is no longer inspection-only. |
| F003 | LOW | `NodeFs.copy` containment is now separator-aware (`rel === '..' \|\| rel.startsWith('..'+sep)`) so an in-tree `..foo` name isn't over-rejected — fixed + test. |
| F004 | LOW | `NodeBackground` closes the log fd in a `finally` (incl. the null-pid throw path) — no descriptor leak per launch; asserted via a mocked `closeSync`. |
| F005 | LOW | `input.env` is forwarded to `resolveSpawn` (5th param) so a win32 `.cmd`/PATH lookup uses the child env — fixed + test. |
| F006 | LOW | New `validate-harness-flow/extension.test.ts` (whole-verb): detached fire, capture-timeout → degraded, `--global` harnessSource, `E_CORE_TOO_OLD`. |
| F007 | LOW | Plan **Domain Manifest + T002 + T003** reconciled with what shipped (the `background-port`/`node-background`/`fake-background` triad — `node-exec.ts` unchanged; `adapters/process/*` + `doctor-service.ts` added). |
| F008 | LOW | Evidence caveat (the companion was blind to untracked files) — already recorded as D2 + the companion-mode honesty note; evidence rests on the green suite + the user review. |

Post-fix: full suite **961 passed (85 files)**, `tsc` clean, changed files biome-clean, `windows-check` ok/0.

**Companion-mode honesty (correction):** companion mode was booted/briefed/pinged but **did not meaningfully review** — see D2. With no per-task commits, the `git diff -- <files>` pings showed nothing for untracked (new) files, so the companion was blind to the bulk of the work and surfaced 0 findings. A genuine code review over the **complete** change set is still owed (the user elected to do it manually). Do not read "0 companion findings" as "reviewed clean."

