# Validation — Phase 3 tasks dossier (`tasks/phase-3-tui-packaging-docs/tasks.md`)

**Validated**: 2026-07-15 · **Mode**: adaptive (lead + 1 independent critic) · **Verdict**: ✅ **VALIDATED WITH FIXES**

## Contract

- **Purpose/Promise**: the implementable contract for Phase 3 (Ink TUI + packaging + docs) — a coder builds T001–T012 without undocumented design decisions; workshop 003 (D1–D9, Approved) is the design authority it renders into tasks.
- **Proof target**: Implementation-ready.
- **Upstream**: plan §Phase 3 (rows 3.1–3.5, AC-11..14), workshop 003, Phase 2 shipped source.
- **Consumers**: the phase coder; review-3 (D9 checklines); ship.

## Proof run

- Path/symbol existence: every Pre-Implementation Check row verified on disk; `SensorReading` fields at contract.ts:241; `FROZEN_API_2` corpus guard; E210–E217 block read at output/error-codes.ts.
- Prior-phase claims cross-checked against both phases' execution logs (lock-incident lesson, CONF-002, S12/S13 floors).
- Critic (read-only, bounded packet) independently spot-checked tsconfig, FsPort, ProcessPort, CliIo/selectMode, acts/sensors.ts, scaffold templates.

## Findings → all fixed in-target (7)

| Sev | Finding | Fix applied |
|---|---|---|
| HIGH | `.tsx` tasks with no `jsx` option in harness/cli/tsconfig.json — phase couldn't compile | T006 + Pre-Impl row pin `"jsx": "react-jsx"`; static `react/jsx-runtime` imports accepted behind the lazy boundary, re-proved by T012 import-graph |
| HIGH | mtime poll had no port support (FsPort has no stat) and services are ports-only | T003 adds `FsPort.mtimeMs(path): number \| null` + node adapter + FakeFs |
| HIGH | `c`/`q` keys required nonexistent engine capabilities (no clear API, no watcher-stop mechanism) | T003 adds `SensorStateStore.clearAll()` (snapshot kept); T008 pins `ProcessPort.kill(daemon.pid,'SIGTERM')` + pid-gone flash |
| MEDIUM | dossier named a nonexistent `buildStatus` export (real: private `readerEnvelope`, acts/sensors.ts:94) | both mentions corrected; T005 now owns extracting the shared assembly function |
| MEDIUM | TTY/TERM signal had no injected carrier (CliIo/ProcessPort expose neither; io.mode ≢ interactive) | T005 pins `CliIo.interactive: boolean` resolved once by the entrypoint (useColor precedent, output-port.ts:24); `--no-json`-on-TTY-without-ink corner specified |
| MEDIUM (lead) | T008 + workshop attributed E215 to snapshot; the no-readings snapshot actually emits a degraded envelope with `next_action`, no E-code (acts/sensors.ts:233-243); E215 = SENSORS_CHECK_FAILED | both documents corrected to the degraded-envelope flash |
| LOW→fixed (lead) | T007 cited "D14" (nonexistent) for the overlay decision | corrected to D9 #14 |

Reverification: each fix re-read in place; the three port/build additions are named in both the task rows and the Pre-Implementation Check, so no undocumented decision remains.

**Thesis**: advanced — the dossier now carries every design decision Phase 3 needs (target proof = actual proof: Implementation-ready).
**Consumers**: 3/3 — coder (T-rows + Done-Whens), review-3 (T012 D9 sweep table), ACs 11–14 mapped.
