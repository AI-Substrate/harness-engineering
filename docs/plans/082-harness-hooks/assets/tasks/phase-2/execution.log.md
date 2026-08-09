# Phase 2 execution log — the agent matrix and the harness hooks verb family

Plan 082. Seat `pij-cautious-firefly`. Ordering is not the task-list order: **tk-0011 runs first**
because tk-000c (status surfaces a failed fire) is a *read* of the journal tk-0011 makes loss-free,
and building the reader first would ship a compensating control that silently drops what it exists
to catch.

---

## tk-0011 — the hook journal was losing records at THREE concurrent processes

### Where it came from

The cross-model reviewer (`pij-vitreous-swordfish`) filed it as its **softest claim** — *INFERRED,
not reproduced, deliberately not a finding*: `FileHookJournal.record()` is a read-rewrite-write with
no interprocess lock. The question put to me was whether the `O_EXCL` claim marker already excludes
the concurrency.

**It does not.** The claim gates the **emit**, not the **record**. Every fire journals on every
path: PRE fires never take a claim at all, and claim-losers journal
`{kind:'silent', reason:'lost-the-claim'}`. So every racing process writes, and the claim serialises
none of them.

### Why the existing concurrency test could never have caught it

`provocation.int.test.ts` races three POST fires **in one process**, where `record()` is fully
synchronous and therefore cannot interleave. It was green throughout the period the journal was
losing records. The real runtime is **one `harness hooks fire` OS process per agent tool call**.

That row is kept and now carries an explicit label saying what it cannot see (dw-003f) — a green
that is read as covering interprocess loss is worse than no row at all.

### MEASURED, not inferred

N real concurrent processes against a temp `HOME`, counting journal lines:

```
24 -> 22     8 -> 8 (not every run)     8 -> 6     4 -> 3     3 -> 2
```

**It fires at three** — an agent issuing three parallel tool calls, which is ordinary behaviour, not
a stress test.

### Why it blocked the status verb instead of following it

Escalated from my own "take it in Phase 3" to Phase 2, ahead of tk-000c. Three facts compose:

1. the journal is the **only** observable for a failure that exits 0 by design;
2. **ac-000b** — the compensating control G2 granted the exit-0 constitutional deviation for — is a
   **read** of this journal;
3. the record most likely to be lost in a burst is a **`failed`** one.

So the control would have been dropping precisely what it exists to expose, **with green tests**,
because a lossy journal reads exactly like a quiet one.

### The fix

- `FsPort.appendText` — one `O_APPEND` write. New port method, implemented in `NodeFs` (`open(…,'a')`
  + a single `writeSync`) and `FakeFs` (tracked in a separate `appends` log so a test can assert a
  path **appended** rather than **rewrote**).
- `record()` is now `mkdirp` + one `appendText` of one complete line. It never reads the file.
- **The 500-line trim was the rewrite**, so it could not stay. The bound now lives in two places
  that bound different things: `read()` bounds what a **consumer** sees (newest `JOURNAL_KEEP`), and
  `compact()` bounds what the **disk** holds.
- `compact()` rotates by **rename**, never by rewriting. A trimmed-copy compaction would race
  exactly as `record()` did — and would lose the **newest** records, the wrong direction. `rename(2)`
  is atomic and a process holding the old descriptor keeps writing to the same inode, which `read()`
  still reads. It is called by readers, never on the fire path.

### PROVING IT — and the fixture had to be re-proven after I rewrote it

**RED control (probabilistic by nature).** Against the original read-rewrite-write, the committed
fixture at N=8, K=5:

```
AssertionError: expected [ 7, 5, 3, 4, 8 ] to deeply equal [ 8, 8, 8, 8, 8 ]
```

The vector assertion earned itself immediately: **run 5 recorded all 8**. A single run would have
been a false green — which is exactly why K exists.

**THE FIXTURE WAS REWRITTEN, SO THE RED PROOF WAS RE-TAKEN.** The first version drove a `/bin/sh`
script using `&` backgrounding. It raced well, but the repo has a `windows-latest` suite leg running
the full vitest suite against a pinned count, and a fixture that cannot run on a platform reports
nothing about it — while still perturbing another seat's guard. Rewritten to spawn children with
`spawn` and await them together: portable, no temp script, and the starts still overlap because every
child is started before any is awaited. **A rewritten fixture does not inherit its predecessor's
refusal**, so the RED control was re-run against the mutated implementation.

**Detection rate, measured rather than assumed** — the whole file, 8 attempts each way:

| implementation | attempts | result |
| --- | --- | --- |
| original read-rewrite-write | 8 | **RED 8 / 8** |
| `O_APPEND` single write | 8 | **GREEN 8 / 8, exact** |

Two of the eight RED attempts were caught by only **one** of the two rows (`[7,8,8,8,8]` passed the
count row on some runs while the intact-records row still failed). They fail independently, so the
pair detects more reliably than either alone — that is why both are kept.

**The asymmetry held, and that is the result.** The green side needed **no tolerance**: exactly N,
every repeat, 8 attempts. Had it needed one, that would have been the fix reporting itself
incomplete, not a test to tune.

### A unit test that would have gone vacuously green

`hook-journal.test.ts` had a fault-injection row stubbing `fs.writeText` to prove `record()` never
throws. After the fix `record()` no longer calls `writeText`, so **the row would have passed while
injecting no fault at all** — its own premise absent. Repointed at `appendText`, with a comment
naming the trap. That is the **fifth** instance on this plan of a probe that could not see the
opposite of what it asserts; the other four are tabled in the Phase 1 log.

### The PM's INFERRED finding on `compact()` — CONFIRMED, and worse than inferred

Raised as *INFERRED, not reproduced*: two concurrent readers can both pass the rotation threshold
check before either renames, and the second rename puts a freshly-recreated live file over the
rotated generation.

**Reachability, stated precisely.** It is **not reachable today** — `grep` for `.compact()` across
`src/` returns no caller. It becomes reachable the moment **tk-000c** lands, because the status verb
is the reader that calls it. So it is fixed now rather than filed.

**Measured** on the real filesystem, executing the exact call sequence concurrency produces:

```
ORIGINAL live lines: 2001 | rotated generation after doubled rotation: 1 lines
READ() returns: 1 entries
```

Not a partial loss — **the entire journal**. A bound that exists to preserve the recent past
destroying 2001 records is the same silent-degradation shape as the unpruned claim markers.

**The fix needs BOTH halves.** An exclusive claim (the `O_EXCL` primitive the commit guard already
uses) so only one rotator runs, **and** a re-check of the live file's length *after* taking the
claim — because the second rotator's guard was passed before the first rename, and a **stale guard**
is what does the damage. The claim alone would not have helped.

A leaked claim from a killed process would disable rotation for good — reintroducing unbounded
growth via the fix for unbounded growth — so a claim older than `ROTATE_CLAIM_STALE_MS` is treated
as abandoned. That recovery path is asserted, not assumed.

### A SIXTH instance, and this one was mine, in a test I had just written

My first `DOUBLED rotation` row asserted the right outcome and **passed with the re-check mutated
out**. It never reached the re-check at all: by the time the second compactor ran, the live file was
already small, so the OUTER check stopped it. The row proved the outer check while claiming to prove
the re-check.

I only found it because I mutated the fix rather than trusting the green — the discipline this plan
has been applying to everyone else's code, applied to code written ten minutes earlier.

The repair is a second row that models the interleaving explicitly: the other rotation is triggered
from inside the second compactor's `createExclusive` call, which *is* the window between its check
and its rename. Mutating the re-check out now turns **exactly one** row red — proving it is the only
probe that can see that mechanism. The original row is **kept and labelled** as unable to see it,
for the same reason the in-process concurrency row is kept and labelled.

That the interleaving is **modelled rather than raced** is stated in the row itself. The
real-concurrency proof for this file is `journal-race.int.test.ts`; an ordering that reproduces
intermittently is not a probe you can rely on to refuse.

### Adapter parity — the divergence the PM predicted, measured and closed

Touching `fs-port` and both adapters raised the question of whether they agree. They did not:

```
MISSING PARENT -> NodeFs: false | FakeFs: true
```

A service tested only against the fake would have believed a record landed that never did. `FakeFs`
now models the refusal, and `append-text-parity.test.ts` runs the **same table against both
adapters** so they cannot drift apart again.

Two things are deliberately *not* parity rows, and are named as unproven except against `NodeFs`
rather than given a weak row: permission/full-disk errors, and inode stability across appends (the
fake has no inodes) — the latter is what makes rotation-by-rename safe, so it is asserted against the
real filesystem alone.

**A short write is a failure, not something to retry.** Retrying would be a second `write()` — the
exact split `appendText` exists to prevent, and another process could land a whole record between the
halves. So it returns false and the record is treated as unwritten.

### Scope note

`journal-race.int.test.ts` is **deliberately left in the fast test scope** at ~1.4s. Both suites that
prove the commit guard are in `SLOW_TESTS`, so a default `just test` says nothing about them. This
one is cheap enough that the loss-free property does get default-scope signal — **it is the only
one of this plan's three proofs that a default `just test` can see.**

---

## Carried into tk-0003 — a compound-command finding from the PM (commit `41d6b7da`)

Recorded here so it is not lost between tasks. Reading the live `~/.cursor/hooks.json` to establish a
restore point found **no standalone git-ai entry**: its checkpoint invocation is a *pipeline stage*
inside a chained command the attribution POC wrote, across four `preToolUse`/`postToolUse` entries,
all referencing untracked `scratch/`.

Two fixture rows follow directly, and both belong to the marker predicate:

1. A compound entry containing a **foreign** tool's marker text must **not** be claimed as ours.
   git-ai's own `contains("git-ai") && contains("checkpoint")` heuristic would claim this entire
   POC-authored entry — one it did not write, containing two other tools' invocations. That is the
   argument for exact-token matching, and it should be a row rather than an argument.
2. The reverse: **our** marker embedded in a compound command written by someone else must still not
   make that entry ours.

This is the config-side instance of the same lesson tk-000d taught on the command side — one entry is
not one tool's command.

It also bounds what Phase 3 may claim: *"installing preserves every pre-existing hook entry"* cannot
be validated on this machine against a pristine baseline, because the baseline is already
POC-modified. Phase 3 compares against the **recorded pre-install bytes**, not an idealised config.

Confirmed rather than assumed in the same read: the Cursor event names really are lowerCamel —
`preToolUse` / `postToolUse` — from a real config, not from the workshop.
