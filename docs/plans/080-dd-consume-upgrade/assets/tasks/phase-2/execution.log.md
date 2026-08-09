# Phase-2 execution log — Round-3 trial: plan semantics on public primitives

**Seat**: `pij-grotesque-diziet` (coder) · **Branch**: `s080/dd-consume-upgrade`
**Pin under trial**: `a37a20ecf12342275a9d81b4cf8835302de8e9e0` (dd `s002/sdk-build`)
**Prediction (pre-committed, `51558dbc`)**: [prediction.md](./prediction.md)

Every surface claim below is measured against the **INSTALLED**
`node_modules/@ai-substrate/dd/**` at the pin, never against memory or dd's working tree
(context.md tripwire 4).

---

## Recon (before any test or implementation) — a finding that reframes OQ-2

### What I expected to find, and did not

The prediction sizes OQ-2 as *"can harness re-implement plan semantics from dd's public
primitives"*, and leans **insufficient** on `#5 buildPlanIndex` / `#6 readPlanCheck`
because `core/derive`, `core/rel` and `core/constants` are not public.

The non-public part of that lean is **confirmed** (measured below). But the framing has a
larger hole in it: **dd already ships the entire plan-semantics layer, compiled, inside the
installed package — it is simply not exported.**

### Evidence 1 — the pack contains a complete `dist/plan/**`

```
$ ls node_modules/@ai-substrate/dd/dist/plan/
check.d.ts  index-plan.d.ts  index.d.ts  model.d.ts  ready.d.ts  semantics.d.ts   (+ .js/.js.map each)

$ ls harness/cli/src/services/dd/plan/
check.ts    index-plan.ts   index.ts    model.ts    ready.ts    semantics.ts
```

A 1:1 file correspondence with the fork tree this phase exists to retire.

### Evidence 2 — the shipped barrel exports all nine in-scope symbols

`node_modules/@ai-substrate/dd/dist/plan/index.d.ts` and the fork's
`services/dd/plan/index.ts` carry the **same barrel**, doc comment included. Per-module
exported-symbol-set comparison (source vs shipped `.d.ts`):

| module | result |
|---|---|
| `check` | symbol sets **IDENTICAL** (13 symbols) |
| `index-plan` | one fork-only symbol: `displayAddress` |
| `model` | symbol sets **IDENTICAL** (7 symbols) |
| `ready` | symbol sets **IDENTICAL** (11 symbols) |
| `semantics` | symbol sets **IDENTICAL** (2 symbols) |

All nine symbols the two consumers actually import are present upstream:
`buildPlanIndex`, `itemKey`, `PlanDocument`, `ReadyReading`, `readPlanCheck`,
`readPlanReadiness` (`acts/plan/index.ts:41-48`) and `PlanEdge`, `PlanIndex`, `PlanItem`
(`acts/plan/pr-body.ts:2`). `displayAddress` is fork-only and **not** consumer-facing, so
it is not part of this phase's surface.

### Evidence 3 — none of it is reachable (negative control, Node's own resolver)

Resolved through `createRequire`, which consults the package `exports` map with no bundler
in the way (the phase-1 lesson: a literal `import()` specifier is resolved by Vite at
transform time and cannot serve as a negative control):

```
BLOCKED  @ai-substrate/dd/plan               -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/plan/index         -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/dist/plan/index.js -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/core/constants     -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/core/derive        -> ERR_PACKAGE_PATH_NOT_EXPORTED
BLOCKED  @ai-substrate/dd/core/rel           -> ERR_PACKAGE_PATH_NOT_EXPORTED
```

The `exports` map has 13 subpaths and **no wildcard**, so the deep-dist path is closed too.
The root barrel is deliberately empty of plan symbols — `dist/lib.d.ts` documents itself as
"a curated allowlist, not a re-export of whatever happens to be public", and directs
domain symbols to their subpath: *"A symbol that is merely useful goes to its domain
subpath (`./core/*`, `./links`, `./schema`, `./render/*`, `./node`)"*.

```
$ grep -nE "buildPlanIndex|readPlanCheck|itemKey|PlanIndex|readPlanSemantics" dist/lib.d.ts
NONE - barrel carries zero plan symbols
```

### What this means for the prediction (stated plainly, per hard rule 6)

- The prediction's **non-public claim is CONFIRMED**: `core/constants`, `core/derive`,
  `core/rel` are all `ERR_PACKAGE_PATH_NOT_EXPORTED` at this pin. Its `#5`/`#6` lean is
  measured-correct on the question as asked.
- The prediction's **framing is incomplete, not wrong**: it asks whether the semantics can
  be *rebuilt* from primitives, and never considers that dd might already *have* the
  finished layer sitting unexported in the pack. It does. So the cheapest true answer to
  OQ-2 may not be "dd exports three internals so harness can rebuild the layer" but
  "dd exports the layer it already ships".
- This does **not** pre-empt the trial. Symbol-set equality is **not** behavioural
  equality, and hard rule 5 sets the bar at an equal findings set on the same input. The
  tk-0007 falsifiers remain exactly the right instrument and are being authored regardless
  — they are what would catch a `dist/plan` that exports the right names and behaves
  differently.

### Routing (per hard rule 3 / the dispatch's STOP instruction)

`tk-0008` as written ("re-implement ... on PUBLIC primitives only") cannot start: every
route into the semantic core is a non-public surface, and the alternative — re-declaring
`BUILTIN_RELS` / `CLAIMING_RELS` / the terminal-state and completion-state lists
harness-side — is the pre-committed **INSUFFICIENT** call and a D-3 block, never a shim.

Reported to koala at recon time rather than at phase end, because the re-pin loop is fast
and the gap is on the critical path. `tk-0007` continues in parallel, unblocked.

---

## tk-0007 — falsifier suite authored and run RED (dw-000c evidence)

**File**: `harness/cli/test/integration/plan-semantics-falsifiers.int.test.ts`
**Subject (absent by design)**: `harness/cli/src/services/plan-semantics/index.ts` — the
module tk-0008 will create. Its ABSENCE is the sanctioned RED control for dw-000c.

### Coverage: all NINE primitives, 13 falsifier tests

| # | primitive | falsifier | test |
|---|---|---|---|
| 1 | `itemKey` | native-separator vs POSIX spelling collapse to one key; key agrees with public `indexDocument` addressing | 2 |
| 2-5 | `PlanDocument`, `PlanItem`, `PlanEdge`, `PlanIndex` | every field of every item/edge filled from the same public inputs, compared field-by-field against the fork | 1 |
| 6-7 | `ReadyReading`, `readPlanReadiness` | three fixtures producing three DISTINCT verdicts: ready / not-ready / cant-tell | 3 |
| 8 | `buildPlanIndex` | (a) derived rollup state for a stateless container; (b) non-builtin `satisfies-toward` behaves as the fork's, with no local vocabulary | 2 |
| 9 | `readPlanCheck` | findings-set + counts equality on 4 synthetic corpora **and** on plan 080's own documents | 5 |

### The RED run (subject absent) — verbatim

```
$ npx vitest run test/integration/plan-semantics-falsifiers.int.test.ts
 × #1 itemKey > collapses a native-separator spelling and a POSIX spelling to one key
 × #1 itemKey > agrees with the public indexDocument addressing for every indexed node
 × #2/#3/#4/#5 > fills every PlanItem and PlanEdge field from the same public inputs as the fork
 × #6/#7 > reproduces the fork verdict: ready
 × #6/#7 > reproduces the fork verdict: not-ready (unclaimed criterion)
 × #6/#7 > reproduces the fork verdict: cant-tell (survey unreadable)
 × #8 buildPlanIndex > (a) reproduces derived rollup state for a container with no state of its own
 × #8 buildPlanIndex > (b) treats a non-builtin relation exactly as the fork does, without a local vocabulary
 × #9 readPlanCheck > findings set equal to the fork: constructed contradiction (checked task, open criterion)
 × #9 readPlanCheck > findings set equal to the fork: non-builtin relation makes NO contradiction
 × #9 readPlanCheck > findings set equal to the fork: orphan-claim under --complete
 × #9 readPlanCheck > findings set equal to the fork: rollup corpus, per-row accounting
 × #9 readPlanCheck > agrees with the fork on plan 080 own documents
 ✓ the subject module > is absent until tk-0008 lands, and tk-0008 is blocked on the dd export gap

 Test Files  1 failed (1)
      Tests  13 failed | 1 passed (14)
```

### A RED that cannot go green is not a control — so I proved it can

A suite that fails because of a typo fails identically to one that fails for the reason
you claim. I stubbed the subject module deliberately WRONG (an `itemKey` that skips
`toPosix`, empty `buildPlanIndex`/`readPlanCheck` returns), re-ran, and confirmed every
falsifier then failed on **behaviour** rather than on absence:

```
AssertionError: expected 'C:\repo\docs\p.dd.json#tasks/tk-0001'
             to be 'C:/repo/docs/p.dd.json#tasks/tk-0001'      # A2 caught by #1
AssertionError: expected [] to strictly equal [ { …(14) }, { …(14) }, …(10) ]   # #2-#5
AssertionError: expected 'ready' to be 'not-ready'                              # #6/#7
AssertionError: no rollup item at …/plan.dd.json#: expected undefined to be defined  # #8a
AssertionError: expected [] to strictly equal [ Array(1) ]                      # #9
```

The stub was then deleted (`rm -rf harness/cli/src/services/plan-semantics`); the tree
carries no subject module.

### Two traps found while building it, both fixed rather than worked around

1. **Fixture shape.** `DdDoc.sections` is `DdSection[]` (`{name,title?,value}`), not a
   record. My first fixtures were record-shaped and the ORACLE crashed
   (`doc.sections.map is not a function`) — the falsifiers would have "failed" for a
   reason having nothing to do with the trial.
2. **Vacuous oracle.** After that fix the oracle returned `error: 1, semantic: null` —
   `link value must be a string`, because the schema declares `type: 'link'` and I passed
   an array. The semantic read never ran, so the contradiction falsifier was comparing two
   EMPTY finding sets and would have passed against almost anything.

Both were caught only by reading the oracle's actual output rather than its pass/fail. So
the fixtures are now **pinned against vacuity**, permanently:

- each `readPlanCheck` scenario asserts the finding classes the ORACLE must produce
  (`['contradiction']`, `[]`, `['open-completable','open-completable','orphan-claim']`,
  `['open-completable','orphan-claim']`) before comparing the subject to it;
- each readiness scenario pins the oracle's `{verdict, reason, decided_by}` triple;
- `#8a` asserts the oracle found at least one `derived` item.

The strongest of these is the **control pair**: scenarios 1 and 2 are the SAME document
with only the relation changed (`satisfies` → `satisfies-toward`), and the contradiction
appears in one and not the other. That is what makes the vocabulary question testable at
all — a subject carrying a hand-copied `BUILTIN_RELS` cannot track a relation added after
the copy was made, and fails exactly there.

### Bound on what a test can prove here (honesty note for the verdict)

The prediction's #2/#3 falsifiers are stated as *"strict `tsc` of the re-declared type
against package types"*. **In this repo a test file cannot carry that claim**: the only
tsconfig is `harness/cli/tsconfig.json` with `include: ["src"]`, and `harness checks`
typechecks exactly that project (`.harness/extensions/checks/extension.ts:153`); vitest
transpiles tests without typechecking. So a type-level assertion written in a test is
INERT — it can never fail.

This is not fatal to #2/#3 and does not make them UNPROVEN, but it relocates the proof and
that must be stated: the type half is enforced when the subject module lands in `src/`
(tk-0008) and `acts/plan/*` consumes it (tk-0009) — both inside the typechecked project.
The test file's contribution to #2/#3 is the RUNTIME half (every field filled, compared
field-by-field). Recorded as `harness observe` DL-003, because untypechecked tests are a
harness-wide property, not a plan-080 one.

### State

`dw-000c` is earned (all nine have a runnable falsifier, each run RED, per-primitive
output above; commit order is the proof). **`dw-000d` is NOT earned and stays unchecked**:
it wants `just build && just test` green with the suite in the tree, and the suite is red
by design until tk-0008 — which is D-3 blocked. `tsc --noEmit -p harness/cli/tsconfig.json`
exits 0 and biome is clean on the new file.

---

## Goldens — captured from the fork while it is still alive (koala's precondition)

**Why this exists.** Under the ratified reshape (dd keeps mechanisms, consumers bring
vocabulary — dd governance `d8950eb`) the plan layer becomes harness-owned, most likely by
promoting *this very fork*. At that instant my falsifier suite's subject and oracle are the
same code: every comparison passes trivially and the suite is blind to any bug the two
share. Phase 3 then deletes the fork and the oracle disappears entirely. So the suite
degrades from independent pin to move-refactor net **unless the goldens exist first** —
which is why koala cut them as a PRECONDITION of the reshape rather than a follow-up.

**Files**

| file | role |
|---|---|
| `test/integration/fixtures/plan-semantics-corpora.ts` | the corpora, shared by generator and suite so neither can drift and silently re-baseline the other |
| `test/integration/fixtures/plan-semantics-goldens.json` | 39 KB of recorded fork behaviour: findings, counts, full item shapes, edges, readiness triples |
| `test/integration/plan-semantics-goldens.gen.test.ts` | the capture — a TEST, so it re-verifies the goldens against the fork on every run; `GOLDEN_UPDATE=1` rewrites them |

Regeneration is deliberately an explicit act with a reviewable diff, never a side effect of
a passing run:

```
$ GOLDEN_UPDATE=1 npx vitest run test/integration/plan-semantics-goldens.gen.test.ts
 ✓ test/integration/plan-semantics-goldens.gen.test.ts (2 tests)
```

**What got recorded** (all non-vacuous — asserted, not hoped):

```
check.contradiction  findings 1  {"items":12,"completable":2,"open":1,"contradictions":1,"orphans":0}
check.nonBuiltinRel  findings 0  {"items":12,"completable":2,"open":1,"contradictions":0,"orphans":1}
check.orphan         findings 3  {"items":11,"completable":2,"open":2,"contradictions":0,"orphans":1}
check.rollup         findings 2  {"items":18,"completable":4,"open":1,"contradictions":0,"orphans":1}
index.contradiction  items 12  edges 1 (satisfies       → RESOLVED)  derived 3
index.nonBuiltinRel  items 12  edges 1 (satisfies-toward → RESOLVED)  derived 3
readiness.ready/notReady/cantTell = ready / not-ready / cant-tell   (three DISTINCT verdicts)
```

### A third vacuity trap, caught the same way as the first two

The first capture recorded **`edges 0` on every corpus**. The `check` half looked perfect —
the contradiction was there — because `readPlanCheck` builds its own edges internally. But
my `edgesFor` helper seeded `traverseCorpus` with a single path string plus a `depth`,
where the production call in `check.ts` passes an **array** of seeds with
`mode: 'direct', follow: false`. Wrong seed shape ⇒ zero edges ⇒ silently.

Had that shipped, every edge assertion in falsifiers #2–#5 and #8b would have been an
empty-set-versus-empty-set comparison — the exact failure I had already caught once in this
phase on the contradiction falsifier. Same class, third occurrence, and again it was
visible only by reading the captured VALUES rather than the pass/fail.

It is now pinned so it cannot come back:

```ts
expect(index.contradiction.edges.map((e) => e.rel)).toStrictEqual(['satisfies']);
expect(index.nonBuiltinRel.edges.map((e) => e.rel)).toStrictEqual(['satisfies-toward']);
expect(index[name].edges[0]?.to, `${name} edge must RESOLVE to an item`).not.toBeNull();
```

That pair is the sharpest thing in the suite: the **same document**, differing only in the
relation, resolving an edge either way — but producing a contradiction under `satisfies`
and none under `satisfies-toward`. A subject carrying a hand-copied `BUILTIN_RELS` cannot
track a relation added after the copy, and fails exactly there.

### The suite now measures against the goldens, not against a live fork

Re-ran the wrong-stub control against the NEW bar to prove the goldens catch a bad subject
on their own:

```
AssertionError: expected 'C:\repo\docs\p.dd.json#tasks/tk-0001' to be 'C:/repo/…'   # #1
AssertionError: expected { verdict: 'ready', …(2) } to strictly equal { verdict: 'not-ready', …(2) }
AssertionError: expected { verdict: 'ready', …(2) } to strictly equal { verdict: 'cant-tell', …(2) }
AssertionError: expected [] to strictly equal [ { …(14) }, { …(14) }, …(10) ]        # #2-#5
AssertionError: expected [] to strictly equal [ { …(4) } ]                          # #8a
      Tests  13 failed | 2 passed (15)
```

Two tests are always green by design and are structural guards, not falsifiers: *"the three
goldens are three DIFFERENT verdicts, or this suite pins nothing"* and *"the subject module
is absent"*.

**One deliberate exception.** The live-corpus test (plan 080's own documents) keeps the
fork as its oracle and gets NO literal golden: those documents change every time a task
closes, so a pinned findings set would churn and train everyone to re-baseline it. It
asserts non-vacuity instead (`items > 100`), and at fork deletion it converts to structural
invariants rather than literals. Recorded here so phase 3 does not discover it by surprise.

### Full-suite state

```
$ npx tsc --noEmit -p harness/cli/tsconfig.json      → exit 0
$ npx vitest run
 Test Files  1 failed | 349 passed (350)
      Tests  13 failed | 5152 passed (5165)
```

The ONLY red is the 13 deliberate falsifiers. Blast radius is clean: no existing test
changed behaviour. `dw-000d` stays unchecked per koala's ruling — it wants a green suite,
and the suite is red by design while the reshape is parked.
