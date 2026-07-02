import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import {
  buildReport,
  TIMELINE_KINDS,
  type TimelineMarker,
} from '../../../src/services/telemetry/report.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
  type SessionExport,
} from '../../../src/services/telemetry/session-export.js';

/**
 * Plan 048 Phase 2 (Q2 rider) — the additive, single-session-report-only
 * `control_timeline`: an ORDERED list of P12-safe control markers over a CLOSED
 * allowlist of event kinds (harness verb, checks status, subagent name, branch
 * to, and bash git push/commit SIGNATURES). It is the honest substrate the
 * insights discipline panel (sequence joins) and the subagent section consume —
 * NOT a general event dump. Built through the REAL event→segment→combine→report
 * pipeline (real-fixtures-only testing strategy).
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

function seg(events: Event[], over: Partial<SegmentInput> = {}): Segment {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: over.harness_session_id ?? 'sessX',
      timecode: '2026-06-29T00:00:00Z',
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

/** The full event stream exercising every allowlisted kind PLUS excluded kinds. */
const MIXED: Event[] = [
  { t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 12 },
  { t: '2026-06-29T00:00:01Z', kind: 'harness', verb: 'observe' },
  { t: '2026-06-29T00:00:02Z', kind: 'skill', name: 'the-flow', status: 'completed' },
  { t: '2026-06-29T00:00:03Z', kind: 'turn', dur_s: 5, in: 100, out: 40 },
  { t: '2026-06-29T00:00:04Z', kind: 'flow', flow: 'p048', stage: 'implement', status: 'active' },
  { t: '2026-06-29T00:00:05Z', kind: 'tools', name: 'Read', count: 2, span_s: 1 },
  { t: '2026-06-29T00:00:06Z', kind: 'checks', status: 'ok' },
  { t: '2026-06-29T00:00:07Z', kind: 'subagent', name: 'Explore', status: 'completed' },
  {
    t: '2026-06-29T00:00:08Z',
    kind: 'tools',
    name: 'bash',
    count: 1,
    span_s: 0,
    signature: 'git push',
  },
  { t: '2026-06-29T00:00:09Z', kind: 'branch', to: 'feat/x', from: 'main' },
  { t: '2026-06-29T00:00:10Z', kind: 'harness', verb: 'record' },
];

const has = (tl: TimelineMarker[], kind: string, key: string): boolean =>
  tl.some((m) => m.kind === kind && m.key === key);

describe('report control_timeline (Q2 — closed-allowlist control markers)', () => {
  it('a single-session report carries an ordered timeline of ONLY allowlisted markers', () => {
    const report = buildReport([exportOf('sessX', [seg(MIXED)])]);
    const tl = report.control_timeline;
    expect(tl).toBeDefined();
    if (tl === undefined) return;

    // Every marker's kind is inside the CLOSED allowlist (rider 1: never a dump).
    for (const m of tl) expect(TIMELINE_KINDS).toContain(m.kind);

    // The allowlisted markers ARE present with their P12-safe key.
    expect(has(tl, 'harness', 'observe')).toBe(true);
    expect(has(tl, 'harness', 'record')).toBe(true);
    expect(has(tl, 'checks', 'ok')).toBe(true);
    expect(has(tl, 'subagent', 'Explore')).toBe(true);
    expect(has(tl, 'branch', 'feat/x')).toBe(true);
    expect(has(tl, 'bash', 'git push')).toBe(true);

    // Ordered ascending by t.
    const ts = tl.map((m) => m.t);
    expect([...ts].sort()).toEqual(ts);
  });

  it('non-allowlisted kinds NEVER leak into the timeline (rider-1 mutation guard)', () => {
    // Mutation `add 'prompt' kind` → a prompt/turn/flow/skill marker appears → RED.
    const report = buildReport([exportOf('sessX', [seg(MIXED)])]);
    const tl = report.control_timeline ?? [];
    for (const kind of ['prompt', 'turn', 'flow', 'skill', 'tools']) {
      expect(tl.some((m) => (m.kind as string) === kind)).toBe(false);
    }
    // The the-flow skill and the Read tool do NOT become markers.
    expect(has(tl, 'skill', 'the-flow')).toBe(false);
    expect(tl.some((m) => m.key === 'Read')).toBe(false);
  });

  it('bash markers are ONLY git push/commit signatures (the push signal for §2.3)', () => {
    const events: Event[] = [
      {
        t: '2026-06-29T00:00:00Z',
        kind: 'tools',
        name: 'bash',
        count: 1,
        span_s: 0,
        signature: 'rg',
      },
      {
        t: '2026-06-29T00:00:01Z',
        kind: 'tools',
        name: 'bash',
        count: 1,
        span_s: 0,
        signature: 'git status',
      },
      {
        t: '2026-06-29T00:00:02Z',
        kind: 'tools',
        name: 'bash',
        count: 1,
        span_s: 0,
        signature: 'git push',
      },
      {
        t: '2026-06-29T00:00:03Z',
        kind: 'tools',
        name: 'bash',
        count: 1,
        span_s: 0,
        signature: 'git commit',
      },
    ];
    const report = buildReport([exportOf('sessX', [seg(events)])]);
    const bash = (report.control_timeline ?? []).filter((m) => m.kind === 'bash').map((m) => m.key);
    expect(bash.sort()).toEqual(['git commit', 'git push']);
  });

  it('a multi-session (aggregate) report OMITS the timeline (single-session-only)', () => {
    const report = buildReport([
      exportOf('sessA', [seg(MIXED, { harness_session_id: 'sessA' })]),
      exportOf('sessB', [seg(MIXED, { harness_session_id: 'sessB' })]),
    ]);
    expect(report.scope.single).toBe(false);
    expect(report.control_timeline).toBeUndefined();
  });
});
