# PM handover — Deterministic Documents (plan 065)

*(From silkworm to related-koala, 2026-08-03, on Jordan's direction: "koala will be pm". Everything below lives in this worktree — `harness-engineering-worktrees/s065-deterministic-documents`, branch `s065/deterministic-documents`.)*

## The concept in one paragraph

A **Deterministic Document** is a document stored as validated data: a `.dd.json` file (schema in-file, content hash over sections) with a generated, human-readable `.dd.md` beside it. Sections are typed primitives (free-text, list, completable-list, completable-table, append-only log, record, include). Anything stateful or linkable gets a stable address; typed links between documents carry target shape and cardinality, so a CLI can validate the whole graph mechanically. The payoff: another process — like a workflow engine — can *compute* gates from document state ("all acceptance-criteria rows are done") instead of an agent remembering to tick a box. Knowledge lives in one graph (the documents), workflow in another (the flow spine), bridged by one typed link.

## Reading order

1. **`initial-brief.md`** — Jordan's dictated brief. Primary source of intent.
2. **`workshop-notes.md`** — THE authoritative rulings doc: decisions D1–D14 (each verbatim-quote grounded; D14 captured via the PM's session), open workshops, and the three-tier validation lessons. Where this and anything else disagree, this wins.
3. **`dd-infographic.html`** — the shared-understanding window ("AI Substrate presents — Deterministic Documents"). Open in a browser; it is the aligned picture of the concept Jordan and silkworm converged on. To check it mechanically use `harness html-snap` (see below).
4. **`exemplar-plans-as-dd.md`** — the first exemplar implementation target: composing a *plan* as a DD, phases in focus, grounded in real plan 063. Includes the schema sketch and the W10 question it surfaced.
5. **`research/`** — full provenance: `workshop-dialogue.md` (verbatim Jordan rulings in sequence), `survey-recent-plans.md` (7-plan backpressure/spine survey + the reproducible 54-file "no requirement-like structured keys" scan), and four `thinker-*.md` deep-dives (core primitives, linking/composition, verbs/lifecycle, flow integration — each annotated where later rulings superseded them).

## Decisions vs. open items — the split that matters

- **Ruled (D1–D14)**: write posture (validated file, not CLI-mediated store), AC rows as signposts with `pressure`/`proven_by` links, execution-log-as-DD (append-only), states-not-booleans, spine links-never-copies, graph tooling first-class, portability (lib inside harness now; standalone CLI out of scope; concepts are the contract), transactional rename, contributors-manifest vs basis-pin (two hash ledgers, opposite refresh rules), source-only links with computed reverse lookup, ids only where state/linkability demands them, two-graphs-one-bridge.
- **Open (W1–W3, W7–W10)**: render adapters for custom types, the exact state vocabulary and skip authority, log entry kinds, `dd build` semantics, validate radius, the full addressing grammar (W9 — load-bearing, deserves its own session before the plan locks anything; now also owns the name-vs-path second reference kind from D14), and `done_when` granularity (W10). (W6 schema depth was resolved by supersession as D14: by-reference named schema packages.) **These are the plan's workshop backlog — the plan must not silently promote any of them to settled.** The final validator pass flagged exactly this failure mode (enforcement strength and address syntax reading as settled when they are open).

## Tooling you inherit

- **`harness html-snap`** (extension at `.harness/extensions/html-snap/`, tests green): headless-Chrome screenshot of any HTML at an offset (`--offset/--crop-height/--slices`), plus `--structure` for a stack-based parse check. Its `instructions.md` records the proven failure modes (sips center-crop at offset 0, Chrome's 500px window floor, browsers error-recovering broken markup) — read it before trusting any screenshot.
- **Validation reports** (root repo, gitignored): `.harness/temp/validate-065/report.md` and `.harness/temp/validate-065-final/report.md` — two independent fresh-agent comprehension tests of the page against the corpus. All findings from both were resolved; they remain useful as a model of what a cold reader trips on.

## Process state (as of this handover)

- Branch `s065/deterministic-documents` off `ad4882a0`, ~24 commits, all inside two pathspecs: `docs/plans/065-deterministic-documents/**` and `.harness/extensions/html-snap/**`.
- Governance: prime is `pij-massive-meadowlark`. Currently an **open iteration window** (Jordan still editing the page via silkworm); on Jordan's "done", silkworm sends one final pin and prime runs convergence: PR A = html-snap as its own `feat(harness)` PR, then PR B = docs. Branch never rewritten; docs and extension commits stay separate.
- Writing rule (Jordan, twice): outward artifacts are for readers who do NOT share our context. Plain-first, every term introduced with its meaning; "assuming the reader has Jordan's knowledge" is a named failure mode.

## What the PM job is from here

Jordan's sequencing: concept alignment first (done — the page), then the plan. Next steps as silkworm understands them: run the open workshops (W9 addressing first — everything depends on it), then drive the 065 plan through the flow with the plans-exemplar as phase one's target. The concept is portable by design (D7): keep dd-core a cleanly separated lib inside the harness repo, harness/plans as first consumer.
