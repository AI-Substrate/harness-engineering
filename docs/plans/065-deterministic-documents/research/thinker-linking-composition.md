> **FROZEN PROVENANCE — verbatim as authored, not maintained.**
> This file records what was said or found at the time it was written. Its terminology,
> shapes, and decisions are **as-written and may not be current** — later rulings supersede
> without editing this file. The authoritative, maintained record of decisions and open
> items is `workshop-notes.md`. Consistency sweeps should **skip this file by design**:
> a stale-looking term here is correct, not a defect.

# Thinker deliverable — Composition and linking between DDs

> Opus 5 subagent deliverable, 2026-08-03, plan 065. Preserved with technical content intact (meta-preamble removed). Syntax marked **[proposed]** is the thinker's proposal — the brief fixes semantics, not notation; the addressing grammar is workshop W9's to lock. Its transclusion/basis split became D9; its derived-index reasoning became D11's grounding.

## Part 1 — The link model: links are values, not strings

### 1.1 The address [proposed]

```
<relative-path>#<section-id>/<element-kind>:<element-id>
e.g.  ../071-checkout-flow/backpressure.dd.json#table:evidence/row:bp-7f3a
```

Three parts, three different id disciplines: path (filesystem, relative to the containing .dd.json, author-chosen), section id (**convention**: derived, never stored by hand), element id (**generated**, unique within file, never reused). The section rule is mechanical and total: a section of type `plan-phase` named "Phase 2" is the same id in *every* plan file, forever — which is what lets the-flow say "phase 2's ACs" without knowing which plan it is looking at. Corollary: two sections of the same type and name in one file is a hard validation error — ids must be derivable, never disambiguated by a `-2` suffix. Path rules: always relative, POSIX separators, `..` permitted, resolution must terminate inside the repo root, target must be tracked. No absolute paths, no crossing a submodule boundary.

### 1.2 The stored value

A link cell is an **object**: `{ "target": "...", "basis": "5d10ab77" }` — `basis` being the first 8 hex of the target document's content sha at the moment the link was recorded (optional; the decision of whether to set it is load-bearing, Part 3.4). A compact string form `...@5d10ab77` is accepted on input and normalised to the object on write.

### 1.3 The column declaration — a link column declares its target shape

```json
{ "key": "back-pressure-evidence", "type": "link",
  "target": { "dd": "backpressure", "section": "table:evidence", "element": "row" },
  "cardinality": "1",
  "display": ["mode", "paved_command", "certainty"] }
```

Four things a bare hyperlink cannot give: (1) `target.dd` is a document **type**, not a path — the schema constrains the *shape* of the relationship while leaving repo layout free; (2) `target.section` is checked before the file is even opened for rows; (3) `cardinality` ∈ `"1" | "0..1" | "1..n" | "0..n"` — `"1"` on an AC's evidence column makes "every AC must name its proof" a *schema* fact instead of a review habit; (4) `display` names which columns of the pointee to inline when rendering — the brief's "UI overview / summary" made deterministic.

### 1.4 Inline links in free text [proposed]

Markdown link syntax with a `dd:` scheme — the prefix is the opt-in: doctor enforces `dd:` links and ignores plain Markdown links, so prose can still link to a blog post without becoming a broken-link error. On render the scheme is stripped and the path rewritten to `.dd.md`.

## Part 2 — The worked example (payment capture in a checkout flow)

Four files: `plan.dd.json` (sha `9c4e21b8`), `backpressure.dd.json` (sha `5d10ab77`), `the-flow.json`, `tasks/phase-2-payment-capture/tasks.dd.json`. The backpressure evidence table carries rows `bp-7f3a` (RUN · `npm test -- test/checkout/decline-path.test.ts` · computational · strong) and `bp-2e88` (BUILD→RUN · `harness check checkout-idempotency` · partial). The plan's AC table (completable-table) carries `ac-4b1c` (complete, evidence "decline-path suite green at 3f9a10c", back-pressure-evidence → `row:bp-7f3a` basis `5d10ab77`) and `ac-9d02` (incomplete, → `row:bp-2e88`).

Rendered AC table:

```markdown
| Done | Criterion | Back-pressure evidence | id |
| :--: | --- | --- | --- |
| [x] | Declined card at capture returns a retryable error and preserves the cart | RUN · `npm test -- …decline-path…` · strong → bp-7f3a | `ac-4b1c` |
| [ ] | Retrying a capture with the same idempotency key never double-charges | BUILD→RUN · `harness check checkout-idempotency` · partial → bp-2e88 | `ac-9d02` |
```

Read the second row: an unticked AC whose named proof does not exist yet and whose certainty is partial — visible on the plan page, at a glance. **The link column turns "is this plan actually provable?" into a table you can read.** Two rendering facts to fix early: the JSON address points at `.dd.json`, the renderer rewrites to `.dd.md`; and Markdown has no row anchors without raw HTML — default render lands on the section heading anchor with the row id in the link text (precise row resolution is dd's job, not Markdown's; opt-in `anchors: html` where the consumer allows it).

The tasks dossier, one folder down, demonstrates traversal (`../../plan.dd.json#…`) and two link columns per done-when row: `proof` (→ backpressure rows, `1..n`) and `implements` (→ plan AC rows, `1..n`). Nothing about an address changes when a document moves except its path prefix — section and element ids are position-independent.

## Part 3 — Transclusion vs reference, and the single-writer property

### 3.1 Two verbs, one syntax

| | **Reference** (link) | **Transclusion** (include) |
| --- | --- | --- |
| Consumer's .dd.json stores | the address (+ optional basis) | the address **only** |
| Consumer's .dd.md shows | a link plus the display summary | the **full rendered body** of the target section |
| Reader's sense | "this is elsewhere, here's a handle" | "this is here" |
| Writes | n/a | routed to the owner |

### 3.2 The include directive & the spine

An include stores `source` + `mode: read-only`. In the-flow, the spine node holds nothing but the pointer: `dd_link: { include: "./plan.dd.json#…acceptance-criteria", mode: "transclude", gate: "all-complete" }`. Nav reads completion *through* the link — the same mechanic as chores, but the checkboxes live in the plan.

### 3.3 The single-writer property — why "update in one place updates the other" is free

**Every section has exactly one owning document: the file it is literally defined in. A transcluded section is never copied into a consumer's .dd.json.** That single rule does all the work: the .dd.json stores a pointer; the .dd.md stores a copy but is a build artifact, regenerated on every edit — a stale copy is not "reconciled", it is *unrepresentable*. There is no second writer, so there is no merge: "updating in one place updates the other" is not synchronisation — **there is only one place**. Writes addressed at a transcluded row are resolved by dd to the owner file and applied there; the consumer is structurally read-only. Any design where a consumer could persist its own version of a transcluded row reintroduces two writers, and with them a sync protocol, conflict rules, and eventual divergence. Include graphs must be acyclic (doctor rejects cycles); basis edges are exempt — they are epistemic, not compositional.

### 3.4 The sharp rule

**Transclude what must never diverge; reference-with-basis what you want to be told about.** Transclusion is live and never drifts — pinning it would be meaningless. A reference with a basis is a snapshot of an epistemic dependency, and drift is exactly the signal you want: when an AC says "my proof is bp-7f3a" and someone later downgrades that row, the AC's owner must be told. So: flow → plan ACs is a transclusion; plan AC → backpressure evidence is a reference with basis; survey → plan is a basis. Same address syntax; three intents, each named.

## Part 4 — Drift defence: making links checkable

### 4.1 Two invariants

(1) **Content SHA** — recomputed on every edit, over section content, **excluding front matter and excluding the `basis` field of any link value** (so refreshing a stale pin does not churn the sha — which is what lets two documents pin each other without ping-ponging). (2) **Stable ids** — an address is a durable name, not a line number.

### 4.2 What doctor checks, per link

| # | Check | Severity |
| --- | --- | --- |
| 1 | path resolves, tracked, inside repo root | ERROR |
| 2 | target's `dd.type` matches the column's `target.dd` | ERROR |
| 3 | section id present in target | ERROR |
| 4 | element id present and of declared kind | ERROR |
| 5 | cardinality satisfied (`"1"` ⇒ non-empty) | ERROR |
| 6 | `basis` equals target's current content sha[:8] | **WARN: DRIFT** |
| 7 | include graph acyclic; includes read-only | ERROR |
| 8 | inbound-link coverage rules (4.4) | WARN |

Check 3's consequence: renaming a section breaks every inbound link **loudly** — the intended trade; mitigation is an explicit `aliases` list resolving with a deprecation warning.

### 4.3 What this repo's corpus looks like today (measured)

- **11 backpressure surveys exist**, all as Markdown tables, no structured variant.
- **Exactly one records a basis** (063). **That one basis is already stale** — the plan file now hashes differently; the single document that tried to do this correctly has been silently orphaned from the plan version it was written against, and nothing noticed. Check 6 is a one-line WARN that would have caught it the day it happened.
- **Survey rows have no ids at all** — a row is addressable only by its exact criterion text plus file path; a link is literally unwritable today.
- **Proof lines are selected but folding is unenforced** — 063's own artifact says "Selection, not enforcement… the proof lines below are what the plan owner folds into each task's Done When"; 063 phase-1's tasks carry a Backpressure basis header, phases 2–3 carry none; plans 033/051/056/058 have zero backpressure references in task files.

### 4.4 The archaeology-to-query conversion

> Every `table:evidence` row whose mode is RUN must have ≥1 **inbound** link from a tasks DD's done-when. Zero inbound = an **unfolded proof**.
> Every AC row must carry a back-pressure-evidence link (cardinality). Zero = an **unproven criterion**.

Both are inbound/outbound edge counts over a graph the documents already declare. The link *type* turns a question that costs an afternoon of archaeology into an exit code.

## Part 5 — The graph view

Nodes: plan.dd.json (criteria owner) · backpressure.dd.json (evidence owner) · the-flow.json (navigation, owns nothing) · tasks.dd.json (execution). Edges: AC→evidence references (pinned), flow→AC transclusion (read-only, gate all-complete), tasks→evidence proof + tasks→AC implements (pinned), survey→plan basis. Derived-artifact edges dashed (renders-to). Three things the drawing makes obvious: (1) the evidence doc is a sink for content and a source for basis; (2) the AC↔survey loop is legal — cycle detection applies to include edges only, and the sha rule keeps mutual pins from oscillating; (3) **the flow spine has exactly one edge and owns nothing — the node with the most authority in the workflow has the least data.**
