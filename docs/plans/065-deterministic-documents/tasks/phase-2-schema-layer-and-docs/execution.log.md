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
  `node_modules`/`.git`/`dist`/`coverage`. It descends **until it finds** the convention folder —
  there is no depth bound (see the fix round below: an 8-level cap shipped here and was removed
  as review finding F001). It never recurses *into* a found `schemas/` folder (a nested
  `schemas` there is a package name). Any port failure becomes one `scan-failed` issue per root
  instead of an exception.
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

## T004 — `dd validate` flipped live (the OD-2 handoff)

`src/acts/dd/validate.ts` — real resolver + P1 engine + depth walk. The frozen signature and the
`--depth` option string are byte-identical; only the body changed.

**Where the adapters come from.** `DdActDeps` carries only a `Clock`, and both it (`acts/dd/shared.ts`)
and the registration site (`acts/dd/index.ts`) are P1 files outside this fence. Rather than
renegotiate a shared type, the act constructs its own `NodeFs`/`NodeProcess`/`NodeEnv`/`NodeExec`/
`NodeHash` — the exact precedent `acts/doctor.ts` already sets. The heavy logic stayed in
`services/dd/schema/**`, which is injected and fake-tested, so nothing was traded away for it.

**`FsDocLoader`** supplies the walk's documents. `tracked` comes from ONE `git ls-files -z`
snapshot taken before the walk: calling every readable file "tracked" would have silently
suppressed the untracked-target WARN, and a per-document `git` call would have made depth
quadratic. A non-repo yields a null set — "this host has no tracking concept", not "everything
happens to be tracked". The live run proved the distinction: the exemplar reported 13
`address-target-untracked` WARNs while uncommitted and zero after `git add`.

**Exit mapping** is T008(c): clean ⇒ `ok`/0, WARN-only ⇒ `degraded`/0, any ERROR ⇒ `error`/1 with
the first ERROR's mapped E-code; `data.issues[]` always carries every finding with its class,
severity, location, owner and code. Issue class → E-code is an act-level table of P1 allocations
only — Phase 2 adds no codes.

**OD-1 honoured**: mode is always `direct`, so `sweep_exclude` and the fixture-path exclusion
(the doctor's) never apply here. Pointing the verb at a known-bad fixture still fails, which is
asserted rather than asserted-about.

## T005 — `dd schema list` / `show`

`src/acts/dd/schema.ts`. Paths are shown ALWAYS, in both verbs — a schema you cannot locate is a
schema you cannot trust — along with the in-file description, the resolved root, the shadow chain
with each loser's path, the section shapes, every declared enum, and the schema's gate-terminal
set. An absent qualified name is `E410`; a broken package keeps its row in `list` with the reason
it failed, because a schema that vanishes from a listing is worse than one that reports why it
is unusable.

`list` is `degraded` (exit 0) when a package fails to load or a shadow exists — the listing is
still complete and correct — and `error` only when a discovery root itself could not be scanned,
where nothing can be listed at all. Human mode renders a real listing; JSON mode is the envelope.

## T006 — Exemplar `builder/*` packages

`.dd/schemas/builder/{plan,backpressure,execution-log}/schema.json` (OD-4; `git check-ignore`
re-verified: not ignored).

`builder/plan` carries D2's link columns on AC rows — `pressure` → `builder/backpressure/section/rows`,
`proven_by` → `builder/execution-log/section/entries` — and the same pair on every evidence entry.
Each task row links to ITS own evidence list via `done` → `builder/plan/section/evidence`.

**One shape changed under live proof.** Modelling the per-task evidence list as an array entry
whose `id` IS the owning task id produced `E404 duplicate-id` from a real `dd validate` run — ids
are unique per FILE across all sections, and the task row already owns that id. Workshop-002's
own ASCII shows `tk-9f2a:` as a **key**, so `evidence` is an object keyed by task id: no
collision, address `#evidence/tk-1a2b` unchanged, per-task ownership intact, minted list ids
still rejected. Ratified by the PM (fence note: `DdShape` is P1's and was not touched).

The residual cost is recorded as Noteworthy below and parked as residual A3.

## T007 — Baked docs (D15) + drift scripts

Two docs, compiled INTO the CLI so an agent holding the binary holds the documentation:
`dd-overview` (envelope, ids/addresses, the state table and gate, resolution precedence, the CLI,
jq recipes) and `how-to-add-a-schema` (a worked package with a custom enum + `gate_terminal`, the
`human-skipped` receipt convention, and a complete `(value, ctx) => string` adapter sample).

`scripts/gen-dd-docs.mjs` mirrors `gen-docs.mjs` exactly — `JSON.stringify` escaping, biome
normalisation, stderr-only logging — and `scripts/check-dd-docs.mjs` calls it in-process rather
than re-spawning node, so there is one implementation of the rules and nothing to drift between
them. Root `package.json` gained exactly the two granted script entries (`gen:dd-docs`,
`check:dd-docs`) and nothing else; `build`, `prepare`, and every dependency block are untouched.

Two leaf details worth recording:

- **The generated module carries its own biome suppression.** The baked prose quotes real
  TypeScript, so `${…}` appears inside string literals and trips
  `lint/suspicious/noTemplateCurlyInString`. The repo's precedent for this is a `biome.json`
  override (as `services/docs/docs-content.ts` has), but `biome.json` is outside this fence — so
  the generator emits a `biome-ignore-all` header instead. That is arguably the better shape
  anyway: the escape hatch is scoped to exactly one file and travels with the generator that
  creates it, rather than accumulating in a central override list.
- **Drift is proven in both directions**: `npm run check:dd-docs` exits 0 clean, and exits 1 with
  a diff when a source `.md` is edited without regenerating (verified by injecting a line and
  restoring it).

## T009 — Validation & proof

| Proof line | Result |
|---|---|
| `npx vitest run test/services/dd/schema test/services/dd/docs` (**with P3/P4 absent**) | **53 passed** / 5 files |
| P1 suites still green — `npx vitest run test/services/dd test/acts/dd-surface.test.ts test/acts/dd.test.ts` | **136 passed** / 15 files |
| `test/acts/dd-live.test.ts` (act bodies end-to-end) | **11 passed** |
| Full `just test` | **3354 passed / 3355** — one pre-existing failure, see Deferred below |
| `harness arch-check` | **2 violations = baseline 2** (both pre-existing telemetry `services-ports-type-only`; dd adds none) |
| `npx biome check harness/cli` | clean, 462 files, 0 warnings |
| `npm run check:dd-docs` | OK — no drift (and exits 1 on injected drift) |

### Recorded live run

```
$ node harness/cli/bin/harness.js dd validate <fixtures>/exemplar/plan.dd.json --json
{"status":"ok","schema":"builder/plan","depth":3,"counts":{"error":0,"warn":0}}            exit 0

$ … dd validate <fixtures>/chain/repo/docs/a.dd.json --depth 2 --json
depth2: ok                                                                                 exit 0
$ … dd validate <fixtures>/chain/repo/docs/a.dd.json --depth 3 --json
depth3: error E408  owner=d.dd.json                                                        exit 1
   ^ the 3-hop corpus: depth 3 reaches the bad document, depth 2 does not, and the finding
     is owned by the file that must change — four hops from the one the command named.

$ … dd schema list --json
ok
  builder/backpressure  | gitroot | .dd/schemas/builder/backpressure/schema.json
  builder/execution-log | gitroot | .dd/schemas/builder/execution-log/schema.json
  builder/plan          | gitroot | .dd/schemas/builder/plan/schema.json
  roots: ['gitroot', 'harness', 'home']

$ … dd schema show builder/plan --json
ok | gate_terminal: ['checked','human-skipped','na']
   | sections: ['meta','goals','non_goals','acceptance_criteria','phases','tasks','evidence']
   | enums: ['plan_status','complexity']

$ … dd schema show builder/nope --json        → error E410                                 exit 1
$ … dd docs list --json                       → ok ['dd-overview','how-to-add-a-schema']    exit 0
$ … dd docs get how-to-add-a-schema --json    → ok "How to add a schema (and an adapter)" (5597 bytes)
$ … dd docs get nope --json                   → error E419                                  exit 1
```

The eight remaining P3/P4 stubs were re-run unchanged and still exit 2 `unconfigured` naming
their owning phase; `dd-surface.test.ts` (15 tests) and the E400–E449 enumeration are untouched
and green — the freeze holds.

---

## Deferred & Noteworthy (this phase)

| Tag | What | Why a human should see it |
|---|---|---|
| **Deferred** | Full `just test` is 3354/3355: `test/integration/docs.test.ts` "streams the full markdown byte-for-byte" times out at vitest's **default 5000 ms**. Not dd, and not new. | Root cause measured: **every harness CLI invocation costs ~4 s, and it is telemetry capture** — `dd docs list --json --no-extensions` 3.93 s vs **0.09 s** with `HARNESS_NO_TELEMETRY=1`; `harness --version` (which skips the capture path) 0.26 s. That test spawns the real dist CLI, so a 4 s command under a 5 s timeout is permanently ~1 s from red; it passes standalone at 4.0 s and fails under full-suite load. Its **sibling test in the same file already carries an explicit `}, 120_000)`** — the same wall was hit once before and only half-fixed. The file is outside this fence; captured via `harness observe --kind difficulty`. |
| **Noteworthy** | `evidence` is a dynamic-key map, so dd-core cannot validate INSIDE it — dw entries' states are not enum-checked. | `DdShape` has `fields`/`items` but no "every value of this map has shape X". `deriveState` still walks the raw values, so **the gate is unaffected**; only shape/enum validation of the entries is lost. An additive `DdShape.valuesShape` would close it — P1's file, so not taken here. Parked as residual A3 and captured as `--kind magic-wand`. |
| **Noteworthy** | The P2 fence listed source paths but not `test/acts/dd.test.ts`, whose stub-enumeration table necessarily reddens when a stub goes live. | Resolved by PM fence amendment 1 before any edit. This is **DL-002 recurring one phase later**: a fence for "fill the stub bodies" work must name the tests that assert the stub behaviour, not just the `src/` paths. Captured as `--kind difficulty`. |
| **Noteworthy** | `GIT_CONFIG_COUNT`/`KEY_0`/`VALUE_0`/`KEY_1`/`VALUE_1` exported into the agent shell make `test/adapters/git/exec-remote-telemetry-git.int.test.ts` fail its `beforeAll` with `fatal: not in a git directory`. | 91/91 green under `env -u …`. **DL-003 recurring verbatim** — second phase to lose time to it, so the fix belongs in the harness (a vitest setup that neutralises `GIT_CONFIG_*` for git-touching suites), not in each coder's memory. Captured as `--kind difficulty`. |
| **Noteworthy** | The act constructs its own Node adapters instead of taking them from `DdActDeps`. | `DdActDeps` (`acts/dd/shared.ts`) and the registration site are P1 files outside the fence, and `acts/doctor.ts` sets the precedent. P3/P4 will hit the same wall for `dd build`/`dd doctor`; widening `DdActDeps` once, in a phase that owns those files, would be tidier than three repeats. |

No `TODO`/`FIXME`/`HACK` markers were introduced. No task was skipped or blocked.

## Phase complete

All nine tasks `[x]`. Phase 2 delivers: deep-scan schema resolution with D14 precedence, loud
clash/shadow diagnostics, declarable enums with their own `gate_terminal` sets flowing into both
the validate engine and `deriveState`, the five Phase-2 command bodies live (the OD-2 handoff
closed), three exemplar `builder/*` packages, and the D15 baked docs with a two-way drift gate.
The frozen surface is unchanged: no command, positional, option, or E-code moved.

---

## Fix round — P2 code review (F001 + held cwd stabilization)

One commit, both items, per the reviewer's verdict (FIX, 1 HIGH) and the PM's rulings.

### F001 (HIGH) — the scan carried an undocumented semantic depth cap

`scan.ts` pruned the walk with `if (depth > MAX_SCAN_DEPTH) return` (`MAX_SCAN_DEPTH = 8`).
**D14 rules the hierarchy above a package organization-only and sets no bound**, so the cap was
a semantic decision smuggled in as a constant — and the worst kind, because a package below
depth 8 is not *reported*, it is silently **not found**. No ruling authorised it; I did not
attempt to justify it after the fact.

Fix: `MAX_SCAN_DEPTH` deleted from `model.ts`, the guard and the now-unused `depth` parameter
deleted from `scan.ts`, and the function's doc comment corrected (it had claimed over-deep
branches are "silently pruned" — that sentence described the bug).

No cycle guard was added in its place. There was none to keep, and the port
(`SchemaFs` = `readdir`/`exists`/`readText`) exposes no `realpath`/`stat`, so a symlink loop
cannot be detected by identity — and a path-set guard would not catch it, since each traversal
yields a *new* path. A loop therefore terminates by `ENAMETOOLONG` (which `NodeFs.readdir`
absorbs to `[]`) or by recursion depth, which the existing `try/catch` converts into one honest
`scan-failed` ERROR. Silent omission is traded for a loud, bounded failure. Adding a guard would
have meant re-introducing a bound by the back door; per the PM's instruction that would be a
renegotiation, not a coder's constant.

**Fixture: `fixtures/beyond-cap/`** — `builder/plan` at
`repo/.dd/org/team/squad/area/service/module/component/feature/config/schemas/builder/plan/`:
nine levels below its root, exactly one past the former cap.

**Mutation proof (the fixture has teeth).** Re-introducing an equivalent cap transiently —
`if (dir.split('/').length - root.path.split('/').length > 8) return;` — reddened exactly the
new row and nothing else:

```
 FAIL  test/services/dd/schema/resolve.test.ts > dd schema resolution — precedence >
       finds a package nested past the former scan cap — the walk has no depth bound
 Test Files  1 failed | 12 passed (13)
      Tests  1 failed | 106 passed (107)
```

The mutation was reverted and its absence verified by grep before commit.

### Held item — cwd stabilization of the live act suites

`dd validate` resolves its document argument against `process.cwd()` (the house repo-root
convention, `validate.ts`). The live rows hand it `harness/cli`-relative fixture paths, so they
only meant what they said when cwd happened to be `harness/cli`.

That is not a theoretical exposure: **this repo ships its own root `vitest.config.ts`**
(`mergeConfig(cliConfig, { root: 'harness/cli' })`). Vitest's `root` relocates *discovery*; it
does **not** set `process.cwd()`. So a root-level `npx vitest run` is a supported invocation, and
under it 7 tests were red — 2 in `dd.test.ts`, 5 in `dd-live.test.ts` — with the path miss
surfacing as `E400` instead of `E401`/`E408`.

Fix: each affected `describe` pins cwd to `CLI_ROOT` (derived from `import.meta.url`) in
`beforeEach` and restores it in the existing `afterEach`. This is the idiom already proven in
`dd-live.test.ts`'s `schema / docs` group, which was green from either cwd throughout. Absolute
fixture paths were rejected: they would change `repoRoot`, and with it the `git ls-files`
tracked-ness WARNs the assertions depend on.

Per the PM's ruling, the pin is **describe-level**: a row-level freeze pins the assertions, not
the file's scaffolding. Every frozen row's text is byte-identical (`git diff` on `dd.test.ts`
touches only imports, one `const`, and the hooks), and the 8 P3/P4 stub rows are cwd-agnostic,
so a shared pin changes nothing they assert.

### Proof — both cwds, because a fix proven from one leaves the other unproven

```
cd harness/cli && npx vitest run test/services/dd test/acts/dd-surface.test.ts \
  test/acts/dd.test.ts test/acts/dd-live.test.ts
  Test Files  16 passed (16)
       Tests  148 passed (148)

cd <repo root> && npx vitest run test/services/dd test/acts/dd-surface.test.ts \
  test/acts/dd.test.ts test/acts/dd-live.test.ts
  Test Files  16 passed (16)
       Tests  148 passed (148)
```

147 → 148 is the one new beyond-cap row. `npx biome check harness/cli/src harness/cli/test`
clean (459 files); `npx tsc -p harness/cli/tsconfig.json` passes.

### Left undecided on purpose

The durable lesson is not the test bug — it is the **proof ceiling** behind it: two *sanctioned*
invocations of the same suite disagreed, and nothing in `harness checks` ran the second one. The
remedy is a choice, not a patch — add a repo-root run to the gate, **or** delete the root
`vitest.config.ts` if that invocation is not really supported. Today the repo asserts both work
and only one does. Captured as `harness observe --kind difficulty` (**DL-008**) and left to the
retro / P5 checks conversation, per the PM's ruling not to decide it inside a fix round.
