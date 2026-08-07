> **FROZEN PROVENANCE — verbatim as authored, not maintained.**
> This file records what was said or found at the time it was written. Its terminology,
> shapes, and decisions are **as-written and may not be current** — later rulings supersede
> without editing this file. The authoritative, maintained record of decisions and open
> items is `workshop-notes.md`. Consistency sweeps should **skip this file by design**:
> a stale-looking term here is correct, not a defect.

# Workshop dispositions — ruled/steered by Jordan 2026-08-03 (PM capture, off-tree)

> For recording into workshop-notes.md. Jordan's dictation in the koala
> session; PM notes marked (PM). Governs how each remaining W-item enters the
> builder flow (workshop mode per item, per Jordan).

## Standing design rule (record prominently — applies to ALL of dd)

**R-elegance (Jordan): "we must be elegant and not over-engineer."** Every
workshop outcome and schema/verb design is measured against this first.

## Per-workshop dispositions

- **W1 — render adapters (DIRECTION RULED)**: a tiny `.ts` adapter — a
  function that takes the value in and returns the markdown out — is the whole
  mechanism. Plus a small sample in the dd help text showing how to write one.
  No adapter framework, no registration ceremony beyond the schema package
  folder (D14). Workshop confirms shape only.
- **NEW — dd help/docs system (RULED, surfaced by W1)**: the dd command needs
  help docs just like harness docs — `dd docs list` and `dd docs get`; one of
  the docs must be "how to add a new schema, including its md adapter."
- **W2 — completion states (DIRECTION RULED)**: ship sensible default state
  enum(s) with the built-in completion-state type; custom schemas may define
  their own state vocabularies and their adapters handle rendering them.
  Defaults shipped, rest delegated to schemas+adapters. Workshop confirms:
  which defaults, and which states gate nav vs pass-with-record (the D4
  human-skipped receipt question stands).
- **W3 — evidence entries (DIRECTION RULED)**: append-only log, free-text
  entries, links inside them. No typed entry kinds for now (deferred, not
  dead). Plus NEW verb idea from Jordan: `dd link resolve` — take a link text
  and find the doc + section it points at. (PM: endorsed; it is the
  interactive face of the same resolver validate already needs — one engine,
  two callers; fits D6's graph family alongside `dd links <target>`.)
- **W7 — dd build (DEFERRED)**: no workshop now; iterate on the open
  questions when we render real output ("iterate on further questions when we
  render it").
- **W8 — validate radius (CLOSED, no workshop)**: default depth 3 or 4, CPU
  cost is tiny. The REAL requirement: very good loop breakers so build and
  validate never recurse infinitely (cycle detection on the walk, not just on
  include edges). (PM: record default choice 3 vs 4 at implementation;
  either is fine per Jordan.)
- **W9 — addressing (WORKSHOP STANDS)**: full session; Jordan wants to be
  asked questions one at a time when we get there.
- **W10 — done_when granularity (LEANING RULED)**: Jordan leans nested
  completable-list ("nested completable per phase?" — PM: exemplar frames
  this per task ROW; per-row vs per-phase to be pinned in the workshop, it
  changes the addressing depth W9 must support).

## Flow note

Jordan directs: work these through the /builder flow in workshop mode, one
per item. Sequencing (PM): W9 first, then W10+W2, W1/W3 confirmations, W7/W8
folded in as implementation notes.
