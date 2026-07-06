---
record_kind: "retro"
harness_version: "0.7.0"
branch: "feat/041-flow-conformance-eval"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-07-02T12:34:10.270Z"
agent: agent
plan_id: 048-cohort-telemetry-insights
schema_version: "1.1"
retro_id: "2026-07-02T12:34:10Z-agent-048p3"
started_at: "2026-07-02T08:30:00Z"
ended_at: "2026-07-02T12:34:10Z"
summary: "048 task 3.4 harvest — drain after the real-month dogfood (June 2026, 21 sessions) + all three phases cross-model reviewed. Two dogfood defects were encoded IN-PHASE (D-A/D-B); two observations were LOST to an observe id-collision bug (reconstructed below, bug recorded); the pij false-stall report was fixed upstream same-day."
entries:
  - id: WIN-001
    kind: win
    description: "048 1.2-fix live-confirmed on the first post-build segment (19407): plans_touched=['048-cohort-telemetry-insights'] + flow event (the-flow, phase-1, in_progress) — after 19,406 segments where the cwd heuristic yielded 4 plans_touched and 3 flow events total. The nav-derived stage pipeline is now fed in real workflows."
    target: project
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T10:31:09.288Z"
  - id: DL-001
    kind: difficulty
    description: "Dogfood BUG: active > wall — 8/21 June sessions showed active time exceeding their calendar span (worst: 222s active over 14s wall, cursor-agent), silently folded into the cohort aggregate. Timestamp-precision artifact (anchored/coarse t_precision over-accrues gap-based active time)."
    target: project
    severity: degrading
    workaround: "ENCODED in-phase (D-A): insights excludes impossible sessions from the cohort + declares count/reason; per-session rows kept with data_quality flags; no clamping."
    suggested_encoding: "DONE for the insights layer. OPEN capture-side follow-up: see SUGG-002."
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T11:53:44.180Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "Honest-zero vs unmeasurable-era: June's checks-before-push read 0/0 because git-push SIGNATURES only exist post-FX001 (13/21 sessions signature-less); stage economics near-empty because 20/21 sessions predate the FlowEvent fix. Zeros reflected capture-era coverage, not practice."
    target: project
    workaround: "ENCODED in-phase (D-B): evidence-based coverageDeclaration on discipline + stage_economics; UNMEASURABLE rendered distinct from zero."
    suggested_encoding: "DONE."
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T11:53:44.873Z"
  - id: WIN-002
    kind: win
    description: "First real-month insights board (June 2026, 21 sessions from refs alone) produced immediately actionable practice truth: observe→drain 36/42, backpressure-before-implement 1/6 work units, cohort active/wall 0.51 (post-fix, 8 exclusions declared), mega-outlier identified with stage mix. Suppression/caveat machinery all fired on real data; narrator route live-exercised and reviewer-audited (incl. one orchestrator violation caught + fixed — F2)."
    target: project
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T11:53:45.573Z"
  - id: SUGG-002
    kind: improvement-suggestion
    description: "RECONSTRUCTED (lost to the id-collision bug, DL-002): capture-side root cause of active>wall — the gap classifier over-accrues active seconds from coarse/anchored t_precision timestamps. A report-layer clamp was deliberately rejected (would corrupt totals.time_s downstream and mask the bug). Needs a bounded report/capture-layer time_quality investigation."
    target: project
    suggested_encoding: "a time_quality task in a future telemetry plan (or 048 ship-note follow-up)"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-02T12:07:42.745Z"
  - id: DL-002
    kind: difficulty
    description: "harness observe ID COLLISION: after a mid-session drain+clear, subsequent same-kind observations each got the SAME id (three SUGG-001s issued at 09:34, 11:53, 12:07 — later captures OVERWROTE earlier ones in the buffer). Two observations were silently lost (reconstructed here: SUGG-002 above; the pij false-stall report, which was independently fixed upstream). Sequential numbering appears to reset/misread after a clear."
    target: tooling
    severity: degrading
    workaround: "reconstructed the lost entries from conversation; cross-checked buffer vs captures issued"
    suggested_encoding: "observe id assignment must scan the buffer for the max existing per-kind ordinal (or use a monotonic counter that survives clears within a session); a test: capture→clear→capture×2 ⇒ distinct ids"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-02T12:34:10.270Z"
  - id: INS-001
    kind: insight
    description: "RECONSTRUCTED-adjacent (context): the pij daemon's false STALLED pushes on xhigh peers were reported to the pij maintainer agent (pij-5lztp8) with evidence; root cause confirmed (tick-start descriptor + frozen boot-classification heartbeat) and FIXED upstream same-day, incl. a backgrounded-copilot focus wedge. Cross-agent bug reporting over pij works."
    target: tooling
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-07-02T09:34:07.236Z"
---

# Retro — 048 P3 real-month dogfood drain (task 3.4)

Drained at the Phase 3 seam. The headline: the dogfood loop closed on itself twice in one phase — two measure defects found by the June board were encoded (D-A/D-B) before the phase's own review completed, and the review then audited the orchestrator's narration and caught a third violation (F2), also fixed in-phase. Open follow-ups: capture-side time_quality (SUGG-002), observe id-collision (DL-002), codex telemetry adapter (deferred, prior record), AC-13 digit confirm (one user keystroke).
