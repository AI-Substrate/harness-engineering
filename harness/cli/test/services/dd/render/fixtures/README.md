# dd render fixture corpus

The TDD floor for Phase 3 (plan 065, T001). Every fixture is a **real repo shape**
— `<case>/repo/.dd/schemas/<pkg>/<schema>/schema.json` plus `<case>/repo/docs/*.dd.json`
— so the convention resolver (P2) discovers schemas here exactly as it does in a
consumer repo. The whole tree sits under `test/**/fixtures/**`, which is the
sweep-exclusion subject, so `harness checks` stays green with the corpus committed
(AC-15).

**Golden files are hand-authored expected output, not snapshots.** The seven originals
(`showcase`, `adapters`, `chain/source`, `chain/consumer`, `drift`, `drift.expected`,
`limits`) were written **before the renderer existed** and the renderer was made to match
them — they caught three real renderer defects doing it. Two later files do **not** carry
that guarantee and must not be cited as if they did: `showcase.dd.md`'s `proven_by` column
was added alongside the renderer, and `showcase/repo/docs/other.dd.md` is a **support
fixture** (it makes the showcase's live reference resolve) authored with the renderer's
output shape already in hand. The per-file provenance record is the phase execution log,
§ T001. See § Updating a golden below — regeneration is a *verification* step, never the
source of truth.

## Fixture → feature map

| Fixture | Exercises |
|---|---|
| `showcase/repo/docs/showcase.dd.json` → `.dd.md` | The everything-doc: banner, document title from the first object section's `title`, `**Schema**/**Source**/**Sections**` meta line, object section → `Field \| Value` table, scalar array → bullet list, object array → table, **task-id-keyed evidence MAP** with a `###` sub-heading per key (A3 — interiors render although the shape declares no fields), text section → block, `references` ledger table |
| ↳ `meta.status` / `tasks[].state` | Gate pips: `[x]` gate-terminal · `[ ]` holds · `[-]` blocked. `meta.risk` uses an enum with **no** `gate_terminal`, so it renders unpipped — Ruling 2's "enums are general-purpose" |
| ↳ `tasks[].done` / `meta.coverage` | Same-document link + **derived-state row summary**: `[~] 3/5`, `[x] 2/2`, `[ ] 0/1` (via P1 `deriveState`) |
| ↳ `tasks[].upstream` | Cross-file link → `[<last segment>](<file>.dd.md#<section>)`; heading-only anchors (workshop-001 § Anchors), id visible in the link text |
| ↳ `tasks[0].note` | Table-cell escaping: a literal `\|` and `<tag>` survive a cell |
| ↳ `goals[1]` | Block context does **not** escape — backticks and pipes stay verbatim outside tables |
| ↳ `tasks[2].risk` | Undeclared column (A3): declared fields first in declaration order, undeclared appended in first-seen order |
| ↳ `meta.budget` / `tasks[].spent` | Custom type → adapter (`adapters/duration.ts`), proving `ctx` carries the column declaration |
| `limits/repo/docs/limits.dd.json` → `.dd.md` | Every **invented limit** with a fixture that CROSSES it (P2 DL-006): `MAX_CELL_DEPTH` nested-container rendering — `at-limit` sits at the bound, `crosses-limit` goes past it and collapses to `⟨…⟩`. Also proves the title fallback to the source basename when no section carries a `title` |
| `chain/repo/docs/source.dd.json` + `consumer.dd.json` | Transclusion chain for live-ledger refresh (T005): consumer's `upstream` link carries a **precomputed cross-file** summary `[~] 2/3`; `references` row is `mode: live`; empty section renders `_No entries._` |
| `drift/repo/docs/drift.dd.json` | The hand-edit path (AC-03). `drift.expected.md` is the correct render; `drift.dd.md` is the **deliberately hand-edited sibling** that `dd build --check` must catch as byte drift (E422) and `dd build` must overwrite |

## Adapter failure classes → fixture map

All in `adapters/repo/` (schema `render/adapters`, adapters in
`.dd/schemas/render/adapters/adapters/`). Every class renders the **honest fallback**
`` `<value>` ⟨type:<name>⟩ `` and reports an envelope warning — never a crash, never a
blank (workshop-003 W1 rules 4–5).

| Field | Adapter file | Failure class | Frozen code |
|---|---|---|---|
| `good` | `good.ts` | none — the control; renders `**ok: 7**` | — |
| `missing` | *(absent by design)* | no adapter file for the declared custom type | `E423 DD_ADAPTER_NOT_FOUND` |
| `broken` | `broken.ts` | throws while the module evaluates (import half) | `E424 DD_ADAPTER_LOAD_FAILED` |
| `shapeless` | `shapeless.ts` | imports cleanly, default export is not callable (wrong-signature half) | `E424 DD_ADAPTER_LOAD_FAILED` |
| `boom` | `boom.ts` | loads and is callable, throws when invoked | `E425 DD_ADAPTER_RUNTIME_FAILED` |
| `numeric` | `numeric.ts` | callable, returns a non-string | `E426 DD_ADAPTER_OUTPUT_INVALID` |

## Updating a golden

Goldens are the spec, so the procedure is deliberately two-step and never blind
(T006 ruling c):

1. Change the golden `.dd.md` **by hand** to the output you intend.
2. Run the slice — `npx vitest run test/services/dd/render` from `harness/cli` —
   and make the renderer match.

To *inspect* what the renderer currently produces without overwriting anything:

```sh
node harness/cli/bin/harness.js dd build <fixture>.dd.json --check --json
```

`--check` never writes. There is deliberately **no `--update-goldens` flag**: a
regeneration switch turns a spec into a snapshot of whatever ran, which is exactly
what this corpus exists to prevent.

`drift/repo/docs/drift.dd.md` is the one file here that must **stay** hand-edited —
regenerating it destroys the drift subject.
