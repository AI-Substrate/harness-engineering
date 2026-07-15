# Harness sensors: headless engine and agent surface

Sensors are cheap, deterministic measurements that continuously report repository
health. They are advisory by default: readings guide a human or agent, while only
an explicit `harness sensors check` invocation turns failures into a non-zero exit
for CI callers.

This guide covers the Phase 2 headless engine. It does not describe or load a TTY
interface, Ink, or React.

## Scaffold a sensor

```bash
harness new lint-count --sensor
```

This creates:

```text
.harness/extensions/lint-count/
├── extension.ts
└── instructions.md
```

The generated `v2-sensor-ts` starter wraps `npm run lint-count`, applies a hard
timeout, maps its exit code to a reading, and includes a guidance prompt. Set the
command, watch globs, and guidance to match the repository before relying on it.
`--sensor` cannot be combined with `--sub`, `--wrap`, or `--js`.

## Authoring contract

A sensor lives under the API-2 `sensors` section. Its containing key is its flat,
cross-extension name:

```ts
import { defineExtension } from '@ai-substrate/engineering-harness/contract';

export default defineExtension({
  name: 'quality-sensors',
  summary: 'Deterministic quality signals.',
  sensors: {
    'lint-count': {
      summary: 'Whether the lint command passes.',
      watch: ['src/**/*.ts', 'test/**/*.ts'],
      timeoutMs: 60_000,
      guidance: 'Run `npm run lint` and fix the reported problems.',
      async run(ctx) {
        const result = await ctx.exec('npm', ['run', 'lint', '--silent']);
        return result.code === 0
          ? { state: 'pass', score: 0, direction: 'lower' }
          : { state: 'fail', details: 'lint reported problems' };
      },
    },
    'dependency-audit': {
      summary: 'Runs the slower dependency audit on demand.',
      trigger: 'manual',
      timeoutMs: 300_000,
      guidance: 'Review and resolve the dependency audit.',
      async run(ctx) {
        const result = await ctx.exec('npm', ['audit', '--audit-level=high']);
        return result.code === 0
          ? { state: 'pass' }
          : { state: 'fail', details: 'the dependency audit failed' };
      },
    },
  },
});
```

`SensorDecl` has this contract:

| Field | Required | Meaning |
|-------|----------|---------|
| `summary` | yes | One-line description |
| `run(ctx)` | yes | Deterministic measurement returning `SensorReading` |
| `watch` | no | Repository-relative POSIX globs; absent means no watch firing |
| `trigger` | no | `watch` by default; `manual` disables watch firing |
| `timeoutMs` | no | Hard command budget; default 30,000 ms |
| `guidance` | no | Static remediation fallback |

The run context is intentionally narrow: `{ cwd, exec }`. It has no registry,
interactive I/O, or filesystem-write capability. `exec` is shell-free and caps a
child command to the sensor's remaining budget. Code `124` means the child was
killed at the deadline.

### Reading states

A reading has `state: 'pass' | 'warn' | 'fail' | 'skip'` and may add `score`,
`direction: 'lower' | 'higher'`, `threshold`, one-line `details`, and reading-local
`guidance`.

- A numeric `score` requires `direction`; direction drives snapshot trend.
- Reading-local guidance overrides declaration guidance.
- `skip` means the measurement was not meaningful, such as an optional binary
  being absent. It never fails `check`, changes `failStreak`, or contributes a
  trend.
- Never copy raw child stdout or stderr into a reading. Persist only an authored,
  non-secret one-liner.

Whether the sensor ran is separate from what it found. State records carry
`runStatus: 'ok' | 'error' | 'timeout'`; `reading` is present only for `ok`.
Consequently, a valid `{state:'fail'}` reading is mechanically different from a
sensor that crashed or timed out.

## Commands

| Command | Behavior | Reading failure exit |
|---------|----------|----------------------|
| `harness sensors --json` | Reads state, stats, snapshot, and daemon heartbeat only | 0 |
| `harness sensors run <name>` | Runs one registered sensor and atomically writes state | 0 |
| `harness sensors watch` | Runs the foreground headless watcher and heartbeat loop | 0 |
| `harness sensors snapshot [name]` | Stores a working-session baseline from current state | 0 |
| `harness sensors check` | Runs every sensor once for an explicit CI-style check | 1 for fail/error/timeout |

`run` remains advisory even when its reading fails or its run record reports an
error or timeout. `watch` isolates one sensor failure and continues. `check` is
the sole path that maps failing readings to E215 and exit 1; `warn` and `skip`
do not fail it.

An unknown name is an argument fault (E210), and unreadable or unwritable scratch
state uses E213/E214. These operational errors are distinct from a valid failing
reading.

### Agent status read

```bash
harness sensors --json
```

The reader never invokes a sensor and never talks to the daemon over IPC. It
joins registered declarations with files on disk and returns one envelope:

```json
{
  "command": "sensors",
  "status": "ok",
  "data": {
    "daemon": {
      "running": true,
      "pid": 41217,
      "since": "2026-07-15T02:01:00.000Z",
      "heartbeatAt": "2026-07-15T02:11:05.000Z"
    },
    "snapshot": { "takenAt": "2026-07-15T01:00:00.000Z" },
    "sensors": [
      {
        "name": "lint-count",
        "summary": "Whether the lint command passes.",
        "trigger": "watch",
        "runStatus": "ok",
        "reading": { "state": "pass", "score": 0, "direction": "lower" },
        "stats": {
          "runCount": 42,
          "lastRunAt": "2026-07-15T02:11:04.512Z",
          "lastWallclockMs": 2140,
          "avgWallclockMs": 2310,
          "failStreak": 0
        },
        "ageMs": 61000,
        "stale": false,
        "delta": 0,
        "trend": "steady",
        "guidance": "Run `npm run lint` and fix the reported problems."
      }
    ]
  }
}
```

If the heartbeat is absent or older than 15 seconds, or no sensor has written
state, the reader returns `status: "degraded"` with exit 0 and a `next_action` to
start `harness sensors watch`. It never silently runs sensors and never returns
`unconfigured` on this path.

### Run and snapshot

```bash
harness sensors run lint-count
harness sensors snapshot
harness sensors snapshot lint-count
```

A run atomically updates its reading and cumulative stats. Snapshot captures one
consistent baseline for all current readings, or one named reading. Subsequent
status reads report `delta` and `trend: better | worse | steady`; absent or
skipped comparisons use `trend: null`.

### Headless watch loop

```bash
harness sensors watch
```

Run this as a foreground daemon or launch it through an environment's detached
process capability. The watcher:

1. Matches repository-relative POSIX paths with picomatch and `{ dot: true }`.
2. Quiesces each write burst for 1,000 ms.
3. Deduplicates no-op saves using a sorted SHA-256 content hash.
4. Serializes each sensor while allowing different sensors to run concurrently.
5. Keeps at most one queued rerun, marked `stale: true`.
6. Never watch-fires `trigger: 'manual'` sensors.

Native watcher events are hints and may be coalesced or reordered, particularly
on Windows. Content hashes—not event counts—define deduplication.

### Explicit check

```bash
harness sensors check
```

Use this command when a caller deliberately wants a gate. E215 includes the
failing sensor names and their guidance in `next_action`. Ordinary status,
one-off, and watch flows remain advisory.

## State layout

All runtime data is regenerable, gitignored scratch state:

```text
.harness/temp/sensors/
├── daemon.json
├── state/
│   └── lint-count.json
└── snapshot.json
```

Each file has `schema: 1`. A sensor state file stores `{record, stats}` together
so one temp-write plus same-filesystem rename commits the whole update. Stats are
`runCount`, `lastRunAt`, last and cumulative-average wallclock milliseconds, and
`failStreak`. The daemon rewrites its heartbeat every 5 seconds and is considered
running while the heartbeat is less than 15 seconds old. State uses last-writer
wins and no locks.

The snapshot is intentionally not a committed team baseline: it answers “did I
make this working session worse?” without creating cross-developer merge noise.

## Custom item discovery

V2 verbs may also fold over repository-defined `custom.<type>` items through the
presence-detected `ctx.registry.items(type)` capability. Returned items include
`type`, `name`, extension provenance, and the original `declaration`. This is a
data/discovery feature only; custom behavior remains owned by the repository.

## Error codes

| Code | Meaning |
|------|---------|
| E210 | Requested sensor is not registered |
| E211 | Sensor threw or rejected |
| E212 | Sensor command timed out |
| E213 | State, daemon, or snapshot file is unreadable or has the wrong schema |
| E214 | Atomic state write failed |
| E215 | Explicit `sensors check` aggregate failed |
| E216 | Sensor declaration is invalid |
| E217 | Duplicate sensor name; first discovered declaration remains active |
