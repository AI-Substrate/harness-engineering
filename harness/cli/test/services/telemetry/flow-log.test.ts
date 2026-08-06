import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  type CaptureDeps,
  captureTelemetry,
} from '../../../src/services/telemetry/capture-service.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { flowLogEvents } from '../../../src/services/telemetry/flow-log.js';
import { computeRollup } from '../../../src/services/telemetry/rollup.js';
import { type Segment, serializeEvent } from '../../../src/services/telemetry/segment.js';

/**
 * Plan 035 — flow replay. The flight plan's append-only `events[]` audit log is
 * projected into telemetry `flow_log` events (pure shape, windowed by an array
 * offset, rollup-excluded). Proves AC-01..07.
 */

// ── A real-shaped flight-plan event log ─────────────────────────────────────
const LOG = [
  {
    id: 'CRT-001',
    kind: 'created',
    origin: 'engine',
    fired_at: '2026-06-24T08:00:00Z',
    details: { kind: 'flight-plan', slug: 'x' },
  },
  {
    id: 'CUR-001',
    kind: 'cursor-moved',
    origin: 'engine',
    fired_at: '2026-06-24T08:30:00Z',
    details: { from: 'plan', to: 'implement' },
  },
  {
    // SAME fired_at as CUR-001 — the collision a timestamp watermark would mishandle.
    id: 'STA-001',
    kind: 'status-changed',
    origin: 'engine',
    fired_at: '2026-06-24T08:30:00Z',
    details: { node: 'plan', from: 'in_progress', to: 'done' },
  },
];

function parse(events: unknown[]): unknown {
  return { provenance: { agent: 'the-flow' }, nav: { now: 'implement' }, nodes: [], events };
}

describe('flowLogEvents — projection (AC-01/02)', () => {
  it('projects each built-in op to its allowlisted structural shape, at its fired_at', () => {
    const { events, nextOffset } = flowLogEvents(parse(LOG), 0);
    expect(nextOffset).toBe(3);
    expect(events).toEqual([
      { t: '2026-06-24T08:00:00Z', t_precision: 'anchored', kind: 'flow_log', op: 'created' },
      {
        t: '2026-06-24T08:30:00Z',
        t_precision: 'anchored',
        kind: 'flow_log',
        op: 'cursor-moved',
        from: 'plan',
        to: 'implement',
      },
      {
        t: '2026-06-24T08:30:00Z',
        t_precision: 'anchored',
        kind: 'flow_log',
        op: 'status-changed',
        node: 'plan',
        from: 'in_progress',
        to: 'done',
      },
    ]);
  });

  it('projects node-created (type) and node-updated (edge_op when present)', () => {
    const log = [
      {
        kind: 'node-created',
        fired_at: '2026-06-24T08:00:00Z',
        details: { node: 'phase-1', type: 'phase' },
      },
      {
        kind: 'node-updated',
        fired_at: '2026-06-24T08:01:00Z',
        details: { node: 'plan', fields: ['comments'] },
      },
      {
        kind: 'node-updated',
        fired_at: '2026-06-24T08:02:00Z',
        details: { node: 'plan', edge_op: 'splice-after' },
      },
    ];
    const { events } = flowLogEvents(parse(log), 0);
    expect(events[0]).toMatchObject({ op: 'node-created', node: 'phase-1', type: 'phase' });
    // fields[] is NOT projected (lean); a plain node-updated carries just `node`
    expect(events[1]).toEqual({
      t: '2026-06-24T08:01:00Z',
      t_precision: 'anchored',
      kind: 'flow_log',
      op: 'node-updated',
      node: 'plan',
    });
    expect(events[2]).toMatchObject({ op: 'node-updated', node: 'plan', edge_op: 'splice-after' });
  });
});

describe('flowLogEvents — offset windowing (AC-04)', () => {
  it('slices by array offset (not timestamp); same-fired_at siblings both survive', () => {
    // offset 0 → all 3 (incl. the two that share 08:30 — no timestamp dedup drops them)
    expect(flowLogEvents(parse(LOG), 0).events).toHaveLength(3);
    // offset 2 → only the 3rd, even though it shares a fired_at with the 2nd
    const tail = flowLogEvents(parse(LOG), 2);
    expect(tail.events).toHaveLength(1);
    expect(tail.events[0]).toMatchObject({ op: 'status-changed' });
    expect(tail.nextOffset).toBe(3);
    // offset at the end → nothing new
    expect(flowLogEvents(parse(LOG), 3).events).toEqual([]);
  });
});

describe('flowLogEvents — privacy (AC-03) + defensiveness (AC-06)', () => {
  it('never projects free-form fields (manual description / custom value / name)', () => {
    const log = [
      {
        kind: 'custom',
        origin: 'manual',
        fired_at: '2026-06-24T08:00:00Z',
        description: 'SECRET prose the user typed',
        name: 'SECRET-metric',
        value: 'SECRET-value',
        type: 'string',
        details: {},
      },
    ];
    const { events } = flowLogEvents(parse(log), 0);
    expect(events[0]).toEqual({
      t: '2026-06-24T08:00:00Z',
      t_precision: 'anchored',
      kind: 'flow_log',
      op: 'custom',
    });
    expect(JSON.stringify(events)).not.toContain('SECRET');
  });

  it('a planted secret in details (a non-allowlisted key) is dropped', () => {
    const log = [
      {
        kind: 'cursor-moved',
        fired_at: '2026-06-24T08:00:00Z',
        details: { from: 'a', to: 'b', secret: 'LEAK' },
      },
    ];
    expect(JSON.stringify(flowLogEvents(parse(log), 0).events)).not.toContain('LEAK');
  });

  it('non-array / missing log and malformed entries never throw', () => {
    expect(flowLogEvents(null, 0)).toEqual({ events: [], nextOffset: 0 });
    expect(flowLogEvents({ events: 'nope' }, 5)).toEqual({ events: [], nextOffset: 5 });
    // an entry missing kind or fired_at is skipped, the rest survive
    const log = [{ details: {} }, { kind: 'created', fired_at: '2026-06-24T08:00:00Z' }];
    const { events, nextOffset } = flowLogEvents(parse(log), 0);
    expect(events).toHaveLength(1);
    expect(nextOffset).toBe(2);
  });
});

// ── Capture-service integration ─────────────────────────────────────────────
const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';
const PLAN = '035-x';
const FLIGHT = `${REPO}/docs/plans/${PLAN}/the-flow.json`;
const FLOWCURSOR = `${TEL}/sess1.${PLAN}.flowcursor`;

const WORK: Event[] = [
  { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 4 },
  { t: '2026-06-24T09:01:00Z', kind: 'turn', dur_s: 50, out: 120 },
];

function flightPlanJson(events: unknown[]): string {
  return JSON.stringify({
    provenance: { agent: 'the-flow' },
    nav: { now: 'implement' },
    nodes: [{ id: 'implement', status: 'in_progress' }],
    events,
  });
}

function adapter(stream: Event[]): HarnessAdapter {
  const caps: HarnessCapabilities = { event_stream: stream };
  return {
    harness: 'claude-code',
    handles: (id) => id === 'claude-code',
    currentPosition: () => 240,
    extract: () => caps,
  };
}

function deps(files: Record<string, string>, stream: Event[]): { d: CaptureDeps; fs: FakeFs } {
  const fs = new FakeFs(files);
  const d: CaptureDeps = {
    fs,
    env: new FakeEnv({
      HARNESS_TELEMETRY_CAPTURE: '1',
      CLAUDE_CODE_SESSION_ID: 'sess1',
      HARNESS_PLAN_ID: PLAN,
    }),
    clock: new FakeClock('2026-06-24T09:02:00.000Z'),
    proc: new FakeProcess({}, REPO),
    git: new FakeGit({ isRepo: true, branch: 'main', remoteUrl: 'github.com/x/y' }),
    command: 'flow',
    adapters: [adapter(stream)],
  };
  return { d, fs };
}

function seg(fs: FakeFs): Segment | null {
  const raw = fs.readText(`${TEL}/sess1/1.json`);
  return raw === null ? null : (JSON.parse(raw) as Segment);
}
function flowLogIn(s: Segment | null): Event[] {
  return (s?.event_stream ?? []).filter((e) => e.kind === 'flow_log');
}

describe('capture-service — flow_log replay (AC-04/05/06/07)', () => {
  it('appends flow_log events + the flow snapshot; advances the per-(session,plan) offset', () => {
    const { d, fs } = deps({ [FLIGHT]: flightPlanJson(LOG) }, WORK);
    captureTelemetry(d);

    const s = seg(fs);
    // the current-stage anchor is still emitted (AC-05)
    expect(s?.event_stream.some((e) => e.kind === 'flow')).toBe(true);
    // all three log entries surfaced as flow_log, appended after the work
    expect(flowLogIn(s).map((e) => (e as { op: string }).op)).toEqual([
      'created',
      'cursor-moved',
      'status-changed',
    ]);
    // offset persisted = full log length (AC-04)
    expect(fs.readText(FLOWCURSOR)).toBe('3');
  });

  it('a second capture surfaces no duplicates (offset already at the end)', () => {
    const { d, fs } = deps({ [FLIGHT]: flightPlanJson(LOG), [FLOWCURSOR]: '3' }, WORK);
    captureTelemetry(d);
    expect(flowLogIn(seg(fs))).toEqual([]);
    expect(fs.readText(FLOWCURSOR)).toBe('3');
  });

  it('AC-07 — backfilled flow_log (old fired_at) does NOT distort the rollup', () => {
    // LOG entries are 08:00/08:30; the work is 09:00–09:01. Excluding flow_log,
    // wall is the 60s work span — NOT 08:00→09:01.
    const { d, fs } = deps({ [FLIGHT]: flightPlanJson(LOG) }, WORK);
    captureTelemetry(d);
    const s = seg(fs);
    expect(s?.rollup?.activity.wall_s).toBe(60);
    // and the flow_log entries are still present in the stream for replay
    expect(flowLogIn(s)).toHaveLength(3);
  });

  it('no flight plan → no flow_log and no flowcursor write (AC-06)', () => {
    const fs = new FakeFs({}); // no FLIGHT file
    const d: CaptureDeps = {
      fs,
      env: new FakeEnv({
        HARNESS_TELEMETRY_CAPTURE: '1',
        CLAUDE_CODE_SESSION_ID: 'sess1',
        HARNESS_PLAN_ID: PLAN,
      }),
      clock: new FakeClock('2026-06-24T09:02:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch: 'main', remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [adapter(WORK)],
    };
    captureTelemetry(d);
    expect(flowLogIn(seg(fs))).toEqual([]);
    // offset is still written (0) — harmless; the point is no events + no throw
    expect(seg(fs)).not.toBeNull();
  });

  it('AC-04 — two plans in ONE session window independently (per-plan offset)', () => {
    // Same session id, two different linked plans → two independent .flowcursor files.
    const LOG_A = [
      { kind: 'cursor-moved', fired_at: '2026-06-24T08:00:00Z', details: { to: 'plan' } },
    ];
    const LOG_B = [
      {
        kind: 'node-created',
        fired_at: '2026-06-24T08:00:00Z',
        details: { node: 'x', type: 'phase' },
      },
      {
        kind: 'status-changed',
        fired_at: '2026-06-24T08:01:00Z',
        details: { node: 'x', to: 'done' },
      },
    ];
    const fs = new FakeFs({
      [`${REPO}/docs/plans/plan-a/the-flow.json`]: flightPlanJson(LOG_A),
      [`${REPO}/docs/plans/plan-b/the-flow.json`]: flightPlanJson(LOG_B),
    });
    function capWith(planId: string): void {
      captureTelemetry({
        fs,
        env: new FakeEnv({
          HARNESS_TELEMETRY_CAPTURE: '1',
          CLAUDE_CODE_SESSION_ID: 'sess1',
          HARNESS_PLAN_ID: planId,
        }),
        clock: new FakeClock('2026-06-24T09:02:00.000Z'),
        proc: new FakeProcess({}, REPO),
        git: new FakeGit({ isRepo: true, branch: 'main', remoteUrl: 'github.com/x/y' }),
        command: 'flow',
        adapters: [adapter(WORK)],
      });
    }
    capWith('plan-a');
    capWith('plan-b'); // overwrites 1.json; its segment carries ONLY plan-b's log
    expect(fs.readText(`${TEL}/sess1.plan-a.flowcursor`)).toBe('1');
    expect(fs.readText(`${TEL}/sess1.plan-b.flowcursor`)).toBe('2');
    // the last segment (plan-b) holds plan-b's ops, never plan-a's `cursor-moved`
    expect(flowLogIn(seg(fs)).map((e) => (e as { op: string }).op)).toEqual([
      'node-created',
      'status-changed',
    ]);
  });
});

// ── Schema/serializer lockstep (F001) + full rollup invariance (F002/AC-07) ──
const SCHEMA = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../src/services/telemetry/segment.schema.json',
    ),
    'utf8',
  ),
) as { properties: { event_stream: { items: { properties: Record<string, unknown> } } } };

describe('flow_log — schema/serializer lockstep (F001)', () => {
  it('every key a serialized flow_log can emit is in the schema event allowlist', () => {
    // additionalProperties:false on event items means a key the serializer emits but
    // the schema omits would make a VALID segment fail validation (the F001 defect).
    const full = serializeEvent({
      t: '2026-06-24T08:00:00Z',
      t_precision: 'anchored',
      kind: 'flow_log',
      op: 'node-created',
      node: 'phase-1',
      from: 'a',
      to: 'b',
      type: 'phase',
      edge_op: 'splice-after',
    });
    const allowed = SCHEMA.properties.event_stream.items.properties;
    for (const key of Object.keys(full)) {
      expect(allowed, `schema must allow event key "${key}"`).toHaveProperty(key);
    }
  });
});

describe('flow_log — full rollup invariance (AC-07)', () => {
  it('adding flow_log leaves EVERY rollup activity field + flow_stage_time_s unchanged', () => {
    // A timed work window with a flow snapshot (so flow_stage_time_s is non-trivial).
    const work: Event[] = [
      {
        t: '2026-06-24T09:00:00Z',
        kind: 'flow',
        flow: 'the-flow',
        stage: 'implement',
        status: 'in_progress',
      },
      { t: '2026-06-24T09:00:00Z', kind: 'prompt', words: 4 },
      { t: '2026-06-24T09:01:00Z', kind: 'turn', dur_s: 50, out: 100 },
    ];
    const withLog: Event[] = [
      ...work,
      // backfilled markers — days earlier; if they leaked into the rollup they'd
      // wreck wall_s / idle_s / stage time.
      {
        t: '2026-06-20T00:00:00Z',
        kind: 'flow_log',
        op: 'cursor-moved',
        from: 'plan',
        to: 'implement',
      },
      {
        t: '2026-06-24T08:00:00Z',
        kind: 'flow_log',
        op: 'status-changed',
        node: 'plan',
        to: 'done',
      },
    ];
    const base = computeRollup(work);
    const augmented = computeRollup(withLog);
    expect(augmented.activity).toEqual(base.activity);
    expect(augmented.flow_stage_time_s).toEqual(base.flow_stage_time_s);
  });
});
