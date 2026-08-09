# `harness checks` — agent briefing

## What this verb computes (the deterministic part)

`harness checks` is this repo's **mandated quality gate** — the one command you run
**before considering work done**, and the **same command CI runs** (so local and CI
can't drift). It **composes** the repo's deterministic checks into a single honest
envelope (it never auto-fixes, unlike `just fft`):

| Gate | Runs | Posture |
|---|---|---|
| `tests` | `npx vitest run --coverage` (harness/cli) | **hard** — `error` on failure |
| `biome` | `npx biome check harness/cli` | **hard** — `error` on lint/format issue |
| `typecheck` | `npx tsc --noEmit -p harness/cli/tsconfig.json` | **hard** — `error` on type error |
| `check:docs` | `npm run check:docs` | **hard** — `error` on generated-docs drift |
| `check:flows` | `npm run check:flows` | **hard** — `error` on flow schema/render drift |
| `check:telemetry-fixtures` | `npm run check:telemetry-fixtures` | **hard** — `error` on golden drift |
| `arch-check` | `harness arch-check` | warn-launch — findings → `degraded` |
| `skills-check` | `harness skills-check` | **hard** — `error` on violation |
| `markdown-lint` | `harness markdown-lint` | warn-launch — findings → `degraded` |
| `windows-check` | `harness windows-check` | warn-launch — findings → `degraded` |

**Prerequisite:** the caller must `npm run build` first — `bin/harness.js` runs from
`dist/` and the drift guards need it (CI builds first; `just checks` does too).
`data` carries `{ durationMs, summary, gates[] }`, where each
gate is `{ name, status, exit, note }`.

### Verdicts

| Situation | Status | Exit |
|---|---|---|
| every gate `ok` | `ok` | 0 |
| any hard gate (`tests`/`biome`/`typecheck`/`check:*`/`skills-check`) `error` | `error` (`E_CHECKS_FAILED`) | 1 |
| only warn-launch gates `degraded`/`unconfigured` | `degraded` | 0 |
| run from outside the repo root | `unconfigured` | 2 |

## Your role (the inference part)

- On **`ok`**, the gate is green — work is safe to call done.
- On **`error`**, a hard gate failed. Read `error.details.gates` + `next_action`;
  reproduce the failing gate directly (`just test`, or `harness skills-check`) and
  fix before re-running.
- On **`degraded`**, only warn-launch gates have findings (the repo's launch
  posture — visible, non-blocking). Triage them; they don't block, but they're the
  backlog. A gate is promoted from warn → hard by changing its line in
  `checks/extension.ts`.

## Extending the gate

This is the **growth point**: add a new check (coverage, a security audit, schema
validation, a `tsc --noEmit` typecheck) by adding one gate line in
`checks/extension.ts`. Every caller — `harness checks` directly, and `harness boot`
which composes it — picks it up for free. Keep gates **read-only** (no `--write`).

## Watch out for

- **`checks` runs the test suite** — it's as slow as vitest; keep the suite fast.
- **Don't duplicate this into `boot`.** `boot` composes `harness checks`; the gate
  has exactly one definition here.
- Trust the **envelope + exit code**, never scraped prose.

## `--ref <ref>` — gate another commit without touching your tree

`harness checks --ref <ref> [--keep]` runs the whole gate against any ref inside a
throwaway `git worktree` that installs its own dependencies, and returns the same
envelope with `ref`, the resolved `sha`, `scope` and `isolated: true` attached, so
the verdict carries its own basis. ~55s cold; `--keep` leaves the tree to inspect.

It exists because measuring against another ref used to mean `git stash`, and
**this repo's stash stack is shared across every worktree** — a `pop` can silently
pull another seat's uncommitted work into the tree you are about to commit from.
Three seats reached for it in one day, all while *measuring*. See #145.

Two invariants, both load-bearing:

- **No gate runs in the caller's tree.** The `--ref` branch returns before any
  gate executes, because the gates WRITE tracked files (`gen:docs` and friends
  regenerate) — a `--ref` that changed what was measured while still running in
  your tree would remove the stash and keep the mutation.
- **The isolated tree installs its own deps.** Measured: vitest writes
  `node_modules/.vite/vitest/<hash>/results.json`, so a shared or symlinked
  `node_modules` leaks writes back into the caller's checkout — untracked, and
  invisible to `git status`. No dependency-sharing scheme, however clever.

Test scope defaults to `all` here (a ref verdict should mean the whole gate),
overridden by `HARNESS_TEST_SCOPE`. Cleanup is unconditional — but if a run is
**interrupted** (killed, or `npm ci` fails) the worktree survives, and
**`git worktree prune` will NOT reclaim it**: prune only drops entries whose
directory is missing, and a half-installed tree still has one. Recovery is
`git worktree remove --force <path>`, and the verb reports any it finds rather
than deleting them — a concurrent seat may be running its own `--ref` gate, and
the name alone cannot tell a crashed tree from a live one.
`.harness/extensions/checks/ref-isolation.test.ts` asserts the negative (nothing
gate-like runs in the caller's cwd).
