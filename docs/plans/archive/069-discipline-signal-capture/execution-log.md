# Plan 069 — execution log

Pair: copilot/claude-opus-5 coder (pij-urban-platypus) + copilot/gpt-5.6-terra
reviewer (pij-variable-inigo), orchestrated by pij-respectable-clam.
Branch `feat/069-discipline-signal-capture`, base `2984bf98`.

## Item 0 — the diagnosis (before any code)

The read path was **exonerated first**: rebuilding reports + insights over three
real corpus sessions produced non-zero panel rows the moment producers were
fed — the 0/0 panel was starved, not miswired. Both producers were at fault:

- **Push/commit signatures** reached the stream in the wrong form.
  `shellSignature()` keeps only the chain head, so `cd x && git push` records
  as `cd`. Quantified over 859 real chained git lines from 93 sessions:
  **97.1% swallowed** (647 by `cd`, 102 by `git add`, 33 by bare `git`, 30 by
  `set`). The corpus agreed: 101 refs / 1457 segments yielded six `git push`
  markers total, while `cd` was the #1 signature on both flagship harnesses.
  claude-code, copilot-cli, and cursor share the one defective code path;
  copilot-vscode has no shell visibility at all.
- **Checks outcomes** died at the adapter seam: capture is a *preamble*, so at
  capture time the outcome does not exist. Only the claude adapter ever
  emitted a `checks` event, and only when a `--json` envelope happened to land
  in a captured tool_result. Corpus: 8 checks events vs 226 `harness checks`
  verb markers.

## The fixes (write side, one grammar)

1. **`tools.control`** — closed two-member allowlist (`git push`,
   `git commit`) counted anywhere in the line; `signature` keeps its
   chain-head meaning. The read side imports the producer's
   `CONTROL_SIGNATURES` (plan-068 seam rule: one grammar, cannot drift),
   prefers `control`, falls back to `signature` for pre-069 shards, never
   double-counts. `control` joined the burst key so a push can never lose its
   instant to burst merging.
2. **Self-observed checks verdicts** — the harness observes itself at the
   exit chokepoint (housekeeping decorator) where the real envelope exists;
   writes a zero-width verdict segment before the auto-push. Works on every
   harness; reads gates from `data` or `error.details` (a failing gate is the
   case the panel most needs). No session / unknown verdict ⇒ writes nothing.
3. **vscode `models.json` rider — deliberately NOT done**: the file is the
   39-entry model catalogue; its selection-shaped flags name the account
   default, not the user's pick. Stamping it would fabricate. Recorded
   in-code as `MODELS_JSON_RULING`.

## Review chain

- Round 1: **FIX_REQUIRED**, one P1 — copilot-vscode never self-captured:
  vscode detection intentionally yields an empty session id (the preamble
  DB-resolves it later) and the new exit path had no `DbPort`, so the
  truth-table claim "YES (self)" was aspirational. Reviewer ran 4 independent
  Dim-0 mutations (read-side allowlist, fabricated verdict, serializer,
  producer), all caught, byte-identical restores.
- Fix (option A, commit `50bf91be`): extracted the preamble's resolution into
  a shared `resolveDetectedSession()` used by **both** the capture preamble
  and the checks self-observer — lane divergence impossible by construction.
  +3 tests (vscode positive, two null-pins). Coder's mutation gate grew to
  12/12, including one mutation found to have been **silently not-applied**
  after an earlier edit moved its target line — self-reported and re-pointed
  (lesson recorded: re-point string-matched mutations whenever the source
  line changes; re-run the whole gate after any formatter pass).
- Round 2: **APPROVED** — delta verified against the diff, null-pins attacked,
  mutations re-run by the reviewer, full suite green.

## Process notes

- The packet's "no telemetry-ref mutation" bound was **unsatisfiable**: the
  mandated gate (`checks`) auto-pushes buffered telemetry by design. The coder
  flagged it instead of hiding it; the o-prime owned the specification
  contradiction and re-worded the fence template ("no manual sync / no
  mutation of existing refs" — name the hazard, not the surface).
- Historical shards carry no `control`; pre-069 discipline numbers stay
  unmeasurable and are declared as `coverage.push_signatures_unavailable`.

## Follow-ups deliberately out of scope

- `cd` remains the #1 rollup signature (misleading lens; fixing the head
  signature perturbs many fixtures — needs its own plan).
- `git -C <path>` / `git --no-pager` still roll up as bare `git` (global
  flags defeat the subcommand regex); not push/commit-critical since
  `control` scans the whole chain.
