# Phase 5 — Exemplar, plan verb & checks join · Execution log

**Plan**: [deterministic-documents-plan.md](../../deterministic-documents-plan.md) § Phase 5
**Tasks**: [tasks.md](./tasks.md)
**Branch**: `s065/deterministic-documents` · single-writer fan-in phase

---

## Baselines recorded BEFORE the new gates (prime rider)

`node harness/cli/bin/harness.js checks --json` on the tree as inherited (OD-8 not yet started):

| Gate | Status |
|---|---|
| tests | **error** |
| biome | error (unformatted work-in-progress files) |
| typecheck · check:docs · check:flows · check:telemetry-fixtures · check:doctrine-parity · skills-check | ok |
| arch-check | degraded |
| markdown-lint | degraded |
| windows-check | degraded |

Composite: **error / exit 1**. `arch-check`, `markdown-lint` and `windows-check` are the repo's
standing warn-launch trio and were already degraded before this phase — that is the baseline the
new dd gates are measured against, not a regression introduced here.

The `tests` error was **not** a dd failure. It is the phase's first retro follow-in, below.

---

## Retro follow-in — GIT_CONFIG_* env injection (third strike, now fixed)

`test/adapters/git/exec-remote-telemetry-git.int.test.ts` failed its `beforeAll` with
`fatal: not in a git directory`. Root cause is the host, not the code: this session's environment
exports `GIT_CONFIG_COUNT` + `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, git reads that env-config as a
config source for a plain `git config <key> <value>` write, and the fixture builder dies.

It cost P1 (DL-003), P2 (DL-004), P3/P4 (DL-004) and this phase a green full-suite proof — four
phases re-diagnosing one host defect. Fixed where it can never recur: the test's own `git()` fixture
helper now strips ambient `GIT_CONFIG_*` instead of inheriting it (18 lines, additive, that helper
only — the poison-isolation cases further down still inject their own variables deliberately,
because they drive the *adapter*, not the fixture builder).

```text
npx vitest run test/adapters/git/exec-remote-telemetry-git.int.test.ts
  Test Files  1 passed (1)
       Tests  91 passed (91)
```

Captured as `harness observe --kind difficulty` (DL-001 this session).

---

## OD-8 — `DdShape.valuesShape` (proposed, ratified, landed)

**Proposed** with the grounds the ruling asked for, and **ratified verbatim** by the PM this session.

The criterion was met, and the evidence was mechanical rather than rhetorical: `evidence` is declared
`{type: "object", allowAdditional: true, fields: {}}`, so its interiors were invisible to the
validator — while `deriveState()` collects `state` from exactly those interiors *structurally*. A dw
entry could carry `state: "chekced"`, or `human-skipped` with no receipt, and the computed gate would
move on data nothing had checked. Separately, `collectLinkCells()` walks declared shapes only, so D2's
`pressure`/`proven_by` inside evidence entries were never link-type-checked and never followed by the
depth walk.

**Semantics** (as ratified): declared `fields` win per key; `valuesShape` shapes the keys a schema
cannot name in advance; `allowAdditional: false` keeps its meaning only when `valuesShape` is absent.

**Five files, not three.** Two were discovered by reading implementations rather than trusting
contracts, and both were separately granted before landing:

| File | Why |
|---|---|
| `services/dd/core/model.ts` | the optional field + its doc comment |
| `services/dd/core/validate.ts` | `validateShape` object branch (unmatched keys vs `valuesShape`) + `collectShapeLinks` object branch |
| `services/dd/schema/declarations.ts` | **`parseShape` builds `DdShape` key-by-key from an allow-list — an unread key is silently DROPPED.** Without this branch the ratified declaration would never have reached the validator and the grant would have been a no-op. Same failure class as P2's F002: silence where the design promised behaviour. A misplaced `valuesShape` on a non-object type is now a loud package error. |
| `.dd/schemas/builder/plan/schema.json` | the one-key `evidence` declaration |
| `services/dd/links/resolver.ts` | **the exemplar found this one** — see below |

### The resolver half — found by dog-fooding, not by unit tests

With the corpus authored, `dd doctor --path …/exemplar` returned **9 ERRORs**, every one the same:

```text
ERROR link-unresolved  $.sections[tasks].value[0].done  |  "evidence" declares no part "tk-0201"
```

`descend()` in `links/resolver.ts` classifies each address segment by asking the schema shape, and its
object branch read `shape.fields?.[value]` only. A dynamic-key map declares no field per key, so it had
**never** been steppable — which meant workshop-002 Ruling 3 (`done → #evidence/<task-id>`, an evidence
list addressed by its owning task's explicit id) could not resolve at all. Pre-existing, not caused by
OD-8; but OD-8 is what made a principled fix possible, because now there is a shape to descend with.

The fix is the ~6 lines proposed and granted: `fields` wins per key, `valuesShape` is the fallback, and
a map entry reached by its own id is classified `instance` — the same kind an array member found by id
gets, because `DdSegmentKind` is what a segment turns out to *be* against shape and data, never where it
sat in the address. Presence in the data is still required, and a map with no `valuesShape` still fails
`part-unknown` (regression pin).

After: **9 ERRORs → 0**, and `dd doctor --path …/exemplar` is `ok`.

This is the exemplar earning its keep. P4's fixture corpus could not have caught it — `valuesShape` did
not exist when that corpus was written, so nothing in it addressed a map interior. Captured as
`harness observe --kind win` (WIN-001).

### Proof

```text
cd harness/cli && npx vitest run test/services/dd
  Test Files  26 passed (26)
       Tests  255 passed (255)
```

New rows: `core/values-shape.test.ts` (9, incl. the required no-`valuesShape` regression pin and the
`allowAdditional:false`-still-means-closed pin), 3 declaration rows (carry-through, loud reject on a
non-object, malformed `valuesShape`), 4 resolver rows (entry, two-hop interior, absent-from-data still
fails, and a map **without** `valuesShape` still unsteppable). `dd-surface.test.ts` and the E-code
enumeration are untouched, per the rider — this is engine-internal and changes no surface.

---

## T001 — Living exemplar corpus

`docs/plans/065-deterministic-documents/exemplar/` — four documents that cite each other by address
instead of by prose, plus their generated siblings:

| Document | Schema | What it carries |
|---|---|---|
| `plan.dd.json` | `builder/plan` | the overview: meta, goals, non-goals, 4 AC rows, 6 phases |
| `tasks/phase-2/tasks.dd.json` | `builder/plan` | phase 2's 9 tasks + one evidence list per task (25 dw rows) |
| `backpressure.dd.json` | `builder/backpressure` | 5 coverage rows + 3 sensor rows |
| `execution-log.dd.json` | `builder/execution-log` | 11 entries, each with its own outbound links |

The subject is **plan 065 itself**, and phase 2 — a phase that has actually shipped — is the worked
task file. Every claim in the corpus is a real fact from this plan's own history, so the exemplar is
not a mock-up of a plan; it is this plan, said in the other notation.

### What the primitives are doing (the "clever" bar — a HUMAN call, flagged below)

1. **The signpost pair is typed, not prose.** Each AC row carries `pressure` → a backpressure row and
   `proven_by` → a log entry, as declared link columns. "Is AC-02 proven?" is a traversal.
2. **Task state is derived, never self-reported.** Each task row's `done` → `#evidence/<its own id>`,
   and the row renders `◆ 3/3` computed from that list. Workshop-002 Ruling 3, rendered exactly as its
   ASCII sketch drew it — with no renderer feature added for the occasion.
3. **The plan's phase row summarises another file.** `ph-0002`'s `tasks` link renders `◆ 9/9` from the
   task file, through the live ledger. The Phase Index that used to be hand-maintained cannot drift,
   because nothing maintains it.
4. **Both ledger modes are exercised for real.** The task file and the coverage survey are `live` (this
   document's *view* of them must be current at render); the log is `pinned` (append-only, and a pin is
   the honest posture for it). Every recorded sha is true, so the corpus is clean rather than
   conveniently quiet.
5. **The gate vocabulary is used honestly, including the awkward parts.** `dw-0263` is `na` with a note
   ("nothing to do" and "done" are different answers). `dw-0294` is `human-skipped` carrying the PM's
   verbatim words from the phase-2 log — the root-invocation proof gap stays visible forever instead of
   dissolving into a passing suite.
6. **Incompleteness is shown, not hidden.** `ac-0901` is `unchecked` because this corpus is that
   criterion's own subject; `bp-0902` ("the exemplar uses the primitives cleverly") is an `unchecked`
   **human-judgement** row, because no machine proves taste and pretending otherwise would be the
   dishonest kind of green.

### A design constraint the corpus surfaced: the basis ledger must be acyclic

First draft had the log and the survey each record a basis for `plan.dd.json`, while the plan recorded
a basis for both. That has **no fixed point**: pinning the plan's shas changes the plan's bytes, which
invalidates the survey's recorded sha of the plan, which changes the survey's bytes, which invalidates
the plan's sha of the survey.

The resolution is also the honest reading of what a ledger *means*: an entry says "I transclude this and
my view of it must be current", not "I mention this". The log and the survey cite the plan; they do not
transclude it. Dropping their ledgers makes the graph acyclic — survey and log carry no ledger, the task
file transcludes them, the plan transcludes the task file — and shas pin in one pass.

### Proof

```text
$ harness dd validate docs/plans/065-deterministic-documents/exemplar/plan.dd.json --depth 3 --json
status: ok   counts: {"error":0,"warn":0}

$ harness dd doctor --path docs/plans/065-deterministic-documents/exemplar --json
status: ok   counts: {"error":0,"warn":0}      (was 9 ERRORs before the resolver half)

$ harness markdown-lint --json
totals: {"findings":199,"filesLinted":109,…}   ← baseline 199 held, with 4 generated .dd.md added
```

The generated siblings pass the repo's own markdown lint with no allowance — the renderer's output is
publishable markdown, not merely parseable.

**HUMAN REVIEW FLAG (Deferred/Noteworthy)**: item 6 above is a judgement row on purpose. Jordan's
standing constraint — plans-as-exemplar must use dd primitives *cleverly* and render well for humans —
is a person's call. The rendered siblings (`plan.dd.md`, `tasks/phase-2/tasks.dd.md`) are the artifacts
to read; `bp-0902` in the corpus is where the verdict belongs.

---

## T004 — Fan-in seam reconciliation (the P3 ↔ P4 meet)

Three seams, exactly three, and nothing else in `services/dd/**` touched.

### Seam 1 — P3's adapter gaps, injected into P4's doctor for real

New `services/dd/render/gaps.ts` collects gaps and freezes them into the synchronous
`DdAdapterGapSource` the sweep consumes. It declares the gap shape locally rather than importing the
links layer's, so neither module names the other and the structural match does the work — the same
posture `DdAdapterWarnSource` was declared with in Phase 3.

**It renders, and that is the decision worth recording.** Two of the four failure classes only exist at
render time: no load-time check can discover an adapter that *throws while rendering* or *returns a
number*. AC-04 says the doctor repeats a degraded render, so repeating only the cheap half would have
been a check that looked complete and was not. The cost is bounded by the guard above it — a document
that populates **no** custom type never renders here, which in a normal corpus is nearly every
document, so only documents that could *have* a gap pay for the question. The rendered markdown is
discarded; nothing is written.

Sweep-excluded documents are dropped **before** collection: a known-bad fixture's deliberately broken
adapter is not a finding about this repository (AC-15), and loading it would be work done to throw away.

Live proof, against a fixture built for it:

```text
$ harness dd doctor --path .harness/temp/p5-proof/gapdemo --json
status: degraded   counts {"error":0,"warn":2}
- WARN adapter-gap not-found      E423 | no adapter for custom type "sparkline"
- WARN adapter-gap runtime-failed E425 | adapter for "duration" threw while rendering: …
```

### Seam 2 — `autoRegenerateSibling` gets its first call site

Phase 3 built and proved that helper with no consumer, and said so honestly: every dd verb shipped
until now was read-only. `dd link verify-basis --update` is the first dd verb that **mutates a
document**, so it is the first that owes its `.dd.md` a regeneration — without it, the ledger move
would surface later as `dd build --check` drift and be misread as a hand-edit.

Posture is Phase 3's, unchanged: warn on failure, never roll back. The envelope now carries
`sibling_regenerated`, and when regeneration fails the `next_action` names the `dd build` that fixes it.

```text
$ harness dd link verify-basis <log>#entries --sha <old> --update <plan>.dd.json
status: ok   updated: true | sibling_regenerated: true
$ harness dd build <plan>.dd.json --check
status: ok   drift: false        ← the regenerated bytes ARE dd build's bytes
```

### Seam 3 — one E-code map, and it had already drifted

Three copies existed: `ISSUE_CODES` (validate), `FINDING_CODES` (doctor), `LINK_ISSUE_CODES` (link).
They **disagreed**: `address-path-escape` answered to the generic `DD_ADDRESS_INVALID` in `dd validate`
and to the specific `DD_LINK_PATH_ESCAPE` in `dd doctor`, so one finding had two codes depending on
which verb reported it. That is exactly the drift a duplicated table produces, and it was already real
rather than hypothetical.

Collapsed into one exported `DD_ISSUE_CODES` in `acts/dd/shared.ts`. **The specific code wins**
(`DD_LINK_PATH_ESCAPE`) — PM-confirmed. Both codes are inside the frozen E-block, so no surface moved;
this is a behaviour change to a filled body and it is called out here for the reviewer to re-derive.
The exhaustive `Record<DdIssueClass | DdLinkIssueClass, string>` is the guard: a new issue class in any
dd layer now fails to compile until this one map answers for it.

### The module move, and the alternatives rejected

Wiring seam 2 made `acts/dd/link.ts` import `acts/dd/build.ts`, which imports the render layer. But
`acts/dd/graph.ts` and `acts/dd/links.ts` took `createLinkContext` from `link.ts` — so both would have
transitively **reached render** and tripped `dd-graph-never-imports-render`, the depcruise rule that
exists because Phases 3 and 4 were split along exactly that line. Two new warnings; arch-check baseline
2 → 4.

So `createLinkContext`/`DdLinkContext`, `codedLinkIssues`, `nextActionFor`, `FsDocLoader` and
`trackedPaths` moved into `acts/dd/shared.ts` — a pure relocation, zero logic. Phase 4's own comment
names shared.ts as the true home and gives the only reason it wasn't there: *"that file belongs to
Phase 1 and the parallel phases must not touch each other's files."* The fan-in retired that constraint.
`address.ts` needed the same import redirect and is reported alongside the granted two.

Rejected, and worth the next reader knowing why:

- **`await import('./build.js')` inside `updateBasis`** — dependency-cruiser follows dynamic imports, so
  it would not even have silenced the rule; and if it had, it would have hidden a real edge rather than
  removed one. Passing a checker by making a dependency harder to see is not passing it.
- **Moving the regeneration helper into `services/dd/render/`** — it needs `NodeFs` and the io writers,
  and that layer is forbidden (correctly) from importing either.
- **Accepting baseline 2 → 4** — a warn-severity rule still erodes silently; the boundary was drawn on
  purpose and one module move keeps it.

### Proof

```text
cd harness/cli && npx vitest run test/services/dd test/acts
  Test Files  53 passed (53)
       Tests  570 passed (570)

harness arch-check --json
  degraded | violations: 2   ← baseline 2 HELD, both pre-existing telemetry
                               services-ports-type-only; the dd-graph rule is live and green
```

New rows: `test/services/dd/render/gaps.test.ts` (7 — all four failure classes incl. the two
render-only ones, path/schema carried, unresolvable and unreadable documents yield nothing, the
no-custom-types skip, and the source's path filtering), plus two live rows in
`test/acts/dd-links-live.test.ts` — a throwing adapter surfacing in the sweep as `E425`/`E423`, and
`--update` regenerating a sibling that `dd build --check` then agrees with byte-for-byte.

---

## T002 — `harness plan`, a core act

Two files under `acts/plan/`, plus the two registration lines OD-7 grants (`registerPlanAct` in
`app.ts`, `plan` in `RESERVED_NAMES`). Nothing else in `app.ts` was touched.

### Why it is a verb and not a `dd` subcommand

On cited authority (`initial-brief.md`: *"Harness to have a first class plan verb (which uses dd under
the hood)"*) — and the distinction turns out to be real rather than ceremonial. **Every `dd` verb acts
on ONE document; every `plan` verb acts on the whole plan.** `plan render` renders the overview *and
every task file it links to*, and `plan validate` walks the same set. That composition is the value;
`dd build` pointed at `plan.dd.json` renders one file and says nothing about the three beside it.

The dd surface gains nothing. `plan render` calls `renderDocument` — the exact function `dd build`
uses — so a plan's markdown cannot disagree with the markdown `dd build` would have produced for the
same file. `plan validate` runs dd-core's own walk with the unified `DD_ISSUE_CODES` from T004.

### Decisions worth the reader's time

**Minted ids are derived, not random.** Workshop-001 wants four lowercase hex digits, born once,
unique per file — and a random mint would satisfy that while breaking something the scaffold needs:
`plan new` with the same arguments must produce the same bytes, or the scaffold cannot be
golden-tested and every re-scaffold reads as a diff. A small FNV-1a over `slug/phase/index`, probed
for uniqueness within the file, gives born-once ids that are also reproducible. It is not a content
hash and does not need to be: the requirement is "distinct within one document".

**Always split by phase, even for one phase.** Workshop-002 Ruling 4 allows a single-file plan; the
scaffold declines the option. A plan that starts as one file and grows into many is a migration; a
plan that starts split is just a plan.

**The evidence section ships empty but present**, so the first task added has somewhere to put its
proof instead of inventing a section the workshop already named.

**No references are recorded at creation.** A ledger entry means "I transclude this and my view of it
must be current"; a basis is minted when something is first *verified*, which is
`dd link verify-basis --update`'s job. Writing shas at scaffold time would record a promise nobody made.

**`plan new` renders immediately, and reports what the render found.** A scaffold cannot answer "does
`builder/plan` actually resolve from here?" — but its first render can. Resolution failure is
`degraded` with the roots-searched next_action, so the honest answer arrives at creation instead of
surprising the first `validate`.

**Refuse before writing anything.** An existing plan folder stops the whole command (`E152`), not the
document that happened to collide first: a half-landed scaffold is worse than none, because the next
run has to work out which half it is looking at. The test asserts the refusal is total.

No new E-codes. `plan new` is a scaffolding verb and reuses the scaffolding family already in the
frozen block (`E150` invalid name, `E152` exists, `E153` write failed); the delegating verbs report
whatever dd's own codes say.

### Proof — a real scaffold, driven live

```text
$ harness plan new telemetry-repair --title "Telemetry repair" \
    --phase "Capture pipeline" --phase "Remote sync" --dir <tmp>
status: ok
  telemetry-repair/plan.dd.json                          + plan.dd.md
  telemetry-repair/tasks/phase-1-capture-pipeline/…json   + …md
  telemetry-repair/tasks/phase-2-remote-sync/…json        + …md

$ harness plan validate <tmp>/telemetry-repair
status: degraded  counts {"error":0,"warn":2}
 - WARN address-target-untracked  $.sections[phases].value[0].tasks
 - WARN address-target-untracked  $.sections[phases].value[1].tasks

$ harness plan render <tmp>/telemetry-repair --check
status: ok | documents: 3 | drifted: 0
```

The two WARNs are the design working, not a defect: the scaffolded task files are not committed yet,
and workshop-001 rules an untracked target a WARN precisely because "not committed yet" is a real,
recoverable state. Zero ERRORs, exit 0 — the plan validates out of the box, and says the one true
thing about itself that a brand-new plan can say.

The rendered overview reads as a plan: phases as a table with `◇ unchecked` pips, `depends_on`
chained, and each phase's `tasks` cell a live link to its own file.

### Suite

```text
cd harness/cli && npx vitest run
  Test Files  262 passed (262)
       Tests  3575 passed (3575)
```

**That is the plan's first fully green full-suite run.** P1, P2 and P3/P4 each recorded a red or a
caveat here — P2's log records 3354/3355 with the docs integration test timing out under load, and
every phase lost the git integration file to the `GIT_CONFIG_*` host defect. Both are green now.

New rows: `test/acts/plan.test.ts` (17 — six pure scaffold rows incl. the reproducibility pin, and
eleven live rows covering scaffold→validate→render, whole-plan rendering, drift caught in a task file
while the plan document is untouched, folder-or-file targeting, the total refusal, and three honest
failures). `test/app.test.ts` and `test/index.test.ts` gain one ADDITIVE `'plan'` row each in the
command enumeration — the P1-retro fence lesson, pre-granted for exactly this.
