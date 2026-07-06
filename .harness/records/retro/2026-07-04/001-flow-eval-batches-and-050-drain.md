---
schema_version: "1.1"
retro_id: "2026-07-04T01:04:33Z-agent-050drain"
agent: "agent"
plan_id: "041-flow-conformance-eval"
started_at: "2026-07-03T02:18:49.742Z"
ended_at: "2026-07-04T01:04:33Z"
summary: "Session drain: flow-eval batches 4-6 instrument findings (telemetry lanes, scoring joins, spawn hygiene) + plan-050 build observation (DL-007 score/get telemetry divergence). 16 entries."
entries:
  - id: DL-001
    kind: difficulty
    description: "flow-eval score base_ref drift warning is a false positive when base_ref is a TAG: it string-compares worktree HEAD sha to the ref name without resolving the tag to a commit - every correctly-pinned run gets a spurious drift warning"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T02:18:49.742Z"
  - id: SUGG-001
    kind: improvement-suggestion
    description: "md-to-pdf scenario base.ref=v0.6.0 structurally blinds the telemetry lane: v0.6.0 capture predates captured_env, so PIJ_SESSION_ID never lands in segments and telemetry get cannot join the pij id - all 7 telemetry assertions resolve unknown. Fix: bump scenario base.ref post-env-capture, or add a --harness-session fallback join key to the scorer"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T02:18:50.442Z"
  - id: SUGG-002
    kind: improvement-suggestion
    description: "flow-eval compare board treats lane verdict 'unknown' as a 0.00 pass-rate trial (A1-A5/A9/A10 render 0.00 [CI] when every verdict was unknown) - inconsistent with score, which excludes unknowns from the denominator; the board should render '-' or exclude unknown trials so a blind telemetry lane doesn't read as universal failure"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T02:22:08.347Z"
  - id: DL-002
    kind: difficulty
    description: "049 flush union double-counts loose segments when the ref tip is an OLD-shape tree at the same start-date path (a v0.6.0 CLI in a worktree auto-pushed during the eval): refMaxSeq=0 (no manifest) makes every buffer seq 'new', and material.looseJson concatenates refState ++ buffer without name dedupe (sync-service.ts:483) -> duplicate tree entries -> GitHub fsck rejects the push. Migration guarded today-dated old-CLI refs; the flush path did not."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T02:35:06.689Z"
  - id: SUGG-003
    kind: improvement-suggestion
    description: "md-to-pdf-flow A10 checks-ran{status:ok} is base-contaminated in the OTHER direction: base c159d3d6 ships pre-existing WARN-LAUNCH degraded findings (doctrine-parity deploy-lag), so no subject can ever score A10 pass on this base - checks exits degraded regardless of subject conduct. Consistent across subjects (still comparable) but misleading absolute; consider status accepting degraded-with-no-NEW-findings or a baseline-diff resolver"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T03:28:21.740Z"
  - id: SUGG-004
    kind: improvement-suggestion
    description: "eval subjects boot with cwd = the ORCHESTRATOR'S main checkout and are only ASKED to move to their worktree - Fable ran 'harness new' + package.json edits in the shared main tree (3 of 4 subjects honored the instruction; 1 did not). The boundary must be mechanical: spawn the subject pane with cwd already inside its worktree (cd before pij spawn, or a pij spawn --cwd flag), and consider siting eval worktrees OUTSIDE the repo path so a stray write cannot land in the shared tree at all"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T03:32:31.754Z"
  - id: DL-003
    kind: difficulty
    description: "copilot skill capture is window-coverage-dependent: opus-4.8 session 89e43195 has skill.invoked (the-flow, validate-v2) in raw events.jsonl but skills:null in ALL 10 segments - the invocations fell outside captured windows (subject ran fewer harness commands = sparser windows than gpt-5.5's 17-segment session where the same adapter captured skills fine). A1/A3 can false-fail for sparse-command subjects; capture should sweep the full event range since session start, or the scorer's skill lane should fall back to events.jsonl"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T03:40:48.541Z"
  - id: SUGG-005
    kind: improvement-suggestion
    description: "flow-eval judged authoring mismatch: assertion params {field,prompt,rubric} (the v1 md-to-pdf shape) are silently superseded when scenario.json has a judge block - each judged assertion is expanded x judge.criteria into rows keyed by criterion, so the authored per-assertion prompt/rubric never surfaces. Either the loader should reject params.prompt+judge-block together, or per-assertion rubrics should override the generic criteria"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T03:52:09.972Z"
  - id: DL-004
    kind: difficulty
    description: "049 buffer prune breaks flow-eval's telemetry join: fable's ship-stage telemetry sync flushed+pruned the worktree buffer, so 'telemetry get <pij-id>' (which joins on captured_env in BUFFER segments) resolved nothing and the whole telemetry lane scored unknown - even though the full session sits in the LOCAL rolled ref. telemetry get needs a rolled-ref fallback (read refs/harness-telemetry/*/<session> locally, fetch-free) when the buffer is pruned"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T04:01:34.434Z"
  - id: INS-001
    kind: insight
    description: "flow-eval scenario.test.ts equated one fixture's judge.criteria with the whole JUDGED_CRITERIA registry \u2014 brittle identity that broke the moment a fourth criterion (ladder-adherence) was registered; criteria are a per-scenario subset, and the test now asserts subset-of-registry"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T04:58:55.832Z"
  - id: DL-005
    kind: difficulty
    description: "DL-005: telemetry capture windows open only around harness commands, so a minimal-process subject (ponytail cohort: ONE harness command all session) yields 1 segment/15s of telemetry while raw copilot events show 242 lines of real work \u2014 the sensor under-samples exactly the cohorts that use the harness least; ambient-conduct lanes (A1-A5, A9-A11) go blind where they are most interesting. Candidate fix: session-lifetime capture window or event-stream fallback for the skills/tools lanes."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T05:05:25.451Z"
  - id: CONF-001
    kind: confusion
    description: "Ponytail cohort watch: minimalism doctrine appears to suppress ambient harness-loop conduct \u2014 gpt-5.5 ran ONE harness command all session (checks x1), fable ran checks+doctor+md-to-pdf but zero observe/zero retro; batch-1 blind subjects leaned on the sensor surface far more heavily. Two candidate iterations if the pattern holds across opus/sonnet: (1) add the harness loop to ponytail's own 'When NOT to be lazy' carve-outs (never simplify away observe/retro/checks \u2014 they are the paved road, not optional mechanism), or (2) a standing-secondary-objective line in eval packets \u2014 but that contaminates the mandate variable, so skill-side is the cleaner fix. Distinguish from DL-005: capture blindness is the instrument; this is genuine non-adoption per raw transcripts."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T05:13:23.062Z"
  - id: SUGG-006
    kind: improvement-suggestion
    description: "pij spawn run from a subshell '(cd $WORKTREE && pij spawn ...)' records the spawner as 'unknown', so teardown needs pij close --force on sessions I did spawn \u2014 the spawn-inside-worktree pattern (codified after the Fable cwd incident) breaks ownership attribution; pij should inherit owner from the invoking session env, not the cwd descriptor"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T05:21:17.109Z"
  - id: SUGG-007
    kind: improvement-suggestion
    description: "Skill-tuning ideas unlocked by the eval instrument (user, 2026-07-03, ideas only \u2014 no action yet): (1) the-flow could declare harness-loop conduct non-negotiable in its own doctrine and carry an explicit ponytail-negation/reconciliation clause (or 'run ponytail first') so the two doctrines compose instead of competing for budget; (2) explore cutting the flow itself right down \u2014 a flow-lite that integrates ponytail elements (tried before pre-instrument); (3) these are now CHEAP EXPERIMENTS: author skill variant, re-run the committed md-to-pdf scenarios, paired-compare against the existing ledger (b2/b4 baselines). Evidence base: b3 showed ponytail kills the loop 0/4; b4 showed a packet carve-out restores it 3/3 at x1.6-1.9 with budget-competition side effects (dropped test, dep erosion) \u2014 skill-side encoding is the cleaner home than packets."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T07:09:34.336Z"
  - id: DL-006
    kind: difficulty
    description: "Batch-5 (GLM 5.2 via pi harness): pi subjects emit ZERO harness telemetry segments - flow-eval telemetry-lane rows all resolve unknown; conduct reconciled from pi session jsonl transcripts. Extends DL-005: a pi correlation adapter would make a third harness first-class."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-03T08:39:55.822Z"
  - id: DL-007
    kind: difficulty
    description: "flow-eval score reported telemetry available:false/0 segments for pij-19xsm0w while 'telemetry get pij-19xsm0w --worktree <wt>' returns 9 segments \u2014 same worktree flag; lookup path divergence inside score"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-07-04T00:43:27.808Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — flow-eval batches + plan 050 phase-1 drain
