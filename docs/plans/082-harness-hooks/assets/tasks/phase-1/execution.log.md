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

