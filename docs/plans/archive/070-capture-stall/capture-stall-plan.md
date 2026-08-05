# Plan 070 — capture liveness: detect the stall, then fix it

Base: `origin/main @ d8e0cfea` (recorded at branch time). Owner:
pij-respectable-clam, assigned by Jordan 2026-08-04 ("we do 070 straight
away"). Sequenced explicitly BEFORE the cursor end-to-end validation run —
the stall's failure mode is the one that would poison it.

## Problem — the confident wrong number

Cursor-agent session `1a501a09-…` (2026-08-03, live fleet load): capture fired
exactly once (`harness doctor`, transcript line 2), then **never again** for
the rest of the session — through `harness instructions` ×3, `harness boot`,
multiple `harness checks` chains, and 5 post-commit hook syncs. The session's
9 ApplyPatch edits were never captured. No error surfaced anywhere (capture
failures are swallowed by design — correctly, per the zero-host-impact
contract).

The committed result is the dangerous part: a **plausible, internally
consistent, non-zero ref** ({prompt:1, turn:1, tools:1, harness:1}) that
under-represents the session ~27× on transcript lines. The o-prime's framing,
now doctrine: *this failure produces a CONFIDENT WRONG NUMBER, not a gap.*
Downstream attribution silently loses the agent's work — the exact defect
class the telemetry program exists to rule out.

A controlled repro (same transcript, same machine, same CLI build, fake
conversation id, quiet-ish box) consumed the full 56-line window in one
segment with correct counts — so the capture code path handles this input
perfectly in isolation. The failure is load/contention-conditioned and
currently **undetectable in the product**.

## Evidence (read before any code)

- `scratch/capture-stall-datum-2026-08-04.md` in this worktree — the complete
  datum: observed failure, clean-repro exclusions, mechanism candidates,
  three-variable framing (concurrent temp-dir-creating suites / CPU / I-O —
  load1 is a PROXY, see the datum's proxy warning), and two inherited
  experiment designs.
- Preserved known-bad fixture (UNTRACKED, deliberately —
  `government/` is gitignored and holds real session content):
  `government/preserved-fixtures/capture-stall-1a501a09/` (buffer-markers/,
  transcript/, README, datum copy).
- Live originals: buffer markers under
  `…worktrees/cursor-test/.harness/temp/telemetry/1a501a09-…*`; transcript
  under `~/.cursor/projects/…cursor-test/agent-transcripts/1a501a09-…/`.

**Fixture hygiene rule (hard):** the preserved content is REAL session data.
Nothing from `government/` is committed as-is. A committed test fixture must
go through fixture-scrub (including the 068 cursor-mangle) AND be re-verified
that the stall's marker pattern (cursor frozen at 2 while the transcript
grows) SURVIVES the scrub — a scrub that normalizes the pattern away produces
a fixture that tests nothing.

## The ruling that shapes the work: DETECTOR FIRST

The controlled repro passes BEFORE any fix, so "repro passes after fix"
proves nothing. The sequence is fixed (o-prime ruling, Jordan-aligned):

1. **Deliverable 1 — a liveness expectation.** A harness invocation that runs
   with an active harness detected and an unconsumed window SHOULD produce a
   capture. When it does not, that absence must be RECORDED somewhere a
   sensor/doctor reads — degrade-and-name, never throw, never a fabricated
   segment. (Candidate shape: a per-session liveness marker the capture
   preamble maintains — attempted/succeeded/skipped-with-reason — plus a
   repo-sensor or doctor layer that reads divergence between marker age,
   cursor position, and transcript growth. The diagnosis may improve on
   this; the CONTRACT is only "the absence is observable".)
2. **Prove the detector fires** on the known-bad session shape — the
   1a501a09 marker pattern reconstructed as a scrubbed fixture.
3. **Diagnose and fix** the stall on whichever mechanism the evidence blames.
4. **Prove the detector goes quiet** on the fixed path, and stays quiet on
   healthy fixtures.

Steps 3–4 may land in a follow-up commit but belong to this plan; step 1–2
land FIRST and stand alone even if the fix proves elusive.

## Mechanism candidates (from the datum — unproven, diagnosis required)

- Silent throw inside the capture guard on every post-first invocation —
  e.g. sqlite `state.vscdb` WAL contention while the Cursor IDE is live (the
  adapter queries bubble timelines per capture; one db.query throw kills the
  whole capture silently).
- Per-session lock/cursor contention between concurrent harness invocations
  (hook sync vs in-flight checks) wedging the cursor file at its position.
- EXCLUDED already: the re-entrancy depth guard alone (first capture
  succeeded with identical env); transcript-format issues (clean repro).
- Sibling defect, UNRESOLVED whether related: the exec-remote git int-test
  load-race (o-prime's queue). Do not assume shared cause; do not ignore the
  pairing. The datum carries the experiment designs.

## Acceptance criteria

- AC-1: the liveness expectation exists in the product (not a test-only
  construct): an un-captured eligible window becomes an observable, named
  signal readable by doctor and/or a repo sensor.
- AC-2: a scrubbed fixture reconstructing the 1a501a09 pattern makes the
  detector FIRE, proven by test; the scrub demonstrably preserves the marker
  pattern (assert the pattern in the fixture itself, not just the detector's
  output).
- AC-3: healthy-session fixtures (existing corpus fixtures) keep the detector
  QUIET — pinned by test. No false-fire on: fresh session first capture,
  zero-harness runs, HARNESS_NO_TELEMETRY runs, sessions with genuinely no
  new transcript content.
- AC-4: the root cause is diagnosed with evidence from the real markers/
  transcript (dossier-bound), and the fix addresses that mechanism — or, if
  the mechanism cannot be pinned, the plan says so loudly and ships
  detector-only with the diagnosis state recorded.
- AC-5: capture's zero-host-impact contract is untouched: no new throw can
  reach the host command; the detector adds no blocking I/O to the hot path
  beyond what capture already does; failures inside the detector itself
  degrade silent-but-marked (never recursive).
- AC-6: full gate green; warn baselines at this base (verify the triple at
  your tree — series: 196 markdown / 127 files at 963eae53-lineage) added to
  none.

## Bounds & gates

`harness/cli/src/**` (capture-service, adapters, sensors/doctor wiring),
`harness/cli/test/**`, `.harness/extensions/**` if a repo-sensor is the right
read surface, `scratch/**`. No `docs/**` for the coder (owner's docs pass).
No MANUAL telemetry sync; no mutation of EXISTING telemetry refs (per-session
autosync side-effects of mandated gates are expected and fine — fence per the
o-prime's re-worded template). Commits `HARNESS_NO_TELEMETRY=1 git commit`.
Known box flakes: exec-remote-telemetry-git (diagnosed load/concurrency race
— re-run solo, record load and concurrent-suite state before any blame),
docs.test.ts pipe timeouts. Gates: `just test` +
`node harness/cli/bin/harness.js checks`, rebuild before gating.
