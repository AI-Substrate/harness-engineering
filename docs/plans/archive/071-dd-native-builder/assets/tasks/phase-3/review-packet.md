# Phase-3 review packet — plan 071 dd-native builder

**For**: the phase-3 reviewer (gpt-5.6-terra, effort high)
**From**: pij-related-koala (orchestrator). Report verdict by pij send —
wire discipline, first line = verdict.

## Dispatch fields

- Coder report: `/tmp/pij-msgs/phase3-report.md` — read IN FULL (its
  defects-my-own-controls-caught, design-calls, and owed-run sections direct
  your attention).
- Commits under review (fourteen, interleaved with orchestrator corpus
  commits — review THESE, not a range): `3f3db39d`, `1fb2ed22`, `fb08148a`,
  `f908f0a3`, `f97b73ab`, `ed7f884c`, `e28e9542`, `afc156fd`, `ce4beb9b`,
  `55b06908`, `f947a2fc`, `0def0f86`, `7c91d65e`, `f3c1a4f3` (exit sha).
- Orchestrator commits interleaved (docs/plans/071 corpus + briefs — MINE,
  not the coder's; verify only that the coder did not touch that folder):
  `0285ff4a`, `4da00af6`, `ebfb15a3`, `8109bd8c`, `37458267`, `f5cc57e9`,
  `b60b88e4`, `bdfaf690`.
- Attribution baseline: `ebfb15a3` (coder measured at `8109bd8c` before its
  first commit). Warn trio there: arch 2 / markdown 196 / windows 6 —
  coder claims BYTE-IDENTICAL at every one of the fourteen commits. Verify
  at the exit sha; a RISE is the coder's, a drop should have been quoted.
- Counts claimed at exit: 302 files / 4244 tests green; checks exit 0
  degraded with zero error gates; dd doctor 0/0 over 103 documents.
- Fences: phase-3 `brief.md` + its THREE amendments (README two-line
  sample fix; 065 structural-proof-graph 3-line signpost; flow-eval-run
  SKILL one subsection) + the carried phase-1/2 amendments.
- Flake note: tk-7173 claims the exec-remote-telemetry-git load flake is
  ROOT-CAUSED and fixed (shared os.tmpdir scan → private TMPDIR). Do NOT
  extend it the old rerun-alone courtesy: if ANY git suite flakes during
  your reproduction, that is now a FINDING, not weather.

## Mission

Adversarial review of ph-7103 "Close-out" — 14 tasks (tk-7151/7152,
tk-7161..7168, tk-7171..7174) against ACs ac-7112, ac-7113 (archive
clause), ac-7114, ac-7117, ac-7118, ac-7120, ac-7121. You are the
cross-model check: find what the coder missed.

Two OWED items are declared, not hidden — do not report them as findings,
DO verify they are exactly as scoped:
1. tk-7168's blind-subject RUN (bundle authored + dry-scored; the run is
   the orchestrator's act, happening in parallel with your review).
2. dw-0003's real-PR click-through (needs a push; happens at ship).

## Read first (in order)

1. `../../../plan.dd.md` — ph-7103 section, the seven ACs above.
2. `tasks.dd.md` (this folder) — 14 tasks, 15 done_when assertions = the
   done bar (note the honest not-applicable instruments on dw-000e note and
   the human-review instruments on dw-0005/dw-0006 — YOU are that
   instrument; judge those two directly).
3. `../../../backpressure.dd.md` — bp-7112/7113/7114/7117/7118/7120/7121.
4. `../../../execution-log.dd.md` — entries lg-0004..lg-0006 record the
   tk-7167 audit + the orchestrator's response (gates retrofit).
5. `brief.md` (this folder) + its three amendments.
6. The coder's report, then the fourteen diffs.

## Dim-0 — mutation gate (MANDATORY, first, blocking)

Controls must be tested, not demonstrated. Pick ≥4 of these refusal/ERROR
classes, mutate a good fixture into the bad shape (or verify the
planted-bad is genuinely bad), run, confirm it FIRES with the right code:

- `plan pr-body` unclosed-corpus refusal (E457) — the shipped exemplar's
  open ac-0901 IS the planted-bad; also try a CLOSED fixture and confirm it
  renders (the guard must not be a blanket).
- `plan fence` out-of-fence refusal (E460/E461) — the coder's own controls
  caught a glob defect (`src/**` compiled to dir-only match = everything
  out-of-fence); verify the FIX fires both ways (in-fence passes,
  out-of-fence named with path + fence row).
- flow.ts strict sibling writes (E302) — 4 controls claimed to fire
  against pre-fix source; reproduce at least one.
- archive-move: an UNREWRITTEN dd_link after the mv must fail the probe.
- review schema: delete one verdict row → 3 tests must fail (the verdict
  decides EVERY finding — that closure is the whole point).
- `gate-refused` assertion: a run with no refusal must FAIL the assertion;
  a different gate code must NOT satisfy it.

## Dimensions (after Dim-0)

1. **The coder's own caught-defects list** — five defects claimed found and
   fixed (wrong-end satisfies; fence glob; A11 literal ${VAR}; runCliIn
   root-scope; vacuous 20x script). For each: verify the fix is real AND
   the pre-fix behavior actually failed. A self-reported catch is
   attractive; verify it is not a story.
2. **Deflake honesty (tk-7173)** — the root-cause claim (shared os.tmpdir
   scan) and the 20/20 loaded-run bar. INS-001 says three real-git suites
   flake under load as a PATTERN — check the fix is the namespace, not a
   timeout widened somewhere.
3. **Surface discipline** — E460/E461 manifest rows in the same commit;
   NO manifest row for plan pr-body/fence VERBS (ruling Q1-A — verify the
   --help test pins exist instead); dd-surface.test.ts pin deliberate.
4. **Docs truth (dw-0005/dw-0006, human-judged)** — 29-control coverage
   test aside, read `docs/how/dd/` chapter additions + the promoted
   11-the-builder-proof-graph.md: does every command this plan shipped
   actually appear with a runnable recipe? Is the proof-graph doc accurate
   to the SHIPPED surface (no aspirational claims)? The README got exactly
   the two granted line edits and the one chapter-index line — nothing else.
5. **Fence compliance** — fourteen diffs touch ONLY brief paths + the three
   amendments' exact grants. `docs/plans/071-dd-native-builder/**` must be
  untouched by the coder (the corpus churn is mine). The 065 signpost is
  exactly 3 lines.
6. **Test honesty** — 4244/4244 reproduces; the two owed items are the ONLY
   gaps; dw rows claiming counts match the tests that exist.

## Verify independently

Run `just test` + `harness checks` yourself; run the bp probes for
bp-7112/7113/7114/7120/7121; quote counts. Never accept unreproduced
numbers.

## Your fence

Read-only + running tests/probes. No commits, no edits, no push. Forbidden:
any the-flow files, `docs/plans/071-dd-native-builder/**` writes.

## Report shape

Line 1: `VERDICT: APPROVE` or `VERDICT: FIX`. Dim-0 evidence first
(commands + codes), then per-dimension one-liners, then numbered findings
(file:line, severity, expected, found). DISCRETE findings please — this
review will be recorded as a `review.dd.json` corpus (tk-7172's dogfood):
each finding becomes a row, and the verdict must decide every one.
