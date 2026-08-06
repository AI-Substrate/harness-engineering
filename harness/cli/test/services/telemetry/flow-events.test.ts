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
import { flowEventFromFlightPlan } from '../../../src/services/telemetry/flow-nav.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';

/**
 * Phase 5 · T5.6 — flow-stage events (AC-18, detail doc §4.4). A `flow` event is
 * read from the linked plan's `the-flow.json` `nav` at CAPTURE time (never from
 * command args), so a command window's gap-time attributes to the current
 * flight-plan stage (`rollup.flow_stage_time_s`).
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';
const PLAN = '034-x';
const FLIGHT = `${REPO}/docs/plans/${PLAN}/the-flow.json`;

const T0 = '2026-06-24T09:00:00Z';
const T1 = '2026-06-24T09:01:00Z'; // +60s

function flightPlan(stage: string, status: string, agent = 'the-flow'): string {
  return JSON.stringify({
    provenance: { agent },
    nav: { now: stage },
    nodes: [{ id: stage, status }],
  });
}

function streamAdapter(harness: string, stream: Event[]): HarnessAdapter {
  const caps: HarnessCapabilities = { event_stream: stream };
  return {
    harness,
    handles: (id) => id === harness,
    currentPosition: () => 240,
    extract: () => caps,
  };
}

function deps(
  files: Record<string, string>,
  adapters: HarnessAdapter[],
): { d: CaptureDeps; fs: FakeFs } {
  const fs = new FakeFs(files);
  const d: CaptureDeps = {
    fs,
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'sess1', HARNESS_PLAN_ID: PLAN }),
    clock: new FakeClock('2026-06-24T09:02:00.000Z'),
    proc: new FakeProcess({}, REPO),
    git: new FakeGit({ isRepo: true, branch: PLAN, remoteUrl: 'github.com/x/y' }),
    command: 'flow',
    adapters,
  };
  return { d, fs };
}

function readSeg(fs: FakeFs): Segment | null {
  const raw = fs.readText(`${TEL}/sess1/1.json`);
  return raw === null ? null : (JSON.parse(raw) as Segment);
}

const TWO_EVENTS: Event[] = [
  { t: T0, kind: 'prompt', words: 4 },
  { t: T1, kind: 'turn', dur_s: 50, out: 120 },
];

describe('flowEventFromFlightPlan — pure derivation (T5.6)', () => {
  it('reads flow/stage from nav + status from the matching node (in_progress)', () => {
    const e = flowEventFromFlightPlan(JSON.parse(flightPlan('phase-5', 'in_progress')), T0);
    expect(e).toEqual({
      t: T0,
      t_precision: 'anchored',
      kind: 'flow',
      flow: 'the-flow',
      stage: 'phase-5',
      status: 'in_progress',
    });
  });

  it('maps node status done/blocked through; any other status ⇒ in_progress', () => {
    expect(flowEventFromFlightPlan(JSON.parse(flightPlan('ship', 'done')), T0)?.status).toBe(
      'done',
    );
    expect(flowEventFromFlightPlan(JSON.parse(flightPlan('x', 'blocked')), T0)?.status).toBe(
      'blocked',
    );
    // `assumed` is not a flow-vocabulary value → narrowed to in_progress
    expect(flowEventFromFlightPlan(JSON.parse(flightPlan('x', 'assumed')), T0)?.status).toBe(
      'in_progress',
    );
  });

  it('uses the harness-loop agent name verbatim as `flow`', () => {
    expect(
      flowEventFromFlightPlan(JSON.parse(flightPlan('boot', 'in_progress', 'harness-loop')), T0)
        ?.flow,
    ).toBe('harness-loop');
  });

  it('returns null for a plan with no nav.now or no agent (nothing honest to emit)', () => {
    expect(flowEventFromFlightPlan({ provenance: { agent: 'the-flow' }, nav: {} }, T0)).toBeNull();
    expect(flowEventFromFlightPlan({ nav: { now: 'phase-5' } }, T0)).toBeNull();
    expect(flowEventFromFlightPlan(null, T0)).toBeNull();
    expect(flowEventFromFlightPlan('not-an-object', T0)).toBeNull();
  });

  it('omits `from` — a single capture sees the current position, not the transition', () => {
    const e = flowEventFromFlightPlan(JSON.parse(flightPlan('phase-5', 'in_progress')), T0);
    expect(e && 'from' in e).toBe(false);
  });
});

describe('capture-service — flow event injection (T5.6, AC-18)', () => {
  it('prepends the flow event + attributes the window gap-time to the stage', () => {
    const { d, fs } = deps({ [FLIGHT]: flightPlan('phase-5', 'in_progress') }, [
      streamAdapter('claude-code', TWO_EVENTS),
    ]);
    captureTelemetry(d);

    const seg = readSeg(fs);
    expect(seg).not.toBeNull();
    const flow = seg?.event_stream.find((e) => e.kind === 'flow') as
      | (Event & { stage: string; status: string })
      | undefined;
    expect(flow).toMatchObject({
      kind: 'flow',
      flow: 'the-flow',
      stage: 'phase-5',
      status: 'in_progress',
    });
    // anchored to the window start so the 60s agent gap belongs to the stage
    expect(seg?.event_stream[0].kind).toBe('flow');
    expect(seg?.rollup?.flow_stage_time_s).toEqual({ 'phase-5': 60 });
  });

  it('no flight plan present → stream is emitted unchanged (no fabricated stage)', () => {
    const { d, fs } = deps({}, [streamAdapter('claude-code', TWO_EVENTS)]);
    captureTelemetry(d);

    const seg = readSeg(fs);
    expect(seg?.event_stream.some((e) => e.kind === 'flow')).toBe(false);
    expect(seg?.rollup?.flow_stage_time_s).toEqual({});
  });

  it('empty event stream → no flow event injected (nothing to attribute)', () => {
    const { d, fs } = deps({ [FLIGHT]: flightPlan('phase-5', 'in_progress') }, [
      streamAdapter('claude-code', []),
    ]);
    captureTelemetry(d);

    const seg = readSeg(fs);
    expect(seg?.event_stream).toEqual([]);
    expect(seg?.rollup).toBeNull();
  });

  it('a malformed flight plan never breaks capture (best-effort, no flow event)', () => {
    const { d, fs } = deps({ [FLIGHT]: '{ not json' }, [streamAdapter('claude-code', TWO_EVENTS)]);
    captureTelemetry(d);

    const seg = readSeg(fs);
    expect(seg).not.toBeNull();
    expect(seg?.event_stream.some((e) => e.kind === 'flow')).toBe(false);
  });

  it('resolves the flight plan when cwd is DEEP under docs/plans/<id> (companion F001)', () => {
    // cwd at `/repo/docs/plans/034-x/tasks`; the flight plan lives at the plan root.
    const deepCwd = `${REPO}/docs/plans/${PLAN}/tasks`;
    const fs = new FakeFs({ [FLIGHT]: flightPlan('phase-5', 'in_progress') });
    const d: CaptureDeps = {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'sess1' }), // no HARNESS_PLAN_ID → derived from cwd
      clock: new FakeClock('2026-06-24T09:02:00.000Z'),
      proc: new FakeProcess({}, deepCwd),
      git: new FakeGit({ isRepo: true, branch: PLAN, remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [streamAdapter('claude-code', TWO_EVENTS)],
    };
    captureTelemetry(d);

    // the buffer is written under the (deep) cwd, not the repo root
    const raw = fs.readText(`${deepCwd}/.harness/temp/telemetry/sess1/1.json`);
    expect(raw).not.toBeNull();
    const seg = JSON.parse(raw as string) as Segment;
    const flow = seg.event_stream.find((e) => e.kind === 'flow') as
      | (Event & { stage: string })
      | undefined;
    expect(flow?.stage).toBe('phase-5'); // resolved despite the deep cwd
    expect(seg.rollup?.flow_stage_time_s).toEqual({ 'phase-5': 60 });
  });

  it('explicit HARNESS_PLAN_ID overrides a different cwd-derived plan (companion F005)', () => {
    // cwd is inside plan 034-x, but HARNESS_PLAN_ID points at a DIFFERENT plan; the
    // flight plan must resolve from the repo root + the env plan id, not double the
    // cwd's own plan segment.
    const otherPlan = '035-y';
    const otherFlight = `${REPO}/docs/plans/${otherPlan}/the-flow.json`;
    const deepCwd = `${REPO}/docs/plans/${PLAN}/tasks`;
    const fs = new FakeFs({ [otherFlight]: flightPlan('design', 'in_progress') });
    const d: CaptureDeps = {
      fs,
      env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'sess1', HARNESS_PLAN_ID: otherPlan }),
      clock: new FakeClock('2026-06-24T09:02:00.000Z'),
      proc: new FakeProcess({}, deepCwd),
      git: new FakeGit({ isRepo: true, branch: otherPlan, remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      adapters: [streamAdapter('claude-code', TWO_EVENTS)],
    };
    captureTelemetry(d);

    const raw = fs.readText(`${deepCwd}/.harness/temp/telemetry/sess1/1.json`);
    const seg = JSON.parse(raw as string) as Segment;
    const flow = seg.event_stream.find((e) => e.kind === 'flow') as
      | (Event & { stage: string })
      | undefined;
    expect(flow?.stage).toBe('design'); // resolved from the env plan, not the cwd plan
  });
});
