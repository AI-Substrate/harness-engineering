# PM handover — Deterministic Documents (plan 065)

*(From silkworm to related-koala, 2026-08-03, on Jordan's direction: "koala will be pm". Everything below lives in this worktree — `harness-engineering-worktrees/s065-deterministic-documents`, branch `s065/deterministic-documents`.)*

## The concept in one paragraph

A **Deterministic Document** is a document stored as validated data: a `.dd.json` file (naming its schema by reference, content hash over sections) with a generated, human-readable `.dd.md` beside it. Sections are typed primitives (free-text, list, completable-list, completable-table, append-only log, record, include). Anything stateful or linkable gets a stable address; typed links between documents carry target shape and cardinality, so a CLI can validate the whole graph mechanically. The payoff: another process — like a workflow engine — can *compute* gates from document state ("all acceptance-criteria rows are done") instead of an agent remembering to tick a box. Knowledge lives in one graph (the documents), workflow in another (the flow spine), bridged by one typed link.

## Reading order

1. **`initial-brief.md`** — Jordan's dictated brief. Primary source of intent.
2. **`workshop-notes.md`** — THE authoritative rulings doc: decisions D1–D14 (each verbatim-quote grounded; D14 captured via the PM's session), open workshops, and the three-tier validation lessons. Where this and anything else disagree, this wins.
3. **`dd-infographic.html`** — the shared-understanding window ("AI Substrate presents — Deterministic Documents"). Open in a browser; it is the aligned picture of the concept Jordan and silkworm converged on. To check it mechanically use `harness html-snap` (see below).
4. **`exemplar-plans-as-dd.md`** — the first exemplar implementation target: composing a *plan* as a DD, phases in focus, grounded in real plan 063. Includes the schema sketch and the W10 question it surfaced.
5. **`research/`** — full provenance: `workshop-dialogue.md` (verbatim Jordan rulings in sequence), `survey-recent-plans.md` (7-plan backpressure/spine survey + the reproducible 54-file "no requirement-like structured keys" scan), and four `thinker-*.md` deep-dives (core primitives, linking/composition, verbs/lifecycle, flow integration — each annotated where later rulings superseded them).

## Living vs. frozen — the other split that matters

The plan folder has two halves, and a sweep must treat them differently:

- **Living** (must track every ruling): `workshop-notes.md`, `pm-handover.md`, `dd-infographic.html`, `exemplar-plans-as-dd.md`.
- **Frozen provenance** (must NOT be updated): `initial-brief.md` and everything under `research/`. Each carries a banner saying so. Their terminology and shapes are as-written; a stale-looking term there is correct, not a defect.

Why it's marked rather than remembered: after a ruling lands, someone sweeps the corpus for contradictions, and the frozen half will look wrong every single time. The banner lets the sweep scope itself instead of re-deciding file by file. Two defects of exactly this class have already been caught here — a doc that was true when written and became false when something else was ruled — so sweep by **concept**, not by label: searching the W-item number misses any doc that asserts a superseded model without naming it.

## Decisions vs. open items — the split that matters

- **Standing rule — R-elegance**: "we must be elegant and not over-engineer" (Jordan). Measured against first, before any other criterion.
- **Ruled (D1–D16)**: write posture (validated file, not CLI-mediated store), AC rows as signposts with `pressure`/`proven_by` links, execution-log-as-DD (append-only), states-not-booleans, spine links-never-copies, graph tooling first-class, portability (lib inside harness now; standalone CLI out of scope; concepts are the contract), transactional rename, contributors-manifest vs basis-pin (two hash ledgers, opposite refresh rules), source-only links with computed reverse lookup, ids only where state/linkability demands them, two-graphs-one-bridge.
- **Open, but every one now has a disposition from Jordan (2026-08-03)**: **W9 addressing** is the only full workshop that stands (and Jordan wants to be asked one question at a time); **W10** leans nested completable-list with per-phase-vs-per-row to pin; **W2** ships default states with custom vocabularies delegated to schemas+adapters; **W1** is a tiny `.ts` value→markdown function, shape-confirm only; **W3** is append-only free-text entries with links, typed kinds deferred; **W7** deferred until real rendered output exists; **W8 closed** (default depth 3–4, real requirement is loop breakers on the walks). W6 was resolved by supersession as D14. Jordan directs these run through **the /builder flow in workshop mode, one item at a time**. **Still true and still the rule: nothing here may be silently promoted to settled in the plan beyond what its disposition says.** **These are the plan's workshop backlog — the plan must not silently promote any of them to settled.** The final validator pass flagged exactly this failure mode (enforcement strength and address syntax reading as settled when they are open).

## Tooling you inherit

- **`harness html-snap`** (extension at `.harness/extensions/html-snap/`, tests green): headless-Chrome screenshot of any HTML at an offset (`--offset/--crop-height/--slices`), plus `--structure` for a stack-based parse check. Its `instructions.md` records the proven failure modes (sips center-crop at offset 0, Chrome's 500px window floor, browsers error-recovering broken markup) — read it before trusting any screenshot.
- **Validation reports** (root repo, gitignored): `.harness/temp/validate-065/report.md` and `.harness/temp/validate-065-final/report.md` — two independent fresh-agent comprehension tests of the page against the corpus. All findings from both were resolved; they remain useful as a model of what a cold reader trips on.

## Process state (as of this handover)

- Branch `s065/deterministic-documents` off `ad4882a0`, ~24 commits, all inside two pathspecs: `docs/plans/065-deterministic-documents/**` and `.harness/extensions/html-snap/**`.
- Governance: prime is `pij-massive-meadowlark`. Currently an **open iteration window** (Jordan still editing the page via silkworm); on Jordan's "done", silkworm sends one final pin and prime runs convergence: PR A = html-snap as its own `feat(harness)` PR, then PR B = docs. Branch never rewritten; docs and extension commits stay separate.
- Writing rule (Jordan, twice): outward artifacts are for readers who do NOT share our context. Plain-first, every term introduced with its meaning; "assuming the reader has Jordan's knowledge" is a named failure mode.

## What the PM job is from here

**Jordan has directed the plan to proceed via the /builder flow in workshop mode, one W-item at a time.** PM sequencing: W9 first (everything depends on the address grammar), then W10 + W2 together, then the W1/W3 shape confirmations, with W7/W8 folded in as implementation notes.

Jordan's sequencing: concept alignment first (done — the page), then the plan. Next steps as silkworm understands them: run the open workshops (W9 addressing first — everything depends on it), then drive the 065 plan through the flow with the plans-exemplar as phase one's target. The concept is portable by design (D7): keep dd-core a cleanly separated lib inside the harness repo, harness/plans as first consumer.
