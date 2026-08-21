# `harness windows-check` — agent briefing

This verb is **deterministic Windows-compatibility back pressure**: it moves
"does this run on Windows?" out of the inferred world (eyeballing, a `windows-latest`
CI leg the team ruled out) into the deterministic one. It statically scans the
**extension verb layer** (`.harness/extensions/**`) for the cross-platform
anti-patterns the dogfood verbs once regressed on, and reports an honest
envelope. Run it after any change to an extension; CI runs it through this
same verb (one rule set, one code path) whenever CI is dispatched — see
AGENTS.md, CI is manual on branches.

Windows compatibility is proven **by construction** on the existing ubuntu legs
— there is no Windows runner (continuing plan 017's posture for the core's
`windows-command.ts`).

## What it proves — and the proof boundary

**Proves**: no in-scope extension source contains a flagged Windows-incompatible
pattern (POSIX shell-out/coreutil, a `/tmp` literal, a `git clone` without
`core.longpaths`, a single-separator basename split, a `node:*`/builtin import,
a direct `child_process` spawn, a POSIX absolute path / `$HOME`, or a `nohup …`
detached-launch idiom).

**Does not prove**: runtime behaviour on a real Windows host (a portable-looking
call can still fail for other reasons — the downstream `verify-port.ps1` re-port
is the on-Windows confirmation); anything outside `.harness/extensions/**` (the
core `harness/cli/src` legitimately owns `node:*` in its adapters and is **out of
scope**); patterns no rule encodes yet (a missing rule stays silently green).
The complement is the core's `windows-command.ts` tests + the Windows-shaped
sensors in `harness/cli/test/`.

If you find a Windows-incompat pattern this verb misses, that's harness feedback
— add a rule to `lib/rules.ts` (with a hostile + safe test pair) so the next
regression is caught.

## Scope (what gets scanned)

`git ls-files` → keep only `.harness/extensions/**` source (`.ts/.js/.mjs/.cjs`),
**excluding** this verb's own files, `*.test.*`, and `fixtures/` (they carry the
patterns as data). The core and other layers are not scanned — they are allowed
to use `node:*`.

## Outcome states

| Condition | `status` | exit | what to do |
|---|---|---|---|
| 0 findings | `ok` | 0 | nothing — the verbs are portable |
| ≥1 finding | `degraded` | 0 | review `data.findings[]`; fix per each finding's `message`, or suppress a deliberate line (below). **Warn-launch** — visible, never blocking |
| not a git work tree | `unconfigured` | 2 | run from the repo root (inside the git tree) |
| unexpected failure | `error` | 1 | `E_WINDOWS_CHECK_UNEXPECTED` — inspect `error.details`; the scan is pure text matching, so this should never fire |

## Rules

| id | flags |
|----|-------|
| WIN001 | POSIX shell-out / coreutil via `ctx.exec`/`spawn` (use `ctx.fsWrite` / `ctx.clock.sleep` / `ctx.background` / a real cross-platform tool) |
| WIN002 | hard-coded `/tmp` path (use `ctx.fsWrite.mkdtemp`) |
| WIN003 | `git clone` without `-c core.longpaths=true` |
| WIN004 | single-separator basename split `.split('/')` (use `/[/\\]/`) |
| WIN005 | `node:*` / `fs`/`path`/`os`/`child_process` import in an extension (P2 — node:* lives in the core adapters) |
| WIN006 | direct `child_process` spawn (use `ctx.exec` / `ctx.background.spawnDetached`) |
| WIN007 | POSIX absolute path (`/usr`, `/bin`, …) or `process.env.HOME` |
| WIN008 | `nohup` / `& echo $!` detached-launch idiom (use `ctx.background.spawnDetached`) |

## Suppressing a deliberate line

Append `// win-ok: <reason>` to a line to opt it out of ALL rules — the
documented escape hatch for an intentional, justified exception (e.g. a
ubuntu-only maintenance script). Keep the reason specific.

## Gotchas

- **Rules scan comments too** — so commented-out hazardous code is caught. If a
  *descriptive* comment legitimately names a pattern (e.g. "replaces the `nohup`
  idiom"), reword it or add `// win-ok:`.
- Run from the **repo root** — `git ls-files` + the scope filter resolve against
  the invocation cwd.
- Warn-launch by design: findings never fail the build. Promote to blocking by
  raising the wiring's exit handling once the verbs are clean (they are today).

## Evidence

No durable evidence files are written: `scanned`, `findingCount`, `byRule`, and
`findings[]` (each with `file`, `line`, `rule`, `snippet`, `message`) live in the
envelope's `data` — capture it with `harness windows-check --json > out.json` if
you need a record.
