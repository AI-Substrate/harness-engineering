# Plan 069 — discipline signal capture (make the panel able to report a non-zero)

Base: `origin/main @ 2984bf98` (recorded at branch time, per the o-prime's
tip-check rule).

## Problem

The insights **discipline panel** (§2.3, `insights.ts` — rows for
observe-before-work, record usage, boot discipline, checks-before-push) and
§7's `checks_before_push` column read **0/0 on every harness including
claude-code** — measured empirically across the whole corpus during the
2026-08-04 richness review. The o-prime's framing, now doctrine: *a panel that
reads 0/0 universally is not measuring low discipline, it is measuring
nothing* — the read path (`report.ts:401` `TIMELINE_BASH_SIGNATURES`, the
control-timeline joins) sits ready and NO adapter feeds it. This was ranked
the single highest-value capture gap corpus-wide: it is the one place the
flagship harness is also blind.

## What the read path expects (verified in the richness review)

- `checks` events (kind exists in `events.ts`, `ChecksStatus = ok|degraded|error`)
  reaching the event stream → control-timeline `checks` markers.
- `tools` events whose FX001 `signature` is `git push` / `git commit` →
  control-timeline `bash` markers (`TIMELINE_BASH_SIGNATURES`).
- `harness` verb events already flow (the only lane that works today).

## Item 0 — DIAGNOSIS FIRST (mandatory, shapes everything after)

The claude baseline session had 148 signature-bearing shell tool calls and 16
bash-command rollup rows, yet its control timeline contained ZERO `bash`
markers and ZERO `checks` markers. Before writing any emit code, determine —
with evidence from a real session export — for each harness:

1. Are `git push`/`git commit` invocations reaching the stream at all, and if
   so under what signature form? (Suspect: FX001 `shellSignature`
   normalization emits a form that never equals the exact strings
   `TIMELINE_BASH_SIGNATURES` matches, e.g. subcommand dropped or flags
   folded. If so the fix may be READ-side matching or WRITE-side signature
   shape — choose deliberately, do not change both without need.)
2. Where do `checks` outcomes die? The claude adapter has the full result
   envelope; `outcomes.checks` exists in the rollup. Is a `checks` EVENT ever
   emitted into the stream, by any adapter?

Record the diagnosis in the dossier-bound done-report BEFORE the fix commits.

## Items 1..3 — the fixes (shaped by item 0)

1. **checks events**: every adapter that can observe a `harness checks`
   invocation/outcome emits a `checks` event with honest status; harnesses
   that structurally cannot see outcomes stay honestly silent (no fabricated
   `ok`).
2. **push/commit signatures**: ensure `git push` / `git commit` shell calls
   yield timeline-matchable signatures on claude, copilot-cli, and cursor
   (vscode has no shell-call visibility in its store — honest null, document
   it). Whichever side of the seam the diagnosis blames, the fix must keep
   ONE grammar across producer and consumer (the 068 seam rule).
3. **Rider — vscode `models`**: `…/debug-logs/<session>/models.json` exists
   per session; if it names the model honestly, un-null `models` for
   copilot-vscode via the fs port (bounded read, degrade to null on
   absence/parse failure). If the file's semantics are ambiguous, DON'T —
   record why instead.

## Acceptance criteria

- AC-1: the diagnosis is written, per-harness, with real-session evidence.
- AC-2: a claude-code session that ran `harness checks` and `git push` shows
  non-zero discipline-panel rows end-to-end (session → report → insights),
  proven with a real or fixture session.
- AC-3: per-harness capability truth-table updated in the done-report (who
  emits checks/signatures/models now; who stays null and WHY) — feeds my docs
  pass.
- AC-4: no fabricated outcomes anywhere: a harness that can't see a result
  emits nothing (tests pin the null paths).
- AC-5: existing fixtures byte-identical unless the diagnosis proves the
  producer was wrong (in which case fixture changes land with the fix commit
  and the drift guard's regen path is followed, stated loudly).
- AC-6: full gate green; warn-baselines (arch 2 / markdown 199 / windows 6 —
  the third is html-snap's, inherited) not added to.

## Bounds & gates

As plan 068's packet: `harness/cli/src/**`, `harness/cli/test/**`,
`.harness/extensions/**` if needed; no docs/**, no push, no telemetry-ref
mutation, no `telemetry sync`; known box flakes re-run solo before blame.
