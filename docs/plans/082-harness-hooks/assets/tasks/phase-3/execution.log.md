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

- **Only the agents we enumerate are covered.** Unchanged, and still declared in the backup's own
  detail line: git-ai also installs for agents we do not detect, and those are not backed up.
- **Windows paths are not addressed.** The namespace split tests `startsWith('/')`, which is the
  repo's logical-POSIX convention; a `C:/…` source would be classified home-relative-or-absolute by
  that same test as before. This is not a regression — the classification is the one the module
  already used — but it is not a Windows claim either.

---

## tk-0001 (continued) — `harness hooks restore`, because a library function is not a delivery

### The ruling, and why it is the same defect as phase 2's

I finished the library, raised the missing verb as a question rather than adding surface nobody
asked for, and the PM ruled: **add it** — using an argument I had made myself earlier in the plan.

Phase 2's most important finding was that `install`, `status` and `list` had been built, asserted
against directly, and checked off while **none of them was registered on the CLI**. A capability that
cannot be invoked has not been delivered. `restoreAgentConfigs` was that same defect wearing
different clothes: six rows, six red mutations, and no way for a person at a terminal to run it.

The asymmetry is what settles it. Everyone who needs this verb is, by definition, someone for whom
something has **already** gone wrong — possibly at three in the morning, possibly with a broken
editor config, possibly not the person who wrote it. Every other verb in this family exists for
convenience; this one exists for recovery, which is exactly when *"write a script against the
library"* stops being an answer.

Recorded as the PM's correction of their own task text, not as scope I took.

### What was built

`harness hooks restore [--from <dir>] [--json]`.

- **Newest by default.** Backup directories are named from an ISO timestamp with `:` and `.`
  replaced, which sorts lexicographically in the same order as chronologically — so "newest" is the
  last name, not a `stat`. Only directories carrying a `manifest.json` are candidates.
- **Operator-facing, so it fails loudly.** It is the **only** verb in this family that sets an exit
  code. `fire`'s exit-0-and-silent contract binds `fire` alone, because `fire` runs inside an agent's
  tool loop; this runs at a terminal, and a restore that fails silently is the worst verb in the
  family — the operator walks away believing their configs are back.
- **It is inside the registration guard**, which now asserts `['fire','list','status','install','restore']`.
  Being registered is no longer something this verb could quietly lose.

### PROVEN BY REFUSAL at the VERB level — four mutations, four RED

The library mutations do not transfer: they prove the mechanism, not the delivery, which is the
distinction that produced this whole exchange. Each of these rebuilds `dist`, because the real bin
runs the build, not the sources.

| # | mutation | result |
| --- | --- | --- |
| V1 | the verb swallows the refusal (no exit code set) | RED — 2 failed \| 7 passed |
| V2 | **the verb is BUILT but never REGISTERED — phase 2's defect, replayed** | RED — 4 failed \| 41 passed |
| V3 | no backup at all reported as a clean restore of zero files | RED — 1 failed \| 8 passed |
| V4 | `ok` not derived from failures — always true | RED — 1 failed \| 8 passed |

**V2 is the one that matters.** The defect that shipped undetected in phase 2, replayed deliberately,
is now caught by four tests across two files — the registration guard in `app.test.ts` plus the three
end-to-end rows. The guard I wrote after finding that gap by accident has now been demonstrated
refusing the thing it was written for, rather than merely existing.

The refusal rows assert **exit code AND reason together**, because either alone is survivable by the
wrong implementation: a non-zero exit with no reason leaves the operator guessing, and a reason with
exit 0 is invisible to a script.

The end-to-end rows take their backup from the **real `backupAgentConfigs`**, never a hand-built
fixture directory — a fixture would prove the restore against a layout only the test believes in.

### Still not delivered

- **No human-readable renderer.** `--json` is the only shaped output; the flag is accepted and
  ignored, exactly as `list`/`status`/`install` do today. Consistent, and stated rather than implied.
- **Restore does not consult the installer.** It puts back what the backup recorded; it does not
  reason about what an install did. That is the design — the manifest is the record — but it means a
  restore after two installs restores to the state before whichever backup is chosen, not "before
  our hook".

### Verification

- `HARNESS_TEST_SCOPE=all npx vitest run test/services/doctor/collector/ test/services/hooks/` —
  **36 files, 692 tests, all passing** (the fast scope skips `provocation.int` and
  `live-daemon-note.int`, both of which are in this range, so the scope is named deliberately).
- `npx tsc --noEmit` clean; biome clean.
- The verb rows additionally require a `npm run build` first — `verbs-e2e.int` drives `bin/harness.js`,
  which runs `dist`. The first run of these rows failed for exactly that reason, which is a small
  reminder that the end-to-end surface and the source can disagree.
