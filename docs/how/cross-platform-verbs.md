# Cross-platform verbs — the portable I/O contract + `windows-check`

Harness verbs run wherever the CLI runs — Linux, macOS, **and Windows**. The verb
contract gives you portable primitives for every side effect, so an extension
never reaches for a POSIX shell-out (`bash -c …`, `mkdir`, `cp`, `sleep`, `nohup`)
or a `/tmp` literal, and never imports `node:*` directly. A deterministic lint
verb, `harness windows-check`, proves your verbs stay portable **by construction**
— no Windows CI runner required.

> **Where docs live (for now):** user guides live under `docs/how/`. Documentation
> is planned to become a first-class, CLI-surfaced concept later; this guide is
> written standalone so it can be promoted/indexed without moving.

> **Layer rule.** `node:*` lives **only** in the core's adapters (`harness/cli/src/adapters`),
> never in an extension verb. Verbs receive every capability through the injected
> `ctx`; the adapters own the platform-specific code (and the Windows `.cmd`
> resolver). This is what `windows-check` enforces.

---

## The portable contract (what to use instead of a shell-out)

| Need | Use | Not |
|------|-----|-----|
| Run a real repo command (build/test/git/minih) | `ctx.exec(cmd, args, { cwd? })` | `ctx.exec('bash', ['-c', …])` |
| Write a file | `ctx.fsWrite.writeText(path, contents)` | `bash -c 'printf … > file'` |
| Make a directory | `ctx.fsWrite.mkdirp(path)` | `ctx.exec('mkdir', ['-p', …])` |
| Copy a file (optionally confined) | `ctx.fsWrite.copy(src, destDir, { confineRoot? })` | `ctx.exec('cp', …)` + a `realpath` guard |
| A unique temp dir | `ctx.fsWrite.mkdtemp(prefix)` | `` `/tmp/x-${ts}` `` + `mkdir -p` |
| Resolve symlinks | `ctx.fs.realpath(path)` | `ctx.exec('realpath', …)` |
| Wait between polls | `await ctx.clock.sleep(ms)` | `ctx.exec('sleep', ['1'])` |
| Launch a detached, fire-and-forget worker | `ctx.background.spawnDetached({ command, args, cwd, logPath, env? })` | `bash -c 'nohup "$@" & echo $!'` |

`ctx.fsWrite` and `ctx.background` are **optional capabilities** — feature-detect
them so a verb degrades gracefully on an older core:

```ts
if (!ctx.fsWrite || !ctx.background) {
  return ctx.error('E_CORE_TOO_OLD', 'this verb needs a newer harness core', {
    next_action: 'Run `harness update`, then re-run.',
  });
}
const tmp = ctx.fsWrite.mkdtemp('my-verb-');
const { pid } = ctx.background.spawnDetached({ command: 'minih', args, cwd: ctx.cwd, logPath });
```

### Why these, specifically

- **`spawnDetached` reuses the core `.cmd` resolver.** On patched Node (≥20.12.2,
  and the CLI's `>=22` floor) you **cannot** `spawn('foo.cmd', args, { shell:false })`
  — it throws `EINVAL`. The only injection-safe route is `cmd.exe /d /s /c` with
  `windowsVerbatimArguments`, which the core already implements; `spawnDetached`
  rides on it, so you never hand-build a `.cmd` launch. (Background:
  `docs/plans/031-windows-portability-and-check/workshops/001-windows-cmd-launch-escaping.md`.)
- **Confined `copy` closes a CWE-59 hole in one operation.** A cloned (untrusted)
  repo can commit a fixed artifact path as a **symlink** to a host file
  (`~/.ssh/id_rsa`). `ctx.fsWrite.copy(src, destDir, { confineRoot })` resolves the
  real path, checks containment, and copies from the *resolved* path in a single
  call — no silent skip-all on Windows, and no check-then-copy TOCTOU window.
- **`git clone` needs `core.longpaths`.** Windows' 260-char `MAX_PATH` truncates
  deep clones; pass `-c core.longpaths=true`.
- **Split basenames on both separators.** `url.split('/').pop()` drops the
  basename of a backslash path — use `url.split(/[/\\]/).pop()`.

### Node version floor

The CLI requires **Node ≥22** (`engines.node`), the patched baseline where the
`.cmd` EINVAL fix is present on every supported runtime. `harness doctor` adds a
`node-runtime` layer that degrades with an upgrade `next_action` when the running
Node is below the floor — advisory, never blocking.

---

## `harness windows-check`

Statically scans the **extension verb layer** (`.harness/extensions/**`, excluding
the verb's own files, `*.test.*`, and `fixtures/`) for the anti-patterns above and
reports a warn-launch envelope. The core (`harness/cli/src`) is **out of scope** —
its adapters legitimately own `node:*`.

```bash
harness windows-check          # human summary
harness windows-check --json   # the envelope (scanned, findingCount, byRule, findings[])
```

| Outcome | `status` | exit |
|---|---|---|
| 0 findings | `ok` | 0 |
| ≥1 finding | `degraded` | 0 (warn-launch — visible, non-blocking) |
| not a git tree | `unconfigured` | 2 |

### Rules

| id | flags |
|----|-------|
| WIN001 | POSIX shell-out / coreutil via `ctx.exec`/`spawn` |
| WIN002 | hard-coded `/tmp` path |
| WIN003 | `git clone` without `-c core.longpaths=true` |
| WIN004 | single-separator basename split `.split('/')` |
| WIN005 | `node:*` / `fs`/`path`/`os`/`child_process` import in a verb |
| WIN006 | direct `child_process` spawn |
| WIN007 | POSIX absolute path (`/usr`, `/bin`, …) or `process.env.HOME` |
| WIN008 | `nohup` / `& echo $!` detached-launch idiom |

### Suppressing a deliberate line

Append `// win-ok: <reason>` to opt a single line out of **all** rules — the
escape hatch for a justified, ubuntu-only exception. Note: the rules scan
comments too (so commented-out hazards are caught), so reword a *descriptive*
comment that merely names a pattern, or suppress it.

### Wiring

`windows-check` runs in the engineering loop (`just fft` → `… windows-check`) and
in CI as a `::warning` step (mirroring `arch-check`/`markdown-lint`): findings are
visible but never fail the build until the verbs regress. Full agent briefing:
`harness instructions windows-check`.

---

## The proof boundary

`windows-check` proves your verb *sources* are free of the flagged patterns. It
does **not** prove runtime behaviour on a real Windows host — that is the job of
the downstream on-Windows re-port and the core's `windows-command.ts` tests +
the Windows-shaped sensors in `harness/cli/test/`. If you hit a Windows-incompat
pattern no rule catches, add a rule (with a hostile + safe test pair) to
`.harness/extensions/windows-check/lib/rules.ts`.
