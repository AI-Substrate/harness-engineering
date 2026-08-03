# Phase 2: Schema layer & baked docs — Execution Log

**Plan**: [deterministic-documents-plan.md](../../deterministic-documents-plan.md) § Phase 2
**Tasks**: [tasks.md](./tasks.md) (T001–T009)
**Freeze basis**: [dd-surface.md](../phase-1-dd-core-foundations/dd-surface.md) — bodies only; no signature, option, or E-code change.

---

## Fence amendment 1 (PM grant, 2026-08-03)

`harness/cli/test/acts/dd.test.ts` is a P1 file whose `it.each` stub table asserts the five
Phase-2 commands exit 2 `unconfigured`. Those five rows cannot survive the ruled OD-2 handoff
(P2 flips them live), so the fence was amended before any edit: **replace exactly those five
rows with live-body assertions; the family-registration test and the eight P3/P4 stub rows stay
byte-identical; assertions must be real live behaviour per the T008(c) exit ruling, never
weakened.** `dd-surface.test.ts` is untouched — no signature, option, or E-code moved.

Captured as a difficulty (`harness observe`): this is DL-002 recurring — a new-core-verb fence
that lists source paths still misses the *enumeration* tests that necessarily redden when a
stub goes live.

---

## T008 — Leaf rulings

The three decisions the phase's consumers need before they can land. Each is a leaf decision
(the coder's, constrained by the workshops), recorded here with its one-line rationale in the
T009-P1 style.

### (a) In-package file layout

A schema lives at `<root>/schemas/<pkg>/<schema>/schema.json` — **one file per schema**, whose
qualified name (`<pkg>/<schema>`) comes from the folder path and is never repeated inside the
file; the human `description` is a top-level key in that same file; a sibling `adapters/`
directory is reserved for Phase 3's `(value, ctx) => string` type adapters.

```json
{
  "dd_schema": 1,
  "description": "…one line, shown by `dd schema list`…",
  "sections": { "<name>": { "required": true, "shape": { "type": "…" } } },
  "enums": { "<name>": { "values": ["…"], "gate_terminal": ["…"] } }
}
```

**Rationale**: identity from the path means a moved or copied folder cannot lie about its name
(the shadow/duplicate diagnostics stay truthful); the in-file description keeps `dd schema list`
one read per schema instead of a sidecar convention nobody can see; `dd_schema` is the version
knob E414 needs (supported: `1`).

### (b) Declaration syntax for custom enums and `gate_terminal[]`

Enums are declared once per schema under `enums` and **bound per field** by name —
`{"type":"enum","enum":"severity"}` for a plain vocabulary, `{"type":"state","enum":"review"}`
when the field also carries gate semantics. `gate_terminal` is declared **on the enum** and must
be a non-empty subset of that enum's `values`. A schema may bind **at most one distinct
gate-terminal declaration** to its `state` fields; two `state` fields binding enums with
different terminal sets is `E415` at declaration time. Nothing declared ⇒ the built-in
`COMPLETION_STATES` / `DEFAULT_GATE_TERMINAL_STATES` from P1.

**Rationale**: `deriveState` takes exactly one terminal set per section (P1's signature), so the
schema must resolve to exactly one — refusing the ambiguity at declaration time is honest and
keeps the gate's answer computable, where a silent union or first-wins would quietly change what
"done" means. Field-level binding (rather than a second schema-level key) means one mechanism,
not two: the enum owns both its vocabulary and its gate semantics.

### (c) `dd validate` exit mapping

| Outcome | Status | Exit |
|---|---|---|
| No issues | `ok` | 0 |
| WARN-class issues only | `degraded` | 0 |
| Any ERROR-class issue | `error` | 1 |

The envelope's `error.code` is the mapped E-code of the **first** ERROR-class issue in document
order; `data.issues[]` always carries **every** issue (class, severity, location, owner, code) in
both the degraded and error cases.

**Rationale**: AC-07 already ruled this exact mapping for `dd doctor`, and W8 ruled that doctor
*is* this engine at radius ∞ — so the two must not disagree about what a WARN costs. A single
first-issue code keeps the envelope's `error.code` a real, specific E4xx (never a generic
"something failed") while `issues[]` remains the complete record.

---

## T001 — Resolution fixture corpus

`harness/cli/test/services/dd/schema/fixtures/**` — nine **worlds**, each a whole
`repo/` (+ `home/`) tree so the four discovery roots are real directories, not stubs:
`repo/docs` · `repo/.dd` · `repo/.harness/.dd` · `home/.dd`.

The corpus is **real files on disk**, loaded into a `FakeFs` by `world.ts` — which is how both
statements in the task hold at once: the fixtures stay enumerable and human-readable (and are
the same bytes `dd validate`'s live proof runs against), while the resolver under test still
runs entirely against a fake port (house fakes-only rule). `fixtures/README.md` maps every
failure class to its bad case and good twin, and `corpus.test.ts` asserts that map stays true.

Every schema-layer class has a bad case and a good twin: E410 (`unknown-schema.dd.json`),
E411 (`malformed-package/`), E412 (`duplicate-in-root/`), E413 (`precedence-chain/`),
E414 (`unsupported-version/`), E415 (`invalid-enum/`, three distinct shapes), E416 (a throwing
port — a scan failure is a *port* failure, so it has no on-disk form), E417 (a traversing
requested name). `precedence-chain/` carries the same qualified name in **all four** roots with
four distinguishable descriptions, `deep-scan/` buries a package five levels down, and `chain/`
is the four-document hop chain the `--depth` proof needs.

**Evidence**: `npx vitest run test/services/dd/schema` — 3 files, 39 tests, green.

## T002 — Schema package model + deep-scan resolution

`src/services/dd/schema/{model,declarations,scan,resolve}.ts` (+ `index.ts`).

- `model.ts` declares a **narrow `SchemaFs`** (`readdir`/`exists`/`readText`) that `FsPort`
  satisfies structurally, so the layer names no adapter at all, and keeps the whole layer free
  of `output/` — the act owns the class → E-code mapping, exactly as dd-core does.
- `scan.ts` deep-scans a root for `schemas/<pkg>/<schema>/schema.json` at any depth, pruning
  `node_modules`/`.git`/`dist`/`coverage` and stopping at `MAX_SCAN_DEPTH` 8. It never recurses
  *into* a found `schemas/` folder (a nested `schemas` there is a package name). Any port
  failure becomes one `scan-failed` issue per root instead of an exception.
- `resolve.ts` implements P1's `SchemaResolver` **exactly** (`resolve(ref, fromPath)`), with the
  richer surface — `resolveDetailed`, `list`, `rootsFor` — hanging off separate methods so the
  frozen seam stays one method wide. Precedence is D14's, first-hit-wins with **all** hits
  recorded; scans and parses are memoised per instance (without it a `--depth 3` walk re-scans
  four roots per hop).

Two rulings the corpus forced, recorded here because they are behaviour, not style:
- **A duplicate name inside one root is fatal; across roots it is a WARN-class shadow.** Local
  override is the feature; silently forking validation is the bug it must not become.
- **A scan failure blocks resolution even if a lower root holds the schema** — you cannot claim
  "first hit wins" over a chain you could not read.

**Evidence**: `resolve.test.ts` proves the four-root chain resolves doc-folder-first with the
three losers listed by path and root, deep-nested discovery, and each E-code class. The
interface seam is proven from *both* sides: substituting the real resolver into P1's
`validateDocument` keeps the clean/ERROR/unresolvable outcomes exactly as P1's own suite has them.

## T003 — Declarations: custom enums + `gate_terminal[]`

`src/services/dd/schema/declarations.ts`, hand-rolled in the `flow-schema.ts` idiom (collect
issues, never throw — KF-02).

Enums are declared once per schema and bound per field by name; `gate_terminal` lives on the
enum and must be a non-empty subset of its `values`. `resolveGateTerminal` then answers the one
question `deriveState` can accept: **which set makes a document complete?** Only an explicit
enum-level declaration counts, so a plain built-in `state` field alongside a declared one is not
a conflict; two *different* declared sets bound to `state` fields is `E415`.

Both halves of the flow are proven end-to-end, not asserted structurally:
- **Vocabulary** — a `builder/review` document whose state is `checked` (a built-in value the
  custom enum does not declare) fails `enum-invalid` through the real resolver, naming the
  declared values.
- **Gate** — `deriveSchemaState` (the injected-terminal-set seam) calls a document of
  `approved`/`waived` complete and the same document with `in-review` incomplete, which the
  built-in terminal set would not do.

A `fields`/`items`/`required`/`gate_terminal` key on a type that cannot carry it is refused
rather than ignored — the first version silently accepted `"fields": 3` on a string shape, and
the corpus caught it.

**Evidence**: `declarations.test.ts` (16 cases) + the resolver suite's declaration group.
