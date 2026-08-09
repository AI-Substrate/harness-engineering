# Phase 3 execution log — doctor integration, the LIVE install, and the artifact Jordan runs

Plan 082. Seat `pij-cautious-firefly`.

**This phase touches the real home directory.** Every earlier phase was fenced away from it on
purpose. The fence comes down here, deliberately and once — and the task order *is* the safety
property, which is why task one is not the install.

**No independent review stands behind phase 2.** Three consecutive pij spawns wedged identically
across two harnesses (copilot twice, codex once), so the cross-model pass that reviewed phase 1
never ran on phase 2. Phase 2 had the PM's review — which found the vacuous corroboration row, the
copilot ownership defect and the sequential-not-concurrent row — but not another model's. Recorded,
not a reason to stop. The working consequence is written into this phase: **mutate more than usual,
because there is nobody coming behind.**

---

## tk-0001 — the backup was not a restore point, and it could not be made into one by reversing it

### The claim under test

Phase 2 stated, and phase 3's task text repeats, that `backupAgentConfigs` is **write-only**: it
flattens each path into one directory by substituting `__` for `/`, and no code anywhere reverses
the mapping. The task offered two acceptable resolutions — implement the reverse mapping, or use a
copy-tree that preserves relative paths — and one unacceptable one: an unproven restore.

I did not choose between them by reasoning. **The reverse mapping cannot be implemented**, and the
first thing this task produced was the measurement that says so.

### MEASURED — the flatten is not injective (macOS 26.0 arm64, real filesystem, 2026-08-10)

A throwaway int test drove the **real `backupAgentConfigs`** through the **real `NodeFs`** against a
real temp home, with `CLAUDE_CONFIG_DIR` pointing at a directory whose own name carries the
separator — which is an ordinary thing for a user to have, not a contrived one, because the variable
takes an arbitrary path.

```
COPIED  : [
  "/var/folders/mv/.../measure-flatten-qwPpkv/cfg__a/settings.json",
  ".cursor/hooks.json"
]
ON DISK : [
  ".cursor__hooks.json",
  "__var__folders__mv__...__measure-flatten-qwPpkv__cfg__a__settings.json"
]
  INVERSE of .cursor__hooks.json
     -> .cursor/hooks.json                                  <- correct
  INVERSE of __var__..__cfg__a__settings.json
     -> /var/.../measure-flatten-qwPpkv/cfg/a/settings.json  <- A DIFFERENT FILE
```

Two facts, and the second is the one that shaped the work:

1. **The inverse writes to a path that never existed.** Restoring through it would leave the damaged
   original in place and create a stranger beside it — and report success.
2. **`.cursor/hooks.json` round-trips perfectly.** The path this machine actually has, the path any
   demonstration would naturally reach for, is in the subset where the broken mapping works. A
   restore proof built on the paths we expect would have gone green against a mapping that cannot
   restore.

That is the ninth instance of one shape in this plan, in a new place: *the working case is available,
defensible, and one question away from being caught.* Here the question was **which path**, not
whether a round trip happened.

### What was built

The flatten is gone. It was not replaced with a cleverer encoding — it was replaced with **not
encoding at all**.

- **Copies keep their path verbatim**, in two namespaces so the two cannot collide:
  `files/home/<rel>` for a home-relative source, `files/abs/<path>` for an absolute one. A directory
  named `cfg__a` is stored in a directory named `cfg__a`.
- **`manifest.json` is authoritative.** It records the ABSOLUTE source beside its stored location, so
  `restoreAgentConfigs` never parses a filename. No encoding is reversed, so no encoding can be
  reversed wrongly. It carries a `version`, and an unrecognised one refuses.
- **Injectivity is checked, not assumed.** The construction is injective, so the collision branch
  should be unreachable — and it is still there, pushing to `failed` (which blocks the install at the
  call site) rather than overwriting one copy with another. A backup that silently clobbers its own
  copy is worse than no backup.
- **Absences are recorded.** A source that does not exist is not copied — there is nothing to copy —
  but it IS written to the manifest with `existed: false`, because our own installer *creates* config
  files, and for a file we created the restore is to **delete** it. This closes a gap phase 2 could
  only see through the installer's own `created: true` flag.

`copied` / `failed` / `undeclared` / `dir` keep their phase-2 semantics exactly; `absent` is
additive. The phase-2 row asserting that an absent source appears in neither `copied` nor `failed`
still holds and still passes — its stale doc comment (`created: true` is *the only thing* that can
distinguish this case) has been corrected rather than left to rot.

### The demonstration — dw-0001 to dw-0004

`test/services/doctor/collector/backup-restore.int.test.ts`, six rows, **against `NodeFs` in a real
temp tree** (dw-0002). Not a FakeFs: this is the path whose whole purpose is to work when something
has already gone wrong, and the defect that motivated the task was a real-path defect.

| row | assertion |
| --- | --- |
| capture → **mutate** → restore | dw-0001. Byte-identical, compared as a `Buffer`. The fixture carries a JSONC comment, CRLF line endings, a tab, trailing spaces and no trailing newline, so "byte-identical" means more than "same JSON". |
| a path with `__` in its own name | dw-0003. Restores to **itself** — asserted on the path as well as the bytes, plus an explicit assertion that the wrong path the old inverse produced was **not** created. |
| a file that did not exist | dw-0004. The absence is in the manifest; the restore **deletes** the file the install created, asserted on the filesystem. |
| a second restore | Idempotent. An operator already in trouble runs recovery twice; a recorded-absent file that is already gone is `alreadyAbsent`, not a failure. |
| a directory with no manifest | Refused with a reason, never "restored 0 files". The harm this module names is the CLAIM. |
| an unrecognised layout version | Refused. Old directories stay on disk looking restorable; reading one through the wrong reader is how you write the right bytes to the wrong path. |

### PROVEN BY REFUSAL — six mutations, six RED

Green rows prove nothing. Each mutation was applied by **exact-string replacement with a loud abort
on anchor mismatch** — the phase-2 near-miss rule, where biome had reformatted an anchor, the
replacement silently no-opped, and the suite printed "12 passed", which is indistinguishable from
blind tests and resolves in the flattering direction.

| # | mutation | result |
| --- | --- | --- |
| M1 | **the pre-task design restored**: flatten the copy, and decode the FILENAME instead of reading the manifest | RED |
| M2 | restore does not write, but still reports success | RED |
| M3 | the backup stops recording absences (phase-2 behaviour) | RED |
| M4 | restore rewrites an absent entry as an empty file instead of deleting | RED |
| M5 | a missing manifest reported as a clean restore of zero files | RED |
| M6 | an unrecognised manifest version restored anyway | RED |

**M1 is the one worth reading, and it is not the pass/fail that matters but the split:**

```
Tests  1 failed | 5 passed (6)

FAIL  a path with __ IN ITS OWN NAME round-trips — the case the old flatten broke (dw-0003)
- Expected  "/var/.../harness-restore-oVw2pA/cfg__a/settings.json"
+ Received  "/var/.../harness-restore-oVw2pA/cfg/a/settings.json"
```

Under the old design **five of six rows stay green**, including the capture→mutate→restore row and
the delete-an-absent-file row. Only the `__` row dies. So the row dw-0003 asked for is not a
completeness nicety — it is the **only** row in the file that can see the defect the task exists to
fix, and it was named in the task text before I measured anything. That is the assertion earning its
place.

### One collateral change, and why it is not a literal any more

`auto-install.test.ts` injected its write failure at the hard-coded flattened name
`<backup-dir>/.claude__settings.json`. That path no longer exists, so the row stopped injecting
anything and went red — correctly. It now resolves the destination through `storedPathFor`, so the
injection follows the layout instead of silently ceasing to probe when the layout moves. A literal
there would have been a row that quietly stopped testing while staying green.

### What this does NOT deliver — stated now, not discovered in tk-0003

- **There is no `harness` verb that runs a restore.** `restoreAgentConfigs` is a library function
  with a proven round trip; an operator in trouble cannot yet invoke it from a terminal. No
  assertion in tk-0001 asks for one, and unrequested user-facing surface is not mine to add
  silently — but a restore path only a test can reach is thin insurance for a live install, so this
  is a **question for the PM before tk-0003**, not a decision I have taken.
- **Only the agents we enumerate are covered.** Unchanged, and still declared in the backup's own
  detail line: git-ai also installs for agents we do not detect, and those are not backed up.
- **Windows paths are not addressed.** The namespace split tests `startsWith('/')`, which is the
  repo's logical-POSIX convention; a `C:/…` source would be classified home-relative-or-absolute by
  that same test as before. This is not a regression — the classification is the one the module
  already used — but it is not a Windows claim either.

### Verification

- `HARNESS_TEST_SCOPE=all npx vitest run test/services/doctor/collector/ test/services/hooks/` —
  **36 files, 692 tests, all passing** (the fast scope skips `provocation.int` and
  `live-daemon-note.int`, both of which are in this range, so the scope is named deliberately).
- `npx tsc --noEmit` clean; biome clean.
- Full gate below.
