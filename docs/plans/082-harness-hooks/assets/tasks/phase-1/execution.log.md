# Phase 1 — the hook runtime · execution log

Seat: `pij-cautious-firefly` (copilot / claude-opus-5). Worktree
`harness-engineering-worktrees/s077-suite-portability`, branch `s077/suite-portability`,
base `8400e202`.

---

## tk-0001 — `node:net` added to the architecture guard, proven RED before green

**Files**: `harness/cli/test/architecture/no-direct-node-io.test.ts`

### The gap was real, and it is now measured rather than asserted

The plan's G3 note claims the `no-direct-node-io` guard already covers socket I/O
("services must not import node:net directly (no-direct-node-io guards 188 service files)").
It did not. Before this change `FORBIDDEN` held two patterns — `node:fs` and
`node:child_process` — and `grep -rn "node:net"` across `test/architecture/` returned nothing.

**Step 1 — the guard is blind (the plant is IN, the rule is OUT).** A deliberate offender was
planted at `harness/cli/src/services/__redproof-node-net.ts`, in `src/services` specifically —
the guard walks that directory only (`tsFiles(join(CLI_ROOT, 'src', 'services'))`), and
`src/adapters/net/node-socket-probe.ts` imports `node:net` legitimately and always will, so a
plant in an adapter would prove nothing.

```
$ npx vitest run test/architecture/no-direct-node-io.test.ts
stderr | ... no service imports node:fs or node:child_process directly (KF-06)
no-direct-node-io — examined 190 service file(s), 0 offender(s)

 ✓ test/architecture/no-direct-node-io.test.ts (1 test) 16ms
 Test Files  1 passed (1)
```

190 service files examined, **0 offenders**, while one of those 190 was
`import { createConnection } from 'node:net';`. A service could import `node:net` and pass
`just checks`. The G3 note was false.

**Step 2 — the rule is added, and the guard REFUSES.** Verbatim:

```
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/architecture/no-direct-node-io.test.ts > architecture — services keep Node I/O behind ports > no service imports node:fs, node:child_process or node:net directly (KF-06)
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "src/services/__redproof-node-net.ts",
+ ]

 ❯ test/architecture/no-direct-node-io.test.ts:60:23
     58|     );
     59|
     60|     expect(offenders).toEqual([]);
       |                       ^
     61|   });
     62| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed (1)
```

**Step 3 — the `\s+` shape earns its keep.** The rule is `/from\s+['"]node:net['"]/`, matching
the two existing entries. `\s+` rather than a literal space is not cosmetic: the same plant
rewritten with the import line-wrapped across `from` and the specifier is *also* refused —

```
+ Received
- []
+ [
+   "src/services/__redproof-node-net.ts",
+ ]
```

— which a single-space pattern would have missed silently.

**Step 4 — plant removed, guard green.**

```
no-direct-node-io — examined 189 service file(s), 0 offender(s)
 ✓ test/architecture/no-direct-node-io.test.ts (1 test) 14ms
```

189, not 190: the plant is gone from the tree, not merely from the diff.

**dw-0001 satisfied.** The refusal is the evidence, not the rule's presence.

---

## tk-0002 — a reflog read on the git port

**Files**: `src/adapters/git/git-port.ts` (`ReflogEntry`, `ReflogRead`, `readReflog`),
`src/adapters/git/exec-git.ts` (`parseReflogPorcelain` + `ExecGit.readReflog`),
`src/adapters/git/fake-git.ts` (`FakeGit.readReflog`), plus tests in
`test/adapters/git/exec-git.test.ts` and `test/adapters/git/fake-git.test.ts`.

### Where it went, and why not where the task text pointed

The task names `git-read-port.ts` as the file that "exposes no reflog read". It went on
**`git-port.ts`** instead — *the* git port, and the one whose contract is "informational
repository facts", already carrying `currentCommit()`. `git-read-port.ts` documents itself as
exposing **only** `for-each-ref` + `cat-file` over the telemetry ref namespace, "READ-ONLY BY
CONSTRUCTION"; adding a `reflog` verb there would have falsified that header. A third new port
(the plan-074 `GitAttributionPort` precedent) was rejected because the hook runtime already needs
`currentCommit()` from `GitPort` and would otherwise carry two git ports to answer one question.

### Shape, and the one thing that is load-bearing

```ts
readReflog(ref: string, limit: number): ReflogRead;   // newest first
```

`ReflogEntry` is `{ sha, selector, subject }` and **`subject` is the full `%gs` line** — never a
sha, prefix or truncation. That is the PM's constraint and it is the right one: the entries the
guard must reject differ from an authored commit *only* in that text, and a caller handed a
truncation cannot recover what was cut. Framing is `--format=%H%x00%gD%x00%gs` — NUL between
fields because a subject may contain spaces and colons; newline between records because a reflog
message provably cannot contain one (git's on-disk reflog is line-based).

`ReflogRead` keeps **"the read failed" distinct from "there is nothing to read"** — the FX001·R2
lesson the telemetry read port learned the hard way. It matters more here than there, because the
guard's safe default is silence: a caller that cannot tell an empty reflog from a failed read
would emit on evidence it never gathered. Reasons are `unreadable` (git refused or timed out),
`malformed` (git answered, the output did not parse), `bad-limit`.

`ExecGit` gained a constructor `timeoutMs` (default 5s) used by **this method only** — every other
method is left byte-for-byte alone. It exists because the guard runs from an agent hook on every
tool call, where a hung git would stall the agent; a timeout arrives as `unreadable`, so the
failure direction is silence.

### Measured against real git, not against our own fixtures

Probed in throwaway repos before writing a line (`git reflog show --format=%H%x00%gD%x00%gs`):

| situation | exit | output |
|---|---|---|
| not a repository | 128 | `fatal: ambiguous argument 'HEAD'…` |
| repo, unborn HEAD | 128 | same |
| unknown ref | 128 | same |
| **valid ref, `.git/logs` removed** | **0** | **empty** |
| after a commit | 0 | `<sha>\0HEAD@{0}\0commit (initial): first thing` |

That fourth row is why "empty" is `{ status: 'ok', entries: [] }` and not a failure — it is what
git actually reports, verified, not what was convenient to assume.

**The PM's squash-merge measurement independently reproduced here**: after `merge --squash` +
`commit`, `HEAD@{0}` reads `commit: squashed in` — byte-identical to an authored commit — and
`rev-list --parents -1 HEAD` returns two fields, i.e. **one parent**, also identical. Both facts
are pinned as assertions in the real-git test so the guard can never be designed as though either
could separate them.

### Evidence

```
$ npx vitest run test/adapters/git/fake-git.test.ts test/adapters/git/exec-git.test.ts
 ✓ test/adapters/git/exec-git.test.ts (21 tests) 3ms
 ✓ test/adapters/git/fake-git.test.ts (18 tests) 363ms
 Test Files  2 passed (2)
      Tests  39 passed (39)
```

**Mutation check — the tests bite.** `subject` was mutated to `subject.split(' ')[0]` (the exact
truncation the PM warned against). Two tests went red, including the multi-word-subject case;
mutation reverted, green restored. A test that cannot fail is not evidence.

**dw-0002 satisfied**: `FakeGit` seeds both entries and typed failures (`reflog`,
`reflogFailure`), and `ExecGit` is covered by a test that builds a real repository and reads real
reflog subjects — `commit (initial): seed: the first thing` and `commit: squashed in`.

---

## Discoveries & Learnings

| tag | what | so what |
|---|---|---|
| Noteworthy | The reflog read went on `GitPort`, not the `git-read-port.ts` named in the task text. | Reasoned above. A reviewer who wants it elsewhere should say so before tk-0003 builds on it. |
| Noteworthy | `ExecGit` gained a `timeoutMs` constructor parameter, defaulted so no existing caller changes behaviour, and used by `readReflog` only. | A widened constructor is a small blast radius, but it is a change to a class doctor depends on. |
| Noteworthy | `harness dd set …/state in-progress` is refused — `E451`, the enum is `unchecked, checked, blocked, human-skipped, na`. | The implement sub-skill's per-task checklist prescribes a `[~]` in-progress flip that the schema cannot represent. Progress is visible only at terminal states. |

---

## Gate evidence (baton `s077-gate`, lease `lease-828e8d3c`)

The tree held **only** these two tasks' files at gate time (`git status --short` — six source/test
files plus the three phase-1 plan files), so this result certifies this work and nothing else.

**`just test-all` — the authoritative scope, the one CI gates on:**

```
 Test Files  359 passed (359)
      Tests  5326 passed (5326)
   Duration  20.30s
Statements : 89.86%  Branches : 81.27%  Functions : 92.25%  Lines : 92.2%
```

**`just checks` — `degraded`, and every degraded gate is PRE-EXISTING and in files I did not
touch.** Attribution was established per-finding, not by comparing totals:

| gate | finding | mine? |
|---|---|---|
| `arch-check` | 2 warn `services-ports-type-only`: `services/telemetry/sync-service.ts` and `services/telemetry/ref-source.ts` → `git-write-port.ts` | No — neither file is in this diff, and neither names `git-port.ts`. |
| `windows-check` | 7 hazards, all in `.harness/extensions/checks/extension.ts` | No. The new real-git fixture uses `mkdtempSync(join(tmpdir(), …))`, never a hard-coded `/tmp`. |
| `markdown-lint` | 211 findings, none under `docs/plans/` | **Unproven, not clean.** `.markdownlint-cli2.jsonc:46` ignores `docs/plans/**`, so this execution log was never scanned. Zero findings here means out-of-scope, not lint-clean — recorded rather than claimed. |

`tests`, `biome`, `typecheck`, `check:docs`, `check:flows`, `check:telemetry-fixtures`,
`check:doctrine-parity`, `check:dd-docs`, `root-invocation-smoke`, `dd doctor` and `skills-check`
all `ok`. Note the `checks` envelope runs `tests` at the **fast** scope and says so in its own
note; the full scope is the separate `just test-all` run above.



---

## tk-0003 — the PRE hook records the INDEX STATE, atomically

**Files**: `src/adapters/git/git-port.ts` (`IndexState`, `indexState()`),
`src/adapters/fs/fs-port.ts` (`createExclusive`), `src/services/hooks/hook-state.ts`, adapters and
fakes for each, `test/services/hooks/hook-state.test.ts`.

Exit codes were **measured before the code was written**, including the case expected to be a
problem and was not: `git diff --cached --quiet` exits 0 on an **unborn HEAD with an empty index**
and 1 with a file staged. So the first commit in a repository is handled by the ordinary path
rather than special-cased. 129 (not a repo) and everything else map to `unknown`.

### Two different races, two different mechanisms

They are not the same fix and conflating them is how the bug returns:

| race | mechanism | what it guarantees |
|---|---|---|
| a POST reading a half-written record | atomic replace (unique temp → `rename`) | reads are **coherent** |
| two POSTs deciding on one commit | `O_EXCL` claim keyed by (repo, destination head) | the decision is **unique** |

An atomic write does **not** give the second property: the read-then-write window *is* the bug,
and only `O_EXCL` closes it. State is one file per repository keyed by `sha256(repoRoot)`, not the
POC's single shared JSON keyed by repo path — that shape has a lost-update race the moment two
repositories fire at once.

`FakeGit.indexState()` defaults to **`unknown`**, deliberately. A `clean` default would make every
test that forgot to seed it look like a genuine authored commit — the exact failure the
discriminator exists to prevent.

### The claim prune (found in review by `pij-respectable-clam`)

One marker per commit, never removed, is unbounded growth in a hidden directory. When it
eventually meets an inode or quota limit `createExclusive` starts returning `false` — which means
*"someone else won"* — so the guard fails closed and **silently stops emitting** while every path
still exits 0. `CLAIM_KEEP = 50`, pruned on write, best-effort so a prune failure can never cost
the claim that already succeeded.

Assertions are on the **identity** of the survivors, not a global count: a count could be
satisfied by unrelated cleanup, or by deleting the *wrong* markers. A second test proves another
repository's markers are untouched **and its claim is still held** — a prune that silently freed a
claim would let a re-fire double-emit, which a count assertion would never have seen.

One deliberate exception, recorded rather than discovered: the **real-filesystem** prune test
asserts only the *bound*, not which markers survive. Real mtimes are millisecond-resolution, 55
creates land inside one millisecond, and the survivor set is then genuinely arbitrary — asserting
identity there would be a flake generator. Identity is pinned in the `FakeFs` test where ordering
is deterministic. `FakeFs.createExclusive` had to stamp mtimes like `writeText` does, or fake and
real would prune different survivors.

**Evidence**: 14 tests, one driving real git end to end — agent edit → `clean` → record → commit →
still reads `clean`; `merge --squash` → `already-staged` → record → commit → still reads
`already-staged`. The same test asserts `.git/MERGE_HEAD` and `.git/SQUASH_MSG` are **both absent**
after the squash commit, which is why `.git` state is not a classifier parameter.

**Mutation checks (6, all caught)**: claim made non-exclusive; `recordPre` made an in-place write;
`indexState` mapping exit 1 to `clean`; prune disabled; prune keeping the *oldest*; prune ignoring
the repo prefix.

---

## tk-0004 — the pure classifier

`classifyHeadTransition({ prev, head, parents, reflogSubject, indexAtPre, commandScan })`. Pure,
single type-only import. Checks run cheapest-first and **every one can only move the answer toward
silence**.

Both `done_when` items are guards, so both were proven **by refusal**, not by passing:

- planting `import { readFileSync } from 'node:fs'` → the purity test failed with
  ``/from\s+['"]node:fs['"]/ must not appear: expected true to be false``.
- planting `gitDirState?: { MERGE_HEAD: boolean }` into `TransitionInputs` → the no-`.git`-state
  test failed. It scans the **interface block only**, so naming `MERGE_HEAD` in the prose that
  explains its absence stays legal while declaring it as a field does not.

**Mutation checks**: index check removed → 8 RED; `unknown` treated as `clean` → RED; reflog
matched as a substring → RED.

---

## tk-000d — the command scan, and the bug the real-git suite found

### The most important finding on this plan

> **A unit test built from a plausible-looking fabricated reflog subject PASSED while the deny list
> matched a prefix that no real pull has ever produced.**

git writes the **whole argv** into the reflog subject:

```
pull -q --ff-only origin main: Fast-forward
```

not `pull: Fast-forward`. The implementation matched the literal prefix `pull:` — matching **no
real pull, ever** — and the unit test agreed with it, because both came from the same imagination.
The provocation row against a real repository went RED and exposed it.

This is the entire argument for driving real repositories rather than the pure function, and it was
settled by a failing row instead of an argument. The fix: take the phrase before the **first
colon**; its leading word is the operation. Every reflog string in the unit tests is now one git
actually produced, with a comment at `classify-head-transition.test.ts` banning fabricated ones —
**that comment is the thing that stops this being re-introduced in six months.**

Consequences pinned as tests: `commit: pull: rename the helper` still **emits** (the phrase is just
`commit`); `commit (initial)` is **authorship**, while `(amend)`, `(merge)` and `(cherry-pick)` are
not.

### The scan itself

Segments split on `&&`, `||`, `;`, `|` and newline, **every** segment inspected, matched at the git
*invocation*. Measured from 76 captured Cursor PRE payloads: the agent chains
`git add -A && git commit …` in **one** Shell tool call, so an import chained the same way reaches
PRE with a **clean** index and index-at-PRE cannot see it. A first-token scan misses every real
instance.

`checkout`, `restore` and `reset` are qualified rather than blanket-matched (`--` pathspec,
`--source`, a target ref) because `git checkout -b foo` authors nothing and silencing it would cost
ordinary work.

Two decisions, both upheld on review:

1. **`unavailable` ABSTAINS.** It neither silences nor approves. If a missing command forced
   silence, any client that sends no command would have the feature switched off wholesale — a
   config-shaped outage that looks like a working guard. Abstaining keeps the layer's property
   intact: it only ever **adds** silence when it positively recognises an import, so it introduces
   **no new false-positive path and no new false-negative path**.
2. **The captured Cursor line is asserted as `authors-only`** — a positive control on the guard
   itself. If it ever scanned as an import, the feature would emit nothing and every silence row
   would pass for the wrong reason: a suite green because the system is dead.

### A known-blind row that was not blind

The heredoc row was specified as KNOWN-BLIND. Built as specified, it went **RED**: the heredoc body
is in the same command string and the scan splits on newlines, so it **is** caught. It moved to the
caught rows with a comment saying it is caught **incidentally, not by design** — the row was not
deleted for contradicting the spec, and the accident was not recorded as a capability. Script
wrapper, alias and Makefile target remain genuinely blind and assert EMIT.

### Defence in depth, measured (dw-001f)

| negation | RED rows |
|---|---|
| command scan OFF only | **5** — every defeater-INSIDE-bracket row |
| index-at-PRE OFF only | **7** — every defeater-BEFORE-bracket row |
| both OFF | **12** — the exact union |

The failure sets are **disjoint**: neither layer covers for the other, and that is now measured
rather than argued.

### What an over-emit costs is UNMEASURED

Stated as the open question it is — neither upgraded to "fabricates authorship" nor downgraded to
"harmless". The six events tell the daemon a commit happened; the line-level attribution is
git-ai's own, computed from checkpoint records its hooks wrote. A row records the observed daemon
behaviour for an over-emit and reports **SKIPPED** without a live daemon; it deliberately asserts
nothing about the outcome, because an assertion there would encode the very guess it exists to
replace.

---

## tk-0005 / tk-0007 — the provocation suite and the intercept

32 rows, each driving **real git in an isolated repository** and asserting on the **runtime's**
decision, in the real agent shape: `PRE fire → the transition → POST fire`.

The intercept takes the **claim before the emit** (the POC writes state *after* emitting — that is
the window). Three racing POSTs against a real filesystem produce exactly **one** emit. Every
failure is an outcome, never a throw. The baseline is re-based on every POST path *including the
silent ones*: an ignored checkout still moved HEAD, and leaving a stale baseline would make the
next commit look like a multi-commit jump and be dropped too.

### Trade-off recorded: `SLOW_TESTS` and the fast scope

The suite costs ~8.7s, so it is registered in `SLOW_TESTS` (`vitest.config.ts`) with a measured
median, consistent with the existing band. **Name the consequence:** this suite is the *only* proof
the guard works, and `SLOW_TESTS` means **it does not run under `just test`**. A developer on the
default scope gets **zero signal on the most safety-critical thing in this plan**, and the
fast-scope banner reports green regardless. CI sets `HARNESS_TEST_SCOPE=all`, so the branch is
covered — but a broken guard can pass a green local run. Written down here so it is not discovered
by shipping.

### Gate evidence (baton `s077-gate`, lease `lease-08ce0cc5`)

`just test-all` — the scope CI gates on:

```
 Test Files  363 passed (363)
      Tests  5451 passed (5451)
Statements : 89.91%  Branches : 81.32%  Functions : 92.3%  Lines : 92.25%
```

5451 vs the 5326 at the previous commit — +125 tests, no regressions.

`just checks` — `degraded`, exit 0, with the **identical** finding counts to the previous commit
(2 arch / 211 markdown / 7 windows). Every degraded gate is pre-existing and in files this diff
does not touch; the four new service modules under `src/services/hooks/` added **zero** findings
(dependency-cruiser now cruises 319 modules, up from 315, with the same two warnings naming
`services/telemetry/sync-service.ts` and `services/telemetry/ref-source.ts`). `markdown-lint`
still ignores `docs/plans/**`, so this log remains **unscanned, not proven clean**.


---

## tk-0006 / tk-0008 — the tickler, and the live-daemon note MEASURED

### The result, on this machine, against the live daemon

Not skipped. `git-ai bg run` was live at the measured pin **1.6.21** with both sockets present, so
the positive half was runnable and was run. The note the daemon wrote, verbatim:

```
a.txt
  s_ed609d39de2442::t_eb4de9492947b2 1-3
---
{
  "schema_version": "authorship/3.0.0",
  "git_ai_version": "1.6.21",
  "base_commit_sha": "b18ebf6176be7bdb13b1795d1cc5d94eb262107e",
  "sessions": {
    "s_ed609d39de2442": {
      "agent_id": { "tool": "github-copilot-cli", "id": "62892a0d-…", "model": "unknown" },
      "human_author": "Jordan Knight <…>"
    }
  }
}
```

The chain end to end: a commit made with **trace2 discarded** — the sandboxed-agent case this plan
exists to fix — carried **no note**; our six synthetic events, in **one** send, produced one in
~400ms. Assertions are on **identity**: the file, the line range `1-3`, and the session id from the
range line **cross-referenced against the sessions map in the note's own body**, so the three agree
with each other rather than each merely being present. Never a count — any unsandboxed commit
anywhere on this machine moves a count.

Observed, and relevant to the unmeasured-harm question: the daemon attributed the lines to tool
`github-copilot-cli` under the session that was running. The line-level attribution is **git-ai's
own**, computed from its checkpoint records; our events only told it a commit had happened.

### The causation control

"A note appeared after we emitted" is not the claim "our emit caused the note", and on a machine
running a live daemon with git-ai's own hooks installed, ambient activity was a genuine competing
explanation. So the same repository, the same commit, the same wait — and **no emit**: the note is
**absent** over a window many times longer than the measured arrival. Found by mutating the emit
away and watching the row stay red for the full window, which is the only way to know a control is
actually a control.

**Status of the acceptance criteria, stated precisely:** ac-0001 and ac-0002 are
**MEASURED on macOS against a live daemon**, and **UNVERIFIED in CI** — where no daemon exists and
the trace2 event stream is disabled run-wide. The fixture records **SKIPPED**, never PASSED, when
no socket is reachable, and prints the trace2 target it looked at so a skip is diagnosable.
"SKIPPED" and "unproven" are not the same claim, and neither is "Phase 1 unproven".

### Two guessed formats, one method — name them together

Twice on this plan a **fabricated** artifact produced a test that proved nothing, and the **real**
artifact corrected it:

1. an imagined reflog subject (`pull: Fast-forward`) that **no pull ever writes** — git writes the
   whole argv; and
2. an imagined JSON note shape, when the real note is a **plain-text block terminated by `---`**
   with JSON after it.

**Both times the fabricated version passed and the real one failed.** Read separately these are two
typos; read together they are a method — *a test written from an imagined artifact tests the
imagination, and only the real artifact can fail it.*

### Other decisions

- The hermetic-git guard **failed this very fixture** because a doc comment quoted a trace2 key in
  `KEY=` form. The comment was reworded — the guard was not exempted. A guard that gets an
  exemption the first time it inconveniences its author is decoration. A `liveDaemonGitEnv` helper
  written and then not needed was **deleted** rather than left to explain itself later.
- The tickler reads the ingress from git's global `trace2.eventTarget` rather than re-deriving
  git-ai's sha256-of-internal-dir digest as the POC does. A second derivation of someone else's
  internal path diverges **silently** the moment they change it.
- **ONE send, not six.** `SocketRelayPort.send()` half-closes per call, so six calls would give the
  daemon six sessions for one commit. The test asserts the **call count**, because a loop sending
  each event separately produces identical total bytes and would pass a bytes assertion.

### The scope caveat, stated once and plainly

**Both suites that prove this feature works — `provocation.int.test.ts` and
`live-daemon-note.int.test.ts` — are in `SLOW_TESTS`, so neither runs under the default
`just test`. A local green says nothing about whether the guard is correct or whether the emit
works. CI on `test-all` is the only place they run.** Written down so nobody learns it by shipping.


---

## tk-0009 / tk-000a / tk-000b / tk-000c — the verb, its failure paths, and the platforms

### THREE guessed shapes, one method — the full list, in one place

Three times on this plan a **fabricated** artifact produced a test that proved nothing, and the
**real** artifact corrected it:

1. **the reflog subject** — matched the literal prefix `pull:`, which no pull writes (git writes the
   whole argv, `pull -q --ff-only origin main: Fast-forward`);
2. **the note format** — parsed as JSON, when the real note is a plain-text block terminated by
   `---` with JSON after it;
3. **the note's attribution line** — parsed only the agent form `s_<session>::t_<turn>`, so a
   **human-attributed** note (`h_<id>`, no `::`) parsed as *zero* attributions and the row flaked.

**Every time, the fabricated version passed and the real one failed.** Three is a method, not bad
luck: *a test written from an imagined artifact tests the imagination, and only the real artifact
can fail it.*

### The over-emit question, ANSWERED — by the flake

The third instance was not merely a parser bug; chasing it answered the plan's biggest open
question. For the **same commit shape**, this machine's daemon writes **two different notes**:

```
a.txt
  s_ed609d39de2442::t_eb4de9492947b2 1-3     <- AGENT (body has "sessions")

a.txt
  h_9e71e8b09f7cf2 1-3                        <- HUMAN (body has "humans")
```

Observed across five consecutive runs: **agent ×1, human ×4.**

Our six events tell the daemon *a commit happened here*; they do **not** determine attribution.
That is git-ai's own computation over the checkpoint records **its** hooks wrote, and with no agent
checkpoints covering those lines it falls back to **human**. So the observed failure direction of
an over-emit is a **human-attributed** note — **not** a fabricated claim that the agent wrote
someone else's code.

**This is NOT a claim that a false agent attribution is impossible.** It was not observed *here*,
in a repository with no agent checkpoint records. A repository where the agent HAS recent
checkpoints is a different case and **remains unmeasured**.

The consequence is a boundary, and it is the general lesson: the original row asserted a property
of a system **we do not control**, which is exactly why it flaked. **A test that asserts someone
else's behaviour reports their changes as our regressions.** The row now asserts what our emit
*causes* — a note exists, anchored to this sha, naming this file and this line range with an actor
cross-referenced against the note's own body — and **records** which kind of actor without
requiring one.

### An assertion tightened from conditional to unconditional

The journal row was first written as `if (last.outcome?.kind === 'failed') { … }`. That passes on a
run where the guard never reached the emit at all — **the exact invisible case the journal exists
to expose**. It is now unconditional: `kind` is `failed` and `cause` is
`no af_unix trace2 ingress configured`.

### Windows: not "unverified" — INERT

The tickler reads git's global `trace2.eventTarget` and returns `null` for anything that is not
`af_unix:`. On a named-pipe host it therefore **refuses to emit** and journals
`no af_unix trace2 ingress configured`. That is honest — it never claims a delivery it did not
make — but **the feature does nothing on Windows today**. That is a materially different statement
from "unverified on Windows", and "code-portable but unobserved" would now be too generous.
`assets/platform-findings.md` carries the four things #108 must check and the exact command.

### Platforms

- **Linux MEASURED** (Ubuntu plucky, aarch64, node v22.23.2, git 2.48.1, OrbStack): **138/138**
  hooks tests, **including the full 32-row provocation suite** — so the guard's correctness is not
  a macOS artefact. macOS `node_modules` cannot be reused (rolldown's native binding is
  per-platform), so the tree was copied into the VM and installed there.
- A second result for free: the live-daemon fixture recorded **SKIPPED** with its reason printed,
  which proves the skip path behaves correctly on a machine with **no daemon** — **exactly the CI
  condition**. CI will record a skip, not a false pass.

### What a default-scope (`just test`) developer DOES and DOES NOT get

**DOES get** — every unit suite (classifier, command scan, tickler payload, hook state, journal,
payload parsing) **and** `hooks-verb.int.test.ts`, deliberately left in the fast scope at ~1.8s so
the default loop retains real signal on the verb: exit-0-and-silent on five injected faults, the
journal recording a failure with its cause, and the hook leaving no trace in the observed repo.

**DOES NOT get** — the two suites that prove the feature actually works:
`provocation.int.test.ts` (the guard is correct) and `live-daemon-note.int.test.ts` (the emit
reaches a daemon). Both are in `SLOW_TESTS`. **A green `just test` says nothing about either.** CI
on `test-all` is the only place they run.


### Final gate (baton `s077-gate`, lease `lease-7866c918`)

```
just test-all   ->  Test Files 367 passed (367)   Tests 5499 passed (5499)
                    Statements 89.75%  Branches 81.3%  Functions 91.93%  Lines 92.07%
just checks     ->  degraded, exit 0 — arch 2 / markdown 211 / windows 7
```

Those three warn-launch counts are **byte-identical to the two previous commits**, so the new act,
the five new service modules and the seven new test files added **zero** findings. `markdown-lint`
ignores `docs/plans/**`, so this log and `platform-findings.md` are **unscanned, not proven clean**.
