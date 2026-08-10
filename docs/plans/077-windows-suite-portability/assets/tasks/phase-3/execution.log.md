# Phase 3 execution log — round two

**Coder**: `pij-sacred-orangutan` · **PM**: `pij-respectable-clam` · **Date**: 2026-08-08
**Branch**: `s077/suite-portability` · **Consumer issue**: #108 · **PR**: #118 (open, accumulating)

Round two is two items and then it stops: the flake class round one created, and the one
item anyone suspected of being a product defect.

---

## tk-0202 — the suspected product smell. **It is not one.**

**Verdict: test-environment, both parts. Nothing here outranks the phase.**

The consumer's premise was that `skills.test.ts`'s 10 failures were
`TypeError: File URL path must be absolute` at `skills-service.ts:19` — `src/`, not test
code, and therefore the only plausible product defect in their whole ledger.
**That line explains 1 of the 10, not 10.**

### How it was traced without a Windows box

Node ≥22 accepts `fileURLToPath(url, { windows: true })`, which runs win32 path semantics
on macOS. That turns "what would Windows do here" from an argument into a command.

Resolving `../../../../../skills` against **four realistic win32 module URLs** — their
checkout's `src/` and `dist/`, a shallow `C:\h` install, and an npm-global layout — every
one returns a drive-lettered path and **none throws**:

| module URL (win32) | result |
|---|---|
| `C:/src/pristine-116/harness/cli/src/services/skills/…` | `C:\src\pristine-116\skills` |
| `C:/src/pristine-116/harness/cli/dist/services/skills/…` | `C:\src\pristine-116\skills` |
| `C:/h/cli/dist/services/skills/…` | `C:\skills` |
| `…/npm/node_modules/@ai-substrate/harness/dist/services/skills/…` | `…\node_modules\skills` |
| **`file:///pkg/harness/cli/dist/services/skills/…`** (the test's own fixture) | **THROWS `ERR_INVALID_FILE_URL_PATH`** |

The throw requires a file URL with **no drive letter**. `import.meta.url` on Windows always
carries one. So the only input in existence that can produce this error is the hand-written
`file:///pkg/...` literal at `skills.test.ts:51` — a fixture, not the product.

### The other 9 — a different root cause entirely

`FakeFs.copyDir` (`src/adapters/fs/fake-fs.ts`) normalised its `src` argument to POSIX but
compared it against **raw seeded keys**. On win32 `packagedDir` carries backslashes, so
`hasSource` was false, staging returned *"could not stage packaged skills"*, and every test
through the packaged-source path failed — on Windows only.

**9 + 1 = 10. Mechanism verified for both parts**, which matters: a root cause that explains
9 of 10 and hand-waves the last one is how a wrong answer survives, because the last item
inherits the credibility of its confirmed siblings.

### `it's in src/` was true of both and load-bearing for neither

This heuristic — file location as a proxy for reachability — is what put this item on the
consumer's list, on the PM's list, and in the task text. All three parties used it.
`FakeFs` also lives in `src/`; it is a **test double** with no production instantiation
(grepped: two comment mentions, zero constructions). Checking reachability directly made the
proxy evaporate. The consumer reasoned the same way and is owed the reason it failed.

### Two independent traces disagreed — which one fires

The consumer independently traced the same 9 and reached a *different* mechanism: the
readdir key matches, the walk starts, and the mixed-separator **file** keys miss every read.
Both mechanisms produce 9 failures and the same user-visible message, which is exactly how
one of them survives being wrong. Evaluating the pre-fix predicate verbatim on
Windows-shaped keys:

```
dirKeyMatches  (their "readdir key MATCHES")  : false   ← inside copyDir
fileKeyMatches                                : false
hasSource                                     : false   → copyDir returns before ANY read
```

and, separately, on the same fake:

```
readdir(nativeDir)              : ['README.md', 'eng-harness-flow']   ← their observation, real
readText(`${dir}\README.md`)    : null                                ← their door, real
readText(`${dir}/README.md`)    : 'readme'
```

**Both parties describe something true.** Their door is genuinely open — a native-separator
read against mixed-separator keys does return `null`. It is simply **not on this route**:
`copyDir` bails at `hasSource` before reaching a read, and its copy loop already normalised
keys before this change. So on *this* tree the fix closes the door that was actually shut.

**What the evidence supports: (a) — mine is the live mechanism, theirs describes a door this
path never reaches.** Stated for our tree, at this HEAD.

**What it cannot distinguish: (c) — theirs live on their tree, mine on ours.** Their fork is
demonstrably not upstream (it carried a win32-only `maxWorkers: 1` that upstream never had),
and a difference that changes worker count can change which door you reach first. Nothing
runnable from here can rule that out. The decisive test is theirs to run, and it is cheap
now that their turnaround is ~3 minutes.

> **A fix can be correct for the wrong reason, and a control proving 9 red go green cannot
> distinguish which door it shut.**

### The controls

- **Unit control** (`fake-fs.test.ts`, committed): seeds Windows-shaped keys, asserts
  `copyDir` returns true **and that the copied content is readable at the destination** —
  so it proves the walk reaches the file keys, not merely that a boolean flipped.
  Demonstrated red before the fix and green after, on macOS and Linux too: the input that
  distinguishes fix from defect is the key *shape*, not the host platform.
- **Faithful replay** (probe, not committed): `resolvePackagedSkillsDir` stubbed to a native
  win32 path so the fixture and the act agree exactly as they do on Windows —
  **10 failed → 1**, that 1 being the probe's own artefact (it mocks the function the pure
  test asserts on). An earlier replay that let the two sides *diverge* reproduced the same
  9 failures through a route Windows does not take; it was discarded rather than reported.

---

## tk-0201 — the flake class round one created

Round one killed the 5000ms class (46 → 0) and created a 30000ms one (0 → 8). Eight cases
now sit at the ceiling, worst median 27.5s against a 30s budget: **1.09x headroom, a flake
generator rather than a pass.** The brief's instruction was to prefer making the work cheaper
over raising the ceiling a second time, since raising it again concedes the pattern and buys
another round of exactly this.

### The consumer's suggested win, verified rather than inherited

Their proposal: the three `flow-renderer` mermaid-parse cases account for ~76s between them
and look consolidatable to **one representative parse proof** without losing the property
under test.

**Half right, and the wrong half is the one that would have cost coverage.** The ~76s is
real (27.5 + 25.9 + 22.3 = 75.7s). But these are three *different* properties over three
*different* inputs — the whole golden-fixture corpus, the importance-border regression that
actually shipped once as a real defect, and the full TD-columns shape. Collapsing to one
representative proof discards two of them.

**The cost is not the assertions — it is the process spawns.** `validateMermaid` spawns
`node`, and that child loads mermaid + jsdom. Measured on macOS:

| fences in one spawn | wall |
|---:|---:|
| 1 | 508ms |
| 5 | 552ms |
| 20 | 558ms |

Flat. Nineteen extra fences cost 50ms; each extra **spawn** costs ~500ms. Three call sites
meant three spawns. The runner already accepts an array of fences and reports per-fence
results, so all three proofs can share **one** spawn and keep every assertion.

**Change**: fences batched behind a memoised module-level helper, keyed by prefix
(`fixture:*`, `importance:*`, `td`); each test asserts on its own slice. Memoised rather
than `beforeAll` so a filtered run (`-t AC-01`) pays for no mermaid spawn at all.

**Measured, macOS** — same 58 tests, no coverage given up:

| | before | after |
|---|---:|---:|
| golden-fixture corpus proof | 515ms | 585ms *(now carries all three)* |
| importance-border proof | 503ms | ~0ms |
| TD-columns proof | 547ms | ~0ms |
| **spawns** | **3** | **1** |

A vacuity guard was added while restructuring: `fencesUnder()` asserts its prefix matched at
least one fence. Without it an empty batch satisfies "nothing invalid" — which is how a
parse proof silently stops proving anything.

### The other five ceiling cases — MEASURED: they spawn 99 real child processes

**An earlier version of this log claimed these five were fully faked, contained no
`child_process` work, and had no mechanism. That was false, and it was corrected by
review (`assets/reviews/phase-3-review.md`, P1) rather than by me.** The claim is
retracted in full; what follows replaces it and is measured, not read.

A read-only `node:child_process` observer (wrapping `spawnSync`/`spawn`/`exec*`/`fork`,
recording each call and delegating to the original) was run across **both entire files**,
so the 34 non-ceiling tests act as the control:

| test | spawns | local elapsed |
|---|---:|---:|
| `update-banner` — negative control | **27** | 608ms |
| `app` — THROWING capture (AC-09) | **18** | 422ms |
| `app` — non-Error throw (catch-all) | **18** | 403ms |
| `app` — throw while BUILDING CaptureDeps (F1) | **18** | 339ms |
| `app` — telemetry on vs off, `doctor` | **18** | 333ms |
| 5 other `doctor`-invoking tests | 9 each | 162–200ms |
| **29 of 39 tests** | **0** | — |

**144 spawns total; the five ceiling cases account for 99 of them (69%), and they are the
five heaviest spawners in both files.** The gradient is exactly `9 × (number of `doctor`
invocations)` — 16 doctor runs × 9 = 144, reconciling to the last call. Each run spawns
`git rev-parse` ×3, `git config`, `git symbolic-ref`, `git merge-base`, `git rev-list`,
`git notes`, and `which node` — the last being **`where node` on Windows**
(`adapters/process/node-process.ts:5-11`).

Local cost tracks spawn count linearly at roughly **20ms per spawn**.

**Why the fakes did not prevent this** — verified at source: `acts/doctor.ts` `runReport()`
constructs `new NodeFs()`, `new ExecGit()` and `new ExecGitAttribution(cwd)` **itself**;
only `sockets?.probe` is injectable. A test handing `doctor` fake ports gets real adapters
anyway. The fakes are accepted and ignored. That is a product smell, it is the most
interesting thing round two found, and it is **deliberately not fixed here** — it is a new
item and the consumer ranks the work. Measured and named, not fixed.

**This is an unresolved candidate, not the cause.** A mechanism with a count is not a
demonstration that it produces their 18–26s. And one check cuts against it: if spawn count
dominated, the 27-spawn `update-banner` control should run ~1.5× the 18-spawn `app` cases.
Their medians do not show that (25.0s vs 26.0s and 18.4s). Either a large fixed per-test
cost dominates on their box, or those medians are timeout-contaminated — they warned the
numbers came from a non-green branch where identical isolated repeats gave 25.7s and 77.8s.

**Falsifiable prediction for their re-run**: if the spawn path dominates, per-test elapsed
should scale with the 9/18/27 spawn counts above. If it does not, spawn count is ruled out
as the primary term and the remaining suspect is per-test fixed cost.

### How the false absence was produced — two independent errors

Recorded because the shape recurs, not for contrition:

1. **The search boundary was the test file.** The fakes are handed to `main()`; the spawn is
   two layers down, inside an act that constructs its own adapters. Reading the test and the
   telemetry services proved something true about *those files* and nothing about the run.
2. **The timing filter could not see the opposite.** Local durations were dismissed as
   "0ms" on the strength of a shell filter (`grep -vE " 0ms|[1-9]ms$"`) that also silently
   discarded every duration ending in a non-zero digit — including the 608ms and 422ms
   above. A malformed probe returned an artefact of itself, and it happened to agree with
   error 1, which is what made the conclusion feel corroborated.

Two instruments agreeing is not corroboration when one of them cannot report the contrary
result. The absence was flagged as the softest claim in the round and pointed at a reviewer
deliberately; that is the only reason it was caught before it reached the consumer.

---

## tk-0203 — the three columns

**Never a total that mixes them.** Every win32 figure is **EXPECTED, UNVERIFIED on win32** —
mechanism verified on macOS under simulated win32 semantics is **not** the same as verified
on Windows. Their re-run is the measurement.

| | count | basis |
|---|---:|---|
| **FAILURES FIXED** (become passes) | **10** *(skills)* **+ 2** *(flow-renderer timeouts)* | skills: 9 via the `FakeFs` normalisation + 1 via the fixture, faithful replay 10 → 1-artefact. flow-renderer: two of the three ceiling cases stop doing any work. |
| **FAILURES DECLARED** (become named skips) | **0** | Nothing was skipped this round. No coverage was given up. |
| **SKIPS RECOVERED** (become real coverage) | **0** | Nothing previously skipped was restored. |

**Suite denominator**: **+1 case** (the `FakeFs` Windows-shaped-keys control) — counted from
the diff, not by subtracting run totals, because a `main` merge landed between round one's
log and this one and the two totals are therefore different trees. Local total is now
**5124**; round one's 5116 is **not** the comparable baseline. That conflation has cost this
thread three wrong conclusions already, twice from us and once from them.

### Does their number actually move? Say it plainly.

Round one moved it **134 → 60**. Round two is expected to move it **60 → ~48**, and the
honest reading of that is:

- **10 of the ~12 are `skills`** — one `FakeFs` predicate and one fixture line.
- **2 are timeouts.** The third `flow-renderer` case still carries the one remaining spawn,
  and **its Windows elapsed time is unmeasured** — the merged case has never run on
  Windows. An earlier draft put it at "~26s, ~1.15x headroom"; that number was *derived*
  (their 25.9s standalone corpus median plus the macOS one-vs-twenty-fence measurement) and
  is withdrawn. A derived figure reads exactly like a measured one and invites comparison
  against the 30s ceiling as though we had checked. What is true: **one spawn remains where
  three were.** Whether that clears the ceiling is theirs to measure, and their own 25.7s
  vs 77.8s variance on identical repeats is why nobody should predict it from here.
- **The other 6 ceiling cases are untouched.** Five of them now have a **measured**
  candidate mechanism — 99 real child-process spawns, 9 per `doctor` run, because `doctor`
  ignores its injected ports — but a mechanism with a count is not a cause, and their own
  medians do not scale with spawn count. Unresolved, with a falsifiable prediction attached.
- **The skills trace came back environmental**, which was the outcome the task warned
  against overselling.

So: **two tasks, one real fix and one genuine but partial reduction.** This round does not
move the consumer's number the way round one did, and the trace — not the fix — is the more
valuable output, because three parties were carrying the wrong version of what those 10
failures were.

### Local gate (measured, macOS)

`just checks` — **every hard gate ok**: `tests:ok biome:ok typecheck:ok check:docs:ok
check:flows:ok check:telemetry-fixtures:ok check:doctrine-parity:ok check:dd-docs:ok
root-invocation-smoke:ok dd doctor:ok skills-check:ok`.

Three warn-launch degradeds (`arch-check`, `markdown-lint`, `windows-check`) are
pre-existing; `windows-check`'s 6 findings are all in `.harness/extensions/html-snap/`,
none in any file this phase touched.

**Full suite: 5124/5124, three consecutive clean runs.**

---

## Pointers, not scope

- **Issue #129** (the class-level path-separator work — shared helper + a lint rule banning
  path-shaped `${x}/...` concatenation) has a partial instrument already in this repo:
  `harness windows-check`, with rules WIN001–WIN008 and a `// win-ok:` escape hatch. Two
  gaps make it miss this class today, and both are stated in its own briefing rather than
  hidden: its scope is **`.harness/extensions/**` only** — `harness/cli/src` and `test/` are
  explicitly out of scope, which is where every one of the five instances (A1
  `displayAddress`, A2 `itemKey`, C1 pin-knob, C2 refresh, skills) actually lives; and no
  rule encodes template-literal path concatenation (WIN004 is the nearest, and only covers
  `.split('/')`). Extending an existing gate is likely cheaper than a new one. **Not pulled
  into this round.**
- **`cbd90474`** (turkey's preserved class-1/2 work, 6 test files) is **not an ancestor of
  this branch** — verified with `git merge-base --is-ancestor`. It is preserved but not
  merged here, so it is not covered by this round's green suite. Someone owns that merge.
