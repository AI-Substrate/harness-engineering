# Execution Log — Phase 2: CLI command surface + architecture

**Plan**: [../../harness-core-plan.md](../../harness-core-plan.md)
**Phase**: Phase 2: CLI command surface + architecture
**Mode**: Full · **Companion**: code-review-companion (Power-On-Mode), run `2026-06-08T09-12-29-770Z-3f1f`
**Started**: 2026-06-08
**Testing**: Hybrid — test-first for services/registry/config; lighter validation for acts/wiring.

> Companion onboarding refs: `minih agent-readme` · https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md · https://github.com/AI-Substrate/minih/blob/main/docs/how/companion-mode.md

## Pre-Phase Agent Harness Validation

| Stage | Status | Note |
|-------|--------|------|
| Boot / Interact / Observe | 🔴 UNAVAILABLE | No `docs/project-rules/engineering-harness.md` (or legacy governance doc). Proceeding with standard vitest testing per plan § Agent Harness Strategy. |

## Companion findings disposition

| Finding ID | ackOf (review-request) | Severity | Disposition | Notes |
|-----------|------------------------|----------|-------------|-------|
| F001 | T003 | MEDIUM | ✅ fixed in `413ae98`, re-pinged | ExecGit smoke asserted `currentBranch()` is always a string; contract allows `null` (detached HEAD, common in CI). Now accepts string-or-null; FakeGit covers the null case. |
| F002 | T005 | HIGH | ✅ fixed in `de58d83`, re-pinged | Acts read `program.opts().json`, re-introducing the collapsed tri-state bug. Introduced `CliIo{mode,writers}` resolved once by the entrypoint and injected into all acts; no act touches `program.opts().json`. |
| F003 | T005 | HIGH | ✅ fixed in `de58d83`, re-pinged | Contract drift: workshop 001 defines `run <slot> [--dry-run]` dispatcher (E108/E110/unconfigured exit 2 with `data.slot`), not a flat `run` slot. Added `acts/run.ts` + `runSlot()`; the 7 non-run slots stay top-level (AC-10); `run` excluded from the factory. |
| F004 | F002+F003-fix | MEDIUM | ✅ fixed in `4055200`, re-pinged | Stale `run --dry-run` / `run --dry-run smoke` wording in `envelope.ts` comment + `envelope.test.ts` Test Doc. Updated to reconciled `harness run smoke --dry-run`. Comments only. |
| F005 | T009 | HIGH | ✅ fixed in `db39949`, re-pinged | ESM `isMain` guard compared `argv[1]` to `import.meta.url` — under an npm/npx bin **symlink** these differ, so `main()` was skipped and the installed CLI did nothing (breaks the npx contract). Split helpers to `src/app.ts`; `index.ts` is a thin bin calling `main()` unconditionally. Verified via a symlink. |

---

## Task Log

### T001 — fs adapter (port/node/fake) [Stage 1]
**Status**: ✅ complete · **sha**: `7194874` · companion pinged

- `src/adapters/fs/fs-port.ts`: `FsPort { exists(path):boolean; readText(path):string|null }` (read-only this slice).
- `src/adapters/fs/node-fs.ts`: `NodeFs` (wraps `node:fs` `existsSync`/`readFileSync`; `readText` returns null on error, never throws).
- `src/adapters/fs/fake-fs.ts`: `FakeFs(files?)` records every probed path on `reads[]` (fakes over mocks).
- `test/adapters/fs/fake-fs.test.ts`: FakeFs seed/records + NodeFs real-file read.
- **Discovery (gotcha)**: vitest runs from `harness/cli` (the `test` recipe `cd`s there), so adapter tests that touch a real file must use a path relative to `harness/cli` (used `tsconfig.json`), NOT the repo-root `package.json`. First cut failed on `package.json`.
- **Evidence**: `just fft` green — 34 tests, coverage 95.55%.
- **AC**: contributes to AC-7 (one fake per adapter).
### T002 — process adapter (port/node/fake) [Stage 1]
**Status**: ✅ complete · **sha**: `5597cb9` · companion pinged (acked, no findings)

- `ProcessPort { which(command):string|null }`; `NodeProcess` uses `spawnSync('which'|'where', [cmd])` (only spawn site); `FakeProcess(paths?)` records `lookups[]`.
- **Evidence**: `just fft` green — 36 tests, coverage 96.36%.
- **AC**: contributes to AC-7.
### T003 — git adapter (port/exec/fake) [Stage 1]
**Status**: ✅ complete · **sha**: `9bb53e2` · companion pinged

- `GitPort { isRepo():boolean; currentBranch():string|null }`; `ExecGit` uses `git rev-parse` (read-only); `FakeGit({isRepo?,branch?})` records `calls[]`.

### T004 — env adapter (port/node/fake) [Stage 1 COMPLETE]
**Status**: ✅ complete · **sha**: `971095c` · companion pinged

- `EnvPort { get(name):string|undefined }`; `NodeEnv` wraps `process.env`; `FakeEnv(vars?)` records `gets[]`.
- **Evidence**: `just fft` green — 41 tests, coverage 95.89%. **Stage 1 (all 4 adapters) complete; AC-7 fakes present.**
- **Companion**: APPROVE on T001 (7194874) + T002 (5597cb9); T003/T004 pinged.
### T005 — Slot registry + factory act (test-first) [Stage 2 COMPLETE]
**Status**: ✅ complete · **sha**: `b41647b` · companion pinged

- `services/slots/slot-registry.ts`: `SlotStatus`, **open** `CommandSlot {name:string,status,description,next_action,acceptsDryRun?}` (NO closed `SlotName` union — R7/Q4 guardrail), `BUILTIN_SLOTS` (8, all unconfigured), `loadSlotRegistry(fs)` returns fresh copies, pure `slotEnvelope(slot,opts,clock)` → unconfigured + next_action + exit 2; `--dry-run` carries `{dry_run,slot,mapped_command:null}` (workshop 001 #4).
- `acts/unconfigured-slot.ts`: thin `registerSlotAct(program, slot)` — constructs clock, calls `slotEnvelope`, resolves OutputPort via `makeOutputPort`, exits. `--dry-run` only on run/validate.
- `output/output-port.ts`: added `makeOutputPort(flags, env, isTty, writers?) = createOutputPort(selectMode(...))`.
- Built **before** doctor so doctor consumes the registry.
- **Evidence**: `just fft` green — 52 tests, coverage 97.72%. **Stage 2 complete; AC-10.**
### T006 — help service + act [Stage 3 COMPLETE]
**Status**: ✅ complete · **sha**: `b3f1ca6` · companion pinged

- `services/help/help-service.ts`: pure `buildHelp(registry)` → `{purpose, output_modes, exit_codes, safe_first_actions, slots[]}` + `renderHelpText(content)`.
- `acts/help.ts`: human mode prints rich text (custom `OutputPort.emit`); `help --json` → `formatOk('help', content)` whose `data.slots[]` is `{name,status,description,next_action}` (AC-8/PL-02). Exit always via `exit.ts`. Writers injectable.
- **Evidence**: `just fft` green — 56 tests, coverage 98.34%. **Stage 3 complete; AC-8.**

### T007 — doctor service + act (test-first) [Stage 4 COMPLETE]
**Status**: ✅ complete · **sha**: `6380bac` · companion pinged

- `services/doctor/doctor-service.ts`: `buildDoctorReport(deps,slots)` → toolchain (proc.which), cli-build (fs.exists), command-slots (injected registry) + branch (git) + json_env (env port); `doctorEnvelope` → `formatOk` (all ready) | `formatDegraded` (any not-ok, exit 0) with required next_action; `renderDoctorText` for human stderr.
- `acts/doctor.ts`: injects real adapters; human report→stderr + summary→stdout; JSON envelope→stdout. Service tested with fakes, zero real I/O.
- **Evidence**: `just fft` green — 66 tests, coverage 98.77%. **Stage 4 complete; AC-9.**

### FIX (companion F002 + F003) — run<slot> dispatcher + CliIo into acts
**Status**: ✅ both HIGH fixed · **sha**: `de58d83` · re-pinged

- **F003 (contract drift)**: workshop 001 defines `harness run <slot> [--dry-run]` (E108 missing slot, E110 unknown slot, unconfigured exit 2 with `data.slot`). I had modelled `run` as a flat top-level slot. Added `acts/run.ts` dispatcher + `runSlot(registry, name, opts, clock)` service (command always `'run'`). The other 7 slots (validate/build/lint/test/smoke/health/observe) remain top-level convenience commands via the factory (AC-10); `run` is excluded from the factory. Both documented surfaces now faithful.
- **F002 (collapsed --json)**: acts read `program.opts().json` — re-introducing the tri-state collapse the briefing warned about. Introduced `CliIo {mode, writers}` resolved **once** by the entrypoint (T009) and injected into every act; acts no longer read `program.opts().json`. The entrypoint resolution + TTY/env fallback is tested in T009.
- **Deviation logged**: T005's "8-slot factory" became "1 dispatcher (`run`) + 7-slot factory" to honour workshop 001. tasks.md T012 wording (`harness run smoke`) is now exactly correct.
- **Evidence**: `just fft` green — 73 tests, coverage 97.56%.

### T008 — command-map validation (E120) [Stage 5 COMPLETE]
**Status**: ✅ complete · **sha**: `7749b5c` · companion pinged

- `services/config/load-config.ts`: `validateCommandMap(slots, clock)` checks non-empty name/description/next_action, valid status, unique names → `formatError(E120)` envelope (never throws) with `error.details`, else `formatOk`. In-code map only.
- **Evidence**: `just fft` green — 76 tests. **Stage 5 complete; AC-12.**

### T009 — entrypoint composition root [Stage 6 COMPLETE]
**Status**: ✅ complete · **sha**: `423762d` · companion pinged

- `src/index.ts`: commander root — `--version`, global `--json`/`--no-json`, resolves the **tri-state** output mode ONCE via `jsonFlag(argv)`+`selectMode` into `CliIo`, validates the command-map (E120 guard), registers help/doctor/run(dispatcher)/7 factory slots, bare `harness` → orientation. **No `node:fs`/`child_process`/git imports** — version read moved to `src/version.ts`; slots enumerated via `builtinSlots()` (no adapter construction in the entrypoint). `isMain` guard so the module is importable in tests.
- Removed the now-vestigial `makeOutputPort` (superseded by `CliIo` in the F002 fix).
- **Discovery (decision)**: extracted `readVersion` → `src/version.ts` so `index.ts` honours the "no fs/process/git imports" constraint (AC-6 / plan 2.2). Added `builtinSlots()` (no-fs enumerator) for the same reason.
- **Evidence**: `just fft` green — 82 tests, coverage 96.79%. Built `dist/` smoke verified end-to-end: `--version`→0.1.0; `help --json`→ok+slots; `doctor --json`→degraded (toolchain✓ cli-build✓ command-slots✗) exit 0; `run smoke`→unconfigured exit 2; `run smoke --dry-run`→data exit 2; `run`→E108 exit 1; `run bogus`→E110 exit 1; `smoke`→exit 2; bare→orientation. **Stage 6 complete; AC-6.**

### T010 — actionable-error hardening [Stage 7]
**Status**: ✅ complete · **sha**: `db0b664` · companion pinged

- `app.ts` (then split): `program.exitOverride()` + `commanderErrorEnvelope()` map commander errors → actionable envelopes (help/version→exit 0; unknown/excess args→E108; unexpected throw→E100). `main()` wraps `parse()` in try/catch so no raw stack trace escapes. `run <slot>` already emits E108/E110.
- `test/acts/errors.test.ts`: maps + run E108/E110 + asserts no `\n  at ` stack frames. **AC-11.**

### FIX (companion F005) — bin works through npm/npx symlink
**Status**: ✅ HIGH fixed · **sha**: `db39949` · re-pinged

- The ESM `isMain` guard (`process.argv[1] === fileURLToPath(import.meta.url)`) is FALSE under an npm/npx bin symlink (argv[1]=symlink, import.meta.url=target), so `main()` was skipped and the installed CLI did nothing — breaking the package's whole npx contract.
- **Fix**: moved all composition helpers to `src/app.ts` (importable, never auto-runs); `src/index.ts` is now a thin bin calling `main()` **unconditionally**. Verified by invoking through a real symlink (`--version`→0.1.0, `run smoke`→exit 2). `npm pack --dry-run` still lists `harness/cli/dist/index.js` as the bin.
- **Evidence**: `just fft` green — 87 tests, coverage 91.28% (drop = app.ts `main()` now counted, previously excluded as index.ts; report-only).

| F006 | T010 | MEDIUM | ✅ fixed in `7c8fae8`, re-pinged | `main()` help/version branch called `process.exit` directly, drifting from the single-exit-point rule. Now `return`s (Node exits 0 naturally); added `test/architecture/no-direct-exit.test.ts` enforcing only `output/exit.ts` calls `process.exit`. |
| F007 | drain | MEDIUM | ✅ fixed in docs | Phase 2 docs still told future agents to add/use the removed `makeOutputPort` and showed stale Stage-6/approval status. Added a Build-reconciliation note (makeOutputPort → CliIo; flat-slot → run-dispatcher+factory), set Stage 6 `[x]`, corrected the companion status. |

### T011 — CLI README [Stage 7]
**Status**: ✅ complete · **sha**: `617444f` · companion **APPROVE**

- `harness/cli/README.md`: npx install, command surface (help/doctor + `run <slot>` dispatcher + 7 top-level slots), output modes (flag/env/TTY precedence), exit codes 0/1/2 + rationale, envelope shape, architecture pointer. Publication-boundary clean.

### T012 — integration + coverage pass [Stage 7 — PHASE LANDED]
**Status**: ✅ complete · **sha**: `5c9cfbd` · companion pinged

- `test/integration/cli-commands.test.ts`: drives the wired composition root, asserts workshop-001 envelopes/exit codes for help/doctor/run smoke/run validate --dry-run/smoke/run(E108)/bare orientation/doctor-human.
- Final dist smoke (built binary): help --json (ok, 8 slots), doctor (exit 0), run smoke (2), run validate --dry-run (2), validate (2), run (E108→1), run bogus (E110→1), HARNESS_JSON=1 forces JSON, `npm audit` → 0 vulnerabilities.
- **Evidence**: `just fft` green — 96 tests, coverage 92.2%. **Phase 2 LANDED.**

## Phase 2 Result

- **Acceptance**: AC-6 ✅ (thin entrypoint, no business logic, no fs/process/git imports), AC-7 ✅ (acts inject services+adapters; fs/process/git/env/clock each have a fake), AC-8 ✅ (help + per-command --help; `help --json` machine-readable `data.slots[]`), AC-9 ✅ (doctor layered report, next_action per layer, human stderr/JSON stdout, exit 0), AC-10 ✅ (`run <slot>` + 7 top-level slots → unconfigured + next_action + exit 2; run/validate accept --dry-run), AC-11 ✅ (actionable errors E108/E110/E120/E100, no raw stack traces), AC-12 ✅ (services/acts unit-tested via fakes; command-map validated before use).
- **Tests**: 96 passing across 18 files; coverage 92.2% (app.ts `main()` is integration-tested; report-only).
- **Companion**: 7 findings (F001 MEDIUM, F002 HIGH, F003 HIGH, F004 MEDIUM, F005 HIGH, F006 MEDIUM, F007 MEDIUM docs-drift) — ALL raised, fixed inline, and verified/approved by the companion. Final sweep clean.
- **Deviations logged**: F001 detached-HEAD smoke; F003 run-dispatcher vs flat-slot reconciliation (run + 7 factory); F002 CliIo threading; F005 app.ts/index.ts split for the bin symlink; F006 single-exit-point.
