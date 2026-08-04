# Phase 3: Render, adapters & freshness — Execution Log

**Plan**: [deterministic-documents-plan.md](../../deterministic-documents-plan.md) § Phase 3
**Tasks**: [tasks.md](./tasks.md) (T001–T007)
**Freeze basis**: [dd-surface.md](../phase-1-dd-core-foundations/dd-surface.md) — one body only (`dd build <path> [--check] [--json]`); no signature, option, or E-code change.
**Runs in parallel with Phase 4** in this same worktree — every commit via `git commit --only <pathspec>` (§ Shared-surface custody).

---

## Fence amendment 1 (PM grant, 2026-08-03) — `.dependency-cruiser.cjs`

T002's Done-When requires renderer purity to be **machine-enforced** by "the existing
depcruise/arch-test pattern", and the phase proof line reads "arch-check baseline 2 incl. your
new renderer-purity rule". The three `dd-core-never-imports-*` rules live in root
`.dependency-cruiser.cjs`, which is a **P1-owned file outside the P3 fence**, so the edit was
requested before it was made rather than taken.

**Granted (option A)** with three riders:

1. `.dependency-cruiser.cjs` is a **custody-window file** like `test/acts/dd.test.ts` — request
   the window from the PM, append-only, exactly the three mirrored `dd-render-*` rules, commit
   via `--only` inside the window. P4 holds a mirror grant for its own graph-purity rule.
2. The in-fence `renderer-purity.test.ts` is **required alongside** the depcruise rule, not
   instead of it (arch rule + test is the P1 pattern).
3. **Proof-line rider (prime, amendment 4)**: run `harness arch-check` BEFORE and AFTER the
   append, record both counts here, and say so explicitly in the done-report if the count
   moves off the standing baseline of 2.

`arch-check` **BEFORE** (`node harness/cli/bin/harness.js arch-check --json`, before any P3 edit):

```
status=degraded  modules=233  dependencies=497  violations=2
  services/telemetry/ref-source.ts  -> adapters/git/git-write-port.ts   (services-ports-type-only)
  services/telemetry/sync-service.ts -> adapters/git/git-write-port.ts  (services-ports-type-only)
```

Baseline **2**, as documented. The AFTER count is recorded under T002.

---

## T006 — Leaf rulings

The three leaf decisions this phase's consumers need before they land. Each is the coder's to
make, constrained by the freeze and the workshops; recorded here with a one-line rationale in
the P1/P2 T00x style.

### (a) E42x allocation within the frozen block

P1 froze the ten names `E420–E429`; this phase decides only **which failure maps to which**, and
adds none. Adapter failures split by *where the pipeline gave up*, so an agent reading a code
knows which artifact to open:

| Code | Name | This phase raises it when |
|---|---|---|
| `E420` | `DD_RENDER_FAILED` | the renderer itself could not produce markdown |
| `E421` | `DD_RENDER_WRITE_FAILED` | the sibling `.dd.md` write failed |
| `E422` | `DD_RENDER_DRIFT` | `build --check` found the sibling differs byte-for-byte (incl. absent) |
| `E423` | `DD_ADAPTER_NOT_FOUND` | a declared custom type has **no** `adapters/<type>.ts` file |
| `E424` | `DD_ADAPTER_LOAD_FAILED` | the module threw while evaluating, **or** loaded but its default export is not callable — in both cases nothing usable was ever obtained |
| `E425` | `DD_ADAPTER_RUNTIME_FAILED` | a loaded, callable adapter threw when invoked |
| `E426` | `DD_ADAPTER_OUTPUT_INVALID` | the adapter returned a non-string |
| `E427` | `DD_LIVE_BASIS_REFRESH_FAILED` | a `live` ledger entry could not be recomputed |
| `E428` | `DD_WATCH_FAILED` | the injected watcher subscription or its regeneration failed |
| `E429` | `DD_BUILD_INPUT_INVALID` | the build input is unreadable, unparseable, or not a dd document |

Rationale: the wrong-signature case is `E424` rather than `E426`, because "output invalid" must
keep meaning *the adapter ran and returned the wrong thing* — a non-callable export never ran.

### (b) `dd build` / `--check` exit mapping

The envelope status **is** the severity (KF-05: `runVerbGate` has no severity parameter), so the
mapping is chosen so a green CI run means "the committed markdown is the markdown this
`.dd.json` produces", and a degraded run means "it is, but the render is honestly degraded".

| Case | Status | Exit |
|---|---|---|
| `build` wrote the sibling, no adapter issues | `ok` | 0 |
| `build` wrote the sibling, ≥1 adapter issue | `degraded` | 0 |
| `build --check`, sibling matches byte-for-byte, no adapter issues | `ok` | 0 |
| `build --check`, sibling matches, ≥1 adapter issue | `degraded` | 0 |
| `build --check`, sibling differs or is absent | `error` `E422` | 1 |
| input missing / unparseable / not a dd document | `error` `E429` | 1 |
| schema unresolvable | `error` `E401` | 1 |
| sibling write failed | `error` `E421` | 1 |

Rationale: a degraded render is **loud but not fatal** (workshop-003 W1 rule 5 — call out every
adapter issue, never crash, never blank), while drift **is** fatal, because the drift gate exists
precisely to fail CI. `--check` never writes, mirroring `harness flow render --check` (F-05).

### (c) Golden-file update procedure

**Hand-edit the golden first, then make the renderer match.** No `--update-goldens` switch ships,
and none should: a regeneration flag silently converts a spec into a snapshot of whatever ran,
which is the exact failure mode T001 was written to prevent. `dd build --check --json` is the
inspection path (it never writes), and the procedure is documented for the next agent in
`test/services/dd/render/fixtures/README.md` § Updating a golden. `drift.dd.md` is exempt in the
other direction: it must **stay** hand-edited, or the drift subject evaporates.

---

## T001 — Golden/fixture corpus (TDD floor)

**Status**: complete. `harness/cli/test/services/dd/render/fixtures/**` + an enumeration test.

Every fixture is a real repo shape (`<case>/repo/.dd/schemas/<pkg>/<schema>/schema.json` +
`<case>/repo/docs/*.dd.json`), so the P2 convention resolver discovers schemas here exactly as in
a consumer repo, and the whole tree sits under the `test/**/fixtures/**` sweep exclusion so
`harness checks` stays green with the corpus committed (AC-15).

Five cases: `showcase` (every render feature in one document), `adapters` (one field per failure
class), `drift` (the hand-edited sibling), `chain` (transclusion for T005), `limits` (the
DL-006 subject). The fixture → feature/failure map is the README table, and
`fixture-corpus.test.ts` asserts the map stays honest: every `.dd.json` has a golden sibling,
every adapter class has its fixture and its frozen code, the drift subject still differs from the
correct render, and no regeneration switch exists.

**Golden provenance — per file, not blanket** (corrected under review F001; the original entry
here claimed *every* `.dd.md` was written before the renderer, which P3's own history contradicts).
The property that makes a golden a TDD floor is that it was authored from the spec with nothing to
copy from. That is fully true of seven files, partly true of one column, and **not true at all** of
one later file:

| Golden | Authored | Independence basis |
|---|---|---|
| `showcase.dd.md`, `adapters.dd.md`, `chain/source.dd.md`, `chain/consumer.dd.md`, `drift.dd.md`, `drift.expected.md`, `limits.dd.md` | `d865563c` — before any renderer source existed | **Full.** Written from the workshop rulings; there was no implementation to copy. These are the files that caught D1–D3 below. |
| `showcase.dd.md` — the `proven_by` column only | `44dc52db` — the same commit as the renderer | **Partial.** The column and its `.dd.json` input were added by hand from workshop-002 Ruling 3 to give the undeclared-address case a subject, and the renderer then *failed* it (D3). Commit-level history cannot order a fixture edit against a source edit inside one commit, so that ordering rests on the session record, not on git. |
| `showcase/repo/docs/other.dd.md` | `3f84f7fb` — during T005 | **None. This is a support fixture, not a golden.** It exists so the showcase's live reference resolves; before it, the corpus carried a dangling reference and the showcase build was spuriously `degraded`. It was written with the renderer's output shape already in hand, so it proves nothing *about* the renderer. Its only guarantee is self-consistency: `dd build --check` renders it drift-free (`dd-build.test.ts` — "renders every committed golden in the corpus without drift"). |

Where a renderer and a golden disagree, the disagreement is adjudicated here — never silently
overwritten. The T002 adjudications are recorded in full below.

**Invented limit (DL-006 compliance)**: the renderer needs exactly one bound —
`MAX_CELL_DEPTH`, how deep a nested container renders inside a table cell before collapsing to
`⟨…⟩`. It ships as a named exported constant with a ruling note, and `limits.dd.json` carries a
row that sits **at** the bound and a row that **crosses** it.

**Evidence**

```
$ cd harness/cli && npx vitest run test/services/dd/render
 ✓ test/services/dd/render/fixture-corpus.test.ts (5 tests) 4ms
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

---

## T002 — Pure renderer

**Status**: complete. `src/services/dd/render/{contract,renderer}.ts` + `renderer.test.ts` +
`renderer-purity.test.ts`.

`renderDd(doc, resolved) => string` exactly as the plan specified — the frozen-ish signature is
kept literally, and adapter *issues* travel on the injected `DdAdapterSet` rather than widening
the return, so the function stays a plain `(inputs) => markdown`.

**Machine-enforced purity** (fence amendment 1): three depcruise rules mirroring the dd-core trio
(`dd-render-never-imports-{output,acts,node-adapters}`, `reachable: true`, severity warn) plus the
in-fence transitive scan in `renderer-purity.test.ts`, which also asserts those three rules exist
and are reachable — so deleting the rule reddens the suite.

`arch-check` **AFTER** the append: **2 violations** — the SAME two `services-ports-type-only`
findings in telemetry, status `degraded`. **Baseline unmoved.** (Module count moved 233 → 246 and
deps 497 → 537; that is new P3/P4 source landing, not new violations.)

### Golden-caught defects (T002 first run) — the adjudication record

The corpus earned its keep on the renderer's first run: **three renderer defects, every one caught
by a golden written before the code, every one resolved in the golden's favour.** A fourth failure
in the same run was mine and was *not* a renderer defect — it is recorded because I reported all
four to the PM live as "goldens are right, code is wrong", and that report was wrong about D4.

| # | Subject | Golden expects | Renderer emitted | Cause & remediation |
|---|---|---|---|---|
| D1 | `showcase.dd.md:16` — the `meta.summary` cell | `Every render feature in one document.<br>Second line proves newline folding.` | `…in one document.&lt;br&gt;Second line…` | `escapeCell` folded newlines to `<br>` **before** escaping `<`/`>`, so the escape pass ate its own output. Fixed by ordering the passes — escape `<`, `>`, `\|` first, fold newlines last (`renderer.ts:62-68`). The order is load-bearing and is now the reason that function is not a one-liner. |
| D2 | `limits.dd.md:10` — the **at-bound** row's `config` cell | `a: 1; nested: (b: 2)` | `a: 1; nested: (b: ⟨…⟩)` | The `depth > MAX_CELL_DEPTH` test ran before the value was classified, so it truncated **scalars** as well as containers — an off-by-one in *kind*, not in number: `b`'s scalar `2` sits at depth 3 (cells enter at depth 1) and was collapsed even though the container holding it was legally at the bound. Fixed by moving the bound inside the array and record branches only (`renderer.ts:203-216`); a scalar at any depth renders, which is the rule T006 then wrote down. |
| D3 | `showcase.dd.md:39` — the `proven_by` cell | `[tk-a1b2](#tasks)` | `#tasks/tk-a1b2` (raw, unlinked) | Link rendering keyed only off a *declared* `link` shape, but workshop-002 Ruling 3 puts evidence links in an interior no schema declares — so the design's own navigable links rendered as dead prose. Fixed by adding `looksLikeAddress` plus the `!shape && looksLikeAddress(value)` branch (`renderer.ts:235-265`), gated on the file half so `"See #tasks"` stays prose. |
| D4 | *(no golden)* `renderer.test.ts` — the empty-section case | — | — | **My test was wrong; the renderer was already right.** That case asserts the `_No entries._` / `_No fields._` / `_Empty._` trio for an empty array, empty object, and empty string, and I mis-assigned one of the three sentinels when writing it; the fix was to the expectation, not to `renderer.ts`. **The exact original expectation is not recoverable** — the correction predates the first commit of `renderer.test.ts` (`44dc52db`), so it exists in no diff. Per the review's instruction I state that rather than approximate it. What *is* supportable: it was in that case, it was an expectation error, and no golden carried it. |

**Provenance of the two right-hand columns.** "Golden expects" is quoted from the committed
goldens (exact, verifiable today). "Renderer emitted" is **reconstructed**, not remembered — the
failing output existed only in a pre-commit run. Each reconstruction is mechanical from the fix
itself: D1 is what escaping `<br>` produces, D2 is what the pre-fix depth guard does to
`limits.dd.json`'s at-bound row, D3 is the unlinked raw string. None is a recollection of bytes.

### Render rules this phase settled

Every rule below is pinned by a golden, an inline case, or both.

- **Anchors are heading-only** (workshop-001 § Anchors, verbatim): no HTML anchor mode. Sections
  become `##` headings; a keyed-map entry earns a `###` heading of its own, so an instance link has
  a nearest heading to land on. An array member lands on its *section* heading, with its id visible
  in the link text — `[tk-a1b2](#tasks)`.
- **Cross-file links point at the sibling `.dd.md`**, not the `.dd.json`: the rendered file is the
  artifact a human clicking the link can read.
- **Only the basename of the source path is rendered.** A golden that pinned an absolute path
  would be machine-specific; this makes the corpus cwd-independent by construction.
- **Gate pips are borrowed, not invented**: `◆` terminal, `◇` holds, `✗` blocked (the flow rail's
  own vocabulary), plus `◐` for the partial summary the plan named. A `state` field pips from the
  schema's gate-terminal set; an enum pips only when it *declares* `gate_terminal` — an enum
  without one is a vocabulary, not a gate, and pipping it would invent a semantic the schema
  declined (workshop-002 Ruling 2).
- **A summary is suppressed when there is nothing to count** (`total === 0`), so a link to a
  stateless section stays a plain link rather than claiming a meaningless `◆ 0/0`.
- **A3 — undeclared interiors render**: declared columns first in declaration order, then whatever
  the data carries, first-seen. A declared-but-absent field still gets a column (an empty cell says
  "this could be filled"; hiding it says nothing). An undeclared field named `state` still pips,
  because that is the same structural convention `deriveState` itself uses.
- **An undeclared string is read as a link only when it parses as an address AND its file half is
  either empty or a real `.dd.json`.** The grammar alone is not enough — `"See #tasks"` parses.
  This exists for workshop-002 Ruling 3: an evidence entry's `proven_by`/`pressure` links live in
  an interior the schema never declares, and rendering them as prose would strand exactly the
  links the design exists to make navigable.
- **Escaping is context-scoped**: table cells escape `<`, `>`, `|` and fold newlines to `<br>`;
  block prose is verbatim, because nothing there can break a row. Adapter output is never escaped —
  it is a markdown fragment by contract.
- **`MAX_CELL_DEPTH = 2`** — the phase's ONE invented limit, shipped as a named exported constant
  with `limits.dd.json` carrying a row at the bound and a row past it (P2 DL-006). The bound applies
  to containers only; a scalar at any depth renders.

**Evidence**: `renderer.test.ts` 14 tests, `renderer-purity.test.ts` 3 tests, all golden
comparisons byte-exact.

---

## T004 — Adapter pipeline

**Status**: complete. `src/services/dd/render/adapters.ts` + `adapters.test.ts`.

Presence is registration (W1 rule 2): `<schema package>/adapters/<type>.ts`, resolved from the
*winning* schema file's own folder, so a shadowed package cannot smuggle in adapters. Loading is
jiti through an **injected** `DdAdapterModuleLoader` — the interface is declared in this layer, not
imported from `src/adapters`, exactly as P2 declared its own `SchemaFs`; `JitiLoader` and
`NodeSchemaFs` satisfy both structurally, so the depcruise purity rules hold with no exception.

Loading is async and rendering is not: every import completes before the pure renderer is called.
That is what lets `renderDd` stay synchronous while adapters live on disk.

`.ts` is the only extension probed. W1 locked that home, and a probe list would invent a precedence
order nobody asked for; a `.js` home is an additive change the day a consumer needs one.

**Every failure class produces the same visible outcome and a different recorded issue** — the
whole design in one line. The fallback (`` `<value>` ⟨type:foo⟩ ``) means a reader never gets a
blank cell or a stack trace (W1 rule 4); the recorded WARN means an operator never gets a silent
degradation (W1 rule 5). Issues deduplicate per type — a 200-row table with one broken adapter
yields one finding — but keep the first location, so the finding is still actionable.

`DdAdapterWarnSource` is the WARN-aggregation seam P4's doctor consumes at P5. **Interface only**,
as the fence requires: implemented and fake-tested here, wired nowhere.

**Evidence**: `adapters.test.ts` 9 tests, driving the REAL jiti loader over the fixture corpus —
all four classes provoked, and the showcase golden re-rendered through the real `duration.ts`
rather than the renderer suite's fake, so no golden rests on a fake.

---

## T003 — `dd build` (the one frozen body)

**Status**: complete. `src/acts/dd/build.ts` + `test/acts/dd-build.test.ts`.

Signature untouched: `command('build <path>')` + `.option('--check'…)`, exactly as `dd-surface.md`
froze it and `dd-surface.test.ts` greps for. No option added, no E-code moved.

Composition follows the dd house pattern — the act is its own composition root (`acts/doctor.ts`
precedent, followed by `dd validate`): `NodeSchemaFs` for reads, `NodeFs` for the one write,
`JitiLoader` for adapters, `NodeHash` for basis hashing, `ConventionSchemaResolver` for the schema.
Every structured failure becomes an E-code **here**, never in `services/dd/render`.

**`--check` never writes** — proven by a test that snapshots the sibling's bytes around the call,
not merely by reading the code. An **absent** sibling is drift too: committed markdown is just as
wrong when it is missing as when it is stale.

**Containment**: a document outside the repo root is `E429` rather than a write to an arbitrary
path. The sibling always lands beside its source, and `build` must not become a way to write
anywhere on the disk.

`autoRegenerateSibling` ships the "auto-regen after every mutating dd verb" half (plan 3.2) as a
shared export, so a mutating verb cannot drift from what `dd build` itself produces. It warns to
stderr and returns — a verb that already changed state is never rolled back over a stale view.

> **Deferred — no call site yet.** Every dd verb shipped through P3 is read-only, so
> `autoRegenerateSibling` is exported and proven but wired nowhere. Phase 4's re-verification verb
> (a RESERVED row, mutation semantics its leaf call) is the first candidate and should call this
> rather than re-derive the render path. Flagged rather than silently left as dead code.

---

## T005 — Live-ledger refresh & the watcher library

**Status**: complete. `src/services/dd/render/refresh.ts` + `test/services/dd/render/refresh.test.ts`.

### The ruling that shaped it: refresh updates the VIEW, not the document

`dd build` recomputes what a `live` entry promises and **does not rewrite the `.dd.json`**. Two
reasons:

1. A build that dirties its own input can never have a stable `--check` — every run would produce
   drift against the file it just changed, and the gate would be worthless.
2. Staleness already has owners: `dd validate` reports `basis-stale` (P1) and `verify-basis`
   adjudicates a pinned one (P4). A third answer here would give an operator two sources of truth
   for one question.

So the refresh's visible effect is the **derived summary** — a row saying `◐ 2/3` about a list that
lives in another file — which is exactly what workshop-001 meant by "auto-refreshes at render;
view freshness". A basis that has moved is *reported* (`refreshed_bases` in the envelope), never
silently corrected and never treated as a failure.

**The ledger is the opt-in.** Only files carrying a `live` entry are read, so a document declares
what it transcludes instead of dragging in every link it happens to mention. `pinned` entries are
untouched — they are P4's.

### The watcher is a library, and the content hash is the contract

`DdWatcherPort` is the smallest thing that can be true: "tell me which paths changed". No daemon,
no scheduler, no sensor declaration — P5 owns those (Opus F11: watch globs are snapshotted at
scheduler construction, so the declaration cannot live here).

The load-bearing part is that **a change is only a change when the bytes hash differently from the
last hash this subscription saw.** Real watchers fire on mtime touches, editors' atomic-rename
dances, and debounce flushes; if any of those triggered a rebuild, a save-with-no-edit would
rewrite files and the drift gate would churn forever. Hashing on our side makes *any* watcher
honest rather than requiring a particular one. A deletion is forgotten rather than recorded, so
recreating a file counts as a change.

Depth-1 revalidate-on-save stays **deferred with W7**: this regenerates views, it does not re-run
validation.

**Evidence**: 13 tests, including the end-to-end that matters — a temp copy of the chain fixture, a
fake watcher, and `autoRegenerateSibling` as the injected `regenerate`, proving that editing a
transcluded source moves the consumer's markdown from `◐ 2/3` to `◆ 3/3` **through the real CLI
path**, not a re-derivation of it. Also proven: the same-content event that rebuilds nothing, the
failed regeneration that becomes a WARN instead of a silence, and a watcher that refuses to
subscribe at all returning an inert (not absent) subscription.

---

## T007 — Validation & proof

### Slice green with Phase 4 absent

```
$ cd harness/cli && npx vitest run test/services/dd/render
 ✓ fixture-corpus.test.ts (5)  ✓ renderer-purity.test.ts (5)
 ✓ renderer.test.ts (14)       ✓ adapters.test.ts (9)        ✓ refresh.test.ts (13)
 Test Files 5 passed (5)   Tests 46 passed (46)
```

P4 is **live in this shared worktree**, so "absent" could not be proven by deleting it — and a
one-off deletion would only have proven it for one run. Instead the claim is proven the way it
stays true: two import-reachability tests in `renderer-purity.test.ts` assert that
`src/services/dd/render/**` transitively reaches **no** `services/dd/{links,doctor}` module, and
that the slice suite itself imports none either. What a slice cannot reach, its presence or absence
cannot change — and that proof survives every future run, which a `rm -rf` would not.

### The freeze holds

```
$ npx vitest run test/services/dd test/acts/dd-surface.test.ts test/acts/dd.test.ts \
    test/acts/dd-live.test.ts test/acts/dd-schema-fs.test.ts test/acts/dd-build.test.ts test/architecture
 Test Files 34 passed (34)   Tests 299 passed (299)
```

`dd-surface.test.ts` is untouched and green: no frozen signature, option, or E-code moved.

### Both cwds

```
$ cd harness/cli && npx vitest run test/services/dd/render test/acts/dd-build.test.ts test/acts/dd.test.ts
 Test Files 7 passed (7)   Tests 74 passed (74)

$ cd <repo root> && npx vitest run --root harness/cli test/services/dd/render test/acts/dd-build.test.ts test/acts/dd.test.ts
 Test Files 7 passed (7)   Tests 74 passed (74)
```

The second run is the meaningful one: `--root` moves vitest's root but **not** `process.cwd()`, so
every act-driving test ran with the repo root as its process cwd — the exact skew the P2 lesson
warned about.

### Baselines

| Gate | Baseline | Measured after P3 |
|---|---|---|
| `harness arch-check` | 2 | **2** (the identical `services-ports-type-only` pair in telemetry) |
| `harness markdown-lint` | 199 | **199** (197 markdownlint + 1 links + 1 mermaid) |
| biome, P3 paths only | clean | clean (18 files, no fixes) |

The golden `.dd.md` fixtures do not move markdown-lint: it examines 109 authored docs, and the
corpus lives under `harness/cli/test/**`.

### `just test` — honest result, and a pre-existing red

```
$ cd harness/cli && just test
 Test Files  1 failed | 258 passed (259)
 Tests  3509 passed | 18 skipped (3527)      <- zero failed TESTS
```

**Every test passes.** The one failed *file* is
`test/adapters/git/exec-remote-telemetry-git.int.test.ts`, which fails in `beforeAll` with
`git config uploadpack.allowFilter true -> fatal: not in a git directory`, then throws in `afterAll`
on an undefined `daemonManager`.

It is **not** P3's: the file contains zero `dd` references, and it **fails identically when run
alone**, with no other phase's tests loaded — so it is environment-dependent (it wants a
git-daemon-capable setup), not a regression. Captured as a difficulty (`harness observe`): a suite
that cannot self-skip when its prerequisites are absent makes "full `just test` green" unusable as
a completion proof on this machine, and costs every coder a cycle proving the red is not theirs.
The honest signal is **0 failed tests + 1 known-red file**.

### Live transcript

```
### 1. clean document — the committed sibling IS the render
$ node harness/cli/bin/harness.js dd build docs/showcase.dd.json --check --json
{ "command": "dd build", "status": "ok",
  "data": { "schema": "render/showcase", "bytes": 2075, "adapter_warnings": [],
            "refreshed_bases": [ { "path": ".../other.dd.json", "recorded": "sha-other", ... } ] } }
   -> a moved live basis is REPORTED, not a degradation: the view is still correct.

### 2. hand-edited sibling — byte drift (AC-03)
$ node harness/cli/bin/harness.js dd build docs/drift.dd.json --check --json
status: error   error: "E422"  ".../drift.dd.md drifted from the render of .../drift.dd.json"
next_action: Regenerate with `harness dd build docs/drift.dd.json` and commit the result.

### 3. regenerate, then re-check
--- before (hand-edited tail) ---
| tk-0002 | second, and a human typed this straight into the generated file | ◆ checked |
A hand-added paragraph the generator would never emit.
$ node harness/cli/bin/harness.js dd build docs/drift.dd.json --json
status: ok | evidence: rendered markdown
--- after (regenerated tail) ---
| tk-0001 | first | ◆ checked |
| tk-0002 | second | ◇ unchecked |
$ node harness/cli/bin/harness.js dd build docs/drift.dd.json --check ; echo $?
0
   -> AC-03's whole hand-edit path, end to end: detected, regenerated, clean.

### 4. broken adapters — degraded, exit 0, every failure named (AC-04)
$ node harness/cli/bin/harness.js dd build docs/adapters.dd.json --check --json
status: degraded
  E424 broken     adapter-load-failed
  E423 missing    adapter-not-found
  E424 shapeless  adapter-load-failed
  E425 boom       adapter-runtime-failed
  E426 numeric    adapter-output-invalid
exit=0
   -> loud (W1 rule 5) but never fatal (W1 rule 4).
```

### Acceptance criteria

| AC | Status | Where |
|---|---|---|
| AC-03 Render + hand-edit path | met | goldens byte-exact; drift fixture caught by `--check` (E422) and regenerated by `build`; live transcript §2-3; derived-state summaries (`◐ 3/5`) in the showcase golden |
| AC-04 Adapters | met | all four failure classes provoked through the REAL jiti loader; honest fallback rendered; every issue in the envelope; transcript §4 |
| AC-06 (live half) | met | `refreshLiveReferences` + the watch→CLI end-to-end moving a consumer from `◐ 2/3` to `◆ 3/3` |
| AC-13 (consumed) | met | renderer consumes P1 `deriveState`; cross-file summaries precomputed by refresh |

---

## Discoveries & Learnings

| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-08-03 | T001 | Noteworthy | The P3 fence lists source paths but not `.dependency-cruiser.cjs`, while T002's Done-When requires a depcruise rule — the same *"the fence names sources, not the shared files a change necessarily touches"* shape P2 hit as DL-002. | Asked the PM before editing; fence amendment 1 recorded above with a custody-window rider. | tasks.md § Shared-surface custody |
| 2026-08-03 | T006 | Noteworthy | Nothing in the freeze says which adapter failure gets `E424` vs `E426`; a non-callable default export could defensibly be either. | Ruled (a) above: `E426` is reserved for an adapter that *ran*, so a non-callable export is `E424`. | dd-surface.md § E420-E429 |
| 2026-08-03 | T002 | Noteworthy | Nothing in the freeze said whether an UNDECLARED string that parses as an address should render as a link. Rendering it as prose strands workshop-002 Ruling 3's `proven_by`/`pressure` links (they live in an undeclared interior); rendering every parsing string as a link turns `"See #tasks"` into a broken link. | Inference accepted, but gated on the file half being empty or a real `.dd.json`. Pinned by a golden and by an explicit "never mistakes prose for one" case. | renderer.ts § looksLikeAddress |
| 2026-08-03 | T004 | Noteworthy | `services/dd/render` needs a module loader and an fs probe, but importing `src/adapters/**` — even type-only — trips the very purity rule this phase added (`reachable: true` catches type-only edges). | Declared `DdAdapterFs`/`DdAdapterModuleLoader` locally, exactly as P2 declared `SchemaFs`; `NodeSchemaFs`/`JitiLoader` satisfy both structurally. No rule exception needed. | adapters.ts, P2 `schema/model.ts` |
| 2026-08-03 | T003 | Deferred | `autoRegenerateSibling` implements "auto-regen after every mutating dd verb", but every dd verb shipped through P3 is read-only, so it has no call site. | Exported and proven, flagged here for P4's re-verification verb rather than left as silent dead code. | build.ts, dd-surface.md RESERVED rows |
| 2026-08-03 | T005 | Noteworthy | "Live entries auto-refresh at render" is ambiguous: refresh the VIEW, or rewrite the document's ledger? Rewriting makes `build` mutating and permanently breaks its own `--check`. | Ruled: refresh the view, report a moved basis, never rewrite. Staleness keeps its existing owners (`dd validate`, `verify-basis`). | refresh.ts header, T005 log section |
| 2026-08-03 | T007 | Noteworthy | The fence asks for a slice "green with P4 absent", but P4 is live in this shared worktree and cannot be removed. | Proved by import reachability instead of deletion — stronger, because it stays true on every future run. | renderer-purity.test.ts |
| 2026-08-03 | T007 | Deferred | `just test` reports 1 failed FILE (0 failed tests): `exec-remote-telemetry-git.int.test.ts` fails in `beforeAll`/`afterAll` on a git-daemon prerequisite. Reproduces identically in isolation with no P3 files loaded — pre-existing and environment-dependent, not P3's. | Reported, not hidden: the honest phase signal is 0 failed tests + 1 known-red file. Captured via `harness observe` for the retro; the fixture should self-skip when its git prerequisites are absent. | § T007 `just test` |
