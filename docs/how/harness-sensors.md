# Harness sensors: live TUI and agent surface

Sensors are cheap, deterministic measurements that continuously report repository
health. They are advisory by default: readings guide a human or agent, while only
an explicit `harness sensors check` invocation turns failures into a non-zero exit
for CI callers.

The same state files drive two renderers: a lazy Ink interface for an interactive
terminal and a compact JSON envelope for agents, pipes, and CI. The headless
engine remains usable when the optional UI packages are absent. In this repo,
[AGENTS.md](../../AGENTS.md#sensors-one-truth-two-views) is the binding operating
rule for choosing the human or agent view.

## This repo's dogfood sensors

`.harness/extensions/repo-sensors/` declares these 12 real measurements. The
watch globs are repository-relative and are the same declarations consumed by
the watcher and displayed in the detail view:

| Sensor | Measures | Watch globs |
|--------|----------|-------------|
| `tests` | Full Vitest suite with coverage | `harness/cli/src/**/*.{ts,tsx}`, `harness/cli/test/**/*.ts`, `.harness/extensions/**/*.{ts,tsx,js,mjs,cjs}`, `harness/cli/vitest.config.ts`, `package.json`, `package-lock.json` |
| `skills-check` | Agent Skills frontmatter validity | `skills/**/*.md`, `.harness/extensions/skills-check/**/*.ts` |
| `typecheck` | CLI TypeScript with no emit | `harness/cli/src/**/*.{ts,tsx}`, `harness/cli/tsconfig.json`, `package.json`, `package-lock.json` |
| `lint` | Read-only Biome check | `harness/cli/**/*.{ts,tsx,json}`, `biome.json`, `package.json`, `package-lock.json` |
| `arch-check` | Dependency-cruiser architecture rules | `harness/cli/src/**/*.{ts,tsx}`, `.dependency-cruiser.cjs`, `.harness/extensions/arch-check/**/*.ts` |
| `docs-drift` | Generated CLI docs against curated sources | `docs/**/*.md`, `harness/cli/src/services/docs/**/*.{ts,json}`, `scripts/gen-docs.mjs` |
| `flows-drift` | Generated flow schemas/templates/fixtures | `docs/plans/**/*.md`, `harness/cli/src/services/flow/**/*.{ts,json}`, `scripts/gen-flows.mjs`, `scripts/flow-fixtures.mjs` |
| `doctrine-parity` | Harness chore/seam doctrine mirror | `skills/eng-harness-flow/SKILL.md`, `scripts/doctrine-parity.mjs` |
| `windows-check` | Cross-platform extension-source hazards | `.harness/extensions/**/*.{ts,js,mjs,cjs}` |
| `coverage-branch` | Independent branch coverage; higher is better, target 80% | same six globs as `tests` |
| `todo-debt` | Tracked debt-marker count; lower is better, target 20 | `harness/cli/src/**/*.{ts,tsx}`, `harness/cli/test/**/*.ts`, `.harness/extensions/**/*.{ts,tsx,js,mjs,cjs}`, `skills/**/*.md`, `scripts/**/*.{ts,js,mjs,cjs}`, `docs/**/*.md`, `*.md` |
| `lock-hygiene` | Internal/proxy/signed URLs in the lock; target zero | `package.json`, `package-lock.json` |

The coverage sensor is intentionally independent: it runs its own bounded
`npm test` and parses that invocation's branch summary. It never assumes the
`tests` sensor ran first; a missing summary becomes `skip`, not an invented
score. All wrappers use installed local scripts, bins, or source. They invoke no
`npx`, package installation, registry resolution, or network fallback.

The first complete check measured 20–7,230 ms per sensor. The extension records
the full command-by-command timings and timeout budgets in
`.harness/extensions/repo-sensors/instructions.md`.

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
      timeoutMs: 120_000,
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

Sensors are short-feedback instruments, not batch jobs: target seconds, tolerate
up to about 2–3 minutes, never longer. The default 30-second hard kill is the
paved path; raising `timeoutMs` above 180,000 ms is a design smell and the work
belongs in CI or a verb. **If your sensor needs 20 minutes, it isn't a sensor.**

### Reading states

A reading has `state: 'pass' | 'warn' | 'fail' | 'skip'` and may add `score`,
`direction: 'lower' | 'higher'`, `threshold`, one-line `details`, multi-line
`report`, and reading-local `guidance`.

- A numeric `score` requires `direction`; direction drives snapshot trend.
- Reading-local guidance overrides declaration guidance.
- `skip` means the measurement was not meaningful, such as an optional binary
  being absent. It never fails `check`, changes `failStreak`, or contributes a
  trend.
- `details` is the table one-liner (keep it under 80 characters); `report` is
  optional author-written detail shown in JSON and the drill-in view.
- Never copy raw child stdout or stderr into either field. Persist only authored,
  bounded, non-secret conclusions.

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
| `harness sensors check [--concurrency <n>]` | Runs every sensor once for an explicit CI-style check; defaults to four at once | 1 for fail/error/timeout |

`run` remains advisory even when its reading fails or its run record reports an
error or timeout. `watch` isolates one sensor failure and continues. `check` is
the sole path that maps failing readings to E215 and exit 1; `warn` and `skip`
do not fail it.

An unknown name is an argument fault (E210), and unreadable or unwritable scratch
state uses E213/E214. These operational errors are distinct from a valid failing
reading.

### `harness doctor` surfaces a stopped watcher

Once a repo registers sensors, their readings are only fresh while the watcher is
running and publishing its heartbeat. To keep that discoverable, `harness doctor`
adds a `sensor-watcher` layer: with sensors registered but no live heartbeat it
reports `degraded` (advisory, exit 0 — the harness never gates) and its
`next_action` spells out the three usual moves — start the watcher with
`harness sensors watch` (in the background, and **restart it after adding or
changing an extension or sensor**, since the watch set is read once at startup),
read the results as an agent with `harness sensors --json`, and view them as a
human with `harness sensors`. A repo with no sensors registered stays quiet.

## Interactive TUI

Run the bare command in an interactive terminal:

```bash
harness sensors
```

The TUI starts only when stdout is a TTY, `TERM` is not `dumb`, output mode is
human, and the optional Ink/React modules resolve. `--json` always wins. Bare
non-TTY output uses the exact same JSON path as `harness sensors --json`, with no
ANSI or alternate-screen bytes. If optional UI packages are absent on a TTY, the
command emits a degraded envelope over the same status data and recommends:

```bash
npm install ink react
```

The TUI polls state-file and daemon mtimes once per second. It does not invoke
sensors merely to refresh the screen and never uses daemon IPC.

### Keys

| Key | Action |
|-----|--------|
| `1`–`9` | Re-run that numbered sensor through the manual-run engine path |
| `↑` / `↓` | Select a row (all rows remain reachable past 9) |
| `enter` | Open the selected sensor's full-width detail view |
| `←` / `→` | In detail, scrub older/newer persisted runs; right past newest resumes live |
| `r` | In detail, re-run the selected sensor |
| `s` | Take a snapshot; a no-readings result appears as a degraded footer message |
| `a` | Run all sensors through the advisory, history-preserving manual-run path |
| `c` | Clear state and history, preserve the snapshot, then run all sensors |
| `w` | Close only the viewer; leave the watcher running |
| `q`, `q` | Confirm, signal the daemon pid with `SIGTERM`, then close |
| `esc` | Return from detail to the table |

### Status and trend glyphs

A crash never masquerades as a failing measurement:

| Meaning | Color-capable | NO_COLOR / ASCII |
|---------|---------------|------------------|
| pass | green `●` | `✓` |
| warn | yellow `●` | `!` |
| fail reading | red `●` | `✗` |
| skipped reading | dim `◌` | `-` |
| sensor crashed (E211) | red `✖` | `E` |
| sensor timed out (E212) | red `⧖` | `T` |
| running | cyan `◐` / braille spinner | `~` |
| queued rerun | dim `·` | `.` |

Trend is `↗` better, `→` steady, `▲` worse, or `—` without a comparable
snapshot. It is derived from the same `trend` value returned in JSON. `Last Run`
adds `✗N` for a failure streak and `⚠` when the reading is stale — flagged
`stale`, or older than 15 minutes. Watcher-down state is shown once in the header,
never per row.

Set `NO_COLOR=1` for shape-distinct status glyphs, or use
`harness --ascii sensors` for those glyphs plus ASCII borders and a collapsed
banner. Full layout starts at 100 columns; 84–99 drops Trend but keeps Run (so
run durations stay visible); below 84 shows a selected-sensor summary. A terminal shorter than 20 rows also collapses
the wordmark.

### Detail and playback

The detail overlay includes declaration summary/globs/timeout, latest and average
runtime, streak, snapshot delta, `details`, guidance, and the optional multi-line
`report`. Guidance precedence remains `reading.guidance` before declaration
`guidance`.

Every state write also atomically rewrites a per-sensor JSONL history ring. The
newest 50 runs are available for `←`/`→` playback; an older selection shows
`⏪ viewing run N of M`. Missing or malformed history displays `history
unavailable` without taking down the live view.

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
        "watch": ["src/**/*.ts", "test/**/*.ts"],
        "timeoutMs": 60000,
        "record": {
          "runStatus": "ok",
          "reading": {
            "state": "pass",
            "score": 0,
            "direction": "lower",
            "details": "lint passed",
            "report": "0 errors\n0 warnings"
          }
        },
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
harness sensors check --concurrency 1
```

Use this command when a caller deliberately wants a gate. E215 includes the
failing sensor names and their guidance in `next_action`. Ordinary status,
one-off, and watch flows remain advisory.

`check`, TUI `a`, and TUI clear+run share one bounded pool. It defaults to four
sensors at once (capped at the registered count), serializes repeated runs of the
same sensor, and emits results in declaration order regardless of completion
order. Parallel subprocess contention can inflate an individual sensor's
wallclock relative to an uncontended run; use `--concurrency 1` when CI needs
honest per-sensor timing rather than the fastest aggregate result.

## State layout

All runtime data is regenerable, gitignored scratch state:

```text
.harness/temp/sensors/
├── daemon.json
├── state/
│   └── lint-count.json
├── history/
│   └── lint-count.jsonl
└── snapshot.json
```

Schema-bearing state/daemon/snapshot files use `schema: 1`. A sensor state file
stores `{record, stats}` together so one temp-write plus same-filesystem rename
commits the whole update. History is one `SensorRunRecord` per line, newest last,
atomically rewrite-on-append, capped at 50; readers return newest first and skip
malformed lines with a degradation note. Stats are
`runCount`, `lastRunAt`, last and cumulative-average wallclock milliseconds, and
`failStreak`. The daemon rewrites its heartbeat every 5 seconds and is considered
running while the heartbeat is less than 15 seconds old. Run-one and run-all
calls in one process serialize writes for the same sensor; independent processes
remain last-writer-wins with no cross-process lock.

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
| E216 | Sensor declaration or `--concurrency` value is invalid |
| E217 | Duplicate sensor name; first discovered declaration remains active |
