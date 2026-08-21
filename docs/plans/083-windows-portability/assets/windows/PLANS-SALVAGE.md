# Salvaged from the three stream coders before they were closed (2026-08-10)

The streams were stopped and the seats closed before any edit was made. **Nothing was committed,
pushed or merged; all three worktrees were verified clean at 5e1aa48a.** Two findings from their
planning messages are worth more than the seats were, and are recorded here so nobody re-derives
them.

## 1. MY OWN STEER ON THE NULL-DEVICE FIX WAS WRONG — `/dev/null` IS the documented answer

I briefed S1 that `/dev/null` on Windows "works only because git treats a missing file as no
config — a behaviour, not a device", and pushed toward a guaranteed-empty temp file.
`pij-inc-mastodon` contradicted it with a citation:

> git's own `Documentation/git.adoc`, ENVIRONMENT VARIABLES, `GIT_CONFIG_GLOBAL` /
> `GIT_CONFIG_SYSTEM`: *"Take the configuration from the given files instead from global or
> system-level configuration files. … Can be set to `/dev/null` to skip reading configuration
> files of the respective level."*

So it is a **documented contract of the variable**, not an ENOENT accident. Combined with wilson's
positive-controlled measurement on the target box (git 2.55.0.windows.3: `/dev/null` → exit 0,
isolated), it is the only candidate that is both **documented upstream** and **measured on
Windows**. The temp file is neither, and would add fs I/O, a lifecycle, cleanup-on-crash, an
injected seam, and a new failure mode (tmpdir unwritable) inside the security-critical isolation
path — a subsystem replacing a constant, to buy less certainty.

**Consistency evidence already in the tree**: `exec-git-write.int.test.ts:167` and
`services/flow/archive-move.test.ts:65` already use the literal `/dev/null` on both platforms, each
with a comment giving this reasoning. **The product is the outlier, not `/dev/null`.**

Also proposed and worth keeping: rename `nullDeviceForPlatform` for intent (it is no longer a null
*device* at all — the old name is half the reason this went wrong), and make the test assert the
value is **platform-independent** so the win32 answer is checked on every host.

**Two untouched siblings emit the rejected value on Windows** and would be left behind by a
product-only fix:
- `test/support/hermetic-git.ts:85` — `GIT_CONFIG_GLOBAL: win32 ? 'NUL' : devNull`
- `exec-remote-telemetry-git.int.test.ts:199` — `win32 ? 'NUL' : '/dev/null'`

## 2. The six windsurf rows are ONE product line, and the fix is STRICTER, not looser

`pij-silent-pike` found the mechanism. `agent-matrix.ts:319` joins with `/` deliberately (the data
layer must not import `node:path`), so on Windows the product hands `fs.writeText` a
**mixed-separator** path: `C:\Users\jk\AppData\...\harness-composition-x/.codeium/windsurf/hooks.json`
(home from `mkdtempSync` = backslashes, the rest POSIX-joined).

The fakes compare that against a `node:path.join()` value, which is all-backslash:
- `:186` `if (p === second()) throw …` → never matches → **the fake never refuses**
- `:894` `if (p.endsWith('windsurf/hooks.json'))` → hardcoded POSIX separator

**When the fake never refuses, the failure under test never happens** — the row asserts a failure
path that did not execute. That is why all six sit in one file.

The test is the wrong side (Windows accepts forward slashes; the field evidence stands — both
`~/.codeium` files written, probe reports `runs`). The proposed fix replaces `endsWith` with a
path-comparison helper, which is **stricter than what it replaces**, not a relaxation.

**Third defect, reported not fixed**: those mixed-separator paths reach the operator — the failure
`reason` string and `install-record.json` will show `C:\Users\jk/.codeium/hooks.json` on Windows.
User-visible, owned by whoever owns the matrix.

## 3. The journal-race 14-where-8 has three candidate causes, distinguishable on sight

Contract confirmed as one record per fire process (`acts/hooks.ts:310` returns early, mutually
exclusive with `commit-intercept.ts:91`), so 8 processes must be 8 lines. **H1** accumulation — the
K-loop's `rmSync(recursive+force)` fails on Windows (`force` only suppresses ENOENT; `maxRetries`
defaults to 0, so EBUSY/EPERM is not retried), leaving run 1's lines to be counted again. **H2**
double-record. **H3** genuine interprocess duplication. The **per-run vector** separates them: H1
grows monotonically with run 1 == 8; H2 shows run 1 already > 8. We have the total, not the shape.
