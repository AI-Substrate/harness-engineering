# Phase 2 execution log — Sensors engine (headless)

**Plan**: 059 · **Phase**: 2 · **Date**: 2026-07-14 · **Branch**: `feat/059-typed-extensions-sensors`

## Contract authority

Implementation follows workshop 002 decisions S1–S13. In particular: typed deterministic readings (S1–S3/S11–S12), atomic schema-1 scratch state (S4–S7), picomatch (S8), only E210–E217 (S9), fixed scheduler semantics (S10), and degraded—never unconfigured—reader paths (S13).

## Progress

| Task | State | Evidence |
|------|-------|----------|
| T001 | complete before delegation | Workshop 002 is Approved. |
| T002 | complete (red lane) | Six required suites failed before production implementation: four on missing `services/sensors/*` / watcher modules; registration and custom-item suites on the absent reserved name and registry surfaces. Command exited 1 with 6 failed files, 4 executed/failed tests. |
| T003 | complete | Added S1/S2/S11 types, field validation, known-fields normalization/defaults, flat first-wins sensor registry, `sensors` reservation, E210–E217, and two appended corpus fixtures. Frozen fixture hashes remain unchanged. |
| T004 | complete | Registered custom items with provenance, injected presence-detected `ctx.registry.items(type)` on v2 contexts, and listed sensor/custom items in doctor output. |
| T005 | complete | Added schema-1 per-sensor state+stats and daemon stores with temp-write/rename commits, E213/E214 failures, FakeClock age, 15s liveness, cumulative stats, and skip-safe failure streak. |
| T006 | complete | Added atomic session snapshot storage and pure score/state trend math, including lower/higher direction and skip exclusion. |
| T007 | complete | Added `WatcherPort`, recursive Node `fs.watch` adapter, POSIX/content-hash boundary, win32 caveat docs, and recording/replayable fake with injected smoke coverage. |
| T008 | complete | Declared picomatch as a runtime dependency and added fake-clock scheduling: dot-aware globs, fixed 1s quiescence, sorted SHA-256 dedup, cross-sensor concurrency, per-sensor serialization, stale queue depth one, manual skip, and advisory failure isolation. Child exec budgets hard-kill through the existing code-124 port contract. |
| T009 | complete | Added and registered `sensors` reader/run/watch/snapshot/check: state-only S13 degraded reads, daemon/snapshot/trend JSON, atomic one-off/check/watch writes, heartbeat loop, advisory run/watch posture, skip-safe E215 check aggregation, and single-exit envelopes. No TTY/Ink branch. |
| T010 | complete | Added mutually exclusive `--sensor` / `v2-sensor-ts`, a bounded npm-command reading with static guidance and no raw output persistence, sensor-specific instructions, and a real temp-repo scaffold → jiti load → registry → `sensors run` proof. |
| T011 | complete | Added the headless engine/agent guide: authoring and reading contracts, skip/run-status semantics, verb/exit posture, JSON shape, watcher rules, scratch layout, custom discovery, and E210–E217. No TTY/Ink content. |

## Discoveries

- The frozen Phase-1 `sensor-bearing.ts` fixture predates S1 and contains `{summary, command, args}` rather than `run`. Because its bytes are an immutable compatibility promise, the runtime recognizes only that previously accepted wrapper shape, emits explicit doctor info, and normalizes it into the strict S1 `run(ctx)` form. New declarations remain strict and missing `run` fails E216.

## Gate history

- T002 red lane: `npx vitest run test/extensions/{sensors-registration,custom-items}.test.ts test/sensors/{state-store,stats,snapshot,scheduler}.test.ts` — expected failure, exit 1 (missing modules / unimplemented registry capabilities only).
- T003/T004 focused gate: 10 files / 86 tests passed, including extension activation, doctor, v2 act, appended corpus cases, and the frozen-hash guard; TypeScript passed.
- T005/T006 focused gate: 3 files / 13 tests passed; TypeScript passed.
- T007/T008 focused gate: watcher + scheduler + runner/state set passed 13/13; TypeScript passed.
- T009 focused gate: 9 files / 66 tests passed across sensors acts, app/help registration, state, snapshot, watcher, and scheduler; TypeScript passed.
- T010 focused gate: 4 files / 63 tests passed, including real temp-repo scaffold/load/run; TypeScript passed.
- T011 compiled-CLI proof in a throwaway test fixture: `new --sensor` ok; fresh `sensors --json` degraded/exit 0 with zero state; `run` ok/pass; named `snapshot` ok; `check` ok; populated daemon-down reader degraded/exit 0; real `watch` published atomic `daemon.json` before the proof process terminated it.
- Final `npm run build` passed (docs, flows, TypeScript). Full suite passed: 205 files / 2,461 tests. Biome passed for 375 files; standalone TypeScript, `git diff --check`, frozen corpus 14/14, v1 `acts/verb.ts` diff, and `npm ls picomatch --omit=dev --depth=0` all passed (`picomatch@4.0.5`). The new guide passed markdownlint and remark link validation with zero findings.
- Final compatibility reads using the same compiled core: worktree doctor at `2026-07-14T21:00:28.995Z` loaded 10/10, all v1, no failures/conflicts; read-only private-consumer doctor at `2026-07-14T21:00:29.336Z` loaded 9/9, all v1, no failures/conflicts, with byte-identical pre/post `git status --short`.
- Authoritative gate at `2026-07-14T21:00:49.809Z`: all hard gates passed; tests, Biome, typecheck, docs/flows/telemetry/doctrine drift, skills, and windows all `ok`; only the two handed-down warn-launch gates remain (`arch-check`: 2 `services-ports-type-only`; `markdown-lint`: 199 existing findings).

## Review fix packet `dlg-0002-p2-fix1`

- RED before production/hash changes: 3 files / 21 tests produced exactly 4 failures. The non-settling handler hit Vitest's 250 ms timeout instead of E212; the late rejection returned E211 `old implementation stayed pending`; A→B→A executed stale B rather than the latest A; and the directory completeness guard reported exactly `invalid-sensor.js` and `manual-sensor.ts` missing from `FROZEN_API_2`.
- F1: the whole async handler now races an abortable injected-clock deadline. It returns one E212 record without awaiting late settlement, keeps child-exec code-124 handling, and attaches both settlement handlers so a late rejection is defused. Clock cancellation prevents a successful run from leaving a live deadline timer.
- F2: while a sensor runs, every newer quiesced burst now replaces the depth-one queue slot before any hash dedup. The queued burst always executes stale after completion, even when equal to the just-finished hash, so A→B→A ends on A.
- F3: appended the two independently reviewed hashes to `FROZEN_API_2`; the fixture files were not modified. The guard now also proves that every shipped `.ts`/`.js` file in the api-2 directory has a frozen entry.
- Focused GREEN: 3 files / 21 tests. Final root `npm test` coverage suite: 205 files / 2,465 tests passed. The packet's literal `cd harness/cli && npm test` returned ENOENT because that directory has no `package.json`; root `npm test` is the repository command and itself runs `cd harness/cli && vitest run --coverage`.
- Final build, standalone typecheck, Biome (375 files), `git diff --check`, and unchanged v1 `acts/verb.ts` proof passed. Authoritative gate at `2026-07-14T21:31:19.976Z` passed every hard gate; only the same accepted architecture (2) and markdown (199) warn-launch findings remain.

## Review fix packet `dlg-0002-p2-fix2`

- RED before implementation: the runner and scheduler suites had exactly 4 failures / 21 tests. An immediately resolved async handler incorrectly recorded `wallclockMs: 10`; one-microtask and immediate-`ctx.exec` handlers incorrectly returned E212; and pure in-flight A→A incorrectly produced two runs. The 17 retained tests—including non-settling E212, late-rejection defusing, A→B→A newest-wins, and quiescent hash dedup—were green.
- F1: signal-bearing `FakeClock.sleep` calls are now virtual deadline waiters. They resolve only when explicit fake-time advancement reaches their due instant or when aborted, and never advance time themselves. One-argument fake sleeps retain immediate advance/resolve behavior for deterministic poll loops. The Clock contract comment now documents real abort, fake poll, and fake deadline semantics. Non-settling and late-rejection tests explicitly advance the virtual clock to their deadline.
- F2: while running, a hash matching the queued slot is ignored; a hash matching current with no queue is ignored; otherwise the latest distinct burst claims/replaces the slot. Completion still always executes a queued burst stale, preserving A→B→A while making pure A→A inert. This supersedes fix1's over-broad any-burst wording.
- Focused GREEN: 2 files / 21 tests. Root coverage suite: 205 files / 2,469 tests, with 91.12% statements, 80.67% branches, 93.89% functions, and 93.54% lines.
- Final build, standalone typecheck, Biome (375 files), `git diff --check`, and unchanged v1 `acts/verb.ts` proof passed. Authoritative gate at `2026-07-14T21:54:32.252Z` passed every hard gate; only the same accepted architecture (2) and markdown (199) warn-launch findings remain.

## Review fix packet `dlg-0002-p2-fix3`

- RED before implementation: the runner suite had exactly 3 failures / 14 tests. When an unawaited quick sensor execution was immediately composed with `await clock.sleep(1_000)`, direct async, one-extra-microtask, and immediate-`ctx.exec` handlers all incorrectly returned E212 with `wallclockMs: 1_000`. The other 11 tests—including a newly composed never-settling handler that correctly timed out—were green.
- Plain one-argument `FakeClock.sleep` now records immediately but defers its fake-time advancement and deadline release to the next event-loop turn, then resolves without a real timer delay. Already-runnable sensor microtasks therefore finish and abort their deadline waiter at truthful time before the poll sleep advances; genuinely pending work retains its waiter and times out when that advancement crosses the due instant. Signal-bearing sleep behavior is unchanged.
- The Clock comments now document next-turn fake poll advancement. The scheduler test's generic settle helper awaits that intentional event-loop boundary; no scheduler production behavior changed in round 3.
- Focused GREEN: runner 14/14 and direct Clock-consumer matrix 5 files / 50 tests. Root coverage suite: 205 files / 2,470 tests, with 91.11% statements, 80.65% branches, 93.90% functions, and 93.54% lines.
- Final build, standalone typecheck, Biome (375 files), `git diff --check`, and unchanged v1 `acts/verb.ts` proof passed. Authoritative gate at `2026-07-14T22:11:35.214Z` passed every hard gate; only the same accepted architecture (2) and markdown (199) warn-launch findings remain.

## Prime-verification closure (`dlg-0002-p2-fix4-closure` / `dlg-0002-p2-fix5-archport`)

- Restored `package-lock.json` directly from `HEAD`, then surgically reused its existing picomatch 4.0.4/4.0.5 metadata in exactly four topology hunks: root dependency declaration, dependency-cruiser's nested 4.0.4 entry, root runtime 4.0.5 without `dev`, and removal of vite's now-deduplicated nested entry. No install, regeneration, network request, invented metadata, or `package.json` change was made during closure.
- Updated only the `FakeClock.sleep()` test title and Test Doc prose to state its accepted next-event-loop-turn behavior after runnable microtasks and without a real timer delay; assertions were unchanged.
- Added the reusable generic `HashPort`, real `NodeHash`, and recording deterministic `FakeHash`. `SensorScheduler` now has a type-only port dependency and hashes the unchanged sorted `path\0contentHash` canonical string through it; app composition supplies `NodeHash`. The known `abc` SHA-256 vector and canonical scheduler input are pinned in tests, and `src/services/sensors/` contains no `node:crypto` import.
- Focused closure gate passed 6 files / 37 tests across hash adapters, all sensor service suites, and the sensors act. Root coverage suite passed 206 files / 2,472 tests. Build, standalone typecheck, Biome (379 files), and `git diff --check` passed. The authoritative gate at `2026-07-14T22:44:51.328Z` passed every hard gate; only the accepted architecture (2) and markdown (199) warn-launch findings remain.
