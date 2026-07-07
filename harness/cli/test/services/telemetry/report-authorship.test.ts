import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import { buildReport } from '../../../src/services/telemetry/report.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';
import {
  type CombineSessionDeps,
  combineSession,
  type SessionExport,
} from '../../../src/services/telemetry/session-export.js';

/**
 * plan 056 · T008 (AC-08) — `buildReport` surfaces the per-file authorship view
 * (which files agents wrote + deltas), aggregated from the `file` events across
 * every included session. Built from REAL serialized segments via the real combine.
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

function seg(events: Event[], over: Partial<SegmentInput> = {}) {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sessX',
      timecode: '2026-06-29T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: events,
      ...over,
    },
    '/repo',
  );
}

const fileEvent = (path: string, change: 'written' | 'edited', la: number, lr: number): Event => ({
  t: '2026-06-29T00:00:01Z',
  kind: 'file',
  path,
  change,
  delta: { lines_added: la, lines_removed: lr, bytes_added: la * 10, bytes_removed: lr * 10 },
});

describe('buildReport authorship (T008 · AC-08)', () => {
  it('includes an authorship surface with per-file deltas + totals', () => {
    const exp = exportOf('s1', [
      seg([
        { t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 3 },
        fileEvent('src/a.ts', 'written', 10, 0),
        fileEvent('src/b.ts', 'edited', 2, 1),
      ]),
    ]);
    const report = buildReport([exp]);
    expect(report.authorship).toBeDefined();
    expect(report.authorship?.totals).toEqual({
      files: 2,
      lines_added: 12,
      lines_removed: 1,
      bytes_added: 120,
      bytes_removed: 10,
    });
    const a = report.authorship?.files.find((f) => f.path === 'src/a.ts');
    expect(a?.change).toBe('written');
    expect(a?.lines_added).toBe(10);
  });

  it('aggregates the same path across multiple sessions', () => {
    const e1 = exportOf('s1', [seg([fileEvent('src/shared.ts', 'edited', 3, 1)])]);
    const e2 = exportOf('s2', [seg([fileEvent('src/shared.ts', 'edited', 4, 2)])]);
    const report = buildReport([e1, e2]);
    const shared = report.authorship?.files.find((f) => f.path === 'src/shared.ts');
    expect(shared?.lines_added).toBe(7);
    expect(shared?.lines_removed).toBe(3);
    expect(shared?.events).toBe(2);
  });

  it('OMITS authorship when no session carried a file event', () => {
    const exp = exportOf('s1', [seg([{ t: '2026-06-29T00:00:00Z', kind: 'prompt', words: 3 }])]);
    expect(buildReport([exp]).authorship).toBeUndefined();
  });
});
