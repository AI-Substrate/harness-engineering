# Workshop: Sensor contract & state schema

**Type**: Data Model + Storage Design
**Plan**: 059-typed-extensions-sensors
**Spec**: `../typed-extensions-sensors-plan.md` § Business Specification
**Created**: 2026-07-15
**Status**: Approved

**Value Thesis**: Every Phase 2 task (T002–T011) reads its shapes off this document — settling `SensorDecl`/`SensorReading`, the state-file schemas, snapshot location, the glob matcher, and the error-code block here converts the phase's named risk ("state-file schema churn") into a fixed contract, so the coder builds once instead of renegotiating shapes mid-phase.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Implementation Readiness**: T002's failing tests and T003–T009's implementations cite these types/schemas verbatim.
- **Safety to Change**: every persisted file carries `schema: 1`; evolution rules stated per file.
- **Agent Readiness**: the `--json` surface is specified as a worked example an agent can parse today.
- **Learning Compounding**: decisions are grounded in wild-extension evidence (private-consumer `checks`) so the contract generalizes what userland already proved it needs.

**Related Documents**:
- `001-extension-authoring-v2.md` — the v2 authoring substrate this lands on (api-2 vocabulary already reserves `sensors:`; D6 type model)
- `../spine.md` §B (sensor kind), §C (runner + state), §D (surfaces), E1/E3/E5 (the open questions this workshop closes)
- private-consumer `checks` extension (`<private-consumer>/.harness/extensions/checks/extension.ts`) — the hand-rolled sensor registry this contract subsumes

**Domain Context**:
- **Primary Domain**: harness-cli (`services/extensions/v2`, new `services/sensors/`, new `adapters/watcher/`)
- **Related Domains**: repo-engineering-substrate (windows-check covers watcher semantics)

---

## Purpose

Fix the two artifacts everything in Phase 2 hangs off (spine E1): the authoring-side contract (`SensorDecl`, `SensorReading`, the run context) and the runtime-side state schema (`.harness/temp/sensors/` layout, stats, heartbeat, snapshot). Also closes spine E3 (matcher/watcher posture) and E5 (snapshot vs git), and allocates the sensor error-code block.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Contract Ready** with no additional context. They should be able to:

- Author a sensor in a v2 extension (correct fields, correct reading semantics) without reading core source
- Write T002's failing tests against exact type/file shapes
- Parse `harness sensors --json` output and know what every field means, daemon up or down

## Key Questions Addressed

- Exact `SensorDecl` / `SensorReading` fields, incl. `trigger: 'watch' | 'manual'` (spine B4)
- State-file / stats / heartbeat / snapshot schemas and filenames (spine C2/C3/C4)
- Snapshot location relative to git (spine E5)
- Glob matcher choice given the 2-runtime-dep posture (spine E3, surfaced by Phase 2 prep)
- Sensor error-code assignments (E210+ block, verified free)

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | T002 (TDD red lane) needs exact shapes to fail for the right reason; Implementation Ready is the tasks dossier's job |
| Primary Value Axis | Implementation Readiness | 10 downstream tasks consume these decisions verbatim |
| Supporting Value Axes | Safety to Change, Agent Readiness | `schema: 1` + additive evolution rules; the `--json` example is the agent contract |
| Downstream Loop Improved | Implementation + Review | Coder builds to a fixed contract; reviewer diffs against this doc instead of reconstructing intent |

## Decision Summary (S1–S12)

| # | Decision | One-line outcome |
|---|----------|------------------|
| S1 | `SensorDecl` shape | `summary` + `run` required; `watch`/`trigger`/`timeoutMs`/`guidance` optional with stated defaults |
| S2 | `SensorReading` shape | `state: pass\|warn\|fail\|skip` (+`score`/`direction`/`threshold`/`details`/`guidance`); `skip` added on private-consumer evidence |
| S3 | Run-status vs reading-state | `SensorRunRecord.runStatus: ok\|error\|timeout` wraps `reading` — crash ≠ fail, mechanically |
| S4 | State layout | one atomic file per sensor `state/<name>.json` = `{ record, stats }`; `daemon.json`; `snapshot.json` |
| S5 | Stats fields | runCount, lastRunAt, lastWallclockMs, cumulative-mean avgWallclockMs, failStreak |
| S6 | Heartbeat & liveness | 5s beat; alive = heartbeatAt within 15s; readers never IPC |
| S7 | Snapshot location | `.harness/temp/sensors/snapshot.json` — **gitignored** (closes E5); committable team baseline = explicit non-goal |
| S8 | Glob matcher | **picomatch** (zero-dep) added as 3rd runtime dependency; hand-rolled matcher rejected |
| S9 | Error codes | **E210–E217** (block verified free by read: E204 last update code, E300 first flow code) |
| S10 | Scheduler constants | quiescence 1000ms core constant; content-hash dedup; serialize per sensor; stale-queue-of-one; timeoutMs default 30 000 hard-kill |
| S11 | `SensorRunContext` | narrow `{ cwd, exec }` — no io, no registry, no fs writes (deterministic posture) |
| S12 | Secrets guard | raw child stdout/stderr never enters readings or state; readings carry author-written one-liners only |
| S13 | Reader-path status floor | `--json`/bare readers emit `degraded` when daemon down / no state — **never `unconfigured`**, which exits 2 by the core contract (`exit.ts` `EXIT_BY_STATUS`); private-consumer dlg-0003-fix1 hit this exact trap |

---

## S1/S2/S11 — The authoring contract (`./contract` additions)

```typescript
/** Context a sensor's run() receives — deliberately narrow (S11).
 *  No io, no registry, no fs write: sensors are deterministic reporters.
 *  exec's timeout is capped by the scheduler to the sensor's remaining budget. */
export interface SensorRunContext {
  cwd: string;
  exec: (command: string, args?: string[], opts?: { cwd?: string; timeoutMs?: number; env?: Record<string, string> }) => Promise<ExecResult>;
}

/** One sensor declaration under the api-2 `sensors:` section (S1). */
export interface SensorDecl {
  /** One-line human summary (required — same posture as custom items). */
  summary: string;
  /** The deterministic measurement. Returns a reading; throwing = runStatus 'error'. */
  run: (ctx: SensorRunContext) => SensorReading | Promise<SensorReading>;
  /** Repo-root-relative globs that watch-fire this sensor. Absent/empty ⇒ never watch-fired (doctor info, not an error). */
  watch?: string[];
  /** 'watch' (default) = scheduler may auto-fire; 'manual' = only `sensors run <name>` / `sensors check` (spine B4). */
  trigger?: 'watch' | 'manual';
  /** Hard budget; scheduler kills at deadline (exit 124 ⇒ runStatus 'timeout'). Default 30_000. */
  timeoutMs?: number;
  /** Static self-correction text — fallback when a reading omits its own `guidance`. */
  guidance?: string;
}

/** What a sensor found (S2) — distinct from whether it ran (S3 / spine B3). */
export interface SensorReading {
  /** 'skip' = sensor could not meaningfully measure (e.g. optional binary absent —
   *  private-consumer gitleaks precedent); never counts as failing. */
  state: 'pass' | 'warn' | 'fail' | 'skip';
  /** Numeric measurement; requires `direction` when present. */
  score?: number;
  /** Which way is better — drives trend math (S7) and TUI arrows. */
  direction?: 'lower' | 'higher';
  /** The boundary the author considers pass/fail, for display ("12 / max 10"). */
  threshold?: number;
  /** One line of context. NEVER raw tool output (S12). */
  details?: string;
  /** Self-correction text for this reading; overrides decl.guidance. */
  guidance?: string;
}
```

**Validation posture** (extends `validate.ts`'s existing two-tier rule): `summary` missing/empty or `run` not a function → per-extension failed record **E216** (`SENSOR_DECL_INVALID`); unknown fields → tolerated + doctor info; `trigger:'watch'` (or defaulted) with no `watch` globs → doctor info "never watch-fired; runs via `sensors run`/`check`". Normalization follows the HIGH-2 rule: `NormalizedSensor` is rebuilt from the known fields above — author data can never overwrite kernel identity.

**Name rules**: sensor names share the item-key grammar verbs use (`^[a-z][a-z0-9-]*$`), live in one flat cross-extension namespace, and collide first-wins with a per-extension failed record **E217** (`SENSOR_NAME_CONFLICT`) — the exact semantics verbs get from E142.

### Authoring example (the wrap-a-command shape the `--sensor` scaffold emits)

```typescript
import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'quality-sensors',
  summary: 'Deterministic quality sensors for this repo',
  sensors: {
    'lint-count': {
      summary: 'ESLint problem count',
      watch: ['src/**/*.ts'],
      timeoutMs: 60_000,
      guidance: 'Run `npm run lint` and fix reported problems before continuing.',
      run: async (ctx) => {
        const res = await ctx.exec('npm', ['run', 'lint', '--silent']);
        // Exit-code reading — raw output NEVER copied into the reading (S12).
        return res.code === 0
          ? { state: 'pass', score: 0, direction: 'lower' }
          : { state: 'fail', details: 'eslint reported problems' };
      },
    },
    'mutation-score': {
      summary: 'Stryker mutation score',
      trigger: 'manual', // expensive — never watch-fired (spine B4)
      timeoutMs: 600_000,
      run: async (ctx) => { /* … */ return { state: 'pass', score: 87, direction: 'higher', threshold: 80 }; },
    },
  },
});
```

---

## S3/S4/S5/S6/S7 — The state store

```
.harness/temp/sensors/          # gitignored (F-12: .harness/temp/ precedent; no .gitignore edit needed)
├── daemon.json                 # heartbeat/pidfile — atomic rewrite every 5s
├── state/
│   ├── lint-count.json         # { record, stats } — ONE atomic write per run
│   └── mutation-score.json
└── snapshot.json               # baseline (S7)
```

Every write is temp-file + `FsPort.rename` (atomic on same fs — the documented contract at `fs-port.ts:22-27`). Readers (`--json`, `check`, Phase 3 TUI) only ever read these files — never IPC (spine C2). Last-writer-wins, no locks (spine C5).

### `state/<name>.json` — record + stats in one file (S4)

Reading and stats always change together, so one file keeps their update atomic without a lock:

```json
{
  "schema": 1,
  "record": {
    "sensor": "lint-count",
    "runId": 42,
    "runStatus": "ok",
    "reading": { "state": "pass", "score": 0, "direction": "lower" },
    "error": null,
    "startedAt": "2026-07-15T02:11:04.512Z",
    "wallclockMs": 2140,
    "trigger": "watch",
    "stale": false,
    "lastTriggerHash": "9f2c…"
  },
  "stats": {
    "runCount": 42,
    "lastRunAt": "2026-07-15T02:11:04.512Z",
    "lastWallclockMs": 2140,
    "avgWallclockMs": 2310,
    "failStreak": 0
  }
}
```

- `runStatus: 'ok' | 'error' | 'timeout'` — **did it run** (spine B3). `reading` is non-null iff `ok`; `error: { code, message }` is set iff not `ok` (`E211` crash, `E212` timeout). A crashed sensor is mechanically distinguishable from a failing one.
- `trigger` on the record: `'watch' | 'manual-run' | 'check'` — how this run was caused (decl `trigger` says what *may* cause runs; the record says what *did*).
- `stale: true` = the scheduler queued this rerun while a run was in flight (stale-queue-of-one, spine C1).
- `lastTriggerHash` = content hash of the matched changed set that caused the last watch run (S10 dedup input).
- `avgWallclockMs` = cumulative mean (`avg + (x − avg)/runCount`) — no window to configure, monotone memory.
- `failStreak` = consecutive runs with `runStatus !== 'ok'` **or** `reading.state === 'fail'`; reset by `pass`/`warn`; `skip` neither increments nor resets.
- **Evolution rule**: additive fields only under `schema: 1`; any breaking reshape bumps `schema` and readers report `E213` with `next_action` "re-run the sensor" (state is scratch — regeneration is always safe).

### `daemon.json` (S6)

```json
{ "schema": 1, "pid": 41217, "startedAt": "2026-07-15T02:01:00.000Z", "heartbeatAt": "2026-07-15T02:11:05.000Z", "version": "0.12.0" }
```

Beat every **5s**; readers compute `daemon.running = (now − heartbeatAt) < 15_000` (3 missed beats). No pid-probing needed for liveness (pid is informational + future kill affordance). Absent file = not running.

### `snapshot.json` (S7) — and where it lives (closes spine E5)

```json
{
  "schema": 1,
  "takenAt": "2026-07-15T01:00:00.000Z",
  "readings": { "lint-count": { "state": "pass", "score": 0 }, "mutation-score": { "state": "pass", "score": 87 } }
}
```

**Decision: gitignored, under `.harness/temp/sensors/`.** The baseline answers *"did I make this worse in this working session"* (Boeckeler's I-broke-it vs already-broken split) — it is derived from a working tree, so committing it would pin someone else's tree state as your baseline, invite merge noise on every snapshot, and turn an advisory aid into a contested artifact. A **committed team baseline is an explicit non-goal** for this plan; if evidence demands one later, it lands as a separate, deliberately-committed records-class file — never by relocating this one.

**Trend math**: per sensor, `delta = current.score − snapshot.score`, sign interpreted through `direction` → `trend: 'better' | 'worse' | 'steady'`. No score on either side → compare state rank (`pass 0 · warn 1 · fail 2`; `skip` excluded from trend). No snapshot / sensor absent from snapshot → `trend: null`.

---

## S8 — Glob matcher (closes spine E3's matcher half)

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **picomatch** | zero-dep glob matcher; the engine under micromatch | battle-tested globstar/brace/negation semantics; 0 transitive deps (posture stays honest: commander + jiti + picomatch); matches paths without touching the fs | +1 runtime dependency | **Selected** |
| In-house minimal matcher | hand-rolled `*`/`**` support | no new dep | correctness rabbit hole (braces, negation, dotfiles, separators, win32) — exactly the class of hand-rolled userland boilerplate this plan exists to delete; every edge case becomes our bug | Rejected |
| minimatch | the npm classic | familiar | carries a transitive dep (brace-expansion); no advantage over picomatch | Rejected |

Match options pinned: `picomatch(globs, { dot: true })` against **repo-root-relative POSIX paths** (win32 backslashes normalized before matching — the watcher adapter owns that, T007). The watcher-library half of E3 stays as planned: native `fs.watch` recursive behind `WatcherPort`; `@parcel/watcher` only if the windows-check surfaces edge cases the port can't paper over.

## S9 — Error codes (block verified free by read: E204 is the last update code, E300 the first flow code)

| Code | Name | Fires when | next_action carries |
|------|------|-----------|---------------------|
| E210 | `SENSOR_NOT_FOUND` | `sensors run <name>` / `snapshot` names an unregistered sensor | `harness sensors --json` to list registered sensors |
| E211 | `SENSOR_RUN_FAILED` | `run()` threw / rejected | the thrown message + "fix the sensor, then `sensors run <name>`" |
| E212 | `SENSOR_TIMEOUT` | hard `timeoutMs` kill (exec deadline, exit 124) | raise `timeoutMs` or make the sensor cheaper |
| E213 | `SENSOR_STATE_UNREADABLE` | state/snapshot/daemon file unparseable or wrong `schema` | re-run the sensor (state is regenerable scratch) |
| E214 | `SENSOR_STATE_WRITE_FAILED` | temp-write or rename failed | check `.harness/temp/` permissions |
| E215 | `SENSORS_CHECK_FAILED` | `sensors check` aggregate: any fail/error/timeout | the failing sensors' names + their guidance lines |
| E216 | `SENSOR_DECL_INVALID` | missing/empty `summary`, `run` not a function | fix the declaration; field named in message |
| E217 | `SENSOR_NAME_CONFLICT` | duplicate sensor name across extensions (first wins) | rename the later sensor; both entry paths named |

## S10 — Scheduler constants (fixed, not per-sensor knobs)

| Constant | Value | Why |
|----------|-------|-----|
| Quiescence window | 1000ms | agents write in bursts (spine C1's ~1s); core constant — per-sensor tuning is a knob nobody asked for (A7 anti-sprawl) |
| Dedup hash | sha256 over the sorted `(path, contentSha256)` pairs of the sensor's matched changed files | no-op saves and editor touch events don't rerun (spine C1); persisted as `lastTriggerHash` |
| Concurrency | serialize per sensor; different sensors may run concurrently | spine C1 |
| Rerun queue | depth 1, `stale: true` on the queued run | never a backlog (spine C1) |
| Default `timeoutMs` | 30_000 | generous for wrap-a-command sensors; expensive sensors declare their own or go `trigger:'manual'` |
| Heartbeat / liveness | 5s beat / 15s threshold | S6 |

## The `--json` agent surface (worked example — what T009 builds and an agent parses)

```json
{
  "command": "sensors",
  "status": "ok",
  "data": {
    "daemon": { "running": true, "pid": 41217, "since": "2026-07-15T02:01:00.000Z", "heartbeatAt": "2026-07-15T02:11:05.000Z" },
    "snapshot": { "takenAt": "2026-07-15T01:00:00.000Z" },
    "sensors": [
      {
        "name": "lint-count",
        "summary": "ESLint problem count",
        "trigger": "watch",
        "runStatus": "ok",
        "reading": { "state": "pass", "score": 0, "direction": "lower" },
        "stats": { "runCount": 42, "lastWallclockMs": 2140, "avgWallclockMs": 2310, "failStreak": 0 },
        "ageMs": 61000,
        "stale": false,
        "trend": "steady",
        "guidance": null
      },
      {
        "name": "mutation-score",
        "trigger": "manual",
        "runStatus": "timeout",
        "reading": null,
        "error": { "code": "E212", "message": "timed out after 600000ms" },
        "stats": { "runCount": 3, "failStreak": 1 },
        "ageMs": 7260000,
        "trend": null,
        "guidance": "Run `harness sensors run mutation-score` after shrinking the mutation scope."
      }
    ]
  }
}
```

Daemon down (or no sensor has ever written state) → `status: "degraded"` — **never `unconfigured`** (S13): the core's status contract maps `unconfigured` to **exit 2** (`exit.ts` `EXIT_BY_STATUS`), which would break AC-13's "only `check` exits non-zero" on every fresh repo; the private consumer's `checks` extension hit and fixed this exact trap (its dlg-0003-fix1 comment). `daemon.running: false`, sensors listed from whatever state files exist (stale ages honest), `next_action: "start the watcher: harness sensors watch (background: ctx.background.spawnDetached)"`. The reader **never** runs sensors to answer `--json` (spine D2; D2's `unconfigured`/`degraded` wording is superseded by S13 on this path). Envelope-level: `sensors check` is the **only** verb where failing readings map to `error` + exit 1 (E215); `run`/`watch`/`snapshot`/`--json` report honestly and exit 0 (spine C7 — matching the core's "only `error` exits non-zero" posture private-consumer already builds against).

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation (T002–T009) | every type/file shape an open negotiation mid-phase | shapes cited verbatim; churn risk closed |
| Review | reviewer reconstructs intended semantics from code | reviewer diffs code against S1–S12 |
| Agent execution | agent guesses what `--json` returns | worked example is the contract |
| private-consumer migration (later) | 15-sensor hand-rolled registry | each SENSORS row maps 1:1 onto a `SensorDecl` |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| private-consumer `checks` SENSORS array (`{name, bin, args, display}`, skip-safe gitleaks, secrets guard, only-error-exits-nonzero) | private-consumer `extension.ts` (read 2026-07-15) | S1 shape, S2 `skip` state, S12, check posture | Ready |
| `.harness/temp/` gitignore precedent | root `.gitignore:168` (read) | S4/S7 location | Ready |
| `FsPort.rename` atomicity contract | `fs-port.ts:22-27` (read) | S4 atomic writes | Ready |
| E210+ block free | `error-codes.ts` (read; also independently re-verified by the Phase-2-prep Opus critic) | S9 | Validated |
| deps = commander + jiti only | `package.json` (read) | S8 decision honesty | Ready |
| `sensors:` already in api-2 vocabulary | `contract.ts:253` + workshop 001 | activation needs no api bump | Validated |

## Open Questions

### Q1: Should `SensorReading` widen spine B2's `pass|warn|fail` with `skip`?
**RESOLVED**: Yes — the private consumer's gitleaks sensor (soft-optional binary → `skipped`, not passed/failed) is exactly the wild-extension evidence standard this plan uses; without `skip`, authors would lie with `warn`. `skip` never fails `check`, never moves `failStreak`, and is excluded from trend.

### Q2: Do stats need a rolling window / percentiles?
**RESOLVED**: No — cumulative mean + last wallclock covers the TUI/agent need (is it slow, is it getting slower); windows/percentiles are knobs with no evidence (A7).

### Q3: Does `snapshot` belong per-sensor inside `state/<name>.json`?
**RESOLVED**: No — one `snapshot.json` written at one instant is the whole point of a baseline (a consistent cut); per-sensor snapshots could interleave with runs and lie.

### Q4: `checks`-style aggregation (spine E4)?
**RESOLVED (scope)**: `sensors check` (T009) **is** the core aggregation — run-all-once, exit non-zero on fail (CI may gate; the harness doesn't). the private consumer's richer gate remains a userland verb composing over the registry; no further core affordance this plan.
