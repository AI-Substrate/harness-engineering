import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { buildReport, type Rollup } from '../../../src/services/telemetry/report.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
  type SessionExport,
} from '../../../src/services/telemetry/session-export.js';

/**
 * 057 Phase 1 · T002/T003 (AC-01) — the `flow_stage` lens learns a richer source:
 * `cursor-moved` `flow_log` markers (real `fired_at` stage transitions projected
 * from the flight plan's append-only event log).
 *
 * Design (T001 evidence, execution.log.md): stage(event) = latest transition mark
 * at-or-before the event's `t` — a point LOOKUP over the merged timeline of
 * in-stream `flow` anchors + out-of-stream `cursor-moved` marks. The lookup never
 * re-sorts `flow_log` into gap/wall math, so the rollup exclusion policy
 * (events.ts — clock-distortion guard) is preserved. Windows labeled by a
 * cursor-moved mark count as the new additive mechanism `flow_log`; sessions with
 * NO marks keep today's flow/digit/unlabeled behavior byte-for-byte.
 *
 * Named mutations: `lookup-ignores-marks` (marks present but stages still
 * anchor-only) ⇒ RED; `mechanism-misattributed` (flow_log windows counted as
 * flow) ⇒ RED; `pre-mark-events-dropped` (events before the first mark silently
 * skipped instead of honest `unlabeled`) ⇒ RED.
 */

const tel = (root: string): string => `${root}/.harness/temp/telemetry`;

function makeDeps(
  files: Record<string, string>,
  dirs: Record<string, string[]>,
): CombineSessionDeps {
  return {
    fs: new FakeFs(files, dirs),
    proc: new FakeProcess({}, '/nowhere'),
    env: new FakeEnv({}, '/home/dev'),
  };
}

function seg(events: Event[], over: Partial<SegmentInput> = {}) {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sX',
      timecode: '2026-07-01T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: events,
      ...over,
    },
    '/repo',
  );
}

function exportOf(sub: string, segments: object[]): SessionExport {
  const files: Record<string, string> = {};
  const names: string[] = [];
  segments.forEach((s, i) => {
    files[`${tel('/work')}/${sub}/${i}.json`] = JSON.stringify(s);
    names.push(`${i}.json`);
  });
  return combineSession(sub, makeDeps(files, { [`${tel('/work')}/${sub}`]: names }), {
    root: '/work',
  });
}

function byKey(r: Rollup): Record<string, { count: number; input: number; output: number }> {
  const out: Record<string, { count: number; input: number; output: number }> = {};
  for (const e of r.entries) {
    out[e.key] = { count: e.count, input: e.tokens.input, output: e.tokens.output };
  }
  return out;
}

const T = (n: number): string => `2026-07-01T09:${String(n).padStart(2, '0')}:00Z`;
const cursorMoved = (t: string, from: string, to: string): Event =>
  ({ t, kind: 'flow_log', op: 'cursor-moved', from, to }) as Event;
const flow = (t: string, stage: string): Event =>
  ({ t, kind: 'flow', flow: 'the-flow', stage, status: 'in_progress' }) as Event;
const theFlow = (t: string, arg?: string): Event =>
  ({ t, kind: 'skill', name: 'the-flow', status: 'completed', ...(arg ? { arg } : {}) }) as Event;
const turn = (t: string, i: number, o: number): Event =>
  ({ t, kind: 'turn', dur_s: 5, in: i, out: o }) as Event;

// ── flow_log lookup as the richer source (mutation: lookup-ignores-marks) ────

describe('057 T002 — cursor-moved marks label stages by last-transition lookup', () => {
  it('attributes turns to stages from cursor-moved marks alone (no flow events)', () => {
    const s = exportOf('a', [
      seg([
        cursorMoved(T(0), 'seed', 'research'),
        turn(T(1), 100, 50),
        cursorMoved(T(2), 'research', 'plan'),
        turn(T(3), 200, 80),
        cursorMoved(T(4), 'plan', 'phase-1'),
        turn(T(5), 300, 90),
      ]),
    ]);
    const report = buildReport([s]);
    const fs = byKey(report.rollups.flow_stage);
    // MUTATION lookup-ignores-marks: no marks consumed ⇒ no keys / unlabeled ⇒ RED.
    expect(Object.keys(fs).sort()).toEqual(['phase-1', 'plan', 'research']);
    expect(fs.research).toMatchObject({ input: 100, output: 50 });
    expect(fs.plan).toMatchObject({ input: 200, output: 80 });
    expect(fs['phase-1']).toMatchObject({ input: 300, output: 90 });
    // MUTATION mechanism-misattributed: counting these as `flow` ⇒ RED.
    expect(report.provenance.flow_stage_mechanism).toEqual({
      flow: 0,
      digit: 0,
      unlabeled: 0,
      flow_log: 3,
    });
  });

  it('056-shape retroactivity: marks BEFORE the turn window still label every turn (no starvation)', () => {
    // Mirrors the real 056 ref: cursor-moves land, then ALL turns arrive after the
    // last one — the lookup attributes every turn to the last mark's stage.
    const s = exportOf('b', [
      seg([
        cursorMoved(T(0), 'research', 'plan'),
        cursorMoved(T(1), 'plan', 'phase-1'),
        turn(T(2), 10, 5),
        turn(T(3), 20, 5),
        turn(T(4), 30, 5),
      ]),
    ]);
    const report = buildReport([s]);
    const fs = byKey(report.rollups.flow_stage);
    expect(Object.keys(fs)).toEqual(['phase-1']);
    expect(fs['phase-1']).toMatchObject({ input: 60, output: 15 });
    expect(report.provenance.flow_stage_mechanism.flow_log).toBeGreaterThan(0);
  });

  it('merges in-stream flow anchors with cursor-moved marks; each window counts its own mechanism', () => {
    const s = exportOf('c', [
      seg([
        flow(T(0), 'research'),
        turn(T(1), 100, 50),
        cursorMoved(T(2), 'research', 'plan'),
        turn(T(3), 200, 80),
      ]),
    ]);
    const report = buildReport([s]);
    const fs = byKey(report.rollups.flow_stage);
    expect(Object.keys(fs).sort()).toEqual(['plan', 'research']);
    expect(fs.research).toMatchObject({ input: 100, output: 50 });
    expect(fs.plan).toMatchObject({ input: 200, output: 80 });
    expect(report.provenance.flow_stage_mechanism).toEqual({
      flow: 1,
      digit: 0,
      unlabeled: 0,
      flow_log: 1,
    });
  });

  it('events before the first mark land in an honest unlabeled window, never dropped', () => {
    const s = exportOf('d', [
      seg([turn(T(0), 40, 20), cursorMoved(T(1), 'plan', 'phase-1'), turn(T(2), 10, 5)]),
    ]);
    const report = buildReport([s]);
    const fs = byKey(report.rollups.flow_stage);
    // MUTATION pre-mark-events-dropped: fs.unlabeled missing ⇒ RED.
    expect(fs.unlabeled).toMatchObject({ input: 40, output: 20 });
    expect(fs['phase-1']).toMatchObject({ input: 10, output: 5 });
    expect(report.provenance.flow_stage_mechanism).toEqual({
      flow: 0,
      digit: 0,
      unlabeled: 1,
      flow_log: 1,
    });
  });

  it('non-cursor-moved flow_log ops (status-changed, node-created) label nothing', () => {
    const s = exportOf('e', [
      seg([
        {
          t: T(0),
          kind: 'flow_log',
          op: 'status-changed',
          node: 'plan',
          from: 'assumed',
          to: 'done',
        } as Event,
        { t: T(1), kind: 'flow_log', op: 'node-created', node: 'w1', type: 'workshop' } as Event,
        turn(T(2), 10, 5),
      ]),
    ]);
    const report = buildReport([s]);
    // No cursor-moved, no flow, no /the-flow → the lens stays empty exactly as today.
    expect(report.rollups.flow_stage.entries).toEqual([]);
    expect(report.provenance.flow_stage_mechanism).toEqual({
      flow: 0,
      digit: 0,
      unlabeled: 0,
      flow_log: 0,
    });
  });
});

// ── No-marks sessions keep today's behavior ──────────────────────────────────

describe('057 T002 — mark-free sessions are unchanged (regression)', () => {
  it('digit fallback fires exactly as before when no marks and no flow events exist', () => {
    const s = exportOf('f', [
      seg([theFlow(T(0), '05'), turn(T(1), 100, 50), theFlow(T(2), '07'), turn(T(3), 200, 80)]),
    ]);
    const report = buildReport([s]);
    expect(Object.keys(byKey(report.rollups.flow_stage)).sort()).toEqual(['05', '07']);
    expect(report.provenance.flow_stage_mechanism).toEqual({
      flow: 0,
      digit: 2,
      unlabeled: 0,
      flow_log: 0,
    });
  });

  it('flow-anchor-only sessions keep FlowEvent-primary bracketing untouched', () => {
    const s = exportOf('g', [
      seg([
        flow(T(0), 'research'),
        turn(T(1), 100, 50),
        flow(T(2), 'phase-2'),
        turn(T(3), 200, 80),
      ]),
    ]);
    const report = buildReport([s]);
    const fs = byKey(report.rollups.flow_stage);
    expect(Object.keys(fs).sort()).toEqual(['phase-2', 'research']);
    expect(report.provenance.flow_stage_mechanism).toEqual({
      flow: 2,
      digit: 0,
      unlabeled: 0,
      flow_log: 0,
    });
  });
});
