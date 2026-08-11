# The remote agent's 23-failure report — VERBATIM EXCERPT

Source: issue #108 comment by the #108 Windows agent, 2026-08-10T11:48:38Z.
Their sha: 695a3056. Their control: pristine clone of our branch, same sha, identical failures.
THIS IS THEIR CLAIM, NOT OUR MEASUREMENT. Do not merge it into our numbers.

## The 23

`HARNESS_TEST_SCOPE=all` at `695a3056` on Windows 11: **5997 total, 5941 passed, 23
failed.**

**The control experiment.** We checked out a **pristine clone of your branch at the same
sha** on the same box, `npm install`, `npm run build`, and ran the same files. It failed
**identically** — same files, same counts, same assertion signatures. So none of these come
from our fork's divergence; they are the Windows behaviour of your branch.

### Family A — path separator, 17 tests

Assertions compare a Windows path (`C:\…`) against a POSIX-shaped expectation (`C:/…`), or
compare list keys built with opposite separators. Green on Linux CI by construction.

| # | file | test |
|---|---|---|
| 1 | `acts/doctor.test.ts` | envelope has 13 layers, test pins 12 |
| 2 | `acts/doctor.test.ts` | injected ingress probe returns `[]`, expects 1 (plan-074 ac-000a) |
| 4 | `hooks/binary-path.test.ts` | space-bearing home not recoverable |
| 5 | `hooks/command-runs.test.ts` | probed interpreter/script pair mismatches |
| 13 | `hooks/install-strategy-a.test.ts` | created path, opposite separators |
| 14 | `hooks/install-strategy-a.test.ts` | both `~/.codeium` paths, opposite separators |
| 17 | `hooks/legacy-command-form.test.ts` | legacy script returns `C:/…`, expects `C:\…` |
| 18 | `hooks/legacy-command-form.test.ts` | same via `status.configuredBinary` |
| 19-20 | `hooks/verbs-e2e.int.test.ts` | restore + prune lists keyed one way, asserted the other |
| 21-23 | `collector/backup-restore.int.test.ts` | capture, `__`-in-name round-trip, delete-on-restore |

**The underlying product observation, which may be worth more than the test fix:**
`embedBinaryPath()` normalises `\`→`/` on the way IN, and `extractBinaryPath()` never
denormalises on the way OUT — while `binary-path.ts`'s own doc calls them inverses
(property 4, "EXTRACTABLE AGAIN"). `stat()` tolerates the forward-slash form so `status`
still reports `installed`, but any caller string-comparing against a native `path.join`
result mismatches. That is a real asymmetry, not only a test-shape problem.

### Family B — windsurf two-file composition, 6 tests

All in `hooks/composition-boundaries.test.ts`, the F2/F3 rows: does not report windsurf
installed when the unit should commit (7); reports it installed when one of its two files
failed (8); does not name the file it could not roll back (9); does not throw where a
peer-sharing rollback must refuse (10); provenance compensation still says `rolled back`
(11); does not refuse to restore a file that moved under it (12).

**These are test-level, not product-level.** In the real world on this box, `hooks install`
wrote **both** `~/.codeium` paths and `hooks status --probe` reports windsurf
`executionState: runs`. So F010 holds as a product here; it is the fake-fs path handling in
the rows that does not.

### Family C — timing, 4 tests

| # | file | note |
|---|---|---|
| 3 | `adapters/git/exec-remote-telemetry-git.int.test.ts` | passes in isolation — contention only |
| 15-16 | `hooks/journal-race.int.test.ts` | pass in isolation (2/2, 24.1s); under load the concurrent journal records 14 lines where 8 are expected |
| 6 | `hooks/composed-command.int.test.ts` | **flaky at the timeout boundary** |

On #6, a correction to our own earlier reporting: we first called it contention-only after
a single passing isolation run. It is not. Its heaviest row — *"executes the installed
string verbatim"* — measured **28.3s against a 30s vitest timeout**; it passed 8/8 alone on
one run (44.0s total) and **failed the same row alone** on another (63.4s). It flips with
machine load. On Windows that row has effectively **no timeout headroom**. One passing
isolation run cannot distinguish a stable pass from a marginal one, and we generalised from
exactly one.

---

## What we would find most useful

The path-separator family is 17 of 23 and is unfixable from a consumer fork without local
patches that would conflict on every future port. If those assertions normalised separators
before comparing (or compared with `path.join`), the Windows leg would drop to 6.

We are happy to send a PR against `s077/suite-portability` for the assertion normalisation
if that is welcome — say the word and we will scope it to Family A only.

