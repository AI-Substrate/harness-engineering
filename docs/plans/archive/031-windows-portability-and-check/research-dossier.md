# Research Report: Windows portability for the dogfood verbs + a deterministic `windows-check` extension

**Generated**: 2026-06-19T02:32Z
**Research Query**: "re-add Windows portability to validate-harness-flow + add a deterministic windows-check extension"
**Mode**: Pre-Plan (plan-associated · `docs/plans/031-windows-portability-and-check/`)
**FlowSpace**: Not available (standard tools + 5 parallel research threads)
**Findings**: 18 (F1–F18) + 2 Perplexity deep-research reports folded in (§ Deep Research), 3 prior learnings

> Source for the ask: upstream handover `scratch/paste/20260619T021244.md` (analyzed earlier this session; every POSIX-only claim verified true against the current branch). Prior art: plan `017-windows-cross-platform-fixes` (CLI path-separator + package-smoke fixes — shipped, distinct, closed).

---

## Executive Summary

### What it does
Two repo-local **dogfood** verbs (`validate-harness-flow`, `validate-harnessability`) clone public repos to a temp dir and fire detached `minih` workers to self-test the harness. Both are **POSIX-only** today and **completely non-functional on Windows** (the fork develops on Windows). This work re-adds cross-platform support to the verbs **and** adds a new `windows-check` lint verb that catches the anti-pattern classes deterministically on ubuntu — "prove Windows by construction, no Windows CI", matching plan 017's posture.

### Key insights
1. **(F7, HIGH) The hard gap is the detached fire.** `ctx.exec` is blocking and has **no `detached`** — there is *no way at all* to launch a background process through the verb contract. Every other POSIX call has a portable swap; the fire does not. This single capability gap is the crux of the design.
2. **(F8, HIGH) The core exec adapter is already Windows-safe for blocking calls.** `ctx.exec` routes through `resolveSpawn` (`windows-command.ts`), which resolves `.cmd`/`.bat` shims via `cmd.exe`. So `ctx.exec('minih'|'git'|'node', …)` already works on Windows — only the **coreutils** (`mkdir`/`cp`/`sleep`/`printf`/`realpath`) and **`bash`/`nohup`** are broken.
3. **(F10, HIGH) A cleaner design than the handover assumed.** The handover proposes restoring a `node:*`-importing sidecar `lib/portable.mjs`. But the underlying `FsPort` already has `mkdirp`/`writeText`/`rename` (just not exposed on `ctx`), and core `resolveSpawn` already solves `.cmd`. P8 ("implement original behaviour only where a real gap exists") points to **filling the gap in the core contract** rather than bolting a sidecar onto a verb. This is the central decision (§ Design Fork) and is workshop/ADR-worthy.
4. **(F13) `windows-check` is largely generalizing an existing sensor.** `windows-shape.test.ts:266-300` already asserts "no `node:path` imports under `src/services/**` except `shared/posix-path.ts`" — a static Windows-compat rule expressed as a vitest test. The new verb promotes that idea to a first-class, repo-wide, CI-wired check.

### Quick stats
- **Port surface**: ~14 POSIX-only call sites across 3 files (table below); near-identical in both verbs.
- **Capability gaps in `ctx`**: 2 (read-only fs; no detached spawn) — F6/F7.
- **Reuse assets already in-repo**: 5 (posix-path helper, resolveSpawn, windows-shape tests, .gitattributes, arch-check/markdown-lint scaffold) — F11–F15.
- **Complexity**: Medium — the verb swaps are mechanical; the *design decision* (sidecar vs core primitive) and the detached-spawn primitive carry the novelty/risk.
- **Shipping boundary**: the verbs are **repo-local dogfood, NOT in the npm `files`** (F16). A core-primitive fix (Option B) *does* ship to consumers; a sidecar (Option A) does not.

---

## The port surface — POSIX-only call inventory (verified, file:line)

Every Windows failure mode the handover lists is real. `ctx.exec(<coreutil>)` and `ctx.exec('bash', …)` are the breakages; `ctx.exec('minih'|'git')` are already fine (F8).

| # | Site | Current (POSIX-only) | Windows failure | Portable intent |
|---|---|---|---|---|
| F1 | `validate-harness-flow/extension.ts:738`; `validate-harnessability/extension.ts:102` | `ctx.exec('bash',['-c','command -v minih'])` | no `bash` on stock Windows → dies line 1 | `ctx.exec('minih',['--version'])` — core resolves `.cmd` (F8) |
| F2 | `…flow/extension.ts:766-767`; `…ability/extension.ts:121-122` | `/tmp/…` + `ctx.exec('mkdir',['-p',tmpRoot])` | no `/tmp`, no `mkdir` binary | temp dir under `os.tmpdir()` via a portable mkdtemp |
| F3 | `…flow/extension.ts:802`; `…ability/extension.ts:156` | `git clone --depth=1` (no longpaths) | deep trees > `MAX_PATH` (260) → `Filename too long` | add `-c core.longpaths=true` (no-op on POSIX) |
| F4 | `…flow/extension.ts:87`; `…ability/extension.ts:40` | `repoName`: `url.split('/')` | Windows local path → 60-char blob | `url.split(/[/\\]/)` |
| F5 | `…flow/extension.ts:817-831`; `…ability/extension.ts:169-185` | `ctx.exec('bash',['-c','… nohup "$@" … & echo $!'])` **(detached fire)** | no `bash`/`nohup`; POSIX job-control | **see F7 — the hard gap** |
| F6 | `…flow/lib/worker-io.ts:50` | `ctx.exec('bash',['-c','printf "%s" "$2" > "$1"'])` (write) | no `bash`/`printf` | portable file write |
| F7 | `…flow/lib/worker-io.ts:100-103` | `ctx.exec('mkdir',['-p',destDir])` + `ctx.exec('cp',…)` | no `mkdir`/`cp` binary | portable mkdir+copy |
| F8 | `…flow/lib/worker-io.ts:90-98` | `ctx.exec('bash',['-c','realpath … case …'])` **(CWE-59 confine guard)** | `realpath` POSIX-only → guard errors → **silently skips every copy** (security degrades to "collect nothing") | portable realpath-confine (Node `fs.realpathSync` + containment) |
| F9 | `…flow/lib/worker-io.ts:43`; `…flow/extension.ts:451,532,863`; `…ability/extension.ts:81` | `ctx.exec('sleep',…)`, more `ctx.exec('mkdir',…)` in the collect path | no `sleep`/`mkdir` binary | portable sleep / mkdir |

**Preserve (do NOT revert):** the CWE-59 confine guard (F8), `--global` mode (`…flow/extension.ts:718-722,762-763`), and injection-safe argv-only fire/write (positional `"$@"`, never interpolated). The change is the *mechanism*, not these wins.

---

## Capability-gap analysis (why a naive swap isn't enough)

The verb contract (`harness/cli/src/services/extensions/contract.ts:59-104`) is deliberately thin:

| Gap | Evidence | Consequence |
|---|---|---|
| **F6-CG `ctx.fs` is READ-ONLY** | `contract.ts:68-72` — only `exists`/`readText`/`readdir`. The injected `FsPort` *does* have `mkdirp`/`writeText`/`rename` (`adapters/fs/fs-port.ts:9-28`) but it is **not** exposed on `ctx`. | A verb cannot write/mkdir/copy without shelling out to a coreutil (which Windows lacks). |
| **F7-CG `ctx.exec` cannot detach** | `contract.ts:66-68` (no opts beyond `cwd`); `node-exec.ts:23-27` spawns with `shell:false`, **no `detached`**, resolves only on child `close` (`:37-40`). | There is **no** way to fire-and-forget a background `minih` worker through the contract. This is the one capability that has no in-contract substitute. |
| **F8-OK blocking exec is already cross-platform** | `ctx.exec` → `resolveSpawn` (`windows-command.ts:132-183`) wraps `.cmd`/`.bat` via `cmd.exe /d /s /c "<line>"` with `windowsVerbatimArguments` set **only** on the cmd path; rejects literal `"` (BatBadBut/CVE-2024-27980). | `ctx.exec('minih'|'git'|'node', …)` already works on Windows — narrows the real problem to coreutils + bash + detach. |

---

## ⭐ Design Fork (the central decision — workshop / ADR candidate)

The handover assumes **Option A** (restore the sidecar). Research surfaces a cleaner **Option B**. This is the one genuinely open design question; recommend resolving it in a workshop before planning phases.

**Option A — repo-local sidecar `lib/portable.mjs` (handover's proposal).** Verb shells `ctx.exec('node',['lib/portable.mjs',op,…])`; the `.mjs` (a separate process, morally a coreutil) does `mkdirp`/`cp`/`write`/`sleep`/`mktemp`/`fire` and resolves `.cmd` for the detached launch.
- ➖ **Duplicates `resolveSpawn`** — a plain `node` sidecar can't import the core `.ts` (only the jiti-loaded *verb* can, F12); it would copy-paste the Windows resolution (drift risk, exactly the PR #24 convergence hazard).
- ➖ **`node:*` in the sidecar** — P2 says services MUST NOT import `node:child_process`/`node:fs` (`constitution.md:65-77`); research found **no written carve-out** for a separate spawned process (F17). Needs a deviation-ledger entry (no `docs/adr/` exists, F18).
- ➕ Smallest core change; does not touch the shipped contract; confined to the dogfood verbs.

**Option B — fill the gap in the CORE contract ("wrap, don't rebuild" applied to `ctx`).** P8 (`constitution.md:112-116`) sanctions original behaviour "where a real gap exists" — and F6/F7 *are* the gap. Expose portable write primitives on `ctx` (the `FsPort` methods already exist) and add a core detached-spawn primitive (e.g. `ctx.spawnDetached`/`fire`) in `NodeExec` that **reuses** `resolveSpawn` + sets `detached:true`, stdio→logfile, `unref()`, `windowsHide`.
- ➕ Verbs need **no** `node:*`, **no** sidecar, **no** duplication, **no** P2/P8 deviation.
- ➕ Ships to consumers — every extension gets cross-platform I/O; testable on ubuntu via fakes.
- ➖ Larger, careful core change (new contract surface + tests); the detached primitive is novel.

**Option C — hybrid.** Option B for write/mkdir/copy/sleep (cheap: expose `FsPort` + trivial sleep), and minimize the `node:*` exposure for the *one* thing core lacks (detached launch) — either a core `fire` primitive (preferred) or a single-op sidecar. Shrinks the novelty/exemption to detached-spawn alone.

**Recommendation:** B or C. Both eliminate the duplication and the constitution deviation that Option A incurs, and B benefits the shipped product. Decide the detached-spawn home (core primitive vs sidecar) in a workshop — that is the crux.

---

## `windows-check` extension — scaffold spec (conventions verified)

A repo-local dogfood verb; **discovery is automatic** (no manual registration — `discovery.ts:27-85`, `registry.ts:60-176`); `doctor` lists it and flags a missing `instructions.md` (`doctor-service.ts:130-171`).

- **Files** (mirror arch-check/markdown-lint): `.harness/extensions/windows-check/extension.ts` (thin shell) + `lib/rules.ts` (pure rule fns) + `lib/rules.test.ts` (+ `fixtures/`) + `instructions.md`.
- **Enumerate** scan targets via `ctx.exec('git',['ls-files', …])` (cross-platform; respects ignore) → `ctx.fs.readText` each → run pure rules. Zero non-portable deps.
- **Verb skeleton** = `HarnessVerb` default export (`name/summary/description/options/run`) like `arch-check/extension.ts:24-115`.
- **Envelope / warn-launch** (copy arch-check `mapping.ts`): 0 findings → `ctx.ok`; warn-severity → `ctx.degraded`/exit 0; error-severity → `ctx.error`/exit 1; can't enumerate (no git) → `ctx.unconfigured`/exit 2 (P5); crash → `ctx.error`. Every rule **starts at warn** and is promoted to error as the tree goes clean.
- **Rule set** (each a pure, deterministic match; inline `// win-ok:` suppression + allowlist): (1) non-portable shell-outs `ctx.exec('bash'|'sh'|<coreutil>,…)`; (2) hardcoded `/tmp`; (3) `git clone` without `core.longpaths`; (4) path-split on a bare separator (`.split('/')`); (5) native `node:path` join/dirname/relative outside `shared/posix-path.ts` (generalizes the `windows-shape.test.ts:266-300` guard, F13); (6) extensionless node-CLI spawn (`execFileSync('npm'|'npx'|'biome'|'tsc'|'depcruise',…)`); (7) POSIX env (`process.env.HOME` w/o `USERPROFILE`; `:` instead of `path.delimiter`); (8) hygiene meta-rules (`.gitattributes` `eol=lf`; Windows-shaped sensor tests still present).
- **Wiring**: a `just` recipe folded into `fft` (P11, like markdown-lint `justfile:173-181`) **and** a CI `::warning` step (like arch-check `ci.yml:103-123`). Invoke via `node harness/cli/bin/harness.js windows-check` — **not** `npx` (PL-1).
- **Tests**: pure `lib/rules.test.ts` feeds each rule Windows-hostile + Windows-safe fixtures → deterministic pass/fail on ubuntu (the by-construction proof; mirrors `mapping.test.ts`).

---

## Dependencies & reuse map

| Asset | Location | Use |
|---|---|---|
| POSIX path helper | `harness/cli/src/services/shared/posix-path.ts:1-104` (`toPosix`/`isWithin`/`dedupeKey`) | rule-5 reference; the canonical "logical paths are POSIX" helper production code must use |
| `resolveSpawn` (`.cmd` resolution) | `harness/cli/src/adapters/exec/windows-command.ts:132-183` | Option B's detached primitive reuses it; **not** importable by a plain-node sidecar (F12) nor via package subpath (`exports` = `.` + `./contract` only, F16) |
| `FsPort` write methods | `harness/cli/src/adapters/fs/fs-port.ts:9-28` (`mkdirp`/`writeText`/`rename`) | already exist in core; Option B exposes them on `ctx` |
| Windows-shaped sensor tests | `harness/cli/test/services/windows-shape.test.ts:26-300` | the proof pattern to extend; already carries a source-guard (F13) |
| `.gitattributes` | repo root (`* text=auto eol=lf`) | hygiene meta-rule asserts it stays |
| Extension scaffold + envelope + wiring | `.harness/extensions/{arch-check,markdown-lint}/` | copy structure for `windows-check` |

---

## Risks & danger zones

- 🚫 **F8 CWE-59 guard regression (security).** The confine guard already **silently degrades to skip-all on Windows** today (POSIX `realpath`). Any reimplementation MUST preserve "resolve both, assert src under root, skip (return false) on escape" — and folding resolve+check+copy into one op closes a TOCTOU window. Don't lose the guard while making it portable.
- ⚠️ **F7 detached-spawn primitive (novelty).** A new core background-spawn API is the riskiest piece — get the stdio→logfile, `unref`, `windowsHide`, and `.cmd` resolution right; pin with fakes.
- ⚠️ **No Windows CI (by decision).** Proof is by construction + ubuntu Windows-shaped fakes + the downstream `verify-port.ps1` re-port. Upstream cannot *execute*-prove the verb on Windows here.
- ⚠️ **Two near-identical verbs.** `validate-harnessability` shares every breakage; fix both (or factor shared fire/tmp/io) or the divergence just moves.

---

## Prior Learnings

| ID | Type | Source | Insight → action |
|---|---|---|---|
| **PL-1** | gotcha | `.harness/records/retro/2026-06-10/008-017-windows-build-drain.md:22-28` (DL-002) | `npx --no-install` root-bin resolution is nondeterministic across npm majors → invoke `windows-check` (and CI/just) via `node harness/cli/bin/harness.js …`, never `npx` (also AGENTS.md). |
| **PL-2** | convention | same retro `:34-37` (CONF-001) | check verbs are **cwd-sensitive** and `--json` is the **default** (not a flag) → make `windows-check` cwd-robust and default to the envelope. |
| **PL-3** | decision | `docs/plans/017-windows-cross-platform-fixes/…plan.md:36-43` | 017 deliberately took "by construction, **no Windows CI**" and deferred "extensionless-bin spawning via NodeExec" — which **was subsequently shipped** (`windows-command.ts`, `CHANGELOG.md:10`). This work continues that track; reuse 017's helper + test pattern rather than re-deriving. |

---

## External research opportunities (`/deepresearch` prompts)

- **DR-1 (Option B/C detached spawn):** "Best-practice Node.js pattern for a CLI to launch a fully-detached, fire-and-forget child whose stdout/stderr go to a log file and that survives the parent exiting, cross-platform — `spawn({detached, stdio:['ignore',fd,fd], windowsHide})` + `unref()`, including launching a `.cmd` shim via `cmd.exe` and capturing the child PID. Edge cases on Windows (job objects, console detachment) vs POSIX (`setsid`/`nohup`)."
- **DR-2 (contract surface):** "Designing a minimal, testable write/spawn capability on a hexagonal CLI's verb context — expose existing `FsPort` write methods vs a new write port; keep adapters fakeable for deterministic ubuntu tests; avoid widening the `node:*` boundary into verbs."

---

## Deep Research (Perplexity) — resolves the Design Fork

Two jobs run (DR-1 `sonar-deep-research`; DR-2 `sonar-pro`). Primary sources: the Node.js `child_process` docs, the BatBadBut writeup, the Node CVE-2024-27980 advisory, and ports-and-adapters literature. **Net: Option B/C is confirmed; the detached-spawn mechanics are now fully specified — and DR-1 surfaces a security-relevant simplification of the repo's *existing* exec adapter.**

### DR-1 — the cross-platform detached fire (crux mechanics)
- **Canonical pattern** (DR-1 §2.4, §3.2, §5.2): `spawn(cmd, args, { shell:false, detached:true, stdio:['ignore', logFd, logFd], windowsHide:true })` → record `child.pid` → `child.unref()`. Log fds via `fs.openSync(path,'a')`; stdio MUST be real file descriptors, never pipes (avoids EPIPE after the parent exits). Behaves identically on POSIX (own session/process group, no `SIGHUP` on terminal close) and Windows (survives parent + console close).
- **Prefer bypassing the `.cmd` shim** (DR-1 §2.4, §4.3, §7.3): launching `minih.cmd` detached **still pops a console window even with `windowsHide:true`**, whereas `spawn(process.execPath, [<resolved minih JS entry>, …])` does not. Resolve the underlying JS entry and spawn `node` directly where possible; else fall back to the **absolute** `.cmd` path.
- **⚠ SUPERSEDED on the spawn-mechanics point — see [`workshops/001-windows-cmd-launch-escaping.md`](workshops/001-windows-cmd-launch-escaping.md).** DR-1's claim below that `spawn(absoluteCmdPath, args, {shell:false})` is "safe" on patched Node is **wrong**: patched Node (≥20.12.2 / 22.x) *throws `EINVAL`* for a bare `.cmd` with `shell:false` (Node docs + CVE-2024-27980). The cmd.exe wrapper + `windowsVerbatimArguments` in `windows-command.ts` is the **documented-correct** pattern, not a bug. Read the workshop's Decision Space, not the bullet below, for the build contract.
- **⚠ `windowsVerbatimArguments` is the wrong tool for `.cmd`** (DR-1 §4.3–4.4, §6.1): on **patched Node (≥20.12.2 / July-2024 22.x)**, `spawn(absoluteCmdPath, args, {shell:false})` *without* `windowsVerbatimArguments` is safe — Node's built-in escaping mitigates BatBadBut/CVE-2024-27980. Setting `windowsVerbatimArguments:true` **disables** that protection and re-exposes injection unless you perfectly reimplement cmd.exe escaping yourself.
  - **F19 (follow-up, MEDIUM):** the repo's core `windows-command.ts:141-168` does exactly that error-prone path — explicit `cmd.exe /d /s /c "<line>"` + `windowsVerbatimArguments:true` + a hand-rolled `quoteCmdArg`/`"`-rejection. It passes today's tests + a real-Windows smoke, but DR-1 says that on the now-required Node baseline it could be **simplified and de-risked** to "resolve absolute `.cmd`, spawn with Node's default escaping" (or bypass to `node` + JS entry). The new detached primitive should adopt the safer pattern from day one rather than copy the verbatim approach. Workshop/ADR candidate.
- **Node baseline is a real requirement** (DR-1 §6.1–6.3): pin `engines` ≥20.12.2 / patched 22.x + a runtime `process.versions.node` guard; always pass **absolute** executable paths (never rely on `PATH`/`PATHEXT` — hijack + accidental `.cmd` selection); don't use PowerShell as a detached worker (crashes without a console).

### DR-2 — the capability surface (how to add it to `ctx`)
- **Split FS into read + write ports** (`FileSystemReadPort` + `FileSystemWritePort`); inject `fsWrite?` only where needed (least-privilege). InMemory fake records an ops log; tests assert *what* was written.
- **Model the launch as a dedicated `BackgroundProcessPort`** (or higher-level `TaskRunnerPort`), **not** raw `spawn`. The fake records `{command,args,cwd,env}` and returns a synthetic pid; tests assert *intent*, not real process creation — keeps the verb deterministic on ubuntu.
- **`node:*` stays in adapter modules**; ports + `VerbContext` live node-agnostic; the CLI entrypoint wires the Node adapters — verbs never import `node:*`. **No sidecar, no P2 deviation.**
- **Optional capabilities** (`fsWrite?`, `background?`) let verbs degrade gracefully; version the context as a whole, additive-compatible.

→ **Verdict:** adopt **Option B** — DR-2 gives the exact port/fake shape, DR-1 gives the exact adapter mechanics. The one remaining workshop item is F19 (verbatim-vs-patched-Node in `windows-command.ts`), which the new detached adapter should settle.

## Recommended next step

Proceed to **plan** (`1b`). Deep research has effectively resolved the design fork, so the plan should: (a) adopt **Option B** — a read/write FS port split + a fakeable `BackgroundProcessPort` (detached `spawn`+`unref`+log-fds, absolute paths, **no** `windowsVerbatimArguments`), pinning the Node ≥20.12.2 baseline; (b) carry **F19** (simplify/harden core `windows-command.ts`) as an explicit workshop/decision the detached adapter settles; (c) port **both** dogfood verbs onto the new ports, preserving the F8 CWE-59 guard + `--global` + injection-safety; and (d) add the `windows-check` extension (warn-launch, `just fft` + CI). Mode is likely **Full** (CS ≈ 4: a new contract surface + adapter, two verb ports, a new verb, security-sensitive) — the plan pass confirms.
