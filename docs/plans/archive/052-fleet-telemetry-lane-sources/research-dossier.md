# Research dossier — 052 fleet telemetry lane sources

**Status**: complete (live-session archaeology, 2026-07-04 — every finding verified against real data during the 051 debrief)
**Method**: not a fresh explore — the research WAS the debrief. Each finding below was proven live, with the artifact named.

## Findings

| id | finding | evidence | impact |
|----|---------|----------|--------|
| F-01 | **Copilot lanes are NOT token-blind.** Full `tokenDetails` (input/output/cache_read/cache_write) + `totalNanoAiu` (AIC×10⁹, the billing unit) + `totalApiDurationMs` + `codeChanges` live in the `session.shutdown` event of `~/.copilot/session-state/<session-id>/events.jsonl`. Written ONLY at graceful session end. | Coder 34524328: 1,742.9 AIC, 20.7 M tokens; reviewer 6daaffe6: 298.5 AIC — both recovered post-hoc | Reverses dossier-051 F-07. Per-command capture reads mid-session → always null; a post-session sweep gets everything |
| F-02 | **codex lanes recoverable**: `~/.codex/sessions/<Y/M/D>/rollout-*.jsonl` carries per-turn `token_count` events (`total_token_usage` incl. cached + reasoning splits). | Validator rollout `…6fbb…`: 1,368,083 total | Third lane source; join is the weak point (see F-04) |
| F-03 | **`get-fleet` reads only the temp buffer.** With all 48 `refs/harness-telemetry/*` fetched locally, ref-resident lanes still don't appear (051 peers → orphans, `segments: 0`). The post-commit flush hook syncs+prunes temp, so lanes VANISH from live queries mid-run (coder's lane observed disappearing between T005 and the debrief). | Live get-fleet runs 2026-07-04 ~04:50Z | Ref reader in `candidateRoots` + run-end snapshot solve volatility |
| F-04 | **The join keys already exist in pij's registry** — no pij changes needed to consume. `SessionDescriptor.harnessSessionId` (pij `types.ts:81`) is the inner copilot/codex/claude session id, persisted to `~/.pij/<id>.json` on bind, incl. read-only peers, + `byHarnessSession` reverse index + codex `transcriptPath`. | pij-z4bt25 scoping doc: `~/pi-hacking/pij/docs/notes/telemetry-join-keys-scoping.md` (file:line refs) | The sweep joins lanes via a registry READ. pij-side polish (`pij sessions --json`, harness-aware adopt) is Jordan+pij-z4bt25's lane, NOT this plan |
| F-05 | **Read-only peers leave zero harness telemetry.** Reviewer ran only vitest/git/shasum — no harness command, no segments, no flush (flush is post-commit and reviewers never commit). Their ONLY trace is the F-01/F-02 side channels. | Reviewer: no temp dir, no ref, grep of all refs negative | The sweep is the only path to reviewer lanes; also argues for `harness telemetry sync` at teardown |
| F-06 | **050 artifact semantics WORK in the claude lane**: orchestrator segments carry artifact events with counts/enums — dossier `{findings:11, high:11}`, workshop `{decisions:4}+CONTRACT_READY`, backpressure `{exists:10}`, plan-phase extractor, review-verdict extractor, `flow_log` node transitions, `rollup.flow_stage_time_s`. | Live segments, session 15eaa924, 2026-07-04 | The capture thesis holds; gaps are lane coverage + precision + aggregation, not the layer itself |
| F-07 | **Copilot worker lane emitted 0 artifact events** despite running harness commands (checks, get-fleet) AFTER writing execution log + evidence. Claude-lane capture emits them; copilot-lane doesn't. Adapter or plan-cursor initialization gap — root cause unconfirmed. | Coder ref `34524328` logs: kinds = tools/turn/harness/prompt only | Fleet semantic reporting is blind on worker lanes until fixed. NEEDS INVESTIGATION FIRST (task order) |
| F-08 | **Classifier false positive**: review-PACKET files (instruction templates whose rubric line lists `APPROVE \| APPROVE_WITH_NOTES \| FIX_REQUIRED`) classify as `artifact_type: review` with `enums.verdict: APPROVE`. Actual round-1 verdict was FIX_REQUIRED. | Segment event on `reviews/review-packet.md` 04:03:57Z (both 050 and 051 packets affected) | A telemetry-only quality report would be WRONG, not just incomplete. `artifact-semantics.ts:149` verdict regex |
| F-09 | **No fleet semantic rollup.** `FleetEvidence` totals cost/time only; artifact/flow/skill events are never aggregated per fleet run. The debrief's §05 semantics table was hand-assembled from repo files. | `fleet-evidence.ts` (051 P1); debrief §05 honesty note | The "telemetry-only, no repo access" reporting goal fails today for quality/semantic dims |
| F-10 | **Cost reporting convention**: billing units, never raw token grand totals — Copilot in AIC ($0.01/credit from `totalNanoAiu`), others indicative USD via `scratch/evals/2026-07-03-md-to-pdf/pricing.json`. `totalPremiumRequests` is a legacy pre-2026-06 field, NOT cost. 98.5% of a Fable orchestrator lane's tokens are cache reads billed at 1/10 input rate. | User correction + pricing.json + live conversion 2026-07-04 | FleetLane should carry billing-unit fields, and the export schema must keep them ids/counts/enums-only |

## Risks

| risk | note |
|------|------|
| `~/.copilot` / `~/.codex` formats are unversioned vendor internals | Readers must degrade to `cost_measured:false` on shape mismatch — never crash, never guess. Fixture real samples (privacy-scrubbed) into the corpus |
| Privacy: side-channel files contain prose (messages, file paths) | Sweep extracts ONLY counts/ids/enums (tokens, AIC, durations, session ids) — counts-only posture unchanged; never copy event bodies |
| F-07 root cause unknown | Investigation task ordered FIRST in its phase; fix shape depends on findings |
| pij registry read couples harness → `~/.pij` layout | Read via a port; tolerate absence (no pij installed → source simply unavailable) |

## Fix backlog → observe ids (drained to retro at plan lock)

DL-001 volatility · SUGG-001 refs-unread · DL-002 read-only peers · DL-003 adopt self-id (pij lane) · SUGG-002 copilot sweep · SUGG-003 codex reader · INS-001 tribal-knowledge meta · SUGG-004 semantic rollup · DL-004 copilot artifact events · DL-005 packet false positive
