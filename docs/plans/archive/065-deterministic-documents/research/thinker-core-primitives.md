> **FROZEN PROVENANCE — verbatim as authored, not maintained.**
> This file records what was said or found at the time it was written. Its terminology,
> shapes, and decisions are **as-written and may not be current** — later rulings supersede
> without editing this file. The authoritative, maintained record of decisions and open
> items is `workshop-notes.md`. Consistency sweeps should **skip this file by design**:
> a stale-looking term here is correct, not a defect.

# Thinker deliverable — DD core concept & section primitives

> Opus 5 subagent deliverable, 2026-08-03, commissioned for plan 065. Preserved verbatim (agent meta-preamble removed). NOTE (parent context): written before workshop decisions D2/D4 — its `complete: bool` + inline-evidence examples were superseded by the state-enum + signpost-links design; its id-derivation, integrity-envelope, and include/record proposals fed sections 02–04 of the infographic and W6/W9.

**Running example throughout:** a checkout-flow feature plan at `docs/plans/071-checkout-flow/plan.dd.json`, rendering to `plan.dd.md` beside it.

## Part 1 — What a deterministic document is

> A **deterministic document (DD)** is a document whose source of truth is structured data: a `.dd.json` file in which every section declares its type, every element carries an id, and the human-readable `.dd.md` is *generated* beside it rather than authored. Because the structure is declared in the file itself, `dd validate` can check the document without consulting any external registry; because every write re-renders and re-hashes the content, the markdown cannot drift from the data, and any consumer — a flow node, a check, another DD — can bind a decision to the exact content it saw.

The word *deterministic* is load-bearing in four specific ways:

| Property | Mechanism | Consequence |
| --- | --- | --- |
| **Machine-validatable structure** | Section `type` + `primitive` declared in-file; table columns carry types | "Is this a phase? are these ACs?" is answered by reading a field, not by inference |
| **Single-writer rendering** | `.dd.md` is written only by `dd render`, never by hand | One representation, two views — the prose view can never disagree with the data |
| **Content hashing** | `content_sha256` over canonical `sections`, excluding metadata | Identical content → identical bytes → meaningful diffs, and drift is detectable |
| **Stable addressability** | Convention-derived section ids + born-once element ids | `plan-phase-ac.phase-2/ac-7f3a91c4` resolves from anywhere in the repo, forever |

### The failure mode it kills: "coding in markdown"

Markdown documents that carry operational state are programs written in a language with no parser. Four concrete rots:

1. **Structure exists only in the reader's head.** A heading level, a bold label, a bullet convention — an agent must re-infer the document's schema on every session, spends tokens doing it, and different agents infer differently. Nothing detects a wrong inference; the work just quietly proceeds on a misreading.
2. **Checkboxes rot.** `- [x] Handles declined cards` has no id, no author, no timestamp, and no reason. You cannot ask *who ticked it*, *when*, or *on what evidence* — and nothing can refuse a tick that has no proof behind it. Ticks accumulate optimism.
3. **Sections drift.** Rename a heading and every "see the Acceptance Criteria section" reference silently points at nothing. No error fires.
4. **Nothing is addressable, so everything is copied.** You cannot say "AC-3 of phase 2 of the checkout plan" in a form a tool can resolve, so the flow spine keeps its own copy of the ACs and the plan keeps another. Two copies of a truth diverge; that is the only thing two copies reliably do.

A DD closes each one: (1) the structure is a field, (2) a tick is a record with an id and a required evidence sibling, (3) an unresolvable reference is a `dd doctor` error, (4) linking replaces copying.

### What a DD is *not*

A DD is not "markdown without prose." Free-text sections keep full prose, and most of a plan remains prose. What changes is that prose now lives *inside a named, typed, addressable slot* instead of being the container that the structure has to be guessed out of.

## Part 2 — The section-primitive taxonomy

Every section carries four attributes: **`type`** (semantic role in the doc type: `plan-objective`, `plan-phase-ac`, `bp-evidence` — many and open), **`primitive`** (the shape — few and closed), **`name`** (human label), **`id`** (derived from type + name). A `plan-phase-ac` section and a `bp-evidence` section are different types sharing one primitive.

> **Note on `link`:** a link is a *column/field type*, not a section primitive. Links live inside tables and records so they always arrive with a labelled slot and a declared target.

### 2.1 `free-text` — prose in a named, addressable slot

Purpose: hold narrative that is meant to be read, not computed over, without letting it become the container for structure.

### 2.2 `list` — a flat enumeration with no state

Purpose: bullets read as a set, carrying nothing anything else needs to point at. **Design call (deviates from brief line 54):** `list` items are plain strings with **no ids**. The rule that makes this safe: *an element gets an id when it carries state or is a link target.* Wanting to link to a `list` item means you needed a `completable-list`, and promoting the section is the correct fix.

### 2.3 `completable-list` — ticks with mandatory evidence

The acceptance-criteria primitive, and the thing nav gates on. **The rule that makes it worth having:** a completed item with an empty evidence is a `dd validate` **error**, not a warning. The tick and the reason for the tick are stored in the same record, so an unevidenced tick is not expressible in a valid document.

### 2.4 `completable-table` — typed columns, including links to other DDs

Same completion semantics, for when a tick needs more fields. Column types: `string`, `int`, `bool`, `link`. Three precise points from the worked example:

- **A typed link subsumes the brief's `back-pressure-evidence` column type.** Rather than minting a column type per referent kind, `link` carries a `target: { doc_type, section }` constraint — the same guarantee, one mechanism, works for any future doc type without a code change.
- **The stored ref points at `.dd.json`; the rendered link points at `.dd.md`.** Data references data; the renderer maps to the human view.
- **The link label is pulled from the referenced row** — the brief's "UI overview / summary", with a useful side effect: a label can only be produced if the referent resolves, so a broken cross-document link fails visibly at render time.

### 2.5 `record` — typed key/value header *(proposed beyond brief)*

The small set of facts about a document that must be queryable and linkable but are not a list — owner, target, linked flow, phase count. Without it, exactly this content gets stuffed into a `free-text` section as a bolded pseudo-table — the "coding in markdown" failure mode reappearing *inside* a DD.

### 2.6 `include` — transclusion of another DD's section *(proposed beyond brief)*

Single-sourcing (brief lines 60–61). An `include` section stores a *reference plus a hash*, never a copy; the `.dd.md` renders the referenced content inline; the `.dd.json` never contains it. **`included_sha256` is what makes an include deterministic rather than a slow copy-paste** — `dd doctor` recomputes the source section's hash; a mismatch means this document's render is stale.

### What each primitive buys the tooling

| Primitive | `validate` can assert | `nav`/`checks` can gate on | Linkable target |
| --- | --- | --- | --- |
| `free-text` | present, non-empty | presence only | section |
| `list` | item count bounds | presence only | section |
| `completable-list` | every tick has evidence | **all items complete** | section + item |
| `completable-table` | column types, link targets resolve + right doc type | **completion column all true** | section + row |
| `record` | required keys present and typed | field-value assertions | section + field |
| `include` | source resolves; `included_sha256` current | render freshness | section (pass-through) |

## Part 3 — Two id regimes

### 3.1 Section ids are stable and derived

`id = slug(type) + "." + slug(name)`, with one reduction: **a doc-type-singleton section's id is just `slug(type)`.** Properties: semantic (readable without opening the file), greppable, **predictable before the file exists** (a flow node can carry a dd-link written by convention, reported as dangling until authored — the link is designed, not discovered), survives file copies. **Invariant:** section ids unique *within a file* (same type+name twice = validate error). Global uniqueness is neither required nor wanted — the point is the same id means the same thing in every file.

### 3.2 Element ids are unique and born once

`<element_prefix>-<8 hex>` (e.g. `ac-7f3a91c4`, `ev-4c81a0`). Generated once by the writer, never re-derived from content, never reused. Unique within the file; cross-document references are path-qualified, so repo-global uniqueness is unnecessary.

### 3.3 Why two regimes

**Sections are addresses. Rows are records.** An address should be guessable, readable, identical across files. A record must survive being re-worded, re-ordered, re-rendered, because it carries state other documents bound themselves to. If row ids were derived from row text, a clarifying edit would be delete-plus-create — silently discarding completion state and orphaning every reference. Chosen by asking *what breaks when this thing is renamed*: section — renaming should be a visible, deliberate, repo-wide operation → id derived from name; row — renaming should change nothing → id independent of text.

### 3.4 The known hard case: section renames

Deriving section ids from names has one unavoidable cost: renaming changes the id and every inbound link now points at nothing. Survivable because: (1) **the repo is a closed world** — doctor in `checks` makes a dangling reference build-visible the moment it appears (worst case it breaks loudly, the correct failure); (2) **rename is a first-class operation** — `dd rename-section` recomputes the id and rewrites every inbound reference across the repo in the same transaction; (3) **optional alias tombstones** — `prev_ids: [...]` keeps external/in-flight links resolving with a "resolved via alias, update the reference" warning. Reordering is free (ids are name-derived, not positional); duplicating a name within a file is a validate error, not a silent collision.

## Part 4 — The integrity envelope

### 4.1 Schema in the file

Two layers: **structural** (in-file, always sufficient — every section declares its primitive, every table its columns; any reader can parse, resolve, type-check with zero external files — this layer makes DD portable) and **completeness** (which sections are required, in what order, singletons — defined by the named doc-type schema, versioned, shipped with the owning verb).

> **Open call for the workshop (→ W6):** the brief says files "contain their schema". Recommended reading: inline the *instance-varying* structure, reference *doc-type* rules by name — fully inlining a JSON Schema into every document makes files large and lets schemas drift copy by copy. The alternative (full inline, absolute portability, no registry) is defensible and should be decided explicitly.

### 4.2 `edited_at` — ISO-8601 UTC, written on every mutation. Freshness questions with no git access; cheap first-pass ordering for stale renders.

### 4.3 `content_sha256` — over content, not the file

`content_sha256 = SHA-256(canonical_json(doc.sections))`. **Canonicalization must be specified or the hash is not reproducible**: keys sorted, no insignificant whitespace, UTF-8, LF, shortest round-trip numbers. Scope deliberately excludes `dd` and `meta` — timestamps and metadata churn do not move the hash. Buys: (1) **render-drift detection** (renderer stamps the sha into the .md banner; doctor re-renders in memory and compares — catching both a stale .md and a hand-edited one); (2) **idempotent writes and meaningful diffs** (a no-op edit is byte-identical; a .dd.json diff is always a real content change); (3) **basis-binding** (the 063 pattern generalized — and improved: 063 hashes the whole plan file, so a metadata touch falsely invalidates a valid review; a content-scoped sha invalidates when and only when reviewed content changed). **Extension worth considering (not v1):** per-section sha alongside the document-level one, so a review bound to one section stays valid when an unrelated section moves — surgical re-opening.

## Part 5 — Anatomy of a `.dd.json`

(Envelope `dd` — what kind of document this is, interpretable with no external lookup; `meta` — timestamp + content hash for drift detection and basis binding; sections — prose in an addressed slot, plus a completable section holding ACs whose ids outlive every re-wording. An open item means nav refuses to advance; a ticked item could not have been ticked without its evidence.)

## Cross-cutting notes for the rest of the brief

- **The flow-spine dd-link shape is `{ file, section }` with a convention-derived section id** — writable before the plan exists, greppable afterwards.
- **`link` as a column type with a `target: { doc_type, section }` constraint replaces per-referent column types.**
- **`include` + `included_sha256` is the single mechanism for "updating in one place updates the other."**
