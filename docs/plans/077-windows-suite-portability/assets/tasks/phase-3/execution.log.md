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

### The other five ceiling cases — no work to make cheaper

`app.test.ts` ×4 and `update-banner.test.ts` ×1 were investigated and **deliberately not
changed**. They drive fully-faked deps (`FakeExec`, `FakeFs`, `FakeEnv`, `FakeGit`,
`FakeClock`, `FakeProcess`, `FakeModuleLoader`); `src/services/telemetry/**` contains no
`node:child_process`, no `node:fs`, no `homedir` — it is entirely port-injected. Locally
every one of these runs at 0ms except a single 180ms case.

**There is no work inside them to remove.** Something that takes 0ms here and 18–26s there
is not explained by anything in the test, and the honest report is that no mechanism was
found — not a guess dressed as one. Raising or lowering a budget for them would be
optimising against numbers the consumer themselves marked order-of-magnitude, from a
non-green branch where identical isolated repeats gave 25.7s and 77.8s.

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
- **2 are timeouts.** The third `flow-renderer` case still carries the single remaining
  spawn at ~26s against a 30s ceiling — roughly **1.15x headroom, still flake margin.**
  It is better than three cases at that margin, but it is not fixed, and it should not be
  reported as fixed.
- **The other 6 ceiling cases are untouched** and no mechanism for them was found.
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
