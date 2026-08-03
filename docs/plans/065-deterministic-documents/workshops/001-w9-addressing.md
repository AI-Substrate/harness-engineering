# Workshop: W9 — Addressing Grammar

**Type**: Data Model (addressing contract)
**Plan**: 065-deterministic-documents
**Spec**: pre-plan workshop — business source is `../initial-brief.md` + `../workshop-notes.md` (D1–D16)
**Created**: 2026-08-03T16:05+10:00
**Status**: Approved (rulings by Jordan, this session — each locked verbatim in-conversation)

**Value Thesis**: Every dd link, flow `dd_link`, validate/build walk, and render anchor consumes an address. Locking one grammar — with tooling so agents never hand-assemble addresses — removes the single largest source of cross-document ambiguity before the plan is written.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Agent Readiness**: addresses are generated/validated by CLI, greppable by jq — agents act without inventing syntax.
- **Safety to Change**: nothing positional, ids born-once — insert/reorder/renumber never breaks a link.
- **Proof Quality**: every rule below is mechanically checkable by `dd validate`/`doctor`; violation severities are stated.
- **Implementation Readiness**: grammar, id discipline, ledger shape, and diagnostics are specified to coding depth.

**Related Documents**:
- `../workshop-notes.md` — D1–D16 (esp. D9, D11, D13, D14, D16); this workshop supersedes D8 and revises D9's citation granularity.
- `../exemplar-plans-as-dd.md` — notation predates this grammar; the plan pass folds it in.
- `../research/thinker-linking-composition.md` (frozen) — the [proposed] input floor; superseded where it differs.

---

## Purpose

Lock the full dd address grammar: syntax, id discipline, basis/staleness model, path rules, anchors, rename posture, and the CLI tooling contract. Downstream loop made cheaper: the plan pass and every consumer (flow spine first) build on one address shape with zero re-litigation.

## Fresh Entrant Outcome

A fresh human or agent can, with no additional context: read any dd address and know exactly what it targets; produce a correct address with `dd address generate`; know which failures WARN vs ERROR; and know how staleness is detected and what it invalidates.

## Key Questions Addressed

1. What is the canonical address syntax?
2. How are sections, shape parts, and instances identified — names, keys, or ids?
3. Where does the citation basis live, and what does drift invalidate?
4. What are the path rules, anchor mapping, and rename semantics?

---

## The Grammar

```
<relative-path>.dd.json#<interior>
interior := <section>[/<instance-id>][/<shape-part>[/<instance-id>]…]
```

- `#` separates file from interior (file part is a path and may contain `/`; interior is slash-delimited).
- Interior is an **alternating schema-name / instance-id descent**: each level is either declared structure (stable text from the schema) or a minted instance id. **Nothing positional, ever.**

### Worked examples

```
plan.dd.json#preamble                          singleton section — no key segment
plan.dd.json#phases                            a collection section (link to the whole thing)
plan.dd.json#phases/ph-3f2a                    one phase, by minted id
plan.dd.json#phases/ph-3f2a/brief              a primitive shape-part, by name — no id
plan.dd.json#phases/ph-3f2a/tasks/tk-9f2a      a task row
../other/backpressure.dd.json#evidence/bp-7f3a cross-folder reference
```

W10 composability: if done-when becomes a nested completable list, the grammar extends without change — `…/tasks/tk-9f2a/done/dw-11c2`.

## Sections and Shapes (structural model this grammar addresses)

- A dd is a flat list of **sections**; every piece of content lives in a section (even an executive overview → `preamble`). Nothing is outside a section, so nothing is unaddressable.
- Each section has a **type** from the schema package (D14), and a section type declares a **shape** — named parts of primitive kinds. E.g. `phase` = { `brief`: text, `tasks`: completable-table }. *(Refines the exemplar's phase-as-sibling-group model: a phase is ONE section instance with a composite shape.)*

## Link columns — type path in the column, address in the cell

- A link column's **type is a path into the target schema's shape**: `builder/backpressure/section/somelist`. The column pins target schema + level + granularity **once**; validation checks every cell against it.
- Granularity is free: a column may target a single item, a list, a section, or a primitive — the type path names the level.
- The **cell holds only the address string** (the actual file, always — `docname.dd.json#…`; never "any doc of this type"). The target doc's own schema ref (D14) is then *verified* against the column's declared type — resolution never searches.

## Id discipline

| Thing | Identity | Rule |
|---|---|---|
| Section, shape part, field | **Stable name** from the schema | Addressable with no id (`#phases/ph-3f2a/brief`) |
| Instance (phase, table row, list item, log entry) | **Minted short hash**, per-kind prefix | Born once, never reused, unique per file, never positional |

- Prefixes by kind for diff legibility: `ph-` phase · `tk-` task row · `ac-` AC row · `bp-` backpressure row · `lg-` log entry (registry finalized at plan time).
- Rationale (decision space below): plans really do get phases inserted (Phase 0 is a standing recommendation of the backpressure survey) — semantic number-keys would renumber and mass-break links; minted ids make insert/split/reorder free.
- jq-friendliness is a design goal: ids are plain JSON data — `jq '.. | select(.id? == "tk-9f2a")'` works with no dd tooling (depth-1 portability, D7).
- D13 refined, not contradicted: plain prose bullets still carry no ids (not linkable); anything stateful/linkable does.

## Basis & staleness — the per-doc references ledger

*(Revises D9's citation granularity: per-link pins are dropped for per-doc entries. D9's two-refresh-rules split survives unchanged.)*

- Link cells carry **addresses only** — no per-link basis. `@` is **reserved** in the grammar (unbuilt) should a per-link pin ever prove necessary.
- Each doc carries **one references ledger** in its data section (at the bottom): one entry per referenced doc — `{ path, sha, mode: live | pinned }`. All links to that doc share the entry.
  - `live` (transclusions / render inputs): auto-refreshes at render — view freshness; refreshing is always correct.
  - `pinned` (citations): moves **only** by explicit re-verification — decision validity; a changed sha IS the signal.
- **Why this exists (Jordan's rationale, verbatim concept)**: consumers derive state through links. The flow spine (a dd-SDK consumer, not a dd) gates a node on an AC section; if upstream adds a row, a previously-satisfied gate is silently wrong — a flow-in-data bug. The sha detects it mechanically.
- Consumer mechanics: consumers recompute through links at read time (D12); the recorded sha covers everything *between* reads. Non-dd consumers record the same basis-sha beside their `dd_link` in their own storage. The SDK exposes one primitive: `verify-basis(address, recorded-sha) → fresh | stale`; stale ⇒ recompute, never trust cached verdicts, surface it (e.g. orient: "⚠ AC section changed since this gate last held").

## Resolution, path rules & diagnostics

| Rule | Posture |
|---|---|
| Paths relative to the containing doc, POSIX separators, `..` allowed | violation → **WARN** |
| Absolute paths | **WARN** |
| Resolution must land inside the repo; target tracked | violation → **WARN** |
| Target file missing at doctor time | **WARN** |
| Cell fails the column's declared type path (wrong schema/level) | validate **ERROR** |
| Interior segment names a schema part that doesn't exist | validate **ERROR** |
| Id not found in the named collection | validate **ERROR** |

`harness checks` scans for and validates `.dd` files **out of the box** — no per-repo wiring.

## Tooling contract (one resolver engine, three faces)

| Verb | Direction | Job |
|---|---|---|
| `dd address generate` | target → address | produce the canonical address so agents never hand-assemble |
| `dd address validate` | address → verdict | syntax + (optionally) resolution check |
| `dd link resolve` (D16) | address → target | find the doc/section/element an address points at |

## Anchors (rendered `.dd.md`)

**Heading-only.** Sections/parts map to markdown heading anchors; instance-level links land on the nearest heading with the instance id visible in the link text. No HTML anchor mode — precise resolution is dd's job, not markdown's.

## Renames

**No rename machinery — D8 is superseded.** Renaming schema-structural names is rare and breaking: doctor lights up every broken address; you fix them with jq/python/sed. No transactional rewriter, no alias tombstones. (Instance ids never rename — born-once.)

---

## Decision Space

| Option | Description | Decision | Why |
|---|---|---|---|
| Positional interior (`phases/2` = 2nd) | API-like ordinals | **Rejected** | insert silently re-points every downstream link — the exact failure dd exists to kill |
| Semantic keys (`phases/2` = number-key 2) | Stable while data unchanged | **Rejected** | real plans renumber (Phase 0 insertions); renumber = mass link rewrite |
| **Minted ids for instances, names for structure** | Alternating descent | **Selected** | born-once stability; tooling + renders pay the readability cost |
| Per-link `@sha` basis pins | Thinker proposal | **Rejected** (grammar reserves `@`) | N-edit churn per upstream change; per-link epistemic timing never acted on |
| **Per-doc references ledger (live\|pinned)** | One entry per referenced doc | **Selected** | one-line re-verify; same drift signal; feeds consumer gate invalidation |
| `#` file/interior separator | vs uniform slashes | **Selected** | unambiguous boundary; file part may contain `/` |
| Type-scoped bare-id cells | Column type finds the doc | **Rejected** | cells name the actual file — resolution never searches (D11-consistent) |

## Attention Reduction

| Future Loop | Before | After |
|---|---|---|
| Plan pass | grammar open, exemplar notation provisional | one locked shape to specify against |
| Agent link authoring | hand-assembled addresses, munge risk | `dd address generate`/`validate` |
| Flow gate correctness | upstream edits silently invalidate gates | `verify-basis → stale` is mechanical |
| Review | per-link pin churn on upstream change | one ledger line per referenced doc |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|---|---|---|---|
| Grammar + worked examples | § The Grammar | canonical syntax | Ready |
| Id discipline table | § Id discipline | name-vs-id split | Ready |
| Ledger semantics + consumer primitive | § Basis & staleness | gate invalidation | Ready |
| Severity table | § Resolution | validate/doctor behaviour | Ready |
| Decision space | § Decision Space | rejected alternatives stay rejected | Ready |

## Validation / Acceptance

- Every address form in § Worked examples parses under the grammar. ✓ (by construction)
- Each ruling traces to a verbatim Jordan lock in this session's transcript. ✓
- No open addressing questions remain; handed off: gate posture → W2 session; prefix registry + ledger field name → plan pass.

## Open Questions

None within addressing. **Handed off**: nav gate posture (warn vs refuse — W2, with state vocabulary); id-prefix registry finalization and ledger field naming (plan pass).

---

## Addenda (2026-08-03, ruled in the W2+W10 session — `002-w2-w10-completion-and-gating.md`)

1. **Bare-`#` same-doc addresses**: a link targeting its own file omits the file part — `#phase-2-evidence/tk-9f2a`. Survives file rename/move; all other grammar rules unchanged.
2. **Explicit id override**: minted short-hash ids are the **default**; an instance may carry an explicitly-named id where meaning demands it (e.g. an evidence list keyed by its owning task's id, a named section). Uniqueness-per-file + born-once semantics apply unchanged; renaming an explicit id is breaking like any rename (no machinery). Flagged by Jordan as broader than one workshop — the plan pass sweeps it through schema design and validation rules.
3. The gate-posture handoff is **closed**: refuse with `--force` (workshop 002 § Ruling 1).
