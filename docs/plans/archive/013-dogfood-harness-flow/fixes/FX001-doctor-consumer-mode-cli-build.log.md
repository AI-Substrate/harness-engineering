# Execution Log — FX001: Consumer-mode `doctor` `cli-build` false degraded

_Created by plan-5 fix mode; populated by plan-6-companion during implementation._

## Session — 2026-06-10 (plan-6-v2-implement-phase-companion)

**Companion**: `code-review-companion`, run `2026-06-10T07-51-13-436Z-c845` (Power-On-Mode, booted fresh this session).

### FX001-1 — consumer-mode detection (`doctor-service.ts`)
- Added `CLI_DEV_MARKER = 'harness/cli/tsconfig.json'`; rewrote the `CLI_BUILD_PATH` doc comment to describe both modes (dev build check vs consumer n/a) instead of the old "installed/loop behaviour is out of scope" clause.
- `checkCliBuild` early-returns `ok: true` + `consumer install — dev build check n/a (no harness/cli/tsconfig.json)` when the marker is absent; dev path (marker present) is byte-identical to before.
- Marker is a **file**, not the `harness/cli/` dir — `FakeFs.exists` (`fake-fs.ts:21-24`) resolves only exact seeded file paths or `mkdirp`-created dirs, so a directory gate would have been untestable and would have flipped existing dev-mode tests. Confirmed `harness/cli/package.json` does **not** exist (CLI builds from the root package), so `tsconfig.json` is the stable dev-tree marker.

### FX001-2 — tests (`doctor-service.test.ts`, `acts/doctor.test.ts`)
- `BUILT_CLI` seed gained `'harness/cli/tsconfig.json': '{}'` so the existing all-layers-ok test stays a **dev-mode** test.
- Added 2 cases: dev+unbuilt (marker only) → not-ok + `npm run build` next_action; consumer (empty fs) → ok + detail `/consumer/` + whole envelope `ok`.
- **Unplanned discovery**: `test/acts/doctor.test.ts:52` asserted `env.next_action.length > 0` unconditionally. That only ever held because the act test runs the real doctor in cwd `harness/cli/`, where the dev paths never resolve → cli-build was *always* not-ok → envelope always degraded. That is the very bug under fix. Post-fix the cwd reads as consumer-mode → envelope can be `ok` → `next_action` undefined. Made the assertion conditional on `status==='degraded'` (the actual Envelope contract: `formatDegraded` requires a next_action, `formatOk` has none). Not a regression mask — it corrects a latent over-assumption.

### FX001-3 — build + suite + commit
- `npm run build` exit 0; vitest **277/277** (was 275; +2 mode tests). No Envelope/contract shape change.
- Commit `b0613e1` — `fix(doctor): stop falsely reporting cli-build degraded in consumer mode`.

### Companion timeline
- 21:56:20Z — briefing sent (scope, FakeFs gate-trap hazard, doctor.test.ts assertion-change flag).
- 21:56:29Z — review-request `FX001 b0613e1` sent (fire-and-forget).
- 22:11:47Z — `control:stop` honoured; farewell envelope written to `agents/code-review-companion/runs/2026-06-10T07-51-13-436Z-c845/output/report.json` (`exitReason: stop_requested`, 2 tasks received, **1 finding sent**, 1 question asked).

### Companion verdict (drained)
- **Summary**: "The implementation path was sound and the final drain found no new code issues." The FX001 *code* (marker gate, dev-repo parity, doctor act assertion change, targeted tests) reviewed **clean**.
- **One finding — F001 (MEDIUM, Domain Compliance / Contract Drift)**: FX001 changed the user-visible `doctor` contract (consumer-mode `cli-build` is now `ok`/n/a), but shipped setup/flow guidance + the validate-harness-flow prompt still describe the **old** consumer `cli-build degraded` wart — which can train future agents to ignore a real degraded status or **record an obsolete difficulty**. Targets:
  - `skills/eng-harness-setup/eng-harness-0-setup/SKILL.md:79`
  - `skills/eng-harness-setup/eng-harness-0-setup/README.md:28`
  - `skills/eng-harness-loop/eng-harness-flow/SKILL.md:83`
  - `agents/validate-harness-flow/prompt.md:129-132` (strongest — explicitly says "record it as a difficulty")
- **Disposition**: F001 is **out of FX001's ripple set** (FX001 scope = `doctor-service.ts` + its tests). Per the standing guardrail (findings surfaced, never auto-implemented) it is **NOT folded into FX001** — surfaced as candidate follow-up **FX003** for explicit user go-ahead.
- **Coordination miss (owned)**: my `control:stop` body told the companion the review was "clean, no findings" — but F001 had already been sent + acked (`ackOf 01KTQ66525CWKCA6P8RFARYTH2`) earlier in the session and I had not drained the inbox before stopping. The companion correctly preserved F001 in its farewell and flagged the contradiction (retro **MH-003**). Lesson: **drain the companion inbox before sending `control:stop`** — see proposed magic-wand below.

### Companion retrospective (harvested → `docs/retros/code-review-companion.md`)
- **Worked well**: coordination inbox + `ackOf` links + state transitions made it easy to correlate briefing → review task → finding → summaries; the focused diff + fix dossier gave enough context to review the marker choice independently.
- **Confusing**: the stop message contradicted the finding history (MH-003); output instructions mix a rich companion envelope with a minimal generic report shape.
- **Magic wand** (target: coordination): an **outside-side stop preflight** that summarizes unresolved inside findings by `ackOf` before sending `control:stop`, so the orchestrator cannot accidentally close a run as "clean" when the companion has already sent a finding.
- **Difficulties**: MH-001 (oversized `rg` result saved temp output instead of surfacing refs — reran narrower); MH-002 (backticked `rg` pattern triggered shell command-substitution → invalid regex — single-quoted/escaped instead); MH-003 (the stop/finding contradiction above).

### Closure
FX001 is **CLOSED**: code committed `b0613e1` (277/277 green), companion review clean on the code, farewell drained + harvested. The lone finding F001 is surfaced (not auto-applied) as candidate **FX003**.
