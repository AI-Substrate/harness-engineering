# Phase 1 execution log — plan 051 (pij fleet session eval)

Coder: pij-g7t974 (flow-pair coder; orchestrator pij-4s10mb). One entry per task: what / evidence / deviations.

---

## T001 — Spike: time + cost + roster reconcile over the 050 fleet (scratch)

**Verdict: GO.** The join, cost, and time source are all proven on real data; the CLI service can be built as designed.

**What I did.** Wrote `scratch/051-fleet-spike/spike.py` (scratch-only, not promoted): read every `<seq>.json` under `.harness/temp/telemetry/*/`, group by `captured_env.PIJ_SESSION_ID`, keep children where `captured_env.PIJ_PARENT_ID == "pij-4s10mb"` (+ the orchestrator lane), and compute per-lane cost + time.

**Evidence (reproduces the dossier/workshop spike exactly):**

```
fleet of pij-4s10mb: 13 children, 99 segments
  pij-i13g2o   [claude ] segs=26 grand=35,232,032 output=395,206 span_s=11445
  pij-1s7r0mw  [claude ] segs=16 grand=24,408,986 output=316,651 span_s=9596
  pij-1t3oakg  [claude ] segs= 7 grand=18,967,436 output=139,743 span_s=2374
  pij-1q4bt7w  [claude ] segs= 3 grand=   206,204 output=   798 span_s=241
  pij-1mx6yf1  [copilot] segs= 2 grand=0 output=0 measured=False span_s=1225
  … 8 more copilot lanes, all tokens:null (measured=False)
FLEET TOTALS (children only):
  cost.grand_total (measured lanes only) = 78,814,658   ← matches dossier F-06
  cost.output      (measured lanes only) =    852,398   ← matches dossier F-06
  measured_lanes=4  unmeasured_lanes=9
  segments=99
  time.wall_clock_s (union) = 35,748.5
  time.active_s     (sum)   = 36,518.6
  parallelism (active/wall) = 1.02
```

**Discovered constraints / go-no-go findings (promoted into the T002/T003 design, spike code discarded):**

1. **Time source = `event_stream[].t` ISO timestamps** (min/max per lane), the SAME source `session-evidence.ts#fold` already uses for `duration_s`. `window` is event-index (`{since,from,to}`) and unusable (confirms F-08). `timecode` is a valid bounding fallback. → per-lane span is `[minT,maxT]`; fleet `wall_clock_s` = union of lane intervals, `active_s` = Σ lane spans, parallelism = active/wall. Non-null for the 050 fleet.
2. **Synced OTLP refs also carry time**: `refs/harness-telemetry/**` `session.metrics.jsonl` blobs carry `timeUnixNano`/`startTimeUnixNano` and a `harness.session.wall_seconds` metric (verified on `2026/06/23/15eaa924…`). The temp `event_stream` is the authoritative live source the service reads; the ref path is a proven fallback, not needed for the 050 fleet.
3. **Cost**: `cost_measured` = a lane has ≥1 segment with non-null `tokens`. Copilot lanes are `tokens: null` (F-07) → `cost_measured: false`, **excluded** from `totals.cost` (never zero-added), counted in `unmeasured_lanes`. 4 measured claude lanes reproduce 78,814,658 grand-total exactly.
4. **Roster**: only the **051** run carries a `roster` (`role → {pijId, harness, model}`, `pijId` nullable) at `.flow-pair/runs/2026-07-04-051-fleet-session-eval/run.json`. **No 050-era roster exists** (the roster field post-dates the 050 run) — so the env-tree join (no roster) is the clean 050 fleet; a roster run demonstrates the D1 orphan/unrostered diff. Roster parse must tolerate `pijId: null`.
5. **Enumeration**: the current temp buffer's `pij-4s10mb` env-tree returns EXACTLY the 13-child / 99-segment 050 fleet (the 051 children haven't flushed telemetry into this buffer under that parent yet) — so T005's env-tree retrospective is clean, and D1 conflation is real but not yet triggered here.

**Deviations from the plan sketch:** D2's `FleetLane` sketch has no token field, but `SessionEvidence` (embedded per D2, unchanged) carries no tokens either — so cost has no home. Resolution: add a per-lane `tokens {grand_total, output}` + `cost_measured` to `FleetLane` (fleet-layer cost), leaving `SessionEvidence` frozen (honours the "change session-evidence carefully" handoff). Recorded here as the one contract addition.

---

## T002 — `FleetEvidence` types + pure merge/diff/totals + unit tests

**What.** New PURE service `harness/cli/src/services/telemetry/fleet-evidence.ts` (ports only, no `node:*`). `getFleetEvidence(rootPijId, deps, opts)` + a pure `buildFleetEvidence(root, segments, roster)` core + `parseRoster(raw)`. Reuses the per-session builder by EXPORTING (read-only) `fold`, `readSegments`, `candidateRoots` from `session-evidence.ts` (dossier F-05 — reuse, don't reimplement); `SessionEvidence` stays frozen.

**Contract (D2 + the T001 addition).** `FleetLane` = `{pij_id, role, harness, model, cost_measured, tokens{grand_total,output}, evidence: SessionEvidence}`. `FleetTotals` = `{cost{grand_total,output,measured_lanes,unmeasured_lanes}, time{wall_clock_s,active_s}, segments}`. `FleetEvidence` = `{root_pij_id, scope, sessions, orphans, unrostered, totals}`.

**Semantics proven by tests** (`test/services/telemetry/fleet-evidence.test.ts`, real-shaped via `serializeSegment`):
- AC-02: a `tokens:null` copilot lane is `cost_measured:false`, `tokens {0,0}`, EXCLUDED from `totals.cost` (asserted grand_total = claude-only 1400, unmeasured_lanes counted) — never zero-filled.
- AC-03: `wall_clock_s` = union of lane `[minT,maxT]` spans, `active_s` = sum; overlap test proves active(2400s) > wall(1800s) — parallelism > 1.
- AC-04: with a roster, roles attach + `orphans`/`unrostered` diffs populate; env-tree scope leaves both empty. `parseRoster` tolerates `pijId:null` + garbage.

**Evidence.** 17/17 vitest green; session-evidence's own 17 still green after the export refactor.

**Deviation.** Added per-lane `tokens{grand_total,output}` to `FleetLane` (the D2 sketch omitted a cost home; `SessionEvidence` carries none) — see T001 deviation. `harness` field surfaces the `PIJ_HARNESS` short label (`claude`/`copilot`) per D2, falling back to the segment harness.

---

## T003 — Closed export schema + `telemetry get-fleet` wiring

**What.** `harness/cli/src/services/telemetry/fleet-export.schema.json` — `additionalProperties:false` on EVERY fixed object (top-level, totals, cost, time, fleetLane, files, checks item, sessionEvidence); the only open maps are the count histograms (skills/tools/harness_verbs) whose VALUES are pinned to integers. Wired `telemetry get-fleet <root-pij-id> [--roster <path>] [--worktree <path>]` into `acts/telemetry.ts`, mirroring the `get` action's ok/error envelope (exit 1 + honest `next_action` when no child joins).

**AC-07 negative test.** A tiny recursive closed-key checker (no ajv in-repo, KF-05) walks a REAL `buildFleetEvidence` payload → 0 violations; injecting an un-enumerated key at the top level AND deep in a lane both flip to a violation. Non-vacuous.

**Live (AC-01/02/03/04), `just build` then `node harness/cli/dist/index.js telemetry get-fleet pij-4s10mb`:**
- env-tree: **14 lanes** (the 13 050 children + `pij-g7t974` = this coder session, newly captured), `totals.cost.grand_total = 78,814,658` (EXACTLY the dossier spike — the new copilot lane is `tokens:null`, adds 0), `measured_lanes=4 unmeasured_lanes=10`, `time {wall_clock_s:36607, active_s:37377}`, `segments:100`, scope env-tree, diffs empty.
- `--roster …/2026-07-04-051…/run.json`: scope roster, `pij-g7t974`→`coder`, `orphans:[pij-wolk0r]` (rostered validator, not yet captured), `unrostered`: the 13 050-era children — a live D1 conflation signal (one orchestrator pij id spans the 050 + 051 runs).

**Deviation.** None. Envelope shape is `{command,status,timestamp,data,next_action}` (repo standard).

---

## T004 — Scenario `intent` register (scaffold + optional load)

**What.** `scenario.ts`: added optional `intent?: { reason, vibe }` to `ScenarioConfig`, validated only when present (`{reason,vibe}` non-empty strings, else a descriptive issue), and carried through the loader. `extension.ts` `scaffoldScenarioJson` now seeds an `intent` block (TODO-worded reason + vibe). Purely additive — the loader never rejected unknown keys, so every existing bundle is unaffected.

**Evidence.** `scenario.test.ts` +3 (valid intent carried · legacy bundle loads with `intent` undefined · malformed intent rejected). `extension.test.ts` scaffold test now asserts the scaffolded `intent.reason`/`vibe` are non-empty AND survive `loadScenario`. 52/52 flow-eval scenario+extension tests green. The frozen md-to-pdf fixture (no `intent`) still loads (AC-05).

---

## T005 — fleet-050 retrospective validation (AC-06)

**What.** Ran `get-fleet pij-4s10mb --json` → `evidence/fleet-050.json`; roster-scoped variant → `evidence/fleet-050-roster-scoped.json`; wrote `evidence/fleet-050-reconcile.md`.

**Reconcile.** The 13 050-era lanes: 4 measured claude lanes sum to **78,814,658 / 852,398** — the dossier/workshop spike EXACTLY; 9 copilot lanes `cost_measured:false`, excluded. `totals.time` non-null (wall ≈36,607s, active ≈37,377s). The live env-tree shows a **14th** lane, `pij-g7t974` (this coder session, captured live under the same orchestrator) — a bonus live-join proof AND a live D1 conflation instance the roster mode resolves (`orphans:[pij-wolk0r]`, `unrostered:` the 13 050 children). Committed `fleet-050.json` validates clean (0 violations) against `fleet-export.schema.json`.

**Deviation.** T005 done-when mentions a "register table update" in the plan §register, but the packet marks the plan `.md` read-only (not in Allowed paths) and the fleet-050-retrospective register row ALREADY exists in the plan (§ D4 Scenario Register). So no plan edit; the retrospective is recorded under `evidence/` instead.

---

## T006 — docs § fleet + `just build` + `harness checks`

**What.** Added a `## Fleets — joining a flow-pair run (harness telemetry get-fleet)` section to `docs/how/telemetry.md` (cost lower-bound / time union / roster diff semantics, depth-1, fail-safe). `telemetry.md` is manifest-embedded, so `just build` (runs `gen:docs`) regenerated `harness/cli/src/services/docs/docs-content.ts` — an allowed regen path.

**Checks verdict (`harness checks`, then targeted re-runs):**
- typecheck: **ok** · biome: **ok** (after `biome --write` on my 3 files + 1 `useIterableCallbackReturn` fix) · check:docs: **ok** (staged the regenerated `docs-content.ts`; `git diff --exit-code` clean) · check:flows/telemetry-fixtures/doctrine-parity/skills/windows: **ok**.
- arch-check: **degraded** (1 warn `services-ports-type-only`) and markdown-lint: **degraded** (11 findings) — both pre-existing warn-launch, tolerated per packet, not mine.
- Full vitest: **2105 pass / 1 fail**. Every new/changed test of mine is green (fleet-evidence 17, session-evidence 17, flow-eval scenario 20 + extension 35).

**The one RED — PRE-EXISTING, OUTSIDE MY ALLOWED PATHS (not fixed):** `test/acts/doctor.test.ts > json mode emits an envelope with data.layers` expects 8 layers; the doctor now emits **9** — a `version-skew` layer added to `harness/cli/src/services/doctor/doctor-service.ts:163`. Proven pre-existing: at HEAD, committed `doctor-service.ts` emits `version-skew` while committed `doctor.test.ts` omits it (both files are unmodified in this tree). It fails on a clean checkout independent of plan 051. The fix is a 1-line test update (add `'version-skew'` to the expected list) but `harness/cli/test/acts/**` + `harness/cli/src/services/doctor/**` are NOT in this packet's Allowed paths, so I left it for the owner. This is the sole reason `harness checks` is not exit 0.

**Deviation.** `harness checks` exit 0 is blocked ONLY by that out-of-scope pre-existing failure; my entire scope is green. Escalated to the orchestrator for a decision.

**UPDATE — blocker resolved, `harness checks` EXIT 0.** While finalizing, another session landed the missing `version-skew` line in `harness/cli/test/acts/doctor.test.ts` (not my change — outside my lane). Re-ran the full gate: `tests:ok biome:ok typecheck:ok check:docs:ok check:flows:ok check:telemetry-fixtures:ok check:doctrine-parity:ok skills-check:ok windows-check:ok`, with only `arch-check:degraded` (1 pre-existing warn: `sync-service.ts → git-write-port.ts`, not my file) and `markdown-lint:degraded` (pre-existing) — both tolerated warn-launch. **Overall status degraded ⇒ exit 0.** Phase 1 complete.

---

## FIX-001 — F1 (CRITICAL): roster scope now SCOPES membership, not just labels

**Finding (review.phase-1.md F1).** `buildFleetEvidence` built `sessions` from every env-tree child, then only *attached roles*; totals iterated that unfiltered list. So `fleet-050-roster-scoped.json` said `scope:"roster"` yet still totalled the 13 unrostered 050-era lanes (78,814,658) into what is labelled the 051 run scope — violating AC-04 + workshop D1 ("env tree = superset, roster = run scope").

**Fix (source).** `harness/cli/src/services/telemetry/fleet-evidence.ts` — when a roster is present, `childLanes` (and thus `sessions` and all cost/time totals) are filtered to `roster === null || roleOf.has(sid)`. Env-tree ids are still enumerated for the diffs, so `unrostered` (env-tree children absent from the roster) stays complete — those ids are now **diff-only**: never in `sessions`, never in `totals`. Orchestrator lane + `orphans` semantics unchanged. Doc comment (ROSTER block) updated to say membership scopes.

**Fix (tests).** `test/services/telemetry/fleet-evidence.test.ts`:
- Added regression `a MEASURED unrostered child does NOT contaminate cost/time totals (F1 regression)`: roster covers only `pij-claude-a` (1000); the measured `pij-claude-b` (400) is unrostered → `sessions == ['pij-claude-a']`, `cost.grand_total == 1000` (NOT 1400), `measured_lanes == 1`, `segments == 1`, `time == 600s`, `unrostered == ['pij-claude-b','pij-copilot']`. Fails on the old "labelled-not-scoped" behaviour.
- Updated the existing roster test to assert the unrostered child (`pij-copilot`) is NOT in `sessions` (`sessions == ['pij-claude-a','pij-claude-b']`).
- Updated the ports-path roster test to expect 2 rostered lanes, not 3.
- `npx vitest run test/services/telemetry/fleet-evidence.test.ts` → **18/18 green** (was 17).

**Fix (evidence).** Regenerated `evidence/fleet-050-roster-scoped.json` via the live `get-fleet --roster` run. It now scopes to the roster: `scope:"roster"`, `sessions == [pij-g7t974]` (the sole rostered child in the env tree — coder, copilot/`tokens:null`), `totals.cost.grand_total == 0` / `unmeasured_lanes:1` (the 78,814,658 contamination is GONE), `unrostered ==` the 13 050-era children, `orphans == [pij-106t2i1, pij-wolk0r]` (rostered members with no env-tree capture). `evidence/fleet-050.json` (env-tree) is unchanged — still the `scope:"env-tree"` superset at **78,814,658**. Both validate clean (0 violations) against `fleet-export.schema.json`. Reconcile note updated with a roster-vs-env-tree numbers table.

**Gates.** `npx vitest run test/services/telemetry/` → **green**. `just build` → exit 0. `harness checks` → exit 0 (pre-existing `arch-check`/`markdown-lint` warn-launch degradeds tolerated; overall degraded ⇒ exit 0).
