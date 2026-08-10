# Coder brief — plan 077, round four: the null-device product defect (#108)

**PM**: `pij-respectable-clam` · **You**: copilot / claude-opus-5 / high
**Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s077-suite-portability`
**Branch**: `s077/suite-portability` @ `f19bf0d1` — clean, pushed, CI green.

## The finding is the downstream consumer's, and it is a PRODUCT defect, not a test one

`os.devNull` on Windows returns `\\.\nul`. **Git rejects that as a config path** with
`Invalid argument`. The spelling git accepts is `NUL`.

Our two sites, both in `harness/cli/src/adapters/git/exec-remote-telemetry-git.ts`:

```
:107    GIT_CONFIG_GLOBAL: credentialConfigPath ?? devNull,      safeCredentialConfigEnvironment
:126    ...(materializing ? { GIT_CONFIG_GLOBAL: devNull } : {}), safeGitEnvironment
```

**Why it matters more than a failing assertion:** `GIT_CONFIG_GLOBAL` is the isolation
boundary for the whole remote-telemetry adapter — it is how a fixture git run is prevented
from reading the operator's real global config. On Windows, `GIT_CONFIG_GLOBAL=\\.\nul`
does not produce a clean empty config; it produces an error from git. **The isolation we
intended is not the isolation we get**, on a platform where `harness telemetry` is
expected to work.

Their fork carries the fix and has for longer than their involvement:

```ts
// Windows accepts 'NUL' as a null device for git config paths; os.devNull returns '\\.\nul' on
// Windows, which git rejects with "Invalid argument". Use the canonical device name instead.
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : devNull;
```

The test file is **byte-identical** between our trees — they diffed it, zero delta. It
fails on their box and passes on ours purely because the *source* differs.

## What I want

1. **The fix at both sites.** Do not fix one.
2. **A test that fails without it.** The existing assertion is `GIT_CONFIG_GLOBAL === devNull`,
   which is *correct on POSIX and wrong on win32* — so it cannot catch this. Whatever you
   write must be able to return the contrary answer on a POSIX host. Simulated win32 is
   fine and is what we have; label it as simulated.
3. **Check for OTHER `os.devNull` uses that reach a git config path or any Windows-hostile
   consumer.** Enumerate mechanically — `grep`, not reading — and report the count. One
   site fixed and a sibling left is this thread's most repeated defect shape.

## What is NOT in scope

The other six failures they reported. They reproduce on our tree 3/3 runs and they are
**deranked by the consumer**, twice for `exec-remote-telemetry-git`. Do not touch them.

Do not touch `#129`, `#130`, or anything else filed.

## Honesty constraints — non-negotiable, and this thread has cost us four rounds of them

- **Nobody here has a Windows box.** Every win32 outcome is **expected, unverified**. Say so.
- **We have NOT verified that git rejects `\\.\nul`** — that is the consumer's mechanism,
  from a comment in their fork, and they said plainly they could not date it or find a
  changelog entry. Do not restate it as our measurement.
- If you flag your own softest claim, I will point the reviewer at it. That has caught
  something real in two of the last three rounds.

## Operational

- Invoke the CLI as `node harness/cli/bin/harness.js`. **Never `just link`.**
- Commit: `HARNESS_NO_TELEMETRY=1 timeout 30 git commit --no-verify`, explicit pathspecs.
  **Never `git add -A`. Never `git stash`.** Do not push until I say.
- Gate with `just checks`. Bare `npx vitest run` self-pollutes; do not chase that failure.
- Three warn-launch degradations are pre-existing: `arch-check` ×2, `markdown-lint` 210,
  `windows-check` 6. None is yours unless you add to them.

> ⚠️ **BASELINE CORRECTION (2026-08-09):** the `markdown-lint 210` above is stale — the
> branch measured **211** (195 lint / 15 links / 1 mermaid) even on the three-check gate, and
> `6a43fd4d` on main adds a fourth check that will move it again at merge. **Derive it, do not
> quote it:** `harness markdown-lint --json | jq '.data.checks[] | {name, outcome, findings, examined}'`.
> Full reasoning and the three-state attribution table: [`BASELINE-CORRECTION-markdown-lint.md`](./BASELINE-CORRECTION-markdown-lint.md)
