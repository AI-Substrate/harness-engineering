# Plan 070 — execution log

Pair: copilot/claude-opus-5 coder (pij-unusual-johansson) + copilot/gpt-5.6-terra
reviewer (pij-rear-leopon), orchestrated by pij-respectable-clam. Live-probe
evidence contributed by Jordan (instrumented cursor session 755f2676).
Branch `feat/070-capture-stall`, base `d8e0cfea`.

## The diagnosis journey (worth recording — three reversals, each on evidence)

1. **Starting theory** (from the 1a501a09 datum): a load-correlated capture
   defect — capture fired once then never again while the transcript grew to
   56 lines; committed a plausible thin ref (~27× under-count).
2. **Candidate killed at the port level**: the sqlite/WAL-throw theory died
   before any probe — `NodeDb.query` catches everything and degrades to zero
   rows; the db path had already run on the capture that succeeded.
3. **Two-mechanism claim, made and refuted in hours**: an archaeology pass
   argued a later invocation saw the complete file and still didn't consume
   (a "stopped consumer"). Refuted: the anchoring commit belonged to a
   DIFFERENT session, and capture is session-keyed — no other session's
   invocation can ever advance a lane's cursor. The refutation's structural
   insight became the design: **a finished session never runs another
   harness command, so residue is unconsumable in-session by design.**
4. **Live confirmation** (instrumented session, log-only diagnostic build):
   transcript frozen at 2 lines/456B across 11 minutes of continuous agent
   work — every adapter read `ok, lines: 2`, zero swallowed throws — then a
   36-line flush at session-idle, and on the next in-session invocation the
   cursor consumed the whole delta in one tick (2→37, at load1 ~72, inside
   the original failure's load band — retiring load-as-proxy). **Root cause:
   cursor-agent buffers its transcript in memory during an agent turn and
   writes at turn boundaries** (it wrote incrementally in June; the cadence
   changed). Capture was correct the whole time; the source materializes
   after the last reader.

## What shipped

- **Deliverable 1 — capture liveness** (`5056f829`): every eligible attempt
  records `<session>.liveness.json` (outcome vocabulary classified from
  observed facts; local-only, pruned with its session). Stall detector
  (2 consecutive anomalies) + **residue detector** (residue > cursor AND
  ≥10 lines, 6h idle) — the only instrument that can catch the lazy-writer
  class. Surface: `harness doctor` layer `capture-liveness`. Proven to FIRE
  on a scrubbed reconstruction of the 1a501a09 shape (fixture asserts the
  stall pattern in itself; publication-safe) and stay QUIET on healthy shapes.
- **Deliverable 3 — orphan-lane reconciliation** (`f670ef4b`): on explicit
  `telemetry sync` (hourly-debounced; the checks auto-sync path structurally
  excluded), stale lanes with residue are re-read via the marker's recorded
  source and the missed segment is emitted — **Segment 2.7
  `capture_mode: 'reconciled'`** (liveness = the field's absence; strict
  readers fail closed), interval-grade t_precision, window end anchored to
  source mtime, two independent idempotence guards, marker-only attribution.
  Recovery window [6h, 14d) with the prune-ordering PINNED by test.
- **Doctor honesty** (`41f6f978`): owed vs UNRECOVERABLE lanes named
  (no-adapter / no-signal / source-gone), no sync suggestion for debts sync
  can't pay, `lost` state for a vanished source — emitted only from recorded
  facts (marker saw position > cursor), never guessed. `prepareLane` is the
  single truth doctor and sync both project — they cannot disagree.

## Review chain

Round 1: **FIX_REQUIRED, two P1s** — both honesty-class, both with reproduced
failing cases: (A) the render channel marked every event inside a recovered
time-range as reconciled (a live `boot` inside the window rendered
reconciled); (B) reconcile mode still passed the recovery shell's env to
adapters (recovered lanes inherited CLAUDE_EFFORT / HOME-selected dbs).
Fixes (`b945a985`), both structural: per-resource `capture_mode` provenance
surviving both the combine-collapse AND collision (interleave + identical-
instant tests; the lossy interval channel DELETED); env made a COMPILE error
in reconcile mode (source-type union with no EnvPort), every adapter env site
individually re-derived, unknowable facts omitted — including deliberately
dropping cursor bubble timing to interval grade rather than borrowing another
install's clock ("losing precision is honest, borrowing is not").
Round 2: **ACCEPT** — reviewer re-ran its mutations plus its own collision
shapes (overlapping recovered ranges, live at both edges) and the hostile
marker-path traversal.

Mutation totals: coder 33 hand-run (all caught; five of its own initially-
vacuous tests found and fixed via the gate), reviewer 5 independent (caught).

## Decided limits (shipped in source, documented here on purpose)

- **Single-worktree sweep** (Jordan's confirmed scope): each worktree heals
  itself; cross-worktree recovery without cross-worktree flush just relocates
  the loss. Family sweep = designed follow-up (`reconcileOrphanLanes(deps,
  root?)` landed; staleness detectable cheaply via per-worktree sweep stamps;
  see the datum's workflow sketch).
- **Teardown tail**: a deleted worktree destroys markers+buffers+watermarks
  together — run `harness telemetry sync` in a worktree before removing it;
  nothing bounds the loss to zero.
- **Last-session-ever tail**: the final session before a repo goes quiet
  stays thin until anything touches the repo again; unresolvable in-design.
