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


---

## tk-0003 — the owned marker

Decided before any writer assumes it, because three tasks match on "our marker" and nothing said
what it is. The lazy answer at implementation time would have been `command.includes('harness')` —
git-ai's rejected two-substring heuristic under a new name.

**The literal**: `ai-substrate-harness-hook-v1`, carried by a `--hook-owner` flag. Same literal in
all three locations — a `command` token for Strategy A, a header comment for C, a `#` line for D — so
one grep finds every artifact we install.

**Why the marker is its own ARGUMENT and not part of the binary path.** The path is quoted (it may
contain a space) and Windows-normalised (`C:\x\y.exe` → `C:/x/y.exe`, `\\?\` stripped). A marker
inside the path would be mangled by both; a standalone token is invariant under both. Asserted
against four path shapes including a quoted space-bearing path and a normalised Windows path
(dw-000b) rather than argued.

### The compound-command rows, from the LIVE config (finding `41d6b7da`)

The live `~/.cursor/hooks.json` has **no standalone git-ai entry**. Its checkpoint call is one
pipeline stage inside a compound command the POC wrote — `python3 …probe.py PRE …; tee -a … |
…/git-ai checkpoint cursor --hook-input stdin`. Both directions are asserted (dw-000c):

- our predicate does **not** claim that entry — it contains three tools, only one of them git-ai's;
- git-ai's own `contains("git-ai") && contains("checkpoint")` **does** claim it, asserted as an
  executable contrast rather than a narrated one. An uninstall on that predicate would delete an
  entry it did not write, along with two other tools' invocations;
- git-ai's predicate does not claim ours (our command contains neither string, deliberately);
- our marker mentioned inside someone else's compound command does not make that entry ours.

### A SEVENTH instance — a test whose TITLE was its strongest claim, and its body tested nothing of it

The row named *"our marker inside someone else's compound command does not make that entry ours"*
used `${HOOK_MARKER}-ish` as its foreign command. That is a **longer token**, so it returned false
via the longer-token rule already proven two rows above. **It proved that rule twice and
compound attribution never** — while its title claimed the hardest property in the file.

Different in kind from the earlier six. The other probes could not see the opposite; this one could,
it just was not looking at the thing it named. Verified mechanically before acting:

```
MENTION tokens : ["ai-substrate-harness-hook-v1-ish"]   <- a different token entirely
MENTION owned  : false
REAL COMPOUND  : true   <- deleting this entry deletes `other-tool --run`
```

I had written a LIMIT comment stating the real case correctly, so the gap was not knowledge — the
comment framed the claim as harmless and nobody had drawn the consequence.

### THE CONSEQUENCE — it is git-ai's defect with our name on it

An entry that will exist:

```
other-tool --run && harness hooks fire cursor --hook-owner ai-substrate-harness-hook-v1
```

`isOwnedByUs` is **correctly true** — our invocation really is in there. An uninstall that removes
"our marked entry" deletes `other-tool --run` with it. That is precisely what
`contains("git-ai") && contains("checkpoint")` does to the POC entry on this machine: claims a
compound entry it did not author and destroys somebody else's work. The same defect, more precisely
targeted, with a better marker.

Not hypothetical: the measured evidence *is* the finding. A third party — our own POC — took a
tool's standalone hook invocation and wrapped it into a chained command. That is the observed
normal.

### THE DECISION — REFUSE, decided explicitly rather than by default

`classifyOwnership` now returns **three** states, because a boolean makes the wrong behaviour the
easy one (*"is it ours? yes → delete it"*):

| state | meaning | uninstall |
| --- | --- | --- |
| `not-ours` | no exact marker token | leave alone |
| `wholly-ours` | every segment is our invocation | **removable** |
| `ours-with-foreign` | our invocation chained with foreign work | **reported, never deleted** |

**REFUSE**, for two reasons and the first settles it: a refusal that surprises someone is
recoverable and a deletion that surprises them is not — *"we never delete work we did not write"* is
a sentence we can keep. And it is the same refuse-to-clobber posture already adopted for Strategies
C and D (cline.rs's, not amp.rs's unconditional `remove_file`), so ownership behaves identically
across all three.

Per-segment surgery is the better behaviour and more machinery; it is **deferred, not silently
skipped**. A bare mention of the exact marker beside foreign work also lands in
`ours-with-foreign` — refusing gives the safe answer without needing to tell an invocation from a
mention.

**Proven by refusal**: reverting `mayRemove` to the bare boolean turns **2 rows RED**, including a
positive control that a wholly-ours entry *is* removable — without which "refuses to remove" would
be satisfied by an uninstall that does nothing.

`isOwnedByUs` is kept for the question idempotency and `status` actually ask ("is our hook already
here?"), which is not the question uninstall asks.

**Proven by refusal.** Swapping exact-token matching for `command.includes(...)` — git-ai's shape —
turns **5 rows RED**, including every substring row and the foreign-compound row.

---

## tk-0001 — the config fixture harness, with three known-bad writers

Sensors before feature code. A per-agent fixture materialises a realistic config under an injected
home, runs a writer, and compares byte-for-byte against a **committed golden**.

**Why a golden and not a self-diff** (dw-0003): after a legitimate install the bytes have changed, so
byte-equality against the input would call every correct install a failure and could only be
satisfied by installing nothing.

**Why the input already holds git-ai's entries**: preservation is the property most likely to break
silently, and a fixture starting from an empty config could never catch a writer that destroys what
was there.

**Why the key order is deliberately not alphabetical**: the real file writes `preToolUse` before
`postToolUse`. A fixture that happened to be sorted already would go green against a re-sorting
writer and the most-predicted failure would be invisible.

### The three known-bad writers, and why one would not have been enough

| writer | what it does | what it preserves |
| --- | --- | --- |
| clobber | replaces the event arrays | nothing — caught by the weakest assertion anyone would write |
| **re-sort** | adds our entry correctly, then sorts every key | **every value** — `toEqual` on the parsed docs PASSES |
| **de-comment** | adds our entry, keeps key order, drops comments | **every value and the order** |

The re-sort row asserts **both** halves — parsed-equal **and** bytes-different — because asserting
only the difference would pass against a writer that mangled the values, and we would not know which
property the fixture actually detects. It is git-ai's real serde_json `BTreeMap` behaviour.

### THE DETECTION MATRIX — measured, and it found a blind spot

```
clobber     cursor=caught   droid=caught
resort      cursor=caught   droid=caught
decomment   cursor=BLIND    droid=caught
```

**The cursor fixture cannot see a de-comment** — plain JSON has no comments to lose. The JSONC
fixture is the only proof of the workshop's comment-preservation defect. Left implicit, someone
tidying up would delete the droid fixture and quietly void a third of dw-0001 with every test still
green. It is now an assertion, so the blindness is a fact rather than a coincidence.

### The positive control, and why "three RED" needs one

"All three known-bad writers are RED" is satisfied just as well by a comparator that **never**
passes. A sensor that always fires detects nothing, and the three refusals would then be measuring
the fixture's own brokenness. The control emits the golden bytes verbatim and must go green. It
proves the harness **can** say yes — and nothing about any real writer, which does not exist yet.

### Injected home, by construction (dw-0004)

Path assertions show the fixtures happen to be injected today; only the absence of any ambient-home
read makes it structural. So the support module's **source** is asserted to contain no `homedir`, no
`process.env`, no `USERPROFILE`. That is what stops a later helper adding a convenience default — and
it matters here specifically, because the live `~/.cursor/hooks.json` holds the git-ai checkpoint
pipeline that phase 1's only end-to-end measurement depends on.

---

## The gate is measuring something stable

Five commits — one new act, several service modules, a marker, a fixture harness and four committed
fixtures — and `harness checks` has reported **arch 2 / markdown 211 / windows 7 on every one of
them**. Byte-identical counts across that much new code is the sentence that says the gate is awake
rather than asleep: zero new findings is a result, not an absence of one.

---

## tk-0002 — the comment- and order-preserving writer

### The dependency decision (dw-0008), and why it is not a formality

**Chosen: `jsonc-parser`, pinned EXACTLY at `3.3.1`.** First new *runtime* dependency this plan adds.

*Why a package over hand-rolling.* The requirement is not "parse JSONC" — `JSON.parse` on
comment-stripped text does that in three lines. It is to **edit** a document and re-print it with
every byte we did not touch left alone. Hand-rolling that means owning a JSON scanner, comment and
trailing-comma handling, and edit-offset arithmetic, in the code path that writes to a customer's
editor config.

*Why this package.* `comment-json` re-serialises the whole document and preserves only the comments
it manages to reattach — the failure mode we are preventing. `json5` is a different dialect, not an
editor for this one. `jsonc-parser` returns **minimal text edits**, so untouched bytes are untouched
*by construction* rather than by careful re-printing. It is Microsoft's own JSONC parser — the one
VS Code uses to edit `settings.json`, which is the identical problem — MIT, with **zero transitive
dependencies**.

*Why DECLARED rather than reused.* It was already resolvable in `node_modules` — but only
transitively, via **`markdownlint-cli2`, a dev dependency** (confirmed from the artifact: the prior
lockfile carries `node_modules/jsonc-parser` with `dev: true`). A production install
(`npm ci --omit=dev`) would not have had it, so reusing it would have been a runtime
`ERR_MODULE_NOT_FOUND` **that no LOCAL test could see** — locally it is always present.

**AND THAT IS THE PRECISE CLAIM. It is NOT true that nothing would have caught it**, which is the
better-sounding sentence I first wrote and had to correct. CI's **package-smoke** job packs the
tarball and installs it with `--omit=dev` specifically so a runtime dependency that stopped
resolving is caught — its own comment says so, naming `jiti` as the case it was built for after a
previous incident.

So this is worth recording as **a positive control on the harness itself**: a gate someone built
after an earlier incident was still pointed at exactly the right thing months later, and would have
refused this. We spend most of this log noting where the harness is blind; here it was awake, and
that deserves the same weight. Finding it *before* CI is still strictly better — a red
package-smoke tells you something broke, whereas catching it at authoring time tells you **why**
while the context is still in hand.

*Why EXACT rather than `^3.3.1`.* This code writes to files the user did not ask us to reformat; a
caret range lets an unreviewed version into that path. The repo already pins `jiti` exactly and its
lockfile remediation used `--save-exact`. Locked with integrity.

### The golden is a REGRESSION LOCK, not the proof

The goldens were **generated by this writer** and then committed, so "the writer matches the golden"
is the writer agreeing with itself — the defect this plan has hit seven times. So the golden rows are
labelled as a regression lock, and the proof is a set of property rows derived from the **input**,
each of which would hold against any correct writer: comments present, non-alphabetical order
preserved, the byte-prefix before the first edit identical, pre-existing entries intact, append
rather than replace.

**One cost is asserted rather than discovered**: the array we edit is **reformatted** to the
document's indent style, so a single-line entry becomes multi-line. Bounded to the touched array —
which the untouched-prefix row proves at the same time.

### THE TEST CAUGHT A REAL DEFECT IN MY OWN WRITER

The guard was `if (parseTree(text) === undefined) return text`. **`parseTree` does not reject a
broken document** — it is an *editor* parser and recovers from errors on purpose. It returned a
usable tree for `{ this is not json at all`, and the writer rewrote that garbage into well-formed
JSON, **destroying whatever the user actually had**. Only the `parse(text, errors)` errors array
answers "was this really valid?". A config we cannot understand is one we must not rewrite.

### The symlink row proves LESS than its name — so the hazard is now executable (dw-0007)

Agent configs are routinely dotfile-managed (chezmoi, stow), so the path is often a symlink into a
git-tracked directory. Mutating the `realpath` call away turned the row red — but on the **path
identity** assertion, not on destruction, because `writeFileSync` already follows a symlink. **The
`realpath` call is not load-bearing today.** It becomes load-bearing the moment someone makes this
write atomic — which is exactly what the rest of this codebase does (`HookStateStore` writes
temp-then-rename), so it is the obvious future "improvement".

Rather than let the row overclaim, a second row **demonstrates the hazard**: temp-write + rename onto
the symlink leaves `lstat().isSymbolicLink() === false` and the real file untouched, while
`writeThroughSymlink` keeps the link and updates the target. "A rename would break this" is now a
measurement instead of a comment.

---

## tk-0004 — the agent matrix as data

### The swap refusal was taken AFTER green, not before

The obvious order is to write the swap row first and watch it fail. That red is worthless: a row
written before the resolvers exist goes red **because there are no resolvers**. It proves the row
runs; it proves nothing about whether it can detect a *swap*, because with nothing to swap there is
no asymmetry for it to be sensitive to.

So the sequence was: implement → **watch the rows go green (24 passing)** → *then* swap the two
override kinds → watch them go red. Same lesson as a rewritten fixture not inheriting its
predecessor's refusal, with the roles reversed: there the instrument changed, here the **subject
arrived**. Either way, a refusal recorded against a different state of the world is not a refusal
against this one.

### The swap — BOTH fixtures red (dw-000d)

One-line mutation, `config-dir` and `home-root` exchanged:

```
FAIL  CLAUDE_CONFIG_DIR is used VERBATIM — nothing is appended
      expected '/cfg/.claude' to be '/cfg'
FAIL  GEMINI_CLI_HOME is the HOME ROOT — .gemini IS appended
      expected '/elsewhere' to be '/elsewhere/.gemini'
FAIL  a FAKE agent resolves fully with NO code change
      expected '/x' to be '/x/.invented'
```

**And the row that proves why set-vs-unset is not accepted STAYED GREEN under that same mutation.**
That is the whole argument, executable: unset, both kinds resolve to `home/subdir`, so a resolver
with the bug fully present passes a set-vs-unset test. The inadequate test is kept deliberately,
labelled, so nobody later "simplifies" the swap mutation into it.

The fake-agent row going red as well is a bonus result: it shows the dw-0010 row is sensitive to the
same property rather than merely exercising a happy path.

### The asymmetry is DATA, not branching

`OverrideKind` is a field on the row, so the two behaviours differ by one value rather than by two
`if` branches. That is what makes the swap a **single, unambiguous edit** — had it been branching,
swapping would have been a rewrite and the mutation would have proved less.

### Event casing (dw-000f) and windsurf's two files (dw-000e)

Three genuinely different casings among seven agents — `PreToolUse`, `preToolUse`, `BeforeTool` —
asserted as a set so "all Pascal by accident" cannot pass. A wrong key writes a hook the agent never
fires: an install that reports success and does nothing.

Windsurf is the **only** multi-file agent, asserted as such — which is precisely why a single-file
assumption would pass against the other six and install half of windsurf's hooks.

### dw-0010 is deliberately LEFT UNCHECKED

Its text is *"proven by adding a fake agent in a test and **installing** it with no code change"*.
The fake agent resolves its paths, events and override through the shared functions with no code
change — but **the installer is tk-0005 and does not exist yet**, so the install half is unproven.
Checking it now would be claiming a proof I have not taken; it is completed in tk-0005 by driving
the same fake row through the real writer.

---

## tk-0005 — Strategy A, absent-file first

### The absent-file case is ONE situation with three consequences

Built first, deliberately: every fixture before this task starts from a config that **exists**, so
the no-config case is the one with no fixture shape yet — which is exactly the one that gets quietly
dropped. Not hypothetical either; the collector's evidence already records git-ai creating copilot's
hooks file fresh on this machine.

1. **Create the file AND its parents, with a skeleton built FROM THE MATRIX ROW.** `github-copilot`
   lives at `.copilot/hooks/git-ai.json` — the parent is two levels deep and routinely absent. A
   skeleton hard-coded to `PreToolUse` would produce a config gemini and cursor silently ignore: an
   install that reports success and does nothing.
2. **`created: true` means created-not-backed-up, NOT covered.** `backupAgentConfigs` skips a
   non-existent source, so a created file has no backup, and "no backup" must never look like
   "backed up successfully".
3. **Uninstall's symmetry is DELETE, not restore** — there are no original bytes. Written down for
   tk-000d rather than solved here; this flag is the input that decision needs.

### Proven by refusal — three properties, three independent mutations

| mutation | rows red |
| --- | --- |
| install only the FIRST config file | **3** — both windsurf rows *and* the fake-agent row |
| skeleton hard-coded to `PreToolUse`/`PostToolUse` | **2** |
| `created` always true | **2** |

The `created` mutation is worth its own note: every absent-file row still passes individually when
`created` is always true. Only the row that installs **twice and compares** catches it — a flag whose
whole purpose is to distinguish two cases cannot be tested one case at a time.

### A NEAR-MISS IN MY OWN MUTATION METHOD, and the lesson generalises

The first `one-file` mutation **silently failed to apply** — biome had reformatted the anchor text
after I copied it — and the run printed `Tests 12 passed`. That output is **indistinguishable from
"the tests cannot detect this mutation"**, and I would have recorded a false all-clear.

It was caught only because the patch script `assert`s its anchor matched and raised. So the rule the
harness needs: **a mutation script must fail LOUDLY when its anchor does not match.** Otherwise
"green under mutation" is ambiguous between *the tests are blind* and *nothing was mutated*, and the
ambiguity resolves in the flattering direction every time. Re-run against the real formatted text, it
turned 3 rows red.

Same family as the seven, one level up: the probe was fine, the thing being probed was never
perturbed.

### dw-0013 is asserted from the INPUT, not from our own entry

The row reads the pre-existing commands out of the input document, then asserts each survives the
install byte-for-byte. Confirming *our* entry landed proves nothing about what happened to theirs —
and theirs is what a clobbering or re-sorting writer destroys.

### dw-0010 is now CHECKED — the install half exists

Left unchecked in tk-0004 because the installer did not exist. The same invented agent row now drives
the **real writer** end-to-end: it creates its directories, both its files and its entries, using its
own event casing, with no code change. Adding an agent is adding a row, measured rather than argued.

### Idempotency finds our entry by MARKER, not by string equality

The binary path can legitimately differ between installs (a moved install, a different user).
Matching the whole command string would fail to recognise our own entry and append a second one on
every run. Asserted with a deliberately different binary path.

---

## tk-0006 — the binary path

### The space case is the DEFAULT, not a special row

Every fixture in this suite installs into a home directory whose name **contains a space**
(`mkdtemp('harness binary path ')`). Making it the default rather than one named row means the
ordinary install rows exercise the property too — a single row named "handles a space" is the shape
that gets deleted as redundant, taking the coverage with it.

Workshop sensor #7, and its failure is invisible until a user whose username has a space installs.
Seven of git-ai's fifteen installers interpolate an unquoted path; only Copilot and Cline quote.

### Quoting is UNCONDITIONAL, and that is the argument

"Quote if it looks like it needs it" is a predicate that has to be right about every character a
filesystem allows, and it is wrong the first time someone's path has a character nobody considered.
Quoting always is one rule with no exceptions to get wrong.

### The read-back is real work, and the naive version is kept as an exhibit

`status` must stat the configured binary, which means getting a quoted, space-bearing,
forward-slashed path back OUT of a command string. `split(' ')[0]` returns `"/Users/ada` — **a
leading quote** — so the stat fails and **every healthy install reports as broken**. That naive
expression is asserted alongside the correct one on the same input, so the reason the real extractor
is more complicated cannot be lost to a later simplification.

### Absolute is necessary and NOT sufficient (dw-0017)

The measured hazard on this machine is a live hook pointing into untracked `scratch/` — which is
absolute. So the check refuses `scratch`, `src`, `dist`, `node_modules`, `.git` and `worktrees`
segments as well as relative paths. A **positive control** row accepts four real install shapes,
because a predicate that refused everything would pass every refusal row while making installation
impossible.

### Proven by refusal — three mutations

| mutation | rows red |
| --- | --- |
| quoting removed | **7** |
| absolute treated as sufficient | **5** |
| extractor forced down the naive split path | **10** |

### Windows is EXPECTED-UNVERIFIED, and the label is in the describe name

The normalisation rows run on macOS against **simulated** win32 inputs — `\\?\C:\…` prefix stripping
and backslash conversion. They prove the transformation and **not** behaviour on a Windows host. The
label lives in the suite name so a green cannot be read as Windows coverage; the real answer waits on
tk-0010's remote agent.

One reason recorded rather than assumed: forward slashes are chosen over backslashes because a
backslash inside a double-quoted string is an **escape character** on POSIX shells, so a backslash
path would need escaping the moment it is quoted. Normalising removes that class of bug — asserted,
not just stated.

---

## tk-0007 — detection reused, and a divergence it caught immediately

### The row meant to prove "no second detector" found one, in disguise

dw-0019 exists because a second detector is a second answer to *which agents are here*. Comparing our
matrix slugs against the collector's marker ids returned:

```
expected [ 'claude-code', 'github-copilot' ] to deeply equal []
```

Not a second detector — a second **naming**. The collector mirrors git-ai's table, where those agents
are `claude` and `copilot`; the workshop (and our hook command) calls them `claude-code` and
`github-copilot`. The same failure with a cheaper disguise: nothing would have detected those two
agents, and nothing would have said so.

**Resolved by declaring the link, not by renaming either side.** They are genuinely two namespaces —
our slug is a CLI argument a user types, the collector's id mirrors an external tool's table. A
`detectId` field makes the correspondence assertable, so a rename on either side fails a test instead
of silently detecting nothing.

### A cross-check between two independently-derived tables

Both the collector's marker table and our matrix name config paths, built from the same source raid
at different times by different tasks. A row now asserts our resolved paths are a subset of the
collector's declared configs for the linked agent. That is stronger than either table's own tests,
because it cannot be satisfied by copying one into the other — they are consumed by different code.
It passes, which independently corroborates the matrix paths.

### The decoy is a positive control for a trap we avoided by INHERITANCE

git-ai's amp/opencode/pi installers test `.amp`/`.opencode`/`.pi` in the **current working
directory**, so installing from a project that happens to contain one marks the agent present. We
cannot inherit that, because `detectAgents` composes absolute paths from the injected home — we get
the property free, from a function written for another purpose.

Free is exactly why it is asserted: inheritance can be refactored away by someone who does not know
it was load-bearing. The rows `chdir` into a directory containing each decoy marker and assert
nothing is detected — **plus a discriminator row** placing the same marker in the home and asserting
it *is* detected, because five rows asserting an empty result would all pass for a detector that
always returns nothing.

### Cline is UNDETECTED, not absent

Editor-level, so marker detection cannot reach it. Asserted as present in `UNDETECTED_INSTALLERS` and
asserted *absent* from the Strategy A matrix — the second row guards against someone "fixing" the
detection gap by adding cline to the JSON matrix, which would write a config file cline does not
read.

### Gate answer: the absent-file path runs against the REAL filesystem

Asked at the gate, answered mechanically rather than assumed. `install-strategy-a.test.ts` uses
`new NodeFs()` throughout — no `FakeFs` anywhere in the file — and both two-level creates
(`.copilot/hooks/` and `.codeium/windsurf/`) are asserted with `existsSync` on disk. So `mkdirp`
semantics for a nested create are proven against real `node:fs`, not against a fake that has already
been measured generous once today.

### Three corrections to the tk-0007 claims

**1. The `created`-flag mutation was never in the ambiguous class.** Re-taken with the anchor
assertion in place: `anchor matched; patch applied`, then **2 rows red** — and they are exactly the
two that install twice and compare. So the observation stands as measured.

The scope of the anchor near-miss is narrower than it first looked, and worth stating precisely: a
mutation that produced **red self-evidently applied**, so every refusal recorded on this plan stands
(disjoint sets, marker rows, resolver swap, compact re-check, extractor quoting). The ambiguity only
touches a mutation whose result was green — and even then it is resolved if **any** row went red in
the same run, since one red proves the patch landed. That leaves exactly one class: a mutation where
the entire run was green. Only the `one-file` attempt was ever in it, and it has been re-taken (3
rows red).

**2. The cross-check is a DRIFT guard, not corroboration — relabelled.** I had called it
"independently corroborated". It is not independent: both tables descend from the **same source
raid**, so a raid that misread a path puts the identical error in both and the check passes cleanly.
Agreement between two derivations of one source is a shared blind spot. What it genuinely proves is
that the tables have not **drifted** since — which is precisely the class that produced the
`detectId` divergence, so it is kept, correctly labelled.

**3. Actual corroboration, from a source that is not the raid: the live filesystem.**

```
live-config corroboration — FOUND 7, ABSENT 1
  present: claude-code:    ~/.claude/settings.json
  present: cursor:         ~/.cursor/hooks.json
  present: gemini:         ~/.gemini/settings.json
  present: droid:          ~/.factory/settings.json
  present: github-copilot: ~/.copilot/hooks/git-ai.json
  present: windsurf:       ~/.codeium/hooks.json
  present: windsurf:       ~/.codeium/windsurf/hooks.json
```

Seven of eight resolved paths are real files **written by those agents**, not transcribed by us. That
independently confirms the two shapes most likely to be wrong: `github-copilot`'s two-level
`hooks/git-ai.json`, and **both** of windsurf's paths — dw-0014's claim, verified against something
other than the table that asserts it. Only firebender is absent here.

**AND THE FIRST VERSION OF THAT ROW COULD NOT FAIL — an eighth instance, caught in review.** It sorted
paths into `found`/`absent`, then took a SKIPPED branch when `found` was empty, asserting only
`absent.length > 0`. Break every path in the matrix and nothing exists, everything lands in `absent`,
and the row goes green — **a totally broken matrix and a machine with no agents installed were
indistinguishable**. The row added specifically to fix a can't-fail problem could not itself fail.

Its surviving assertion was worse than useless: `expect(entry).toContain(realHome)` restated its own
construction (the path was *built* from `realHome`), so it was vacuous in the ordinary case — and
with `CLAUDE_CONFIG_DIR` set it would have gone **spuriously red on a correctly-behaving machine**,
because a correct resolution yields the override root, not the home. Deleted.

**The repair gates on DETECTION, which is observable rather than expected.** If `detectAgents`
reports any agent present, at least one detected agent must have a config exactly where the matrix
says. That is falsifiable, and it couples the two tables: being able to detect an agent by its marker
while finding no config where the matrix claims one means one of them is wrong — the very failure
that produced `detectId`. The skip branch now asserts **nothing was detected**, not merely that
nothing was found.

**Measured on this machine (2026-08-10), so the evidence outlives the scrollback:**

```
live-config corroboration — detected 8, config FOUND 7, ABSENT 0
  present: claude-code:    ~/.claude/settings.json
  present: cursor:         ~/.cursor/hooks.json
  present: gemini:         ~/.gemini/settings.json
  present: droid:          ~/.factory/settings.json
  present: github-copilot: ~/.copilot/hooks/git-ai.json
  present: windsurf:       ~/.codeium/hooks.json
  present: windsurf:       ~/.codeium/windsurf/hooks.json
```

**Proven able to refuse** — every `configFiles` entry in the matrix rewritten to a garbage path:

```
anchor matched; every matrix path broken
live-config corroboration — detected 8, config FOUND 0, ABSENT 6
FAIL  every DETECTED agent has a config where the matrix says it does
      AssertionError: expected 0 to be greater than 0
```

The drift check went red in the same run, which is the pair behaving as designed: one guards the
tables against each other, the other guards both against the world.

The row is **read-only** and records `FOUND`/`ABSENT` counts. On CI nothing is detected and it is a
real skip.

---

## tk-0008 — the verb family

### The opt-out lives in the VERB, and is asserted on the filesystem

A guard at doctor's call site is bypassed the moment someone runs
`harness hooks install` directly — which is exactly what a user reaching for the command does. So
`installHooks` checks it itself, and the row asserts the home is **byte-for-byte unchanged**, never
that a message was returned. A message is what a broken implementation prints while installing anyway.

### The value semantics are fixed here so two call sites cannot disagree (dw-001f)

**Any non-empty value opts out.** `1`, `true`, `yes` — and deliberately `0` and `false` too. Someone
exporting `HARNESS_NO_HOOKS=0` is reaching for the off switch, and a variable named NO_HOOKS that
*installs* when set to `0` is a trap. Only unset or empty proceeds, with a **positive control** row
asserting that unset really does install — without it, "opts out" is satisfied by a verb that never
installs at all.

### The cut line is named, never skipped (dw-001d)

Strategies C and D are the acceptable casualties, which leaves four agents with no writer. `list`
reports them `supported: false` with a reason naming the strategy; `install` puts a detected one in
`refused` **by name** and writes nothing for it. A discriminator row asserts a *supported* agent
carries **no** reason — otherwise "reason set for unsupported" would pass for an implementation that
sets one on everything.

`cline` additionally carries `undetectable: true`: editor-level, so marker detection cannot reach it,
and "not detected" must not collapse into "not installed".

### `status` stats the target, because an entry is not a working hook

Measured on this machine: the live Cursor hook points into untracked `scratch/`. An entry can exist
while its target does not, and because a hook exits 0 by design that is indistinguishable from a
working hook. `status` extracts the binary back out of the command string and stats it — with a row
that **deletes the binary after installing** and asserts `binaryResolves: false`, since asserting only
the healthy case proves nothing about the case that matters.

### Proven by refusal — four mutations, every anchor asserted

| mutation | rows red |
| --- | --- |
| opt-out left to the caller | 1 |
| opt-out narrowed to `=== '1'` | **5** |
| unsupported agent silently skipped | 1 |
| `binaryResolves` hard-coded true | 1 |

Every run printed `anchor matched` before the build, per the rule the near-miss produced — so a green
here would have meant blind tests, not an unapplied patch.

---

## tk-0009 — idempotency is TWO assertions, not one

Hashing the bytes before and after the **second** run proves only that run2 equals run1. It says
nothing about run1 versus the **original** — and the gap is not theoretical. A writer that
alphabetically re-sorts on the first install (git-ai's actual `BTreeMap` behaviour) and re-sorts
identically on the second produces byte-identical run1 and run2, and passes a naive idempotency test
**green, with the customer's config already rearranged**.

So: idempotency is asserted **run1 vs run2**; order preservation is asserted **run1 vs GOLDEN**.

### The row that makes the inadequacy executable

One row runs the re-sorting writer and asserts **both** facts about it at once:

- `run2 === run1` — perfectly idempotent, so the naive check is green;
- `run1 !== golden`, with `postToolUse` now ahead of `preToolUse` — the order destroyed.

Then it runs our real writer on the same input and shows it is idempotent **and** matches the golden.
Kept as an exhibit for the same reason as the set-vs-unset row: the normal fate of a demonstration
like this is deletion as redundant, and the reason the second assertion exists leaves with it.

### Three runs, not two, and both windsurf files

Two runs cannot see a duplicate that first appears on run three, so the check runs three times.
The denominator is **every** touched config: windsurf's two files are read individually, and each is
asserted to contain the marker exactly twice — an idempotency check that read only the first file
would pass while the second accumulated an entry per run.

### The populated case is the interesting one (dw-0022)

An empty config has nothing to rearrange, so idempotency is asserted against the fixture that already
holds git-ai's compound entry — which is where a naive merge reorders — and that entry is asserted to
survive both runs.

---

## CORRECTION — the copilot row pointed at git-ai's OWN file

Raised by the PM from a directory listing, then resolved from the **Copilot CLI's own bundle**,
because a listing with one file in it is consistent with two very different worlds: a drop-in
directory, or a single-slot file that git-ai happened to win.

**The decisive evidence is the NEGATIVE.**

```
app.js:  userHooksDir: lP(ri(s,"config"),"hooks")        ->  ~/.copilot/hooks
app.js:  getHooksDir(e) { … lP(e,".github","hooks") }    ->  per-repo .github/hooks
grep for any hooks FILENAME literal across app.js + index.js  ->  NOTHING
```

An **absent** filename cannot be a coincidence the way a single present file can. `~/.copilot/hooks/`
is a drop-in directory; `git-ai.json` is git-ai's own file, named for itself.

**Why it mattered.** Merging our entry into that file would have put our hook in a file we do not own
— one `git-ai uninstall-hooks` deletes, taking our hook with it **silently**. This plan's own failure
class, arriving through a config path rather than an exit code. It would also have made the marker
question incoherent: the file would carry our marker *and* be git-ai's artifact.

**Fixed:** copilot writes `hooks/harness.json`. Same Strategy A mechanism, our own file, so uninstall
deletes something we created and neither tool can remove the other's hook.

### Why BOTH table checks passed on the broken row

The drift check passed because both tables descend from the same raid and agreed. The live-config
check passed because the file **genuinely exists**. **Existence was never the question — ownership
was, and no row asked it.** The shared-blind-spot caution, instantiated as a real defect rather than
a warning: the raid recorded git-ai's install *targets*, and for six agents a target is the agent's
shared config, but for copilot it is git-ai's private file. The transcription flattened that
distinction.

### The BASENAME tell — the real prize, generalised into a guard

`settings.json` / `hooks.json` belong to the **agent**; `git-ai.json` belongs to **git-ai**. That rule
applies without knowing anything about a new agent, so it is now an assertion: no matrix `configFiles`
basename may fall outside `{settings.json, settings.jsonc, hooks.json, harness.json}`.

**Proven by refusal** — reverting copilot to `hooks/git-ai.json` turns **2 rows red**. The next
instance fails at the table rather than in production.

A known property, recorded rather than fixed: the allowlist will fire on a legitimate future agent
whose config is (say) `config.json`. That is the **correct direction** — it fails closed and forces a
human to look at the basename, which is exactly the inspection nobody did this time. Frequent firing
would be data, not a defect.

### All six other rows checked — copilot was the only one

```
gemini    ~/.gemini/settings.json   general, hooks, ide, security, tools  -> genuinely SHARED
claude    ~/.claude/settings.json   model, permissions, plugins, hooks    -> genuinely SHARED
droid     ~/.factory/settings.json  hooks only today, GENERIC name        -> agent's own
windsurf  ~/.codeium/*hooks.json    hooks only today, GENERIC name        -> agent's own
firebender  absent (not installed here)
```

That bounds the finding to one row rather than a rewrite.

### A DECLARED divergence, not a silent carve-out

The drift check now skips copilot **with the reason stated**: the collector's `configs` answer *what
should be backed up* (git-ai's targets); our matrix answers *where do WE write*. For six agents those
coincide; for copilot they must not. A carve-out gets deleted in a year; a declared divergence has to
be argued with.

### `entryExtras` — the entry shape is a FIELD, and one part is UNRESOLVED

git-ai's working copilot entry is richer than ours:

```json
{ "command": "…", "powershell": "& '…' checkpoint …", "type": "command" }
```

Entry shape is now a matrix field, so *adding an agent is a row* survives contact with agents whose
entries differ. Copilot gets `type: "command"` — matching the only working example on this machine
rather than a guess.

**The `powershell` variant is deliberately NOT guessed.** Copilot parses hook files in **native
code**, so the schema is unreadable from its JS bundle: a hard wall, not laziness. Inventing a field
into a file on a user's machine to satisfy a schema we cannot read is how a silently-inert hook gets
produced. It goes to tk-0010 as a **specific** question — *does copilot require `type`, and is
`powershell` needed for the hook to fire on Windows* — because a named question gets an answer and a
general one gets a shrug.

**This is the SECOND independent reason Windows stays EXPECTED-UNVERIFIED.** The first was the
af_unix tickler refusing to emit on a named-pipe host. Two unrelated reasons pointing the same way is
a stronger statement than either alone.
