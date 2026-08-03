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

**Goldens are hand-authored.** Each `.dd.md` was written before the renderer existed; T002's job
is to match them. Where the renderer and a golden disagree, the disagreement is adjudicated in
this log — never silently overwritten.

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



| Date | Task | Type | Discovery | Resolution | References |
|------|------|------|-----------|------------|------------|
| 2026-08-03 | T001 | Noteworthy | The P3 fence lists source paths but not `.dependency-cruiser.cjs`, while T002's Done-When requires a depcruise rule — the same *"the fence names sources, not the shared files a change necessarily touches"* shape P2 hit as DL-002. | Asked the PM before editing; fence amendment 1 recorded above with a custody-window rider. | tasks.md § Shared-surface custody |
| 2026-08-03 | T006 | Noteworthy | Nothing in the freeze says which adapter failure gets `E424` vs `E426`; a non-callable default export could defensibly be either. | Ruled (a) above: `E426` is reserved for an adapter that *ran*, so a non-callable export is `E424`. | dd-surface.md § E420-E429 |
| 2026-08-03 | T002 | Noteworthy | Nothing in the freeze said whether an UNDECLARED string that parses as an address should render as a link. Rendering it as prose strands workshop-002 Ruling 3's `proven_by`/`pressure` links (they live in an undeclared interior); rendering every parsing string as a link turns `"See #tasks"` into a broken link. | Inference accepted, but gated on the file half being empty or a real `.dd.json`. Pinned by a golden and by an explicit "never mistakes prose for one" case. | renderer.ts § looksLikeAddress |
| 2026-08-03 | T004 | Noteworthy | `services/dd/render` needs a module loader and an fs probe, but importing `src/adapters/**` — even type-only — trips the very purity rule this phase added (`reachable: true` catches type-only edges). | Declared `DdAdapterFs`/`DdAdapterModuleLoader` locally, exactly as P2 declared `SchemaFs`; `NodeSchemaFs`/`JitiLoader` satisfy both structurally. No rule exception needed. | adapters.ts, P2 `schema/model.ts` |
