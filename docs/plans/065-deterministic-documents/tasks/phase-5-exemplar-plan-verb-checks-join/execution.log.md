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
