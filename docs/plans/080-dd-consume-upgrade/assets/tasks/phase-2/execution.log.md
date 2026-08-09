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

---

## tk-0008 — the promotion (keep-and-promote, BY COPY)

**Module**: `harness/cli/src/services/plan-semantics/` — the five plan modules
(`check`, `index-plan`, `model`, `ready`, `semantics`) plus the barrel, copied from the
fork, with every dd import re-pointed. `harness/cli/src/services/plan-semantics/dd-mechanisms/`
holds the enumerated temporary copies.

### Where each dd import went, and why

| fork import | promoted to | basis |
|---|---|---|
| `core/address` | `@ai-substrate/dd` (root barrel) | public |
| `core/model` | `@ai-substrate/dd/core/model` | public |
| `core/validate` | `@ai-substrate/dd/core/validate` | public |
| `core/walk` | `@ai-substrate/dd/core/walk` | public |
| `links/index`, `links/map`, `links/model` | `@ai-substrate/dd/links` | public (all three collapse to one subpath) |
| `schema/index` | `@ai-substrate/dd/schema` | public |
| `core/constants` | `./dd-mechanisms/constants.js` | **no public home**; vocabulary, builder-owned by ruling |
| `core/derive` | `./dd-mechanisms/derive.js` | **no public home** |
| `core/rel` | `./dd-mechanisms/rel.js` | **no public home** |
| `core/value` | `./dd-mechanisms/value.js` | **no public home** |
| `../../shared/posix-path` | `../shared/posix-path.js` | **not copied** — already harness-owned, outside the fence |

**Correction to the ledger's drift surface (worth a line, because it changes a trigger).**
The drift section enumerates five copied internals including `shared/posix-path`. The
promotion copies **four**: `posix-path` is harness's own module (`services/shared/`), not
inside `services/dd/**`, so the promoted module simply imports it. Trigger 1 ("re-run a
diff of the copied mechanism files against dd's sources at the new pin") should diff four
files, not five — a phantom fifth would produce a permanent, meaningless divergence.

### `deriveSchemaItems` was considered as a public route and rejected on evidence

`./schema` publicly exports `deriveSchemaItems`/`deriveSchemaState`, and dd's own docs say
both project the same collector as `deriveItems`. Under dw-000f ("copies no symbol that has
a public home") that looked like it might forbid the `core/derive` copy, so I checked the
signatures rather than the prose:

- they take a full `SchemaRecord` (`name`, `description`, `version`, `path`, `root`,
  `schema`); `buildPlanIndex` holds only a `ResolvedDdSchema`, so the provenance fields
  would have to be fabricated — a shim wearing a public import's clothes;
- they decide `terminal` from the SCHEMA's `gate_terminal`, while the plan layer must apply
  the terminal set carried by the ENTRY (`entry.terminal ?? DEFAULT_GATE_TERMINAL_STATES`).

So `deriveItems` genuinely has no public home, the copy stands, and the reasoning is
recorded at the declaration so a reviewer does not have to re-derive it. Only the collector
is copied — `deriveState`/`deriveRollup` are NOT, because nothing calls them and unused
copied surface widens the drift footprint for free.

### dw-000f is enforced by a test, not by a one-off grep

`test/architecture/plan-semantics-boundary.test.ts` (5 tests): the copies are confined to
`dd-mechanisms/` and that set equals the enumeration; the module reaches dd only through
public subpaths; **every copied origin is re-measured as unreachable against the INSTALLED
package with Node's own resolver**, so a copy stops being legitimate the moment dd publishes
the thing; provenance and the `6aaef35` sunset appear at each declaration; and the
vocabulary copy states it is sanctioned by ruling rather than tolerated as a gap.

Control-armed — I added a `parse.ts` copying `parseAddress` (which IS public):

```
AssertionError: expected [ 'constants.ts', 'derive.ts', …(3) ]
             to strictly equal [ 'constants.ts', 'derive.ts', …(2) ]
      Tests  1 failed | 4 passed (5)
```

Also hardened after that run: the enumeration and the origin map are now asserted to be in
lockstep, so a new copy cannot be added to one list and skip the reachability check in the
other.

### dw-000e — the fork is byte-untouched

```
$ git grep -nE "services/dd|acts/dd|node_modules|@ai-substrate/dd/dist" -- harness/cli/src/services/plan-semantics/
ZERO matches
$ git diff --quiet -- harness/cli/src/services/dd harness/cli/src/acts/dd
FENCE CLEAN: git diff empty over services/dd + acts/dd
$ npx vitest run test/architecture/dd-plan-semantics-frozen.test.ts
 ✓ 2 passed          # semantics.ts FROZEN_DIGEST intact
```

Re-verified after `just build`, which regenerates `services/dd/docs/docs-content.ts` — the
fence stayed clean, but that generator writes INSIDE the fence and is worth knowing about
before phase 3 treats a dirty fence as tampering.

---

## tk-0009 — the rewire, and the full-zero proof (dw-0010)

Two one-line import changes (`acts/plan/index.ts`, `acts/plan/pr-body.ts`), plus moving the
import block to keep biome's ordering happy.

```
$ git grep -nE "services/dd|acts/dd|\./dd/" -- harness/cli/src/acts/flow.ts \
    harness/cli/src/acts/plan/fence.ts harness/cli/src/acts/plan/index.ts \
    harness/cli/src/acts/plan/pr-body.ts
ZERO matches — full-zero proof holds
```

That is **ac-0002 in full**, superseding phase 1's bounded `bp-000f`.

### The falsifiers went green — which is the actual trial result

```
 ✓ #1 itemKey (2)   ✓ #2-#5 PlanDocument/Item/Edge/Index   ✓ #6/#7 readiness (3+1)
 ✓ #8 buildPlanIndex (a) rollup (b) non-builtin relation
 ✓ #9 readPlanCheck × 4 corpora   ✓ #9 live corpus: plan 080's own documents
```

The live-corpus test is the one that matters most: the promoted module and the fork produce
an **identical findings set and identical counts** on plan 080's real 541-item corpus. A
synthetic fixture cannot catch what only appears at that scale.

`realDeps` had to move from `require()` to static ESM imports: the package's `"."` export
declares only `types` and `import` conditions — **no `require`** — so a CJS require of the
barrel dies with `No exports main defined`. Worth knowing for any future consumer that is
not ESM.

### Full gate

```
$ npx tsc --noEmit -p harness/cli/tsconfig.json   → exit 0
$ just build                                       → exit 0
$ npx vitest run
 Test Files  351 passed (351)
      Tests  5180 passed (5180)
```

`just checks`: **tests ok, typecheck ok**, docs/flows/telemetry/doctrine/dd-docs/root-smoke/
dd-doctor/skills all ok; arch-check, markdown-lint, windows-check degraded (pre-existing
warn-launch). **biome fails on ONE pre-existing error in a file I never touched** —
`harness/cli/test/services/dd/schema/builder-rels.test.ts`, a pure line-length format
violation committed at `8e641add` (prime's dw-0154 rel guard). Verified pre-existing:
the file is unmodified in my working tree. My changed areas are clean; the 5 remaining
`noUnusedImports`/`noUnusedVariables` warnings in `acts/plan/index.ts` are also
pre-existing (identical at HEAD) and deliberately NOT fixed — that is dead code with an
owner, not my diff.

---

## tk-000b evidence — dogfood on the rewired build (dw-0014)

```
$ node harness/cli/bin/harness.js plan validate docs/plans/080-dd-consume-upgrade/plan.dd.json
status ok  counts {"error":0,"warn":0,"semantic":{"items":541,"completable":63,"open":45,
                    "contradictions":0,"orphans":8,"in_scope":541}}
$ node harness/cli/bin/harness.js flow rail --path .../the-flow.json     → status ok
$ node harness/cli/bin/harness.js flow orient --path .../the-flow.json   → renders; no gate
                                        ✕; due chores only (Observe: P2, Retro: P2)
```

All three return **ok** on the rewired build — and this time `plan validate` is genuinely
`ok`, not `degraded`, because prime's `satisfies_toward` convention cleared the
cross-phase contradictions. dw-0014's strict "all return ok" reading is satisfiable now,
so unlike phase 1's dw-0009 it needed no interpretation.

`dw-0015` stays unchecked: it is deliberately human-tier (ledger judgement, `bp-000c`).

---

## Per-primitive evidence table (input to tk-000a — koala rules, I supply evidence)

RED sha `45928d24` (falsifier suite authored, all 13 run RED against the absent subject).
Goldens sha `5f8cfa44`. Green sha `964640f8` (promotion + rewire).
Proof command for every row below:

```
npx vitest run test/integration/plan-semantics-falsifiers.int.test.ts     # 15 passed
npx vitest run test/architecture/plan-semantics-boundary.test.ts          #  5 passed
```

| # | primitive | falsifier (test id) | RED | result | candidate verdict |
|---|---|---|---|---|---|
| 1 | `itemKey` | #1 ×2 — native/POSIX collapse; agreement with public `indexDocument` + golden keys | `45928d24` | PASS | **sufficient** — public `./links` addressing agrees; algorithm-class as predicted |
| 2 | `PlanDocument` | #2-#5 — every field filled from public loader/resolver outputs | `45928d24` | PASS | **sufficient** (runtime half; type half enforced in `src/`, see note) |
| 3 | `PlanItem` | #2-#5 — 14 fields compared value-by-value against goldens | `45928d24` | PASS | **sufficient** |
| 4 | `PlanEdge` | #2-#5 + #8b — edge shape, resolved target, relation | `45928d24` | PASS | **sufficient** |
| 5 | `PlanIndex` | #2-#5 — items, edges, `byKey` | `45928d24` | PASS | **sufficient** |
| 6 | `ReadyReading` | #6/#7 ×3 — three distinct verdicts | `45928d24` | PASS | **sufficient** |
| 7 | `readPlanReadiness` | #6/#7 ×3 — ready / not-ready / cant-tell | `45928d24` | PASS | **sufficient** |
| 8 | `buildPlanIndex` | #8a rollup, #8b non-builtin relation | `45928d24` | PASS **only with copied mechanisms** | **insufficient on PUBLIC surface** — needs `core/derive` + `core/rel` + `core/constants`, all `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| 9 | `readPlanCheck` | #9 ×4 synthetic + live 541-item corpus | `45928d24` | PASS **only with copied mechanisms** | **insufficient on PUBLIC surface** — inherits #8 plus `effectiveRel` for `readPlanSemantics` |

### Two honesty notes the verdict must carry

1. **#1–#7 are sufficient on public surface; #8–#9 are not.** That split is exactly what
   `prediction.md` called, and it was called BEFORE the trial. The prediction's *framing*
   was still wrong in a way its own scoring rules could not catch — it asked whether the
   layer could be REBUILT from primitives and never considered that dd already shipped the
   finished layer unexported, which recon found in the first ten minutes. Superseded by
   Jordan's ruling, and stated rather than reworded (hard rule 6).
2. **"PASS" for #8/#9 means the promoted module reproduces the fork exactly, not that the
   public surface sufficed.** The mechanisms are the four enumerated copies. Reading those
   rows as SUFFICIENT would be the one misreading this table exists to prevent.

The type half of #2–#5 ("strict `tsc` against package types") is enforced by the promoted
module living in `src/` and being consumed by `acts/plan/*` — both inside the only
typechecked project. It is NOT enforced by the test file: no test in this repo is
typechecked (`tsconfig` `include: ["src"]`; `harness checks` typechecks exactly that).
Recorded as `harness observe` DL-003.

---

## Fixes round — terra REJECT on the round-3 trial (2026-08-09)

Review: `assets/tasks/phase-2/reviews/review.round-3-trial.md` (0C/1H/0M/1L).
F001 (dd-doc state) was koala's and landed at `622f0840`. Two items were mine, in one
commit.

### FT-002 / F002 (HIGH) — `forkReadPlanReadiness` used but never imported

`plan-semantics-falsifiers.int.test.ts:99` declared `readPlanReadiness: typeof
forkReadPlanReadiness` on the `Subject` interface, but no import ever bound that name.

**This is DL-003 biting for real, not a typo.** The last paragraph of the section above,
written before the review, says no test in this repo is typechecked (`tsconfig` has
`include: ["src"]`). F002 is the first measured consequence: an undefined type-query
identifier in a test file is invisible to every gate the repo runs. `just test` was green
with the bug present, and stayed green after the fix — 5180/5180 both sides. **The suite
cannot see this class of defect at all**, so "tests pass" is not evidence here and the
fix needed a different instrument.

Fix (the review's second option — a valid type import; also what biome independently
demanded, see below):

```
  itemKey as forkItemKey,
  readPlanCheck as forkReadPlanCheck,
+ type readPlanReadiness as forkReadPlanReadiness,
} from '../../src/services/dd/plan/index.js';
```

`type` on the specifier is correct and deliberate: the name appears ONLY in a `typeof`
type query, never at runtime, and TypeScript permits type-query use of a type-only
binding. The first attempt used a plain value import; biome rejected it
(`Checked 2 files … Found 1 warning`, pointing at the missing `type` modifier), which is
the linter arriving at the review's own alternative. The sibling `readPlanCheck` above it
stays a VALUE import because it is called at line 388 — the two are not interchangeable.

**Proof — an ad-hoc typecheck that actually covers the file**, since `npx tsc --noEmit`
does not (it typechecks `src` only, and returned `exit 0` with the bug present — recorded
here precisely because the required gate is silent on the required finding):

```
$ cat > harness/cli/tsconfig.f002-probe.json <<'EOF'
{ "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": ".", "types": ["node"] },
  "include": ["test/integration/plan-semantics-falsifiers.int.test.ts"] }
EOF
$ npx tsc -p tsconfig.f002-probe.json
probe_exit=0
```

Green alone proves nothing — an instrument that cannot fail is not a measurement. So the
probe was run against a NEGATIVE CONTROL: delete the one added line, re-run, and confirm
it reproduces the reviewer's finding at the reviewer's line, verbatim:

```
$ sed -i '' '/type readPlanReadiness as forkReadPlanReadiness,/d' \
    test/integration/plan-semantics-falsifiers.int.test.ts
$ npx tsc -p tsconfig.f002-probe.json
test/integration/plan-semantics-falsifiers.int.test.ts:99:29 - error TS2304: Cannot find name 'forkReadPlanReadiness'.

99   readPlanReadiness: typeof forkReadPlanReadiness;
                               ~~~~~~~~~~~~~~~~~~~~~
```

RED without the fix at 99:29, GREEN with it. That pair is the evidence; the passing suite
is not.

The probe config was NOT committed — it is a one-file instrument, and a committed
half-measure covering one test file would read as coverage the repo does not have. The
recipe is recorded above verbatim so it is reproducible, and the general fix (bring
`test/**` into a typechecked project) stays where it belongs: DL-003 in the observation
buffer for the phase-2 drain, sharpened by this incident from "a gap" to "a gap that has
now shipped one HIGH finding".

### RIDER (LOW, from prime) — `acts/flow.ts:236-241` doc comment overpromises rollback

Packet: `s065-deterministic-documents/scratch/dd-080-acts-flow-236-rider.md`.
Comment-only, applied as the exact old/new text in the packet, verified against the live
text before replacing (the "source untouched" clause was present as quoted).

The claim being corrected: `persistSibling`'s comment asserted failure leaves "the source
untouched", which holds only on the SUCCESSFUL-rollback branch. `refuse()` verifies the
restore and can return false; that path still emits E302 but with a `next_action` warning
that the source may be out of step. New text says the rollback is "attempted and
VERIFIED, not guaranteed" and tells callers to read `next_action` rather than switch on
the code alone. No behaviour change; no doc regen (not a bundled doc — confirmed by
`just build` leaving the tree clean apart from the two edited files).

### Gates (final state, both changes in tree)

```
$ npx tsc --noEmit                    → tsc_exit=0
$ just build                          → build_exit=0
$ just test                           → Test Files 351 passed (351)
                                        Tests     5180 passed (5180)
$ npx biome check <both changed files> → Checked 2 files in 18ms. No fixes applied.
$ git status --short                  → only the two intended files (+ untracked reviews/)
```

Test count unchanged at 5180 on both sides of the fix, as expected and as noted above:
neither change is behavioural.

### Correction to the line above — my `just checks` claim was STALE, not merely wrong

The paragraph originally ended by saying `just checks` still carried a pre-existing biome
format error in `test/services/dd/schema/builder-rels.test.ts`. **That was false at head
and I should not have written it.** koala had already fixed it at `294a545b`, which is an
ANCESTOR of my own fixes commit — so the tree I was reporting on had the fix in it the
whole time. Verified rather than accepted on his say-so:

```
$ git merge-base --is-ancestor 294a545b 4fe34c81   → YES ancestor
$ npx biome check harness/cli/test/services/dd/schema/builder-rels.test.ts
Checked 1 file in 4ms. No fixes applied.
$ npx biome ci .
Checked 669 files in 330ms. No fixes applied.
Found 9 warnings. Found 4 infos.        biome_ci_exit=0
```

True status of the composite gate at `4fe34c81`:

```
$ just checks   → checks_exit=0
tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok
check:telemetry-fixtures:ok check:doctrine-parity:ok check:dd-docs:ok
root-invocation-smoke:ok arch-check:degraded dd doctor:ok skills-check:ok
markdown-lint:degraded windows-check:degraded
```

Every BLOCKING gate is green. The three `degraded` are warn-launch and non-blocking, and
none of them are mine — checked, not assumed: `arch-check`'s 2 warnings are both
`services-ports-type-only` in `services/telemetry/{ref-source,sync-service}.ts`;
`markdown-lint`'s 211 findings do not include this log or any phase-2 file;
`windows-check`'s 6 are in `.harness/extensions/html-snap` and friends.

> **Annotation appended 2026-08-09, after phase-2 approval** (additive only — no figure
> above was altered). The `211` was measured **pre-`6a43fd4d`**, against a markdown-lint
> gate with **three** checks. PR #146 added a fourth, `unexamined`, which reports in-scope
> **untracked** markdown — files the other three never received, because their file list
> comes from `git ls-files`. **The total above will not reproduce after a rebase onto main,
> and that delta is not a regression**: it is the new check counting documents nobody had
> linted. The claim this figure supports — that none of the findings are phase-2's — is
> unaffected and still holds. Recorded here so a future reviewer of this commit reads the
> number with the gate it was taken against, rather than reconstructing it without context.
>
> **Second annotation, same day, correcting the one above.** "The claim this figure
> supports is unaffected" is true, but it is true for a reason the sentence above the
> annotation does not give, and the difference matters. `docs/plans/**` is in `IGNORE_GLOBS`
> in `.harness/extensions/markdown-lint/lib/scope.ts:33`, and **ignore beats include**
> (`inScope()`, `scope.ts:95`). This log — and every plan asset, brief, checklist and
> `the-flow` file — is **out of the gate's scope entirely**. So "`markdown-lint`'s 211
> findings do not include this log or any phase-2 file" was never a *result*; it was
> **guaranteed by the scope**, and would have read identically had the file been full of
> violations. Verified by running the real predicate with a positive control rather than by
> reading the globs:
>
> ```
> IN-SCOPE  docs/how/consuming-dd.md
> IN-SCOPE  AGENTS.md
> IGNORED   docs/plans/080-dd-consume-upgrade/assets/tasks/phase-2/execution.log.md
> IGNORED   docs/plans/080-dd-consume-upgrade/assets/tasks/phase-3/context.md
> IGNORED   docs/plans/080-dd-consume-upgrade/the-flow.md
> ```
>
> The two in-scope lines are the control: the predicate does say yes to something, so the
> IGNORED verdicts are a filter and not a broken probe. **I wrote the annotation above to
> explain one way this number could mislead, and did not notice the sentence it annotates
> was already vacuous for a different reason** — which is the fourth instance of this class
> in a day and the sharpest, because it happened *inside the correction*. It also names the
> general rule better than my earlier wording did: publishing a denominator is necessary and
> not sufficient — **the denominator has to be the population the claim covers**, or it is a
> more confident way of being wrong. Phase 3's figures do not inherit this defect: that
> phase touched `AGENTS.md` and `docs/how/consuming-dd.md`, both genuinely in scope.

**The failure mode worth keeping.** The biome red was a REAL observation — when I first
made it. I then carried it forward across several commits and restated it as current fact
in both the log and a report, without re-running the command. It is the same defect class
as the one this very phase already found twice: a hand-carried count going stale the
moment someone else's work lands (ledger entry 4's contradiction count, F001). The rule
that would have caught all three is one rule: **if a claim names a measurable, re-measure
it at the moment of the claim, or attribute it to the run that produced it.** Applied
here retroactively — the stale line is corrected, and the replacement cites the commands
above, run at `4fe34c81`.
